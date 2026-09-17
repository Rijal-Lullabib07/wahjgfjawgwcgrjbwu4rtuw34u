// Supabase Edge Function: archive-photos
// Retensi: hapus foto > 6 bulan dari Storage (panggil via pg_cron harian).
// Opsi aman: foto laporan final tetap ada di tabel (storage_path jadi histori),
// file fisik dihapus untuk hemat biaya Storage.
//
// Deploy: supabase functions deploy archive-photos
// Schedule (opsi di migration): cron.schedule('siplap-archive', '0 3 * * *', ...)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RETENTION_DAYS = 180; // 6 bulan

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();

  // Ambil foto lama
  const { data: fotos, error } = await admin
    .from('laporan_foto')
    .select('id, storage_path')
    .lt('created_at', cutoff)
    .limit(500);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let deleted = 0;
  for (const f of fotos ?? []) {
    if (f.storage_path.startsWith('demo://')) continue;
    const { error: rmErr } = await admin.storage
      .from('laporan-foto')
      .remove([f.storage_path]);
    if (!rmErr) deleted++;
  }

  return new Response(JSON.stringify({ ok: true, scanned: fotos?.length ?? 0, deleted }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
