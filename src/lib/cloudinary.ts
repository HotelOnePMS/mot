import { put, del } from '@vercel/blob';
import { randomUUID } from 'crypto';

export interface UploadResult {
  url: string;
  publicId: string;
}

/**
 * Returns true when blob storage is configured (BLOB_READ_WRITE_TOKEN set).
 * The app must keep working when it is absent — uploads are then disabled
 * with a clear admin-facing message instead of crashing.
 */
export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Upload an image to Vercel Blob storage.
 * @param file - Base64 encoded image data (data:image/...;base64,...)
 * @param folder - Folder prefix (e.g., 'properties' or 'room-types')
 */
export async function uploadImage(file: string, folder: string = 'properties'): Promise<UploadResult> {
  if (!isBlobConfigured()) {
    throw new Error(
      'Image uploads are disabled: BLOB_READ_WRITE_TOKEN is not configured. ' +
      'Connect a Vercel Blob store to enable uploads.'
    );
  }

  const matches = file.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image data format');
  }

  const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `${folder}/${randomUUID()}.${extension}`;

  const blob = await put(filename, buffer, {
    access: 'public',
    contentType: `image/${matches[1]}`,
  });

  return {
    url: blob.url,
    publicId: blob.pathname,
  };
}

/**
 * Delete an image from Vercel Blob storage. No-op when storage is not configured.
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
  try {
    await del(publicId);
  } catch (error) {
    console.error('Error deleting image from blob storage:', error);
  }
}
