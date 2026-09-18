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
- **Reminder notifikasi Web Push (VAPID)** 15 menit sebelum siklus berakhir — tetap sampai walau app
ditutup; reminder lokal dipakai sebagai cadangan bila push tidak tersedia
- **RLS Supabase**: regu hanya akses laporan miliknya; admin baca semua

## Setup Supabase

1. Buat project di [supabase.com](https://supabase.com). Catat **Project URL** & **anon key**
   (Settings → API).
2. Salin `.env.example` → `.env`:
   ```env
   VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<ANON_KEY>
   VITE_VAPID_PUBLIC_KEY=<VAPID_PUBLIC_KEY>   # didapat di langkah 8
   ```
3. **SQL Editor** → jalankan seluruh isi `supabase/migrations/0001_init.sql`
   (tabel, index, storage bucket, RLS, realtime — idempoten, aman diulang).
4. **SQL Editor** → jalankan `supabase/migrations/0002_seed.sql`
   (15 akun regu `REGU01`–`REGU15` + 1 admin, password default tercantum di file — ganti!).
5. **SQL Editor** → jalankan `supabase/migrations/0003_reminder_logs.sql`
   (log agar satu regu hanya menerima satu reminder per siklus).
6. **SQL Editor** → jalankan `supabase/migrations/0004_push_claim.sql`
   (fungsi `claim_push_subscription` — device boleh pindah regu).
7. Cek login: `REGU01` / `siplap2026`, admin `admin@satpolpp.go.id` / `admin2026`.

## 8. Aktifkan notifikasi pengingat (Web Push VAPID)

Reminder dikirim oleh Edge Function `reminder-push` yang dipicu pg_cron tiap 5 menit,
**bukan** oleh halaman — jadi tetap masuk saat app tertutup / HP di kantong.

**a. Generate kunci VAPID** (sekali saja, simpan hasilnya)
```bash
npx web-push generate-vapid-keys
```

**b. Isi kunci PUBLIK di `.env`**, lalu restart `npm run dev` / build ulang:
```env
VITE_VAPID_PUBLIC_KEY=<Public Key>
```

**c. Set secret Edge Function** (kunci PRIVAT hanya di server, jangan pernah di frontend):
```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="<Public Key>" \
  VAPID_PRIVATE_KEY="<Private Key>" \
  VAPID_SUBJECT="mailto:admin@satpolpp.go.id" \
  CRON_SECRET="<string pendek pilihan sendiri, mis. satpolpp-cron-9f3k2m7q>"
```
`CRON_SECRET` dipakai pg_cron sebagai tanda pengenal, dikirim lewat header **`x-cron-secret`**
(sengaja bukan `Authorization`, agar tidak terkena pemeriksaan JWT bawaan platform). Jadi tidak
perlu menempel `service_role` key yang panjang ke dalam SQL — sumber 401 yang paling sering
terjadi. Bebas diganti kapan saja, cukup ubah secret + jadwal cron-nya.

**d. Deploy Edge Function dengan pemeriksaan JWT bawaan DIMATIKAN**
```bash
supabase functions deploy reminder-push --no-verify-jwt
```
Alasan: pg_cron tidak membawa JWT user, dan pemeriksaan bawaan platform hanya mengerti format
kunci lama — kalau dibiarkan aktif, request ditolak sebelum kode kita jalan (gejala: pesan
`{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}` atau `Invalid API key`).
Supabase sendiri kini merekomendasikan mematikannya dan mengatur autentikasi di dalam function.
Kalau deploy lewat Dashboard: buka function → **Settings** → matikan **Verify JWT**.
Sebagai gantinya, function memverifikasi sendiri header `x-cron-secret`.

**e. Aktifkan ekstensi** — Dashboard → Database → Extensions → aktifkan **`pg_cron`** dan **`pg_net`**.

**f. Jadwalkan cron** di SQL Editor (ganti `<PROJECT_REF>` dan `<SERVICE_ROLE_KEY>`):
```sql
select cron.unschedule('siplap-reminder') where exists (
  select 1 from cron.job where jobname = 'siplap-reminder'
);

select cron.schedule(
  'siplap-reminder',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/reminder-push',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret','<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**g. Uji end-to-end** — buka app sebagai regu, login, klik **"Aktifkan"** pada banner
notifikasi (browser minta izin), lalu dari terminal:
```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/reminder-push" \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"test":true}'
```
Respons `{"ok":true,...,"results":[{"regu":"Regu 1","foto":0,"sent":1}]}` = notifikasi
benar-benar terkirim ke device. `"sent":0` berarti belum ada device yang mendaftar →
cek isi tabel `push_subscriptions`.

**h. Verifikasi cron** yang sedang berjalan:
```sql
select jobname, schedule, active from cron.job;
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select * from public.reminder_logs order by sent_at desc limit 10;
```

### Catatan penting

- **Reminder hanya dikirim di 15 menit terakhir siklus.** Di luar window itu responsnya
  `{"skipped":true}` — itu normal, bukan error.
- **iOS** wajib 16.4+ dan app harus **dipasang ke home screen** (Share → Add to Home Screen)
  baru Web Push bisa masuk. Di Safari biasa, notifikasi tidak akan sampai.
- `VITE_VAPID_PUBLIC_KEY` hanya boleh berisi **Public Key**. Kalau tertukar dengan Private Key,
  `pushManager.subscribe()` akan gagal.
- Bila push gagal didaftarkan, app otomatis memakai **reminder lokal** (`src/lib/push/localReminder.ts`)
  yang hanya bunyi selama app hidup. Keduanya memakai tag `siplap-reminder` yang sama,
  jadi tidak akan muncul dua notifikasi untuk siklus yang sama.

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
src/lib/push                   → Web Push VAPID + reminder lokal (cadangan)
supabase/migrations            → 0001 skema+RLS, 0002 seed akun
supabase/functions             → Edge Functions (reminder-push, archive-photos)
```

## Keamanan

- Hanya `anon key` di frontend — semua akses dijaga **Row Level Security**.
- `service_role key` hanya di Edge Functions / pg_cron (server-side), tidak pernah di frontend.
- Kamera hanya live capture; tidak ada jalur upload galeri.
- Password regu tersimpan ter-hash (bcrypt) di Supabase Auth.
