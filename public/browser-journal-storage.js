import {validateJournal, newJournal, applyJournalCommand, commandFingerprint} from './browser-journal.js';

const conflict = () => Object.assign(new Error('Your journal changed in another tab. Refresh and review before saving.'), {code: 'conflict'});
const storageError = () => Object.assign(new Error('This browser could not save your journal. Check available storage or export a backup. Your last saved journal has not been replaced.'), {code: 'storage'});

/** IndexedDB is the authority for guest journals. No localStorage or silent memory fallback. */
export function createBrowserJournalStorage({indexedDB = globalThis.indexedDB, dbName = 'grindzone-browser-journal-v1', now = () => new Date().toISOString(), notify = () => {}} = {}) {
  let connection = null;
  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(storageError()); return; }
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('documents')) request.result.createObjectStore('documents'); };
      request.onblocked = () => { connection = null; reject(storageError()); };
      request.onerror = () => { connection = null; reject(storageError()); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); connection = null; }; resolve(db); };
    });
    return connection;
  }
  async function transaction(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let output, failure;
      const tx = db.transaction('documents', mode), store = tx.objectStore('documents');
      const request = store.get('current');
      request.onsuccess = () => {
        try { output = operation(request.result == null ? null : validateJournal(request.result), store); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(output);
      tx.onabort = () => reject(failure || storageError());
      tx.onerror = () => { /* onabort reports one failure after rollback. */ };
    });
  }
  const changed = (doc) => { try { notify({journalId: doc?.id ?? null, revision: doc?.revision ?? null}); } catch {} return doc; };
  return {
    read() { return transaction('readonly', doc => doc); },
    async create(platform) {
      const doc = newJournal({journalId: crypto.randomUUID(), platform, now: now()});
      return changed(await transaction('readwrite', (current, store) => {
        if (current) throw conflict(); store.add(doc, 'current'); return doc;
      }));
    },
    async execute(journalId, command) {
      const fingerprint = await commandFingerprint(command), recordedAt = now();
      const result = await transaction('readwrite', (doc, store) => {
        if (!doc || doc.id !== journalId) throw conflict();
        const result = applyJournalCommand(doc, command, fingerprint, recordedAt);
        if (!result.replay) store.put(result.journal, 'current'); return result;
      });
      if (!result.replay) changed(result.journal); return result.journal;
    },
    async restore(imported, expected = null) {
      const checked = validateJournal(imported);
      return changed(await transaction('readwrite', (current, store) => {
        if ((current?.id ?? null) !== (expected?.id ?? null) || (current?.revision ?? null) !== (expected?.revision ?? null)) throw conflict();
        store.put(checked, 'current'); return checked;
      }));
    },
    async erase(expected) {
      const output = await transaction('readwrite', (current, store) => {
        if (!current || current.id !== expected?.id || current.revision !== expected?.revision) throw conflict();
        store.delete('current'); return null;
      });
      return changed(output);
    },
    async close() { const db = await connection?.catch(() => null); db?.close(); connection = null; }
  };
}
