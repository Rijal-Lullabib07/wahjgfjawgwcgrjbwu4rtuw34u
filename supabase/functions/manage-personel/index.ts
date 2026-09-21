// Supabase Edge Function: manage-personel
//
// Membuat & mengelola akun personel dari menu Manajemen.
// PENYEBAB FUNCTION INI ADA: di Supabase hosted, SQL/RPC TIDAK BISA
// menulis ke schema `auth` (permission denied) — satu-satunya jalur
// resmi membuat/mengubah auth user adalah Auth Admin API, yang hanya
// bisa dipanggil dengan SERVICE_ROLE key dari Edge Function.
//
// Aksi (JSON body):
//   { "action": "buat",  nama, jabatan, kode_login, pin,
//     unit_key?, wilayah_key?, access_level? }
//   { "action": "reset_pin", kode_login, pin_baru }
//
// Keamanan: pemanggil wajib membawa JWT admin penuh (is_admin()),
// diverifikasi di sisi server lewat query admin_users — token user
// tidak bisa dipalsukan karena diambil dari header Authorization.
//
// Deploy:
//   supabase functions deploy manage-personel
// (Proteksi RLS tetap berlaku untuk tabel public; fungsi ini hanya
//  mengizinkan pemanggil dengan akses admin penuh.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface BuatPayload {
  action: "buat";
  nama: string;
  jabatan?: string;
  kode_login: string;
  pin: string;
  unit_key?: string | null;
  wilayah_key?: string | null;
  access_level?: string;
}

interface ResetPayload {
  action: "reset_pin";
  kode_login: string;
  pin_baru: string;
}

type Payload = BuatPayload | ResetPayload;

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

