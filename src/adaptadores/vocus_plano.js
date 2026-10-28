// ============================================================
// Plano VOCUS — porte fiel do algoritmo do PlannerCork (calcScheduleForWeek + cadeia contínua por máquina)
// Fonte: index.html do PlannerCork (funções calcScheduleForWeek, advanceSkippingStops, getStopRange,
// getShiftOffRanges, getRate/getOeeFor, getStartHour), lido a 28/10/2026.
// Regras (iguais à app):
//   · por máquina, semanas (weekKey) por ordem; dentro da semana por sortIdx; cursor contínuo entre semanas
//   · 1.ª semana arranca na segunda-feira às SETTINGS.startTime (06:00)
//   · duração = (qc + reprocessoC5) / (rate × OEE da máquina) horas + tempoParagem/60
//   · startMode 'manual' + startManual válido força o cursor (para a frente ou para trás)
//   · paragens (SETTINGS.stops[máquina]) e períodos de turno reduzido (shiftPeriods) são saltados
//   · setup de SETTINGS.setupMinutes (10) entre ordens
//   · inclui ordens concluídas (a app também as encadeia) — o plano é o do PlannerCork, não uma estimativa nossa
// Datas em hora LOCAL de Lisboa: o servidor tem de correr com TZ=Europe/Lisbon (server.js força-o).
// ============================================================
'use strict';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_SETTINGS = {
  startTime: '06:00', rate: 1800, setupMinutes: 10,
  oee: { v1: 0.77, v2: 0.77, v3: 0.77 },
  stops: { 'Vocus 1': [], 'Vocus 2': [], 'Vocus 3': [] },
  shiftPeriods: [],
};

function oeeDe(S, maquina) {
  if (!S.oee) return 1;
  const key = maquina === 'Vocus 1' ? 'v1' : maquina === 'Vocus 2' ? 'v2' : maquina === 'Vocus 3' ? 'v3' : null;
  if (key && S.oee[key] !== undefined) return S.oee[key] || 1;
  return 1;
}
function rateDe(S, maquina) { return (S.rate || 1800) * oeeDe(S, maquina); }
function horaInicio(S) { const t = S.startTime || '06:00'; const [h, m] = t.split(':').map(Number); return { h, m }; }

function intervaloParagem(stop) {
  const base = new Date(stop.date + 'T00:00'); const days = stop.days || 1;
  const hasStart = stop.startTime && /^\d{2}:\d{2}$/.test(stop.startTime); const hasEnd = stop.endTime && /^\d{2}:\d{2}$/.test(stop.endTime);
  const start = new Date(base); const end = new Date(base);
  if (hasStart && hasEnd) { const [sh, sm] = stop.startTime.split(':').map(Number); const [eh, em] = stop.endTime.split(':').map(Number); start.setHours(sh, sm, 0, 0); end.setDate(end.getDate() + days - 1); end.setHours(eh, em, 0, 0); }
  else { start.setHours(0, 0, 0, 0); end.setDate(end.getDate() + days); end.setHours(0, 0, 0, 0); }
  return { start, end, label: stop.label || 'Paragem' };
}

function intervalosTurnoReduzido(S) {
  if (!Array.isArray(S.shiftPeriods)) return [];
  const ranges = [];
  for (const p of S.shiftPeriods) {
    if (!p.dateStart || !p.dateEnd || !p.timeStart || !p.timeEnd) continue;
    const start = new Date(p.dateStart + 'T00:00'); const end = new Date(p.dateEnd + 'T00:00');
    if (end < start) continue;
    const [sh, sm] = p.timeStart.split(':').map(Number); const [eh, em] = p.timeEnd.split(':').map(Number);
    const cur = new Date(start);
    if (sh > 0 || sm > 0) { const a = new Date(cur); a.setHours(0, 0, 0, 0); const b = new Date(cur); b.setHours(sh, sm, 0, 0); ranges.push({ start: a, end: b, label: 'Off-shift' }); }
    while (cur <= end) {
      const offStart = new Date(cur); offStart.setHours(eh, em, 0, 0);
      const next = new Date(cur); next.setDate(next.getDate() + 1); next.setHours(sh, sm, 0, 0);
      const offEnd = (cur.getTime() === end.getTime()) ? new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0, 0) : next;
      if (offEnd > offStart) ranges.push({ start: offStart, end: offEnd, label: 'Off-shift' });
      cur.setDate(cur.getDate() + 1);
    }
  }
  return ranges;
}

