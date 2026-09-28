import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Laporan, Regu } from "../../types";
import { formatTanggal, formatWaktu } from "../../lib/cycle";
import { fotoUrl } from "../../lib/supabase/api";
import { reguDisplayName } from "../../lib/regu";
import { cariPersonelBatch } from "../../lib/personel";

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

/** Ambil foto/video dari Supabase Storage → dataURL. */
async function mediaDataUrl(storagePath: string): Promise<string | null> {
  try {
    const url = fotoUrl(storagePath);
    const res = await fetch(url);
    if (!res.ok) return null;
    return await blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}

/** Koordinat 6 desimal (≈ 0,1 m) untuk dokumen resmi; "—" bila kosong. */
function koordinatPresisi(
  lat: number | null,
  lng: number | null,
): string {
  if (lat == null || lng == null) return "—";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/** Export laporan ke PDF dengan ringkasan, tabel rekap, dan thumbnail foto/video. */
export async function exportPdf(
  laporan: Laporan[],
  ctx: ExportCtx,
): Promise<void> {
  // Pencocokan NRP → personel (LAPBUL) untuk kolom NRP.
  const personelMap = await cariPersonelBatch(
    laporan.flatMap((l) =>
      (l.nrp_pelapor ?? "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  );

  /** Kolom NRP: tiap NRP dicocokkan "PANGKAT — Nama — Jabatan" (fallback NRP polos). */
  const nrpCol = (l: Laporan): string => {
    const nrpList = (l.nrp_pelapor ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (nrpList.length === 0) return "—";
    return nrpList
      .map((nrp) => {
        const p = personelMap.get(nrp);
        return p ? `${p.pangkat} — ${p.nama} — ${p.jabatan}` : `NRP ${nrp}`;
      })
      .join("\n");
  };

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const title =
    ctx.reguId === "all"
      ? "Laporan Gabungan"
      : "Laporan " +
        (ctx.reguList.find((r) => r.id === ctx.reguId)?.nama_regu ?? "Regu");

  // Header
  doc.setFontSize(14);
  doc.text("SALAM PRESISI — Pelaporan Giat Lapangan Polres", 14, 16);
  doc.setFontSize(11);
  doc.text(title + " (Polres)", 14, 23);
  doc.setFontSize(9);
  doc.text(
    "Periode: " +
      ctx.range.from.toLocaleDateString("id-ID") +
      " s.d. " +
      ctx.range.to.toLocaleDateString("id-ID"),
    14,
    29,
  );
  doc.text("Dicetak: " + new Date().toLocaleString("id-ID"), 14, 34);

  const totalFoto = laporan.reduce((a, l) => a + (l.fotos?.length ?? 0), 0);
  const totalVideo = laporan.reduce((a, l) => a + (l.videos?.length ?? 0), 0);
  doc.text(
    "Total laporan: " +
      laporan.length +
      "  ·  Total foto: " +
      totalFoto +
      "  ·  Total video: " +
      totalVideo,
    14,
    40,
  );

  // Tabel rekap — kolom Siklus diganti Lokasi (koordinat presisi)
  autoTable(doc, {
    startY: 45,
    head: [[
      "Waktu",
      "Pelapor",
      "NRP",
      "Keterangan",
      "Lokasi",
      "Foto",
      "Video",
      "Status",
    ]],
    body: laporan.map((l) => [
      new Date(l.timestamp_kirim).toLocaleString("id-ID"),
      l.regu ? reguDisplayName(l.regu) : l.regu_id,
      nrpCol(l),
      l.catatan ?? "",
      koordinatPresisi(l.latitude, l.longitude),
      String(l.fotos?.length ?? 0),
      String((l.videos ?? []).length),
      l.status_sync,
    ]),
    styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 30 },
      2: { cellWidth: 30 },
      3: { cellWidth: 42 },
      4: { cellWidth: 26 },
      5: { cellWidth: 11 },
      6: { cellWidth: 11 },
      7: { cellWidth: 16 },
    },
    headStyles: { fillColor: [15, 61, 110] },
    alternateRowStyles: { fillColor: [240, 244, 250] },
  });

  // Detail foto: thumbnail + metadata (batasi agar PDF tidak membengkak)
  let y =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 8;
  const detail = laporan.slice(0, 30);
  const maxFoto = 60;
  const maxVideo = 24;
  let fotoCount = 0;
  let videoCount = 0;

  /** Pastikan ruang `needed` mm tersedia; pindah halaman bila tidak. */
  const ensureSpace = (needed: number) => {
    if (y + needed > 282) {
      doc.addPage();
      y = 16;
    }
  };

  for (const l of detail) {
    ensureSpace(20);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(
      (l.regu ? reguDisplayName(l.regu) : "Regu") +
        " — " +
        formatWaktu(l.timestamp_kirim),
      14,
      y,
    );
    doc.setFont("helvetica", "normal");
    y += 4;
    if (l.catatan) {
      const lines = doc.splitTextToSize("Keterangan: " + l.catatan, 182);
      doc.setFontSize(8);
      ensureSpace(lines.length * 4 + 2);
      doc.text(lines, 14, y);
      y += lines.length * 4 + 2;
    }

    const fotos = l.fotos ?? [];
    let fotoTampil = 0;
    for (let i = 0; i < fotos.length; i++) {
      if (fotoCount >= maxFoto) break;
      const f = fotos[i];
      const col = i % 3;
      // Setiap baris thumbnail butuh 52 mm — cek SEBELUM menggambar baris
      // baru agar foto tidak tergambar melewati batas halaman.
      if (col === 0 && y + 52 > 282) {
        doc.addPage();
        y = 16;
      }
      const dataUrl = await mediaDataUrl(f.storage_path);
      const x = 14 + col * 62;
      if (dataUrl) {
        // Format dideteksi dari data URL (foto bisa JPEG atau PNG hasil
        // watermark) — pemaksaan "JPEG" membuat jsPDF melempar error dan
        // gambar tidak muncul.
        try {
          doc.addImage(dataUrl, x, y, 58, 44);
        } catch {
          doc.setDrawColor(200);
          doc.rect(x, y, 58, 44);
          doc.setFontSize(7);
          doc.text("foto gagal dimuat", x + 4, y + 23);
          doc.setFontSize(9);
        }
      } else {
        doc.setDrawColor(200);
        doc.rect(x, y, 58, 44);
        doc.setFontSize(7);
        doc.text("foto tidak tersedia", x + 4, y + 23);
        doc.setFontSize(9);
      }
      doc.setFontSize(6.5);
      doc.text(
        koordinatPresisi(f.watermark_lat, f.watermark_lng) +
          " · " +
          formatWaktu(f.watermark_timestamp),
        x,
        y + 48,
      );
      fotoCount++;
      fotoTampil++;
      if (col === 2) y += 56; // pindah baris setelah kolom ke-3
    }
    if (fotoTampil % 3 !== 0) y += 56;

    // Video — keterangan jelas: judul + kotak berisi nomor, durasi,
    // tanggal/jam, koordinat, dan cara membuka berkasnya.
    const videoList = Array.isArray(l.videos) ? l.videos : [];
    if (videoList.length > 0 && videoCount < maxVideo) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      ensureSpace(8);
      doc.text(`Lampiran Video (${videoList.length} berkas):`, 14, y + 4);
      doc.setFont("helvetica", "normal");
      y += 6;

      for (let i = 0; i < videoList.length; i++) {
        if (videoCount >= maxVideo) break;
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
        doc.rect(14, y, 182, 12, "FD");
        doc.setTextColor(15, 61, 110);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text(`VIDEO ${i + 1} — durasi ${durasi}`, 17, y + 5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(
          `${tanggal} · ${koordinatPresisi(v.watermark_lat, v.watermark_lng)}`,
          17,
          y + 9.5,
        );
        doc.setTextColor(0, 0, 0);
        doc.text("Buka melalui aplikasi (menu Monitoring)", 193, y + 9.5, {
          align: "right",
        });
        videoCount++;
        y += 15;
      }
      y += 2;
    }

    y += 4;
  }

  const fname =
    "salam-presisi-" +
    (ctx.reguId === "all" ? "gabungan" : ctx.reguId) +
    "-" +
    ctx.range.from.toISOString().slice(0, 10) +
    ".pdf";
  doc.save(fname);
}
