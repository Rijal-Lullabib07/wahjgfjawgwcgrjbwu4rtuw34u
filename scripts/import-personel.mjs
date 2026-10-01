/**
 * Import direktori personel ke Supabase dari file LAPBUL xlsx.
 *
 *   node scripts/import-personel.mjs "DATA PERSONEL FIX.xlsx"
 *   node scripts/import-personel.mjs "DATA PERSONEL FIX.xlsx" --dry-run
 *
 * Butuh .env.provision.local / .env dengan:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Sumber data (2 lapis):
 *  1. MASTER (xlsx): kolom [N A M A, PANGKAT, NRP, JABATAN, FUNGSI,
 *     SATUAN, STATUS] — format DATA PERSONEL FIX. Sumber utama semua
 *     personel di luar Polsek Jatiluhur.
 *  2. OVERLAY (DAFTAR PERS.pdf — Polsek Jatiluhur, Sept 2026): jabatan
 *     personel Polsek Jatiluhur mengikuti PDF (lebih baru dari master);
 *     NRP yang beda satu digit menyesuaikan NRP di master. Dua personel
 *     yang tidak ada di master (Yuli, Dedi) ditambahkan dari data PDF.
 *
 * Kolom FUNGSI/SATUAN/STATUS kosong / file lama → fungsi = JABATAN
 * (fallback lama), satuan & status = NULL.
 * Baris tanpa NRP valid (angka 5–12 digit; NRP PNS 18 digit diizinkan
 * khusus lewat daftar TAMBAHAN_PDF) dilewati dengan peringatan.
 * Import UPSERT: baris dengan NRP sama diperbarui, NRP lama yang tidak
 * ada di file TETAP tersimpan (tidak ada penghapusan).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const dryRun = process.argv.includes("--dry-run");
const fileArg =
  process.argv.find((a, i) => i >= 2 && !a.startsWith("--") && a !== process.argv[1] && i > 1) ??
  process.argv[2];

// ----------------------------------------------------------------
// OVERLAY: DAFTAR PERSONIL POLSEK JATILUHUR (DAFTAR PERS.pdf, Sept 2026)
// ----------------------------------------------------------------
// Aturan (konfirmasi user):
//  - Personel Polsek Jatiluhur → JABATAN mengikuti PDF.
//  - NRP yang beda satu digit (PDF vs master) → ikuti NRP master:
//      HERRY HERMANSYAH : PDF 79120228 → master 79120028
//      GATOT PRASTIO    : PDF 89020956 → master 89020596
//  - NAMA/PANGKAT/FUNGSI tetap dari master bila ada di master.
// Kunci = NRP master. 31 personel di daftar PDF.
const SATUAN_JATILUHUR = "POLSEK JATILUHUR";
const OVERLAY_JATILUHUR = [
  { nrp: "68120300", jabatan: "KAPOLSEK" }, // A. ABDUL KODIR (KOMPOL)
  { nrp: "79120028", jabatan: "PANIT I RESKRIM" }, // HERRY HERMANSYAH (IPDA)
  { nrp: "71040080", jabatan: "PANIT I LANTAS" }, // ERIYANTO (AIPTU)
  { nrp: "74050078", jabatan: "PANIT II BINMAS" }, // DEDI KUSNADI (AIPTU)
  { nrp: "81080088", jabatan: "KA SPKT I" }, // HENDRA (AIPTU)
  { nrp: "77120293", jabatan: "KA SPKT II" }, // MOCH. AGUNG MARGONO (AIPTU)
  { nrp: "85070613", jabatan: "KA SPKT III" }, // YUSEP WAHYUDIN (AIPDA)
  { nrp: "70040204", jabatan: "BHABINKAMTIBMAS" }, // AFRIZAL INDRA (AIPTU)
  { nrp: "73090450", jabatan: "BHABINKAMTIBMAS" }, // HASAN NUL IMAN (AIPTU)
  { nrp: "75100572", jabatan: "BHABINKAMTIBMAS" }, // YUDI ISKANDAR (AIPTU)
  { nrp: "73070437", jabatan: "BHABINKAMTIBMAS" }, // SUHENDA KUSNANDAR (AIPTU)
  { nrp: "73050504", jabatan: "BHABINKAMTIBMAS" }, // KUKUH TRI HANDOYO (AIPTU)
  { nrp: "69080007", jabatan: "BHABINKAMTIBMAS" }, // ENGKOS KOSASIH (AIPTU)
  { nrp: "82080704", jabatan: "BHABINKAMTIBMAS" }, // AGUS FIRMANSYAH. C (AIPTU)
  { nrp: "80060204", jabatan: "PANIT II RESKRIM" }, // IRWAN SURYANA (AIPTU)
  { nrp: "79050701", jabatan: "BHABINKAMTIBMAS" }, // M. IKBAL WIBIKSANA (AIPTU)
  { nrp: "89120324", jabatan: "BHABINKAMTIBMAS" }, // BAIHAQQI (BRIPKA)
  { nrp: "84030565", jabatan: "KASI UMUM" }, // UNANG SURYADINATA (AIPDA)
  { nrp: "74110663", jabatan: "PANIT II LANTAS" }, // NIKRON SITORUS (AIPDA)
  { nrp: "85110305", jabatan: "PS. PANIT II SAMAPTA" }, // NANA MAULANA (AIPDA)
  { nrp: "85111347", jabatan: "KANIT PROVOS" }, // HERMAN SUHERMANTO (AIPDA)
  { nrp: "85051648", jabatan: "PS. PANIT YANMIN INTEL" }, // GILMAN IRAWAN (AIPDA)
  { nrp: "88060092", jabatan: "PAUR MIN INTELKAM" }, // HARDI RICKSA. H (AIPDA)
  { nrp: "86081741", jabatan: "PANIT III SAMAPTA" }, // REZA ISMAIL (AIPDA)
  { nrp: "89080168", jabatan: "PAUR MIN RESKRIM" }, // BUDI RAHMAT (AIPDA)
  { nrp: "91010015", jabatan: "BHABINKAMTIBMAS" }, // RIZKI DIRGANTARA. N (BRIPKA)
  { nrp: "89020596", jabatan: "BA RESKRIM" }, // GATOT PRASTIO (BRIPKA)
  { nrp: "98060561", jabatan: "BA INTELKAM" }, // DEDE RAHARI MURDIYANTO (BRIPTU)
  { nrp: "99010638", jabatan: "BA RESKRIM" }, // ALDI MUHAMMAD (BRIPTU)
];

// Personel yang ADA di PDF Polsek Jatiluhur tapi TIDAK ada di master →
// data diambil penuh dari PDF (nama & pangkat tersedia di sana).
const TAMBAHAN_PDF = [
  { nrp: "198107142005012000", nama: "YULI CAHYANINGSIH, Amd. Kep", pangkat: "PENDA", jabatan: "KASI HUMAS" },
  { nrp: "196909112014121003", nama: "DEDI GUNAWAN", pangkat: "PENGDA", jabatan: "STAF UMUM" },
];

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

// ---------- Baca xlsx (master) ----------

const wb = XLSX.readFile(fileArg);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
  header: 1,
});

/** Normalisasi teks header: "N A M A" → "NAMA". */
const norm = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Petakan indeks kolom by nama header. Format baru (DATA PERSONEL FIX):
 * [N A M A, PANGKAT, NRP, JABATAN, FUNGSI, SATUAN, STATUS].
 * Fallback format lama (LAPBUL 4 kolom) → fungsi = JABATAN,
 * satuan/status = null.
 */
