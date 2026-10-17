import { type DefaultSession } from "next-auth"

export type UserRole = "ADMIN" | "OWNER" | "MANAGER" | "FRONT_DESK" | "HOUSEKEEPER" | "CUSTOMER"

export type ExtendedUser = DefaultSession["user"] & {
  id: string
  role: UserRole
}

declare module "next-auth" {
  interface Session {
    user: ExtendedUser
  }

  interface User {
    role: UserRole
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole
    id?: string
  }
}
