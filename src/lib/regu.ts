import type { Regu } from "../types";

const wilayahNames: Record<string, string> = {
  kota: "Purwakarta Kota",
  plered: "Plered",
  jatiluhur: "Jatiluhur",
  bungursari: "Bungursari",
  campaka: "Campaka",
  cibatu: "Cibatu",
  pasawahan: "Pasawahan",
  darangdan: "Darangdan",
  wanayasa: "Wanayasa",
  maniis: "Maniis",
  sukatani: "Sukatani",
  sukasari: "Sukasari",
  kiarapedes: "Kiarapedes",
  bojong: "Bojong",
};

const unitNames: Record<string, string> = {
  intelkam: "Satintelkam",
  reskrim: "Satreskrim",
  narkoba: "Satresnarkoba",
  binmas: "Satbinmas",
  samapta: "Satsamapta",
  pamobvit: "Pam Obvit Samapta",
  lantas: "Satlantas",
  polair: "Satpolairud",
  tahti: "Sattahti",
  spkt: "SPKT",
};

function titleFromKey(key: string): string {
  return key
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function reguOrigin(regu: Pick<Regu, "unit_key" | "wilayah_key">): string {
  if (regu.wilayah_key) {
    const key = regu.wilayah_key.trim().toLowerCase();
    return `Polsek ${wilayahNames[key] ?? titleFromKey(key)}`;
  }
  if (regu.unit_key) {
    const key = regu.unit_key.trim().toLowerCase();
    return `Polsek belum ditentukan · Unit Polres: ${
      unitNames[key] ?? titleFromKey(key)
    }`;
  }
  return "Asal belum diatur";
}

export function reguDisplayName(regu: Regu): string {
  return `${regu.nama_regu} — ${reguOrigin(regu)}`;
}
