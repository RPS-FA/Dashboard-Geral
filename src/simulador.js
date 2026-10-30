// ============================================================
// Simulador de cenários + planos (barras de Gantt) por ordem.
// Corre os MOTORES PORTADOS das apps (cópias fiéis, validadas contra cada app) sobre CÓPIAS
// dos dados que o agregador leu. Nunca escreve nas apps: as alterações vivem só neste pedido.
//
// Motores: Densidades, DSL, DSL Talis, WIM (src/motores/*), VOCUS e DS100 (src/adaptadores/*_plano.js).
// PureCork fica de fora (pedido do Rui Pedro, 29/10/2026).
// Sem propagação entre secções: a app de uma secção não conhece as outras. O simulador mostra o
// impacto dentro de cada secção alterada e o efeito nas encomendas (Pedido_Item) ligadas.
// ============================================================
'use strict';
const U = require('./util');

const MOT = {
  densidades: require('./motores/densidades'),
  dsl: require('./motores/dsl'),
  talis: require('./motores/talis'),
  wim: require('./motores/wim'),
  vocus: require('./adaptadores/vocus_plano'),
  ds100: require('./adaptadores/ds100_plano'),
};
const FONTES_SIM = Object.keys(MOT);
const ROTULO = { densidades: 'DENSIDADES', dsl: 'DSL', talis: 'DSL TALIS', wim: 'WIM', vocus: 'VOCUS', ds100: 'DS100' };
const UN_QTD = { densidades: 'rolhas', dsl: 'milheiros', talis: 'unidades', wim: 'rolhas', vocus: 'unidades (qc)', ds100: 'rolhas' };
const CAMPO_QTD = { densidades: 'qtdEntrada', dsl: 'qtd', talis: 'qtd', wim: 'qtd', vocus: 'qc', ds100: 'qtEntrada' };
const MAQ_DENS = ['Maq 1 - Linha 9', 'Maq 3 - Linha 10'];
const FASE_WIM = { W: 'Wash', I: 'Innocork', M: 'Make-up' };

