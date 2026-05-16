var DataQualityService = (function () {
  var LEDGER_INDEX = {
    FECHA_DOCUMENTO: 1,
    TIPO_MOVIMIENTO: 2,
    CATEGORIA: 3,
    NUMERO_DOCUMENTO: 7,
    MONTO_NETO: 9,
    IVA: 10,
    MONTO_TOTAL: 11,
    ESTADO_PAGO: 12,
    ORIGEN_VENTA: 14,
    HASH_DOCUMENTO: 17,
    GERENCIA_ROL: 22,
    MONTO_TOTAL_CLP: 28,
    ESTADO_CONCILIACION: 29,
    ES_EXTRANJERO: 30,
    ALERTA_SISTEMA: 31
  };

  function getLedgerSheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
  }

  function getQualitySheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.DATA_QUALITY, FinanceConfig.HEADERS.DATA_QUALITY);
  }

  function getRejectedSheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.REJECTED_RECORDS, FinanceConfig.HEADERS.REJECTED_RECORDS);
  }

  function clearPreviousResults(sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.DATA_QUALITY.length).clearContent();
    }
  }

  function registerRejectedRecord(metadata, record, errors) {
    var rejectedSheet = getRejectedSheet();
    var payload = {
      metadata: metadata || {},
      record: record || {},
      errors: errors || []
    };

    rejectedSheet.appendRow([
      FinanceUtils.nowIso(),
      (metadata && metadata.fuente) || '',
      (metadata && metadata.gmailMessageId) || '',
      (metadata && metadata.emailOrigen) || '',
      (record && record.numeroDocumento) || '',
      'ERROR',
      (errors || []).join(', '),
      JSON.stringify(payload)
    ]);
  }

  function getRejectedRecordsSummary(startDate, endDate) {
    var sheet = getRejectedSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { count: 0, bySource: {} };
    }

    var rows = sheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.REJECTED_RECORDS.length).getValues();
    var count = 0;
    var bySource = {};

    rows.forEach(function (row) {
      var timestamp = new Date(row[0]);
      if (isNaN(timestamp.getTime()) || timestamp < startDate || timestamp > endDate) {
        return;
      }

      count += 1;
      var source = String(row[1] || 'SIN_FUENTE');
      bySource[source] = (bySource[source] || 0) + 1;
    });

    return { count: count, bySource: bySource };
  }

  function runWeeklyDataQualitySummary() {
    var today = FinanceUtils.getChileDate();
    var endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    var startDate = new Date(endDate.getTime());
    startDate.setDate(startDate.getDate() - 6);

    var qualitySheet = getQualitySheet();
    var lastRow = qualitySheet.getLastRow();
    var findings = [];

    if (lastRow >= 2) {
      findings = qualitySheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.DATA_QUALITY.length).getValues();
    }

    var errorCount = findings.filter(function (row) {
      var executedAt = new Date(row[0]);
      return !isNaN(executedAt.getTime()) && executedAt >= startDate && executedAt <= endDate && row[3] === 'ERROR';
    }).length;

    var warnCount = findings.filter(function (row) {
      var executedAt = new Date(row[0]);
      return !isNaN(executedAt.getTime()) && executedAt >= startDate && executedAt <= endDate && row[3] === 'WARN';
    }).length;

    var rejectedSummary = getRejectedRecordsSummary(startDate, endDate);
    var recipients = FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS');
    var sourceLines = Object.keys(rejectedSummary.bySource).sort().map(function (key) {
      return '- ' + key + ': ' + rejectedSummary.bySource[key];
    });

    MailApp.sendEmail({
      to: recipients,
      subject: '[Vitto Finance] Resumen semanal calidad de datos',
      body: [
        'Resumen semanal de calidad del Libro Mayor',
        'Periodo: ' + FinanceUtils.toDateString(startDate) + ' a ' + FinanceUtils.toDateString(endDate),
        'Hallazgos ERROR: ' + errorCount,
        'Hallazgos WARN: ' + warnCount,
        'Registros bloqueados antes de guardar: ' + rejectedSummary.count,
        '',
        'Bloqueos por fuente:',
        sourceLines.length > 0 ? sourceLines.join('\n') : '- Sin bloqueos en el periodo',
        '',
        'Revisar hojas Control_Calidad_Datos y Registros_Rechazados para el detalle completo.'
      ].join('\n')
    });

    AuditService.logInfo('Resumen semanal calidad enviado', JSON.stringify({
      periodStart: FinanceUtils.toDateString(startDate),
      periodEnd: FinanceUtils.toDateString(endDate),
      errors: errorCount,
      warnings: warnCount,
      blocked: rejectedSummary.count
    }));

    return {
      periodStart: FinanceUtils.toDateString(startDate),
      periodEnd: FinanceUtils.toDateString(endDate),
      errorCount: errorCount,
      warnCount: warnCount,
      blockedCount: rejectedSummary.count
    };
  }

  function isValidDateValue(value) {
    if (!value) {
      return false;
    }

    var date = new Date(value);
    return !isNaN(date.getTime());
  }

  function isPendingTooLong(fechaDocumento) {
    var documentDate = new Date(fechaDocumento);
    if (isNaN(documentDate.getTime())) {
      return false;
    }

    var now = FinanceUtils.getChileDate();
    var diffMs = now.getTime() - documentDate.getTime();
    var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays > 7;
  }

  function buildIssue(executedAt, rowNumber, hashDocumento, severity, rule, detail) {
    return [executedAt, rowNumber, hashDocumento || '', severity, rule, detail];
  }

  function sendCriticalFindingsEmail(summary, findings) {
    var recipients = FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS');
    var topFindings = findings.slice(0, 10).map(function (item) {
      return [
        '- Fila ' + item[1],
        'Severidad: ' + item[3],
        'Regla: ' + item[4],
        'Detalle: ' + item[5]
      ].join(' | ');
    });

    var body = [
      'Control de calidad de datos - Libro Mayor',
      'Ejecutado en: ' + summary.executedAt,
      'Filas revisadas: ' + summary.reviewedRows,
      'Hallazgos totales: ' + summary.findings,
      'Errores: ' + summary.errorCount,
      'Warnings: ' + summary.warnCount,
      '',
      'Primeros hallazgos detectados:',
      topFindings.join('\n'),
      '',
      'Revisar hoja Control_Calidad_Datos para el detalle completo.'
    ].join('\n');

    MailApp.sendEmail({
      to: recipients,
      subject: '[Vitto Finance] Errores criticos en control de calidad de datos',
      body: body
    });
  }

  function inspectRow(row, rowNumber, executedAt, hashCounts) {
    var issues = [];
    var tipoMovimiento = String(row[LEDGER_INDEX.TIPO_MOVIMIENTO] || '').toUpperCase();
    var categoria = String(row[LEDGER_INDEX.CATEGORIA] || '').trim();
    var numeroDocumento = String(row[LEDGER_INDEX.NUMERO_DOCUMENTO] || '').trim();
    var fechaDocumento = row[LEDGER_INDEX.FECHA_DOCUMENTO];
    var hashDocumento = String(row[LEDGER_INDEX.HASH_DOCUMENTO] || '').trim();
    var origenVenta = String(row[LEDGER_INDEX.ORIGEN_VENTA] || '').trim();
    var gerenciaRol = String(row[LEDGER_INDEX.GERENCIA_ROL] || '').trim();
    var estadoPago = String(row[LEDGER_INDEX.ESTADO_PAGO] || '').trim();
    var estadoConciliacion = String(row[LEDGER_INDEX.ESTADO_CONCILIACION] || '').trim();
    var esExtranjero = String(row[LEDGER_INDEX.ES_EXTRANJERO] || 'FALSE').toUpperCase();
    var alertaSistema = String(row[LEDGER_INDEX.ALERTA_SISTEMA] || '').trim();

    var montoNeto = FinanceUtils.normalizeCurrency(row[LEDGER_INDEX.MONTO_NETO]);
    var iva = FinanceUtils.normalizeCurrency(row[LEDGER_INDEX.IVA]);
    var montoTotal = FinanceUtils.normalizeCurrency(row[LEDGER_INDEX.MONTO_TOTAL]);
    var montoTotalClp = FinanceUtils.normalizeCurrency(row[LEDGER_INDEX.MONTO_TOTAL_CLP]);

    if (tipoMovimiento !== 'INGRESO' && tipoMovimiento !== 'EGRESO') {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'ERROR', 'TIPO_MOVIMIENTO_INVALIDO', 'La fila no tiene tipo de movimiento valido.'));
    }

    if (!isValidDateValue(fechaDocumento)) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'ERROR', 'FECHA_DOCUMENTO_INVALIDA', 'La fecha del documento esta vacia o no tiene formato valido.'));
    }

    if (!categoria) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'ERROR', 'CATEGORIA_FALTANTE', 'La fila no tiene categoria asignada.'));
    }

    if (!numeroDocumento) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'ERROR', 'DOCUMENTO_FALTANTE', 'La fila no tiene numero de documento.'));
    }

    if (montoTotal <= 0) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'ERROR', 'MONTO_TOTAL_INVALIDO', 'El monto total es cero o negativo.'));
    }

    if (Math.abs((montoNeto + iva) - montoTotal) > 1) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'WARN', 'DESCUADRE_NETO_IVA_TOTAL', 'MontoNeto + IVA no cuadra con MontoTotal.'));
    }

    if (montoTotalClp > 0 && Math.abs(montoTotalClp - montoTotal) > 1) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'WARN', 'DESCUADRE_TOTAL_CLP', 'MontoTotal y MontoTotalCLP no coinciden. Revisar conversion o carga manual.'));
    }

    if (!estadoPago) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'WARN', 'ESTADO_PAGO_FALTANTE', 'La fila no tiene estado de pago.'));
    }

    if (tipoMovimiento === 'INGRESO' && (!origenVenta || origenVenta === 'Sin atribucion')) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'WARN', 'ORIGEN_VENTA_SIN_ATRIBUCION', 'Ingreso sin origen de venta util para analitica y cierre.'));
    }

    if (!gerenciaRol) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'WARN', 'GERENCIA_ROL_FALTANTE', 'La fila no tiene gerencia o area responsable.'));
    }

    if (!hashDocumento) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'ERROR', 'HASH_FALTANTE', 'La fila no tiene HashDocumento para trazabilidad.'));
    } else if (hashCounts[hashDocumento] > 1) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'ERROR', 'HASH_DUPLICADO_EN_LIBRO', 'El HashDocumento aparece repetido en Libro_Mayor.'));
    }

    if (estadoConciliacion !== 'CONCILIADO_BANCO' && isPendingTooLong(fechaDocumento)) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'WARN', 'CONCILIACION_PENDIENTE_ANTIGUA', 'La fila lleva mas de 7 dias sin conciliacion bancaria.'));
    }

    if (esExtranjero === 'TRUE' && !alertaSistema) {
      issues.push(buildIssue(executedAt, rowNumber, hashDocumento, 'WARN', 'FACTURA_EXTRANJERA_SIN_ALERTA', 'Registro extranjero sin alerta o comentario operativo.'));
    }

    return issues;
  }

  function buildHashCounts(rows) {
    var counts = {};

    rows.forEach(function (row) {
      var hashDocumento = String(row[LEDGER_INDEX.HASH_DOCUMENTO] || '').trim();
      if (!hashDocumento) {
        return;
      }
      counts[hashDocumento] = (counts[hashDocumento] || 0) + 1;
    });

    return counts;
  }

  function runLedgerDataQualityChecks() {
    LedgerService.ensureCoreSheets();

    var ledgerSheet = getLedgerSheet();
    var qualitySheet = getQualitySheet();
    var lastRow = ledgerSheet.getLastRow();
    var executedAt = FinanceUtils.nowIso();

    clearPreviousResults(qualitySheet);

    if (lastRow < 2) {
      AuditService.logInfo('Control calidad datos ejecutado', 'Libro_Mayor sin filas para revisar');
      return {
        executedAt: executedAt,
        reviewedRows: 0,
        findings: 0,
        errorCount: 0,
        warnCount: 0
      };
    }

    var rows = ledgerSheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.LEDGER.length).getValues();
    var hashCounts = buildHashCounts(rows);
    var findings = [];

    rows.forEach(function (row, index) {
      findings = findings.concat(inspectRow(row, index + 2, executedAt, hashCounts));
    });

    if (findings.length > 0) {
      qualitySheet.getRange(2, 1, findings.length, FinanceConfig.HEADERS.DATA_QUALITY.length).setValues(findings);
    }

    var errorCount = findings.filter(function (item) {
      return item[3] === 'ERROR';
    }).length;
    var warnCount = findings.filter(function (item) {
      return item[3] === 'WARN';
    }).length;

    var summary = {
      executedAt: executedAt,
      reviewedRows: rows.length,
      findings: findings.length,
      errorCount: errorCount,
      warnCount: warnCount
    };

    if (errorCount > 0) {
      sendCriticalFindingsEmail(summary, findings.filter(function (item) {
        return item[3] === 'ERROR';
      }));
    }

    AuditService.logInfo('Control calidad datos ejecutado', JSON.stringify({
      reviewedRows: rows.length,
      findings: findings.length,
      errors: errorCount,
      warnings: warnCount
    }));

    return summary;
  }

  return {
    registerRejectedRecord: registerRejectedRecord,
    runLedgerDataQualityChecks: runLedgerDataQualityChecks,
    runWeeklyDataQualitySummary: runWeeklyDataQualitySummary
  };
})();
