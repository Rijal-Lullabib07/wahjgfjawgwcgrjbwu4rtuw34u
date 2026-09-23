import { useEffect, useState } from "react";
import { isIOS, isStandaloneNow } from "../../lib/session";
import { useInstallPrompt } from "../../lib/push/installPrompt";

function Icon({ name, size = 20 }: { name: "user" | "lock" | "eye" | "eyeOff" | "wifi" | "download"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.5 3.1-5.5 7-5.5s6.2 2 7 5.5" /></svg>;
  if (name === "lock") return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === "eyeOff") return <svg {...common}><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c5.5 0 9 7 9 7a17 17 0 0 1-3 3.8M6.2 6.3C3.9 8.1 3 12 3 12s3.5 7 9 7c1 0 2-.2 2.8-.5" /></svg>;
  if (name === "eye") return <svg {...common}><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  if (name === "download") return <svg {...common}><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 20h14" /></svg>;
  return <svg {...common}><path d="M5 18a4 4 0 0 1 .9-7.9A6.5 6.5 0 0 1 18.5 8a4 4 0 0 1 .5 8H5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>;
}

export function RoleTabs({ value, onChange }: { value: "regu" | "admin"; onChange: (value: "regu" | "admin") => void }) {
  return (
    <div className="login-role-tabs" role="tablist" aria-label="Pilih jenis akses">
      <span className={`login-role-indicator ${value === "admin" ? "login-role-indicator-admin" : ""}`} aria-hidden />
      {(["regu", "admin"] as const).map((role) => (
        <button key={role} type="button" role="tab" aria-selected={value === role} className="login-role-tab" onClick={() => onChange(role)}>
          <span aria-hidden>{role === "regu" ? "♟" : "◈"}</span>
          {role === "regu" ? "Lapor" : "Pantau"}
        </button>
      ))}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, visible, onToggle, label }: { id: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void; label: string }) {
  return (
    <div className="login-field">
      <label htmlFor={id}>{label}</label>
      <div className="login-input-wrap">
        <span className="login-input-icon"><Icon name="lock" /></span>
        <input id={id} className="login-input login-input-password" type={visible ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="current-password" required />
        <button type="button" className="login-eye-button" onClick={onToggle} aria-label={visible ? "Sembunyikan password" : "Tampilkan password"} aria-pressed={visible}>
          <Icon name={visible ? "eyeOff" : "eye"} size={19} />
        </button>
      </div>
    </div>
  );
}

export function ConnectionBadge({ online }: { online: boolean }) {
  return <div className={`login-connection ${online ? "login-connection-online" : "login-connection-offline"}`} role="status"><Icon name="wifi" size={15} /><span>{online ? "Online" : "Offline"}</span></div>;
}

export function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [standalone, setStandalone] = useState(isStandaloneNow);
  const [closed, setClosed] = useState(() => sessionStorage.getItem("jawara-install-dismissed") === "1");
  const ios = isIOS();

  useEffect(() => {
    const update = () => setStandalone(isStandaloneNow());
    window.addEventListener("appinstalled", update);
    return () => window.removeEventListener("appinstalled", update);
  }, []);

  if (standalone || closed) return null;
  return (
    <aside className="login-install-banner" aria-label="Pasang aplikasi JAWARA">
      <div className="login-install-icon"><Icon name="download" size={20} /></div>
      <div className="min-w-0 flex-1">
        <strong>Pasang JAWARA di layar utama</strong>
        <p>{ios ? "Safari: tekan Bagikan, lalu Tambah ke Layar Utama." : "Akses lebih cepat dan tetap siap digunakan di lapangan."}</p>
      </div>
      {canInstall && !ios ? <button type="button" onClick={() => void promptInstall()} className="login-install-button">Pasang</button> : <span className="login-install-hint">{ios ? "Bagikan ↑" : "Menu ⋮"}</span>}
      <button type="button" className="login-install-close" onClick={() => { sessionStorage.setItem("jawara-install-dismissed", "1"); setClosed(true); }} aria-label="Tutup pengingat instalasi">×</button>
    </aside>
  );
}
