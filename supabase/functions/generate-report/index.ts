// Supabase Edge Function: generate-report
// Opsional: generate PDF server-side untuk dataset besar agar tidak
// membebani browser. Menerima { from, to, regu_id } dan mengembalikan JSON
// berisi data teragregasi; client menyusun PDF/Excel.
//
// Deploy: supabase functions deploy generate-report

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }, // RLS ikut identitas caller
  );

  const { from, to, regu_id } = await req.json().catch(() => ({}));
  if (!from || !to) {
    return new Response(JSON.stringify({ error: 'from & to wajib' }), { status: 400, headers: cors() });
  }

  let query = supabase
    .from('laporan')
    .select('*, regu:regu_id(nama_regu), fotos:laporan_foto(*)')
    .gte('timestamp_kirim', from)
    .lte('timestamp_kirim', to)
    .order('timestamp_kirim', { ascending: false });

  if (regu_id) query = query.eq('regu_id', regu_id);

  const { data, error } = await query;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors() });

  return new Response(JSON.stringify({ data }), { headers: cors() });
});

function cors(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  };
}
