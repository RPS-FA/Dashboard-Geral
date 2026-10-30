# Dashboard Geral — CSP1 · urgências de planeamento

Dashboard de leitura que agrega as 6 apps de planeamento do CSP1 (7 unidades) e mostra **só o que precisa de acção da equipa de planeamento**:

1. **OP por abrir** — ordens activas cujo campo OP ainda não tem o número de OP (8 dígitos), em cartões ordenados pelo dia planeado, com filtros rápidos Hoje / até D+1 / até D+2 / até D+3 / personalizado / todas e opção de ignorar antigas (hoje vermelho, D+1 e D+2 amarelo).
2. **Pesquisa global** — qualquer item em todos os planeamentos (activos e fechados), com detalhe da ordem.
3. **Encomendas** — rastreio por Pedido_Item (Encomendas.xlsx), com **mini-Gantt** por linha e Gantt detalhado por encomenda.
4. **Simulador** — cenários (quantidade, mover/antecipar, forçar início, capacidade) recalculados com os **motores das próprias apps** e impacto nas encomendas. Nada é gravado nas apps.

O painel de excepções "Atenção" (v3–v7) foi retirado do ecrã a pedido (28/10); a API `/api/resumo` continua a devolver `alertas` (regras em `src/indicadores.js alertas()`), sem UI.

Só faz `GET` às apps de origem. Não tem base de dados e não altera nada. (As versões v1–v3 tinham painel de máquinas, cartões por unidade e tabela completa — removidos na v5 a pedido; a API `/api/resumo` continua a devolver `unidades[].maquinas` e `ordens`, por isso recuperam-se só com código de cliente.)

## OP por abrir (regra)

| | |
|---|---|
| Ordem considerada | activa: não terminal (`terminada`, `espera_job`, `fechada`), não manutenção, não "fase futura" (WIM) |
| Número de OP | 8 dígitos seguidos, isolados (não colados a letras/dígitos) e sem começar por 0 — `src/util.js numOP()`. As OPs do CSP1 começam por 11…18 (PureCork 111/114, WIM 120, DSL 130–135, Densidades 134, DSL Talis 144, DS100 150/151, VOCUS 180/185) |
| Conta como OP | `12063090`, `12063090- LT02356473`, `14400249 -2`, `OP12063090`, `12063068 - REDES` |
| Não conta | `AG OP - 150XXX`, `1800XXXX`, `144xxxx -1`, `AG OP (1) - 1500XXXX - PAV 1200`, lote `LT02328411`, pedido `4400042021-20`, vazio |
| Dias até ao plano | dia planeado − hoje; VOCUS usa o dia de início programado pelo PlannerCork; DS100 usa o 1.º dia com frascos do separador DS100 (KANBAN: segunda-feira da semana); sem data → fim da lista |
| Nível (KPI) | **crítico** = plano já passou ou é hoje · **sério** = próximos 7 dias · **aviso** = depois |
| Filtro de datas | D = hoje, **D+n em dias úteis** (2.ª–6.ª, sem feriados — Código do Trabalho art. 234.º n.º 1, com Sexta-Feira Santa, Páscoa e Corpo de Deus calculados; + feriado municipal de Santa Maria da Feira 20/1; `FERIADO_MUNICIPAL=MM-DD` (vazio desliga) e `FERIADOS_EXTRA=AAAA-MM-DD,MM-DD,…` para Carnaval, pontes, férias colectivas). Um plano ao sábado/domingo/feriado conta no último dia útil antes (ex.: hoje 6.ª, plano sáb. → D). `dias_plano` = dias úteis (futuro) / dias corridos negativos (atrasada); `dias_corridos` = sempre corridos. **Hoje** = D · **até D+1/D+2/D+3** (defeito D+3) · **Personalizado** (datas) · **Todas**. **As ordens com plano anterior a hoje nunca entram nos filtros D** — só em Todas/Personalizado ou no indicador "Antigas" (`?dias=antigas`). **Ignorar antigas** tira-as também de Todas e das contagens. URL: `?dias=0|1|2|3|todas|antigas`, `?de=AAAA-MM-DD&ate=AAAA-MM-DD`, `?antigas=ignorar` |
| Cartões | **uma coluna por unidade** (7 colunas, pela ordem das fontes; com uma unidade seleccionada, grelha dessa unidade); dentro da coluna, ordenados pelo dia planeado; 20 por coluna + "mostrar todas" (TV: 6 por coluna, cabe em 1080p); cabeçalho da coluna com total, nº para hoje (vermelho) e D+1/D+2 (amarelo); **hoje vermelho**, **D+1 e D+2 amarelo** (cor fixa, sem piscar — retirado a pedido a 28/10), ≥ D+3 azul, atrasadas vermelho esbatido (só em Todas/Antigas), sem data cinzento. Clique abre o detalhe |
| Onde | KPIs (OP por abrir · Hoje · D+1 e D+2 · Antigas — clicar aplica o filtro), chips por unidade, cartões (60 + "mostrar todas"), CSV com o filtro activo, modo TV (25 mais próximas, cabe em 1080p) |

