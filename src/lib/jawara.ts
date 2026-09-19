export interface JawaraGroup {
  name: string;
  count: number;
  scope: "polres" | "polsek";
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
    title: "Kapolres / Wakapolres",
    access: "all",
    description:
      "Memantau seluruh laporan giat dari semua Polsek dan satuan Polres.",
    username: "polres.kapolres",
  },
  {
    title: "Admin Utama",
    access: "all",
    description: "Mengelola akun, konfigurasi, dan seluruh sistem pelaporan.",
    username: "polres.admin",
  },
  {
    title: "Kapolsek",
    access: "wilayah",
    description: "Memantau seluruh laporan fungsi di wilayah Polseknya.",
    username: "plered.kapolsek",
  },
  {
    title: "Kasat Polres",
    access: "fungsi",
    description:
      "Memantau fungsi terkait di tingkat Polres dan seluruh Polsek.",
    username: "reskrim.kasat",
  },
  {
    title: "Pelapor level 1",
    access: "pelapor-level-1",
    description:
      "Unit atau fungsi di bawah Kapolsek yang membuat laporan giat.",
    username: "plered.bhabin02",
  },
  {
    title: "Pelapor level 2",
    access: "pelapor-level-2",
    description: "Unit di bawah Kasat Polres yang membuat laporan giat.",
    username: "reskrim.banit03",
  },
];

export const jawaraStructure = {
  allAccessMonitors: 2,
  functionMonitors: [
    "KASAT INTEL",
    "KASAT RESKRIM",
    "KASATRESNARKOBA",
    "KASAT BINMAS",
    "KASAT SAMAPTA",
    "PAMOBVIT SAMAPTA",
    "KASAT LANTAS",
    "KASAT POLAIR",
    "KASAT TAHTI",
    "KASAT SPKT",
  ],
  polsekMonitors: [
    "KAPOLSEK PURWAKARTA KOTA",
    "KAPOLSEK PLERED",
    "KAPOLSEK JATILUHUR",
    "KAPOLSEK BUNGURSARI",
    "KAPOLSEK CAMPAKA",
    "KAPOLSEK CIBATU",
    "KAPOLSEK PASAWAHAN",
    "KAPOLSEK DARANGDAN",
    "KAPOLSEK WANAYASA",
    "KAPOLSEK MANIIS",
    "KAPOLSEK SUKATANI",
    "KAPOLSEK SUKASARI",
    "KAPOLSEK KIARAPEDES",
    "KAPOLSEK BOJONG",
  ],
  polresReporters: [
    { name: "SATUAN INTELKAM", count: 30, scope: "polres" },
    { name: "SATUAN RESKRIM", count: 73, scope: "polres" },
    { name: "SATUAN RESNARKOBA", count: 35, scope: "polres" },
    { name: "SATUAN BINMAS", count: 9, scope: "polres" },
    { name: "SATUAN SAMAPTA", count: 44, scope: "polres" },
    { name: "PAM OBVIT SAMAPTA", count: 24, scope: "polres" },
    { name: "SATUAN LANTAS", count: 96, scope: "polres" },
    { name: "SATUAN POLAIR", count: 7, scope: "polres" },
    { name: "SATUAN TAHTI", count: 10, scope: "polres" },
  ],
  polsekReporters: [
    { name: "POLSEK PURWAKARTA KOTA", count: 35, scope: "polsek" },
    { name: "POLSEK PLERED", count: 25, scope: "polsek" },
    { name: "POLSEK JATILUHUR", count: 27, scope: "polsek" },
    { name: "POLSEK BUNGURSARI", count: 27, scope: "polsek" },
    { name: "POLSEK CAMPAKA", count: 22, scope: "polsek" },
    { name: "POLSEK CIBATU", count: 23, scope: "polsek" },
    { name: "POLSEK PASAWAHAN", count: 24, scope: "polsek" },
    { name: "POLSEK DARANGDAN", count: 16, scope: "polsek" },
    { name: "POLSEK WANAYASA", count: 18, scope: "polsek" },
    { name: "POLSEK MANIIS", count: 14, scope: "polsek" },
    { name: "POLSEK SUKATANI", count: 16, scope: "polsek" },
    { name: "POLSEK SUKASARI", count: 16, scope: "polsek" },
    { name: "POLSEK KIARAPEDES", count: 12, scope: "polsek" },
    { name: "POLSEK BOJONG", count: 14, scope: "polsek" },
  ],
  spktReporters: [
    { name: "SPKT PURWAKARTA KOTA", wilayah: "kota" },
    { name: "SPKT PLERED", wilayah: "plered" },
    { name: "SPKT JATILUHUR", wilayah: "jatiluhur" },
    { name: "SPKT BUNGURSARI", wilayah: "bungursari" },
    { name: "SPKT CAMPAKA", wilayah: "campaka" },
    { name: "SPKT CIBATU", wilayah: "cibatu" },
    { name: "SPKT PASAWAHAN", wilayah: "pasawahan" },
    { name: "SPKT DARANGDAN", wilayah: "darangdan" },
    { name: "SPKT WANAYASA", wilayah: "wanayasa" },
    { name: "SPKT MANIIS", wilayah: "maniis" },
    { name: "SPKT SUKATANI", wilayah: "sukatani" },
    { name: "SPKT SUKASARI", wilayah: "sukasari" },
    { name: "SPKT KIARAPEDES", wilayah: "kiarapedes" },
    { name: "SPKT BOJONG", wilayah: "bojong" },
  ],
} as const;

export const jawaraTotals = {
  functionMonitors: jawaraStructure.functionMonitors.length,
  polsekMonitors: jawaraStructure.polsekMonitors.length,
  polresReporters: jawaraStructure.polresReporters.reduce(
    (sum, item) => sum + item.count,
    0,
  ),
  polsekReporters: jawaraStructure.polsekReporters.reduce(
    (sum, item) => sum + item.count,
    0,
  ),
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
