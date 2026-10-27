// ============================================================
// Indicadores — enriquecimento de cada ordem (flags de atraso, hoje, semana),
// acumulação dos KPIs e painel de máquinas. Módulo puro (sem I/O).
// ============================================================
'use strict';
const E = require('./estados');
const U = require('./util');

/**
 * Regras:
 *  - atraso_prazo: data limite (cliente) < hoje e ordem não terminal
 *  - atraso_plano: fim planeado (ou dia planeado) < hoje e ordem não terminal
 *      · plano à semana (DS100): conta a partir da segunda-feira seguinte
 *      · plano em fila (VOCUS: sequência por máquina, sem data): não se aplica
 *  - hoje: dia planeado = hoje, ou janela planeada início..fim que inclui hoje (só plano ao dia)
 *  - semana: semana planeada = semana ISO actual
 *  - feita_hoje: fim real hoje
 *  - fechada_7d: terminal com fim real nos últimos 7 dias
 *  - paragem_7d: minutos de paragem registados em ordens com actividade real nos últimos 7 dias
 *  - manutenção (ciclos de limpeza no WIM): nunca conta nos KPIs; aparece no painel de máquinas
 */
function enriquecer(o, hoje, semana, limite7, agora) {
  const term = E.terminal(o.estado);
  const fimPlano = o.data_fim_plano || o.data_plano;
  const gran = o.plano_granularidade || 'dia';
  const d = { ...o };
  d.terminal = term;
  d.em_curso = o.estado === 'em_processo';
  d.atraso_prazo_dias = (!term && !o.manutencao && o.data_limite && o.data_limite < hoje) ? U.difDias(o.data_limite, hoje) : 0;
  d.atraso_plano_dias = (!term && !o.manutencao && gran !== 'fila' && fimPlano && fimPlano < hoje) ? U.difDias(fimPlano, hoje) : 0;
  d.atraso_prazo = d.atraso_prazo_dias > 0;
  d.atraso_plano = d.atraso_plano_dias > 0;
  const janela = gran === 'dia' && !!o.data_plano && !!fimPlano && o.data_plano <= hoje && fimPlano >= hoje;
  d.hoje = !o.manutencao && gran === 'dia' && (o.data_plano === hoje || janela);
  d.semana = !o.manutencao && (o.semana_plano === semana || (!!o.data_plano && U.semanaISO(o.data_plano) === semana));
  const fimReal = o.real_fim ? o.real_fim.slice(0, 10) : null;
  d.feita_hoje = !!fimReal && fimReal === hoje && (term || o.estado === 'em_processo');
  d.fechada_7d = term && !!fimReal && fimReal >= limite7 && fimReal <= hoje;
  const actividade = (o.real_fim || o.real_inicio || '').slice(0, 10);
  d.paragem_7d = (o.atraso_prod_min > 0 && actividade && actividade >= limite7) ? o.atraso_prod_min : 0;
  d.na_fila = !term && !o.manutencao;            // conta para a fila do painel de máquinas
  d.ativa = d.na_fila && !o.fase_futura;          // conta para os KPIs e para a tabela
  if (o.fase_futura) { d.em_curso = false; d.atraso_prazo = d.atraso_plano = d.hoje = d.semana = d.feita_hoje = d.fechada_7d = false; d.atraso_prazo_dias = d.atraso_plano_dias = 0; d.paragem_7d = 0; d.hoje = !o.manutencao && (o.data_plano === hoje); }
  d.decorrido_min = (d.em_curso && o.real_inicio && o.real_inicio.length > 10 && agora) ? U.minutosDesde(o.real_inicio, agora) : null;
  // Fim planeado (data + hora quando a app a calcula: Densidades, DSL Talis) e atraso da execução em curso
  d.fim_plano_dt = o.data_fim_plano ? (o.hora_plano_fim ? `${o.data_fim_plano} ${o.hora_plano_fim}` : o.data_fim_plano) : null;
  d.atraso_fim_min = null;
  if (d.em_curso && d.fim_plano_dt && agora && gran === 'dia') {
    const ref = d.fim_plano_dt.length > 10 ? d.fim_plano_dt : `${d.fim_plano_dt} 23:59`; // só data: conta a partir do fim desse dia
    const m = U.minutosDesde(ref, agora);
    d.atraso_fim_min = m > 0 ? m : 0;
  }
  // Fim real registado mas estado ainda "em processo" (há quanto tempo)
  d.fim_registado_min = (d.em_curso && o.real_fim && o.real_fim.length > 10 && agora) ? U.minutosDesde(o.real_fim, agora) : null;
  // OP por abrir: ordem activa (não terminal, não manutenção) sem número de OP de 8 dígitos no campo OP
  d.op_num = U.numOP(o.op);
  d.sem_op = d.ativa && !d.op_num;
  // Dias até ao plano (negativo = já passou): dia planeado, ou segunda-feira da semana planeada (DS100, fila VOCUS)
  const refPlano = o.data_plano || (o.semana_plano ? U.segundaDaSemana(o.semana_plano) : null);
  d.dias_plano = refPlano ? U.difDias(hoje, refPlano) : null;
  d.sem_op_nivel = !d.sem_op ? null : (d.dias_plano == null ? 'aviso' : (d.dias_plano <= 0 ? 'critico' : (d.dias_plano <= 7 ? 'serio' : 'aviso')));
  return d;
}

