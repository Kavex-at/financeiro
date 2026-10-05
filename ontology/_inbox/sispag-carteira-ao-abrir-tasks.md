# sispag-carteira-ao-abrir — tasks

**Tweak** de `ingerirPagamentos` (`ontology/actions/sispag/ingerir-pagamentos.md`).
Branch `fix/sispag-carteira-ao-abrir`, empilhada em `worktree-sispag-delivery-gap` (base do PR).

## Intenção (entrevista, 2026-10-05)

Pagamento pede carteira quase em tempo real, e o cron do GitHub chega 2–5 h atrasado. Decisões:

1. **Ao abrir `/sispag`, a tela mostra a carteira já gravada e pede um refresh se ela estiver defasada;
   ao terminar, a tela recarrega sozinha.** Cache de **30 min** (configurável).
2. **Quem só tem `sispag:ver` pode disparar** o refresh (escreve só no Postgres próprio; I1 — nada
   no ERP — se mantém).
3. **A formação automática de lotes NÃO dispara na abertura da tela**: continua só no cron (e no botão
   explícito). Formar lote sob os pés de quem está editando muda a tela dela.
4. **Cron**: de 1x/dia para **3x/dia em dia útil** (07h todo dia; mais 12h e 16h BRT em dia útil),
   como rede de segurança. A formação roda só na execução da manhã (e no `workflow_dispatch`) —
   comportamento de hoje.

Classificação: **mudança de regra** (novo gatilho + TTL de staleness) → diff de ontologia + ADR-0060.
Sem lógica monetária alimentada pelo Conexos → **Ground-Truth Validation não se aplica** (a ingestão
só lê o que o gatilho manual já lê).

## Tasks

### T1 — Staleness da carteira como regra do serviço (backend)
`IngestaoPagamentosService.atualizarSeDefasada({ triggeredBy })`.
- `fresca`: última ingestão `success` com menos de `sispagCarteiraTtlMin` (default 30) → não roda.
- `em_andamento`: run `running` iniciada há menos de 10 min **ou** lock ocupado (`IngestLockBusyError`).
- `falha_recente`: última run `error` há menos de `sispagCarteiraCooldownMin` (default 5) → não repete
  (um 403 do robô não pode virar uma tentativa a cada abertura de tela).
- `atualizada`: roda `executar` (mesmo compute do cron/manual) e devolve o resultado.
- Aceite: testes por estado, incluindo relógio injetado e run `running` velha (>10 min) que NÃO
  bloqueia.

### T2 — Configuração (backend)
`EnvironmentVars` + `EnvironmentProvider`: `sispagCarteiraTtlMin` (`SISPAG_CARTEIRA_TTL_MIN`) e
`sispagCarteiraCooldownMin` (`SISPAG_CARTEIRA_COOLDOWN_MIN`). Valor inválido/≤0 cai no default.
- Aceite: teste do parse (default, válido, lixo).

### T3 — Rota (backend)
`POST /sispag/carteira/atualizar` — `sispag:ver`, `heavyRouteLimiter`, `triggered_by =
abertura:<ator>`. Responde `{ estado, ultimaIngestaoEm?, idadeMin?, run?, motivo? }`. Falha inesperada
→ 500 com a mensagem; `IngestLockBusyError` nunca vira 409 aqui (vira `em_andamento`).
- Aceite: `routePermissions.test.ts` lista a rota com `SISPAG_VER`; teste de rota para os estados.

### T4 — Tela (frontend)
`lib/sispag.ts` `atualizarCarteiraSeDefasada()`; `page.tsx` dispara **uma vez por abertura** (após o
primeiro carregamento), mostra "atualizando a carteira…" ao lado de "carteira de <data>", recarrega o
painel quando `estado = atualizada`, reconfere a cada 8 s (até 6x) quando `em_andamento`, e em falha mantém
os dados com aviso "não foi possível atualizar". `IngestaoDialog` rotula `abertura:<ator>`.
- Aceite: testes de página — refresh disparado uma vez; recarrega ao `atualizada`; não recarrega ao
  `fresca`; falha mostra aviso sem esconder os dados; não dispara sem `sispag:ver`.

### T5 — Cron (workflow)
`ingest-sispag.yml`: duas entradas de `schedule` — `0 10 * * *` (manhã, todo dia, como hoje) e
`0 15,19 * * 1-5` (12h e 16h BRT, dia útil). `job:formar-lotes` só roda com `workflow_dispatch` ou
`github.event.schedule == '0 10 * * *'` (o texto do cron que disparou, não a hora, que o GitHub atrasa).
- Aceite: YAML válido; `job:formar-lotes` condicionado; passo de alerta intacto.

### T6 — Ontologia e docs
`actions/sispag/ingerir-pagamentos.md` (gatilho novo + regra de staleness), `business-rules/staleness-por-pipeline.md`
(linha do `sispag-pagamentos`), ADR-0060, `CHANGELOG.md` do app e da ontologia.

## Fora de escopo
- Formação automática na abertura da tela.
- Polling por WebSocket/SSE; o refresh é uma chamada síncrona (~10 s medidos no cron).
- Mudar o limite de staleness do detector (ADR-0042): o refresh só deixa a carteira mais fresca.
