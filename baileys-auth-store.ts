import {
    AuthenticationState,
    BufferJSON,
    initAuthCreds,
    proto,
    useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const FALLBACK_AUTH_DIR = process.env.BAILEYS_AUTH_DIR || 'baileys_auth_info';
const DB_AUTH_PREFIX = 'baileys-auth';
const SESSION_LOCK_KEY = `${DB_AUTH_PREFIX}:lock:session`;
const DEFAULT_SESSION_LEASE_TTL_MS = Number(process.env.BAILEYS_SESSION_LEASE_TTL_MS ?? 120000);
const sessionLeaseOwnerId = `pid:${process.pid}:${randomUUID()}`;

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;

type BaileysAuthStore = {
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    locationLabel: string;
};

type SessionLeasePayload = {
    ownerId: string;
    pid: number;
    acquiredAt: number;
    expiresAt: number;
};

const dbKey = (category: string, id: string) => `${DB_AUTH_PREFIX}:${category}:${id}`;

const readJson = async (key: string) => {
    if (!prisma) {
        return null;
    }

    const row = await prisma.baileysAuthKV.findUnique({ where: { key } });
    if (!row) {
        return null;
    }

    return JSON.parse(row.data, BufferJSON.reviver);
};

const writeJson = async (key: string, value: unknown) => {
    if (!prisma) {
        return;
    }

    await prisma.baileysAuthKV.upsert({
        where: { key },
        update: { data: JSON.stringify(value, BufferJSON.replacer) },
        create: {
            key,
            data: JSON.stringify(value, BufferJSON.replacer)
        }
    });
};

const deleteJson = async (key: string) => {
    if (!prisma) {
        return;
    }

    await prisma.baileysAuthKV.deleteMany({ where: { key } });
};

const parseSessionLease = (raw: string): SessionLeasePayload | null => {
    try {
        const parsed = JSON.parse(raw) as Partial<SessionLeasePayload>;

        if (
            typeof parsed.ownerId !== 'string' ||
            typeof parsed.pid !== 'number' ||
            typeof parsed.acquiredAt !== 'number' ||
            typeof parsed.expiresAt !== 'number'
        ) {
            return null;
        }

        return {
            ownerId: parsed.ownerId,
            pid: parsed.pid,
            acquiredAt: parsed.acquiredAt,
            expiresAt: parsed.expiresAt
        };
    } catch (_error) {
        return null;
    }
};

const buildSessionLeasePayload = (ttlMs = DEFAULT_SESSION_LEASE_TTL_MS): SessionLeasePayload => {
    const now = Date.now();

    return {
        ownerId: sessionLeaseOwnerId,
        pid: process.pid,
        acquiredAt: now,
        expiresAt: now + ttlMs
    };
};

export const acquireBaileysSessionLease = async (ttlMs = DEFAULT_SESSION_LEASE_TTL_MS) => {
    if (!prisma) {
        return true;
    }

    const nextPayload = buildSessionLeasePayload(ttlMs);
    const nextSerialized = JSON.stringify(nextPayload);

    try {
        const existing = await prisma.baileysAuthKV.findUnique({ where: { key: SESSION_LOCK_KEY } });

        if (!existing) {
            try {
                await prisma.baileysAuthKV.create({
                    data: {
                        key: SESSION_LOCK_KEY,
                        data: nextSerialized
                    }
                });
                return true;
            } catch (_error) {
                return false;
            }
        }

        const currentLease = parseSessionLease(existing.data);
        const leaseExpired = !currentLease || currentLease.expiresAt <= Date.now();
        const sameOwner = currentLease?.ownerId === sessionLeaseOwnerId;

        if (!leaseExpired && !sameOwner) {
            return false;
        }

        const updated = await prisma.baileysAuthKV.updateMany({
            where: {
                key: SESSION_LOCK_KEY,
                data: existing.data
            },
            data: {
                data: nextSerialized
            }
        });

        return updated.count === 1;
    } catch (error) {
        console.error('[WhatsApp] ⚠️ No se pudo adquirir lease de sesion en PostgreSQL:', error);
        return false;
    }
};

export const renewBaileysSessionLease = async (ttlMs = DEFAULT_SESSION_LEASE_TTL_MS) => {
    return acquireBaileysSessionLease(ttlMs);
};

export const releaseBaileysSessionLease = async () => {
    if (!prisma) {
        return true;
    }

    try {
        const existing = await prisma.baileysAuthKV.findUnique({ where: { key: SESSION_LOCK_KEY } });
        if (!existing) {
            return true;
        }

        const currentLease = parseSessionLease(existing.data);
        if (!currentLease || currentLease.ownerId !== sessionLeaseOwnerId) {
            return false;
        }

        await prisma.baileysAuthKV.deleteMany({
            where: {
                key: SESSION_LOCK_KEY,
                data: existing.data
            }
        });

        return true;
    } catch (error) {
        console.error('[WhatsApp] ⚠️ No se pudo liberar lease de sesion en PostgreSQL:', error);
        return false;
    }
};

const createPostgresAuthStore = async (): Promise<BaileysAuthStore> => {
    if (!prisma) {
        throw new Error('DATABASE_URL no configurada');
    }

    const creds = (await readJson(dbKey('meta', 'creds'))) || initAuthCreds();

    const state: AuthenticationState = {
        creds,
        keys: {
            get: async (type: string, ids: string[]) => {
                const data: Record<string, unknown> = {};

                for (const id of ids) {
                    const value = await readJson(dbKey(type, id));
                    if (type === 'app-state-sync-key' && value) {
                        data[id] = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
                    } else {
                        data[id] = value;
                    }
                }

                return data;
            },
            set: async (data: Record<string, Record<string, unknown>>) => {
                const tasks: Array<Promise<void>> = [];

                for (const category of Object.keys(data)) {
                    for (const id of Object.keys(data[category])) {
                        const value = data[category][id];
                        if (value) {
                            tasks.push(writeJson(dbKey(category, id), value));
                        } else {
                            tasks.push(deleteJson(dbKey(category, id)));
                        }
                    }
                }

                await Promise.all(tasks);
            }
        }
    };

    return {
        state,
        saveCreds: async () => {
            await writeJson(dbKey('meta', 'creds'), state.creds);
        },
        locationLabel: 'postgres'
    };
};

const createFileAuthStore = async (): Promise<BaileysAuthStore> => {
    const { state, saveCreds } = await useMultiFileAuthState(FALLBACK_AUTH_DIR);
    return {
        state,
        saveCreds,
        locationLabel: FALLBACK_AUTH_DIR
    };
};

export const clearBaileysAuthStore = async (): Promise<void> => {
    if (!prisma) {
        return;
    }

    try {
        await prisma.baileysAuthKV.deleteMany({});
        console.log('[WhatsApp] 🗑️ Credenciales borradas de PostgreSQL.');
    } catch (error) {
        console.error('[WhatsApp] ⚠️ No se pudo borrar credenciales de PostgreSQL:', error);
    }
};

export const createBaileysAuthStore = async (): Promise<BaileysAuthStore> => {
    if (!prisma) {
        return createFileAuthStore();
    }

    try {
        const store = await createPostgresAuthStore();
        console.log('[WhatsApp] 🗄️ Auth state persistido en PostgreSQL.');
        return store;
    } catch (error) {
        console.error('[WhatsApp] ⚠️ No se pudo usar auth state en PostgreSQL. Se usara almacenamiento local.', error);
        return createFileAuthStore();
    }
};
