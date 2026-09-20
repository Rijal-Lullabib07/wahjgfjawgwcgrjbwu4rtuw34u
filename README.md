# SIPLAP — Sistem Informasi Pelaporan Giat Lapangan Polres

PWA pelaporan kegiatan lapangan berbasis foto/video untuk Polres Purwakarta.
Pelapor mengirim laporan (maks 4 foto + 1 video) dengan watermark GPS & waktu;
pemantau memantau lewat **tab 📁 Folder** (Polsek → unit → laporan) dan menerima
**popup + notifikasi push** setiap laporan baru masuk dalam cakupannya.

## Fitur

- **Kamera live capture** (getUserMedia, tanpa upload galeri) + watermark GPS & waktu via `<canvas>`
- **Offline-first**: foto & metadata tersimpan di IndexedDB, auto-sync ke Supabase saat online
- **Folder pemantau**: tab 📁 Folder = halaman utama. Tiap folder menampilkan
  jumlah laporan hari ini, waktu laporan terakhir, dan badge merah **"N baru"**
  yang hilang saat folder dibuka. Tampilan mengikuti hak akses (RLS).
- **Popup laporan baru**: bunyi + getar + tombol **"Buka laporan"** yang langsung
  membuka folder yang benar — hanya untuk laporan dalam cakupan pemantau.
- **Web Push (notify-laporan)**: kalau app ditutup, notifikasi sistem tetap
  masuk; klik notifikasi membuka folder laporan tersebut. Kalau app sedang
  terbuka, notifikasi sistem **ditahan** agar tidak dobel dengan popup.
- **Generator laporan**: export PDF (jsPDF + thumbnail) & Excel (SheetJS)
- **RLS Supabase**: pelapor hanya akses laporan miliknya; pemantau sesuai cakupan

## Struktur akun (146 total)

| Kelompok | Jumlah | Cakupan |
| --- | --- | --- |
| Kapolres | 1 | Pemantau + kelola (semua folder) |
| Wakapolres | 1 | Read-only (semua folder) |
| Admin Utama | 1 | Kelola (akun terpisah) |
| Kasat (fungsi) | 10 | Satuannya di Polres + folder unit yang sama di tiap Polsek |
| Kapolsek (wilayah) | 14 | Langsung masuk folder Polseknya |
| Pelapor level 2 | 9 | Satu akun per satuan Polres (`reskrim.polres`, dst.) |
| Pelapor level 1 | 96 | Akun unit di Polsek (`reskrim.jatiluhur`, dst.) |
| SPKT | 14 | Satu akun per Polsek (`spkt.jatiluhur`, dst.) |

Akun lama (format `.pelapor01`–`.pelapor73` dst.) **tidak dibuat** di project
baru. Skema tetap mendukung arsip lewat kolom `regu.is_legacy`: bila kelak data
lama diimpor, laporannya tampil di folder satuan masing-masing dan di folder
**"Arsip akun lama"** di Polsek masing-masing.

## Setup Supabase (PROJECT BARU)

