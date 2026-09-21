import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";

/** Panggil Edge Function manage-personel dengan sesi admin saat ini. */
async function callManagePersonel(
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; error?: string }> {
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");
  const { data: sesi } = await supabase.auth.getSession();
  const token = sesi.session?.access_token;
  if (!token) throw new Error("Sesi admin tidak ditemukan — login ulang.");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-personel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/**
 * Menu 🗂️ Manajemen Data — KELOLA PERSONEL saja.
 *
 * - Nama dan Jabatan dipisah (kolom regu.jabatan).
 * - Tambah akun lewat RPC `buat_akun_personel` (membuat user auth +
 *   baris regu sekaligus) → PIN ditampilkan sekali ke admin.
 * - Edit nama/jabatan/kode, aktif/nonaktif, reset PIN. Tanpa hapus.
 */

interface ReguRow {
  id: string;
  nama_regu: string;
  jabatan: string | null;
  kode_login: string;
  status_aktif: boolean;
  unit_key: string | null;
  wilayah_key: string | null;
}

interface AdminRow {
  id: string;
  nama: string;
  role: string;
  username: string | null;
  status_aktif: boolean;
}

/** PostgREST error → pesan Indonesia yang bisa dibaca. */
function pesanError(e: unknown, fallback: string): string {
  const raw =
    e instanceof Error ? e.message : typeof e === "string" ? e : "";
  // Edge function belum dideploy → 404.
  if (raw.includes("404") || raw.includes("Not Found")) {
    return "Edge function belum dideploy: jalankan `supabase functions deploy manage-personel`, lalu refresh halaman.";
  }
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError")) {
    return "Tidak bisa menghubungi server. Periksa koneksi internet.";
  }
  try {
    const parsed = JSON.parse(raw) as { message?: string; hint?: string };
    if (parsed?.message) {
      return parsed.hint ? `${parsed.message} (${parsed.hint})` : parsed.message;
    }
  } catch {
    /* bukan JSON */
  }
  if (raw && raw !== "[object Object]") return raw;
  return fallback;
}

function ToggleStatus({
  aktif,
  busy,
  onToggle,
}: {
  aktif: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      className={
        "badge transition disabled:opacity-50 " +
        (aktif
          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "bg-slate-100 text-slate-500 hover:bg-slate-200")
      }
      title={aktif ? "Klik untuk nonaktifkan" : "Klik untuk aktifkan"}
    >
      {aktif ? "● Aktif" : "○ Nonaktif"}
    </button>
  );
}

/** Kartu "PIN sementara" — tampil setelah tambah akun / reset PIN. */
function PinReveal({
  kode,
  pin,
  onClose,
}: {
  kode: string;
  pin: string;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
      <div className="text-sm font-bold text-emerald-800">
        ✅ Akun dibuat — catat PIN sekarang
      </div>
      <p className="mt-1 text-xs text-emerald-700">
        PIN hanya ditampilkan sekali ini. Bagikan ke personel bersama kode
        login-nya.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">Kode login</div>
          <code className="text-sm font-bold text-slate-800">{kode}</code>
        </div>
        <div className="rounded-xl bg-white px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">PIN</div>
          <code className="text-sm font-bold text-emerald-700">{pin}</code>
        </div>
      </div>
      <button
        onClick={onClose}
        className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
      >
        Sudah saya catat
      </button>
    </div>
  );
}

