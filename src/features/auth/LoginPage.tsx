import { useState } from "react";
import PolresLogo from "../../components/PolresLogo";

interface Props {
  onLoginRegu: (kode: string, pin: string) => Promise<void>;
  onLoginAdmin: (email: string, password: string) => Promise<void>;
}

type Tab = "regu" | "admin";

/** Ilustrasi hero: kartu laporan mengambang di atas gelombang, foto giat di layar. */
function LoginHero() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      {/* Glow latar */}
      <div className="absolute left-1/2 top-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-400/10 blur-3xl" />
      <div className="absolute -right-6 -top-6 -z-10 h-40 w-40 rounded-full bg-navy-500/20 blur-2xl" />

      {/* Kartu utama: preview laporan */}
      <div className="anim-float relative mx-auto w-64 rotate-[-4deg] rounded-3xl border border-navy-600/70 bg-gradient-to-b from-navy-800 to-navy-900 p-4 shadow-2xl shadow-navy-950/80">
        {/* Header kartu */}
        <div className="mb-3 flex min-w-0 items-center gap-2">
          <PolresLogo className="h-9 w-28 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-wide text-white">
              SALAM PRESISI
            </div>
            <div className="text-[9px] text-slate-400">
              Laporan Giat Pelapor 05
            </div>
          </div>
          <span className="anim-pulse-dot ml-auto inline-block h-2 w-2 rounded-full bg-emerald-400" />
        </div>

        {/* "Foto" giat: ilustrasi petugas di lapangan */}
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-sky-700 via-navy-600 to-navy-800">
          {/* Langit + matahari */}
          <div className="absolute right-4 top-3 h-8 w-8 rounded-full bg-gold-400/90 blur-[1px]" />
          {/* Awan */}
          <div className="absolute left-5 top-5 h-2.5 w-14 rounded-full bg-white/25" />
          <div className="absolute left-10 top-9 h-2 w-10 rounded-full bg-white/15" />
          {/* Jalan */}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-slate-500 to-slate-600" />
          <div className="absolute bottom-8 left-1/2 h-1 w-10 -translate-x-1/2 rotate-90 bg-white/30" />
          {/* Petugas melambai (ilustrasi sederhana) */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <div className="mx-auto h-7 w-7 rounded-full bg-slate-200" />
            <div className="mx-auto mt-0.5 h-10 w-9 rounded-t-xl bg-navy-900" />
            <div className="absolute -top-3 left-8 h-8 w-1.5 rotate-[30deg] rounded-full bg-slate-200" />
          </div>
          {/* Watermark GPS */}
          <div className="absolute inset-x-2 bottom-2 rounded-lg bg-black/55 px-2 py-1 font-mono text-[8px] leading-tight text-white">
            📍 -6.91472, 107.38041 · 14:02 WIB · SALAM PRESISI
          </div>
        </div>

        <div className="mt-3 text-right text-[9px] text-slate-400">
          Pelaporan tersedia 24 jam
        </div>
      </div>

      {/* Kartu sekunder: statistik */}
      <div className="anim-float-soft absolute -left-2 top-10 w-36 rotate-[5deg] rounded-2xl border border-navy-600/70 bg-navy-800/95 p-3 shadow-xl backdrop-blur sm:-left-8">
        <div className="text-[10px] text-slate-400">Pelapor hari ini</div>
        <div className="text-xl font-bold text-gold-400">24 jam</div>
      </div>

      {/* Kartu sekunder: push notification */}
      <div
        className="anim-float-soft absolute -right-1 bottom-8 w-40 rotate-[-3deg] rounded-2xl border border-navy-600/70 bg-navy-800/95 p-3 shadow-xl backdrop-blur sm:-right-6"
        style={{ animationDelay: "1.2s" }}
      >
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-white">
          🔔 Notifikasi
        </div>
        <div className="mt-1 text-[9px] leading-snug text-slate-400">
          Laporan baru langsung diberitahukan ke pemantau.
        </div>
      </div>

      {/* Gelombang bawah */}
      <div className="pointer-events-none absolute -bottom-2 left-0 h-10 w-[200%] overflow-hidden">
        <svg
          viewBox="0 0 1200 40"
          preserveAspectRatio="none"
          className="wave-drift h-full w-full"
        >
          <path
            d="M0 20 Q 75 0 150 20 T 300 20 T 450 20 T 600 20 T 750 20 T 900 20 T 1050 20 T 1200 20 V40 H0 Z"
            fill="rgba(245,185,66,0.18)"
          />
        </svg>
      </div>
    </div>
  );
}

