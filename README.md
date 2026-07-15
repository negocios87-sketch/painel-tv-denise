# Painel TV — Time Denise

Painel de acompanhamento comercial (Sniper / Elite / Olympus) pra rodar
numa TV, sem login. Backend em Node.js (função serverless da Vercel),
frontend estático.

## ⚠️ Antes de confiar nisso

Este código foi escrito lendo o `calcular_abril()` do seu Forecast
Dashboard em Python — **não foi testado contra o Pipedrive real**
(não tenho acesso à sua API nem às suas planilhas daqui). Antes de
deixar rodando na TV da sala:

1. Testa `https://SEU-APP.vercel.app/api/painel-tv` direto no navegador
   e compara os números com o painel Flask que você já usa.
2. Presta atenção especial em: `ritmo_necessario_100` (campo novo que
   não existe em nenhum painel seu ainda) e `top_sdrs` (o campo `lider`
   fica vazio — não portei o mapeamento de team leader, só o essencial
   pro ranking).
3. Se a planilha de metas do mês ainda não tiver sido preenchida, a
   API retorna `{"aviso": "..."}` com squads vazios em vez de quebrar.

## Deploy

### 1. Criar o repositório no GitHub

```bash
cd painel-tv-denise
git init
git add .
git commit -m "Painel TV Time Denise — versão inicial"
gh repo create SEU-USUARIO/painel-tv-denise --private --source=. --push
```
(ou cria o repo pela interface do GitHub e faz `git remote add origin ...` + `git push`)

### 2. Importar na Vercel

1. vercel.com → **Add New → Project** → importa o repo que você acabou de subir.
2. Framework preset: deixa em **Other** (é só uma função serverless + estático, não precisa de build).
3. Em **Environment Variables**, adiciona:
   - `PIPE_API_KEY` = sua chave do Pipedrive
   - (opcional) `URL_COLAB`, `URL_METAS`, `URL_FERIADOS` só se forem diferentes do default que já está no código
4. Deploy.

### 3. Testar

- `https://SEU-APP.vercel.app/` → dashboard visual
- `https://SEU-APP.vercel.app/api/painel-tv` → JSON cru, pra debugar

### 4. Colocar na TV

Abre a URL raiz em modo kiosk no Chrome (ou Chromecast/Fire Stick com
navegador). A página já se atualiza sozinha a cada 60s — não precisa
dar refresh manual.

## Sobre não ter login

Essa API é pública de propósito (é o que foi pedido — TV sem tela de
login). Isso expõe faturamento e ranking nominal de vendedores pra
qualquer pessoa com a URL. Se quiser reduzir a chance de acesso por
acaso, renomeia a pasta `api/painel-tv.js` pra algo com um token
aleatório (ex: `api/tv-x7f9k2h4a1.js`) e ajusta o `API_URL` no
`public/index.html` — não é segurança de verdade, só dificulta.

## Ajustar o intervalo de refresh

`public/index.html`, variável `REFRESH_MS` (linha ~121). Está em 60000
(60s).

## Checkpoint de 40%

`api/painel-tv.js`, constante `MARCO_ATINGIMENTO`. Hoje é fixo em 40 —
se isso precisar vir de planilha (marco que muda mês a mês), me avisa
que eu ajusto.
