(() => {
  "use strict";

  const CONFIG = window.QAQC_CONFIG || {};
  const UNITS = CONFIG.units || { depth: "", charge: "unid. da fonte", stemming: "", diameter: "unid. da fonte", delay: "ms" };
  const state = {
    dataset: null,
    sourceFiles: [],
    driveEndpoint: "",
    selectedFileId: "",
    selectedHoleId: null,
    filtered: [],
    loading: false,
    syncing: false,
    sourceKind: "local",
    sourceLabel: "Fonte local",
    statusFilter: "all",
  };

  const $ = (id) => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const integerFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "always" });
  const rateFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const statusFilterLabels = { all: "Todos os furos", green: "Conforme", amber: "Em revisão", red: "Fora da faixa" };

  const requiredFields = [
    ["id", ["id", "furo", "numero do furo", "n do furo"]],
    ["plan", ["plano", "plan"]],
    ["date", ["data", "date"]],
    ["depthPlanned", ["profundidade prevista", "profundidade planejada", "depth planned"]],
    ["depthActual", ["profundidade realizada", "profundidade real", "depth actual"]],
    ["chargePlanned", ["cargas previstas", "carga prevista", "cargas planejadas", "charge planned"]],
    ["chargeActual", ["cargas realizadas", "carga realizada", "charge actual"]],
    ["stemmingPlanned", ["tampao previsto", "tampao planejado", "stemming planned"]],
    ["stemmingActual", ["tampao realizado", "tampao real", "stemming actual"]],
  ];

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || String(value).trim() === "") return null;
    let text = String(value).trim().replace(/\s/g, "");
    if (text.includes(",") && text.includes(".")) {
      text = text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replaceAll(".", "").replace(",", ".")
        : text.replaceAll(",", "");
    } else {
      text = text.replace(",", ".");
    }
    const number = Number(text.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) return "N/D";
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
  }

  function formatInteger(value) {
    return Number.isFinite(value) ? integerFormat.format(value) : "N/D";
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? percentFormat.format(value * 100) + "%" : "N/D";
  }

  function formatRate(value) {
    return Number.isFinite(value) ? `${rateFormat.format(value * 100)}%` : "N/D";
  }

  function formatDate(value) {
    const text = String(value ?? "").trim();
    if (!text) return "N/D";
    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (!match) return text;
    return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}`;
  }

  function dateKey(value) {
    return formatDate(value);
  }

  function formatSigned(value, unit = "") {
    if (!Number.isFinite(value)) return "N/D";
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
  }

  function withUnit(value, unit) {
    return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
  }

  function formatTypeLabel(value) {
    const text = String(value ?? "").trim();
    const normalized = normalizeText(text);
    if (!text || normalized === "na" || normalized === "nd") return "Não informado";
    if (normalized === "producao") return "Produção";
    if (normalized === "preplit" || normalized === "presplit") return "Pré-corte";
    if (normalized === "contorno") return "Contorno";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function average(rows, field) {
    const values = rows.map((row) => row[field]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function averageValues(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function hasReference(value) {
    return Number.isFinite(value) && Math.abs(value) >= 0.000001;
  }

  function pairedAverage(rows, plannedField, actualField) {
    const pairs = rows.filter((row) => hasReference(row[plannedField]) && Number.isFinite(row[actualField]));
    return {
      planned: average(pairs, plannedField),
      actual: average(pairs, actualField),
      delta: averageValues(pairs.map((row) => row[actualField] - row[plannedField])),
      count: pairs.length,
    };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function percentile(values, fraction) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * fraction;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  }

  function getSheetEntries(payload) {
    if (!payload || !payload.sheets) return [];
    if (Array.isArray(payload.sheets)) return payload.sheets.map((sheet, index) => [String(index), sheet]);
    return Object.entries(payload.sheets);
  }

  function getSheetRows(sheet) {
    if (Array.isArray(sheet)) return sheet;
    if (Array.isArray(sheet.rows)) return [sheet.headers || [], ...sheet.rows];
    return [];
  }

  function createHeaderMap(headers) {
    return headers.reduce((map, header, index) => {
      const key = normalizeText(header);
      if (key && map[key] === undefined) map[key] = index;
      return map;
    }, {});
  }

  function resolveColumn(headerMap, aliases) {
    for (const alias of aliases) {
      const index = headerMap[normalizeText(alias)];
      if (index !== undefined) return index;
    }
    return undefined;
  }

  function findHoleSheet(entries) {
    return entries.find(([, sheet]) => {
      const rows = getSheetRows(sheet);
      const map = createHeaderMap(rows[0] || []);
      return resolveColumn(map, ["id", "furo", "numero do furo"]) !== undefined
        && resolveColumn(map, ["profundidade realizada", "profundidade real"]) !== undefined;
    });
  }

  function valueAt(row, headerMap, aliases) {
    const index = resolveColumn(headerMap, aliases);
    return index === undefined ? null : row[index];
  }

  function makeFlag(label, delta, base, tolerance, mode = "relative") {
    if (!Number.isFinite(delta) || !hasReference(base) || !Number.isFinite(tolerance) || tolerance <= 0) return null;
    const relative = delta / Math.abs(base);
    const score = mode === "absolute" ? Math.abs(delta) / tolerance : Math.abs(relative) / tolerance;
    return { label, delta, relative, score, tolerance, mode };
  }

  function makeHole(row, headerMap, rawIndex) {
    const read = (aliases) => valueAt(row, headerMap, aliases);
    const depthPlanned = toNumber(read(["profundidade prevista", "profundidade planejada", "depth planned"]));
    const depthActual = toNumber(read(["profundidade realizada", "profundidade real", "depth actual"]));
    const chargePlanned = toNumber(read(["cargas previstas", "carga prevista", "cargas planejadas", "charge planned"]));
    const chargeActual = toNumber(read(["cargas realizadas", "carga realizada", "charge actual"]));
    const stemmingPlanned = toNumber(read(["tampao previsto", "tampao planejado", "stemming planned"]));
    const stemmingActual = toNumber(read(["tampao realizado", "tampao real", "stemming actual"]));
    const depthDelta = Number.isFinite(depthActual) && Number.isFinite(depthPlanned) ? depthActual - depthPlanned : null;
    const chargeDelta = Number.isFinite(chargeActual) && Number.isFinite(chargePlanned) ? chargeActual - chargePlanned : null;
    const stemmingDelta = Number.isFinite(stemmingActual) && Number.isFinite(stemmingPlanned) ? stemmingActual - stemmingPlanned : null;
    const flags = [
      makeFlag("Profundidade", depthDelta, depthPlanned, 0.10),
      makeFlag("Carga", chargeDelta, chargePlanned, 0.20),
      makeFlag("Tampão", stemmingDelta, stemmingPlanned, 0.50, "absolute"),
    ].filter(Boolean);
    const baselineMissing = [depthPlanned, chargePlanned, stemmingPlanned].some((value) => !hasReference(value));
    const executionMissing = [
      [depthPlanned, depthActual],
      [chargePlanned, chargeActual],
      [stemmingPlanned, stemmingActual],
    ].some(([planned, actual]) => hasReference(planned) && !Number.isFinite(actual));
    const notEvaluable = baselineMissing || executionMissing;
    const score = Math.max(flags.reduce((max, flag) => Math.max(max, flag.score), 0), notEvaluable ? 1 : 0);
    const primary = flags.slice().sort((a, b) => b.score - a.score)[0] || null;
    const severity = score >= 2 ? "red" : score >= 1 ? "amber" : "green";

    return {
      rawIndex,
      id: toNumber(read(["id", "furo", "numero do furo", "n do furo"])),
      plan: String(read(["plano", "plan"]) ?? "N/D").trim(),
      type: String(read(["tipo", "type"]) ?? "N/D").trim(),
      date: String(read(["data", "date"]) ?? "").trim(),
      time: String(read(["horario", "hora", "time"]) ?? "").trim(),
      x: toNumber(read(["x", "easting"])),
      y: toNumber(read(["y", "northing"])),
      crest: toNumber(read(["z crest", "crest", "z (crest)"])),
      toe: toNumber(read(["z toe", "toe", "z (toe)"])),
      depthPlanned,
      depthActual,
      depthDelta,
      depthPct: Number.isFinite(depthDelta) && Number.isFinite(depthPlanned) && depthPlanned !== 0 ? depthDelta / Math.abs(depthPlanned) : null,
      azimuth: toNumber(read(["azimute", "azimuth"])),
      inclination: toNumber(read(["inclinacao", "inclinação", "inclination"])),
      chargePlanned,
      chargeActual,
      chargeDelta,
      chargePct: Number.isFinite(chargeDelta) && Number.isFinite(chargePlanned) && chargePlanned !== 0 ? chargeDelta / Math.abs(chargePlanned) : null,
      stemmingPlanned,
      stemmingActual,
      stemmingDelta,
      subdrill: toNumber(read(["subfuracao", "subfuração", "subdrill"])),
      diameter: toNumber(read(["diametro", "diâmetro", "diameter"])),
      delay: toNumber(read(["tempo detonacao (ms)", "tempo detonação (ms)", "tempo detonacao", "delay"])),
      score,
      primary: primary || (baselineMissing ? { label: "Sem referência", delta: null, relative: null, score: 1, tolerance: null } : executionMissing ? { label: "Não avaliável", delta: null, relative: null, score: 1, tolerance: null } : null),
      baselineMissing,
      notEvaluable,
      severity,
      statusLabel: baselineMissing ? "Sem referência" : executionMissing ? "Não avaliável" : severity === "red" ? "Fora da faixa" : severity === "amber" ? "Em revisão" : "Conforme",
    };
  }

  function buildDataset(payload, fileMeta = {}) {
    const entries = getSheetEntries(payload);
    const holeEntry = findHoleSheet(entries);
    if (!holeEntry) throw new Error("A planilha não contém uma aba com ID do furo e profundidade executada.");
    const rows = getSheetRows(holeEntry[1]);
    const headers = rows[0] || [];
    const headerMap = createHeaderMap(headers);
    const missing = requiredFields.filter(([, aliases]) => resolveColumn(headerMap, aliases) === undefined).map(([name]) => name);
    if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}`);
    const holes = rows.slice(1)
      .map((row, index) => makeHole(row, headerMap, index + 2))
      .filter((hole) => Number.isFinite(hole.id))
      .map((hole) => ({
        ...hole,
        sourceId: fileMeta.id || "local",
        sourceName: fileMeta.name || payload.meta?.sourceFile || "Fonte local",
        sourceUpdatedAt: fileMeta.updatedAt || payload.meta?.updatedAt || "",
      }));
    const summaryEntry = entries.find(([name]) => normalizeText(name) === "resumo");
    const summary = {};
    if (summaryEntry) {
      const summaryRows = getSheetRows(summaryEntry[1]);
      summaryRows.slice(1).forEach((row) => {
        if (row[0] !== null && row[0] !== undefined && String(row[0]).trim()) summary[String(row[0]).trim()] = row[1];
      });
    }
    if (!holes.length) throw new Error("A planilha foi lida, mas não contém registros de furos válidos.");
    return {
      holes,
      summary,
      headers,
      meta: { ...(payload.meta || {}), ...fileMeta, sourceFile: fileMeta.name || payload.meta?.sourceFile || "Fonte não identificada" },
    };
  }

  function combineDatasets(datasets) {
    const records = new Map();
    const ordered = datasets.slice().sort((a, b) => String(a.meta.updatedAt || "").localeCompare(String(b.meta.updatedAt || "")));
    ordered.forEach((dataset) => dataset.holes.forEach((hole) => {
      const key = `${dateKey(hole.date)}|${hole.plan}|${hole.id}`;
      const existing = records.get(key);
      if (!existing || String(hole.sourceUpdatedAt || "") >= String(existing.sourceUpdatedAt || "")) records.set(key, hole);
    }));
    const holes = [...records.values()].sort((a, b) => a.id - b.id || String(a.plan).localeCompare(String(b.plan), "pt-BR", { numeric: true }));
    return {
      holes,
      summary: {},
      headers: [...new Set(datasets.flatMap((dataset) => dataset.headers || []))],
      meta: {
        sourceFile: `${datasets.length} planilhas do Drive`,
        updatedAt: ordered.at(-1)?.meta.updatedAt || "",
        sourceFiles: datasets.map((dataset) => dataset.meta.name).filter(Boolean),
      },
    };
  }

  function summarize(rows) {
    const depthPair = pairedAverage(rows, "depthPlanned", "depthActual");
    const chargePair = pairedAverage(rows, "chargePlanned", "chargeActual");
    const stemmingPair = pairedAverage(rows, "stemmingPlanned", "stemmingActual");
    const depthPlanned = depthPair.planned;
    const depthActual = depthPair.actual;
    const chargePlanned = chargePair.planned;
    const chargeActual = chargePair.actual;
    const stemmingPlanned = stemmingPair.planned;
    const stemmingActual = stemmingPair.actual;
    const delays = rows.map((row) => row.delay).filter(Number.isFinite);
    const depthDelta = depthPair.delta;
    const chargeDelta = chargePair.delta;
    const stemmingDelta = stemmingPair.delta;
    const evaluable = rows.filter((row) => !row.notEvaluable).length;
    return {
      count: rows.length,
      evaluable,
      plans: [...new Set(rows.map((row) => row.plan).filter(Boolean))],
      types: [...new Set(rows.map((row) => row.type).filter(Boolean))],
      dates: [...new Set(rows.map((row) => dateKey(row.date)).filter(Boolean))],
      depthPlanned, depthActual, depthDelta,
      depthPct: Number.isFinite(depthPlanned) && depthPlanned ? depthDelta / Math.abs(depthPlanned) : null,
      chargePlanned, chargeActual, chargeDelta,
      chargePct: Number.isFinite(chargePlanned) && chargePlanned ? chargeDelta / Math.abs(chargePlanned) : null,
      stemmingPlanned, stemmingActual, stemmingDelta,
      flagged: rows.filter((row) => row.severity !== "green").length,
      critical: rows.filter((row) => row.severity === "red").length,
      within: rows.filter((row) => row.severity === "green").length,
      review: rows.filter((row) => row.severity === "amber").length,
      high: rows.filter((row) => row.severity === "red").length,
      baselineMissing: rows.filter((row) => row.baselineMissing).length,
      notEvaluable: rows.filter((row) => row.notEvaluable).length,
      depthPairs: depthPair.count,
      chargePairs: chargePair.count,
      stemmingPairs: stemmingPair.count,
      delays,
      delayMin: delays.length ? Math.min(...delays) : null,
      delayMax: delays.length ? Math.max(...delays) : null,
      delayMedian: median(delays),
      delayP10: percentile(delays, 0.10),
      delayP90: percentile(delays, 0.90),
    };
  }

  function getVisibleRows() {
    if (!state.dataset) return [];
    const plan = $("plan-filter").value;
    const type = $("type-filter").value;
    const date = $("date-filter").value;
    const query = $("hole-search").value.trim().toLowerCase();
    return state.dataset.holes.filter((row) => {
      const matchesPlan = plan === "all" || row.plan === plan;
      const matchesType = type === "all" || row.type === type;
      const matchesDate = date === "all" || dateKey(row.date) === date;
      const matchesStatus = state.statusFilter === "all" || row.severity === state.statusFilter;
      const matchesQuery = !query || String(row.id).toLowerCase().includes(query);
      return matchesPlan && matchesType && matchesDate && matchesStatus && matchesQuery;
    });
  }

  function setSelectOptions(select, values, allLabel, formatValue = (value) => value) {
    const current = select.value;
    select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(formatValue(value))}</option>`).join("");
    if (["all", ...values].includes(current)) select.value = current;
  }

  function populateFilters() {
    const holes = state.dataset?.holes || [];
    setSelectOptions($("plan-filter"), [...new Set(holes.map((row) => row.plan))].sort(), "Todos os planos de fogo");
    setSelectOptions($("type-filter"), [...new Set(holes.map((row) => row.type))].sort(), "Todos os tipos de desmonte", formatTypeLabel);
    setSelectOptions($("date-filter"), [...new Set(holes.map((row) => dateKey(row.date)))].sort(), "Todas as datas de desmonte");
  }

  function renderHeroGraphic() {
    const holes = [
      [46, 40, "green"], [111, 70, "green"], [179, 48, "amber"], [247, 93, "green"], [314, 62, "red"],
      [383, 113, "green"], [452, 42, "green"], [519, 83, "amber"], [587, 53, "green"],
    ];
    const circles = holes.map(([x, y, status]) => `<g class="hero-hole hero-hole--${status}"><circle cx="${x}" cy="${y}" r="8"/><path d="M${x} ${y - 24}v13M${x - 5} ${y - 16}h10"/></g>`).join("");
    $("hero-graphic").innerHTML = `
      <svg class="hero-drill-svg" viewBox="0 0 650 180" role="img" aria-label="Malha esquemática com furos de perfuração">
        <defs><pattern id="hero-grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#ffffff" stroke-opacity=".1"/></pattern></defs>
        <rect x="12" y="12" width="626" height="156" fill="url(#hero-grid)"/>
        <path d="M32 136h586M32 94h586M32 52h586" stroke="#ffffff" stroke-opacity=".14" stroke-dasharray="2 8"/>
        <path d="M32 138C120 130 179 143 259 130S415 135 618 115" fill="none" stroke="#2cabb6" stroke-width="2" stroke-opacity=".7"/>
        <g>${circles}</g>
      </svg>`;
  }

  function renderSourceUi() {
    const select = $("file-select");
    const allOption = state.sourceFiles.length > 1 ? `<option value="all">Todas as planilhas (${state.sourceFiles.length})</option>` : "";
    select.innerHTML = state.sourceFiles.length
      ? allOption + state.sourceFiles.map((file) => `<option value="${escapeHtml(file.id)}">${escapeHtml(file.name)}</option>`).join("")
      : `<option value="local">Fonte local</option>`;
    select.disabled = !state.sourceFiles.length;
    if (state.selectedFileId === "all" && state.sourceFiles.length > 1) select.value = "all";
    else if (state.selectedFileId && state.sourceFiles.some((file) => file.id === state.selectedFileId)) select.value = state.selectedFileId;
    const markClass = state.sourceKind === "remote" ? "status-mark--remote" : state.sourceKind === "error" ? "status-mark--warn" : "status-mark--local";
    $("source-status").innerHTML = `<span class="status-mark ${markClass}" aria-hidden="true"></span><span>${escapeHtml(state.sourceLabel)}</span>`;
    $("top-status").textContent = state.syncing
      ? "Atualizando dados"
      : state.sourceKind === "remote" ? "Drive conectado" : state.sourceKind === "error" ? "Fonte alternativa" : "Fonte carregada";
  }

  function renderHero(summary) {
    const candidates = [
      { key: "profundidade", delta: summary.depthDelta, pct: summary.depthPct, unit: UNITS.depth, label: "Profundidade" },
      { key: "carga", delta: summary.chargeDelta, pct: summary.chargePct, unit: UNITS.charge, label: "Carga" },
      { key: "tampão", delta: summary.stemmingDelta, pct: summary.stemmingPlanned ? summary.stemmingDelta / Math.abs(summary.stemmingPlanned) : null, unit: UNITS.stemming, label: "Tampão" },
    ].filter((item) => Number.isFinite(item.pct));
    const lead = candidates.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
    if (lead && Math.abs(lead.pct) >= 0.02) {
      $("hero-focus").textContent = lead.label;
      $("hero-focus-delta").textContent = `${formatPercent(lead.pct)} · ${formatSigned(lead.delta, lead.unit)} em relação ao planejado`;
    } else {
      $("hero-focus").textContent = "Nenhum parâmetro dominante";
      $("hero-focus-delta").textContent = "Desvios médios dentro da faixa configurada";
    }
    const compliance = summary.evaluable ? summary.within / summary.evaluable : null;
    $("hero-compliance").textContent = formatRate(compliance);
    $("hero-compliance-caption").textContent = Number.isFinite(compliance) ? `${formatInteger(summary.within)} de ${formatInteger(summary.evaluable)} furos avaliáveis classificados como conformes` : "Sem registros avaliáveis";
    $("hero-plan").textContent = summary.plans.length ? `Plano de fogo ${summary.plans.join(", ")}` : "Plano de fogo N/D";
    $("hero-date").textContent = summary.dates.length ? `Data do desmonte ${summary.dates.join(", ")}` : "Data do desmonte N/D";
    $("hero-count").textContent = `${formatInteger(summary.count)} furos avaliados`;
  }

  function renderKpis(summary) {
    $("kpi-holes").textContent = formatInteger(summary.count);
    $("kpi-holes-foot").textContent = summary.flagged ? `${formatInteger(summary.flagged)} exceções para verificação` : "Sem exceções no recorte";
    $("kpi-depth").textContent = formatInteger(summary.within);
    $("kpi-depth-foot").textContent = `${formatRate(summary.evaluable ? summary.within / summary.evaluable : null)} dos furos avaliáveis`;
    $("kpi-charge").textContent = formatInteger(summary.review);
    $("kpi-charge-foot").textContent = summary.review ? "Requerem conferência" : "Sem registros em revisão";
    $("kpi-attention").textContent = formatInteger(summary.high);
    $("kpi-attention-foot").textContent = summary.high ? "Prioridade alta" : summary.baselineMissing ? `${formatInteger(summary.baselineMissing)} sem referência` : "Sem ocorrências";
  }

  function severityClass(severity) {
    return severity === "red" ? "red" : severity === "amber" ? "amber" : "green";
  }

  function hideChartTooltip() {
    const tooltip = $("chart-tooltip");
    if (!tooltip) return;
    tooltip.classList.remove("is-visible");
    tooltip.setAttribute("aria-hidden", "true");
  }

  function showChartTooltip(node, event) {
    const tooltip = $("chart-tooltip");
    const message = node?.dataset.chartTooltip;
    if (!tooltip || !message) return;
    tooltip.textContent = message;
    tooltip.classList.add("is-visible");
    tooltip.setAttribute("aria-hidden", "false");
    const rect = node.getBoundingClientRect();
    const pointerX = event?.clientX ?? rect.left + rect.width / 2;
    const pointerY = event?.clientY ?? rect.top + rect.height / 2;
    const left = Math.max(10, Math.min(pointerX + 14, window.innerWidth - tooltip.offsetWidth - 10));
    const above = pointerY - tooltip.offsetHeight - 14;
    const top = above > 10 ? above : Math.min(window.innerHeight - tooltip.offsetHeight - 10, pointerY + 14);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(10, top)}px`;
  }

  function bindChartTooltips(root) {
    root.querySelectorAll("[data-chart-tooltip]").forEach((node) => {
      node.addEventListener("pointerenter", (event) => showChartTooltip(node, event));
      node.addEventListener("pointermove", (event) => showChartTooltip(node, event));
      node.addEventListener("pointerleave", hideChartTooltip);
      node.addEventListener("focus", () => showChartTooltip(node));
      node.addEventListener("blur", hideChartTooltip);
    });
  }

  function applyStatusFilter(value) {
    if (!Object.hasOwn(statusFilterLabels, value)) return;
    state.statusFilter = value;
    renderAll();
    if (value !== "all") $("table-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`Filtro aplicado: ${statusFilterLabels[value]}`);
  }

  function renderMap(rows) {
    const mapRoot = $("hole-map");
    const coordinateRows = rows.filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y));
    if (!coordinateRows.length) {
      mapRoot.innerHTML = `<div class="empty-state">A fonte não contém coordenadas X/Y válidas para este recorte.</div>`;
      return;
    }
    const width = 840;
    const height = 408;
    const pad = { left: 58, right: 26, top: 26, bottom: 44 };
    const minX = Math.min(...coordinateRows.map((row) => row.x));
    const maxX = Math.max(...coordinateRows.map((row) => row.x));
    const minY = Math.min(...coordinateRows.map((row) => row.y));
    const maxY = Math.max(...coordinateRows.map((row) => row.y));
    const dataSpanX = Math.max(maxX - minX, 1);
    const dataSpanY = Math.max(maxY - minY, 1);
    // Keep a deliberate internal margin around the measured extent. This
    // prevents the selected point/ring and the outer rows from touching the
    // plot edge while preserving the complete spatial distribution.
    const extentPadRatio = 0.08;
    const domainMinX = minX - dataSpanX * extentPadRatio;
    const domainMaxX = maxX + dataSpanX * extentPadRatio;
    const domainMinY = minY - dataSpanY * extentPadRatio;
    const domainMaxY = maxY + dataSpanY * extentPadRatio;
    const domainSpanX = domainMaxX - domainMinX;
    const domainSpanY = domainMaxY - domainMinY;
    const xPos = (value) => pad.left + ((value - domainMinX) / domainSpanX) * (width - pad.left - pad.right);
    const yPos = (value) => height - pad.bottom - ((value - domainMinY) / domainSpanY) * (height - pad.top - pad.bottom);
    const grid = [0, .25, .5, .75, 1].map((fraction) => {
      const x = pad.left + fraction * (width - pad.left - pad.right);
      const y = height - pad.bottom - fraction * (height - pad.top - pad.bottom);
      return `<line class="plot-grid" x1="${x}" y1="${pad.top}" x2="${x}" y2="${height - pad.bottom}"/><line class="plot-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"/>`;
    }).join("");
    const points = coordinateRows.map((row) => {
      const x = xPos(row.x).toFixed(2);
      const y = yPos(row.y).toFixed(2);
      const selected = String(row.id) === String(state.selectedHoleId);
      const radius = row.severity === "red" ? 5.2 : row.severity === "amber" ? 4.3 : 3.5;
      const selectedRing = selected ? `<circle class="selection-ring" cx="${x}" cy="${y}" r="${radius + 6}"/>` : "";
      const tooltip = `Furo ${row.id} · ${row.statusLabel} · ${row.primary?.label || "Sem parâmetro crítico"}`;
      return `${selectedRing}<circle class="hole-point hole-point--${severityClass(row.severity)}${selected ? " hole-point--selected" : ""}" cx="${x}" cy="${y}" r="${radius}" data-hole-id="${escapeHtml(row.id)}" data-chart-tooltip="${escapeHtml(tooltip)}" tabindex="0" role="button" aria-label="Furo ${escapeHtml(row.id)}, ${escapeHtml(row.statusLabel)}"><title>${escapeHtml(tooltip)}</title></circle>`;
    }).join("");
    const labelX = [0, .5, 1].map((fraction) => `<text class="plot-label" x="${xPos(minX + fraction * (maxX - minX))}" y="${height - 14}" text-anchor="middle">${formatNumber(minX + fraction * (maxX - minX), 1)}</text>`).join("");
    const labelY = [0, .5, 1].map((fraction) => `<text class="plot-label" x="16" y="${yPos(minY + fraction * (maxY - minY)) + 3}">${formatNumber(minY + fraction * (maxY - minY), 1)}</text>`).join("");
    mapRoot.innerHTML = `<svg class="map-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mapa de ${coordinateRows.length} furos por coordenadas X e Y"><rect x="0" y="0" width="${width}" height="${height}" fill="#f5f8f7"/>${grid}<line class="plot-axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"/><line class="plot-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"/>${points}${labelX}${labelY}<text class="plot-label" x="${width - 26}" y="${height - 14}" text-anchor="end">X</text><text class="plot-label" x="18" y="${pad.top - 8}">Y</text></svg>`;
    mapRoot.querySelectorAll("[data-hole-id]").forEach((node) => {
      node.addEventListener("click", () => selectHole(node.dataset.holeId));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectHole(node.dataset.holeId); }
      });
    });
    bindChartTooltips(mapRoot);
    $("map-tag").textContent = `${formatInteger(coordinateRows.length)} pontos`;
  }

  function renderScatter(rows) {
    const root = $("scatter-chart");
    const paired = rows.filter((row) => Number.isFinite(row.depthPct) && Number.isFinite(row.chargePct));
    if (!paired.length) {
      root.innerHTML = `<div class="empty-state">Não há pares completos entre planejado e executado neste recorte.</div>`;
      $("scatter-tag").textContent = "Sem pares completos";
      return;
    }
    const width = 760;
    const height = 250;
    const pad = { left: 52, right: 20, top: 18, bottom: 38 };
    const maxAbs = Math.max(10, ...paired.flatMap((row) => [Math.abs(row.depthPct * 100), Math.abs(row.chargePct * 100)]));
    const domain = Math.ceil(maxAbs / 10) * 10;
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const xPos = (value) => pad.left + ((value + domain) / (domain * 2)) * plotWidth;
    const yPos = (value) => height - pad.bottom - ((value + domain) / (domain * 2)) * plotHeight;
    const ticks = [-domain, -domain / 2, 0, domain / 2, domain];
    const grid = ticks.map((tick) => {
      const x = xPos(tick);
      const y = yPos(tick);
      return `<line class="scatter-grid" x1="${x}" y1="${pad.top}" x2="${x}" y2="${height - pad.bottom}"/><line class="scatter-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"/><text class="scatter-tick" x="${x}" y="${height - 15}" text-anchor="middle">${formatNumber(tick, 0)}%</text><text class="scatter-tick" x="${pad.left - 9}" y="${y + 3}" text-anchor="end">${formatNumber(tick, 0)}%</text>`;
    }).join("");
    const points = paired.map((row) => {
      const x = xPos(row.depthPct * 100).toFixed(2);
      const y = yPos(row.chargePct * 100).toFixed(2);
      const radius = row.severity === "red" ? 5.5 : row.severity === "amber" ? 4.5 : 3.8;
      const selected = String(row.id) === String(state.selectedHoleId);
      const selectedRing = selected ? `<circle class="selection-ring" cx="${x}" cy="${y}" r="${radius + 5}"/>` : "";
      const tooltip = `Furo ${row.id} · profundidade ${formatPercent(row.depthPct)} · carga ${formatPercent(row.chargePct)}`;
      return `${selectedRing}<circle class="scatter-point scatter-point--${severityClass(row.severity)}${selected ? " scatter-point--selected" : ""}" cx="${x}" cy="${y}" r="${radius}" data-hole-id="${escapeHtml(row.id)}" data-chart-tooltip="${escapeHtml(tooltip)}" tabindex="0" role="button" aria-label="Furo ${escapeHtml(row.id)}, profundidade ${escapeHtml(formatPercent(row.depthPct))}, carga ${escapeHtml(formatPercent(row.chargePct))}"><title>${escapeHtml(tooltip)}</title></circle>`;
    }).join("");
    const zeroX = xPos(0);
    const zeroY = yPos(0);
     root.innerHTML = `<svg class="scatter-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Dispersão de ${paired.length} furos: desvio relativo de profundidade no eixo X e de carga no eixo Y"><rect x="0" y="0" width="${width}" height="${height}" fill="#fbfcfb"/>${grid}<line class="scatter-zero" x1="${zeroX}" y1="${pad.top}" x2="${zeroX}" y2="${height - pad.bottom}"/><line class="scatter-zero" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"/>${points}<text class="scatter-axis-label" x="${width - pad.right}" y="${height - 4}" text-anchor="end">Desvio de profundidade</text><text class="scatter-axis-label" x="${pad.left}" y="12">Desvio de carga</text></svg>`;
    root.querySelectorAll("[data-hole-id]").forEach((node) => {
      node.addEventListener("click", () => selectHole(node.dataset.holeId));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectHole(node.dataset.holeId); }
      });
    });
    bindChartTooltips(root);
     $("scatter-tag").textContent = `${formatInteger(paired.length)} pares completos`;
  }

  function renderWaterfall(rows) {
    const root = $("waterfall-chart");
    const total = rows.length;
    if (!total) {
      root.innerHTML = `<div class="empty-state">Sem furos no recorte.</div>`;
      $("waterfall-tag").textContent = "Sem dados";
      return;
    }
    const within = rows.filter((row) => row.severity === "green").length;
    const review = rows.filter((row) => row.severity === "amber").length;
    const high = rows.filter((row) => row.severity === "red").length;
    const exceptions = review + high;
    const steps = [
      { label: "Avaliados", amount: total, kind: "total", filter: "all" },
      { label: "Conformes", amount: -within, kind: "green", filter: "green" },
      { label: "Em revisão", amount: -review, kind: "amber", filter: "amber" },
      { label: "Fora da faixa", amount: -high, kind: "red", filter: "red" },
    ];
    const width = 600;
    const height = 235;
    const plotTop = 22;
    const plotBottom = 176;
    const plotHeight = plotBottom - plotTop;
    const barWidth = 70;
    const gap = 42;
    const xStart = 28;
    const yFor = (value) => plotBottom - (value / total) * plotHeight;
    let running = 0;
    const bars = steps.map((step, index) => {
      const previous = running;
      running += step.amount;
      const low = Math.min(previous, running);
      const high = Math.max(previous, running);
      const x = xStart + index * (barWidth + gap);
      const y = yFor(high);
      const h = Math.max(3, yFor(low) - y);
      const connector = index ? `<line class="waterfall-connector" x1="${x - gap}" y1="${yFor(previous)}" x2="${x}" y2="${yFor(previous)}"/>` : "";
      const label = step.amount < 0 ? `−${formatInteger(Math.abs(step.amount))}` : formatInteger(step.amount);
      const tooltip = `${step.label}: ${formatInteger(Math.abs(step.amount))} furos · clique para filtrar o detalhamento`;
      return `${connector}<rect class="waterfall-bar waterfall-bar--${step.kind}" x="${x}" y="${y}" width="${barWidth}" height="${h}" tabindex="0" role="button" data-status-filter="${step.filter}" data-chart-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}"><title>${escapeHtml(tooltip)}</title></rect><text class="waterfall-value" x="${x + barWidth / 2}" y="${Math.max(15, y - 7)}" text-anchor="middle">${escapeHtml(label)}</text><text class="waterfall-label" x="${x + barWidth / 2}" y="201" text-anchor="middle">${escapeHtml(step.label)}</text>`;
    }).join("");
    const remaining = formatInteger(running);
    root.innerHTML = `<svg class="waterfall-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribuição da conformidade: ${formatInteger(total)} furos avaliados e ${formatInteger(exceptions)} exceções"><line class="waterfall-axis" x1="18" y1="${plotBottom}" x2="${width - 18}" y2="${plotBottom}"/>${bars}<text class="waterfall-end" x="${width - 23}" y="${yFor(running) - 8}" text-anchor="end">Restante: ${remaining}</text></svg>`;
    root.querySelectorAll("[data-status-filter]").forEach((node) => {
      node.addEventListener("click", () => applyStatusFilter(node.dataset.statusFilter));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); applyStatusFilter(node.dataset.statusFilter); }
      });
    });
    bindChartTooltips(root);
    $("waterfall-tag").textContent = `${formatInteger(exceptions)} exceções`;
  }

  function renderProfile(hole) {
    if (!hole) {
      $("selected-hole").textContent = "Furo —";
      $("profile-illustration").innerHTML = `<div class="empty-state">Selecione um furo no mapa ou na tabela para consultar o perfil.</div>`;
      $("profile-data").innerHTML = "";
      return;
    }
    $("selected-hole").textContent = `Furo ${formatInteger(hole.id)}`;
    const total = Math.max(hole.depthActual || 0, hole.depthPlanned || 0, 1);
    const bodyY = 30;
    const bodyH = 292;
    const bodyX = 84;
    const bodyW = 68;
    const innerX = bodyX + 8;
    const innerW = bodyW - 16;
    const stemHeight = Number.isFinite(hole.stemmingActual) ? Math.min(bodyH * .42, Math.max(20, hole.stemmingActual / total * bodyH)) : 20;
    const subHeight = Number.isFinite(hole.subdrill) ? Math.min(bodyH * .18, Math.max(16, hole.subdrill / total * bodyH)) : 16;
    const chargeY = bodyY + stemHeight;
    const toeY = bodyY + bodyH - subHeight;
    const chargeH = Math.max(24, bodyY + bodyH - chargeY);
    const plannedH = Number.isFinite(hole.depthPlanned) ? Math.min(bodyH, Math.max(16, hole.depthPlanned / total * bodyH)) : bodyH;
    const cartridgeCount = Math.max(4, Math.min(8, Math.round(chargeH / 34)));
    const cartridgeLines = Array.from({ length: cartridgeCount - 1 }, (_, index) => {
      const y = chargeY + ((index + 1) * chargeH) / cartridgeCount;
      return `<line x1="${innerX}" y1="${y.toFixed(1)}" x2="${innerX + innerW}" y2="${y.toFixed(1)}" stroke="#8ab7c7" stroke-width=".8" opacity=".75"/>`;
    }).join("");
    const boosterH = Math.min(42, Math.max(24, chargeH * .18));
    const boosterY = chargeY + chargeH - boosterH * .82;
    const plannedY = bodyY + plannedH;
    $("profile-illustration").innerHTML = `
      <svg class="profile-svg" viewBox="0 0 236 360" role="img" aria-label="Perfil técnico do furo ${escapeHtml(hole.id)} com tampão, coluna explosiva, iniciador e subperfuração">
        <defs>
          <pattern id="profile-grid" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#d9e4e1" stroke-width=".6"/></pattern>
          <pattern id="profile-stem" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="#dfe6e4"/><path d="M-1 6 6-1M2 8 8 2" stroke="#aab9b7" stroke-width=".8"/></pattern>
          <pattern id="profile-subdrill" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="#34474e" fill-opacity=".22"/><path d="M-1 6 6-1M2 8 8 2" stroke="#4c5e65" stroke-width=".8" opacity=".8"/></pattern>
          <clipPath id="profile-hole-clip"><rect x="${innerX}" y="${bodyY}" width="${innerW}" height="${bodyH}"/></clipPath>
        </defs>
        <rect x="20" y="12" width="196" height="336" fill="url(#profile-grid)"/>
        <path d="M42 ${bodyY}H194" stroke="#9aa9a9" stroke-width="1.2"/>
        <path d="M42 ${toeY}H194" stroke="#9aa9a9" stroke-width="1.2" stroke-dasharray="2 3"/>
        <g clip-path="url(#profile-hole-clip)">
          <rect x="${innerX}" y="${bodyY}" width="${innerW}" height="${bodyH}" fill="#f7faf9"/>
          <rect x="${innerX}" y="${bodyY}" width="${innerW}" height="${stemHeight}" fill="url(#profile-stem)"/>
          <rect x="${innerX}" y="${chargeY}" width="${innerW}" height="${chargeH}" fill="#1767a6"/>
          <g>${cartridgeLines}</g>
          <rect x="${innerX}" y="${boosterY}" width="${innerW}" height="${boosterH}" fill="#df2338"/>
          <line x1="${innerX + 5}" y1="${boosterY + 5}" x2="${innerX + 5}" y2="${boosterY + boosterH - 5}" stroke="#ffb1ba" stroke-width="1.1"/>
          <rect x="${innerX}" y="${toeY}" width="${innerW}" height="${subHeight}" fill="url(#profile-subdrill)"/>
        </g>
        <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" fill="none" stroke="#1f2f38" stroke-width="1.5"/>
        <ellipse cx="${bodyX + bodyW / 2}" cy="${bodyY}" rx="${bodyW / 2}" ry="7" fill="#f7faf9" stroke="#1f2f38" stroke-width="1.4"/>
        <ellipse cx="${bodyX + bodyW / 2}" cy="${bodyY + bodyH}" rx="${bodyW / 2}" ry="7" fill="#4c5e65" stroke="#1f2f38" stroke-width="1.4"/>
        <path d="M${bodyX - 12} ${plannedY}h${bodyW + 24}" stroke="#0d62a8" stroke-width="1.2" stroke-dasharray="4 4"/>
        <path d="M${bodyX + bodyW + 14} ${bodyY}h16M${bodyX + bodyW + 22} ${bodyY}v${bodyH}M${bodyX + bodyW + 14} ${bodyY + bodyH}h16" stroke="#8b9b9d" stroke-width="1"/>
        <path d="M${bodyX - 27} ${bodyY}h16M${bodyX - 19} ${bodyY}v${stemHeight}M${bodyX - 27} ${chargeY}h16" stroke="#8b9b9d" stroke-width="1"/>
        <path d="M${bodyX + bodyW + 32} ${toeY}h14M${bodyX + bodyW + 39} ${toeY}v${subHeight}M${bodyX + bodyW + 32} ${bodyY + bodyH}h14" stroke="#8b9b9d" stroke-width="1"/>
      </svg>`;
     const rows = [
       ["Profundidade executada", withUnit(hole.depthActual, UNITS.depth), hole.depthDelta],
       ["Carga carregada", withUnit(hole.chargeActual, UNITS.charge), hole.chargeDelta],
       ["Tampão executado", withUnit(hole.stemmingActual, UNITS.stemming), hole.stemmingDelta],
       ["Subperfuração", withUnit(hole.subdrill, UNITS.depth), null],
       ["Tempo de iniciação", withUnit(hole.delay, UNITS.delay), null],
       ["Azimute / inclinação", `${formatNumber(hole.azimuth, 0)}° / ${formatNumber(hole.inclination, 0)}°`, null],
     ];
     $("profile-data").innerHTML = `<div class="profile-kicker">${escapeHtml(hole.statusLabel)} · ${escapeHtml(formatTypeLabel(hole.type))}</div>${rows.map(([label, value, delta]) => `<div class="profile-data-row"><span>${escapeHtml(label)}</span><strong class="${Number.isFinite(delta) && Math.abs(delta) > 0.0001 ? "is-alert" : ""}">${escapeHtml(value)}${Number.isFinite(delta) ? ` <small>(${escapeHtml(formatSigned(delta))})</small>` : ""}</strong></div>`).join("")}`;
  }

  function renderCompare(summary) {
    const metrics = [
      ["Profundidade", summary.depthPlanned, summary.depthActual],
      ["Carga", summary.chargePlanned, summary.chargeActual],
      ["Tampão", summary.stemmingPlanned, summary.stemmingActual],
    ];
    $("compare-chart").innerHTML = metrics.map(([label, planned, actual]) => {
      const maximum = Math.max(planned || 0, actual || 0, 1);
      const displayUnit = label === "Carga" ? UNITS.charge : label === "Tampão" ? UNITS.stemming : UNITS.depth;
      const plannedWidth = Number.isFinite(planned) ? Math.max(2, (planned / maximum) * 100) : 2;
      const actualWidth = Number.isFinite(actual) ? Math.max(2, (actual / maximum) * 100) : 2;
      const delta = Number.isFinite(planned) && planned !== 0 && Number.isFinite(actual) ? (actual - planned) / Math.abs(planned) : null;
      const tooltip = `${label}: planejado ${withUnit(planned, displayUnit)} · executado ${withUnit(actual, displayUnit)} · desvio ${formatPercent(delta)}`;
      return `<div class="compare-row" tabindex="0" role="group" aria-label="${escapeHtml(tooltip)}" data-chart-tooltip="${escapeHtml(tooltip)}"><span class="compare-label">${escapeHtml(label)}</span><div class="compare-track"><span class="compare-bar compare-bar--planned" style="width:${plannedWidth}%"></span><span class="compare-bar compare-bar--actual" style="width:${actualWidth}%"></span></div><span class="compare-value">${withUnit(actual, displayUnit)}<small>${formatPercent(delta)}</small></span></div>`;
    }).join("");
    bindChartTooltips($("compare-chart"));
  }

  function renderRanking(rows) {
    const ranked = rows.filter((row) => row.primary).slice().sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 7);
    const exceptionCount = rows.filter((row) => row.severity !== "green").length;
    $("ranking-tag").textContent = `${formatInteger(exceptionCount)} exceções · ${formatInteger(ranked.length)} principais`;
    if (!ranked.length) {
       $("ranking-list").innerHTML = `<div class="empty-state">Nenhum registro fora das faixas configuradas.</div>`;
      return;
    }
    const maximum = Math.max(...ranked.map((row) => row.score), 1);
    $("ranking-list").innerHTML = ranked.map((row) => {
      const metric = row.primary;
      const deltaUnit = metric.label === "Carga" ? UNITS.charge : metric.label === "Tampão" ? UNITS.stemming : UNITS.depth;
      const fillClass = row.severity === "red" ? "ranking-fill--red" : "";
       const metricText = metric.label === "Sem referência" ? "Referência ausente" : metric.label === "Não avaliável" ? "Não avaliável" : `${metric.label} · ${formatPercent(metric.relative)}`;
       const deltaText = Number.isFinite(metric.delta) ? formatSigned(metric.delta, deltaUnit) : "N/D";
       return `<button class="ranking-item ranking-button" type="button" data-hole-id="${escapeHtml(row.id)}" aria-label="Furo ${escapeHtml(row.id)}: ${escapeHtml(metricText)}, desvio ${escapeHtml(deltaText)}"><span class="ranking-hole">${escapeHtml(row.id)}</span><span class="ranking-metric">${escapeHtml(metricText)}</span><span class="ranking-track"><span class="ranking-fill ${fillClass}" style="width:${Math.min(100, (row.score / maximum) * 100)}%"></span></span><span class="ranking-delta">${escapeHtml(deltaText)}</span></button>`;
    }).join("");
    $("ranking-list").querySelectorAll("[data-hole-id]").forEach((node) => node.addEventListener("click", () => selectHole(node.dataset.holeId)));
  }

  function renderTiming(rows, summary) {
    if (!summary.delays.length || summary.delayMin === summary.delayMax) {
       $("timing-chart").innerHTML = `<div class="empty-state">A fonte não apresenta variação nos tempos de iniciação neste recorte.</div>`;
      $("timing-tag").textContent = summary.delays.length ? `${formatInteger(summary.delayMin)} ms` : "Sem dados";
      return;
    }
    const min = summary.delayMin;
    const max = summary.delayMax;
    const span = max - min;
    const position = (value) => `${Math.max(0, Math.min(100, ((value - min) / span) * 100))}%`;
    const dots = rows.filter((row) => Number.isFinite(row.delay)).sort((a, b) => a.delay - b.delay).filter((row, index) => index % Math.max(1, Math.ceil(rows.length / 70)) === 0).map((row) => {
      const tooltip = `Furo ${row.id} · ${formatInteger(row.delay)} ms · ${row.statusLabel}`;
      return `<span class="timing-dot ${row.severity === "red" ? "timing-dot--focus" : ""}" style="left:${position(row.delay)}; bottom:${row.severity === "red" ? "69px" : "57px"}" data-hole-id="${escapeHtml(row.id)}" data-chart-tooltip="${escapeHtml(tooltip)}" tabindex="0" role="button" aria-label="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}"></span>`;
    }).join("");
    const medianPosition = position(summary.delayMedian);
    $("timing-chart").innerHTML = `<div class="timing-band"></div><div class="timing-axis"></div>${dots}<span class="timing-median" style="left:calc(15px + ${medianPosition} * (100% - 30px))"></span><span class="timing-median-label" style="left:calc(15px + ${medianPosition} * (100% - 30px))">Mediana ${formatInteger(summary.delayMedian)} ms</span><span class="timing-tick" style="left:15px">${formatInteger(min)}</span><span class="timing-tick" style="left:50%">${formatInteger(min + span / 2)}</span><span class="timing-tick" style="right:0; transform:none">${formatInteger(max)}</span>`;
    $("timing-chart").querySelectorAll("[data-hole-id]").forEach((node) => {
      node.addEventListener("click", () => selectHole(node.dataset.holeId));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectHole(node.dataset.holeId); }
      });
    });
    bindChartTooltips($("timing-chart"));
    $("timing-tag").textContent = `${formatInteger(summary.delayMin)}–${formatInteger(summary.delayMax)} ms`;
  }

  function renderTable(rows) {
    const sorted = rows.slice().sort((a, b) => b.score - a.score || a.id - b.id);
    const visible = sorted.slice(0, 15);
    if (!visible.length) {
      $("holes-table-body").innerHTML = `<tr><td colspan="8"><div class="empty-state">Nenhum furo corresponde ao filtro atual.</div></td></tr>`;
      $("table-footer").textContent = "Sem registros no recorte";
      return;
    }
     $("holes-table-body").innerHTML = visible.map((row) => `<tr><td data-label="ID do furo"><button class="table-hole-button" type="button" data-hole-id="${escapeHtml(row.id)}">${escapeHtml(row.id)}</button></td><td data-label="Conformidade"><span class="status-pill status-pill--${severityClass(row.severity)}">${escapeHtml(row.statusLabel)}</span></td><td data-label="Profundidade planejada">${withUnit(row.depthPlanned, UNITS.depth)}</td><td data-label="Profundidade executada">${withUnit(row.depthActual, UNITS.depth)}</td><td data-label="Carga planejada">${withUnit(row.chargePlanned, UNITS.charge)}</td><td data-label="Carga carregada">${withUnit(row.chargeActual, UNITS.charge)}</td><td data-label="Tampão executado">${withUnit(row.stemmingActual, UNITS.stemming)}</td><td data-label="Tempo de iniciação">${withUnit(row.delay, UNITS.delay)}</td></tr>`).join("");
    $("holes-table-body").querySelectorAll("[data-hole-id]").forEach((node) => node.addEventListener("click", () => selectHole(node.dataset.holeId)));
    const statusSuffix = state.statusFilter === "all" ? "" : ` · filtro: ${statusFilterLabels[state.statusFilter]}`;
    $("table-footer").textContent = `Exibindo ${formatInteger(visible.length)} de ${formatInteger(rows.length)} furos · ordenado pela prioridade de verificação${statusSuffix}`;
  }

  function renderAll() {
    if (!state.dataset) return;
    hideChartTooltip();
    const rows = getVisibleRows();
    state.filtered = rows;
    const summary = summarize(rows);
    const currentExists = rows.some((row) => String(row.id) === String(state.selectedHoleId));
    if (!currentExists) state.selectedHoleId = rows[0]?.id ?? null;
    const selected = rows.find((row) => String(row.id) === String(state.selectedHoleId)) || rows[0] || null;
    state.selectedHoleId = selected?.id ?? null;
    renderHero(summary);
    renderKpis(summary);
    renderMap(rows);
    renderProfile(selected);
    renderScatter(rows);
    renderWaterfall(rows);
    renderCompare(summary);
    renderRanking(rows);
    renderTiming(rows, summary);
    renderTable(rows);
  }

  function selectHole(id) {
    const row = state.filtered.find((hole) => String(hole.id) === String(id)) || state.dataset?.holes.find((hole) => String(hole.id) === String(id));
    if (!row) return;
    state.selectedHoleId = row.id;
    renderAll();
    $("selected-hole").focus({ preventScroll: true });
  }

  function appendParams(url, params) {
    const target = new URL(url, window.location.href);
    Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
    return target.toString();
  }

  function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = `__qaqc_jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const cleanup = () => { delete window[callback]; script.remove(); };
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Tempo esgotado ao acessar a fonte Drive.")); }, 15000);
      window[callback] = (value) => { window.clearTimeout(timeout); cleanup(); resolve(value); };
      script.onerror = () => { window.clearTimeout(timeout); cleanup(); reject(new Error("Não foi possível acessar o endpoint Drive.")); };
      script.src = appendParams(url, { callback });
      document.head.appendChild(script);
    });
  }

  async function fetchJson(url, params = {}) {
    const target = appendParams(url, { ...params, t: Date.now() });
    try {
      const response = await fetch(target, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      const payload = JSON.parse(body);
      if (payload.ok === false) throw new Error(payload.error || "A fonte devolveu um erro de leitura.");
      return payload;
    } catch (error) {
      return fetchJsonp(target);
    }
  }

  function base64ToBytes(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function workbookToPayload(arrayBuffer, meta = {}) {
    if (!window.XLSX) throw new Error("Leitor XLSX indisponível no site.");
    const workbook = window.XLSX.read(arrayBuffer, { type: "array", cellDates: false });
    const sheets = {};
    workbook.SheetNames.forEach((name) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: true });
      sheets[name] = { headers: rows[0] || [], rows: rows.slice(1) };
    });
    return { meta, sheets };
  }

  async function fetchRemoteFile(endpoint, file) {
    if (file.url) {
      const response = await fetch(appendParams(file.url, { t: Date.now() }), { cache: "no-store" });
      if (!response.ok) throw new Error(`Download indisponível (HTTP ${response.status}).`);
      return workbookToPayload(await response.arrayBuffer(), file);
    }
    const payload = await fetchJson(endpoint, { action: "download", id: file.id });
    if (!payload.base64) throw new Error("A fonte não retornou o conteúdo da planilha.");
    return workbookToPayload(base64ToBytes(payload.base64), file);
  }

  async function loadCombinedFiles(endpoint, files) {
    const payloads = await Promise.all(files.map((file) => fetchRemoteFile(endpoint, file)));
    return combineDatasets(payloads.map((payload, index) => buildDataset(payload, files[index])));
  }

  async function loadSample(reason = "Fonte local") {
    const response = await fetch(appendParams(CONFIG.sampleUrl || "data/sample.json", { t: Date.now() }), { cache: "no-store" });
    if (!response.ok) throw new Error("Fonte local indisponível.");
    const payload = await response.json();
    state.dataset = buildDataset(payload, { name: payload.meta?.sourceFile || "data/sample.json" });
      state.sourceKind = reason.startsWith("Falha") ? "error" : "local";
    state.sourceLabel = reason;
    state.selectedFileId = "";
    populateFilters();
    renderSourceUi();
    renderAll();
  }

  async function loadSource(preferredFileId = "") {
    if (state.loading) return;
    state.loading = true;
    const hadDatasetAtStart = Boolean(state.dataset);
    const previousSourceKind = state.sourceKind;
    $("refresh-data").disabled = true;
    try {
      const endpointFromQuery = new URLSearchParams(window.location.search).get("drive");
      const endpoint = endpointFromQuery || CONFIG.driveIndexUrl || "";
      state.driveEndpoint = endpoint;
      if (!endpoint) {
        state.syncing = false;
        await loadSample("Fonte local");
        return;
      }

      state.syncing = true;
      renderSourceUi();
      // Render the bundled fixture first so a slow Apps Script response never
      // leaves the dashboard empty. The remote dataset replaces it as soon as
      // the Drive listing and workbooks are available.
      let bootstrapRendered = false;
      if (!state.dataset) {
        try {
          await loadSample("Fonte local · sincronizando Drive");
          bootstrapRendered = true;
          state.syncing = true;
          renderSourceUi();
        } catch {
          // The remote source is still attempted; the catch block below will
          // provide the final error state if both sources are unavailable.
        }
      }
      const listing = await fetchJson(endpoint);
      state.sourceFiles = Array.isArray(listing.files) ? listing.files : [];
      if (!state.sourceFiles.length) {
        if (!state.dataset) await loadSample("Drive conectado · nenhuma planilha encontrada");
        state.sourceKind = bootstrapRendered ? "error" : "remote";
        state.sourceLabel = bootstrapRendered
          ? "Drive conectado · nenhuma planilha encontrada · fonte local"
          : "Drive conectado · nenhuma planilha encontrada";
        state.syncing = false;
        renderSourceUi();
        return;
      }
      const shouldCombine = state.sourceFiles.length > 1 && (preferredFileId === "all" || !preferredFileId);
      if (shouldCombine) {
        state.selectedFileId = "all";
        state.dataset = await loadCombinedFiles(endpoint, state.sourceFiles);
        state.sourceKind = "remote";
        state.sourceLabel = `${state.sourceFiles.length} arquivos Drive · ${formatInteger(state.dataset.holes.length)} furos`;
      } else {
        const file = state.sourceFiles.find((item) => item.id === preferredFileId) || state.sourceFiles[0];
        state.selectedFileId = file.id;
        const payload = await fetchRemoteFile(endpoint, file);
        state.dataset = buildDataset(payload, file);
        state.sourceKind = "remote";
        state.sourceLabel = `${file.name} · ${formatBytes(file.size)}`;
      }
      populateFilters();
      state.syncing = false;
      renderSourceUi();
      renderAll();
      showToast(shouldCombine ? `Planilhas atualizadas: ${state.sourceFiles.length}` : `Planilha atualizada: ${state.dataset.meta.sourceFile}`);
    } catch (error) {
      const canKeepVisibleData = hadDatasetAtStart || Boolean(state.dataset);
      if (canKeepVisibleData) {
        state.sourceKind = "error";
        state.sourceLabel = previousSourceKind === "remote"
          ? "Falha na atualização · dados anteriores mantidos"
          : "Falha na fonte · fonte local mantida";
        state.syncing = false;
        renderSourceUi();
        showToast(`${error.message || "Fonte Drive indisponível."} Dados visíveis foram mantidos.`, true);
      } else {
        state.sourceFiles = [];
        try {
          await loadSample("Falha na fonte · usando fonte local");
        } catch {
          state.sourceKind = "error";
          state.sourceLabel = "Falha ao carregar as fontes";
          state.syncing = false;
          renderSourceUi();
        }
        showToast(error.message || "Fonte indisponível; fonte local carregada.", true);
      }
    } finally {
      state.loading = false;
      state.syncing = false;
      $("refresh-data").disabled = false;
      if (state.sourceKind !== "remote") renderSourceUi();
    }
  }

  function formatBytes(value) {
    const bytes = toNumber(value);
    if (!Number.isFinite(bytes)) return "tamanho não disponível";
    if (bytes < 1024) return `${formatInteger(bytes)} B`;
    if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
    return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
  }

  let toastTimer;
  function showToast(message, isError = false) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
  }

  function bindEvents() {
    $("refresh-data").addEventListener("click", () => loadSource(state.selectedFileId));
    ["plan-filter", "type-filter", "date-filter"].forEach((id) => $(id).addEventListener("change", renderAll));
    $("hole-search").addEventListener("input", renderAll);
    $("clear-filters").addEventListener("click", () => {
      ["plan-filter", "type-filter", "date-filter"].forEach((id) => { $(id).value = "all"; });
      $("hole-search").value = "";
      state.statusFilter = "all";
      renderAll();
    });
    $("file-select").addEventListener("change", (event) => loadSource(event.target.value));
    $("selected-hole").addEventListener("click", () => {
      const row = state.dataset?.holes.find((hole) => String(hole.id) === String(state.selectedHoleId));
      if (row) showToast(`Furo ${row.id} · ${row.statusLabel}`);
    });
  }

  renderHeroGraphic();
  bindEvents();
  loadSource();
  window.setInterval(() => { if (state.driveEndpoint && !document.hidden) loadSource(state.selectedFileId); }, Number(CONFIG.refreshMs) || 300000);
})();
