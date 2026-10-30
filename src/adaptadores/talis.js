// ============================================================
// Adaptador DSL Talis — GET /api/estado?mes=YYYY-MM -> {config, ops, plano, rev, referencias}
// dia_fixo = dia planeado; linha = EE1 | EE2 | EM; ordem = posição na linha; data_limite = prazo;
// real_inicio_*/real_fim_* = reais; atraso_min = paragem registada; qtd em unidades.
// Lê o mês actual e o anterior (dedupe por id). plano.linhas[linha][] traz data_inicio/data_final
// calculados pela app -> hora planeada de início/fim. Linhas: config.capacidade (EM, EE1, EE2).
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');

function mesesAConsultar() {
  const h = U.hoje();
  const [y, m] = h.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return [prev, `${y}-${String(m).padStart(2, '0')}`];
}
// A app guarda datas em UTC usado como hora de parede ("08:00Z" = 08:00 na fábrica): ler a hora tal como está, sem converter fuso.
function hora(iso) { const m = /T(\d{2}:\d{2})/.exec(String(iso || '')); return m ? m[1] : null; }

async function carregar(fonte, http) {
  const meses = mesesAConsultar();
  const res = await Promise.all(meses.map(m => http(fonte.url + '/api/estado?mes=' + m).catch(e => ({ _erro: e.message }))));
  const ok = res.filter(r => !r._erro);
  if (!ok.length) throw new Error(res.map(r => r._erro).join(' | '));
  const ultimo = ok[ok.length - 1];
  const cap = (ultimo.config || {}).capacidade || {};
  const maquinas = ['EE1', 'EE2', 'EM'].filter(m => m in cap).concat(Object.keys(cap).filter(m => !['EE1', 'EE2', 'EM'].includes(m)));
  // Etiquetas dos estados como a app as mostra (referencias.estados: [{id, label}])
  const rotulos = {};
  for (const e of ((ultimo.referencias || {}).estados || [])) if (e && e.id) rotulos[e.id] = e.label || e.id;
  const mapa = new Map();
  const plano = new Map();
  for (const st of ok) {
    for (const o of (Array.isArray(st.ops) ? st.ops : [])) mapa.set(o.id, o);
    const linhas = st.plano && st.plano.linhas && typeof st.plano.linhas === 'object' ? st.plano.linhas : {};
    for (const arr of Object.values(linhas)) {
      if (!Array.isArray(arr)) continue;
      for (const p of arr) if (p && p.id) plano.set(p.id, { ini: p.data_inicio || p.plan_inicio || null, fim: p.data_final || p.plan_final || p.data_fim || null });
    }
  }
  const out = [];
  const registosErro = []; // registos com dados inesperados: ignora-se o registo, não a fonte
  for (const o of mapa.values()) {
    try {
      const pf = plano.get(o.id) || {};
      out.push({
        fonte: fonte.id, unidade: fonte.unidade,
        id: `${fonte.id}-${o.id}`,
        op: U.limpa(o.op), ref: U.limpa(o.lote), pedido: U.limpa(o.nr_pedido),
        cliente: U.limpa(o.cliente), produto: U.limpa(o.material), calibre: '',
        qtd: U.num(o.qtd),
        maquina: U.limpa(o.linha) || null, fase: null,
        fila: U.num(o.ordem),
        estado: E.normalizar(o.estado), estado_origem: rotulos[o.estado] || U.limpa(o.estado), estado_derivado: false,
        data_plano: U.paraData(o.dia_fixo) || U.paraData(pf.ini),
        data_fim_plano: U.paraData(pf.fim) || U.paraData(o.dia_fixo),
        semana_plano: o.dia_fixo ? U.semanaISO(o.dia_fixo) : null, plano_granularidade: 'dia',
        hora_plano_ini: hora(pf.ini), hora_plano_fim: hora(pf.fim),
        data_limite: U.paraData(o.data_limite), data_log: null,
        real_inicio: o.real_inicio_hora ? U.dataHora(o.real_inicio_data || o.dia_fixo, o.real_inicio_hora) : null,
        real_fim: o.real_fim_hora ? U.dataHora(o.real_fim_data || o.real_inicio_data || o.dia_fixo, o.real_fim_hora) : null,
        atraso_prod_min: U.paraMinutos(o.atraso_min), motivo_paragem: U.limpa(o.motivo_paragem),
        urgente: !!o.urgente, manutencao: false,
        obs: U.limpa([o.obs, o.obs_producao, o.qtd_objetivo ? `objectivo ${o.qtd_objetivo}` : ''].filter(Boolean).join(' · ')),
        atualizado: null,
        link: fonte.url,
      });
  
    } catch (e) { registosErro.push(`${(o && (o.id ?? o.op)) || "?"}: ${e.message}`); }
  }
  return { ordens: out, maquinas, erros_registos: registosErro, ts: ok[ok.length - 1].rev || null, granularidade: 'dia',
    bruto: { ops: [...mapa.values()], config: ultimo.config || {} } }; // bruto: entrada do motor (config já vem fundida com CONFIG_DEFAULT)
}

module.exports = { carregar };
