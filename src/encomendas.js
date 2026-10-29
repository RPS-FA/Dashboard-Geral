// ============================================================
// Rastreio de encomendas por Pedido_Item
// Fonte: Encomendas.xlsx (Industrial Planning - Encomendas, SharePoint) — carregado por upload no dashboard.
// O browser lê o Excel (SheetJS) e envia as linhas em JSON; aqui só se valida, guarda e cruza com os planeamentos.
//
// Ligação encomenda → ordens dos planeamentos (as duas, sem duplicar):
//   1) "pedido": o Pedido_Item (4400041825-30 / 4400041825_30 / 4400041825/30) aparece no campo pedido, OP, lote/ref ou obs
//      da ordem na app (VOCUS, DS100, Densidades, DSL Talis registam-no; WIM/DSL quase nunca; PureCork não tem campo).
//   2) "obs": as colunas OBS do Excel citam OPs de 8 dígitos ("LAV 12063175", "DSL 14400252", "PC 11402913", "DS100 15007579")
//      → liga a qualquer ordem cujo número de OP seja esse.
// Estado da encomenda (só com base nas apps — o dashboard não sabe de expedição/SAP):
//   sem_plano  — nenhuma ordem encontrada nos planeamentos
//   planeada   — há ordens, nenhuma começou
//   em_curso   — alguma em processo, ou parte já terminada e parte por fazer
//   concluida  — todas as ordens ligadas estão terminadas (terminada / espera JOB / fechada)
// Fim previsto = maior fim planeado das ordens ainda activas (para VOCUS/DS100/Densidades/Talis é o fim calculado pela app;
// WIM só conhece a fase actual). Comparado com a data prometida ao cliente (ou, se vazia, a data desejada de remessa).
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

// Railway: sem volume o disco é efémero (um redeploy apaga o ficheiro). Com volume, o Railway define RAILWAY_VOLUME_MOUNT_PATH.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
const DISCO_PERSISTENTE = !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
const FICHEIRO = path.join(DATA_DIR, 'encomendas.json');
const MAX_LINHAS = 10000;

let ESTADO = null; // { ficheiro, carregado_em, carregado_por, folhas:[{nome, linhas, usadas}], linhas:[...] }

const RE_PI = /(\d{10})\s*[-_\/]\s*(\d{1,3})(?!\d)/g;
const RE_OP8 = /(?<![A-Za-z0-9])([1-9]\d{7})(?!\d)/g;

/** '4400041825_30' / '4400041825-30' / ' 4400041825 / 30 ' -> '4400041825-30' (ou null). */
function normPI(v) { const m = /(\d{10})\s*[-_\/]\s*(\d{1,3})(?!\d)/.exec(String(v == null ? '' : v)); return m ? `${m[1]}-${parseInt(m[2], 10)}` : null; }
function pisEm(texto) { const out = new Set(); for (const m of String(texto == null ? '' : texto).matchAll(RE_PI)) out.add(`${m[1]}-${parseInt(m[2], 10)}`); return out; }
function opsEm(texto) { const out = new Set(); for (const m of String(texto == null ? '' : texto).replace(/OP(?=\d)/gi, 'OP ').matchAll(RE_OP8)) out.add(m[1]); return out; }

const txt = (v, max = 400) => v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max);
const dataOuNull = v => { const d = U.paraData(v); return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null; };
const numOuNull = v => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };

