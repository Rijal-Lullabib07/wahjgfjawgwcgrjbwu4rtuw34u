import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "../../types";
import MonitoringScreen from "./MonitoringScreen";
import OrganizationScreen from "./OrganizationScreen";
import FolderScreen from "./FolderScreen";
import ReportPopup, { type ReportPopupData } from "./ReportPopup";
import ReportScreen from "../report-generator/ReportScreen";
import PolresLogo from "../../components/PolresLogo";
import { subscribeLaporan } from "../../lib/supabase/api";
import { supabase } from "../../lib/supabase/client";
import { folderKeyForRegu } from "../../lib/folders";
import { playAlertSound, vibrateDevice } from "../../lib/notify";
import {
  describePushBlocker,
  enablePush,
  getPushBlocker,
  notificationPermission,
  syncPushSubscription,
} from "../../lib/push/subscribe";

interface Props {
  session: SessionUser;
  onLogout: () => void;
}

type Tab = "folder" | "monitoring" | "struktur" | "laporan";

/** Tombol "Aktifkan notifikasi" untuk pemantau (sekali saja, lalu aktif). */
function NotificationButton({ session }: { session: SessionUser }) {
  const [perm, setPerm] = useState(notificationPermission());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isMonitor = session.role === "admin" || session.role === "pimpinan";

  useEffect(() => {
    if (!isMonitor || perm !== "granted") return;
    // Re-bind endpoint ke akun pemantau yang sedang login (HP dipakai
    // bergantian antar akun).
    void syncPushSubscription(undefined);
  }, [isMonitor, perm]);

  if (!isMonitor || perm === "unsupported") return null;

  if (perm === "granted") {
    return (
      <span className="badge hidden bg-emerald-500/15 text-emerald-300 sm:inline-flex">
        🔔 Notifikasi aktif
      </span>
    );
  }

  const blocker = getPushBlocker();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            // Untuk pemantau, claim_push_subscription menautkan endpoint
            // ke akun admin (monitor_id) di sisi server.
            await enablePush(undefined);
            setPerm(notificationPermission());
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="rounded-xl border border-gold-400/50 bg-gold-400/10 px-3 py-2 text-sm font-semibold text-gold-300 transition hover:bg-gold-400/20 disabled:opacity-50"
      >
        {busy ? "Mengaktifkan…" : "🔔 Aktifkan notifikasi"}
      </button>
      {(msg || blocker) && (
        <span className="max-w-[16rem] text-right text-[11px] leading-tight text-red-300">
          {msg ?? describePushBlocker(blocker as Exclude<typeof blocker, null>)}
        </span>
      )}
    </div>
  );
}

/** Dashboard Pemantau/Admin: tab utama 📁 Folder + monitoring realtime. */
export default function AdminApp({ session, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("folder");
  const [refreshKey, setRefreshKey] = useState(0);
  const [popup, setPopup] = useState<ReportPopupData | null>(null);
  const [openFolderKey, setOpenFolderKey] = useState<string | null>(null);
  const shownIds = useRef(new Set<string>());

  const handleInsert = useCallback(
    async (row: {
      id: string;
      regu_id: string;
      timestamp_kirim: string;
      catatan: string | null;
    }) => {
      if (shownIds.current.has(row.id)) return;
      shownIds.current.add(row.id);
      if (!supabase) return;

      const { data: regu } = await supabase
        .from("regu")
        .select("nama_regu, unit_key, wilayah_key")
        .eq("id", row.regu_id)
        .maybeSingle();

      const waktu = new Date(row.timestamp_kirim).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
      });
      setPopup({
        title: regu?.nama_regu ?? "Laporan baru",
        body: `${waktu} WIB${
          row.catatan ? ` — ${row.catatan.slice(0, 80)}` : ""
        }`,
        folderKey: folderKeyForRegu(regu?.unit_key, regu?.wilayah_key),
        laporanId: row.id,
      });
      playAlertSound();
      vibrateDevice();
    },
    [],
  );

  useEffect(() => {
    // Realtime menghormati RLS → pemantau hanya menerima laporan
    // dalam cakupannya.
    const unsubscribe = subscribeLaporan(
      () => setRefreshKey((k) => k + 1),
      (row) => void handleInsert(row),
    );

    // Push diterima saat app TERBUKA → sistem ditahan oleh service worker
    // dan diteruskan ke sini sebagai pesan (tidak dobel dengan popup).
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string;
            data?: {
              title?: string;
              body?: string;
              folderKey?: string;
              laporanId?: string;
            };
          }
        | undefined;
      if (data?.type !== "SIPLAP_LAPORAN_PUSH") return;
      const laporanId = data.data?.laporanId;
      if (laporanId) {
        if (shownIds.current.has(laporanId)) return;
        shownIds.current.add(laporanId);
      }
      setPopup({
        title: data.data?.title ?? "Laporan baru masuk",
        body: data.data?.body ?? "",
        folderKey: data.data?.folderKey ?? null,
        laporanId,
      });
      playAlertSound();
      vibrateDevice();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      unsubscribe();
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [handleInsert]);

  const handleOpenFromPopup = useCallback((folderKey: string) => {
    setPopup(null);
    setTab("folder");
    setOpenFolderKey(folderKey);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-navy-700/70 bg-navy-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <PolresLogo className="h-10 w-32" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-tight text-white">
                  SIPLAP
                </span>
                <span className="status-live hidden sm:inline-flex">
                  Live ops
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Pusat kendali{" "}
                {session.role === "pimpinan" ? "pimpinan" : "admin"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationButton session={session} />
            <div className="hidden text-right sm:block">
              <div className="text-xs text-slate-500">Masuk sebagai</div>
              <div className="text-sm font-semibold text-slate-200">
                {session.nama}
              </div>
            </div>
            <button
              onClick={onLogout}
              className="rounded-xl border border-navy-700 px-3 py-2 text-sm text-slate-400 transition hover:border-red-400/40 hover:text-red-300"
            >
              Keluar
            </button>
          </div>
        </div>
        <nav className="mx-auto mt-4 flex max-w-6xl gap-2">
          {(
            [
              ["folder", "📁 Folder"],
              ["monitoring", "📡 Monitoring"],
              ...(session.role === "admin"
                ? ([["struktur", "🏢 Struktur"]] as Array<[Tab, string]>)
                : []),
              ["laporan", "📄 Laporan"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                "rounded-xl border px-4 py-2 text-sm font-semibold transition " +
                (tab === key
                  ? "bg-gold-400 text-navy-900"
                  : "text-slate-400 hover:text-white")
              }
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="safe-bottom mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {tab === "folder" ? (
          <FolderScreen
            session={session}
            refreshKey={refreshKey}
            openFolderKey={openFolderKey}
            onOpenHandled={() => setOpenFolderKey(null)}
          />
        ) : tab === "monitoring" ? (
          <MonitoringScreen />
        ) : tab === "struktur" && session.role === "admin" ? (
          <OrganizationScreen />
        ) : (
          <ReportScreen />
        )}
      </main>

      <ReportPopup
        popup={popup}
        onOpen={handleOpenFromPopup}
        onClose={() => setPopup(null)}
      />
    </div>
  );
}