/**
 * CORS — function ini dipanggil LANGSUNG dari browser (dashboard admin),
 * jadi SEMUA response wajib membawa header Access-Control-Allow-*;
 * kalau tidak, browser memblokir response dan fetch melempar
 * "Failed to fetch" walau server sebenarnya sukses.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-notify-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Preflight browser — WAJIB jawab dengan CORS headers.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 1) Verifikasi pemanggil: JWT dari header Authorization harus
  //    milik admin penuh (access_level = 'all' di admin_users).
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Token tidak ditemukan." }, 401);

  const adminKey = resolveAdminKey();
  if (!adminKey) return json({ error: "Service-role key tidak tersedia." }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Identitas pemanggil dari JWT (bukan dari body!).
  const caller = await admin.auth.getUser(jwt);
  if (caller.error || !caller.data?.user) {
    return json({ error: "Token tidak valid atau kedaluwarsa." }, 401);
  }
  const callerEmail = caller.data.user.email ?? "";

  const { data: me, error: meErr } = await admin
    .from("admin_users")
    .select("id, nama, access_level, status_aktif")
    .or(`email.eq.${callerEmail},username.eq.${callerEmail.split("@")[0]}`)
    .maybeSingle();
  if (meErr) return json({ error: meErr.message }, 500);
  if (!me || me.access_level !== "all" || me.status_aktif === false) {
    return json(
      { error: "Hanya admin penuh yang boleh mengelola personel." },
      403,
    );
  }

  // 2) Aksi.
  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return json({ error: "Body bukan JSON yang valid." }, 400);
  }

  try {
    if (payload.action === "buat") {
      const kode = (payload.kode_login ?? "").trim().toLowerCase();
      const pin = (payload.pin ?? "").trim();
      const nama = (payload.nama ?? "").trim();
      if (!nama) return json({ error: "Nama wajib diisi." }, 400);
      if (!kode) return json({ error: "Kode login wajib diisi." }, 400);
      if (pin.length < 4) return json({ error: "PIN minimal 4 karakter." }, 400);

      const email = `${kode}@regu.siplap.id`;

      // Kode login unik di regu.
      const { data: dup } = await admin
        .from("regu")
        .select("id")
        .eq("kode_login", kode)
        .maybeSingle();
      if (dup) {
        return json(
          { error: `Kode login "${kode}" sudah dipakai personel lain.` },
          409,
        );
      }

      // Email auth unik (kalau row regu lama belum punya akun auth):
      // coba createUser; bila email sudah terdaftar kita pakai user yang
      // ada dan sinkronkan PIN-nya (idempoten).
      let authUserId: string;
      const created = await admin.auth.admin.createUser({
        email,
        password: pin,
        email_confirm: true,
        user_metadata: { username: kode },
      });
      if (created.error) {
        const msg = created.error.message ?? "";
        if (!/already|exists|terdaftar/i.test(msg)) {
          return json({ error: `Gagal membuat akun auth: ${msg}` }, 500);
        }
        // Email sudah ada → ambil id-nya lewat query.
        const { data: found } = await admin
          .from("regu")
          .select("auth_user_id")
          .eq("kode_login", kode)
          .maybeSingle();
        if (found?.auth_user_id) {
          authUserId = found.auth_user_id as string;
          // Sinkronkan PIN ke PIN baru yang diminta admin.
          await admin.auth.admin.updateUserById(authUserId, { password: pin });
        } else {
          // Cari lewat daftar user (email pasti unik).
          const { data: users } = await admin.auth.admin.listUsers();
          const match = users?.users?.find(
            (u) => (u.email ?? "").toLowerCase() === email,
          );
          if (!match) {
            return json(
              { error: "Email auth sudah dipakai tapi user tidak ditemukan." },
              500,
            );
          }
          authUserId = match.id;
          await admin.auth.admin.updateUserById(authUserId, { password: pin });
        }
      } else {
        authUserId = created.data.user!.id;
      }

      // Buat baris regu (profile pelapor).
      const { data: regu, error: reguErr } = await admin
        .from("regu")
        .insert({
          nama_regu: nama,
          jabatan: (payload.jabatan ?? "").trim() || null,
          kode_login: kode,
          status_aktif: true,
          access_level: payload.access_level ?? "pelapor-level-1",
          unit_key: (payload.unit_key ?? "").trim().toLowerCase() || null,
          wilayah_key: (payload.wilayah_key ?? "").trim().toLowerCase() || null,
          is_legacy: false,
          auth_user_id: authUserId,
        })
        .select("id")
        .single();
      if (reguErr) return json({ error: reguErr.message }, 500);

      return json({
        ok: true,
        regu_id: regu.id,
        kode_login: kode,
        pin,
      });
    }

    if (payload.action === "reset_pin") {
      const kode = (payload.kode_login ?? "").trim().toLowerCase();
      const pinBaru = (payload.pin_baru ?? "").trim();
      if (pinBaru.length < 4) {
        return json({ error: "PIN minimal 4 karakter." }, 400);
      }

      // Cari auth_user_id dari regu.
      const { data: regu, error: reguErr } = await admin
        .from("regu")
        .select("id, auth_user_id")
        .eq("kode_login", kode)
        .maybeSingle();
      if (reguErr) return json({ error: reguErr.message }, 500);
      if (!regu) return json({ error: "Personel tidak ditemukan." }, 404);

      let authUserId = regu.auth_user_id as string | null;
      if (!authUserId) {
        // Personel lama tanpa auth_user_id — cari lewat email sintetis.
        const email = `${kode}@regu.siplap.id`;
        const { data: users } = await admin.auth.admin.listUsers();
        const match = users?.users?.find(
          (u) => (u.email ?? "").toLowerCase() === email,
        );
        if (match) {
          authUserId = match.id;
          await admin
            .from("regu")
            .update({ auth_user_id: authUserId })
            .eq("id", regu.id);
        }
      }
      if (!authUserId) {
        return json(
          { error: "Akun auth belum ada untuk personel ini." },
          404,
        );
      }

      const { error: updErr } = await admin.auth.admin.updateUserById(
        authUserId,
        { password: pinBaru },
      );
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ ok: true, kode_login: kode, pin: pinBaru });
    }

    return json({ error: `Aksi tidak dikenal.` }, 400);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Kesalahan tak terduga." },
      500,
    );
  }
});
