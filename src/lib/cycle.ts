/**
 * Pelaporan 24 jam — tidak ada lagi siklus 2 jam.
 *
 * Laporan bisa dikirim kapan saja sepanjang hari; satu hari = satu periode
 * pelaporan (00.00–24.00 WIB). Konstanta & fungsi siklus dipertahankan agar
 * skema DB lama (`laporan.siklus_ke`) dan komponen yang sudah memakai
 * `CycleInfo` tetap kompatibel: `siklusKe` selalu 1 dan `minutesLeft` selalu 0
 * (tidak dipakai lagi di UI).
 */
export const CYCLE_START_HOUR = 0; // periode mulai 00.00 lokal
export const CYCLE_LENGTH_HOURS = 24;
export const CYCLES_PER_DAY = 1;
/** Refensi lama (maks foto "lengkap"); tidak lagi dipakai UI pemantau. */
export const FOTOS_PER_SIKLUS = 2;

export interface CycleInfo {
  siklusKe: number; // selalu 1 (kompatibilitas kolom laporan.siklus_ke)
  start: Date;
  end: Date;
  minutesLeft: number; // selalu 0 — tidak dipakai lagi
  label: string; // contoh: "Pelaporan 24 jam · 20 Sep"
}

/** Info periode pelaporan berjalan pada waktu tertentu (default: sekarang). */
export function getCurrentCycle(now: Date = new Date()): CycleInfo {
  const start = new Date(now);
  start.setHours(CYCLE_START_HOUR, 0, 0, 0);
  const end = new Date(start.getTime() + CYCLE_LENGTH_HOURS * 3600_000);

  const fmt = (d: Date) =>
    d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });

  return {
    siklusKe: 1,
    start,
    end,
    minutesLeft: 0,
    label: `Pelaporan 24 jam · ${fmt(now)}`,
  };
}

/** Rentang waktu periode untuk tanggal tertentu (00.00–24.00). */
export function getCycleRange(date: Date, _siklusKe = 1): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(CYCLE_START_HOUR, 0, 0, 0);
  const end = new Date(start.getTime() + CYCLE_LENGTH_HOURS * 3600_000);
  return { start, end };
}

export function formatWaktu(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTanggal(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatKoordinat(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}
