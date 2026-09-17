import { useCallback, useEffect, useRef, useState } from 'react';

type FacingMode = 'environment' | 'user';

/**
 * Hook kamera getUserMedia (WAJIB live capture — tanpa upload galeri).
 * Mengelola stream, start/stop, dan pergantian kamera depan/belakang.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<FacingMode>('environment');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(
    async (mode: FacingMode = facing) => {
      stop();
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.name === 'NotAllowedError'
              ? 'Akses kamera ditolak. Izinkan kamera di pengaturan browser.'
              : err.message
            : 'Kamera tidak tersedia',
        );
      }
    },
    [facing, stop],
  );

  const switchCamera = useCallback(() => {
    const next: FacingMode = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void start(next);
  }, [facing, start]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { videoRef, ready, error, facing, start, stop, switchCamera };
}
