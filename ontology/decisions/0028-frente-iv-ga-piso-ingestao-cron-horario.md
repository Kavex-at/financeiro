---
adr_number: 0028
title: Frente IV liberada em produção ("Gestão de Adiantamentos") — gate de frontend removido e RECEBIMENTOS_ENABLED rebaixado a kill-switch (fail-safe invertido); piso DURO de ingestão do extrato em 2026-08-03 (CONEXOS_EXTRATO_SYNC_START_DATE) válido inclusive no backfill; cron HORÁRIO do job:ingest-extratos via GitHub Actions (20 * * * *) com até 3 tentativas
date: 2026-08-04
status: accepted
type: change
related_entities: [TransacaoBancaria]
related_actions: [importarTransacoesExtrato]
related_integrations: [conexos-fin095-extrato]
supersedes_decisions: []
amends_decisions: [0022, 0023]
---

# ADR 0028: Frente IV em produção, piso de ingestão e cron horário

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`feat/recebimentos-ga-extrato-hourly` (worktree, base `main`). **Fonte:** feature-tweak aprovado com
o usuário (2026-08-04).
**`entity_changed = true`** — a ação `importarTransacoesExtrato` ganha uma regra de janela nova (o
piso) e a cadência sai de "não agendada" para horária. Nenhuma entidade nova.

## Contexto

A Frente IV estava **completa em código e invisível em produção**. Dois gates independentes a
bloqueavam, e cada um sozinho já quebrava a frente:

| Gate | Onde | Comportamento em produção |
|------|------|---------------------------|
| Frontend | `lib/features.ts` → `isRecebimentosEnabled()` | sem env, só habilitava com `NEXT_PUBLIC_ENV=local` — e um build da Vercel **nunca** é `local`, então o botão da home ficava apagado ("Indisponível em produção") |
| Backend | `http/recebimentosGate.ts` + `RECEBIMENTOS_ENABLED` (`sync:false`) | env não setada no dashboard → **403 em todo `/recebimentos/*`** |

Além disso o `job:ingest-extratos` existia, funcionava e estava **medido em produção** (1.759
créditos, filial 1, 90 dias, reingestão 100% deduplicada), mas **não estava agendado** — o cron era
só um comentário no docblock (`_inbox/frente-iv-fase1-followups.md`, item 5).

## Decisões

### D1 — O gate do frontend é REMOVIDO, não invertido

`isRecebimentosEnabled` deixa de existir; a home renderiza o card sempre habilitado e a rota
`/recebimentos` não tem mais tela de bloqueio.

Deliberadamente **sem espelho** da flag no frontend: uma `NEXT_PUBLIC_*` é assada no build da Vercel,
então um espelho só voltaria a valer no próximo deploy — tarde demais para uma emergência. Manter dois
gates que precisam concordar é pior que ter um só que funciona.

### D2 — `RECEBIMENTOS_ENABLED` sobrevive como KILL-SWITCH, com o fail-safe INVERTIDO

`resolveRecebimentosEnabled` passa a ser `readEnv('RECEBIMENTOS_ENABLED') !== 'false'`: **ausência da
env significa habilitado**. Só `false` desliga.

Isto é o oposto do `SISPAG_ENABLED`, que continua fail-safe (bloqueia em produção sem env) — e a
assimetria é intencional: o SISPAG ainda tem legs dormentes, a Frente IV não. O gate do backend
(`recebimentosGate` → 403) fica de pé porque é o único freio que funciona **sem redeploy**, com o
dashboard do Render (`sync:false`) como fonte da verdade.

**Consequência aceita:** a frente vai ao ar sem ninguém precisar tocar em dashboard. Era o objetivo —
a alternativa (setar a env manualmente) tinha a falha de que esquecer o passo deixa a página abrindo
e falhando em toda chamada.

### D3 — O rótulo do usuário é "Gestão de Adiantamentos"; o termo de domínio continua "Recebimento"

Muda o H1 da página, o card da home e o título da aba (via `app/recebimentos/layout.tsx` — a página é
`'use client'` e o Next ignora `export const metadata` em client component).

**Não** muda: a rota (`/recebimentos`), as entidades, as tabelas, as rotas de API nem o vocabulário da
ontologia. Renomear o domínio custaria 20+ arquivos e o alinhamento com o ERP para ganhar zero. É um
rótulo de UI, e está registrado aqui para que a divergência entre tela e ontologia seja lida como
decisão, não como drift.

### D4 — Piso DURO de ingestão em 2026-08-03, válido inclusive no backfill

`resolverPeriodo` recorta `de` pelo `CONEXOS_EXTRATO_SYNC_START_DATE` (default `2026-08-03`). A janela
efetiva é a **interseção** com `RECEBIMENTO_INGEST_DIAS`.

