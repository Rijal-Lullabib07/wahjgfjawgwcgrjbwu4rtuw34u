import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
    "Missing provisioning config. Create .env.provision.local with VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run npm run provision:jawara.",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ================================================================
// Struktur akun SIPLAP (146 total) — sesuai db_supabase.sql:
//   Pemantau (27)    : Kapolres, Wakapolres (read-only), Admin Utama,
//                      10 Kasat (fungsi), 14 Kapolsek (wilayah)
//   Pelapor Lv2 (9)  : satu per satuan Polres (reskrim.polres, dst.)
//   Pelapor Lv1 (110): 96 akun unit di Polsek + 14 SPKT
// ================================================================

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

const unitLabels = {
  reskrim: "Reskrim",
  intelkam: "Intelkam",
  bhabinkamtibmas: "Bhabinkamtibmas",
  samapta: "Samapta",
  binmas: "Binmas",
  propam: "Propam",
  lantas: "Lantas",
  sium: "Sium & Humas",
  spkt: "SPKT",
};

// Presensi unit per Polsek (mengikuti JAWARA APP.xlsx, BKO diabaikan).
const allWilayah = wilayahList.map(([w]) => w);
const unitPresence = {
  reskrim: allWilayah,
  intelkam: allWilayah,
  bhabinkamtibmas: allWilayah,
  samapta: allWilayah.filter((w) => w !== "sukatani"),
  binmas: allWilayah.filter(
    (w) => !["plered", "darangdan", "sukasari"].includes(w),
  ),
  propam: allWilayah.filter((w) => !["kota", "campaka"].includes(w)),
  lantas: ["kota", "plered", "jatiluhur", "bungursari", "cibatu"],
  sium: allWilayah,
};

const polresSatus = [
  ["Satintelkam", "intelkam"],
  ["Satreskrim", "reskrim"],
  ["Satresnarkoba", "narkoba"],
  ["Satbinmas", "binmas"],
  ["Satsamapta", "samapta"],
  ["Pam Obvit Samapta", "pamobvit"],
  ["Satlantas", "lantas"],
  ["Satpolairud", "polair"],
  ["Sattahti", "tahti"],
];

const kasatUnits = [
  ["KASAT INTELKAM", "intelkam"],
  ["KASAT RESKRIM", "reskrim"],
  ["KASAT RESNARKOBA", "narkoba"],
  ["KASAT BINMAS", "binmas"],
  ["KASAT SAMAPTA", "samapta"],
  ["PAM OBVIT SAMAPTA", "pamobvit"],
  ["KASAT LANTAS", "lantas"],
  ["KASAT POLAIR", "polair"],
  ["KASAT TAHTI", "tahti"],
  ["KASAT SPKT", "spkt"],
];

const monitorAccounts = [
  {
    kind: "pemantau",
    username: "polres.kapolres",
    name: "KAPOLRES",
    accessLevel: "all",
    scopeKey: null,
    unitKey: null,
    wilayahKey: null,
  },
  {
    kind: "pemantau",
    username: "polres.wakapolres",
    name: "WAKAPOLRES",
    accessLevel: "all",
    scopeKey: null,
    unitKey: null,
    wilayahKey: null,
  },
  {
    kind: "pemantau",
    username: "polres.admin",
    name: "ADMIN UTAMA",
    email: "admin@polres.go.id",
    accessLevel: "all",
    scopeKey: null,
    unitKey: null,
    wilayahKey: null,
  },
  ...kasatUnits.map(([name, unit]) => ({
    kind: "pemantau",
    username: `${unit}.kasat`,
    name,
    accessLevel: "fungsi",
    scopeKey: unit,
    unitKey: null,
    wilayahKey: null,
  })),
  ...wilayahList.map(([wilayah, nama]) => ({
    kind: "pemantau",
    username: `${wilayah}.kapolsek`,
    name: `KAPOLSEK ${nama.toUpperCase()}`,
    accessLevel: "wilayah",
    scopeKey: wilayah,
    unitKey: null,
    wilayahKey: null,
  })),
];

