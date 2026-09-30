import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  JenisLaporan,
  KategoriLaporan,
  TahapLaporan,
} from "../../types";
import { TAHAP_LABEL } from "../../types";
import { fetchJenisLaporan } from "../../lib/supabase/api";
import { cariPersonel } from "../../lib/personel";
import { useCamera } from "./useCamera";
import { useGeolocation } from "./useGeolocation";
import { applyWatermark, compressGaleriFoto } from "./watermark";

export interface LaporanFormResult {
  kategori: KategoriLaporan;
  jenis: JenisLaporan | null;
  /** Nama jenis ketikan pelapor sendiri (tidak dari master) — dicari/
   *  didaftarkan saat sync lewat RPC pakai_jenis_custom. */
  jenisCustom: string | null;
  tahap: TahapLaporan;
  parentId: string | null;
  perihal: string;
  isi: string;
  /** Daftar NRP pelapor (satu unit bisa >1 personel) — pemantau memakai ini
   *  mengenali siapa saja pelapornya. */
  nrpList: string[];
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

/** Format detik perekaman → "0:42". */
function formatRecTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  /** Mode jenis custom: pelapor mengetik jenis sendiri (tidak ada di master).
   *  Aktif lewat opsi "➕ Jenis lain / ketik sendiri…" di dropdown. */
  const [jenisCustomMode, setJenisCustomMode] = useState(false);
  const [jenisCustomNama, setJenisCustomNama] = useState("");
  const [perihal, setPerihal] = useState("");
  const [isi, setIsi] = useState("");
  /** Daftar NRP pelapor — diingat di localStorage agar tidak ketik ulang.
   *  Tombol + menambah baris NRP (satu laporan bisa berisi banyak personel). */
  const [nrpList, setNrpList] = useState<string[]>(() => {
    const saved = localStorage.getItem("siplap_nrp_list");
    if (saved) {
      try {
        const arr = JSON.parse(saved) as unknown;
        if (Array.isArray(arr) && arr.length > 0) {
          return arr
            .filter((n): n is string => typeof n === "string")
            .map((n) => n.replace(/[^0-9]/g, "").slice(0, 20));
        }
      } catch {
        /* localStorage rusak → mulai dari kosong. */
      }
    }
    // Versi lama menyimpan satu NRP polos — pindahkan ke daftar.
    const legacy = localStorage.getItem("siplap_nrp");
    return legacy ? [legacy.replace(/[^0-9]/g, "").slice(0, 20)] : [""];
  });
  const setNrpAt = (index: number, raw: string) => {
    // Hanya angka, maksimal 20 digit per NRP.
    const v = raw.replace(/[^0-9]/g, "").slice(0, 20);
    setNrpList((list) => list.map((n, i) => (i === index ? v : n)));
  };
  const tambahNrp = () => setNrpList((list) => [...list, ""]);
  const hapusNrp = (index: number) =>
    setNrpList((list) =>
      list.length > 1 ? list.filter((_, i) => i !== index) : list,
    );
  /** Daftar NRP siap kirim: buang baris kosong & duplikat, pertahankan urutan. */
  const nrpBersih = useMemo(() => {
    const seen = new Set<string>();
    for (const n of nrpList) {
      const v = n.trim();
      if (v && !seen.has(v)) seen.add(v);
    }
    return [...seen];
  }, [nrpList]);
  useEffect(() => {
    localStorage.setItem("siplap_nrp_list", JSON.stringify(nrpBersih));
  }, [nrpBersih]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Validasi real-time NRP: begitu NRP lengkap (≥6 digit), cari di direktori
   * personel (LAPBUL via Supabase). Ketemu → tampil "PANGKAT Nama — Jabatan"
   * (hijau = benar). Tidak ketemu → tampil peringatan kuning agar pelapor
   * mengecek ulang ketikan — mencegah salah ketik NRP.
   */
  const [nrpCek, setNrpCek] = useState<Record<number, string>>({});
  useEffect(() => {
    let active = true;
    void (async () => {
      const hasil: Record<number, string> = {};
      for (let i = 0; i < nrpList.length; i++) {
        const n = nrpList[i]?.trim() ?? "";
        if (n.length < 6) continue;
        const p = await cariPersonel(n);
        hasil[i] = p ? `${p.pangkat} ${p.nama} — ${p.jabatan}` : "";
      }
      if (active) setNrpCek(hasil);
    })();
    return () => {
      active = false;
    };
  }, [nrpList]);

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
    setJenisCustomMode(false);
    setJenisCustomNama("");
    setTahap("awal");
    // Toggle galeri hanya ada di kejadian — kembali ke kamera agar mode
    // unggah manual tidak nyangkut saat kategori berubah.
    setMediaSource("kamera");
    setCaptureError(null);
  }, [kategori]);

  /** Buang SEMUA dokumentasi (foto & video) + cabut URL preview-nya agar
   *  memori perangkat tidak bocor. Dipakai saat ganti kategori: dokumentasi
   *  galeri tidak memiliki watermark GPS/waktu live sehingga rawan
   *  dipindah-tempelkan — hanya sah untuk laporan kejadian, jadi TIDAK BOLEH
   *  terbawa ke laporan kegiatan (anti kecurangan). */
  const buangSemuaMedia = () => {
    setShots((current) => {
      current.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
    setVideoShot((v) => {
      if (v) URL.revokeObjectURL(v.url);
      return null;
    });
  };

  /** Batalkan perekaman yang sedang berjalan TANPA menjadikannya klip:
   *  stop() polos justru menghasilkan videoShot lewat onstop — maka flag
   *  rekamDibuangRef dipasang dulu supaya chunk dibuang di onstop. */
  const batalkanRekam = () => {
    if (!recording) return;
    rekamDibuangRef.current = true;
    recorderRef.current?.stop();
  };

  /** Pilih kategori = MULAI DARI AWAL, sinkron sebelum render ulang.
   *  Anti kecurangan: unggah galeri hanya sah di kejadian (dokumentasi dari
   *  masyarakat tanpa rekam ulang). Saat pindah kategori, SELURUHNYA direset:
   *  form (perihal, isi, jenis, tahap) maupun foto & video — dokumentasi
   *  galeri tidak boleh nyangkut ke laporan kegiatan yang wajib kamera
   *  langsung ber-watermark GPS. Kamera dinyalakan ulang dari sini (bukan
   *  efek) agar frame <video> tidak hilang-muncul blip satu render. */
  const pilihKategori = (next: KategoriLaporan) => {
    if (next === kategori) return;
    batalkanRekam();
    setKategori(next);
    setMediaSource("kamera");
    setMediaMode("foto");
    // Reset form...
    setPerihal("");
    setIsi("");
    setJenisId("");
    setJenisQuery("");
    setJenisOpen(false);
    setJenisCustomMode(false);
    setJenisCustomNama("");
    setTahap("awal");
    setNrpList(nrpBersih.length > 0 ? nrpBersih : [""]);
    setCaptureError(null);
    setError(null);
    // ...dan reset seluruh dokumentasi (foto & video hilang semua).
    buangSemuaMedia();
    void camera.start(camera.facing, false);
  };

  /** Ganti sumber media (kamera ⇄ galeri) sinkron sebelum render. Galeri
   *  hanya untuk kejadian — guard ini juga menahan klik ganda yang lolos
   *  saat efek [kategori] belum sempat jalan. Matikan perekaman saat pindah
   *  sumber supaya REK + preview video tidak nyangkut di mode galeri.
   *  Kamera dimatikan di sini (bukan efek) supaya frame <video> tidak
   *  hilang-muncul — stream berhenti duluan sebelum galeri dirender. */
  const pilihSumber = (next: "kamera" | "galeri") => {
    if (next === mediaSource) return;
    if (next === "galeri" && kategori !== "kejadian") return;
    batalkanRekam();
    setMediaSource(next);
    if (next === "galeri") {
      setMediaMode("foto");
      camera.stop();
      fileInputRef.current?.click();
    } else {
      setCaptureError(null);
      setMediaMode("foto");
      void camera.start(camera.facing, false);
    }
  };

  const jenisTerpilih = useMemo(
    () => jenisList.find((j) => j.id === jenisId) ?? null,
    [jenisList, jenisId],
  );

  /** Nama custom siap kirim (dirapikan) — hanya saat mode custom aktif. */
  const jenisCustomBersih = useMemo(() => {
    if (!jenisCustomMode) return null;
    return jenisCustomNama.replace(/\s+/g, " ").trim() || null;
  }, [jenisCustomMode, jenisCustomNama]);

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
  /**
   * Teks laporan resmi (format revisi 2026):
   *   *Perihal : {perihal}*
   *   {hari}, {tanggal bulan tahun} pukul {waktu WIB}
   *   {isi laporan}
   *   Demikian laporan kami sampaikan, terimakasih.
   * Hari/jam diambil saat teks disusun (mengikuti pengetikan terakhir),
   * bukan saat form dibuka.
   */
  const teksLaporan = useMemo(() => {
    const now = new Date();
    const p = perihal.trim() || "(perihal belum diisi)";
    const body = isi.trim() || "(isi laporan belum diisi)";
    const hari = now.toLocaleDateString("id-ID", { weekday: "long" });
    const waktu =
      now.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }) + " WIB";
    // Jarak antar bagian: enter 2x (baris kosong di antaranya).
    return `*Perihal : ${p}*\n\n${hari}, ${tanggal} pukul ${waktu}\n\n${body}\n\nDemikian laporan kami sampaikan, terimakasih.`;
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
  /** Detik berjalan selama perekaman — dipakai badge REC + hint tombol. */
  const [recSeconds, setRecSeconds] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  /** Sumber media: kamera langsung (default) atau unggah manual dari
   *  galeri/perangkat — hanya untuk kategori kejadian (laporan dari
   *  masyarakat dulu, baru diinput anggota → tidak bisa direkam ulang). */
  const [mediaSource, setMediaSource] = useState<"kamera" | "galeri">("kamera");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordStartRef = useRef(0);
  /** Flag: perekaman sedang DIBATALKAN (bukan dihentikan normal) — onstop
   *  recorder membaca ini untuk membuang chunk, klip tidak pernah jadi. */
  const rekamDibuangRef = useRef(false);

  useEffect(() => {
    void camera.start();
    return () => camera.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Timer perekaman: hitung detik sejak recordStartRef; reset saat berhenti. */
  useEffect(() => {
    if (!recording) {
      setRecSeconds(0);
      return;
    }
    const started = recordStartRef.current;
    const tick = () => setRecSeconds(Math.floor((Date.now() - started) / 1000));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const changeMode = async (next: "foto" | "video") => {
    if (next === "video" && videoShot) return;
    setCaptureError(null);
    setMediaMode(next);
    // Jangan nyalakan ulang kamera saat perekaman — restart stream akan
    // memotong klip yang sedang berjalan.
    if (!recording) await camera.start(camera.facing, next === "video");
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
        label: "Salam Jawara - Pelaporan Giat",
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
  };  /** Durasi video galeri dari metadata (detik) — 0 bila tak terbaca. */
  const probeVideoDuration = (file: File): Promise<number> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      const selesai = (d: number) => {
        URL.revokeObjectURL(url);
        v.src = "";
        resolve(d);
      };
      v.preload = "metadata";
      v.onloadedmetadata = () =>
        selesai(Number.isFinite(v.duration) ? v.duration : 0);
      v.onerror = () => selesai(0);
      v.src = url;
    });

  /** Unggah manual (khusus kejadian): foto dikompres + diberi label
   *  "Dokumentasi galeri" (TANPA koordinat GPS karangan), video divalidasi
   *  durasi maks 60 detik & ukuran maks 50 MB. */
  const handleGaleriFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Antisipasi ganda: pemilih file hanya boleh mengisi laporan kejadian.
    // Bila user ganti kategori di sela pemilih file terbuka, tolak hasilnya
    // agar foto/video tidak lolos masuk laporan kegiatan.
    if (kategori !== "kejadian") {
      setCaptureError(
        "Unggah galeri hanya untuk laporan kejadian — pakai kamera langsung.",
      );
      return;
    }
    setCaptureError(null);
    const list = Array.from(files);
    const mediaCount = list.filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    ).length;
    if (mediaCount === 0) {
      setCaptureError("Pilih file foto (image) atau video — format lain tidak didukung.");
      return;
    }
    const sisaFoto = Math.max(0, 4 - shots.length);
    const fotoFiles = list.filter((f) => f.type.startsWith("image/")).slice(0, sisaFoto);
    const videoFile = list.find((f) => f.type.startsWith("video/"));
    if (videoFile && videoShot) {
      // Video sudah ada → jangan timpa diam-diam; foto tetap diproses,
      // videonya saja yang dilewati.
      setCaptureError("Video sudah ada — hapus dulu bila ingin mengganti.");
    }

    for (const f of fotoFiles) {
      try {
        const ts = new Date();
        const { blob } = await compressGaleriFoto(f, {
          timestamp: ts,
          label: "Salam Jawara - Pelaporan Giat",
        });
        setShots((s) =>
          s.length >= 4 ? s : [...s, { url: URL.createObjectURL(blob), ts, blob }],
        );
      } catch {
        setCaptureError(`Gagal memproses foto ${f.name}.`);
      }
    }
    if (fotoFiles.length > 0 && fotoFiles.length < list.filter((f) => f.type.startsWith("image/")).length) {
      setCaptureError("Maksimal 4 foto per laporan.");
    }

    if (videoFile && !videoShot) {
      if (videoFile.size > 50 * 1024 * 1024) {
        setCaptureError("Ukuran video galeri melebihi 50 MB — potong/kompres dulu di galeri HP.");
        return;
      }
      const dur = await probeVideoDuration(videoFile);
      if (dur > 60) {
        setCaptureError(`Durasi video galeri ${Math.round(dur)} detik — maksimal 60 detik. Potong dulu di galeri HP.`);
        return;
      }
      setVideoShot((v) => {
        if (v) URL.revokeObjectURL(v.url);
        return {
          url: URL.createObjectURL(videoFile),
          ts: new Date(),
          blob: videoFile,
          durationSeconds: Math.max(1, Math.round(dur || 0)),
        };
      });
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
    // Rekaman baru = mulai bersih: flag pembatalan lama tidak boleh ikut
    // membuang chunk rekaman ini di onstop.
    rekamDibuangRef.current = false;
    setRecording(true);
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      setRecording(false);
      // Perekaman dibatalkan (ganti kategori / pindah sumber) → chunk
      // dibuang, klip tidak pernah dibuat.
      if (rekamDibuangRef.current) {
        rekamDibuangRef.current = false;
        return;
      }
      if (chunks.length === 0) {
        setCaptureError("Video kosong. Coba rekam kembali.");
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
    if (nrpBersih.length === 0) {
      setError("NRP wajib diisi — pemantau memakainya mengenali pelapor.");
      return;
    }
    for (const n of nrpBersih) {
      if (!/^[0-9]{6,20}$/.test(n)) {
        setError(`NRP ${n || "(kosong)"} tidak valid — harus angka 6–20 digit tanpa spasi/huruf.`);
        return;
      }
    }
    if (!perihal.trim()) {
      setError("Perihal laporan wajib diisi.");
      return;
    }
    if (!isi.trim()) {
      setError("Isi laporan wajib diisi.");
      return;
    }
    if (shots.length === 0 && !videoShot) {
      setError(
        "Dokumentasi wajib — sertakan minimal 1 foto atau 1 video.",
      );
      return;
    }
    if (mode === "baru" && !jenisCustomMode && !jenisTerpilih) {
      setError("Pilih jenis laporan terlebih dahulu.");
      return;
    }
    if (mode === "baru" && jenisCustomMode && !jenisCustomBersih) {
      setError("Tulis nama jenis laporan terlebih dahulu.");
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
        jenisCustom:
          mode === "baru" && jenisCustomMode
            ? (jenisCustomBersih ?? null)
            : null,
        tahap:
          mode === "turunan" && parent ? parent.tahapBerikut : tahap,
        parentId: parent?.id ?? null,
        perihal: perihal.trim(),
        isi: isi.trim(),
        nrpList: nrpBersih,
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
                onClick={() => pilihKategori(opt.key)}
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
          <div className="eyebrow">
            Pilih jenis {kategori === "kegiatan" ? "kegiatan (program kerja)" : "kejadian (temuan)"} <span className="text-red-400" aria-hidden="true">*</span>
          </div>
          <input
            type="text"
            className="input mt-2"
            placeholder={
              jenisCustomMode
                ? "Tulis jenis sendiri, mis. Kegiatan Masyarakat"
                : "🔍 Cari jenis… (mis. pencurian)"
            }
            value={
              jenisCustomMode
                ? jenisCustomNama
                : jenisTerpilih && !jenisOpen
                  ? jenisTerpilih.nama
                  : jenisQuery
            }
            onFocus={() => setJenisOpen(true)}
            onChange={(e) => {
              if (jenisCustomMode) {
                setJenisCustomNama(e.target.value);
                return;
              }
              setJenisQuery(e.target.value);
              setJenisOpen(true);
              setJenisId("");
            }}
          />
          {jenisOpen && !jenisCustomMode && (
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
              {/* Opsi custom: pelapor bisa mengetik jenis sendiri bila tidak
                  ada di master — mis. kegiatan masyarakat yang khas. */}
              <button
                type="button"
                onClick={() => {
                  setJenisCustomMode(true);
                  setJenisCustomNama(jenisQuery.trim());
                  setJenisQuery("");
                  setJenisId("");
                  setJenisOpen(false);
                }}
                className="block w-full border-t border-white/10 px-4 py-2.5 text-left text-sm font-semibold text-sky-300 transition hover:bg-white/[0.06]"
              >
                {jenisQuery.trim()
                  ? `➕ Gunakan jenis "${jenisQuery.trim()}"`
                  : "➕ Jenis lain — ketik sendiri…"}
              </button>
            </div>
          )}
          {jenisCustomMode && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-[11px] text-sky-300">
                Jenis ketikan sendiri — tercatat sebagai jenis baru bila belum
                ada di master.
              </p>
              <button
                type="button"
                onClick={() => {
                  setJenisCustomMode(false);
                  setJenisCustomNama("");
                }}
                className="shrink-0 text-[11px] font-semibold text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
              >
                Pilih dari daftar
              </button>
            </div>
          )}
          {!jenisCustomMode && jenisTerpilih && !jenisOpen && (
            <p className="mt-1 text-[11px] text-slate-500">
              Jenis terpilih: <b className="text-gold-300">{jenisTerpilih.nama}</b>
            </p>
          )}
        </section>
      )}

      {/* ---------- 3) Kotak laporan terformat ---------- */}
      <section className="card space-y-4">
        <div>
          <label className="eyebrow" htmlFor="nrp-pelapor">
            NRP pelapor <span className="text-red-400" aria-hidden="true">*</span>
          </label>
          <div className="mt-2 space-y-2">
            {nrpList.map((n, i) => {
              const cek = nrpCek[i];
              const nrpSiap = (n?.trim().length ?? 0) >= 6;
              return (
              <div key={i}>
              <div className="flex gap-2">
                <input
                  id={i === 0 ? "nrp-pelapor" : undefined}
                  className="input"
                  value={n}
                  onChange={(e) => setNrpAt(i, e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={
                    i === 0
                      ? "Tulis NRP Anda, mis. 75001234"
                      : "NRP personel lain…"
                  }
                  required
                />
                {nrpList.length > 1 && (
                  <button
                    type="button"
                    onClick={() => hapusNrp(i)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 text-lg font-bold text-red-300 transition hover:bg-red-500/20 active:scale-90"
                    aria-label={`Hapus NRP ke-${i + 1}`}
                    title="Hapus NRP ini"
                  >
                    ×
                  </button>
                )}
              </div>
              {nrpSiap && cek !== undefined && (
                <p
                  className={
                    "mt-1 text-[11px] font-semibold " +
                    (cek
                      ? "text-emerald-400"
                      : "text-amber-400")
                  }
                >
                  {cek
                    ? `✓ ${cek}`
                    : `NRP ${n} tidak ada di direktori — periksa ulang ketikan.`}
                </p>
              )}
              </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={tambahNrp}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gold-400/50 bg-gold-400/[0.06] px-3 py-2.5 text-sm font-bold text-gold-300 transition hover:bg-gold-400/[0.12] active:scale-[0.98]"
          >
            <span className="text-lg leading-none">+</span> Tambah personel
          </button>
          <p className="mt-1 text-[11px] text-slate-500">
            Satu unit bisa berisi banyak personel — ketuk + untuk menambah NRP.
            Daftar disimpan di perangkat ini, laporan berikutnya terisi otomatis.
          </p>
        </div>

        <div>
          <div className="eyebrow">
            Isi Perihal <span className="text-red-400" aria-hidden="true">*</span>
            <span className="ml-1 font-normal normal-case text-slate-500">(wajib)</span>
          </div>
          <input
            className="input mt-2"
            value={perihal}
            onChange={(e) => setPerihal(e.target.value)}
            placeholder="Tulis perihal, mis. Patroli dialogis di pasar baru"
            maxLength={180}
            required
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-300">
            Isi laporan <span className="text-red-400" aria-hidden="true">*</span>
            <span className="ml-1 text-[11px] font-normal text-slate-500">(wajib)</span>
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

      {/* ---------- 4) Media wajib minimal 1 ---------- */}
      <section className="card">
        <div className="flex items-center justify-between">
          <div className="eyebrow">
            Dokumentasi <span className="text-red-400" aria-hidden="true">*</span>
            <span className="ml-1 font-normal normal-case text-slate-500">(wajib — min. 1 foto / video)</span>
          </div>
          <span className="text-[11px] text-slate-500">
            Maks 4 foto · 1 video
          </span>
        </div>

        {/* Sumber media — unggah manual hanya untuk kejadian: laporan bisa
            berasal dari masyarakat (foto/video WhatsApp dsb.), jadi anggota
            tidak selalu bisa merekam ulang secara realtime. Tombol galeri
            BUKAN perutean antar form — hanya sumber berkas dokumentasi. */}
        {kategori === "kejadian" && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#0b172b] p-1.5">
            <button
              type="button"
              onClick={() => pilihSumber("kamera")}
              className={mediaSource === "kamera" ? "btn-primary py-2" : "btn-secondary py-2"}
            >
              📷 Kamera langsung
            </button>
            <button
              type="button"
              onClick={() => pilihSumber("galeri")}
              className={mediaSource === "galeri" ? "btn-primary py-2" : "btn-secondary py-2"}
            >
              📁 Unggah galeri
            </button>
          </div>
        )}

        <div
          className={
            "mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#0b172b] p-1.5 " +
            (mediaSource === "galeri" ? "hidden" : "")
          }
        >
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

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleGaleriFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {mediaSource === "galeri" && (
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-sky-400/50 bg-sky-400/[0.06] px-4 py-6 text-sm font-bold text-sky-300 transition hover:bg-sky-400/[0.12] active:scale-[0.98]"
            >
              <span className="text-2xl">📁</span>
              Pilih foto / video dari galeri atau file manager
            </button>
            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              Untuk dokumentasi dari masyarakat (WA, dsb.) yang tidak bisa
              direkam ulang. Foto dikompres otomatis · video maks 60 detik /
              50 MB.
            </p>
          </div>
        )}

        <div
          className={
            "camera-frame relative mt-3 overflow-hidden rounded-[1.5rem] border border-sky-400/20 bg-black shadow-[0_20px_45px_rgba(2,12,25,0.38)] " +
            (mediaSource === "galeri" ? "hidden" : "")
          }
        >
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

          {/* Badge REC merah berdenyut + timer detik saat merekam video */}
          {recording && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
              <div className="flex items-center gap-2 rounded-full border border-red-500/40 bg-black/70 px-3.5 py-1.5 backdrop-blur">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="text-[12px] font-extrabold tracking-widest text-red-400">
                  REC
                </span>
                <span className="mono text-[12px] font-bold tabular-nums text-white">
                  {formatRecTime(recSeconds)}
                </span>
                <span className="text-[10px] font-semibold text-slate-400">/ 1:00</span>
              </div>
            </div>
          )}

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

        {mediaSource === "kamera" && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            onClick={toggleCapture}
            disabled={
              !camera.ready ||
              capturing ||
              (mediaMode === "foto" ? shots.length >= 4 : Boolean(videoShot))
            }
            className={
              "shutter-button flex h-16 w-16 items-center justify-center rounded-full border-4 bg-navy-800 text-2xl transition active:scale-90 disabled:opacity-30 " +
              (recording
                ? "border-red-500 shadow-[0_0_0_7px_rgba(239,68,68,0.18)]"
                : "border-gold-400 shadow-[0_0_0_7px_rgba(245,185,66,0.12)]")
            }
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
                ? `Merekam… ${formatRecTime(recSeconds)} / 1:00 — ketuk untuk berhenti`
                : videoShot
                  ? "Video sudah ditambahkan"
                  : "Rekam maksimal 60 detik"}
          </span>
        </div>
        )}
        {captureError && (
          <p className="mt-2 text-center text-xs font-semibold text-red-300">
            {captureError}
          </p>
        )}

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
        disabled={
          sending ||
          !perihal.trim() ||
          !isi.trim() ||
          nrpBersih.length === 0 ||
          (shots.length === 0 && !videoShot)
        }
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
