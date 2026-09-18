import { useCallback, useEffect, useRef, useState } from "react";
import type { QueuedLaporan, SessionUser } from "../../types";
import { getCurrentCycle, type CycleInfo } from "../../lib/cycle";
import { fetchLaporan, subscribeLaporan } from "../../lib/supabase/api";
import { blobPut, queuePut, queueGetAll } from "../../lib/offline-sync/db";
import {
  syncPendingLaporan,
  requestBackgroundSync,
} from "../../lib/offline-sync/syncManager";
import { startLocalReminder } from "../../lib/push/localReminder";
import {
  syncPushSubscription,
  notificationPermission,
  pushSupported,
} from "../../lib/push/subscribe";
import { getPlatform, isStandaloneNow } from "../../lib/session";
import PushSetupModal from "./PushSetupModal";
import CaptureScreen from "./CaptureScreen";
import QueueList from "./QueueList";
import SatpolPPLogo from "../../components/SatpolPPLogo";

interface Props {
  session: SessionUser;
  onLogout: () => void;
}

type Screen = "capture" | "queue";

async function loadReguState(
  reguId: string | undefined,
  cycle: CycleInfo,
  setQueueCount: (n: number) => void,
  setSentCount: (n: number) => void,
) {
  const q = await queueGetAll();
  // Hanya entri siklus berjalan yang dihitung ke kuota (foto di antrian offline)
  setQueueCount(
    q
      .filter((i) => i.reguId === reguId && i.siklusKe === cycle.siklusKe)
      .reduce((acc, i) => acc + i.fotos.length, 0),
  );
  try {
    const rows = await fetchLaporan({
      reguId,
      from: cycle.start,
      to: cycle.end,
      limit: 50,
    });
    setSentCount(rows.reduce((acc, r) => acc + (r.fotos?.length ?? 0), 0));
  } catch {
    /* offline: keep last value */
  }
}

export default function ReguApp({ session, onLogout }: Props) {
  const [screen, setScreen] = useState<Screen>("capture");
  const [cycle, setCycle] = useState<CycleInfo>(() => getCurrentCycle());
  const [sentCount, setSentCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [pushState, setPushState] = useState<"unknown" | "on" | "off">(
    "unknown",
  );
  const [setupOpen, setSetupOpen] = useState(false);
  const reminderRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setCycle(getCurrentCycle()), 15000);
    return () => clearInterval(t);
  }, []);

  const loadState = useCallback(async () => {
    await loadReguState(session.reguId, cycle, setQueueCount, setSentCount);
  }, [session.reguId, cycle]);

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

  /**
   * Segarkan status notifikasi + reminder lokal.
   * Dipanggil saat mount, saat ganti regu, dan setiap app kembali terlihat
   * (user mungkin baru saja mengizinkan notifikasi lewat Pengaturan Android /
   * Safari lalu kembali ke app).
   */
  const refreshPushStatus = useCallback(() => {
    if (!pushSupported() || notificationPermission() !== "granted") {
      setPushState("off");
      return;
    }
    setPushState("on");
    reminderRef.current?.stop();
    reminderRef.current = startLocalReminder(session.reguId);
    // Pastikan endpoint device ini menunjuk ke regu yang sedang login — device
    // bisa dipakai bergantian, dan browser bisa merotasi kunci subscription.
    void syncPushSubscription(session.reguId);
  }, [session.reguId]);

  useEffect(() => {
    refreshPushStatus();
    // Bersihkan reminder saat regu berganti / unmount (bug lama: reminder
    // ganda karena handle baru menimpa ref tanpa stop() handle lama).
    return () => reminderRef.current?.stop();
  }, [refreshPushStatus]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshPushStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshPushStatus]);

  // Aktivasi notifikasi kini lewat modal interaktif (diagnosa + izin +
  // panduan per-platform). Handler lama diganti onPushEnabled di bawah.
  const onPushEnabled = useCallback(() => {
    setPushState("on");
    reminderRef.current?.stop();
    reminderRef.current = startLocalReminder(session.reguId);
  }, [session.reguId]);

  const handleCaptureDone = useCallback(
    async (
      fotos: Array<{
        blob: Blob;
        lat: number | null;
        lng: number | null;
        ts: Date;
      }>,
    ) => {
      const localId = crypto.randomUUID();
      const entry: QueuedLaporan = {
        localId,
        reguId: session.reguId || "",
        siklusKe: cycle.siklusKe,
        timestampKirim: new Date().toISOString(),
        latitude: fotos[0]?.lat ?? null,
        longitude: fotos[0]?.lng ?? null,
        catatan: "",
        fotos: fotos.map((f, i) => ({
          blobKey: localId + ":" + (i + 1),
          urutan: (i + 1) as 1 | 2,
          watermarkLat: f.lat,
          watermarkLng: f.lng,
          watermarkTimestamp: f.ts.toISOString(),
        })),
        status: "pending",
        attempts: 0,
      };
      for (let i = 0; i < entry.fotos.length; i++) {
        await blobPut(entry.fotos[i].blobKey, fotos[i].blob);
      }
      await queuePut(entry);
      const r = await syncPendingLaporan();
      if (r.synced > 0) await requestBackgroundSync();
      await loadState();
    },
    [session.reguId, cycle.siklusKe, loadState],
  );

  const platform = getPlatform();
  const standalone = isStandaloneNow();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-navy-700/70 bg-navy-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SatpolPPLogo className="h-9 w-9" />
            <div>
              <div className="eyebrow">SIPLAP / lapangan</div>
              <div className="font-bold leading-tight">{session.namaRegu}</div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white"
          >
            Keluar
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="badge bg-navy-700 text-navy-100">{cycle.label}</span>
          <span
            className={
              cycle.minutesLeft <= 15
                ? "font-semibold text-gold-400"
                : "text-slate-400"
            }
          >
            <span className="mono">
              {String(cycle.minutesLeft).padStart(2, "0")}m
            </span>{" "}
            tersisa
          </span>
        </div>
      </header>

      <main className="safe-bottom flex-1 pb-24">
        {screen === "capture" ? (
          <CaptureScreen
            cycle={cycle}
            sentCount={sentCount}
            queueCount={queueCount}
            onCaptureDone={handleCaptureDone}
          />
        ) : (
          <QueueList onQueueChanged={loadState} />
        )}
      </main>

      {/* Banner aktivasi push (muncul bila belum aktif) */}
      {pushState === "off" && (
        <div className="fixed inset-x-0 bottom-16 z-10 px-4">
          <div className="mx-auto max-w-md rounded-xl border border-gold-400/40 bg-navy-800 p-3 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-200">
                🔔 Aktifkan notifikasi pengingat siklus (tetap masuk walau app
                ditutup)
              </span>
              <button
                onClick={() => setSetupOpen(true)}
                className="btn-primary shrink-0 px-3 py-1.5 text-xs"
              >
                Aktifkan
              </button>
            </div>
            {/* Petunjuk singkat sesuai platform — tidak lagi menebak iOS di Android */}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {platform === "android"
                ? standalone
                  ? "Android · app terpasang — tinggal izinkan notifikasi."
                  : "Android · Chrome / Samsung Internet direkomendasikan. Buka dari link chat (WebView) tidak mendukung push."
                : platform === "ios"
                  ? "iPhone · wajib dipasang ke Home Screen (Share → Add to Home Screen)."
                  : "Desktop · izinkan notifikasi di address bar."}
            </p>
          </div>
        </div>
      )}

      {/* Modal setup interaktif: diagnosa, izin, pasang app, troubleshooting */}
      <PushSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        reguId={session.reguId}
        onEnabled={onPushEnabled}
      />

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
