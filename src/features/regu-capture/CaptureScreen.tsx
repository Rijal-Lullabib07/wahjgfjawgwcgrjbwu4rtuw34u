import { useEffect, useRef, useState } from 'react';
import type { CycleInfo } from '../../lib/cycle';
import { FOTOS_PER_SIKLUS } from '../../lib/cycle';
import { useCamera } from './useCamera';
import { useGeolocation } from './useGeolocation';
import { applyWatermark } from './watermark';

interface Props {
  cycle: CycleInfo;
  sentCount: number;
  queueCount: number;
  onCaptureDone: (fotos: Array<{ blob: Blob; lat: number | null; lng: number | null; ts: Date }>) => Promise<void>;
}

/**
 * Layar capture: live preview getUserMedia, tombol shutter besar (thumb-friendly),
 * GPS live, indikator "Tersimpan lokal" vs "Terkirim", dan hitungan 2 foto/siklus.
 * Kuota ketat: 2 foto per siklus per regu = terkirim + di antrian + di layar ini.
 */
export default function CaptureScreen({ cycle, sentCount, queueCount, onCaptureDone }: Props) {
  const camera = useCamera();
  const geo = useGeolocation();
  const [shots, setShots] = useState<Array<{ url: string; ts: Date; blob: Blob }>>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  // Total foto yang sudah "dipakai" regu ini pada siklus berjalan:
  // terkirim ke server + masih menunggu di antrian offline + jepretan di layar.
  const used = sentCount + queueCount + shots.length;
  const quotaLeft = Math.max(0, FOTOS_PER_SIKLUS - used);

  useEffect(() => {
    void camera.start();
    return () => camera.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = Math.max(0, quotaLeft);

  const takePhoto = async () => {
    if (!camera.videoRef.current || !camera.ready || saving) return;
    if (quotaLeft <= 0) return;

    // efek flash
    const flash = flashRef.current;
    if (flash) {
      flash.style.opacity = '0.85';
      setTimeout(() => (flash.style.opacity = '0'), 120);
    }

    setSaving(true);
    try {
      const ts = new Date();
      const { blob } = await applyWatermark(camera.videoRef.current, {
        lat: geo.lat,
        lng: geo.lng,
        timestamp: ts,
        label: 'SIPLAP · Siklus ' + cycle.siklusKe,
      });
      setShots((s) => [...s, { url: URL.createObjectURL(blob), ts, blob }]);
    } finally {
      setSaving(false);
    }
  };

  const submitAll = async () => {
    if (shots.length === 0 || saving) return;
    setSaving(true);
    try {
      const fotos = shots.map((s) => ({
        blob: s.blob,
        lat: geo.lat,
        lng: geo.lng,
        ts: s.ts,
      }));
      await onCaptureDone(fotos);
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]);
      setSavedMsg('Laporan masuk antrian — ' + (queueCount > 0 ? 'sebagian tersimpan lokal' : 'terkirim'));
      setTimeout(() => setSavedMsg(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  const removeShot = (index: number) => {
    setShots((current) => {
      const shot = current[index];
      if (shot) URL.revokeObjectURL(shot.url);
      return current.filter((_, shotIndex) => shotIndex !== index);
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-4 sm:px-6">
      {/* Status siklus */}
      <div className="card mb-4 border-sky-400/20 bg-navy-800/75">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow">Siklus berjalan</div>
            <div className="mt-1 font-semibold text-white">{cycle.label}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Foto terkirim</div>
            <div className="mono text-lg font-semibold text-white">
              {sentCount}/{FOTOS_PER_SIKLUS}
            </div>
          </div>
        </div>
        {used >= FOTOS_PER_SIKLUS && (
          <p className="mt-2 text-xs text-emerald-400">
            ✅ Kuota siklus ini sudah habis ({FOTOS_PER_SIKLUS}/{FOTOS_PER_SIKLUS} foto)
          </p>
        )}
        {queueCount > 0 && sentCount < FOTOS_PER_SIKLUS && (
          <p className="mt-2 text-xs text-amber-300">
            ⏳ {queueCount} foto menunggu sinkron — dihitung dalam kuota.
          </p>
        )}
      </div>

      {/* Live preview kamera */}
      <div className="camera-frame relative overflow-hidden rounded-[1.5rem] border border-navy-500/70 bg-black shadow-2xl shadow-black/30">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          autoPlay
          className="aspect-[4/5] max-h-[62dvh] w-full object-cover"
        />
        <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-white opacity-0 transition-opacity duration-100" />

        {camera.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="text-4xl">📷</span>
            <p className="text-sm text-red-300">{camera.error}</p>
            <button className="btn-secondary" onClick={() => void camera.start()}>
              Coba lagi
            </button>
          </div>
        )}

        {!camera.ready && !camera.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="animate-pulse text-sm text-slate-400">Menyalakan kamera…</span>
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => void camera.start()}>
              Nyalakan ulang
            </button>
          </div>
        )}

        {/* GPS badge */}
        <div className="absolute left-3 top-3 max-w-[75%] rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur">
          {geo.error
            ? '⚠️ GPS: ' + geo.error
            : geo.lat != null
              ? '📍 ' + geo.lat.toFixed(5) + ', ' + (geo.lng ?? 0).toFixed(5)
              : '📍 Mencari GPS…'}
        </div>

        {/* Tombol ganti kamera */}
        {camera.ready && (
          <button
            onClick={camera.switchCamera}
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/60 text-lg text-white backdrop-blur transition hover:bg-black/80 active:scale-90"
            aria-label="Ganti kamera"
          >
            🔄
          </button>
        )}
      </div>

      {/* Shutter besar — thumb-friendly, terkunci saat kuota habis */}
      <div className="mt-5 flex flex-col items-center gap-2 pb-1">
        <button
          onClick={() => void takePhoto()}
          disabled={!camera.ready || saving || quotaLeft <= 0}
          className="shutter-button flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-full border-4 border-gold-400 bg-navy-800 text-3xl shadow-[0_0_0_7px_rgba(245,185,66,0.12),0_12px_30px_rgba(0,0,0,0.3)] transition hover:bg-navy-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Ambil foto"
        >
          <span aria-hidden="true">📸</span>
        </button>
        <span className="text-xs font-medium text-slate-400">Ambil foto {shots.length + 1} dari {FOTOS_PER_SIKLUS}</span>
        {quotaLeft <= 0 && (
          <p className="text-xs font-semibold text-amber-300">
            🔒 Maksimal {FOTOS_PER_SIKLUS} foto per siklus — kirim dulu / tunggu siklus berikutnya.
          </p>
        )}
      </div>

      {/* Hasil jepretan */}
      {shots.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {shots.map((s, i) => (
              <div key={i} className="group relative overflow-hidden rounded-xl border border-navy-600">
                <img src={s.url} alt={'Foto ' + (i + 1)} className="aspect-square w-full object-cover" />
                <span className="absolute left-2 top-2 badge bg-black/60 text-white">#{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeShot(i)}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-500/90 text-sm text-white shadow-lg transition hover:bg-red-400 active:scale-90"
                  aria-label={'Hapus foto ' + (i + 1)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => void submitAll()} disabled={saving} className="btn-primary w-full py-4">
            {saving ? 'Menyimpan…' : 'Kirim Laporan (' + shots.length + ' foto)'}
          </button>
        </div>
      )}

      {savedMsg && (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {savedMsg}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-slate-500">
        {remaining > 0
          ? 'Sisa kuota ' + remaining + ' foto untuk siklus ini.'
          : 'Kuota siklus ini sudah habis — tunggu siklus berikutnya.'}
        {queueCount > 0 && ' · ' + queueCount + ' laporan menunggu sinkron'}
      </p>
    </div>
  );
}