const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const p2 = n => String(n).padStart(2, '0');
function iso(d) { return d && !isNaN(d) ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` : null; }
function diaDe(d) { return d && !isNaN(d) ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : null; }
function dLocal(ds, hm) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ds || ''); if (!m) return null; const h = /^(\d{1,2}):(\d{2})/.exec(hm || '') || [0, 0, 0]; return new Date(+m[1], +m[2] - 1, +m[3], +h[1], +h[2]); }
function semanaDia(ds) { const d = dLocal(ds); return { weekKey: U.semanaISO(ds), diaIdx: (d.getDay() + 6) % 7 }; }
function diasEntre(de, ate) { const out = []; let d = de; for (let i = 0; i < 400 && d <= ate; i++) { out.push(d); d = U.addDias(d, 1); } return out; }
// Talis: datas em UTC usado como hora de parede (08:00Z = 08:00 na fábrica)
function paredeUTC(v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()); }
function nomeLinhaDsl(l) { return l ? (/^\d+$/.test(l) ? `Linha ${l}` : l) : null; }
const chaveDe = (fonte, opId, fase) => `${fonte}-${opId}` + (fase ? `|${fase}` : '');
const idDash = chave => chave.split('|')[0];

// ------------------------------------------------------------
// Planos: Map chave -> barra { chave, fonte, id, op_id, fase, maquina, maq_motor, inicio, fim, so_dia, segs }
// ------------------------------------------------------------
function barra(fonte, opId, fase, maqMotor, maqRotulo, inicio, fim, segs, soDia) {
  return { chave: chaveDe(fonte, opId, fase), fonte, id: `${fonte}-${opId}`, op_id: String(opId), fase: fase || null, maq_motor: maqMotor, maquina: maqRotulo, inicio, fim, so_dia: !!soDia, segs: segs || [] };
}

function calcularPlano(fonte, b) {
  const out = new Map();
  const put = x => { if (x.inicio && x.fim && !isNaN(x.inicio) && !isNaN(x.fim)) out.set(x.chave, x); };
  if (!b) return out;
  if (fonte === 'densidades') {
    for (const [id, x] of MOT.densidades.calcularPlano(b.ops, b.settings)) put(barra(fonte, id, null, x.maquina, x.maquina, x.inicio, x.fim, x.segs.map(s => ({ inicio: s.inicio, fim: s.fim }))));
  } else if (fonte === 'dsl') {
    for (const [id, x] of MOT.dsl.calcularPlano(b.ops, b.settings, 'eff')) put(barra(fonte, id, null, x.maquina, nomeLinhaDsl(x.maquina), x.inicio, x.fim, x.segs.map(s => ({ inicio: s.inicio, fim: s.fim }))));
  } else if (fonte === 'talis') {
    for (const [id, x] of MOT.talis.calcularPlano(b.ops, b.config)) {
      const segs = (x.fatias || []).filter(f => f.ini && f.fim).map(f => ({ inicio: paredeUTC(f.ini), fim: paredeUTC(f.fim) }));
      put(barra(fonte, id, null, x.maquina, x.maquina, paredeUTC(x.inicio), paredeUTC(x.fim), segs));
    }
  } else if (fonte === 'vocus') {
    const maq = new Map((b.ops || []).map(o => [String(o.id), o.maquina]));
    for (const [id, x] of MOT.vocus.calcularPlano(b.ops || [], b.settings)) { const m = maq.get(String(id)); put(barra(fonte, id, null, m, m, x.start, x.end, [{ inicio: x.start, fim: x.end }])); }
  } else if (fonte === 'ds100') {
    for (const [id, x] of MOT.ds100.calcularPlano(b.ops || [], b.settings)) {
      if (!x.inicio || !x.fim) continue;
      const ini = new Date(x.inicio.getFullYear(), x.inicio.getMonth(), x.inicio.getDate());
      // barras "só dia": fim às 23:59 do último dia (assim o dia do fim é o certo)
      const fim = new Date(x.fim.getFullYear(), x.fim.getMonth(), x.fim.getDate(), 23, 59);
      const segs = (x.porDia || []).map(p => ({ inicio: new Date(p.data.getFullYear(), p.data.getMonth(), p.data.getDate()), fim: new Date(p.data.getFullYear(), p.data.getMonth(), p.data.getDate(), 23, 59), qtd: p.frascos }));
      put(barra(fonte, id, null, 'DS100', 'DS100', ini, fim, segs, true));
    }
  } else if (fonte === 'wim') {
    for (const x of MOT.wim.calcularPlano(b.ops, b.settings).values()) {
      const fimDia = d => (x.so_dia ? new Date(d.getTime() - 60000) : d); // Make-up só dia: 00:00 → 23:59
      put(barra(fonte, x.id, x.fase, x.maquina, x.maquina || FASE_WIM[x.fase], x.inicio, fimDia(x.fim), x.segs.map(s => ({ inicio: s.inicio, fim: fimDia(s.fim) })), x.so_dia));
    }
  }
  return out;
}

// Planos base em cache: um por objecto "bruto" (o agregador cria um novo a cada leitura).
const CACHE = new WeakMap();
function planoBase(fonte, b) {
  if (!b) return new Map();
  let c = CACHE.get(b);
  if (!c) { c = calcularPlano(fonte, b); CACHE.set(b, c); }
  return c;
}

// Funde segmentos quase contíguos (≤ 60 min) para aliviar o JSON das barras.
function fundirSegs(segs) {
  const s = segs.filter(x => x.inicio && x.fim).sort((a, b) => a.inicio - b.inicio); const out = [];
  for (const x of s) { const u = out[out.length - 1]; if (u && x.inicio - u.fim <= 3600000) { if (x.fim > u.fim) u.fim = x.fim; } else out.push({ inicio: x.inicio, fim: x.fim }); }
  return out;
}
function serial(bb, comSegs) {
  const o = { fonte: bb.fonte, unidade: ROTULO[bb.fonte], fase: bb.fase, fase_label: bb.fase ? FASE_WIM[bb.fase] : null, maquina: bb.maquina, ini: iso(bb.inicio), fim: iso(bb.fim), so_dia: bb.so_dia };
  if (comSegs) o.segs = fundirSegs(bb.segs).map(s => [iso(s.inicio), iso(s.fim)]);
  return o;
}

/** Barras base por ordem do dashboard: Map id -> [barra serializada] (WIM: uma por fase). */
function barrasPorOrdem(brutos) {
  const m = new Map();
  for (const f of FONTES_SIM) {
    const b = brutos[f]; if (!b) continue;
    let plano; try { plano = planoBase(f, b); } catch (e) { console.warn(`[simulador] motor ${f} falhou: ${e.message}`); continue; } // uma fonte com dados estranhos não apaga as outras
    for (const bb of plano.values()) { const a = m.get(bb.id) || []; a.push(serial(bb, true)); m.set(bb.id, a); }
  }
  for (const a of m.values()) a.sort((x, y) => String(x.ini).localeCompare(String(y.ini)));
  return m;
}

// ------------------------------------------------------------
// Alterações de cenário (aplicadas a uma CÓPIA do bruto da fonte)
// ------------------------------------------------------------
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/, RE_HORA = /^\d{1,2}:\d{2}$/;
function lista(fonte, b) { return Array.isArray(b.ops) ? b.ops : []; }
function acharOp(fonte, b, dashId) {
  const raw = String(dashId || '').startsWith(fonte + '-') ? String(dashId).slice(fonte.length + 1) : String(dashId || '');
  return lista(fonte, b).find(o => String(o.id) === raw) || null;
}
const num = v => (v === '' || v == null ? 0 : +v || 0);

// Campos de posicionamento por fonte/fase (motores com dia + ordem no dia)
function camposDia(fonte, fase) {
  if (fonte === 'densidades') return { maq: 'maquina', wk: 'weekKey', dia: 'diaIdx', sort: 'sortIdx' };
  if (fonte === 'dsl') return { maq: 'linha', wk: 'weekKey', dia: 'diaIdx', sort: 'sortIdx' };
  if (fonte === 'wim' && fase === 'W') return { maq: 'w_maq', wk: 'w_wk', dia: 'w_dia', sort: 'w_sort' };
  if (fonte === 'wim' && fase === 'I') return { maq: 'i_maq', wk: 'i_wk', dia: 'i_dia', sort: 'i_sort' };
  return null;
}
function limparManual(fonte, op, fase) {
  if (fonte === 'densidades' || fonte === 'dsl') { if (op.inicioMode === 'manual') op.inicioMode = 'auto'; }
  else if (fonte === 'talis') { if (op.inicio_modo === 'manual') op.inicio_modo = 'auto'; delete op.inicio_manual; }
  else if (fonte === 'vocus') { if (op.startMode === 'manual') op.startMode = 'auto'; }
  else if (fonte === 'wim') { const p = fase === 'I' ? 'i' : 'w'; if (op[p + '_mode'] === 'manual') op[p + '_mode'] = 'auto'; }
}
function prepararInno(op, ops) {
  op.i_manual = true; delete op.i_bseq; delete op.i_dayB;
  if (!op.i_maq) op.i_maq = 'INNOCORK';
}
function mesmoDia(lst, op, F, maqVal, wk, dia) { return lst.filter(o => o !== op && o[F.maq] === maqVal && o[F.wk] === wk && num(o[F.dia]) === dia); }

function aplicarQtd(fonte, b, alt) {
  const op = acharOp(fonte, b, alt.ordem); if (!op) return { erro: 'ordem não encontrada' };
  const v = Number(alt.valor); if (!Number.isFinite(v) || v < 0) return { erro: 'quantidade inválida' };
  const campo = CAMPO_QTD[fonte]; const antes = op[campo]; op[campo] = v;
  return { ok: true, descricao: `quantidade ${antes ?? '—'} → ${v} ${UN_QTD[fonte]}` };
}

function aplicarMover(fonte, b, alt, base) {
  const op = acharOp(fonte, b, alt.ordem); if (!op) return { erro: 'ordem não encontrada' };
  const ops = lista(fonte, b);
  const fase = fonte === 'wim' ? (alt.fase || 'W') : null;
  if (fonte === 'wim' && fase === 'M') return { erro: 'Make-up: a app só define o dia (fim da Lavação + 1 dia útil). Altera a Lavação para ver o efeito.' };
  if (fonte === 'wim' && fase === 'W' && !op.temW) return { erro: 'a ordem não tem fase Wash' };
  if (fonte === 'wim' && fase === 'I' && !op.temI) return { erro: 'a ordem não tem fase Innocork' };
  const x = alt.antes_de ? acharOp(fonte, b, alt.antes_de) : null;
  if (alt.antes_de && !x) return { erro: 'ordem de referência não encontrada' };
  if (!x && !RE_DIA.test(alt.data || '')) return { erro: 'indica a data (AAAA-MM-DD) ou a ordem de referência' };
  const avisos = [];
  limparManual(fonte, op, fase);
  const F = camposDia(fonte, fase);
  if (F) {
    if (fase === 'I') { prepararInno(op, ops); avisos.push('INNO: a ordem fica com dia fixo; a sequência fina por batch (i_bseq) desta ordem é ignorada'); }
    if (x) {
      let wk = x[F.wk], dia = num(x[F.dia]);
      if (fase === 'I' && !(x.i_manual && x.i_wk)) { const bx = base.get(chaveDe(fonte, x.id, 'I')); if (bx) ({ weekKey: wk, diaIdx: dia } = semanaDia(diaDe(bx.inicio))); }
      op[F.maq] = x[F.maq] || op[F.maq]; op[F.wk] = wk; op[F.dia] = dia; op[F.sort] = num(x[F.sort]) - 0.5;
    } else {
      const sd = semanaDia(alt.data);
      if (alt.maquina) op[F.maq] = alt.maquina;
      op[F.wk] = sd.weekKey; op[F.dia] = sd.diaIdx;
      const ms = mesmoDia(ops, op, F, op[F.maq], sd.weekKey, sd.diaIdx).map(o => num(o[F.sort]));
      op[F.sort] = alt.posicao === 'fim' ? (ms.length ? Math.max(...ms) + 1 : 0) : (ms.length ? Math.min(...ms) - 1 : 0);
    }
    if (fonte === 'dsl' && op.buffer) avisos.push('a ordem está no Buffer da app');
    return { ok: true, avisos, descricao: x ? `mover para antes de ${x.op || x.ordem || x.id}` : `mover para ${alt.data} (${alt.posicao === 'fim' ? 'fim' : 'início'} do dia${alt.maquina ? ', ' + alt.maquina : ''})` };
  }
  if (fonte === 'talis') {
    const ord = o => (o.ordem ?? 999);
    if (x) { op.linha = x.linha; op.ordem = ord(x) - 0.5; op.dia_fixo = x.dia_fixo || null; }
    else {
      if (alt.maquina) op.linha = alt.maquina;
      op.dia_fixo = alt.data;
      const outros = ops.filter(o => o !== op && o.linha === op.linha).sort((a, c) => ord(a) - ord(c));
      const dIni = o => { const bb = base.get(chaveDe(fonte, o.id)); return bb ? diaDe(bb.inicio) : (o.dia_fixo || null); };
      if (alt.posicao === 'fim') { const ult = outros.filter(o => dIni(o) && dIni(o) <= alt.data).pop(); op.ordem = ult ? ord(ult) + 0.5 : (outros.length ? ord(outros[0]) - 1 : 0); }
      else { const prim = outros.find(o => dIni(o) && dIni(o) >= alt.data); op.ordem = prim ? ord(prim) - 0.5 : (outros.length ? ord(outros[outros.length - 1]) + 1 : 0); }
    }
    return { ok: true, avisos, descricao: x ? `mover para antes de ${x.op || x.id}` : `mover para ${alt.data} (${alt.posicao === 'fim' ? 'fim' : 'início'} do dia${alt.maquina ? ', ' + alt.maquina : ''})` };
  }
  if (fonte === 'vocus' || fonte === 'ds100') {
    if (fonte === 'ds100' && (!op.maquina || op.maquina === 'KANBAN')) op.maquina = 'DS100';
    if (x) { if (fonte === 'vocus') op.maquina = x.maquina; op.weekKey = x.weekKey; op.sortIdx = num(x.sortIdx) - 0.5; }
    else {
      const wk = U.semanaISO(alt.data);
      if (fonte === 'vocus' && alt.maquina) op.maquina = alt.maquina;
      op.weekKey = wk;
      const ms = ops.filter(o => o !== op && o.weekKey === wk && (fonte === 'ds100' ? o.maquina !== 'KANBAN' : o.maquina === op.maquina)).map(o => num(o.sortIdx));
      op.sortIdx = alt.posicao === 'fim' ? (ms.length ? Math.max(...ms) + 1 : 0) : (ms.length ? Math.min(...ms) - 1 : 0);
      avisos.push(`${ROTULO[fonte]} planeia por semana: a ordem passa para o ${alt.posicao === 'fim' ? 'fim' : 'início'} da semana ${wk}`);
    }
    return { ok: true, avisos, descricao: x ? `mover para antes de ${x.op || x.id}` : `mover para a semana de ${alt.data}` };
  }
  return { erro: 'fonte sem simulação' };
}

function aplicarInicio(fonte, b, alt, base) {
  const op = acharOp(fonte, b, alt.ordem); if (!op) return { erro: 'ordem não encontrada' };
  if (!RE_DIA.test(alt.data || '')) return { erro: 'data inválida (AAAA-MM-DD)' };
  const hora = RE_HORA.test(alt.hora || '') ? alt.hora.padStart(5, '0') : null;
  if (fonte !== 'ds100' && !hora) return { erro: 'hora inválida (HH:MM)' };
  const ops = lista(fonte, b);
  const fase = fonte === 'wim' ? (alt.fase || 'W') : null;
  if (fonte === 'wim' && fase === 'M') return { erro: 'Make-up: a app só define o dia (fim da Lavação + 1 dia útil). Altera a Lavação para ver o efeito.' };
  if (fonte === 'wim' && fase === 'W' && !op.temW) return { erro: 'a ordem não tem fase Wash' };
  if (fonte === 'wim' && fase === 'I' && !op.temI) return { erro: 'a ordem não tem fase Innocork' };
  const alvo = dLocal(alt.data, hora || '00:00');
  const avisos = [];
  const F = camposDia(fonte, fase);
  const chaveBase = o => chaveDe(fonte, o.id, fase);
  if (F) {
    if (fase === 'I') { prepararInno(op, ops); avisos.push('INNO: a ordem fica com dia fixo; a sequência fina por batch (i_bseq) desta ordem é ignorada'); }
    const sd = semanaDia(alt.data);
    op[F.wk] = sd.weekKey; op[F.dia] = sd.diaIdx;
    const ms = mesmoDia(ops, op, F, op[F.maq], sd.weekKey, sd.diaIdx).sort((a, c) => num(a[F.sort]) - num(c[F.sort]));
    const seg = ms.find(o => { const bb = base.get(chaveBase(o)); return bb && bb.inicio >= alvo; });
    op[F.sort] = seg ? num(seg[F.sort]) - 0.5 : (ms.length ? num(ms[ms.length - 1][F.sort]) + 1 : 0);
    if (fonte === 'densidades' || fonte === 'dsl') { op.inicioMode = 'manual'; op.hInicioP = hora; }
    else { const p = fase === 'I' ? 'i' : 'w'; op[p + '_mode'] = 'manual'; op[p + '_hIni'] = hora; }
    if (fonte === 'densidades') avisos.push('Densidades: início manual é autoritário (a app não impede sobreposição com a ordem anterior)');
    return { ok: true, avisos, descricao: `forçar início ${alt.data} ${hora}` };
  }
  if (fonte === 'talis') {
    op.inicio_modo = 'manual'; op.dia_fixo = alt.data; op.hora_inicio = hora;
    const ord = o => (o.ordem ?? 999);
    const outros = ops.filter(o => o !== op && o.linha === op.linha).sort((a, c) => ord(a) - ord(c));
    const seg = outros.find(o => { const bb = base.get(chaveBase(o)); return bb && bb.inicio >= alvo; });
    op.ordem = seg ? ord(seg) - 0.5 : (outros.length ? ord(outros[outros.length - 1]) + 1 : 0);
    avisos.push('DSL Talis: a hora manual é um mínimo — se a fila anterior acabar mais tarde, a app arranca mais tarde');
    return { ok: true, avisos, descricao: `forçar início ${alt.data} ${hora}` };
  }
  if (fonte === 'vocus') {
    op.startMode = 'manual'; op.startManual = `${alt.data}T${hora}`;
    op.weekKey = U.semanaISO(alt.data);
    const ms = ops.filter(o => o !== op && o.maquina === op.maquina && o.weekKey === op.weekKey).sort((a, c) => num(a.sortIdx) - num(c.sortIdx));
    const seg = ms.find(o => { const bb = base.get(chaveBase(o)); return bb && bb.inicio >= alvo; });
    op.sortIdx = seg ? num(seg.sortIdx) - 0.5 : (ms.length ? num(ms[ms.length - 1].sortIdx) + 1 : 0);
    return { ok: true, avisos, descricao: `forçar início ${alt.data} ${hora}` };
  }
  if (fonte === 'ds100') {
    if (!op.maquina || op.maquina === 'KANBAN') op.maquina = 'DS100';
    op.weekKey = U.semanaISO(alt.data);
    const ms = ops.filter(o => o !== op && o.maquina !== 'KANBAN' && o.weekKey === op.weekKey).sort((a, c) => num(a.sortIdx) - num(c.sortIdx));
    const seg = ms.find(o => { const bb = base.get(chaveBase(o)); return bb && bb.inicio >= dLocal(alt.data); });
    op.sortIdx = seg ? num(seg.sortIdx) - 0.5 : (ms.length ? num(ms[ms.length - 1].sortIdx) + 1 : 0);
    avisos.push('DS100 não tem hora nem dia fixo: a ordem entra na semana da data, na posição correspondente; o dia resulta da capacidade diária');
    return { ok: true, avisos, descricao: `antecipar/adiar para a semana de ${alt.data}` };
  }
  return { erro: 'fonte sem simulação' };
}

function aplicarCapacidade(fonte, b, alt) {
  const maq = alt.maquina; if (!maq) return { erro: 'indica a máquina/linha' };
  const modo = alt.modo === 'paragem' ? 'paragem' : 'ritmo';
  let f = 1, dias = [];
  if (modo === 'ritmo') { const pct = Number(alt.pct); if (!Number.isFinite(pct) || pct < 1 || pct > 400) return { erro: 'ritmo inválido (1–400 %)' }; f = pct / 100; }
  else { if (!RE_DIA.test(alt.de || '') || !RE_DIA.test(alt.ate || alt.de)) return { erro: 'datas da paragem inválidas' }; dias = diasEntre(alt.de, alt.ate || alt.de); if (!dias.length) return { erro: 'período vazio' }; }
  const avisos = [];
  const desc = modo === 'ritmo' ? `ritmo ${maq} a ${Math.round(f * 100)} %` : `paragem ${maq} de ${dias[0]} a ${dias[dias.length - 1]} (${dias.length} d)`;
  if (fonte === 'densidades') {
    const eff = MOT.densidades.criar([], b.settings).SETTINGS;
    b.settings = b.settings || {};
    if (modo === 'ritmo') { b.settings.capacidades = clone(eff.capacidades); if (!b.settings.capacidades[maq]) return { erro: 'máquina desconhecida' }; b.settings.capacidades[maq].krH = (+b.settings.capacidades[maq].krH || 0) * f; }
    else { b.settings.stops = clone(eff.stops); (b.settings.stops[maq] = b.settings.stops[maq] || []).push({ date: dias[0], label: 'Simulação', days: dias.length }); }
  } else if (fonte === 'dsl') {
    b.settings = b.settings || {};
    if (modo === 'ritmo') {
      const caps = b.settings.capacidades = b.settings.capacidades || {};
      const base = maq === 'EM' ? ((caps.EM || caps.EM_B || {}).krH || 2000) : ((caps[maq] || {}).krH || 17000);
      caps[maq] = Object.assign({}, caps[maq] || {}, { krH: base * f });
    } else { const td = b.settings.turnosDia = b.settings.turnosDia || {}; for (const d of dias) td[d] = Object.assign({}, td[d] || {}, { [maq]: 0 }); }
  } else if (fonte === 'talis') {
    b.config = b.config || {};
    if (modo === 'ritmo') { b.config.capacidade = Object.assign({}, b.config.capacidade || {}); b.config.capacidade[maq] = (b.config.capacidade[maq] || 1) * f; }
    else b.config.excecoes = [...(b.config.excecoes || []), ...dias.map(d => ({ data: d, linha: maq, tipo: 'fechado' }))];
  } else if (fonte === 'vocus') {
    b.settings = b.settings || {};
    if (modo === 'ritmo') {
      const key = { 'Vocus 1': 'v1', 'Vocus 2': 'v2', 'Vocus 3': 'v3' }[maq]; if (!key) return { erro: 'máquina VOCUS desconhecida' };
      const eff = b.settings.oee || MOT.vocus.DEFAULT_SETTINGS.oee;
      b.settings.oee = Object.assign({}, eff, { [key]: (eff[key] || 1) * f });
      avisos.push('VOCUS: ritmo aplicado ao OEE da máquina');
    } else { b.settings.stops = clone(b.settings.stops || MOT.vocus.DEFAULT_SETTINGS.stops); (b.settings.stops[maq] = b.settings.stops[maq] || []).push({ date: dias[0], days: dias.length, label: 'Simulação' }); }
  } else if (fonte === 'ds100') {
    b.settings = b.settings || {};
    const S = Object.assign({ ds100DailyTarget: 15000 }, b.settings);
    if (modo === 'ritmo') {
      b.settings.ds100DailyTarget = (S.ds100DailyTarget || 15000) * f;
      const cw = {}; for (const [wk, arr] of Object.entries(b.settings.ds100CapsByWeek || {})) cw[wk] = Array.isArray(arr) ? arr.map(v => (v == null || isNaN(v)) ? v : v * f) : arr;
      b.settings.ds100CapsByWeek = cw;
    } else {
      const cw = b.settings.ds100CapsByWeek = Object.assign({}, b.settings.ds100CapsByWeek || {});
      for (const d of dias) { const { weekKey, diaIdx } = semanaDia(d); if (diaIdx > 5) continue; const arr = []; for (let i = 0; i < 6; i++) arr.push(MOT.ds100.capDia(S, weekKey, i)); arr[diaIdx] = 0; cw[weekKey] = arr; S.ds100CapsByWeek = cw; }
    }
  } else if (fonte === 'wim') {
    b.settings = b.settings || {}; const S = b.settings;
    const secs = S.sections || {}; const emW = ((secs.W || {}).maqs || []).includes(maq), emI = ((secs.I || {}).maqs || []).includes(maq);
    if (!emW && !emI) return { erro: 'WIM: capacidade só simulável em Wash e Innocork (o Make-up não tem modelo de capacidade na app)' };
    if (modo === 'ritmo') {
      if (emW) {
        const progs = new Set([...Object.keys(S.washCycle || {}), ...Object.keys((S.washCycleMaq || {})[maq] || {}), ...Object.values(S.washMap || {}), 'L03', 'L01_Btops']);
        for (const o of lista(fonte, b)) { if (o.w_progFixed) progs.add(o.w_progFixed); const lav = ((o.lavacao || o.w_prog || '') + '').trim(); if (lav) progs.add(lav); }
        const wm = Object.assign({}, (S.washCycleMaq || {})[maq] || {});
        const atual = p => (wm[p] != null && wm[p] !== '' && +wm[p] > 0) ? +wm[p] : ((S.washCycle || {})[p] || 90);
        const novo = {}; for (const p of progs) novo[p] = atual(p) / f;
        S.washCycleMaq = Object.assign({}, S.washCycleMaq || {}, { [maq]: novo });
      }
      if (emI) {
        const progs = new Set([...Object.keys(S.innoCycle || {}), 'INNO 2H']);
        for (const o of lista(fonte, b)) { if (o.i_prog) progs.add(o.i_prog); for (const v of Object.values(o.i_progB || {})) if (v) progs.add(v); }
        const atual = p => { const ic = (S.innoCycle || {})[p]; return (typeof ic === 'number') ? ic : (ic ? ((+ic.carga || 0) + (+ic.ciclo || 0) + (+ic.desc || 0)) : 45); };
        const novo = {}; for (const p of progs) novo[p] = atual(p) / f;
        S.innoCycle = novo;
      }
      avisos.push('WIM: ritmo aplicado aos tempos de ciclo por batch');
    } else { const td = S.turnosDia = Object.assign({}, S.turnosDia || {}); for (const d of dias) td[d] = Object.assign({}, td[d] || {}, { [maq]: 0 }); }
  } else return { erro: 'fonte sem simulação' };
  return { ok: true, avisos, descricao: desc };
}

function aplicar(fonte, b, alt, base) {
  try {
    if (alt.tipo === 'qtd') return aplicarQtd(fonte, b, alt);
    if (alt.tipo === 'mover') return aplicarMover(fonte, b, alt, base);
    if (alt.tipo === 'inicio') return aplicarInicio(fonte, b, alt, base);
    if (alt.tipo === 'capacidade') return aplicarCapacidade(fonte, b, alt);
    return { erro: 'tipo de alteração desconhecido' };
  } catch (e) { return { erro: 'falha ao aplicar: ' + ((e && e.message) || e) }; }
}

// ------------------------------------------------------------
// Simulação
// ------------------------------------------------------------
const MIN = 60000;
function fimMax(barras) { let m = null; for (const x of barras) if (x && x.fim && (!m || x.fim > m)) m = x.fim; return m; }
function ultimaBarra(barras) { let m = null; for (const x of barras) if (x && x.fim && (!m || x.fim > m.fim)) m = x; return m; }

/**
 * @param alteracoes [{fonte, tipo, ordem, fase, valor, data, hora, posicao, maquina, antes_de, modo, pct, de, ate}]
 * @param ctx { brutos: {fonte: bruto}, ordens: [linhas normalizadas do resumo], encomendas: resultado de cruzar() ou null, hoje }
 */
function simular(alteracoes, ctx) {
  const alts = (Array.isArray(alteracoes) ? alteracoes : []).slice(0, 30);
  const porFonte = new Map();
  const resAlt = [];
  for (const a of alts) {
    const fonte = a && a.fonte;
    if (!FONTES_SIM.includes(fonte)) { resAlt.push({ ...a, ok: false, erro: 'fonte sem simulação' }); continue; }
    const b0 = ctx.brutos[fonte]; if (!b0) { resAlt.push({ ...a, ok: false, erro: 'dados da fonte indisponíveis' }); continue; }
    let st = porFonte.get(fonte);
    if (!st) { try { st = { base: planoBase(fonte, b0), b: clone(b0) }; } catch (e) { resAlt.push({ ...a, ok: false, erro: 'motor da fonte falhou: ' + e.message }); continue; } porFonte.set(fonte, st); }
    const r = aplicar(fonte, st.b, a, st.base);
    resAlt.push({ ...a, ok: !!r.ok, erro: r.erro || null, avisos: r.avisos || [], descricao: r.descricao || null });
  }
  const ordemDash = new Map((ctx.ordens || []).map(o => [o.id, o]));
  const cen = new Map(); // fonte -> plano cenário
  const mudadas = [];
  for (const [fonte, st] of [...porFonte]) {
    let p; try { p = calcularPlano(fonte, st.b); } catch (e) { porFonte.delete(fonte); for (const r of resAlt) if (r.fonte === fonte && r.ok) { r.ok = false; r.erro = 'o motor falhou com este cenário: ' + e.message; } continue; }
    cen.set(fonte, p);
    const chaves = new Set([...st.base.keys(), ...p.keys()]);
    for (const k of chaves) {
      const a = st.base.get(k), d = p.get(k);
      const dIni = a && d ? Math.round((d.inicio - a.inicio) / MIN) : null, dFim = a && d ? Math.round((d.fim - a.fim) / MIN) : null;
      if (a && d && Math.abs(dIni) < 1 && Math.abs(dFim) < 1) continue;
      const ref = d || a; const o = ordemDash.get(ref.id) || {};
      mudadas.push({
        chave: k, id: ref.id, fonte, unidade: ROTULO[fonte], fase: ref.fase, fase_label: ref.fase ? FASE_WIM[ref.fase] : null,
        maquina_antes: a ? a.maquina : null, maquina_depois: d ? d.maquina : null,
        ini_antes: a ? iso(a.inicio) : null, fim_antes: a ? iso(a.fim) : null, ini_depois: d ? iso(d.inicio) : null, fim_depois: d ? iso(d.fim) : null,
        delta_ini_min: dIni, delta_fim_min: dFim, so_dia: !!(ref.so_dia),
        op: o.op || o.ref || '', pedido: o.pedido || '', cliente: o.cliente || '', produto: o.produto || '', estado: o.estado || null, estado_origem: o.estado_origem || '', terminal: !!o.terminal,
        alterada: alts.some(x => x.fonte === fonte && x.ordem === ref.id),
      });
    }
  }
  mudadas.sort((x, y) => Math.abs(y.delta_fim_min ?? 1e9) - Math.abs(x.delta_fim_min ?? 1e9));

  // Encomendas: fim previsto antes/depois (máximo do fim das barras das ordens activas ligadas)
  const encs = [];
  const tot = { afectadas: 0, novas_em_risco: 0, saem_de_risco: 0, pioram: 0, melhoram: 0 };
  if (ctx.encomendas && Array.isArray(ctx.encomendas.encomendas)) {
    const hoje = ctx.hoje || U.hoje();
    const barrasDe = (id, usarCen) => {
      const fonte = id.split('-')[0];
      const plano = (usarCen && cen.get(fonte)) || (ctx.brutos[fonte] ? planoBase(fonte, ctx.brutos[fonte]) : null);
      if (!plano) return [];
      const out = []; for (const x of plano.values()) if (x.id === id) out.push(x); return out;
    };
    // índice id -> barras (base/cenário) só para as fontes simuladas (o resto não muda)
    const idx = (usarCen) => { const m = new Map(); for (const [fonte] of porFonte) { const plano = usarCen ? cen.get(fonte) : porFonte.get(fonte).base; for (const x of plano.values()) { const a = m.get(x.id) || []; a.push(x); m.set(x.id, a); } } return m; };
    const iA = idx(false), iD = idx(true);
    for (const e of ctx.encomendas.encomendas) {
      const activas = (e.ordens || []).filter(o => !o.terminal);
      if (!activas.some(o => porFonte.has(o.id.split('-')[0]))) continue;
      // última barra de cada ordem activa (fontes simuladas: base/cenário; outras: plano base ou data da app)
      const ultDe = (o, m) => { const f = o.id.split('-')[0]; if (porFonte.has(f)) return ultimaBarra(m.get(o.id) || []); const u = ultimaBarra(barrasDe(o.id, false)); if (u) return u; return o.data_fim_plano ? { fim: dLocal(o.data_fim_plano, o.hora_plano_fim || '23:59'), so_dia: !o.hora_plano_fim } : null; };
      const ua = ultimaBarra(activas.map(o => ultDe(o, iA))), ud = ultimaBarra(activas.map(o => ultDe(o, iD)));
      const fa = ua ? ua.fim : null, fd = ud ? ud.fim : null;
      if (!fa && !fd) continue;
      if (fa && fd && Math.abs(fd - fa) < MIN) continue;
      const prazo = e.prazo;
      const folga = f => (prazo && f ? U.difDias(diaDe(f), prazo) : null);
      const risco = f => { if (prazo && prazo < hoje) return 'prazo_passado'; if (!f) return 'sem_plano'; if (prazo && diaDe(f) > prazo) return 'fim_depois_do_prazo'; return null; };
      const ra = risco(fa), rd = risco(fd);
      tot.afectadas++; if (!ra && rd) tot.novas_em_risco++; if (ra && !rd) tot.saem_de_risco++;
      if (fa && fd) { if (fd > fa) tot.pioram++; else tot.melhoram++; }
      encs.push({
        pedido_item: e.pedido_item, cliente: e.cliente || '', material: e.material || '', descricao: e.descricao || '', prazo, prazo_tipo: e.prazo_tipo || null,
        fim_antes: iso(fa), fim_depois: iso(fd), fim_antes_so_dia: !!(ua && ua.so_dia), fim_depois_so_dia: !!(ud && ud.so_dia), delta_h: fa && fd ? Math.round((fd - fa) / 36e5 * 10) / 10 : null,
        folga_antes: folga(fa), folga_depois: folga(fd), risco_antes: ra, risco_depois: rd,
        ordens: activas.filter(o => porFonte.has(o.id.split('-')[0])).map(o => o.id),
      });
    }
    encs.sort((x, y) => (Number(!!y.risco_depois && !y.risco_antes) - Number(!!x.risco_depois && !x.risco_antes)) || Math.abs(y.delta_h || 0) - Math.abs(x.delta_h || 0));
  }

  // Gantt antes/depois: máquinas tocadas, janela à volta das mudanças
  const maqs = new Set();
  for (const m of mudadas) { if (m.maquina_antes) maqs.add(m.fonte + '|' + m.maquina_antes); if (m.maquina_depois) maqs.add(m.fonte + '|' + m.maquina_depois); }
  for (const a of resAlt) if (a.ok && a.tipo === 'capacidade' && a.maquina) { const rot = a.fonte === 'dsl' ? nomeLinhaDsl(a.maquina) : a.maquina; maqs.add(a.fonte + '|' + rot); }
  let jIni = null, jFim = null;
  for (const m of mudadas) for (const v of [m.ini_antes, m.ini_depois]) if (v && (!jIni || v < jIni)) jIni = v;
  for (const m of mudadas) for (const v of [m.fim_antes, m.fim_depois]) if (v && (!jFim || v > jFim)) jFim = v;
  let gantt = null;
  if (jIni && jFim) {
    const de = dLocal(jIni.slice(0, 10)); de.setDate(de.getDate() - 1);
    let ate = dLocal(jFim.slice(0, 10)); ate.setDate(ate.getDate() + 2);
    const maxAte = new Date(de); maxAte.setDate(maxAte.getDate() + 35); if (ate > maxAte) ate = maxAte;
    const lanes = [...maqs].sort();
    const mudSet = new Set(mudadas.map(m => m.chave));
    const recolher = (fonte, plano) => { const out = []; for (const x of plano.values()) { if (!maqs.has(fonte + '|' + x.maquina)) continue; if (x.fim <= de || x.inicio >= ate) continue; const o = ordemDash.get(x.id) || {}; out.push({ ...serial(x, true), lane: fonte + '|' + x.maquina, chave: x.chave, op: o.op || o.ref || '', mudou: mudSet.has(x.chave), terminal: !!o.terminal }); } return out; };
    const antes = [], depois = [];
    for (const [fonte, st] of porFonte) { antes.push(...recolher(fonte, st.base)); depois.push(...recolher(fonte, cen.get(fonte))); }
    gantt = { de: iso(de), ate: iso(ate), lanes: lanes.map(l => { const [f, m] = l.split('|'); return { id: l, fonte: f, unidade: ROTULO[f], maquina: m }; }), antes: antes.slice(0, 900), depois: depois.slice(0, 900), truncado: antes.length > 900 || depois.length > 900 };
  }
  return {
    gerado: new Date().toISOString(), alteracoes: resAlt,
    resumo: { ordens_afectadas: mudadas.length, ordens_activas_afectadas: mudadas.filter(m => !m.terminal).length, ...tot, encomendas_carregadas: !!(ctx.encomendas && ctx.encomendas.encomendas) },
    ordens: mudadas.slice(0, 500), encomendas: encs.slice(0, 300), gantt,
  };
}

// ------------------------------------------------------------
// Catálogo para a UI: máquinas por fonte e procura de ordens simuláveis
// ------------------------------------------------------------
function maquinas(brutos) {
  const out = [];
  for (const f of FONTES_SIM) {
    const b = brutos[f]; if (!b) continue;
    let l = [];
    if (f === 'densidades') l = MAQ_DENS.map(m => ({ valor: m, rotulo: m }));
    else if (f === 'dsl') { const s = new Set(['1', '2', '3', '4', '5', '6', '7', '8', 'EM', 'EEB']); for (const o of lista(f, b)) if (o.linha) s.add(String(o.linha)); l = [...s].sort((a, c) => (parseInt(a, 10) || 99) - (parseInt(c, 10) || 99) || a.localeCompare(c)).map(m => ({ valor: m, rotulo: nomeLinhaDsl(m) })); }
    else if (f === 'talis') l = MOT.talis.LINHAS.map(m => ({ valor: m, rotulo: m }));
    else if (f === 'vocus') l = [...new Set(lista(f, b).map(o => o.maquina).filter(m => m && m !== 'KANBAN'))].sort().map(m => ({ valor: m, rotulo: m }));
    else if (f === 'ds100') l = [{ valor: 'DS100', rotulo: 'DS100 (capacidade diária)' }];
    else if (f === 'wim') { const s = (b.settings || {}).sections || {}; l = [...((s.W || {}).maqs || []).map(m => ({ valor: m, rotulo: `Wash · ${m}`, fase: 'W' })), ...((s.I || {}).maqs || []).map(m => ({ valor: m, rotulo: `Innocork · ${m}`, fase: 'I' }))]; }
    out.push({ fonte: f, unidade: ROTULO[f], un_qtd: UN_QTD[f], maquinas: l });
  }
  return out;
}

function procurar(q, ctx, filtro) {
  const termo = String(q || '').trim(); const f = filtro || {};
  if (!f.id && termo.length < 2) return [];
  const out = [];
  for (const o of (ctx.ordens || [])) {
    const fonte = o.fonte || String(o.id).split('-')[0];
    if (!FONTES_SIM.includes(fonte) || !ctx.brutos[fonte]) continue;
    if (f.fonte && fonte !== f.fonte) continue;
    if (f.id) { if (o.id !== f.id) continue; }
    else if (!U.corresponde(U.textoPesquisa(o), termo)) continue;
    const b = ctx.brutos[fonte]; const raw = acharOp(fonte, b, o.id);
    const base = planoBase(fonte, b);
    const barras = [...base.values()].filter(x => x.id === o.id).sort((a, c) => a.inicio - c.inicio).map(x => serial(x, false));
    const fases = fonte === 'wim' && raw ? ['W', 'I', 'M'].filter(p => raw['tem' + p]).map(p => ({ fase: p, label: FASE_WIM[p] })) : [];
    out.push({
      id: o.id, fonte, unidade: ROTULO[fonte], op: o.op || o.ref || '', pedido: o.pedido || '', cliente: o.cliente || '', produto: o.produto || '',
      maquina: o.maquina || null, maq_motor: raw ? (raw.maquina || raw.linha || raw.w_maq || raw.i_maq || null) : null, estado_origem: o.estado_origem || '', terminal: !!o.terminal,
      qtd_nativa: raw ? raw[CAMPO_QTD[fonte]] ?? null : null, un_qtd: UN_QTD[fonte], fases, barras,
    });
    if (out.length >= 40) break;
  }
  return out;
}

module.exports = { FONTES_SIM, ROTULO, UN_QTD, CAMPO_QTD, calcularPlano, planoBase, barrasPorOrdem, simular, maquinas, procurar, aplicar, semanaDia, iso, _paredeUTC: paredeUTC };
