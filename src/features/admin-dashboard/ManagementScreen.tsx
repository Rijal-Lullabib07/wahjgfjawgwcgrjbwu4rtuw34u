import { useCallback, useEffect, useMemo, useState } from "react";
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
 * Menu 🗂️ Manajemen Data — kelola personel lapangan & pemantau/pimpinan.
 *
 * - Nama dan Jabatan dipisah (kolom regu.jabatan).
 * - Tambah akun lewat edge function `manage-personel` (membuat user
 *   auth + baris regu sekaligus) → PIN ditampilkan sekali ke admin.
 * - Edit (modal): nama, jabatan, username/kode login, PIN baru, dan
 *   status aktif/nonaktif — semuanya dalam satu form.
 * - Hapus permanen KHUSUS personel (laporan & foto ikut terhapus).
 * - Pemantau/pimpinan (admin_users): reset password, edit (nama,
 *   username, password, status), dan hapus permanen — lewat edge
 *   function yang sama dengan action *_pemantau.
 */

interface ReguRow {
  id: string;
  nama_regu: string;
  jabatan: string | null;
  kode_login: string;
  status_aktif: boolean;
  unit_key: string | null;
  wilayah_key: string | null;
  app_version: string | null;
  versi_dikirim_pada: string | null;
}

interface AdminRow {
  id: string;
  nama: string;
  email: string | null;
  role: string;
  username: string | null;
  status_aktif: boolean;
}

/** PostgREST error → pesan Indonesia yang bisa dibaca. */
function pesanError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
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
      return parsed.hint
        ? `${parsed.message} (${parsed.hint})`
        : parsed.message;
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

