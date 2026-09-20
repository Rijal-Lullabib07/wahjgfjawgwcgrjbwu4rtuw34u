import PolresLogo from "../../components/PolresLogo";

/**
 * Splash screen animatif: logo Polres dengan ring pulse & shine, judul rise,
 * progress bar gold. Dipakai saat app boot (App.tsx "booting").
 */
export default function SplashScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-navy-950 px-6">
      <div className="flex flex-col items-center">
        {/* Logo + ring pulse + shine */}
        <div className="relative flex h-28 w-28 items-center justify-center">
          <span className="splash-ring absolute inset-0 rounded-[2rem] border-2 border-gold-400/60" />
          <span className="splash-ring-delay absolute inset-0 rounded-[2rem] border-2 border-gold-400/40" />
          <div className="splash-logo relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[1.6rem] bg-gradient-to-br from-navy-600 to-navy-800 shadow-2xl shadow-navy-900/80 ring-1 ring-navy-500/50">
            {/* shine menyapu diagonal */}
            <span className="splash-shine absolute -inset-y-4 left-0 w-10 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            <PolresLogo className="h-16 w-44 drop-shadow-lg" />
          </div>
        </div>

        {/* Judul */}
        <h1 className="splash-title mt-7 text-2xl font-bold tracking-[0.28em] text-white sm:text-3xl">
          SALAM PRESISI
        </h1>
        <p className="splash-sub mt-2 max-w-xs text-center text-xs leading-relaxed text-slate-400">
          Pelaporan Giat
          <br />
          Lapangan Polres
        </p>

        {/* Progress bar */}
        <div className="splash-footer mt-9 h-1 w-44 overflow-hidden rounded-full bg-navy-700/70">
          <div className="splash-bar h-full w-1/4 rounded-full bg-gradient-to-r from-gold-500 to-gold-400" />
        </div>
      </div>

      <p className="splash-footer absolute bottom-8 text-[10px] uppercase tracking-widest text-slate-600">
        Presisi · Responsif · Lapor Cepat
      </p>
    </div>
  );
}
