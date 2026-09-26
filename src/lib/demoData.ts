import type { Laporan, KategoriLaporan, Regu, SessionUser } from "../types";

// Demo hanya aktif bila sengaja diaktifkan untuk kebutuhan video.
// Nilai yang tidak ada atau selain "true" membuat dashboard membaca Supabase.
export const isDashboardDemo = import.meta.env.VITE_DEMO_DASHBOARD === "true";

const WILAYAH = [
  ["kota", "Regu Polres Kota"],
  ["plered", "Regu Polsek Plered"],
  ["jatiluhur", "Regu Polsek Jatiluhur"],
  ["bungursari", "Regu Polsek Bungursari"],
  ["campaka", "Regu Polsek Campaka"],
  ["cibatu", "Regu Polsek Cibatu"],
  ["pasawahan", "Regu Polsek Pasawahan"],
  ["darangdan", "Regu Polsek Darangdan"],
  ["wanayasa", "Regu Polsek Wanayasa"],
  ["maniis", "Regu Polsek Maniis"],
  ["sukatani", "Regu Polsek Sukatani"],
  ["sukasari", "Regu Polsek Sukasari"],
  ["kiarapedes", "Regu Polsek Kiarapedes"],
  ["bojong", "Regu Polsek Bojong"],
] as const;

// Jumlah dibuat sengaja menurun sesuai urutan Polsek agar grafik tidak terlihat
// seperti data acak/rata saat dipakai untuk rekaman video.
const WILAYAH_BOBOT = [36, 32, 29, 26, 23, 21, 19, 17, 16, 15, 14, 12, 11, 9];
const UNIT_BOBOT = [24, 21, 18, 16, 14, 12, 10, 8, 6];

const UNIT = [
  "intelkam",
  "reskrim",
  "narkoba",
  "binmas",
  "samapta",
  "lantas",
  "polair",
  "tahti",
  "spkt",
] as const;

const KEGIATAN = [
  "Patroli Presisi",
  "Bakti Sosial",
  "Pengamanan Kegiatan",
  "Sambang Warga",
  "Operasi Kepolisian",
];
const KEJADIAN = [
  "Kecelakaan Lalu Lintas",
  "Pencurian Kendaraan",
  "Gangguan Kamtibmas",
  "Kebakaran",
  "Kerumunan Massa",
];

function demoRegu(index: number, wilayahKey?: string): Regu {
  const isUnitMode = index % 3 === 0;
  // Jangan hanya mengulang tiga fungsi pertama; rotasikan seluruh daftar unit.
  const unitKey = UNIT[Math.floor(index / 3) % UNIT.length];
  return {
    id: `demo-regu-${index}`,
    nama_regu: isUnitMode
      ? `Regu ${unitKey.toUpperCase()}`
      : WILAYAH[index % WILAYAH.length][1],
    kode_login: "DEMO",
    status_aktif: true,
    unit_key: isUnitMode ? unitKey : null,
    wilayah_key: isUnitMode
      ? null
      : (wilayahKey ?? WILAYAH[index % WILAYAH.length][0]),
  };
}

function weightedIndex(value: number, weights: readonly number[]): number {
  let cursor = value % weights.reduce((total, weight) => total + weight, 0);
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return index;
  }
  return weights.length - 1;
}

/**
 * Filter visibilitas demo mengikuti scope pemantau, tanpa menyentuh data.
 *
 * Aturan sama dengan RLS can_read_monitor_scope di database:
 *   - wilayah (Kapolsek) HANYA melihat pelapor Polsek wilayahnya — baris
 *     mode satuan (wilayah_key NULL) TIDAK BOLEH muncul. Sebelumnya baris
 *     satuan diberi Polsek karangan di sini, sehingga Kapolsek melihat
 *     "pelapor satuan Polres" yang seharusnya tak terlihat.
 *   - fungsi (Kasat) hanya melihat unit fungsinya.
 */
