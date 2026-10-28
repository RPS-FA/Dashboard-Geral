# Dashboard Geral — CSP1 · urgências de planeamento

Dashboard de leitura que agrega as 6 apps de planeamento do CSP1 (7 unidades) e mostra **só o que precisa de acção da equipa de planeamento**:

1. **OP por abrir** — ordens activas cujo campo OP ainda não tem o número de OP (8 dígitos), em cartões ordenados pelo dia planeado, com filtros rápidos Hoje / até D+1 / até D+2 / até D+3 / personalizado / todas e opção de ignorar antigas (hoje pisca a vermelho, D+1 e D+2 a amarelo).
2. **Pesquisa global** — qualquer item em todos os planeamentos (activos e fechados), com detalhe da ordem.

O painel de excepções "Atenção" (v3–v7) foi retirado do ecrã a pedido (28/10); a API `/api/resumo` continua a devolver `alertas` (regras em `src/indicadores.js alertas()`), sem UI.

Só faz `GET` às apps de origem. Não tem base de dados e não altera nada. (As versões v1–v3 tinham painel de máquinas, cartões por unidade e tabela completa — removidos na v5 a pedido; a API `/api/resumo` continua a devolver `unidades[].maquinas` e `ordens`, por isso recuperam-se só com código de cliente.)

## OP por abrir (regra)

| | |
|---|---|
| Ordem considerada | activa: não terminal (`terminada`, `espera_job`, `fechada`), não manutenção, não "fase futura" (WIM) |
| Número de OP | 8 dígitos seguidos, isolados (não colados a letras/dígitos) e sem começar por 0 — `src/util.js numOP()`. As OPs do CSP1 começam por 11…18 (PureCork 111/114, WIM 120, DSL 130–135, Densidades 134, DSL Talis 144, DS100 150/151, VOCUS 180/185) |
| Conta como OP | `12063090`, `12063090- LT02356473`, `14400249 -2`, `OP12063090`, `12063068 - REDES` |
| Não conta | `AG OP - 150XXX`, `1800XXXX`, `144xxxx -1`, `AG OP (1) - 1500XXXX - PAV 1200`, lote `LT02328411`, pedido `4400042021-20`, vazio |
| Dias até ao plano | dia planeado − hoje; VOCUS usa o dia de início programado pelo PlannerCork; DS100 (semana) usa a **segunda-feira** dessa semana; sem data → fim da lista |
| Nível (KPI) | **crítico** = plano já passou ou é hoje · **sério** = próximos 7 dias · **aviso** = depois |
| Filtro de datas | D = hoje. **Hoje** = dias até ao plano = 0 · **até D+1** = 0..1 · **até D+2** = 0..2 · **até D+3** = 0..3 (defeito) · **Personalizado** = intervalo de dias planeados · **Todas**. **As ordens com plano anterior a hoje nunca entram nos filtros D** — só em Todas/Personalizado ou pelo indicador "Antigas" (`?dias=antigas`). **Ignorar antigas** tira-as também de Todas e das contagens (guardado no browser). URL: `?dias=0|1|2|3|todas|antigas`, `?de=AAAA-MM-DD&ate=AAAA-MM-DD`, `?antigas=ignorar` |
| Cartões | um por ordem, ordenados pelo dia planeado; **hoje pisca a vermelho**, **D+1 e D+2 piscam a amarelo**, ≥ D+3 azul, atrasadas vermelho fixo esbatido (só em Todas/Antigas), sem data cinzento (`prefers-reduced-motion` desliga o piscar). Clique abre o detalhe |
| Onde | KPIs (OP por abrir · Hoje · D+1 e D+2 · Antigas — clicar aplica o filtro), chips por unidade, cartões (60 + "mostrar todas"), CSV com o filtro activo, modo TV (25 mais próximas, cabe em 1080p) |

PureCork: o campo `op` da app fica vazio quando não há OP (o lote fica em `ref`); até à v4 o dashboard preenchia `op` com o lote, o que escondia OPs em falta.

## Fontes

