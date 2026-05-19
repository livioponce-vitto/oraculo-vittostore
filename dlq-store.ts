import * as fs from 'fs';
import * as path from 'path';

export interface DLQItem {
  id: string;
  phone: string;
  message: string;
  attempts: number;
  enqueuedAt: number;
  failedAt: number;
  lastError: string;
  retryCount: number; // how many times manually retried from DLQ
}

const DLQ_FILE = path.join(__dirname, '..', 'data', 'dead-letter-queue.json');

const ensureDataDir = () => {
  const dir = path.dirname(DLQ_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const readAll = (): DLQItem[] => {
  try {
    ensureDataDir();
    if (!fs.existsSync(DLQ_FILE)) return [];
    const raw = fs.readFileSync(DLQ_FILE, 'utf8').trim();
    if (!raw) return [];
    return JSON.parse(raw) as DLQItem[];
  } catch {
    return [];
  }
};

const writeAll = (items: DLQItem[]): void => {
  try {
    ensureDataDir();
    fs.writeFileSync(DLQ_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (err) {
    console.error('[DLQStore] Error escribiendo DLQ:', err);
  }
};

/** Mueve un mensaje fallido a la dead-letter queue */
export const addToDLQ = (
  item: Omit<DLQItem, 'failedAt' | 'retryCount'> & { lastError: string }
): void => {
  const items = readAll();
  const existingIdx = items.findIndex(i => i.id === item.id);
  const dlqItem: DLQItem = {
    ...item,
    failedAt: Date.now(),
    retryCount: existingIdx >= 0 ? items[existingIdx].retryCount : 0
  };
  if (existingIdx >= 0) {
    items[existingIdx] = dlqItem;
  } else {
    items.push(dlqItem);
  }
  writeAll(items);
};

/** Devuelve todos los items en la DLQ */
export const getDLQItems = (): DLQItem[] => readAll();

/** Elimina un item de la DLQ por id */
export const removeFromDLQ = (id: string): void => {
  const items = readAll().filter(i => i.id !== id);
  writeAll(items);
};

/** Limpia toda la DLQ (útil en tests) */
export const clearDLQ = (): void => writeAll([]);

/** Estadísticas rápidas de la DLQ */
export const getDLQStats = () => {
  const items = getDLQItems();
  return {
    count: items.length,
    oldest: items[0]?.enqueuedAt ?? null,
    items
  };
};

const DLQ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Elimina items cuyo failedAt supera maxAgeMs. Devuelve cuántos se eliminaron. */
export const purgeStaleDLQItems = (maxAgeMs = DLQ_MAX_AGE_MS): number => {
  const cutoff = Date.now() - maxAgeMs;
  const before = readAll();
  const after = before.filter(i => i.failedAt >= cutoff);
  const removed = before.length - after.length;
  if (removed > 0) {
    writeAll(after);
    console.log(`[DLQStore] Purged ${removed} stale item(s) older than ${maxAgeMs / 86400000}d`);
  }
  return removed;
};

/** Arranca un intervalo diario que elimina items viejos de la DLQ. */
export const startDLQAutoCleanup = (): void => {
  purgeStaleDLQItems();
  setInterval(() => purgeStaleDLQItems(), 24 * 60 * 60 * 1000);
};
