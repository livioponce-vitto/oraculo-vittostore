#!/bin/bash

###############################################################################
# SETUP MONITORING AUTOMÁTICO
#
# Este script automatiza la configuración de monitoreo en Render + Slack
# 
# REQUISITOS:
#  1. Render API Key: https://dashboard.render.com/account/api-tokens
#  2. Slack Bot Token o Workspace: https://api.slack.com/apps (create app)
#  3. Service ID de Render: https://dashboard.render.com/web/services (copy ID)
#
# EJECUCIÓN:
#  chmod +x setup-monitoring.sh
#  ./setup-monitoring.sh
#
###############################################################################

set -e

echo "═══════════════════════════════════════════════════════════════════════════"
echo "🔧 SETUP MONITOREO: Render + Slack"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 1. RECOLECTAR CREDENCIALES
# ─────────────────────────────────────────────────────────────────────────────

echo "📋 PASO 1: Credenciales"
echo ""

read -p "✓ Render API Key (https://dashboard.render.com/account/api-tokens): " RENDER_API_KEY
if [ -z "$RENDER_API_KEY" ]; then
  echo "❌ Render API Key es requerido"
  exit 1
fi

read -p "✓ Render Service ID (ej: srv-c123d456e78f90g): " RENDER_SERVICE_ID
if [ -z "$RENDER_SERVICE_ID" ]; then
  echo "❌ Service ID es requerido"
  exit 1
fi

read -p "✓ Tu Slack workspace domain (ej: mycompany.slack.com): " SLACK_WORKSPACE
if [ -z "$SLACK_WORKSPACE" ]; then
  echo "❌ Slack workspace es requerido"
  exit 1
fi

read -p "✓ Tu nombre de canal Slack para alertas (ej: #alerts-production): " SLACK_CHANNEL
if [ -z "$SLACK_CHANNEL" ]; then
  echo "❌ Canal Slack es requerido"
  exit 1
fi

# Remove leading # if present
SLACK_CHANNEL="${SLACK_CHANNEL#\#}"

echo ""
echo "✅ Credenciales recolectadas"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 2. CREAR SLACK WEBHOOK
# ─────────────────────────────────────────────────────────────────────────────

echo "📋 PASO 2: Crear Slack Incoming Webhook"
echo ""
echo "Abriré Slack en tu navegador para crear el webhook manualmente:"
echo "  1. Ve a: https://api.slack.com/apps/new"
echo "  2. Nombre: 'Oráculo Alerts'"
echo "  3. Workspace: tu workspace"
echo "  4. Crea → Incoming Webhooks → Turn ON"
echo "  5. Add New Webhook to Workspace → Selecciona #$SLACK_CHANNEL"
echo "  6. Copia el Webhook URL"
echo ""
read -p "✓ Pega aquí tu Slack Webhook URL (https://hooks.slack.com/services/...): " SLACK_WEBHOOK_URL

if [ -z "$SLACK_WEBHOOK_URL" ]; then
  echo "❌ Webhook URL es requerido"
  exit 1
fi

echo "✅ Webhook Slack obtenido"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 3. OBTENER RENDER SERVICE DETAILS
# ─────────────────────────────────────────────────────────────────────────────

echo "📋 PASO 3: Obtener detalles del servicio Render"
echo ""

SERVICE_RESPONSE=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID")

if echo "$SERVICE_RESPONSE" | grep -q "errors"; then
  echo "❌ Error: No se pudo obtener el servicio. Verifica Service ID y API Key"
  echo "Respuesta: $SERVICE_RESPONSE"
  exit 1
fi

