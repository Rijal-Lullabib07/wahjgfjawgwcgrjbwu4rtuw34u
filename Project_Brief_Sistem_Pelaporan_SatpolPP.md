# PROJECT BRIEF: Sistem Informasi Pelaporan Giat Lapangan (Satpol PP)

## 1. Konteks & Tujuan
Bangun sistem pelaporan kegiatan lapangan berbasis foto untuk Satuan Polisi Pamong Praja.
15 regu di lapangan mengirim laporan foto secara berkala, admin/pimpinan memantau
secara real-time dan menarik rekap laporan dari web dashboard.

## 2. Tech Stack (WAJIB, jangan diganti tanpa konfirmasi)
- Frontend: React (Vite) + TypeScript, styled dengan Tailwind CSS
- PWA: vite-plugin-pwa, Service Worker custom untuk offline queue
- Backend/DB: Supabase (Postgres, Auth, Storage, Realtime, Edge Functions/Deno)
- State management: React Query / TanStack Query untuk sinkronisasi data server
- Report generation: jsPDF + jspdf-autotable (PDF), SheetJS/xlsx (Excel)
- Push Notification: Web Push API native (VAPID keys) + Supabase pg_cron untuk trigger terjadwal
- Hosting: Vercel/Netlify/Cloudflare Pages (frontend) + Supabase project (backend)

## 3. Aktor & Autentikasi
- **Akun Regu** (15 akun: Regu 1 s/d Regu 15) — login berbasis kode regu + PIN/password,
  BUKAN akun personal. Satu smartphone = satu sesi login persisten.
- **Akun Admin/Pimpinan** — akses penuh ke seluruh data 15 regu, role-based via Supabase Auth
  custom claims atau tabel `user_roles`.
- Implementasikan Row Level Security (RLS) di Postgres:
  - Regu hanya bisa INSERT/SELECT laporan miliknya sendiri.
  - Admin bisa SELECT semua, tidak bisa mengatasnamakan regu lain saat submit.

## 4. Skema Database (Postgres via Supabase) — buatkan migration SQL
Tabel minimal yang dibutuhkan:
- `regu` (id, nama_regu, kode_login, status_aktif)
- `admin_users` (id, nama, email, role)
- `laporan` (id, regu_id FK, timestamp_kirim, siklus_ke, latitude, longitude,
  status_sync ['pending','synced','failed'], created_at)
- `laporan_foto` (id, laporan_id FK, storage_path, watermark_lat, watermark_lng,
  watermark_timestamp, urutan_foto [1 atau 2])
- Index pada `laporan.regu_id`, `laporan.timestamp_kirim` untuk query rentang tanggal cepat.

## 5. Fitur Inti — Aplikasi Mobile (PWA, sisi Regu)

### 5.1 Kamera Terintegrasi + Watermark GPS & Waktu
- Akses kamera HANYA via `getUserMedia` (live capture), JANGAN sediakan opsi upload dari galeri.
- Ambil koordinat GPS via Geolocation API saat capture.
- Overlay watermark (lat, lng, timestamp lokal) ke foto menggunakan `<canvas>` sebelum disimpan.
- Setiap siklus laporan = 2 foto per regu.

### 5.2 Offline-First Sync
- Simpan foto + metadata ke IndexedDB kalau koneksi tidak tersedia saat capture.
- Service Worker: retry upload otomatis di background ketika koneksi kembali (Background Sync API
  untuk Android; fallback retry-on-foreground untuk iOS karena keterbatasan Background Sync di Safari).
- Tampilkan indikator status di UI: "Tersimpan lokal" vs "Terkirim".

### 5.3 Push Notification Reminder
- Kirim reminder push 15 menit sebelum batas siklus 2 jam berakhir, ke tiap regu yang belum submit.
- Implementasi: Supabase Edge Function dipicu `pg_cron` tiap interval tertentu, cek status_sync,
  kirim Web Push (VAPID) ke subscription endpoint yang tersimpan per device.
- Catatan: di iOS, push HANYA jalan jika PWA sudah di-"Add to Home Screen" (iOS 16.4+). Sertakan
  prompt onboarding yang mewajibkan instalasi ke homescreen sebelum user bisa login.

## 6. Fitur Inti — Web Dashboard (sisi Admin)

### 6.1 Monitoring Real-Time
- Gunakan Supabase Realtime (subscribe ke tabel `laporan` & `laporan_foto`) supaya foto yang
  masuk muncul otomatis di dashboard tanpa refresh/polling manual.
- Tampilkan grid/feed foto terbaru per regu, dengan indikator regu mana yang belum lapor
  di siklus berjalan.

### 6.2 Generator Laporan
- Filter rentang waktu: Harian, Mingguan, Bulanan, Custom (date range picker).
- Kategori: Laporan Gabungan (rangkum 15 regu) vs Laporan Per Regu (filter satu regu).
- Export ke PDF (jsPDF, sertakan thumbnail foto + metadata) dan Excel (SheetJS, tabular).
- Idealnya generate di Edge Function server-side untuk file besar agar tidak membebani browser.

## 7. Non-Functional Requirements
- Skala: 15 regu x 2 foto x 12 siklus/hari = 360 foto/hari (~10.800 foto/bulan), data terus
  terakumulasi — desain schema & storage agar tetap query-cepat walau volume tumbuh.
- Retensi: sediakan mekanisme arsip/cleanup foto lama (misal >6 bulan) agar biaya Supabase
  Storage terkendali — bisa berupa scheduled Edge Function yang memindahkan foto lama ke
  cold storage terpisah atau menghapus setelah laporan final di-generate.
- Responsif: UI mobile harus nyaman dipakai satu tangan di lapangan (thumb-friendly), UI
  dashboard harus scalable untuk data tabular besar (virtualized list/pagination).
- Keamanan: JANGAN expose Supabase service_role key di frontend, hanya anon key + RLS.

## 8. Struktur Folder yang Diharapkan
```
/src
  /features
    /regu-capture      (kamera, watermark, offline queue)
    /admin-dashboard    (monitoring realtime, filter)
    /report-generator   (PDF/Excel export)
  /lib
    /supabase           (client init, query hooks)
    /offline-sync        (IndexedDB wrapper, sync manager)
    /push                (subscribe, VAPID handling)
  /components (shared UI)
  /types (TypeScript interfaces sesuai skema DB)
/supabase
  /migrations (SQL schema di atas)
  /functions (Edge Functions: reminder-push, generate-report, archive-photos)
```

## 9. Urutan Pengerjaan yang Diminta
1. Setup project (Vite + React + TS + Tailwind + PWA plugin) dan koneksi Supabase.
2. Migration SQL untuk semua tabel di poin 4, plus RLS policy.
3. Modul Auth (login Akun Regu & Admin, role-based routing).
4. Modul kamera + watermark + offline queue (sisi Regu) — INI FITUR PALING KRITIS, prioritaskan.
5. Modul dashboard real-time (sisi Admin).
6. Modul generator laporan (PDF/Excel).
7. Push notification reminder (Edge Function + pg_cron + Web Push).
8. Testing alur end-to-end: submit offline → sync otomatis → muncul di dashboard real-time
   → ter-generate di laporan.

Mulai dari langkah 1 dan 2 dulu, tunjukkan skema SQL lengkap sebelum lanjut ke kode frontend.
