import puppeteer from 'puppeteer';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

const localPuppeteerCacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(process.cwd(), '.cache', 'puppeteer');
process.env.PUPPETEER_CACHE_DIR = localPuppeteerCacheDir;

const findChromeInLocalCache = () => {
    const chromeRoot = path.join(localPuppeteerCacheDir, 'chrome');
    if (!fs.existsSync(chromeRoot)) {
        return null;
    }

    const buildDirs = fs.readdirSync(chromeRoot).sort().reverse();
    for (const buildDir of buildDirs) {
        const modernPath = path.join(chromeRoot, buildDir, 'chrome-linux64', 'chrome');
        if (fs.existsSync(modernPath)) {
            return modernPath;
        }

        const legacyPath = path.join(chromeRoot, buildDir, 'chrome-linux', 'chrome');
        if (fs.existsSync(legacyPath)) {
            return legacyPath;
        }
    }

    return null;
};

const resolveChromeExecutablePath = () => {
    const cachedChromePath = findChromeInLocalCache();
    if (cachedChromePath) {
        return cachedChromePath;
    }

    try {
        return puppeteer.executablePath();
    } catch (_error) {
        const candidates = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium'
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        throw new Error('No se encontro Chrome para Puppeteer. Verifica postinstall y PUPPETEER_CACHE_DIR en Render.');
    }
};

let whatsappClient: Client | null = null;

let isWhatsappReady = false;

const waitForWhatsappReady = async (timeoutMs = 45000) => {
    if (isWhatsappReady) {
        return;
    }

    const start = Date.now();
    while (!isWhatsappReady && Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!isWhatsappReady) {
        throw new Error('Cliente de WhatsApp no esta listo. Verifica sesion activa o escaneo de QR.');
    }
};

try {
    const executablePath = resolveChromeExecutablePath();
    whatsappClient = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            executablePath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process'
            ]
        }
    });

    whatsappClient.on('qr', (qr) => {
        console.log('\n=========================================');
        console.log('📱 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP');
        console.log('=========================================\n');
        qrcode.generate(qr, { small: true });
    });

    whatsappClient.on('ready', () => {
        isWhatsappReady = true;
        console.log('✅ Módulo de WhatsApp conectado y listo para disparar.');
    });

    whatsappClient.on('auth_failure', (msg) => {
        isWhatsappReady = false;
        console.error('[WhatsApp] ❌ Fallo de autenticacion:', msg);
    });

    whatsappClient.on('disconnected', (reason) => {
        isWhatsappReady = false;
        console.error('[WhatsApp] ⚠️ Cliente desconectado:', reason);
    });

    whatsappClient.initialize().catch((error) => {
        isWhatsappReady = false;
        console.error('[WhatsApp] ❌ Error inicializando cliente:', error);
    });
} catch (error) {
    isWhatsappReady = false;
    console.error('[WhatsApp] ❌ Inicializacion omitida por error:', error);
}

export const enviarMensajeWhatsApp = async (numero: string, mensaje: string) => {
    try {
        if (!whatsappClient) {
            throw new Error('Cliente de WhatsApp no inicializado.');
        }

        await waitForWhatsappReady();
        const state = await whatsappClient.getState();
        if (state !== 'CONNECTED') {
            throw new Error(`Cliente de WhatsApp no conectado (estado actual: ${state}).`);
        }

        const numeroNormalizado = numero.replace(/\D/g, '');
        const numberId = await whatsappClient.getNumberId(numeroNormalizado);

        if (!numberId?._serialized) {
            throw new Error(`El numero ${numeroNormalizado} no tiene cuenta valida en WhatsApp.`);
        }

        await whatsappClient.sendMessage(numberId._serialized, mensaje);
        console.log(`[WhatsApp] 🚀 Mensaje enviado con éxito a: ${numeroNormalizado}`);
    } catch (error) {
        console.error('[WhatsApp] ❌ Error enviando el mensaje:', error);
    }
};