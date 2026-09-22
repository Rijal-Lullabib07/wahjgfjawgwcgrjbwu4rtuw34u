import * as XLSX from "xlsx";
import type { Laporan } from "../../types";
import type { ExportCtx } from "./exportPdf";
import { reguDisplayName } from "../../lib/regu";

/** Normalisasi relasi video/foto: bisa array, objek tunggal, atau null. */
function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

/** Export laporan ke file Excel tabular (satu baris per laporan). */
export async function exportExcel(
  laporan: Laporan[],
  ctx: ExportCtx,
): Promise<void> {
  const rows = laporan.map((l) => ({
    Waktu: new Date(l.timestamp_kirim).toLocaleString("id-ID"),
    Pelapor: l.regu ? reguDisplayName(l.regu) : l.regu_id,
    NRP: l.nrp_pelapor ?? "",
    Keterangan: l.catatan ?? "",
    Latitude: l.latitude ?? "",
    Longitude: l.longitude ?? "",
    Koordinat:
      l.latitude != null && l.longitude != null
        ? `${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)}`
        : "",
    Jumlah_Foto: asArray(l.fotos).length,
    Path_Foto: asArray(l.fotos)
      .map((f) => f.storage_path)
      .join("; "),
    Watermark_Lat: asArray(l.fotos)
      .map((f) => f.watermark_lat ?? "")
      .join("; "),
    Watermark_Lng: asArray(l.fotos)
      .map((f) => f.watermark_lng ?? "")
      .join("; "),
    Watermark_Waktu: asArray(l.fotos)
      .map((f) => f.watermark_timestamp)
      .join("; "),
    Jumlah_Video: asArray(l.videos).length,
    Path_Video: asArray(l.videos)
      .map((v) => v.storage_path ?? "")
      .filter(Boolean)
      .join("; "),
    Video_Durasi_Detik: asArray(l.videos)
      .map((v) => v.duration_seconds ?? "")
      .join("; "),
    Video_Watermark_Waktu: asArray(l.videos)
      .map((v) => v.watermark_timestamp ?? "")
      .join("; "),
    Video: asArray(l.videos).length > 0 ? "Tersedia" : "Tidak ada",
    Status_Sync: l.status_sync,
  }));

  // Sheet rekap per regu
  const perRegu = new Map<string, { laporan: number; foto: number; video: number }>();
  for (const l of laporan) {
    const key = l.regu ? reguDisplayName(l.regu) : l.regu_id;
    const cur = perRegu.get(key) ?? { laporan: 0, foto: 0, video: 0 };
    cur.laporan += 1;
    cur.foto += asArray(l.fotos).length;
    cur.video += asArray(l.videos).length;
    perRegu.set(key, cur);
  }
  const rekapRows = [...perRegu.entries()].map(([nama, counts]) => ({
    Pelapor: nama,
    Jumlah_Laporan: counts.laporan,
    Jumlah_Foto: counts.foto,
    Jumlah_Video: counts.video,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  const wsRekap = XLSX.utils.json_to_sheet(rekapRows);
  XLSX.utils.book_append_sheet(wb, ws, "Laporan");
  XLSX.utils.book_append_sheet(wb, wsRekap, "Rekap Pelapor");
  XLSX.writeFile(
    wb,
    "salam-presisi-" +
      (ctx.reguId === "all" ? "gabungan" : ctx.reguId) +
      "-" +
      ctx.range.from.toISOString().slice(0, 10) +
      ".xlsx",
  );
}
