# SIPLAP — Sistem Informasi Pelaporan Giat Lapangan (Satpol PP)

PWA pelaporan kegiatan lapangan berbasis foto untuk Satuan Polisi Pamong Praja.
15 regu mengirim 2 foto per siklus (12 siklus × 2 jam/hari) dengan watermark GPS &
waktu. Admin memantau secara real-time dan menarik rekap laporan (PDF/Excel).

## Fitur

- **Kamera live capture** (getUserMedia, tanpa upload galeri) + watermark GPS & waktu via `<canvas>`
- **Offline-first**: foto & metadata tersimpan di IndexedDB, auto-sync ke Supabase saat online
  (Background Sync API di Android, retry-on-foreground di iOS)
- **Realtime dashboard** admin: status 15 regu per siklus + feed foto terbaru
- **Generator laporan**: filter harian/mingguan/bulanan/custom, gabungan/per regu,
  export PDF (jsPDF + thumbnail) & Excel (SheetJS)
- **Push reminder** 15 menit sebelum siklus berakhir (Web Push VAPID + pg_cron + Edge Function)
- **RLS Supabase**: regu hanya akses laporan miliknya; admin baca semua

## Setup Supabase

1. Buat project di [supabase.com](https://supabase.com). Catat **Project URL** & **anon key**
   (Settings → API).
2. Salin `.env.example` → `.env`:
   ```env
   VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<ANON_KEY>
   VITE_VAPID_PUBLIC_KEY=<nanti setelah langkah 6>
   ```
3. **SQL Editor** → jalankan seluruh isi `supabase/migrations/0001_init.sql`
   (tabel, index, storage bucket, RLS, realtime — idempoten, aman diulang).
4. **SQL Editor** → jalankan `supabase/migrations/0002_seed.sql`
   (15 akun regu `REGU01`–`REGU15` + 1 admin, password default tercantum di file — ganti!).
5. **SQL Editor** → jalankan `supabase/migrations/0003_reminder_logs.sql`.
6. Cek login: `REGU01` / `siplap2026`, admin `admin@satpolpp.go.id` / `admin2026`.
7. **Push notification**:
   ```bash
   npx web-push generate-vapid-keys
   ```
   Isi `VITE_VAPID_PUBLIC_KEY` di `.env`. Simpan private key untuk langkah Edge Function.
8. **Edge Functions**:
   ```bash
   supabase functions deploy reminder-push
   supabase functions deploy archive-photos
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:admin@satpolpp.go.id
   ```
9. **Reminder otomatis (setup admin satu kali)**: aktifkan ekstensi `pg_cron` + `pg_net`
   di Dashboard → Database → Extensions, lalu jalankan blok cron dari `0001_init.sql`
   setelah mengganti `<PROJECT_REF>` dan `<SERVICE_ROLE_KEY>`. Setelah aktif, scheduler
   memanggil Edge Function tiap 5 menit. Edge Function hanya mengirim saat 15 menit terakhir
   siklus dan mencatat log agar setiap regu menerima maksimal satu reminder per siklus.

## Menjalankan

```bash
npm install
npm run dev      # development
npm run build    # produksi (ikut typecheck) → dist/
```

Deploy `dist/` ke Vercel/Netlify/Cloudflare Pages. PWA manifest & service worker
otomatis dari `vite-plugin-pwa`.

## Akun

| Role | Kredensial | Keterangan |
|------|-----------|------------|
| Regu | Kode: `REGU01`–`REGU15`, PIN: `siplap2026` | ⚠️ wajib ganti PIN |
| Admin | `admin@satpolpp.go.id` / `admin2026` | ⚠️ wajib ganti password |

## Struktur

```
src/features/regu-capture      → kamera, watermark, offline queue (sisi Regu)
src/features/admin-dashboard   → monitoring realtime (sisi Admin)
src/features/report-generator  → export PDF/Excel
src/lib/supabase               → client + adapter data
src/lib/offline-sync           → IndexedDB + sync manager
src/lib/push                   → subscription VAPID
supabase/migrations            → 0001 skema+RLS, 0002 seed akun
supabase/functions             → Edge Functions (reminder, arsip)
```

## Keamanan

- Hanya `anon key` di frontend — semua akses dijaga **Row Level Security**.
- `service_role key` hanya di Edge Functions / pg_cron (server-side), tidak pernah di frontend.
- Kamera hanya live capture; tidak ada jalur upload galeri.
- Password regu tersimpan ter-hash (bcrypt) di Supabase Auth.
