import * as XLSX from "xlsx";
import type { Laporan } from "../../types";
import { formatKoordinat } from "../../lib/cycle";
import type { ExportCtx } from "./exportPdf";
import { reguDisplayName } from "../../lib/regu";

/** Export laporan ke file Excel tabular (satu baris per laporan). */
export async function exportExcel(
  laporan: Laporan[],
  ctx: ExportCtx,
): Promise<void> {
  const rows = laporan.map((l) => ({
    Waktu: new Date(l.timestamp_kirim).toLocaleString("id-ID"),
    Pelapor: l.regu ? reguDisplayName(l.regu) : l.regu_id,
    Keterangan: l.catatan ?? "",
    Siklus: l.siklus_ke,
    Latitude: l.latitude ?? "",
    Longitude: l.longitude ?? "",
    Koordinat: formatKoordinat(l.latitude, l.longitude),
    Jumlah_Foto: l.fotos?.length ?? 0,
    Path_Foto: (l.fotos ?? []).map((f) => f.storage_path).join("; "),
    Watermark_Lat: (l.fotos ?? []).map((f) => f.watermark_lat ?? "").join("; "),
    Watermark_Lng: (l.fotos ?? []).map((f) => f.watermark_lng ?? "").join("; "),
    Watermark_Waktu: (l.fotos ?? [])
      .map((f) => f.watermark_timestamp)
      .join("; "),
    Jumlah_Video: (l.videos ?? []).length,
    Path_Video: (l.videos ?? []).map((v) => v.storage_path).join("; "),
    Video_Durasi_Detik: (l.videos ?? [])
      .map((v) => v.duration_seconds ?? "")
      .join("; "),
    Video_Watermark_Waktu: (l.videos ?? [])
      .map((v) => v.watermark_timestamp)
      .join("; "),
    Status_Sync: l.status_sync,
  }));

  // Sheet rekap per regu
  const perRegu = new Map<string, { laporan: number; foto: number; video: number }>();
  for (const l of laporan) {
    const key = l.regu ? reguDisplayName(l.regu) : l.regu_id;
    const cur = perRegu.get(key) ?? { laporan: 0, foto: 0, video: 0 };
    cur.laporan += 1;
    cur.foto += l.fotos?.length ?? 0;
    cur.video += l.videos?.length ?? 0;
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
    "siplap-" +
      (ctx.reguId === "all" ? "gabungan" : ctx.reguId) +
      "-" +
      ctx.range.from.toISOString().slice(0, 10) +
      ".xlsx",
  );
}
