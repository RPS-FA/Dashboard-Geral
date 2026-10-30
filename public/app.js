// ============================================================
// Dashboard Geral — urgências de planeamento (JS puro, sem dependências)
// Lê /api/resumo a cada N segundos e mostra: OPs por abrir, pesquisa global, rastreio de encomendas
// (com mini-Gantt dos motores das apps) e o simulador de cenários (POST /api/sim — nunca escreve nas apps).
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
let VISTA = ['enc', 'sim'].includes(new URLSearchParams(location.search).get('vista')) ? new URLSearchParams(location.search).get('vista') : 'ops';
let ENC = null; // resposta de /api/encomendas
let ENC_FILTRO = { estado: '', unidade: '', pesq: '', risco: false, semConc: false };
const ENC_ABERTOS = new Set();
let ENC_TUDO = false;
const SHEETJS = 'vendor/xlsx-0.18.5.full.min.js'; // SheetJS CE 0.18.5 (npm), servido localmente — ver README (CVE-2023-30533)
const RISCO_TXT = { prazo_passado: 'prazo já passou e a encomenda não está concluída', fim_depois_do_prazo: 'fim previsto depois do prazo', sem_plano_prazo_proximo: 'sem planeamento e prazo a ≤ 14 dias' };

function definirVista(v) {
  VISTA = ['enc', 'sim'].includes(v) ? v : 'ops';
  const u = new URL(location.href); if (VISTA !== 'ops') u.searchParams.set('vista', VISTA); else u.searchParams.delete('vista'); history.replaceState(null, '', u);
  $$('#vistas .vista').forEach(b => b.classList.toggle('activo', b.dataset.vista === VISTA));
  $('#vistaOps').hidden = VISTA !== 'ops'; $('#vistaEnc').hidden = VISTA !== 'enc'; $('#vistaSim').hidden = VISTA !== 'sim';
  if (VISTA === 'enc') carregarEnc();
  if (VISTA === 'sim') simIniciar();
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

// Colunas da tabela de encomendas: texto (para pesquisa/filtro por coluna) e valor (para ordenar). Nulos ficam sempre no fim.
const ENC_EST_ORD = { sem_plano: 0, planeada: 1, em_curso: 2, concluida: 3 };
const encOndeTxt = e => e.em_processo.length ? `em processo: ${e.em_processo.map(x => x.unidade + (x.maquina ? ' · ' + x.maquina : '')).join(', ')}` : (e.proxima ? `próxima: ${e.proxima.unidade} ${dPT(e.proxima.data_plano)}${e.proxima.hora_plano_ini ? ' ' + e.proxima.hora_plano_ini : ''}` : '');
const dTxt = d => d ? `${d} ${dPT(d)} ${diaSem(d)}` : '';
const ENC_COLS = [
  { k: 'pi', rot: 'Pedido_Item', txt: e => [e.pedido_item, e.pedido_item.replace('-', '_'), e.n_pedido, (e.folhas || []).join(' ')].join(' '), val: e => e.pedido_item.replace(/-(\d+)$/, (m, i) => '-' + i.padStart(3, '0')) },
  { k: 'cli', rot: 'Cliente · alias', txt: e => [e.alias, e.cliente, e.desc_cliente].join(' '), val: e => (e.alias || e.cliente || '').toLowerCase() || null },
  { k: 'mat', rot: 'Material', txt: e => [e.descricao, e.material, e.servicos, e.calibre, e.qualidade, e.lavacao].join(' '), val: e => (e.descricao || e.material || '').toLowerCase() || null },
  { k: 'qt', rot: 'Qt', num: true, txt: e => e.qt != null ? String(e.qt).replace('.', ',') : '', val: e => e.qt },
  { k: 'prazo', rot: 'Prazo', txt: e => dTxt(e.prazo) + (e.prazo_tipo ? ' ' + e.prazo_tipo : ''), val: e => e.prazo },
  { k: 'estado', rot: 'Estado', txt: e => [e.estado_label, e.sem_op ? 'sem OP' : '', RISCO_TXT[e.risco] || '', e.risco ? 'risco' : ''].join(' '), val: e => ENC_EST_ORD[e.estado] * 10 + (e.risco ? 0 : 1) },
  { k: 'onde', rot: 'Onde está', txt: e => [e.unidades.join(' '), encOndeTxt(e), e.ordens.map(o => `${o.op} ${o.maquina || ''}`).join(' '), e.n_ordens ? '' : 'não encontrada'].join(' '), val: e => e.em_processo.length ? 'a' + e.em_processo[0].unidade : (e.proxima ? 'b' + (e.proxima.data_plano || '9999') : (e.unidades[0] ? 'c' + e.unidades[0] : null)) },
  { k: 'fim', rot: 'Fim previsto', txt: e => e.estado === 'concluida' ? 'terminou ' + dTxt(e.fim_real) : (e.fim_previsto ? dTxt(e.fim_previsto) : (e.n_ordens ? 'sem data' : '')), val: e => e.fim_previsto || e.fim_real },
  { k: 'folga', rot: 'Folga', num: true, txt: e => e.folga_dias == null ? '' : String(e.folga_dias), val: e => e.folga_dias },
];
let ENC_ORD = { k: 'prazo', dir: 1 };
const ENC_COLF = {}; // filtro por coluna: k -> texto
function montarCabEnc() {
  const th = $('#encHead');
  if (!th.dataset.montado) {
    th.innerHTML = `<tr>${ENC_COLS.map(c => `<th data-k="${c.k}" class="${c.num ? 'num ' : ''}ord" title="Clicar para ordenar (outra vez inverte)">${esc(c.rot)}</th>`).join('')}<th class="mg-th" title="Plano das ordens ligadas (motores das apps), de 1 semana atrás a 7 semanas à frente · linha vermelha = prazo · linha azul = hoje">Plano <span class="nota">8 semanas</span><div class="mg-eixo" id="mgEixo"></div></th><th></th></tr>
      <tr class="filtros-col">${ENC_COLS.map(c => `<th class="${c.num ? 'num' : ''}"><input type="search" data-k="${c.k}" placeholder="${c.num ? '>0, <-5, =10…' : 'filtrar…'}" aria-label="Filtrar ${esc(c.rot)}"></th>`).join('')}<th></th><th><button type="button" class="btn btn-sec" id="encLimparCols" title="Limpar filtros das colunas">✕</button></th></tr>`;
    th.dataset.montado = '1';
    $$('#encHead th.ord').forEach(h => h.addEventListener('click', () => { const k = h.dataset.k; ENC_ORD = ENC_ORD.k === k ? { k, dir: -ENC_ORD.dir } : { k, dir: 1 }; renderEnc(); }));
    $$('#encHead .filtros-col input').forEach(i => i.addEventListener('input', () => { ENC_COLF[i.dataset.k] = i.value; ENC_TUDO = false; renderEnc(); }));
    $('#encLimparCols').addEventListener('click', () => { for (const k of Object.keys(ENC_COLF)) delete ENC_COLF[k]; $$('#encHead .filtros-col input').forEach(i => { i.value = ''; }); renderEnc(); });
  }
  $$('#encHead th.ord').forEach(h => { h.classList.toggle('sort-asc', ENC_ORD.k === h.dataset.k && ENC_ORD.dir === 1); h.classList.toggle('sort-desc', ENC_ORD.k === h.dataset.k && ENC_ORD.dir === -1); });
  const eixo = $('#mgEixo'); if (eixo) eixo.innerHTML = miniEixo();
}
// filtro de uma coluna: palavras (todas têm de aparecer, sem acentos) ou, em colunas numéricas, >n <n >=n <=n =n
function passaColuna(c, e, f) {
  const q = String(f || '').trim(); if (!q) return true;
  if (c.num) { const m = /^(>=|<=|>|<|=)\s*(-?\d+(?:[.,]\d+)?)$/.exec(q); if (m) { const v = c.val(e); if (v == null) return false; const n = parseFloat(m[2].replace(',', '.')); return m[1] === '>' ? v > n : m[1] === '<' ? v < n : m[1] === '>=' ? v >= n : m[1] === '<=' ? v <= n : v === n; } }
  const t = normTexto(c.txt(e)); return normTexto(q).split(' ').filter(Boolean).every(k => t.includes(k));
}
function encFiltradas() {
  if (!ENC || !ENC.carregado) return [];
  const toks = normTexto(ENC_FILTRO.pesq).split(' ').filter(Boolean);
  const colF = ENC_COLS.filter(c => (ENC_COLF[c.k] || '').trim());
  let l = ENC.encomendas.filter(e => {
    if (ENC_FILTRO.estado === 'em_risco') { if (!e.risco) return false; }
    else if (ENC_FILTRO.estado === 'sem_op') { if (!e.sem_op) return false; }
    else if (ENC_FILTRO.estado && e.estado !== ENC_FILTRO.estado) return false;
    if (ENC_FILTRO.risco && !e.risco) return false;
    if (ENC_FILTRO.semConc && e.estado === 'concluida') return false;
    if (ENC_FILTRO.unidade && !e.unidades.includes(ENC_FILTRO.unidade)) return false;
    for (const c of colF) if (!passaColuna(c, e, ENC_COLF[c.k])) return false;
    if (toks.length) { // pesquisa geral: todas as colunas + OBS do Excel + OPs/máquinas/estados das ordens ligadas
      const t = normTexto([...ENC_COLS.map(c => c.txt(e)), e.material, ...Object.values(e.obs || {}), ...e.ordens.map(o => [o.op, o.unidade, o.maquina, o.estado_origem, o.pedido].join(' ')), ...(e.ops_obs || [])].join(' | '));
      if (!toks.every(k => t.includes(k))) return false;
    }
    return true;
  });
  const col = ENC_COLS.find(c => c.k === ENC_ORD.k) || ENC_COLS[4];
  const cmp = (x, y) => (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), 'pt', { numeric: true });
  const prazo = ENC_COLS[4];
  return [...l].sort((a, b) => {
    const va = col.val(a), vb = col.val(b);
    if (va == null && vb == null) return cmp(prazo.val(a) ?? '9999', prazo.val(b) ?? '9999');
    if (va == null) return 1; if (vb == null) return -1; // vazios sempre no fim
    return cmp(va, vb) * ENC_ORD.dir || cmp(prazo.val(a) ?? '9999', prazo.val(b) ?? '9999') || a.pedido_item.localeCompare(b.pedido_item);
  });
}

