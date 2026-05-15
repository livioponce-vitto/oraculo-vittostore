var FxService = (function () {
  function getFxSheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.FX_RATES, FinanceConfig.HEADERS.FX_RATES);
  }

  function formatApiDate(date) {
    var d = new Date(date);
    var dd = Utilities.formatDate(d, 'America/Santiago', 'dd');
    var mm = Utilities.formatDate(d, 'America/Santiago', 'MM');
    var yyyy = Utilities.formatDate(d, 'America/Santiago', 'yyyy');
    return dd + '-' + mm + '-' + yyyy;
  }

  function dateKey(date) {
    return Utilities.formatDate(new Date(date), 'America/Santiago', 'yyyy-MM-dd');
  }

  function normalizeDateCell(cellValue) {
    if (!cellValue) return '';
    // getValues() returns Date objects for date-formatted cells; normalize to yyyy-MM-dd
    if (cellValue instanceof Date) return dateKey(cellValue);
    return String(cellValue);
  }

  function saveRate(date, rate, source) {
    var sheet = getFxSheet();
    var key = dateKey(date);
    var lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      for (var i = 0; i < data.length; i++) {
        if (normalizeDateCell(data[i][0]) === key) {
          sheet.getRange(i + 2, 2).setValue(rate);
          sheet.getRange(i + 2, 3).setValue(source || 'mindicador.cl');
          sheet.getRange(i + 2, 4).setValue(FinanceUtils.nowIso());
          return;
        }
      }
    }

    sheet.appendRow([key, rate, source || 'mindicador.cl', FinanceUtils.nowIso()]);
  }

  function readCachedRate(date) {
    var sheet = getFxSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return null;
    }

    var key = dateKey(date);
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      if (normalizeDateCell(values[i][0]) === key) {
        var rate = Number(values[i][1]);
        return isNaN(rate) ? null : rate;
      }
    }
    return null;
  }

  function readPreviousCachedRate(date) {
    var sheet = getFxSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return null;
    }

    var target = dateKey(date);
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var bestDate = '';
    var bestRate = null;

    for (var i = 0; i < values.length; i++) {
      var d = normalizeDateCell(values[i][0]);
      var r = Number(values[i][1]);
      if (!d || isNaN(r) || r <= 0) {
        continue;
      }

      if (d <= target && (bestDate === '' || d > bestDate)) {
        bestDate = d;
        bestRate = r;
      }
    }

    if (!bestRate) {
      return null;
    }

    return {
      date: bestDate,
      rate: bestRate
    };
  }

  function fetchRateFromApi(date) {
    var apiDate = formatApiDate(date);
    var endpoint = 'https://mindicador.cl/api/dolar/' + apiDate;
    var response = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    var status = response.getResponseCode();

    if (status < 200 || status > 299) {
      throw new Error('No se pudo obtener dolar observado (' + apiDate + '). HTTP ' + status);
    }

    var data = FinanceUtils.safeJsonParse(response.getContentText());
    if (!data || !data.serie || !data.serie[0] || !data.serie[0].valor) {
      throw new Error('Respuesta invalida de mindicador para fecha ' + apiDate);
    }

    var rate = Number(data.serie[0].valor);
    if (isNaN(rate) || rate <= 0) {
      throw new Error('Tipo de cambio invalido para fecha ' + apiDate);
    }

    saveRate(date, rate, 'mindicador.cl');
    return rate;
  }

  function getUsdRateForDate(date) {
    var cached = readCachedRate(date);
    if (cached) {
      return {
        rate: cached,
        source: 'cache_same_day',
        fallbackUsed: false,
        alert: ''
      };
    }

    try {
      var apiRate = fetchRateFromApi(date);
      return {
        rate: apiRate,
        source: 'mindicador.cl',
        fallbackUsed: false,
        alert: ''
      };
    } catch (apiError) {
      var previous = readPreviousCachedRate(date);
      if (!previous) {
        ContingencyService.registerIntegrationIncident('FX_API', 'getUsdRateForDate', String(apiError), {
          responsible: 'Finanzas',
          fallbackApplied: false
        });
        throw apiError;
      }

      ContingencyService.registerIntegrationIncident('FX_API', 'getUsdRateForDate', String(apiError), {
        responsible: 'Finanzas',
        fallbackApplied: true,
        nextAction: 'Operar con cache previo y reintentar runDailyFxRate mas tarde.'
      });

      return {
        rate: previous.rate,
        source: 'cache_previous_day',
        fallbackUsed: true,
        alert: 'TC calculado con valor de ' + previous.date + ' por caida de API'
      };
    }
  }

  function convertToClp(amount, currency, transactionDate) {
    var normalizedCurrency = String(currency || 'CLP').toUpperCase().trim();
    var numericAmount = FinanceUtils.normalizeCurrency(amount);

    if (normalizedCurrency === 'CLP') {
      return {
        currency: 'CLP',
        amountOriginal: numericAmount,
        fxRate: 1,
        amountClp: numericAmount
      };
    }

    if (normalizedCurrency === 'USD') {
      var rateContext = getUsdRateForDate(transactionDate || new Date());
      return {
        currency: 'USD',
        amountOriginal: Math.round(numericAmount * 100) / 100,
        fxRate: rateContext.rate,
        amountClp: Math.round(numericAmount * rateContext.rate),
        fxFallbackUsed: rateContext.fallbackUsed,
        fxAlert: rateContext.alert,
        fxSource: rateContext.source
      };
    }

    throw new Error('Moneda no soportada para contabilidad automatica: ' + normalizedCurrency);
  }

  function refreshDailyUsdObservedRate() {
    var today = FinanceUtils.toDateString(new Date());
    var rateContext = getUsdRateForDate(today);
    AuditService.logInfo('TC USD actualizado', 'fecha=' + today + ' rate=' + rateContext.rate + ' source=' + rateContext.source);
    return { date: today, rate: rateContext.rate, source: rateContext.source, fallback: rateContext.fallbackUsed };
  }

  return {
    convertToClp: convertToClp,
    getUsdRateForDate: getUsdRateForDate,
    refreshDailyUsdObservedRate: refreshDailyUsdObservedRate
  };
})();
