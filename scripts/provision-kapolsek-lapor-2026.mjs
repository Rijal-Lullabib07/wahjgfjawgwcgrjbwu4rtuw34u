// Provisioning TAMBAHAN SIPLAP 2026: 1 akun pelapor khusus per Polsek,
// kode lapor.<polsek> (mis. lapor.jatiluhur) — total 14 akun.
//
// Prinsip: INCREMENTAL SAJA. Tidak mengubah, tidak me-reset, dan tidak
// menyentuh akun existing maupun objek server lain (RLS, Edge Function,
// trigger). Akun Kapolsek lama (kapolsek.<polsek>) tetap ada.
//
// Pola kode & password MENYESUAIKAN permintaan khusus:
//   username : lapor.<polsek>            (mis. lapor.jatiluhur)
//   password : SAMA DENGAN USERNAME      (mis. lapor.jatiluhur)
//   email    : lapor.<polsek>@regu.siplap.id
//   akses    : pelapor-level-1, unit_key = 'spkt', wilayah_key = <polsek>
//              → laporannya menyatu di folder "SPKT — Polsek <nama>",
//                pelapor dikenali dari NRP yang diisi di form laporan.
//
// Jalankan:
//   node scripts/provision-kapolsek-lapor-2026.mjs            → buat akun
//   node scripts/provision-kapolsek-lapor-2026.mjs --dry-run  → rencana saja
//
// Kredensial ditulis ke:
//   kapolsek-lapor-2026-credentials.csv (0600) & pw-kapolsek-lapor-2026.md (0600)

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
// Struktur: 1 akun lapor.<polsek> × 14 Polsek
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

const accounts = wilayahList.map(([wilayah, nama]) => ({
  username: `lapor.${wilayah}`,
  name: `Polsek ${nama} Lapor`,
  unitKey: "spkt",
  wilayahKey: wilayah,
}));

const expected = 14; // 1 akun × 14 polsek
if (accounts.length !== expected) {
  throw new Error(`Struktur akun salah: ${accounts.length} (harusnya ${expected}).`);
}

const emailFor = (username) => `${username}@regu.siplap.id`;
// Password = username (permintaan khusus 2026: lapor.jatiluhur / lapor.jatiluhur).

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
  const password = account.username; // password = username
  const existing = users.get(email);
  if (existing) {
    // Akun Auth sudah ada → JANGAN reset password, cukup catat statusnya.
    return { email, password: null, created: false };
  }

  if (dryRun) return { email, password: "(dry-run)", created: false };

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

  // Baris regu dibuat/diperbarui HANYA untuk 14 kode lapor.* ini.
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
    ? "DRY RUN — rencana provisioning 14 akun lapor.<polsek> (password = username, folder SPKT):"
    : "Provisioning 14 akun lapor.<polsek> (password = username, folder SPKT)…",
);

if (dryRun) {
  for (const account of accounts)
    console.log(`  [pelapor] ${account.username.padEnd(20)} → ${account.name} (unit: spkt)`);
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
  process.env.JAWARA_CREDENTIALS_FILE ?? "kapolsek-lapor-2026-credentials.csv";

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

const markdownOutput = process.env.JAWARA_PASSWORD_MD ?? "pw-kapolsek-lapor-2026.md";
const markdown = [
  "# SIPLAP — Kredensial Akun Lapor Polsek 2026 (password = username)",
  "",
  "> SENSITIVE: simpan di password manager atau kanal privat, jangan commit ke Git.",
  "> Password akun ini SAMA DENGAN USERNAME (mis. lapor.jatiluhur / lapor.jatiluhur).",
  "> Akun existing ditandai `[existing password preserved]` dan tidak di-reset oleh script.",
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
console.log(`Kredensial: ${output} & ${markdownOutput}`);
