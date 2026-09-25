import type {
  JenisLaporan,
  KategoriLaporan,
  Laporan,
  QueuedLaporan,
  Regu,
  SessionUser,
} from "../../types";
import {
  createDemoLaporan,
  isDashboardDemo,
  isDemoLaporanInScope,
} from "../demoData";
import { supabase } from "./client";

/**
 * Adapter data — SEMUA lewat Supabase (Postgres + Auth + Storage + Realtime).
 * Ringkasan dashboard punya mode demo opt-in untuk kebutuhan presentasi.
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
    unitKey: regu.unit_key,
    wilayahKey: regu.wilayah_key,
  };
}

export async function loginAdmin(
  identifier: string,
  password: string,
): Promise<SessionUser> {
  const client = requireClient();
  const normalized = identifier.trim().toLowerCase();
  const email = normalized.includes("@")
    ? normalized
    : `${normalized}@monitor.siplap.id`;
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw describeAuthError(error);

  const { data: admin, error: adminErr } = await client
    .from("admin_users")
    .select("id, nama, email, role, username, access_level, scope_key, status_aktif")
    .or(`email.eq.${email},username.eq.${normalized}`)
    .single();
  if (adminErr || !admin) throw new Error("Bukan akun admin yang valid");
  if (admin.status_aktif === false) {
    throw new Error("Akun pemantau nonaktif. Hubungi admin.");
  }

  return {
    role: admin.role,
    nama: admin.nama,
    email: admin.email,
    monitorId: admin.id,
    username: admin.username ?? undefined,
    accessLevel: admin.access_level,
    scopeKey: admin.scope_key,
  };
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

// ---------- Master jenis laporan ----------

/** Daftar pilihan jenis (Kegiatan = program kerja, Kejadian = temuan). */
export async function fetchJenisLaporan(
  kategori?: KategoriLaporan,
  onlyActive = false,
): Promise<JenisLaporan[]> {
  const client = requireClient();
  let query = client
    .from("jenis_laporan")
    .select("*")
    .order("kategori")
    .order("urutan")
    .order("nama");
  if (kategori) query = query.eq("kategori", kategori);
  if (onlyActive) query = query.eq("aktif", true);
  const { data, error } = await query;
  if (error)
    throw describeSupabaseError(error, "Gagal memuat daftar jenis laporan");
  return data ?? [];
}

/** Tambah jenis baru (admin penuh saja — RLS menolak selain itu). */
export async function createJenisLaporan(
  kategori: KategoriLaporan,
  nama: string,
): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from("jenis_laporan")
    .insert({ kategori, nama: nama.trim() });
  if (error) throw describeSupabaseError(error, "Gagal menambah jenis laporan");
}

/**
 * Edit nama & status aktif jenis. TIDAK ADA hapus — jenis lama tetap
 * valid untuk laporan yang sudah ada.
 */
export async function updateJenisLaporan(
  id: string,
  patch: { nama?: string; aktif?: boolean },
): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("jenis_laporan").update(patch).eq("id", id);
  if (error) throw describeSupabaseError(error, "Gagal mengubah jenis laporan");
}

// ---------- Laporan ----------

