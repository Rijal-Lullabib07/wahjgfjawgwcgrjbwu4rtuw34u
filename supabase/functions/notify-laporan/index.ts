// Supabase Edge Function: notify-laporan
// Dipicu **Database Webhook** pada tabel `laporan` (event INSERT).
// Mengirim Web Push (VAPID) ke semua PEMANTAU yang cakupannya mencakup
// laporan tersebut:
//   - access_level 'all'     → semua laporan
//   - access_level 'wilayah' → laporan dari Polsek yang sama (scope_key = wilayah_key)
//   - access_level 'fungsi'  → laporan dari unit yang sama (scope_key = unit_key)
// Pelapor (regu) tidak menerima push laporan; reminder regu tetap di
// function `reminder-push`.
//
// Setup lengkap (VAPID, NOTIFY_SECRET, Database Webhook) ada di README.
//
// Deploy:  supabase functions deploy notify-laporan --no-verify-jwt
// Secrets: NOTIFY_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

interface ReguRow {
  nama_regu: string;
  unit_key: string | null;
  wilayah_key: string | null;
}

interface MonitorRow {
  id: string;
  nama: string;
  access_level: string;
  scope_key: string | null;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Kunci service-role, mendukung model API key lama & baru. */
function resolveAdminKey(): string {
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
      /* bukan JSON → lanjut */
    }
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
}

/** folder_key harus sama persis dengan konvensi folder_overview() di SQL. */
function folderKeyFor(regu: ReguRow): string | null {
  const unit = (regu.unit_key ?? "").trim().toLowerCase();
  const wilayah = (regu.wilayah_key ?? "").trim().toLowerCase();
  if (!unit) return null;
  if (!wilayah) return `satuan:${unit}`;
  return `unit:${wilayah}:${unit}`;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  // Proteksi: webhook wajib membawa NOTIFY_SECRET (header kustom yang
  // dikonfigurasi saat membuat Database Webhook). Juga terima service-role
  // key untuk pengujian manual via curl.
  const notifySecret = Deno.env.get("NOTIFY_SECRET") ?? "";
  const provided =
    (req.headers.get("x-notify-secret") ?? "").trim() ||
    (req.headers.get("Authorization") ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
  const adminKey = resolveAdminKey();
  const authorized =
    (notifySecret !== "" && provided === notifySecret) ||
    (adminKey !== "" && provided === adminKey);

  if (!authorized) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        detail: `Kirim header x-notify-secret. (NOTIFY_SECRET di server ${
          notifySecret === "" ? "BELUM diset" : "sudah diset"
        })`,
      }),
      { status: 401 },
    );
  }

  if (adminKey === "") {
    return new Response(
      JSON.stringify({ error: "misconfig", detail: "Service-role key tidak tersedia di server." }),
      { status: 500 },
    );
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  if (vapidPublicKey === "" || vapidPrivateKey === "") {
    return new Response(
      JSON.stringify({ error: "misconfig", detail: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum diset." }),
      { status: 500 },
    );
  }

  // Database Webhook mengirim { type, table, schema, record, old_record }.
  let record: Record<string, unknown> | null = null;
  try {
    const body = (await req.json()) as {
      type?: string;
      record?: Record<string, unknown>;
    };
    if ((body?.type ?? "INSERT") !== "INSERT") {
      return new Response(JSON.stringify({ skipped: true, reason: "bukan INSERT" }), { status: 200 });
    }
    record = body?.record ?? null;
  } catch {
    return new Response(JSON.stringify({ error: "bad_request", detail: "Body bukan JSON webhook." }), {
      status: 400,
    });
  }

  const laporanId = typeof record?.id === "string" ? record.id : null;
  const reguId = typeof record?.regu_id === "string" ? record.regu_id : null;
  const timestampKirim =
    typeof record?.timestamp_kirim === "string" ? record.timestamp_kirim : null;
  const catatan = typeof record?.catatan === "string" ? record.catatan : "";

  if (!laporanId || !reguId) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "record tidak berisi id/regu_id" }),
      { status: 200 },
    );
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: regu, error: reguErr } = await admin
    .from("regu")
    .select("nama_regu, unit_key, wilayah_key")
    .eq("id", reguId)
    .maybeSingle();
  if (reguErr) {
    return new Response(JSON.stringify({ error: reguErr.message }), { status: 500 });
  }
  if (!regu) {
    return new Response(JSON.stringify({ skipped: true, reason: "regu tidak ditemukan" }), {
      status: 200,
    });
  }

  const folderKey = folderKeyFor(regu as ReguRow);

  // Cari pemantau yang cakupannya mencakup laporan ini.
  const { data: monitors, error: monErr } = await admin
    .from("admin_users")
    .select("id, nama, access_level, scope_key");
  if (monErr) {
    return new Response(JSON.stringify({ error: monErr.message }), { status: 500 });
  }

  const targets = (monitors ?? [] as MonitorRow[]).filter((m) => {
    if (m.access_level === "all") return true;
    if (m.access_level === "wilayah") {
      return norm(m.scope_key) !== "" && norm(m.scope_key) === norm((regu as ReguRow).wilayah_key);
    }
    if (m.access_level === "fungsi") {
      return norm(m.scope_key) !== "" && norm(m.scope_key) === norm((regu as ReguRow).unit_key);
    }
    return false;
  });

  if (targets.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, sent: 0, reason: "tidak ada pemantau dalam cakupan" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const { data: subs, error: subErr } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, monitor_id")
    .in(
      "monitor_id",
      targets.map((m) => m.id),
    );
  if (subErr) {
    return new Response(JSON.stringify({ error: subErr.message }), { status: 500 });
  }

  const waktu = timestampKirim
    ? new Date(timestampKirim).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
      })
    : "";
  const payload = JSON.stringify({
    title: "📥 Laporan baru masuk",
    body: `${(regu as ReguRow).nama_regu}${waktu ? ` · ${waktu}` : ""}${
      catatan ? ` — ${catatan.slice(0, 80)}` : ""
    }`,
    url: folderKey ? `/?folder=${encodeURIComponent(folderKey)}` : "/",
    tag: "siplap-laporan",
    laporanId,
    folderKey,
  });

  let sent = 0;
  const errors: string[] = [];
  for (const sub of (subs ?? []) as Array<SubRow & { monitor_id: string }>) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        {
          vapidDetails: {
            subject: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@polres.go.id",
            publicKey: vapidPublicKey,
            privateKey: vapidPrivateKey,
          },
        },
      );
      sent++;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; body?: string };
      // Subscription kedaluwarsa → hapus agar tidak mengganggu pengiriman berikutnya.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
      errors.push(`${e.statusCode ?? ""} ${e.message ?? ""}`.trim());
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      laporanId,
      folderKey,
      monitors: targets.length,
      subscriptions: subs?.length ?? 0,
      sent,
      ...(errors.length ? { errors: errors.slice(0, 5) } : {}),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