function findCols(header) {
  const idx = {
    nama: 0,
    pangkat: 1,
    nrp: 2,
    jabatan: 3,
    fungsi: -1,
    satuan: -1,
    status: -1,
  };
  for (let i = 0; i < header.length; i++) {
    const h = norm(header[i]);
    if (h === "NRP") idx.nrp = i;
    else if (h.startsWith("NAMA")) idx.nama = i;
    else if (h === "PANGKAT") idx.pangkat = i;
    else if (h === "JABATAN") idx.jabatan = i;
    else if (h === "FUNGSI") idx.fungsi = i;
    else if (h === "SATUAN") idx.satuan = i;
    else if (h === "STATUS") idx.status = i;
  }
  return idx;
}

const header = rows[0] ?? [];
const col = findCols(header);
const punyaFungsi = col.fungsi !== -1;

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
  const fungsiFile = col.fungsi !== -1 ? String(r[col.fungsi] ?? "").trim() : "";
  const satuan = col.satuan !== -1 ? String(r[col.satuan] ?? "").trim() : "";
  const status = col.status !== -1 ? String(r[col.status] ?? "").trim().toUpperCase() : "";

  if (!nama && !pangkat && !nrp && !jabatan && !fungsiFile) continue; // baris kosong

  if (!/^\d{5,12}$/.test(nrp) || !nama || !pangkat || !jabatan) {
    skipped.push([i + 1, JSON.stringify(r).slice(0, 120)]);
    continue;
  }

  // Duplikat dalam satu file: pertahankan yang pertama.
  if (seen.has(nrp)) continue;
  seen.set(nrp, true);

  // FUNGSI wajib ada: file baru → kolom FUNGSI; file lama → JABATAN.
  const fungsi = (punyaFungsi ? fungsiFile : jabatan) || jabatan;

  personel.push({
    nrp,
    nama,
    pangkat,
    jabatan,
    fungsi,
    satuan: satuan || null,
    status: status || null,
  });
}

