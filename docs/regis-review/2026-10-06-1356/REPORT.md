# Regis-Review — sispag-verificacoes-ted-pix (2026-10-06-1356, `--quick`, delta vs `origin/main`)

> Delta saudável (**7,2** e **0 P0**), mas o foco dos próximos 30 dias é fechar o caminho de volta
> (rollback e flags) e dar orçamento de tempo à leitura síncrona do Conexos, antes de a revisão
> obrigatória do lote travar em produção.

Escopo: ADR-0063 — verificações TED/PIX (duplicidade forte/fraca no `fin064`, canal habitual por
perfil semanal, dados de pagamento no `cmn025`), gate de duplicidade no `finalizarLote`, conferência
por segunda pessoa (L12/L13) antes da remessa e fila de pendências de cadastro. Seções por QA neste
diretório; cards em `KANBAN.md` (27, IDs originais preservados).

## Scorecard

Pesos: Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0,
Performance 1.0, Integrability 0.9, Deployability 0.9 → 64,65 / 9,0 = **7,2**.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Security | 8.0 | 0 | 0 | 2 | 1 | F-security-1: conferente ≠ finalizador só no código, sem CHECK no banco |
| Testability | 8.0 | 0 | 0 | 3 | 1 | F-testability-1: 13 invariantes em 5 cenários SQL, 0 de concorrência |
| Fault Tolerance | 7.5 | 0 | 1 | 2 | 0 | F-fault-tolerance-1: retorno `false` de `removerItemPeloSistema` ignorado |
| Integrability | 7.5 | 0 | 0 | 3 | 0 | F-integrability-3: Zod `.catch`/`preprocess` degrada sem detector de drift |
| Availability | 7.0 | 0 | 1 | 1 | 1 | F-availability-1: `ConexosBaseClient` sem timeout no caminho síncrono do `finalizarLote` |
| Modifiability | 7.0 | 0 | 2 | 1 | 0 | F-modifiability-1: `LotePagamentoRepository` 1060 LOC (+210) |
| Deployability | 6.5 | 0 | 1 | 2 | 1 | F-deployability-1: migrations 0076–0079 sem reverse (0/4) |
| Performance | 5.5 | 0 | 1 | 2 | 1 | F-performance-1: leitura completa do `fin064` (até 50 páginas seriais) por clique de modalidade |

Cards: **27** — P0 0 · P1 6 · P2 16 · P3 5 (32 findings).

## Top 5 riscos

1. **R-1 — leitura síncrona do `fin064` sem orçamento de tempo** (availability-1, performance-1/2/3,
   availability-2). 0 timeout no `ConexosBaseClient`; até 50 páginas seriais; cache só dentro de uma
   chamada, então cada clique de modalidade relê a filial. P1 e não P0 porque o volume de PRD não foi
   medido — a primeira ação é medir (`count` por filial).
2. **R-2 — sem caminho de volta** (deployability-1/2/4). 0/4 reverses, 0 linhas no `DEPLOY.md`; a
   0078 cria trigger append-only; não há flag para desligar os três comportamentos bloqueantes
   (gate de duplicidade, retirada por falta de dado, conferência obrigatória).
3. **R-3 — corridas com estado divergente** (fault-tolerance-1/2, testability-1). `retirarSemDado`
   descarta alertas e abre pendência `RETIRADO` mesmo quando o DELETE não removeu (lote já
   finalizado); janelas devolver × remessa e gate × transição. 0 testes de concorrência. Mitigado
   pela reconferência do destino ao vivo no envio e pelo ledger contra duplo envio.
4. **R-4 — segregação de funções só no código** (security-1/2/3). Nenhum vetor testado a contornou
   (ator de `req.user.sub`, guarda na remessa, reabrir/devolver limpam a conferência); o risco é de
   regressão. Sem evento/alarme para tentativa de autoconferência.
5. **R-5 — monólitos SISPAG cresceram** (modifiability-1/2, testability-3). `routes/sispag.ts`
   1163 LOC / 34 imports; split proposto em `routes/sispagVerificacao.ts`.

Demais: R-6 falha fechada sem observabilidade (itens presos em PENDENTE, lote finalizado sem
conferência); R-7 drift de contrato Conexos (fixtures de `fin010`/`cmn025`); R-8 rollout sem
checagem do perfil vazio; R-9 prova SQL rasa das invariantes concorrentes; R-10 limiares no código.

## Causas-raiz cruzadas

- **CC-1** leitura Conexos síncrona sem timeout, cache nem métrica.
- **CC-2** monólitos de rota e repositório.
- **CC-3** falha fechada sem observabilidade.
- **CC-4** corridas sem constraint no banco nem teste de concorrência.
- **CC-5** reversibilidade e flags ausentes.
- **CC-6** parsers Zod tolerantes sem fixture nem contador.

## O que está bem

- Falha de leitura vira PENDENTE em 3/3 leituras (fail-closed, I13b).
- 4/4 escritas multi-tabela em transação, com evento append-only por trigger.
- CAS por `versao` em 4/4 mutações de lote; conferir exige `conferido_por IS NULL`.
- 100% das leituras novas via `runWithRetry`; clients com Zod; nenhum service com axios/fetch.
- Serviços novos ≤ 490 LOC, sem ciclos; regra L12/L13 isolada em `ConferenciaLoteRule`.
- 13/13 invariantes I13a–m com teste nomeado; 0 testes com rede real.
- Migrations idempotentes; build copia os `.sql`; cron com alerta ADR-0042 e `concurrency`.

## Ações de 30 dias

1. deployability-1 e deployability-2 **antes** de ligar a verificação em PRD.
2. Um PR de cliente Conexos: availability-1 + performance-2 (com availability-2 e performance-4),
   precedido do probe só de `count` por filial.
3. fault-tolerance-1; depois fault-tolerance-2 junto com testability-1.
4. security-1; depois security-2.
5. Com os dados do passo 2: performance-1, deployability-4, fault-tolerance-3 e o split de
   rotas/repositório (modifiability-1/2 + testability-3).

## Limitações

- `--quick`: sem cobertura medida, sem build de frontend, sem `npm audit`.
- Não medíveis localmente: volume e latência do `fin064` em PRD, p95, MTTR, duração do job.
- Security não leu por completo `LotePagamentoApiView`, a barreira de edição em lote FINALIZADO e o
  `requireAuth` global.
- Sem `infra/`: Terraform, IAM e tenants N/A.

> Consolidado a partir das 8 seções pelo orquestrador (o `qa-consolidator` gerou o `KANBAN.md`; a
> escrita do REPORT pelo subagente foi recusada pela harness).
