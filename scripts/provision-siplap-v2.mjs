import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ================================================================
// Provisioning SIPLAP struktur v2 (reset total).
// Jalankan SETELAH supabase/reset-akun-struktur-baru.sql (bagian 2 &
// 3, v_confirm = true). Skrip ini membuat akun Auth + password untuk
// SEMUA 132 akun (25 pemantau + 107 pelapor) dan menautkan baris DB.
//
//   Pemantau  (25): kapolres.purwakarta (admin/all),
//                   wakapolres.purwakarta (pimpinan/all),
//                   kabag.ops (admin/all), 8 kasat sat.* (fungsi),
//                   14 kapolsek.<polsek> (wilayah)
//   Pelapor  (107): 23 sat.<unit>.unitN (level-2, satuan Polres)
//                   + 84 unit polsek (level-1): unit.<unit>.<polsek>
//                     untuk spkt/intelkam/reskrim/binmas/samapta/lantas
//                     × 14 polsek (mis. unit.spkt.jatiluhur)
//
// Semua akun lama (polres.kapolres, polres.wakapolres, polres.admin,
// *.kasat, <polsek>.kapolsek, dst.) sudah dihapus oleh SQL — akun
// Auth lama ikut terhapus, jadi tidak ada konflik email.
//
// Pakai:
//   npm run provision:siplap-v2            → buat/reset + tulis kredensial
//   npm run provision:siplap-v2 -- --dry-run → tampilkan rencana saja
//   JAWARA_RESET_EXISTING=1 npm run …      → reset password akun existing
// ================================================================

const dryRun = process.argv.includes("--dry-run");

