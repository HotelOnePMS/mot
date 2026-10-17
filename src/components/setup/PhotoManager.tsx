'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ImageIcon, ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { IconButton } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { SmartImage } from '@/components/ui/smart-image';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { DeveloperNote } from './DeveloperNote';

interface Photo {
  id: string;
  url: string;
  isMain: boolean;
}

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 2000;
// Request bodies on Vercel Functions top out at 4.5 MB; stay well under it.
const MAX_UPLOAD_CHARS = 4_000_000;

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale to ≤2000px and re-encode as JPEG — sharp on any screen, a few hundred KB. */
async function toUploadDataUrl(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    // JPEG has no transparency: flatten onto white.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    // A format this browser can't decode: send the original.
    return toDataUrl(file);
  }
}

/**
 * Upload, choose the cover photo and delete photos for a property or room
 * type. Works against `/api/admin/{properties|room-types}/{id}/photos`.
 * Every tile is 4:3, so the grid never shifts while photos load.
 */
export function PhotoManager({ endpoint, editable = true }: { endpoint: string; editable?: boolean }) {
  const { data: photos, mutate } = useSWR<Photo[]>(endpoint, fetcher);
  const { data: config } = useSWR<{ uploadsEnabled: boolean }>('/api/config', fetcher);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState<Photo | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const uploads = !!config?.uploadsEnabled;

  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) {
      toast.error('Those files aren’t photos — use JPEG, PNG, WebP or HEIC.');
      return;
    }
    const tooBig = list.find((f) => f.size > MAX_SOURCE_BYTES);
    if (tooBig) {
      toast.error(`${tooBig.name} is larger than 25 MB.`);
      return;
    }
    setBusy('upload');
    try {
      // One photo per request keeps every upload under the body limit.
      let done = 0;
      for (const file of list) {
        setProgress(list.length > 1 ? `Uploading ${done + 1} of ${list.length}…` : 'Uploading…');
        const image = await toUploadDataUrl(file);
        if (image.length > MAX_UPLOAD_CHARS) throw new Error(`${file.name} is too large to upload — try a JPEG or a smaller photo.`);
        await api(endpoint, { method: 'POST', json: { images: [image] } });
        done += 1;
        await mutate();
      }
      toast.success(`Uploaded ${done} photo${done > 1 ? 's' : ''}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setProgress('');
      if (input.current) input.current.value = '';
    }
  }

  async function makeMain(id: string) {
    setBusy(id);
    try {
      await api(endpoint, { method: 'PATCH', json: { photoId: id } });
      await mutate();
      toast.success('Cover photo updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api(`${endpoint}?photoId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await mutate();
      setConfirmDelete(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const canUpload = editable && uploads && busy !== 'upload';

  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Photos" aria-busy={!photos}>
        {!photos &&
          Array.from({ length: 3 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="aspect-[4/3] h-auto rounded-xl" />
            </li>
          ))}
        {(photos ?? []).map((p, i) => (
          <li key={p.id} className={cn('group relative overflow-hidden rounded-xl border bg-muted', busy === p.id && 'opacity-60')}>
            <SmartImage src={p.url} alt={`Photo ${i + 1}${p.isMain ? ' (cover)' : ''}`} icon={ImageIcon} aspectRatio="4 / 3" sizes="(min-width: 1024px) 220px, 45vw" className="w-full" />
            {p.isMain && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-inverse/85 px-2 py-0.5 text-2xs font-semibold text-inverse-foreground backdrop-blur">
                <Star className="size-3 fill-current" aria-hidden /> Cover
              </span>
            )}
            {editable && (
              // Always visible on touch screens; on hover-capable screens they appear on hover or focus.
              <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0">
                {!p.isMain && (
                  <IconButton
                    label={`Use photo ${i + 1} as the cover`}
                    size="icon-sm"
                    variant="outline"
                    className="bg-surface/90 backdrop-blur"
                    onClick={() => makeMain(p.id)}
                    disabled={!!busy}
                  >
                    <Star />
                  </IconButton>
                )}
                <IconButton
                  label={`Delete photo ${i + 1}`}
                  size="icon-sm"
                  variant="outline"
                  className="bg-surface/90 text-destructive backdrop-blur hover:bg-destructive-soft hover:text-destructive-soft-foreground"
                  onClick={() => setConfirmDelete(p)}
                  disabled={!!busy}
                >
                  <Trash2 />
                </IconButton>
              </div>
            )}
          </li>
        ))}
        {editable && (
          <li>
            <button
              type="button"
              disabled={!canUpload}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                if (!canUpload) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (canUpload) void upload(e.dataTransfer.files);
              }}
              className={cn(
                'flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong/60 px-3 text-center text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-primary-soft/40 hover:text-primary-soft-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border-strong/60 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
                dragging && 'border-primary bg-primary-soft/60 text-primary-soft-foreground'
              )}
            >
              {busy === 'upload' ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
              <span className="font-medium">{busy === 'upload' ? progress || 'Uploading…' : 'Add photos'}</span>
              {busy !== 'upload' && <span className="hidden text-xs sm:block">or drop them here</span>}
            </button>
          </li>
        )}
      </ul>
      <span role="status" aria-live="polite" className="sr-only">
        {progress}
      </span>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} tabIndex={-1} aria-hidden />
      {photos && photos.length === 0 && !editable && <p className="mt-3 text-sm text-muted-foreground">No photos yet.</p>}
      {editable && config && !uploads && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted-foreground">Photo uploads aren’t switched on for this site yet. Your {PRODUCT_NAME} contact can turn them on.</p>
          <DeveloperNote>
            <p>
              Uploads need file storage: connect a Vercel Blob store (<code>BLOB_READ_WRITE_TOKEN</code>) and redeploy.
            </p>
          </DeveloperNote>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Delete this photo?"
        description={confirmDelete?.isMain ? 'It’s your cover photo — the next photo becomes the cover. This can’t be undone.' : 'It’s removed from your booking page right away. This can’t be undone.'}
        confirmLabel="Delete photo"
        destructive
        loading={!!confirmDelete && busy === confirmDelete.id}
        onConfirm={() => confirmDelete && void remove(confirmDelete.id)}
      />
    </div>
  );
}