PureCork: o campo `op` da app fica vazio quando não há OP (o lote fica em `ref`); até à v4 o dashboard preenchia `op` com o lote, o que escondia OPs em falta.

## Fontes

| Unidade | App | Endpoint lido | Plano | Data limite | Horas reais | Paragens |
|---|---|---|---|---|---|---|
| WIM | planeamento-wim | `/api/state` | dia (semana ISO + dia, por fase W/I/M) | — | sim (`*_real`, `*_hIniR/hFimR`) | `*_atraso` |
| VOCUS | plannercork | `/api/store/planeamento_vocus_v6` + `/api/store/planeamento_vocus_settings_v1` (`/api/ops?tipo=vocus` está desactualizado desde Jul/2026) | **dia + hora de início/fim programados** — porte do algoritmo do PlannerCork (`src/adaptadores/vocus_plano.js`: fila por máquina `weekKey`+`sortIdx`, cadeia contínua, `qc`+reprocesso / (rate × OEE), paragens, turnos reduzidos, setup, início manual); validado 329/329 contra a app a 28/10/2026 | `dlim` (+ `dlog`) | `realStart/realEnd` | — |
| DS100 | plannercork | `/api/store/planeamento_ds100_v3` + `/api/store/planeamento_vocus_settings_v1` (mesmo SETTINGS da app) | **dia** = 1.º dia com frascos nas colunas 2.ªF…SAB do separador DS100 — porte da alocação diária do PlannerCork (`src/adaptadores/ds100_plano.js`: frascos = `qtEntrada` / rolhas por frasco da análise, capacidade `ds100CapsByWeek`/`ds100DailyTarget`, ordem `sortIdx`, transbordo entre semanas); validado 423/423 contra a app a 29/10/2026. KANBAN: semana | `dlim` (+ `dlog`) | — | — |
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

## Encomendas — rastreio por Pedido_Item (separador "Encomendas")

Responde a "onde está a ser processada cada encomenda e quando termina".

