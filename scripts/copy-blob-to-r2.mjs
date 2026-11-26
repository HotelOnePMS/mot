#!/usr/bin/env node
/**
 * One-off: copies every photo from Vercel Blob to the Cloudflare R2 bucket
 * and points the database at the R2 copies. See CLOUDFLARE.md, step 4.
 *
 *   BLOB_READ_WRITE_TOKEN=…  CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=…
 *   R2_BUCKET=hotelone-media  MEDIA_PUBLIC_URL=https://media.hotelone.site
 *   DATABASE_URL=…  node scripts/copy-blob-to-r2.mjs [--apply]
 *
 * Without --apply it only lists what it would copy and rewrite. Objects keep
 * their Blob pathname as the R2 key, so publicId values stay valid and only
 * the URL host changes. Safe to run again: objects already in R2 are skipped,
 * and rows already on MEDIA_PUBLIC_URL don't match the Blob host any more.
 * Blob is left untouched, so Vercel keeps serving the old URLs until it is
 * retired.
 */
import { list } from '@vercel/blob';
import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
};

need('BLOB_READ_WRITE_TOKEN');
const token = need('CLOUDFLARE_API_TOKEN');
const accountId = need('CLOUDFLARE_ACCOUNT_ID');
const bucket = need('R2_BUCKET');
const mediaUrl = need('MEDIA_PUBLIC_URL').replace(/\/$/, '');

const objectUrl = (key) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;

async function existsInR2(key) {
  const res = await fetch(objectUrl(key), { method: 'HEAD', headers: { Authorization: `Bearer ${token}` } });
  return res.ok;
}

async function copy(blob) {
  if (await existsInR2(blob.pathname)) return 'skipped';
  const source = await fetch(blob.url);
  if (!source.ok) throw new Error(`download ${blob.pathname}: ${source.status}`);
  const res = await fetch(objectUrl(blob.pathname), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': source.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: Buffer.from(await source.arrayBuffer()),
  });
  if (!res.ok) throw new Error(`upload ${blob.pathname}: ${res.status} ${await res.text()}`);
  return 'copied';
}

async function main() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  console.log(`${blobs.length} objects in Vercel Blob.`);

  const counts = { copied: 0, skipped: 0, failed: 0 };
  for (const blob of blobs) {
    if (!apply) continue;
    try {
      counts[await copy(blob)]++;
    } catch (error) {
      counts.failed++;
      console.error(`  ${error.message}`);
    }
  }
  if (apply) console.log(`R2: ${counts.copied} copied, ${counts.skipped} already there, ${counts.failed} failed.`);

  // https://<store>.public.blob.vercel-storage.com/<pathname> -> <MEDIA_PUBLIC_URL>/<pathname>
  const hosts = [...new Set(blobs.map((blob) => new URL(blob.url).origin))];
  const prisma = new PrismaClient();
  try {
    for (const origin of hosts) {
      const like = `${origin}/%`;
      const [property, roomType, logos] = await Promise.all([
        prisma.propertyPhoto.count({ where: { url: { startsWith: `${origin}/` } } }),
        prisma.roomTypePhoto.count({ where: { url: { startsWith: `${origin}/` } } }),
        prisma.property.count({ where: { logoUrl: { startsWith: `${origin}/` } } }),
      ]);
      console.log(`${origin}: ${property} property photos, ${roomType} room photos, ${logos} logos to point at ${mediaUrl}.`);
      if (!apply) continue;
      if (counts.failed) {
        console.error('Some objects failed to copy, so URLs were not rewritten. Fix and run again.');
        return;
      }
      await prisma.$transaction([
        prisma.$executeRaw`UPDATE property_photos SET url = ${mediaUrl} || substr(url, ${origin.length + 1}) WHERE url LIKE ${like}`,
        prisma.$executeRaw`UPDATE room_type_photos SET url = ${mediaUrl} || substr(url, ${origin.length + 1}) WHERE url LIKE ${like}`,
        prisma.$executeRaw`UPDATE properties SET "logoUrl" = ${mediaUrl} || substr("logoUrl", ${origin.length + 1}) WHERE "logoUrl" LIKE ${like}`,
      ]);
      console.log('  rewritten.');
    }
    if (!apply) console.log('\nDry run. Run again with --apply to copy and rewrite.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