| Unidade | App | Endpoint lido | Plano | Data limite | Horas reais | Paragens |
|---|---|---|---|---|---|---|
| WIM | planeamento-wim | `/api/state` | dia (semana ISO + dia, por fase W/I/M) | — | sim (`*_real`, `*_hIniR/hFimR`) | `*_atraso` |
| VOCUS | plannercork | `/api/store/planeamento_vocus_v6` + `/api/store/planeamento_vocus_settings_v1` (`/api/ops?tipo=vocus` está desactualizado desde Jul/2026) | **dia + hora de início/fim programados** — porte do algoritmo do PlannerCork (`src/adaptadores/vocus_plano.js`: fila por máquina `weekKey`+`sortIdx`, cadeia contínua, `qc`+reprocesso / (rate × OEE), paragens, turnos reduzidos, setup, início manual); validado 329/329 contra a app a 28/10/2026 | `dlim` (+ `dlog`) | `realStart/realEnd` | — |
| DS100 | plannercork | `/api/store/planeamento_ds100_v3` | **semana** (`weekKey`) | `dlim` (+ `dlog`) | — | — |
| PURECORK | purecork | `/api/data` | dia (`dayKey`) | — | — | — |
| DENSIDADES | planeamento-densidades | `/api/state` | dia (`dataPlano`, `_calcInicioP/_calcFimP`) | — | sim | `tempoAtraso` |
| DSL | planeamento-dsl | `/api/state` | dia (`diaPlano`) | — | sim | `tempoAtraso`, `temposPerdidosAvaria` |
| DSL TALIS | planeamento-dsl-talis | `/api/estado?mes=AAAA-MM` (mês actual + anterior) | dia (`dia_fixo`) | `data_limite` | sim | `atraso_min` |

## Ciclo de estados normalizado

`pre` (KANBAN / Buffer) → `aberto` → `liberada` → `entregue_log` ("Na linha") → `em_processo` → `terminada` (na linha) → `espera_job` → `fechada` ("Concluída Planeamento").
Terminais (sem trabalho de produção pendente): `terminada`, `espera_job`, `fechada`. O mapeamento está em `src/estados.js`.

Confirmado nos dados de produção (26/10/2026):
- **"Entregue Logística" / "Entrega LOG" é pré-produção** — material entregue pela logística à linha. Todas as ordens nesse estado estão sem início real e planeadas para hoje/próximos dias (DSL Talis, Densidades, VOCUS, WIM).
- **"Espera JOB" é pós-produção** — terminada na linha, à espera do JOB SAP para fechar (no DSL, 41 das 63 ordens nesse estado têm início e fim reais). A lista de referência da app DSL Talis confirma a ordem: aberto, liberada, entregue_logistica, em_processo, terminado_linha, espera_job, concluido_planeamento.

**PureCork não regista execução.** Só existem `LOTE FINAL` (→ fechada) e `CONTADO`; o resto é "planeado". Não há "em processo" nesta unidade (está assinalado no ecrã).

## Excepções (só API, sem ecrã desde 28/10)

`/api/resumo.alertas` agrupa por tipo e ordena por gravidade:

| Tipo | Regra | Limiar (variável de ambiente) |
|---|---|---|
| App sem ligação | última leitura da fonte falhou | — |
| Em processo além do fim planeado | em processo e o fim calculado pela app (Densidades, DSL Talis; só dia nas outras) já passou | — |
| Terminada mas não fechada | fim real registado e estado ainda "Em Processo" | `ALERTA_FIM_REGISTADO_H` (12 h) |
| Em processo há demasiado tempo | sem fim registado | `ALERTA_PROCESSO_H` (24 h) · `ALERTA_PROCESSO_H_FILA` (96 h, VOCUS) |
| Data limite do cliente ultrapassada | = KPI "atraso prazo" | — |
| Pronta mas sem máquina | liberada / na linha com dia planeado ≤ hoje, ou em processo, sem máquina | — |
| Plano antigo por fechar | activa com dia planeado há mais de N dias | `ALERTA_PLANO_DIAS` (14) |
| Espera JOB há demasiado tempo | terminada à espera de JOB SAP | `ALERTA_JOB_DIAS` (7) |

## Pesquisa global

A caixa no cabeçalho procura **em todos os planeamentos ao mesmo tempo** — todas as unidades, ordens activas e fechadas — por OP, lote, pedido/encomenda, cliente, produto, calibre, máquina, fase, estado de origem e observações. Várias palavras = todas têm de aparecer (`csu 45x240`); acentos e maiúsculas são ignorados. Os resultados agrupam-se por unidade (máx. 12 por unidade); clicar numa ordem abre o detalhe (todos os campos, estado, plano, real, ligação à app). `Esc` fecha.

Alcance = o que cada app guarda: WIM, VOCUS, DS100, PureCork, Densidades e DSL devolvem o histórico completo que têm; **DSL Talis só o mês actual e o anterior** (`/api/estado?mes=`). Ordens apagadas nas apps não aparecem. API: `GET /api/procurar?q=…` (máx. 200 resultados).

## Ecrã por unidade

`?tv=1&unidade=DSL` (ou o selector "Unidade" no cabeçalho) mostra só essa unidade: KPIs, OPs por abrir e excepções da unidade, em letra maior — um ecrã por secção. Unidades: `WIM`, `VOCUS`, `DS100`, `PURECORK`, `DENSIDADES`, `DSL`, `DSL TALIS`.

## Regras dos indicadores (`src/indicadores.js`)

