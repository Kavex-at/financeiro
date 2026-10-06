# Follow-ups do Regis-Review — sispag-verificacoes-ted-pix

Run: `docs/regis-review/2026-10-06-1356/` (`REPORT.md`, `KANBAN.md`). **0 P0** — nada re-entrou no
loop. P1/P2/P3 abaixo **não foram implementados** neste ciclo (regra do pipeline). Detalhe completo
de cada card (Problema / Melhoria / Resultado) no `KANBAN.md`.

## Antes de ligar em produção (recomendação da revisão)

| Card | Prio | Finding |
|---|---|---|
| fault-tolerance-1 | P1 | `retirarSemDado` ignora o `false` de `removerItemPeloSistema`: com o lote finalizado entre a leitura e a remoção, o item fica no lote FINALIZADO, os alertas dele são descartados e a pendência registra `RETIRADO`. Esforço S. |
| availability-1 | P1 | `ConexosBaseClient` sem timeout; o `finalizarLote` agora faz leitura viva do `fin064`. |
| performance-1 | P1 | Cada troca de modalidade TED/PIX relê o `fin064` inteiro da filial (até 50 páginas seriais). Medir o volume (`count` por filial) antes de decidir o cache. |
| deployability-1 | P1 | Migrations 0076–0079 sem reverse; `DEPLOY.md` sem seção de rollout/rollback da ADR-0063. |
| deployability-2 | P2 | Rollout sem checagem de pré-requisito (perfil de canal populado). |

## Demais

| Card | Prio | Finding |
|---|---|---|
| modifiability-1 | P1 | `LotePagamentoRepository` 1060 LOC (+210). |
| modifiability-2 | P1 | `routes/sispag.ts` 1163 LOC / 34 imports; importa client e repository direto. |
| security-1 | P2 | Conferente ≠ finalizador só no código; sem CHECK no banco. |
| availability-2 | P2 | Leitura serial por filial sem deadline; job de perfil sem notificação ativa. |
| modifiability-3 | P2 | Constantes de tempo duplicadas e limiares no código. |
| performance-2 | P2 | Orçamento de tempo e paralelismo limitado na paginação do `fin064`. |
| performance-3 | P2 | Filtro de favorecido em memória (filtro no servidor não confirmado — Q3). |
| testability-2 | P2 | 6 `randomUUID` diretos nos repositórios. |
| integrability-1 | P2 | `PerfilCanalService` injeta `ConexosBaseClient` só para `getFiliais`. |
| integrability-2 | P2 | Sem fixture real de `fin010/baixas` e `cmn025`. |
| security-2 | P2 | Sem evento/alarme para tentativa de autoconferência. |
| fault-tolerance-2 | P2 | Janelas de corrida devolver × remessa e gate de duplicidade × transição. |
| fault-tolerance-3 | P2 | Sem alerta para item PENDENTE ou conferência parada. |
| testability-1 | P2 | Integração SQL com 5 cenários para 13 invariantes, 0 de concorrência. |
| testability-3 | P2 | Dividir `routes/sispag.ts` e testes > 500 LOC (mesmo split de modifiability-2). |
| deployability-4 | P2 | Sem interruptor de env para o gate de duplicidade e a conferência obrigatória. |
| integrability-3 | P2 | Zod `.catch`/`preprocess` degrada campos sem contador de drift. |
| availability-3 | P3 | Dois `catch` best-effort sem log. |
| performance-4 | P3 | Instrumentar duração da verificação e do job; agrupar leituras de perfil. |
| testability-4 | P3 | Piso de cobertura para `domain/repository/` e `domain/libs/sispag/`. |
| deployability-3 | P3 | Node 22 no cron × Node 24 no CI. |
| security-3 | P3 | Conferência não vinculada ao conteúdo dos itens (gap Q10 aceito na ADR-0063). |

Observabilidade (ObservabilityAdvisor): `sispag-verificacoes-ted-pix-observability-followups.md`.