SERVICE_NAME=$(echo "$SERVICE_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
SERVICE_URL=$(echo "$SERVICE_RESPONSE" | grep -o '"serviceDetails":{"url":"[^"]*"' | cut -d'"' -f6)

echo "✅ Servicio encontrado: $SERVICE_NAME"
echo "   URL: $SERVICE_URL"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 4. AGREGAR ENV VARIABLES EN RENDER
# ─────────────────────────────────────────────────────────────────────────────

echo "📋 PASO 4: Agregar variables de entorno en Render"
echo ""

# Agregar SLACK_WEBHOOK_URL
echo "Agregando SLACK_WEBHOOK_URL..."
curl -s -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"SLACK_WEBHOOK_URL\",\"value\":\"$SLACK_WEBHOOK_URL\"}" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars" > /dev/null

echo "✅ SLACK_WEBHOOK_URL agregada"

# Agregar HEALTH_URL si no existe (para cron job)
HEALTH_URL="${SERVICE_URL}/health"
echo "Agregando HEALTH_URL=$HEALTH_URL..."
curl -s -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"HEALTH_URL\",\"value\":\"$HEALTH_URL\"}" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars" > /dev/null

echo "✅ HEALTH_URL agregada"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 5. CREAR CRON JOB EN RENDER
# ─────────────────────────────────────────────────────────────────────────────

echo "📋 PASO 5: Crear Cron Job en Render"
echo ""

CRON_PAYLOAD=$(cat <<'EOF'
{
  "name": "oraculo-health-monitor",
  "ownerId": "",
  "type": "cron_job",
  "environmentId": null,
  "region": "oregon",
  "buildCommand": "npm install",
  "startCommand": "npx ts-node -T monitoring.ts",
  "schedule": "*/5 * * * *",
  "notificationEmail": null,
  "envVars": [
    {
      "key": "HEALTH_URL",
      "value": "PLACEHOLDER_HEALTH_URL"
    },
    {
      "key": "SLACK_WEBHOOK_URL",
      "value": "PLACEHOLDER_SLACK_WEBHOOK"
    }
  ]
}
EOF
)

# Reemplazar placeholders
CRON_PAYLOAD="${CRON_PAYLOAD//PLACEHOLDER_HEALTH_URL/$HEALTH_URL}"
CRON_PAYLOAD="${CRON_PAYLOAD//PLACEHOLDER_SLACK_WEBHOOK/$SLACK_WEBHOOK_URL}"

echo "Creando Cron Job: oraculo-health-monitor..."
CRON_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$CRON_PAYLOAD" \
  "https://api.render.com/v1/services")

if echo "$CRON_RESPONSE" | grep -q "id"; then
  CRON_ID=$(echo "$CRON_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "✅ Cron Job creado: $CRON_ID"
else
  echo "⚠️  Advertencia: Cron Job no se creó via API (esto es normal)"
  echo "   Debes crear manualmente en Render Dashboard:"
  echo "   1. Ve a: https://dashboard.render.com"
  echo "   2. Nuevo (+) → Cron Job"
  echo "   3. Repository: vittostore-oraculo-backend"
  echo "   4. Name: oraculo-health-monitor"
  echo "   5. Build: npm install"
  echo "   6. Run: npx ts-node -T monitoring.ts"
  echo "   7. Schedule: */5 * * * *"
  echo "   8. Environment vars: HEALTH_URL=$HEALTH_URL, SLACK_WEBHOOK_URL=$SLACK_WEBHOOK_URL"
  echo "   9. Deploy"
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 6. RESUMEN Y PRÓXIMOS PASOS
# ─────────────────────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════════════════"
echo "✅ SETUP COMPLETADO"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "📊 CONFIGURACIÓN:"
echo "  Render Service: $SERVICE_NAME"
echo "  Service URL: $SERVICE_URL"
echo "  Slack Webhook: ✓ Configurado"
echo "  Slack Channel: #$SLACK_CHANNEL"
echo "  Health URL: $HEALTH_URL"
echo "  Cron Schedule: */5 * * * *"
echo ""
echo "🧪 PRÓXIMOS PASOS:"
echo ""
echo "1. Trigger Cron Job manualmente para probar:"
echo "   curl -X POST https://api.render.com/v1/crons/$CRON_ID/run \\"
echo "     -H 'Authorization: Bearer $RENDER_API_KEY'"
echo ""
echo "2. O espera 5 minutos para que se ejecute automáticamente"
echo ""
echo "3. Verifica que recibas un mensaje en Slack en #$SLACK_CHANNEL"
echo ""
echo "4. Si todo funciona, irás recibiendo alertas cuando:"
echo "   - Queue supere 20 mensajes"
echo "   - WhatsApp se desconecte"
echo "   - Haya >3 reintentos de conexión"
echo "   - >5 mensajes fallen"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
