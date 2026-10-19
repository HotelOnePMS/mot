import { type DefaultSession } from "next-auth"

export type UserRole = "ADMIN" | "OWNER" | "MANAGER" | "FRONT_DESK" | "HOUSEKEEPER" | "CUSTOMER"

export type ExtendedUser = DefaultSession["user"] & {
  id: string
  role: UserRole
  /** How this session signed in. */
  authMethod: "password" | "sso" | "google"
  sessionVersion: number
}

declare module "next-auth" {
  interface Session {
    user: ExtendedUser
  }

  interface User {
    role: UserRole
    sessionVersion?: number
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole
    id?: string
    /** User.sessionVersion at sign-in; a newer one in the database ends the session. */
    sv?: number
    amr?: "password" | "sso" | "google"
    /** Must set up two-step sign-in before using the console. */
    mfaSetup?: boolean
  }
}
