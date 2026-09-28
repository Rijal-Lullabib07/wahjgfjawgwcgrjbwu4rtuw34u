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
 * Adapter data — Auth/master data via Supabase; domain laporan via backend lokal.
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

function describeAuthError(error: {
  message?: string;
  status?: number;
}): Error {
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
    .select(
      "id, nama, email, role, username, access_level, scope_key, status_aktif",
    )
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
 * Jenis ketikan pelapor (custom): cari jenis dengan nama sama (tidak
 * sensitif kapital) dan pakai; bila belum ada, daftarkan sebagai jenis
 * baru kategori tersebut. Lewat RPC SECURITY DEFINER karena RLS menolak
 * insert jenis_laporan dari role regu (migration 0027).
 * Gagal (mis. RPC belum dipasang) tidak menggagalkan laporan — kembalikan
 * null agar laporan tetap terkirim tanpa jenis.
 */
export async function pakaiJenisCustom(
  kategori: KategoriLaporan,
  nama: string,
): Promise<string | null> {
  const client = requireClient();
  const { data, error } = await client.rpc("pakai_jenis_custom", {
    p_kategori: kategori,
    p_nama: nama,
  });
  if (error) {
    console.debug("pakaiJenisCustom:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
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
  const { error } = await client
    .from("jenis_laporan")
    .update(patch)
    .eq("id", id);
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

  const client = requireClient();

  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError) {
    throw new Error(`Gagal membaca session login: ${sessionError.message}`);
  }

  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error("Session login tidak tersedia.");
  }

  const apiUrl = import.meta.env.VITE_LOCAL_API_URL;

  if (!apiUrl) {
    throw new Error("VITE_LOCAL_API_URL belum dikonfigurasi.");
  }

  const params = new URLSearchParams();

  if (filter.reguId) params.set("reguId", filter.reguId);
  if (filter.kategori) params.set("kategori", filter.kategori);
  if (filter.from) params.set("from", filter.from.toISOString());
  if (filter.to) params.set("to", filter.to.toISOString());

  params.set("limit", String(filter.limit ?? 500));

  const response = await fetch(`${apiUrl}/api/laporan?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  let result: {
    ok?: boolean;
    data?: Laporan[];
    error?: string;
  };

  try {
    result = await response.json();
  } catch {
    throw new Error(
      `Server lokal memberi respons tidak valid (${response.status}).`,
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      result.error ??
        `Gagal memuat laporan dari server lokal (${response.status}).`,
    );
  }

  const localRows = result.data ?? [];

  const reguIds = Array.from(
    new Set(localRows.map((row) => row.regu_id).filter(Boolean)),
  );

  const jenisIds = Array.from(
    new Set(
      localRows
        .map((row) => row.jenis_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const reguMap = new Map<string, Regu>();

  if (reguIds.length > 0) {
    const { data: reguRows, error: reguError } = await client
      .from("regu")
      .select("*")
      .in("id", reguIds);

    if (reguError) {
      throw describeSupabaseError(reguError, "Gagal memuat data pelapor");
    }

    for (const regu of reguRows ?? []) {
      reguMap.set(regu.id, regu as Regu);
    }
  }

  const jenisMap = new Map<string, JenisLaporan>();

  if (jenisIds.length > 0) {
    const { data: jenisRows, error: jenisError } = await client
      .from("jenis_laporan")
      .select("*")
      .in("id", jenisIds);

    if (jenisError) {
      throw describeSupabaseError(jenisError, "Gagal memuat jenis laporan");
    }

    for (const jenis of jenisRows ?? []) {
      jenisMap.set(jenis.id, jenis as JenisLaporan);
    }
  }

  const normalized = localRows.map((row) => {
    const nrpDb = row.nrp_pelapor as unknown;

    const nrpText = Array.isArray(nrpDb)
      ? nrpDb.filter(Boolean).join(", ") || null
      : ((nrpDb as string | null) ?? null);

    return {
      ...row,
      nrp_pelapor: nrpText,
      regu: reguMap.get(row.regu_id) ?? row.regu ?? null,
      jenis: row.jenis_id
        ? (jenisMap.get(row.jenis_id) ?? row.jenis ?? null)
        : null,
      fotos: Array.isArray(row.fotos)
        ? row.fotos
        : row.fotos
          ? [row.fotos]
          : [],
      videos: Array.isArray(row.videos)
        ? row.videos
        : row.videos
          ? [row.videos]
          : [],
    } as Laporan;
  });

  const limit = filter.limit ?? 500;

  const sortByNewest = (a: Laporan, b: Laporan) =>
    new Date(b.timestamp_kirim).getTime() -
    new Date(a.timestamp_kirim).getTime();

  if (isDashboardDemo) {
    const realRows = [...normalized].sort(sortByNewest);

    const demoRowsForDisplay = [...demoRows]
      .sort(sortByNewest)
      .slice(0, Math.max(0, limit - realRows.length));

    return [...realRows, ...demoRowsForDisplay].sort(sortByNewest);
  }

  return normalized.sort(sortByNewest).slice(0, limit);
}

export async function submitLaporan(
  q: QueuedLaporan,
  blobs: Blob[],
  videoBlobs: Blob[] = [],
): Promise<string> {
  const client = requireClient();

  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError) {
    throw new Error(`Gagal membaca session login: ${sessionError.message}`);
  }

  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error("Session login tidak tersedia.");
  }

  const apiUrl = import.meta.env.VITE_LOCAL_API_URL;

  if (!apiUrl) {
    throw new Error("VITE_LOCAL_API_URL belum dikonfigurasi.");
  }

  const nrpLama = (q as { nrp?: string | null }).nrp?.trim() ?? "";

  const nrpList = Array.from(
    new Set(
      [...(q.nrpList ?? []), nrpLama].map((n) => n.trim()).filter(Boolean),
    ),
  );

  let jenisIdFinal: string | null = q.jenisId ?? null;

  const jenisCustomNama = q.jenisCustom?.trim() ?? "";

  if (!jenisIdFinal && jenisCustomNama) {
    jenisIdFinal = await pakaiJenisCustom(q.kategori, jenisCustomNama);
  }

  const metadata = {
    reguId: q.reguId,
    timestampKirim: q.timestampKirim,
    siklusKe: q.siklusKe,
    latitude: q.latitude,
    longitude: q.longitude,
    catatan: q.catatan ?? null,
    kategori: q.kategori,
    jenisId: jenisIdFinal,
    tahap: q.tahap,
    parentId: q.parentId ?? null,
    perihal: q.perihal ?? null,
    nrpList: nrpList.length > 0 ? nrpList : null,

    fotos: (q.fotos ?? []).map((foto) => ({
      watermarkLat: foto.watermarkLat ?? null,
      watermarkLng: foto.watermarkLng ?? null,
      watermarkTimestamp: foto.watermarkTimestamp ?? null,
      urutan: foto.urutan,
    })),

    videos: (q.videos ?? []).map((video) => ({
      watermarkLat: video.watermarkLat ?? null,
      watermarkLng: video.watermarkLng ?? null,
      watermarkTimestamp: video.watermarkTimestamp ?? null,
      durationSeconds: video.durationSeconds ?? null,
    })),
  };

  const formData = new FormData();

  formData.append("metadata", JSON.stringify(metadata));

  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];

    if (!blob || blob.size === 0) {
      throw new Error(`Data foto ${i + 1} tidak tersedia.`);
    }

    formData.append("foto", blob, `foto-${i + 1}.jpg`);
  }

  for (let i = 0; i < videoBlobs.length; i++) {
    const blob = videoBlobs[i];

    if (!blob || blob.size === 0) {
      throw new Error("Data video tidak tersedia untuk dikirim.");
    }

    let ext = "webm";

    if (blob.type.includes("mp4")) {
      ext = "mp4";
    } else if (blob.type.includes("quicktime")) {
      ext = "mov";
    }

    formData.append("video", blob, `video-${i + 1}.${ext}`);
  }

  const response = await fetch(`${apiUrl}/api/laporan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  let result: {
    ok?: boolean;
    id?: string;
    error?: string;
  };

  try {
    result = await response.json();
  } catch {
    throw new Error(
      `Server lokal memberi respons tidak valid (${response.status}).`,
    );
  }

  if (!response.ok || !result.ok || !result.id) {
    throw new Error(
      result.error ?? `Gagal mengirim laporan (${response.status}).`,
    );
  }

  return result.id;
}

/**
 * Rangkaian (thread) satu laporan awal: induk + semua turunannya
 * urut waktu. RLS tetap berlaku — hanya rangkaian milik sendiri atau
 * dalam cakupan yang bisa diambil.
 */
export async function fetchLaporanThread(rootId: string): Promise<Laporan[]> {
  const client = requireClient();

  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError) {
    throw new Error(`Gagal membaca session login: ${sessionError.message}`);
  }

  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error("Session login tidak tersedia.");
  }

  const apiUrl = import.meta.env.VITE_LOCAL_API_URL;

  if (!apiUrl) {
    throw new Error("VITE_LOCAL_API_URL belum dikonfigurasi.");
  }

  const response = await fetch(`${apiUrl}/api/laporan/${rootId}/thread`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.error ?? `Gagal memuat rangkaian laporan (${response.status}).`,
    );
  }

  const rows = (result.data ?? []) as Laporan[];

  return rows.map((row) => {
    const nrpDb = row.nrp_pelapor as unknown;

    const nrpText = Array.isArray(nrpDb)
      ? nrpDb.filter(Boolean).join(", ") || null
      : ((nrpDb as string | null) ?? null);

    return {
      ...row,
      nrp_pelapor: nrpText,
      fotos: Array.isArray(row.fotos)
        ? row.fotos
        : row.fotos
          ? [row.fotos]
          : [],
      videos: Array.isArray(row.videos)
        ? row.videos
        : row.videos
          ? [row.videos]
          : [],
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

  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError) {
    throw new Error(`Gagal membaca session login: ${sessionError.message}`);
  }

  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error("Session login tidak tersedia.");
  }

  const apiUrl = import.meta.env.VITE_LOCAL_API_URL;

  if (!apiUrl) {
    throw new Error("VITE_LOCAL_API_URL belum dikonfigurasi.");
  }

  const response = await fetch(
    `${apiUrl}/api/laporan/open/${encodeURIComponent(reguId)}?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.error ?? `Gagal memuat laporan berjalan (${response.status}).`,
    );
  }

  return (result.data ?? []) as Array<Laporan & { child_count: number }>;
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
    const unitKey = (regu?.unit_key ?? "").trim().toLowerCase();
    const wilayahKey = (regu?.wilayah_key ?? "").trim().toLowerCase();
    if (wilayahKey) {
      perWilayah.set(wilayahKey, (perWilayah.get(wilayahKey) ?? 0) + 1);
    }
    // Fungsi dihitung dari SEMUA pelapor ber-unit_key: satuan Polres
    // (pelapor-level-2, wilayah kosong) DAN unit di Polsek (pelapor-level-1,
    // mis. spkt di Jatiluhur). Sebelumnya laporan unit Polsek tidak masuk
    // grafik fungsi sama sekali → "Monitoring Fungsi" Kapolsek selalu kosong.
    if (unitKey) {
      perUnit.set(unitKey, (perUnit.get(unitKey) ?? 0) + 1);
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
  if (error) throw describeSupabaseError(error, "Gagal memuat posisi pelapor");

  return (
    (data ?? []) as Array<{
      regu_id: string;
      latitude: number;
      longitude: number;
      accuracy_m: number | null;
      diupdate_pada: string;
      regu?: {
        nama_regu?: string;
        unit_key?: string | null;
        wilayah_key?: string | null;
      } | null;
    }>
  ).map((row) => ({
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
export async function laporkanVersiApp(
  reguId: string,
  versi: string,
): Promise<void> {
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
  const apiUrl = import.meta.env.VITE_LOCAL_API_URL;

  if (!apiUrl) {
    throw new Error("VITE_LOCAL_API_URL belum dikonfigurasi.");
  }

  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    return storagePath;
  }

  if (storagePath.startsWith("/")) {
    return `${apiUrl}${storagePath}`;
  }

  return `${apiUrl}/${storagePath}`;
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
  const apiUrl = import.meta.env.VITE_LOCAL_API_URL;

  if (!apiUrl) {
    throw new Error("VITE_LOCAL_API_URL belum dikonfigurasi.");
  }

  let fileUrl: string;

  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    fileUrl = storagePath;
  } else if (storagePath.startsWith("/")) {
    fileUrl = `${apiUrl}${storagePath}`;
  } else {
    fileUrl = `${apiUrl}/${storagePath}`;
  }

  const res = await fetch(fileUrl);

  if (!res.ok) {
    throw new Error(`Gagal mengambil file (HTTP ${res.status}).`);
  }

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
  const apiUrl = import.meta.env.VITE_LOCAL_API_URL;

  if (!apiUrl) {
    throw new Error("VITE_LOCAL_API_URL belum dikonfigurasi.");
  }

  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    return storagePath;
  }

  if (storagePath.startsWith("/")) {
    return `${apiUrl}${storagePath}`;
  }

  return `${apiUrl}/${storagePath}`;
}

// ---------- Realtime ----------

/**
 * Subscribe perubahan laporan lokal via polling backend.
 *
 * Polling hanya dijalankan untuk akun pemantau.
 * Akun pelapor (@regu.siplap.id) tidak melakukan polling global karena
 * endpoint GET /api/laporan tanpa reguId memang tidak diizinkan untuk pelapor.
 */
export function subscribeLaporan(
  cb: () => void,
  onInsert?: (row: {
    id: string;
    regu_id: string;
    timestamp_kirim: string;
    catatan: string | null;
  }) => void,
): () => void {
  let stopped = false;
  let initialized = false;
  let lastSeenId: string | null = null;

  const poll = async () => {
    if (stopped) return;

    try {
      const client = requireClient();

      const { data: sessionData, error: sessionError } =
        await client.auth.getSession();

      if (sessionError) {
        console.debug("subscribeLaporan session:", sessionError.message);
        return;
      }

      const email = sessionData.session?.user?.email?.toLowerCase() ?? "";

      // Akun pelapor tidak boleh melakukan GET laporan global.
      // Submit, open thread, dan thread milik pelapor tetap berjalan normal.
      if (email.endsWith("@regu.siplap.id")) {
        initialized = true;
        lastSeenId = null;
        return;
      }

      // Belum login / session sudah hilang.
      if (!sessionData.session) {
        initialized = false;
        lastSeenId = null;
        return;
      }

      const rows = await fetchLaporan({
        limit: 1,
      });

      const newest = rows[0];

      if (!initialized) {
        lastSeenId = newest?.id ?? null;
        initialized = true;
        return;
      }

      if (newest && newest.id !== lastSeenId) {
        lastSeenId = newest.id;

        cb();

        if (onInsert) {
          onInsert({
            id: newest.id,
            regu_id: newest.regu_id,
            timestamp_kirim: newest.timestamp_kirim,
            catatan: newest.catatan ?? null,
          });
        }
      }
    } catch (error) {
      console.debug(
        "subscribeLaporan polling:",
        error instanceof Error ? error.message : error,
      );
    }
  };

  void poll();

  const intervalId = window.setInterval(() => {
    void poll();
  }, 10_000);

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
  };
}
