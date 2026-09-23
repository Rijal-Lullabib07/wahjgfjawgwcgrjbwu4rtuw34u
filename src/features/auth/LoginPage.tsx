import { useEffect, useRef, useState } from "react";
import PolresLogo from "../../components/PolresLogo";
import { ConnectionBadge, InstallBanner, PasswordInput, RoleTabs } from "./LoginParts";

interface Props {
  onLoginRegu: (kode: string, pin: string) => Promise<void>;
  onLoginAdmin: (email: string, password: string) => Promise<void>;
}
type Tab = "regu" | "admin";

export default function LoginPage({ onLoginRegu, onLoginAdmin }: Props) {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("jawara-login-tab") as Tab) || "regu");
  const [kode, setKode] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [failures, setFailures] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const usernameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    usernameRef.current?.focus();
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const changeTab = (next: Tab) => {
    setTab(next);
    localStorage.setItem("jawara-login-tab", next);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !online || cooldown > 0) return;
    setError(null);
    setBusy(true);
    try {
      if (tab === "regu") await onLoginRegu(kode.trim(), pin);
      else await onLoginAdmin(email.trim(), password);
      setFailures(0);
    } catch {
      const nextFailures = failures + 1;
      setFailures(nextFailures);
      if (nextFailures >= 3) setCooldown(Math.min(30, 5 * (nextFailures - 2)));
      setError("Username atau password salah. Periksa kembali lalu coba lagi.");
      window.setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  const currentUsername = tab === "regu" ? kode : email;
  const setUsername = tab === "regu" ? setKode : setEmail;
  return (
    <main className="login-page min-h-dvh">
      <div className="login-shell">
        <section className="login-brand-panel" aria-labelledby="login-title">
          <div className="login-logo-stage">
            <span className="login-logo-aura" aria-hidden />
            <span className="login-logo-shine" aria-hidden />
            <PolresLogo className="login-brand-logo" />
          </div>
          <p className="login-kicker">SISTEM INTEGRASI PELAPORAN</p>
          <h1 id="login-title">Polres Purwakarta</h1>
          <p className="login-brand-copy">Pelaporan giat lapangan yang cepat, presisi, dan terhubung.</p>
        </section>

        <section className="login-card-column">
          <div className="login-card login-form-card">
            <div className="login-card-heading"><div><h2>Masuk ke JAWARA</h2><p>Pilih akses dan masukkan akun Anda.</p></div><ConnectionBadge online={online} /></div>
            <RoleTabs value={tab} onChange={changeTab} />
            <form onSubmit={submit} className="login-form" noValidate>
              <div className="login-field">
                <label htmlFor="login-username">{tab === "regu" ? "Username pelapor" : "Username pemantau"}</label>
                <div className="login-input-wrap"><span className="login-input-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.5 3.1-5.5 7-5.5s6.2 2 7 5.5" /></svg></span><input ref={usernameRef} id="login-username" className="login-input" value={currentUsername} onChange={(e) => setUsername(e.target.value)} placeholder={tab === "regu" ? "Contoh: unit.reskrim" : "Contoh: kasat.reskrim"} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></div>
              </div>
              <PasswordInput id="login-password" label="Password" value={tab === "regu" ? pin : password} onChange={tab === "regu" ? setPin : setPassword} visible={tab === "regu" ? showPin : showPassword} onToggle={() => tab === "regu" ? setShowPin((v) => !v) : setShowPassword((v) => !v)} />
              {error && <div ref={errorRef} className="login-error" tabIndex={-1} role="alert" aria-live="polite">{error}</div>}
              {!online && <div className="login-offline-message" role="status">Koneksi offline. Sambungkan internet untuk masuk.</div>}
              <button type="submit" className="login-submit-button" disabled={busy || !online || cooldown > 0 || !currentUsername.trim() || !(tab === "regu" ? pin : password)}>{busy ? <><span className="login-spinner" /> Memverifikasi...</> : cooldown > 0 ? `Coba lagi dalam ${cooldown} dtk` : "Masuk"}</button>
            </form>
            <InstallBanner />
          </div>
          <footer className="login-footer">v2026.09.23 · Polres Purwakarta</footer>
        </section>
      </div>
    </main>
  );
}
