# Playbook de Incidentes - VittoStore Finance Automation

## 1. Objetivo
Este playbook define como detectar, contener y resolver incidentes del sistema financiero automatizado en Google Workspace sin contaminar el Libro Mayor oficial.

## 2. Alcance
Aplica a estos procesos:
1. Ingestion Gmail + Gemini
2. Parseo XML DTE
3. Conversion USD/CLP
4. Alertas SII (Previred y F29)
5. Conciliacion bancaria
6. Generacion de Ordenes de Compra

## 3. Niveles de severidad
1. SEV-1 Critico: Riesgo tributario o corrupcion de datos contables.
2. SEV-2 Alto: Flujo detenido o datos incompletos en produccion.
3. SEV-3 Medio: Degradacion parcial con workaround disponible.
4. SEV-4 Bajo: Alertas informativas sin impacto operativo.

## 4. Regla de oro
1. No borrar ni editar filas historicas del Libro_Mayor.
2. Corregir solo con fila de ajuste y observacion.
3. Ante duda, pausar ejecuciones manuales de ingestion.

## 5. Checklist de triage rapido (5 minutos)
1. Abrir hoja Auditoria_Finanzas.
2. Abrir hoja Contingencia_Integraciones si el error involucra Gmail, Gemini, FX, Mail o Calendar.
2. Identificar ultimo evento ERROR o WARN.
3. Registrar hora exacta, funcion y mensaje.
4. Confirmar si hay impacto en Libro_Mayor.
5. Clasificar severidad SEV-1/2/3/4.

## 5.1 Hojas operativas nuevas
1. Registros_Rechazados: evidencia cruda de registros bloqueados antes de entrar al Libro Mayor.
2. Bandeja_Revision_Rechazados: cola operativa para corregir y reprocesar registros sin tocar codigo.
3. Contingencia_Integraciones: bitacora automatica de fallas de integracion con severidad, fallback y siguiente accion.

## 6. Runbooks por incidente

### 6.1 Incidente A - Falla Gemini o extraccion invalida
Sintoma:
1. Eventos ERROR en procesamiento Gmail/Gemini.
2. Registros descartados por validacion.

Diagnostico:
1. Revisar Auditoria_Finanzas por messageId y detalle de error.
2. Validar si correo trae XML DTE adjunto.
3. Confirmar estado de GEMINI_API_KEY en Script Properties.

Contencion inmediata:
1. Ejecutar solo correos con DTE/XML de forma manual (sin corrida masiva).
2. Posponer ingestion de facturas sin XML hasta restablecer servicio.
3. Revisar hoja Contingencia_Integraciones para validar severidad y accion sugerida.

Recuperacion:
1. Reintentar runFinancialIngestion.
2. Verificar nuevas filas y ausencia de errores recurrentes.

Criterio de cierre:
1. Dos ejecuciones consecutivas sin ERROR Gemini.

### 6.2 Incidente B - Caida API tipo de cambio (mindicador)
Sintoma:
1. Error en runDailyFxRate o alerta de fallback.

Diagnostico:
1. Revisar Auditoria_Finanzas evento TC USD actualizado.
2. Confirmar si source es cache_previous_day.

Contencion inmediata:
1. Permitir fallback al ultimo TC cacheado.
2. Mantener trazabilidad en columna AlertaSistema.
3. Revisar hoja Contingencia_Integraciones para confirmar que fallback quedo registrado.

Recuperacion:
1. Reintentar runDailyFxRate mas tarde.
2. Confirmar retorno a source=mindicador.cl.

Criterio de cierre:
1. Evento TC USD actualizado con source=mindicador.cl.

### 6.3 Incidente C - Falla envio de correo (MailApp)
Sintoma:
1. No llega recordatorio SII o alertas de conciliacion.

Diagnostico:
1. Revisar permisos OAuth script.send_mail.
2. Verificar FINANCE_ALERT_EMAILS y CEO_EMAIL.

Contencion inmediata:
1. Enviar recordatorio manual por correo.
2. Ejecutar runDailyCompliance de forma manual cuando se recupere permiso.

Recuperacion:
1. Reautorizar permisos ejecutando runDailyCompliance.
2. Confirmar llegada de correo de prueba.

Criterio de cierre:
1. Correo automatico recibido y evento auditado.

### 6.4 Incidente D - Conciliacion bancaria no cuadra
Sintoma:
1. Muchos PENDIENTE_BANCO.
2. Alertas de Ingreso No Identificado.

Diagnostico:
1. Validar formato de cartola en Cartola_Banco.
2. Revisar tipo movimiento y monto CLP.
3. Confirmar rango de fechas razonable.

Contencion inmediata:
1. No ajustar manualmente estados conciliados sin respaldo.
2. Separar partidas en revision en observaciones.

Recuperacion:
1. Corregir formato cartola.
2. Reejecutar runWeeklyBankReconciliation.

Criterio de cierre:
1. Pendientes acotados a diferencias justificadas.

### 6.5 Incidente E - Duplicados o sospecha de corrupcion contable
Sintoma:
1. Registros repetidos por numeroDocumento o hash.
2. Ingresos/egresos fuera de rango esperado.

Diagnostico:
1. Revisar Control_Duplicados y HashDocumento.
2. Verificar columna AlertaSistema.

Contencion inmediata:
1. Pausar ejecucion manual de ingestion.
2. Registrar incidente SEV-1 si afecta cierre tributario.

Recuperacion:
1. Reconciliar con evidencia documental.
2. Generar filas de ajuste sin borrar historico.

Criterio de cierre:
1. Balance y trazabilidad consistentes con respaldo.

