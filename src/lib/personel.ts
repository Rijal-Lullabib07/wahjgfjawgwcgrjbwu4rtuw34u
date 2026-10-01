import { supabase } from "./supabase/client";

/**
 * Direktori personel Polri (tabel personel_polri di Supabase — migration
 * 0028). Dipakai mencocokkan NRP laporan dengan pangkat/nama/jabatan dari
 * LAPBUL. Read-only untuk client; import lewat scripts/import-personel.mjs.
 */

export interface PersonelPolri {
  nrp: string;
  nama: string;
  pangkat: string;
  jabatan: string;
  /** Fungsi personel (LAPBUL — DATA PERSONEL FIX): RESKRIM, SAMAPTA, dst. */
  fungsi?: string | null;
  /** Satuan personel (LAPBUL — DATA PERSONEL FIX): POLRES/POLSEK <nama>. */
  satuan?: string | null;
  /** Status kepegawaian (LAPBUL — DATA PERSONEL FIX): AKTIF, dst. */
  status?: string | null;
}

/**
 * Koreksi jabatan MANUAL (sisi tampilan saja — database TIDAK diubah).
 * Sumber LAPBUL masih mencantumkan jabatan lama; daftar ini menimpanya
 * saat data ditampilkan. Hapus entri di sini bila file LAPBUL/DB sudah
 * diperbarui lewat import ulang.
 */
const KOREKSI_JABATAN: Record<string, string> = {
  // AIPDA Didi Suryadi — benar: Banit Binmas (bukan Banit Samapta)
  "74020484": "BANIT BINMAS",
  // AIPDA RE Deden Tajudin — benar: Bhabinkamtibmas (bukan Banit Samapta/Bhabinkamtibmas)
  "77121038": "BHABINKAMTIBMAS",
  // Brigadir Giri (Giri Rukmantara, S.H.) — benar: Bhabinkamtibmas
  "97010046": "BHABINKAMTIBMAS",
};

/** Terapkan koreksi jabatan manual ke satu baris personel. */
function terapkanKoreksi(p: PersonelPolri): PersonelPolri {
  const koreksi = KOREKSI_JABATAN[p.nrp];
  return koreksi && p.jabatan !== koreksi ? { ...p, jabatan: koreksi } : p;
}

/**
 * Tampilan satu personel: "PANGKAT Nama (Jabatan)" — bila personel punya
 * FUNGSI (DATA PERSONEL FIX): "PANGKAT Nama (Jabatan) — FUNGSI".
 */
export function personelFormat(p: PersonelPolri | null | undefined): string {
  if (!p) return "";
  const dasar = `${p.pangkat} ${p.nama} (${p.jabatan})`;
  const fungsi = p.fungsi?.trim();
  return fungsi ? `${dasar} — ${fungsi}` : dasar;
}

/** Alias lama — format sama dengan personelFormat. */
export function personelLabel(p: PersonelPolri | null | undefined): string {
  return personelFormat(p);
}

/** Tampilan personel ringkas: "PANGKAT Nama". */
export function personelLabelSingkat(p: PersonelPolri | null | undefined): string {
  if (!p) return "";
  return `${p.pangkat} ${p.nama}`;
}

/**
 * Tampilan validasi NRP di form pelapor:
 * "PANGKAT Nama — Jabatan — FUNGSI" (FUNGSI dilewati bila kosong).
 */
export function personelFormatValidasi(p: PersonelPolri | null | undefined): string {
  if (!p) return "";
  const fungsi = p.fungsi?.trim();
  return fungsi ? `${p.pangkat} ${p.nama} — ${p.jabatan} — ${fungsi}` : `${p.pangkat} ${p.nama} — ${p.jabatan}`;
}

/**
 * Bangun teks pencocokan NRP → personel untuk satu laporan:
 *   AKBP Febri Nurzam (Kapolres) - KOMPOL Yudi (Wakapolres) - dst…
 *  - ≤ maxTampil personel : ditampilkan semua
 *  - > maxTampil          : maxTampil pertama + "… +N personel"
 * NRP yang tidak ada di direktori tetap tampil polos "NRP xxx".
 * Menerima nrp_pelapor bentuk apa pun (string "a, b" atau string[] dari RPC).
 */
export function ringkasPersonel(
  nrpText: string | string[] | null | undefined,
  map: Map<string, PersonelPolri>,
  maxTampil = 2,
): string {
  const nrpList = (
    Array.isArray(nrpText)
      ? nrpText
      : (nrpText ?? "").split(",")
  )
    .map((n) => String(n).trim())
    .filter(Boolean);
  if (nrpList.length === 0) return "";
  const labels = nrpList.map((nrp) => {
    const p = map.get(nrp);
    return p ? personelFormat(p) : `NRP ${nrp}`;
  });
  if (labels.length <= maxTampil) return labels.join(" - ");
  return `${labels.slice(0, maxTampil).join(" - ")} - … +${labels.length - maxTampil} personel`;
}

// ---------- Cache in-memory (1 sesi browser) ----------

let cache: Map<string, PersonelPolri> | null = null;
let cachePromise: Promise<Map<string, PersonelPolri>> | null = null;

/**
 * Muat seluruh direktori personel (±773 baris — ringan) sekali per sesi.
 * Gagal (mis. tabel belum dibuat) → cache kosong, lookup mengembalikan null
 * dan pemanggil tetap menampilkan NRP polos. Tidak pernah melempar error.
 */
async function loadCache(): Promise<Map<string, PersonelPolri>> {
  if (cache) return cache;
  if (!cachePromise) {
    const promise = (async () => {
      const map = new Map<string, PersonelPolri>();
      if (!supabase) return map;
      try {
        const { data, error } = await supabase
          .from("personel_polri")
          .select("nrp, nama, pangkat, jabatan, fungsi, satuan, status");
        if (error) {
          console.warn("personel_polri gagal dimuat:", error.message);
          return map;
        }
        for (const row of (data ?? []) as PersonelPolri[]) {
          map.set(row.nrp, terapkanKoreksi(row));
        }
      } catch (e) {
        console.warn("personel_polri gagal dimuat:", e);
      }
      return map;
    })();
    cachePromise = promise;
    void promise.then((m) => {
      cache = m;
    });
  }
  return cachePromise;
}

/** Lookup satu NRP. Null bila tidak ketemu / direktori tidak tersedia. */
export async function cariPersonel(nrp: string): Promise<PersonelPolri | null> {
  const key = nrp.trim();
  if (!key) return null;
  const map = await loadCache();
  return map.get(key) ?? null;
}

/** Lookup banyak NRP sekaligus (satu laporan bisa >1 personel). */
export async function cariPersonelBatch(
  nrpList: string[],
): Promise<Map<string, PersonelPolri>> {
  const map = await loadCache();
  const out = new Map<string, PersonelPolri>();
  for (const nrp of nrpList) {
    const p = map.get(nrp.trim());
    if (p) out.set(nrp.trim(), p);
  }
  return out;
}

/** Bersihkan cache (dipakai kalau admin selesai import data baru). */
export function resetPersonelCache(): void {
  cache = null;
  cachePromise = null;
}
