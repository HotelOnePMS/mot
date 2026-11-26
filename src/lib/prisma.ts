import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '@/lib/db-url'
import { cloudflareContext, onCloudflare } from '@/lib/cloudflare'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient() {
  const url = databaseUrl()
  // directUrl is only read by migrations, but keep the schema's env reference satisfiable.
  if (url && !process.env.DIRECT_URL) process.env.DIRECT_URL = url
  return new PrismaClient(url ? { datasourceUrl: url } : undefined)
}

/**
 * On Cloudflare Workers a database socket belongs to the request that opened
 * it, so one shared client would fail on the second request. Each request
 * gets its own client over the `pg` driver adapter, through Hyperdrive when
 * it is bound (pooling and a warm connection near the Worker), else straight
 * to DATABASE_URL. The client lives as long as the request's context, which
 * includes work kept alive with after() / waitUntil.
 */
const requestClients = new WeakMap<object, PrismaClient>()

function cloudflareClient(): PrismaClient {
  const context = cloudflareContext()
  if (!context) {
    // Build-time or a script run under HOSTING=cloudflare: no request to bind to.
    return (globalForPrisma.prisma ??= createClient())
  }
  let client = requestClients.get(context.ctx)
  if (!client) {
    const connectionString = context.env.HYPERDRIVE?.connectionString || databaseUrl()
    if (!connectionString) throw new Error('No database configured: bind HYPERDRIVE or set DATABASE_URL')
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString, maxUses: 1 }) })
    requestClients.set(context.ctx, client)
  }
  return client
}

function nodeClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? createClient()
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
  return client
}

let shared: PrismaClient | undefined

/**
 * Picks the client on each use rather than at import, because on Workers the
 * environment (HOSTING) is only filled in when the first request arrives.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = onCloudflare() ? cloudflareClient() : (shared ??= nodeClient())
    const value = Reflect.get(client, property, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
