# Shared metrics — run 2026-09-08-2011 (delta permuta-snapshot-estados)

Escopo: DELTA da branch `fix/permuta-snapshot-estados` vs `origin/main` (dc994c8). Modo: --quick.
Worktree: /home/inteli/kavex-worktrees/permuta-snapshot-estados

## Delta da branch (o objeto da review)
```
 CHANGELOG.md                                       |  45 +++++
 ontology/_coverage.json                            |  26 ++-
 ontology/_inbox/_watchlist.md                      |  20 ++
 ontology/_index.json                               |  39 +++-
 ontology/_provenance.json                          |  12 +-
 ontology/actions/avaliar-elegibilidade.md          |   9 +-
 ontology/actions/expor-no-painel.md                |   8 +-
 ontology/business-rules/elegibilidade-permuta.md   |  28 ++-
 ontology/entities/job-run.md                       |   2 +-
 ontology/entities/permuta-candidata.md             |  22 +-
 ontology/glossary.md                               |   1 +
 .../elegibilidade-permuta-candidata.md             |  78 +++++--
 .../interface/permutas/EstadoElegibilidade.ts      |  17 ++
 .../permutas/PermutaRelationalRepository.test.ts   |  54 +++++
 .../permutas/PermutaRelationalRepository.ts        |  75 +++++--
 .../permutas/PermutaSnapshotRepository.test.ts     | 224 +++++++++++++++++++++
 .../permutas/PermutaSnapshotRepository.ts          |  94 ++++++++-
 .../service/operacao/JobRunReadModel.test.ts       |  14 +-
 .../domain/service/operacao/JobRunReadModel.ts     |  14 ++
 .../service/permutas/ElegibilidadeService.test.ts  |  35 +++-
 .../service/permutas/ElegibilidadeService.ts       |  21 +-
 .../permutas/EleicaoPermutasService.test.ts        | 216 +++++++++++++++++++-
 .../service/permutas/EleicaoPermutasService.ts     | 108 ++++++----
 .../service/permutas/GestaoPermutasService.test.ts |  39 +++-
 .../service/permutas/GestaoPermutasService.ts      |  36 ++--
 .../permutas/IngestaoPermutasService.test.ts       |  42 ++++
 .../service/permutas/IngestaoPermutasService.ts    |  38 +++-
 .../domain/service/permutas/PainelService.test.ts  |  77 -------
 .../domain/service/permutas/PainelService.ts       |  91 ---------
 src/backend/jobs/probe-impacto-narrativa.ts        |  23 ++-
 src/backend/jobs/probe-impacto-verificacao.ts      |  55 ++++-
 src/backend/routes/permutas.test.ts                |  89 +++-----
 src/backend/routes/permutas.ts                     |  17 +-
 33 files changed, 1265 insertions(+), 404 deletions(-)
```

### Arquivos novos (untracked, fazem parte do delta)
```
?? docs/regis-review/2026-09-08-2011-permuta-snapshot-estados/
?? ontology/_inbox/permuta-snapshot-estados-tasks.md
?? ontology/business-rules/fidelidade-snapshot-eleicao.md
?? ontology/decisions/0043-ja-permutado-e-fidelidade-do-snapshot-de-eleicao.md
?? src/backend/migrations/0054_estado_ja_permutado.sql
```

### Arquivos removidos
```
D  src/backend/domain/service/permutas/PainelService.test.ts
D  src/backend/domain/service/permutas/PainelService.ts
```

## Baseline do repo

| Métrica | Valor |
|---|---|
| Backend LOC (não-teste) | 52017 |
| Backend arquivos de teste | 136 |
| Frontend LOC (não-teste) | 18498 |
| Frontend arquivos de teste | 26 |
| Módulos Terraform | ⚠️ Não medível: `infra/` não existe neste repo (deploy via Render hook) |
| Tenants provisionados | ⚠️ Não medível: sem `infra/tenants-vars/` |
| Migrations SQL | 55 |

## Gates verificados de forma independente (2026-09-08 20:11 UTC)

| Gate | Resultado |
|---|---|
| `npm run typecheck` (src/backend) | ✅ exit 0, sem saída |
| `npm run lint` (Biome) | ✅ sem erros — 66 warnings, todos pré-existentes (complexidade cognitiva em legado); 445 arquivos |
| `npm test` (src/backend) | ✅ 122 suítes / **1745 testes** passando (baseline origin/main: 1723 → +22) |
| `src/frontend/` no diff | ✅ nenhum arquivo — DesignSystemReviewer não acionado |
| Cobertura (`--coverage`) | ⚠️ Não coletada: modo `--quick` |
| `npm audit` | ⚠️ Não coletado: modo `--quick` |
| `terraform plan` | ⚠️ Não medível: não há `infra/` |

## Contexto normativo do delta (leitura obrigatória para os agents)

- `ontology/decisions/0043-ja-permutado-e-fidelidade-do-snapshot-de-eleicao.md` — ADR aprovado pelo Yuri
- `ontology/business-rules/fidelidade-snapshot-eleicao.md` — invariante I5 que o ciclo instala
- `ontology/state-machines/elegibilidade-permuta-candidata.md` — estado JA_PERMUTADO, transição T6
- `ontology/_inbox/permuta-snapshot-estados-tasks.md` — 13 tasks, 101 acceptance criteria

