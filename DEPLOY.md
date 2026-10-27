# Deploy — Dashboard OPS (GitHub + Railway)

Igual ao processo do Planeamento WIM / DSL. Sem base de dados — é só um serviço web.

## Passo 1 — Git local
PowerShell na pasta do projecto:
```powershell
cd "C:\Users\rpsilva\OneDrive - Harv 81\Documents\Claude\Projects\Dashboard OPS\Railway"
.\deploy-setup.ps1
```
> Erro de execution policy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

## Passo 2 — Repositório GitHub
1. https://github.com/new
2. Nome: `dashboard-ops` · Visibility: **Private** · sem README/gitignore/license
3. Create repository

## Passo 3 — Ligar e enviar
```powershell
git remote add origin https://github.com/<TEU_UTILIZADOR>/dashboard-ops.git
git push -u origin main
```

## Passo 4 — Serviço web no Railway
1. https://railway.app/new → **Deploy from GitHub repo** → `dashboard-ops`
2. Railway detecta `package.json` + `nixpacks.toml` (Node 20) + `railway.toml`
3. Build ~1 min. **Não precisa de Postgres.**
4. (Opcional) Variables: `REFRESH_SEC=60`

## Passo 5 — URL público
Serviço web → **Settings → Networking → Generate Domain** → abre no browser.
Para ecrã de produção: `https://<URL>/?tv=1`

## Verificar
```powershell
curl https://<TEU_URL>/health            # {"status":"ok","fontes_ok":7,"fontes_total":7,...}
curl "https://<TEU_URL>/api/resumo?so=kpi"
```
No cabeçalho do dashboard, os 7 chips (WIM, VOCUS, DS100, PURECORK, DENSIDADES, DSL, DSL TALIS) devem ficar verdes.
Um chip vermelho = essa app não respondeu (o tooltip mostra o erro); o dashboard mantém a última leitura boa.

## Actualizar
```powershell
cd "C:\Users\rpsilva\OneDrive - Harv 81\Documents\Claude\Projects\Dashboard OPS\Railway"
git add .
git commit -m "Atualização"
git push
```

## Segurança
O dashboard é de leitura mas expõe nomes de clientes e OPs. Restringir como as outras apps:
Railway → Settings → Networking → **Basic Auth**, ou Cloudflare Access.

## Se uma app mudar a API
Cada app tem o seu adaptador em `src/adaptadores/`. Alterar só esse ficheiro; validar com `node tools/harness.js <app>` na consola do browser dessa app (ver README).

---
**Cork Supply / Harv 81 Group**
