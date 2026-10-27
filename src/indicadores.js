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
  return d;
}

function vazio() {
  return { ativas: 0, em_curso: 0, atraso_prazo: 0, atraso_plano: 0, hoje: 0, semana: 0, urgentes: 0, espera_job: 0, feitas_hoje: 0, fechadas_7d: 0, paragens_7d_min: 0, por_estado: Object.fromEntries(E.ESTADOS.map(e => [e, 0])), qtd_em_curso: 0, qtd_hoje: 0, qtd_semana: 0, qtd_feita_hoje: 0 };
}

function somar(k, d) {
  if (d.manutencao || d.fase_futura) return;
  if (d.ativa) { k.ativas++; k.por_estado[d.estado] = (k.por_estado[d.estado] || 0) + 1; }
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

module.exports = { enriquecer, vazio, somar, calcular, painelMaquinas };
