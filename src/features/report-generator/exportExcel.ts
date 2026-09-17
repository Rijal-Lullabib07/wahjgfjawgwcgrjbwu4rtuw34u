import * as XLSX from 'xlsx';
import type { Laporan } from '../../types';
import { formatKoordinat } from '../../lib/cycle';
import type { ExportCtx } from './exportPdf';

/** Export laporan ke file Excel tabular (satu baris per laporan). */
export async function exportExcel(laporan: Laporan[], ctx: ExportCtx): Promise<void> {
  const rows = laporan.map((l) => ({
    Waktu: new Date(l.timestamp_kirim).toLocaleString('id-ID'),
    Regu: l.regu?.nama_regu ?? l.regu_id,
    Siklus: l.siklus_ke,
    Latitude: l.latitude ?? '',
    Longitude: l.longitude ?? '',
    Koordinat: formatKoordinat(l.latitude, l.longitude),
    Jumlah_Foto: l.fotos?.length ?? 0,
    Path_Foto: (l.fotos ?? []).map((f) => f.storage_path).join('; '),
    Watermark_Lat: (l.fotos ?? []).map((f) => f.watermark_lat ?? '').join('; '),
    Watermark_Lng: (l.fotos ?? []).map((f) => f.watermark_lng ?? '').join('; '),
    Watermark_Waktu: (l.fotos ?? []).map((f) => f.watermark_timestamp).join('; '),
    Status_Sync: l.status_sync,
  }));

  // Sheet rekap per regu
  const perRegu = new Map<string, number>();
  for (const l of laporan) {
    const key = l.regu?.nama_regu ?? l.regu_id;
    perRegu.set(key, (perRegu.get(key) ?? 0) + 1);
  }
  const rekapRows = [...perRegu.entries()].map(([nama, jumlah]) => ({
    Regu: nama,
    Jumlah_Laporan: jumlah,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  const wsRekap = XLSX.utils.json_to_sheet(rekapRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
  XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap Regu');
  XLSX.writeFile(wb, 'siplap-' + (ctx.reguId === 'all' ? 'gabungan' : ctx.reguId) + '-' + ctx.range.from.toISOString().slice(0, 10) + '.xlsx');
}
