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
    // Hotel booking page domains (see DEPLOYMENT.md)
    PROPERTY_DOMAIN_BASE?: string
    PROPERTY_DOMAIN_WILDCARD?: string
    APP_HOSTNAMES?: string
    INTERNAL_APP_URL?: string
    CUSTOM_DOMAIN_CNAME_TARGET?: string
    CUSTOM_DOMAIN_A_RECORD?: string
    VERCEL_API_TOKEN?: string
    VERCEL_PROJECT_ID?: string
    VERCEL_TEAM_ID?: string
  }
}
