var ValidationService = (function () {
  function isAnthropicProvider_(value) {
    var provider = String(value || '').toLowerCase();
    return provider.indexOf('anthropic') !== -1;
  }

  function isValidDate(value) {
    if (!value) {
      return false;
    }

    var date = new Date(value);
    return !isNaN(date.getTime());
  }

  function isValidRut(rut) {
    var value = String(rut || '').replace(/\./g, '').replace(/-/g, '').toUpperCase();
    if (!value || value.length < 2) {
      return false;
    }

    var body = value.slice(0, -1);
    var dv = value.slice(-1);
    if (!/^\d+$/.test(body)) {
      return false;
    }

    var sum = 0;
    var multiplier = 2;
    for (var i = body.length - 1; i >= 0; i--) {
      sum += Number(body.charAt(i)) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }

    var expected = 11 - (sum % 11);
    var expectedDv = expected === 11 ? '0' : expected === 10 ? 'K' : String(expected);
    return dv === expectedDv;
  }

  function validateExtractedRecord(record) {
    var errors = [];
    var warnings = [];
    var tipo = String(record.tipoMovimiento || '').toUpperCase();

    if (tipo !== 'INGRESO' && tipo !== 'EGRESO') {
      errors.push('tipoMovimiento invalido');
    }

    var total = FinanceUtils.normalizeCurrency(record.montoTotal);
    if (total <= 0) {
      errors.push('montoTotal invalido');
    }

    if (!isValidDate(record.fechaDocumento)) {
      errors.push('fechaDocumento invalida');
    }

    if (!record.categoria) {
      errors.push('categoria vacia');
    }

    if (!record.numeroDocumento) {
      errors.push('numeroDocumento vacio');
    }

    var moneda = String(record.moneda || 'CLP').toUpperCase();
    if (moneda !== 'CLP' && moneda !== 'USD') {
      errors.push('moneda no soportada');
    }

    if (record.rutEmisorReceptor && !isValidRut(record.rutEmisorReceptor)) {
      errors.push('rutEmisorReceptor invalido');
    }

    if (tipo === 'INGRESO' && !record.origenVenta) {
      warnings.push('origenVenta vacio para ingreso');
    }

    // PRV-002: Anthropic Chile debe mantener IVA ~19% del neto si ambos campos vienen informados.
    if (tipo === 'EGRESO' && isAnthropicProvider_(record.proveedorCliente)) {
      var neto = FinanceUtils.normalizeCurrency(record.montoNeto);
      var iva = FinanceUtils.normalizeCurrency(record.iva);
      var monedaAnthropic = String(record.moneda || 'CLP').toUpperCase();

      if (neto > 0 && iva > 0) {
        var expectedIva = Math.round((neto * 0.19) * 100) / 100;
        if (Math.abs(iva - expectedIva) > 0.03) {
          warnings.push('anthropic_iva_19_inconsistente');
        }
      }

      // PRV-004: Claude Pro individual suele netear a USD 20. Alertar desviaciones relevantes.
      if (monedaAnthropic === 'USD' && neto > 0 && Math.abs(neto - 20) > 5) {
        warnings.push('anthropic_plan_monto_fuera_rango');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  function validateEmailSenderAgainstAllowList(fromHeader, listKey) {
    var allowed = FinanceConfig.getArrayProperty(listKey);
    var sender = FinanceUtils.normalizeText(fromHeader);
    var ok = allowed.some(function (entry) {
      return sender.indexOf(entry) !== -1;
    });

    return {
      valid: ok,
      allowed: allowed
    };
  }

  return {
    validateExtractedRecord: validateExtractedRecord,
    validateEmailSenderAgainstAllowList: validateEmailSenderAgainstAllowList
  };
})();
