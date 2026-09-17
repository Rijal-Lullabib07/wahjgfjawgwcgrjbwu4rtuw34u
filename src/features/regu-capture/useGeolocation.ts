import { useEffect, useRef, useState } from 'react';

export interface GeoState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  error: string | null;
}

/** Hook GPS: posisi ter-update terus via watchPosition (akurasi meningkat seiring waktu). */
export function useGeolocation(active = true): GeoState & { refresh: () => void } {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    error: null,
  });
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'Perangkat tidak mendukung GPS' }));
      return;
    }
    const success: PositionCallback = (pos) => {
      setState({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        error: null,
        ...({} as object),
      });
      // pemanggilan setState di atas sudah lengkap
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
      setState({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        error: null,
      });
    });
  };

  return { ...state, refresh };
}
