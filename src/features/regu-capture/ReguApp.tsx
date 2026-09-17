import { useCallback, useEffect, useState } from 'react';
import type { QueuedLaporan, SessionUser } from '../../types';
import { getCurrentCycle, type CycleInfo } from '../../lib/cycle';
import { fetchLaporan, subscribeLaporan } from '../../lib/supabase/api';
import { blobPut, queuePut, queueGetAll } from '../../lib/offline-sync/db';
import { syncPendingLaporan, requestBackgroundSync } from '../../lib/offline-sync/syncManager';
import { subscribePush, testLocalNotification } from '../../lib/push/subscribe';
import CaptureScreen from './CaptureScreen';
import QueueList from './QueueList';
import SatpolPPLogo from '../../components/SatpolPPLogo';

interface Props {
  session: SessionUser;
  onLogout: () => void;
}

type Screen = 'capture' | 'queue';

async function loadReguState(
  reguId: string | undefined,
  cycle: CycleInfo,
  setQueueCount: (n: number) => void,
  setSentCount: (n: number) => void,
) {
  const q = await queueGetAll();
  // Hanya entri siklus berjalan yang dihitung ke kuota (foto di antrian offline)
  setQueueCount(
    q
      .filter((i) => i.reguId === reguId && i.siklusKe === cycle.siklusKe)
      .reduce((acc, i) => acc + i.fotos.length, 0),
  );
  try {
    const rows = await fetchLaporan({ reguId, from: cycle.start, to: cycle.end, limit: 50 });
    setSentCount(rows.reduce((acc, r) => acc + (r.fotos?.length ?? 0), 0));
  } catch {
    /* offline: keep last value */
  }
}

export default function ReguApp({ session, onLogout }: Props) {
  const [screen, setScreen] = useState<Screen>('capture');
  const [cycle, setCycle] = useState<CycleInfo>(() => getCurrentCycle());
  const [sentCount, setSentCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [pushState, setPushState] = useState<'unknown' | 'on' | 'off'>('unknown');
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setCycle(getCurrentCycle()), 15000);
    return () => clearInterval(t);
  }, []);

  const loadState = useCallback(async () => {
    await loadReguState(session.reguId, cycle, setQueueCount, setSentCount);
  }, [session.reguId, cycle]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await syncPendingLaporan();
      if (active && r.synced > 0) void loadState();
    })();
    const unsub = subscribeLaporan(() => void loadState());
    return () => {
      active = false;
      unsub();
    };
  }, [loadState]);

  // Cek status izin notifikasi awal
  useEffect(() => {
    if ('Notification' in window) {
      setPushState(Notification.permission === 'granted' ? 'on' : 'off');
    } else {
      setPushState('off');
    }
  }, []);

  const handleEnablePush = async () => {
    setPushMsg(null);
    try {
      await subscribePush(session.reguId ?? null);
      await testLocalNotification();
      setPushState('on');
      setPushMsg('✅ Notifikasi aktif — pengingat siklus akan dikirim ke device ini.');
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : 'Gagal mengaktifkan notifikasi');
    }
    setTimeout(() => setPushMsg(null), 6000);
  };

  const handleCaptureDone = useCallback(
    async (fotos: Array<{ blob: Blob; lat: number | null; lng: number | null; ts: Date }>) => {
      const localId = crypto.randomUUID();
      const entry: QueuedLaporan = {
        localId,
        reguId: session.reguId || '',
        siklusKe: cycle.siklusKe,
        timestampKirim: new Date().toISOString(),
        latitude: fotos[0]?.lat ?? null,
        longitude: fotos[0]?.lng ?? null,
        catatan: '',
        fotos: fotos.map((f, i) => ({
          blobKey: localId + ':' + (i + 1),
          urutan: (i + 1) as 1 | 2,
          watermarkLat: f.lat,
          watermarkLng: f.lng,
          watermarkTimestamp: f.ts.toISOString(),
        })),
        status: 'pending',
        attempts: 0,
      };
      for (let i = 0; i < entry.fotos.length; i++) {
        await blobPut(entry.fotos[i].blobKey, fotos[i].blob);
      }
      await queuePut(entry);
      const r = await syncPendingLaporan();
      if (r.synced > 0) await requestBackgroundSync();
      await loadState();
    },
    [session.reguId, cycle.siklusKe, loadState],
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-navy-700/70 bg-navy-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SatpolPPLogo className="h-9 w-9" />
            <div>
              <div className="eyebrow">SIPLAP / lapangan</div>
              <div className="font-bold leading-tight">{session.namaRegu}</div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white"
          >
            Keluar
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="badge bg-navy-700 text-navy-100">Siklus {cycle.siklusKe} · {cycle.label}</span>
          <span className={cycle.minutesLeft <= 15 ? 'font-semibold text-gold-400' : 'text-slate-400'}>
            <span className="mono">{String(cycle.minutesLeft).padStart(2, '0')}m</span> tersisa
          </span>
        </div>
      </header>

      <main className="safe-bottom flex-1 pb-24">
        {screen === 'capture' ? (
          <CaptureScreen cycle={cycle} sentCount={sentCount} queueCount={queueCount} onCaptureDone={handleCaptureDone} />
        ) : (
          <QueueList onQueueChanged={loadState} />
        )}
      </main>

      {/* Banner aktivasi push (muncul bila belum aktif) */}
      {pushState === 'off' && (
        <div className="fixed inset-x-0 bottom-16 z-10 px-4">
          <div className="mx-auto max-w-md rounded-xl border border-gold-400/40 bg-navy-800 p-3 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-200">
                🔔 Aktifkan notifikasi pengingat siklus
              </span>
              <button onClick={() => void handleEnablePush()} className="btn-primary px-3 py-1.5 text-xs">
                Aktifkan
              </button>
            </div>
            {pushMsg && <p className="mt-2 text-[11px] text-slate-400">{pushMsg}</p>}
          </div>
        </div>
      )}

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-10 grid grid-cols-2 border-t border-navy-700/70 bg-navy-900/95 backdrop-blur">
        <button
          onClick={() => setScreen('capture')}
          className={'py-4 text-sm font-semibold ' + (screen === 'capture' ? 'text-gold-400' : 'text-slate-400')}
        >
          📷 Kamera
        </button>
        <button
          onClick={() => setScreen('queue')}
          className={'py-4 text-sm font-semibold ' + (screen === 'queue' ? 'text-gold-400' : 'text-slate-400')}
        >
          📦 Antrian{queueCount > 0 ? ' (' + queueCount + ')' : ''}
        </button>
      </nav>
    </div>
  );
}
