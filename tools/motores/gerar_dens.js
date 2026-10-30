const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const sha = process.argv[3];
const ind = s => s.split('\n').map(l => l ? '  ' + l : l).join('\n');
const out = `// ============================================================
// Motor Densidades — cópia FIEL do agendador da app planeamento-densidades
// (public/index.html, sha256 ${sha}…, extraído 2026-10-29 com scratch extrair.js).
// Não editar à mão: o código dentro de criar() é o da app (fecho transitivo de
// calcScheduleForMachineRange + ensureSettingsShape + isoWeekToMonday). Só muda o âmbito:
// DATA e SETTINGS deixam de ser globais e passam a ser injectados.
// Janela de cálculo = a da própria app em _findOpItemStart/freezeSubsequentAutoOps:
// por máquina, todas as weekKeys da máquina + a semana anterior (cursor contínuo).
// ============================================================
'use strict';

function criar(opsIn, settingsIn) {
${ind(raw)}

  // --- arranque igual a applyServerSettings() da app ---
  SETTINGS = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), settingsIn || {});
  ensureSettingsShape();
  DATA = Array.isArray(opsIn) ? opsIn : [];

  function semanasMaquina(machine) {
    const wks = Array.from(new Set(DATA.filter(o => o.maquina === machine && o.weekKey).map(o => o.weekKey))).sort();
    if (wks.length === 0) return null;
    const weeksArr = wks.map(k => ({ key: k, monday: isoWeekToMonday(k) }));
    const monday0 = weeksArr[0].monday;
    const prev = new Date(monday0); prev.setDate(prev.getDate() - 7);
    return [{ key: weekKey(prev), monday: prev }, ...weeksArr];
  }
  return { MACHINES, SETTINGS, calcScheduleForMachineRange, semanasMaquina, isoWeekToMonday, weekKey, fmtDate };
}

// Plano completo: Map id -> { maquina, inicio, fim, manual, segs:[{inicio,fim,qtd}] }
function calcularPlano(ops, settings) {
  const m = criar(ops, settings);
  const out = new Map();
  for (const machine of m.MACHINES) {
    const wk = m.semanasMaquina(machine);
    if (!wk) continue;
    for (const it of m.calcScheduleForMachineRange(machine, wk)) {
      if (!it.start || isNaN(it.start)) continue;
      let r = out.get(it.op.id);
      if (!r) { r = { maquina: machine, inicio: it.start, fim: it.end, manual: it.op.inicioMode === 'manual', segs: [] }; out.set(it.op.id, r); }
      r.segs.push({ inicio: it.start, fim: it.end, qtd: it.qtdSeg });
      if (it.start < r.inicio) r.inicio = it.start;
      if (it.end > r.fim) r.fim = it.end;
    }
  }
  return out;
}

if (typeof module === 'object' && module.exports) module.exports = { criar, calcularPlano };
`;
fs.writeFileSync(process.argv[4], out);