| | |
|---|---|
| Fonte | `Encomendas.xlsx` (SharePoint *Industrial Planning - Encomendas*), folhas cujo nome começa por **"Encomendas"** e **"Acompanhamentos"** (as outras — DS+, PR, Resumo… — são ignoradas e listadas no carregamento). A folha "Encomendas" estava vazia a 29/10/2026; os dados estão em "Encomendas HOJE". |
| Carregamento | botão **⬆ Carregar Encomendas.xlsx** no separador. O Excel é lido **no browser** (SheetJS CE 0.18.5, servido localmente em `public/vendor/`) e só as colunas necessárias seguem para `POST /api/encomendas`. O Railway não consegue ler o SharePoint nem o PC — por isso o upload. |
| Persistência | grava `encomendas.json` em `DATA_DIR` (ou `RAILWAY_VOLUME_MOUNT_PATH`). **Sem volume, um novo deploy apaga o ficheiro** (o ecrã avisa) → Railway → serviço → *Volumes* → montar em `/data` (o Railway define `RAILWAY_VOLUME_MOUNT_PATH`). |
| Protecção | opcional: variável `UPLOAD_TOKEN` no Railway → o carregamento pede o código (guardado no browser). Sem ela, qualquer pessoa com o link pode substituir o ficheiro. |
| Ligação às ordens | **(1) pedido** — o Pedido_Item (`4400041825_30` = `4400041825-30`) aparece no campo pedido/OP/lote/obs da ordem na app (VOCUS, DS100, Densidades, DSL Talis registam-no; WIM e DSL quase nunca; PureCork não tem o campo). **(2) OBS do Excel** — as colunas OBS/OBS AS/OBS FS citam OPs de 8 dígitos ("LAV 12063175", "DSL 14400252", "PC 11402913") → ligadas pelo número de OP. Ao vivo a 29/10: 163 de 253 Pedido_Item ligados (93 pelas duas vias, 40 só pedido, 30 só OBS); 90 sem nenhuma ordem nas apps. |
| Estado | *Sem planeamento* (nenhuma ordem) · *Planeada* (nenhuma começou) · *Em curso* (alguma em processo, ou parte feita) · *Concluída nas apps* (todas as ordens ligadas terminadas). Não inclui expedição/SAP. |
| Fim previsto | maior fim das **barras dos motores** (ver "Motores portados") das ordens ainda activas — WIM inclui Wash, Innocork e o dia de Make-up; DS100 e Make-up só têm dia (sem hora). Ordem sem barra (PureCork, Kanban/Buffer) usa a data da app. **Folga** = dias corridos entre fim previsto e data prometida (ou desejada, se não houver prometida). |
| Mini-Gantt | coluna **Plano**: escala comum de 1 semana atrás a 7 semanas à frente (S = semana ISO); uma barra por ordem/fase, cor por unidade; linha azul tracejada = hoje, linha vermelha = prazo; ‹ › = há plano fora da janela; riscado = só dia; esbatido = terminada. Ao abrir a linha: Gantt detalhado (uma linha por ordem e fase, segmentos por turno/batch, fins-de-semana sombreados) e ⚙ para simular essa ordem. |
| Em risco | prazo já passou e não concluída · fim previsto depois do prazo · sem planeamento com prazo a ≤ 14 dias. |
| Pesquisa e ordenação | **Procurar em tudo** = todas as colunas + OBS do Excel + OPs/máquinas/estados das ordens ligadas. **Filtro por coluna** (linha por baixo do cabeçalho): palavras sem acentos, todas têm de aparecer; datas aceitam `11/11` ou `2026-11-11` ou `qua`; colunas numéricas (Qt, Folga) aceitam `>100`, `<0`, `>=5`, `=10`. **Ordenar**: clicar no título de qualquer coluna (2.º clique inverte); vazios ficam sempre no fim; desempate pelo prazo. O CSV exporta o que está filtrado, na ordem do ecrã. |
| Segurança | SheetJS 0.18.5 tem a CVE-2023-30533 (prototype pollution com ficheiro malicioso; corrigida na 0.19.3, que não está no npm). Risco aceite: só lê o Encomendas.xlsx interno, no browser de quem carrega. Trocar por 0.20.x de cdn.sheetjs.com quando a rede o permitir. |

## Motores portados (base do Gantt e do simulador)

Cada app calcula o próprio plano no browser (excepto DSL Talis, no servidor). O dashboard corre **cópias fiéis** desses agendadores sobre os dados que lê — não estima nada por conta própria. Cada porte foi validado **contra a própria app**, no separador da app, com os dados reais:

| Unidade | Motor (origem) | Ficheiro | Validação (data) |
|---|---|---|---|
| VOCUS | `calcScheduleForWeek` em cadeia por máquina (PlannerCork) | `src/adaptadores/vocus_plano.js` | 329/329 ordens iguais (28/10/2026) |
| DS100 | `computeDS100AllocAllWeeks` (PlannerCork) | `src/adaptadores/ds100_plano.js` | 423/423 (1.º e último dia) (29/10) |
| Densidades | fecho de `calcScheduleForMachineRange` (index.html sha256 1563c014…) | `src/motores/densidades.js` | 222/222 (início, fim, segmentos, qtd/segmento; memória e `/api/state`); vista mensal 81/81 (29/10) |
| DSL Talis | `server/scheduler.js` integral + `inicioManualDe` + parte "linhas" de `calcular()` | `src/motores/talis.js` | 60/60 em 9 campos vs `plano.linhas` de `/api/estado` (29/10) |
| DSL | fecho de `scheduleLine` (index.html sha256 a446d16b…, = deploy) | `src/motores/dsl.js` | 861/861 nos 3 modos da app (`eff`, `efet`, `plan`) (29/10) |
| WIM | `scheduleMaq` (Wash) + `scheduleInno` (Innocork, arranca no fim da Lavação + 2 h) + transcrição do cálculo de `renderMQPlan` (Make-up) (index.html sha256 1a3af96a…, = deploy) | `src/motores/wim.js` | Wash + Innocork 223/223; dia de Make-up 64/64 (29/10). As horas de Make-up não foram validadas: 0 de 64 lotes tinham máquina de Make-up atribuída — a app só define o **dia** (fim da Lavação + 1 dia útil). |

PureCork não tem motor (fora do âmbito, 29/10). Os ficheiros em `src/motores/` são gerados a partir do código das apps (extracção por AST do fecho transitivo das funções) — **não editar à mão**: se uma app mudar o agendador, voltar a extrair e validar. Se o sha256 do `index.html` publicado mudar, o porte pode ficar desactualizado.

Fuso: os motores usam hora local; o servidor força `TZ=Europe/Lisbon`. DSL Talis guarda datas em UTC usado como hora de parede (`08:00Z` = 08:00 na fábrica) — tratado como tal (o adaptador antigo convertia de fuso e mostrava +1 h no horário de verão; corrigido na v19).

## Simulador (separador "Simulador")

Responde a "se o cliente mudar a data ou a quantidade, ou se uma máquina parar, que outras encomendas são afectadas?".

