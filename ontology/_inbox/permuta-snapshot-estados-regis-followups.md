# Follow-ups da Regis-Review — `permuta-snapshot-estados`

**Run:** `2026-09-08-2011-permuta-snapshot-estados`
**Relatório:** `docs/regis-review/2026-09-08-2011-permuta-snapshot-estados/REPORT.md`
**Kanban:** `docs/regis-review/2026-09-08-2011-permuta-snapshot-estados/KANBAN.md`
**Score geral:** 7,2/10 · **P0 = 0** (gate passou sem sub-loop de remediação)
**Cards:** 30 (0 P0 · 7 P1 · 16 P2 · 7 P3), consolidados de 41 brutos em 8 clusters cross-QA.

> Pela regra do pipeline, **só P0 re-entra no loop**. Como não houve nenhum, nada foi remediado
> por obrigação. Dois P1 de esforço S foram implementados **por decisão do Yuri** (2026-09-08),
> por serem baratos e por a 0054 ser justamente a migration que iria a produção sem eles.
> Todo o resto abaixo é backlog, não dívida deste PR.

## Implementados NESTE PR (não são follow-up)

| Card | Prioridade | O que foi feito |
|---|---|---|
| `rollback-0054` | P1 / S | `src/backend/migrations/rollbacks/0054_estado_ja_permutado.rollback.sql` + `rollbacks/README.md` com a política. Verificado em PG 17: reverse correto, **idempotente** (hashes idênticos em 2 execuções) e **ida-e-volta é identidade** (0054 → reverse → 0054 devolve o estado original linha a linha). |
| `lock-timeout-not-valid` | P1 / S | `SET LOCAL lock_timeout='30s'` + `statement_timeout='10min'` prefixados a toda migration no `MigrationRunner`; 0054 passa a usar `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` pós-backfill (lock SHARE UPDATE EXCLUSIVE em vez de ACCESS EXCLUSIVE). |
| — | — | **Bônus não catalogado:** `migrations/rollbacks.test.ts` (4 guardas). O runner faz `readdirSync(...).filter(f => f.endsWith('.sql'))` e **não é recursivo** — um reverse salvo solto em `migrations/` seria aplicado no boot seguinte e desfaria a migration que acabou de subir, registrando-se em `schema_migrations` como passo para a frente. O teste impede isso e também falha se alguém acrescentar `SET motivo_bloqueio` à 0054, que é o que torna o reverse reconstruível. |

## P1 — abertos (sprint 1 pós-merge)

| Card | Esforço | Problema em uma linha |
|---|---|---|
| `rollback-assimetrico` | M | A CHECK nova **aceita** o comportamento antigo: reverter o backend sem reverter a 0054 faz ~80 linhas de `ja-permutado` voltarem a `bloqueada` na primeira ingestão, sem violação de constraint e sem log. Proposta: TRIGGER que rejeite o combo antigo. **É o risco não mitigado deste delta.** |
| `taxonomia-fonte-unica` | M | A lista de estados vive em 6 representações TS paralelas. Este ciclo tocou ~10 arquivos para adicionar 1 estado. |
| `assertNever-propagacao` | M | Exaustividade checada pelo compilador existe em **1 de ~20** sítios que despacham sobre `EstadoElegibilidade` (5%). O sítio corrigido foi o que quebrou; os vizinhos seguem silenciando — mesma classe de defeito que este ciclo corrige. |
| `migration-test-harness` | L | A 0054 (227 LOC, 152k linhas) não tem teste automatizado. A validação foi manual, em container, e não é reexecutável por quem vier depois. |
| `view-compat-snapshot` | S | `COMMENT ON COLUMN` / view de compat para leitores externos: quem filtra `WHERE status='bloqueada'` fora da aplicação vê o número cair sem sinal de que a semântica mudou. |

## P2 e P3

16 cards P2 e 7 P3 no `KANBAN.md`. Os que valem menção porque são **pré-existentes que este ciclo tornou visíveis**:

- **`rbac-gestao-adr` (P2)** — `GET /permutas/gestao` não tem `requireRole`: qualquer autenticado lê a projeção inteira do domínio, com `pesCod`, importador e valores. Não é regressão deste PR; é que agora existe um teste que **afirma** o comportamento por escrito. Precisa virar ADR ou virar role.
- **`metricas-camelcase` (P2)** — as chaves `'casamento manual'`, `'permuta manual'`, `'já permutado'` (com espaço e acento) em `JobRunReadModel`. **Dívida consciente**, não descuido: decisão do Yuri para não tocar `src/frontend/` e não acionar o DesignSystemReviewer neste ciclo. O custo é real — é apresentação dentro do contrato HTTP, inacessível por notação de ponto.
- **`lint-not-tobe` (P3)** — a sonda de RBAC que estava oca (`.not.toBe(403)` passando por um 500) foi corrigida, e a varredura mostrou **0 ocorrências vivas** do anti-padrão no resto do repo. Falta a regra de CI que impeça a reintrodução.
- **`predeploy-doc` (P3)** — `render.yaml`, `DEPLOY.md` e a docstring do `BootMigrator` discordam sobre quem roda as migrations. Três fontes, uma verdade.

## Nota de calibragem para quem for pegar estes cards

O relatório mede o risco da 0054 corretamente **depois** de duas medições que eu fiz em produção e que os agentes não tinham no início: Postgres **17.6** e tabela de **22 MB** / 152.516 linhas com índice em `(run_id)`. Não trate os cards de volume como urgentes — o risco da 0054 é de **corretude e ordem de deploy**, não de janela de lock.

E **não** pegue nenhum card propondo tirar a migration do caminho do boot sem antes ler `src/backend/index.ts:147-158`: aquilo é mitigação deliberada, adotada depois do incidente de 2026-08-10 em que o código da ADR-0032 chegou a produção antes da migration 0044. O `preDeployCommand` do Render é indisponível no plano atual. Desfazer aquilo troca um risco mitigado por um já materializado.
