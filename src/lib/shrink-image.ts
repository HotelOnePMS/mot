/**
 * Shrinks a photo in the browser before upload: longest side at most
 * `maxSide` pixels, re-encoded as JPEG (EXIF orientation is applied by the
 * browser when drawing). Phone photos of an ID go from several MB to about
 * half a megabyte, well inside request limits. Browser-only.
 */
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or HEIC).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That photo couldn’t be opened. Try another one, or take it again.'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser can’t prepare the photo. Try another browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL('image/jpeg', quality);
    // Very detailed photos: trade a little quality for size.
    if (out.length > 2_800_000) out = canvas.toDataURL('image/jpeg', 0.6);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
