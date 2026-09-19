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

// Counts and unit keys come from JAWARA APP.xlsx / panduan-update-app-web.html.
const polsekReporters = [
  ["Purwakarta Kota", "kota", 35],
  ["Plered", "plered", 25],
  ["Jatiluhur", "jatiluhur", 27],
  ["Bungursari", "bungursari", 27],
  ["Campaka", "campaka", 22],
  ["Cibatu", "cibatu", 23],
  ["Pasawahan", "pasawahan", 24],
  ["Darangdan", "darangdan", 16],
  ["Wanayasa", "wanayasa", 18],
  ["Maniis", "maniis", 14],
  ["Sukatani", "sukatani", 16],
  ["Sukasari", "sukasari", 16],
  ["Kiarapedes", "kiarapedes", 12],
  ["Bojong", "bojong", 14],
];
const polresReporters = [
  ["Satintelkam", "intelkam", 30],
  ["Satreskrim", "reskrim", 73],
  ["Satresnarkoba", "narkoba", 35],
  ["Satbinmas", "binmas", 9],
  ["Satsamapta", "samapta", 44],
  ["Pam Obvit Samapta", "pamobvit", 24],
  ["Satlantas", "lantas", 96],
  ["Satpolairud", "polair", 7],
  ["Sattahti", "tahti", 10],
];
const functionMonitors = [
  ["KASAT INTEL", "intelkam", "kasat"],
  ["KASAT RESKRIM", "reskrim", "kasat"],
  ["KASATRESNARKOBA", "narkoba", "kasat"],
  ["KASAT BINMAS", "binmas", "kasat"],
  ["KASAT SAMAPTA", "samapta", "kasat"],
  ["PAMOBVIT SAMAPTA", "pamobvit", "kasat"],
  ["KASAT LANTAS", "lantas", "kasat"],
  ["KASAT POLAIR", "polair", "kasat"],
  ["KASAT TAHTI", "tahti", "kasat"],
  ["KASAT SPKT", "spkt", "kasat"],
];

const randomPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const special = "!@#$%^&*";
  const chars = [
    alphabet[randomBytes(1)[0] % 26],
    alphabet[26 + (randomBytes(1)[0] % 26)],
    String(2 + (randomBytes(1)[0] % 8)),
    special[randomBytes(1)[0] % special.length],
  ];
  while (chars.length < 20)
    chars.push(alphabet[randomBytes(1)[0] % alphabet.length]);
  for (let index = chars.length - 1; index > 0; index--) {
    const swapIndex = randomBytes(1)[0] % (index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars.join("");
};

const emailFor = (username, type) => `${username}@${type}.siplap.id`;
const reporterAccounts = [];
const monitorAccounts = [
  {
    kind: "pemantau",
    username: "polres.kapolres",
    name: "Kapolres",
    accessLevel: "all",
    scopeKey: null,
  },
  {
    kind: "pemantau",
    username: "polres.wakapolres",
    name: "Wakapolres",
    accessLevel: "all",
    scopeKey: null,
  },
  {
    kind: "pemantau",
    username: "polres.admin",
    name: "Admin Utama",
    accessLevel: "all",
    scopeKey: null,
    email: "admin@polres.go.id",
  },
  ...functionMonitors.map(([name, unit]) => ({
    kind: "pemantau",
    username: `${unit}.kasat`,
    name,
    accessLevel: "fungsi",
    scopeKey: unit,
  })),
  ...polsekReporters.map(([name, unit]) => ({
    kind: "pemantau",
    username: `${unit}.kapolsek`,
    name: `KAPOLSEK ${name.toUpperCase()}`,
    accessLevel: "wilayah",
    scopeKey: unit,
  })),
];

for (const [name, unit, count] of polresReporters) {
  for (let index = 1; index <= count; index++) {
    reporterAccounts.push({
      kind: "pelapor",
      username: `${unit}.pelapor${String(index).padStart(2, "0")}`,
      name: `${name} Pelapor ${String(index).padStart(2, "0")}`,
      accessLevel: "pelapor-level-2",
      unitKey: unit,
      wilayahKey: null,
    });
  }
}
for (const [name, unit, count] of polsekReporters) {
  for (let index = 1; index <= count; index++) {
    reporterAccounts.push({
      kind: "pelapor",
      username: `${unit}.pelapor${String(index).padStart(2, "0")}`,
      name: `${name} Pelapor ${String(index).padStart(2, "0")}`,
      accessLevel: "pelapor-level-1",
      unitKey: null,
      wilayahKey: unit,
    });
  }
}
for (const [index, [, wilayahKey]] of polsekReporters.entries()) {
  reporterAccounts.push({
    kind: "pelapor",
    username: `spkt.pelapor${String(index + 1).padStart(2, "0")}`,
    name: `SPKT Pelapor ${String(index + 1).padStart(2, "0")}`,
    accessLevel: "pelapor-level-1",
    unitKey: "spkt",
    wilayahKey,
  });
}

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

async function ensureAuthUser(account, users, type) {
  const email = (
    account.email ?? emailFor(account.username, type)
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
  const auth = await ensureAuthUser(account, users, "monitor");
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
    role: account.accessLevel === "all" ? "admin" : "pimpinan",
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
  const auth = await ensureAuthUser(account, users, "regu");
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
    "scope_key",
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
      account.scopeKey ?? account.unitKey ?? account.wilayahKey ?? "",
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
  "",
  "| Jenis | Username | Password | Scope | Email | Status |",
  "|---|---|---|---|---|---|",
  ...created.map(
    (account) =>
      [
        account.kind,
        account.username,
        account.password ?? "[existing password preserved]",
        account.scopeKey ?? account.unitKey ?? account.wilayahKey ?? "all",
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

console.log(`Provisioned ${created.length} JAWARA accounts.`);
console.log(
  `Credentials written to ${output} and ${markdownOutput}. Treat both files as secrets and delete them after secure delivery.`,
);
