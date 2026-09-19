// Supabase Edge Function: reminder-push
// Dipicu pg_cron tiap 5 menit. Kirim Web Push (VAPID) ke regu yang belum
// melengkapi 2 foto pada siklus berjalan (reminder di 15 menit terakhir siklus).
//
// Deploy:  supabase functions deploy reminder-push --no-verify-jwt
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
//          CRON_SECRET — string pendek buatan sendiri, dikirim pg_cron lewat header
//          `x-cron-secret` (sengaja bukan Authorization, agar tidak terkena
//          pemeriksaan JWT bawaan platform). Bisa diganti kapan saja.
//
// PENTING: runtime Edge Function berjalan di UTC, sedangkan siklus didefinisikan
// dalam WIB (anchor 04:00). Karena itu semua perhitungan waktu di sini dilakukan
// dalam "ruang WIB" (digeser +7 jam) — jangan pakai setHours() apa adanya.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

// Harus sama dengan src/lib/cycle.ts
const CYCLE_START_HOUR = 4; // siklus 1 mulai 04:00 WIB
const CYCLE_HOURS = 2;
const REMINDER_BEFORE_MIN = 15;
const FOTOS_PER_SIKLUS = 2;
const REMINDERS_ENABLED = false;

// Harus sama dengan src/lib/push/localReminder.ts (tag notifikasi lokal)
const NOTIF_TAG = "siplap-reminder";

const WIB_OFFSET_MS = 7 * 3600_000; // WIB = UTC+7

interface ReguRow {
  id: string;
  nama_regu: string;
}
interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}
interface LaporanRow {
  id: string;
  fotos: Array<{ id: string }> | null;
}

/**
 * Info siklus menurut jam WIB.
 * Trik: geser `now` +7 jam, lalu perlakukan field UTC sebagai jam WIB.
 */
function currentCycle(now: Date) {
  const wibMs = now.getTime() + WIB_OFFSET_MS;
  const wib = new Date(wibMs);
  const anchorMs = Date.UTC(
    wib.getUTCFullYear(),
    wib.getUTCMonth(),
    wib.getUTCDate(),
    CYCLE_START_HOUR,
    0,
    0,
    0,
  );
  // Sebelum 04:00 WIB → masih siklus "hari" kemarin
  const dayStartMs = wibMs < anchorMs ? anchorMs - 24 * 3600_000 : anchorMs;
  const idx = Math.floor((wibMs - dayStartMs) / (CYCLE_HOURS * 3600_000)); // 0..11
  const startMs = dayStartMs + idx * CYCLE_HOURS * 3600_000;
  const endMs = startMs + CYCLE_HOURS * 3600_000;

  return {
    siklusKe: idx + 1,
    // Kembalikan ke instant UTC yang sebenarnya (dipakai untuk query timestamptz)
    start: new Date(startMs - WIB_OFFSET_MS),
    end: new Date(endMs - WIB_OFFSET_MS),
    // Tanggal hari kerja (anchor 04:00 WIB) → kunci dedupe reminder_logs
    tanggalSiklus: new Date(startMs).toISOString().slice(0, 10),
  };
}

/**
 * Cari kunci ber-hak-akses-penuh untuk bicara ke database & GoTrue.
 * Tiga bentuk yang mungkin tersedia, tergantung umur project:
 *   1. SUPABASE_SERVICE_ROLE_KEY         — project lama (kunci JWT)
 *   2. SUPABASE_SECRET_KEYS / _SECRET_KEY — project dengan model API key baru
 *   3. kunci service yang dikirim pemanggil (jalan terakhir)
 */
