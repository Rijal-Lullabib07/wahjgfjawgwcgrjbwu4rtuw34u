import { openDB, type IDBPDatabase } from "idb";
import type { QueuedLaporan } from "../../types";

/**
 * IndexedDB wrapper untuk antrian offline (foto + metadata) sebelum
 * berhasil terkirim ke Supabase. Object stores:
 *  - antrian: QueuedLaporan keyed by localId
 *  - blobs:   Blob media keyed by `${localId}:foto:${urutan}` or `${localId}:video`
 */

const DB_NAME = "siplap-offline";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 punya store demo_fotos (mode demo lama) — v2 menghapusnya
        if (oldVersion < 2 && db.objectStoreNames.contains("demo_fotos")) {
          db.deleteObjectStore("demo_fotos");
        }
        if (!db.objectStoreNames.contains("antrian")) {
          db.createObjectStore("antrian", { keyPath: "localId" });
        }
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs");
        }
        // v3: antrian posisi GPS (pelacakan realtime, offline queue)
        if (oldVersion < 3 && !db.objectStoreNames.contains("posisi")) {
          db.createObjectStore("posisi", { keyPath: "recordedAt" });
        }
      },
    });
  }
  return dbPromise;
}

// ---------- Antrian laporan ----------

export async function queuePut(item: QueuedLaporan): Promise<void> {
  const db = await getDB();
  await db.put("antrian", item);
}

export async function queueGetAll(): Promise<QueuedLaporan[]> {
  const db = await getDB();
  return (await db.getAll("antrian")) as QueuedLaporan[];
}

export async function queueDelete(localId: string): Promise<void> {
  const db = await getDB();
  await db.delete("antrian", localId);
}

export async function queueUpdate(
  localId: string,
  patch: Partial<QueuedLaporan>,
): Promise<void> {
  const db = await getDB();
  const item = (await db.get("antrian", localId)) as QueuedLaporan | undefined;
  if (item) await db.put("antrian", { ...item, ...patch });
}

// ---------- Blob foto ----------

export async function blobPut(key: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put("blobs", blob, key);
}

export async function blobGet(key: string): Promise<Blob | undefined> {
  const db = await getDB();
  return (await db.get("blobs", key)) as Blob | undefined;
}

export async function blobDelete(key: string): Promise<void> {
  const db = await getDB();
  await db.delete("blobs", key);
}

// ---------- Antrian posisi GPS (pelacakan realtime) ----------

export async function posisiPut(p: {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  kecepatanMps: number | null;
  recordedAt: number;
}): Promise<void> {
  const db = await getDB();
  await db.put("posisi", p);
  // Jaga ukuran antrian: buang yang tertua bila melebihi 60 entri.
  const all = (await db.getAll("posisi")) as Array<{ recordedAt: number }>;
  if (all.length > 60) {
    const sorted = all.sort((a, b) => a.recordedAt - b.recordedAt);
    for (const old of sorted.slice(0, all.length - 60)) {
      await db.delete("posisi", old.recordedAt);
    }
  }
}

export async function posisiGetAll(): Promise<
  Array<{
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    kecepatanMps: number | null;
    recordedAt: number;
  }>
> {
  const db = await getDB();
  const all = (await db.getAll("posisi")) as Array<{
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    kecepatanMps: number | null;
    recordedAt: number;
  }>;
  return all.sort((a, b) => a.recordedAt - b.recordedAt);
}

export async function posisiDelete(p: { recordedAt: number }): Promise<void> {
  const db = await getDB();
  await db.delete("posisi", p.recordedAt);
}

export async function posisiClear(): Promise<void> {
  const db = await getDB();
  await db.clear("posisi");
}