| Indicador | Regra |
|---|---|
| Em processo | estado normalizado `em_processo` |
| Atraso prazo cliente | `data_limite < hoje` e ordem não terminal (só VOCUS, DS100 e DSL Talis têm data limite) |
| Atraso plano | fim planeado (ou dia planeado) `< hoje` e ordem não terminal. DS100 planeia à semana: conta a partir da segunda-feira seguinte. VOCUS é uma fila por máquina sem data: não se aplica (só a data limite) |
| Hoje | dia planeado = hoje, ou janela planeada início..fim que inclui hoje (só fontes com plano ao dia) |
| Esta semana | semana planeada = semana ISO actual |
| Terminadas hoje | fim real = hoje |
| Fechadas 7 d | terminal com fim real nos últimos 7 dias |
| Espera JOB | terminadas à espera do JOB SAP (backlog administrativo, mostrado por unidade) |
| Paragens 7 d | minutos registados pela produção em ordens com actividade real nos últimos 7 dias |
| Manutenção (WIM: ciclos de limpeza) | aparece em "em curso", nunca conta nos indicadores |

Quantidades em **unidades** (DSL e PureCork guardam milheiros → ×1000). Fuso horário: Europe/Lisbon — `server.js` força `process.env.TZ` porque o plano VOCUS usa `Date` local (como a app).

## Tema

Fundo preto por defeito (TV / sala de planeamento). Botão "Tema" no cabeçalho alterna para claro e guarda a escolha no browser (`localStorage dg_tema`); `?tema=claro` força o claro numa URL.

## Correr

```bash
npm install
npm start                      # http://localhost:3000
FIXTURES_DIR=fixtures npm start  # sem acesso às apps: dados de TESTE em fixtures/
npm test                       # testes unitários (estados, datas, indicadores)
```

Variáveis de ambiente (opcionais): `PORT`, `REFRESH_SEC` (defeito 60), `TIMEOUT_MS` (defeito 12000), `URL_WIM`, `URL_PLANNERCORK`, `URL_PURECORK`, `URL_DENSIDADES`, `URL_DSL`, `URL_DSL_TALIS`.

## Endpoints

- `GET /` — dashboard. `?tv=1` abre em modo ecrã (KPIs + OPs por abrir mais próximas + excepções; cabe num 1080p).
- `GET /api/resumo` — indicadores por unidade (inclui `sem_op`, `sem_op_passado`, `sem_op_7d`), `ops_por_abrir` (ordenada), excepções (`alertas`), painel de máquinas (`unidades[].maquinas`, sem UI) e lista de ordens enriquecidas (`op_num`, `sem_op`, `sem_op_nivel`, `dias_plano`). `?so=kpi` omite a lista.
- `GET /api/procurar?q=…` — pesquisa global (todas as unidades, activas e fechadas; todas as palavras têm de aparecer).
- `POST /api/refresh` — força nova leitura das fontes.
- `GET /health` — `{status, fontes_ok, fontes_total, ultima_agregacao}`.

## Resiliência

Cada fonte é lida em paralelo com timeout. Se uma falhar, o dashboard mantém a **última leitura boa** dessa fonte e marca-a a vermelho no cabeçalho (com o erro e a hora da última leitura boa). As outras continuam normais.

## Estrutura

```
server.js                 Express: API + estáticos
src/fontes.js             URLs das apps (substituíveis por env)
src/agregador.js          ciclo de leitura, cache por fonte, resumo
src/indicadores.js        regras dos KPIs (puro, testável)
src/estados.js            normalização de estados
src/util.js               datas (Lisboa, semana ISO), minutos, números
src/adaptadores/*.js      um por app: converte o JSON de origem no modelo comum
public/                   index.html, app.js, styles.css (JS puro, sem dependências)
fixtures/                 dados de TESTE (regenerar com tools/gerar-fixtures.js)
tools/harness.js          gera um script para validar um adaptador na consola do browser da própria app
test/normalizar.test.js   testes
```

## Validar um adaptador contra dados reais (sem deploy)

As apps bloqueiam CORS, por isso a validação faz-se na consola do browser **da própria app**:

```bash
node tools/harness.js dsl > h.js   # colar o conteúdo na consola de planeamento-dsl-production.up.railway.app
```
e depois, na consola: `await __DOPS.adaptador.carregar({id:'dsl',unidade:'DSL',url:location.origin}, u=>fetch(u).then(r=>r.json()))`.

## Modelo comum de ordem (saída dos adaptadores)

`fonte, unidade, id, op, ref, pedido, cliente, produto, calibre, qtd, maquina, fase, estado, estado_origem, estado_derivado, data_plano, data_fim_plano, semana_plano, plano_granularidade, data_limite, data_log, real_inicio, real_fim, atraso_prod_min, motivo_paragem, urgente, manutencao, obs, atualizado, link`

---
**Cork Supply / Harv 81 Group** · CSP1