function loadProvisionEnv() {
  const files = [".env.provision.local", ".env"];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

loadProvisionEnv();
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing provisioning config. Create .env.provision.local with VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run npm run provision:siplap-v2.",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ----------------------------------------------------------------
// Struktur akun v2
// ----------------------------------------------------------------

const wilayahList = [
  ["kota", "Purwakarta Kota"],
  ["plered", "Plered"],
  ["jatiluhur", "Jatiluhur"],
  ["bungursari", "Bungursari"],
  ["campaka", "Campaka"],
  ["cibatu", "Cibatu"],
  ["pasawahan", "Pasawahan"],
  ["darangdan", "Darangdan"],
  ["wanayasa", "Wanayasa"],
  ["maniis", "Maniis"],
  ["sukatani", "Sukatani"],
  ["sukasari", "Sukasari"],
  ["kiarapedes", "Kiarapedes"],
  ["bojong", "Bojong"],
];

const kasatUnits = [
  ["KASAT INTELKAM", "intelkam"],
  ["KASAT RESKRIM", "reskrim"],
  ["KASAT RESNARKOBA", "resnarkoba"],
  ["KASAT BINMAS", "binmas"],
  ["KASAT SAMAPTA", "samapta"],
  ["KASAT LANTAS", "lantas"],
  ["KASAT POLAIR", "polair"],
  ["KASAT TAHTI", "tahti"],
];

const satuanUnits = [
  ["intelkam", "Satintelkam", 4],
  ["reskrim", "Satreskrim", 5],
  ["resnarkoba", "Satresnarkoba", 2],
  ["binmas", "Satbinmas", 1],
  ["samapta", "Satsamapta", 3],
  ["lantas", "Satlantas", 5],
  ["polair", "Satpolairud", 2],
  ["tahti", "Sattahti", 1],
];

const polsekUnits = [
  ["spkt", "SPKT"],
  ["intelkam", "Intelkam"],
  ["reskrim", "Reskrim"],
  ["binmas", "Binmas"],
  ["samapta", "Samapta"],
  ["lantas", "Lantas"],
];

const monitorAccounts = [
  {
    kind: "pemantau",
    username: "kapolres.purwakarta",
    name: "KAPOLRES PURWAKARTA",
    accessLevel: "all",
    scopeKey: null,
  },
  {
    kind: "pemantau",
    username: "wakapolres.purwakarta",
    name: "WAKAPOLRES PURWAKARTA",
    accessLevel: "all",
    scopeKey: null,
  },
  {
    kind: "pemantau",
    username: "kabag.ops",
    name: "KABAG OPERASIONAL",
    accessLevel: "all",
    scopeKey: null,
  },
  ...kasatUnits.map(([name, unit]) => ({
    kind: "pemantau",
    username: `sat.${unit}`,
    name,
    accessLevel: "fungsi",
    scopeKey: unit,
  })),
  ...wilayahList.map(([wilayah, nama]) => ({
    kind: "pemantau",
    username: `kapolsek.${wilayah}`,
    name: `KAPOLSEK ${nama.toUpperCase()}`,
    accessLevel: "wilayah",
    scopeKey: wilayah,
  })),
];

const reporterAccounts = [
  // Level 2: unit satuan Polres (sat.<unit>.unitN).
  ...satuanUnits.flatMap(([unit, label, count]) =>
    Array.from({ length: count }, (_, i) => ({
      kind: "pelapor",
      username: `sat.${unit}.unit${i + 1}`,
      name: `${label} Unit ${i + 1}`,
      accessLevel: "pelapor-level-2",
      unitKey: unit,
      wilayahKey: null,
    })),
  ),
  // Level 1: 6 unit × 14 polsek. Kode: unit.<unit>.<polsek>
  // (mis. unit.spkt.jatiluhur) — nama tampil: "Polsek Jatiluhur Unit SPKT".
  ...wilayahList.flatMap(([wilayah, nama]) =>
    polsekUnits.map(([unit, label]) => ({
      kind: "pelapor",
      username: `unit.${unit}.${wilayah}`,
      name: `Polsek ${nama} Unit ${label}`,
      accessLevel: "pelapor-level-1",
      unitKey: unit,
      wilayahKey: wilayah,
    })),
  ),
];

const allAccounts = [...monitorAccounts, ...reporterAccounts];
const expected = 132; // 25 pemantau + 107 pelapor
if (allAccounts.length !== expected) {
  throw new Error(
    `Struktur akun salah: ${allAccounts.length} akun (harusnya ${expected}).`,
  );
}

const emailFor = (username, kind) =>
  `${username}@${kind === "pemantau" ? "monitor" : "regu"}.siplap.id`;

// Password pola KATA-ANGKA-KATA (contoh: Mangga-7429-Roti).
const WORDS = [
  "Mangga", "Roti", "Nasi", "Kopi", "Teh", "Gula", "Susu", "Buku", "Pena",
  "Meja", "Kursi", "Lampu", "Pintu", "Kunci", "Gunung", "Laut", "Pantai",
  "Batu", "Pasir", "Kayu", "Bunga", "Daun", "Padi", "Jagung", "Kelapa",
  "Pisang", "Jambu", "Ayam", "Bebek", "Sapi", "Kuda", "Ikan", "Udang",
  "Kucing", "Burung", "Elang", "Garuda", "Bintang", "Bulan", "Awan",
  "Hujan", "Angin", "Petir", "Pelangi", "Teluk", "Bukit", "Lembah", "Sawah",
  "Kebun", "Rumah", "Jalan", "Sekolah", "Pasar", "Warung", "Kamar", "Dapur",
  "Taman", "Pohon", "Besi", "Emas", "Perak", "Kaca", "Kertas", "Kartu",
  "Surat", "Kabar", "Cerita", "Lagu", "Gitar", "Bendera", "Topi", "Baju",
  "Sepatu", "Sandal", "Tas", "Dompet", "Jam", "Payung", "Sarung", "Sabuk",
  "Gelang", "Cincin", "Kalung", "Pagar", "Gerbang", "Menara", "Jangkar",
  "Perahu", "Sampan", "Dayung", "Nelayan", "Petani", "Sopir", "Kurir",
  "Kapal", "Roda", "Ban", "Mesin", "Senter", "Kompas", "Peta", "Tenda",
];

const randomWord = () => WORDS[randomBytes(1)[0] % WORDS.length];

const randomPassword = () => {
  const first = randomWord();
  let second = randomWord();
  while (second === first) second = randomWord();
  const number = 1000 + (randomBytes(2).readUInt16BE(0) % 9000);
  return `${first}-${number}-${second}`;
};

async function loadUsers() {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw error;
  return new Map(
    (data.users ?? []).map((user) => [user.email?.toLowerCase(), user]),
  );
}

async function ensureAuthUser(account, users) {
  const email = emailFor(account.username, account.kind).toLowerCase();
  const existing = users.get(email);
  if (existing) {
    if (!process.env.JAWARA_RESET_EXISTING) {
      return { email, password: null, created: false };
    }
    const password = randomPassword();
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
    });
    if (error) throw error;
    return { email, password, created: false, reset: true };
  }

  if (dryRun) return { email, password: "(dry-run)", created: false };

  const password = randomPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: account.username,
      access_level: account.accessLevel,
    },
  });
  if (error) throw error;
  users.set(email, data.user);
  return { email, password, created: true };
}

