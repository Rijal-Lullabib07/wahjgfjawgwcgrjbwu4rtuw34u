import { useEffect, useRef, useState } from "react";
import type { CycleInfo } from "../../lib/cycle";
import { useCamera } from "./useCamera";
import { useGeolocation } from "./useGeolocation";
import { applyWatermark } from "./watermark";

interface Props {
  cycle: CycleInfo;
  onCaptureDone: (
    fotos: Array<{
      blob: Blob;
      lat: number | null;
      lng: number | null;
      ts: Date;
    }>,
    video: { blob: Blob; ts: Date; durationSeconds: number } | null,
    catatan: string,
  ) => Promise<void>;
}

/**
 * Layar capture: live preview getUserMedia, tombol shutter besar (thumb-friendly),
 * GPS live, indikator "Tersimpan lokal" vs "Terkirim", dan foto opsional.
 * Satu laporan dapat dikirim tanpa foto atau dengan maksimal dua foto.
 */
export default function CaptureScreen({ cycle, onCaptureDone }: Props) {
  const camera = useCamera();
  const geo = useGeolocation();
  const [shots, setShots] = useState<
    Array<{ url: string; ts: Date; blob: Blob }>
  >([]);
  const [videoShot, setVideoShot] = useState<{
    url: string;
    ts: Date;
    blob: Blob;
    durationSeconds: number;
  } | null>(null);
  const [mode, setMode] = useState<"foto" | "video">("foto");
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catatan, setCatatan] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordStartRef = useRef(0);

  useEffect(() => {
    void camera.start();
    return () => camera.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeMode = async (next: "foto" | "video") => {
    if (next === "video" && videoShot) return;
    setCaptureError(null);
    setMode(next);
    await camera.start(camera.facing, next === "video");
  };

  const takePhoto = async () => {
    if (!camera.videoRef.current || !camera.ready || saving) return;
    if (mode !== "foto" || shots.length >= 4) return;

    if (mode !== "foto") return;

    // efek flash
    const flash = flashRef.current;
    if (flash) {
      flash.style.opacity = "0.85";
      setTimeout(() => (flash.style.opacity = "0"), 120);
    }

    setSaving(true);
    try {
      const ts = new Date();
      const { blob } = await applyWatermark(camera.videoRef.current, {
        lat: geo.lat,
        lng: geo.lng,
        timestamp: ts,
        label: "SALAM PRESISI · Pelaporan Harian",
        place: geo.place
          ? geo.place.detail
            ? `${geo.place.name} — ${geo.place.detail}`
            : geo.place.name
          : null,
        accuracy: geo.accuracy,
      });
      setShots((s) => [...s, { url: URL.createObjectURL(blob), ts, blob }]);
    } finally {
      setSaving(false);
    }
  };

  const recordVideo = () => {
    setCaptureError(null);
    if (!camera.videoRef.current || !camera.ready || saving) return;
    if (recording || videoShot) return;
    const stream = camera.videoRef.current.srcObject as MediaStream | null;
    if (!stream) {
      setCaptureError("Kamera belum siap. Tekan Coba lagi lalu pilih Video.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setCaptureError(
        "Browser ini belum mendukung perekaman video. Gunakan Chrome atau Safari terbaru.",
      );
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported(
      "video/webm;codecs=vp8,opus",
    )
      ? "video/webm;codecs=vp8,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (error) {
      setCaptureError(
        error instanceof Error
          ? `Perekaman video gagal: ${error.message}`
          : "Perekaman video gagal dimulai.",
      );
      return;
    }
    recorderRef.current = recorder;
    recordStartRef.current = Date.now();
    setRecording(true);
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (chunks.length === 0) {
        setCaptureError("Video kosong. Coba rekam kembali.");
        recorderRef.current = null;
        setRecording(false);
        return;
      }
      const blob = new Blob(chunks, {
        type: mimeType || chunks[0].type || "video/webm",
      });
      setVideoShot({
        url: URL.createObjectURL(blob),
        ts: new Date(recordStartRef.current),
        blob,
        durationSeconds: Math.max(
          1,
          Math.round((Date.now() - recordStartRef.current) / 1000),
        ),
      });
      recorderRef.current = null;
      setRecording(false);
    };
    recorder.onerror = () => {
      setCaptureError("Perekaman video gagal. Periksa izin kamera lalu coba lagi.");
      recorderRef.current = null;
      setRecording(false);
    };
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 60_000);
  };

  const toggleCapture = () => {
    if (mode === "foto") void takePhoto();
    else if (recording) recorderRef.current?.stop();
    else recordVideo();
  };

  const submitAll = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const fotos = shots.map((s) => ({
        blob: s.blob,
        lat: geo.lat,
        lng: geo.lng,
        ts: s.ts,
      }));
      await onCaptureDone(
        fotos,
        videoShot
          ? {
              blob: videoShot.blob,
              ts: videoShot.ts,
              durationSeconds: videoShot.durationSeconds,
            }
          : null,
        catatan.trim(),
      );
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      if (videoShot) URL.revokeObjectURL(videoShot.url);
      setShots([]);
      setVideoShot(null);
      setCatatan("");
      setSavedMsg(
        "Laporan masuk antrian dan akan dikirim saat koneksi tersedia.",
      );
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
    <div className="mx-auto w-full max-w-xl px-4 py-5 sm:px-6">
      {/* Status pelaporan */}
      <div className="card mb-4 border-sky-400/20 bg-gradient-to-br from-[#142d4d] to-[#0e2039] p-4 shadow-[0_18px_40px_rgba(2,12,25,0.2)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow">Pelaporan terbuka</div>
            <div className="mt-1 text-base font-extrabold text-white">
              Bisa melapor kapan saja
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Waktu server</div>
            <div className="mono text-sm font-semibold text-white">
              {cycle.label}
            </div>
          </div>
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-slate-400">
          Media bersifat opsional. Maksimal 4 foto dan 1 video per laporan.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#0b172b] p-1.5">
        <button
          type="button"
          onClick={() => void changeMode("foto")}
          className={
            mode === "foto" ? "btn-primary py-2" : "btn-secondary py-2"
          }
        >
          📷 Foto ({shots.length}/4)
        </button>
        <button
          type="button"
          onClick={() => void changeMode("video")}
          className={
            mode === "video" ? "btn-primary py-2" : "btn-secondary py-2"
          }
        >
          🎥 Video ({videoShot ? 1 : 0}/1)
        </button>
      </div>

      {/* Live preview kamera */}
        <div className="camera-frame relative overflow-hidden rounded-[1.75rem] border border-sky-400/20 bg-black shadow-[0_20px_45px_rgba(2,12,25,0.38)]">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          autoPlay
          className="aspect-[4/5] max-h-[62dvh] w-full object-cover"
        />
        <div
          ref={flashRef}
          className="pointer-events-none absolute inset-0 bg-white opacity-0 transition-opacity duration-100"
        />

        {camera.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="text-4xl">📷</span>
            <p className="text-sm text-red-300">{camera.error}</p>
            <button
              className="btn-secondary"
              onClick={() => void camera.start()}
            >
              Coba lagi
            </button>
          </div>
        )}

        {!camera.ready && !camera.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="animate-pulse text-sm text-slate-400">
              Menyalakan kamera…
            </span>
            <button
              className="btn-secondary px-4 py-2 text-xs"
              onClick={() => void camera.start()}
            >
              Nyalakan ulang
            </button>
          </div>
        )}

        {/* GPS badge: akurasi ditonjolkan — pemantau melihat lokasi yang sama */}
        <div className="absolute left-3 top-3 max-w-[75%] rounded-xl border border-white/10 bg-black/60 px-3 py-1.5 text-white backdrop-blur">
          {geo.error ? (
            <span className="text-[11px] font-medium">⚠️ GPS: {geo.error}</span>
          ) : geo.lat == null ? (
            <span className="anim-pulse-dot text-[11px] font-medium">
              📍 Mencari GPS…
            </span>
          ) : (
            <>
              <div className="truncate text-[12px] font-semibold leading-tight">
                📌 {geo.place ? geo.place.name : "Lokasi terkunci"}
              </div>
              <div className="truncate text-[10px] leading-tight text-slate-300">
                {geo.place?.detail
                  ? geo.place.detail
                  : `${geo.lat.toFixed(6)}, ${(geo.lng ?? 0).toFixed(6)}`}
                {geo.accuracy != null && ` · ±${Math.round(geo.accuracy)}m`}
              </div>
              <div
                className={
                  "mt-0.5 text-[10px] font-semibold " +
                  (geo.locked ? "text-emerald-400" : "text-amber-300")
                }
              >
                {geo.locked
                  ? "🎯 Lokasi akurat"
                  : `🎯 Menajamkan GPS… ±${geo.accuracy != null ? Math.round(geo.accuracy) : "?"}m`}
              </div>
            </>
          )}
        </div>

        {/* Perbarui lokasi */}
        {geo.lat != null && !geo.locked && (
          <button
            onClick={geo.refresh}
            className="absolute right-3 top-16 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/80 active:scale-95"
          >
            🎯 Perbarui lokasi
          </button>
        )}

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

      {/* Shutter besar — mode foto atau video */}
      <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.025] py-4 pb-4">
        <button
          onClick={toggleCapture}
          disabled={
            !camera.ready ||
            saving ||
            (mode === "foto" ? shots.length >= 4 : Boolean(videoShot))
          }
          className="shutter-button flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-full border-4 border-gold-400 bg-navy-800 text-3xl shadow-[0_0_0_7px_rgba(245,185,66,0.12),0_12px_30px_rgba(0,0,0,0.3)] transition hover:bg-navy-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={
            mode === "foto"
              ? "Ambil foto"
              : recording
                ? "Hentikan video"
                : "Rekam video"
          }
        >
          <span aria-hidden="true">
            {mode === "foto" ? "📸" : recording ? "⏹️" : "⏺️"}
          </span>
        </button>
        <span className="text-xs font-medium text-slate-400">
          {mode === "foto"
            ? `Ambil foto ${shots.length + 1} dari 4 (opsional)`
            : recording
              ? "Merekam video… ketuk untuk berhenti"
              : videoShot
                ? "Video sudah ditambahkan"
                : "Rekam video maksimal 60 detik"}
        </span>
        {captureError && (
          <p className="max-w-sm text-center text-xs font-semibold text-red-300">
            {captureError}
          </p>
        )}
        {shots.length >= 4 && (
          <p className="text-xs font-semibold text-amber-300">
            Maksimal 4 foto untuk satu laporan.
          </p>
        )}
      </div>

      <label className="mt-5 block rounded-2xl border border-white/10 bg-[#0e2039]/70 p-4 text-sm font-medium text-slate-200">
        Perihal laporan
        <textarea
          className="input mt-2 min-h-28 resize-y border-white/10 bg-[#09172b] text-sm leading-5"
          value={catatan}
          onChange={(event) => setCatatan(event.target.value)}
          placeholder="Contoh: Patroli wilayah dan pengamanan kegiatan masyarakat"
          required
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Jelaskan singkat kegiatan, lokasi, atau kejadian yang dilaporkan.
        </span>
      </label>

      {geo.lat == null && !geo.error && (
        <p className="mt-2 text-xs font-semibold text-amber-300">
          📍 GPS belum terkunci — tunggu sebentar agar lokasi laporan akurat.
        </p>
      )}

      {/* Hasil jepretan */}
      {(shots.length > 0 || Boolean(videoShot)) && (
        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {shots.map((s, i) => (
              <div
                key={i}
                className="group relative overflow-hidden rounded-xl border border-navy-600"
              >
                <img
                  src={s.url}
                  alt={"Foto " + (i + 1)}
                  className="aspect-square w-full object-cover"
                />
                <span className="absolute left-2 top-2 badge bg-black/60 text-white">
                  #{i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeShot(i)}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-500/90 text-sm text-white shadow-lg transition hover:bg-red-400 active:scale-90"
                  aria-label={"Hapus foto " + (i + 1)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => void submitAll()}
            disabled={saving || !catatan.trim()}
            className="group relative mt-1 flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl border border-gold-300/70 bg-gradient-to-r from-gold-400 via-amber-300 to-gold-400 px-5 py-4 text-base font-extrabold text-navy-950 shadow-[0_10px_28px_rgba(245,185,66,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(245,185,66,0.3)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-950/10 text-lg transition group-hover:scale-110">
              {saving ? "⏳" : "➤"}
            </span>
            <span>
              {saving
                ? "Menyimpan laporan…"
                : `Kirim laporan${shots.length > 0 || videoShot ? ` · ${shots.length} foto${videoShot ? " + 1 video" : ""}` : ""}`}
            </span>
          </button>
        </div>
      )}

      {videoShot && (
        <div className="mt-5 overflow-hidden rounded-xl border border-sky-500/50 bg-navy-900 p-2">
          <video src={videoShot.url} controls className="w-full rounded-lg" />
          <div className="flex justify-between px-1 pt-2 text-xs text-slate-400">
            <span>Video · {videoShot.durationSeconds} detik</span>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(videoShot.url);
                setVideoShot(null);
              }}
              className="text-red-300"
            >
              Hapus
            </button>
          </div>
        </div>
      )}

      {shots.length === 0 && !videoShot && (
        <button
          onClick={() => void submitAll()}
          disabled={saving || !catatan.trim()}
          className="group relative mt-5 flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl border border-gold-300/70 bg-gradient-to-r from-gold-400 via-amber-300 to-gold-400 px-5 py-4 text-base font-extrabold text-navy-950 shadow-[0_10px_28px_rgba(245,185,66,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(245,185,66,0.3)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-950/10 text-lg">
            {saving ? "⏳" : "➤"}
          </span>
          <span>{saving ? "Menyimpan laporan…" : "Kirim laporan tanpa foto"}</span>
        </button>
      )}

      {savedMsg && (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {savedMsg}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-slate-500">
        Pelaporan tersedia 24 jam. Metadata waktu tetap dicatat untuk rekap.
      </p>
    </div>
  );
}