// ------------------------------------------------------------
// Alertas (painel de excepções) — limiares configuráveis por variáveis de ambiente
// ------------------------------------------------------------
const LIMIARES = {
  processo_h: 24,        // em processo há mais de N h sem fim registado (unidades com plano ao dia)
  processo_h_fila: 96,   // idem para unidades em fila (VOCUS: ordens de 100k+ un. correm vários dias)
  fim_registado_h: 12,   // fim real registado há mais de N h e estado ainda "em processo"
  plano_dias: 14,        // ordem activa com dia planeado há mais de N dias
  job_dias: 7,           // "Espera JOB" há mais de N dias (fim real, ou dia planeado se não houver)
};
function limiares(env) {
  const e = env || {};
  const n = (k, d) => { const v = parseFloat(e[k]); return isFinite(v) && v > 0 ? v : d; };
  return { processo_h: n('ALERTA_PROCESSO_H', LIMIARES.processo_h), processo_h_fila: n('ALERTA_PROCESSO_H_FILA', LIMIARES.processo_h_fila), fim_registado_h: n('ALERTA_FIM_REGISTADO_H', LIMIARES.fim_registado_h), plano_dias: n('ALERTA_PLANO_DIAS', LIMIARES.plano_dias), job_dias: n('ALERTA_JOB_DIAS', LIMIARES.job_dias) };
}

const TIPOS_ALERTA = {
  fonte_falha:        { ordem: 0, nivel: 'critico', titulo: 'App sem ligação', descr: 'a última leitura falhou; a mostrar a última leitura boa, se existir' },
  fim_plano:          { ordem: 1, nivel: 'serio',   titulo: 'Em processo além do fim planeado', descr: 'a app de origem calculou um fim para esta ordem e já passou' },
  fim_registado:      { ordem: 2, nivel: 'serio',   titulo: 'Terminada mas não fechada', descr: 'tem fim real registado há horas e continua "Em Processo" na app — alguém tem de mudar o estado' },
  processo_longo:     { ordem: 3, nivel: 'aviso',   titulo: 'Em processo há demasiado tempo', descr: 'sem fim registado; ou é uma ordem longa ou ficou esquecida' },
  prazo:              { ordem: 4, nivel: 'critico', titulo: 'Data limite do cliente ultrapassada', descr: 'ordem não terminada com data limite no passado' },
  sem_maquina:        { ordem: 5, nivel: 'aviso',   titulo: 'Pronta mas sem máquina', descr: 'liberada / na linha / em processo sem máquina atribuída na app' },
  plano_antigo:       { ordem: 6, nivel: 'aviso',   titulo: 'Plano antigo por fechar', descr: 'ordem activa com dia planeado há mais de N dias — provavelmente lixo de planeamento' },
  job_antigo:         { ordem: 7, nivel: 'aviso',   titulo: 'Espera JOB há demasiado tempo', descr: 'terminada, à espera do JOB SAP há mais de N dias — backlog administrativo' },
};

