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

// ---------- Auth ----------

export async function loginRegu(
  kodeLogin: string,
  pin: string,
): Promise<SessionUser> {
  const client = requireClient();
  // Login regu: email sintetis kode_login@regu.siplap.id + PIN sebagai password.
  const email = `${kodeLogin.toLowerCase()}@regu.siplap.id`;
  const { error } = await client.auth.signInWithPassword({
    email,
    password: pin,
  });
  if (error) throw new Error(error.message);

  const { data: regu, error: reguErr } = await client
    .from("regu")
    .select("*")
    .eq("kode_login", kodeLogin.toUpperCase())
    .single();
  if (reguErr || !regu) throw new Error("Data regu tidak ditemukan");

  return {
    role: "regu",
    nama: regu.nama_regu,
    reguId: regu.id,
    namaRegu: regu.nama_regu,
    kodeLogin: regu.kode_login,
  };
}

export async function loginAdmin(
  email: string,
  password: string,
): Promise<SessionUser> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const { data: admin, error: adminErr } = await client
    .from("admin_users")
    .select("*")
    .eq("email", email.toLowerCase())
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
  if (error) throw error;
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
    .select("*, regu:regu_id(*), fotos:laporan_foto(*)")
    .order("timestamp_kirim", { ascending: false })
    .limit(filter.limit ?? 500);
  if (filter.reguId) query = query.eq("regu_id", filter.reguId);
  if (filter.from)
    query = query.gte("timestamp_kirim", filter.from.toISOString());
  if (filter.to) query = query.lte("timestamp_kirim", filter.to.toISOString());
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Laporan[];
}

/** Upload satu foto ke Supabase Storage, kembalikan storage_path. */
async function uploadFoto(
  reguId: string,
  laporanId: string,
  urutan: 1 | 2,
  blob: Blob,
): Promise<string> {
  const client = requireClient();
  const path = `${reguId}/${laporanId}/foto-${urutan}.jpg`;
  const { error } = await client.storage
    .from("laporan-foto")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
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
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
