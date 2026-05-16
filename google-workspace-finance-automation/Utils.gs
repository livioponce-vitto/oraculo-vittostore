if (typeof FinanceUtils === 'undefined') {
var FinanceUtils = (function () {
  function nowIso() {
    return new Date().toISOString();
  }

  function nowChile() {
    return Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd HH:mm:ss');
  }

  function getChileDate() {
    var tz = 'America/Santiago';
    var now = new Date();
    var year = Number(Utilities.formatDate(now, tz, 'yyyy'));
    var month = Number(Utilities.formatDate(now, tz, 'M'));
    var day = Number(Utilities.formatDate(now, tz, 'd'));
    return new Date(year, month - 1, day);
  }

  function isLastDayOfMonth(date) {
    var temp = new Date(date.getTime());
    temp.setDate(temp.getDate() + 1);
    return temp.getDate() === 1;
  }

  function normalizeCurrency(value) {
    if (value === null || value === undefined || value === '') {
      return 0;
    }
    if (typeof value === 'number') {
      return isNaN(value) ? 0 : value;
    }
    if (typeof value === 'object') {
      return 0;
    }
    var cleaned = String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    var parsed = Number(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  function roundCurrency(value, moneda) {
    var num = normalizeCurrency(value);
    var m = String(moneda || 'CLP').toUpperCase().trim();
    if (m === 'CLP') {
      return Math.round(num);
    }
    return Math.round(num * 100) / 100;
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function sha256(input) {
    var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
    return raw
      .map(function (b) {
        var v = (b + 256) % 256;
        return (v < 16 ? '0' : '') + v.toString(16);
      })
      .join('');
  }

  function buildDocHash(entry) {
    var fingerprint = [
      normalizeText(entry.tipoMovimiento),
      normalizeText(entry.proveedorCliente),
      normalizeText(entry.rutEmisorReceptor || ''),
      normalizeText(entry.numeroDocumento),
      normalizeText(entry.fechaDocumento),
      normalizeText(entry.moneda || 'CLP'),
      String(normalizeCurrency(entry.montoTotal))
    ].join('|');

    return sha256(fingerprint);
  }

  function safeJsonParse(input) {
    try {
      return JSON.parse(input);
    } catch (error) {
      return null;
    }
  }

  function toDateString(date) {
    return Utilities.formatDate(date, 'America/Santiago', 'yyyy-MM-dd');
  }

  return {
    nowIso: nowIso,
    nowChile: nowChile,
    getChileDate: getChileDate,
    isLastDayOfMonth: isLastDayOfMonth,
    normalizeCurrency: normalizeCurrency,
    roundCurrency: roundCurrency,
    normalizeText: normalizeText,
    sha256: sha256,
    buildDocHash: buildDocHash,
    safeJsonParse: safeJsonParse,
    toDateString: toDateString
  };
})();
}
