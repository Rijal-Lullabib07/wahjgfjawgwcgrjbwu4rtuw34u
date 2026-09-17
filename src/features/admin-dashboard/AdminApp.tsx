import { useState } from "react";
import type { SessionUser } from "../../types";
import MonitoringScreen from "./MonitoringScreen";
import ReportScreen from "../report-generator/ReportScreen";
import SatpolPPLogo from "../../components/SatpolPPLogo";

interface Props {
  session: SessionUser;
  onLogout: () => void;
}

type Tab = "monitoring" | "laporan";

/** Dashboard Admin/Pimpinan: monitoring realtime + generator laporan. */
export default function AdminApp({ session, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("monitoring");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-navy-700/70 bg-navy-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <SatpolPPLogo className="h-10 w-10" />
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
              ["monitoring", "📡 Monitoring"],
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
        {tab === "monitoring" ? <MonitoringScreen /> : <ReportScreen />}
      </main>
    </div>
  );
}
