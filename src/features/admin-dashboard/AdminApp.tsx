import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionUser } from "../../types";
import ManagementScreen from "./ManagementScreen";
import BerandaScreen from "./BerandaScreen";
import LaporanGiatScreen from "./LaporanGiatScreen";
import StatistikScreen from "./StatistikScreen";
import PetaScreen from "./PetaScreen";
import ReportPopup, { type ReportPopupData } from "./ReportPopup";
import { subscribeLaporan } from "../../lib/supabase/api";
import { supabase } from "../../lib/supabase/client";
import { folderKeyForRegu } from "../../lib/folders";
import { playAlertSound, vibrateDevice } from "../../lib/notify";
import PolresLogo from "../../components/PolresLogo";
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

type Tab = "beranda" | "laporan" | "statistik" | "peta" | "rekap" | "manajemen";
type DashboardTheme = "dark" | "light";

const MENU: Array<{
  key: Tab;
  icon: string;
  label: string;
  adminOnly?: boolean;
  kapolresOnly?: boolean;
}> = [
  { key: "beranda", icon: "🏠", label: "Beranda" },
  { key: "laporan", icon: "📄", label: "Laporan Giat" },
  { key: "statistik", icon: "📊", label: "Statistik" },
  { key: "peta", icon: "📍", label: "Peta Kegiatan", kapolresOnly: true },
  { key: "rekap", icon: "⬇️", label: "Rekap & Unduh" },
  { key: "manajemen", icon: "🗂️", label: "Manajemen Data", adminOnly: true },
];

/**
 * Peta Kegiatan hanya untuk Kapolres — Wakapolres, Kabag, Kasat, dan
 * Kapolsek tidak melihat fitur ini sama sekali (menu + halaman).
 * Hati-hati: "WAKAPOLRES" mengandung substring "KAPOLRES", jadi pemeriksaan
 * nama WAJIB pakai awalan + pengecualian eksplisit, bukan `includes`.
 */
function isKapolresUser(session: SessionUser): boolean {
  const uname = session.username?.toLowerCase() ?? "";
  const nama = (session.nama ?? "").toUpperCase();
  if (uname.startsWith("wakapolres") || nama.startsWith("WAKAPOLRES")) {
    return false;
  }
  return (
    uname.startsWith("kapolres.") ||
    nama.startsWith("KAPOLRES ") ||
    nama === "KAPOLRES"
  );
}
const MOBILE_MENU: Tab[] = ["beranda", "laporan", "statistik"];