export async function fetchLaporan(filter: {
  reguId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  kategori?: KategoriLaporan;
  session?: SessionUser | null;
}): Promise<Laporan[]> {
  const demoRows = isDashboardDemo
    ? createDemoLaporan(
        filter.from ?? new Date(Date.now() - 7 * 86_400_000),
        filter.to ?? new Date(),
      ).filter((row) => {
        if (!isDemoLaporanInScope(row, filter.session)) return false;
        if (filter.reguId && row.regu_id !== filter.reguId) return false;
        if (filter.kategori && row.kategori !== filter.kategori) return false;
        if (filter.from && new Date(row.timestamp_kirim) < filter.from)
          return false;
        if (filter.to && new Date(row.timestamp_kirim) > filter.to)
          return false;
        return true;
      })
    : [];

  // Mode demo tetap boleh dipakai tanpa konfigurasi Supabase. Jika Supabase
  // tersedia, data sintetis digabung dengan laporan nyata agar laporan
  // pelapor tetap masuk ke pemantau.
  if (!supabase) {
    if (isDashboardDemo) return demoRows.slice(0, filter.limit ?? 500);
    requireClient();
  }

  const client = requireClient();
  let query = client
    .from("laporan")
    .select(
      "*, regu:regu_id(*), jenis:jenis_id(*), fotos:laporan_foto(*), videos:laporan_video(*)",
    )
    .order("timestamp_kirim", { ascending: false })
    .limit(filter.limit ?? 500);
  if (filter.reguId) query = query.eq("regu_id", filter.reguId);
  if (filter.kategori) query = query.eq("kategori", filter.kategori);
  if (filter.from)
    query = query.gte("timestamp_kirim", filter.from.toISOString());
  if (filter.to)
    query = query.lte("timestamp_kirim", filter.to.toISOString());
  const { data, error } = await query;
  if (error) throw describeSupabaseError(error, "Gagal memuat laporan");
  // `laporan_video` punya unique(laporan_id) → PostgREST menganggap relasi
  // satu-ke-satu dan mengembalikan OBJEK (atau null), bukan array. Normalisasi
  // agar pemakaian `(l.videos ?? []).map(...)` tidak meledak.
  const normalized = (data ?? []).map((row) => {
    const r = row as Laporan;
    // Kolom nrp_pelapor di DB sudah text[] (migration 0021) — rapikan jadi
    // teks "NRP1, NRP2" agar UI & export versi ini tetap tampil normal.
    const nrpDb = r.nrp_pelapor as unknown;
    const nrpText = Array.isArray(nrpDb)
      ? nrpDb.filter(Boolean).join(", ") || null
      : ((nrpDb as string | null) ?? null);
    return {
      ...r,
      nrp_pelapor: nrpText,
      fotos: Array.isArray(r.fotos) ? r.fotos : r.fotos ? [r.fotos] : [],
      videos: Array.isArray(r.videos) ? r.videos : r.videos ? [r.videos] : [],
    } as Laporan;
  });

  const limit = filter.limit ?? 500;
  const sortByNewest = (a: Laporan, b: Laporan) =>
    new Date(b.timestamp_kirim).getTime() -
    new Date(a.timestamp_kirim).getTime();

  // Jangan biarkan ratusan baris demo menghabiskan kuota hasil dan
  // menyingkirkan laporan pelapor nyata. Semua baris real yang sudah diambil
  // dari Supabase diprioritaskan; demo hanya mengisi sisa kuota tampilan.
  if (isDashboardDemo) {
    const realRows = [...normalized].sort(sortByNewest);
    const demoRowsForDisplay = [...demoRows]
      .sort(sortByNewest)
      .slice(0, Math.max(0, limit - realRows.length));
    return [...realRows, ...demoRowsForDisplay].sort(sortByNewest);
  }

  return normalized.sort(sortByNewest).slice(0, limit);
  /*
    const from = filter.from ?? new Date(Date.now() - 7 * 86_400_000);
    const to = filter.to ?? new Date();
    const rows = createDemoLaporan(from, to).filter((row) => {
      if (filter.reguId && row.regu_id !== filter.reguId) return false;
      if (filter.kategori && row.kategori !== filter.kategori) return false;
      if (filter.from && new Date(row.timestamp_kirim) < filter.from) return false;
      if (filter.to && new Date(row.timestamp_kirim) > filter.to) return false;
      return true;
    });
    return rows.slice(0, filter.limit ?? 500);
  }

  const client = requireClient();
  let query = client
    .from("laporan")
    .select(
      "*, regu:regu_id(*), jenis:jenis_id(*), fotos:laporan_foto(*), videos:laporan_video(*)",
    )
    .order("timestamp_kirim", { ascending: false })
    .limit(filter.limit ?? 500);
  if (filter.reguId) query = query.eq("regu_id", filter.reguId);
  if (filter.kategori) query = query.eq("kategori", filter.kategori);
  if (filter.from)
    query = query.gte("timestamp_kirim", filter.from.toISOString());
  if (filter.to) query = query.lte("timestamp_kirim", filter.to.toISOString());
  const { data, error } = await query;
  if (error) throw describeSupabaseError(error, "Gagal memuat laporan");
  // `laporan_video` punya unique(laporan_id) → PostgREST menganggap relasi
  // satu-ke-satu dan mengembalikan OBJEK (atau null), bukan array. Normalisasi
  // agar pemakaian `(l.videos ?? []).map(...)` tidak meledak.
  const normalized = (data ?? []).map((row) => {
    const r = row as Laporan;
    // Kolom nrp_pelapor di DB sudah text[] (migration 0021) — rapikan jadi
    // teks "NRP1, NRP2" agar UI & export versi ini tetap tampil normal.
    const nrpDb = r.nrp_pelapor as unknown;
    const nrpText = Array.isArray(nrpDb)
      ? nrpDb.filter(Boolean).join(", ") || null
      : ((nrpDb as string | null) ?? null);
    return {
      ...r,
      nrp_pelapor: nrpText,
      fotos: Array.isArray(r.fotos) ? r.fotos : r.fotos ? [r.fotos] : [],
      videos: Array.isArray(r.videos) ? r.videos : r.videos ? [r.videos] : [],
    } as Laporan;
  });
  return normalized;
  */
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

  // Daftar NRP pelapor (migration 0021: kolom DB text[]) — buang kosong &
  // duplikat, pertahankan urutan input. Antrian offline versi lama menyimpan
  // satu NRP di q.nrp — ikutkan agar tidak hilang saat sync.
  const nrpLama = (q as { nrp?: string | null }).nrp?.trim() ?? "";
  const nrpList = Array.from(
    new Set(
      [...(q.nrpList ?? []), nrpLama]
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  );
  const insertLaporan = async (
    nrpValue: string[] | string | null,
  ): Promise<{ id: string }> => {
    const { data, error } = await client
      .from("laporan")
      .insert({
        regu_id: q.reguId,
        timestamp_kirim: q.timestampKirim,
        siklus_ke: q.siklusKe,
        latitude: q.latitude,
        longitude: q.longitude,
        status_sync: "synced",
        catatan: q.catatan ?? null,
        kategori: q.kategori,
        jenis_id: q.jenisId ?? null,
        tahap: q.tahap,
        parent_id: q.parentId ?? null,
        perihal: q.perihal ?? null,
        nrp_pelapor: nrpValue,
      })
      .select("id")
      .single();
    if (error) {
      throw new Error(`Gagal membuat laporan: ${error.message}`);
    }
    return data;
  };

  let laporan: { id: string };
  try {
    // Kolom nrp_pelapor sudah text[] (migration 0021) — kirim seluruh daftar.
    laporan = await insertLaporan(nrpList.length > 0 ? nrpList : null);
  } catch (firstErr) {
    // Fallback: bila DB masih skema lama (kolom text), gabungkan daftar jadi
    // satu string — hanya untuk error konversi tipe, bukan error lain.
    const msg = firstErr instanceof Error ? firstErr.message : "";
    if (
      nrpList.length === 0 ||
      !/array|invalid input syntax|22P02/i.test(msg)
    )
      throw firstErr;
    laporan = await insertLaporan(nrpList.join(", "));
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

/**
 * Rangkaian (thread) satu laporan awal: induk + semua turunannya
 * urut waktu. RLS tetap berlaku — hanya rangkaian milik sendiri atau
 * dalam cakupan yang bisa diambil.
 */
export async function fetchLaporanThread(rootId: string): Promise<Laporan[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("laporan")
    .select(
      "*, regu:regu_id(*), jenis:jenis_id(*), fotos:laporan_foto(*), videos:laporan_video(*)",
    )
    .or(`id.eq.${rootId},parent_id.eq.${rootId}`)
    .order("timestamp_kirim", { ascending: true });
  if (error) throw describeSupabaseError(error, "Gagal memuat rangkaian laporan");
  return (data ?? []).map((row) => {
    const r = row as Laporan;
    const nrpDb = r.nrp_pelapor as unknown;
    const nrpText = Array.isArray(nrpDb)
      ? nrpDb.filter(Boolean).join(", ") || null
      : ((nrpDb as string | null) ?? null);
    return {
      ...r,
      nrp_pelapor: nrpText,
      fotos: Array.isArray(r.fotos) ? r.fotos : r.fotos ? [r.fotos] : [],
      videos: Array.isArray(r.videos) ? r.videos : r.videos ? [r.videos] : [],
    } as Laporan;
  });
}

/**
 * Rangkaian milik pelapor yang masih terbuka (awal/update — belum
 * lengkap) + yang sudah lengkap. Dipakai daftar "Rangkaian" di sisi
 * pelapor. child_count = jumlah turunan terkirim.
 *
 * @param limit batas jumlah laporan awal yang diambil (default 50,
 *              dinaikkan bertahap lewat tombol "Muat lebih banyak").
 */
export async function fetchOpenThreads(
  reguId: string,
  limit = 50,
): Promise<Array<Laporan & { child_count: number }>> {
  const client = requireClient();
  // PostgREST tidak mendukung agregat count embedded, dan embed by nama FK
  // (laporan_parent_id_fkey) gagal bila constraint-nya tidak ada di cache
  // skema (PGRST200). Ambil induk + turunan terpisah, hitung di klien.
  const { data, error } = await client
    .from("laporan")
    .select("*, jenis:jenis_id(*)")
    .eq("regu_id", reguId)
    .is("parent_id", null)
    .order("timestamp_kirim", { ascending: false })
    .limit(limit);
  if (error) throw describeSupabaseError(error, "Gagal memuat laporan berjalan");
  const roots = (data ?? []) as Laporan[];

  const childCounts = new Map<string, number>();
  const rootIds = roots.map((r) => r.id);
  if (rootIds.length > 0) {
    const { data: children, error: childErr } = await client
      .from("laporan")
      .select("id, parent_id")
      .in("parent_id", rootIds);
    if (!childErr && children) {
      for (const c of children as Array<{ id: string; parent_id: string | null }>) {
        if (c.parent_id) {
          childCounts.set(c.parent_id, (childCounts.get(c.parent_id) ?? 0) + 1);
        }
      }
    }
    // Gagal hitung turunan tidak boleh menggagalkan daftar — biarkan 0.
  }

  return roots.map((r) => ({
    ...r,
    child_count: childCounts.get(r.id) ?? 0,
  }));
}

/** Ringkasan per wilayah/unit untuk dashboard & statistik. */
export interface RingkasanKelompok {
  key: string;
  label: string;
  jumlah: number;
}

/**
 * Ringkasan laporan hari ini: total, per wilayah (polsek), per unit
 * (satuan), per kategori (kegiatan/kejadian), foto+video.
 * Data dihitung dari fetch laporan (RLS tetap berlaku).
 */
export async function fetchDashboardSummary(
  from: Date,
  to: Date,
  session?: SessionUser | null,
) {
  const rows = await fetchLaporan({ from, to, limit: 2000, session });
  const perWilayah = new Map<string, number>();
  const perUnit = new Map<string, number>();
  let kegiatan = 0;
  let kejadian = 0;
  let foto = 0;
  let video = 0;
  for (const l of rows) {
    if (l.kategori === "kejadian") kejadian++;
    else kegiatan++;
    foto += l.fotos?.length ?? 0;
    video += l.videos?.length ?? 0;
    // Grafik wilayah/fungsi hanya dihitung dari LAPORAN AWAL (induk) agar
    // satu rangkaian laporan (awal → update → lengkap) tidak dihitung
    // berulang untuk tiap tahap turunannya. Induk ditandai parent_id NULL —
    // JANGAN pakai `tahap = 'awal'`: tahap induk ikut berubah ('update'/'
    // 'lengkap') lewat trigger sync_parent_tahap, dan laporan baru boleh
    // langsung dibuat bertahap 'update'/'lengkap' (migration 0017).
    if (l.parent_id) continue;
    const regu = l.regu;
    if (regu?.wilayah_key) {
      const key = regu.wilayah_key.trim().toLowerCase();
      perWilayah.set(key, (perWilayah.get(key) ?? 0) + 1);
    } else if (regu?.unit_key) {
      const key = regu.unit_key.trim().toLowerCase();
      perUnit.set(key, (perUnit.get(key) ?? 0) + 1);
    }
  }
  return {
    total: rows.length,
    kegiatan,
    kejadian,
    foto,
    video,
    pelaporAktif: new Set(rows.map((l) => l.regu_id)).size,
    perWilayah: [...perWilayah.entries()]
      .map(([key, jumlah]) => ({ key, label: wilayahLabel(key), jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah),
    perUnit: [...perUnit.entries()]
      .map(([key, jumlah]) => ({ key, label: unitLabel(key), jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah),
    rows,
  };
}

// ---------- Posisi realtime pelapor (peta personel) ----------

/** Satu posisi GPS terkini per pelapor (tabel `posisi`, migration 0018). */
export interface LokasiPelapor {
  regu_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  /** Waktu posisi terakhir diterima server. */
  diupdate_pada: string;
  nama_regu: string;
  unit_key: string | null;
  wilayah_key: string | null;
}

/**
 * Posisi terkini SEMUA pelapor (untuk peta personel di dashboard).
 * Satu baris per regu — tabel `posisi` selalu di-update pelapor.
 * RLS (migration 0025): pelapor hanya posisinya; pemantau hanya posisi
 * dalam cakupannya (can_read_monitor_scope). PetaScreen menyaring lagi
 * di klien sebagai lapisan kedua.
 */
export async function fetchLokasiPelapor(): Promise<LokasiPelapor[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("posisi")
    .select(
      "regu_id, latitude, longitude, accuracy_m, diupdate_pada, regu:regu_id(nama_regu, unit_key, wilayah_key)",
    )
    .order("diupdate_pada", { ascending: false })
    .limit(500);
  if (error)
    throw describeSupabaseError(error, "Gagal memuat posisi pelapor");

  return ((data ?? []) as Array<{
    regu_id: string;
    latitude: number;
    longitude: number;
    accuracy_m: number | null;
    diupdate_pada: string;
    regu?: { nama_regu?: string; unit_key?: string | null; wilayah_key?: string | null } | null;
  }>).map((row) => ({
    regu_id: row.regu_id,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy_m: row.accuracy_m,
    diupdate_pada: row.diupdate_pada,
    nama_regu: row.regu?.nama_regu ?? "Pelapor",
    unit_key: row.regu?.unit_key ?? null,
    wilayah_key: row.regu?.wilayah_key ?? null,
  }));
}

/**
 * Kirim posisi GPS pelapor ke tabel `posisi` (upsert per regu).
 * Dipanggil tracker lokasi di app pelapor tiap 60 detik selama app
 * terbuka. Gagal (mis. offline) tidak dilempar — antrian offline yang
 * menangani pengiriman ulang.
 */
export async function upsertPosisi(p: {
  reguId: string;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  kecepatanMps?: number | null;
}): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("posisi").upsert(
    {
      regu_id: p.reguId,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy_m: p.accuracyM ?? null,
      kecepatan_mps: p.kecepatanMps ?? null,
      diupdate_pada: new Date().toISOString(),
    },
    { onConflict: "regu_id" },
  );
  if (error) throw describeSupabaseError(error, "Gagal mengirim posisi");
}

/**
 * Berlangganan perubahan tabel `posisi` (realtime) — dipakai peta
 * dashboard agar marker personel bergerak tanpa reload.
 */
export function subscribePosisi(cb: () => void): () => void {
  const client = requireClient();
  const channel = client
    .channel(`posisi-changes:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "posisi" },
      () => cb(),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

// ---------- Heartbeat versi app pelapor ----------

/**
 * Kirim versi build app pelapor ke tabel `regu` (heartbeat).
 * Dipanggil saat app dibuka, kembali ke foreground, dan tiap kirim
 * posisi — supaya dashboard tahu personel mana yang app-nya belum
 * di-update (badge "Versi lama" di Manajemen Personel).
 * Gagal diam-diam: heartbeat tidak boleh mengganggu pemakaian app.
 */
export async function laporkanVersiApp(reguId: string, versi: string): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from("regu")
    .update({
      app_version: versi,
      versi_dikirim_pada: new Date().toISOString(),
    })
    .eq("id", reguId);
  // RLS membatasi update ke baris sendiri — cukup diam bila gagal.
  if (error) console.debug("laporkanVersiApp:", error.message);
}

export function wilayahLabel(key: string): string {
  const map: Record<string, string> = {
    kota: "Purwakarta Kota",
    plered: "Plered",
    jatiluhur: "Jatiluhur",
    bungursari: "Bungursari",
    campaka: "Campaka",
    cibatu: "Cibatu",
    pasawahan: "Pasawahan",
    darangdan: "Darangdan",
    wanayasa: "Wanayasa",
    maniis: "Maniis",
    sukatani: "Sukatani",
    sukasari: "Sukasari",
    kiarapedes: "Kiarapedes",
    bojong: "Bojong",
  };
  return (
    map[key] ??
    key
      .split(/[-_ ]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
  );
}

export function unitLabel(key: string): string {
  // Samakan dengan unitNames di src/lib/regu.ts — penamaan resmi satuan
  // Polres (Satintelkam, Satreskrim, dst.) sesuai nama akun pelapor.
  const map: Record<string, string> = {
    intelkam: "Satintelkam",
    reskrim: "Satreskrim",
    narkoba: "Satresnarkoba",
    binmas: "Satbinmas",
    samapta: "Satsamapta",
    pamobvit: "Pam Obvit Samapta",
    lantas: "Satlantas",
    polair: "Satpolairud",
    tahti: "Sattahti",
    spkt: "SPKT",
  };
  return (
    map[key] ??
    key
      .split(/[-_ ]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
  );
}

/** URL publik foto dari Storage. */
export function fotoUrl(storagePath: string): string {
  const client = requireClient();
  const { data } = client.storage
    .from("laporan-foto")
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Unduh file dari Storage sebagai blob, lalu simpan via <a download>.
 *
 * Atribut `download` pada <a> DIABAIKAN browser bila URL-nya lintas domain
 * (mis. supabase.co ≠ domain app) — halaman malah terbuka di tab baru.
 * Triknya: fetch file → buat object URL (same-origin) → klik <a download>
 * sehingga browser langsung membuka dialog simpan file.
 */
export async function unduhFileStorage(
  storagePath: string,
  namaFile: string,
): Promise<void> {
  const client = requireClient();
  const { data } = client.storage
    .from("laporan-foto")
    .getPublicUrl(storagePath, { download: true });
  const res = await fetch(data.publicUrl);
  if (!res.ok) throw new Error(`Gagal mengambil file (HTTP ${res.status}).`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objUrl), 30_000);
}

/** Nama file yang ramah untuk unduhan, dari storage path
 *  `<reguId>/<laporanId>/foto/foto-1.jpg` → `laporan-<id>/foto-1.jpg`. */
export function namaFileUnduhan(storagePath: string): string {
  const parts = storagePath.split("/");
  const nama = parts[parts.length - 1] || "file";
  const laporanId = parts.length >= 2 ? parts[parts.length - 3] : undefined;
  return laporanId ? `laporan-${laporanId.slice(0, 8)}-${nama}` : nama;
}

/** URL publik video dari Storage. */
export function videoUrl(storagePath: string): string {
  const client = requireClient();
  const { data } = client.storage
    .from("laporan-foto")
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

// ---------- Realtime ----------

/** Subscribe perubahan tabel laporan & laporan_foto via Supabase Realtime.
 *  `cb` dipanggil untuk semua perubahan (refresh data);
 *  `onInsert` dipanggil khusus saat laporan BARU masuk (payload barisnya)
 *  — dipakai popup "Laporan baru". Realtime menghormati RLS, jadi
 *  pemantau hanya menerima laporan dalam cakupannya. */
export function subscribeLaporan(
  cb: () => void,
  onInsert?: (row: {
    id: string;
    regu_id: string;
    timestamp_kirim: string;
    catatan: string | null;
  }) => void,
): () => void {
  const client = requireClient();
  // Nama channel harus UNIK per langganan: `client.channel(nama)` mengembalikan
  // instance yang sama jika nama sudah dipakai, dan menambah callback
  // `postgres_changes` ke channel yang sudah di-subscribe akan throw.
  // AdminApp, MonitoringScreen, dan ReguApp bisa subscribe bersamaan.
  const channel = client
    .channel(`laporan-changes:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "laporan" },
      (payload) => {
        cb();
        if (!onInsert) return;
        const newRow = payload.new as
          | {
              id?: string;
              regu_id?: string;
              timestamp_kirim?: string;
              catatan?: string | null;
            }
          | undefined;
        if (newRow?.id && newRow?.regu_id) {
          onInsert({
            id: newRow.id,
            regu_id: newRow.regu_id,
            timestamp_kirim: newRow.timestamp_kirim ?? new Date().toISOString(),
            catatan: newRow.catatan ?? null,
          });
        }
      },
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