/** Gera a lista de alertas a partir das ordens enriquecidas de TODAS as unidades e do estado das fontes. */
function alertas(ordens, unidades, hoje, agora, lim) {
  lim = lim || LIMIARES;
  const out = [];
  const add = (tipo, o, detalhe, valor) => out.push({ tipo, nivel: TIPOS_ALERTA[tipo].nivel, unidade: o.unidade, maquina: o.maquina || null, op: o.op || o.ref || '', cliente: o.cliente || '', detalhe, valor: valor ?? null, id: o.id });
  for (const u of (unidades || [])) if (u.fonte && !u.fonte.ok) out.push({ tipo: 'fonte_falha', nivel: 'critico', unidade: u.unidade, maquina: null, op: '', cliente: '', detalhe: `${u.fonte.erro || 'erro desconhecido'}${u.fonte.ultima_ok ? ' · última leitura boa ' + u.fonte.ultima_ok.slice(0, 16).replace('T', ' ') : ''}`, valor: u.fonte.idade_min, id: 'fonte-' + u.id });
  const limPlano = U.addDias(hoje, -lim.plano_dias);
  const limJob = U.addDias(hoje, -lim.job_dias);
  for (const o of ordens) {
    if (o.fase_futura || o.manutencao) continue;
    const gran = o.plano_granularidade || 'dia';
    if (o.em_curso) {
      if (o.atraso_fim_min > 0) add('fim_plano', o, `fim planeado ${o.fim_plano_dt} · ultrapassado há ${hhmm(o.atraso_fim_min)}`, o.atraso_fim_min);
      if (o.fim_registado_min != null && o.fim_registado_min > lim.fim_registado_h * 60) add('fim_registado', o, `fim real ${o.real_fim} · há ${hhmm(o.fim_registado_min)}`, o.fim_registado_min);
      else if (o.decorrido_min != null) {
        const h = gran === 'fila' ? lim.processo_h_fila : lim.processo_h;
        if (o.decorrido_min > h * 60) add('processo_longo', o, `início ${o.real_inicio} · há ${hhmm(o.decorrido_min)} (limiar ${h} h)`, o.decorrido_min);
      }
      if (!o.maquina) add('sem_maquina', o, 'em processo sem máquina atribuída');
    } else if (o.ativa) {
      if (!o.maquina && (o.estado === 'liberada' || o.estado === 'entregue_log') && o.data_plano && o.data_plano <= hoje) add('sem_maquina', o, `${o.estado_origem} · plano ${o.data_plano}`);
      if (o.data_plano && o.data_plano < limPlano && gran === 'dia') add('plano_antigo', o, `${o.estado_origem} · plano ${o.data_plano} (${U.difDias(o.data_plano, hoje)} dias)`, U.difDias(o.data_plano, hoje));
    }
    if (o.atraso_prazo) add('prazo', o, `limite ${o.data_limite} · ${o.atraso_prazo_dias} dias${o.em_curso ? ' · em processo' : ''}`, o.atraso_prazo_dias);
    if (o.estado === 'espera_job') {
      const ref = (o.real_fim || o.data_plano || '').slice(0, 10);
      if (ref && ref < limJob) add('job_antigo', o, `terminada ${ref} · ${U.difDias(ref, hoje)} dias à espera de JOB`, U.difDias(ref, hoje));
    }
  }
  const ordemNivel = { critico: 0, serio: 1, aviso: 2 };
  out.sort((a, b) => (TIPOS_ALERTA[a.tipo].ordem - TIPOS_ALERTA[b.tipo].ordem) || ((b.valor || 0) - (a.valor || 0)) || a.unidade.localeCompare(b.unidade));
  const grupos = {};
  for (const a of out) { (grupos[a.tipo] = grupos[a.tipo] || { tipo: a.tipo, nivel: a.nivel, titulo: TIPOS_ALERTA[a.tipo].titulo, descr: TIPOS_ALERTA[a.tipo].descr, n: 0, itens: [] }); grupos[a.tipo].n++; grupos[a.tipo].itens.push(a); }
  return { total: out.length, criticos: out.filter(a => a.nivel === 'critico').length, limiares: lim, grupos: Object.values(grupos).sort((a, b) => TIPOS_ALERTA[a.tipo].ordem - TIPOS_ALERTA[b.tipo].ordem), ordemNivel };
}
function hhmm(m) { m = Math.round(m || 0); return m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`); }

function vazio() {
  return { ativas: 0, em_curso: 0, atraso_prazo: 0, atraso_plano: 0, hoje: 0, semana: 0, urgentes: 0, espera_job: 0, feitas_hoje: 0, fechadas_7d: 0, paragens_7d_min: 0, por_estado: Object.fromEntries(E.ESTADOS.map(e => [e, 0])), qtd_em_curso: 0, qtd_hoje: 0, qtd_semana: 0, qtd_feita_hoje: 0, sem_op: 0, sem_op_passado: 0, sem_op_7d: 0 };
}

function somar(k, d) {
  if (d.manutencao || d.fase_futura) return;
  if (d.ativa) { k.ativas++; k.por_estado[d.estado] = (k.por_estado[d.estado] || 0) + 1; }
  if (d.sem_op) { k.sem_op++; if (d.sem_op_nivel === 'critico') k.sem_op_passado++; else if (d.sem_op_nivel === 'serio') k.sem_op_7d++; }
  if (d.estado === 'espera_job') k.espera_job++;
  if (d.em_curso) { k.em_curso++; k.qtd_em_curso += d.qtd || 0; }
  if (d.atraso_prazo) k.atraso_prazo++;
  if (d.atraso_plano) k.atraso_plano++;
  if (d.hoje && d.ativa) { k.hoje++; k.qtd_hoje += d.qtd || 0; }
  if (d.semana && d.ativa) { k.semana++; k.qtd_semana += d.qtd || 0; }
  if (d.urgente && d.ativa) k.urgentes++;
  if (d.feita_hoje) { k.feitas_hoje++; k.qtd_feita_hoje += d.qtd || 0; }
  if (d.fechada_7d) k.fechadas_7d++;
  k.paragens_7d_min += d.paragem_7d;
}

/** Ordem na fila: dia planeado, depois índice de fila, depois OP. */
function cmpFila(a, b) {
  return String(a.data_plano || '9999').localeCompare(String(b.data_plano || '9999')) || ((a.fila ?? 1e9) - (b.fila ?? 1e9)) || String(a.op).localeCompare(String(b.op));
}

/**
 * Painel de máquinas: para cada máquina da unidade, o que está em processo, o que vem a seguir e a carga de hoje.
 * `maquinas` = lista ordenada vinda das settings da app; máquinas vistas nas ordens activas são acrescentadas.
 */
function painelMaquinas(ordens, maquinas, hoje, gran) {
  const nomes = [...(maquinas || [])];
  for (const o of ordens) if (o.maquina && !o.manutencao && (o.em_curso || o.na_fila) && !nomes.includes(o.maquina)) nomes.push(o.maquina);
  return nomes.map(nome => {
    const da = ordens.filter(o => o.maquina === nome);
    const atuais = da.filter(o => o.em_curso).sort((a, b) => (Number(a.manutencao) - Number(b.manutencao)) || String(b.real_inicio || '').localeCompare(String(a.real_inicio || '')));
    // Fila: tudo o que está por fazer na máquina — atrasadas recentes (≤14 dias) primeiro, depois hoje e futuro.
    // Atrasadas com mais de 14 dias contam em `atrasadas` mas não entram em "a seguir" (lixo de planeamento antigo).
    const lim14 = U.addDias(hoje, -14);
    const proximas = da.filter(o => o.na_fila && !o.em_curso && (gran === 'fila' ? true : (!o.data_plano || o.data_plano >= lim14))).sort(cmpFila);
    const hojeL = da.filter(o => o.hoje && !o.manutencao);
    const feitas = da.filter(o => o.feita_hoje);
    const atrasadas = da.filter(o => o.atraso_prazo || o.atraso_plano).length;
    const estado = atuais.some(o => !o.manutencao) ? 'em_processo' : (atuais.length ? 'manutencao' : (proximas.length ? 'planeada' : 'sem_plano'));
    return {
      nome, estado,
      atuais: atuais.slice(0, 3), n_atuais: atuais.length, proximas: proximas.slice(0, 3), n_fila: proximas.length,
      hoje_n: hojeL.length, hoje_qtd: hojeL.reduce((s, o) => s + (o.qtd || 0), 0),
      feitas_hoje_n: feitas.length, feitas_hoje_qtd: feitas.reduce((s, o) => s + (o.qtd || 0), 0),
      atrasadas,
    };
  });
}

/** Enriquece e acumula uma lista de ordens de uma fonte. Devolve {kpi, ordens, em_curso, maquinas}. */
function calcular(ordens, hoje, semana, limite7, opts) {
  opts = opts || {};
  const k = vazio();
  const lista = [];
  const emCurso = [];
  for (const o of ordens) {
    const d = enriquecer(o, hoje, semana, limite7, opts.agora);
    somar(k, d);
    lista.push(d);
    if (d.em_curso) emCurso.push(d);
  }
  emCurso.sort((a, b) => String(b.real_inicio || '').localeCompare(String(a.real_inicio || '')) || String(a.maquina || '').localeCompare(String(b.maquina || '')));
  const maquinas = painelMaquinas(lista, opts.maquinas, hoje, opts.granularidade || 'dia');
  return { kpi: k, ordens: lista, em_curso: emCurso, maquinas };
}

module.exports = { enriquecer, vazio, somar, calcular, painelMaquinas, alertas, limiares, LIMIARES, TIPOS_ALERTA };
