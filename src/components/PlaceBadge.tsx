import { useEffect, useState } from "react";
import {
  cachedPlace,
  formatPlace,
  reverseGeocode,
  type PlaceInfo,
} from "../lib/geo";

/**
 * Badge lokasi dengan nama tempat (reverse geocoding, ber-cache) —
 * fallback ke koordinat presisi bila nama tempat belum tersedia.
 * Hover/title memuat koordinat lengkap 6 desimal (≈ 0,1 m).
 */
export default function PlaceBadge({
  lat,
  lng,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
}) {
  const [place, setPlace] = useState<PlaceInfo | null>(() =>
    cachedPlace(lat ?? null, lng ?? null),
  );

  useEffect(() => {
    if (lat == null || lng == null) return;
    const cached = cachedPlace(lat, lng);
    if (cached) {
      setPlace(cached);
      return;
    }
    let active = true;
    void reverseGeocode(lat, lng).then((p) => {
      if (active && p) setPlace(p);
    });
    return () => {
      active = false;
    };
  }, [lat, lng]);

  const koordinat =
    lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : null;

  return (
    <span
      className="badge bg-navy-700 text-navy-100"
      title={koordinat ? `Koordinat: ${koordinat}` : undefined}
    >
      📍{" "}
      {lat == null || lng == null
        ? "Lokasi tidak tersedia"
        : formatPlace(place, lat, lng)}
    </span>
  );
}
