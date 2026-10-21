'use client';

import * as React from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Point = { x: number; y: number };

const HEIGHT = 180;
const INK = '#111827';
/** Enough ink to be a signature rather than a stray tap. */
const MIN_POINTS = 12;

/**
 * Draw-your-signature pad (finger, stylus or mouse). Strokes are kept in CSS
 * pixels and redrawn on resize, so rotating a phone doesn't wipe them. The
 * exported PNG has a white background, so it reads on dark screens too.
 * Keyboard and screen-reader users sign by typing instead (the form offers both).
 */
export function SignaturePad({ onChange, className, label = 'Signature pad' }: { onChange: (png: string | null) => void; className?: string; label?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const strokes = React.useRef<Point[][]>([]);
  const drawing = React.useRef(false);
  const [empty, setEmpty] = React.useState(true);

  const redraw = React.useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y + 0.1);
      // Midpoint quadratic curves smooth the line between pointer samples.
      for (let i = 1; i < s.length; i++) {
        const mid = { x: (s[i - 1].x + s[i].x) / 2, y: (s[i - 1].y + s[i].y) / 2 };
        ctx.quadraticCurveTo(s[i - 1].x, s[i - 1].y, mid.x, mid.y);
      }
      ctx.stroke();
    }
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      redraw();
    };
    size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
    ro?.observe(canvas);
    return () => ro?.disconnect();
  }, [redraw]);

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const emit = () => {
    const points = strokes.current.reduce((n, s) => n + s.length, 0);
    const isEmpty = points < MIN_POINTS;
    setEmpty(points === 0);
    onChange(isEmpty ? null : (canvasRef.current?.toDataURL('image/png') ?? null));
  };

  const clear = () => {
    strokes.current = [];
    redraw();
    emit();
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative overflow-hidden rounded-xl border border-input bg-white">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${label}: draw your signature with a finger, stylus or mouse`}
          className="block w-full cursor-crosshair touch-none"
          style={{ height: HEIGHT }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            strokes.current.push([pointAt(e)]);
            redraw();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            strokes.current[strokes.current.length - 1].push(pointAt(e));
            redraw();
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            emit();
          }}
          onPointerCancel={() => {
            drawing.current = false;
            emit();
          }}
        />
        {/* The baseline people sign on; not part of the exported image. */}
        <div className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-dashed border-slate-300" aria-hidden />
        {empty && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-500" aria-hidden>
            Sign above the line
          </p>
        )}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={empty}>
        <Eraser aria-hidden /> Clear
      </Button>
    </div>
  );
}
