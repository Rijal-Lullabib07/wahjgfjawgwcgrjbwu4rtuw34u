import type { Laporan, QueuedLaporan, Regu, SessionUser } from "../../types";
import { supabase } from "./client";

/**
 * Adapter data — SEMUA lewat Supabase (Postgres + Auth + Storage + Realtime).
 * Tidak ada mode demo; jika .env belum diisi, aplikasi menampilkan
 * pesan konfigurasi jelas (bukan data palsu).
 */

function requireClient() {
  if (!supabase) {
    throw new Error(
      "Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di file .env, lalu restart dev server.",
    );
  }

  return supabase;
}

function describeSupabaseError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const value = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
      status?: unknown;
    };
    const parts = [
      typeof value.message === "string" ? value.message : null,
      typeof value.code === "string" ? `kode ${value.code}` : null,
      typeof value.status === "number" ? `HTTP ${value.status}` : null,
      typeof value.details === "string" ? value.details : null,
      typeof value.hint === "string" ? value.hint : null,
    ].filter((part): part is string => Boolean(part));
    if (parts.length > 0) return new Error(parts.join(" · "));
  }

  return new Error(fallback);
}

function describeAuthError(error: { message?: string; status?: number }): Error {
  if (error.status === 400) {
    return new Error(
      "Login ditolak. Periksa kode/username dan password. Password akun lama tidak berubah saat provisioning ulang.",
    );
  }
  return new Error(error.message || "Login gagal. Coba lagi.");
}

// ---------- Auth ----------

export async function loginRegu(
  kodeLogin: string,
  pin: string,
): Promise<SessionUser> {
  const client = requireClient();
  const username = kodeLogin.trim().toLowerCase();
  // Login regu: email sintetis kode_login@regu.siplap.id + PIN sebagai password.
  const email = `${username}@regu.siplap.id`;
  const { error } = await client.auth.signInWithPassword({
    email,
    password: pin,
  });
  if (error) throw describeAuthError(error);

  const { data: regu, error: reguErr } = await client
    .from("regu")
    .select("*")
    .eq("kode_login", username)
    .single();
  if (reguErr || !regu) throw new Error("Data regu tidak ditemukan");
  if (!regu.status_aktif) throw new Error("Akun pelapor tidak aktif");

  return {
    role: "regu",
    nama: regu.nama_regu,
    reguId: regu.id,
    namaRegu: regu.nama_regu,
    kodeLogin: regu.kode_login,
  };
}

export async function loginAdmin(
  identifier: string,
  password: string,
): Promise<SessionUser> {
  const client = requireClient();
  const normalized = identifier.trim().toLowerCase();
  const email =
    normalized === "polres.admin"
      ? "admin@polres.go.id"
      : normalized.includes("@")
        ? normalized
        : `${normalized}@monitor.siplap.id`;
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw describeAuthError(error);

  const { data: admin, error: adminErr } = await client
    .from("admin_users")
    .select("*")
    .or(`email.eq.${email},username.eq.${normalized}`)
    .single();
  if (adminErr || !admin) throw new Error("Bukan akun admin yang valid");

  return { role: admin.role, nama: admin.nama, email: admin.email };
}

export async function logout(): Promise<void> {
  const client = requireClient();
  await client.auth.signOut();
}

// ---------- Regu ----------

export async function fetchReguList(): Promise<Regu[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("regu")
    .select("*")
    .order("nama_regu");
  if (error) throw describeSupabaseError(error, "Gagal memuat daftar pelapor");
  return data ?? [];
}

// ---------- Laporan ----------

