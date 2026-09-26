// Tipe data sesuai skema DB (supabase/migrations/*)
export type Role = "admin" | "pimpinan" | "regu";

/** Kategori pelaporan: kegiatan (program kerja) atau kejadian (temuan). */
export type KategoriLaporan = "kegiatan" | "kejadian";

/** Tahapan rangkaian laporan: awal → update → lengkap. */
export type TahapLaporan = "awal" | "update" | "lengkap";

export const TAHAP_LABEL: Record<TahapLaporan, string> = {
  awal: "Laporan Awal",
  update: "Update Situasi",
  lengkap: "Laporan Lengkap",
};

/** Master pilihan jenis laporan (dikelola admin, tanpa hapus). */
export interface JenisLaporan {
  id: string;
  kategori: KategoriLaporan;
  nama: string;
  aktif: boolean;
  urutan: number;
  created_at?: string;
}

export interface Regu {
  id: string;
  nama_regu: string;
  jabatan?: string | null;
  kode_login: string;
  status_aktif: boolean;
  unit_key?: string | null;
  wilayah_key?: string | null;
  created_at?: string;
}

export interface AdminUser {
  id: string;
  nama: string;
  email: string;
  role: "admin" | "pimpinan";
  status_aktif?: boolean;
  created_at?: string;
}

export type SyncStatus = "pending" | "synced" | "failed";

export interface Laporan {
  id: string;
  regu_id: string;
  timestamp_kirim: string;
  siklus_ke: number;
  latitude: number | null;
  longitude: number | null;
  status_sync: SyncStatus;
  catatan?: string | null;
  /** NRP pelapor yang diinput saat membuat laporan (migration 0020). */
  nrp_pelapor?: string | null;
  kategori: KategoriLaporan;
  jenis_id?: string | null;
  tahap: TahapLaporan;
  parent_id?: string | null;
  perihal?: string | null;
  created_at?: string;
  // join
  regu?: Regu;
  jenis?: JenisLaporan | null;
  fotos?: LaporanFoto[];
  videos?: LaporanVideo[];
}

export interface LaporanFoto {
  id: string;
  laporan_id: string;
  storage_path: string;
  watermark_lat: number | null;
  watermark_lng: number | null;
  watermark_timestamp: string;
  urutan_foto: 1 | 2 | 3 | 4;
  created_at?: string;
}

export interface LaporanVideo {
  id: string;
  laporan_id: string;
  storage_path: string;
  watermark_lat: number | null;
  watermark_lng: number | null;
  watermark_timestamp: string;
  duration_seconds: number | null;
  created_at?: string;
}

export interface PushSubscriptionRow {
  id: string;
  regu_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at?: string;
}

/** Entri antrian laporan di IndexedDB sebelum tersinkron ke Supabase */
export interface QueuedLaporan {
  localId: string;
  reguId: string;
  siklusKe: number;
  timestampKirim: string;
  latitude: number | null;
  longitude: number | null;
  catatan?: string;
  kategori: KategoriLaporan;
  jenisId?: string | null;
  jenisNama?: string | null;
  /** Nama jenis yang diketik pelapor sendiri (tidak dipilih dari master).
   *  Dicari/didaftarkan saat sync via RPC pakai_jenis_custom. */
  jenisCustom?: string | null;
  tahap: TahapLaporan;
  parentId?: string | null;
  perihal?: string;
  /** Daftar NRP pelapor (satu unit bisa >1 personel) — dikirim bersama
   *  laporan agar pemantau tahu siapa saja pelapornya. */
  nrpList?: string[];
  fotos: Array<{
    blobKey: string; // kunci blob di object store fotos
    urutan: 1 | 2 | 3 | 4;
    watermarkLat: number | null;
    watermarkLng: number | null;
    watermarkTimestamp: string;
  }>;
  videos: Array<{
    blobKey: string;
    watermarkLat: number | null;
    watermarkLng: number | null;
    watermarkTimestamp: string;
    durationSeconds: number | null;
  }>;
  status: "pending" | "syncing" | "failed";
  attempts: number;
  lastError?: string;
}

export interface SessionUser {
  role: "admin" | "pimpinan" | "regu";
  nama: string;
  // untuk regu
  reguId?: string;
  namaRegu?: string;
  kodeLogin?: string;
  unitKey?: string | null;
  wilayahKey?: string | null;
  // untuk admin/pemantau
  email?: string;
  monitorId?: string;
  username?: string;
  accessLevel?: "all" | "wilayah" | "fungsi";
  scopeKey?: string | null;
}
