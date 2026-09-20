import { isIOS, useIsStandalone } from '../../lib/session';

interface Props {
  children: React.ReactNode;
}

/**
 * Gate khusus iOS: push notification hanya berjalan bila PWA sudah di
 * "Add to Home Screen" (iOS 16.4+). Di iOS, tampilkan panduan instalasi
 * dan blokir akses sampai user meng-install. Non-iOS langsung lolos.
 */
export default function InstallGate({ children }: Props) {
  const standalone = useIsStandalone();
  const ios = isIOS();

  if (!ios || standalone) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <div className="card text-center">
        <div className="mb-4 text-5xl">📲</div>
        <h1 className="text-xl font-bold">Pasang SALAM PRESISI ke Homescreen</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Untuk iPhone/iPad, notifikasi pengingat laporan <b>hanya berjalan</b> jika
          aplikasi sudah dipasang ke homescreen.
        </p>
        <ol className="mt-5 space-y-3 text-left text-sm text-slate-300">
          <li className="flex gap-3">
            <span className="badge bg-gold-400/20 text-gold-400">1</span>
            Buka menu <b>Share</b> ⬆️ di Safari
          </li>
          <li className="flex gap-3">
            <span className="badge bg-gold-400/20 text-gold-400">2</span>
            Pilih <b>Add to Home Screen</b>
          </li>
          <li className="flex gap-3">
            <span className="badge bg-gold-400/20 text-gold-400">3</span>
            Buka SALAM PRESISI dari ikon di homescreen, lalu login kembali
          </li>
        </ol>
      </div>
    </div>
  );
}