/** Halaman login dua kolom: kiri hero animatif, kanan form. Mobile: hero di atas. */
export default function LoginPage({ onLoginRegu, onLoginAdmin }: Props) {
  const [tab, setTab] = useState<Tab>("regu");
  const [kode, setKode] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "regu") await onLoginRegu(kode.trim(), pin);
      else await onLoginAdmin(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-navy-950">
      {/* Dekorasi latar: glow & grid halus */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-navy-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-gold-400/5 blur-3xl" />

      <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-2 lg:gap-6 lg:py-0">
        {/* Kolom kiri: hero animatif */}
        <div className="anim-rise order-1 hidden lg:order-none lg:block">
          <div className="-mt-8 mb-8 flex items-center gap-4">
            <PolresLogo className="h-24 w-80 shrink-0 drop-shadow-lg" />
            <div className="min-w-0">
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                SALAM PRESISI
              </h1>
              <p className="max-w-sm text-sm leading-relaxed text-slate-400">
                Sistem Informasi Pelaporan Giat Lapangan
              </p>
            </div>
          </div>
          <LoginHero />
        </div>

        {/* Kolom kanan: form login */}
        <div className="anim-rise order-2 mx-auto w-full max-w-sm lg:order-none">
          {/* Logo versi mobile */}
          <div className="mb-8 text-center lg:hidden">
            <PolresLogo className="anim-float-soft mx-auto mb-3 h-32 w-96 drop-shadow-lg" />
            <h1 className="text-2xl font-extrabold tracking-tight">
              SALAM PRESISI
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Sistem Informasi Pelaporan Giat Lapangan Polres
            </p>
          </div>

          <div className="card">
            {/* Tab switcher */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-navy-900 p-1">
              {(["regu", "admin"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t);
                    setError(null);
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    tab === t
                      ? "bg-gold-400 text-navy-900"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {t === "regu" ? "👤 Pelapor" : "🛡️ Pemantau"}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-4">
              {tab === "regu" ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">
                      Kode Pelapor
                    </label>
                    <input
                      className="input"
                      placeholder="Contoh: reskrim.banit03"
                      value={kode}
                      onChange={(e) => setKode(e.target.value)}
                      autoCapitalize="characters"
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">
                      Password
                    </label>
                    <input
                      className="input"
                      type="password"
                      inputMode="text"
                      placeholder="Password pelapor"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">
                      Username pemantau
                    </label>
                    <input
                      className="input"
                      type="text"
                      placeholder="Contoh: reskrim.kasat"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">
                      Password
                    </label>
                    <input
                      className="input"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </>
              )}

              {error && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary w-full py-3.5"
                disabled={busy}
              >
                {busy ? "Memproses…" : "Masuk"}
              </button>
            </form>
          </div>

          <div className="mt-6 rounded-2xl border border-navy-600/60 bg-navy-800/50 px-4 py-3">
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-300">
              <span aria-hidden>📱</span>
              <span>
                <b className="font-semibold text-white">
                  Satu smartphone = satu akun.
                </b>{" "}
                Sesi login tersimpan permanen di perangkat ini.
              </span>
            </p>
            <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-slate-300">
              <span aria-hidden>📲</span>
              <span>
                <b className="font-semibold text-white">
                  Pelapor wajib pasang ke homescreen
                </b>{" "}
                agar notifikasi &amp; kirim laporan otomatis saat online
                berjalan optimal.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