async function provisionMonitor(account, users) {
  const auth = await ensureAuthUser(account, users);
  const { data: existing, error: lookupError } = await supabase
    .from("admin_users")
    .select("id")
    .or(`username.eq.${account.username},email.eq.${auth.email}`)
    .maybeSingle();
  if (lookupError) throw lookupError;

  // Kapolres & kabag ops: kelola penuh. Wakapolres read-only;
  // kasat & kapolsek hanya pantau.
  const row = {
    nama: account.name,
    email: auth.email,
    username: account.username,
    role:
      account.accessLevel === "all" && account.username !== "wakapolres.purwakarta"
        ? "admin"
        : "pimpinan",
    access_level: account.accessLevel,
    scope_key: account.scopeKey,
  };
  if (dryRun) return { ...account, ...auth };

  // Unique index username bersifat parsial (lower(username) where not
  // null) → tidak bisa jadi target onConflict PostgREST. Pakai
  // lookup-then-update/insert seperti skrip provision lama.
  const query = existing
    ? supabase.from("admin_users").update(row).eq("id", existing.id)
    : supabase.from("admin_users").insert(row);
  const { error } = await query;
  if (error) throw error;
  return { ...account, ...auth };
}

async function provisionReporter(account, users) {
  const auth = await ensureAuthUser(account, users);
  if (dryRun) return { ...account, ...auth };

  const { data, error } = await supabase
    .from("regu")
    .upsert(
      {
        nama_regu: account.name,
        kode_login: account.username,
        status_aktif: true,
        access_level: account.accessLevel,
        unit_key: account.unitKey,
        wilayah_key: account.wilayahKey,
        is_legacy: false,
      },
      { onConflict: "kode_login" },
    )
    .select("id, auth_user_id")
    .single();
  if (error) throw error;

  // Tautkan auth_user_id (migration 0016) bila belum.
  const authId = users.get(auth.email)?.id ?? null;
  if (authId && data.auth_user_id !== authId) {
    const { error: linkErr } = await supabase
      .from("regu")
      .update({ auth_user_id: authId })
      .eq("id", data.id);
    if (linkErr) throw linkErr;
  }
  return { ...account, ...auth };
}

// ----------------------------------------------------------------
// Eksekusi
// ----------------------------------------------------------------

console.log(
  dryRun
    ? `DRY RUN — rencana provisioning ${allAccounts.length} akun v2:`
    : `Provisioning ${allAccounts.length} akun SIPLAP v2…`,
);

if (dryRun) {
  for (const account of monitorAccounts)
    console.log(
      `  [pemantau] ${account.username.padEnd(22)} ${account.accessLevel.padEnd(8)} scope=${account.scopeKey ?? "-"}`,
    );
  for (const account of reporterAccounts)
    console.log(
      `  [pelapor ] ${account.username.padEnd(22)} ${account.accessLevel.padEnd(16)} ${account.name}`,
    );
  console.log("Dry run selesai — tidak ada yang dibuat.");
  process.exit(0);
}

const users = await loadUsers();
const created = [];
for (const account of monitorAccounts)
  created.push(await provisionMonitor(account, users));
for (const account of reporterAccounts)
  created.push(await provisionReporter(account, users));

const output =
  process.env.JAWARA_CREDENTIALS_FILE ?? "siplap-v2-credentials-latest.csv";
const markdownOutput = process.env.JAWARA_PASSWORD_MD ?? "pw.md";
const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const lines = [
  ["username", "password", "email", "kind", "access_level", "scope", "status"]
    .map(csvEscape)
    .join(","),
  ...created.map((account) =>
    [
      account.username,
      account.password ?? "[existing password preserved]",
      account.email,
      account.kind,
      account.accessLevel,
      account.unitKey ?? account.scopeKey ?? account.wilayahKey ?? "all",
      account.reset ? "reset" : account.created ? "created" : "existing",
    ]
      .map(csvEscape)
      .join(","),
  ),
];
writeFileSync(output, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(output, 0o600);
} catch {
  /* Windows ACLs may ignore chmod. */
}

const markdown = [
  "# SIPLAP v2 Credentials",
  "",
  "> SENSITIVE: simpan di password manager atau kanal privat, jangan commit ke Git.",
  "> Akun existing ditandai `[existing password preserved]` dan tidak di-reset oleh script.",
  "> Format password: KATA-ANGKA-KATA (contoh: Mangga-7429-Roti).",
  "",
  "| Jenis | Username | Password | Scope | Email | Status |",
  "|---|---|---|---|---|---|",
  ...created.map(
    (account) =>
      [
        account.kind,
        account.username,
        account.password ?? "[existing password preserved]",
        account.unitKey ?? account.scopeKey ?? account.wilayahKey ?? "all",
        account.email,
        account.reset ? "reset" : account.created ? "created" : "existing",
      ]
        .map((value) => `| ${String(value).replaceAll("|", "\\|")} `)
        .join("") + "|",
  ),
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
].join("\n");
writeFileSync(markdownOutput, markdown, { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(markdownOutput, 0o600);
} catch {
  /* Windows ACLs may ignore chmod. */
}

console.log(`Provisioned ${created.length} SIPLAP v2 accounts (target ${expected}).`);
console.log(
  `Credentials written to ${output} and ${markdownOutput}. Treat both files as secrets and delete them after secure delivery.`,
);