export function isDemoLaporanInScope(
  row: Laporan,
  session?: SessionUser | null,
): boolean {
  if (!session) return true;
  const level = session.accessLevel ?? "all";
  const scope = (session.scopeKey ?? "").trim().toLowerCase();
  if (level === "all" || !scope) return true;
  if (level === "wilayah") {
    const wilayah = (row.regu?.wilayah_key ?? "").trim().toLowerCase();
    return wilayah !== "" && wilayah === scope;
  }
  if (level === "fungsi") {
    return (row.regu?.unit_key ?? "").trim().toLowerCase() === scope;
  }
  return true;
}

/** Membuat baris laporan lokal yang bentuknya sama dengan hasil query Supabase. */
export function createDemoLaporan(from: Date, to: Date): Laporan[] {
  const span = Math.max(86_400_000, to.getTime() - from.getTime());
  const count = 420;
  const rows: Laporan[] = [];

  for (let i = 0; i < count; i += 1) {
    const ratio = ((i * 37) % count) / count;
    // Selalu berada di dalam rentang aktif, termasuk saat preset "Hari Ini".
    const timestamp = new Date(from.getTime() + ratio * span);
    timestamp.setSeconds((i * 11) % 60, 0);
    const kategori: KategoriLaporan = i % 3 === 0 ? "kejadian" : "kegiatan";
    const isUnitMode = i >= 280;
    const wilayahIndex = weightedIndex(i * 17, WILAYAH_BOBOT);
    const unitIndex = weightedIndex(i * 13, UNIT_BOBOT);
    const wilayah = WILAYAH[wilayahIndex];
    const jenisNama = (kategori === "kejadian" ? KEJADIAN : KEGIATAN)[
      i % (kategori === "kejadian" ? KEJADIAN.length : KEGIATAN.length)
    ];
    const id = `demo-laporan-${i}`;
    const regu = isUnitMode
      ? {
          ...demoRegu(i, wilayah[0]),
          nama_regu: `Regu ${UNIT[unitIndex].toUpperCase()}`,
          unit_key: UNIT[unitIndex],
          wilayah_key: null,
        }
      : {
          ...demoRegu(i, wilayah[0]),
          unit_key: null,
          wilayah_key: wilayah[0],
          nama_regu: wilayah[1],
        };
    rows.push({
      id,
      regu_id: regu.id,
      timestamp_kirim: timestamp.toISOString(),
      siklus_ke: i + 1,
      latitude: -6.55 + (i % 20) * 0.002,
      longitude: 107.44 + (i % 20) * 0.002,
      status_sync: "synced",
      kategori,
      jenis_id: `demo-jenis-${kategori}-${i % 5}`,
      tahap: "awal",
      perihal: jenisNama,
      catatan: "Data demonstrasi untuk kebutuhan rekaman video.",
      regu,
      jenis: {
        id: `demo-jenis-${kategori}-${i % 5}`,
        kategori,
        nama: jenisNama,
        aktif: true,
        urutan: i % 5,
      },
      fotos:
        i % 4 === 0
          ? ([
              {
                id: `demo-foto-${i}`,
                laporan_id: id,
                storage_path: `demo/${id}/foto-${i}.jpg`,
                watermark_lat: null,
                watermark_lng: null,
                watermark_timestamp: timestamp.toISOString(),
                urutan_foto: 1,
              },
            ] as NonNullable<Laporan["fotos"]>)
          : [],
      videos:
        i % 7 === 0
          ? ([
              {
                id: `demo-video-${i}`,
                laporan_id: id,
                storage_path: `demo/${id}/video-${i}.mp4`,
                watermark_lat: null,
                watermark_lng: null,
                watermark_timestamp: timestamp.toISOString(),
                duration_seconds: 30 + (i % 90),
              },
            ] as NonNullable<Laporan["videos"]>)
          : [],
    });
  }

  return rows.sort(
    (a, b) =>
      new Date(b.timestamp_kirim).getTime() -
      new Date(a.timestamp_kirim).getTime(),
  );
}
