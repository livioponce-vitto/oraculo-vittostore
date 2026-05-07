# CONFIGURACIÓN DE ALERTAS EN RENDER

## Resumen

Se han implementado **3 capas de monitoreo**:

1. **Health Endpoint Mejorado** → `/health` ahora expone alertas calculadas
2. **Logging Estructurado** → Eventos críticos se registran en JSON para parsing
3. **Script de Monitoreo Automático** → `monitoring.ts` valida 5 puntos críticos cada 5 min

---

## PASO 1: Verificar Health Endpoint Mejorado

### En Render Dashboard:

1. Ve a tu servicio en Render
2. Abre la consola y ejecuta:
   ```bash
   curl https://YOUR_RENDER_URL/health
   ```

### Verifica que la respuesta incluya:
```json
{
  "ok": true,
  "healthy": true,
  "alerts": {
    "hasAlerts": false,
    "count": 0,
    "messages": []
  },
  "whatsapp": {
    "ready": true,
    "reconnectAttempts": 0
  },
  "queue": {
    "totalPending": 0,
    "alertThreshold": 20
  },
  "tracking": {
    "failed": 0
  }
}
```

---

## PASO 2: Configurar Slack Webhook (RECOMENDADO)

### Crear Webhook en Slack:

1. Ve a https://api.slack.com/apps
2. Click en "Create New App" → "From scratch"
3. Nombre: "Oráculo Alerts"
4. Selecciona tu workspace
5. En el menú izquierdo: "Incoming Webhooks" → Turn ON
6. Click "Add New Webhook to Workspace"
7. Selecciona canal (ej: #alerts-production)
8. Copia el **Webhook URL**

### Agregar a Render:

1. En Render Dashboard → Tu servicio
2. Settings → Environment Variables
3. Crea variable: `SLACK_WEBHOOK_URL` = (tu webhook URL)
4. Deploy

---

## PASO 3: Configurar Cron Job de Monitoreo

### Opción A: Usar Render Cron Service (RECOMENDADO)

1. **Crear un nuevo servicio Cron en Render:**
   - Ve a https://dashboard.render.com
   - Click "+ New" → "Cron Job"
   - Nombre: `oraculo-health-monitor`
   - Build command: `npm install`
   - Run command: `npx ts-node -T monitoring.ts`
   - Schedule: `*/5 * * * *` (cada 5 minutos)
   - Environment variables:
     - `HEALTH_URL` = `https://YOUR_RENDER_URL/health`
     - `SLACK_WEBHOOK_URL` = (tu webhook)

2. **Deploy** y espera a que se ejecute

### Opción B: Usar External Cron Service (si prefieres)

Servicios gratuitos:
- **EasyCron.com** → URL trigger: https://www.easycron.com/?u=YOUR_ID
- **cron-job.org** → URL trigger: https://cron-job.org/en/

Configuración:
- URL: `https://YOUR_RENDER_URL/health`
- Intervalo: 5 minutos
- Cuando reciba `"healthy": false`, envía webhook a tu Slack

---

## PASO 4: Logs Estructurados en Render

Los eventos críticos ahora se loguean en JSON con estructura:
```json
{
  "timestamp": "2025-05-07T12:34:56.789Z",
  "severity": "WARN|ERROR|CRITICAL|INFO|DEBUG",
  "stage": "send_failed|dedupe_duplicate|whatsapp_reconnect|etc",
  "message": "descripción legible",
  "data": { ... context ...}
}
```

### Ver logs en Render:

1. Dashboard → Tu servicio → "Logs"
2. Filtra por: `severity: CRITICAL` o `severity: ERROR`
3. Busca por stage: `send_failed`, `queue_saturated`, etc.

---

## PUNTOS CRÍTICOS MONITOREADOS

| Alerta | Condición | Acción |
|--------|-----------|--------|
| **QUEUE_SATURATED** | `queue.totalPending > alertThreshold (20)` | Slack alert WARN |
| **WHATSAPP_DISCONNECTED** | `whatsapp.ready = false` | Slack alert CRITICAL |
| **RECONNECT_LOOP** | `reconnectAttempts > 3` | Slack alert WARN |
| **DELIVERY_FAILURES** | `tracking.failed > 5` | Slack alert WARN |
| **ENDPOINT_DOWN** | Health endpoint no responde | Slack alert CRITICAL |

---

## TESTING MANUAL

### Test 1: Verificar Health Endpoint

```bash
curl https://YOUR_RENDER_URL/health | jq '.alerts'
```

Esperado:
```json
{
  "hasAlerts": false,
  "count": 0,
  "messages": []
}
```

### Test 2: Ejecutar Script de Monitoreo Localmente

```bash
# En tu máquina local
export HEALTH_URL="https://YOUR_RENDER_URL/health"
export SLACK_WEBHOOK_URL="YOUR_WEBHOOK"
npx ts-node -T monitoring.ts
```

Deberías ver:
```
[Monitor] Starting health check at 2025-05-07T12:34:56.789Z
[Monitor] Health Check Result: { ... }
[Monitor] System healthy. No alerts needed.
```

### Test 3: Simular Alerta

En tu terminal Render (si tienes acceso SSH):

```bash
# Simula queue saturada
# Busca en server.ts dónde se agrega a WA_TASK_QUEUE
# Escribe un test que agregue 30+ items
```

O usa curl:
```bash
# POST un webhook 30 veces rápido para saturar queue
for i in {1..30}; do 
  curl -X POST https://YOUR_RENDER_URL/api/webhooks/shopify/checkout \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Hmac-Sha256: VALID_HMAC" \
    -d '{"total_price": 100, "customer": {"phone": "5619999999"}}'
done
```

Después de 5 minutos, deberías recibir un mensaje de Slack alertando sobre QUEUE_SATURATED.

---

## RESUMEN DE CONFIGURACIÓN

| Componente | Status | Config |
|-----------|--------|--------|
| Health Endpoint | ✅ Deployado | `/health` responde con alertas |
| Logging Estructurado | ✅ Deployado | JSON en stdout capturado por Render |
| Monitoring Script | ✅ Listo | `monitoring.ts` requiere Cron en Render |
| Slack Webhook | ⏳ Manual | Requiere creación en Slack API + env var |
| Cron Trigger | ⏳ Manual | Crear Cron Service en Render o usar external |

---

## PRÓXIMOS PASOS

1. **Hoy**: Deploy cambios en `server.ts` (alertas + logging)
2. **Hoy**: Crear Slack webhook y agregar env var
3. **Hoy**: Crear Cron Job en Render o external service
4. **Mañana**: Validar que recibes primera alerta (o clean log)

---

## SOPORTE

Si algo no funciona:

1. Verifica que `/health` responde con status 200
2. Comprueba env vars en Render Dashboard
3. Revisa logs en Render bajo "Logs"
4. Para debugging Slack: usa curl directamente al webhook URL

```bash
curl -X POST YOUR_SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{"text":"Test message from Oráculo"}'
```

Si recibes un JSON response de Slack con `"ok": true`, el webhook está configurado correctamente.