| | |
|---|---|
| Como funciona | `POST /api/sim {alteracoes:[…]}`: o servidor copia os dados lidos de cada unidade alterada, aplica as alterações, corre o motor da app e compara com o plano base. **Nunca escreve nas apps.** |
| Alterações | **Quantidade** (campo nativo: Densidades `qtdEntrada` rolhas · DSL `qtd` milheiros · Talis `qtd` un. · WIM `qtd` rolhas · VOCUS `qc` · DS100 `qtEntrada` rolhas) · **Mover / antecipar** (para um dia — início ou fim do dia, opcionalmente noutra máquina — ou para antes de outra ordem) · **Forçar início** (dia + hora, como o início manual da app) · **Capacidade** (ritmo % de uma máquina ou paragem de dias inteiros). Várias alterações juntam-se num cenário e aplicam-se por ordem. |
| Regras por unidade | VOCUS e DS100 planeiam por semana (mover = semana + posição). DS100 não tem hora: forçar início = semana do dia na posição correspondente. DSL Talis: a hora manual é um mínimo (a fila manda). Densidades: início manual é autoritário (a app não impede sobreposição). WIM: escolhe-se a fase (Wash ou Innocork); Make-up não se altera directamente (é Lavação + 1 dia útil); no Innocork a ordem movida fica com dia fixo e a sequência fina por batch (`i_bseq`) dessa ordem é ignorada. Ritmo: Densidades/DSL `krH`, Talis `capacidade`, VOCUS OEE da máquina, DS100 capacidade diária, WIM tempos de ciclo. |
| Resultado | ordens que mudam (início/fim antes → depois, Δ), Gantt antes/depois das máquinas afectadas, encomendas cujo fim previsto muda (folga antes → depois, **passa a estar em risco** / sai de risco). |
| Limites | sem propagação entre secções (nenhuma app conhece as outras): o efeito noutra secção vê-se na encomenda (fim previsto = máximo das ordens ligadas), não no plano dessa secção. O cenário fica só no browser (localStorage). |

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
npm test                       # testes unitários (estados, datas, indicadores, motores, simulador)
```

Variáveis de ambiente (opcionais): `PORT`, `DATA_DIR`, `UPLOAD_TOKEN`, `FERIADO_MUNICIPAL` (defeito `01-20`), `FERIADOS_EXTRA`, `REFRESH_SEC` (defeito 60), `TIMEOUT_MS` (defeito 12000), `URL_WIM`, `URL_PLANNERCORK`, `URL_PURECORK`, `URL_DENSIDADES`, `URL_DSL`, `URL_DSL_TALIS`.

## Endpoints

- `GET /` — dashboard. `?tv=1` abre em modo ecrã (KPIs + OPs por abrir mais próximas + excepções; cabe num 1080p).
- `GET /api/resumo` — indicadores por unidade (inclui `sem_op`, `sem_op_passado`, `sem_op_7d`), `ops_por_abrir` (ordenada), excepções (`alertas`), painel de máquinas (`unidades[].maquinas`, sem UI) e lista de ordens enriquecidas (`op_num`, `sem_op`, `sem_op_nivel`, `dias_plano`). `?so=kpi` omite a lista.
- `GET /api/encomendas` — encomendas carregadas cruzadas com as ordens (estado, onde está, fim previsto, folga, risco, ordens ligadas). `POST /api/encomendas` — carrega as linhas (JSON; cabeçalho `x-upload-token` se `UPLOAD_TOKEN`).
- `GET /api/procurar?q=…` — pesquisa global (todas as unidades, activas e fechadas; todas as palavras têm de aparecer).
- `GET /api/sim/maquinas` — máquinas/linhas por unidade simulável. `GET /api/sim/procurar?q=…[&fonte=…][&id=…]` — ordens simuláveis com o plano base (barras). `POST /api/sim` — `{alteracoes:[{fonte, tipo:'qtd'|'mover'|'inicio'|'capacidade', ordem, fase, valor, data, hora, posicao, maquina, antes_de, modo:'ritmo'|'paragem', pct, de, ate}]}` → ordens afectadas, encomendas afectadas, Gantt antes/depois.
- `POST /api/refresh` — força nova leitura das fontes.
- `GET /health` — `{status, fontes_ok, fontes_total, ultima_agregacao}`.

## Resiliência

Cada fonte é lida em paralelo com timeout. Se uma falhar, o dashboard mantém a **última leitura boa** dessa fonte e marca-a a vermelho no cabeçalho e na coluna (com o erro, a hora da última leitura boa e ligação à app). As outras continuam normais.

Um **registo** com dados inesperados (ex.: WIM guardou `i_real: [null, {...}]` a 28/10/2026) é ignorado e contado — nunca derruba a fonte inteira: o chip fica amarelo e a coluna mostra ⚠ com a lista (`fonte.registos_ignorados` / `registos_erro` na API).

Como verificar uma "sem leitura": passar o rato no chip da unidade (cabeçalho) ou no cabeçalho da coluna → erro exacto; `GET /api/resumo?so=kpi` → `unidades[].fonte` (`ok`, `erro`, `ultima_ok`, `ultima_tentativa`, `ms`, `registos_erro`); logs do serviço no Railway (`[agregador] <fonte>: <erro>`).

## Estrutura

```
server.js                 Express: API + estáticos
src/fontes.js             URLs das apps (substituíveis por env)
src/agregador.js          ciclo de leitura, cache por fonte, resumo
src/indicadores.js        regras dos KPIs (puro, testável)
src/estados.js            normalização de estados
src/util.js               datas (Lisboa, semana ISO), minutos, números
src/adaptadores/*.js      um por app: converte o JSON de origem no modelo comum (devolve também `bruto` = entrada do motor)
src/motores/*.js          agendadores portados das apps (Densidades, DSL, DSL Talis, WIM) — gerados, não editar à mão
src/simulador.js          planos/barras por ordem, alterações de cenário, impacto nas encomendas
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
