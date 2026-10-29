// ============================================================
// Plano DS100 — porte fiel do PlannerCork, separador DS100 (renderDS100Weeks + computeDS100AllocAllWeeks)
// Fonte: index.html do PlannerCork, lido a 29/10/2026.
// Regras (iguais à app):
//   · frascos = round(qtEntrada / rolhas por frasco da análise) — DS100_1:1, DS100_2:2, DS100_4:4, Amostras_1:1, Amostras_2:2 (outras: 2)
//   · semanas: todas as weekKey entre a 1.ª e a última com ordens (máquina ≠ KANBAN), +12 semanas para absorver transbordos
//     (a app avança "ww > 53 → semana 1 do ano seguinte", mesmo em anos com 52 semanas — replicado)
//   · por semana: 6 dias (2.ª–sáb.), capacidade diária = settings.ds100CapsByWeek[semana][dia] ou ds100DailyTarget (15000; sábado 0)
//   · enche dia a dia pela ordem sortIdx; o que não cabe passa para a semana seguinte (carry), antes das ordens dessa semana
//   · uma ordem sem nenhum frasco colocado numa semana não aparece nessa semana (passa inteira)
// Início planeado = 1.º dia com frascos (colunas 2.ªF…SAB do separador DS100); fim = último dia com frascos.
// Datas em hora LOCAL (server.js força TZ=Europe/Lisbon).
// ============================================================
'use strict';

const ROLHAS_FRASCO = { DS100_1: 1, DS100_2: 2, DS100_4: 4, Amostras_1: 1, Amostras_2: 2 };
const DIAS = 6;

function frascos(op) { const rpf = ROLHAS_FRASCO[op.analise] || 2; return Math.round((parseFloat(op.qtEntrada) || 0) / rpf); }
function capPadrao(S, dia) { return dia === 5 ? 0 : (S.ds100DailyTarget || 15000); }
function capDia(S, wk, dia) {
  if (wk && S.ds100CapsByWeek && Array.isArray(S.ds100CapsByWeek[wk])) { const v = S.ds100CapsByWeek[wk][dia]; if (v != null && !isNaN(v)) return v; }
  return capPadrao(S, dia);
}
const pad = n => String(n).padStart(2, '0');
function segundaDe(wk) {
  const m = /^(\d{4})-W(\d{2})$/.exec(wk || ''); if (!m) return null;
  const yy = parseInt(m[1], 10), ww = parseInt(m[2], 10);
  const jan4 = new Date(yy, 0, 4); const dow = (jan4.getDay() || 7) - 1;
  const monday1 = new Date(jan4); monday1.setDate(jan4.getDate() - dow);
  const wkMon = new Date(monday1); wkMon.setDate(monday1.getDate() + (ww - 1) * 7);
  return wkMon;
}

function semanas(ops) {
  const comOps = [...new Set(ops.filter(o => o.maquina !== 'KANBAN' && o.weekKey).map(o => o.weekKey))].sort();
  const todas = [];
  if (!comOps.length) return todas;
  const mF = /^(\d{4})-W(\d{2})$/.exec(comOps[0]), mL = /^(\d{4})-W(\d{2})$/.exec(comOps[comOps.length - 1]);
  if (!mF || !mL) return todas;
  let yy = parseInt(mF[1], 10), ww = parseInt(mF[2], 10);
  const endYY = parseInt(mL[1], 10), endWW = parseInt(mL[2], 10);
  for (let guarda = 0; guarda < 2000; guarda++) { todas.push(`${yy}-W${pad(ww)}`); if (yy === endYY && ww === endWW) break; ww++; if (ww > 53) { ww = 1; yy++; } }
  for (let i = 0; i < 12; i++) { ww++; if (ww > 53) { ww = 1; yy++; } todas.push(`${yy}-W${pad(ww)}`); }
  return todas;
}

/**
 * Alocação diária de todas as ordens DS100.
 * Devolve Map id -> { inicio: Date (1.º dia com frascos), fim: Date (último dia), frascos, colocados, porDia: [{data, frascos}] }.
 * `ops` = blob planeamento_ds100_v3.data (inclui VAZIO e reservas: ocupam capacidade como na app);
 * `settings` = blob planeamento_vocus_settings_v1.data (a app usa o mesmo SETTINGS para VOCUS e DS100).
 */
function calcularPlano(ops, settings) {
  const S = Object.assign({ ds100DailyTarget: 15000 }, settings || {});
  const res = new Map();
  const semanasDados = semanas(ops).map(key => ({ key, monday: segundaDe(key), ops: ops.filter(o => o.maquina !== 'KANBAN' && o.weekKey === key).sort((a, b) => (a.sortIdx ?? 0) - (b.sortIdx ?? 0)) })).filter(w => w.monday);
  let carry = [];
  for (const w of semanasDados) {
    const usado = new Array(DIAS).fill(0); const novoCarry = [];
    const lista = [...carry.map(c => ({ op: c.op, resto: c.resto })), ...w.ops.map(o => ({ op: o, resto: frascos(o) }))];
    let cur = 0;
    for (const item of lista) {
      let rem = item.resto; const porDia = new Array(DIAS).fill(0);
      while (rem > 0 && cur < DIAS) {
        const cap = capDia(S, w.key, cur) - usado[cur];
        if (cap <= 0) { cur++; continue; }
        const colocado = Math.min(rem, cap); porDia[cur] = colocado; usado[cur] += colocado; rem -= colocado;
        if (usado[cur] >= capDia(S, w.key, cur)) cur++;
      }
      const total = porDia.reduce((a, b) => a + b, 0);
      if (total === 0) { novoCarry.push({ op: item.op, resto: item.resto }); continue; }
      const r = res.get(item.op.id) || { inicio: null, fim: null, frascos: frascos(item.op), colocados: 0, porDia: [] };
      porDia.forEach((f, d) => { if (f > 0) { const dt = new Date(w.monday); dt.setDate(dt.getDate() + d); if (!r.inicio) r.inicio = dt; r.fim = dt; r.porDia.push({ data: dt, frascos: f }); } });
      r.colocados += total;
      res.set(item.op.id, r);
      if (rem > 0) novoCarry.push({ op: item.op, resto: rem });
    }
    carry = novoCarry;
  }
  return res;
}

const p2 = n => String(n).padStart(2, '0');
function dataLocal(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }

module.exports = { calcularPlano, frascos, capDia, semanas, segundaDe, dataLocal, ROLHAS_FRASCO };
