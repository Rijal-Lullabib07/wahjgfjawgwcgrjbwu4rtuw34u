export interface JawaraGroup {
  name: string;
  count: number;
  scope: "polres" | "polsek";
  /** Daftar akun di dalam grup (untuk tampilan Struktur). */
  items?: string[];
}

export type JawaraAccess =
  | "all"
  | "wilayah"
  | "fungsi"
  | "pelapor-level-1"
  | "pelapor-level-2";

export interface JawaraRole {
  title: string;
  access: JawaraAccess;
  description: string;
  username: string;
}

export const jawaraRoles: JawaraRole[] = [
  {
    title: "Kapolres",
    access: "all",
    description:
      "Memantau seluruh laporan dan mengelola sistem (pemantau + kelola).",
    username: "kapolres.purwakarta",
  },
  {
    title: "Wakapolres",
    access: "all",
    description: "Memantau seluruh laporan (read-only, tanpa kelola).",
    username: "wakapolres.purwakarta",
  },
  {
    title: "Kabag Operasional",
    access: "all",
    description:
      "Memantau seluruh laporan dan mengelola sistem (setara Kapolres).",
    username: "kabag.ops",
  },
  {
    title: "Kasat Polres",
    access: "fungsi",
    description:
      "Memantau satuannya di Polres dan folder unit yang sama di tiap Polsek.",
    username: "sat.reskrim",
  },
  {
    title: "Kapolsek",
    access: "wilayah",
    description:
      "Langsung masuk ke folder Polseknya dan memantau seluruh unit di wilayah itu.",
    username: "kapolsek.jatiluhur",
  },
  {
    title: "Pelapor level 2",
    access: "pelapor-level-2",
    description: "Satu akun per unit satuan Polres yang membuat laporan giat.",
    username: "sat.reskrim.unit1",
  },
  {
    title: "Pelapor level 1",
    access: "pelapor-level-1",
    description:
      "Satu akun per unit di Polsek (mis. unit.reskrim.jatiluhur) plus SPKT per Polsek.",
    username: "unit.reskrim.jatiluhur",
  },
];

