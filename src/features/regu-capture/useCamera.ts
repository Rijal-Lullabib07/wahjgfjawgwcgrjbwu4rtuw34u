import { useCallback, useEffect, useRef, useState } from "react";

type FacingMode = "environment" | "user";

function errMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Kamera tidak tersedia";
  switch (err.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Akses kamera ditolak. Buka pengaturan browser/HP → izin kamera → izinkan untuk SIPLAP.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Kamera tidak ditemukan di perangkat ini.";
    case "NotReadableError":
      return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.";
    default:
      return err.message || "Kamera gagal dinyalakan";
  }
}

/**
 * Hook kamera getUserMedia (WAJIB live capture — tanpa upload galeri).
 * Mengelola stream, start/stop, pergantian kamera depan/belakang,
 * deteksi konteks tidak aman (bukan HTTPS), dan timeout permintaan izin.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<FacingMode>("environment");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [insecure, setInsecure] = useState(false);

  // getUserMedia hanya jalan di secure context (HTTPS / localhost).
  // Ditambah pengecualian Android WebView, tempat browser lama mendaftarkan
  // getUserMedia meski halaman tidak aman — dan gagal jalan.
  const isSecure =
    typeof window !== "undefined" &&
    (window.isSecureContext ||
      /Android/i.test(navigator.userAgent) === false ||
      /; wv\)/i.test(navigator.userAgent));

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(
    async (mode: FacingMode = facing, withAudio = false) => {
      stop();
      setError(null);

      if (!isSecure) {
        setInsecure(true);
        setError(
          "Kamera butuh koneksi aman (HTTPS). Buka aplikasi lewat alamat https://…, bukan http://",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Browser ini tidak mendukung akses kamera. Coba Chrome terbaru.",
        );
        return;
      }

      // Coba bertahap: HD → resolusi default → constraint longgar.
      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: withAudio,
        },
        { video: { facingMode: { ideal: mode } }, audio: withAudio },
        { video: true, audio: withAudio },
      ];
      if (withAudio) {
        attempts.push(
          { video: { facingMode: { ideal: mode } }, audio: false },
          { video: true, audio: false },
        );
      }

      let lastErr: unknown = null;
      for (const constraints of attempts) {
        try {
          // Timeout 15 dtk: kalau izin menggantung (dialog tidak dijawab / bug WebView),
          // batalkan dan tampilkan pesan supaya user tidak menunggu selamanya.
          const stream = await Promise.race([
            navigator.mediaDevices.getUserMedia(constraints),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Waktu permintaan kamera habis")),
                15000,
              ),
            ),
          ]);
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            try {
              await videoRef.current.play();
            } catch {
              /* autoplay policy: user gesture akan melanjutkan */
            }
          }
          setReady(true);
          return;
        } catch (err) {
          lastErr = err;
          // NotAllowedError tidak akan membaik dengan constraint longgar — hentikan.
          if (err instanceof Error && err.name === "NotAllowedError") break;
        }
      }
      setError(errMessage(lastErr));
    },
    [facing, stop, isSecure],
  );

  const switchCamera = useCallback(() => {
    const next: FacingMode = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void start(next);
  }, [facing, start]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    videoRef,
    ready,
    error,
    facing,
    start,
    stop,
    switchCamera,
    insecure,
  };
}
