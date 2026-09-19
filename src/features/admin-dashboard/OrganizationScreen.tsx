import { useState } from "react";
import {
  jawaraRoles,
  jawaraStructure,
  jawaraTotals,
  makeJawaraUsername,
} from "../../lib/jawara";

const usernameUnits = [
  ["polres", "Polres"],
  ["reskrim", "Satreskrim"],
  ["intelkam", "Satintelkam"],
  ["narkoba", "Satresnarkoba"],
  ["samapta", "Satsamapta"],
  ["lantas", "Satlantas"],
  ["plered", "Polsek Plered"],
  ["kota", "Polsek Purwakarta Kota"],
] as const;

function GroupList({
  title,
  groups,
}: {
  title: string;
  groups: readonly { name: string; count: number }[];
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Akun pelapor</div>
          <h2 className="mt-1 font-semibold">{title}</h2>
        </div>
        <span className="mono text-xs text-slate-500">
          {groups.reduce((sum, group) => sum + group.count, 0)} akun
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => {
          const open = openGroup === group.name;
          return (
            <div key={group.name} className="card">
              <button
                type="button"
                onClick={() => setOpenGroup(open ? null : group.name)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="text-sm font-semibold text-slate-200">
                  📁 {group.name}
                </span>
                <span className="badge shrink-0 bg-gold-400/15 text-gold-300">
                  {group.count}
                </span>
              </button>
              {open && (
                <div className="mt-3 grid max-h-56 gap-1 overflow-y-auto border-t border-navy-700 pt-3">
                  {Array.from({ length: group.count }, (_, index) => (
                    <div
                      key={index}
                      className="rounded-lg bg-navy-900/70 px-3 py-1.5 text-xs text-slate-400"
                    >
                      {group.name} {index + 1}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MonitorList({
  title,
  names,
}: {
  title: string;
  names: readonly string[];
}) {
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="badge bg-sky-400/15 text-sky-300">
          {names.length} akun
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {names.map((name) => (
          <div
            key={name}
            className="rounded-xl border border-navy-700/70 bg-navy-900/60 px-3 py-2 text-sm text-slate-300"
          >
            {name}
          </div>
        ))}
      </div>
    </section>
  );
}

function UsernameBuilder() {
  const [unit, setUnit] = useState("reskrim");
  const [position, setPosition] = useState("BANIT SAT RESKRIM");
  const [number, setNumber] = useState("3");
  const username = makeJawaraUsername(
    unit,
    position,
    number ? Number(number) : null,
  );

  return (
    <section className="card">
      <div className="eyebrow">Akun / pola username</div>
      <h2 className="mt-1 font-semibold">
        Buat username pelapor atau pemantau
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Format: unit.jabatan + nomor urut dua digit jika diperlukan.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-slate-400">
          Unit atau wilayah
          <select
            className="input mt-1"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            {usernameUnits.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-400 sm:col-span-2">
          Jabatan sesuai data
          <input
            className="input mt-1"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-slate-400">
          Nomor urut
          <input
            className="input mt-1"
            type="number"
            min="1"
            max="99"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-4 rounded-xl border-l-4 border-gold-400 bg-navy-900 px-4 py-3">
        <div className="text-xs text-slate-400">Username yang dihasilkan</div>
        <code className="mt-1 block break-all text-lg font-semibold text-gold-300">
          {username || "-"}
        </code>
      </div>
    </section>
  );
}

export default function OrganizationScreen() {
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">JAWARA / struktur akun</div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Struktur pemantauan Polres
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Ringkasan pembagian akun pemantau dan pelapor berdasarkan workbook
            JAWARA APP.
          </p>
        </div>
        <span className="status-live">Data konfigurasi</span>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gold-400" />
          <div className="text-xs text-slate-400">All access</div>
          <div className="mt-2 text-2xl font-bold">
            {jawaraStructure.allAccessMonitors}
          </div>
        </div>
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-sky-400" />
          <div className="text-xs text-slate-400">Pemantau fungsi</div>
          <div className="mt-2 text-2xl font-bold">
            {jawaraTotals.functionMonitors}
          </div>
        </div>
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-emerald-400" />
          <div className="text-xs text-slate-400">Pelapor Polres</div>
          <div className="mt-2 text-2xl font-bold">
            {jawaraTotals.polresReporters}
          </div>
        </div>
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-red-400" />
          <div className="text-xs text-slate-400">Pelapor Polsek</div>
          <div className="mt-2 text-2xl font-bold">
            {jawaraTotals.polsekReporters}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MonitorList
          title="Pemantau sesuai fungsi Polres"
          names={jawaraStructure.functionMonitors}
        />
        <MonitorList
          title="Pemantau sesuai wilayah Polsek"
          names={jawaraStructure.polsekMonitors}
        />
      </div>

      <section>
        <div className="mb-3">
          <div className="eyebrow">Hirarki akses</div>
          <h2 className="mt-1 font-semibold">Peran dan cakupan pemantauan</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jawaraRoles.map((role) => (
            <div key={role.title} className="card">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-white">{role.title}</h3>
                <span className="badge bg-gold-400/15 text-gold-300">
                  {role.access}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{role.description}</p>
              <code className="mt-3 block rounded-lg bg-navy-900 px-3 py-2 text-xs text-slate-300">
                {role.username}
              </code>
            </div>
          ))}
        </div>
      </section>

      <UsernameBuilder />

      <GroupList
        title="Pelapor tingkat Polres"
        groups={jawaraStructure.polresReporters}
      />
      <GroupList
        title="Pelapor tingkat Polsek"
        groups={jawaraStructure.polsekReporters}
      />
    </div>
  );
}
