/**
 * Watermark GPS & waktu di atas foto via <canvas>.
 * Dipanggil setelah capture dari getUserMedia stream.
 */

export interface WatermarkInfo {
  lat: number | null;
  lng: number | null;
  timestamp: Date;
  label: string; // nama regu / siklus
  place?: string | null; // nama tempat hasil reverse geocoding (opsional)
  accuracy?: number | null;
}

export async function applyWatermark(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
  info: WatermarkInfo,
): Promise<{ blob: Blob; width: number; height: number }> {
  const w = 'videoWidth' in source ? source.videoWidth : source.width;
  const h = 'videoHeight' in source ? source.videoHeight : source.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source as CanvasImageSource, 0, 0);

  const scale = Math.max(1, Math.round(w / 640));
  const pad = 14 * scale;
  const fs = 13 * scale;
  const lh = fs * 1.35;

  // Panel semi-transparan di bawah kiri
  const coord = `📍 ${info.lat != null ? info.lat.toFixed(6) : '—'}, ${info.lng != null ? info.lng.toFixed(6) : '—'}${info.accuracy != null ? ` (±${Math.round(info.accuracy)}m)` : ''}`;
  const lines = [
    info.place ? `📌 ${info.place}` : null,
    coord,
    `🕒 ${info.timestamp.toLocaleString('id-ID', { hour12: false })}`,
    `${info.label}`,
  ].filter((l): l is string => l != null);
  const boxH = lines.length * lh + pad * 1.4;
  const maxLineW = Math.max(
    ...lines.map((l) => {
      ctx.font = `${fs}px monospace`;
      return ctx.measureText(l).width;
    }),
  );
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(pad, h - boxH - pad, maxLineW + pad * 1.6, boxH);

  ctx.font = `${fs}px monospace`;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad + pad * 0.8, h - boxH - pad + pad * 0.7 + i * lh);
  });

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('Gagal memproses foto');
  return { blob, width: w, height: h };
}
