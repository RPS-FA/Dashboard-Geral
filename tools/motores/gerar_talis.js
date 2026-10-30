const fs = require('fs');
const [,, schedF, idxF, cfgF, shaS, shaI, shaC, outF] = process.argv;
let sched = fs.readFileSync(schedF, 'utf8')
  .replace(/^export (function|const|async function)/gm, '$1')
  .replace(/^export \{[^}]*\};?\s*$/gm, '');
const idx = fs.readFileSync(idxF, 'utf8');
const cfg = fs.readFileSync(cfgF, 'utf8');
const bloco = (src, re) => { const m = re.exec(src); if (!m) throw new Error('não encontrado: ' + re); return m[0]; };
const inicioManualDe = bloco(idx, /function inicioManualDe\(op\) \{[\s\S]*?\n\}/);
const turnoEmMinutos = bloco(cfg, /export function turnoEmMinutos\(turno\) \{[\s\S]*?\n\}/).replace(/^export /, '');
const LINHAS = bloco(cfg, /export const LINHAS = [^\n]*/).replace(/^export /, '');
const PARAGENS = bloco(cfg, /  paragens: \[[\s\S]*?\n  \]/).replace(/^  paragens: /, '').split('\n').map((l, i) => i ? l.replace(/^  /, '') : l).join('\n');
const out = `// ============================================================
// Motor DSL Talis — cópia FIEL do motor da app planeamento-dsl-talis
//   server/scheduler.js  sha256 ${shaS}…  (integral; só se retiraram os "export")
//   server/index.js      sha256 ${shaI}…  (inicioManualDe + a parte "linhas" de calcular())
//   server/config.js     sha256 ${shaC}…  (LINHAS, turnoEmMinutos)
// Extraído 2026-10-29. Não editar à mão.
// Convenção da app: datas em UTC usado como hora de parede (08:00Z = 08:00 na fábrica).
// A app devolve o próprio plano em /api/estado (plano.linhas) -> o agregador compara
// sempre motor vs app e expõe as diferenças (auto-validação contínua).
// ============================================================
'use strict';

${sched.trim()}

// --- config.js ---
${LINHAS}

${turnoEmMinutos}

// --- index.js ---
${inicioManualDe}

// Subconjunto de CONFIG_DEFAULT (server/config.js) que o motor usa — para o caso de a config vir incompleta.
// lerConfig() da app faz { ...CONFIG_DEFAULT, ...guardada }; /api/estado já devolve a config fundida.
const CONFIG_BASE = {
  capacidade: { EE1: 9000, EE2: 9000, EM: 6000 },
  setupMin: 15,
  turno: { inicio: "08:00", fim: "17:00", almocoIni: "12:00", almocoFim: "13:00" },
  ancora: "2026-09-01T08:00:00Z",
  paragens: ${PARAGENS},
  excecoes: [],
};

// Parte "linhas" de calcular(opsBruto, cfg, mes) da app (buffer/kanban/dias não interessam ao plano).
// cfg = config devolvida por /api/estado (já é {...CONFIG_DEFAULT, ...guardada}).
function calcularLinhas(opsBruto, cfgIn) {
  const cfg = { ...CONFIG_BASE, ...(cfgIn || {}) };
  const ops = Array.isArray(opsBruto) ? opsBruto : [];
  const cal = {
    paragens: new Set((cfg.paragens || []).map((p) => p.data)),
    excecoes: cfg.excecoes || [],
    turno: turnoEmMinutos(cfg.turno),
  };
  const linhas = {};
  for (const linha of LINHAS) {
    const fila = ops
      .filter((o) => o.linha === linha)
      .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999))
      .map((o, i) => ({ ...o, ordem: i, inicio_manual: inicioManualDe(o) }));
    linhas[linha] = escalonarLinha(fila, {
      krh: cfg.capacidade[linha] || 1,
      setupMin: cfg.setupMin,
      ancora: new Date(cfg.ancora),
      linha,
      cal,
    });
  }
  return linhas;
}

// Plano completo: Map id -> { maquina, inicio, fim, origem, fatias:[{dia,minutos,ini,fim,qtd}] }
// inicio/fim: Date em UTC-parede (ler com getUTC*).
function calcularPlano(ops, cfg) {
  const out = new Map();
  const linhas = calcularLinhas(ops, cfg);
  for (const linha of Object.keys(linhas)) {
    for (const o of linhas[linha]) {
      out.set(o.id, {
        maquina: linha, inicio: new Date(o.data_inicio), fim: new Date(o.data_final),
        origem: o.origem_datas, fatias: repartirQtd(o._fatias || [], o.qtd),
      });
    }
  }
  return out;
}

if (typeof module === 'object' && module.exports) module.exports = { calcularLinhas, calcularPlano, agendar, janelaDoDia, LINHAS };
`;
fs.writeFileSync(outF, out);
