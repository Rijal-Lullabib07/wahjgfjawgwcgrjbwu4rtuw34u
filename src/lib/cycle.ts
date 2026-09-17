/**
 * Logika siklus laporan: 1 hari = 12 siklus × 2 jam.
 * Siklus dimulai pukul 04.00 WIB ( UTC+8 ) → siklus 1: 04–06, siklus 2: 06–08, ... siklus 12: 02–04.
 */
export const CYCLE_START_HOUR = 4; // siklus 1 mulai 04:00 lokal
export const CYCLE_LENGTH_HOURS = 2;
export const CYCLES_PER_DAY = 12;
export const FOTOS_PER_SIKLUS = 2;
export const REMINDER_MINUTES_BEFORE = 15;

export interface CycleInfo {
  siklusKe: number; // 1..12
  start: Date;
  end: Date;
  minutesLeft: number;
  label: string;
}

/** Hitung info siklus berjalan pada waktu tertentu (default: sekarang). */
export function getCurrentCycle(now: Date = new Date()): CycleInfo {
  const startOfDay = new Date(now);
  startOfDay.setHours(CYCLE_START_HOUR, 0, 0, 0);
  if (now < startOfDay) startOfDay.setDate(startOfDay.getDate() - 1);

  const elapsedMs = now.getTime() - startOfDay.getTime();
  const idx = Math.floor(elapsedMs / (CYCLE_LENGTH_HOURS * 3600_000)); // 0..11
  const siklusKe = idx + 1;

  const start = new Date(startOfDay.getTime() + idx * CYCLE_LENGTH_HOURS * 3600_000);
  const end = new Date(start.getTime() + CYCLE_LENGTH_HOURS * 3600_000);
  const minutesLeft = Math.max(0, Math.round((end.getTime() - now.getTime()) / 60_000));

  const fmt = (d: Date) =>
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  return {
    siklusKe,
    start,
    end,
    minutesLeft,
    label: `Siklus ${siklusKe} · ${fmt(start)}–${fmt(end)}`,
  };
}

/** Rentang waktu siklus untuk tanggal & nomor siklus tertentu. */
export function getCycleRange(date: Date, siklusKe: number): { start: Date; end: Date } {
  const startOfDay = new Date(date);
  startOfDay.setHours(CYCLE_START_HOUR, 0, 0, 0);
  const start = new Date(
    startOfDay.getTime() + (siklusKe - 1) * CYCLE_LENGTH_HOURS * 3600_000,
  );
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
