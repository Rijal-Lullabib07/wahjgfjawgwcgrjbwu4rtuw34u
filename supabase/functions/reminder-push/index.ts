// Supabase Edge Function: reminder-push
// Dipicu pg_cron tiap 5 menit. Kirim Web Push (VAPID) ke regu yang belum
// melengkapi laporan pada siklus berjalan (reminder 15 menit sebelum berakhir).
//
// Deploy: supabase functions deploy reminder-push
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const CYCLE_START_HOUR = 4;
const CYCLE_HOURS = 2;
const CYCLES = 12;
const REMINDER_BEFORE_MIN = 15;

interface ReguRow { id: string; nama_regu: string }
interface SubRow { endpoint: string; p256dh: string; auth: string }

function currentCycle(now: Date) {
  const start = new Date(now);
  start.setHours(CYCLE_START_HOUR, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  const idx = Math.floor((now.getTime() - start.getTime()) / (CYCLE_HOURS * 3600_000));
  const siklusKe = idx + 1;
  const end = new Date(start.getTime() + (idx + 1) * CYCLE_HOURS * 3600_000);
  return { siklusKe, end };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  // Proteksi: harus dipanggil dengan service role (dari pg_cron)
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();
  const { siklusKe, end } = currentCycle(now);
  const minutesLeft = (end.getTime() - now.getTime()) / 60000;

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
    return new Response(JSON.stringify({ skipped: true, minutesLeft }), { status: 200 });
  }

  // Regu aktif yang belum melengkapi 2 foto di siklus ini
  const { data: reguList, error: reguErr } = await admin
    .from('regu').select('id, nama_regu').eq('status_aktif', true);
  if (reguErr) return new Response(JSON.stringify({ error: reguErr.message }), { status: 500 });

  const results: Array<{ regu: string; sent: number }> = [];

  for (const regu of (reguList ?? []) as ReguRow[]) {
    const { count } = await admin
      .from('laporan')
      .select('id', { count: 'exact', head: true })
      .eq('regu_id', regu.id)
      .eq('siklus_ke', siklusKe)
      .eq('status_sync', 'synced')
      .gte('timestamp_kirim', new Date(end.getTime() - CYCLE_HOURS * 3600_000).toISOString());

    // sudah lapor lengkap? (asumsi 1 laporan = 1 siklus penuh)
    if ((count ?? 0) > 0) continue;

    const { data: subs } = await admin
      .from('push_subscriptions').select('endpoint, p256dh, auth').eq('regu_id', regu.id);

    const payload = JSON.stringify({
      title: testMode ? '🧪 Tes Notifikasi SIPLAP' : '⏰ Pengingat SIPLAP',
      body: testMode
        ? `Berhasil! Notifikasi sampai ke device ini (${regu.nama_regu}).`
        : `Regu ${regu.nama_regu}: ${Math.ceil(minutesLeft)} menit lagi batas siklus ${siklusKe} berakhir. Segera kirim laporan!`,
      url: '/',
    });

    let sent = 0;
    for (const sub of (subs ?? []) as SubRow[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapidDetails: {
              subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@siplap.id',
              publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!,
              privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!,
            },
          },
        );
        sent++;
      } catch (err) {
        // Subscription expired (404/410) → hapus
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }
    results.push({ regu: regu.nama_regu, sent });
  }

  return new Response(JSON.stringify({ ok: true, siklusKe, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