### O que o delta faz

Corrige um bug de PROJEÇÃO: `permuta_candidata_snapshot.status` era binário
(`CHECK IN ('elegivel','bloqueada')`, migration 0001) enquanto o domínio tem 5 estados de
elegibilidade. Três estados eram achatados em `bloqueada` por catch-alls na escrita
(`PermutaSnapshotRepository.insertCandidataChunk`), na leitura (`mapSnapshotRow`) e na
ingestão relacional (`IngestaoPermutasService.toEstadoRow`, `default: 'descoberta'`).
Medido em PRD: header da run dizia 329 bloqueadas, snapshot da MESMA run dizia 677 (2,06×).
Passivo externo real 249 → inflação de 2,72×. Além disso `ja-permutado` foi promovido de
`bloqueada`+motivo a estado de domínio de primeira classe.

### Pontos de atenção que os agents devem olhar com rigor

1. **`migrations/0054_estado_ja_permutado.sql` (227 linhas)** — o artefato de maior risco.
   Backfill de **152.516 linhas / 250 runs** em produção, com asserção que aborta
   (`RAISE EXCEPTION`) se o mapeamento por motivo divergir do que o header já gravava.
   Reescreve `total_bloqueadas` histórico (64.893 → 51.459). Avaliar: idempotência,
   comportamento em re-execução, rollback, janela de lock, ausência de backup/rollback script.
2. **Quebra de série temporal** — KPIs históricos de 'bloqueadas' mudam de significado.
3. **Remoção de `GET /permutas/painel` + `PainelService`** — endpoint público removido.
   Verificar se a asserção de RBAC que vivia nesse teste foi de fato substituída por uma real.
4. **Convergência header↔snapshot por construção** — verificar se é realmente uma fonte só
   ou dois caminhos que por acaso coincidem.

## Medições em PRODUÇÃO (read-only, 2026-09-08 ~20:15 UTC) — adicionadas após o fan-out

| Fato | Valor | Por que importa |
|---|---|---|
| Versão do Postgres | **17.6** | `ADD COLUMN NOT NULL DEFAULT` é metadata-only desde o PG11 → as 3 colunas novas de `permuta_eleicao_run` NÃO reescrevem a tabela |
| `permuta_candidata_snapshot` — total | **22 MB** (heap 17 MB) | a tabela é pequena; o full scan do `ALTER TABLE ... ADD CONSTRAINT CHECK` é sobre 17 MB, não sobre um monstro |
| `permuta_candidata_snapshot` — linhas | **152.516** | confere com o universo do backfill |
| Índice `idx_permuta_candidata_snapshot_run` em (run_id) | **existe** (migration 0001) | serve os `GROUP BY run_id` da asserção e do backfill do header |
| Índices presentes | `permuta_candidata_snapshot_pkey`, `idx_permuta_candidata_snapshot_run`, `permuta_eleicao_run_pkey`, `idx_permuta_eleicao_run_status_finished` | |

> **Leitura:** a medição local de 2,6 s para 152.500 linhas é plausível em produção —
> o volume é de 22 MB, não de gigabytes. O risco da 0054 é de **corretude e de ordem de
> deploy**, não de janela de lock. Agents de Performance e Availability: calibrem por isto.

## Contexto que o consolidator NÃO pode ignorar — o boot bloqueante é deliberado

`src/backend/index.ts:147-173` roda `await BootMigrator.run()` ANTES de `app.listen()`.
Isso é verdade e foi confirmado. **Mas não é descuido — é mitigação adotada após incidente.**
A docstring do próprio arquivo registra:

> "O `preDeployCommand` do `render.yaml` nunca rodou (serviço configurado pelo dashboard;
> pre-deploy é de plano pago), e em **2026-08-10 o código da ADR-0032 chegou a produção antes
> da `0044`** — chave natural nova contra banco velho. Aqui o `listen` é inalcançável enquanto
> houver migração pendente. (...) Falha ao migrar = processo morre com código 1. O Render marca
> o deploy como falho e MANTÉM a versão anterior no ar, que é o desfecho certo: melhor a release
> não subir do que subir servindo contra um esquema que ninguém sabe qual é."

**Consequências para a síntese:**

1. A janela "código novo + schema velho" está **estruturalmente impedida**. Qualquer finding
   que recomende tirar a migration do boot precisa responder ao incidente de 2026-08-10 e ao
   fato de que `preDeployCommand` é indisponível no plano atual do Render. **Não emita P0**
   pedindo para desfazer isso sem apresentar alternativa que cubra o mesmo risco.
2. A janela que **permanece aberta** é a inversa: **rollback de deploy sem rollback de
   migration** → código antigo + schema novo, reescrevendo `bloqueada` sobre dado já corrigido,
   em silêncio (a CHECK nova aceita `bloqueada`). Este é o risco real e não mitigado do delta.
3. O custo de boot é limitado pelo tamanho medido: 22 MB / 152.516 linhas, com índice em
   `(run_id)`. O risco é de **corretude e ordem de deploy**, não de janela de lock.
4. F-performance-5 ("versão do Postgres não declarada") — o repo de fato não declara, mas eu
   **medi em produção: PostgreSQL 17.6**. A premissa "metadata-only em PG≥11" está satisfeita
   de fato; o card sobre declarar a versão segue válido como dívida documental.
