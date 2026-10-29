// ============================================================
// Dashboard Geral — urgências de planeamento (JS puro, sem dependências)
// Lê /api/resumo a cada N segundos e mostra: OPs por abrir, excepções ("Atenção") e pesquisa global.
// ============================================================
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nR = n => (Math.round(+n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dPT = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—';
const dhPT = s => s ? (s.length > 10 ? `${dPT(s)} ${s.slice(11, 16)}` : dPT(s)) : '—';
const minH = m => !m ? '—' : (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
const decorrido = m => m == null ? '' : (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`));
const opTxt = o => o.op || o.ref || '—';
const semanaTxt = o => { const s = (o.semana_plano || '').split('-W')[1]; return s ? `S${s}` : null; };
function planoTxt(o) {
  if (o.plano_granularidade === 'semana') return semanaTxt(o) || '—';
  if (o.plano_granularidade === 'fila') return semanaTxt(o) ? `fila ${semanaTxt(o)}` : 'fila';
  return o.data_plano ? dPT(o.data_plano) + (o.hora_plano_ini ? ' ' + o.hora_plano_ini : '') : '—';
}
const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaSem = ds => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ds || ''); return m ? DIAS_SEM[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : ''; };
const refPlanoTxt = o => o.data_plano ? `${diaSem(o.data_plano)} ${dPT(o.data_plano)}` : '';
// D+n em DIAS ÚTEIS (2.ª–6.ª, sem feriados); atrasadas em dias corridos
function diasTxt(o) {
  const d = o.dias_plano;
  if (d == null) return 'sem data';
  if (d < 0) return `atrasada há ${o.dias_corridos != null ? -o.dias_corridos : -d} d`;
  if (d === 0) return o.dias_corridos > 0 ? `D (último dia útil antes do plano de ${refPlanoTxt(o)})` : 'D (hoje)';
  return `D+${d} úteis`;
}
const ORDEM_UNID = ['PURECORK', 'DSL', 'DENSIDADES', 'WIM', 'VOCUS', 'DS100', 'DSL TALIS'];

let DADOS = null;
let ECRA = new URLSearchParams(location.search).get('unidade') || ''; // ?unidade=DSL -> só essa unidade
let OPS_TUDO = false;
let temporizador = null;
const unidade = u => DADOS.unidades.find(x => x.unidade === u);

// ------------------------------------------------------------
// Pesquisa global (todas as unidades, activas e fechadas, sem limite de data)
// ------------------------------------------------------------
const normTexto = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const CAMPOS_PESQUISA = ['op', 'ref', 'pedido', 'cliente', 'produto', 'calibre', 'maquina', 'fase', 'estado_origem', 'obs', 'unidade'];
const textoPesquisa = o => normTexto(CAMPOS_PESQUISA.map(k => o[k]).filter(Boolean).join(' | '));
function procurar(q) {
  const toks = normTexto(q).split(' ').filter(Boolean);
  if (!toks.length || !DADOS) return [];
  return DADOS.ordens.filter(o => { const t = textoPesquisa(o); return toks.every(k => t.includes(k)); });
}
function realcar(txt, q) {
  const toks = normTexto(q).split(' ').filter(Boolean);
  let h = esc(txt);
  for (const t of toks) { if (t.length < 2) continue; const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'); h = h.replace(re, m => `<mark>${m}</mark>`); }
  return h;
}
function renderPesquisa() {
  const q = $('#qGlobal').value.trim();
  const box = $('#qResultados');
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  const res = procurar(q);
  const porUnid = {};
  for (const o of res) (porUnid[o.unidade] = porUnid[o.unidade] || []).push(o);
  const unids = Object.keys(porUnid).sort((a, b) => ORDEM_UNID.indexOf(a) - ORDEM_UNID.indexOf(b));
  const MAX = 12;
  const linha = o => `<div class="q-item" data-id="${esc(o.id)}" title="Ver detalhe">
      <div class="q1"><b>${realcar(opTxt(o), q)}</b>${o.ref && o.ref !== o.op ? `<span class="origem">${realcar(o.ref, q)}</span>` : ''}${o.pedido ? `<span class="origem">· ${realcar(o.pedido, q)}</span>` : ''}${o.urgente ? ' <span class="tag urg">urg</span>' : ''}${o.sem_op ? ' <span class="tag semop">sem OP</span>' : ''}</div>
      <div class="q2">${realcar([o.cliente, o.produto, o.maquina ? 'máq. ' + o.maquina : '', o.fase].filter(Boolean).join(' · '), q)}</div>
      <div class="q3"><span class="est ${o.estado}"><i></i>${esc(DADOS.estados[o.estado] || o.estado)}</span><div class="origem">${esc(o.estado_origem)} · plano ${esc(planoTxt(o))}${o.data_limite ? ' · limite ' + dPT(o.data_limite) : ''}</div><div class="origem">${o.real_inicio || o.real_fim ? `real ${dhPT(o.real_inicio)} → ${dhPT(o.real_fim)}` : ''}${o.qtd ? ` · ${nR(o.qtd)} un.` : ''}</div></div>
    </div>`;
  box.innerHTML = res.length ? `<div class="q-cab"><span><b>${res.length}</b> resultado${res.length === 1 ? '' : 's'} em <b>${unids.length}</b> unidade${unids.length === 1 ? '' : 's'} para "${esc(q)}"</span><span>Esc fecha · clique abre o detalhe</span></div>`
    + unids.map(u => { const l = porUnid[u]; const uni = unidade(u); return `<div class="q-grupo"><h4>${esc(u)} <span>${l.length}</span>${uni ? `<a href="${esc(uni.url)}" target="_blank" rel="noopener">abrir app ↗</a>` : ''}</h4>${l.slice(0, MAX).map(linha).join('')}${l.length > MAX ? `<div class="q-mais">+ ${l.length - MAX} nesta unidade — refina a pesquisa</div>` : ''}</div>`; }).join('')
    : `<div class="q-vazio">Nada encontrado para "${esc(q)}" em ${DADOS.ordens.length} ordens das 7 unidades (activas e fechadas).</div>`;
  box.hidden = false;
  $$('#qResultados .q-item').forEach(el => el.addEventListener('click', () => { box.hidden = true; abrirDetalhe(el.dataset.id); }));
}

// ------------------------------------------------------------
// Detalhe de uma ordem (modal)
// ------------------------------------------------------------
function abrirDetalhe(id) {
  const o = DADOS.ordens.find(x => x.id === id);
  if (!o) { toast('Ordem já não está na leitura actual'); return; }
  const uni = unidade(o.unidade);
  const campos = [
    ['Unidade', `${o.unidade}${uni ? ' · ' + uni.nome : ''}`],
    ['Campo OP', `${o.op || '—'}${o.op_num ? ` <span class="origem">(OP ${o.op_num})</span>` : ' <span class="tag semop">sem número de OP</span>'}`],
    ['Lote / ref.', o.ref || '—'], ['Pedido', o.pedido || '—'], ['Cliente', o.cliente || '—'], ['Produto', `${o.produto || '—'}${o.calibre ? ' · ' + o.calibre : ''}`],
    ['Quantidade', o.qtd ? nR(o.qtd) + ' un.' : '—'], ['Máquina / linha', `${o.maquina || '—'}${o.fase ? ' · ' + o.fase : ''}`],
    ['Estado', `<span class="est ${o.estado}"><i></i>${esc(DADOS.estados[o.estado] || o.estado)}</span> <span class="origem">${esc(o.estado_origem)}${o.estado_derivado ? ' (derivado)' : ''}</span>`],
    ['Plano', `${planoTxt(o)}${o.data_fim_plano && o.data_fim_plano !== o.data_plano ? ' → ' + dPT(o.data_fim_plano) + (o.hora_plano_fim ? ' ' + o.hora_plano_fim : '') : ''} · ${diasTxt(o)}`],
    ['Data limite', o.data_limite ? `${dPT(o.data_limite)}${o.atraso_prazo ? ` <b class="atr-prazo">ultrapassada há ${o.atraso_prazo_dias} d</b>` : ''}` : '—'],
    ['Real', o.real_inicio || o.real_fim ? `${dhPT(o.real_inicio)} → ${dhPT(o.real_fim)}${o.decorrido_min != null ? ' · há ' + decorrido(o.decorrido_min) : ''}` : '—'],
    ['Paragens', o.atraso_prod_min ? `${minH(o.atraso_prod_min)}${o.motivo_paragem ? ' · ' + esc(o.motivo_paragem) : ''}` : '—'],
    ['Obs.', o.obs || '—'],
  ];
  $('#detCorpo').innerHTML = `<h3>${esc(opTxt(o))}${o.urgente ? ' <span class="tag urg">urgente</span>' : ''}${o.manutencao ? ' <span class="tag manut">manutenção</span>' : ''}</h3>
    <table class="det-tab">${campos.map(([k, v]) => `<tr><th>${k}</th><td>${['Campo OP', 'Estado', 'Plano', 'Data limite', 'Real', 'Paragens'].includes(k) ? v : esc(v)}</td></tr>`).join('')}</table>
    <div class="det-rod">${uni ? `<a class="btn" href="${esc(uni.url)}" target="_blank" rel="noopener">abrir ${esc(o.unidade)} na app ↗</a>` : ''}<span class="nota">o dashboard só lê — qualquer correcção faz-se na app de origem</span></div>`;
  $('#detalhe').hidden = false;
}
function fecharDetalhe() { $('#detalhe').hidden = true; }

// ------------------------------------------------------------
// Carregamento
// ------------------------------------------------------------
async function carregar(forcar) {
  const main = $('#main');
  main.classList.add('a-actualizar');
  try {
    if (forcar) await fetch('/api/refresh', { method: 'POST' }).catch(() => {});
    const r = await fetch('/api/resumo', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    DADOS = await r.json();
    render();
    main.classList.remove('a-carregar');
  } catch (e) {
    toast('Falha a ler o dashboard: ' + e.message);
  } finally {
    main.classList.remove('a-actualizar');
  }
}
function agendar() {
  clearInterval(temporizador);
  const seg = (DADOS && DADOS.refresh_seg) || 60;
  temporizador = setInterval(() => { if (!document.hidden) carregar(false); }, seg * 1000);
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------
function render() {
  if (!DADOS) return;
  document.body.classList.toggle('uma-unidade', !!ECRA);
  renderMeta(); renderFontes(); renderSelects(); renderKpis(); renderOps();
  if (!$('#qResultados').hidden) renderPesquisa();
  if (VISTA === 'enc') carregarEnc();
  agendar();
}

function renderMeta() {
  const d = DADOS;
  const hora = d.ultima_agregacao ? new Date(d.ultima_agregacao).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '—';
  $('#meta').textContent = `${ECRA ? 'UNIDADE ' + ECRA + ' · ' : ''}${dPT(d.hoje)}/${d.hoje.slice(0, 4)} · semana ${d.semana.split('-W')[1]} · última leitura ${hora} · ${d.fontes_ok}/${d.fontes_total} apps ligadas · actualiza a cada ${d.refresh_seg} s`;
}

function renderFontes() {
  $('#fontes').innerHTML = DADOS.unidades.map(u => {
    const f = u.fonte;
    const cls = !f.ok ? 'falha' : (f.idade_min != null && f.idade_min > 10 ? 'velho' : (f.registos_ignorados ? 'velho' : 'ok'));
    const tit = f.ok ? `OK · ${f.n} registos · ${f.ms} ms · lida há ${f.idade_min ?? 0} min${f.registos_ignorados ? `\n${f.registos_ignorados} registo(s) ignorado(s) por dados inesperados:\n` + (f.registos_erro || []).join('\n') : ''}` : `FALHA: ${f.erro || '?'}${f.ultima_ok ? ' · última leitura boa ' + new Date(f.ultima_ok).toLocaleString('pt-PT') : ' · nunca lida desde o arranque'}\n${f.url || ''}`;
    return `<span class="chip ${cls}" title="${esc(tit)}"><i class="pt"></i>${esc(u.unidade)}</span>`;
  }).join('');
}

function renderSelects() {
  const se = $('#selUnidade');
  if (se.options.length <= 1) {
    DADOS.unidades.forEach(u => se.insertAdjacentHTML('beforeend', `<option value="${esc(u.unidade)}">${esc(u.unidade)}</option>`));
    se.value = ECRA;
  }
}

function kpiTile(cls, rot, val, det, alvo, alerta) {
  return `<div class="kpi ${cls}" data-alvo="${alvo}" role="button" tabindex="0">
    <div class="rot">${rot}</div>
    <div class="val${alerta ? ' alerta' : ''}">${val}</div>
    <div class="det">${det}</div></div>`;
}
function renderKpis() {
  const base = (DADOS.ops_por_abrir || []).filter(o => !ECRA || o.unidade === ECRA);
  const vis = base.filter(o => !(ANTIGAS && antiga(o)));
  const nAntigas = base.filter(antiga).length;
  const hoje = vis.filter(o => o.dias_plano === 0).length;
  const d12 = vis.filter(o => o.dias_plano === 1 || o.dias_plano === 2).length;
  const d1 = vis.filter(o => o.dias_plano === 1).length;
  $('#kpis').innerHTML = [
    kpiTile('k-op', 'OP por abrir', vis.length, `${ANTIGAS ? 'sem as antigas · ' : ''}${vis.filter(o => o.dias_plano != null && o.dias_plano >= 0 && o.dias_plano <= 3).length} de D a D+3 · ${vis.filter(o => o.dias_plano == null || o.dias_plano > 3).length} depois ou sem data${ANTIGAS ? '' : ` · ${vis.filter(antiga).length} antigas`}`, 'todas', false),
    kpiTile('k-hoje', 'Hoje (D)', hoje, 'plano hoje (ou fim-de-semana/feriado seguinte) — abrir a OP já', 'd0', hoje > 0),
    kpiTile('k-d12', 'D+1 e D+2', d12, `${d1} em D+1 · ${d12 - d1} em D+2 (dias úteis)`, 'd2', d12 > 0),
    kpiTile('k-antigas', 'Antigas', nAntigas, 'plano anterior a hoje — não entram nos filtros D; clicar mostra-as', 'antigas', false),
  ].join('');
  $$('#kpis .kpi').forEach(el => el.addEventListener('click', () => {
    const m = el.dataset.alvo;
    if (m === 'antigas') { if (ANTIGAS) definirAntigas(false); definirFiltroData('antigas'); }
    else definirFiltroData(m);
    if (!document.body.classList.contains('tv')) $('#opsSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ------------------------------------------------------------
// OPs por abrir
// ------------------------------------------------------------
// Filtro de datas (dia planeado): Hoje (dias = 0; inclui atrasadas se não ignoradas), até D+1, até D+2, até D+3, personalizado (de…até), todas
// "Ignorar antigas" tira da lista e das contagens as ordens com plano antes de hoje.
const PARAMS = new URLSearchParams(location.search);
let FDATA = { modo: PARAMS.get('dias') != null ? (['todas', 'antigas'].includes(PARAMS.get('dias')) ? PARAMS.get('dias') : 'd' + PARAMS.get('dias')) : (PARAMS.get('de') || PARAMS.get('ate') ? 'custom' : 'd3'), de: PARAMS.get('de') || '', ate: PARAMS.get('ate') || '' };
let ANTIGAS = PARAMS.get('antigas') != null ? PARAMS.get('antigas') === 'ignorar' : (() => { try { return localStorage.getItem('dg_antigas') === 'ignorar'; } catch (e) { return false; } })();
const refPlano = o => o.data_plano || (o.semana_plano ? segundaISO(o.semana_plano) : null);
function segundaISO(wk) { const m = /(\d{4})-W(\d{1,2})/.exec(wk || ''); if (!m) return null; const j4 = new Date(Date.UTC(+m[1], 0, 4)); const dn = (j4.getUTCDay() + 6) % 7; j4.setUTCDate(j4.getUTCDate() - dn + (+m[2] - 1) * 7); return j4.toISOString().slice(0, 10); }
const antiga = o => o.dias_plano != null && o.dias_plano < 0;
function passaData(o) {
  const m = FDATA.modo;
  if (m === 'todas') return true;
  if (m === 'antigas') return antiga(o);
  if (m === 'custom') { const r = refPlano(o); if (!r) return false; return (!FDATA.de || r >= FDATA.de) && (!FDATA.ate || r <= FDATA.ate); }
  const n = +m.slice(1); return o.dias_plano != null && o.dias_plano >= 0 && o.dias_plano <= n; // D = hoje; atrasadas nunca entram nos filtros D
}
function opsUnidade() { return (DADOS.ops_por_abrir || []).filter(o => (!ECRA || o.unidade === ECRA) && !(ANTIGAS && antiga(o))); }
function opsVisiveis() { return opsUnidade().filter(passaData); }
function definirFiltroData(modo, de, ate) {
  FDATA = { modo, de: de || '', ate: ate || '' };
  const u = new URL(location.href); u.searchParams.delete('dias'); u.searchParams.delete('de'); u.searchParams.delete('ate');
  if (modo === 'todas') u.searchParams.set('dias', 'todas'); else if (modo === 'custom') { if (FDATA.de) u.searchParams.set('de', FDATA.de); if (FDATA.ate) u.searchParams.set('ate', FDATA.ate); } else if (modo === 'antigas') u.searchParams.set('dias', 'antigas'); else if (modo !== 'd3') u.searchParams.set('dias', modo.slice(1));
  history.replaceState(null, '', u); OPS_TUDO = false; renderOps();
  $$('#kpis .kpi').forEach(el => el.classList.toggle('activo', el.dataset.alvo === FDATA.modo));
}
function definirAntigas(ignorar) {
  ANTIGAS = !!ignorar; try { localStorage.setItem('dg_antigas', ANTIGAS ? 'ignorar' : 'mostrar'); } catch (e) { /* sem storage */ }
  const u = new URL(location.href); if (ANTIGAS) u.searchParams.set('antigas', 'ignorar'); else u.searchParams.delete('antigas');
  history.replaceState(null, '', u); OPS_TUDO = false; renderKpis(); renderOps();
}
// cor do cartão: hoje (e atrasadas) = vermelho · D+1 e D+2 = amarelo · D+3 em diante = azul · sem data = cinzento
const classeDias = o => o.dias_plano == null ? 'semdata' : (o.dias_plano < 0 ? 'atrasada' : (o.dias_plano === 0 ? 'hoje' : (o.dias_plano <= 2 ? 'd' + o.dias_plano : 'd3mais')));
function etiquetaDias(o) {
  const d = o.dias_plano;
  if (d == null) return 'sem data';
  if (d < 0) return `ATRASADA · ${o.dias_corridos != null ? -o.dias_corridos : -d} d`;
  if (d === 0) return o.dias_corridos > 0 ? `HOJE · plano ${refPlanoTxt(o)}` : 'HOJE';
  return `D+${d} · ${refPlanoTxt(o)}`;
}
function renderOps() {
  const todas = DADOS.ops_por_abrir || [];
  const daUnidade = opsUnidade();
  const lista = opsVisiveis();
  const porU = {}; for (const o of todas) porU[o.unidade] = (porU[o.unidade] || 0) + 1;
  $('#opsChips').innerHTML = DADOS.unidades.map(u => `<button type="button" class="chip${ECRA === u.unidade ? ' activo' : ''}${porU[u.unidade] ? '' : ' zero'}" data-unidade="${esc(u.unidade)}" title="${porU[u.unidade] ? 'só ' + u.unidade : u.unidade + ': nada por abrir'}">${esc(u.unidade)} <b>${porU[u.unidade] || 0}</b></button>`).join('');
  $$('#opsChips .chip').forEach(el => el.addEventListener('click', () => definirEcra(ECRA === el.dataset.unidade ? '' : el.dataset.unidade)));
  // filtros rápidos de data (contagens sobre a unidade escolhida)
  const nAte = n => daUnidade.filter(o => o.dias_plano != null && o.dias_plano >= 0 && o.dias_plano <= n).length;
  const nAntigas = (DADOS.ops_por_abrir || []).filter(o => (!ECRA || o.unidade === ECRA) && antiga(o)).length;
  const btn = (modo, rot, n, tit) => `<button type="button" class="fd ${modo}${FDATA.modo === modo ? ' activo' : ''}" data-modo="${modo}" title="${esc(tit)}">${rot} <b>${n}</b></button>`;
  $('#opsFiltroData').innerHTML = btn('d0', 'Hoje', nAte(0), 'D = hoje (inclui planos ao fim-de-semana/feriado que vêm a seguir); as atrasadas só aparecem em Todas / Antigas')
    + btn('d1', 'até D+1', nAte(1), 'até ao próximo dia útil') + btn('d2', 'até D+2', nAte(2), 'até daqui a 2 dias úteis') + btn('d3', 'até D+3', nAte(3), 'até daqui a 3 dias úteis')
    + btn('todas', 'Todas', daUnidade.length, 'sem horizonte')
    + `<span class="fd-custom${FDATA.modo === 'custom' ? ' activo' : ''}"><button type="button" class="fd custom${FDATA.modo === 'custom' ? ' activo' : ''}" data-modo="custom" title="intervalo de dias planeados">Personalizado</button>
       <label>de <input type="date" id="fdDe" value="${esc(FDATA.de)}"></label><label>até <input type="date" id="fdAte" value="${esc(FDATA.ate)}"></label></span>
       <label class="fd-antigas" title="esconder as ordens com dia planeado anterior a hoje (lixo de planeamento ou já resolvidas na prática)"><input type="checkbox" id="fdAntigas"${ANTIGAS ? ' checked' : ''}> ignorar antigas <b>${nAntigas}</b></label>`;
  $$('#opsFiltroData .fd').forEach(b => b.addEventListener('click', () => { const m = b.dataset.modo; if (m === 'custom') { const de = $('#fdDe').value || DADOS.hoje, ate = $('#fdAte').value || de; definirFiltroData('custom', de, ate); } else definirFiltroData(m); }));
  const aoMudarData = () => { const de = $('#fdDe').value, ate = $('#fdAte').value; if (de || ate) definirFiltroData('custom', de, ate); };
  $('#fdDe').addEventListener('change', aoMudarData); $('#fdAte').addEventListener('change', aoMudarData);
  $('#fdAntigas').addEventListener('change', e => definirAntigas(e.target.checked));
  const nHoje = lista.filter(o => o.dias_plano === 0).length, nAmarelas = lista.filter(o => o.dias_plano === 1 || o.dias_plano === 2).length, nAtr = lista.filter(antiga).length;
  const descFiltro = FDATA.modo === 'todas' ? 'todas as datas' : (FDATA.modo === 'custom' ? `plano de ${dPT(FDATA.de) === '—' ? '…' : dPT(FDATA.de)} até ${dPT(FDATA.ate) === '—' ? '…' : dPT(FDATA.ate)}` : (FDATA.modo === 'd0' ? 'D' : (FDATA.modo === 'antigas' ? 'só antigas (plano antes de hoje)' : `até D+${FDATA.modo.slice(1)} úteis`)));
  $('#opsResumo').textContent = lista.length ? `${lista.length} sem número de OP (${descFiltro}) · ${nHoje} para hoje · ${nAmarelas} para D+1/D+2${nAtr ? ` · ${nAtr} atrasadas` : ''}${ANTIGAS ? ' · antigas ignoradas' : ''}` : (daUnidade.length ? `nenhuma neste filtro (${descFiltro}); ${daUnidade.length} no total${ANTIGAS ? ', antigas ignoradas' : ''}` : 'todas as ordens activas têm número de OP');
  const tv = document.body.classList.contains('tv');
  const MAX = tv ? 6 : (OPS_TUDO ? 5000 : 20); // por coluna (unidade)
  const cartao = o => `<article class="ocard ${classeDias(o)} ${o.sem_op_nivel}" data-id="${esc(o.id)}" title="Ver detalhe">
      <div class="oc-cab"><span class="oc-dias">${esc(etiquetaDias(o))}</span><span class="oc-maq" title="${esc([o.maquina, o.fase].filter(Boolean).join(' · '))}">${esc(o.maquina || '')}</span></div>
      <div class="oc-op"><b>${esc(o.op || '(campo OP vazio)')}</b>${o.urgente ? ' <span class="tag urg">urg</span>' : ''}</div>
      <div class="oc-plano">plano <b>${esc(planoTxt(o))}</b>${o.plano_granularidade !== 'dia' ? ' <span class="origem">(semana → 2.ª feira)</span>' : ''}${o.data_limite ? ` · limite ${dPT(o.data_limite)}` : ''}</div>
      <div class="oc-det" title="${esc([o.cliente, o.produto, o.calibre].filter(Boolean).join(' · '))}">${esc(o.cliente || '—')} · ${esc(o.produto || '—')}${o.calibre ? ' · ' + esc(o.calibre) : ''}</div>
      <div class="oc-lin"><span title="${esc([o.pedido ? 'pedido ' + o.pedido : '', o.ref && o.ref !== o.op ? o.ref : ''].filter(Boolean).join(' · '))}">${o.pedido ? esc(o.pedido) : ''}${o.ref && o.ref !== o.op ? (o.pedido ? ' · ' : '') + esc(o.ref) : ''}</span><span>${o.qtd ? nR(o.qtd) + ' un.' : ''}</span></div>
      <div class="oc-rod"><span class="est ${o.estado}" title="${esc(DADOS.estados[o.estado] || '')}"><i></i>${esc(o.estado_origem || DADOS.estados[o.estado])}</span><a class="oc-lnk" href="${esc((unidade(o.unidade) || {}).url || '#')}" target="_blank" rel="noopener" title="abrir a app de ${esc(o.unidade)}">↗</a></div>
      ${o.obs ? `<div class="oc-obs" title="${esc(o.obs)}">${esc(o.obs)}</div>` : ''}
    </article>`;
  // uma coluna por unidade (área), pela ordem das fontes; com uma unidade seleccionada mostra só essa, em grelha
  const unidadesCol = DADOS.unidades.filter(u => !ECRA || u.unidade === ECRA);
  let escondidas = 0;
  $('#opsCards').className = 'ocols' + (ECRA ? ' uma' : '');
  $('#opsCards').innerHTML = unidadesCol.map(u => {
    const l = lista.filter(o => o.unidade === u.unidade);
    const nH = l.filter(o => o.dias_plano === 0).length, nA = l.filter(o => o.dias_plano === 1 || o.dias_plano === 2).length;
    const mostrar = l.slice(0, MAX); escondidas += l.length - mostrar.length;
    const f = u.fonte;
    return `<div class="ocol${l.length ? '' : ' vazia'}${f.ok ? '' : ' falha'}" data-unidade="${esc(u.unidade)}">
      <div class="ocol-cab" title="${esc(u.nome)}${f.ok ? '' : ' — SEM LEITURA: ' + (f.erro || '')}${f.registos_ignorados ? ` — ${f.registos_ignorados} registo(s) ignorado(s): ` + esc((f.registos_erro || []).join('; ')) : ''}"><b>${esc(u.unidade)}</b><span class="ocol-n">${l.length}</span>${nH ? `<span class="ocol-h" title="para hoje">${nH}</span>` : ''}${nA ? `<span class="ocol-a" title="D+1 e D+2">${nA}</span>` : ''}${f.ok ? (f.registos_ignorados ? `<span class="ocol-w" title="${esc(f.registos_ignorados + ' registo(s) ignorado(s): ' + (f.registos_erro || []).join('; '))}">⚠</span>` : '') : '<span class="ocol-x" title="app sem leitura">✕</span>'}</div>
      <div class="ocol-cards">${mostrar.map(cartao).join('') || `<div class="ocol-vazia">${f.ok ? 'nada por abrir' : `<b>sem leitura da app</b><br>${esc(f.erro || '')}<br><span class="origem">${f.ultima_ok ? 'última leitura boa ' + new Date(f.ultima_ok).toLocaleString('pt-PT') : 'nunca lida desde o arranque'} · <a href="${esc(u.url)}" target="_blank" rel="noopener">abrir app ↗</a></span>`}</div>`}</div>
      ${l.length > MAX ? `<div class="ocol-mais">+ ${l.length - MAX}</div>` : ''}
    </div>`;
  }).join('');
  $('#opsMais').innerHTML = escondidas > 0 ? `+ ${escondidas} ordens além das ${MAX} por coluna${tv ? ' (modo TV mostra as mais próximas)' : ` — <a href="#" id="opsVerTudo">mostrar todas</a>`}` : (OPS_TUDO ? '<a href="#" id="opsVerMenos">mostrar menos</a>' : '');
  const vt = $('#opsVerTudo'); if (vt) vt.addEventListener('click', e => { e.preventDefault(); OPS_TUDO = true; renderOps(); });
  const vm = $('#opsVerMenos'); if (vm) vm.addEventListener('click', e => { e.preventDefault(); OPS_TUDO = false; renderOps(); });
  $$('#opsCards .ocard').forEach(c => c.addEventListener('click', e => { if (e.target.closest('a')) return; abrirDetalhe(c.dataset.id); }));
}
function exportarCsvOps() {
  const lista = opsVisiveis();
  const niv = { critico: 'plano passado/hoje', serio: 'próximos 7 dias', aviso: 'mais tarde' };
  const cab = ['Unidade', 'Urgencia', 'D-n', 'Dias ate ao plano', 'Dia plano', 'Semana plano', 'Campo OP', 'Lote/Ref', 'Pedido', 'Cliente', 'Produto', 'Calibre', 'Qtd (un)', 'Maquina', 'Fase', 'Estado na app', 'Data limite', 'Urgente', 'Obs'];
  const linhas = lista.map(o => [o.unidade, niv[o.sem_op_nivel] || '', etiquetaDias(o), o.dias_plano ?? '', o.data_plano || '', o.semana_plano || '', o.op, o.ref, o.pedido, o.cliente, o.produto, o.calibre, o.qtd, o.maquina, o.fase, o.estado_origem, o.data_limite || '', o.urgente ? 'sim' : '', o.obs]
    .map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';'));
  const blob = new Blob(['﻿' + [cab.join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ops_por_abrir_${ECRA ? ECRA.replace(/\s+/g, '_') + '_' : ''}${FDATA.modo}_${DADOS.hoje}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function definirEcra(u) {
  ECRA = u || ''; const url = new URL(location.href);
  if (ECRA) url.searchParams.set('unidade', ECRA); else url.searchParams.delete('unidade');
  history.replaceState(null, '', url);
  $('#selUnidade').value = ECRA; OPS_TUDO = false; render();
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 4000); }


// ============================================================
// Separador "Encomendas" — rastreio por Pedido_Item (Encomendas.xlsx carregado por upload)
// ============================================================
let VISTA = new URLSearchParams(location.search).get('vista') === 'enc' ? 'enc' : 'ops';
let ENC = null; // resposta de /api/encomendas
let ENC_FILTRO = { estado: '', unidade: '', pesq: '', risco: false, semConc: false, ordem: 'prazo' };
const ENC_ABERTOS = new Set();
let ENC_TUDO = false;
const SHEETJS = 'vendor/xlsx-0.18.5.full.min.js'; // SheetJS CE 0.18.5 (npm), servido localmente — ver README (CVE-2023-30533)
const RISCO_TXT = { prazo_passado: 'prazo já passou e a encomenda não está concluída', fim_depois_do_prazo: 'fim previsto depois do prazo', sem_plano_prazo_proximo: 'sem planeamento e prazo a ≤ 14 dias' };

function definirVista(v) {
  VISTA = v === 'enc' ? 'enc' : 'ops';
  const u = new URL(location.href); if (VISTA === 'enc') u.searchParams.set('vista', 'enc'); else u.searchParams.delete('vista'); history.replaceState(null, '', u);
  $$('#vistas .vista').forEach(b => b.classList.toggle('activo', b.dataset.vista === VISTA));
  $('#vistaOps').hidden = VISTA !== 'ops'; $('#vistaEnc').hidden = VISTA !== 'enc';
  if (VISTA === 'enc') carregarEnc();
}

async function carregarEnc() {
  try {
    const r = await fetch('/api/encomendas', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    ENC = await r.json();
    renderEnc();
  } catch (e) { $('#encInfo').textContent = 'Falha a ler as encomendas: ' + e.message; }
}

function chipUnidade(u, ords) {
  const l = ords.filter(o => o.unidade === u);
  const cls = l.some(o => o.em_curso) ? 'proc' : (l.every(o => o.terminal) ? 'feito' : 'plan');
  const tit = l.map(o => `${o.op || '—'} · ${o.estado_origem || DADOS?.estados?.[o.estado] || o.estado}${o.maquina ? ' · ' + o.maquina : ''}${o.data_plano ? ' · plano ' + dPT(o.data_plano) : ''}`).join('\n');
  return `<span class="uchip ${cls}" title="${esc(tit)}">${esc(u)}${l.length > 1 ? ` <b>${l.length}</b>` : ''}</span>`;
}
const folgaTxt = e => e.folga_dias == null ? '—' : (e.folga_dias > 0 ? `+${e.folga_dias} d` : `${e.folga_dias} d`);

function encFiltradas() {
  if (!ENC || !ENC.carregado) return [];
  const toks = normTexto(ENC_FILTRO.pesq).split(' ').filter(Boolean);
  let l = ENC.encomendas.filter(e => {
    if (ENC_FILTRO.estado === 'em_risco') { if (!e.risco) return false; }
    else if (ENC_FILTRO.estado === 'sem_op') { if (!e.sem_op) return false; }
    else if (ENC_FILTRO.estado && e.estado !== ENC_FILTRO.estado) return false;
    if (ENC_FILTRO.risco && !e.risco) return false;
    if (ENC_FILTRO.semConc && e.estado === 'concluida') return false;
    if (ENC_FILTRO.unidade && !e.unidades.includes(ENC_FILTRO.unidade)) return false;
    if (toks.length) {
      const t = normTexto([e.pedido_item, e.pedido_item.replace('-', '_'), e.n_pedido, e.cliente, e.alias, e.material, e.descricao, e.desc_cliente, e.calibre, e.qualidade, ...Object.values(e.obs || {}), ...e.ordens.map(o => o.op + ' ' + o.unidade + ' ' + (o.maquina || ''))].join(' | '));
      if (!toks.every(k => t.includes(k))) return false;
    }
    return true;
  });
  const k = ENC_FILTRO.ordem;
  const s = (a, b) => String(a ?? '9999').localeCompare(String(b ?? '9999'));
  if (k === 'fim') l = [...l].sort((a, b) => s(a.fim_previsto || a.fim_real, b.fim_previsto || b.fim_real) || s(a.prazo, b.prazo));
  else if (k === 'folga') l = [...l].sort((a, b) => (a.folga_dias ?? 1e9) - (b.folga_dias ?? 1e9) || s(a.prazo, b.prazo));
  else if (k === 'pi') l = [...l].sort((a, b) => a.pedido_item.localeCompare(b.pedido_item));
  return l;
}

function renderEnc() {
  if (!ENC) return;
  const sel = $('#encUnidade');
  if (sel.options.length <= 1 && DADOS) DADOS.unidades.forEach(u => sel.insertAdjacentHTML('beforeend', `<option value="${esc(u.unidade)}">${esc(u.unidade)}</option>`));
  if (!ENC.carregado) {
    $('#encInfo').textContent = 'Ainda não foi carregado nenhum Encomendas.xlsx — usa o botão "Carregar".';
    $('#encKpis').innerHTML = ''; $('#encBody').innerHTML = `<tr><td colspan="10" class="vazio-ok">Carrega o Encomendas.xlsx (pasta Industrial Planning - Encomendas) para começar.</td></tr>`; $('#encContagem').textContent = ''; $('#encMais').textContent = '';
    return;
  }
  const quando = ENC.carregado_em ? new Date(ENC.carregado_em).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const folhas = (ENC.folhas || []).filter(f => f.usadas).map(f => `${f.nome} (${f.linhas})`).join(', ');
  $('#encInfo').innerHTML = `${esc(ENC.ficheiro)}${ENC.ficheiro_modificado ? ' · gravado ' + esc(new Date(ENC.ficheiro_modificado).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : ''} · carregado ${esc(quando)}${ENC.carregado_por ? ' por ' + esc(ENC.carregado_por) : ''} · ${ENC.totais.total} Pedido_Item${folhas ? ' · folhas: ' + esc(folhas) : ''}${!ENC.persistido ? ' · <b class="atr-prazo">não gravado em disco: volta a carregar</b>' : (ENC.disco_persistente ? '' : ' · <span class="atr-plano" title="O servidor não tem volume persistente: um novo deploy apaga o ficheiro carregado. Ver README (Railway → Volume).">sem volume: carregar de novo após cada deploy</span>')}`;
  const T = ENC.totais;
  const tile = (cls, rot, val, det, alvo, alerta) => `<div class="kpi ${cls}${ENC_FILTRO.estado === alvo ? ' activo' : ''}" data-alvo="${alvo}" role="button" tabindex="0"><div class="rot">${rot}</div><div class="val${alerta ? ' alerta' : ''}">${val}</div><div class="det">${det}</div></div>`;
  $('#encKpis').innerHTML = [
    tile('k-op', 'Encomendas', T.total, 'Pedido_Item no Excel', '', false),
    tile('k-antigas', 'Sem planeamento', T.sem_plano, 'não encontradas em nenhuma app', 'sem_plano', false),
    tile('k-semana', 'Planeadas', T.planeada, 'com ordens, nenhuma começou', 'planeada', false),
    tile('k-proc', 'Em curso', T.em_curso, 'alguma ordem em processo ou parte feita', 'em_curso', false),
    tile('k-ativas', 'Concluídas nas apps', T.concluida, 'todas as ordens ligadas terminadas', 'concluida', false),
    tile('k-hoje', 'Em risco', T.em_risco, 'fim previsto após o prazo, prazo passado, ou sem plano a ≤ 14 d', 'em_risco', T.em_risco > 0),
    tile('k-d12', 'Com OP por abrir', T.sem_op, 'alguma ordem ligada sem nº de OP', 'sem_op', T.sem_op > 0),
  ].join('');
  $$('#encKpis .kpi').forEach(el => el.addEventListener('click', () => { ENC_FILTRO.estado = ENC_FILTRO.estado === el.dataset.alvo ? '' : el.dataset.alvo; ENC_TUDO = false; renderEnc(); }));
  const lista = encFiltradas();
  $('#encContagem').textContent = `${lista.length} de ${T.total}`;
  const tv = document.body.classList.contains('tv');
  const MAX = tv ? 25 : (ENC_TUDO ? 5000 : 150);
  const linha = e => {
    const aberto = ENC_ABERTOS.has(e.pedido_item);
    const unids = ORDEM_UNID_ENC.filter(u => e.unidades.includes(u)).map(u => chipUnidade(u, e.ordens)).join(' ');
    const ondeTxt = e.em_processo.length ? `em processo: ${e.em_processo.map(x => x.unidade + (x.maquina ? ' · ' + x.maquina : '')).join(', ')}` : (e.proxima ? `próxima: ${e.proxima.unidade} ${dPT(e.proxima.data_plano)}${e.proxima.hora_plano_ini ? ' ' + e.proxima.hora_plano_ini : ''}` : '');
    const fim = e.estado === 'concluida' ? `<span class="nota">terminou ${dPT(e.fim_real)}</span>` : (e.fim_previsto ? `<b>${diaSem(e.fim_previsto)} ${dPT(e.fim_previsto)}</b>` : (e.n_ordens ? '<span class="nota">sem data</span>' : '—'));
    const cls = e.risco ? 'risco' : (e.estado === 'concluida' ? 'conc' : '');
    let h = `<tr class="enc-l ${cls}" data-pi="${esc(e.pedido_item)}" title="Ver o percurso">
      <td><b>${esc(e.pedido_item.replace('-', '_'))}</b>${e.folhas && e.folhas.length > 1 ? ` <span class="tag" title="${esc(e.folhas.join(' + '))}">${e.folhas.length} folhas</span>` : ''}${e.n_pedido ? `<div class="origem">${esc(e.n_pedido)}</div>` : ''}</td>
      <td class="cliente" title="${esc([e.cliente, e.alias, e.desc_cliente].filter(Boolean).join(' · '))}">${esc(e.alias || e.cliente || '—')}${e.cliente && e.alias ? `<div class="origem">${esc(e.cliente)}</div>` : ''}</td>
      <td class="produto" title="${esc([e.material, e.descricao].filter(Boolean).join(' · '))}">${esc(e.descricao || e.material || '—')}${e.servicos ? `<div class="origem">${esc(e.servicos)}</div>` : ''}</td>
      <td class="num">${e.qt != null ? String(e.qt).replace('.', ',') : '—'}</td>
      <td title="${e.prazo_tipo === 'prometida' ? 'data prometida ao cliente' : (e.prazo_tipo === 'desejada' ? 'data desejada de remessa (sem data prometida)' : '')}">${e.prazo ? `${diaSem(e.prazo)} ${dPT(e.prazo)}` : '—'}${e.prazo_tipo === 'desejada' ? '<div class="origem">desejada</div>' : ''}</td>
      <td><span class="eest ${e.estado}">${esc(e.estado_label)}</span>${e.sem_op ? ' <span class="tag semop" title="alguma ordem ligada ainda sem número de OP">sem OP</span>' : ''}${e.risco ? `<div class="origem atr-prazo">${esc(RISCO_TXT[e.risco] || e.risco)}</div>` : ''}</td>
      <td class="onde">${unids || '<span class="nota">não encontrada nas apps</span>'}${ondeTxt ? `<div class="origem">${esc(ondeTxt)}</div>` : ''}</td>
      <td>${fim}</td>
      <td class="num ${e.folga_dias != null && e.folga_dias < 0 ? 'atr-prazo' : ''}">${folgaTxt(e)}</td>
      <td class="lnk">${aberto ? '▾' : '▸'}</td></tr>`;
    if (aberto) {
      const ords = e.ordens.map(o => `<tr class="${o.em_curso ? 'proc' : (o.terminal ? 'feito' : '')}">
          <td>${esc(o.unidade)}</td><td><b>${esc(o.op || '—')}</b>${o.sem_op ? ' <span class="tag semop">sem OP</span>' : ''}</td><td>${esc(o.maquina || '—')}${o.fase ? `<div class="origem">${esc(o.fase)}</div>` : ''}</td>
          <td><span class="est ${o.estado}"><i></i>${esc(o.estado_origem || o.estado)}</span></td>
          <td>${o.data_plano ? `${dPT(o.data_plano)}${o.hora_plano_ini ? ' ' + o.hora_plano_ini : ''}${o.data_fim_plano && (o.data_fim_plano !== o.data_plano || o.hora_plano_fim) ? ` → ${dPT(o.data_fim_plano)}${o.hora_plano_fim ? ' ' + o.hora_plano_fim : ''}` : ''}` : (o.semana_plano ? 'S' + o.semana_plano.split('-W')[1] : '—')}</td>
          <td>${o.real_inicio || o.real_fim ? `${dhPT(o.real_inicio)} → ${dhPT(o.real_fim)}` : '—'}</td>
          <td class="num">${o.qtd ? nR(o.qtd) : '—'}</td>
          <td><span class="tag" title="${o.via.includes('obs') ? 'OP citada na OBS do Excel' : ''}${o.via === 'obs+pedido' ? ' e ' : ''}${o.via.includes('pedido') ? 'Pedido_Item no campo pedido/OP/obs da app' : ''}">${o.via === 'obs+pedido' ? 'pedido + OBS' : (o.via === 'obs' ? 'OBS Excel' : 'pedido')}</span></td>
          <td class="lnk"><a href="${esc((unidade(o.unidade) || {}).url || '#')}" target="_blank" rel="noopener" title="abrir a app de ${esc(o.unidade)}">↗</a></td></tr>`).join('');
      const obs = Object.entries(e.obs || {}).map(([k, v]) => `<div><span class="origem">${esc(k)}:</span> ${esc(v)}</div>`).join('');
      h += `<tr class="enc-det"><td colspan="10">
        ${e.ordens.length ? `<table class="enc-ords"><thead><tr><th>Unidade</th><th>OP</th><th>Máq. / linha</th><th>Estado na app</th><th>Plano (início → fim)</th><th>Real (início → fim)</th><th class="num">Qtd (un.)</th><th>Ligação</th><th></th></tr></thead><tbody>${ords}</tbody></table>` : '<div class="nota">Nenhuma ordem encontrada nos planeamentos com este Pedido_Item nem com as OPs citadas nas OBS.</div>'}
        ${e.ops_obs_nao_encontradas && e.ops_obs_nao_encontradas.length ? `<div class="nota">OPs citadas nas OBS e não encontradas em nenhuma app: ${esc(e.ops_obs_nao_encontradas.join(', '))} (ex.: ordens de corte 950…, MIX 160…, ou já removidas da app)</div>` : ''}
        ${obs ? `<div class="enc-obs">${obs}</div>` : ''}
      </td></tr>`;
    }
    return h;
  };
  $('#encBody').innerHTML = lista.length ? lista.slice(0, MAX).map(linha).join('') : `<tr><td colspan="10" class="vazio-ok">Nenhuma encomenda com este filtro.</td></tr>`;
  $('#encMais').innerHTML = lista.length > MAX ? `+ ${lista.length - MAX} encomendas${tv ? '' : ' — <a href="#" id="encVerTudo">mostrar todas</a>'}` : '';
  const vt = $('#encVerTudo'); if (vt) vt.addEventListener('click', ev => { ev.preventDefault(); ENC_TUDO = true; renderEnc(); });
  $$('#encBody tr.enc-l').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('a')) return; const pi = tr.dataset.pi; if (ENC_ABERTOS.has(pi)) ENC_ABERTOS.delete(pi); else ENC_ABERTOS.add(pi); renderEnc(); }));
}
const ORDEM_UNID_ENC = ['WIM', 'PURECORK', 'DSL', 'DSL TALIS', 'DENSIDADES', 'VOCUS', 'DS100'];

function exportarCsvEnc() {
  const l = encFiltradas();
  const cab = ['Pedido_Item', 'Nº pedido', 'Cliente', 'Alias', 'Material', 'Descrição', 'Qt', 'Data desejada', 'Data prometida', 'Estado', 'Risco', 'Unidades', 'Em processo em', 'Próxima', 'Fim previsto', 'Fim real', 'Folga (dias)', 'OPs ligadas', 'Folhas'];
  const linhas = l.map(e => [e.pedido_item.replace('-', '_'), e.n_pedido, e.cliente, e.alias, e.material, e.descricao, e.qt, e.data_desejada, e.data_prometida, e.estado_label, RISCO_TXT[e.risco] || '', e.unidades.join(' + '), e.em_processo.map(x => x.unidade + (x.maquina ? ' ' + x.maquina : '')).join(' + '), e.proxima ? `${e.proxima.unidade} ${e.proxima.data_plano || ''}` : '', e.fim_previsto, e.fim_real, e.folga_dias ?? '', e.ordens.map(o => `${o.unidade}:${o.op}`).join(' | '), (e.folhas || []).join(' + ')]
    .map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';'));
  const blob = new Blob(['﻿' + [cab.join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `encomendas_rastreio_${(ENC && ENC.hoje) || ''}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---- upload: o Excel é lido no browser (SheetJS) e só as colunas necessárias seguem para o servidor ----
function carregarScript(src) { return new Promise((ok, falha) => { if (window.XLSX) return ok(); const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => falha(new Error('não foi possível carregar o leitor de Excel (' + src + ')')); document.head.appendChild(s); }); }
const normCab = s => normTexto(s).replace(/[º°ª.]/g, '').replace(/\s+/g, ' ').trim();
function serialParaData(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
  return String(v);
}
function lerLivro(wb) {
  const linhas = [], folhas = [];
  for (const nome of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: false });
    let hi = -1; for (let i = 0; i < Math.min(10, rows.length); i++) if ((rows[i] || []).some(c => normCab(c) === 'pedido_item')) { hi = i; break; }
    if (hi < 0) continue;
    const usar = /^encomendas/i.test(nome.trim()) || /^acompanhamentos$/i.test(nome.trim());
    const cab = rows[hi].map(normCab);
    const col = (...nomes) => { for (const n of nomes) { const i = cab.indexOf(n); if (i >= 0) return i; } return -1; };
    const c = {
      pedido_item: col('pedido_item'), pedido: col('pedido'), item: col('item (pedido)'), n_pedido: col('n pedido', 'no pedido', 'nº pedido'),
      cliente: col('cliente'), alias: col('alias'), tipo: col('tipo'), material: col('material'), descricao: col('texto breve material'), desc_cliente: col('descritivo cliente'),
      calibre: col('calibre'), qualidade: col('qualidade'), lavacao: col('lavacao'), qt: col('qt', 'qt inicial'),
      data_desejada: col('dtdesejada remessa', 'dt desejada remessa'), data_prometida: col('data prometida ao cliente'),
      servicos: cab.findIndex(h => h.startsWith('servicos')),
    };
    const obsCols = cab.map((h, i) => [h, i]).filter(([h]) => h.startsWith('obs')).map(([, i]) => [String(rows[hi][i]).trim(), i]);
    let n = 0;
    for (const r of rows.slice(hi + 1)) {
      const pi = r[c.pedido_item]; if (pi == null || String(pi).trim() === '' || String(pi).trim() === '_') continue;
      n++; if (!usar) continue;
      const g = k => c[k] >= 0 ? r[c[k]] : null;
      const obs = {}; for (const [h, i] of obsCols) { const v = r[i]; if (v != null && v !== 0 && String(v).trim() !== '') obs[h] = String(v); }
      linhas.push({ folha: nome, pedido_item: String(pi), pedido: g('pedido'), item: g('item'), n_pedido: g('n_pedido'), cliente: g('cliente'), alias: g('alias'), tipo: g('tipo'), material: g('material'), descricao: g('descricao'), desc_cliente: g('desc_cliente'), calibre: g('calibre'), qualidade: g('qualidade'), lavacao: g('lavacao'), qt: g('qt'), data_desejada: serialParaData(g('data_desejada')), data_prometida: serialParaData(g('data_prometida')), servicos: g('servicos'), obs });
    }
    folhas.push({ nome, linhas: n, usadas: usar && n > 0, motivo: usar ? '' : 'ignorada (só se usam as folhas "Encomendas…" e "Acompanhamentos")' });
  }
  return { linhas, folhas };
}
async function carregarFicheiroEnc(f) {
  try {
    toast('A ler ' + f.name + '…');
    await carregarScript(SHEETJS);
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const { linhas, folhas } = lerLivro(wb);
    if (!linhas.length) throw new Error('nenhuma linha com Pedido_Item nas folhas "Encomendas…" / "Acompanhamentos"');
    const hdr = { 'Content-Type': 'application/json' };
    if (ENC && ENC.upload_protegido) { let tok = ''; try { tok = localStorage.getItem('dg_upload_token') || ''; } catch (e) { /* sem storage */ } if (!tok) tok = prompt('Código de carregamento (UPLOAD_TOKEN):') || ''; hdr['x-upload-token'] = tok; }
    const r = await fetch('/api/encomendas', { method: 'POST', headers: hdr, body: JSON.stringify({ ficheiro: f.name, ficheiro_modificado: f.lastModified ? new Date(f.lastModified).toISOString() : null, folhas, linhas }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { if (r.status === 401) { try { localStorage.removeItem('dg_upload_token'); } catch (e) { /* */ } } throw new Error(j.error || ('HTTP ' + r.status)); }
    if (hdr['x-upload-token']) { try { localStorage.setItem('dg_upload_token', hdr['x-upload-token']); } catch (e) { /* */ } }
    toast(`${j.n} Pedido_Item carregados${j.persistido ? '' : ' (atenção: não gravado em disco)'}`);
    await carregarEnc();
  } catch (e) { toast('Falha a carregar: ' + e.message); }
}

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
$('#qGlobal').addEventListener('input', renderPesquisa);
$('#qGlobal').addEventListener('focus', renderPesquisa);
$('#qGlobal').addEventListener('keydown', e => { if (e.key === 'Escape') { $('#qResultados').hidden = true; e.target.blur(); } });
document.addEventListener('click', e => { if (!e.target.closest('.pesq-global')) $('#qResultados').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharDetalhe(); });
$('#detalhe').addEventListener('click', e => { if (e.target === e.currentTarget) fecharDetalhe(); });
$('#detFechar').addEventListener('click', fecharDetalhe);
$('#btnCsvOps').addEventListener('click', exportarCsvOps);
$('#selUnidade').addEventListener('change', e => definirEcra(e.target.value));
$('#btnAtualizar').addEventListener('click', () => carregar(true));
$('#btnTema').addEventListener('click', () => { const claro = document.documentElement.dataset.theme === 'light'; if (claro) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light'; try { localStorage.setItem('dg_tema', claro ? 'escuro' : 'claro'); } catch (e) { /* sem storage */ } });
$('#btnTv').addEventListener('click', () => { document.body.classList.toggle('tv'); const u = new URL(location.href); if (document.body.classList.contains('tv')) u.searchParams.set('tv', '1'); else u.searchParams.delete('tv'); history.replaceState(null, '', u); if (DADOS) renderOps(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && DADOS) carregar(false); });

$$('#vistas .vista').forEach(b => b.addEventListener('click', () => definirVista(b.dataset.vista)));
$('#btnEncCarregar').addEventListener('click', () => $('#encFicheiro').click());
$('#encFicheiro').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) carregarFicheiroEnc(f); e.target.value = ''; });
$('#btnEncCsv').addEventListener('click', exportarCsvEnc);
$('#encPesq').addEventListener('input', e => { ENC_FILTRO.pesq = e.target.value; renderEnc(); });
$('#encUnidade').addEventListener('change', e => { ENC_FILTRO.unidade = e.target.value; renderEnc(); });
$('#encOrdem').addEventListener('change', e => { ENC_FILTRO.ordem = e.target.value; renderEnc(); });
$('#encRisco').addEventListener('change', e => { ENC_FILTRO.risco = e.target.checked; renderEnc(); });
$('#encEsconderConc').addEventListener('change', e => { ENC_FILTRO.semConc = e.target.checked; renderEnc(); });
if (new URLSearchParams(location.search).get('tv') === '1') document.body.classList.add('tv');
definirVista(VISTA);
carregar(false);
