import { PrismaClient } from '@prisma/client'
import { databaseUrl } from '@/lib/db-url'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient() {
  const url = databaseUrl()
  // directUrl is only read by migrations, but keep the schema's env reference satisfiable.
  if (url && !process.env.DIRECT_URL) process.env.DIRECT_URL = url
  return new PrismaClient(url ? { datasourceUrl: url } : undefined)
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
