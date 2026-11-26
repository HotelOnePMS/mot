import { put, del } from '@vercel/blob';
import { randomUUID } from 'crypto';
import { logError } from '@/server/log';
import { cloudflareContext, type R2Bucket } from '@/lib/cloudflare';

export interface UploadResult {
  url: string;
  publicId: string;
}

/**
 * Photos go to Cloudflare R2 when the app runs on Workers with the MEDIA
 * bucket bound and MEDIA_PUBLIC_URL set (the bucket's public address, e.g.
 * https://media.hotelone.site); otherwise to Vercel Blob
 * (BLOB_READ_WRITE_TOKEN). Object keys are the same in both
 * ("properties/<id>/<uuid>.jpg"), so scripts/copy-blob-to-r2.mjs can move
 * existing photos across and only the URL host changes.
 */
function r2(): { bucket: R2Bucket; publicUrl: string } | null {
  const bucket = cloudflareContext()?.env.MEDIA;
  const publicUrl = process.env.MEDIA_PUBLIC_URL?.replace(/\/$/, '');
  return bucket && publicUrl ? { bucket, publicUrl } : null;
}

/**
 * Returns true when photo storage is configured (R2, or Vercel Blob).
 * The app must keep working when it is absent — uploads are then disabled
 * with a clear admin-facing message instead of crashing.
 */
export function isBlobConfigured(): boolean {
  return !!r2() || !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Upload an image to R2 or Vercel Blob storage.
 * @param file - Base64 encoded image data (data:image/...;base64,...)
 * @param folder - Folder prefix (e.g., 'properties' or 'room-types')
 */
export async function uploadImage(file: string, folder: string = 'properties'): Promise<UploadResult> {
  if (!isBlobConfigured()) {
    throw new Error(
      'Image uploads are disabled: no photo storage is configured. ' +
      'Bind the MEDIA R2 bucket and set MEDIA_PUBLIC_URL (Cloudflare), or set BLOB_READ_WRITE_TOKEN (Vercel Blob).'
    );
  }

  // Photos only: no SVG or other types a browser could run as a document from the public blob URL.
  const matches = file.match(/^data:image\/(jpeg|jpg|png|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!matches) {
    throw new Error('Invalid image data format');
  }

  const type = matches[1] === 'jpg' ? 'jpeg' : matches[1];
  const extension = type === 'jpeg' ? 'jpg' : type;
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `${folder}/${randomUUID()}.${extension}`;

  const media = r2();
  if (media) {
    await media.bucket.put(filename, buffer, {
      httpMetadata: { contentType: `image/${type}`, cacheControl: 'public, max-age=31536000, immutable' },
    });
    return { url: `${media.publicUrl}/${filename}`, publicId: filename };
  }

  const blob = await put(filename, buffer, {
    access: 'public',
    contentType: `image/${type}`,
  });

  return {
    url: blob.url,
    publicId: blob.pathname,
  };
}

/**
 * Delete an image from R2 or Vercel Blob storage. No-op when storage is not configured.
 * @param publicId - Blob pathname (or legacy local path — those are simply skipped)
 */
export async function deleteImage(publicId: string): Promise<void> {
  if (!isBlobConfigured()) {
    console.warn('deleteImage: blob storage not configured, skipping delete of', publicId);
    return;
  }
  // Legacy local-disk publicIds (e.g. "properties/uuid.jpg") are not valid blob URLs —
  // only attempt deletion for values that look like blob pathnames/URLs.
  if (!publicId || publicId.startsWith('/uploads/')) {
    return;
  }
  const media = r2();
  if (media) {
    // Same key as on Blob, so this also removes photos copied over from there.
    await media.bucket.delete(publicId).catch((error) => logError('lib/cloudinary', 'Error deleting image from R2:', error));
    return;
  }
  try {
    await del(publicId);
  } catch (error) {
    logError('lib/cloudinary', 'Error deleting image from blob storage:', error);
  }
}
