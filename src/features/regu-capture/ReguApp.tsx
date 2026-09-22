import { useCallback, useEffect, useState } from "react";
import type {
  QueuedLaporan,
  SessionUser,
  TahapLaporan,
} from "../../types";
import { subscribeLaporan } from "../../lib/supabase/api";
import { blobPut, queuePut, queueGetAll } from "../../lib/offline-sync/db";
import {
  syncPendingLaporan,
  requestBackgroundSync,
} from "../../lib/offline-sync/syncManager";
import LaporanForm, {
  type LaporanFormResult,
} from "./LaporanForm";
import ThreadList from "./ThreadList";
import QueueList from "./QueueList";
import { usePosisiTracker } from "./usePosisiTracker";
import PolresLogo from "../../components/PolresLogo";

interface Props {
  session: SessionUser;
  onLogout: () => void;
}

type Screen = "lapor" | "rangkaian" | "queue";

async function loadReguState(
  reguId: string | undefined,
  setQueueCount: (n: number) => void,
) {
  const q = await queueGetAll();
  setQueueCount(q.filter((i) => i.reguId === reguId).length);
}

export default function ReguApp({ session, onLogout }: Props) {
  const [screen, setScreen] = useState<Screen>("lapor");
  const [queueCount, setQueueCount] = useState(0);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  /** Tracker posisi: GPS → tabel `posisi` tiap 60 detik (peta personel). */
  const posisi = usePosisiTracker(session, true);
  /** Induk yang sedang dilanjutkan (null = laporan baru). */
  const [parent, setParent] = useState<{
    id: string;
    kategori: "kegiatan" | "kejadian";
    perihal?: string | null;
    namaJenis?: string | null;
    tahapBerikut: TahapLaporan;
  } | null>(null);
  const [refreshThreads, setRefreshThreads] = useState(0);

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
    const unsub = subscribeLaporan(() => {
      void loadState();
      setRefreshThreads((k) => k + 1);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [loadState]);

  /** Terima hasil form → masuk antrian offline → coba sync. */
  const handleSubmit = useCallback(
    async (result: LaporanFormResult) => {
      const localId = crypto.randomUUID();
      const entry: QueuedLaporan = {
        localId,
        reguId: session.reguId || "",
        siklusKe: 1,
        timestampKirim: new Date().toISOString(),
        latitude: result.latitude,
        longitude: result.longitude,
        catatan: result.teksLaporan,
        kategori: result.kategori,
        jenisId: result.jenis?.id ?? null,
        jenisNama: result.jenis?.nama ?? parent?.namaJenis ?? null,
        tahap: result.tahap,
        parentId: result.parentId,
        perihal: result.perihal,
        fotos: result.fotos.map((f, i) => ({
          blobKey: localId + ":" + (i + 1),
          urutan: (i + 1) as 1 | 2 | 3 | 4,
          watermarkLat: f.lat,
          watermarkLng: f.lng,
          watermarkTimestamp: f.ts.toISOString(),
        })),
        videos: result.video
          ? [
              {
                blobKey: localId + ":video",
                watermarkLat: result.latitude,
                watermarkLng: result.longitude,
                watermarkTimestamp: result.video.ts.toISOString(),
                durationSeconds: result.video.durationSeconds,
              },
            ]
          : [],
        status: "pending",
        attempts: 0,
      };
      for (let i = 0; i < entry.fotos.length; i++) {
        await blobPut(entry.fotos[i].blobKey, result.fotos[i].blob);
      }
      if (result.video && entry.videos.length > 0) {
        await blobPut(entry.videos[0].blobKey, result.video.blob);
      }
      await queuePut(entry);
      const r = await syncPendingLaporan();
      if (r.synced > 0) await requestBackgroundSync();
      await loadState();
      setRefreshThreads((k) => k + 1);
      setSentMsg(
        r.synced > 0
          ? "Laporan berhasil terkirim. Terimakasih."
          : "Laporan tersimpan di antrian — dikirim otomatis saat online.",
      );
      setParent(null);
      setScreen("rangkaian");
      window.setTimeout(() => setSentMsg(null), 5000);
    },
    [session.reguId, loadState],
  );

  const navItems: Array<[Screen, string, string, number | null]> = [
    ["lapor", "📝", "Lapor", null],
    ["rangkaian", "🧵", "Rangkaian", null],
    ["queue", "📦", "Antrian", queueCount > 0 ? queueCount : null],
  ];

  return (
    <div className="regu-app flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-white/10 bg-[#0b1428]/90 px-4 py-3 shadow-[0_12px_40px_rgba(2,12,25,0.28)] backdrop-blur-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="regu-logo-panel shrink-0">
              <PolresLogo className="h-10 w-32 sm:h-11 sm:w-36" />
            </div>
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
      </header>

      <main className="safe-bottom flex-1 pb-[7.5rem]">
        {/* Status pelacakan posisi — kecil, tidak mengganggu. */}
        {(posisi.antrian > 0 || posisi.error) && (
          <div className="mx-4 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300 sm:mx-6">
            {posisi.error
              ? `⚠ GPS: ${posisi.error}`
              : `📡 ${posisi.antrian} posisi tertahan — terkirim otomatis saat online`}
          </div>
        )}
        {screen === "lapor" ? (
          <>
            {sentMsg && (
              <div className="mx-4 mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 sm:mx-6">
                {sentMsg}
              </div>
            )}
            <LaporanForm
              key={parent?.id ?? "baru"}
              mode={parent ? "turunan" : "baru"}
              parent={parent}
              onSubmit={handleSubmit}
            />
          </>
        ) : screen === "rangkaian" ? (
          <ThreadList
            reguId={session.reguId ?? ""}
            refreshKey={refreshThreads}
            onLanjutkan={(p) => {
              setParent(p);
              setScreen("lapor");
            }}
            onLaporBaru={() => {
              setParent(null);
              setScreen("lapor");
            }}
          />
        ) : (
          <QueueList onQueueChanged={loadState} />
        )}
      </main>

      <nav className="regu-bottom-nav safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 border-t border-navy-700/70 bg-navy-950/95 shadow-[0_-12px_32px_rgba(2,12,25,0.35)] backdrop-blur-xl">
        {navItems.map(([key, icon, label, badge]) => (
          <button
            key={key}
            onClick={() => {
              if (key === "lapor") setParent(null);
              setScreen(key);
            }}
            aria-current={screen === key ? "page" : undefined}
            className={
              "relative flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition active:scale-95 " +
              (screen === key ? "text-gold-400" : "text-slate-400 hover:text-white")
            }
          >
            <span className="text-xl leading-none">{icon}</span>
            <span>
              {label}
              {badge != null ? ` (${badge})` : ""}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
