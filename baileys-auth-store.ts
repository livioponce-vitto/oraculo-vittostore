import {
    AuthenticationState,
    BufferJSON,
    initAuthCreds,
    proto,
    useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { PrismaClient } from '@prisma/client';

const FALLBACK_AUTH_DIR = process.env.BAILEYS_AUTH_DIR || 'baileys_auth_info';
const DB_AUTH_PREFIX = 'baileys-auth';

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;

type BaileysAuthStore = {
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    locationLabel: string;
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
