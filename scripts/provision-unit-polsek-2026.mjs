// Provisioning TAMBAHAN SIPLAP 2026: 3 unit baru per Polsek (sium, propam,
// humas) × 14 Polsek = 42 akun pelapor level-1.
//
// Prinsip: INCREMENTAL SAJA. Tidak mengubah, tidak me-reset, dan tidak
// menyentuh akun existing maupun objek server lain (RLS, Edge Function,
// trigger). Pola kode & password persis provision-siplap-v2.mjs:
//   username : unit.<unit>.<polsek>   (mis. unit.propam.jatiluhur)
//   email    : unit.<unit>.<polsek>@regu.siplap.id
//   password : KATA-ANGKA-KATA (contoh: Mangga-7429-Roti)
//
// Jalankan SETELAH supabase/tambah-unit-polsek-2026.sql (insert baris regu).
//   node scripts/provision-unit-polsek-2026.mjs            → buat akun
//   node scripts/provision-unit-polsek-2026.mjs --dry-run  → rencana saja
//
// Kredensial ditulis ke:
//   unit-polsek-2026-credentials.csv (0600) & pw-unit-polsek-2026.md (0600)

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
// Struktur: 3 unit baru × 14 Polsek
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

const newUnits = [
  ["sium", "Sium"],
  ["propam", "Propam"],
  ["humas", "Humas"],
];

const accounts = wilayahList.flatMap(([wilayah, nama]) =>
  newUnits.map(([unit, label]) => ({
    username: `unit.${unit}.${wilayah}`,
    name: `Polsek ${nama} Unit ${label}`,
    unitKey: unit,
    wilayahKey: wilayah,
  })),
);

const expected = 42; // 3 unit × 14 polsek
if (accounts.length !== expected) {
  throw new Error(`Struktur akun salah: ${accounts.length} (harusnya ${expected}).`);
}

const emailFor = (username) => `${username}@regu.siplap.id`;

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
  const email = emailFor(account.username).toLowerCase();
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
      access_level: "pelapor-level-1",
    },
  });
  if (error) throw error;
  users.set(email, data.user);
  return { email, password, created: true };
}

async function provisionReporter(account, users) {
  const auth = await ensureAuthUser(account, users);
  if (dryRun) return { ...account, ...auth };

  // Baris regu dibuat/diperbarui HANYA untuk 42 kode baru ini.
  const { data, error } = await supabase
    .from("regu")
    .upsert(
      {
        nama_regu: account.name,
        kode_login: account.username,
        status_aktif: true,
        access_level: "pelapor-level-1",
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
    ? `DRY RUN — rencana provisioning ${accounts.length} akun unit Polsek baru (sium/propam/humas):`
    : `Provisioning ${accounts.length} akun unit Polsek baru (sium/propam/humas)…`,
);

if (dryRun) {
  for (const account of accounts)
    console.log(
      `  [pelapor] ${account.username.padEnd(24)} ${account.name}`,
    );
  console.log("Dry run selesai — tidak ada yang dibuat.");
  process.exit(0);
}

const users = await loadUsers();
const created = [];
for (const account of accounts)
  created.push(await provisionReporter(account, users));

// ----------------------------------------------------------------
// Tulis kredensial (terpisah dari file provisioning lama)
// ----------------------------------------------------------------

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const output =
  process.env.JAWARA_CREDENTIALS_FILE ?? "unit-polsek-2026-credentials.csv";

const lines = [
  ["username", "password", "email", "unit", "polsek", "status"]
    .map(csvEscape)
    .join(","),
  ...created.map((account) =>
    [
      account.username,
      account.password ?? "[existing password preserved]",
      account.email,
      account.unitKey,
      account.wilayahKey,
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

const markdownOutput = process.env.JAWARA_PASSWORD_MD ?? "pw-unit-polsek-2026.md";
const markdown = [
  "# SIPLAP — Kredensial Unit Polsek Baru 2026 (Sium/Propam/Humas)",
  "",
  "> SENSITIVE: simpan di password manager atau kanal privat, jangan commit ke Git.",
  "> Akun existing ditandai `[existing password preserved]` dan tidak di-reset oleh script.",
  "> Format password: KATA-ANGKA-KATA (contoh: Mangga-7429-Roti).",
  "",
  "| Username | Password | Polsek | Unit | Status |",
  "|---|---|---|---|---|",
  ...created.map(
    (account) =>
      `| ${account.username} | ${account.password ?? "[existing password preserved]"} | ${account.wilayahKey} | ${account.unitKey} | ${account.created ? "created" : "existing"} |`,
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
const nExisting = created.length - nCreated;
console.log("");
console.log(`Selesai: ${nCreated} akun Auth dibuat, ${nExisting} sudah ada (dilewati).`);
console.log(`Kredensial: ${output} & ${markdownOutput} (chmod 600).`);