O piso vale para **todos** os caminhos, inclusive `DIAS=` e `POST /recebimentos/ingestao { dias }`.
Crédito anterior ao go-live pertence ao processo manual antigo: importá-lo encheria a carteira do
analista de pendências falsas que ninguém vai conciliar. Ir mais atrás exige mudar a env — decisão
consciente, não efeito colateral de um número grande digitado no painel.

O piso é um **mínimo, não uma data fixa**: passado o tempo, a janela volta a ser a pedida. Fixá-la
faria a ingestão reler de 2026-08-03 em diante para sempre, crescendo sem limite.

Parseado como **meia-noite UTC**: o `fin095` filtra `exiDtaLcto#GE` em epoch-ms e o ERP grava o
dia-calendário BR em UTC 00:00 (o shift de meio-dia do `parseDate` é aplicado na **leitura**), então
o piso em UTC 00:00 inclui o dia 03/08 inteiro no fuso BR. Valor malformado cai no default em vez de
virar `Invalid Date` — que envenenaria a comparação e faria a ingestão trazer nada, em silêncio.

### D5 — Cadência HORÁRIA via GitHub Actions, no minuto :20, com até 3 tentativas

`.github/workflows/ingest-extratos.yml`, `cron: '20 * * * *'`, `workflow_dispatch` habilitado.

- **GitHub Actions e não Render Cron** — é a doutrina da casa ("Cron GRATUITO via GitHub Actions;
  Render Cron Job é pago") e roda o job **uma vez**, num runner, em vez de dentro de cada instância
  web.
- **Minuto :20** — o Conexos limita sessões simultâneas por usuário (`LOGIN_ERROR_MAX_SESSIONS`, ~3
  slots) e os outros crons disparam no `:00` (Permutas `0 9,15,21`; SISPAG `0 10`). Um cron horário no
  `:00` colidiria com eles duas vezes por dia.
- **Sobreposição** barrada em duas camadas: `concurrency` do workflow (entre runs do cron) e advisory
  lock (contra o trigger manual e o upload `.xlsx`, que compartilham `RECEBIMENTO_INGEST_LOCK_KEY`).
- **3 tentativas com backoff (60s, 120s)** — o Actions não tem retry nativo de job. Retentar é seguro
  **porque** a dedupe é por chave natural: uma tentativa que morreu no meio não duplica nada na
  seguinte. Também recupera o 409 de lock ocupado, quando a execução da hora anterior ainda estava
  terminando.

### D6 — Nenhuma migration; a dedupe já estava no banco

`UNIQUE (natural_key)` existe desde a migration `0032` e o `upsertMany` já usa
`ON CONFLICT (natural_key) … WHERE status = 'importada'`. A chave natural **não muda**, então a
primeira execução da sincronização atualizada **não duplica** o que já está lá.

O que foi acrescentado é observabilidade, não proteção: `inseridas` passa a sair no
`IngestaoTransacoesResult` para o job poder logar "quantas entraram" — o número que **prova** a
idempotência (numa reingestão da mesma janela vem `0`).

## Consequências

- A Frente IV fica no ar no próximo deploy, sem passo manual.
- O extrato passa a chegar com atraso máximo de ~1h, contra "quando alguém rodar o job".
- Perde-se o fail-safe: um bug na frente fica visível em produção até alguém setar
  `RECEBIMENTOS_ENABLED=false`. Aceito — é o que "liberar em produção" significa.
- Sobe a pressão sobre as sessões do Conexos. O **usuário-robô dedicado** (P1,
  `_inbox/frente-iv-fase1-followups.md` item 1) segue **aberto** e é a correção real; o `:20` e o
  fan-out bounded são mitigação.
- `_inbox/frente-iv-fase1-followups.md` item 5 (cron não agendado) está **resolvido**.

## Alternativas descartadas

- **Só ligar as envs no dashboard** (sem mexer em código): mantém o botão apagado até alguém setar
  `NEXT_PUBLIC_RECEBIMENTOS_ENABLED` **e** `RECEBIMENTOS_ENABLED`, em dois provedores diferentes, e
  esquecer um deles entrega uma página que abre e falha.
- **Piso só na cadência automática**, deixando o backfill livre: mais flexível, mas o pedido é que
  lançamento anterior a 2026-08-03 **não** seja importado, e um `dias` grande no painel é exatamente
  como isso voltaria por acidente.
- **Filtrar por data na escrita** (rejeitar no repositório) em vez de recortar a janela: gastaria a
  leitura do ERP para descartar depois — o Conexos é justamente o recurso escasso aqui.
- **Cron dentro do processo Express** (`node-cron`/`setInterval`): rodaria uma vez por instância web,
  multiplicando o fan-out contra o Conexos. Foi o cenário que o pedido pediu para evitar.
