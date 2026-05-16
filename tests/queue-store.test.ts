import { persistQueueItem, removeQueueItem, loadPersistedQueue, clearQueue } from '../queue-store';

beforeEach(() => clearQueue());
afterAll(() => clearQueue());

describe('queue-store persistence', () => {
  it('persist y recupera un item', () => {
    persistQueueItem({ id: 'test-1', phone: '56912345678', message: 'Hola', attempt: 1, enqueuedAt: Date.now() });
    const items = loadPersistedQueue();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('test-1');
  });

  it('remove elimina un item', () => {
    persistQueueItem({ id: 'a', phone: '1', message: 'x', attempt: 1, enqueuedAt: Date.now() });
    persistQueueItem({ id: 'b', phone: '2', message: 'y', attempt: 1, enqueuedAt: Date.now() });
    removeQueueItem('a');
    const items = loadPersistedQueue();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('b');
  });

  it('persist actualiza item existente (mismo id)', () => {
    persistQueueItem({ id: 'same', phone: '1', message: 'v1', attempt: 1, enqueuedAt: Date.now() });
    persistQueueItem({ id: 'same', phone: '1', message: 'v1', attempt: 2, enqueuedAt: Date.now() });
    const items = loadPersistedQueue();
    expect(items.length).toBe(1);
    expect(items[0].attempt).toBe(2);
  });

  it('descarta items expirados (>24h)', () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    persistQueueItem({ id: 'old', phone: '1', message: 'x', attempt: 1, enqueuedAt: old });
    persistQueueItem({ id: 'new', phone: '2', message: 'y', attempt: 1, enqueuedAt: Date.now() });
    const items = loadPersistedQueue();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('new');
  });
});