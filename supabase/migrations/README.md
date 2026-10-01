# SIPLAP — Urutan Migration Database

Semua migration **idempoten** (aman dijalankan ulang) dan dijalankan berurutan
di **Supabase Dashboard → SQL Editor**. Jalankan dari atas ke bawah untuk
database baru; untuk database yang sudah jalan, cukup jalankan yang belum
pernah dijalankan.

## Urutan wajib

| # | File | Fungsi | Status |
|---|------|--------|--------|
| 1 | `0001_init.sql` | Skema inti: tabel `regu`, `admin_users`, `laporan`, `laporan_foto`, `push_subscriptions`, index, storage bucket `laporan-foto`, helper `current_regu_id()`/`is_admin()`, RLS awal, realtime, catatan pg_cron | ✅ Aktif |
| 2 | `0002_seed.sql` | Seed 631 akun pelapor (10 satuan Polres + 14 Polsek) + 27 akun pemantau. Setelah ini jalankan `npm run provision:jawara` untuk membuat akun Auth | ✅ Aktif |
| 3 | `0003_reminder_logs.sql` | Tabel `reminder_logs` (dedupe push reminder per siklus) — dipakai Edge Function `reminder-push` | ✅ Aktif |
| 4 | `0004_push_claim.sql` | RPC `claim_push_subscription` — klaim subscription push saat HP dipakai bergantian antar regu | ✅ Aktif |
| 5 | `0005_fix_storage_rls.sql` | Perketat RLS Storage: upload hanya ke folder regu sendiri | ✅ Aktif |
| 6 | `0006_jawara_accounts.sql` | Skema akses JAWARA: `access_level`, `unit_key`, `wilayah_key`, helper `current_username()`, `is_monitor()`, `can_read_laporan()`, RLS berbasis cakupan | ✅ Aktif |
| 7 | `0007_open_reporting.sql` | Hapus trigger kuota foto per siklus — pelaporan bebas waktu | ✅ Aktif |
| 8 | `0008_media_limits.sql` | Maks 4 foto + 1 video per laporan: constraint `urutan_foto`, tabel `laporan_video`, trigger kuota 4 foto, RLS video & storage | ✅ Aktif |
| 9 | `0009_normalize_monitor_scope.sql` | Pencocokan cakupan pemantau tidak sensitif kapital/spasi (`can_read_regu`, `can_read_laporan` versi final) | ✅ Aktif |
| 10 | `0010_fix_scope_rls_recursion.sql` | Pecah fungsi scope jadi `can_read_monitor_scope()` untuk hindari rekursi RLS | ✅ Aktif |
| 11 | `0011_map_spkt_to_polsek.sql` | Petakan 14 akun SPKT ke Polsek (fungsi + wilayah) | ✅ Aktif |
| 12 | `0012_allow_regu_own_profile.sql` | Pelapor bisa baca profil regu miliknya sendiri | ✅ Aktif |
| 13 | `0013_realtime_video.sql` | Tambah `laporan_video` ke publication realtime | ✅ Aktif |
| 14 | `0014_kegiatan_kejadian.sql` | Fitur Kegiatan/Kejadian: master `jenis_laporan` + seed, kolom `kategori`/`jenis_id`/`tahap`/`parent_id`/`perihal`, trigger `validate_laporan_turunan` + `sync_parent_tahap`, RPC `folder_laporan(text)` | ✅ Aktif (trigger ditimpa 0017/0022) |
| 15 | `0015_manajemen_personel.sql` | Kolom `regu.jabatan`, `admin_users.status_aktif`, RLS kelola personel | ✅ Aktif (RPC-nya di-drop 0016) |
| 16 | `0016_fix_manajemen_personel.sql` | Drop RPC `buat_akun_personel`/`reset_pin_personel` (ditangani Edge Function `manage-personel`), kolom `regu.auth_user_id` | ✅ Aktif |
| 17 | `0017_tahap_bebas.sql` | Laporan baru bebas tahap (awal/update/lengkap) — versi baru trigger `validate_laporan_turunan` | ✅ Aktif |
| 18 | `0018_posisi_realtime.sql` | Tabel `posisi` (GPS realtime pelapor, 1 baris per regu) + RLS + realtime | ✅ Aktif |
| 19 | `0019_app_version_heartbeat.sql` | Kolom `regu.app_version`, `versi_dikirim_pada` + policy update heartbeat | ✅ Aktif |
| 20 | `0020_laporan_nrp.sql` | Kolom `laporan.nrp_pelapor text` + index | ✅ Aktif (tipe diubah 0021) |
| 21 | `0021_laporan_multi_nrp.sql` | `nrp_pelapor` text → **text[]** (multi-NRP per laporan) + index GIN | ✅ Aktif |
| 22 | `0022_fix_trigger_tahap_bebas.sql` | Kembalikan trigger `validate_laporan_turunan` ke versi 0017 + pastikan trigger terpasang — perbaiki error *"Laporan baru harus bertahap awal"* | ✅ Aktif |
| 23 | `0023_admin_only_management.sql` | Helper `is_admin_penuh()` (role `admin` + access_level `all`) + RLS kelola personel/pemantau/jenis hanya untuk admin penuh — Wakapolres & pimpinan jadi read-only | ✅ Aktif |
| 24 | `0024_push_monitor_id.sql` | Dukungan pemantau pada `push_subscriptions`: kolom `monitor_id` + index, constraint `push_owner_check`, `claim_push_subscription` versi regu/pemantau, RLS pemilik device regu ATAU pemantau — perbaiki error 400 saat pemantau mengaktifkan notifikasi | ✅ Aktif |
| 25 | `0025_posisi_scope_rls.sql` | RLS `posisi` mengikuti cakupan pemantau (`can_read_monitor_scope`) — sebelumnya `using (true)` sehingga Kapolsek/Kasat melihat posisi seluruh personel di peta | ✅ Aktif |
| 26 | `0026_fix_regu_directory_rls.sql` | Drop policy `regu` warisan 0006 yang `using (true)` (daftar 107 regu bocor ke semua pemantau: dropdown "Semua Unit", PDF/Excel) + perbaiki `is_admin()` yang menganggap semua pemantau admin | ✅ Aktif |
| 27 | `0027_jenis_custom_upload_manual.sql` | RPC `pakai_jenis_custom(kategori, nama)` — pelapor bisa mengetik jenis sendiri dari form Lapor (dicari/didaftarkan aman tanpa duplikat); pendukung unggah manual foto/video untuk laporan kejadian dari masyarakat | ✅ Aktif |
| 28 | `0028_personel_dir.sql` | Tabel `personel_polri` (nrp, nama, pangkat, jabatan — sumber LAPBUL) + RLS read authenticated — pencocokan NRP di pemantau & validasi NRP real-time di form pelapor. Import data: `node scripts/import-personel.mjs <file.xlsx>` | ✅ Aktif |
| 29 | `0029_personel_fungsi.sql` | Kolom `personel_polri.fungsi/satuan/status` (sumber DATA PERSONEL FIX) — validasi NRP tampil "PANGKAT Nama — Jabatan — FUNGSI", FUNGSI ikut di semua tampilan personel. Import ulang: `node scripts/import-personel.mjs "DATA PERSONEL FIX.xlsx"` | ✅ Aktif |

