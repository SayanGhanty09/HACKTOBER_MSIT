// Phase 2: Background sync queue — posts unsynced patients when online.
import { getPatients, markSynced, getUnsyncedIds } from "./patientStore";

const API = import.meta.env.VITE_EXCHANGE_BASE_URL ?? "http://localhost:8000";

export async function runSync(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const ids = await getUnsyncedIds();
  if (!ids.length) return { synced: 0, failed: 0 };

  const all = await getPatients();
  const pending = all.filter(p => ids.includes(p.id));
  let synced = 0, failed = 0;

  for (const patient of pending) {
    try {
      const res = await fetch(`${API}/api/patients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patient),
      });
      if (res.ok) { await markSynced(patient.id); synced++; }
      else          failed++;
    } catch { failed++; }
  }
  return { synced, failed };
}

// Auto-sync whenever connectivity is restored
window.addEventListener("online", () => { runSync().catch(() => {}); });
