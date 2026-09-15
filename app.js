(() => {
  "use strict";

  const CONFIG = window.QAQC_CONFIG || {};
  const UNITS = CONFIG.units || { depth: "", charge: "unid. fonte", stemming: "", diameter: "unid. fonte", delay: "ms" };
  const state = {
    dataset: null,
    sourceFiles: [],
    driveEndpoint: "",
    selectedFileId: "",
    selectedHoleId: null,
    filtered: [],
    loading: false,
    sourceKind: "local",
    sourceLabel: "Base local de referência",
  };

  const $ = (id) => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const integerFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "always" });

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
    if (!Number.isFinite(value)) return "n.a.";
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
  }

  function formatInteger(value) {
    return Number.isFinite(value) ? integerFormat.format(value) : "n.a.";
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? percentFormat.format(value * 100) + "%" : "n.a.";
  }

  function formatDate(value) {
    const text = String(value ?? "").trim();
    if (!text) return "n.a.";
    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (!match) return text;
    return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}`;
  }

  function dateKey(value) {
    return formatDate(value);
  }

  function formatSigned(value, unit = "") {
    if (!Number.isFinite(value)) return "n.a.";
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
  }

  function withUnit(value, unit) {
    return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
  }

  function average(rows, field) {
    const values = rows.map((row) => row[field]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
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

  function makeFlag(label, delta, base, tolerance) {
    if (!Number.isFinite(delta) || !Number.isFinite(base) || Math.abs(base) < 0.000001) return null;
    const relative = delta / Math.abs(base);
    const score = Math.abs(relative) / tolerance;
    return { label, delta, relative, score, tolerance };
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
      makeFlag("Tampão", stemmingDelta, stemmingPlanned, 0.50),
    ].filter(Boolean);
    const baselineMissing = [depthPlanned, chargePlanned, stemmingPlanned].some((value) => Number.isFinite(value) && value === 0);
    const score = Math.max(flags.reduce((max, flag) => Math.max(max, flag.score), 0), baselineMissing ? 1 : 0);
    const primary = flags.slice().sort((a, b) => b.score - a.score)[0] || null;
    const severity = baselineMissing ? "amber" : score >= 2 ? "red" : score >= 1 ? "amber" : "green";

    return {
      rawIndex,
      id: toNumber(read(["id", "furo", "numero do furo", "n do furo"])),
      plan: String(read(["plano", "plan"]) ?? "n.a.").trim(),
      type: String(read(["tipo", "type"]) ?? "n.a.").trim(),
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
      primary: primary || (baselineMissing ? { label: "Sem previsto", delta: null, relative: null, score: 1, tolerance: null } : null),
      baselineMissing,
      severity,
      statusLabel: baselineMissing ? "Sem previsto" : severity === "red" ? "Desvio alto" : severity === "amber" ? "Revisar" : "Dentro da faixa",
    };
  }

  function buildDataset(payload, fileMeta = {}) {
    const entries = getSheetEntries(payload);
    const holeEntry = findHoleSheet(entries);
    if (!holeEntry) throw new Error("A fonte não possui uma aba com ID e profundidade realizada.");
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
        sourceName: fileMeta.name || payload.meta?.sourceFile || "Base local",
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
    if (!holes.length) throw new Error("A fonte foi lida, mas não há linhas válidas de furos.");
    return {
      holes,
      summary,
      headers,
      meta: { ...(payload.meta || {}), ...fileMeta, sourceFile: fileMeta.name || payload.meta?.sourceFile || "Fonte desconhecida" },
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
    const depthPlanned = average(rows, "depthPlanned");
    const depthActual = average(rows, "depthActual");
    const chargePlanned = average(rows, "chargePlanned");
    const chargeActual = average(rows, "chargeActual");
    const stemmingPlanned = average(rows, "stemmingPlanned");
    const stemmingActual = average(rows, "stemmingActual");
    const delays = rows.map((row) => row.delay).filter(Number.isFinite);
    const depthDelta = Number.isFinite(depthPlanned) && Number.isFinite(depthActual) ? depthActual - depthPlanned : null;
    const chargeDelta = Number.isFinite(chargePlanned) && Number.isFinite(chargeActual) ? chargeActual - chargePlanned : null;
    const stemmingDelta = Number.isFinite(stemmingPlanned) && Number.isFinite(stemmingActual) ? stemmingActual - stemmingPlanned : null;
    return {
      count: rows.length,
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
      baselineMissing: rows.filter((row) => row.baselineMissing).length,
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
      const matchesQuery = !query || String(row.id).toLowerCase().includes(query);
      return matchesPlan && matchesType && matchesDate && matchesQuery;
    });
  }

  function setSelectOptions(select, values, allLabel) {
    const current = select.value;
    select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (["all", ...values].includes(current)) select.value = current;
  }

  function populateFilters() {
    const holes = state.dataset?.holes || [];
    setSelectOptions($("plan-filter"), [...new Set(holes.map((row) => row.plan))].sort(), "Todos os planos");
    setSelectOptions($("type-filter"), [...new Set(holes.map((row) => row.type))].sort(), "Todos os tipos");
    setSelectOptions($("date-filter"), [...new Set(holes.map((row) => dateKey(row.date)))].sort(), "Todas as datas");
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
        <rect x="12" y="12" width="626" height="156" rx="8" fill="url(#hero-grid)"/>
        <path d="M32 136h586M32 94h586M32 52h586" stroke="#ffffff" stroke-opacity=".14" stroke-dasharray="2 8"/>
        <path d="M32 138C120 130 179 143 259 130S415 135 618 115" fill="none" stroke="#2cabb6" stroke-width="2" stroke-opacity=".7"/>
        <g>${circles}</g>
        <g fill="#d0ddda" font-family="monospace" font-size="9"><text x="32" y="158">EIXO X / COORDENADA</text><text x="517" y="31">QAQC / CAMPO</text></g>
      </svg>`;
  }

  function renderSourceUi() {
    const select = $("file-select");
    const allOption = state.sourceFiles.length > 1 ? `<option value="all">Todos os arquivos (${state.sourceFiles.length})</option>` : "";
    select.innerHTML = state.sourceFiles.length
      ? allOption + state.sourceFiles.map((file) => `<option value="${escapeHtml(file.id)}">${escapeHtml(file.name)}</option>`).join("")
      : `<option value="local">Base local de referência</option>`;
    select.disabled = !state.sourceFiles.length;
    if (state.selectedFileId === "all" && state.sourceFiles.length > 1) select.value = "all";
    else if (state.selectedFileId && state.sourceFiles.some((file) => file.id === state.selectedFileId)) select.value = state.selectedFileId;
    const markClass = state.sourceKind === "remote" ? "status-mark--remote" : state.sourceKind === "error" ? "status-mark--warn" : "status-mark--local";
    $("source-status").innerHTML = `<span class="status-mark ${markClass}" aria-hidden="true"></span><span>${escapeHtml(state.sourceLabel)}</span>`;
    $("top-status").textContent = state.sourceKind === "remote" ? "Fonte Drive conectada" : state.sourceKind === "error" ? "Fonte com fallback" : "Base local de referência";
  }

  function renderHero(summary) {
    const candidates = [
      { key: "profundidade", delta: summary.depthDelta, pct: summary.depthPct, unit: UNITS.depth, label: "profundidade", article: "A" },
      { key: "carga", delta: summary.chargeDelta, pct: summary.chargePct, unit: UNITS.charge, label: "carga", article: "A" },
      { key: "tampão", delta: summary.stemmingDelta, pct: summary.stemmingPlanned ? summary.stemmingDelta / Math.abs(summary.stemmingPlanned) : null, unit: UNITS.stemming, label: "tampão", article: "O" },
    ].filter((item) => Number.isFinite(item.pct));
    const lead = candidates.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
    if (lead && Math.abs(lead.pct) >= 0.02) {
      $("hero-title").innerHTML = `A execução mudou<br><em>em ${escapeHtml(lead.label)}.</em>`;
      const direction = lead.delta < 0 ? "abaixo" : "acima";
      const unitText = lead.unit ? ` ${lead.unit}` : "";
      const noun = lead.label === "tampão" ? "médio" : "média";
      $("hero-story").textContent = `${lead.article} ${lead.label} ${noun} ficou ${formatNumber(Math.abs(lead.delta))}${unitText} ${direction} do previsto. Use o mapa para encontrar os furos que puxam a diferença.`;
    } else {
      $("hero-title").innerHTML = `A execução acompanha<br><em>o plano.</em>`;
      $("hero-story").textContent = "As médias do recorte estão próximas do previsto. O ranking abaixo mostra as exceções que merecem conferência em campo.";
    }
    $("hero-plan").textContent = summary.plans.length ? `Plano ${summary.plans.join(", ")}` : "Plano n.a.";
    $("hero-date").textContent = summary.dates.length ? summary.dates.join(", ") : "Data n.a.";
    $("hero-count").textContent = `${formatInteger(summary.count)} furos`;
  }

  function renderKpis(summary) {
    $("kpi-holes").textContent = formatInteger(summary.count);
    $("kpi-holes-foot").textContent = summary.flagged ? `${formatInteger(summary.flagged)} pontos para revisar` : "Nenhum ponto para revisar";
    $("kpi-depth").textContent = withUnit(summary.depthActual, UNITS.depth);
    $("kpi-depth-foot").textContent = `prev. ${withUnit(summary.depthPlanned, UNITS.depth)} · ${formatPercent(summary.depthPct)}`;
    $("kpi-charge").textContent = withUnit(summary.chargeActual, UNITS.charge);
    $("kpi-charge-foot").textContent = `prev. ${withUnit(summary.chargePlanned, UNITS.charge)} · ${formatPercent(summary.chargePct)}`;
    $("kpi-attention").textContent = formatInteger(summary.flagged);
    $("kpi-attention-foot").textContent = summary.baselineMissing ? `${formatInteger(summary.baselineMissing)} sem previsto` : summary.critical ? `${formatInteger(summary.critical)} com desvio alto` : "triagem visual";
  }

  function severityClass(severity) {
    return severity === "red" ? "red" : severity === "amber" ? "amber" : "green";
  }

  function renderMap(rows) {
    const mapRoot = $("hole-map");
    const coordinateRows = rows.filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y));
    if (!coordinateRows.length) {
      mapRoot.innerHTML = `<div class="empty-state">A fonte não tem coordenadas X/Y válidas para esta seleção.</div>`;
      return;
    }
    const width = 840;
    const height = 408;
    const pad = { left: 58, right: 26, top: 26, bottom: 44 };
    const minX = Math.min(...coordinateRows.map((row) => row.x));
    const maxX = Math.max(...coordinateRows.map((row) => row.x));
    const minY = Math.min(...coordinateRows.map((row) => row.y));
    const maxY = Math.max(...coordinateRows.map((row) => row.y));
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const xPos = (value) => pad.left + ((value - minX) / spanX) * (width - pad.left - pad.right);
    const yPos = (value) => height - pad.bottom - ((value - minY) / spanY) * (height - pad.top - pad.bottom);
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
      return `${selectedRing}<circle class="hole-point hole-point--${severityClass(row.severity)}${selected ? " hole-point--selected" : ""}" cx="${x}" cy="${y}" r="${radius}" data-hole-id="${escapeHtml(row.id)}" tabindex="0" role="button" aria-label="Furo ${escapeHtml(row.id)}, ${escapeHtml(row.statusLabel)}"><title>Furo ${escapeHtml(row.id)} · ${escapeHtml(row.statusLabel)} · ${escapeHtml(row.primary?.label || "sem desvio principal")}</title></circle>`;
    }).join("");
    const labelX = [0, .5, 1].map((fraction) => `<text class="plot-label" x="${pad.left + fraction * (width - pad.left - pad.right)}" y="${height - 14}" text-anchor="middle">${formatNumber(minX + fraction * spanX, 1)}</text>`).join("");
    const labelY = [0, .5, 1].map((fraction) => `<text class="plot-label" x="16" y="${height - pad.bottom - fraction * (height - pad.top - pad.bottom) + 3}">${formatNumber(minY + fraction * spanY, 1)}</text>`).join("");
    mapRoot.innerHTML = `<svg class="map-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mapa de ${coordinateRows.length} furos por coordenadas X e Y"><rect x="0" y="0" width="${width}" height="${height}" fill="#f5f8f7"/>${grid}<line class="plot-axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"/><line class="plot-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"/>${points}${labelX}${labelY}<text class="plot-label" x="${width - 26}" y="${height - 14}" text-anchor="end">X</text><text class="plot-label" x="18" y="${pad.top - 8}">Y</text></svg>`;
    mapRoot.querySelectorAll("[data-hole-id]").forEach((node) => {
      node.addEventListener("click", () => selectHole(node.dataset.holeId));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectHole(node.dataset.holeId); }
      });
    });
    $("map-tag").textContent = `${formatInteger(coordinateRows.length)} pontos`;
  }

  function renderProfile(hole) {
    if (!hole) {
      $("selected-hole").textContent = "Furo —";
      $("profile-illustration").innerHTML = `<div class="empty-state">Selecione um furo no mapa ou na tabela.</div>`;
      $("profile-data").innerHTML = "";
      return;
    }
    $("selected-hole").textContent = `Furo ${formatInteger(hole.id)}`;
    const total = Math.max(hole.depthActual || 0, hole.depthPlanned || 0, 1);
    const bodyY = 28;
    const bodyH = 292;
    const bodyX = 50;
    const bodyW = 58;
    const stemHeight = Math.min(bodyH * .45, Math.max(16, (hole.stemmingActual || 0) / total * bodyH));
    const subHeight = Math.min(bodyH * .18, Math.max(12, (hole.subdrill || 0) / total * bodyH));
    const chargeY = bodyY + stemHeight;
    const chargeH = Math.max(24, bodyH - stemHeight - subHeight);
    const plannedH = Math.min(bodyH, Math.max(16, (hole.depthPlanned || total) / total * bodyH));
    const alertStroke = hole.severity === "green" ? "#238a6e" : hole.severity === "amber" ? "#d99527" : "#ed1b2f";
    $("profile-illustration").innerHTML = `
      <svg class="profile-svg" viewBox="0 0 170 350" role="img" aria-label="Perfil esquemático do furo ${escapeHtml(hole.id)}">
        <defs><pattern id="profile-grid" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#d9e4e1" stroke-width=".6"/></pattern><linearGradient id="charge-gradient" x1="0" x2="1"><stop offset="0" stop-color="#f08c2b"/><stop offset="1" stop-color="#ed1b2f"/></linearGradient></defs>
        <rect x="4" y="5" width="162" height="340" rx="7" fill="url(#profile-grid)"/>
        <text x="12" y="20" fill="#0d62a8" font-family="monospace" font-size="8">FURO ${escapeHtml(hole.id)}</text>
        <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="${bodyW / 2}" fill="#f7faf9" stroke="#1f2f38" stroke-width="1.5"/>
        <rect x="${bodyX + 3}" y="${bodyY + 3}" width="${bodyW - 6}" height="${Math.max(plannedH - 6, 12)}" rx="${(bodyW - 6) / 2}" fill="none" stroke="#0d62a8" stroke-width="1.5" stroke-dasharray="4 4"/>
        <rect x="${bodyX + 6}" y="${bodyY + 5}" width="${bodyW - 12}" height="${Math.max(stemHeight - 5, 9)}" fill="#dfe6e4"/>
        <rect x="${bodyX + 6}" y="${chargeY}" width="${bodyW - 12}" height="${chargeH}" fill="url(#charge-gradient)" opacity=".86"/>
        <rect x="${bodyX + 6}" y="${bodyY + bodyH - subHeight}" width="${bodyW - 12}" height="${subHeight}" fill="#52656b" opacity=".9"/>
        <path d="M${bodyX + bodyW + 9} ${bodyY}h12M${bodyX + bodyW + 15} ${bodyY}v${bodyH}M${bodyX + bodyW + 9} ${bodyY + bodyH}h12" stroke="#8b9b9d" stroke-width="1"/>
        <text x="${bodyX + bodyW + 22}" y="${bodyY + bodyH / 2}" fill="#607376" font-family="monospace" font-size="8" transform="rotate(90 ${bodyX + bodyW + 22} ${bodyY + bodyH / 2})">${withUnit(hole.depthActual, UNITS.depth)} real.</text>
        <path d="M${bodyX - 5} ${chargeY}H22" stroke="${alertStroke}" stroke-width="1.4"/><text x="8" y="${chargeY - 4}" fill="${alertStroke}" font-family="monospace" font-size="8">carga</text>
        <path d="M${bodyX - 5} ${bodyY + stemHeight / 2}H22" stroke="#6c7b7e" stroke-width="1"/><text x="8" y="${bodyY + stemHeight / 2 - 4}" fill="#6c7b7e" font-family="monospace" font-size="8">tampão</text>
        <text x="12" y="332" fill="#809392" font-family="monospace" font-size="8">linha azul = previsto</text>
      </svg>`;
    const rows = [
      ["Profundidade", withUnit(hole.depthActual, UNITS.depth), hole.depthDelta],
      ["Carga realizada", withUnit(hole.chargeActual, UNITS.charge), hole.chargeDelta],
      ["Tampão realizado", withUnit(hole.stemmingActual, UNITS.stemming), hole.stemmingDelta],
      ["Tempo de detonação", `${formatInteger(hole.delay)} ${UNITS.delay}`, null],
      ["Azimute / inclinação", `${formatNumber(hole.azimuth, 0)}° / ${formatNumber(hole.inclination, 0)}°`, null],
    ];
    $("profile-data").innerHTML = `<div class="profile-kicker">${escapeHtml(hole.statusLabel)} · ${escapeHtml(hole.type)}</div>${rows.map(([label, value, delta]) => `<div class="profile-data-row"><span>${escapeHtml(label)}</span><strong class="${Number.isFinite(delta) && Math.abs(delta) > 0.0001 ? "is-alert" : ""}">${escapeHtml(value)}${Number.isFinite(delta) ? ` <small>(${escapeHtml(formatSigned(delta))})</small>` : ""}</strong></div>`).join("")}`;
  }

  function renderCompare(summary) {
    const metrics = [
      ["Profundidade", summary.depthPlanned, summary.depthActual, "m"],
      ["Carga", summary.chargePlanned, summary.chargeActual, "kg"],
      ["Tampão", summary.stemmingPlanned, summary.stemmingActual, "m"],
    ];
    $("compare-chart").innerHTML = metrics.map(([label, planned, actual, unit]) => {
      const maximum = Math.max(planned || 0, actual || 0, 1);
      const displayUnit = label === "Carga" ? UNITS.charge : label === "Tampão" ? UNITS.stemming : UNITS.depth;
      return `<div class="compare-row"><span class="compare-label">${escapeHtml(label)}</span><div class="compare-track"><span class="compare-bar compare-bar--planned" style="width:${Math.max(2, (planned / maximum) * 100)}%"></span><span class="compare-bar compare-bar--actual" style="width:${Math.max(2, (actual / maximum) * 100)}%"></span></div><span class="compare-value">${withUnit(actual, displayUnit)}<small>${formatPercent(planned ? (actual - planned) / Math.abs(planned) : null)}</small></span></div>`;
    }).join("");
  }

  function renderRanking(rows) {
    const ranked = rows.filter((row) => row.primary).slice().sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 7);
    $("ranking-tag").textContent = `${formatInteger(rows.filter((row) => row.severity !== "green").length)} exceções`;
    if (!ranked.length) {
      $("ranking-list").innerHTML = `<div class="empty-state">Nenhum desvio acima das faixas visuais.</div>`;
      return;
    }
    const maximum = Math.max(...ranked.map((row) => row.score), 1);
    $("ranking-list").innerHTML = ranked.map((row) => {
      const metric = row.primary;
      const deltaUnit = metric.label === "Carga" ? UNITS.charge : metric.label === "Tampão" ? UNITS.stemming : UNITS.depth;
      const fillClass = row.severity === "red" ? "ranking-fill--red" : "";
      const metricText = metric.label === "Sem previsto" ? "referência ausente" : `${metric.label} · ${formatPercent(metric.relative)}`;
      const deltaText = Number.isFinite(metric.delta) ? formatSigned(metric.delta, deltaUnit) : "n.a.";
      return `<button class="ranking-item ranking-button" type="button" data-hole-id="${escapeHtml(row.id)}"><span class="ranking-hole">${escapeHtml(row.id)}</span><span class="ranking-metric">${escapeHtml(metricText)}</span><span class="ranking-track"><span class="ranking-fill ${fillClass}" style="width:${Math.min(100, (row.score / maximum) * 100)}%"></span></span><span class="ranking-delta">${escapeHtml(deltaText)}</span></button>`;
    }).join("");
    $("ranking-list").querySelectorAll("[data-hole-id]").forEach((node) => node.addEventListener("click", () => selectHole(node.dataset.holeId)));
  }

  function renderTiming(rows, summary) {
    if (!summary.delays.length || summary.delayMin === summary.delayMax) {
      $("timing-chart").innerHTML = `<div class="empty-state">A fonte não traz uma janela variável de detonação.</div>`;
      $("timing-tag").textContent = summary.delays.length ? `${formatInteger(summary.delayMin)} ms` : "Sem dados";
      return;
    }
    const min = summary.delayMin;
    const max = summary.delayMax;
    const span = max - min;
    const position = (value) => `${Math.max(0, Math.min(100, ((value - min) / span) * 100))}%`;
    const dots = rows.filter((row) => Number.isFinite(row.delay)).sort((a, b) => a.delay - b.delay).filter((row, index) => index % Math.max(1, Math.ceil(rows.length / 70)) === 0).map((row) => `<span class="timing-dot ${row.severity === "red" ? "timing-dot--focus" : ""}" style="left:${position(row.delay)}; bottom:${row.severity === "red" ? "69px" : "57px"}" title="Furo ${escapeHtml(row.id)} · ${formatInteger(row.delay)} ms"></span>`).join("");
    const medianPosition = position(summary.delayMedian);
    $("timing-chart").innerHTML = `<div class="timing-band"></div><div class="timing-axis"></div>${dots}<span class="timing-median" style="left:calc(15px + ${medianPosition} * (100% - 30px))"></span><span class="timing-median-label" style="left:calc(15px + ${medianPosition} * (100% - 30px))">mediana ${formatInteger(summary.delayMedian)} ms</span><span class="timing-tick" style="left:15px">${formatInteger(min)}</span><span class="timing-tick" style="left:50%">${formatInteger(min + span / 2)}</span><span class="timing-tick" style="right:0; transform:none">${formatInteger(max)}</span>`;
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
    $("holes-table-body").innerHTML = visible.map((row) => `<tr><td><button class="table-hole-button" type="button" data-hole-id="${escapeHtml(row.id)}">${escapeHtml(row.id)}</button></td><td><span class="status-pill status-pill--${severityClass(row.severity)}">${escapeHtml(row.statusLabel)}</span></td><td>${withUnit(row.depthPlanned, UNITS.depth)}</td><td>${withUnit(row.depthActual, UNITS.depth)}</td><td>${withUnit(row.chargePlanned, UNITS.charge)}</td><td>${withUnit(row.chargeActual, UNITS.charge)}</td><td>${withUnit(row.stemmingActual, UNITS.stemming)}</td><td>${formatInteger(row.delay)} ${UNITS.delay}</td></tr>`).join("");
    $("holes-table-body").querySelectorAll("[data-hole-id]").forEach((node) => node.addEventListener("click", () => selectHole(node.dataset.holeId)));
    $("table-footer").textContent = `Mostrando ${formatInteger(visible.length)} de ${formatInteger(rows.length)} furos no recorte · ordenado por prioridade de revisão`;
  }

  function renderAll() {
    if (!state.dataset) return;
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
      if (payload.ok === false) throw new Error(payload.error || "A fonte devolveu um erro.");
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

  async function loadSample(reason = "Base local de referência") {
    const response = await fetch(appendParams(CONFIG.sampleUrl || "data/sample.json", { t: Date.now() }), { cache: "no-store" });
    if (!response.ok) throw new Error("Fixture local indisponível.");
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
    $("refresh-data").disabled = true;
    $("top-status").textContent = "Atualizando fonte";
    try {
      const endpointFromQuery = new URLSearchParams(window.location.search).get("drive");
      const endpoint = endpointFromQuery || CONFIG.driveIndexUrl || "";
      state.driveEndpoint = endpoint;
      if (!endpoint) {
        await loadSample("Base local de referência");
        return;
      }
      const listing = await fetchJson(endpoint);
      state.sourceFiles = Array.isArray(listing.files) ? listing.files : [];
      if (!state.sourceFiles.length) {
        await loadSample("Drive conectado · nenhum arquivo ainda");
        state.sourceKind = "remote";
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
      renderSourceUi();
      renderAll();
      showToast(shouldCombine ? `Fontes atualizadas: ${state.sourceFiles.length} arquivos` : `Fonte atualizada: ${state.dataset.meta.sourceFile}`);
    } catch (error) {
      state.sourceFiles = [];
      await loadSample(`Falha na fonte · usando base local`);
      showToast(error.message || "Fonte indisponível; base local carregada.", true);
    } finally {
      state.loading = false;
      $("refresh-data").disabled = false;
      if (state.sourceKind !== "remote") renderSourceUi();
    }
  }

  function formatBytes(value) {
    const bytes = toNumber(value);
    if (!Number.isFinite(bytes)) return "tamanho n.a.";
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
      renderAll();
    });
    $("file-select").addEventListener("change", (event) => loadSource(event.target.value));
    $("selected-hole").addEventListener("click", () => {
      const row = state.dataset?.holes.find((hole) => String(hole.id) === String(state.selectedHoleId));
      if (row) showToast(`Furo ${row.id}: ${row.statusLabel}`);
    });
  }

  renderHeroGraphic();
  bindEvents();
  loadSource();
  window.setInterval(() => { if (state.driveEndpoint && !document.hidden) loadSource(state.selectedFileId); }, Number(CONFIG.refreshMs) || 300000);
})();
