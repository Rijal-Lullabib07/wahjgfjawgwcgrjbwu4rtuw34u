/**
 * Watermark GPS & waktu di atas foto via <canvas>.
 * Dipanggil setelah capture dari getUserMedia stream.
 *
 * KOMPRESI: foto diturunkan ke maks 1280px & JPEG q0.72 → ±120–200 KB
 * (dari ±400–600 KB). Penting untuk kuota storage Supabase — 632 personel
 * × 4 foto/hari tanpa kompresi = ±5 GB/hari.
 */

export interface WatermarkInfo {
  lat: number | null;
  lng: number | null;
  timestamp: Date;
  label: string; // nama regu / siklus
  place?: string | null; // nama tempat hasil reverse geocoding (opsional)
  accuracy?: number | null;
  /** Teks pengganti koordinat GPS (mis. foto galeri tanpa data lokasi).
   *  Bila diisi, baris koordinat diganti teks ini — jangan mengarang GPS. */
  note?: string | null;
  /** true = tanpa panel watermark sama sekali (foto galeri polos). */
  plain?: boolean;
}

/** Dimensi maksimum foto tersimpan (px, sisi terpanjang). */
const MAX_DIM = 1280;
/** Kualitas JPEG hasil akhir. */
const JPEG_QUALITY = 0.72;

export async function applyWatermark(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | HTMLImageElement,
  info: WatermarkInfo,
): Promise<{ blob: Blob; width: number; height: number }> {
  const w =
    'videoWidth' in source
      ? source.videoWidth
      : 'naturalWidth' in source
        ? source.naturalWidth
        : source.width;
  const h =
    'videoHeight' in source
      ? source.videoHeight
      : 'naturalHeight' in source
        ? source.naturalHeight
        : source.height;

  // Skala turun bila melebihi MAX_DIM (rasio aspek dipertahankan).
  const scaleDown = Math.min(1, MAX_DIM / Math.max(w, h));
  const cw = Math.round(w * scaleDown);
  const ch = Math.round(h * scaleDown);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, cw, ch);

  // Foto galeri (tanpa watermark) langsung dikompres saja.
  if (info.plain) {
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('Gagal memproses foto');
    return { blob, width: cw, height: ch };
  }

  const scale = Math.max(1, Math.round(cw / 640));
  const pad = 14 * scale;
  const fs = 13 * scale;
  const lh = fs * 1.35;

  // Panel semi-transparan di bawah kiri
  const coord = info.note
    ? `📍 ${info.note}`
    : `📍 ${info.lat != null ? info.lat.toFixed(6) : '—'}, ${info.lng != null ? info.lng.toFixed(6) : '—'}${info.accuracy != null ? ` (±${Math.round(info.accuracy)}m)` : ''}`;
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
  ctx.fillRect(pad, ch - boxH - pad, maxLineW + pad * 1.6, boxH);

  ctx.font = `${fs}px monospace`;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad + pad * 0.8, ch - boxH - pad + pad * 0.7 + i * lh);
  });

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('Gagal memproses foto');
  return { blob, width: cw, height: ch };
}

/**
 * Kompres foto galeri (unggahan manual khusus kejadian) ke maks 1280px &
 * JPEG q0.72 — sama seperti hasil kamera agar kuota storage aman.
 * Watermark TIDAK menempel koordinat GPS: foto milik masyarakat tidak
 * punya data lokasi, dan posisi HP anggota saat mengunggah bisa berbeda
 * dari lokasi kejadian. Cukup label keterangan "Dokumentasi galeri".
 */
export async function compressGaleriFoto(
  file: File,
  info: Omit<WatermarkInfo, 'lat' | 'lng' | 'place' | 'accuracy'>,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return await applyWatermark(bitmap, {
      ...info,
      lat: null,
      lng: null,
      note: 'Dokumentasi galeri — tanpa GPS',
    });
  } finally {
    bitmap.close();
  }
}
