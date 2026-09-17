import { useEffect, useRef, useState } from 'react';
import { reverseGeocode, type PlaceInfo } from '../../lib/geo';

export interface GeoState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  error: string | null;
  place: PlaceInfo | null; // nama tempat hasil reverse geocoding
}

/** Hook GPS: posisi ter-update terus via watchPosition (akurasi meningkat seiring waktu). */
export function useGeolocation(active = true): GeoState & { refresh: () => void } {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    error: null,
    place: null,
  });
  const watchId = useRef<number | null>(null);

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

  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'Perangkat tidak mendukung GPS' }));
      return;
    }
    const success: PositionCallback = (pos) => {
      setState((s) => ({
        ...s,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        error: null,
      }));
    };
    const errorCb: PositionErrorCallback = (err) => {
      setState((s) => ({ ...s, error: err.message }));
    };
    watchId.current = navigator.geolocation.watchPosition(success, errorCb, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 5_000,
    });
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [active]);

  const refresh = () => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setState((s) => ({
        ...s,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        error: null,
      }));
    });
  };

  return { ...state, refresh };
}
