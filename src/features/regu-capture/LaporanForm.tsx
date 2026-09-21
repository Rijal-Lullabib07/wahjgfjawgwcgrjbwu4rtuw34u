import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  JenisLaporan,
  KategoriLaporan,
  TahapLaporan,
} from "../../types";
import { TAHAP_LABEL } from "../../types";
import { fetchJenisLaporan } from "../../lib/supabase/api";
import { useCamera } from "./useCamera";
import { useGeolocation } from "./useGeolocation";
import { applyWatermark } from "./watermark";

export interface LaporanFormResult {
  kategori: KategoriLaporan;
  jenis: JenisLaporan | null;
  tahap: TahapLaporan;
  parentId: string | null;
  perihal: string;
  isi: string;
  /** Teks laporan resmi hasil perakitan otomatis (disimpan sebagai catatan). */
  teksLaporan: string;
  fotos: Array<{ blob: Blob; lat: number | null; lng: number | null; ts: Date }>;
  video: { blob: Blob; ts: Date; durationSeconds: number } | null;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  /** Header resmi laporan: "Lapor." + tanggal otomatis. */
  mode: "baru" | "turunan";
  /** Untuk mode turunan: induk + tahap yang akan dikirim. */
  parent?: {
    id: string;
    kategori: KategoriLaporan;
    perihal?: string | null;
    namaJenis?: string | null;
    tahapBerikut: TahapLaporan;
  } | null;
  onSubmit: (result: LaporanFormResult) => Promise<void>;
}

/** Tanggal otomatis: "21 September 2026". */
function tanggalOtomatis(): string {
  return new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Jam otomatis: "14.30 WIB". */
function jamOtomatis(): string {
  return (
    new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    }) + " WIB"
  );
}

const KATEGORI_OPTIONS: Array<{
  key: KategoriLaporan;
  label: string;
  desc: string;
  icon: string;
}> = [
  {
    key: "kegiatan",
    label: "Kegiatan",
    desc: "Program kerja / giat rutin",
    icon: "📋",
  },
  {
    key: "kejadian",
    label: "Kejadian",
    desc: "Temuan / insiden di lapangan",
    icon: "⚡",
  },
];

/**
 * Form inti pelaporan sesuai sketsa:
 *   Lapor:
 *   1) Pilih Kegiatan / Kejadian (selection)
 *   2) Pilih jenis dari master (Program Kerja / Temuan)
 *   3) Kotak "Lapor. pada tgl [tanggal otomatis]"
 *   4) "Izin melaporkan [Perihal]"
 *   5) Kotak besar "Isi: ..."
 *   6) "Demikian terimakasih" + tombol kirim
 */
