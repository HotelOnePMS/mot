import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { prisma } from "@/lib/prisma"
import { isStaffRole } from "@/lib/routes"
import { passwordSignIn, ssoEnforcedFor } from "@/server/auth/signin"
import { consumeToken } from "@/server/auth/tokens"
import { clientIp } from "@/server/http"

// Google OAuth is optional — only registered when credentials are configured.
// Without it, customers use email/password (via /register) instead.
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleEnabled = !!googleClientId && !!googleClientSecret;
if (!googleEnabled) {
  console.warn("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set. Google sign-in is disabled; email/password login remains available.");
}

/** How this session signed in: SSO sessions rely on the identity provider's own two-step sign-in. */
type AuthMethod = "password" | "sso" | "google"

const methodOf = (provider: string | undefined): AuthMethod =>
  provider === "sso" ? "sso" : provider === "google" ? "google" : "password"

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // Trust all hosts in production

  // Production-specific configuration
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        domain: process.env.NODE_ENV === "production"
          ? process.env.NEXTAUTH_DOMAIN
          : undefined,
      },
    },
  },
  providers: [
    ...(googleEnabled
      ? [
          GoogleProvider({
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
            authorization: {
              params: {
                prompt: "consent",
                access_type: "offline",
                response_type: "code"
              }
            },
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                image: profile.picture,
                role: "CUSTOMER" as const,
              }
            },
          }),
        ]
      : []),
    CredentialsProvider({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        otp: { label: "Authenticator code", type: "text" },
      },
      // Lockouts, two-step codes and SSO-only organizations: src/server/auth/signin.ts.
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null
        const user = await passwordSignIn({
          email: String(credentials.email),
          password: String(credentials.password),
          otp: credentials.otp ? String(credentials.otp) : null,
          ip: clientIp(request),
        })
        return user ? { id: user.id, email: user.email, name: user.name, role: user.role as never, sessionVersion: user.sessionVersion } : null
      }
    }),
    // The last step of SSO: the callback (src/app/api/auth/sso/callback) hands the
    // sign-in page a single-use ticket for the person the identity provider vouched for.
    CredentialsProvider({
      id: "sso",
      name: "Single sign-on",
      credentials: { ticket: { label: "Ticket", type: "text" } },
      async authorize(credentials) {
        const userId = await consumeToken(String(credentials?.ticket ?? ""), "SSO_TICKET")
        if (!userId) return null
        const user = await prisma.user.findFirst({ where: { id: userId, isActive: true } })
        if (!user) return null
        return { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}`.trim(), role: user.role, sessionVersion: user.sessionVersion }
      }
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days for better security
    updateAge: 24 * 60 * 60, // Update session every 24 hours
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const email = user.email?.trim()
        if (!email) return false
        const existingUser = await prisma.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          include: { organizations: { select: { organization: { select: { ssoEnabled: true, ssoEnforced: true, ssoDomains: true } } } } },
        })

        // New guests get a customer account; Google has verified the address.
        if (!existingUser) {
          const [firstName, ...lastNameParts] = (user.name || "").split(" ")
          await prisma.user.create({
            data: {
              email,
              password: "", // No password for OAuth users
              firstName: firstName || "User",
              lastName: lastNameParts.join(" ") || "Google",
              role: "CUSTOMER",
              isActive: true,
              emailVerifiedAt: new Date(),
            }
          })
          return true
        }
        if (!existingUser.isActive) return false
        // Staff sign in with a password and two-step code, or their organization's SSO.
        if (isStaffRole(existingUser.role) || ssoEnforcedFor(existingUser.email, existingUser.organizations.map((m) => m.organization))) {
          return "/login?error=GoogleStaff"
        }
        // Someone may have registered this address with a password without ever proving
        // they own it. Google just proved the real owner does: drop that password.
        if (!existingUser.emailVerifiedAt) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { emailVerifiedAt: new Date(), password: "", sessionVersion: { increment: 1 } },
          })
        }
        return true
      }
      // Credentials and SSO were fully checked in authorize().
      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.role = user.role
        token.email = user.email
        token.name = user.name
        token.id = user.id
        token.amr = methodOf(account?.provider)
      }

      // Re-read the person on every check: role changes apply at once, and a
      // deactivated account or a bumped session version (password reset, two-step
      // sign-in changes, "sign out everywhere") ends this session.
      if (!token.email) return token
      const dbUser = await prisma.user.findFirst({
        where: { email: { equals: token.email as string, mode: "insensitive" } },
        select: {
          id: true,
          role: true,
          isActive: true,
          sessionVersion: true,
          mfaEnabled: true,
          organizations: { select: { organization: { select: { requireMfa: true } } } },
        },
      })
      if (!dbUser || !dbUser.isActive) return null
      if (user) token.sv = dbUser.sessionVersion
      else if ((token.sv ?? 0) !== dbUser.sessionVersion) return null
      token.role = dbUser.role
      token.id = dbUser.id
      // Staff whose organization requires two-step sign-in must set it up first (middleware.ts);
      // SSO sessions use the identity provider's own.
      token.mfaSetup =
        isStaffRole(dbUser.role) &&
        !dbUser.mfaEnabled &&
        token.amr !== "sso" &&
        dbUser.organizations.some((m) => m.organization.requireMfa)
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          id: token.id as string || token.sub || "",
          role: (token.role as "ADMIN" | "CUSTOMER") || "CUSTOMER",
          email: token.email as string,
          name: token.name as string,
          authMethod: (token.amr as AuthMethod | undefined) ?? "password",
          sessionVersion: (token.sv as number | undefined) ?? 0,
        }
      }
      return session
    }
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET, // same precedence as src/middleware.ts
  debug: process.env.NODE_ENV === "development",
})
