import { addToDLQ, getDLQItems, removeFromDLQ, getDLQStats, clearDLQ } from '../dlq-store';

beforeEach(() => clearDLQ());
afterAll(() => clearDLQ());

describe('dlq-store', () => {
  it('addToDLQ crea un item con failedAt y retryCount=0', () => {
    const before = Date.now();
    addToDLQ({
      id: 'dlq-1',
      phone: '56912345678',
      message: 'Test message',
      attempts: 3,
      enqueuedAt: before,
      lastError: 'Connection timeout'
    });
    const items = getDLQItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('dlq-1');
    expect(items[0].lastError).toBe('Connection timeout');
    expect(items[0].retryCount).toBe(0);
    expect(items[0].failedAt).toBeGreaterThanOrEqual(before);
    expect(items[0].attempts).toBe(3);
  });

  it('getDLQItems retorna todos los items de la DLQ', () => {
    addToDLQ({ id: 'a', phone: '1', message: 'x', attempts: 3, enqueuedAt: Date.now(), lastError: 'err-a' });
    addToDLQ({ id: 'b', phone: '2', message: 'y', attempts: 3, enqueuedAt: Date.now(), lastError: 'err-b' });
    const items = getDLQItems();
    expect(items.length).toBe(2);
    expect(items.map(i => i.id)).toContain('a');
    expect(items.map(i => i.id)).toContain('b');
  });

  it('removeFromDLQ elimina solo el item indicado', () => {
    addToDLQ({ id: 'keep', phone: '1', message: 'x', attempts: 3, enqueuedAt: Date.now(), lastError: 'err' });
    addToDLQ({ id: 'remove-me', phone: '2', message: 'y', attempts: 3, enqueuedAt: Date.now(), lastError: 'err' });
    removeFromDLQ('remove-me');
    const items = getDLQItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('keep');
  });

  it('getDLQStats retorna count, oldest e items correctos', () => {
    expect(getDLQStats().count).toBe(0);
    expect(getDLQStats().oldest).toBeNull();

    const t = Date.now();
    addToDLQ({ id: 'x', phone: '1', message: 'm', attempts: 3, enqueuedAt: t, lastError: 'e' });
    addToDLQ({ id: 'y', phone: '2', message: 'm', attempts: 3, enqueuedAt: t + 1000, lastError: 'e' });

    const stats = getDLQStats();
    expect(stats.count).toBe(2);
    expect(stats.oldest).toBe(t);
    expect(stats.items.length).toBe(2);
  });
});
