// ============================================================
// Motor Densidades — cópia FIEL do agendador da app planeamento-densidades
// (public/index.html, sha256 1563c01403519115…, extraído 2026-10-29 com scratch extrair.js).
// Não editar à mão: o código dentro de criar() é o da app (fecho transitivo de
// calcScheduleForMachineRange + ensureSettingsShape + isoWeekToMonday). Só muda o âmbito:
// DATA e SETTINGS deixam de ser globais e passam a ser injectados.
// Janela de cálculo = a da própria app em _findOpItemStart/freezeSubsequentAutoOps:
// por máquina, todas as weekKeys da máquina + a semana anterior (cursor contínuo).
// ============================================================
'use strict';

function criar(opsIn, settingsIn) {
  const HOUR_MS = 3600 * 1000;

  const DAY_MS = 24 * HOUR_MS;

  const pad = n => String(n).padStart(2, '0');

  function fmtDate(d) { if (!d || isNaN(d)) return ''; return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

  function isoWeekToMonday(weekKey) {
    const m = /^(\d{4})-W(\d{2})$/.exec(weekKey || '');
    if (!m) return null;
    const yy = parseInt(m[1], 10), ww = parseInt(m[2], 10);
    const jan4 = new Date(yy, 0, 4);
    const dayOfJan4 = (jan4.getDay() || 7) - 1;
    const monday1 = new Date(jan4); monday1.setDate(jan4.getDate() - dayOfJan4);
    const weekMonday = new Date(monday1); weekMonday.setDate(monday1.getDate() + (ww - 1) * 7);
    return weekMonday;
  }

  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
  }

  function isoWeekYear(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    return d.getUTCFullYear();
  }

  function weekKey(date) {
    return `${isoWeekYear(date)}-W${pad(isoWeek(date))}`;
  }

  const MACHINES = ['Maq 1 - Linha 9', 'Maq 3 - Linha 10'];

  const DEFAULT_TURNO_BY_DOW = {
    0: { ini: '08:00', fim: '17:00' },
    1: { ini: '08:00', fim: '17:00' },
    2: { ini: '08:00', fim: '17:00' },
    3: { ini: '08:00', fim: '17:00' },
    4: { ini: '08:00', fim: '17:00' },
    5: { ini: '',      fim: ''      },
    6: { ini: '',      fim: ''      },
  };

  const DEFAULT_SETTINGS = {
    // Turnos por DATA específica (chave = "YYYY-MM-DD"). Override do default (DEFAULT_TURNO_BY_DOW).
    turnosPorDia: {},
    turnosPorMaquina: {},  // override por máquina: turnosPorMaquina[machine][dayKey] = {ini, fim, ...}
    setupMin: 10,             // setup entre OPs (fecho + arranque)
    abastecMin: 60,           // abastecimento Logística
    horaLimiteLog: '09:00',   // hora limite Logística
    capacidades: {
      'Maq 1 - Linha 9': { kr8h: 100000, krH: 14600 },
      'Maq 3 - Linha 10':  { kr8h: 36000,  krH: 4500  },
    },
    calibresPorMaquina: {
      'Maq 1 - Linha 9': ['38x240','45x240','45x250','45x260','49x240','49x250','49x260','54x240'],
      'Maq 3 - Linha 10':  ['38x240','45x240','45x250','45x260','49x240','49x250','49x260','54x240'],
    },
    tiposPorMaquina: {
      'Maq 1 - Linha 9': [],   // [] = sem restrição (todos autorizados)
      'Maq 3 - Linha 10':  [],
    },
    ade: {
      massa_le1:      { pct: 50, tol: 5 },
      massa_gt1:      { pct: 65, tol: 5 },
      cliente_resalte:{ pct: 50, tol: 5 },
      cliente_terlano:{ pct: 30, tol: 5 },
    },
    stops: {
      'Maq 1 - Linha 9': [
        { date: '2026-04-25', label: 'Feriado', days: 1 },
        { date: '2026-05-01', label: 'Feriado', days: 1 },
        { date: '2026-06-04', label: 'Corpo Deus', days: 1 },
        { date: '2026-06-10', label: 'Feriado', days: 1 },
      ],
      'Maq 3 - Linha 10': [
        { date: '2026-04-25', label: 'Feriado', days: 1 },
        { date: '2026-05-01', label: 'Feriado', days: 1 },
        { date: '2026-06-04', label: 'Corpo Deus', days: 1 },
        { date: '2026-06-10', label: 'Feriado', days: 1 },
      ],
    },
  };

  let SETTINGS = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  function ensureSettingsShape() {
    // Garante que todas as chaves obrigatórias existem (após merge com server)
    if (!SETTINGS.stops) SETTINGS.stops = {};
    if (!SETTINGS.capacidades) SETTINGS.capacidades = {};
    for (const m of MACHINES) {
      if (!SETTINGS.stops[m]) SETTINGS.stops[m] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.stops[m] || []));
      if (!SETTINGS.capacidades[m]) SETTINGS.capacidades[m] = Object.assign({}, DEFAULT_SETTINGS.capacidades[m]);
    }
    if (!SETTINGS.ade) SETTINGS.ade = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.ade));
    if (!SETTINGS.calibresPorMaquina) SETTINGS.calibresPorMaquina = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.calibresPorMaquina));
    for (const m of MACHINES) {
      if (!Array.isArray(SETTINGS.calibresPorMaquina[m])) {
        SETTINGS.calibresPorMaquina[m] = (DEFAULT_SETTINGS.calibresPorMaquina[m] || []).slice();
      }
    }
    if (!SETTINGS.tiposPorMaquina) SETTINGS.tiposPorMaquina = {};
    for (const m of MACHINES) {
      if (!Array.isArray(SETTINGS.tiposPorMaquina[m])) {
        SETTINGS.tiposPorMaquina[m] = [];
      }
    }
    if (!SETTINGS.turnosPorDia) SETTINGS.turnosPorDia = {};
    if (!SETTINGS.turnosPorMaquina) SETTINGS.turnosPorMaquina = {};
    delete SETTINGS.turnos;
  }

  function getTurnoForDate(date, machine) {
    const key = fmtDate(date);
    if (machine && SETTINGS.turnosPorMaquina && SETTINGS.turnosPorMaquina[machine] && SETTINGS.turnosPorMaquina[machine][key]) {
      const mov = SETTINGS.turnosPorMaquina[machine][key];
      if (mov.fechado) return { ini: '', fim: '', almocoIni:'', almocoFim:'', jantarIni:'', jantarFim:'', fechado: true };
      if (mov.ini || mov.fim || mov.almocoIni || mov.jantarIni) {
        return {
          ini: mov.ini || '', fim: mov.fim || '',
          almocoIni: mov.almocoIni || '', almocoFim: mov.almocoFim || '',
          jantarIni: mov.jantarIni || '', jantarFim: mov.jantarFim || '',
          almocoScope: 'all', jantarScope: 'all',
          _machineOverride: true,
        };
      }
    }
    const ovr = SETTINGS.turnosPorDia && SETTINGS.turnosPorDia[key];
    if (ovr && ovr.fechado) return { ini: '', fim: '', almocoIni:'', almocoFim:'', jantarIni:'', jantarFim:'' };
    if (ovr && (ovr.ini || ovr.fim || ovr.almocoIni || ovr.jantarIni)) {
      return {
        ini: ovr.ini || '', fim: ovr.fim || '',
        almocoIni: ovr.almocoIni || '', almocoFim: ovr.almocoFim || '',
        jantarIni: ovr.jantarIni || '', jantarFim: ovr.jantarFim || '',
        almocoScope: ovr.almocoScope || 'all',
        jantarScope: ovr.jantarScope || 'all',
      };
    }
    const dow = (date.getDay() + 6) % 7;
    const def = DEFAULT_TURNO_BY_DOW[dow] || { ini: '', fim: '' };
    return {
      ini: def.ini || '', fim: def.fim || '',
      almocoIni: def.almocoIni || '', almocoFim: def.almocoFim || '',
      jantarIni: def.jantarIni || '', jantarFim: def.jantarFim || '',
      almocoScope: 'all', jantarScope: 'all',
    };
  }

  function getMealBreaksForDate(date, machine) {
    const t = getTurnoForDate(date, machine);
    const out = [];
    // Determinar limites do turno para posicionar refeições que caem no dia seguinte
    const shift = getShiftRangeForDate(date, machine);
    function _push(iniStr, fimStr, label, scope) {
      if (!iniStr || !fimStr || !/^\d{2}:\d{2}$/.test(iniStr) || !/^\d{2}:\d{2}$/.test(fimStr)) return;
      if (machine && scope && scope !== 'all' && scope !== machine) return;
      const [iH, iM] = iniStr.split(':').map(Number);
      const [fH, fM] = fimStr.split(':').map(Number);
      let start = new Date(date); start.setHours(iH, iM, 0, 0);
      let end   = new Date(date); end.setHours(fH, fM, 0, 0);
      // Refeição atravessa meia-noite → fim no dia seguinte
      if (end <= start) end.setDate(end.getDate() + 1);
      // Turno noturno: se refeição ficou ANTES do início do turno, empurrar para dia seguinte
      if (shift && shift.end.getDate() !== shift.start.getDate() && start < shift.start) {
        start.setDate(start.getDate() + 1);
        end.setDate(end.getDate() + 1);
      }
      if (end > start) out.push({ start, end, label });
    }
    _push(t.almocoIni, t.almocoFim, 'Almoço', t.almocoScope || 'all');
    _push(t.jantarIni, t.jantarFim, 'Jantar', t.jantarScope || 'all');
    return out;
  }

  function getStops(machine) { return SETTINGS.stops[machine] || []; }

  let DATA = [];

  function isDayClosed(dayKey) {
    const t = SETTINGS.turnosPorDia && SETTINGS.turnosPorDia[dayKey];
    return !!(t && t.fechado);
  }

  function getStartHourForDate(date, machine) {
    const t = getTurnoForDate(date, machine);
    if (t.ini) {
      const [h, m] = t.ini.split(':').map(Number);
      return { h, m };
    }
    return { h: 7, m: 0 };
  }

  function getStopRange(stop) {
    const baseDate = new Date(stop.date + 'T00:00');
    const days = stop.days || 1;
    const hasStart = stop.startTime && /^\d{2}:\d{2}$/.test(stop.startTime);
    const hasEnd = stop.endTime && /^\d{2}:\d{2}$/.test(stop.endTime);
    const start = new Date(baseDate);
    const end = new Date(baseDate);
    if (hasStart && hasEnd) {
      const [sh, sm] = stop.startTime.split(':').map(Number);
      const [eh, em] = stop.endTime.split(':').map(Number);
      start.setHours(sh, sm, 0, 0);
      end.setDate(end.getDate() + days - 1);
      end.setHours(eh, em, 0, 0);
    } else {
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + days);
      end.setHours(0, 0, 0, 0);
    }
    return { start, end, label: stop.label || 'Paragem' };
  }

  function getShiftRangeForDate(date, machine) {
    if (isDayClosed(fmtDate(date))) return null;
    const t = getTurnoForDate(date, machine);
    if (!t.ini || !t.fim) return null;
    const [iH, iM] = t.ini.split(':').map(Number);
    const [fH, fM] = t.fim.split(':').map(Number);
    const start = new Date(date); start.setHours(iH, iM, 0, 0);
    const end = new Date(date); end.setHours(fH, fM, 0, 0);
    // Turno noturno: fim antes/igual ao início → fim é no DIA SEGUINTE
    if (end <= start) end.setDate(end.getDate() + 1);
    return { start, end };
  }

  function nextDayMidnight(date) {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function advanceWithinShiftsSegmented(startCursor, durMs, stopRanges, machine) {
    const sortedStops = stopRanges.slice().sort((a, b) => a.start - b.start);
    function inStop(c) { for (const s of sortedStops) if (c >= s.start && c < s.end) return s; return null; }
    function nextStopAfter(c) { for (const s of sortedStops) if (s.start > c) return s; return null; }
    const segments = [];
    let cursor = new Date(startCursor.getTime());
    let remaining = durMs;
    let segStart = null;
    let segProdMs = 0;  // tempo PRODUTIVO acumulado no segmento (exclui paragens intermédias)
    const _pushSeg = (endDate) => { segments.push({ start: segStart, end: endDate, prodMs: segProdMs }); segStart = null; segProdMs = 0; };
    const MAX_ITER = 600;
    let iter = 0;
    function _findActiveShift(c) {
      // 1) Turno de "hoje" (data operacional = data do cursor)
      let s = getShiftRangeForDate(c, machine);
      if (s && c >= s.start && c < s.end) return s;
      // 2) Turno de "ontem" (nocturno que atravessa meia-noite)
      const yst = new Date(c); yst.setDate(yst.getDate() - 1); yst.setHours(12,0,0,0);
      const ysh = getShiftRangeForDate(yst, machine);
      if (ysh && c >= ysh.start && c < ysh.end) return ysh;
      // 3) Turno futuro (cursor ainda antes do início)
      if (s && c < s.start) return s;
      return null;
    }
    function _nextDayAfterShiftStart(s) {
      const d = new Date(s.start);
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    while (remaining > 0 && iter++ < MAX_ITER) {
      const shift = _findActiveShift(cursor);
      if (!shift) {
        if (segStart) _pushSeg(new Date(cursor.getTime()));
        cursor = nextDayMidnight(cursor);
        continue;
      }
      if (cursor < shift.start) cursor = new Date(shift.start);
      if (cursor >= shift.end) {
        if (segStart) _pushSeg(new Date(cursor.getTime()));
        cursor = _nextDayAfterShiftStart(shift);
        continue;
      }
      const sNow = inStop(cursor);
      if (sNow) { cursor = new Date(sNow.end); continue; }
      if (segStart === null) segStart = new Date(cursor.getTime());
      const sNext = nextStopAfter(cursor);
      let limit = shift.end;
      if (sNext && sNext.start < limit) limit = sNext.start;
      const available = limit - cursor;
      if (remaining <= available) {
        const end = new Date(cursor.getTime() + remaining);
        segProdMs += remaining;
        segments.push({ start: segStart, end, prodMs: segProdMs });
        return segments;
      }
      remaining -= available;
      segProdMs += available;
      cursor = new Date(limit);
      if (cursor.getTime() === shift.end.getTime()) {
        // fim de turno → fecha segmento, próximo turno operacional
        _pushSeg(new Date(cursor.getTime()));
        cursor = _nextDayAfterShiftStart(shift);
      }
      // se for paragem intermédia, segStart continua e o loop saltará a paragem
    }
    if (segStart) _pushSeg(new Date(cursor.getTime()));
    return segments;
  }

  function calcScheduleForMachineRange(machine, weeks) {
    return _calcScheduleCore(machine, weeks);
  }

  function _calcScheduleCore(machine, weeks) {
    // Ordenar OPs por (weekKey cronológico, diaIdx, sortIdx)
    const weekKeys = weeks.map(w => w.key);
    const ops = DATA.filter(o => o.maquina === machine && weekKeys.includes(o.weekKey))
                    .sort((a, b) => {
                      if (a.weekKey !== b.weekKey) return a.weekKey.localeCompare(b.weekKey);
                      return ((a.diaIdx ?? 0) - (b.diaIdx ?? 0)) || ((a.sortIdx ?? 0) - (b.sortIdx ?? 0));
                    });
    const weekByKey = {};
    for (const w of weeks) weekByKey[w.key] = w;
    const firstMonday = weeks[0].monday;
    const startH = getStartHourForDate(firstMonday, machine);
    let cursor = new Date(firstMonday);
    cursor.setHours(startH.h, startH.m, 0, 0);
    const krH = (SETTINGS.capacidades[machine] && SETTINGS.capacidades[machine].krH) || 0;
    const lastMonday = weeks[weeks.length - 1].monday;
    const lookEnd = new Date(lastMonday.getTime() + 28 * DAY_MS);
    let stopRanges = getStops(machine).map(getStopRange).filter(s => s.end > cursor && s.start < lookEnd);
    for (let d = new Date(firstMonday); d < lookEnd; d.setDate(d.getDate() + 1)) {
      const meals = getMealBreaksForDate(d, machine);
      for (const m of meals) {
        if (m.end > cursor && m.start < lookEnd) stopRanges.push(m);
      }
    }
    const SETUP_MS = (SETTINGS.setupMin || 10) * 60 * 1000;
    // Regra forte: cada OP arranca em max(cursor, dayStart do seu diaIdx).
    // Nunca arranca ANTES do dia escolhido — mesmo que haja capacidade num dia anterior.
    // Se houver outras OPs com mesmo diaIdx, cascateiam (cursor já avançou) dentro desse dia.
    const result = [];
    for (const op of ops) {
      // Duração: derivada de qtdEntrada / krH (auto-puro)
      let durH = krH > 0 && op.qtdEntrada > 0 ? (op.qtdEntrada / krH) : 0;
      const dayIdx = op.diaIdx || 0;
      let startPoint;
      // weekStart desta OP (semana específica)
      const opWeekStart = weekByKey[op.weekKey] ? weekByKey[op.weekKey].monday : firstMonday;
      if (op.inicioMode === 'manual' && op.hInicioP && /^\d{2}:\d{2}$/.test(op.hInicioP)) {
        const [hh, mm] = op.hInicioP.split(':').map(Number);
        const dayDate = new Date(opWeekStart);
        dayDate.setDate(opWeekStart.getDate() + dayIdx);
        dayDate.setHours(hh, mm, 0, 0);
        startPoint = dayDate;
      } else {
        const dayDate = new Date(opWeekStart);
        dayDate.setDate(opWeekStart.getDate() + dayIdx);
        const startH2 = getStartHourForDate(dayDate, machine);
        const dayStart = new Date(dayDate);
        dayStart.setHours(startH2.h, startH2.m, 0, 0);
        startPoint = (cursor.getTime() > dayStart.getTime()) ? cursor : dayStart;
      }
      // Tempo de atraso manual (HH:MM) — somar à duração planeada
      // Regra: se a OP tem realPorDia com chaves, usa-se SÓ os atrasos por dia
      // (evita dupla contagem com o legacy op.tempoAtraso que pode estar
      // replicado entre os dois sítios).
      let atrasoMin = 0;
      const _parseAtraso = (s) => {
        if (!s || !/^-?\d{1,2}:\d{2}$/.test(s)) return 0;
        const sign = s.startsWith('-') ? -1 : 1;
        const clean = s.replace('-', '');
        const [h, m] = clean.split(':').map(Number);
        return sign * (h * 60 + m);
      };
      const _rpd = op.realPorDia;
      const _hasRpd = _rpd && typeof _rpd === 'object' && Object.keys(_rpd).length > 0;
      if (_hasRpd) {
        for (const k in _rpd) {
          atrasoMin += _parseAtraso((_rpd[k] || {}).tempoAtraso || '');
        }
      } else {
        atrasoMin += _parseAtraso(op.tempoAtraso || '');
      }
      const totalDurMs = (durH * HOUR_MS) + (atrasoMin * 60 * 1000);
      const segs = advanceWithinShiftsSegmented(startPoint, totalDurMs, stopRanges, machine);
      if (segs.length === 0) {
        // edge case (durH<=0): cria 1 item zero
        result.push({ op, start: startPoint, end: startPoint, durH: 0, segIdx: 0, totalSegs: 1, qtdSeg: op.qtdEntrada || 0 });
        cursor = new Date(startPoint.getTime() + SETUP_MS);
        continue;
      }
      // durH_pura = tempo produtivo total esperado (SEM atraso) — usado para distribuir qtdEntrada.
      // Regra "atraso desloca produção":
      //   O tempo cronológico de cada segmento inclui atraso (se o dia tiver atraso registado
      //   em realPorDia[dayKey].tempoAtraso). Ao calcular qtdSeg, subtraímos o atraso desse dia
      //   ao prodMs — as rolhas "perdidas" nesse dia passam naturalmente para o segmento
      //   seguinte porque o cursor avançou mais no tempo cronológico.
      const durMsPuro = durH * HOUR_MS;
      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s];
        const segMs = seg.end - seg.start;                        // tempo cronológico
        const prodMs = (seg.prodMs != null) ? seg.prodMs : segMs; // tempo dentro dos turnos (inclui atraso)
        // Se este segmento tem atraso associado ao seu dia, subtraí-lo (não conta como produtivo)
        const _segDayKey = fmtDate(seg.start);
        const _rpdOfDay  = _rpd && _rpd[_segDayKey];
        const _atrasoSegMin = _rpdOfDay ? _parseAtraso(_rpdOfDay.tempoAtraso || '') : 0;
        // Se não há realPorDia mas há legacy tempoAtraso, imputá-lo ao primeiro segmento
        const _atrasoSegLegacy = (!_hasRpd && s === 0) ? _parseAtraso(op.tempoAtraso || '') : 0;
        const _atrasoSegMs = (_atrasoSegMin + _atrasoSegLegacy) * 60 * 1000;
        const prodMsReal = Math.max(0, prodMs - _atrasoSegMs);
        const fraction = durMsPuro > 0 ? (prodMsReal / durMsPuro) : (1 / segs.length);
        result.push({
          op,
          start: seg.start,
          end: seg.end,
          durH: segMs / HOUR_MS,
          segIdx: s,
          totalSegs: segs.length,
          qtdSeg: (op.qtdEntrada || 0) * fraction,
        });
      }
      cursor = new Date(segs[segs.length - 1].end.getTime() + SETUP_MS);
    }
    return result;
  }

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