function resolveAdminKey(fallback: string): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (legacy !== "") return legacy;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
  if (secretKeys !== "") {
    try {
      const first = Object.values(
        JSON.parse(secretKeys) as Record<string, string>,
      )[0];
      if (first) return first;
    } catch {
      /* bukan JSON → lanjut ke bentuk berikutnya */
    }
  }

  return Deno.env.get("SUPABASE_SECRET_KEY") ?? fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!REMINDERS_ENABLED) {
    return new Response(
      JSON.stringify({ disabled: true, reason: "Pelaporan tersedia 24 jam." }),
      { status: 200 },
    );
  }

  // Proteksi: pemanggil wajib membawa kunci resmi. Tiga cara diterima:
  //   1. header `x-cron-secret: <CRON_SECRET>` → CARA UTAMA dari SQL/pg_cron.
  //      Header sendiri dipakai supaya tidak menyentuh pemeriksaan JWT bawaan platform
  //      (penyebab pesan "Invalid JWT" yang muncul sebelum kode kita jalan).
  //   2. `Authorization: Bearer <CRON_SECRET>`  → variasi yang sama, lewat Authorization.
  //   3. `Authorization: Bearer <SERVICE_ROLE_KEY>` → cara lama, tetap didukung.
  // Kunci dibandingkan persis (bukan `includes`), supaya tidak ada lagi 401 misterius.
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();
  const provided =
    cronHeader !== ""
      ? cronHeader
      : (req.headers.get("Authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const viaCronSecret = cronSecret !== "" && provided === cronSecret;
  const viaServiceKey = serviceKey !== "" && provided === serviceKey;

  if (!provided || (!viaCronSecret && !viaServiceKey)) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        detail: `Kunci tidak dikenali. Kirim header x-cron-secret <CRON_SECRET>. (CRON_SECRET di server ${cronSecret === "" ? "BELUM diset" : "sudah diset"})`,
      }),
      { status: 401 },
    );
  }

  // Kunci untuk akses database: utamakan env service role. Kalau env kosong
  // (project yang memakai model API key baru), pakai kunci rahasia yang disediakan
  // platform, atau service key dari pemanggil sebagai jalan terakhir.
  const adminKey = resolveAdminKey(viaServiceKey ? provided : "");
  if (adminKey === "") {
    return new Response(
      JSON.stringify({
        error: "misconfig",
        detail:
          "Tidak ada kunci service role di server dan pemanggil tidak mengirimkannya.",
      }),
      { status: 500 },
    );
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const cycle = currentCycle(now);
  const minutesLeft = (cycle.end.getTime() - now.getTime()) / 60000;

  // MODE TES: body {"test":true} → kirim ke SEMUA subscription sekarang juga,
  // tanpa menunggu window 15 menit. Untuk uji end-to-end manual.
  let testMode = false;
  try {
    const body = (await req.json()) as { test?: boolean };
    testMode = body?.test === true;
  } catch {
    /* body kosong → normal */
  }

  // Hanya kirim di window reminder (15 menit terakhir siklus), kecuali mode tes
  if (!testMode && (minutesLeft > REMINDER_BEFORE_MIN || minutesLeft <= 0)) {
    return new Response(JSON.stringify({ skipped: true, minutesLeft }), {
      status: 200,
    });
  }

  // Regu aktif yang belum melengkapi 2 foto di siklus ini
  const { data: reguList, error: reguErr } = await admin
    .from("regu")
    .select("id, nama_regu")
    .eq("status_aktif", true);
  if (reguErr)
    return new Response(JSON.stringify({ error: reguErr.message }), {
      status: 500,
    });

  const results: Array<{
    regu: string;
    foto: number;
    sub: number;
    sent: number;
    err?: string;
  }> = [];

  for (const regu of (reguList ?? []) as ReguRow[]) {
    // Hitung foto (bukan sekadar "ada laporan"): 1 siklus butuh 2 foto.
    const { data: rows, error: laporanErr } = await admin
      .from("laporan")
      .select("id, fotos:laporan_foto(id)")
      .eq("regu_id", regu.id)
      .eq("siklus_ke", cycle.siklusKe)
      .eq("status_sync", "synced")
      .gte("timestamp_kirim", cycle.start.toISOString());
    if (laporanErr) {
      return new Response(JSON.stringify({ error: laporanErr.message }), {
        status: 500,
      });
    }

    const fotoTerkirim = ((rows ?? []) as LaporanRow[]).reduce(
      (acc, r) => acc + (r.fotos?.length ?? 0),
      0,
    );
    if (fotoTerkirim >= FOTOS_PER_SIKLUS) continue; // sudah lengkap → tidak perlu reminder

    // Scheduler berjalan tiap 5 menit, tetapi satu regu cukup menerima satu
    // reminder per siklus. Mode tes sengaja melewati log ini.
    if (!testMode) {
      const { data: reminderLog } = await admin
        .from("reminder_logs")
        .select("sent_at")
        .eq("regu_id", regu.id)
        .eq("tanggal_siklus", cycle.tanggalSiklus)
        .eq("siklus_ke", cycle.siklusKe)
        .maybeSingle();
      if (reminderLog) continue;
    }

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("regu_id", regu.id);

    const payload = JSON.stringify({
      title: testMode ? "🧪 Tes Notifikasi SIPLAP" : "⏰ Pengingat SIPLAP",
      body: testMode
        ? `Berhasil! Notifikasi sampai ke device ini (${regu.nama_regu}).`
        : `Regu ${regu.nama_regu}: ${Math.ceil(minutesLeft)} menit lagi batas siklus ${cycle.siklusKe} berakhir. Segera kirim ${FOTOS_PER_SIKLUS} foto!`,
      url: "/",
      tag: NOTIF_TAG,
    });

    let sent = 0;
    let firstErr = "";
    for (const sub of (subs ?? []) as SubRow[]) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          {
            vapidDetails: {
              subject:
                Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@siplap.id",
              publicKey: Deno.env.get("VAPID_PUBLIC_KEY")!,
              privateKey: Deno.env.get("VAPID_PRIVATE_KEY")!,
            },
          },
        );
        sent++;
      } catch (err) {
        // Jangan telan errornya: laporkan supaya penyebabnya kelihatan.
        const e = err as {
          statusCode?: number;
          body?: string;
          message?: string;
        };
        firstErr =
          firstErr ||
          `${e.statusCode ?? ""} ${e.message ?? ""} ${e.body ?? ""}`.trim();
        // Subscription expired (404/410) → hapus
        if (e.statusCode === 404 || e.statusCode === 410) {
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    }
    if (!testMode && sent > 0) {
      await admin.from("reminder_logs").upsert({
        regu_id: regu.id,
        tanggal_siklus: cycle.tanggalSiklus,
        siklus_ke: cycle.siklusKe,
      });
    }
    results.push({
      regu: regu.nama_regu,
      foto: fotoTerkirim,
      sub: subs?.length ?? 0,
      sent,
      ...(firstErr ? { err: firstErr.slice(0, 300) } : {}),
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      // 12 karakter awal kunci VAPID PUBLIK yang dipakai server. Kunci publik
      // bukan rahasia — ini untuk memastikan nilainya sama dengan
      // VITE_VAPID_PUBLIC_KEY di .env (kalau beda, push service menolak: 403).
      vapidPub: (Deno.env.get("VAPID_PUBLIC_KEY") ?? "(kosong)").slice(0, 12),
      siklusKe: cycle.siklusKe,
      tanggalSiklus: cycle.tanggalSiklus,
      minutesLeft: Math.round(minutesLeft),
      results,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
