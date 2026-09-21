import { jsPDF } from "jspdf";
import type { Laporan } from "../../types";
import { TAHAP_LABEL } from "../../types";
import { formatTanggal, formatWaktu } from "../../lib/cycle";
import { reguOrigin } from "../../lib/regu";
import { fotoUrl } from "../../lib/supabase/api";

/** Konversi blob → dataURL untuk jsPDF. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Ambil foto dari Supabase Storage → dataURL (null bila gagal). */
async function mediaDataUrl(storagePath: string): Promise<string | null> {
  try {
    const res = await fetch(fotoUrl(storagePath));
    if (!res.ok) return null;
    return await blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}

/** Koordinat 6 desimal untuk dokumen resmi; "—" bila kosong. */
function koordinat(lat: number | null, lng: number | null): string {
  return lat == null || lng == null ? "—" : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/**
 * Ekspor satu rangkaian laporan menjadi dokumen PDF formal:
 * kop, identitas laporan, uraian per tahap dengan foto, penutup.
 */
export async function exportThreadPdf(
  entries: Laporan[],
  root: Laporan,
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const M = 14; // margin kiri/kanan
  const W = 182; // lebar area konten
  let y = 16;

  const ensureSpace = (needed: number) => {
    if (y + needed > 282) {
      doc.addPage();
      y = 16;
    }
  };

  const terbaru = entries[entries.length - 1];
  const nomorDokumen = `LAP/${root.id.slice(0, 8).toUpperCase()}/${new Date(
    root.timestamp_kirim,
  ).getFullYear()}`;

  // ---------- Kop ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("KEPOLISIAN NEGARA REPUBLIK INDONESIA", 105, y, { align: "center" });
  y += 6;
  doc.setFontSize(16);
  doc.text("POLRES PURWAKARTA", 105, y, { align: "center" });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Pelaporan Giat Lapangan — SALAM PRESISI", 105, y, { align: "center" });
  y += 3;
  doc.setDrawColor(20, 40, 70);
  doc.setLineWidth(0.8);
  doc.line(M, y, M + W, y);
  doc.setLineWidth(0.2);
  y += 8;

  // ---------- Judul ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(
    (root.kategori === "kejadian" ? "LAPORAN KEJADIAN" : "LAPORAN KEGIATAN").toUpperCase(),
    105,
    y,
    { align: "center" },
  );
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nomor: ${nomorDokumen}`, 105, y, { align: "center" });
  y += 8;

  // ---------- Identitas ----------
  const baris: Array<[string, string]> = [
    [
      "Pelapor",
      root.regu ? `${root.regu.nama_regu} — ${reguOrigin(root.regu)}` : root.regu_id,
    ],
    ["Jenis", root.jenis?.nama ?? (root.kategori === "kejadian" ? "Kejadian" : "Kegiatan")],
    ["Perihal", root.perihal ?? "—"],
    [
      "Tanggal awal",
      `${formatTanggal(root.timestamp_kirim)}, ${formatWaktu(root.timestamp_kirim)} WIB`,
    ],
    [
      "Pembaruan terakhir",
      `${formatTanggal(terbaru.timestamp_kirim)}, ${formatWaktu(terbaru.timestamp_kirim)} WIB`,
    ],
    ["Lokasi", koordinat(root.latitude, root.longitude)],
    ["Status", TAHAP_LABEL[terbaru.tahap]],
  ];
  doc.setFontSize(9);
  for (const [label, value] of baris) {
    ensureSpace(6);
    doc.setFont("helvetica", "bold");
    doc.text(label, M, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(`: ${value}`, W - 40);
    doc.text(lines, M + 38, y);
    y += lines.length * 4.5 + 1.5;
  }
  y += 3;

  // ---------- Uraian per tahap ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  ensureSpace(10);
  doc.text("URAIAN RANGKAIAN LAPORAN", M, y);
  y += 6;

  for (let i = 0; i < entries.length; i++) {
    const l = entries[i];
    ensureSpace(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${ROMAWI[i] ?? i + 1}. ${TAHAP_LABEL[l.tahap]}`, M, y);
    y += 4.5;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(
      `${formatTanggal(l.timestamp_kirim)}, ${formatWaktu(l.timestamp_kirim)} WIB · ${koordinat(l.latitude, l.longitude)}`,
      M,
      y,
    );
    y += 5;

    if (l.catatan) {
      const lines = doc.splitTextToSize(l.catatan, W);
      ensureSpace(lines.length * 4 + 2);
      doc.text(lines, M, y);
      y += lines.length * 4 + 3;
    }

    // Foto (maks 12 per tahap agar PDF ringan)
    const fotos = (l.fotos ?? []).slice(0, 12);
    let col = 0;
    for (const f of fotos) {
      if (y + 52 > 282) {
        doc.addPage();
        y = 16;
      }
      const x = M + col * 62;
      const dataUrl = await mediaDataUrl(f.storage_path);
      if (dataUrl) {
        try {
          doc.addImage(dataUrl, x, y, 58, 44);
        } catch {
          doc.setDrawColor(200);
          doc.rect(x, y, 58, 44);
          doc.setFontSize(7);
          doc.text("foto gagal dimuat", x + 4, y + 23);
          doc.setFontSize(8);
        }
      } else {
        doc.setDrawColor(200);
        doc.rect(x, y, 58, 44);
        doc.setFontSize(7);
        doc.text("foto tidak tersedia", x + 4, y + 23);
        doc.setFontSize(8);
      }
      doc.setFontSize(6.5);
      doc.text(
        koordinat(f.watermark_lat, f.watermark_lng) +
          " · " +
          formatWaktu(f.watermark_timestamp),
        x,
        y + 48,
      );
      doc.setFontSize(8);
      col++;
      if (col % 3 === 0) y += 56;
    }
    if (fotos.length % 3 !== 0) y += 56;

    if ((l.videos?.length ?? 0) > 0) {
      ensureSpace(10);
      doc.setFontSize(7.5);
      doc.text(
        `Lampiran video: ${(l.videos ?? []).length} berkas (dapat dibuka melalui aplikasi)`,
        M,
        y,
      );
      y += 6;
    }

    y += 4;
  }

  // ---------- Penutup ----------
  ensureSpace(40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const penutup = doc.splitTextToSize(
    "Demikian laporan ini dibuat secara bertanggung jawab untuk dipergunakan sebagaimana mestinya.",
    W,
  );
  doc.text(penutup, M, y);
  y += penutup.length * 4.5 + 10;

  doc.text(`Purwakarta, ${formatTanggal(terbaru.timestamp_kirim)}`, M + W - 60, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.text(root.regu?.nama_regu ?? "Pelapor", M + W - 60, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Tanda tangan & nama jelas", M + W - 60, y);

  const fname = `laporan-${root.id.slice(0, 8)}-${new Date(root.timestamp_kirim)
    .toISOString()
    .slice(0, 10)}.pdf`;
  doc.save(fname);
}
