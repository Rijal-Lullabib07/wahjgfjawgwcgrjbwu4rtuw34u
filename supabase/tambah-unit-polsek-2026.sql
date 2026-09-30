-- =============================================================
-- SIPLAP — TAMBAHAN 3 UNIT BARU PER POLSEK (SIUM, PROPAM, HUMAS)
-- =============================================================
-- Tujuan  : menambah 3 regu pelapor level-1 per Polsek:
--             unit.sium.<polsek>, unit.propam.<polsek>, unit.humas.<polsek>
--             3 × 14 Polsek = 42 regu baru → total pelapor Polsek 84 → 126.
-- Aman    : INSERT-ONLY. Tidak mengubah tabel, RLS, fungsi, trigger,
--           bucket, publication, atau data lama sedikitpun.
-- Idempoten: on conflict (kode_login) do update HANYA untuk baris baru ini
--           (menyamakan nama/status/unit/wilayah — tidak menyentuh baris lain).
--
-- Catatan RLS otomatis: regu baru mewarisi wilayah_key Polsek-nya, sehingga
-- Kapolsek terkait langsung melihat/memantau 9 unit per Polsek tanpa
-- perubahan apa pun di sisi server.
-- =============================================================

insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key, is_legacy)
select
  'Polsek ' || w.nama || ' Unit ' || un.label,
  'unit.' || un.unit_key || '.' || w.wilayah_key,
  true, 'pelapor-level-1', un.unit_key, w.wilayah_key, false
from (values
  ('kota','Purwakarta Kota'), ('plered','Plered'),
  ('jatiluhur','Jatiluhur'),  ('bungursari','Bungursari'),
  ('campaka','Campaka'),      ('cibatu','Cibatu'),
  ('pasawahan','Pasawahan'),  ('darangdan','Darangdan'),
  ('wanayasa','Wanayasa'),    ('maniis','Maniis'),
  ('sukatani','Sukatani'),    ('sukasari','Sukasari'),
  ('kiarapedes','Kiarapedes'),('bojong','Bojong')
) as w(wilayah_key, nama)
cross join (values
  ('sium','Sium',1),   ('propam','Propam',2), ('humas','Humas',3)
) as un(unit_key, label, urut)
on conflict (kode_login) do update set
  nama_regu  = excluded.nama_regu,
  status_aktif = excluded.status_aktif,
  access_level = excluded.access_level,
  unit_key     = excluded.unit_key,
  wilayah_key  = excluded.wilayah_key,
  is_legacy    = false;

-- Verifikasi cepat (harus: sium 14, propam 14, humas 14, total level-1 126):
-- select unit_key, count(*) from public.regu
--   where unit_key in ('sium','propam','humas') group by unit_key;
-- select count(*) from public.regu where access_level = 'pelapor-level-1';  -- 126
