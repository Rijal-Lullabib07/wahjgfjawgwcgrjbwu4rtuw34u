/**
 * Folder pemantau (tab 📁 Folder).
 *
 * Semua data lewat RPC di Supabase (db_supabase.sql bagian 8):
 *   - folder_overview()     → daftar folder + jumlah hari ini + waktu terakhir + "N baru"
 *   - folder_laporan(key)   → isi laporan sebuah folder (RLS tetap berlaku)
 *   - mark_folder_read(key) → tandai folder sudah dibuka (badge hilang)
 *
 * folder_key (harus sama dengan konvensi SQL):
 *   polsek:<wilayah> | unit:<wilayah>:<unit> | satuan:<unit> | arsip:<wilayah>
 */

import { supabase } from "./supabase/client";

export type FolderKind = "polsek" | "unit" | "satuan" | "arsip";

export interface FolderRow {
  folder_key: string;
  folder_label: string;
  folder_kind: FolderKind;
  parent_key: string | null;
  today_count: number;
  last_at: string | null;
  new_count: number;
  sort_order: number;
}

export interface FolderFoto {
  id: string;
  storage_path: string;
  urutan_foto: number;
  watermark_timestamp: string;
  watermark_lat: number | null;
  watermark_lng: number | null;
}

export interface FolderVideo {
  id: string;
  storage_path: string;
  duration_seconds: number | null;
}

export interface FolderLaporanRow {
  id: string;
  regu_id: string;
  timestamp_kirim: string;
  siklus_ke: number;
  latitude: number | null;
  longitude: number | null;
  status_sync: "pending" | "synced" | "failed";
  catatan: string | null;
  nama_regu: string;
  fotos: FolderFoto[];
  videos: FolderVideo[];
}

/** folder_key untuk satu regu — dipakai popup "Buka laporan". */
export function folderKeyForRegu(
  unitKey: string | null | undefined,
  wilayahKey: string | null | undefined,
): string | null {
  const unit = (unitKey ?? "").trim().toLowerCase();
  const wilayah = (wilayahKey ?? "").trim().toLowerCase();
  if (!unit) return null;
  if (!wilayah) return `satuan:${unit}`;
  return `unit:${wilayah}:${unit}`;
}

function requireClient() {
  if (!supabase) {
    throw new Error(
      "Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di .env.",
    );
  }
  return supabase;
}

export async function fetchFolderOverview(): Promise<FolderRow[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("folder_overview");
  if (error) throw new Error(`Gagal memuat folder: ${error.message}`);
  return (data ?? []) as FolderRow[];
}

export async function fetchFolderLaporan(
  folderKey: string,
): Promise<FolderLaporanRow[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("folder_laporan", {
    p_folder_key: folderKey,
  });
  if (error) throw new Error(`Gagal memuat isi folder: ${error.message}`);
  return (data ?? []) as FolderLaporanRow[];
}

/** Tandai folder sudah dibuka — dipanggil saat folder dibuka/di-expand. */
export async function markFolderRead(folderKey: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("mark_folder_read", {
    p_folder_key: folderKey,
  });
  if (error) console.warn("mark_folder_read gagal:", error.message);
}

/** Format waktu WIB singkat untuk kartu folder: "17 Sep, 14.32". */
export function formatWaktuWib(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function polsekKeyOf(folderKey: string): string | null {
  if (folderKey.startsWith("polsek:")) return folderKey;
  if (folderKey.startsWith("unit:")) {
    return `polsek:${folderKey.slice(5).split(":")[0] ?? ""}`;
  }
  if (folderKey.startsWith("arsip:")) return `polsek:${folderKey.slice(6)}`;
  return null;
}
