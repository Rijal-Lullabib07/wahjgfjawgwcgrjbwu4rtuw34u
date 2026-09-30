// Provisioning TAMBAHAN SIPLAP 2026 (gelombang 2): Kasat & Satuan untuk
// fungsi baru SIUM, PROPAM, HUMAS di tingkat Polres.
//
//   Pemantau (3, access_level='fungsi'):
//     sat.sium   → KASAT SIUM     (pantau unit sium   di semua Polsek + satuan)
//     si.propam  → KASI PROPAM    (pantau unit propam di semua Polsek + satuan)
//     sat.humas  → KASAT HUMAS    (pantau unit humas  di semua Polsek + satuan)
//   Pelapor level-2 (3):
//     sat.sium.unit1   → Satsium Unit 1
//     sat.propam.unit1 → Satpropam Unit 1
//     sat.humas.unit1  → Sathumas Unit 1
//
// Prinsip: INCREMENTAL SAJA. Tidak mengubah / me-reset akun existing,
// tidak menyentuh RLS, Edge Function, trigger, atau objek server lain.
// Pola & password persis provision-siplap-v2.mjs (KATA-ANGKA-KATA).
//
// Jalankan SETELAH supabase/tambah-kasat-sium-propam-humas-2026.sql
//   node scripts/provision-kasat-sium-propam-humas-2026.mjs            → buat akun
//   node scripts/provision-kasat-sium-propam-humas-2026.mjs --dry-run  → rencana saja
//
// Kredensial ditulis ke (terpisah dari gelombang sebelumnya):
//   kasat-sium-propam-humas-2026-credentials.csv & pw-kasat-sium-propam-humas-2026.md

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
    "Missing provisioning config. Create .env.provision.local with VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ----------------------------------------------------------------
// Struktur: 3 pemantau + 3 pelapor satuan
// ----------------------------------------------------------------

const monitorAccounts = [
  {
    kind: "pemantau",
    username: "sat.sium",
    name: "KASAT SIUM",
    accessLevel: "fungsi",
    scopeKey: "sium",
  },
  {
    kind: "pemantau",
    username: "si.propam",
    name: "KASI PROPAM",
    accessLevel: "fungsi",
    scopeKey: "propam",
  },
  {
    kind: "pemantau",
    username: "sat.humas",
    name: "KASAT HUMAS",
    accessLevel: "fungsi",
    scopeKey: "humas",
  },
];

const reporterAccounts = [
  { username: "sat.sium.unit1", name: "Satsium Unit 1", unitKey: "sium" },
  { username: "sat.propam.unit1", name: "Sipropam Unit 1", unitKey: "propam" },
  { username: "sat.humas.unit1", name: "Sathumas Unit 1", unitKey: "humas" },
];

const emailFor = (username, kind) =>
  `${username}@${kind === "pemantau" ? "monitor" : "regu"}.siplap.id`;

// Password pola KATA-ANGKA-KATA (sama dengan provision-siplap-v2.mjs).
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
    // Akun sudah ada → JANGAN reset password, cukup catat statusnya.
    return { email, password: null, created: false };
  }

  if (dryRun) return { email, password: "(dry-run)", created: false };

  const password = randomPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: account.username,
      access_level: account.accessLevel ?? "pelapor-level-2",
    },
  });
  if (error) throw error;
  users.set(email, data.user);
  return { email, password, created: true };
}

async function provisionMonitor(account, users) {
  const auth = await ensureAuthUser(account, users);
  if (dryRun) return { ...account, ...auth };

  const { data: existing, error: lookupError } = await supabase
    .from("admin_users")
    .select("id")
    .or(`username.eq.${account.username},email.eq.${auth.email}`)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const row = {
    nama: account.name,
    email: auth.email,
    username: account.username,
    role: "pimpinan",
    access_level: account.accessLevel,
    scope_key: account.scopeKey,
  };

  // Lookup-then-upsert: unique index username bersifat parsial sehingga
  // tidak bisa jadi target onConflict PostgREST (pola yang sama dengan
  // provision-siplap-v2.mjs).
  const query = existing
    ? supabase.from("admin_users").update(row).eq("id", existing.id)
    : supabase.from("admin_users").insert(row);
  const { error } = await query;
  if (error) throw error;
  return { ...account, ...auth };
}

async function provisionReporter(account, users) {
  const withKind = { kind: "pelapor", accessLevel: "pelapor-level-2", ...account };
  const auth = await ensureAuthUser(withKind, users);
  if (dryRun) return { ...account, ...auth };

  // Baris regu dibuat/diperbarui HANYA untuk 3 kode baru ini.
  const { data, error } = await supabase
    .from("regu")
    .upsert(
      {
        nama_regu: account.name,
        kode_login: account.username,
        status_aktif: true,
        access_level: "pelapor-level-2",
        unit_key: account.unitKey,
        wilayah_key: null,
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
    ? "DRY RUN — rencana provisioning 6 akun kasat/satuan sium-propam-humas:"
    : "Provisioning 6 akun kasat/satuan sium-propam-humas…",
);

if (dryRun) {
  for (const account of monitorAccounts)
    console.log(
      `  [pemantau] ${account.username.padEnd(18)} ${account.accessLevel.padEnd(8)} scope=${account.scopeKey}`,
    );
  for (const account of reporterAccounts)
    console.log(`  [pelapor ] ${account.username.padEnd(18)} ${account.name}`);
  console.log("Dry run selesai — tidak ada yang dibuat.");
  process.exit(0);
}

const users = await loadUsers();
const created = [];
for (const account of monitorAccounts)
  created.push(await provisionMonitor(account, users));
for (const account of reporterAccounts)
  created.push(await provisionReporter(account, users));

// ----------------------------------------------------------------
// Tulis kredensial (terpisah dari file provisioning lain)
// ----------------------------------------------------------------

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const output =
  process.env.JAWARA_CREDENTIALS_FILE ??
  "kasat-sium-propam-humas-2026-credentials.csv";
const markdownOutput =
  process.env.JAWARA_PASSWORD_MD ?? "pw-kasat-sium-propam-humas-2026.md";

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
      account.unitKey ?? account.scopeKey,
      account.created ? "created" : "existing",
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
  "# SIPLAP — Kredensial Kasat/Satuan Sium-Propam-Humas 2026",
  "",
  "> SENSITIVE: simpan di password manager atau kanal privat, jangan commit ke Git.",
  "> Akun existing ditandai `[existing password preserved]` dan tidak di-reset oleh script.",
  "> Format password: KATA-ANGKA-KATA (contoh: Mangga-7429-Roti).",
  "",
  "| Jenis | Username | Password | Scope | Email | Status |",
  "|---|---|---|---|---|---|",
  ...created.map(
    (account) =>
      `| ${account.kind} | ${account.username} | ${account.password ?? "[existing password preserved]"} | ${account.unitKey ?? account.scopeKey} | ${account.email} | ${account.created ? "created" : "existing"} |`,
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

const nCreated = created.filter((a) => a.created).length;
console.log("");
console.log(`Selesai: ${nCreated} akun Auth dibuat, ${created.length - nCreated} sudah ada (dilewati).`);
console.log(`Kredensial: ${output} & ${markdownOutput} (chmod 600).`);