// ---------- Overlay: jabatan personel Polsek Jatiluhur dari PDF ----------

const byNrp = new Map(personel.map((p) => [p.nrp, p]));
const overlayLog = [];

for (const o of OVERLAY_JATILUHUR) {
  const p = byNrp.get(o.nrp);
  if (!p) {
    overlayLog.push(`  ⚠️ NRP ${o.nrp} (overlay PDF) tidak ada di master — dilewati`);
    continue;
  }
  if (p.jabatan !== o.jabatan || p.satuan !== SATUAN_JATILUHUR) {
    overlayLog.push(
      `  ${o.nrp} ${p.nama}: ${p.jabatan} → ${o.jabatan} (${SATUAN_JATILUHUR})`,
    );
  }
  p.jabatan = o.jabatan;
  p.satuan = SATUAN_JATILUHUR;
}

for (const t of TAMBAHAN_PDF) {
  if (byNrp.has(t.nrp)) continue;
  const row = {
    nrp: t.nrp,
    nama: t.nama,
    pangkat: t.pangkat,
    jabatan: t.jabatan,
    fungsi: t.jabatan, // fallback: PDF tidak punya kolom FUNGSI
    satuan: SATUAN_JATILUHUR,
    status: "AKTIF",
  };
  personel.push(row);
  byNrp.set(t.nrp, row);
  overlayLog.push(`  + ${t.nrp} ${t.nama} (${t.pangkat}) — ${t.jabatan} — TAMBAHAN dari PDF`);
}

console.log(`File       : ${fileArg}`);
console.log(`Sheet      : ${wb.SheetNames[0]}`);
console.log(`Kolom FUNGSI: ${punyaFungsi ? "ada (format baru)" : "tidak ada — fallback JABATAN"}`);
console.log(`Valid      : ${personel.length} personel (termasuk overlay PDF Jatiluhur)`);
console.log(`Dilewati   : ${skipped.length} baris`);
skipped.slice(0, 10).forEach(([line, raw]) => console.log(`  baris ${line}: ${raw}`));
console.log(`Overlay PDF Polsek Jatiluhur (jabatan → PDF, NRP → master):`);
overlayLog.forEach((l) => console.log(l));

if (dryRun) {
  console.log("\n--dry-run — tidak menulis ke Supabase. Contoh 3 data:");
  personel.slice(0, 3).forEach((p) =>
    console.log(`  ${p.nrp} | ${p.pangkat} | ${p.nama} | ${p.jabatan} | fungsi=${p.fungsi} | satuan=${p.satuan} | status=${p.status}`),
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