/** Tombol "Aktifkan notifikasi" untuk pemantau (sekali saja, lalu aktif). */
function NotificationButton({ session }: { session: SessionUser }) {
  const [perm, setPerm] = useState(notificationPermission());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isMonitor = session.role === "admin" || session.role === "pimpinan";

  useEffect(() => {
    if (!isMonitor || perm !== "granted") return;
    void syncPushSubscription(undefined);
  }, [isMonitor, perm]);

  if (!isMonitor || perm === "granted" || perm === "unsupported") return null;

  const blocker = getPushBlocker();
  const hint = msg ?? (blocker ? describePushBlocker(blocker) : null);
  return (
    <div className="relative flex items-center">
      <button
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await enablePush(undefined);
            setPerm(notificationPermission());
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        aria-label="Aktifkan notifikasi"
        title="Aktifkan notifikasi"
        className="rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-2 text-base leading-none text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 sm:px-3"
      >
        {busy ? "⏳" : "🔔"}
      </button>
      {/* Pesan/blocker ditampilkan sebagai popover supaya tidak mendorong
          tombol lain saat layar sempit. */}
      {hint && (
        <span className="header-hint absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border px-3 py-2 text-[11px] font-medium leading-snug">
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * Dashboard pemantau: sidebar kiri (desktop) + bottom nav (HP),
 * tema terang sesuai mockup. Halaman: Beranda (summary), Laporan Giat,
 * Statistik, Peta Kegiatan, Rekap & Unduh, Manajemen Data.
 */
export default function AdminApp({ session, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("beranda");
  const [theme, setTheme] = useState<DashboardTheme>(() => {
    const saved = localStorage.getItem("siplap-admin-theme");
    return saved === "light" ? "light" : "dark";
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [popup, setPopup] = useState<ReportPopupData | null>(null);
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
    const unsubscribe = subscribeLaporan(
      () => setRefreshKey((k) => k + 1),
      (row) => void handleInsert(row),
    );

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

  const kapolres = isKapolresUser(session);
  const roleLabel = session.role === "admin" ? "Admin" : "Pimpinan";
  const menu = useMemo(
    () =>
      MENU.filter(
        (m) =>
          (!m.adminOnly || session.role === "admin") &&
          (!m.kapolresOnly || kapolres),
      ),
    [session.role, kapolres],
  );

  const openFromPopup = () => {
    setPopup(null);
    setTab("laporan");
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("siplap-admin-theme", next);
      return next;
    });
  };

  const page = (() => {
    switch (tab) {
      case "laporan":
        return <LaporanGiatScreen refreshKey={refreshKey} session={session} />;
      case "statistik":
        return <StatistikScreen refreshKey={refreshKey} session={session} />;
      case "peta":
        return kapolres ? (
          <PetaScreen refreshKey={refreshKey} session={session} />
        ) : (
          <BerandaScreen
            refreshKey={refreshKey}
            onOpenTab={setTab}
            session={session}
          />
        );
      case "rekap":
        return <RekapScreen session={session} />;
      case "manajemen":
        return session.role === "admin" ? <ManagementScreen /> : null;
      default:
        return (
          <BerandaScreen
            refreshKey={refreshKey}
            onOpenTab={setTab}
            session={session}
          />
        );
    }
  })();

  return (
    <div className={"dash dash-" + theme + " flex min-h-dvh"}>
      {/* ===== Sidebar (desktop) ===== */}
      <aside
        className={
          "fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 " +
          (sidebarOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="sidebar-logo-panel shrink-0">
            <PolresLogo className="h-11 w-32" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold leading-tight tracking-tight text-slate-900">
              POLRES PURWAKARTA
            </div>
            <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
              Sistem Pelaporan Giat
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {menu.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setTab(m.key);
                setSidebarOpen(false);
              }}
              className={
                "flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition " +
                (tab === m.key
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")
              }
            >
              <span className="text-base">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-4 py-4">
          <div className="text-xs font-semibold text-slate-700">
            {session.nama}
          </div>
          <div className="text-[11px] text-slate-500">
            {session.role === "admin" ? "Admin" : "Pimpinan"}
          </div>
          <button
            onClick={onLogout}
            className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100"
          >
            Keluar
          </button>
        </div>
      </aside>

      {/* Backdrop mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-slate-900/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ===== Konten ===== */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-72">
        <header className="safe-top sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-1.5 py-2.5 pl-3 pr-2.5 sm:gap-3 sm:px-6 sm:py-3">
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded-xl border border-slate-200 px-2 py-2 text-slate-600 lg:hidden"
                aria-label="Buka menu"
              >
                ☰
              </button>
              <div className="min-w-0">
                <div className="truncate whitespace-nowrap text-xs font-extrabold tracking-tight text-slate-900 sm:text-sm">
                  Dashboard Pemantau
                </div>
                <div className="hidden text-[11px] text-slate-500 sm:block">
                  Memantau seluruh laporan giat berdasarkan wilayah dan fungsi
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              <NotificationButton session={session} />
              {/* Chip akses: ikon + nama role (mobile) / ikon + "Akses <role>"
                  (sm ke atas) — ditulis manual tanpa class .badge karena rule
                  .dash .badge memaksa inline-flex dan menimpa utility `hidden`. */}
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-blue-50 py-1.5 pl-2 pr-2.5 text-[11px] font-semibold text-blue-700 sm:text-xs"
                title={"Akses " + roleLabel}
                aria-label={"Akses " + roleLabel}
              >
                <span aria-hidden="true">🛡️</span>
                <span className="hidden sm:inline" aria-hidden="true">
                  Akses {roleLabel}
                </span>
                <span className="sm:hidden" aria-hidden="true">
                  {roleLabel}
                </span>
              </span>
              <button
                type="button"
                onClick={toggleTheme}
                className="theme-toggle rounded-xl border border-slate-200 px-2 py-2 text-xs font-semibold transition sm:px-3"
                aria-label={
                  theme === "dark"
                    ? "Aktifkan mode terang"
                    : "Aktifkan mode gelap"
                }
                title={theme === "dark" ? "Mode terang" : "Mode gelap"}
              >
                <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
                <span className="hidden sm:inline">
                  {theme === "dark" ? "Terang" : "Gelap"}
                </span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-5">
          {/* key={tab} → tiap pindah halaman komponen remount, sehingga
              animasi rise-in terputar ulang (perpindahan terasa hidup). */}
          <div key={tab} className="anim-rise">
            {page}
          </div>
        </main>

        {/* Navigasi inti di bawah; fitur tambahan tetap tersedia melalui menu hamburger. */}
        <nav className="dash-bottom-nav safe-bottom fixed inset-x-0 bottom-0 z-10 flex overflow-x-auto border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          {menu
            .filter((m) => MOBILE_MENU.includes(m.key))
            .map((m) => (
              <button
                key={m.key}
                onClick={() => setTab(m.key)}
                className={
                  "flex min-h-14 min-w-[76px] shrink-0 flex-col items-center justify-center gap-0.5 px-1.5 py-1.5 text-[10px] font-semibold transition " +
                  (tab === m.key ? "text-blue-600" : "text-slate-500")
                }
              >
                <span className="text-lg leading-none">{m.icon}</span>
                <span className="whitespace-nowrap px-0.5">{m.label}</span>
              </button>
            ))}
        </nav>
      </div>

      <ReportPopup
        popup={popup}
        onOpen={openFromPopup}
        onClose={() => setPopup(null)}
      />
    </div>
  );
}

/** Rekap & Unduh — alias ringkas dari generator laporan (PDF/Excel). */
function RekapScreen({ session }: { session: SessionUser }) {
  return <LaporanGiatScreen refreshKey={0} rekapMode session={session} />;
}