function renderEnc() {
  if (!ENC) return;
  const sel = $('#encUnidade');
  if (sel.options.length <= 1 && DADOS) DADOS.unidades.forEach(u => sel.insertAdjacentHTML('beforeend', `<option value="${esc(u.unidade)}">${esc(u.unidade)}</option>`));
  if (!ENC.carregado) {
    $('#encInfo').textContent = 'Ainda não foi carregado nenhum Encomendas.xlsx — usa o botão "Carregar".';
    $('#encKpis').innerHTML = ''; $('#encBody').innerHTML = `<tr><td colspan="11" class="vazio-ok">Carrega o Encomendas.xlsx (pasta Industrial Planning - Encomendas) para começar.</td></tr>`; $('#encContagem').textContent = ''; $('#encMais').textContent = '';
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
  montarCabEnc();
  const lista = encFiltradas();
  const nColF = Object.values(ENC_COLF).filter(v => String(v || '').trim()).length;
  $('#encContagem').textContent = `${lista.length} de ${T.total}${nColF ? ` · ${nColF} filtro${nColF > 1 ? 's' : ''} de coluna` : ''}`;
  const tv = document.body.classList.contains('tv');
  const MAX = tv ? 25 : (ENC_TUDO ? 5000 : 150);
  const linha = e => {
    const aberto = ENC_ABERTOS.has(e.pedido_item);
    const unids = ORDEM_UNID_ENC.filter(u => e.unidades.includes(u)).map(u => chipUnidade(u, e.ordens)).join(' ');
    const ondeTxt = encOndeTxt(e);
    const fim = e.estado === 'concluida' ? `<span class="nota">terminou ${dPT(e.fim_real)}</span>` : (e.fim_previsto ? `<b>${diaSem(e.fim_previsto)} ${dPT(e.fim_previsto)}</b>${e.fim_previsto_hora ? ` <span class="origem">${esc(e.fim_previsto_hora)}</span>` : ''}` : (e.n_ordens ? '<span class="nota">sem data</span>' : '—'));
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
      <td class="mg-td">${miniGantt(e)}</td>
      <td class="lnk">${aberto ? '▾' : '▸'}</td></tr>`;
    if (aberto) {
      const ords = e.ordens.map(o => `<tr class="${o.em_curso ? 'proc' : (o.terminal ? 'feito' : '')}">
          <td>${esc(o.unidade)}</td><td><b>${esc(o.op || '—')}</b>${o.sem_op ? ' <span class="tag semop">sem OP</span>' : ''}</td><td>${esc(o.maquina || '—')}${o.fase ? `<div class="origem">${esc(o.fase)}</div>` : ''}</td>
          <td><span class="est ${o.estado}"><i></i>${esc(o.estado_origem || o.estado)}</span></td>
          <td>${o.data_plano ? `${dPT(o.data_plano)}${o.hora_plano_ini ? ' ' + o.hora_plano_ini : ''}${o.data_fim_plano && (o.data_fim_plano !== o.data_plano || o.hora_plano_fim) ? ` → ${dPT(o.data_fim_plano)}${o.hora_plano_fim ? ' ' + o.hora_plano_fim : ''}` : ''}` : (o.semana_plano ? 'S' + o.semana_plano.split('-W')[1] : '—')}</td>
          <td>${o.real_inicio || o.real_fim ? `${dhPT(o.real_inicio)} → ${dhPT(o.real_fim)}` : '—'}</td>
          <td class="num">${o.qtd ? nR(o.qtd) : '—'}</td>
          <td><span class="tag" title="${o.via.includes('obs') ? 'OP citada na OBS do Excel' : ''}${o.via === 'obs+pedido' ? ' e ' : ''}${o.via.includes('pedido') ? 'Pedido_Item no campo pedido/OP/obs da app' : ''}">${o.via === 'obs+pedido' ? 'pedido + OBS' : (o.via === 'obs' ? 'OBS Excel' : 'pedido')}</span></td>
          <td class="lnk">${o.unidade !== 'PURECORK' && !o.terminal ? `<a href="#" class="sim-lnk" data-id="${esc(o.id)}" title="Simular uma alteração a esta ordem">⚙</a> ` : ''}<a href="${esc((unidade(o.unidade) || {}).url || '#')}" target="_blank" rel="noopener" title="abrir a app de ${esc(o.unidade)}">↗</a></td></tr>`).join('');
      const obs = Object.entries(e.obs || {}).map(([k, v]) => `<div><span class="origem">${esc(k)}:</span> ${esc(v)}</div>`).join('');
      h += `<tr class="enc-det"><td colspan="11">
        ${e.ordens.some(o => (o.barras || []).length) ? ganttEncomenda(e) : ''}
        ${e.ordens.length ? `<table class="enc-ords"><thead><tr><th>Unidade</th><th>OP</th><th>Máq. / linha</th><th>Estado na app</th><th>Plano (início → fim)</th><th>Real (início → fim)</th><th class="num">Qtd (un.)</th><th>Ligação</th><th></th></tr></thead><tbody>${ords}</tbody></table>` : '<div class="nota">Nenhuma ordem encontrada nos planeamentos com este Pedido_Item nem com as OPs citadas nas OBS.</div>'}
        ${e.ops_obs_nao_encontradas && e.ops_obs_nao_encontradas.length ? `<div class="nota">OPs citadas nas OBS e não encontradas em nenhuma app: ${esc(e.ops_obs_nao_encontradas.join(', '))} (ex.: ordens de corte 950…, MIX 160…, ou já removidas da app)</div>` : ''}
        ${obs ? `<div class="enc-obs">${obs}</div>` : ''}
      </td></tr>`;
    }
    return h;
  };
  $('#encBody').innerHTML = lista.length ? lista.slice(0, MAX).map(linha).join('') : `<tr><td colspan="11" class="vazio-ok">Nenhuma encomenda com este filtro.</td></tr>`;
  $('#encMais').innerHTML = lista.length > MAX ? `+ ${lista.length - MAX} encomendas${tv ? '' : ' — <a href="#" id="encVerTudo">mostrar todas</a>'}` : '';
  const vt = $('#encVerTudo'); if (vt) vt.addEventListener('click', ev => { ev.preventDefault(); ENC_TUDO = true; renderEnc(); });
  $$('#encBody tr.enc-l').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('a')) return; const pi = tr.dataset.pi; if (ENC_ABERTOS.has(pi)) ENC_ABERTOS.delete(pi); else ENC_ABERTOS.add(pi); renderEnc(); }));
  $$('#encBody a.sim-lnk').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); simAbrirOrdem(a.dataset.id); }));
}
const ORDEM_UNID_ENC = ['WIM', 'PURECORK', 'DSL', 'DSL TALIS', 'DENSIDADES', 'VOCUS', 'DS100'];

function exportarCsvEnc() {
  const l = encFiltradas();
  const cab = ['Pedido_Item', 'Nº pedido', 'Cliente', 'Alias', 'Material', 'Descrição', 'Qt', 'Data desejada', 'Data prometida', 'Estado', 'Risco', 'Unidades', 'Em processo em', 'Próxima', 'Fim previsto', 'Hora fim previsto', 'Fim real', 'Folga (dias)', 'OPs ligadas', 'Folhas'];
  const linhas = l.map(e => [e.pedido_item.replace('-', '_'), e.n_pedido, e.cliente, e.alias, e.material, e.descricao, e.qt, e.data_desejada, e.data_prometida, e.estado_label, RISCO_TXT[e.risco] || '', e.unidades.join(' + '), e.em_processo.map(x => x.unidade + (x.maquina ? ' ' + x.maquina : '')).join(' + '), e.proxima ? `${e.proxima.unidade} ${e.proxima.data_plano || ''}` : '', e.fim_previsto, e.fim_previsto_hora || '', e.fim_real, e.folga_dias ?? '', e.ordens.map(o => `${o.unidade}:${o.op}`).join(' | '), (e.folhas || []).join(' + ')]
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

// ============================================================
// Gantt (barras dos motores das apps) — encomendas e simulador
// ============================================================
const COR_UNID = { 'WIM': 'u-wim', 'DSL': 'u-dsl', 'DSL TALIS': 'u-talis', 'DENSIDADES': 'u-dens', 'VOCUS': 'u-vocus', 'DS100': 'u-ds100', 'PURECORK': 'u-pure' };
const p2 = n => String(n).padStart(2, '0');
const pData = s => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; };
const fmtDH = d => d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '—';
const dhCurto = s => { const d = pData(s); return d ? `${DIAS_SEM[d.getDay()]} ${fmtDH(d)}` : '—'; };
function semanaNum(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dn + 3); const j4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - j4) / 864e5 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7); }
const hojeData = () => pData((DADOS && DADOS.hoje) || (ENC && ENC.hoje) || new Date().toISOString().slice(0, 10));
const pc = (d, de, span) => Math.max(0, Math.min(100, (d - de) / span * 100));
const delta = m => { if (m == null) return '—'; if (m === 0) return '0'; const s = m > 0 ? '+' : '−'; let a = Math.abs(m); const d = Math.floor(a / 1440); a -= d * 1440; const h = Math.floor(a / 60), mi = a % 60; return s + [d ? d + ' d' : '', h ? h + ' h' : '', !d && mi ? mi + ' min' : ''].filter(Boolean).join(' '); };
const titBarra = (b, extra) => [extra, [b.unidade, b.fase_label, b.maquina].filter(Boolean).join(' · '), b.so_dia ? `dia ${dPT(b.ini)}${b.ini.slice(0, 10) !== b.fim.slice(0, 10) ? ' → ' + dPT(b.fim) : ''} (sem hora na app)` : `${dhCurto(b.ini)} → ${dhCurto(b.fim)}`].filter(Boolean).join('\n');

/**
 * spec: { de: Date, ate: Date, cab: html, linhas: [{ rot: html, tit, cls, barras: [{ ini: Date, fim: Date, cls, txt, tit, segs: [[Date, Date]] }] }], marcas: [{ d: Date, cls, tit }] }
 */
function ganttHTML(spec) {
  const de = spec.de, ate = spec.ate, span = ate - de;
  const nDias = Math.round(span / 864e5);
  const passo = nDias <= 18 ? 1 : (nDias <= 36 ? 2 : 7);
  let eixo = '', fundo = '';
  for (let d = new Date(de.getFullYear(), de.getMonth(), de.getDate()), i = 0; d < ate && i < 400; d.setDate(d.getDate() + 1), i++) {
    const x = pc(d, de, span), w = Math.min(100 - x, 864e5 / span * 100);
    if (d.getDay() === 0 || d.getDay() === 6) fundo += `<i class="g-fds" style="left:${x}%;width:${w}%"></i>`;
    const marca = passo === 7 ? d.getDay() === 1 : (Math.round((d - de) / 864e5) % passo === 0);
    if (marca && x < 97) eixo += `<span class="g-tick" style="left:${x}%">${passo === 7 ? 'S' + semanaNum(d) + ' ' : DIAS_SEM[d.getDay()] + ' '}${p2(d.getDate())}/${p2(d.getMonth() + 1)}</span>`;
  }
  const marcas = (spec.marcas || []).filter(m => m.d && m.d >= de && m.d <= ate).map(m => `<i class="g-marca ${m.cls || ''}" style="left:${pc(m.d, de, span)}%" title="${esc(m.tit || '')}"></i>`).join('');
  const barra = b => {
    if (!b.ini || !b.fim || b.fim <= de || b.ini >= ate) return '';
    const x0 = pc(b.ini, de, span), x1 = pc(b.fim, de, span), w = Math.max(0.35, x1 - x0);
    const dur = Math.max(1, Math.min(b.fim, ate) - Math.max(b.ini, de));
    const segs = (b.segs && b.segs.length > 1) ? b.segs.map(([a, z]) => { if (!a || !z || z <= de || a >= ate) return ''; const l = (Math.max(a, de) - Math.max(b.ini, de)) / dur * 100, ww = (Math.min(z, ate) - Math.max(a, de)) / dur * 100; return `<i class="g-seg" style="left:${l}%;width:${Math.max(0.5, ww)}%"></i>`; }).join('') : '';
    return `<span class="g-b ${b.cls || ''}${segs ? ' dividida' : ''}${b.ini < de ? ' corta-i' : ''}${b.fim > ate ? ' corta-f' : ''}" style="left:${x0}%;width:${w}%" title="${esc(b.tit || '')}">${segs}<em>${esc(b.txt || '')}</em></span>`;
  };
  const linhas = spec.linhas.map(l => `<div class="g-lin ${l.cls || ''}"><div class="g-rot" title="${esc(l.tit || '')}">${l.rot}</div><div class="g-pista">${fundo}${marcas}${l.barras.map(barra).join('')}</div></div>`).join('');
  return `<div class="gantt"><div class="g-lin g-cab"><div class="g-rot">${spec.cab || ''}</div><div class="g-pista g-eixo">${fundo}${eixo}${marcas}</div></div>${linhas}</div>`;
}
const barraDe = (b, extra) => { const ini = pData(b.ini), fim = pData(b.fim); return { ini, fim, segs: (b.segs || []).map(([a, z]) => [pData(a), pData(z)]) }; };

// ---- mini-Gantt por encomenda (1 semana atrás → 7 semanas à frente, escala comum a todas as linhas) ----
function janelaMini() { const h = hojeData(); const de = new Date(h); de.setDate(de.getDate() - 7); const ate = new Date(h); ate.setDate(ate.getDate() + 49); return { de, ate, h }; }
function miniEixo() {
  const { de, ate, h } = janelaMini(); const span = ate - de; let t = '';
  for (let d = new Date(de); d < ate; d.setDate(d.getDate() + 1)) if (d.getDay() === 1) t += `<span style="left:${pc(d, de, span)}%">S${semanaNum(d)}</span>`;
  return t + `<i class="mg-hoje" style="left:${pc(h, de, span)}%"></i>`;
}
function miniGantt(e) {
  const { de, ate, h } = janelaMini(); const span = ate - de;
  const bs = []; for (const o of e.ordens || []) for (const b of (o.barras || [])) bs.push({ ...b, op: o.op, terminal: o.terminal, em_curso: o.em_curso, ini_d: pData(b.ini), fim_d: pData(b.fim) });
  const prazo = e.prazo ? pData(e.prazo) : null; if (prazo) prazo.setHours(23, 59);
  let mk = `<i class="mg-hoje" style="left:${pc(h, de, span)}%"></i>`;
  if (prazo) mk += prazo < de ? '<i class="mg-prazo fora-i" title="prazo antes da janela"></i>' : (prazo > ate ? '<i class="mg-prazo fora-f" title="prazo depois da janela"></i>' : `<i class="mg-prazo" style="left:${pc(prazo, de, span)}%" title="prazo ${dPT(e.prazo)}"></i>`);
  if (!bs.length) return `<div class="mg vazio">${mk}${e.n_ordens ? '<span class="mg-txt">sem plano nos motores</span>' : ''}</div>`;
  bs.sort((a, b) => a.ini_d - b.ini_d);
  const fins = []; const NL = 4;
  for (const b of bs) { let l = fins.findIndex(f => f <= b.ini_d); if (l < 0) l = fins.length < NL ? fins.length : fins.indexOf(Math.min(...fins)); fins[l] = b.fim_d; b.l = l; }
  const nl = Math.max(1, fins.length);
  const html = bs.map(b => {
    if (b.fim_d <= de || b.ini_d >= ate) return '';
    const x0 = pc(b.ini_d, de, span), x1 = pc(b.fim_d, de, span);
    return `<i class="mg-b ${COR_UNID[b.unidade] || ''}${b.terminal ? ' feito' : ''}${b.em_curso ? ' proc' : ''}${b.so_dia ? ' so-dia' : ''}" style="left:${x0}%;width:${Math.max(0.8, x1 - x0)}%;top:${2 + b.l * (16 / nl)}px;height:${Math.max(3, 16 / nl - 1)}px" title="${esc(titBarra(b, b.op))}"></i>`;
  }).join('');
  const antes = bs.some(b => b.ini_d < de) ? '<span class="mg-seta i" title="há plano antes da janela">‹</span>' : '';
  const depois = bs.some(b => b.fim_d > ate) ? '<span class="mg-seta f" title="há plano depois da janela">›</span>' : '';
  return `<div class="mg">${mk}${html}${antes}${depois}</div>`;
}
// ---- Gantt detalhado de uma encomenda (uma linha por ordem e fase) ----
function ganttEncomenda(e) {
  const hoje = hojeData();
  const prazo = e.prazo ? pData(e.prazo) : null; if (prazo) prazo.setHours(23, 59);
  const linhas = [];
  let mn = null, mx = null;
  for (const o of e.ordens) for (const b of (o.barras || [])) {
    const x = barraDe(b); if (!x.ini || !x.fim) continue;
    if (!mn || x.ini < mn) mn = x.ini; if (!mx || x.fim > mx) mx = x.fim;
    linhas.push({ rot: `<span class="uchip ${COR_UNID[o.unidade] || ''} cor">${esc(o.unidade)}</span> <b>${esc(o.op || '—')}</b> <span class="origem">${esc([b.fase_label, b.maquina].filter(Boolean).join(' · '))}</span>`, tit: `${o.unidade} · ${o.op || ''} · ${o.estado_origem || ''}`,
      cls: o.terminal ? 'feito' : '', barras: [{ ...x, cls: `${COR_UNID[o.unidade] || ''}${o.terminal ? ' feito' : ''}${o.em_curso ? ' proc' : ''}${b.so_dia ? ' so-dia' : ''}`, txt: b.so_dia ? 'dia' : `${fmtDH(x.ini).slice(6)}–${fmtDH(x.fim).slice(6)}`, tit: titBarra(b, o.op) }] });
  }
  if (!linhas.length) return '';
  let de = new Date(Math.min(mn, hoje)); de.setHours(0, 0, 0, 0); de.setDate(de.getDate() - 1);
  let ate = new Date(Math.max(mx, prazo || 0, hoje)); ate.setHours(0, 0, 0, 0); ate.setDate(ate.getDate() + 2);
  if ((ate - de) / 864e5 > 63) { de = new Date(Math.max(de, new Date(hoje.getTime() - 7 * 864e5))); de.setHours(0, 0, 0, 0); if ((ate - de) / 864e5 > 63) ate = new Date(de.getTime() + 63 * 864e5); }
  const marcas = [{ d: new Date(), cls: 'hoje', tit: 'agora' }]; if (prazo) marcas.push({ d: prazo, cls: 'prazo', tit: `prazo ${e.prazo_tipo || ''} ${dPT(e.prazo)}` });
  return `<div class="enc-gantt">${ganttHTML({ de, ate, cab: '<span class="nota">plano dos motores das apps</span>', linhas, marcas })}</div>`;
}

// ============================================================
// Separador "Simulador" — POST /api/sim (o servidor corre os motores sobre uma cópia; nada é gravado nas apps)
// ============================================================
const SIM = { sel: null, tipo: 'qtd', alts: [], res: null, maq: null, antes: null, aCorrer: false };
try { const g = JSON.parse(localStorage.getItem('dg_sim_alts') || '[]'); if (Array.isArray(g)) SIM.alts = g.slice(0, 30); } catch (e) { /* sem storage */ }
const guardarAlts = () => { try { localStorage.setItem('dg_sim_alts', JSON.stringify(SIM.alts)); } catch (e) { /* sem storage */ } };
const FONTE_UNID = { densidades: 'DENSIDADES', dsl: 'DSL', talis: 'DSL TALIS', wim: 'WIM', vocus: 'VOCUS', ds100: 'DS100' };

async function simIniciar() {
  if (!SIM.maq) { try { const r = await fetch('/api/sim/maquinas', { cache: 'no-store' }); SIM.maq = (await r.json()).fontes || []; } catch (e) { SIM.maq = []; } }
  renderSimForm(); renderSimAlts(); if (SIM.res) renderSimRes();
}
async function simProcurar(q, fonte) {
  const u = new URL('/api/sim/procurar', location.href); u.searchParams.set('q', q); if (fonte) u.searchParams.set('fonte', fonte);
  const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).resultados || [];
}
let simT = null;
function simOnPesq() {
  clearTimeout(simT); const q = $('#simQ').value.trim();
  if (q.length < 2) { $('#simRes').innerHTML = ''; return; }
  simT = setTimeout(async () => {
    try {
      const l = await simProcurar(q);
      $('#simRes').innerHTML = l.length ? l.map(o => `<div class="sim-item${o.terminal ? ' feito' : ''}" data-id="${esc(o.id)}"><span class="uchip ${COR_UNID[o.unidade] || ''} cor">${esc(o.unidade)}</span> <b>${esc(o.op || '—')}</b> <span class="origem">${esc([o.cliente, o.maquina].filter(Boolean).join(' · '))}</span><div class="origem">${o.barras.length ? esc(o.barras.map(b => `${b.fase_label ? b.fase_label + ' ' : ''}${b.so_dia ? dPT(b.ini) : dhCurto(b.ini)} → ${b.so_dia ? dPT(b.fim) : dhCurto(b.fim)}`).join(' · ')) : 'sem plano no motor (Kanban/Buffer ou sem semana)'} · ${esc(o.estado_origem)}</div></div>`).join('')
        : '<div class="nota">Nada encontrado nas 6 unidades simuláveis.</div>';
      $$('#simRes .sim-item').forEach(el => el.addEventListener('click', () => { const o = l.find(x => x.id === el.dataset.id); simEscolher(o); }));
    } catch (e) { $('#simRes').innerHTML = `<div class="nota">Falha: ${esc(e.message)}</div>`; }
  }, 250);
}
function simEscolher(o) {
  SIM.sel = o; SIM.antes = null; $('#simRes').innerHTML = ''; $('#simQ').value = '';
  if (SIM.tipo === 'capacidade') SIM.tipo = 'mover';
  renderSimForm();
}
async function simAbrirOrdem(id) {
  definirVista('sim');
  try { const u = new URL('/api/sim/procurar', location.href); u.searchParams.set('id', id); const r = await fetch(u, { cache: 'no-store' }); const l = (await r.json()).resultados || []; if (l[0]) simEscolher(l[0]); else toast('Ordem sem simulação disponível'); } catch (e) { toast('Falha: ' + e.message); }
}
function maqsDe(fonte, fase) { const f = (SIM.maq || []).find(x => x.fonte === fonte); return f ? f.maquinas.filter(m => !fase || !m.fase || m.fase === fase) : []; }
function renderSimForm() {
  $$('#simTipos button').forEach(b => b.classList.toggle('activo', b.dataset.tipo === SIM.tipo));
  const o = SIM.sel;
  $('#simSel').innerHTML = o ? `<div class="sim-escolhida"><span class="uchip ${COR_UNID[o.unidade] || ''} cor">${esc(o.unidade)}</span> <b>${esc(o.op || '—')}</b> <a href="#" id="simTirar" title="Tirar">✕</a>
      <div class="origem">${esc([o.cliente, o.produto].filter(Boolean).join(' · '))}</div>
      <div class="origem">${esc(o.maquina || 'sem máquina')} · ${esc(o.estado_origem)} · qtd ${o.qtd_nativa != null ? esc(String(o.qtd_nativa)) + ' ' + esc(o.un_qtd) : '—'}</div>
      ${o.barras.map(b => `<div class="origem">${esc(b.fase_label ? b.fase_label + ': ' : 'plano: ')}${b.so_dia ? 'dia ' + dPT(b.ini) : `${dhCurto(b.ini)} → ${dhCurto(b.fim)}`}</div>`).join('')}</div>` : '';
  const t = $('#simTirar'); if (t) t.addEventListener('click', ev => { ev.preventDefault(); SIM.sel = null; renderSimForm(); });
  const hoje = (DADOS && DADOS.hoje) || '';
  let h = '';
  const faseSel = o && o.fonte === 'wim' ? `<label>Fase <select id="sfFase">${o.fases.filter(f => f.fase !== 'M').map(f => `<option value="${f.fase}">${esc(f.label)}</option>`).join('')}</select></label>${o.fases.some(f => f.fase === 'M') ? '<div class="nota">Make-up: só dia (fim da Lavação + 1 dia útil) — muda ao alterar a Lavação.</div>' : ''}` : '';
  if (SIM.tipo === 'capacidade') {
    const fontes = SIM.maq || [];
    const fSel = (SIM.capFonte && fontes.find(f => f.fonte === SIM.capFonte)) ? SIM.capFonte : (o ? o.fonte : (fontes[0] || {}).fonte);
    h = `<label>Unidade <select id="sfCapFonte">${fontes.map(f => `<option value="${f.fonte}"${f.fonte === fSel ? ' selected' : ''}>${esc(f.unidade)}</option>`).join('')}</select></label>
      <label>Máquina / linha <select id="sfCapMaq">${maqsDe(fSel).map(m => `<option value="${esc(m.valor)}"${o && o.maq_motor === m.valor ? ' selected' : ''}>${esc(m.rotulo)}</option>`).join('')}</select></label>
      <div class="sim-radio"><label><input type="radio" name="sfModo" value="ritmo" checked> ritmo</label><label><input type="radio" name="sfModo" value="paragem"> paragem</label></div>
      <label class="sf-ritmo">Ritmo (% do actual) <input type="number" id="sfPct" min="1" max="400" step="5" value="80"></label>
      <div class="sf-paragem" hidden><label>de <input type="date" id="sfDe" value="${esc(hoje)}"></label><label>até <input type="date" id="sfAte" value="${esc(hoje)}"></label></div>
      <div class="nota">Ritmo: velocidade da máquina (100 % = actual). Paragem: dias inteiros fechados.</div>`;
  } else if (!o) {
    h = '<div class="nota">Escolhe primeiro uma ordem (passo 1).</div>';
  } else if (SIM.tipo === 'qtd') {
    h = `<label>Nova quantidade (${esc(o.un_qtd)}) <input type="number" id="sfQtd" min="0" step="any" value="${o.qtd_nativa != null ? esc(String(o.qtd_nativa)) : ''}"></label><div class="nota">Actual: ${o.qtd_nativa != null ? esc(String(o.qtd_nativa)) : '—'} ${esc(o.un_qtd)}. O tempo da ordem é recalculado pela regra da app.</div>`;
  } else if (SIM.tipo === 'mover') {
    h = `${faseSel}
      <div class="sim-radio"><label><input type="radio" name="sfMv" value="dia" checked> para um dia</label><label><input type="radio" name="sfMv" value="antes"> antes de outra ordem</label></div>
      <div class="sf-dia"><label>Dia <input type="date" id="sfData" value="${esc(hoje)}"></label>
        <label>Posição <select id="sfPos"><option value="inicio">início do dia (fura a fila)</option><option value="fim">fim do dia</option></select></label>
        ${maqsDe(o.fonte).length > 1 && o.fonte !== 'ds100' ? `<label>Máquina${o.fonte === 'wim' ? ' (só Wash)' : ''} <select id="sfMaq"><option value="">(a mesma)</option>${maqsDe(o.fonte).filter(m => o.fonte !== 'wim' || m.fase === 'W').map(m => `<option value="${esc(m.valor)}">${esc(m.rotulo)}</option>`).join('')}</select></label>` : ''}</div>
      <div class="sf-antes" hidden><input type="search" id="sfAntesQ" placeholder="OP da ordem de referência (${esc(o.unidade)})"><div id="sfAntesRes" class="sim-lista"></div><div id="sfAntesSel" class="nota"></div></div>
      ${o.fonte === 'vocus' || o.fonte === 'ds100' ? `<div class="nota">${esc(o.unidade)} planeia por semana: "dia" escolhe a semana.</div>` : ''}`;
  } else if (SIM.tipo === 'inicio') {
    h = `${faseSel}<label>Dia <input type="date" id="sfData" value="${esc(hoje)}"></label>${o.fonte === 'ds100' ? '<div class="nota">DS100 não tem hora: a ordem entra na semana do dia, na posição correspondente.</div>' : '<label>Hora <input type="time" id="sfHora" value="08:00"></label>'}
      <div class="nota">${o.fonte === 'talis' ? 'DSL Talis: a hora é um mínimo — se a fila anterior acabar mais tarde, arranca mais tarde.' : 'Início manual como na app (o resto da fila encadeia a partir daí).'}</div>`;
  }
  $('#simForm').innerHTML = h;
  // ligações do formulário
  const capF = $('#sfCapFonte'); if (capF) capF.addEventListener('change', () => { SIM.capFonte = capF.value; renderSimForm(); });
  $$('input[name=sfModo]').forEach(r => r.addEventListener('change', () => { const p = $('input[name=sfModo]:checked').value === 'paragem'; $('.sf-ritmo').hidden = p; $('.sf-paragem').hidden = !p; }));
  $$('input[name=sfMv]').forEach(r => r.addEventListener('change', () => { const a = $('input[name=sfMv]:checked').value === 'antes'; $('.sf-dia').hidden = a; $('.sf-antes').hidden = !a; }));
  const aq = $('#sfAntesQ'); if (aq) aq.addEventListener('input', () => { clearTimeout(simT); const q = aq.value.trim(); if (q.length < 2) { $('#sfAntesRes').innerHTML = ''; return; } simT = setTimeout(async () => { const l = (await simProcurar(q, o.fonte).catch(() => [])).filter(x => x.id !== o.id); $('#sfAntesRes').innerHTML = l.slice(0, 12).map(x => `<div class="sim-item" data-id="${esc(x.id)}"><b>${esc(x.op || '—')}</b> <span class="origem">${esc([x.maquina, x.barras[0] ? dhCurto(x.barras[0].ini) : ''].filter(Boolean).join(' · '))}</span></div>`).join('') || '<div class="nota">nada</div>'; $$('#sfAntesRes .sim-item').forEach(el => el.addEventListener('click', () => { const x = l.find(y => y.id === el.dataset.id); SIM.antes = x; $('#sfAntesSel').textContent = `antes de ${x.op || x.id} (${x.maquina || ''})`; $('#sfAntesRes').innerHTML = ''; aq.value = ''; })); }, 250); });
  $('#simAdd').disabled = SIM.tipo !== 'capacidade' && !o;
}
function simLerForm() {
  const o = SIM.sel; const fase = $('#sfFase') ? $('#sfFase').value : null;
  if (SIM.tipo === 'capacidade') {
    const fonte = $('#sfCapFonte').value, maquina = $('#sfCapMaq').value, modo = $('input[name=sfModo]:checked').value;
    const unid = FONTE_UNID[fonte];
    if (!maquina) throw new Error('escolhe a máquina');
    if (modo === 'ritmo') { const pct = +$('#sfPct').value; if (!(pct >= 1 && pct <= 400)) throw new Error('ritmo entre 1 e 400 %'); return { fonte, tipo: 'capacidade', modo, maquina, pct, rotulo: `${unid} · ${maquina}: ritmo ${pct} %` }; }
    const de = $('#sfDe').value, ate = $('#sfAte').value || de; if (!de) throw new Error('indica as datas da paragem'); if (ate < de) throw new Error('"até" antes de "de"');
    return { fonte, tipo: 'capacidade', modo, maquina, de, ate, rotulo: `${unid} · ${maquina}: paragem ${dPT(de)}${ate !== de ? '–' + dPT(ate) : ''}` };
  }
  if (!o) throw new Error('escolhe uma ordem');
  const base = { fonte: o.fonte, ordem: o.id, fase, op: o.op };
  const quem = `${o.unidade} ${o.op || o.id}${fase ? ' (' + (fase === 'W' ? 'Wash' : 'Innocork') + ')' : ''}`;
  if (SIM.tipo === 'qtd') { const v = $('#sfQtd').value; if (v === '' || !(+v >= 0)) throw new Error('quantidade inválida'); return { ...base, tipo: 'qtd', valor: +v, rotulo: `${quem}: quantidade ${o.qtd_nativa ?? '—'} → ${v} ${o.un_qtd}` }; }
  if (SIM.tipo === 'mover') {
    if ($('input[name=sfMv]:checked').value === 'antes') { if (!SIM.antes) throw new Error('escolhe a ordem de referência'); return { ...base, tipo: 'mover', antes_de: SIM.antes.id, rotulo: `${quem}: mover para antes de ${SIM.antes.op || SIM.antes.id}` }; }
    const data = $('#sfData').value; if (!data) throw new Error('indica o dia'); const posicao = $('#sfPos').value; const maquina = ($('#sfMaq') && fase !== 'I') ? $('#sfMaq').value : '';
    return { ...base, tipo: 'mover', data, posicao, maquina: maquina || undefined, rotulo: `${quem}: mover para ${diaSem(data)} ${dPT(data)} (${posicao === 'fim' ? 'fim' : 'início'} do dia${maquina ? ', ' + maquina : ''})` };
  }
  const data = $('#sfData').value; const hora = $('#sfHora') ? $('#sfHora').value : ''; if (!data) throw new Error('indica o dia'); if ($('#sfHora') && !hora) throw new Error('indica a hora');
  return { ...base, tipo: 'inicio', data, hora: hora || undefined, rotulo: `${quem}: forçar início ${diaSem(data)} ${dPT(data)}${hora ? ' ' + hora : ''}` };
}
function renderSimAlts() {
  $('#simN').textContent = SIM.alts.length ? `${SIM.alts.length} alteraç${SIM.alts.length === 1 ? 'ão' : 'ões'}` : '';
  $('#simAlts').innerHTML = SIM.alts.length ? SIM.alts.map((a, i) => { const r = SIM.res && SIM.res.alteracoes && SIM.res.alteracoes[i]; return `<li class="${r ? (r.ok ? 'ok' : 'erro') : ''}">${esc(a.rotulo || a.tipo)} <a href="#" data-i="${i}" title="Tirar">✕</a>${r && r.erro ? `<div class="atr-prazo">${esc(r.erro)}</div>` : ''}${r && r.avisos && r.avisos.length ? `<div class="nota">${esc(r.avisos.join(' · '))}</div>` : ''}</li>`; }).join('') : '<li class="nota">vazio — junta alterações no passo 2</li>';
  $$('#simAlts a').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); SIM.alts.splice(+a.dataset.i, 1); guardarAlts(); SIM.res = null; renderSimAlts(); }));
  $('#simCorrer').disabled = !SIM.alts.length || SIM.aCorrer;
}
async function simCorrer() {
  if (!SIM.alts.length) return;
  SIM.aCorrer = true; renderSimAlts(); $('#simSaida').classList.add('a-actualizar');
  try {
    const r = await fetch('/api/sim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alteracoes: SIM.alts }) });
    const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status);
    SIM.res = j; renderSimRes();
  } catch (e) { toast('Falha na simulação: ' + e.message); }
  finally { SIM.aCorrer = false; $('#simSaida').classList.remove('a-actualizar'); renderSimAlts(); }
}
const dS = (v, soDia) => !v ? '—' : (soDia ? `${diaSem(v)} ${dPT(v)}` : dhCurto(v));
const RISCO_SIM = { prazo_passado: 'prazo passado', fim_depois_do_prazo: 'fim depois do prazo', sem_plano: 'sem plano' };
function renderSimRes() {
  const R = SIM.res; if (!R) return;
  const T = R.resumo;
  const tile = (cls, rot, val, det, alerta) => `<div class="kpi ${cls}"><div class="rot">${rot}</div><div class="val${alerta ? ' alerta' : ''}">${val}</div><div class="det">${det}</div></div>`;
  let h = `<div class="kpis sim-kpis">${[
    tile('k-op', 'Ordens que mudam', T.ordens_activas_afectadas, `${T.ordens_afectadas} no total (inclui terminadas re-encadeadas)`, false),
    tile('k-semana', 'Encomendas afectadas', T.encomendas_carregadas ? T.afectadas : '—', T.encomendas_carregadas ? `${T.pioram} acabam mais tarde · ${T.melhoram} mais cedo` : 'Encomendas.xlsx não carregado', false),
    tile('k-hoje', 'Passam a estar em risco', T.encomendas_carregadas ? T.novas_em_risco : '—', 'fim previsto passa para depois do prazo', T.novas_em_risco > 0),
    tile('k-ativas', 'Saem de risco', T.encomendas_carregadas ? T.saem_de_risco : '—', 'fim previsto volta a caber no prazo', false),
  ].join('')}</div><div class="nota">calculado ${new Date(R.gerado).toLocaleTimeString('pt-PT')} em ${R.ms} ms · dados das apps de ${esc((DADOS && DADOS.ultima_agregacao) ? new Date(DADOS.ultima_agregacao).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '—')} · nada foi gravado nas apps</div>`;
  if (R.gantt) {
    const G = R.gantt, de = pData(G.de), ate = pData(G.ate);
    const linhas = [];
    for (const l of G.lanes) {
      const mk = (lista, depois) => lista.filter(b => b.lane === l.id).map(b => { const x = barraDe(b); return { ...x, cls: depois ? `${COR_UNID[l.unidade] || ''}${b.mudou ? ' mudou' : ''}${b.terminal ? ' feito' : ''}${b.so_dia ? ' so-dia' : ''}` : 'antes', txt: b.op, tit: titBarra(b, `${b.op}${b.mudou ? ' — muda' : ''}`) }; });
      linhas.push({ rot: `<span class="uchip ${COR_UNID[l.unidade] || ''} cor">${esc(l.unidade)}</span> <b>${esc(l.maquina)}</b> <span class="origem">antes</span>`, cls: 'g-antes', barras: mk(G.antes, false) });
      linhas.push({ rot: `<span class="g-rot-dep">depois</span>`, cls: 'g-depois', barras: mk(G.depois, true) });
    }
    h += `<h3 class="sim-h">Gantt antes / depois <span class="nota">máquinas afectadas · ${dPT(G.de.slice(0, 10))} a ${dPT(G.ate.slice(0, 10))}${G.truncado ? ' · truncado' : ''} · contorno = ordem que muda</span></h3>`
      + ganttHTML({ de, ate, linhas, marcas: [{ d: new Date(), cls: 'hoje', tit: 'agora' }] });
  }
  if (R.encomendas.length) {
    h += `<h3 class="sim-h">Encomendas com fim previsto alterado <span class="nota">${R.encomendas.length}</span></h3><div class="tabela-wrap"><table class="sim-tab"><thead><tr><th>Pedido_Item</th><th>Cliente</th><th>Prazo</th><th>Fim antes</th><th>Fim depois</th><th class="num">Δ</th><th class="num">Folga antes → depois</th><th>Risco</th></tr></thead><tbody>${R.encomendas.map(e => {
      const nova = !e.risco_antes && e.risco_depois, sai = e.risco_antes && !e.risco_depois;
      return `<tr class="${nova ? 'risco' : (sai ? 'melhora' : '')}"><td><b>${esc(e.pedido_item.replace('-', '_'))}</b></td><td>${esc(e.cliente || '')}</td><td>${e.prazo ? `${diaSem(e.prazo)} ${dPT(e.prazo)}` : '—'}</td><td>${e.fim_antes_so_dia ? diaSem(e.fim_antes) + ' ' + dPT(e.fim_antes) : dhCurto(e.fim_antes)}</td><td><b>${e.fim_depois_so_dia ? diaSem(e.fim_depois) + ' ' + dPT(e.fim_depois) : dhCurto(e.fim_depois)}</b></td><td class="num ${e.delta_h > 0 ? 'atr-prazo' : 'bom'}">${e.delta_h == null ? '—' : (e.delta_h > 0 ? '+' : '') + String(e.delta_h).replace('.', ',') + ' h'}</td><td class="num">${e.folga_antes ?? '—'} → <b>${e.folga_depois ?? '—'}</b> d</td><td>${nova ? `<b class="atr-prazo">passa a: ${esc(RISCO_SIM[e.risco_depois] || e.risco_depois)}</b>` : (sai ? '<span class="bom">sai de risco</span>' : esc(RISCO_SIM[e.risco_depois] || ''))}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  } else if (T.encomendas_carregadas) h += '<div class="nota sim-h">Nenhuma encomenda (Pedido_Item) muda de fim previsto.</div>';
  if (R.ordens.length) {
    h += `<h3 class="sim-h">Ordens que mudam <span class="nota">${R.ordens.length}${R.ordens.length >= 500 ? ' (primeiras 500)' : ''} · ordenadas pelo maior desvio no fim</span></h3><div class="tabela-wrap"><table class="sim-tab"><thead><tr><th>Unidade</th><th>OP</th><th>Máquina</th><th>Início antes → depois</th><th>Fim antes → depois</th><th class="num">Δ fim</th><th>Estado</th></tr></thead><tbody>${R.ordens.map(o => `<tr class="${o.alterada ? 'alterada' : ''}${o.terminal ? ' feito' : ''}"><td><span class="uchip ${COR_UNID[o.unidade] || ''} cor">${esc(o.unidade)}</span>${o.fase_label ? ` <span class="origem">${esc(o.fase_label)}</span>` : ''}</td><td><b>${esc(o.op || '—')}</b>${o.alterada ? ' <span class="tag">alterada</span>' : ''}<div class="origem">${esc(o.cliente || '')}</div></td><td>${esc(o.maquina_antes || '—')}${o.maquina_depois && o.maquina_depois !== o.maquina_antes ? ' → <b>' + esc(o.maquina_depois) + '</b>' : ''}</td><td>${dS(o.ini_antes, o.so_dia)} → <b>${dS(o.ini_depois, o.so_dia)}</b></td><td>${dS(o.fim_antes, o.so_dia)} → <b>${dS(o.fim_depois, o.so_dia)}</b></td><td class="num ${o.delta_fim_min > 0 ? 'atr-prazo' : (o.delta_fim_min < 0 ? 'bom' : '')}">${delta(o.delta_fim_min)}</td><td>${esc(o.estado_origem || '')}</td></tr>`).join('')}</tbody></table></div>`;
  } else h += '<div class="nota sim-h">Nenhuma ordem muda de datas com este cenário.</div>';
  $('#simSaida').innerHTML = h;
  renderSimAlts();
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
$('#encRisco').addEventListener('change', e => { ENC_FILTRO.risco = e.target.checked; renderEnc(); });
$('#encEsconderConc').addEventListener('change', e => { ENC_FILTRO.semConc = e.target.checked; renderEnc(); });
$('#simQ').addEventListener('input', simOnPesq);
$$('#simTipos button').forEach(b => b.addEventListener('click', () => { SIM.tipo = b.dataset.tipo; renderSimForm(); }));
$('#simAdd').addEventListener('click', () => { try { const a = simLerForm(); SIM.alts.push(a); guardarAlts(); SIM.res = null; renderSimAlts(); toast('Junto ao cenário: ' + a.rotulo); } catch (e) { toast(e.message); } });
$('#simCorrer').addEventListener('click', simCorrer);
$('#simLimpar').addEventListener('click', () => { SIM.alts = []; SIM.res = null; guardarAlts(); renderSimAlts(); $('#simSaida').innerHTML = '<div class="sim-vazio">Cenário limpo.</div>'; });
if (new URLSearchParams(location.search).get('tv') === '1') document.body.classList.add('tv');
definirVista(VISTA);
carregar(false);
