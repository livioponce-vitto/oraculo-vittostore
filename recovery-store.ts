import { Prisma, PrismaClient, RecoveryStatus } from '@prisma/client';

export type PersistedRecoveryStatus = 'queued' | 'sent' | 'failed' | 'duplicate' | 'skipped';

type RecoveryEventWrite = {
  dedupeKey: string;
  phone?: string | null;
  customerName?: string | null;
  checkoutUrl?: string | null;
  status: PersistedRecoveryStatus;
  attempts?: number;
  lastError?: string | null;
  sentAt?: Date | null;
};

type RecoveryLogWrite = {
  dedupeKey: string;
  level: 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  payload?: Prisma.InputJsonValue;
};

const persistenceEnabled = Boolean(process.env.DATABASE_URL);
const prisma = persistenceEnabled ? new PrismaClient() : null;

let lastPersistenceError: string | null = null;

const isPrismaUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const safeUpsertRecoveryEvent = async (
  client: PrismaClient,
  args: Parameters<PrismaClient['recoveryEvent']['upsert']>[0]
) => {
  try {
    return await client.recoveryEvent.upsert(args);
  } catch (error) {
    // Under heavy concurrency, two writers can still race on the same dedupeKey.
    // If the row was created by another writer first, fallback to read + update.
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }

    const existing = await client.recoveryEvent.findUnique({
      where: { dedupeKey: args.where.dedupeKey }
    });

    if (existing) {
      return client.recoveryEvent.update({
        where: { id: existing.id },
        data: args.update
      });
    }

    throw error;
  }
};

const withPrisma = async <T>(operation: (client: PrismaClient) => Promise<T>) => {
  if (!prisma) {
    return undefined;
  }

  try {
    const result = await operation(prisma);
    lastPersistenceError = null;
    return result;
  } catch (error) {
    lastPersistenceError = error instanceof Error ? error.message : String(error);
    console.error('[RecoveryStore] ❌ Error de persistencia:', error);
    return undefined;
  }
};

export const getRecoveryStoreHealth = () => ({
  enabled: persistenceEnabled,
  lastError: lastPersistenceError
});

export const findRecoveryEventByDedupeKey = async (dedupeKey: string) => {
  return withPrisma(async (client) => {
    return client.recoveryEvent.findUnique({
      where: { dedupeKey },
      select: {
        status: true,
        updatedAt: true,
        sentAt: true
      }
    });
  });
};

export const recordRecoveryEvent = async (input: RecoveryEventWrite) => {
  return withPrisma(async (client) => {
    const event = await safeUpsertRecoveryEvent(client, {
      where: { dedupeKey: input.dedupeKey },
      update: {
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
        ...(input.checkoutUrl !== undefined ? { checkoutUrl: input.checkoutUrl } : {}),
        status: input.status as RecoveryStatus,
        ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
        lastError: input.lastError ?? null,
        ...(input.sentAt !== undefined ? { sentAt: input.sentAt } : {})
      },
      create: {
        dedupeKey: input.dedupeKey,
        phone: input.phone ?? null,
        customerName: input.customerName ?? null,
        checkoutUrl: input.checkoutUrl ?? null,
        status: input.status as RecoveryStatus,
        attempts: input.attempts ?? 0,
        lastError: input.lastError ?? null,
        sentAt: input.sentAt ?? null
      }
    });

    return event;
  });
};

export const appendRecoveryLog = async (input: RecoveryLogWrite) => {
  return withPrisma(async (client) => {
    const event = await safeUpsertRecoveryEvent(client, {
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        dedupeKey: input.dedupeKey,
        status: RecoveryStatus.queued
      }
    });

    return client.recoveryLog.create({
      data: {
        eventId: event.id,
        level: input.level,
        stage: input.stage,
        message: input.message,
        ...(input.payload !== undefined ? { payload: input.payload } : {})
      }
    });
  });
};