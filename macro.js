(() => {
  const CONFIG = window.QAQC_CONFIG || {};
  const UNITS = CONFIG.units || { depth: "m", charge: "kg", stemming: "m", subdrill: "m", delay: "ms" };
  const state = {
    dataset: null,
    sourceFiles: [],
    sourceKind: "local",
    sourceLabel: "Fonte local",
    driveEndpoint: "",
    loading: false,
    syncing: false,
    filters: { plan: "all", date: "all" },
    groups: [],
    selectedGroupKey: null,
  };

  const $ = (id) => document.getElementById(id);
  const integerFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimalFormat = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const oneDecimalFormat = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
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

  function formatRate(value) {
    return Number.isFinite(value) ? `${oneDecimalFormat.format(value * 100)}%` : "N/D";
  }

  function formatSignedPercent(value) {
    if (!Number.isFinite(value)) return "N/D";
    return `${value > 0 ? "+" : ""}${oneDecimalFormat.format(value * 100)}%`;
  }

  function formatPercentagePoints(value) {
    if (!Number.isFinite(value)) return "N/D";
    return `${value > 0 ? "+" : ""}${oneDecimalFormat.format(value * 100)} p.p.`;
  }

  function formatMagnitudePoints(value) {
    return Number.isFinite(value) ? `${oneDecimalFormat.format(Math.abs(value) * 100)} p.p.` : "N/D";
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

  function dateOrder(value) {
    const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return 0;
    return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }

  function hasReference(value) {
    return Number.isFinite(value) && Math.abs(value) >= 0.000001;
  }

  function makeFlag(delta, base, tolerance, mode = "relative") {
    if (!Number.isFinite(delta) || !hasReference(base) || !Number.isFinite(tolerance) || tolerance <= 0) return null;
    const relative = delta / Math.abs(base);
    const score = mode === "absolute" ? Math.abs(delta) / tolerance : Math.abs(relative) / tolerance;
    return { delta, relative, score };
  }

  function getSheetEntries(payload) {
    if (!payload || !payload.sheets) return [];
    if (Array.isArray(payload.sheets)) return payload.sheets.map((sheet, index) => [String(index), sheet]);
    return Object.entries(payload.sheets);
  }

  function getSheetRows(sheet) {
    if (Array.isArray(sheet)) return sheet;
    if (Array.isArray(sheet?.rows)) return [sheet.headers || [], ...sheet.rows];
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

  function makeHole(row, headerMap, rawIndex) {
    const read = (aliases) => valueAt(row, headerMap, aliases);
    const depthPlanned = toNumber(read(["profundidade prevista", "profundidade planejada", "depth planned"]));
    const depthActual = toNumber(read(["profundidade realizada", "profundidade real", "depth actual"]));
    const chargePlanned = toNumber(read(["cargas previstas", "carga prevista", "cargas planejadas", "charge planned"]));
    const chargeActual = toNumber(read(["cargas realizadas", "carga realizada", "charge actual"]));
    const stemmingPlanned = toNumber(read(["tampao previsto", "tampao planejado", "stemming planned"]));
    const stemmingActual = toNumber(read(["tampao realizado", "tampao real", "stemming actual"]));
    const subdrill = toNumber(read(["subfuracao", "subperfuração", "subperfuração planejada", "subdrill"]));
    const delay = toNumber(read(["tempo detonacao (ms)", "tempo de iniciação", "tempo de iniciacao", "delay"]));
    const depthDelta = Number.isFinite(depthActual) && Number.isFinite(depthPlanned) ? depthActual - depthPlanned : null;
    const chargeDelta = Number.isFinite(chargeActual) && Number.isFinite(chargePlanned) ? chargeActual - chargePlanned : null;
    const stemmingDelta = Number.isFinite(stemmingActual) && Number.isFinite(stemmingPlanned) ? stemmingActual - stemmingPlanned : null;
    const flags = [
      makeFlag(depthDelta, depthPlanned, 0.10),
      makeFlag(chargeDelta, chargePlanned, 0.20),
      makeFlag(stemmingDelta, stemmingPlanned, 0.50, "absolute"),
    ].filter(Boolean);
    const baselineMissing = [depthPlanned, chargePlanned, stemmingPlanned].some((value) => !hasReference(value));
    const executionMissing = [
      [depthPlanned, depthActual],
      [chargePlanned, chargeActual],
      [stemmingPlanned, stemmingActual],
    ].some(([planned, actual]) => hasReference(planned) && !Number.isFinite(actual));
    const notEvaluable = baselineMissing || executionMissing;
    const score = Math.max(flags.reduce((max, flag) => Math.max(max, flag.score), 0), notEvaluable ? 1 : 0);
    return {
      rawIndex,
      id: toNumber(read(["id", "furo", "numero do furo", "n do furo"])),
      plan: String(read(["plano", "plan"]) ?? "N/D").trim(),
      planName: String(read(["nome plano", "nome do plano", "plan name"]) ?? "").trim(),
      type: String(read(["tipo", "type"]) ?? "N/D").trim(),
      date: String(read(["data", "date"]) ?? "").trim(),
      time: String(read(["horario", "hora", "time"]) ?? "").trim(),
      depthPlanned,
      depthActual,
      depthPct: Number.isFinite(depthDelta) && hasReference(depthPlanned) ? depthDelta / Math.abs(depthPlanned) : null,
      chargePlanned,
      chargeActual,
      chargePct: Number.isFinite(chargeDelta) && hasReference(chargePlanned) ? chargeDelta / Math.abs(chargePlanned) : null,
      stemmingPlanned,
      stemmingActual,
      stemmingDelta,
      subdrill,
      delay,
      severity: score >= 2 ? "red" : score >= 1 ? "amber" : "green",
      notEvaluable,
    };
  }

  function buildDataset(payload, fileMeta = {}) {
    const entries = getSheetEntries(payload);
    const holeEntry = findHoleSheet(entries);
    if (!holeEntry) throw new Error("A planilha não contém uma aba com ID do furo e profundidade executada.");
    const rows = getSheetRows(holeEntry[1]);
    const headers = rows[0] || [];
    const headerMap = createHeaderMap(headers);
    const required = [
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
    const missing = required.filter(([, aliases]) => resolveColumn(headerMap, aliases) === undefined).map(([name]) => name);
    if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}`);
    const holes = rows.slice(1)
      .map((item, index) => makeHole(item, headerMap, index + 2))
      .filter((hole) => Number.isFinite(hole.id))
      .map((hole) => ({
        ...hole,
        sourceId: fileMeta.id || "local",
        sourceName: fileMeta.name || payload.meta?.sourceFile || "Fonte local",
        sourceUpdatedAt: fileMeta.updatedAt || payload.meta?.updatedAt || "",
      }));
    if (!holes.length) throw new Error("A planilha foi lida, mas não contém registros de furos válidos.");
    return { holes, headers, meta: { ...(payload.meta || {}), ...fileMeta, sourceFile: fileMeta.name || payload.meta?.sourceFile || "Fonte não identificada" } };
  }

  function combineDatasets(datasets) {
    const records = new Map();
    datasets.forEach((dataset) => dataset.holes.forEach((hole) => {
      const key = `${dateKey(hole.date)}|${hole.time || "N/D"}|${hole.plan}|${hole.type}|${hole.id}`;
      const existing = records.get(key);
      if (!existing || String(hole.sourceUpdatedAt || "") >= String(existing.sourceUpdatedAt || "")) records.set(key, hole);
    }));
    return {
      holes: [...records.values()].sort((a, b) => dateOrder(a.date) - dateOrder(b.date) || String(a.plan).localeCompare(String(b.plan), "pt-BR", { numeric: true }) || a.id - b.id),
      meta: { sourceFile: `${datasets.length} planilhas do Drive`, sourceFiles: datasets.map((dataset) => dataset.meta.name).filter(Boolean) },
    };
  }

  function appendParams(url, params = {}) {
    const target = new URL(url, window.location.href);
    Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
    return target.toString();
  }

  function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = `qaqcMacroCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
      const payload = JSON.parse(await response.text());
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

  function renderSourceStatus() {
    const status = $("macro-top-status");
    status.textContent = state.syncing
      ? "Atualizando dados"
      : state.sourceKind === "remote" ? "Drive conectado" : state.sourceKind === "error" ? "Fonte alternativa" : "Fonte carregada";
    status.title = state.sourceLabel;
  }

  function setSelectOptions(select, values, allLabel) {
    const current = select.value;
    select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    select.value = ["all", ...values].includes(current) ? current : "all";
  }

  function populateFilters() {
    const holes = state.dataset?.holes || [];
    const plans = [...new Set(holes.map((row) => row.plan).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
    const dates = [...new Set(holes.map((row) => dateKey(row.date)).filter(Boolean))].sort((a, b) => dateOrder(b) - dateOrder(a));
    setSelectOptions($("macro-plan-filter"), plans, "Todos os planos de fogo");
    setSelectOptions($("macro-date-filter"), dates, "Todas as datas de desmonte");
    state.filters.plan = $("macro-plan-filter").value;
    state.filters.date = $("macro-date-filter").value;
  }

  function makeGroup(rows, key) {
    const evaluable = rows.filter((row) => !row.notEvaluable);
    const within = rows.filter((row) => row.severity === "green").length;
    const review = rows.filter((row) => row.severity === "amber" && !row.notEvaluable).length;
    const outside = rows.filter((row) => row.severity === "red").length;
    const notEvaluable = rows.filter((row) => row.notEvaluable).length;
    const average = (field) => {
      const values = rows.map((row) => row[field]).filter(Number.isFinite);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    const averageAbsolute = (field) => {
      const values = rows.map((row) => row[field]).filter(Number.isFinite);
      return values.length ? values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length : null;
    };
    const first = rows[0];
    return {
      key,
      date: dateKey(first.date),
      dateOrder: dateOrder(first.date),
      plan: first.plan || "N/D",
      planName: first.planName || "",
      time: first.time || "N/D",
      type: first.type || "N/D",
      holes: rows.length,
      evaluable: evaluable.length,
      within,
      review,
      outside,
      notEvaluable,
      exceptions: review + outside,
      compliance: evaluable.length ? within / evaluable.length : null,
      depthPct: average("depthPct"),
      chargePct: average("chargePct"),
      stemmingDelta: average("stemmingDelta"),
      stemmingAbs: averageAbsolute("stemmingDelta"),
      rows,
    };
  }

  function eventKey(row) {
    return `${dateKey(row.date)}|${row.time || "N/D"}|${row.plan || "N/D"}|${row.type || "N/D"}`;
  }

  function eventLabel(group) {
    const parts = [group.plan || "N/D", group.date || "N/D"];
    if (group.time && group.time !== "N/D") parts.push(group.time);
    return parts.join(" · ");
  }

  function eventContext(group) {
    return `${eventLabel(group)}${group.type && group.type !== "N/D" ? ` · ${group.type}` : ""}`;
  }

  function getGroups() {
    const grouped = new Map();
    (state.dataset?.holes || []).forEach((row) => {
      const key = eventKey(row);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    return [...grouped.entries()]
      .map(([key, rows]) => makeGroup(rows, key))
      .filter((group) => (state.filters.plan === "all" || group.plan === state.filters.plan) && (state.filters.date === "all" || group.date === state.filters.date))
      .sort((a, b) => a.dateOrder - b.dateOrder
        || String(a.time).localeCompare(String(b.time), "pt-BR", { numeric: true })
        || String(a.plan).localeCompare(String(b.plan), "pt-BR", { numeric: true })
        || String(a.type).localeCompare(String(b.type), "pt-BR"));
  }

  function clearMacroContent() {
    ["trend-chart", "deviation-chart", "status-chart"].forEach((id) => { $(id).innerHTML = `<div class="empty-state">Nenhum desmonte corresponde ao recorte atual.</div>`; });
    $("macro-table-body").innerHTML = `<tr><td colspan="13"><div class="empty-state">Nenhum desmonte corresponde ao recorte atual.</div></td></tr>`;
    ["macro-scope", "macro-kpi-events", "macro-kpi-holes", "macro-kpi-coverage", "macro-kpi-compliance", "macro-kpi-outside", "macro-latest", "macro-previous", "macro-change", "trend-tag", "deviation-tag", "status-tag", "macro-table-tag"].forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    $("macro-kpi-events-foot").textContent = "—";
    $("macro-kpi-holes-foot").textContent = "—";
    $("macro-kpi-coverage-foot").textContent = "—";
    $("macro-kpi-compliance-foot").textContent = "—";
    $("macro-kpi-outside-foot").textContent = "—";
    $("macro-table-footer").textContent = "Sem registros no recorte";
    $("macro-direction").textContent = "Sem dados";
    $("macro-direction-note").textContent = "Ajuste os filtros para continuar.";
    $("macro-insight-title").textContent = "Sem dados no recorte";
    $("macro-insight-copy").textContent = "Nenhum desmonte atende aos filtros selecionados.";
  }

  function renderKpis(groups) {
    const rows = groups.flatMap((group) => group.rows);
    const evaluable = rows.filter((row) => !row.notEvaluable).length;
    const within = rows.filter((row) => row.severity === "green").length;
    const outside = rows.filter((row) => row.severity === "red").length;
    $("macro-scope").textContent = `${formatInteger(groups.length)} ${groups.length === 1 ? "desmonte" : "desmontes"} · ${formatInteger(rows.length)} furos`;
    $("macro-kpi-events").textContent = formatInteger(groups.length);
    $("macro-kpi-events-foot").textContent = `${formatInteger(new Set(groups.map((group) => group.date)).size)} ${new Set(groups.map((group) => group.date)).size === 1 ? "data" : "datas"} no recorte`;
    $("macro-kpi-holes").textContent = formatInteger(rows.length);
    $("macro-kpi-holes-foot").textContent = `${formatInteger(evaluable)} furos avaliáveis`;
    $("macro-kpi-coverage").textContent = formatRate(rows.length ? evaluable / rows.length : null);
    $("macro-kpi-coverage-foot").textContent = `${formatInteger(evaluable)} de ${formatInteger(rows.length)} com referência e execução`;
    $("macro-kpi-compliance").textContent = formatRate(evaluable ? within / evaluable : null);
    $("macro-kpi-compliance-foot").textContent = `${formatInteger(within)} de ${formatInteger(evaluable)} furos avaliáveis`;
    $("macro-kpi-outside").textContent = formatInteger(outside);
    $("macro-kpi-outside-foot").textContent = `${formatRate(rows.length ? outside / rows.length : null)} do recorte`;
  }

  function renderExecutive(groups) {
    const latest = groups[groups.length - 1];
    const previous = groups.length > 1 ? groups[groups.length - 2] : null;
    const direction = $("macro-direction");
    direction.className = "";
    if (!latest) return;
    $("macro-latest").textContent = eventContext(latest);
    $("macro-previous").textContent = previous ? `${formatRate(previous.compliance)}` : "Sem comparação";
    if (!previous || !Number.isFinite(latest.compliance) || !Number.isFinite(previous.compliance)) {
      direction.textContent = "Sem histórico";
      $("macro-direction-note").textContent = "A tendência será calculada com ao menos dois desmontes avaliáveis.";
      $("macro-change").textContent = "N/D";
      $("macro-insight-title").textContent = "Histórico em formação";
      $("macro-insight-copy").textContent = `O recorte atual apresenta ${formatInteger(groups.length)} desmonte. A comparação ganha consistência à medida que novos registros do Drive forem incorporados.`;
      return;
    }
    const change = latest.compliance - previous.compliance;
    const differentPlan = latest.plan !== previous.plan;
    const differentType = latest.type !== previous.type;
    const initialComparison = groups.length < 3 && (differentPlan || differentType);
    if (initialComparison) {
      const comparisonReason = differentPlan && differentType ? "planos e tipos diferentes" : differentPlan ? "planos diferentes" : "tipos diferentes";
      direction.textContent = "Comparação inicial";
      direction.classList.add("macro-direction--neutral");
      $("macro-direction-note").textContent = `${formatPercentagePoints(change)} · ${comparisonReason}`;
      $("macro-change").textContent = formatPercentagePoints(change);
      $("macro-insight-title").textContent = "Sinal não conclusivo";
      $("macro-insight-copy").textContent = `A conformidade variou ${formatMagnitudePoints(change)} entre os eventos ${eventContext(previous)} e ${eventContext(latest)}. Como há ${comparisonReason}, o resultado deve orientar o acompanhamento, mas não ser tratado como melhoria ou piora histórica comprovada.`;
      return;
    }
    const tolerance = 0.005;
    const improving = change > tolerance;
    const worsening = change < -tolerance;
    direction.textContent = improving ? "Melhora" : worsening ? "Piora" : "Estável";
    direction.classList.add(improving ? "macro-direction--positive" : worsening ? "macro-direction--negative" : "macro-direction--neutral");
    $("macro-direction-note").textContent = `${formatPercentagePoints(change)} frente ao desmonte anterior`;
    $("macro-change").textContent = formatPercentagePoints(change);
    $("macro-insight-title").textContent = improving ? "Conformidade em recuperação" : worsening ? "Conformidade requer atenção" : "Conformidade estável";
    $("macro-insight-copy").textContent = improving
      ? `O desmonte ${latest.plan} apresentou melhora de ${formatPercentagePoints(change)} na conformidade em relação ao desmonte anterior.`
      : worsening
        ? `O desmonte ${latest.plan} apresentou redução de ${formatMagnitudePoints(change)} na conformidade em relação ao desmonte anterior. Priorize a análise dos desvios de execução.`
        : `A conformidade variou menos de 0,5 p.p. entre os dois últimos desmontes. Mantenha o acompanhamento dos desvios médios.`;
  }

  function tooltipText(group) {
    return `${eventContext(group)} | Conformidade ${formatRate(group.compliance)} | ${formatInteger(group.holes)} furos`;
  }

  function showChartTooltip(event, node) {
    const tooltip = $("macro-tooltip");
    tooltip.textContent = node.dataset.macroTooltip || "";
    const rect = node.getBoundingClientRect();
    tooltip.style.left = `${Math.min(window.innerWidth - 270, Math.max(10, rect.left + rect.width / 2 - 120))}px`;
    tooltip.style.top = `${Math.max(10, rect.top - 48)}px`;
    tooltip.classList.add("is-visible");
    tooltip.setAttribute("aria-hidden", "false");
  }

  function hideChartTooltip() {
    const tooltip = $("macro-tooltip");
    tooltip.classList.remove("is-visible");
    tooltip.setAttribute("aria-hidden", "true");
  }

  function bindGroupInteractions(root) {
    root.querySelectorAll("[data-group-index]").forEach((node) => {
      const select = () => {
        const index = Number(node.dataset.groupIndex);
        const group = state.groups[index];
        if (group) { state.selectedGroupKey = group.key; renderAll(); }
      };
      node.addEventListener("click", select);
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
      });
      node.addEventListener("mouseenter", (event) => showChartTooltip(event, node));
      node.addEventListener("focus", (event) => showChartTooltip(event, node));
      node.addEventListener("mouseleave", hideChartTooltip);
      node.addEventListener("blur", hideChartTooltip);
    });
  }

  function renderTrendChart(groups) {
    const root = $("trend-chart");
    const width = 860;
    const height = 310;
    const margin = { top: 26, right: 24, bottom: 58, left: 55 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xFor = (index) => groups.length === 1 ? margin.left + plotWidth / 2 : margin.left + (plotWidth * index) / (groups.length - 1);
    const yFor = (value) => margin.top + plotHeight - (Math.max(0, Math.min(100, value)) / 100) * plotHeight;
    const grid = [0, 25, 50, 75, 100].map((value) => `<line class="macro-grid-line" x1="${margin.left}" y1="${yFor(value)}" x2="${width - margin.right}" y2="${yFor(value)}"/><text class="macro-axis-label" x="${margin.left - 10}" y="${yFor(value) + 4}" text-anchor="end">${value}%</text>`).join("");
    const points = groups.map((group, index) => {
      if (!Number.isFinite(group.compliance)) return "";
      const x = xFor(index);
      const y = yFor(group.compliance * 100);
      const selected = state.selectedGroupKey === group.key ? " macro-point--selected" : "";
      const tooltip = tooltipText(group);
      return `<circle class="macro-point${selected}" cx="${x}" cy="${y}" r="6" tabindex="0" role="button" aria-pressed="${state.selectedGroupKey === group.key}" aria-label="${escapeHtml(tooltip)}" data-group-index="${index}" data-macro-tooltip="${escapeHtml(tooltip)}"><title>${escapeHtml(tooltip)}</title></circle>`;
    }).join("");
    let linePath = "";
    let segment = [];
    groups.forEach((group, index) => {
      if (Number.isFinite(group.compliance)) segment.push(`${segment.length ? "L" : "M"}${xFor(index)} ${yFor(group.compliance * 100)}`);
      else if (segment.length) { linePath += segment.join(" ") + " "; segment = []; }
    });
    if (segment.length) linePath += segment.join(" ");
    const labels = groups.map((group, index) => `<text class="macro-x-label" x="${xFor(index)}" y="${height - 31}" text-anchor="middle"><tspan x="${xFor(index)}" dy="0">${escapeHtml(group.plan)}</tspan><tspan x="${xFor(index)}" dy="14">${escapeHtml(group.date)}</tspan></text>`).join("");
    root.innerHTML = `<svg class="macro-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução da conformidade por desmonte"><g>${grid}</g><line class="macro-zero-line" x1="${margin.left}" y1="${yFor(0)}" x2="${width - margin.right}" y2="${yFor(0)}"/><path class="macro-trend-line" d="${linePath}"/>${points}${labels}</svg>`;
    bindGroupInteractions(root);
  }

  function renderDeviationChart(groups) {
    const root = $("deviation-chart");
    const width = 860;
    const height = 326;
    const margin = { top: 28, right: 24, bottom: 66, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = groups.flatMap((group) => [group.depthPct, group.chargePct].filter(Number.isFinite).map((value) => Math.abs(value * 100)));
    const domain = Math.max(5, Math.ceil((Math.max(...values, 1) + 2) / 5) * 5);
    const yFor = (value) => margin.top + plotHeight / 2 - (value / domain) * (plotHeight / 2 - 12);
    const zero = yFor(0);
    const slot = plotWidth / Math.max(groups.length, 1);
    const barWidth = Math.min(20, Math.max(8, slot * 0.18));
    const xFor = (index) => margin.left + slot * index + slot / 2;
    const grid = [-domain, -domain / 2, 0, domain / 2, domain].map((value) => `<line class="macro-grid-line" x1="${margin.left}" y1="${yFor(value)}" x2="${width - margin.right}" y2="${yFor(value)}"/><text class="macro-axis-label" x="${margin.left - 9}" y="${yFor(value) + 4}" text-anchor="end">${formatNumber(value, 0)}%</text>`).join("");
    const bars = groups.map((group, index) => {
      const x = xFor(index);
      const selected = state.selectedGroupKey === group.key ? " macro-bar--selected" : "";
      const buildBar = (value, offset, label, colorClass) => {
        if (!Number.isFinite(value)) return "";
        const scaled = value * 100;
        const y = Math.min(zero, yFor(scaled));
        const h = Math.max(2, Math.abs(zero - yFor(scaled)));
        const tooltip = `${eventContext(group)} | ${label}: ${formatSignedPercent(value)}`;
        return `<rect class="macro-bar ${colorClass}${selected}" x="${x + offset}" y="${y}" width="${barWidth}" height="${h}" tabindex="0" role="button" aria-label="${escapeHtml(tooltip)}" data-group-index="${index}" data-macro-tooltip="${escapeHtml(tooltip)}"><title>${escapeHtml(tooltip)}</title></rect>`;
      };
      return `${buildBar(group.depthPct, -barWidth - 2, "Desvio de profundidade", "macro-bar--depth")}${buildBar(group.chargePct, 2, "Desvio de carga", "macro-bar--charge")}<text class="macro-x-label" x="${x}" y="${height - 37}" text-anchor="middle"><tspan x="${x}" dy="0">${escapeHtml(group.plan)}</tspan><tspan x="${x}" dy="14">${escapeHtml(group.date)}</tspan></text>`;
    }).join("");
    const focus = groups.find((group) => group.key === state.selectedGroupKey) || groups[groups.length - 1];
    const readout = focus ? `<div class="macro-deviation-readout"><span>${escapeHtml(eventContext(focus))}</span><strong>Profundidade ${formatSignedPercent(focus.depthPct)} · Carga ${formatSignedPercent(focus.chargePct)} · Tampão |Δ| ${Number.isFinite(focus.stemmingAbs) ? `${formatNumber(focus.stemmingAbs)} ${UNITS.stemming}` : "N/D"}</strong></div>` : "";
    root.innerHTML = `<svg class="macro-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Desvios médios de profundidade e carga por desmonte"><g>${grid}</g><line class="macro-zero-line" x1="${margin.left}" y1="${zero}" x2="${width - margin.right}" y2="${zero}"/><text class="macro-chart-key macro-chart-key--depth" x="${margin.left}" y="15">Profundidade</text><text class="macro-chart-key macro-chart-key--charge" x="${margin.left + 110}" y="15">Carga</text>${bars}</svg>${readout}`;
    bindGroupInteractions(root);
  }

  function renderStatusChart(groups) {
    const total = groups.reduce((sum, group) => sum + group.holes, 0);
    const within = groups.reduce((sum, group) => sum + group.within, 0);
    const review = groups.reduce((sum, group) => sum + group.review, 0);
    const outside = groups.reduce((sum, group) => sum + group.outside, 0);
    const notEvaluable = groups.reduce((sum, group) => sum + group.notEvaluable, 0);
    const width = total || 1;
    const segment = (value, className, label) => `<span class="macro-status-segment ${className}" style="width:${(value / width) * 100}%" title="${escapeHtml(label)}"></span>`;
    $("status-chart").innerHTML = `<div class="macro-status-stack" role="img" aria-label="${escapeHtml(`Conforme ${within}, Em revisão ${review}, Fora da faixa ${outside}, Não avaliáveis ${notEvaluable}`)}">${segment(within, "macro-status-segment--green", `Conforme: ${formatInteger(within)}`)}${segment(review, "macro-status-segment--amber", `Em revisão: ${formatInteger(review)}`)}${segment(outside, "macro-status-segment--red", `Fora da faixa: ${formatInteger(outside)}`)}${segment(notEvaluable, "macro-status-segment--gray", `Não avaliáveis: ${formatInteger(notEvaluable)}`)}</div><div class="macro-status-values"><span><i class="legend-dot legend-dot--green"></i><strong>${formatInteger(within)}</strong> Conforme</span><span><i class="legend-dot legend-dot--amber"></i><strong>${formatInteger(review)}</strong> Em revisão</span><span><i class="legend-dot legend-dot--red"></i><strong>${formatInteger(outside)}</strong> Fora da faixa</span><span><i class="legend-dot legend-dot--gray"></i><strong>${formatInteger(notEvaluable)}</strong> Não avaliáveis</span></div>`;
  }

  function renderTable(groups) {
    const ordered = groups.slice().reverse();
    $("macro-table-body").innerHTML = ordered.map((group) => {
      const index = groups.findIndex((item) => item.key === group.key);
      const selected = state.selectedGroupKey === group.key ? " class=\"macro-row--selected\"" : "";
      return `<tr${selected} data-group-index="${index}"><td data-label="Data"><button class="macro-row-button" type="button" data-group-index="${index}">${escapeHtml(group.date)}</button></td><td data-label="Horário">${escapeHtml(group.time === "N/D" ? "—" : group.time)}</td><td data-label="Plano de fogo">${escapeHtml(group.plan)}</td><td data-label="Tipo">${escapeHtml(group.type === "N/D" ? "—" : group.type)}</td><td data-label="Furos">${formatInteger(group.holes)}</td><td data-label="Conformes">${formatInteger(group.within)}</td><td data-label="Em revisão">${formatInteger(group.review)}</td><td data-label="Fora da faixa">${formatInteger(group.outside)}</td><td data-label="Não avaliáveis">${formatInteger(group.notEvaluable)}</td><td data-label="Conformidade">${formatRate(group.compliance)}</td><td data-label="Desvio de profundidade">${formatSignedPercent(group.depthPct)}</td><td data-label="Desvio de carga">${formatSignedPercent(group.chargePct)}</td><td data-label="Desvio de tampão">${Number.isFinite(group.stemmingAbs) ? `${formatNumber(group.stemmingAbs)} ${UNITS.stemming}` : "N/D"}</td></tr>`;
    }).join("");
    $("macro-table-footer").textContent = `${formatInteger(groups.length)} ${groups.length === 1 ? "desmonte" : "desmontes"} · clique em uma linha para atualizar a leitura executiva`;
    $("macro-table-body").querySelectorAll(".macro-row-button").forEach((button) => button.addEventListener("click", () => {
      const group = groups[Number(button.dataset.groupIndex)];
      if (group) { state.selectedGroupKey = group.key; renderAll(); }
    }));
  }

  function renderAll() {
    if (!state.dataset) return;
    const groups = getGroups();
    state.groups = groups;
    if (groups.length && !groups.some((group) => group.key === state.selectedGroupKey)) state.selectedGroupKey = groups[groups.length - 1].key;
    if (!groups.length) { clearMacroContent(); return; }
    renderKpis(groups);
    renderExecutive(groups);
    $("trend-tag").textContent = `${formatInteger(groups.length)} ${groups.length === 1 ? "desmonte" : "desmontes"}`;
    $("deviation-tag").textContent = `${formatInteger(groups.length)} ${groups.length === 1 ? "ponto" : "pontos"}`;
    $("status-tag").textContent = `${formatInteger(groups.reduce((sum, group) => sum + group.holes, 0))} furos`;
    $("macro-table-tag").textContent = `${formatInteger(groups.length)} ${groups.length === 1 ? "desmonte" : "desmontes"}`;
    renderTrendChart(groups);
    renderDeviationChart(groups);
    renderStatusChart(groups);
    renderTable(groups);
  }

  async function loadSample(reason = "Fonte local") {
    const response = await fetch(appendParams(CONFIG.sampleUrl || "data/sample.json", { t: Date.now() }), { cache: "no-store" });
    if (!response.ok) throw new Error("Fonte local indisponível.");
    const payload = await response.json();
    state.dataset = buildDataset(payload, { name: payload.meta?.sourceFile || "data/sample.json" });
    state.sourceKind = reason.startsWith("Falha") ? "error" : "local";
    state.sourceLabel = reason;
    state.sourceFiles = [];
    populateFilters();
    renderSourceStatus();
    renderAll();
  }

  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    const hadDataset = Boolean(state.dataset);
    const previousKind = state.sourceKind;
    $("macro-refresh-data").disabled = true;
    try {
      const endpoint = new URLSearchParams(window.location.search).get("drive") || CONFIG.driveIndexUrl || "";
      state.driveEndpoint = endpoint;
      if (!endpoint) {
        await loadSample("Fonte local");
        return;
      }
      state.syncing = true;
      renderSourceStatus();
      let bootstrapRendered = false;
      if (!state.dataset) {
        try {
          await loadSample("Fonte local · sincronizando Drive");
          bootstrapRendered = true;
          state.syncing = true;
          renderSourceStatus();
        } catch {
          // The remote source remains the authoritative attempt.
        }
      }
      const listing = await fetchJson(endpoint);
      state.sourceFiles = Array.isArray(listing.files) ? listing.files : [];
      if (!state.sourceFiles.length) {
        if (!state.dataset) await loadSample("Drive conectado · nenhuma planilha encontrada");
        state.sourceKind = bootstrapRendered ? "error" : "remote";
        state.sourceLabel = bootstrapRendered ? "Drive conectado · nenhuma planilha encontrada · fonte local" : "Drive conectado · nenhuma planilha encontrada";
        state.syncing = false;
        renderSourceStatus();
        return;
      }
      const dataset = state.sourceFiles.length > 1
        ? await loadCombinedFiles(endpoint, state.sourceFiles)
        : buildDataset(await fetchRemoteFile(endpoint, state.sourceFiles[0]), state.sourceFiles[0]);
      state.dataset = dataset;
      state.sourceKind = "remote";
      state.sourceLabel = `${state.sourceFiles.length} arquivos Drive · ${formatInteger(dataset.holes.length)} furos`;
      populateFilters();
      state.syncing = false;
      renderSourceStatus();
      renderAll();
      showToast(`Planilhas atualizadas: ${state.sourceFiles.length}`);
    } catch (error) {
      if (hadDataset || state.dataset) {
        state.sourceKind = "error";
        state.sourceLabel = previousKind === "remote" ? "Falha na atualização · dados anteriores mantidos" : "Falha na fonte · fonte local mantida";
        state.syncing = false;
        renderSourceStatus();
        showToast(`${error.message || "Fonte Drive indisponível."} Dados visíveis foram mantidos.`, true);
      } else {
        try { await loadSample("Falha na fonte · usando fonte local"); } catch { state.sourceKind = "error"; state.sourceLabel = "Falha ao carregar as fontes"; renderSourceStatus(); }
        showToast(error.message || "Fonte indisponível; fonte local carregada.", true);
      }
    } finally {
      state.loading = false;
      state.syncing = false;
      $("macro-refresh-data").disabled = false;
      renderSourceStatus();
    }
  }

  let toastTimer;
  function showToast(message, isError = false) {
    const toast = $("macro-toast");
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
  }

  function bindEvents() {
    $("macro-refresh-data").addEventListener("click", loadData);
    $("macro-plan-filter").addEventListener("change", (event) => { state.filters.plan = event.target.value; state.selectedGroupKey = null; renderAll(); });
    $("macro-date-filter").addEventListener("change", (event) => { state.filters.date = event.target.value; state.selectedGroupKey = null; renderAll(); });
    $("macro-clear-filters").addEventListener("click", () => {
      state.filters.plan = "all";
      state.filters.date = "all";
      $("macro-plan-filter").value = "all";
      $("macro-date-filter").value = "all";
      state.selectedGroupKey = null;
      renderAll();
    });
  }

  bindEvents();
  loadData();
  window.setInterval(() => { if (state.driveEndpoint && !document.hidden) loadData(); }, Number(CONFIG.refreshMs) || 300000);
})();