/** Valida e normaliza o payload do upload. Lança Error com mensagem legível se for inválido. */
function validar(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload vazio');
  const linhas = Array.isArray(payload.linhas) ? payload.linhas : null;
  if (!linhas) throw new Error('faltam as linhas');
  if (linhas.length > MAX_LINHAS) throw new Error(`demasiadas linhas (${linhas.length} > ${MAX_LINHAS})`);
  const vistos = new Map();
  for (const l of linhas) {
    const pi = normPI(l && l.pedido_item);
    if (!pi) continue;
    const obs = {};
    if (l.obs && typeof l.obs === 'object') for (const [k, v] of Object.entries(l.obs)) { const t = v == null ? '' : String(v).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 2000); if (t && t !== '0') obs[txt(k, 40)] = t; } // OBS mantém as quebras de linha
    const e = {
      pedido_item: pi, folha: txt(l.folha, 60),
      pedido: txt(l.pedido, 20), item: txt(l.item, 6), n_pedido: txt(l.n_pedido, 40),
      cliente: txt(l.cliente, 80), alias: txt(l.alias, 80), tipo: txt(l.tipo, 20),
      material: txt(l.material, 30), descricao: txt(l.descricao, 120), desc_cliente: txt(l.desc_cliente, 120),
      calibre: txt(l.calibre, 20), qualidade: txt(l.qualidade, 20), lavacao: txt(l.lavacao, 20),
      qt: numOuNull(l.qt), data_desejada: dataOuNull(l.data_desejada), data_prometida: dataOuNull(l.data_prometida),
      servicos: txt(l.servicos, 60), obs,
    };
    const ant = vistos.get(pi);
    if (!ant) { e.folhas = [e.folha]; vistos.set(pi, e); continue; }
    // mesmo Pedido_Item em várias folhas (ex.: Encomendas HOJE + Acompanhamentos): fica a 1.ª, junta OBS e folhas
    ant.folhas.push(e.folha);
    for (const [k, v] of Object.entries(e.obs)) { const kk = ant.obs[k] && ant.obs[k] !== v ? `${k} (${e.folha})` : k; ant.obs[kk] = v; }
    for (const k of ['data_desejada', 'data_prometida', 'qt', 'alias', 'cliente', 'material', 'descricao']) if (ant[k] == null || ant[k] === '') ant[k] = e[k];
  }
  if (!vistos.size) throw new Error('nenhuma linha com Pedido_Item válido (formato 4400041825_30)');
  const folhas = Array.isArray(payload.folhas) ? payload.folhas.slice(0, 50).map(f => ({ nome: txt(f && f.nome, 60), linhas: numOuNull(f && f.linhas) || 0, usadas: !!(f && f.usadas), motivo: txt(f && f.motivo, 120) })) : [];
  return { ficheiro: txt(payload.ficheiro, 120) || 'Encomendas.xlsx', ficheiro_modificado: txt(payload.ficheiro_modificado, 40) || null, folhas, linhas: [...vistos.values()] };
}

function guardar(dados, quem) {
  ESTADO = { ...dados, carregado_em: new Date().toISOString(), carregado_por: txt(quem, 80) || null };
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FICHEIRO + '.tmp', JSON.stringify(ESTADO)); fs.renameSync(FICHEIRO + '.tmp', FICHEIRO); ESTADO.persistido = true; }
  catch (e) { ESTADO.persistido = false; ESTADO.erro_persistencia = e.message; console.warn('[encomendas] não foi possível gravar em disco:', e.message); }
  return ESTADO;
}
function carregarDoDisco() {
  try { if (fs.existsSync(FICHEIRO)) { ESTADO = JSON.parse(fs.readFileSync(FICHEIRO, 'utf8')); ESTADO.persistido = true; console.log(`[encomendas] ${ESTADO.linhas.length} Pedido_Item carregados de ${FICHEIRO} (${ESTADO.carregado_em})`); } }
  catch (e) { console.warn('[encomendas] ficheiro em disco ilegível:', e.message); }
}
function estado() { return ESTADO; }

const ESTADOS_ENC = { sem_plano: 'Sem planeamento', planeada: 'Planeada', em_curso: 'Em curso', concluida: 'Concluída nas apps' };

/** Índices das ordens dos planeamentos por Pedido_Item e por número de OP. */
function indexar(ordens) {
  const porPI = new Map(), porOP = new Map();
  const add = (m, k, o) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(o); };
  for (const o of ordens) {
    if (o.manutencao) continue;
    for (const campo of ['pedido', 'op', 'ref', 'obs']) for (const pi of pisEm(o[campo])) add(porPI, pi, o);
    const n = o.op_num || U.numOP(o.op);
    if (n) add(porOP, n, o);
  }
  return { porPI, porOP };
}

function resumoOrdem(o, via) {
  return {
    id: o.id, unidade: o.unidade, op: o.op || o.ref || '', op_num: o.op_num || null, sem_op: !!o.sem_op, via,
    maquina: o.maquina || null, fase: o.fase || null, estado: o.estado, estado_origem: o.estado_origem, terminal: !!o.terminal, em_curso: !!o.em_curso,
    data_plano: o.data_plano || null, hora_plano_ini: o.hora_plano_ini || null, data_fim_plano: o.data_fim_plano || null, hora_plano_fim: o.hora_plano_fim || null,
    plano_granularidade: o.plano_granularidade, semana_plano: o.semana_plano || null,
    real_inicio: o.real_inicio || null, real_fim: o.real_fim || null, decorrido_min: o.decorrido_min ?? null,
    qtd: o.qtd || 0, pedido: o.pedido || '', cliente: o.cliente || '', produto: o.produto || '',
  };
}