1. Buat project di [supabase.com](https://supabase.com). Catat **Project URL** &
   **anon key** (Settings → API).
2. Salin `.env.example` → `.env`:
   ```env
   VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<ANON_KEY>
   VITE_VAPID_PUBLIC_KEY=<VAPID_PUBLIC_KEY>   # didapat di langkah 5
   ```
3. **SQL Editor** → jalankan **seluruh isi `supabase/db_supabase.sql`**.
   Satu file ini berisi: tabel + index, helper & RLS scope-aware, storage
   bucket `laporan-foto`, realtime, RPC folder (`folder_overview`,
   `folder_laporan`, `mark_folder_read`), dan **seed 146 akun** (metadata saja,
   tanpa password). Idempoten — aman dijalankan ulang.
   > Folder `supabase/migrations/` adalah riwayat project lama; untuk project
   > baru cukup `db_supabase.sql`.
4. **Provision akun Auth** (membuat password):
   ```powershell
   # .env.provision.local: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
   npm run provision:jawara
   ```
   Script membuat **146 akun** dengan password pola **KATA-ANGKA-KATA**
   (contoh: `Mangga-7429-Roti`) — tidak terlalu gampang ditebak, tidak terlalu
   susah diketik di HP. Hasilnya ditulis ke `jawara-credentials-latest.csv`
   dan `pw.md` (keduanya sudah di `.gitignore`). Bagikan lewat kanal aman lalu
   **hapus kedua file**.

## Notifikasi laporan baru (popup + Web Push)

Popup di app langsung jalan setelah login pemantau. **Push** perlu setup sekali:

**a. Generate kunci VAPID** (sekali saja, simpan hasilnya):

```bash
npx web-push generate-vapid-keys
```

**b. Isi kunci PUBLIK di `.env`** (`VITE_VAPID_PUBLIC_KEY`), lalu build ulang.

**c. Set secret Edge Function** (kunci privat hanya di server):

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="<Public Key>" \
  VAPID_PRIVATE_KEY="<Private Key>" \
  VAPID_SUBJECT="mailto:admin@polres.go.id" \
  NOTIFY_SECRET="<string acak pilihan sendiri>"
```

**d. Deploy function** (pemeriksaan JWT dimatikan; function memverifikasi
sendiri header `x-notify-secret`):

```bash
supabase functions deploy notify-laporan --no-verify-jwt
```

**e. Buat Database Webhook** — Dashboard → **Database → Webhooks → Create**:

- Name: `siplap-laporan` · Table: `laporan` · Events: **INSERT**
- Method: `POST` · URL:
  `https://<PROJECT_REF>.supabase.co/functions/v1/notify-laporan`
- HTTP Headers (section **HTTP Headers**): tambahkan
  `x-notify-secret` = `<NOTIFY_SECRET>`

Function menerima `x-notify-secret` **atau** `Authorization: Bearer <kunci>`,
jadi salah satu saja cukup.

**f. Aktifkan per pemantau** — tiap pemantau menekan tombol
**"🔔 Aktifkan notifikasi"** sekali (izin browser). **iPhone wajib dipasang ke
Home Screen dulu** (Share → Add to Home Screen); Web Push tidak jalan di
Safari biasa.

**g. Uji end-to-end** — login sebagai pelapor dalam cakupan, kirim laporan:

- App pemantau **terbuka** → popup muncul (bunyi + getar) + tombol
  **"Buka laporan"**; notifikasi sistem ditahan (tidak dobel).
- App **ditutup** → notifikasi sistem masuk; klik → app terbuka langsung di
  folder laporan tersebut.

Respons function saat webhook terpicu:
`{"ok":true,"laporanId":"…","folderKey":"unit:jatiluhur:reskrim","sent":2,…}`.
`sent:0` berarti belum ada device pemantau dalam cakupan yang menekan
"Aktifkan notifikasi".

> Function `reminder-push` (pengingat siklus) tetap ada tapi dinonaktifkan
> karena pelaporan tersedia 24 jam — tidak perlu di-deploy untuk project baru.

## Menjalankan

```bash
npm install
npm run dev      # development
npm run build    # produksi (ikut typecheck) → dist/
```

Deploy `dist/` ke Vercel/Netlify/Cloudflare Pages. PWA manifest & service
worker otomatis dari `vite-plugin-pwa`.

## Folder pemantau (cara kerja singkat)

- **Kapolres / Wakapolres / Admin**: dua tingkat — **Polsek → unit → laporan**
  dan **Satuan Polres → laporan**.
- **Kapolsek**: langsung masuk ke folder Polseknya (semua unit + SPKT).
- **Kasat (mis. Kasat Intel)**: melihat folder **Satintelkam** dan folder
  **Intelkam** di tiap Polsek — tanpa unit lain.
- Badge **"N baru"** = laporan yang masuk sejak folder terakhir dibuka
  (tabel `folder_reads`); hilang saat folder dibuka/expand.
- Semua angka dihitung server-side oleh RPC `folder_overview()` sesuai
  hak akses; RLS tetap menjaga isi laporan.

## Struktur

```
src/features/regu-capture      → kamera, watermark, offline queue (sisi pelapor)
src/features/admin-dashboard   → FolderScreen (tab utama), monitoring realtime, popup
src/features/report-generator  → export PDF/Excel
src/lib/folders.ts             → RPC folder (overview, isi, mark read)
src/lib/notify.ts              → bunyi + getar popup
src/lib/push                   → Web Push VAPID (subscribe, vapid, localReminder)
src/lib/supabase               → client + adapter data
supabase/db_supabase.sql       → skema lengkap + seed 146 akun (project baru)
supabase/functions             → notify-laporan, reminder-push, archive-photos, generate-report
scripts/provision-jawara-accounts.mjs → buat akun Auth + password
```

## Keamanan

- Hanya `anon key` di frontend — semua akses dijaga **Row Level Security**.
- `service_role key` hanya di Edge Functions / provisioning (server-side),
  tidak pernah di frontend.
- Kamera hanya live capture; tidak ada jalur upload galeri.
- Password tersimpan ter-hash di Supabase Auth; file kredensial dihapus setelah
  dibagikan.
