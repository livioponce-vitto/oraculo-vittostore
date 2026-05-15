var AuditService = (function () {
  var DEFAULT_RETENTION_DAYS = 90;
  var LAST_ROTATION_KEY = 'AUDIT_LAST_ROTATION';

  function log(severity, eventName, detail) {
    var sheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.AUDIT, FinanceConfig.HEADERS.AUDIT);
    sheet.appendRow([FinanceUtils.nowIso(), severity, eventName, detail || '']);
  }

  function logInfo(eventName, detail) {
    log('INFO', eventName, detail);
  }

  function logWarn(eventName, detail) {
    log('WARN', eventName, detail);
  }

  function logError(eventName, detail) {
    log('ERROR', eventName, detail);
  }

  /**
   * Elimina filas de Auditoria_Finanzas anteriores a retentionDays.
   * Asume filas en orden cronológico ascendente (appendRow siempre al final).
   * Usa búsqueda binaria para localizar el corte en O(log n).
   * @param {number} [retentionDays] - Días a conservar (default: AUDIT_RETENTION_DAYS o 90)
   * @returns {{ deleted: number, remaining: number }}
   */
  function rotateAuditLog(retentionDays) {
    try {
      var props = PropertiesService.getScriptProperties();
      var days = retentionDays ||
        parseInt(props.getProperty('AUDIT_RETENTION_DAYS') || '', 10) ||
        DEFAULT_RETENTION_DAYS;

      var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      var sheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.AUDIT, FinanceConfig.HEADERS.AUDIT);
      var lastRow = sheet.getLastRow();

      if (lastRow < 2) {
        return { deleted: 0, remaining: 0 };
      }

      var dataRows = lastRow - 1;
      var timestamps = sheet.getRange(2, 1, dataRows, 1).getValues();

      // Búsqueda binaria: primer índice cuyo timestamp >= cutoff
      var lo = 0;
      var hi = dataRows;
      while (lo < hi) {
        var mid = Math.floor((lo + hi) / 2);
        var ts = new Date(timestamps[mid][0]);
        if (isNaN(ts.getTime()) || ts < cutoff) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }

      // lo = número de filas a eliminar (0-indexed desde fila 2)
      if (lo === 0) {
        props.setProperty(LAST_ROTATION_KEY, new Date().toISOString());
        return { deleted: 0, remaining: dataRows };
      }

      // Eliminar filas 2..lo+1 (1-indexed en Sheets)
      sheet.deleteRows(2, lo);
      SpreadsheetApp.flush();

      props.setProperty(LAST_ROTATION_KEY, new Date().toISOString());

      var remaining = dataRows - lo;
      logInfo('AuditService rotacion completada',
        'Eliminadas: ' + lo + ' | Conservadas: ' + remaining + ' | Retencion: ' + days + ' dias');

      return { deleted: lo, remaining: remaining };
    } catch (e) {
      // No bloquear el flujo si la rotación falla
      Logger.log('AuditService.rotateAuditLog error: ' + String(e));
      return { deleted: 0, remaining: -1, error: String(e) };
    }
  }

  return {
    logInfo: logInfo,
    logWarn: logWarn,
    logError: logError,
    rotateAuditLog: rotateAuditLog
  };
})();

// Wrapper global — aparece en el desplegable de Apps Script
function runAuditLogRotation() {
  var result = AuditService.rotateAuditLog();
  var msg = [
    '✅ Rotación de logs completada',
    '',
    'Filas eliminadas : ' + result.deleted,
    'Filas conservadas: ' + result.remaining,
    '',
    'Retención configurada: ' + (PropertiesService.getScriptProperties().getProperty('AUDIT_RETENTION_DAYS') || '90') + ' días.',
    'Para cambiarla: agrega AUDIT_RETENTION_DAYS en Script Properties.'
  ].join('\n');
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}