const reporterAccounts = [
  // Level 2: satu akun per satuan Polres.
  ...polresSatus.map(([name, unit]) => ({
    kind: "pelapor",
    username: `${unit}.polres`,
    name,
    accessLevel: "pelapor-level-2",
    scopeKey: unit,
    unitKey: unit,
    wilayahKey: null,
  })),
  // Level 1: akun unit di tiap Polsek.
  ...Object.entries(unitPresence).flatMap(([unit, wilayahs]) =>
    wilayahs.map((wilayah) => {
      const nama = wilayahList.find(([w]) => w === wilayah)?.[1] ?? wilayah;
      return {
        kind: "pelapor",
        username: `${unit}.${wilayah}`,
        name: `${unitLabels[unit]} Polsek ${nama}`,
        accessLevel: "pelapor-level-1",
        scopeKey: wilayah,
        unitKey: unit,
        wilayahKey: wilayah,
      };
    }),
  ),
  // SPKT: satu akun per Polsek.
  ...wilayahList.map(([wilayah, nama]) => ({
    kind: "pelapor",
    username: `spkt.${wilayah}`,
    name: `SPKT Polsek ${nama}`,
    accessLevel: "pelapor-level-1",
    scopeKey: wilayah,
    unitKey: "spkt",
    wilayahKey: wilayah,
  })),
];

const allAccounts = [...monitorAccounts, ...reporterAccounts];
if (allAccounts.length !== 146) {
  throw new Error(
    `Struktur akun salah: ${allAccounts.length} akun (harusnya 146).`,
  );
}

const emailFor = (username, type) => `${username}@${type}.siplap.id`;

// Password pola KATA-ANGKA-KATA (contoh: Mangga-7429-Roti) —
// tidak terlalu gampang ditebak, tidak terlalu susah diketik di HP.
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
  // Hindari kedua kata sama agar polanya tidak monoton.
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
  const email = (
    account.email ??
    emailFor(account.username, account.kind === "pemantau" ? "monitor" : "regu")
  ).toLowerCase();
  const existing = users.get(email);
  if (existing) return { email, password: null, created: false };

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

  // Kapolres & Admin Utama boleh kelola; Wakapolres read-only;
  // Kasat & Kapolsek hanya pemantau.
  const role =
    account.accessLevel === "all" && account.username !== "polres.wakapolres"
      ? "admin"
      : "pimpinan";

  const row = {
    nama: account.name,
    email: auth.email,
    username: account.username,
    role,
    access_level: account.accessLevel,
    scope_key: account.scopeKey,
  };
  const query = existing
    ? supabase.from("admin_users").update(row).eq("id", existing.id)
    : supabase.from("admin_users").insert(row);
  const { error } = await query;
  if (error) throw error;
  return {
    ...account,
    email: auth.email,
    password: auth.password,
    created: auth.created,
  };
}

async function provisionReporter(account, users) {
  const auth = await ensureAuthUser(account, users);
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
    .select("id")
    .single();
  if (error) throw error;
  return {
    ...account,
    email: auth.email,
    password: auth.password,
    reguId: data.id,
    created: auth.created,
  };
}

const users = await loadUsers();
const created = [];
for (const account of monitorAccounts)
  created.push(await provisionMonitor(account, users));
for (const account of reporterAccounts)
  created.push(await provisionReporter(account, users));

const output =
  process.env.JAWARA_CREDENTIALS_FILE ?? "jawara-credentials-latest.csv";
const markdownOutput = process.env.JAWARA_PASSWORD_MD ?? "pw.md";
const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const lines = [
  [
    "username",
    "password",
    "email",
    "kind",
    "access_level",
    "scope",
    "status",
  ]
    .map(csvEscape)
    .join(","),
  ...created.map((account) =>
    [
      account.username,
      account.password ?? "[existing password preserved]",
      account.email,
      account.kind,
      account.accessLevel,
      account.unitKey ?? account.wilayahKey ?? "all",
      account.created ? "created" : "existing",
    ]
      .map(csvEscape)
      .join(","),
  ),
];
writeFileSync(output, `${lines.join("\n")}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
try {
  chmodSync(output, 0o600);
} catch {
  /* Windows ACLs may ignore chmod. */
}

const markdown = [
  "# JAWARA Credentials",
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
        account.unitKey ?? account.wilayahKey ?? "all",
        account.email,
        account.created ? "created" : "existing",
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

console.log(`Provisioned ${created.length} JAWARA accounts (target 146).`);
console.log(
  `Credentials written to ${output} and ${markdownOutput}. Treat both files as secrets and delete them after secure delivery.`,
);