/** Kartu "PIN sementara" — tampil setelah tambah akun / reset PIN/password. */
function PinReveal({
  kode,
  pin,
  judul = "✅ Akun dibuat — catat PIN sekarang",
  labelKode = "Kode login",
  labelKredensial = "PIN",
  pesan = "PIN hanya ditampilkan sekali ini. Bagikan ke personel bersama kode login-nya.",
  onClose,
}: {
  kode: string;
  pin: string;
  judul?: string;
  labelKode?: string;
  labelKredensial?: string;
  pesan?: string;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
      <div className="text-sm font-bold text-emerald-800">{judul}</div>
      <p className="mt-1 text-xs text-emerald-700">{pesan}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">
            {labelKode}
          </div>
          <code className="text-sm font-bold text-slate-800">{kode}</code>
        </div>
        <div className="rounded-xl bg-white px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">
            {labelKredensial}
          </div>
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

/**
 * Status versi app personel: bandingkan versi yang dilaporkan device-nya
 * dengan versi build TERBARU yang diketahui server.
 *
 * `versiTerbaru` = versi build dari deployment terkini — dihitung klien
 * sebagai MAX(app_version) semua personel. Personel yang app-nya dibuka
 * setelah deploy terakhir pasti melaporkan versi itu; sisanya "versi lama".
 */
function StatusVersiBadge({
  row,
  versiTerbaru,
}: {
  row: Pick<ReguRow, "app_version" | "versi_dikirim_pada" | "status_aktif">;
  versiTerbaru: string | null;
}) {
  if (!row.app_version || !row.versi_dikirim_pada) {
    return (
      <span
        className="badge bg-slate-100 text-slate-400"
        title="App belum pernah melaporkan versi — belum buka app sejak fitur ini aktif"
      >
        ? belum lapor
      </span>
    );
  }
  const samaDenganTerbaru =
    versiTerbaru !== null && row.app_version === versiTerbaru;
  const umurJam =
    (Date.now() - new Date(row.versi_dikirim_pada).getTime()) / 3_600_000;
  // Lebih dari 48 jam tidak melaporkan diri → app jarang/ tidak dibuka.
  const tidakAktif = umurJam > 48;

  if (!samaDenganTerbaru) {
    return (
      <span
        className="badge bg-red-50 text-red-600"
        title={`Versi device: ${row.app_version}\nTerbaru: ${versiTerbaru ?? "?"}\nLapor terakhir: ${new Date(row.versi_dikirim_pada).toLocaleString("id-ID")}`}
      >
        ⬆ versi lama
      </span>
    );
  }
  if (tidakAktif) {
    return (
      <span
        className="badge bg-amber-50 text-amber-700"
        title={`Terbaru, tapi app tidak dibuka ${Math.floor(umurJam / 24)} hari`}
      >
        ~ jarang dibuka
      </span>
    );
  }
  return (
    <span
      className="badge bg-emerald-50 text-emerald-700"
      title="App versi terbaru"
    >
      ✓ terbaru
    </span>
  );
}

/**
 * Modal edit personel: nama, jabatan, username/kode login, PIN baru
 * (opsional), dan status aktif/nonaktif dalam satu form.
 */
function EditPersonelModal({
  row,
  busy,
  onClose,
  onSave,
}: {
  row: ReguRow;
  busy: boolean;
  onClose: () => void;
  onSave: (nilai: {
    nama: string;
    jabatan: string;
    kodeLogin: string;
    pin: string;
    aktif: boolean;
  }) => Promise<void>;
}) {
  const [nama, setNama] = useState(row.nama_regu);
  const [jabatan, setJabatan] = useState(row.jabatan ?? "");
  const [kode, setKode] = useState(row.kode_login);
  const [pin, setPin] = useState("");
  const [aktif, setAktif] = useState(row.status_aktif);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!nama.trim()) {
      setError("Nama lengkap wajib diisi.");
      return;
    }
    if (!kode.trim()) {
      setError("Username / kode login wajib diisi.");
      return;
    }
    if (pin.trim() && pin.trim().length < 4) {
      setError("PIN baru minimal 4 karakter (kosongkan bila tidak diubah).");
      return;
    }
    setError(null);
    try {
      await onSave({
        nama: nama.trim(),
        jabatan: jabatan.trim(),
        kodeLogin: kode.trim().toLowerCase(),
        pin: pin.trim(),
        aktif,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan perubahan.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="card w-full max-w-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Edit personel</div>
            <h3 className="mt-0.5 font-bold text-slate-800">{row.nama_regu}</h3>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-lg leading-none text-slate-400 hover:text-slate-600 disabled:opacity-40"
            title="Tutup tanpa menyimpan"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-500">
            Nama lengkap
            <input
              className="input mt-1"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="mis. Agung Setiawan"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Jabatan
            <input
              className="input mt-1"
              value={jabatan}
              onChange={(e) => setJabatan(e.target.value)}
              placeholder="mis. Aiptu — Anggota Regu 2"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Username / kode login
            <input
              className="input mt-1"
              value={kode}
              onChange={(e) => setKode(e.target.value)}
              placeholder="mis. agung.reskrimpolres"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            PIN baru (opsional)
            <input
              className="input mt-1"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Kosongkan bila tidak diubah"
            />
          </label>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2">
          <input
            type="checkbox"
            checked={aktif}
            onChange={(e) => setAktif(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-600"
          />
          <span className="text-xs">
            <span className="font-bold text-slate-700">Akun aktif</span>
            <span className="block text-slate-500">
              {aktif
                ? "Personel bisa login & kirim laporan."
                : "Nonaktif: personel tidak bisa login, datanya tetap tersimpan."}
            </span>
          </span>
        </label>

        {kode.trim().toLowerCase() !== row.kode_login.toLowerCase() && (
          <p className="mt-2 text-[11px] text-amber-600">
            ⚠️ Username berubah — personel harus login dengan username baru ini.
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Menyimpan…" : "Simpan perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal edit pemantau/pimpinan: nama, username, password baru (opsional),
 * dan status aktif/nonaktif dalam satu form.
 */
function EditPemantauModal({
  row,
  busy,
  onClose,
  onSave,
}: {
  row: AdminRow;
  busy: boolean;
  onClose: () => void;
  onSave: (nilai: {
    nama: string;
    username: string;
    password: string;
    aktif: boolean;
  }) => Promise<void>;
}) {
  const [nama, setNama] = useState(row.nama);
  const [username, setUsername] = useState(row.username ?? "");
  const [password, setPassword] = useState("");
  const [aktif, setAktif] = useState(row.status_aktif);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!nama.trim()) {
      setError("Nama wajib diisi.");
      return;
    }
    if (!username.trim()) {
      setError("Username wajib diisi.");
      return;
    }
    if (password.trim() && password.trim().length < 6) {
      setError(
        "Password baru minimal 6 karakter (kosongkan bila tidak diubah).",
      );
      return;
    }
    setError(null);
    try {
      await onSave({
        nama: nama.trim(),
        username: username.trim().toLowerCase(),
        password: password.trim(),
        aktif,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan perubahan.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="card w-full max-w-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Edit pemantau</div>
            <h3 className="mt-0.5 font-bold text-slate-800">{row.nama}</h3>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-lg leading-none text-slate-400 hover:text-slate-600 disabled:opacity-40"
            title="Tutup tanpa menyimpan"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-500">
            Nama
            <input
              className="input mt-1"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="mis. Kapolres Purwakarta"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Username / kode login
            <input
              className="input mt-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="mis. kapolres.purwakarta"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500 sm:col-span-2">
            Password baru (opsional)
            <input
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Kosongkan bila tidak diubah — min. 6 karakter"
            />
          </label>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2">
          <input
            type="checkbox"
            checked={aktif}
            onChange={(e) => setAktif(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-600"
          />
          <span className="text-xs">
            <span className="font-bold text-slate-700">Akun aktif</span>
            <span className="block text-slate-500">
              {aktif
                ? "Pemantau bisa login ke dashboard."
                : "Nonaktif: pemantau tidak bisa login, datanya tetap tersimpan."}
            </span>
          </span>
        </label>

        {username.trim().toLowerCase() !==
          (row.username ?? "").toLowerCase() && (
          <p className="mt-2 text-[11px] text-amber-600">
            ⚠️ Username berubah — pemantau harus login dengan username baru ini.
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Menyimpan…" : "Simpan perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManagementScreen() {
  const [pelapor, setPelapor] = useState<ReguRow[] | null>(null);
  const [pemantau, setPemantau] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Kata kunci pencarian — menyaring daftar personel & pemantau sekaligus. */
  const [cari, setCari] = useState("");
  const [pinBaru, setPinBaru] = useState<{
    kode: string;
    pin: string;
    judul?: string;
    labelKode?: string;
    labelKredensial?: string;
    pesan?: string;
  } | null>(null);
  /** Personel yang sedang diedit di modal. */
  const [editRow, setEditRow] = useState<ReguRow | null>(null);
  /** Pemantau yang sedang diedit di modal. */
  const [editAdminRow, setEditAdminRow] = useState<AdminRow | null>(null);
  /** Email akun yang sedang login — untuk cegah hapus diri sendiri. */
  const [emailSaya, setEmailSaya] = useState<string | null>(null);
  /** Versi build terbaru yang diketahui = yang paling banyak dilaporkan personel. */
  const versiTerbaru = useMemo<string | null>(() => {
    const hitung = new Map<string, number>();
    for (const r of pelapor ?? []) {
      if (r.app_version)
        hitung.set(r.app_version, (hitung.get(r.app_version) ?? 0) + 1);
    }
    if (hitung.size === 0) return null;
    // Versi dengan laporan TERBANYAK = versi deploy terkini (yang belum
    // update jauh lebih sedikit daripada yang sudah).
    let best: string | null = null;
    let bestCount = -1;
    for (const [v, c] of hitung) {
      if (c > bestCount) {
        best = v;
        bestCount = c;
      }
    }
    return best;
  }, [pelapor]);

  const load = useCallback(async () => {
    try {
      const client = supabase!;
      const [
        { data: reguData, error: reguErr },
        { data: adminData, error: adminErr },
        { data: userData },
      ] = await Promise.all([
        client
          .from("regu")
          .select(
            "id, nama_regu, jabatan, kode_login, status_aktif, unit_key, wilayah_key, app_version, versi_dikirim_pada",
          )
          .order("nama_regu"),
        client
          .from("admin_users")
          .select("id, nama, email, role, username, status_aktif")
          .order("nama"),
        client.auth.getUser(),
      ]);
      if (reguErr) throw reguErr;
      if (adminErr) throw adminErr;
      setPelapor((reguData ?? []) as ReguRow[]);
      setPemantau((adminData ?? []) as AdminRow[]);
      setEmailSaya((userData?.user?.email ?? "").toLowerCase() || null);
      setError(null);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw.includes("status_aktif")) {
        setError(
          "Kolom status_aktif belum ada. Jalankan migration 0015_manajemen_personel.sql di Supabase SQL Editor dulu.",
        );
      } else {
        setError(pesanError(e, "Gagal memuat data personel."));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Simpan hasil modal edit personel (nama, jabatan, username, PIN, status). */
  const simpanEdit = async (
    row: ReguRow,
    nilai: {
      nama: string;
      jabatan: string;
      kodeLogin: string;
      pin: string;
      aktif: boolean;
    },
  ) => {
    setError(null);
    setBusyId(row.id);
    try {
      const hasil = await callManagePersonel({
        action: "update",
        regu_id: row.id,
        nama: nilai.nama,
        jabatan: nilai.jabatan,
        kode_login_baru: nilai.kodeLogin,
        status_aktif: nilai.aktif,
        ...(nilai.pin ? { pin_baru: nilai.pin } : {}),
      });
      if (nilai.pin) {
        setPinBaru({
          kode:
            (hasil as { kode_login?: string }).kode_login ?? nilai.kodeLogin,
          pin: (hasil as { pin?: string }).pin ?? nilai.pin,
          judul: "✅ Perubahan tersimpan — PIN baru personel ini",
        });
      }
      setEditRow(null);
      await load();
    } catch (e) {
      throw new Error(
        pesanError(
          e,
          "Gagal mengubah data personel. Pastikan edge function manage-personel sudah dideploy ulang.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  /** Hapus permanen personel — hanya personel, bukan pemantau. */
  const hapusRegu = async (row: ReguRow) => {
    const yakin = window.confirm(
      `Hapus permanen ${row.nama_regu} (${row.kode_login})?\n\n` +
        "Seluruh laporan & foto personel ini ikut terhapus dan TIDAK bisa dikembalikan.",
    );
    if (!yakin) return;
    const konfirmasi = window.prompt(
      `Ketik kode login (${row.kode_login}) untuk konfirmasi hapus:`,
    );
    if (konfirmasi === null) return;
    if (konfirmasi.trim().toLowerCase() !== row.kode_login.toLowerCase()) {
      setError("Konfirmasi hapus gagal: kode login tidak cocok.");
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await callManagePersonel({ action: "hapus", regu_id: row.id });
      await load();
    } catch (e) {
      setError(
        pesanError(
          e,
          "Gagal menghapus personel. Pastikan edge function manage-personel sudah dideploy ulang.",
        ),
      );
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
      setError(
        pesanError(
          e,
          "Gagal mengubah status. Pastikan migration 0015 sudah dijalankan.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  // ===== Filter pencarian (client-side, tanpa query tambahan ke Supabase) =====
  const q = cari.trim().toLowerCase();
  const pelaporTersaring = q
    ? (pelapor ?? []).filter((r) =>
        [
          r.nama_regu,
          r.jabatan ?? "",
          r.kode_login,
          r.wilayah_key ?? "",
          r.unit_key ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : (pelapor ?? []);
  const pemantauTersaring = q
    ? (pemantau ?? []).filter((r) =>
        [r.nama, r.role, r.username ?? "", r.email ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : (pemantau ?? []);

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

  /** Simpan hasil modal edit pemantau (nama, username, password, status). */
  const simpanEditPemantau = async (
    row: AdminRow,
    nilai: {
      nama: string;
      username: string;
      password: string;
      aktif: boolean;
    },
  ) => {
    setError(null);
    setBusyId(row.id);
    try {
      const hasil = await callManagePersonel({
        action: "update_pemantau",
        admin_user_id: row.id,
        nama: nilai.nama,
        username_baru: nilai.username,
        status_aktif: nilai.aktif,
        ...(nilai.password ? { password_baru: nilai.password } : {}),
      });
      // Password dari server ada bila akun auth baru dibuat otomatis.
      const pwServer = (hasil as { pin?: string }).pin;
      if (nilai.password || pwServer) {
        setPinBaru({
          kode: (hasil as { username?: string }).username ?? nilai.username,
          pin: nilai.password || (pwServer as string),
          judul: nilai.password
            ? "✅ Perubahan tersimpan — password baru pemantau ini"
            : "✅ Akun auth dibuat — catat password sekarang",
          labelKode: "Username",
          labelKredensial: "Password",
          pesan:
            "Password hanya ditampilkan sekali ini. Bagikan ke pemantau bersama username-nya.",
        });
      }
      setEditAdminRow(null);
      await load();
    } catch (e) {
      throw new Error(
        pesanError(
          e,
          "Gagal mengubah data pemantau. Pastikan edge function manage-personel sudah dideploy ulang.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  /** Reset password pemantau via edge function. */
  const resetPasswordPemantau = async (row: AdminRow) => {
    const pw = window.prompt(
      `Password baru untuk ${row.username || row.nama}: (minimal 6 karakter)`,
    );
    if (pw === null) return;
    if (pw.trim().length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await callManagePersonel({
        action: "reset_pin_pemantau",
        admin_user_id: row.id,
        password_baru: pw.trim(),
      });
      setPinBaru({
        kode: row.username || row.nama,
        pin: pw.trim(),
        judul: "✅ Password diperbarui — catat password sekarang",
        labelKode: "Username",
        labelKredensial: "Password",
        pesan:
          "Password hanya ditampilkan sekali ini. Bagikan ke pemantau bersama username-nya.",
      });
    } catch (e) {
      setError(
        pesanError(
          e,
          "Gagal reset password. Pastikan edge function manage-personel sudah dideploy.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  /** Hapus permanen pemantau — akun auth + baris admin_users ikut terhapus. */
  const hapusPemantau = async (row: AdminRow) => {
    const kode = row.username || row.nama;
    if (row.email && emailSaya && row.email.toLowerCase() === emailSaya) {
      setError("Tidak bisa menghapus akun yang sedang login.");
      return;
    }
    const yakin = window.confirm(
      `Hapus permanen ${row.nama} (${kode})?\n\n` +
        "Pemantau tidak akan bisa login lagi. Riwayat laporan TIDAK ikut terhapus.",
    );
    if (!yakin) return;
    const konfirmasi = window.prompt(
      `Ketik username (${kode}) untuk konfirmasi hapus:`,
    );
    if (konfirmasi === null) return;
    if (konfirmasi.trim().toLowerCase() !== kode.toLowerCase()) {
      setError("Konfirmasi hapus gagal: username tidak cocok.");
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await callManagePersonel({
        action: "hapus_pemantau",
        admin_user_id: row.id,
      });
      await load();
    } catch (e) {
      setError(
        pesanError(
          e,
          "Gagal menghapus pemantau. Pastikan edge function manage-personel sudah dideploy ulang.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const resetPin = async (row: ReguRow) => {
    const pin = window.prompt(
      `PIN baru untuk ${row.kode_login}: (minimal 4 karakter)`,
    );
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
      setPinBaru({
        kode: row.kode_login,
        pin: pin.trim(),
        judul: "✅ PIN diperbarui — catat PIN sekarang",
      });
    } catch (e) {
      setError(
        pesanError(
          e,
          "Gagal reset PIN. Pastikan edge function manage-personel sudah dideploy.",
        ),
      );
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
          Kelola akun personel lapangan & pemantau: reset PIN/password, edit
          data, nonaktifkan, atau hapus permanen.
        </p>

        {/* ===== Pencarian personel ===== */}
        <div className="relative mt-4 max-w-md">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
            aria-hidden
          >
            🔍
          </span>
          <input
            className="input input-iconed"
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama, jabatan, kode login…"
            aria-label="Cari personel"
          />
          {cari && (
            <button
              type="button"
              onClick={() => setCari("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-sm leading-none text-slate-400 hover:text-slate-600"
              title="Hapus pencarian"
            >
              ✕
            </button>
          )}
        </div>
        {q && (
          <p className="mt-2 text-xs text-slate-500">
            {pelaporTersaring.length + pemantauTersaring.length} hasil untuk{" "}
            <b className="text-slate-700">“{cari.trim()}”</b>
          </p>
        )}
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
          judul={pinBaru.judul}
          labelKode={pinBaru.labelKode}
          labelKredensial={pinBaru.labelKredensial}
          pesan={pinBaru.pesan}
          onClose={() => setPinBaru(null)}
        />
      )}

      {editRow && (
        <EditPersonelModal
          row={editRow}
          busy={busyId === editRow.id}
          onClose={() => setEditRow(null)}
          onSave={(nilai) => simpanEdit(editRow, nilai)}
        />
      )}

      {editAdminRow && (
        <EditPemantauModal
          row={editAdminRow}
          busy={busyId === editAdminRow.id}
          onClose={() => setEditAdminRow(null)}
          onSave={(nilai) => simpanEditPemantau(editAdminRow, nilai)}
        />
      )}

      {/* Ringkasan update versi */}
      {pelapor !== null && pelapor.length > 0 && (
        <section className="card">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <span className="font-bold text-slate-700">Status update app:</span>
            <span className="text-emerald-700">
              ✓{" "}
              {
                pelapor.filter(
                  (r) => r.app_version && r.app_version === versiTerbaru,
                ).length
              }{" "}
              versi terbaru
            </span>
            <span className="text-red-600">
              ⬆{" "}
              {
                pelapor.filter(
                  (r) =>
                    r.app_version &&
                    versiTerbaru &&
                    r.app_version !== versiTerbaru,
                ).length
              }{" "}
              perlu update
            </span>
            <span className="text-slate-400">
              ? {pelapor.filter((r) => !r.app_version).length} belum lapor
            </span>
            {versiTerbaru && (
              <span className="ml-auto font-mono text-[11px] text-slate-400">
                build terbaru: {versiTerbaru}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ===== Daftar pelapor ===== */}
      <section className="card p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-bold text-slate-800">Personel lapangan</h3>
          <span className="badge bg-sky-50 text-sky-700">
            {q
              ? `${pelaporTersaring.length}/${pelapor?.length ?? 0}`
              : (pelapor?.length ?? "…")}{" "}
            akun
          </span>
        </div>
        <div className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto">
          {pelaporTersaring.map((row) => (
            <div
              key={row.id}
              className="flex flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words text-sm font-bold leading-snug text-slate-800">
                    {row.nama_regu}
                  </span>
                  <StatusVersiBadge row={row} versiTerbaru={versiTerbaru} />
                </div>
                <div className="break-words text-xs leading-5 text-slate-500">
                  {row.jabatan ? `${row.jabatan} · ` : ""}
                  {row.kode_login}
                  {row.wilayah_key ? ` · Polsek ${row.wilayah_key}` : ""}
                  {row.unit_key ? ` · ${row.unit_key}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2 sm:shrink-0 sm:border-0 sm:pt-0">
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
                  onClick={() => setEditRow(row)}
                  disabled={busyId === row.id}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => void hapusRegu(row)}
                  disabled={busyId === row.id}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                  title="Hapus permanen personel & seluruh laporannya"
                >
                  Hapus
                </button>
              </div>
            </div>
          ))}
          {pelaporTersaring.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              {q
                ? `Tidak ada personel yang cocok dengan “${cari.trim()}”.`
                : "Belum ada akun pelapor."}
            </div>
          )}
        </div>
      </section>

      {/* ===== Daftar pemantau ===== */}
      <section className="card p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-bold text-slate-800">Pemantau / pimpinan</h3>
          <span className="badge bg-amber-50 text-amber-700">
            {q
              ? `${pemantauTersaring.length}/${pemantau?.length ?? 0}`
              : (pemantau?.length ?? "…")}{" "}
            akun
          </span>
        </div>
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {pemantauTersaring.map((row) => (
            <div
              key={row.id}
              className="flex flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="break-words text-sm font-bold leading-snug text-slate-800">
                  {row.nama}
                </div>
                <div className="break-words text-xs leading-5 text-slate-500">
                  {row.role}
                  {row.username ? ` · ${row.username}` : ""}
                  {row.email ? ` · ${row.email}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2 sm:shrink-0 sm:border-0 sm:pt-0">
                <ToggleStatus
                  aktif={row.status_aktif}
                  busy={busyId === row.id}
                  onToggle={() => void toggleAdmin(row)}
                />
                <button
                  onClick={() => void resetPasswordPemantau(row)}
                  disabled={busyId === row.id}
                  className="text-xs font-semibold text-amber-600 hover:text-amber-700 disabled:opacity-50"
                  title="Ganti password login pemantau ini"
                >
                  Reset Password
                </button>
                <button
                  onClick={() => setEditAdminRow(row)}
                  disabled={busyId === row.id}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => void hapusPemantau(row)}
                  disabled={busyId === row.id}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                  title="Hapus permanen akun pemantau ini"
                >
                  Hapus
                </button>
              </div>
            </div>
          ))}
          {pemantau === null && pemantauTersaring.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Memuat…
            </div>
          )}
          {pemantau !== null && pemantauTersaring.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              {q
                ? `Tidak ada pemantau yang cocok dengan “${cari.trim()}”.`
                : "Tidak ada data pemantau dalam cakupan Anda."}
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
