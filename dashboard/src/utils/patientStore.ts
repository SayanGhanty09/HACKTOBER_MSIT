// Phase 2: Encrypted IndexedDB wrapper (AES-GCM via Web Crypto API)

const DB_NAME = "anebilin_v1";
const DB_VER = 1;
const PATIENTS = "patients";
const QUEUE = "sync_queue";

export interface LocalPatient {
  id: string;
  name: string;
  age: number;
  sex: "Male" | "Female" | "Other";
  intake: { symptoms: string[]; lifestyle: string[]; familyHistory: string[] };
  risks?: Record<string, number>;
  vitals?: Record<string, number | undefined>;
  timestamp: number;
  synced: boolean;
}

// ── Crypto ──────────────────────────────────────────────────────────────────
let _key: CryptoKey | null = null;
async function getKey(): Promise<CryptoKey> {
  if (_key) return _key;
  const stored = localStorage.getItem("_abl_ek");
  if (stored) {
    const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    _key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt","decrypt"]);
  } else {
    _key = await crypto.subtle.generateKey({ name:"AES-GCM", length:256 }, true, ["encrypt","decrypt"]);
    const exp = await crypto.subtle.exportKey("raw", _key);
    localStorage.setItem("_abl_ek", btoa(String.fromCharCode(...new Uint8Array(exp))));
  }
  return _key;
}
async function enc(obj: object) {
  const k = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM",iv}, k, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(ct))) };
}
async function dec(blob:{iv:string;ct:string}): Promise<LocalPatient> {
  const k = await getKey();
  const iv = Uint8Array.from(atob(blob.iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(blob.ct), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},k,ct)));
}

// ── DB ───────────────────────────────────────────────────────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PATIENTS)) db.createObjectStore(PATIENTS, { keyPath:"id" });
      if (!db.objectStoreNames.contains(QUEUE))    db.createObjectStore(QUEUE,    { keyPath:"id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

// ── Public ───────────────────────────────────────────────────────────────────
export async function savePatient(p: LocalPatient) {
  const db = await openDB();
  const blob = await enc(p);
  return new Promise<void>((res, rej) => {
    const tx = db.transaction([PATIENTS, QUEUE], "readwrite");
    tx.objectStore(PATIENTS).put({ id:p.id, ...blob });
    if (!p.synced) tx.objectStore(QUEUE).put({ id:p.id });
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export async function getPatients(): Promise<LocalPatient[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(PATIENTS,"readonly").objectStore(PATIENTS).getAll();
    req.onsuccess = async () => res(await Promise.all((req.result as any[]).map(dec)));
    req.onerror   = () => rej(req.error);
  });
}

export async function deletePatient(id: string) {
  const db = await openDB();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction([PATIENTS, QUEUE], "readwrite");
    tx.objectStore(PATIENTS).delete(id);
    tx.objectStore(QUEUE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export async function getUnsyncedIds(): Promise<string[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(QUEUE,"readonly").objectStore(QUEUE).getAllKeys();
    req.onsuccess = () => res(req.result as string[]);
    req.onerror   = () => rej(req.error);
  });
}

export async function markSynced(id: string) {
  const db = await openDB();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(QUEUE,"readwrite");
    tx.objectStore(QUEUE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