export async function fetchLaporan(filter: {
  reguId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<Laporan[]> {
  const client = requireClient();
  let query = client
    .from("laporan")
    .select(
      "*, regu:regu_id(*), fotos:laporan_foto(*), videos:laporan_video(*)",
    )
    .order("timestamp_kirim", { ascending: false })
    .limit(filter.limit ?? 500);
  if (filter.reguId) query = query.eq("regu_id", filter.reguId);
  if (filter.from)
    query = query.gte("timestamp_kirim", filter.from.toISOString());
  if (filter.to) query = query.lte("timestamp_kirim", filter.to.toISOString());
  const { data, error } = await query;
  if (error) throw describeSupabaseError(error, "Gagal memuat laporan");
  return (data ?? []) as Laporan[];
}

/** Upload satu foto ke Supabase Storage, kembalikan storage_path. */
async function uploadFoto(
  reguId: string,
  laporanId: string,
  urutan: 1 | 2 | 3 | 4,
  blob: Blob,
): Promise<string> {
  const client = requireClient();
  const path = `${reguId}/${laporanId}/foto/foto-${urutan}.jpg`;
  const { error } = await client.storage
    .from("laporan-foto")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}

async function uploadVideo(
  reguId: string,
  laporanId: string,
  blob: Blob,
): Promise<string> {
  const client = requireClient();
  const path = `${reguId}/${laporanId}/video/video-1.webm`;
  const { error } = await client.storage
    .from("laporan-foto")
    .upload(path, blob, {
      contentType: blob.type || "video/webm",
      upsert: true,
    });
  if (error) throw error;
  return path;
}

/**
 * Kirim laporan lengkap: insert row laporan, upload foto ke Storage,
 * insert metadata laporan_foto. Mengembalikan id laporan.
 */
export async function submitLaporan(
  q: QueuedLaporan,
  blobs: Blob[],
  videoBlobs: Blob[] = [],
): Promise<string> {
  const client = requireClient();

  const { data: laporan, error } = await client
    .from("laporan")
    .insert({
      regu_id: q.reguId,
      timestamp_kirim: q.timestampKirim,
      siklus_ke: q.siklusKe,
      latitude: q.latitude,
      longitude: q.longitude,
      status_sync: "synced",
      catatan: q.catatan ?? null,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`Gagal membuat laporan: ${error.message}`);
  }

  for (let i = 0; i < q.fotos.length; i++) {
    const f = q.fotos[i];
    let path: string;
    try {
      path = await uploadFoto(q.reguId, laporan.id, f.urutan, blobs[i]);
    } catch (uploadError) {
      const message =
        uploadError instanceof Error
          ? uploadError.message
          : String(uploadError);
      throw new Error(`Gagal upload foto ${f.urutan} ke Storage: ${message}`);
    }
    const { error: fotoErr } = await client.from("laporan_foto").insert({
      laporan_id: laporan.id,
      storage_path: path,
      watermark_lat: f.watermarkLat,
      watermark_lng: f.watermarkLng,
      watermark_timestamp: f.watermarkTimestamp,
      urutan_foto: f.urutan,
    });
    if (fotoErr) {
      throw new Error(
        `Gagal menyimpan metadata foto ${f.urutan}: ${fotoErr.message}`,
      );
    }
  }
  for (let i = 0; i < (q.videos ?? []).length; i++) {
    const video = q.videos[i];
    const videoBlob = videoBlobs[i];
    if (!videoBlob || videoBlob.size === 0) {
      throw new Error("Data video tidak tersedia untuk dikirim.");
    }
    const path = await uploadVideo(q.reguId, laporan.id, videoBlob);
    const { error: videoErr } = await client.from("laporan_video").insert({
      laporan_id: laporan.id,
      storage_path: path,
      watermark_lat: video.watermarkLat,
      watermark_lng: video.watermarkLng,
      watermark_timestamp: video.watermarkTimestamp,
      duration_seconds: video.durationSeconds,
    });
    if (videoErr)
      throw new Error(`Gagal menyimpan metadata video: ${videoErr.message}`);
  }
  return laporan.id;
}

/** URL publik foto dari Storage. */
export function fotoUrl(storagePath: string): string {
  const client = requireClient();
  const { data } = client.storage
    .from("laporan-foto")
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

export function fotoDownloadUrl(storagePath: string): string {
  const client = requireClient();
  const { data } = client.storage
    .from("laporan-foto")
    .getPublicUrl(storagePath, { download: true });
  return data.publicUrl;
}

/** URL publik video dari Storage. */
export function videoUrl(storagePath: string): string {
  const client = requireClient();
  const { data } = client.storage
    .from("laporan-foto")
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

export function videoDownloadUrl(storagePath: string): string {
  const client = requireClient();
  const { data } = client.storage
    .from("laporan-foto")
    .getPublicUrl(storagePath, { download: true });
  return data.publicUrl;
}

// ---------- Realtime ----------

/** Subscribe perubahan tabel laporan & laporan_foto via Supabase Realtime. */
export function subscribeLaporan(cb: () => void): () => void {
  const client = requireClient();
  const channel = client
    .channel("laporan-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "laporan" },
      () => cb(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "laporan_foto" },
      () => cb(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "laporan_video" },
      () => cb(),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
