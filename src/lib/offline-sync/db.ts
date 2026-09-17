import { openDB, type IDBPDatabase } from 'idb';
import type { QueuedLaporan } from '../../types';

/**
 * IndexedDB wrapper untuk antrian offline (foto + metadata) sebelum
 * berhasil terkirim ke Supabase. Object stores:
 *  - antrian: QueuedLaporan keyed by localId
 *  - blobs:   Blob foto keyed by `${localId}:${urutan}`
 */

const DB_NAME = 'siplap-offline';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 punya store demo_fotos (mode demo lama) — v2 menghapusnya
        if (oldVersion < 2 && db.objectStoreNames.contains('demo_fotos')) {
          db.deleteObjectStore('demo_fotos');
        }
        if (!db.objectStoreNames.contains('antrian')) {
          db.createObjectStore('antrian', { keyPath: 'localId' });
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs');
        }
      },
    });
  }
  return dbPromise;
}

// ---------- Antrian laporan ----------

export async function queuePut(item: QueuedLaporan): Promise<void> {
  const db = await getDB();
  await db.put('antrian', item);
}

export async function queueGetAll(): Promise<QueuedLaporan[]> {
  const db = await getDB();
  return (await db.getAll('antrian')) as QueuedLaporan[];
}

export async function queueDelete(localId: string): Promise<void> {
  const db = await getDB();
  await db.delete('antrian', localId);
}

export async function queueUpdate(
  localId: string,
  patch: Partial<QueuedLaporan>,
): Promise<void> {
  const db = await getDB();
  const item = (await db.get('antrian', localId)) as QueuedLaporan | undefined;
  if (item) await db.put('antrian', { ...item, ...patch });
}

// ---------- Blob foto ----------

export async function blobPut(key: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('blobs', blob, key);
}

export async function blobGet(key: string): Promise<Blob | undefined> {
  const db = await getDB();
  return (await db.get('blobs', key)) as Blob | undefined;
}

export async function blobDelete(key: string): Promise<void> {
  const db = await getDB();
  await db.delete('blobs', key);
}