/** Cruza as encomendas carregadas com as ordens actuais dos planeamentos. */
function cruzar(ordens, hoje) {
  if (!ESTADO) return null;
  const { porPI, porOP } = indexar(ordens || []);
  const out = [];
  for (const e of ESTADO.linhas) {
    const ligadas = new Map(); // id -> {o, via:Set}
    for (const o of (porPI.get(e.pedido_item) || [])) { const x = ligadas.get(o.id) || { o, via: new Set() }; x.via.add('pedido'); ligadas.set(o.id, x); }
    const opsObs = new Set(); for (const v of Object.values(e.obs || {})) for (const n of opsEm(v)) opsObs.add(n);
    const opsNaoEncontradas = [];
    for (const n of opsObs) { const s = porOP.get(n); if (!s) { opsNaoEncontradas.push(n); continue; } for (const o of s) { const x = ligadas.get(o.id) || { o, via: new Set() }; x.via.add('obs'); ligadas.set(o.id, x); } }
    const ords = [...ligadas.values()].map(x => resumoOrdem(x.o, [...x.via].sort().join('+')))
      .sort((a, b) => String(a.data_plano || a.real_inicio || '9999').localeCompare(String(b.data_plano || b.real_inicio || '9999')) || a.unidade.localeCompare(b.unidade));
    const activas = ords.filter(o => !o.terminal);
    const emProc = ords.filter(o => o.em_curso);
    let est = 'sem_plano';
    if (ords.length) est = !activas.length ? 'concluida' : ((emProc.length || activas.length < ords.length) ? 'em_curso' : 'planeada');
    const fimDe = o => o.data_fim_plano || o.data_plano || null;
    const fimsActivas = activas.map(fimDe).filter(Boolean).sort();
    const fim_previsto = est === 'concluida' ? null : (fimsActivas[fimsActivas.length - 1] || null);
    const fimsReais = ords.map(o => (o.real_fim || '').slice(0, 10) || fimDe(o)).filter(Boolean).sort();
    const fim_real = est === 'concluida' ? (fimsReais[fimsReais.length - 1] || null) : null;
    const prazo = e.data_prometida || e.data_desejada || null;
    const fimRef = fim_previsto || fim_real;
    const folga = prazo && fimRef ? U.difDias(fimRef, prazo) : null; // dias corridos: >0 = antes do prazo
    let risco = null;
    if (prazo && prazo < hoje && est !== 'concluida') risco = 'prazo_passado';
    else if (prazo && fim_previsto && fim_previsto > prazo) risco = 'fim_depois_do_prazo';
    else if (prazo && est === 'sem_plano' && U.difDias(hoje, prazo) <= 14) risco = 'sem_plano_prazo_proximo';
    const onde = emProc.length ? [...new Set(emProc.map(o => o.unidade))] : (activas.length ? [activas[0].unidade] : []);
    const proxima = activas.filter(o => !o.em_curso).sort((a, b) => String(a.data_plano || '9999').localeCompare(String(b.data_plano || '9999')))[0] || null;
    out.push({
      ...e, estado: est, estado_label: ESTADOS_ENC[est], ordens: ords, n_ordens: ords.length, n_activas: activas.length,
      unidades: [...new Set(ords.map(o => o.unidade))], onde, em_processo: emProc.map(o => ({ unidade: o.unidade, op: o.op, maquina: o.maquina })),
      proxima: proxima ? { unidade: proxima.unidade, op: proxima.op, data_plano: proxima.data_plano, hora_plano_ini: proxima.hora_plano_ini } : null,
      fim_previsto, fim_real, prazo, prazo_tipo: e.data_prometida ? 'prometida' : (e.data_desejada ? 'desejada' : null), folga_dias: folga, risco,
      ops_obs: [...opsObs], ops_obs_nao_encontradas: opsNaoEncontradas,
      sem_op: ords.some(o => !o.terminal && o.sem_op),
    });
  }
  const conta = f => out.filter(f).length;
  return {
    ficheiro: ESTADO.ficheiro, ficheiro_modificado: ESTADO.ficheiro_modificado, carregado_em: ESTADO.carregado_em, carregado_por: ESTADO.carregado_por,
    persistido: ESTADO.persistido !== false, disco_persistente: DISCO_PERSISTENTE, folhas: ESTADO.folhas, hoje,
    totais: { total: out.length, sem_plano: conta(e => e.estado === 'sem_plano'), planeada: conta(e => e.estado === 'planeada'), em_curso: conta(e => e.estado === 'em_curso'), concluida: conta(e => e.estado === 'concluida'), em_risco: conta(e => !!e.risco), sem_op: conta(e => e.sem_op) },
    estados: ESTADOS_ENC,
    encomendas: out.sort((a, b) => String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')) || a.pedido_item.localeCompare(b.pedido_item)),
  };
}

carregarDoDisco();

module.exports = { validar, guardar, estado, cruzar, normPI, pisEm, opsEm, indexar, ESTADOS_ENC, DATA_DIR, DISCO_PERSISTENTE, _definir: (s) => { ESTADO = s; } };
