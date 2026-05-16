import * as fs from 'fs';
import * as path from 'path';

export interface QueueItem {
  id: string;          // dedupeKey — usado para dedup y retry
  phone: string;
  message: string;
  attempt: number;
  enqueuedAt: number;
}

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'pending-queue.json');

const ensureDataDir = () => {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const readAll = (): QueueItem[] => {
  try {
    ensureDataDir();
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
    if (!raw) return [];
    return JSON.parse(raw) as QueueItem[];
  } catch {
    return [];
  }
};

const writeAll = (items: QueueItem[]): void => {
  try {
    ensureDataDir();
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (err) {
    console.error('[QueueStore] Error escribiendo cola:', err);
  }
};

/** Agrega o actualiza un item en la cola persistente */
export const persistQueueItem = (item: QueueItem): void => {
  const items = readAll();
  const idx = items.findIndex(i => i.id === item.id);
  if (idx >= 0) {
    items[idx] = item;
  } else {
    items.push(item);
  }
  writeAll(items);
};

/** Elimina un item (enviado con éxito o agotados los intentos) */
export const removeQueueItem = (id: string): void => {
  const items = readAll().filter(i => i.id !== id);
  writeAll(items);
};

/** Carga todos los items pendientes al arrancar */
export const loadPersistedQueue = (): QueueItem[] => {
  const items = readAll();
  // Descartar items de más de 24h (ya no tienen sentido de recuperación)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const valid = items.filter(i => i.enqueuedAt > cutoff);
  if (valid.length !== items.length) {
    writeAll(valid);
    console.log(`[QueueStore] Descartados ${items.length - valid.length} items expirados (>24h)`);
  }
  return valid;
};

/** Limpia toda la cola (útil en tests) */
export const clearQueue = (): void => writeAll([]);