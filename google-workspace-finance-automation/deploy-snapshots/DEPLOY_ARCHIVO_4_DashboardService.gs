var DashboardService = (function () {
  function getSheet(sheetName, headers) {
    return LedgerService.getOrCreateSheet(sheetName, headers);
  }

  function resetSheet(sheet, headers) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  function readSheetRows(sheetName, headers) {
    var sheet = getSheet(sheetName, headers);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }
    return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  }

  function getLatestAuditTimestamp(eventName) {
    var rows = readSheetRows(FinanceConfig.SHEETS.AUDIT, FinanceConfig.HEADERS.AUDIT);
    var latest = '';

    rows.forEach(function (row) {
      if (String(row[2] || '') !== eventName) {
        return;
      }
      var timestamp = String(row[0] || '');
      if (!latest || timestamp > latest) {
        latest = timestamp;
      }
    });

    return latest || 'N/D';
  }

  function getLedgerHealth() {
    var rows = readSheetRows(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
    var pendingBank = 0;
    var ingresosMes = 0;
    var egresosMes = 0;
    var today = FinanceUtils.getChileDate();
    var currentPeriod = Utilities.formatDate(today, 'America/Santiago', 'yyyy-MM');

    rows.forEach(function (row) {
      if (String(row[29] || '') !== 'CONCILIADO_BANCO') {
        pendingBank += 1;
      }

      var period = '';
      try {
        period = Utilities.formatDate(new Date(row[1]), 'America/Santiago', 'yyyy-MM');
      } catch (error) {
        period = '';
      }

      if (period !== currentPeriod) {
        return;
      }

      var amount = FinanceUtils.normalizeCurrency(row[11]);
      var tipo = String(row[2] || '').toUpperCase();
      if (tipo === 'INGRESO') {
        ingresosMes += amount;
      }
      if (tipo === 'EGRESO') {
        egresosMes += amount;
      }
    });

    return {
      totalRows: rows.length,
      pendingBank: pendingBank,
      ingresosMes: ingresosMes,
      egresosMes: egresosMes,
      resultadoMes: ingresosMes - egresosMes
    };
  }

  function getDataQualityHealth() {
    var rows = readSheetRows(FinanceConfig.SHEETS.DATA_QUALITY, FinanceConfig.HEADERS.DATA_QUALITY);
    var errorCount = 0;
    var warnCount = 0;

    rows.forEach(function (row) {
      if (row[3] === 'ERROR') {
        errorCount += 1;
      }
      if (row[3] === 'WARN') {
        warnCount += 1;
      }
    });

    return {
      errorCount: errorCount,
      warnCount: warnCount
    };
  }

  function getReviewQueueHealth() {
    var rows = readSheetRows(FinanceConfig.SHEETS.REVIEW_QUEUE, FinanceConfig.HEADERS.REVIEW_QUEUE);
    var pending = 0;
    var overdue = 0;
    var financePending = 0;
    var commercialPending = 0;

    rows.forEach(function (row) {
      var status = String(row[7] || '');
      var semaphore = String(row[31] || '');
      var owner = String(row[29] || '');
      var isOpen = status !== 'REPROCESADO_OK' && status !== 'REVISADO' && status !== 'DUPLICADO';

      if (!isOpen) {
        return;
      }

      pending += 1;
      if (semaphore === 'ROJO') {
        overdue += 1;
      }
      if (owner === 'Finanzas') {
        financePending += 1;
      }
      if (owner === 'Comercial') {
        commercialPending += 1;
      }
    });

    return {
      pending: pending,
      overdue: overdue,
      financePending: financePending,
      commercialPending: commercialPending
    };
  }

  function getContingencyHealth() {
    var rows = readSheetRows(FinanceConfig.SHEETS.INTEGRATION_CONTINGENCY, FinanceConfig.HEADERS.INTEGRATION_CONTINGENCY);
    var openIncidents = 0;
    var blockingIncidents = 0;

    rows.forEach(function (row) {
      var status = String(row[4] || '');
      var severity = String(row[3] || '');
      if (status === 'ABIERTO') {
        openIncidents += 1;
      }
      if (status === 'ABIERTO' && (severity === 'SEV-1' || severity === 'SEV-2')) {
        blockingIncidents += 1;
      }
    });

    return {
      openIncidents: openIncidents,
      blockingIncidents: blockingIncidents
    };
  }

  function getSystemHealthSnapshot() {
    return {
      updatedAt: FinanceUtils.nowIso(),
      lastIngestionAt: getLatestAuditTimestamp('Ejecucion ingestion completada'),
      lastQualityCheckAt: getLatestAuditTimestamp('Control calidad datos ejecutado'),
      ledger: getLedgerHealth(),
      quality: getDataQualityHealth(),
      queue: getReviewQueueHealth(),
      contingency: getContingencyHealth()
    };
  }

  function buildDashboardRows(snapshot) {
    return [
      ['Resumen', 'ActualizadoEn', snapshot.updatedAt, ''],
      ['Resumen', 'UltimaIngestion', snapshot.lastIngestionAt, ''],
      ['Resumen', 'UltimoControlCalidad', snapshot.lastQualityCheckAt, ''],
      ['SaludSistema', 'ErroresCalidad', snapshot.quality.errorCount, 'Hallazgos ERROR vigentes en Control_Calidad_Datos'],
      ['SaludSistema', 'WarningsCalidad', snapshot.quality.warnCount, 'Hallazgos WARN vigentes en Control_Calidad_Datos'],
      ['SaludSistema', 'RechazadosPendientes', snapshot.queue.pending, 'Casos abiertos en Bandeja_Revision_Rechazados'],
      ['SaludSistema', 'RechazadosVencidos', snapshot.queue.overdue, 'Casos con semaforo rojo'],
      ['SaludSistema', 'IncidentesAbiertos', snapshot.contingency.openIncidents, 'Integraciones en estado ABIERTO'],
      ['SaludSistema', 'IncidentesBloqueantes', snapshot.contingency.blockingIncidents, 'Integraciones SEV-1 o SEV-2 abiertas'],
      ['Operacion', 'FilasLibroMayor', snapshot.ledger.totalRows, ''],
      ['Operacion', 'PendientesBanco', snapshot.ledger.pendingBank, 'Filas no conciliadas'],
      ['Operacion', 'IngresosMes', snapshot.ledger.ingresosMes, 'Acumulado mensual'],
      ['Operacion', 'EgresosMes', snapshot.ledger.egresosMes, 'Acumulado mensual'],
      ['Operacion', 'ResultadoMes', snapshot.ledger.resultadoMes, 'Ingresos - Egresos del mes']
    ];
  }

  function writeRowsToView(sheetName, headers, rows) {
    var sheet = getSheet(sheetName, headers);
    resetSheet(sheet, headers);
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
  }

  function buildFinanceViewRows(snapshot) {
    return [
      ['Backlog', 'RechazadosFinanzas', snapshot.queue.financePending, 'Casos asignados a Finanzas'],
      ['Backlog', 'RechazadosVencidos', snapshot.queue.overdue, 'Casos rojos que requieren accion'],
      ['Control', 'ErroresCalidad', snapshot.quality.errorCount, 'Errores vigentes antes del cierre'],
      ['Control', 'PendientesBanco', snapshot.ledger.pendingBank, 'Partidas sin conciliacion bancaria'],
      ['Cierre', 'ResultadoMes', snapshot.ledger.resultadoMes, 'Resultado contable del mes a la fecha']
    ];
  }

  function buildCommercialViewRows(snapshot) {
    return [
      ['Backlog', 'RechazadosComercial', snapshot.queue.commercialPending, 'Casos asignados a Comercial'],
      ['Analitica', 'IngresosMes', snapshot.ledger.ingresosMes, 'Acumulado de ingresos del mes'],
      ['Analitica', 'WarningsCalidad', snapshot.quality.warnCount, 'Advertencias que pueden afectar atribucion'],
      ['Riesgo', 'IncidentesAbiertos', snapshot.contingency.openIncidents, 'Fallas de integracion con impacto potencial']
    ];
  }

  function buildManagementViewRows(snapshot) {
    return [
      ['Riesgo', 'ErroresCalidad', snapshot.quality.errorCount, 'Debe ser 0 para cierre confiable'],
      ['Riesgo', 'RechazadosVencidos', snapshot.queue.overdue, 'Pendientes operativos fuera de SLA'],
      ['Riesgo', 'IncidentesBloqueantes', snapshot.contingency.blockingIncidents, 'SEV-1 o SEV-2 abiertos'],
      ['Resultado', 'ResultadoMes', snapshot.ledger.resultadoMes, 'Resultado del mes a la fecha'],
      ['Operacion', 'UltimaIngestion', snapshot.lastIngestionAt, 'Marca de continuidad operacional']
    ];
  }

  function refreshExecutiveSuite() {
    LedgerService.ensureCoreSheets();
    var snapshot = getSystemHealthSnapshot();

    writeRowsToView(FinanceConfig.SHEETS.EXECUTIVE_DASHBOARD, FinanceConfig.HEADERS.EXECUTIVE_DASHBOARD, buildDashboardRows(snapshot));
    writeRowsToView(FinanceConfig.SHEETS.FINANCE_VIEW, FinanceConfig.HEADERS.FINANCE_VIEW, buildFinanceViewRows(snapshot));
    writeRowsToView(FinanceConfig.SHEETS.COMMERCIAL_VIEW, FinanceConfig.HEADERS.COMMERCIAL_VIEW, buildCommercialViewRows(snapshot));
    writeRowsToView(FinanceConfig.SHEETS.MANAGEMENT_VIEW, FinanceConfig.HEADERS.MANAGEMENT_VIEW, buildManagementViewRows(snapshot));
    SheetPresentationService.applyAllPresentation();

    AuditService.logInfo('Dashboard ejecutivo actualizado', JSON.stringify(snapshot));
    return snapshot;
  }

  function getMonthlyCloseBlockers() {
    var snapshot = getSystemHealthSnapshot();
    var blockers = [];

    if (snapshot.quality.errorCount > 0) {
      blockers.push('Existen errores de calidad de datos abiertos: ' + snapshot.quality.errorCount);
    }
    if (snapshot.queue.overdue > 0) {
      blockers.push('Existen rechazados vencidos en bandeja operativa: ' + snapshot.queue.overdue);
    }
    if (snapshot.contingency.blockingIncidents > 0) {
      blockers.push('Existen incidentes de integracion bloqueantes abiertos: ' + snapshot.contingency.blockingIncidents);
    }

    return {
      blocked: blockers.length > 0,
      blockers: blockers,
      snapshot: snapshot
    };
  }

  return {
    getMonthlyCloseBlockers: getMonthlyCloseBlockers,
    getSystemHealthSnapshot: getSystemHealthSnapshot,
    refreshExecutiveSuite: refreshExecutiveSuite
  };
})();