export default function ManagementScreen() {
  const [pelapor, setPelapor] = useState<ReguRow[] | null>(null);
  const [pemantau, setPemantau] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pinBaru, setPinBaru] = useState<{ kode: string; pin: string } | null>(null);
  const [form, setForm] = useState({
    nama: "",
    jabatan: "",
    kode: "",
    pin: "",
    unitKey: "",
    wilayahKey: "",
    level: "pelapor-level-1" as "pelapor-level-1" | "pelapor-level-2",
  });

  const load = useCallback(async () => {
    try {
      const client = supabase!;
      const [{ data: reguData, error: reguErr }, { data: adminData, error: adminErr }] =
        await Promise.all([
          client
            .from("regu")
            .select(
              "id, nama_regu, jabatan, kode_login, status_aktif, unit_key, wilayah_key",
            )
            .order("nama_regu"),
          client
            .from("admin_users")
            .select("id, nama, role, username, status_aktif")
            .order("nama"),
        ]);
      if (reguErr) throw reguErr;
      if (adminErr) throw adminErr;
      setPelapor((reguData ?? []) as ReguRow[]);
      setPemantau((adminData ?? []) as AdminRow[]);
      setError(null);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw.includes("status_aktif")) {
        setError(
          "Kolom status_aktif belum ada. Jalankan migration 0016_manajemen_personel.sql di Supabase SQL Editor dulu.",
        );
      } else {
        setError(pesanError(e, "Gagal memuat data personel."));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Tambah akun personel via RPC (auth + regu). */
  const addPelapor = async () => {
    if (!form.nama.trim() || !form.kode.trim()) {
      setError("Nama dan kode login wajib diisi.");
      return;
    }
    if (form.pin.trim().length < 4) {
      setError("PIN minimal 4 karakter.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const hasil = await callManagePersonel({
        action: "buat",
        nama: form.nama.trim(),
        jabatan: form.jabatan.trim(),
        kode_login: form.kode.trim().toLowerCase(),
        pin: form.pin.trim(),
        unit_key: form.unitKey.trim().toLowerCase() || null,
        wilayah_key: form.wilayahKey.trim().toLowerCase() || null,
        access_level: form.level,
      });
      setPinBaru({
        kode: (hasil as { kode_login?: string }).kode_login ?? form.kode.trim().toLowerCase(),
        pin: (hasil as { pin?: string }).pin ?? form.pin.trim(),
      });
      setForm({
        nama: "",
        jabatan: "",
        kode: "",
        pin: "",
        unitKey: "",
        wilayahKey: "",
        level: "pelapor-level-1",
      });
      await load();
    } catch (e) {
      setError(pesanError(e, "Gagal menambah personel. Pastikan edge function manage-personel sudah dideploy."));
    } finally {
      setAdding(false);
    }
  };

  const editRegu = async (row: ReguRow) => {
    const nama = window.prompt("Nama lengkap:", row.nama_regu);
    if (nama === null) return;
    const jabatan = window.prompt("Jabatan:", row.jabatan ?? "");
    if (jabatan === null) return;
    const kode = window.prompt("Kode login:", row.kode_login);
    if (kode === null) return;
    setBusyId(row.id);
    setError(null);
    try {
      const { error: err } = await supabase!
        .from("regu")
        .update({
          nama_regu: nama.trim() || row.nama_regu,
          jabatan: jabatan.trim() || null,
          kode_login: kode.trim().toLowerCase() || row.kode_login,
        })
        .eq("id", row.id);
      if (err) throw err;
      await load();
    } catch (e) {
      setError(pesanError(e, "Gagal mengubah data personel."));
    } finally {
      setBusyId(null);
    }
  };

  const toggleRegu = async (row: ReguRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      const { error: err } = await supabase!
        .from("regu")
        .update({ status_aktif: !row.status_aktif })
        .eq("id", row.id);
      if (err) throw err;
      await load();
    } catch (e) {
      setError(pesanError(e, "Gagal mengubah status. Pastikan migration 0016 sudah dijalankan."));
    } finally {
      setBusyId(null);
    }
  };

  const toggleAdmin = async (row: AdminRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      const { error: err } = await supabase!
        .from("admin_users")
        .update({ status_aktif: !row.status_aktif })
        .eq("id", row.id);
      if (err) throw err;
      await load();
    } catch (e) {
      setError(pesanError(e, "Gagal mengubah status pemantau."));
    } finally {
      setBusyId(null);
    }
  };

  const resetPin = async (row: ReguRow) => {
    const pin = window.prompt(`PIN baru untuk ${row.kode_login}: (minimal 4 karakter)`);
    if (pin === null) return;
    if (pin.trim().length < 4) {
      setError("PIN minimal 4 karakter.");
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await callManagePersonel({
        action: "reset_pin",
        kode_login: row.kode_login,
        pin_baru: pin.trim(),
      });
      setPinBaru({ kode: row.kode_login, pin: pin.trim() });
    } catch (e) {
      setError(pesanError(e, "Gagal reset PIN. Pastikan edge function manage-personel sudah dideploy."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <div className="eyebrow">Manajemen data</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
          Manajemen Personel
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Kelola akun personel lapangan & pemantau. Tidak ada hapus permanen —
          gunakan status nonaktif.
        </p>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {pinBaru && (
        <PinReveal
          kode={pinBaru.kode}
          pin={pinBaru.pin}
          onClose={() => setPinBaru(null)}
        />
      )}

      {/* ===== Tambah akun ===== */}
      <section className="card">
        <div className="eyebrow">Tambah akun personel</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-500">
            Nama lengkap
            <input
              className="input mt-1"
              value={form.nama}
              onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
              placeholder="mis. Agung Setiawan"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Jabatan
            <input
              className="input mt-1"
              value={form.jabatan}
              onChange={(e) => setForm((f) => ({ ...f, jabatan: e.target.value }))}
              placeholder="mis. Aiptu — Anggota Regu 2"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Kode login
            <input
              className="input mt-1"
              value={form.kode}
              onChange={(e) => setForm((f) => ({ ...f, kode: e.target.value }))}
              placeholder="mis. agung.reskrimpolres"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            PIN awal (min. 4 karakter)
            <input
              className="input mt-1"
              value={form.pin}
              onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
              placeholder="mis. 1234"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Wilayah key (Polsek — kosongkan bila satuan)
            <input
              className="input mt-1"
              value={form.wilayahKey}
              onChange={(e) => setForm((f) => ({ ...f, wilayahKey: e.target.value }))}
              placeholder="mis. plered"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Unit key (satuan — kosongkan bila polsek)
            <input
              className="input mt-1"
              value={form.unitKey}
              onChange={(e) => setForm((f) => ({ ...f, unitKey: e.target.value }))}
              placeholder="mis. reskrim"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={adding}
            onClick={() => void addPelapor()}
          >
            {adding ? "Menyimpan…" : "+ Tambah personel"}
          </button>
          <span className="text-[11px] text-slate-500">
            Akun otomatis bisa langsung login di HP dengan kode + PIN ini.
          </span>
        </div>
      </section>

      {/* ===== Daftar pelapor ===== */}
      <section className="card p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-bold text-slate-800">Personel lapangan</h3>
          <span className="badge bg-sky-50 text-sky-700">
            {pelapor?.length ?? "…"} akun
          </span>
        </div>
        <div className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto">
          {(pelapor ?? []).map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-800">
                  {row.nama_regu}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {row.jabatan ? `${row.jabatan} · ` : ""}
                  {row.kode_login}
                  {row.wilayah_key ? ` · Polsek ${row.wilayah_key}` : ""}
                  {row.unit_key ? ` · ${row.unit_key}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ToggleStatus
                  aktif={row.status_aktif}
                  busy={busyId === row.id}
                  onToggle={() => void toggleRegu(row)}
                />
                <button
                  onClick={() => void resetPin(row)}
                  disabled={busyId === row.id}
                  className="text-xs font-semibold text-amber-600 hover:text-amber-700 disabled:opacity-50"
                  title="Ganti PIN akun ini"
                >
                  Reset PIN
                </button>
                <button
                  onClick={() => void editRegu(row)}
                  disabled={busyId === row.id}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
          {pelapor?.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Belum ada akun pelapor.
            </div>
          )}
        </div>
      </section>

      {/* ===== Daftar pemantau ===== */}
      <section className="card p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-bold text-slate-800">Pemantau / pimpinan</h3>
          <span className="badge bg-amber-50 text-amber-700">
            {pemantau?.length ?? "…"} akun
          </span>
        </div>
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {(pemantau ?? []).map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-800">
                  {row.nama}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {row.role}
                  {row.username ? ` · ${row.username}` : ""}
                </div>
              </div>
              <ToggleStatus
                aktif={row.status_aktif}
                busy={busyId === row.id}
                onToggle={() => void toggleAdmin(row)}
              />
            </div>
          ))}
          {pemantau === null && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Memuat…
            </div>
          )}
          {pemantau?.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Tidak ada data pemantau dalam cakupan Anda.
            </div>
          )}
        </div>
      </section>

      <p className="pb-2 text-center text-[11px] text-slate-400">
        Nama & jabatan personel tampil di kartu laporan dan daftar pelapor.
      </p>
    </div>
  );
}
