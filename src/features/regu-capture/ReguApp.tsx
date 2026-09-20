import { useCallback, useEffect, useState } from "react";
import type { QueuedLaporan, SessionUser } from "../../types";
import { getCurrentCycle, type CycleInfo } from "../../lib/cycle";
import { subscribeLaporan } from "../../lib/supabase/api";
import { blobPut, queuePut, queueGetAll } from "../../lib/offline-sync/db";
import {
  syncPendingLaporan,
  requestBackgroundSync,
} from "../../lib/offline-sync/syncManager";
import CaptureScreen from "./CaptureScreen";
import QueueList from "./QueueList";
import PolresLogo from "../../components/PolresLogo";

interface Props {
  session: SessionUser;
  onLogout: () => void;
}

type Screen = "capture" | "queue";

async function loadReguState(
  reguId: string | undefined,
  setQueueCount: (n: number) => void,
) {
  const q = await queueGetAll();
  setQueueCount(q.filter((i) => i.reguId === reguId).length);
}

export default function ReguApp({ session, onLogout }: Props) {
  const [screen, setScreen] = useState<Screen>("capture");
  const [cycle, setCycle] = useState<CycleInfo>(() => getCurrentCycle());
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setCycle(getCurrentCycle()), 15000);
    return () => clearInterval(t);
  }, []);

  const loadState = useCallback(async () => {
    await loadReguState(session.reguId, setQueueCount);
  }, [session.reguId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await syncPendingLaporan();
      if (active && r.synced > 0) void loadState();
    })();
    const unsub = subscribeLaporan(() => void loadState());
    return () => {
      active = false;
      unsub();
    };
  }, [loadState]);

  const handleCaptureDone = useCallback(
    async (
      fotos: Array<{
        blob: Blob;
        lat: number | null;
        lng: number | null;
        ts: Date;
      }>,
      video: { blob: Blob; ts: Date; durationSeconds: number } | null,
      catatan: string,
    ) => {
      const localId = crypto.randomUUID();
      const entry: QueuedLaporan = {
        localId,
        reguId: session.reguId || "",
        siklusKe: cycle.siklusKe,
        timestampKirim: new Date().toISOString(),
        latitude: fotos[0]?.lat ?? null,
        longitude: fotos[0]?.lng ?? null,
        catatan,
        fotos: fotos.map((f, i) => ({
          blobKey: localId + ":" + (i + 1),
          urutan: (i + 1) as 1 | 2 | 3 | 4,
          watermarkLat: f.lat,
          watermarkLng: f.lng,
          watermarkTimestamp: f.ts.toISOString(),
        })),
        videos: video
          ? [
              {
                blobKey: localId + ":video",
                watermarkLat: fotos[0]?.lat ?? null,
                watermarkLng: fotos[0]?.lng ?? null,
                watermarkTimestamp: video.ts.toISOString(),
                durationSeconds: video.durationSeconds,
              },
            ]
          : [],
        status: "pending",
        attempts: 0,
      };
      for (let i = 0; i < entry.fotos.length; i++) {
        await blobPut(entry.fotos[i].blobKey, fotos[i].blob);
      }
      if (video && entry.videos.length > 0) {
        await blobPut(entry.videos[0].blobKey, video.blob);
      }
      await queuePut(entry);
      const r = await syncPendingLaporan();
      if (r.synced > 0) await requestBackgroundSync();
      await loadState();
    },
    [session.reguId, cycle.siklusKe, loadState],
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-white/10 bg-[#0b1428]/90 px-4 py-3 shadow-[0_12px_40px_rgba(2,12,25,0.28)] backdrop-blur-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PolresLogo className="h-11 w-36 sm:h-12 sm:w-40" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-400">
                Pelapor lapangan
              </div>
              <div className="mt-0.5 max-w-32 truncate text-sm font-bold leading-tight text-white">
                {session.namaRegu}
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300"
          >
            Keluar
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="badge border border-sky-400/20 bg-sky-400/10 text-sky-200">
            {cycle.label}
          </span>
          <span className="truncate text-right text-slate-400">
            Laporan bisa dikirim kapan saja
          </span>
        </div>
      </header>

      <main className="safe-bottom flex-1 pb-24">
        {screen === "capture" ? (
          <CaptureScreen cycle={cycle} onCaptureDone={handleCaptureDone} />
        ) : (
          <QueueList onQueueChanged={loadState} />
        )}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-10 grid grid-cols-2 border-t border-navy-700/70 bg-navy-950/95 shadow-[0_-12px_32px_rgba(2,12,25,0.35)] backdrop-blur-xl">
        <button
          onClick={() => setScreen("capture")}
          aria-current={screen === "capture" ? "page" : undefined}
          className={
            "relative flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition active:scale-95 " +
            (screen === "capture"
              ? "text-gold-400"
              : "text-slate-400 hover:text-white")
          }
        >
          <span className="text-xl leading-none">📷</span>
          <span>Kamera</span>
        </button>
        <button
          onClick={() => setScreen("queue")}
          aria-current={screen === "queue" ? "page" : undefined}
          className={
            "relative flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition active:scale-95 " +
            (screen === "queue"
              ? "text-gold-400"
              : "text-slate-400 hover:text-white")
          }
        >
          <span className="text-xl leading-none">📦</span>
          <span>Antrian{queueCount > 0 ? " (" + queueCount + ")" : ""}</span>
        </button>
      </nav>
    </div>
  );
}
