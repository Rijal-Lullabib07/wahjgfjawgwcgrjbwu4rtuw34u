import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Laporan, Regu } from '../../types';
import { formatKoordinat, formatWaktu } from '../../lib/cycle';
import { fotoUrl } from '../../lib/supabase/api';

export interface ExportCtx {
  range: { from: Date; to: Date };
  reguList: Regu[];
  reguId: string; // 'all' atau id regu
}

/** Konversi blob → dataURL untuk jsPDF. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Ambil foto dari Supabase Storage → dataURL. */
async function fotoDataUrl(storagePath: string): Promise<string | null> {
  try {
    const res = await fetch(fotoUrl(storagePath));
    if (!res.ok) return null;
    return await blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}

/** Export laporan ke PDF dengan ringkasan, tabel rekap, dan thumbnail foto. */
export async function exportPdf(laporan: Laporan[], ctx: ExportCtx): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title =
    ctx.reguId === 'all'
      ? 'Laporan Gabungan'
      : 'Laporan ' + (ctx.reguList.find((r) => r.id === ctx.reguId)?.nama_regu ?? 'Regu');

  // Header
  doc.setFontSize(14);
  doc.text('SIPLAP — Sistem Informasi Pelaporan Giat Lapangan', 14, 16);
  doc.setFontSize(11);
  doc.text(title + ' (Satpol PP)', 14, 23);
  doc.setFontSize(9);
  doc.text(
    'Periode: ' +
      ctx.range.from.toLocaleDateString('id-ID') +
      ' s.d. ' +
      ctx.range.to.toLocaleDateString('id-ID'),
    14,
    29,
  );
  doc.text('Dicetak: ' + new Date().toLocaleString('id-ID'), 14, 34);

  const totalFoto = laporan.reduce((a, l) => a + (l.fotos?.length ?? 0), 0);
  doc.text('Total laporan: ' + laporan.length + '  ·  Total foto: ' + totalFoto, 14, 40);

  // Tabel rekap
  autoTable(doc, {
    startY: 45,
    head: [['Waktu', 'Regu', 'Siklus', 'Koordinat', 'Foto', 'Status']],
    body: laporan.map((l) => [
      new Date(l.timestamp_kirim).toLocaleString('id-ID'),
      l.regu?.nama_regu ?? l.regu_id,
      String(l.siklus_ke),
      formatKoordinat(l.latitude, l.longitude),
      String(l.fotos?.length ?? 0),
      l.status_sync,
    ]),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 61, 110] },
    alternateRowStyles: { fillColor: [240, 244, 250] },
  });

  // Detail foto: thumbnail + metadata (batasi agar PDF tidak membengkak)
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  const detail = laporan.slice(0, 30);
  const maxFoto = 60;
  let fotoCount = 0;

  for (const l of detail) {
    if (y > 250) {
      doc.addPage();
      y = 16;
    }
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(
      (l.regu?.nama_regu ?? 'Regu') + ' — Siklus ' + l.siklus_ke + ' — ' + formatWaktu(l.timestamp_kirim),
      14,
      y,
    );
    doc.setFont('helvetica', 'normal');
    y += 4;

    for (const f of l.fotos ?? []) {
      if (fotoCount >= maxFoto) break;
      const dataUrl = await fotoDataUrl(f.storage_path);
      const x = 14 + (fotoCount % 3) * 62;
      if (dataUrl) {
        doc.addImage(dataUrl, 'JPEG', x, y, 58, 44);
      } else {
        doc.setDrawColor(200);
        doc.rect(x, y, 58, 44);
        doc.setFontSize(7);
        doc.text('foto tidak tersedia', x + 4, y + 23);
        doc.setFontSize(9);
      }
      doc.setFontSize(6.5);
      doc.text(
        formatKoordinat(f.watermark_lat, f.watermark_lng) + ' · ' + formatWaktu(f.watermark_timestamp),
        x,
        y + 48,
      );
      fotoCount++;
      if (fotoCount % 3 === 0) y += 56;
    }
    if ((l.fotos?.length ?? 0) % 3 !== 0) y += 56;
    y += 4;
  }

  const fname =
    'siplap-' +
    (ctx.reguId === 'all' ? 'gabungan' : ctx.reguId) +
    '-' +
    ctx.range.from.toISOString().slice(0, 10) +
    '.pdf';
  doc.save(fname);
}