export default function LaporanForm({ mode, parent, onSubmit }: Props) {
  const [kategori, setKategori] = useState<KategoriLaporan>(
    parent?.kategori ?? "kegiatan",
  );
  /** Tahap dipilih SEBELUM jenis: Kegiatan [awal|lengkap];
   *  Kejadian [awal|update|lengkap]. */
  const [tahap, setTahap] = useState<TahapLaporan>("awal");
  const [jenisId, setJenisId] = useState<string>("");
  const [jenisQuery, setJenisQuery] = useState("");
  const [jenisOpen, setJenisOpen] = useState(false);
  const [perihal, setPerihal] = useState("");
  const [isi, setIsi] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: jenisList = [] } = useQuery({
    queryKey: ["jenis-laporan", kategori],
    queryFn: () => fetchJenisLaporan(kategori, true),
  });

  useEffect(() => {
    // Reset pilihan saat kategori berganti; tahap kembali ke awal karena
    // pilihan tahapnya berbeda antara kegiatan & kejadian.
    setJenisId("");
    setJenisQuery("");
    setJenisOpen(false);
    setTahap("awal");
  }, [kategori]);

  const jenisTerpilih = useMemo(
    () => jenisList.find((j) => j.id === jenisId) ?? null,
    [jenisList, jenisId],
  );

  /** Daftar jenis tersaring kata kunci pencarian (tidak peka huruf besar). */
  const jenisTersaring = useMemo(() => {
    const q = jenisQuery.trim().toLocaleLowerCase("id-ID");
    if (!q) return jenisList;
    return jenisList.filter((j) =>
      j.nama.toLocaleLowerCase("id-ID").includes(q),
    );
  }, [jenisList, jenisQuery]);

  const tahapOptions = useMemo<Array<[TahapLaporan, string]>>(
    () =>
      kategori === "kejadian"
        ? [
            ["awal", TAHAP_LABEL.awal],
            ["update", TAHAP_LABEL.update],
            ["lengkap", TAHAP_LABEL.lengkap],
          ]
        : [
            ["awal", TAHAP_LABEL.awal],
            ["lengkap", TAHAP_LABEL.lengkap],
          ],
    [kategori],
  );

  const tanggal = tanggalOtomatis();
  const teksLaporan = useMemo(() => {
    const p = perihal.trim() || "(perihal belum diisi)";
    const body = isi.trim() || "(isi laporan belum diisi)";
    return `Lapor. Pada tanggal ${tanggal}, izin melaporkan ${p}. Isi: ${body}. Demikian laporan kami sampaikan, terimakasih.`;
  }, [tanggal, perihal, isi]);

  // ---------- Media (opsional, sama seperti capture lama) ----------
  const camera = useCamera();
  const geo = useGeolocation();
  const [shots, setShots] = useState<Array<{ url: string; ts: Date; blob: Blob }>>([]);
  const [videoShot, setVideoShot] = useState<{
    url: string;
    ts: Date;
    blob: Blob;
    durationSeconds: number;
  } | null>(null);
  const [mediaMode, setMediaMode] = useState<"foto" | "video">("foto");
  const [recording, setRecording] = useState(false);
  const [capturing, setCapturing] = useState(false);
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
    setMediaMode(next);
    await camera.start(camera.facing, next === "video");
  };

  const takePhoto = async () => {
    if (!camera.videoRef.current || !camera.ready || capturing) return;
    if (mediaMode !== "foto" || shots.length >= 4) return;

    const flash = flashRef.current;
    if (flash) {
      flash.style.opacity = "0.85";
      setTimeout(() => (flash.style.opacity = "0"), 120);
    }

    setCapturing(true);
    try {
      const ts = new Date();
      const { blob } = await applyWatermark(camera.videoRef.current, {
        lat: geo.lat,
        lng: geo.lng,
        timestamp: ts,
        label: "SALAM PRESISI · Pelaporan Giat",
        place: geo.place
          ? geo.place.detail
            ? `${geo.place.name} — ${geo.place.detail}`
            : geo.place.name
          : null,
        accuracy: geo.accuracy,
      });
      setShots((s) => [...s, { url: URL.createObjectURL(blob), ts, blob }]);
    } finally {
      setCapturing(false);
    }
  };

  const recordVideo = () => {
    setCaptureError(null);
    if (!camera.videoRef.current || !camera.ready || capturing) return;
    if (recording || videoShot) return;
    const stream = camera.videoRef.current.srcObject as MediaStream | null;
    if (!stream) {
      setCaptureError("Kamera belum siap. Coba lagi.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setCaptureError("Browser ini belum mendukung perekaman video.");
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
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
    } catch (err) {
      setCaptureError(
        err instanceof Error ? `Perekaman gagal: ${err.message}` : "Perekaman gagal.",
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
      setCaptureError("Perekaman gagal. Periksa izin kamera lalu coba lagi.");
      recorderRef.current = null;
      setRecording(false);
    };
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 60_000);
  };

  const toggleCapture = () => {
    if (mediaMode === "foto") void takePhoto();
    else if (recording) recorderRef.current?.stop();
    else recordVideo();
  };

  const removeShot = (index: number) => {
    setShots((current) => {
      const shot = current[index];
      if (shot) URL.revokeObjectURL(shot.url);
      return current.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async () => {
    if (sending) return;
    if (!perihal.trim()) {
      setError("Perihal laporan wajib diisi.");
      return;
    }
    if (!isi.trim()) {
      setError("Isi laporan wajib diisi.");
      return;
    }
    if (mode === "baru" && !jenisTerpilih) {
      setError("Pilih jenis laporan terlebih dahulu.");
      return;
    }
    if (mode === "baru" && tahap !== "awal" && !parent) {
      // Tahap update/lengkap TANPA induk diperbolehkan (kebijakan baru:
      // pelapor bisa langsung melapor lengkap) — perihal mewakili rangkaian.
    }
    setSending(true);
    setError(null);
    try {
      await onSubmit({
        kategori,
        jenis: mode === "turunan" ? null : jenisTerpilih,
        tahap:
          mode === "turunan" && parent ? parent.tahapBerikut : tahap,
        parentId: parent?.id ?? null,
        perihal: perihal.trim(),
        isi: isi.trim(),
        teksLaporan,
        fotos: shots.map((s) => ({
          blob: s.blob,
          lat: geo.lat,
          lng: geo.lng,
          ts: s.ts,
        })),
        video: videoShot
          ? {
              blob: videoShot.blob,
              ts: videoShot.ts,
              durationSeconds: videoShot.durationSeconds,
            }
          : null,
        latitude: geo.lat,
        longitude: geo.lng,
      });
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      if (videoShot) URL.revokeObjectURL(videoShot.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim laporan.");
    } finally {
      setSending(false);
    }
  };

  const tahapLabel =
    parent?.tahapBerikut === "update"
      ? "Update Situasi"
      : parent?.tahapBerikut === "lengkap"
        ? "Laporan Lengkap"
        : "Laporan Awal";

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-5 sm:px-6">
      {/* ---------- 1) Pilih kategori ---------- */}
      {mode === "baru" ? (
        <section>
          <div className="eyebrow mb-2">Lapor — pilih jenis pelaporan</div>
          <div className="grid grid-cols-2 gap-3">
            {KATEGORI_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setKategori(opt.key)}
                className={
                  "rounded-2xl border p-4 text-left transition " +
                  (kategori === opt.key
                    ? "border-gold-400 bg-gold-400/10 shadow-[0_10px_30px_rgba(245,185,66,0.12)]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25")
                }
              >
                <span className="text-2xl">{opt.icon}</span>
                <div className="mt-1.5 text-sm font-extrabold text-white">
                  {opt.label}
                </div>
                <div className="text-[11px] leading-tight text-slate-400">
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="card border-gold-400/25 bg-gold-400/[0.06]">
          <div className="eyebrow">Melanjutkan rangkaian laporan</div>
          <div className="mt-1 text-sm font-bold text-white">
            {parent?.namaJenis ?? parent?.perihal ?? "Laporan"}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Kategori: {parent?.kategori} · Tahap berikut:{" "}
            <span className="font-semibold text-gold-300">{tahapLabel}</span>
          </div>
        </section>
      )}

      {/* ---------- 2) Pilih tahap (turunan) ---------- */}
      {mode === "baru" && (
        <section>
          <div className="eyebrow mb-2">Pilih tahapan laporan</div>
          <div
            className={
              "grid gap-2 " +
              (kategori === "kejadian" ? "grid-cols-3" : "grid-cols-2")
            }
          >
            {tahapOptions.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTahap(key)}
                className={
                  "rounded-xl border px-3 py-2.5 text-sm font-bold transition " +
                  (tahap === key
                    ? "border-gold-400 bg-gold-400/10 text-gold-300"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- 3) Pilih jenis (selection + pencarian) ---------- */}
      {mode === "baru" && (
        <section className="relative">
          <span className="mb-1.5 block text-sm font-medium text-slate-300">
            {kategori === "kegiatan"
              ? "Pilih jenis kegiatan (program kerja)"
              : "Pilih jenis kejadian (temuan)"}
          </span>
          <input
            type="text"
            className="input"
            placeholder="🔍 Cari jenis… (mis. pencurian)"
            value={jenisTerpilih && !jenisOpen ? jenisTerpilih.nama : jenisQuery}
            onFocus={() => setJenisOpen(true)}
            onChange={(e) => {
              setJenisQuery(e.target.value);
              setJenisOpen(true);
              setJenisId("");
            }}
          />
          {jenisOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0b172b] shadow-2xl">
              {jenisTersaring.length === 0 && (
                <div className="px-4 py-3 text-sm text-slate-400">
                  Tidak ada jenis yang cocok.
                </div>
              )}
              {jenisTersaring.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setJenisId(j.id);
                    setJenisQuery("");
                    setJenisOpen(false);
                  }}
                  className={
                    "block w-full px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.06] " +
                    (j.id === jenisId ? "text-gold-300" : "text-slate-200")
                  }
                >
                  {j.nama}
                </button>
              ))}
            </div>
          )}
          {jenisTerpilih && !jenisOpen && (
            <p className="mt-1 text-[11px] text-slate-500">
              Jenis terpilih: <b className="text-gold-300">{jenisTerpilih.nama}</b>
            </p>
          )}
        </section>
      )}

      {/* ---------- 3) Kotak laporan terformat ---------- */}
      <section className="card space-y-4">
        <div>
          <div className="eyebrow">Perihal laporan pada tgl {tanggal}</div>
          <div className="mono mt-2 rounded-xl border border-white/10 bg-navy-950/60 px-3 py-2 text-xs text-gold-300">
            Lapor. Pada tanggal {tanggal}, izin melaporkan…
          </div>
          <input
            className="input mt-2"
            value={perihal}
            onChange={(e) => setPerihal(e.target.value)}
            placeholder="Tulis perihal, mis. Patroli dialogis di pasar baru"
            maxLength={180}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-300">
            Isi laporan
          </span>
          <textarea
            className="input min-h-36 resize-y"
            value={isi}
            onChange={(e) => setIsi(e.target.value)}
            placeholder="Uraikan kronologi / pelaksanaan kegiatan atau kejadian yang dilaporkan…"
          />
        </div>

        {/* Pratinjau teks resmi */}
        <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] px-3.5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
            Pratinjau laporan resmi
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-200">
            {teksLaporan}
          </p>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>🕒 {jamOtomatis()} · tanggal & jam terisi otomatis</span>
          <span>📍 {geo.lat != null ? "GPS terkunci" : "GPS mencari…"}</span>
        </div>
      </section>

      {/* ---------- 4) Media opsional ---------- */}
      <section className="card">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Dokumentasi (opsional)</div>
          <span className="text-[11px] text-slate-500">
            Maks 4 foto · 1 video
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#0b172b] p-1.5">
          <button
            type="button"
            onClick={() => void changeMode("foto")}
            className={mediaMode === "foto" ? "btn-primary py-2" : "btn-secondary py-2"}
          >
            📷 Foto ({shots.length}/4)
          </button>
          <button
            type="button"
            onClick={() => void changeMode("video")}
            className={mediaMode === "video" ? "btn-primary py-2" : "btn-secondary py-2"}
          >
            🎥 Video ({videoShot ? 1 : 0}/1)
          </button>
        </div>

        <div className="camera-frame relative mt-3 overflow-hidden rounded-[1.5rem] border border-sky-400/20 bg-black shadow-[0_20px_45px_rgba(2,12,25,0.38)]">
          <video
            ref={camera.videoRef}
            playsInline
            muted
            autoPlay
            className="aspect-[4/3] max-h-[46dvh] w-full object-cover"
          />
          <div
            ref={flashRef}
            className="pointer-events-none absolute inset-0 bg-white opacity-0 transition-opacity duration-100"
          />

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
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="animate-pulse text-sm text-slate-400">
                Menyalakan kamera…
              </span>
            </div>
          )}

          <div className="absolute left-3 top-3 max-w-[75%] rounded-xl border border-white/10 bg-black/60 px-3 py-1.5 text-white backdrop-blur">
            {geo.error ? (
              <span className="text-[11px] font-medium">⚠️ GPS: {geo.error}</span>
            ) : geo.lat == null ? (
              <span className="text-[11px] font-medium">📍 Mencari GPS…</span>
            ) : (
              <>
                <div className="truncate text-[12px] font-semibold leading-tight">
                  📌 {geo.place ? geo.place.name : "Lokasi terkunci"}
                </div>
                <div
                  className={
                    "text-[10px] font-semibold " +
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

        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            onClick={toggleCapture}
            disabled={
              !camera.ready ||
              capturing ||
              (mediaMode === "foto" ? shots.length >= 4 : Boolean(videoShot))
            }
            className="shutter-button flex h-16 w-16 items-center justify-center rounded-full border-4 border-gold-400 bg-navy-800 text-2xl shadow-[0_0_0_7px_rgba(245,185,66,0.12)] transition active:scale-90 disabled:opacity-30"
            aria-label={
              mediaMode === "foto"
                ? "Ambil foto"
                : recording
                  ? "Hentikan video"
                  : "Rekam video"
            }
          >
            <span aria-hidden="true">
              {mediaMode === "foto" ? "📸" : recording ? "⏹️" : "⏺️"}
            </span>
          </button>
          <span className="text-xs font-medium text-slate-400">
            {mediaMode === "foto"
              ? `Foto ${shots.length + 1} dari 4 (opsional)`
              : recording
                ? "Merekam… ketuk untuk berhenti"
                : videoShot
                  ? "Video sudah ditambahkan"
                  : "Rekam maksimal 60 detik"}
          </span>
          {captureError && (
            <p className="text-center text-xs font-semibold text-red-300">
              {captureError}
            </p>
          )}
        </div>

        {shots.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {shots.map((s, i) => (
              <div
                key={i}
                className="relative overflow-hidden rounded-xl border border-navy-600"
              >
                <img
                  src={s.url}
                  alt={"Foto " + (i + 1)}
                  className="aspect-square w-full object-cover"
                />
                <span className="badge absolute left-2 top-2 bg-black/60 text-white">
                  #{i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeShot(i)}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-500/90 text-sm text-white shadow-lg active:scale-90"
                  aria-label={"Hapus foto " + (i + 1)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {videoShot && (
          <div className="mt-3 overflow-hidden rounded-xl border border-sky-500/50 bg-navy-900 p-2">
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
      </section>

      {/* ---------- 5) Kirim ---------- */}
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={() => void handleSubmit()}
        disabled={sending || !perihal.trim() || !isi.trim()}
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl border border-gold-300/70 bg-gradient-to-r from-gold-400 via-amber-300 to-gold-400 px-5 py-4 text-base font-extrabold text-navy-950 shadow-[0_10px_28px_rgba(245,185,66,0.22)] transition hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-950/10 text-lg">
          {sending ? "⏳" : "➤"}
        </span>
        <span>
          {sending
            ? "Mengirim laporan…"
            : `Kirim ${mode === "turunan" ? tahapLabel : "Laporan"}`}
        </span>
      </button>

      <p className="pb-2 text-center text-xs text-slate-500">
        Laporan tersimpan otomatis saat offline dan dikirim saat koneksi kembali.
      </p>
    </div>
  );
}
