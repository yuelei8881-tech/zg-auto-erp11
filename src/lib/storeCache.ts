import type { CloudSession, CloudStore } from './cloud';
import { compactWorkspaceStore } from './workspaceRecords';

const DB = 'zg-auto-erp-cache-v1';
export type StoreCache = { store: CloudStore; savedAt: number; fullSyncedAt: number };
type Identity = Pick<CloudSession, 'organizationId' | 'user' | 'role' | 'permissions'>;
export const storeCacheKey = (session: Identity) => JSON.stringify([
  'workspace-v3', session.organizationId, session.user.id, session.role,
  Object.entries(session.permissions).sort(([a], [b]) => a.localeCompare(b)),
]);
let generation = 0;
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('stores')) request.result.createObjectStore('stores');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function clearStoreCache() {
  generation++;
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('stores', 'readwrite');
      tx.objectStore('stores').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function readStoreCache(session: Identity): Promise<StoreCache | null> {
  // Shared workshop devices must not retain employee-accessible financial data.
  if (session.role !== 'owner') { await clearStoreCache().catch(() => undefined); return null; }
  try {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('stores', 'readwrite');
        const store = tx.objectStore('stores');
        store.delete(session.organizationId); // remove legacy company-wide cache
        store.delete(storeCacheKey(session).replace('workspace-v3', 'account-v2'));
        const request = store.get(storeCacheKey(session));
        request.onsuccess = () => resolve(request.result?.store ? request.result as StoreCache : null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  } catch { return null; }
}
export async function writeStoreCache(session: Identity, store: CloudStore, fullSyncedAt = Date.now(), syncCursor = Date.now()) {
  if (session.role !== 'owner') return;
  const start = generation;
  try {
    const db = await open();
    try {
      if (start !== generation) return;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('stores', 'readwrite');
        tx.objectStore('stores').put({ store: compactWorkspaceStore(store), savedAt: syncCursor, fullSyncedAt }, storeCacheKey(session));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  } catch { /* Optional cache must not affect authoritative saving. */ }
}
