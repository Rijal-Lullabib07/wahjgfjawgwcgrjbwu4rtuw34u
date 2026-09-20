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
    username: "polres.kapolres",
  },
  {
    title: "Wakapolres",
    access: "all",
    description: "Memantau seluruh laporan (read-only, tanpa kelola).",
    username: "polres.wakapolres",
  },
  {
    title: "Admin Utama",
    access: "all",
    description:
      "Akun terpisah untuk mengelola akun, konfigurasi, dan seluruh sistem.",
    username: "polres.admin",
  },
  {
    title: "Kasat Polres",
    access: "fungsi",
    description:
      "Memantau satuannya di Polres dan folder unit yang sama di tiap Polsek.",
    username: "reskrim.kasat",
  },
  {
    title: "Kapolsek",
    access: "wilayah",
    description:
      "Langsung masuk ke folder Polseknya dan memantau seluruh unit di wilayah itu.",
    username: "jatiluhur.kapolsek",
  },
  {
    title: "Pelapor level 2",
    access: "pelapor-level-2",
    description: "Satu akun per satuan Polres yang membuat laporan giat.",
    username: "reskrim.polres",
  },
  {
    title: "Pelapor level 1",
    access: "pelapor-level-1",
    description:
      "Satu akun per unit di Polsek (mis. reskrim.jatiluhur) plus SPKT per Polsek.",
    username: "reskrim.jatiluhur",
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

const unitLabels: Record<string, string> = {
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

// Presensi unit per Polsek — sama dengan seed db_supabase.sql & provision.
const allWilayah = wilayahList.map(([w]) => w);
const unitPresence: Record<string, string[]> = {
  reskrim: [...allWilayah],
  intelkam: [...allWilayah],
  bhabinkamtibmas: [...allWilayah],
  samapta: allWilayah.filter((w) => w !== "sukatani"),
  binmas: allWilayah.filter(
    (w) => !["plered", "darangdan", "sukasari"].includes(w),
  ),
  propam: allWilayah.filter(
    (w) => !["kota", "campaka", "maniis"].includes(w),
  ),
  lantas: ["kota", "plered", "jatiluhur", "bungursari", "cibatu"],
  sium: [...allWilayah],
  spkt: [...allWilayah],
};

export const jawaraStructure = {
  /** 146 = 27 pemantau + 9 pelapor Polres + 110 pelapor Polsek. */
  totalAccounts: 146,
  allAccessMonitors: 3,
  allAccessNames: ["KAPOLRES", "WAKAPOLRES (read-only)", "ADMIN UTAMA"],
  functionMonitors: [
    "KASAT INTELKAM",
    "KASAT RESKRIM",
    "KASAT RESNARKOBA",
    "KASAT BINMAS",
    "KASAT SAMAPTA",
    "PAM OBVIT SAMAPTA",
    "KASAT LANTAS",
    "KASAT POLAIR",
    "KASAT TAHTI",
    "KASAT SPKT",
  ],
  polsekMonitors: wilayahList.map(
    ([, nama]) => `KAPOLSEK ${nama.toUpperCase()}`,
  ),
  polresReporters: [
    { name: "SATUAN INTELKAM", count: 1, items: ["intelkam.polres"], scope: "polres" },
    { name: "SATUAN RESKRIM", count: 1, items: ["reskrim.polres"], scope: "polres" },
    { name: "SATUAN RESNARKOBA", count: 1, items: ["narkoba.polres"], scope: "polres" },
    { name: "SATUAN BINMAS", count: 1, items: ["binmas.polres"], scope: "polres" },
    { name: "SATUAN SAMAPTA", count: 1, items: ["samapta.polres"], scope: "polres" },
    { name: "PAM OBVIT SAMAPTA", count: 1, items: ["pamobvit.polres"], scope: "polres" },
    { name: "SATUAN LANTAS", count: 1, items: ["lantas.polres"], scope: "polres" },
    { name: "SATUAN POLAIR", count: 1, items: ["polair.polres"], scope: "polres" },
    { name: "SATUAN TAHTI", count: 1, items: ["tahti.polres"], scope: "polres" },
  ] as JawaraGroup[],
  polsekReporters: wilayahList.map(([wilayah, nama]) => {
    const units = Object.entries(unitPresence)
      .filter(([unit, wilayahs]) => unit !== "spkt" && wilayahs.includes(wilayah))
      .map(([unit]) => `${unitLabels[unit] ?? unit} — ${unit}.${wilayah}`);
    const items = unitPresence.spkt.includes(wilayah)
      ? [...units, `SPKT — spkt.${wilayah}`]
      : units;
    return {
      name: `POLSEK ${nama.toUpperCase()}`,
      count: items.length,
      items,
      scope: "polsek" as const,
    };
  }),
};

export const jawaraTotals = {
  pemantau:
    jawaraStructure.allAccessMonitors +
    jawaraStructure.functionMonitors.length +
    jawaraStructure.polsekMonitors.length, // 27
  polresReporters: jawaraStructure.polresReporters.reduce(
    (sum, item) => sum + item.count,
    0,
  ), // 9
  polsekReporters: jawaraStructure.polsekReporters.reduce(
    (sum, item) => sum + item.count,
    0,
  ), // 96 + 14 SPKT = 110
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
