# Oraculo Backend

Backend de automatizacion para VittoStore. Procesa webhooks de Shopify, envia notificaciones WhatsApp via Meta Cloud API y gestiona alertas financieras.

## Stack

- **Runtime**: Node.js 20 + TypeScript
- **Framework**: Express 5
- **WhatsApp**: Meta Cloud API (Business API)
- **Seguridad**: Helmet, CORS restringido, rate-limit, Zod
- **Tests**: Jest + ts-jest

## Setup rapido

```bash
cp .env.example .env
# Editar .env con tus credenciales
npm install
npm run typecheck   # verificar tipos
npm test            # correr tests
npm run build       # compilar a dist/
npm run start:prod  # produccion
```

## Scripts

| Script | Descripcion |
|--------|-------------|
| `npm start` | Dev con tsx (no compilar) |
| `npm run build` | Compila TypeScript → dist/ |
| `npm run start:prod` | Inicia desde dist/server.js |
| `npm run typecheck` | Solo verifica tipos |
| `npm test` | Corre tests Jest |

## Endpoints principales

| Metodo | Ruta | Auth | Rate limit |
|--------|------|------|-----------|
| GET | /health | - | general |
| POST | /webhook | HMAC SHA256 | estricto 20/15min |
| POST | /finance-alert | Bearer token | estricto 20/15min |
| GET | /whatsapp/health | - | general |

Ver `docs/manuales/ENDPOINTS.md` para referencia completa.

## Variables de entorno

Ver `.env.example` para todas las variables requeridas.

## Seguridad

- Helmet (headers HTTP seguros)
- CORS: solo `vittostore.store`, `*.myshopify.com`, `localhost`
- Rate limit general: 100 req/15min
- Rate limit estricto: 20 req/15min (webhook + finance-alert)
- Body limit: 256kb
- Validacion de entrada: Zod en todos los endpoints criticos
- Webhook auth: HMAC-SHA256 con `SHOPIFY_WEBHOOK_SECRET`