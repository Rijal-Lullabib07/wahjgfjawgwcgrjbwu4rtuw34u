/**
 * Import direktori personel ke Supabase dari file LAPBUL xlsx.
 *
 *   node scripts/import-personel.mjs "LAPORAN PERSONEL PWK.xlsx"
 *   node scripts/import-personel.mjs "LAPORAN PERSONEL PWK.xlsx" --dry-run
 *
 * Butuh .env.provision.local / .env dengan:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Sheet yang dibaca: kolom [NAMA, PANGKAT, NRP, JABATAN] (header baris 1).
 * Baris tanpa NRP valid (angka 5–12 digit) dilewati dengan peringatan.
 * Import menimpa data baris dengan NRP sama (upsert) — tidak menghapus
 * NRP lama yang tidak ada di file.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const dryRun = process.argv.includes("--dry-run");
const fileArg =
  process.argv.find((a, i) => i >= 2 && !a.startsWith("--") && a !== process.argv[1] && i > 1) ??
  process.argv[2];

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

if (!fileArg) {
  console.error("Pemakaian: node scripts/import-personel.mjs <file.xlsx> [--dry-run]");
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing config. Isi VITE_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.provision.local",
  );
  process.exit(1);
}

if (!dryRun) {
  var { createClient } = await import("@supabase/supabase-js");
  var supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------- Baca xlsx ----------

const wb = XLSX.readFile(fileArg);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
  header: 1,
});

/** Kolom header bisa "N A M A"/"NAMA" dst — petakan by nama header. */
function findCols(header) {
  const norm = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();
  const idx = { nama: 0, pangkat: 1, nrp: 2, jabatan: 3 };
  for (let i = 0; i < header.length; i++) {
    const h = norm(header[i]);
    if (h.startsWith("NAMA") || h === "NRP") {
      // header row: [NAMA, PANGKAT, NRP, JABATAN]
      idx.nama = header.indexOf(header.find((x) => norm(x).startsWith("N A M A") || norm(x) === "NAMA")) ?? 0;
      idx.pangkat = header.findIndex((x) => norm(x) === "PANGKAT");
      idx.nrp = header.findIndex((x) => norm(x) === "NRP");
      idx.jabatan = header.findIndex((x) => norm(x) === "JABATAN");
      break;
    }
  }
  return idx;
}

const header = rows[0] ?? [];
const col = findCols(header);

const personel = [];
const skipped = [];
const seen = new Map();

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r) continue;
  const nama = String(r[col.nama] ?? "").trim();
  const pangkat = String(r[col.pangkat] ?? "").trim();
  const nrp = String(r[col.nrp] ?? "").trim();
  const jabatan = String(r[col.jabatan] ?? "").trim();

  if (!nama && !pangkat && !nrp && !jabatan) continue; // baris kosong

  if (!/^\d{5,12}$/.test(nrp) || !nama || !pangkat || !jabatan) {
    skipped.push([i + 1, JSON.stringify(r).slice(0, 120)]);
    continue;
  }

  // Duplikat dalam satu file: pertahankan yang pertama.
  if (seen.has(nrp)) continue;
  seen.set(nrp, true);

  personel.push({ nrp, nama, pangkat, jabatan });
}

console.log(`File       : ${fileArg}`);
console.log(`Sheet      : ${wb.SheetNames[0]}`);
console.log(`Valid      : ${personel.length} personel`);
console.log(`Dilewati   : ${skipped.length} baris`);
skipped.slice(0, 10).forEach(([line, raw]) => console.log(`  baris ${line}: ${raw}`));

if (dryRun) {
  console.log("\n--dry-run — tidak menulis ke Supabase. Contoh 3 data:");
  personel.slice(0, 3).forEach((p) =>
    console.log(`  ${p.nrp} | ${p.pangkat} | ${p.nama} | ${p.jabatan}`),
  );
  process.exit(0);
}

// ---------- Upsert ke Supabase (batch 500) ----------

let ok = 0;
for (let i = 0; i < personel.length; i += 500) {
  const batch = personel.slice(i, i + 500);
  const { error } = await supabase
    .from("personel_polri")
    .upsert(batch, { onConflict: "nrp" });
  if (error) {
    console.error(`Batch ${i}-${i + batch.length - 1} GAGAL:`, error.message);
    process.exit(1);
  }
  ok += batch.length;
  console.log(`  … ${ok}/${personel.length} tersimpan`);
}

console.log(`\nSelesai. ${ok} personel tersimpan di public.personel_polri.`);
