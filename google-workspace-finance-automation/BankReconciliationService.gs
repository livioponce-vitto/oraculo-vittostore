var BankReconciliationService = (function () {
  function safeSendMail_(payload, contextLabel) {
    try {
      MailApp.sendEmail(payload);
      return { sent: true };
    } catch (error) {
      AuditService.logWarn('MailApp no autorizado; envio omitido', JSON.stringify({
        context: contextLabel,
        message: String(error)
      }));
      return { sent: false, error: String(error) };
    }
  }

  function getBankSheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.BANK_STATEMENT, FinanceConfig.HEADERS.BANK_STATEMENT);
  }

  function normalizeBankType(value) {
    var v = String(value || '').toUpperCase();
    if (v === 'INGRESO' || v === 'ABONO' || v === 'CREDITO') {
      return 'INGRESO';
    }
    if (v === 'EGRESO' || v === 'CARGO' || v === 'DEBITO') {
      return 'EGRESO';
    }
    return v;
  }

  function dateDiffDays(a, b) {
    var d1 = new Date(a);
    var d2 = new Date(b);
    var t1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
    var t2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.abs(Math.floor((t1 - t2) / (1000 * 60 * 60 * 24)));
  }

  // getValues() returns Date objects for date-formatted cells — normalize to yyyy-MM-dd string
  function normalizeDateCell(cellValue) {
    if (!cellValue) return '';
    if (cellValue instanceof Date) {
      return Utilities.formatDate(cellValue, 'America/Santiago', 'yyyy-MM-dd');
    }
    return String(cellValue);
  }

  // MEJORA-9: pre-index bank rows by tipo+roundedAmount for O(1) per-ledger lookup
  function buildBankIndex(bankValues) {
    var map = {};
    bankValues.forEach(function (row, i) {
      if (String(row[5] || '').toUpperCase() === 'SI') return;
      var tipo = normalizeBankType(row[3]);
      var amount = Math.round(FinanceUtils.normalizeCurrency(row[2]));
      // Index under rounded key and ±1 neighbours to survive rounding boundaries
      [-1, 0, 1].forEach(function (delta) {
        var key = tipo + '_' + (amount + delta);
        if (!map[key]) map[key] = [];
        map[key].push(i);
      });
    });
    return map;
  }

  function runWeeklyBankReconciliation() {
    var ledgerSheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
    var bankSheet = getBankSheet();

    var ledgerLastRow = ledgerSheet.getLastRow();
    var bankLastRow = bankSheet.getLastRow();

    if (ledgerLastRow < 2 || bankLastRow < 2) {
      AuditService.logWarn('Conciliacion bancaria omitida', 'Sin datos suficientes en Libro Mayor o Cartola_Banco');
      return { matched: 0, unmatchedLedger: 0, unmatchedBank: 0 };
    }

    var ledgerValues = ledgerSheet.getRange(2, 1, ledgerLastRow - 1, FinanceConfig.HEADERS.LEDGER.length).getValues();
    var bankValues = bankSheet.getRange(2, 1, bankLastRow - 1, FinanceConfig.HEADERS.BANK_STATEMENT.length).getValues();

    var matched = 0;
    var unmatchedLedger = 0;
    var bankUsed = {};
    var alerts = [];

    // MEJORA-9: O(N+M) — lookup map instead of O(N×M) double loop
    var bankIndex = buildBankIndex(bankValues);

    // Accumulate writes; flush in batch after matching loop
    var ledgerStateUpdates = {};    // ledger row idx → new col-30 value
    var bankConciliadoUpdates = {}; // bank row idx → 'SI'
    var bankHashUpdates = {};       // bank row idx → ledgerHash

    ledgerValues.forEach(function (ledgerRow, idx) {
      var ledgerTipo = String(ledgerRow[2] || '').toUpperCase();
      var ledgerDate = normalizeDateCell(ledgerRow[1]);
      var ledgerHash = String(ledgerRow[17] || '');
      var ledgerAmountClp = FinanceUtils.normalizeCurrency(ledgerRow[28] || ledgerRow[11]);
      var ledgerState = String(ledgerRow[29] || '');

      if (!ledgerHash || ledgerState === 'CONCILIADO_BANCO') {
        return;
      }

      var roundedAmount = Math.round(ledgerAmountClp);
      var candidates = bankIndex[ledgerTipo + '_' + roundedAmount] || [];
      var foundBankIndex = -1;

      for (var c = 0; c < candidates.length; c++) {
        var i = candidates[c];
        if (bankUsed[i]) continue;

        var bankRow = bankValues[i];
        var bankDate = normalizeDateCell(bankRow[0]);
        var bankAmount = FinanceUtils.normalizeCurrency(bankRow[2]);

        if (Math.abs(bankAmount - ledgerAmountClp) > 1) continue;
        if (dateDiffDays(bankDate, ledgerDate) > 3) continue;

        foundBankIndex = i;
        break;
      }

      if (foundBankIndex >= 0) {
        bankUsed[foundBankIndex] = true;
        bankConciliadoUpdates[foundBankIndex] = 'SI';
        bankHashUpdates[foundBankIndex] = ledgerHash;
        matched += 1;
        ledgerStateUpdates[idx] = 'CONCILIADO_BANCO';
      } else {
        unmatchedLedger += 1;
        ledgerStateUpdates[idx] = 'PENDIENTE_BANCO';
      }
    });

    // Batch write ledger col 30 (EstadoConciliacionBanco) — 1 Sheets API call
    var ledgerStateCol = ledgerValues.map(function (row, idx) {
      return [idx in ledgerStateUpdates ? ledgerStateUpdates[idx] : row[29]];
    });
    if (ledgerStateCol.length > 0) {
      ledgerSheet.getRange(2, 30, ledgerStateCol.length, 1).setValues(ledgerStateCol);
    }

    // Batch write bank cols 6 (Conciliado) and 7 (LedgerHash) — 2 Sheets API calls
    var bankConciliadoCol = bankValues.map(function (row, i) {
      return [i in bankConciliadoUpdates ? bankConciliadoUpdates[i] : row[5]];
    });
    var bankHashCol = bankValues.map(function (row, i) {
      return [i in bankHashUpdates ? bankHashUpdates[i] : row[6]];
    });
    if (bankConciliadoCol.length > 0) {
      bankSheet.getRange(2, 6, bankConciliadoCol.length, 1).setValues(bankConciliadoCol);
      bankSheet.getRange(2, 7, bankHashCol.length, 1).setValues(bankHashCol);
    }

    // MEJORA-10: in-memory state — no bankSheet.getRange().getValue() inside loop
    // MEJORA-11: alert on unmatched egresos as well as ingresos
    var unmatchedBank = 0;
    bankValues.forEach(function (bankRow, i) {
      var wasConciliated = String(bankRow[5] || '').toUpperCase() === 'SI';
      var newlyConciliated = i in bankConciliadoUpdates;
      if (wasConciliated || newlyConciliated) return;

      unmatchedBank += 1;
      var bankTipo = normalizeBankType(bankRow[3]);
      var label = bankTipo === 'EGRESO' ? 'Egreso No Identificado' : 'Ingreso No Identificado';
      alerts.push(label + ' en cartola: ' + normalizeDateCell(bankRow[0]) + ' monto=' + bankRow[2] + ' ref=' + bankRow[4]);
    });

    if (alerts.length > 0) {
      var emailResult = safeSendMail_({
        to: FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS'),
        subject: '[Conciliacion Bancaria] Movimientos bancarios no identificados',
        body: alerts.join('\n')
      }, 'runWeeklyBankReconciliation');

      if (!emailResult.sent) {
        AuditService.logWarn('Alerta conciliacion sin envio de correo', emailResult.error);
      }
    }

    AuditService.logInfo('Conciliacion bancaria ejecutada', JSON.stringify({
      matched: matched,
      unmatchedLedger: unmatchedLedger,
      unmatchedBank: unmatchedBank
    }));

    return {
      matched: matched,
      unmatchedLedger: unmatchedLedger,
      unmatchedBank: unmatchedBank,
      alerts: alerts.length
    };
  }

  return {
    runWeeklyBankReconciliation: runWeeklyBankReconciliation
  };
})();
