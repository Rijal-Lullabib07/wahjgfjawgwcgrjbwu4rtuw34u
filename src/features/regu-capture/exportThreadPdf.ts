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

/** Dimensi gambar dari dataURL — dipakai agar rasio aspek foto dipertahankan
 *  (pemaksaan w×h tetap membuat foto gepeng/melar). */
function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
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

    // Foto — grid 2 kolom (2 di atas, 2 di bawah), maks 12 foto per tahap.
    // Gambar di-fit ke dalam sel sesuai rasio aspek asli → tidak gepeng.
    const fotos = (l.fotos ?? []).slice(0, 12);
    const CELL_W = 88; // 2 × 88 + jarak 6 = 182 (lebar area konten)
    const CELL_H = 64; // tinggi maksimum gambar dalam sel
    const ROW_H = CELL_H + 10; // sel + keterangan di bawahnya
    for (let i = 0; i < fotos.length; i++) {
      const col = i % 2;
      // Cek ruang SEBELUM menggambar baris baru agar foto tidak melewati
      // batas halaman (penyebab foto kepotong).
      if (col === 0 && y + ROW_H > 282) {
        doc.addPage();
        y = 16;
      }
      const f = fotos[i];
      const x = M + col * (CELL_W + 6);
      const dataUrl = await mediaDataUrl(f.storage_path);
      if (dataUrl) {
        // Hitung ukuran gambar dari dimensi aslinya agar rasio dipertahankan.
        const dim = await imageSize(dataUrl);
        let drawW = CELL_W;
        let drawH = CELL_H;
        if (dim.w > 0 && dim.h > 0) {
          const scale = Math.min(CELL_W / dim.w, CELL_H / dim.h);
          drawW = dim.w * scale;
          drawH = dim.h * scale;
        }
        try {
          doc.addImage(dataUrl, x + (CELL_W - drawW) / 2, y, drawW, drawH);
        } catch {
          doc.setDrawColor(200);
          doc.rect(x, y, CELL_W, CELL_H);
          doc.setFontSize(7);
          doc.text("foto gagal dimuat", x + 4, y + 32);
          doc.setFontSize(8);
        }
      } else {
        doc.setDrawColor(200);
        doc.rect(x, y, CELL_W, CELL_H);
        doc.setFontSize(7);
        doc.text("foto tidak tersedia", x + 4, y + 32);
        doc.setFontSize(8);
      }
      doc.setFontSize(6.5);
      doc.text(
        koordinat(f.watermark_lat, f.watermark_lng) +
          " · " +
          formatWaktu(f.watermark_timestamp),
        x,
        y + CELL_H + 4,
      );
      doc.setFontSize(8);
      if (col === 1) y += ROW_H; // pindah baris setelah kolom ke-2
    }
    if (fotos.length % 2 !== 0) y += ROW_H;

    // Video — keterangan jelas: kotak berisi nomor, durasi, tanggal/jam,
    // koordinat, dan cara membuka berkasnya.
    const videoList = Array.isArray(l.videos) ? l.videos : [];
    if (videoList.length > 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      ensureSpace(8);
      doc.text(`Lampiran Video (${videoList.length} berkas):`, M, y + 4);
      doc.setFont("helvetica", "normal");
      y += 6;

      for (let i = 0; i < videoList.length; i++) {
        const v = videoList[i];
        if (y + 16 > 282) {
          doc.addPage();
          y = 16;
        }
        const durasi =
          v.duration_seconds != null ? `${v.duration_seconds} detik` : "—";
        const tanggal = `${formatTanggal(v.watermark_timestamp)}, ${formatWaktu(
          v.watermark_timestamp,
        )} WIB`;
        doc.setDrawColor(80, 140, 190);
        doc.setFillColor(235, 245, 255);
        doc.rect(M, y, W, 12, "FD");
        doc.setTextColor(15, 61, 110);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text(`VIDEO ${i + 1} — durasi ${durasi}`, M + 3, y + 5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(
          `${tanggal} · ${koordinat(v.watermark_lat, v.watermark_lng)}`,
          M + 3,
          y + 9.5,
        );
        doc.setTextColor(0, 0, 0);
        doc.text("Buka melalui aplikasi (menu Monitoring)", M + W - 3, y + 9.5, {
          align: "right",
        });
        y += 15;
      }
      y += 2;
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
