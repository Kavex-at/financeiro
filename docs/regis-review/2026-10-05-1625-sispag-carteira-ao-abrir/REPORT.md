# REPORT — Regis-Review `sispag-carteira-ao-abrir` (2026-10-05)

**Escopo:** o delta do tweak que atualiza a carteira do SISPAG ao abrir a tela (ADR-0060): commits
`74bdfe5` (backend), `0c6b649` (frontend) e `f25c7e6` (workflow + docs), 20 arquivos, +854 / −10. Revisão
`--quick`, restrita ao delta. Métricas-base e fatos do desenho: `_shared-metrics.md`.

> **Nota de processo.** O consolidador (`qa-consolidator`) não conseguiu gravar este arquivo: a harness
> recusa que subagentes escrevam arquivos de relatório. O orquestrador escreveu `REPORT.md` e
> `KANBAN.md` a partir dos oito arquivos de QA e do resumo que o consolidador devolveu em texto.

## Veredito

**Sem P0 e sem P1.** 28 findings e 24 cards: 18 P2 e 6 P3. O desenho é sólido onde importa: o refresh
tem três freios (TTL de 30 min, lock da ingestão, cooldown de 5 min após falha), uma `running` morta há
mais de 10 min não bloqueia, e o PatternGuardian não achou violação de DDD, tsyringe, permissões ou
`process.env` no delta. As fragilidades estão nas bordas: o que a tela e o contrato dizem quando o
refresh falha, e a configuração operacional.

## Scorecard

| QA | Nota | Findings | Cards | Leitura |
|---|---|---|---|---|
| Availability | 7,0 | 3 | 3 | degrada para o dado gravado; sem deadline e sem aviso de idade quando o refresh não conclui |
| Deployability | 7,0 | 3 | 3 | variáveis novas fora do `DEPLOY.md`/`render.yaml`/`.env.example`; literal do cron duplicado |
| Integrability | 7,5 | 3 | 3 | tipo espelhado à mão, resposta lida com `as`; `motivo` cru |
| Modifiability | 7,5 | 4 | 3 | lógica nova em módulos pequenos; acrescenta linhas a dois arquivos legados de 900+ LOC |
| Performance | 7,0 | 4 | 3 | refresh síncrono (~9 s, n = 1) sem teto; polling contra o limiter de 10/min por IP |
| Fault tolerance | 7,5 | 4 | 3 | ordem de decisão correta; leitura parcial vira `success` e a carteira fica "fresca" |
| Security | 7,5 | 3 | 3 | `motivo` devolve texto cru a quem só tem `sispag:ver`; `triggered_by` não é falsificável |
| Testability | 7,5 | 4 | 3 | relógio injetável e 10 testes no serviço; 0 testes com Postgres real |

Ponderado (pesos 1,2 / 0,9 / 0,9 / 1,2 / 1,0 / 1,3 / 1,5 / 1,0): **7,3 / 10**.

## Cinco riscos, em ordem

1. **Erro cru no contrato (security-1, integrability-3).** `falha_recente.motivo` devolve
   `run.error_message` (`CarteiraAtualizacaoService.ts:94`) a qualquer `sispag:ver`, num 200 que escapa
   do `errorMiddleware`. Pode trazer host, status ou erro de banco do Conexos. Com o papel Analista
   (v0.52.0) esse público cresce. É o ponto que eu corrigiria primeiro.
2. **Refresh sem teto e limiter compartilhado (performance-1/2, availability-2, security-2).** A chamada
   síncrona não tem deadline nem `AbortSignal`. Até 6 POSTs de polling disputam o `heavyRouteLimiter`
   (10/min por IP, um balde para o NAT do escritório) e um 429 vira "falhou".
3. **Leitura parcial vira "fresca" (ft-1, availability-1).** 1 filial de 7 (14%) que falha é gravada
   como `success`; a carteira passa 30 min sem ela e a tela não avisa.
4. **Configuração operacional (deployability-1/2/3, testability-2, modifiability-1/3).** 0 de 2 variáveis
   `SISPAG_CARTEIRA_*` documentadas; o literal `'0 10 * * *'` está no `schedule` e no `if`
   (`ingest-sispag.yml:25,65`) sem teste que o ligue, e o cron das 15:00 UTC coincide com o de Permutas.
5. **Sem teste contra Postgres real (testability-1).** A regra de run morta e o formato de `startedAt`
   só rodam com mock; o lock advisory nunca é exercitado.

## Itens que ficaram de fora do top

`ft-3` (upsert, anti-fantasma e fechamento da run fora de uma transação), `security-3` (cooldown fixo:
até 288 tentativas por dia), `modifiability-2` (extrair endpoint e hook dos arquivos de 900+ LOC, esforço L).

## O que não foi medido

`--quick`: sem cobertura, `npm audit` nem top-10 de LOC. Sem `infra/`: Terraform e Lambda não medíveis.
O pior caso de 7 filiais sob carga e a pressão sobre as sessões do Conexos em produção não foram
medidos (só 1 execução do cron, ~9 s).

## Próxima ação

Nenhum P0: o sub-loop de remediação não dispara. P1 não existe; os 18 P2 e 6 P3 viram follow-ups em
`ontology/_inbox/sispag-carteira-ao-abrir-regis-followups.md`. Três PRs pequenos fecham as convergências
A, B e C; a D é config. Detalhe e ordem em `KANBAN.md`.
