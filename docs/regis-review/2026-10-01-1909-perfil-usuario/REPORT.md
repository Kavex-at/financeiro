# Regis-Review — perfil-usuario (2026-10-01-1909)

> Escopo: delta da branch `feat/perfil-usuario` contra `origin/main` (3cf24c6), modo `--quick`.
> Feature: `GET /me`, `/me/atividade`, `/me/historico`, migration 0072 (índices), página `/perfil`,
> `UserMenu` com avatar. O delta é **100% leitura**: não há escrita financeira nem chamada a ERP,
> Nexxera ou GED.
>
> Os 8 relatórios por QA estão nesta pasta. Os cards estão em [`KANBAN.md`](KANBAN.md).
> Este REPORT foi escrito pelo orquestrador a partir da síntese do `qa-consolidator`, porque o
> harness recusou a escrita do arquivo pelo subagente.

## Veredito

**Score geral: 7,7. Nenhum P0 nem P1.** O gate não exige remediação. Os 22 cards (13 P2, 9 P3)
viram follow-ups em `ontology/_inbox/perfil-usuario-regis-followups.md`.

## Placar

| QA | Score | Peso |
|----|------:|-----:|
| Security | 8,5 | 1,5 |
| Fault Tolerance | 8 | 1,3 |
| Deployability | 8 | 0,9 |
| Performance | 8 | 1,0 |
| Testability | 8 | 1,0 |
| Availability | 7 | 1,2 |
| Modifiability | 7 | 1,2 |
| Integrability | 7 | 0,9 |
| **Geral (ponderado)** | **7,7** | |

## O que foi verificado e está correto

- **Isolamento.**
  - A identidade vem só de `req.user` e `req.acesso`, e não existe rota `:id`.
  - O Zod `.strict()` recusa `userId` e `username` na query.
  - Os 11 ramos do `UNION ALL` filtram o ator dentro de cada ramo.
  - Um cursor forjado não consegue ampliar o escopo nem injetar SQL.
  - Nenhuma coluna de credencial é selecionada.
  - As rotas respondem com `Cache-Control: no-store`.
- **Falha isolada por seção.**
  - Cada seção da página tem estado de erro e botão de tentar de novo.
  - Se a verificação de permissões falha, a tela mostra "não foi possível verificar", não "sem acesso".
  - O formulário de senha fica desligado pela flag e nenhum caminho dele leva a logout.
- **Migration 0072.** São 11 `CREATE INDEX IF NOT EXISTS`, idempotente, com rollback fora do runner.
  O build copia os `.sql` para `dist/`.
- **Números.** A equivalência read-only contra produção comparou 350 valores (7 semanas, 6 atores)
  e encontrou 0 divergências contra `metricas_ciclo()`.
- **Desempenho.** O EXPLAIN em produção dá cerca de 0,5 ms por consulta, com volume de centenas de linhas.

## Top 5 riscos

1. **As leituras do perfil não têm `statement_timeout`.** O pool tem 5 conexões, compartilhadas
   com as escritas, e abrir `/perfil` pode disparar até 5 consultas simultâneas
   (`availability-1`, `performance-2`).
2. **`next` tem advisory crítico** (1 critical e 7 high no `npm audit` do frontend). É anterior a
   esta feature e está fora do delta (`security-1`).
3. **O contrato entre front e back não tem fonte única nem teste.** O front faz
   `res.json() as T`, redeclara cerca de 15 tipos à mão e não valida nenhuma das 3 respostas
   (`integrability-1`).
4. **A regra de KPI está escrita duas vezes**, em `AGREGADOS_SQL` e em `metricas_ciclo()`, sem
   guarda em CI. A paridade hoje só é provada pelo job manual (`modifiability-1`).
5. **O contrato de `POST /me/senha` foi assumido sem o backend existir.** A flag está desligada,
   mas é preciso fixar o contrato antes de ligá-la (`integrability-2`).

## Cards

| Prioridade | Quantidade |
|-----------|-----------:|
| P0 | 0 |
| P1 | 0 |
| P2 | 13 |
| P3 | 9 |

São 25 cards de origem e 22 depois de deduplicar. Três cards de fault-tolerance foram fundidos
em `availability-1`, `availability-3` e `deployability-1`.

## Próxima ação sugerida

Para os próximos 30 dias: `statement_timeout` nas leituras, atualização do `next`, e guardas de
contrato e de paridade de KPI no CI. A flag de senha não deve ser ligada antes de o contrato ser
fixado com o backend da `feat/auth-senha-propria`.
