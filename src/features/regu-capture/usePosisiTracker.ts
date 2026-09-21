/**
 * Tracker posisi realtime untuk app pelapor.
 *
 * - Selama aplikasi terbuka, GPS dibaca terus (watchPosition high-accuracy)
 *   dan dikirim ke tabel `posisi` tiap INTERVAL_MS (60 detik).
 * - Saat offline / gagal kirim: posisi masuk ANTRIAN di IndexedDB dan
 *   dikirim ulang otomatis saat online (sesuai keputusan desain).
 * - Berhenti saat app ditutup; posisi terakhir tetap tersimpan di server
 *   sebagai "posisi terakhir diketahui".
 *
 * Antrian memakai IndexedDB store terpisah ("posisi") via db.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { upsertPosisi } from "../../lib/supabase/api";
import { posisiGetAll, posisiPut, posisiDelete, posisiClear } from "../../lib/offline-sync/db";
import type { SessionUser } from "../../types";

/** Kirim posisi tiap 60 detik. */
export const POSISI_INTERVAL_MS = 60_000;

interface QueuedPosisi {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  kecepatanMps: number | null;
  recordedAt: number;
}

export interface PosisiTrackerState {
  /** Posisi lokal terbaru (tidak menunggu server). */
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  /** true bila posisi terakhir berhasil terkirim ke server. */
  synced: boolean;
  /** Jumlah posisi tertahan di antrian offline. */
  antrian: number;
  error: string | null;
}

export function usePosisiTracker(
  session: SessionUser | null,
  active = true,
): PosisiTrackerState {
  const [state, setState] = useState<PosisiTrackerState>({
    lat: null,
    lng: null,
    accuracy: null,
    synced: false,
    antrian: 0,
    error: null,
  });
  const watchId = useRef<number | null>(null);
  const posisiRef = useRef<QueuedPosisi | null>(null);
  const flushing = useRef(false);
  const reguId = session?.reguId ?? null;

  // ---------- Antrian offline (IndexedDB) ----------

  const refreshAntrian = useCallback(async () => {
    try {
      const all = await posisiGetAll();
      setState((s) => ({ ...s, antrian: all.length }));
    } catch {
      /* abaikan */
    }
  }, []);

  /** Kirim satu posisi: langsung, atau antrikan bila gagal/offline. */
  const kirim = useCallback(
    async (p: QueuedPosisi) => {
      if (!reguId) return;
      if (!navigator.onLine) {
        await posisiPut(p);
        await refreshAntrian();
        setState((s) => ({ ...s, synced: false }));
        return;
      }
      try {
        await upsertPosisi({
          reguId,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracyM: p.accuracyM,
          kecepatanMps: p.kecepatanMps,
        });
        setState((s) => ({ ...s, synced: true, error: null }));
      } catch {
        await posisiPut(p);
        await refreshAntrian();
        setState((s) => ({ ...s, synced: false }));
      }
    },
    [reguId, refreshAntrian],
  );

  /** Kirim semua posisi tertahan (dipanggil saat online kembali & periodic). */
  const flushAntrian = useCallback(async () => {
    if (flushing.current || !reguId || !navigator.onLine) return;
    flushing.current = true;
    try {
      const all = await posisiGetAll();
      for (const p of all) {
        try {
          await upsertPosisi({
            reguId,
            latitude: p.latitude,
            longitude: p.longitude,
            accuracyM: p.accuracyM,
            kecepatanMps: p.kecepatanMps,
          });
          await posisiDelete(p);
        } catch {
          break; // masih gagal — coba lagi nanti
        }
      }
      await refreshAntrian();
    } finally {
      flushing.current = false;
    }
  }, [reguId, refreshAntrian]);

  // ---------- GPS watch ----------

  useEffect(() => {
    if (!active || !reguId) return;
    if (!("geolocation" in navigator)) {
      setState((s) => ({ ...s, error: "Perangkat tidak mendukung GPS" }));
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p: QueuedPosisi = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
          kecepatanMps:
            pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
              ? pos.coords.speed
              : null,
          recordedAt: Date.now(),
        };
        posisiRef.current = p;
        setState((s) => ({
          ...s,
          lat: p.latitude,
          lng: p.longitude,
          accuracy: p.accuracyM,
          error: null,
        }));
      },
      (err) => {
        setState((s) => ({ ...s, error: err.message }));
      },
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 15_000 },
    );

    return () => {
      if (watchId.current != null)
        navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [active, reguId]);

  // ---------- Interval kirim + flush saat online ----------

  useEffect(() => {
    if (!active || !reguId) return;

    // Kirim posisi terakhir saat interval berjalan; jika tidak ada fix GPS
    // baru, jangan kirim apa-apa (posisi lama masih valid di server).
    const timer = window.setInterval(() => {
      const p = posisiRef.current;
      if (p) void kirim(p);
      // Flush antrian berkala juga (bila online).
      void flushAntrian();
    }, POSISI_INTERVAL_MS);

    const onOnline = () => {
      void flushAntrian();
    };
    window.addEventListener("online", onOnline);

    // Flush awal saat tracker aktif (mis. app baru dibuka setelah offline).
    void flushAntrian();
    void refreshAntrian();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [active, reguId, kirim, flushAntrian, refreshAntrian]);

  // ---------- Bersihkan antrian saat logout ----------

  useEffect(() => {
    if (active || reguId) return;
    // Session null (logout) — antrian tidak berguna tanpa reguId.
    void posisiClear().catch(() => undefined);
  }, [active, reguId]);

  return state;
}
