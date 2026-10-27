// ============================================================
// Normalização de estados — ciclo único para as 7 unidades
//   pre -> aberto -> liberada -> entregue_log -> em_processo -> terminada -> espera_job -> fechada
//
// Confirmado nos dados (26/10/2026):
//  - "Entregue Logística" / "Entrega LOG" NÃO é pós-produção: são ordens ainda sem início real,
//    planeadas para hoje/amanhã (material entregue pela logística à linha). Fica ANTES de "Em Processo".
//  - "Espera JOB" é pós-produção: no DSL, 41 das 63 ordens nesse estado têm início E fim reais
//    (terminadas, à espera do JOB SAP para fechar). Fica DEPOIS de "Terminado em Linha".
//  - A lista de referência da app DSL Talis confirma a ordem:
//    aberto, liberada, entregue_logistica, em_processo, terminado_linha, espera_job, concluido_planeamento.
// ============================================================
'use strict';

const ESTADOS = ['pre', 'aberto', 'liberada', 'entregue_log', 'em_processo', 'terminada', 'espera_job', 'fechada', 'desconhecido'];

const LABEL = {
  pre: 'Em espera',              // KANBAN / Buffer — ainda não entra no plano executável
  aberto: 'Aberto',              // planeada, não libertada
  liberada: 'Liberada',          // libertada para produção
  entregue_log: 'Na linha',      // material entregue pela logística à linha, por iniciar
  em_processo: 'Em processo',    // a ser processada agora
  terminada: 'Terminada',        // terminada na linha, por fechar
  espera_job: 'Espera JOB',      // terminada, à espera do JOB SAP
  fechada: 'Fechada',            // "Concluída Planeamento" — fechada pelo planeamento
  desconhecido: 'Desconhecido',
};

// Terminais = já não há trabalho de produção pendente
const TERMINAIS = new Set(['terminada', 'espera_job', 'fechada']);
const ORDEM = Object.fromEntries(ESTADOS.map((e, i) => [e, i]));

function semAcentos(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

/**
 * Vocabulários encontrados (Out/2026):
 *  WIM:        Aberto | Liberado | Em Processo | Entrega LOG | Terminado | Concluído Planeamento
 *  VOCUS:      Aberto | Liberada | Entregue Logística | Em Processo | Terminada | Concluída Planeamento
 *  DS100:      KANBAN | Aberto | Liberada | Entregue Logística | Em Processo | Terminada | Concluída Planeamento
 *  DENSIDADES: Aberto | Liberada | Entregue Logística | Em Processo | Concluída Planeamento
 *  DSL:        Aberto | Liberada | Em Processo | Terminado em Linha | Espera JOB | Concluído Planeamento
 *  DSL TALIS:  aberto | liberada | entregue_logistica | em_processo | terminado_linha | espera_job | concluido_planeamento
 */
function normalizar(raw) {
  const s = semAcentos(raw).replace(/_/g, ' ');
  if (!s) return 'desconhecido';
  if (s.includes('kanban') || s.includes('buffer')) return 'pre';
  if (s.includes('espera')) return 'espera_job';
  if (s.includes('conclu')) return 'fechada';
  if (s.includes('em proc')) return 'em_processo';
  if (s.includes('entreg')) return 'entregue_log';
  if (s.includes('termin')) return 'terminada';
  if (s.includes('liber')) return 'liberada';
  if (s.includes('abert')) return 'aberto';
  return 'desconhecido';
}

function terminal(estado) { return TERMINAIS.has(estado); }

module.exports = { ESTADOS, LABEL, TERMINAIS, ORDEM, normalizar, terminal };
