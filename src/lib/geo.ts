/**
 * Reverse geocoding: ubah koordinat GPS → nama tempat yang mudah dibaca
 * (contoh: "-6.91472, 107.38041" → "Alun-Alun Purwakarta, Purwakarta, Jawa Barat").
 *
 * Sumber data: Nominatim (OpenStreetMap) — gratis, tanpa API key, wajib
 * User-Agent & max 1 req/detik; fallback BigDataCloud (juga gratis, tanpa key).
 * Hasil di-cache per koordinat (dibulatkan ~100 m) di memori + localStorage
 * supaya kuota hemat dan watermark tetap cepat.
 */

export interface PlaceInfo {
  name: string; // nama tempat singkat (POI/jalan/area)
  detail: string; // kota/kabupaten + provinsi
}

const cache = new Map<string, PlaceInfo | null>();
const CACHE_KEY = 'siplap_geocache_v1';
const COORD_PRECISION = 3; // desimal ke-3 ≈ 111 m — cukup untuk nama area
const MIN_INTERVAL_MS = 1100; // hormati batas 1 req/detik Nominatim
let lastCall = 0;

// Muat cache persisten saat modul pertama dipakai (aman-gagal untuk SW/browser lama)
try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, PlaceInfo | null>)) {
      cache.set(k, v);
    }
  }
} catch {
  /* abaikan */
}

function persist(): void {
  try {
    const obj: Record<string, PlaceInfo | null> = {};
    for (const [k, v] of cache) obj[k] = v;
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* kuota penuh — cache memori saja */
  }
}

function cacheKey(lat: number, lng: number): string {
  return lat.toFixed(COORD_PRECISION) + ',' + lng.toFixed(COORD_PRECISION);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nominatim: ambil nama tempat dari koordinat. */
async function viaNominatim(lat: number, lng: number): Promise<PlaceInfo | null> {
  const url =
    'https://nominatim.openstreetmap.org/reverse?format=jsonv2' +
    `&lat=${lat}&lon=${lng}&zoom=18&accept-language=id`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    // Catatan: browser melarang set User-Agent kustom; Nominatim menerima
    // permintaan browser asalkan volume wajar (di-cache & dibatasi di sini).
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    name?: string;
    address?: Record<string, string>;
  };
  const a = j.address ?? {};
  const kota = a.city ?? a.regency ?? a.county ?? a.municipality ?? '';
  const prov = a.state ?? '';
  const detail = [kota, prov].filter(Boolean).join(', ');
  const name = j.name || a.suburb || a.village || a.road || kota || '';
  if (!name && !detail) return null;
  return { name: name || detail, detail };
}

/** BigDataCloud (fallback): gratis tanpa key, cukup akurat sampai level kota. */
async function viaBigDataCloud(lat: number, lng: number): Promise<PlaceInfo | null> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = (await res.json()) as {
    locality?: string;
    city?: string;
    principalSubdivision?: string;
  };
  const kota = j.city || j.locality || '';
  const prov = j.principalSubdivision || '';
  if (!kota && !prov) return null;
  return { name: kota || prov, detail: [kota, prov].filter(Boolean).join(', ') };
}

/**
 * Ambil nama tempat dari koordinat. Selalu resolve (tidak throw);
 * return null bila offline/gagal — pemanggil tinggal tampilkan koordinat.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<PlaceInfo | null> {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!navigator.onLine) return null;

  // Throttle: jeda minimal antar permintaan jaringan
  const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  let result: PlaceInfo | null = null;
  try {
    result = (await viaNominatim(lat, lng)) ?? (await viaBigDataCloud(lat, lng));
  } catch {
    try {
      result = await viaBigDataCloud(lat, lng);
    } catch {
      result = null;
    }
  }

  cache.set(key, result);
  if (cache.size > 200) {
    // buang entri tertua (kunci pertama)
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  persist();
  return result;
}

/** Versi sinkron dari cache saja — untuk watermark (tanpa menunggu jaringan). */
export function cachedPlace(lat: number | null, lng: number | null): PlaceInfo | null {
  if (lat == null || lng == null) return null;
  return cache.get(cacheKey(lat, lng)) ?? null;
}

/** Format ringkas untuk badge/UI: "Alun-Alun Purwakarta — Purwakarta, Jawa Barat". */
export function formatPlace(p: PlaceInfo | null, lat: number | null, lng: number | null): string {
  if (p) return p.detail ? `${p.name} · ${p.detail}` : p.name;
  if (lat != null && lng != null) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return 'Mencari lokasi…';
}
