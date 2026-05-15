// ─── MEJORA-3: Configuración de ventana de deduplicación de incidentes ────────

/**
 * Establece la ventana de deduplicación de incidentes en ContingencyService.
 * Por defecto = 30 min. Cambia DEDUP_WINDOW_MIN abajo y ejecuta esta función.
 */
function setContingencyDedupWindow() {
  var DEDUP_WINDOW_MIN = 60; // ← ajusta aquí si quieres otro valor

  PropertiesService.getScriptProperties().setProperty(
    'INCIDENT_DEDUP_WINDOW_MIN',
    String(DEDUP_WINDOW_MIN)
  );

  var msg = '✅ Ventana de deduplicación configurada: ' + DEDUP_WINDOW_MIN + ' minutos.\n\n' +
            'El mismo incidente no generará nuevas filas en Contingencia_Integraciones\n' +
            'si se repite dentro de ese período.';
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}

// ─── MEJORA-1: Corrección de filas GWS mal ingresadas ────────────────────────
// Rows 11-12 de Libro_Mayor tienen el esquema de columnas incorrecto porque
// el proceso BOT_MANUAL los ingresó con un mapeo desalineado.
// fixGWSRows() sobreescribe esas dos filas con los 32 campos correctos.
// ──────────────────────────────────────────────────────────────────────────────

function fixGWSRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(FinanceConfig.SHEETS.LEDGER);

  if (!sheet) {
    SpreadsheetApp.getUi().alert('❌ Hoja "Libro_Mayor" no encontrada.');
    return;
  }

  // ── Esquema HEADERS.LEDGER (32 columnas, índice 0-31) ────────────────────
  // [0]  FechaRegistro         [1]  FechaDocumento      [2]  TipoMovimiento
  // [3]  Categoria             [4]  Subcategoria         [5]  ProveedorCliente
  // [6]  RutEmisorReceptor     [7]  NumeroDocumento      [8]  Moneda
  // [9]  MontoNeto             [10] IVA                  [11] MontoTotal
  // [12] EstadoPago            [13] MedioPago            [14] OrigenVenta
  // [15] EmailOrigen           [16] GmailMessageId       [17] HashDocumento
  // [18] Fuente                [19] Observaciones        [20] ProcesadoPorAI
  // [21] SocioRut              [22] GerenciaRol          [23] CreatedAt
  // [24] UpdatedAt             [25] MonedaOriginal       [26] MontoOriginal
  // [27] TipoCambioAplicado    [28] MontoTotalCLP        [29] EstadoConciliacionBanco
  // [30] EsExtranjero          [31] AlertaSistema

  var now = new Date();

  // ── Fila 11 (índice de hoja = 11, índice array = 10): GWS-APR26-01 ────────
  // Google Workspace suscripción mensual abril 2026 — cargo principal
  var row11 = [
    '2026-05-12',          // [0]  FechaRegistro
    '2026-04-28',          // [1]  FechaDocumento
    'EGRESO',              // [2]  TipoMovimiento
    'TECNOLOGIA_Y_SOFTWARE', // [3] Categoria
    'SUSCRIPCION_SAAS',    // [4]  Subcategoria
    'Google Workspace',    // [5]  ProveedorCliente
    '76.023.972-2',        // [6]  RutEmisorReceptor
    'GWS-APR-2026',        // [7]  NumeroDocumento
    'CLP',                 // [8]  Moneda
    23319,                 // [9]  MontoNeto
    4431,                  // [10] IVA
    27750,                 // [11] MontoTotal
    'PAGADO',              // [12] EstadoPago
    'auto-cobro tarjeta',  // [13] MedioPago
    '',                    // [14] OrigenVenta
    'billing@google.com',  // [15] EmailOrigen
    '',                    // [16] GmailMessageId
    '',                    // [17] HashDocumento
    'BOT_MANUAL',          // [18] Fuente
    'Corregido por fixGWSRows - schema erroneo original', // [19] Observaciones
    'LOCAL_ENGINE_ALTA',   // [20] ProcesadoPorAI
    '',                    // [21] SocioRut
    '',                    // [22] GerenciaRol
    '2026-05-12',          // [23] CreatedAt
    Utilities.formatDate(now, 'America/Santiago', 'yyyy-MM-dd'), // [24] UpdatedAt
    'CLP',                 // [25] MonedaOriginal
    27750,                 // [26] MontoOriginal
    1,                     // [27] TipoCambioAplicado
    27750,                 // [28] MontoTotalCLP
    'PENDIENTE_BANCO',     // [29] EstadoConciliacionBanco
    'NO',                  // [30] EsExtranjero
    ''                     // [31] AlertaSistema
  ];

  // ── Fila 12 (índice de hoja = 12, índice array = 11): GWS-APR26-02 ────────
  // Google Workspace prorrateo 3 días — IVA 0% confirmado
  var row12 = [
    '2026-05-12',          // [0]  FechaRegistro
    '2026-04-30',          // [1]  FechaDocumento
    'EGRESO',              // [2]  TipoMovimiento
    'TECNOLOGIA_Y_SOFTWARE', // [3] Categoria
    'SUSCRIPCION_SAAS',    // [4]  Subcategoria
    'Google Workspace',    // [5]  ProveedorCliente
    '76.023.972-2',        // [6]  RutEmisorReceptor
    '5554877275',          // [7]  NumeroDocumento
    'CLP',                 // [8]  Moneda
    1554,                  // [9]  MontoNeto
    0,                     // [10] IVA (0% — prorrateo confirmado)
    1554,                  // [11] MontoTotal
    'PAGADO',              // [12] EstadoPago
    'auto-cobro tarjeta',  // [13] MedioPago
    '',                    // [14] OrigenVenta
    'billing@google.com',  // [15] EmailOrigen
    '',                    // [16] GmailMessageId
    '',                    // [17] HashDocumento
    'BOT_MANUAL',          // [18] Fuente
    'Prorrateo 3 dias IVA 0% confirmado - Corregido por fixGWSRows', // [19] Observaciones
    'LOCAL_ENGINE_ALTA',   // [20] ProcesadoPorAI
    '',                    // [21] SocioRut
    '',                    // [22] GerenciaRol
    '2026-05-12',          // [23] CreatedAt
    Utilities.formatDate(now, 'America/Santiago', 'yyyy-MM-dd'), // [24] UpdatedAt
    'CLP',                 // [25] MonedaOriginal
    1554,                  // [26] MontoOriginal
    1,                     // [27] TipoCambioAplicado
    1554,                  // [28] MontoTotalCLP
    'PENDIENTE_BANCO',     // [29] EstadoConciliacionBanco
    'NO',                  // [30] EsExtranjero
    ''                     // [31] AlertaSistema
  ];

  // ── Escribir en la hoja (fila 1 = encabezado, datos desde fila 2) ─────────
  // Libro_Mayor fila 11 = getRange(11, 1)
  sheet.getRange(11, 1, 1, 32).setValues([row11]);
  sheet.getRange(12, 1, 1, 32).setValues([row12]);

  SpreadsheetApp.flush();

  var msg = [
    '✅ fixGWSRows completado',
    '',
    'Fila 11 → GWS-APR-2026    | $27.750 CLP | EGRESO TECNOLOGIA',
    'Fila 12 → 5554877275      | $1.554 CLP  | EGRESO TECNOLOGIA (IVA 0%)',
    '',
    'Ejecuta runDataQualityChecks() para confirmar que los errores desaparecieron.'
  ].join('\n');

  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);

  AuditService.logInfo('LedgerFixes.fixGWSRows', 'Filas 11-12 corregidas con schema LEDGER correcto');
}
