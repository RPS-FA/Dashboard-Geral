# Dashboard Geral — CSP1 · operações

Dashboard de leitura que agrega as 6 apps de planeamento do CSP1 (7 unidades) e mostra, num só ecrã:
**o que cada máquina está a processar agora** (painel de máquinas, como os separadores "Monitor" do WIM e do VOCUS),
**o estado das ordens** (ciclo normalizado) e **os atrasos** (prazo cliente vs. plano).

Só faz `GET` às apps de origem. Não tem base de dados e não altera nada.

| Unidade | App | Endpoint lido | Plano | Data limite | Horas reais | Paragens |
|---|---|---|---|---|---|---|
| WIM | planeamento-wim | `/api/state` | dia (semana ISO + dia, por fase W/I/M) | — | sim (`*_real`, `*_hIniR/hFimR`) | `*_atraso` |
| VOCUS | plannercork | `/api/store/planeamento_vocus_v6` (blob que a app renderiza; `/api/ops?tipo=vocus` está desactualizado desde Jul/2026) | **fila** por máquina (`weekKey` + `sortIdx`, sem data) | `dlim` (+ `dlog`) | `realStart/realEnd` | — |
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

## Painel de máquinas

Para cada máquina/linha (lista vinda das settings de cada app + máquinas vistas nas ordens): o que está **em processo** (OP, cliente, produto, quantidade, início real, tempo decorrido, paragens), o que vem **a seguir** (fila: atrasadas recentes → hoje → futuro, pela ordem da app), carga de hoje, terminadas hoje e nº de ordens em atraso. Máquinas:

| Unidade | Máquinas | Origem |
|---|---|---|
| WIM | Maq 1, Maq 2, Maq 3 (Wash) · INNOCORK · Make-up (a app não atribui máquina ao make-up) | `settings.sections` |
| VOCUS | Vocus 1, Vocus 2, Vocus 3 | fixo + dados |
| DS100 | DS100 · CSP2 (análise feita no CSP2) | fixo + dados |
| PURECORK | PURECORK 2, PURECORK 3 | `settings.maquinas` (activas) |
| DENSIDADES | Maq 1 - Linha 9, Maq 3 - Linha 10 | `settings.turnosPorMaquina` |
| DSL | Linha 1…8, EM | `settings.calibresPorLinha` |
| DSL TALIS | EE1, EE2, EM | `config.capacidade` |

No WIM, uma ordem com a lavação em curso e o Innocork já planeado para hoje aparece na fila do INNOCORK como "fase futura" (só no painel; não conta nos KPIs).

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

Quantidades em **unidades** (DSL e PureCork guardam milheiros → ×1000). Fuso horário: Europe/Lisbon (o servidor Railway corre em UTC).

## Correr

```bash
npm install
npm start                      # http://localhost:3000
FIXTURES_DIR=fixtures npm start  # sem acesso às apps: dados de TESTE em fixtures/
npm test                       # testes unitários (estados, datas, indicadores)
```

Variáveis de ambiente (opcionais): `PORT`, `REFRESH_SEC` (defeito 60), `TIMEOUT_MS` (defeito 12000), `URL_WIM`, `URL_PLANNERCORK`, `URL_PURECORK`, `URL_DENSIDADES`, `URL_DSL`, `URL_DSL_TALIS`.

## Endpoints

- `GET /` — dashboard. `?tv=1` abre em modo ecrã (indicadores + grelha de máquinas; cabe num 1080p).
- `GET /api/resumo` — indicadores por unidade + lista de ordens enriquecidas. `?so=kpi` omite a lista.
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
