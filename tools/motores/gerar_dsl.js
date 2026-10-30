const fs = require('fs');
const [,, rawF, sha, outF] = process.argv;
const raw = fs.readFileSync(rawF, 'utf8');
const ind = s => s.split('\n').map(l => l ? '  ' + l : l).join('\n');
fs.writeFileSync(outF, `// ============================================================
// Motor DSL (Dupla escolha) — cópia FIEL do agendador da app planeamento-dsl
// (public/index.html, sha256 ${sha}…, extraído 2026-10-29: fecho transitivo de scheduleLine).
// Não editar à mão. Só muda o âmbito: DATA/SETTINGS injectados (a app usa st.ops/st.settings
// de /api/state sem merge). Modos da app: 'plan' (só quantidade), 'efet', 'eff' (quadro, defeito).
// Minutos (startMin/endMin) contam a partir da meia-noite local do dia do segmento (podem passar 1440).
// ============================================================
'use strict';

function criar(opsIn, settingsIn) {
${ind(raw)}

  DATA = Array.isArray(opsIn) ? opsIn : [];
  SETTINGS = settingsIn || {};
  return { ALL_LINES, scheduleLine, dDate, dateKey };
}

// hora de parede: dia (meia-noite local) + minutos (podem passar 1440); igual a min2hm() da app mesmo em dias de mudança de hora
function parede(d, min) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min); }

// Plano completo: Map id -> { maquina, inicio, fim, segs:[{inicio,fim,qtd}] }
function calcularPlano(ops, settings, modo) {
  const m = criar(ops, settings);
  const linhas = new Set(m.ALL_LINES);
  for (const o of (Array.isArray(ops) ? ops : [])) if (o && o.linha) linhas.add(o.linha);
  const out = new Map();
  for (const l of linhas) {
    const segs = m.scheduleLine(l, modo || 'eff');
    const todos = Object.values(segs).flat().sort((a, b) => a.date - b.date || a.startMin - b.startMin);
    for (const s of todos) {
      const ini = parede(s.date, s.startMin), fim = parede(s.date, s.endMin);
      let r = out.get(s.op.id);
      if (!r) { r = { maquina: l, inicio: ini, fim, segs: [] }; out.set(s.op.id, r); }
      r.segs.push({ inicio: ini, fim, qtd: s.qtdSeg });
      if (ini < r.inicio) r.inicio = ini;
      if (fim > r.fim) r.fim = fim;
    }
  }
  return out;
}

if (typeof module === 'object' && module.exports) module.exports = { criar, calcularPlano, parede };
`);
