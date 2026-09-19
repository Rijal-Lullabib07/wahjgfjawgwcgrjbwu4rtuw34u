-- SPKT memiliki satu pemantau fungsi dan satu pelapor di setiap Polsek.
-- Username lama dipertahankan agar password/Auth tidak berubah.

update public.admin_users
set nama = 'KASAT SPKT',
    username = 'spkt.kasat',
    access_level = 'fungsi',
    scope_key = 'spkt'
where lower(coalesce(username, '')) = 'spkt.kasat'
   or lower(email) = 'spkt.kasat@monitor.siplap.id';

update public.admin_users
set nama = 'KASAT LANTAS',
    access_level = 'fungsi',
    scope_key = 'lantas'
where lower(coalesce(username, '')) = 'lantas.kasat'
   or lower(email) = 'lantas.kasat@monitor.siplap.id';

with spkt_scope(username, wilayah_key) as (
  values
    ('spkt.pelapor01', 'kota'),
    ('spkt.pelapor02', 'plered'),
    ('spkt.pelapor03', 'jatiluhur'),
    ('spkt.pelapor04', 'bungursari'),
    ('spkt.pelapor05', 'campaka'),
    ('spkt.pelapor06', 'cibatu'),
    ('spkt.pelapor07', 'pasawahan'),
    ('spkt.pelapor08', 'darangdan'),
    ('spkt.pelapor09', 'wanayasa'),
    ('spkt.pelapor10', 'maniis'),
    ('spkt.pelapor11', 'sukatani'),
    ('spkt.pelapor12', 'sukasari'),
    ('spkt.pelapor13', 'kiarapedes'),
    ('spkt.pelapor14', 'bojong')
)
update public.regu r
set nama_regu = 'SPKT Pelapor ' || right(r.kode_login, 2),
    access_level = 'pelapor-level-1',
    unit_key = 'spkt',
    wilayah_key = s.wilayah_key
from spkt_scope s
where lower(r.kode_login) = s.username;
