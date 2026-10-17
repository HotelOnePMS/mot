import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

// Google OAuth is optional — only registered when credentials are configured.
// Without it, customers use email/password (via /register) instead.
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleEnabled = !!googleClientId && !!googleClientSecret;
if (!googleEnabled) {
  console.warn("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set — Google sign-in is disabled; email/password login remains available.");
}

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
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // Emails are matched case-insensitively ("Maya@Hotel.com" == "maya@hotel.com").
        const user = await prisma.user.findFirst({
          where: {
            email: { equals: String(credentials.email).trim(), mode: "insensitive" },
            isActive: true
          }
        })

        // Email/password login is available to customers and staff.
        // (OAuth users have an empty password hash and can never match.)
        if (!user || !user.password) {
          return null
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!passwordMatch) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days for better security
    updateAge: 24 * 60 * 60, // Update session every 24 hours
  },
  callbacks: {
    async signIn({ user, account }) {
      // Allow Google sign-in only for customers
      if (account?.provider === "google") {
        // Check if user exists
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! }
        })

        // If user doesn't exist, create a new customer account
        if (!existingUser) {
          const [firstName, ...lastNameParts] = (user.name || "").split(" ")
          await prisma.user.create({
            data: {
              email: user.email!,
              password: "", // No password for OAuth users
              firstName: firstName || "User",
              lastName: lastNameParts.join(" ") || "Google",
              role: "CUSTOMER",
              isActive: true,
            }
          })
        } else if (existingUser.role === "ADMIN") {
          // Prevent admins from logging in with Google
          return false
        }
        return true
      }
      // Credentials login allowed for all active users with a password
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.email = user.email
        token.name = user.name
        token.id = user.id
      }

      // Fetch fresh user data to ensure role is up-to-date
      if (token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email as string }
        })
        if (dbUser) {
          token.role = dbUser.role
          token.id = dbUser.id
        }
      }

      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          id: token.id as string || token.sub || "",
          role: (token.role as "ADMIN" | "CUSTOMER") || "CUSTOMER",
          email: token.email as string,
          name: token.name as string
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