const wilayahList: Array<[string, string]> = [
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

// Satuan Polres yang punya akun pelapor sat.unit1..N ( struktur v2).
const satuanUnits = [
  ["intelkam", "Satintelkam"],
  ["reskrim", "Satreskrim"],
  ["resnarkoba", "Satresnarkoba"],
  ["binmas", "Satbinmas"],
  ["samapta", "Satsamapta"],
  ["lantas", "Satlantas"],
  ["polair", "Satpolairud"],
  ["tahti", "Sattahti"],
] as const;

const satuanUnitCounts: Record<(typeof satuanUnits)[number][0], number> = {
  intelkam: 4,
  reskrim: 5,
  resnarkoba: 2,
  binmas: 1,
  samapta: 3,
  lantas: 5,
  polair: 2,
  tahti: 1,
};

const satuanLabels: Record<string, string> = {
  intelkam: "Intelkam",
  reskrim: "Reskrim",
  resnarkoba: "Resnarkoba",
  binmas: "Binmas",
  samapta: "Samapta",
  lantas: "Lantas",
  polair: "Polair",
  tahti: "Tahti",
  spkt: "SPKT",
};

// Presensi unit per Polsek (struktur v2): semua unit seragam 14 Polsek.
const allWilayah = wilayahList.map(([w]) => w);
const unitPresence: Record<string, string[]> = {
  spkt: [...allWilayah],
  intelkam: [...allWilayah],
  reskrim: [...allWilayah],
  binmas: [...allWilayah],
  samapta: [...allWilayah],
  lantas: [...allWilayah],
};

export const jawaraStructure = {
  /** 132 = 25 pemantau (3 all-access + 8 kasat + 14 kapolsek) + 107 pelapor
   *  (23 satuan + 84 Polsek). Semua akun lama dihapus & dibuat ulang. */
  totalAccounts: 132,
  allAccessMonitors: 3,
  allAccessNames: [
    "KAPOLRES PURWAKARTA",
    "WAKAPOLRES PURWAKARTA (read-only)",
    "KABAG OPERASIONAL",
  ],
  functionMonitors: [
    "KASAT INTELKAM",
    "KASAT RESKRIM",
    "KASAT RESNARKOBA",
    "KASAT BINMAS",
    "KASAT SAMAPTA",
    "KASAT LANTAS",
    "KASAT POLAIR",
    "KASAT TAHTI",
  ],
  polsekMonitors: wilayahList.map(
    ([, nama]) => `KAPOLSEK ${nama.toUpperCase()}`,
  ),
  polresReporters: satuanUnits.map(([unit, name]) => ({
    name,
    count: satuanUnitCounts[unit],
    items: Array.from(
      { length: satuanUnitCounts[unit] },
      (_, i) => `sat.${unit}.unit${i + 1}`,
    ),
    scope: "polres" as const,
  })),
  polsekReporters: wilayahList.map(([wilayah, nama]) => ({
    name: `POLSEK ${nama.toUpperCase()}`,
    count: 6,
    items: Object.keys(unitPresence).map(
      (unit) =>
        `${satuanLabels[unit] ?? unit} — unit.${unit}.${wilayah}`,
    ),
    scope: "polsek" as const,
  })),
};

export const jawaraTotals = {
  pemantau:
    jawaraStructure.allAccessMonitors +
    jawaraStructure.functionMonitors.length +
    jawaraStructure.polsekMonitors.length, // 3 + 8 + 14 = 25
  polresReporters: jawaraStructure.polresReporters.reduce(
    (sum, item) => sum + item.count,
    0,
  ), // 23
  polsekReporters: jawaraStructure.polsekReporters.reduce(
    (sum, item) => sum + item.count,
    0,
  ), // 84
};

const unitTerms: Record<string, string[]> = {
  intelkam: ["INTELKAM", "INTEL"],
  reskrim: ["RESKRIM"],
  narkoba: ["RES NARKOBA", "NARKOBA"],
  binmas: ["BINMAS"],
  samapta: ["SAMAPTA"],
  pamobvit: ["PAM OBVIT SAMAPTA", "PAM OBVIT"],
  lantas: ["LANTAS"],
  polair: ["POLAIR"],
  tahti: ["TAHTI"],
  spkt: ["SPKT"],
};

/** Build the username format defined by panduan-update-app-web.html. */
export function makeJawaraUsername(
  unit: string,
  position: string,
  number?: number | null,
): string {
  let value = position.toUpperCase().replace(/\s+/g, " ").trim();
  if (!value) return "";

  const kanitMatch = value.match(/^KANIT\s+(?:\d+|IV|V|I{1,3})\s*\(([^)]*)\)$/);
  if (kanitMatch) {
    value = `KANIT ${kanitMatch[1]}`;
  } else {
    value = value
      .replace(/\(.*?\)/g, " ")
      .split("/")[0]
      .replace(/^PS\.?\s*/, "")
      .trim();
  }

  value = value
    .replace(/^KASAT(?=[A-Z])/, "KASAT ")
    .replace(/\bSAT ?RES ?NARKOBA\b/g, " ")
    .replace(
      /\b(?:SATRESKRIM|SATTAHTI|SATLANTAS|SATSAMAPTA|SATUAN|SAT)\b/g,
      " ",
    );
  for (const term of unitTerms[unit] ?? []) {
    value = value.replace(new RegExp(`\\b${term}\\b`, "g"), " ");
  }
  value = value.replace(/\s+/g, " ").trim();

  const abbreviation: Record<string, string> = {
    OPSNAL: "OPS",
    YANMIN: "YAN",
    BENDAHARA: "BEND",
    PATWALAIR: "PATWAL",
    BINMASAIR: "BINMAS",
  };
  for (const [from, to] of Object.entries(abbreviation))
    value = value.split(from).join(to);

  const slug = value.replace(/[^A-Z0-9]/g, "").toLowerCase() || "pemantau";
  const suffix = number == null ? "" : String(number).padStart(2, "0");
  return `${unit}.${slug}${suffix}`.slice(0, 30);
}
