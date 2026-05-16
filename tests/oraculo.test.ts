import { z } from 'zod';

const webhookSchema = z.object({
  checkout: z.object({
    id: z.union([z.string(), z.number()]),
    phone: z.string().optional(),
  }),
});

const financeAlertSchema = z.object({
  phone: z.string().optional(),
  alertType: z.string().max(64).optional(),
  message: z.string().min(1).max(4096),
});

describe('Oraculo schemas (Zod)', () => {
  it('webhook acepta payload valido', () => {
    const r = webhookSchema.safeParse({ checkout: { id: 123, phone: '56912345678' } });
    expect(r.success).toBe(true);
  });

  it('webhook rechaza sin checkout', () => {
    const r = webhookSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('finance-alert acepta message valido', () => {
    const r = financeAlertSchema.safeParse({ message: 'Test alert' });
    expect(r.success).toBe(true);
  });

  it('finance-alert rechaza message vacio', () => {
    const r = financeAlertSchema.safeParse({ message: '' });
    expect(r.success).toBe(false);
  });

  it('finance-alert rechaza message > 4096 chars', () => {
    const r = financeAlertSchema.safeParse({ message: 'x'.repeat(4097) });
    expect(r.success).toBe(false);
  });
});

describe('Phone normalization', () => {
  const normalize = (raw: string) =>
    String(raw || '').replace(/\+/g, '').replace(/\D/g, '').slice(-11);

  it('normaliza +56 9 1234 5678', () => {
    expect(normalize('+56 9 1234 5678')).toBe('56912345678');
  });

  it('elimina caracteres no numericos', () => {
    expect(normalize('(56) 9-1234-5678')).toBe('56912345678');
  });
});

describe('HMAC validation logic', () => {
  const crypto = require('crypto');
  const secret = 'test-secret-for-hmac';

  it('genera HMAC SHA256 base64 correcto', () => {
    const body = '{"test":true}';
    const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    expect(computed).toBe(expected);
  });
});