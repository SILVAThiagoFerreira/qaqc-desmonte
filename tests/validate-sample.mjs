import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const payload = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
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

console.log(JSON.stringify({ ok: true, holes: holes.rows.length, sheets: Object.keys(payload.sheets) }));
