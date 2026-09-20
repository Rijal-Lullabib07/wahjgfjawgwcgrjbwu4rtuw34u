import { useCallback, useEffect, useRef, useState } from 'react';
import { reverseGeocode, type PlaceInfo } from '../../lib/geo';

export interface GeoState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  error: string | null;
  place: PlaceInfo | null; // nama tempat hasil reverse geocoding
}

/** Posisi dianggap sangat akurat bila radius ketidakpastiannya ≤ 10 m. */
export const GPS_TARGET_ACCURACY = 10;

/**
 * Hook GPS dengan fokus AKURASI MAKSIMAL:
 *  1. Fix awal cepat dari cache/network agar UI langsung punya posisi.
 *  2. watchPosition high-accuracy terus-menerus; posisi hanya diganti bila
 *     lebih akurat dari sebelumnya (atau yang lama sudah basi > 30 detik).
 *  3. Setelah fix sangat akurat (≤10 m) diterima, watch tetap jalan — jika
 *     berpindah tempat, posisi mengikuti.
 *  4. `refresh()` memaksa pembacaan ulang (mis. tombol "Perbarui lokasi").
 */
export function useGeolocation(active = true): GeoState & {
  refresh: () => void;
  /** true bila akurasi sudah ≤ GPS_TARGET_ACCURACY meter. */
  locked: boolean;
} {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    error: null,
    place: null,
  });
  const [locked, setLocked] = useState(false);
  const watchId = useRef<number | null>(null);
  const bestAccuracy = useRef<number | null>(null);
  const lastFixAt = useRef<number>(0);

  // Reverse geocoding: cari nama tempat tiap koordinat baru berubah area
  useEffect(() => {
    if (state.lat == null || state.lng == null) return;
    let cancelled = false;
    void reverseGeocode(state.lat, state.lng).then((p) => {
      if (!cancelled && p) setState((s) => ({ ...s, place: p }));
    });
    return () => {
      cancelled = true;
    };
  }, [state.lat, state.lng]);

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = pos.coords;
    const now = Date.now();
    const prev = bestAccuracy.current;
    const stale = now - lastFixAt.current > 30_000;

    // Terima fix pertama apa pun (agar UI tidak kosong), lalu hanya tingkatkan:
    // ganti posisi hanya jika fix baru lebih akurat ATAU fix lama sudah basi.
    if (
      prev != null &&
      !stale &&
      accuracy >= prev &&
      // tapi izinkan update posisi ketika perangkat berpindah jauh (>15 m)
      !movedFarEnough(prev == null, state.lat, state.lng, latitude, longitude)
    ) {
      return;
    }

    bestAccuracy.current = accuracy;
    lastFixAt.current = now;
    setLocked(accuracy <= GPS_TARGET_ACCURACY);
    setState((s) => ({
      ...s,
      lat: latitude,
      lng: longitude,
      accuracy,
      error: null,
    }));
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'Perangkat tidak mendukung GPS' }));
      return;
    }

    // 1) Fix cepat (cache ≤10 detik) supaya koordinat langsung tampil.
    navigator.geolocation.getCurrentPosition(applyPosition, undefined, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 10_000,
    });

    // 2) Watch high-accuracy berkelanjutan untuk menajamkan akurasi.
    watchId.current = navigator.geolocation.watchPosition(applyPosition, (err) => {
      setState((s) => ({ ...s, error: err.message }));
    }, {
      enableHighAccuracy: true,
      timeout: 30_000,
      maximumAge: 0,
    });

    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [active, applyPosition]);

  const refresh = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(applyPosition, undefined, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  }, [applyPosition]);

  return { ...state, refresh, locked };
}

/** True bila posisi baru berpindah > ~15 m dari sebelumnya (perangkat pindah). */
function movedFarEnough(
  _hadPrev: boolean,
  prevLat: number | null,
  prevLng: number | null,
  lat: number,
  lng: number,
): boolean {
  if (prevLat == null || prevLng == null) return false;
  const dLat = ((lat - prevLat) * Math.PI) / 180;
  const dLng = ((lng - prevLng) * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latRad) ** 2 * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(a)) > 15;
}
