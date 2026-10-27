// ============================================================
// Fontes — as apps de planeamento agregadas pelo dashboard.
// URLs podem ser substituídas por variáveis de ambiente (ex.: URL_WIM).
// ============================================================
'use strict';

const env = (k, d) => (process.env[k] && process.env[k].trim()) || d;

const FONTES = [
  { id: 'wim',        unidade: 'WIM',        nome: 'WIM · Wash / Innocork / Make-up', url: env('URL_WIM',        'https://planeamento-wim-production.up.railway.app'),         adaptador: 'wim' },
  { id: 'vocus',      unidade: 'VOCUS',      nome: 'PlannerCork · VOCUS',             url: env('URL_PLANNERCORK','https://plannercork-production.up.railway.app'),              adaptador: 'vocus' },
  { id: 'ds100',      unidade: 'DS100',      nome: 'PlannerCork · DS100',             url: env('URL_PLANNERCORK','https://plannercork-production.up.railway.app'),              adaptador: 'ds100' },
  { id: 'purecork',   unidade: 'PURECORK',   nome: 'PureCork',                        url: env('URL_PURECORK',   'https://purecork-production.up.railway.app'),                 adaptador: 'purecork' },
  { id: 'densidades', unidade: 'DENSIDADES', nome: 'Densidades',                      url: env('URL_DENSIDADES', 'https://planeamento-densidades-production.up.railway.app'),  adaptador: 'densidades' },
  { id: 'dsl',        unidade: 'DSL',        nome: 'DSL · Dupla escolha',             url: env('URL_DSL',        'https://planeamento-dsl-production.up.railway.app'),         adaptador: 'dsl' },
  { id: 'talis',      unidade: 'DSL TALIS',  nome: 'DSL Talis',                       url: env('URL_DSL_TALIS',  'https://planeamento-dsl-talis-production.up.railway.app'),   adaptador: 'talis' },
];

module.exports = { FONTES };
