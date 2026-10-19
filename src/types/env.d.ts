// This file defines the environment variable types for TypeScript
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test'
    DATABASE_URL: string
    NEXTAUTH_URL: string
    NEXTAUTH_URL_INTERNAL?: string
    NEXTAUTH_SECRET: string
    AUTH_TRUST_HOST?: string
    CLOUDINARY_CLOUD_NAME?: string
    CLOUDINARY_API_KEY?: string
    CLOUDINARY_API_SECRET?: string
    ANTHROPIC_API_KEY?: string
  }
}
