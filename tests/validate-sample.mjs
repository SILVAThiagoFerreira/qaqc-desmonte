import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const payload = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
const config = await readFile(new URL("../config.js", import.meta.url), "utf8");
const macroHtml = await readFile(new URL("../macro.html", import.meta.url), "utf8");
const macroJs = await readFile(new URL("../macro.js", import.meta.url), "utf8");
const holes = payload.sheets?.["Dados dos Furos"];
assert.ok(holes, "A aba Dados dos Furos precisa existir");
assert.equal(holes.rows.length, 262, "A fixture deve representar os 262 furos da base fornecida");

const required = [
  "Data", "Horario", "Plano", "Tipo", "id", "x", "y",
  "profundidade prevista", "profundidade realizada",
  "cargas previstas", "cargas realizadas",
  "tampao previsto", "tampao realizado", "tempo detonacao (ms)"
];
for (const header of required) assert.ok(holes.headers.includes(header), `Cabeçalho ausente: ${header}`);

const idIndex = holes.headers.indexOf("id");
const ids = holes.rows.map((row) => row[idIndex]);
assert.equal(new Set(ids).size, ids.length, "Os IDs dos furos devem ser únicos");
assert.ok(ids.every((id) => Number.isFinite(Number(id))), "Todos os furos precisam ter ID numérico");
assert.match(config, /depth:\s*"m"/, "Profundidade deve estar configurada em metros");
assert.match(config, /charge:\s*"kg"/, "Carga deve estar configurada em quilogramas");
assert.match(config, /stemming:\s*"m"/, "Tampão deve estar configurado em metros");
assert.match(config, /subdrill:\s*"m"/, "Subperfuração deve estar configurada em metros");
assert.match(macroHtml, /href="macro\.html"/, "A navegação Macro deve existir");
assert.match(macroHtml, /id="trend-chart"/, "A página Macro deve conter o gráfico de tendência");
assert.match(macroHtml, /id="macro-kpi-coverage"/, "A página Macro deve exibir a cobertura do QA\/QC");
assert.match(macroHtml, /Diferença absoluta média do tampão/, "A página Macro deve exibir a diferença absoluta média do tampão");
assert.match(macroJs, /function loadData\(\)/, "A página Macro deve ter atualização de dados");
assert.match(macroJs, /stemmingAbs/, "A página Macro deve calcular o desvio absoluto do tampão");

console.log(JSON.stringify({ ok: true, holes: holes.rows.length, sheets: Object.keys(payload.sheets), macro: true }));
