# Regenerar os motores portados (`src/motores/*.js`)

Os motores são **cópias** do código de planeamento de cada app. Se uma app mudar o agendador, regenerar e voltar a validar.
Requer `acorn` e `acorn-walk` (só para estas ferramentas; não são dependências do dashboard):

```bash
mkdir -p /tmp/m && cd /tmp/m && npm i acorn acorn-walk   # uma vez
# 1) fonte da app sem CR (o sha256 fica no cabeçalho do motor)
tr -d '\r' < "…/Planeamento DENSIDADES/Railway/public/index.html" > dens.html
# 2) fecho transitivo das funções-raiz
NODE_PATH=/tmp/m/node_modules OUT=dens_raw.js node tools/motores/extrair.js dens.html calcScheduleForMachineRange,ensureSettingsShape,isoWeekToMonday,MACHINES
node tools/motores/gerar_dens.js dens_raw.js $(sha256sum dens.html | cut -c1-16) src/motores/densidades.js
```

| Motor | Raízes para `extrair.js` | Gerador |
|---|---|---|
| Densidades | `calcScheduleForMachineRange,ensureSettingsShape,isoWeekToMonday,MACHINES` | `gerar_dens.js raw sha out` |
| DSL | `scheduleLine,ALL_LINES` | `gerar_dsl.js raw sha out` |
| WIM | `scheduleMaq,scheduleInno,maqsOf,secOfMaq,finishOfSection,effMqDay,mqBatchesFull,batchMaq,mqSeqOf,released,dateKey` | `gerar_wim.js raw sha out` (o cálculo de Make-up é transcrito de `renderMQPlan` dentro do gerador — rever à mão se a app mudar) |
| DSL Talis | — (usa `server/scheduler.js`, `server/index.js`, `server/config.js` sem CR) | `gerar_talis.js scheduler.js index.js config.js shaS shaI shaC out` |

Validação: injectar o motor na consola do browser **da própria app** e comparar com as funções da app (início, fim e segmentos de todas as ordens) — ver a secção "Motores portados" do README principal.
