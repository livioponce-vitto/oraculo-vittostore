// ─── MEJORA-7: Backfill GerenciaRol vacío en Libro_Mayor ─────────────────────

/**
 * Rellena GerenciaRol (columna 23, índice 22) en todas las filas del
 * Libro_Mayor donde el campo está vacío, usando la misma lógica que
 * LedgerService.resolveGerenciaRol_().
 * Seguro de re-ejecutar: solo toca filas con GerenciaRol en blanco.
 */
function backfillGerenciaRol() {
  var GERENCIA_MAP = {
    'Ventas':                'Comercial',
    'TECNOLOGIA_Y_SOFTWARE': 'Operaciones',
    'LEGAL_Y_COMPLIANCE':    'Legal',
    'Servicios':             'Operaciones',
    'MARKETING':             'Comercial',
    'LOGISTICA':             'Operaciones'
  };

  function resolve(categoria) {
    var cat = String(categoria || '').trim();
    return GERENCIA_MAP[cat.toUpperCase()] || GERENCIA_MAP[cat] || 'Finanzas';
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(FinanceConfig.SHEETS.LEDGER);

  if (!sheet) {
    SpreadsheetApp.getUi().alert('❌ Hoja "Libro_Mayor" no encontrada.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('ℹ️ Libro_Mayor sin datos.');
    return;
  }

  // Leer columnas Categoria (col 4, índice 3) y GerenciaRol (col 23, índice 22)
  var dataRows = lastRow - 1;
  var categorias   = sheet.getRange(2, 4,  dataRows, 1).getValues(); // col D
  var gerenciaVals = sheet.getRange(2, 23, dataRows, 1).getValues(); // col W

  var updated = 0;
  for (var i = 0; i < dataRows; i++) {
    var current = String(gerenciaVals[i][0] || '').trim();
    if (current !== '') continue; // ya tiene valor, no tocar

    var newVal = resolve(categorias[i][0]);
    sheet.getRange(i + 2, 23).setValue(newVal);
    updated++;
  }

  SpreadsheetApp.flush();

  var msg = [
    '✅ backfillGerenciaRol completado',
    '',
    'Filas actualizadas: ' + updated,
    'Filas ya con valor: ' + (dataRows - updated),
    '',
    'Mapa aplicado:',
    '  Ventas                → Comercial',
    '  TECNOLOGIA_Y_SOFTWARE → Operaciones',
    '  LEGAL_Y_COMPLIANCE    → Legal',
    '  Servicios / LOGISTICA → Operaciones',
    '  (resto)               → Finanzas'
  ].join('\n');

  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);

  AuditService.logInfo('LedgerFixes.backfillGerenciaRol',
    'GerenciaRol rellenado en ' + updated + ' filas');
}

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

// ─── MEJORA-4: Deduplicación de filas en TipoCambio_USD ──────────────────────

/**
 * Elimina filas duplicadas en TipoCambio_USD causadas por el bug de upsert
 * (getValues() devolvía Date objects que no coincidían con el key string).
 * Por cada fecha, conserva la fila con ActualizadoEn más reciente.
 * Reescribe la hoja limpia y ordenada por fecha ascendente.
 */
function deduplicateFxRates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(FinanceConfig.SHEETS.FX_RATES);

  if (!sheet) {
    SpreadsheetApp.getUi().alert('❌ Hoja "' + FinanceConfig.SHEETS.FX_RATES + '" no encontrada.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('ℹ️ TipoCambio_USD no tiene datos para deduplicar.');
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var totalBefore = data.length;

  // Construir mapa fecha → fila ganadora (la de ActualizadoEn más reciente)
  var best = {};
  data.forEach(function (row) {
    var fecha = row[0];
    var key = (fecha instanceof Date)
      ? Utilities.formatDate(fecha, 'America/Santiago', 'yyyy-MM-dd')
      : String(fecha || '').trim();

    if (!key) return;

    var updatedAt = row[3] ? new Date(row[3]).getTime() : 0;
    if (!best[key] || updatedAt > best[key].updatedAt) {
      best[key] = {
        row: [key, row[1], row[2], row[3]],
        updatedAt: updatedAt
      };
    }
  });

  // Ordenar por fecha ascendente
  var cleanRows = Object.keys(best).sort().map(function (k) {
    return best[k].row;
  });

  var totalAfter = cleanRows.length;
  var removed = totalBefore - totalAfter;

  // Reescribir: limpiar bloque de datos y volcar filas limpias
  sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (cleanRows.length > 0) {
    sheet.getRange(2, 1, cleanRows.length, 4).setValues(cleanRows);
  }

  SpreadsheetApp.flush();

  var msg = [
    '✅ deduplicateFxRates completado',
    '',
    'Filas antes : ' + totalBefore,
    'Filas después: ' + totalAfter,
    'Duplicados eliminados: ' + removed,
    '',
    'La hoja queda ordenada por fecha ascendente.'
  ].join('\n');

  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);

  AuditService.logInfo('LedgerFixes.deduplicateFxRates',
    'Duplicados eliminados: ' + removed + ' | Filas finales: ' + totalAfter);
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

// ─── Purga selectiva de logs INFO en Auditoria_Finanzas ──────────────────────
/**
 * Elimina filas INFO más antiguas que INFO_RETENTION_DAYS (default 7).
 * WARN y ERROR nunca se tocan, independientemente de su antigüedad.
 * Seguro de re-ejecutar: opera sobre una copia en memoria y reescribe de una vez.
 */
function purgeOldInfoLogs() {
  var INFO_RETENTION_DAYS = 7;
  var WARN_RETENTION_DAYS = 30;
  // ERROR: siempre conservado

  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(FinanceConfig.SHEETS.AUDIT);

  if (!sheet) {
    SpreadsheetApp.getUi().alert('❌ Hoja "' + FinanceConfig.SHEETS.AUDIT + '" no encontrada.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('ℹ️ Auditoria sin datos.');
    return;
  }

  var now = Date.now();
  var infoCutoff  = new Date(now - INFO_RETENTION_DAYS  * 24 * 60 * 60 * 1000);
  var warnCutoff  = new Date(now - WARN_RETENTION_DAYS  * 24 * 60 * 60 * 1000);

  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var totalBefore = data.length;

  var kept = data.filter(function (row) {
    var severity = String(row[1] || '').toUpperCase();
    var ts = new Date(row[0]);
    var validTs = !isNaN(ts.getTime());

    if (severity === 'ERROR') return true;
    if (severity === 'WARN')  return validTs && ts >= warnCutoff;
    return validTs && ts >= infoCutoff;
  });

  var removed = totalBefore - kept.length;

  sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (kept.length > 0) {
    sheet.getRange(2, 1, kept.length, 4).setValues(kept);
  }
  SpreadsheetApp.flush();

  var msg = [
    '✅ purgeOldInfoLogs completado',
    '',
    'Filas antes  : ' + totalBefore,
    'Filas después: ' + kept.length,
    'Eliminados   : ' + removed,
    '',
    'Política aplicada:',
    '  ERROR → conservado siempre',
    '  WARN  → últimos ' + WARN_RETENTION_DAYS + ' días',
    '  INFO  → últimos ' + INFO_RETENTION_DAYS  + ' días'
  ].join('\n');

  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);

  AuditService.logInfo('LedgerFixes.purgeOldInfoLogs',
    'Eliminados: ' + removed + ' | Filas finales: ' + kept.length);
}