## Yang dihapus (usang, tidak dipakai lagi)

| File | Alasan hapus |
|------|--------------|
| `0003_foto_quota.sql` (lama) | Trigger kuota 2 foto/siklus sudah di-drop oleh `0007_open_reporting.sql`, lalu diganti aturan baru (maks 4 foto/laporan) di `0008_media_limits.sql`. Menjalankannya justru memasang ulang trigger yang salah. |
| `0009_scope_regu_directory.sql` (lama) | Fungsi `can_read_regu` + policy-nya sudah ditimpa penuh oleh migration normalize/fix-recursion/own-profile. |
| `0023_direktori_personel.sql` (lama) | Fitur direktori personel (NRP→Nama) tidak jadi dipakai; digantikan `0028_personel_dir.sql` (tabel `personel_polri`). |

## Catatan penting

- **Jangan jalankan 0014 lagi setelah 0022** — kalau iya, fungsi trigger
  kembali ke versi lama dan laporan baru bertahap `update`/`lengkap` akan
  gagal dengan pesan *"Laporan baru harus bertahap awal"*. Solusinya: jalankan
  `0022_fix_trigger_tahap_bebas.sql` sekali lagi setelahnya.
- Untuk database **baru**: jalankan 0001 → 0002 urut, lalu `npm run
  provision:jawara`, lalu sisa migration urut sampai 0022.
- `supabase/db_supabase.sql` adalah dump referensi skema lama — **bukan**
  migration, jangan dijalankan sebagai urutan.
- Edge Functions (`reminder-push`, `notify-laporan`, `manage-personel`,
  `archive-photos`, `generate-report`) bergantung pada tabel hasil migration:
  `regu`, `laporan`, `laporan_foto`, `laporan_video`, `push_subscriptions`,
  `reminder_logs`, `admin_users`.
