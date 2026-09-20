/**
 * Bunyi + getar untuk popup "Laporan baru" di dalam app.
 * Bunyi dibuat dengan Web Audio (tanpa file audio) supaya tetap jalan
 * walau app baru saja dibuka dan aset belum dimuat.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  // Autoplay policy: context dibuat saat klik user pertama; kalau suspended,
  // coba lanjutkan (gagal → bunyi diabaikan tanpa error).
  if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => undefined);
  return audioCtx;
}

/** Dua bip pendek naik — dipakai saat laporan baru masuk. */
export function playAlertSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const beep = (start: number, from: number, to: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(from, now + start);
      osc.frequency.exponentialRampToValueAtTime(to, now + start + 0.18);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.22);
    };
    beep(0, 880, 1180);
    beep(0.25, 980, 1320);
  } catch {
    // Bunyi bukan fitur kritis — abaikan kegagalan.
  }
}

/** Getar pendek dua kali (Android; iOS home-screen mendukung). */
export function vibrateDevice(): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([250, 120, 250]);
    }
  } catch {
    // Abaikan.
  }
}