function avancarSaltandoParagens(startCursor, durMs, stopRanges) {
  const sorted = stopRanges.slice().sort((a, b) => a.start - b.start);
  let cursor = new Date(startCursor.getTime());
  for (const s of sorted) { if (cursor >= s.start && cursor < s.end) cursor = new Date(s.end.getTime()); }
  const actualStart = new Date(cursor.getTime()); let remaining = durMs;
  for (const s of sorted) {
    if (s.end <= cursor) continue;
    if (s.start >= new Date(cursor.getTime() + remaining)) break;
    const gap = s.start - cursor;
    if (gap > 0 && gap < remaining) { remaining -= gap; cursor = new Date(s.end.getTime()); }
    else if (gap <= 0) cursor = new Date(s.end.getTime());
  }
  return { start: actualStart, end: new Date(cursor.getTime() + remaining) };
}

/** Segunda-feira (local, 00:00) de 'YYYY-Www' — mesmo cálculo da app (jan4). */
function segundaDe(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey || ''); if (!m) return null;
  const jan4 = new Date(parseInt(m[1], 10), 0, 4);
  const dow = (jan4.getDay() || 7) - 1;
  const monday1 = new Date(jan4); monday1.setDate(jan4.getDate() - dow);
  const weekMonday = new Date(monday1); weekMonday.setDate(monday1.getDate() + (parseInt(m[2], 10) - 1) * 7);
  return weekMonday;
}

function planoSemana(S, ops, maquina, weekKey, weekStart, initialCursor) {
  const lista = ops.filter(o => o.maquina === maquina && o.weekKey === weekKey).sort((a, b) => (a.sortIdx ?? 0) - (b.sortIdx ?? 0));
  const sh = horaInicio(S);
  const naturalStart = new Date(weekStart); naturalStart.setHours(sh.h, sh.m, 0, 0);
  let cursor = (initialCursor instanceof Date && !isNaN(initialCursor.getTime())) ? new Date(initialCursor.getTime()) : naturalStart;
  const rate = rateDe(S, maquina); const lookEnd = new Date(weekStart.getTime() + 28 * DAY_MS);
  const stopRanges = ((S.stops && S.stops[maquina]) || []).map(intervaloParagem).filter(s => s.end > cursor && s.start < lookEnd);
  for (const s of intervalosTurnoReduzido(S).filter(s => s.end > cursor && s.start < lookEnd)) stopRanges.push(s);
  const setupMin = Number.isFinite(S.setupMinutes) ? S.setupMinutes : 10;
  const SETUP_MS = setupMin * 60 * 1000;
  const out = lista.map(op => {
    const reprC5 = (+op.reprocessoC5) || 0;
    const tempoParagemMin = (+op.tempoParagem) || 0;
    const totalQc = (+op.qc || 0) + reprC5;
    const durH = (totalQc > 0 ? (totalQc / rate) : 0) + (tempoParagemMin / 60);
    let manual = false;
    if (op.startMode === 'manual' && op.startManual) {
      const forced = new Date(op.startManual);
      if (!isNaN(forced.getTime())) { cursor = new Date(forced.getTime()); manual = true; }
    }
    const { start, end } = avancarSaltandoParagens(cursor, durH * HOUR_MS, stopRanges);
    cursor = new Date(end.getTime() + SETUP_MS);
    return { id: op.id, start, end, durH, manual };
  });
  out.finalCursor = cursor;
  return out;
}

/**
 * Plano de todas as ordens VOCUS: Map id -> {start, end, durH, manual} (Date locais).
 * `ops` = blob planeamento_vocus_v6.data; `settings` = blob planeamento_vocus_settings_v1.data (ou vazio).
 */
function calcularPlano(ops, settings) {
  const S = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), settings || {});
  const res = new Map();
  const maquinas = [...new Set(ops.filter(o => o.maquina && o.maquina !== 'KANBAN' && o.weekKey).map(o => o.maquina))];
  for (const maquina of maquinas) {
    const semanas = [...new Set(ops.filter(o => o.maquina === maquina && o.weekKey).map(o => o.weekKey))].sort();
    let cursor = null;
    for (const wk of semanas) {
      const seg = segundaDe(wk); if (!seg) continue;
      const sched = planoSemana(S, ops, maquina, wk, seg, cursor);
      for (const it of sched) res.set(it.id, it);
      cursor = sched.finalCursor || cursor;
    }
  }
  return res;
}

const p2 = n => String(n).padStart(2, '0');
function dataLocal(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function horaLocal(d) { return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }

module.exports = { calcularPlano, planoSemana, segundaDe, avancarSaltandoParagens, intervaloParagem, intervalosTurnoReduzido, dataLocal, horaLocal, DEFAULT_SETTINGS };