### 6.6 Incidente F - Clasificacion contable incorrecta (Devolucion/NC/Importacion/Exportacion)
Sintoma:
1. Documento de devolucion o Nota de Credito registrado como INGRESO.
2. Documento de importacion/exportacion clasificado en categoria no correspondiente.

Diagnostico:
1. Revisar columnas TipoMovimiento, Categoria y Subcategoria en Libro_Mayor.
2. Confirmar si subcategoria DTE corresponde a TipoDTE_61, 110, 111 o 112.
3. Revisar asunto/origen de correo para palabras clave (devolucion, refund, importacion, exportacion, FOB, CIF).
4. En importaciones, validar si se clasifico correctamente entre ARANCEL_ADUANERO, IMPUESTOS_IMPORTACION y LOGISTICA_Y_RETIRO_PORTUARIO.
5. En gastos operacionales, validar clasificacion de ARRIENDO_VEHICULOS y CAJA_CHICA_Y_RENDICIONES.

Contencion inmediata:
1. No borrar registro historico.
2. Corregir con fila de ajuste y observacion de trazabilidad.
3. Si el error se repite, registrar incidente en Contingencia_Integraciones con responsable Finanzas.

Recuperacion:
1. Ejecutar runDataQualityChecks.
2. Ejecutar syncRejectedReviewQueue y processRejectedReviewQueue si hubo bloqueos.
3. Reintentar runFinancialIngestion para validar que nuevas entradas queden bien clasificadas.

Criterio de cierre:
1. Dos ejecuciones consecutivas con clasificacion correcta en TipoMovimiento/Categoria/Subcategoria.
2. Para importaciones, evidencia de desglose contable minimo en arancel, impuestos y retiro/logistica portuaria.
3. Para gastos operacionales, evidencia de trazabilidad en observaciones y respaldo de rendiciones.

## 7. Matriz de decision rapida
1. Si hay riesgo tributario inmediato: SEV-1 y detener ingestion manual.
2. Si hay falla tecnica sin riesgo tributario: SEV-2 y aplicar workaround.
3. Si hay degradacion controlada con fallback: SEV-3.
4. Si solo hay alerta informativa: SEV-4.

## 8. Evidencia minima por incidente
1. Hora inicio y fin.
2. Funcion ejecutada.
3. Mensaje de error exacto.
4. Impacto detectado.
5. Accion aplicada.
6. Resultado posterior.
7. Fila registrada en Contingencia_Integraciones si aplica.

## 9. Protocolo de comunicacion
1. SEV-1: Aviso inmediato al CEO y responsable financiero.
2. SEV-2: Aviso al responsable financiero dentro de 30 minutos.
3. SEV-3/4: Reporte en resumen diario.

## 10. Cierre diario operativo
1. Confirmar evento TC USD actualizado.
2. Confirmar ausencia de ERROR critico en Auditoria_Finanzas.
3. Confirmar que no existen pendientes no explicados en conciliacion.

## 11. Mantenimiento semanal
1. Revisión de permisos OAuth.
2. Revisión de Script Properties.
3. Simulación controlada de fallback FX.
4. Revisión de 3 casos aleatorios en Libro_Mayor.
5. Revisión de bandeja Bandeja_Revision_Rechazados y vencimientos en rojo.
6. Revisión del resumen semanal de contingencia de integraciones.
7. Muestreo de 5 documentos con foco en devoluciones/NC/importacion/exportacion para validar clasificacion contable.

## 12. Operacion post go-live (checklist 2 minutos)

### 12.1 Control diario (lunes a viernes, 09:30)
1. Abrir Apps Script > Ejecuciones y revisar jobs automaticos recientes.
2. Confirmar estado Completada en:
	- runFinancialIngestion
	- runDailyFxRate
	- runDailyCompliance
3. Si hay Error, abrir detalle y registrar mensaje exacto en Contingencia_Integraciones.
4. Abrir dashboard financiero y validar:
	- pendingRejected sin alza anormal
	- blockingIncidents = 0

### 12.2 Control semanal (lunes, 11:30)
1. Confirmar ejecuciones semanales:
	- runWeeklyCEOReport
	- runWeeklyBankReconciliation
	- runWeeklyDataQualitySummary
	- runWeeklyIntegrationContingencySummary
	- runExecutiveDashboardRefresh
2. Revisar rechazados pendientes con antiguedad mayor a 7 dias.
3. Si hay acumulacion, ejecutar manualmente:
	- syncRejectedReviewQueue
	- processRejectedReviewQueue

### 12.3 Control mensual (ultimo dia habil, 22:30)
1. Confirmar ejecucion de runMonthlyBalance.
2. Verificar que no existan errores en esa corrida.
3. Validar dashboard actualizado post cierre.
4. Validar muestreo de importaciones/exportaciones con foco en arancel aduanero e impuestos de importacion.

### 12.4 Reglas de alerta operativa
1. Si runFinancialIngestion falla 2 veces seguidas: escalar de inmediato (SEV-2 minimo).
2. Si pendingRejected aumenta 3 dias consecutivos: revisar calidad de extracción y remitentes bloqueados.
3. Si blockingIncidents > 0: abrir incidente operativo con responsable y hora objetivo de resolucion.

### 12.5 Runbook rapido de contingencia runtime
1. Ejecutar debugSetupBuildTag_20260508.
2. Ejecutar runPhase4RuntimeDiagnostics_20260508.
3. Si build/services aparecen missing o undefined:
	- Re-sincronizar codigo con clasp push -f.
	- Ejecutar onOpen y recargar hoja.
	- Reintentar runFinancialIngestion manual.

### 12.6 KPI minimos de control
1. Tasa de exito diaria de jobs >= 95%.
2. Incidentes bloqueantes activos = 0.
3. Rechazados pendientes con antiguedad > 7 dias = 0.
