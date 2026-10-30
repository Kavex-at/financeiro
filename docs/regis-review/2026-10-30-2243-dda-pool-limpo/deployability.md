---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-deployability
generated_at: 2026-10-30T22:50:00-03:00
scope: backend+frontend (diff não commitado)
score: 6
findings_count: 5
cards_count: 5
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev faz merge do PR `dda-pool-limpo` em `main` | Push dispara dois caminhos independentes: Render builda o backend (Express `src/backend`) e Vercel builda o frontend (Next.js `src/frontend`) a partir do mesmo commit; não há orquestração | API `GET /sispag/boletos-dda` (contrato `BoletoDdaConsolidado`) + consumidores no frontend (`TabelaBoletosDda`, `CardsBoletosDda`, `rotulosDda`, `filtrosBoletosDda`) | Produção; usuário com a aba `Boletos DDA` aberta durante a janela de deploy | Novas situações (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`), novos campos (`arquivos`, `copias`, `titulosSaidos`) e novas chaves de `contagem`/`totais` devem ser servidas e consumidas sem UI quebrada em nenhum lado da defasagem FE↔BE; rollback deve ser revert simples (sem schema change) | Janela de incompatibilidade FE/BE ≤ 2 min; 0 erros de ordenação/render com `undefined` em `ORDEM_SITUACAO`/`rotulos`; rollback em 1 revert + 1 redeploy por lado (≤ 10 min) |

> Observação: o template-mãe assume Lambda+Terraform multi-tenant; aqui o estado atual é Express no Render + Next.js na Vercel, sem `infra/`, sem Terraform, sem tenants provisionados (ver CLAUDE.md §Estado Atual vs. Alvo). Toda métrica Terraform/Lambda deste QA é **não medível** neste repo.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados commit→prd (lint/typecheck/test/build/audit) | 5 (backend) + 3 (frontend) | ≥5 em cada | ✅ | `.github/workflows/ci.yml` |
| `terraform plan` gating `apply` | N/A (sem Terraform) | N/A | N/A | `ls infra` → inexistente |
| Rollback: ausência de migration no diff | 0 migrations tocadas | 0 (ou migration reversível) | ✅ | `git diff --stat HEAD` — nenhum `migrations/*.sql` |
| Feature flag gatando as novas situações `FORA_JANELA`/`TITULO_SAIU_CARTEIRA` | Ausente — ligadas por padrão | Flag em `EnvironmentProvider` ou kill-switch no FE | ❌ | `ConsolidacaoBoletoDda.ts:situacaoLivre` — chamada incondicional |
| Contract test FE↔BE do enum `BoletoDdaSituacao` | Ausente — duas uniões string duplicadas | 1 teste que falha se os dois conjuntos divergirem | ❌ | `src/backend/.../BoletoDda.ts:60-67` vs `src/frontend/lib/sispag.ts:1675-1681` |
| Novo campo obrigatório no contrato (`arquivos: number`) sem default | 1 campo (`BoletoDdaConsolidado.arquivos`) não-opcional em ambos os lados | 0 campos obrigatórios novos durante janela de rolling deploy; introduzir como opcional primeiro | ⚠️ | `BoletoDda.ts:116` + `src/frontend/lib/sispag.ts:1715` |
| Novas chaves em `contagem`/`totais` (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`) | 2 chaves novas em cada estrutura | FE tolera chaves faltantes (fallback 0) | ⚠️ | `PaginacaoBoletoDda.ts:325-345` + `CardsBoletosDda.tsx:51-52` |
| Lockfile presente | `src/backend/package-lock.json` e `src/frontend/package-lock.json` presentes | presente | ✅ | `.github/workflows/ci.yml` usa `cache-dependency-path` |
| Rollout sequence dev→stg→prd | Ausente — Render/Vercel autodeployam de `main` | Sequência explícita | ⚠️ (fora do escopo deste PR, mas releva pro cenário) | `.github/workflows/` — sem job `deploy-*` |
| Deploy observability — release marker/log line distinto para a feature | Nenhum log específico anotando ocorrências de `FORA_JANELA`/`TITULO_SAIU_CARTEIRA` após deploy | ≥1 contador para verificar que a feature acendeu | ⚠️ | `BoletoDdaService.ts` / `ConsolidacaoBoletoDda.ts` — sem `logService.message` nas transições novas |

> ⚠️ **Não medíveis localmente**: tamanho de bundle Lambda, cold start, `terraform plan` time, drift Terraform — não aplicáveis (sem `infra/`). Tempo real de propagação Render↔Vercel exige CloudWatch/Datadog do deploy, não disponível neste worktree.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Script Deployment Commands | `npm run build` reprodutível com lockfile; CI roda typecheck+lint+test+build+audit | ✅ presente | `.github/workflows/ci.yml` |
| Scale Rollouts (canary/blue-green/rolling) | Render e Vercel autodeployam de `main` em paralelo, sem orquestração nem canary. O rolling é **efeito colateral**, não desenho: FE e BE ficam dessincronizados por alguns minutos a cada push | ⚠️ parcial | `.github/workflows/` sem job de deploy; ausência de staging ring |
| Rollback | Sem migration no diff; revert do commit basta. Nenhum procedimento documentado específico | ⚠️ parcial | `git diff --stat` sem `migrations/` |
| Logical Grouping | Backend (`src/backend/`) e Frontend (`src/frontend/`) separados; contrato em `interface/sispag/BoletoDda.ts` duplicado manualmente em `frontend/lib/sispag.ts` | ⚠️ parcial | `src/frontend/lib/sispag.ts:1673-1721` espelha backend |
| Physical Grouping | FE e BE deployam em plataformas distintas (Render / Vercel). Deploy skew é inerente | ⚠️ parcial (desenho) | CLAUDE.md §Estado Atual |
| Package Dependencies | Lockfiles comitados em `src/backend/` e `src/frontend/`; `npm audit --omit=dev` no CI | ✅ presente | `ci.yml:24` |
| Surge Protection | N/A — Express/Render não tem throttling de deploy; não há tráfego de sinal relevante disparado por esta feature | N/A | — |
| Idempotent deploys | Deploys do Render são idempotentes (rebuild from commit); nada no diff quebra isso | ✅ presente | — |
| Drift detection (IaC) | N/A — sem IaC | N/A | `ls infra` → inexistente |
| Reproducible builds | Node 24 fixado no CI; lockfile; `tsc` + `esbuild` determinísticos; `migrations/*.sql` copiados pelo build (ADR do incidente 2026-09-23) | ✅ presente | `ci.yml:17-18`, DEPLOY.md referido pelo CLAUDE.md |
| Per-tenant blast radius | N/A — tenant único hoje (sem Terraform) | N/A | CLAUDE.md §Tenants |
| Deployment observability | Sem log/métrica específica para a feature; sem release marker | ❌ ausente | `ConsolidacaoBoletoDda.ts` — nenhum `logService` referenciando novas situações |
| Feature flag / dark launch | Nenhum gating. As novas situações, campos e colapso por `codbar` entram ligados a partir do primeiro boot | ❌ ausente | `BoletoDdaService.consolidar` — comportamento incondicional |

## 4. Findings (achados)

### F-deployability-1: Rolling deploy FE↔BE expõe UI ao enum novo sem fallback

- **Severidade**: P1
- **Tactic violada**: Scale Rollouts (versionamento de contrato), Logical Grouping (fonte única do enum)
- **Localização**: `src/backend/domain/interface/sispag/BoletoDda.ts:60-67` + `src/frontend/lib/sispag.ts:1675-1681` + `src/frontend/app/sispag/boletos-dda/TabelaBoletosDda.tsx:40-50` + `src/frontend/app/sispag/boletos-dda/rotulosDda.ts:21-32` + `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:159-164`
- **Evidência (objetiva)**:
  ```ts
  // backend
  export const BOLETO_DDA_SITUACAO = { VINCULADO, CANDIDATO, AMBIGUO,
      FORA_JANELA, TITULO_SAIU_CARTEIRA, SEM_TITULO } as const;
  // frontend duplicado
  export type BoletoDdaSituacao = 'VINCULADO'|'CANDIDATO'|'AMBIGUO'
      |'FORA_JANELA'|'TITULO_SAIU_CARTEIRA'|'SEM_TITULO'
  ```
  Render e Vercel autodeployam o mesmo commit em pipelines independentes; durante a janela de defasagem o backend novo pode servir `FORA_JANELA`/`TITULO_SAIU_CARTEIRA` ao frontend antigo, onde `ORDEM_SITUACAO[sit]` retorna `undefined` (ordenação instável), `rotulos[sit]` renderiza "undefined" na tabela, e a chip do filtro perde a situação.
- **Impacto técnico**: por minutos após o deploy, a aba "Boletos DDA" apresenta linhas sem rótulo, ordem inconsistente, e o `contagem.todas`/`totais.todas` do FE antigo não bate com o do BE (que agora exclui `TITULO_SAIU_CARTEIRA` do `todas`).
- **Impacto de negócio**: operador do financeiro (analista Columbia) vê números inconsistentes no painel do SISPAG — perda de confiança no número de "boletos a conferir" exatamente na janela em que o Yuri costuma validar o deploy.
- **Métrica de baseline**: 2 valores novos no enum (33% de crescimento sobre os 4 anteriores) e 2 chaves novas em `contagem`/`totais`, sem contract test que falhe quando as duas uniões divergem.

### F-deployability-2: Novo campo obrigatório `arquivos: number` sem backward compat

- **Severidade**: P2
- **Tactic violada**: Scale Rollouts (contrato aditivo deve ser opcional durante rollout)
- **Localização**: `src/backend/domain/interface/sispag/BoletoDda.ts:116` + `src/frontend/lib/sispag.ts:1715` + `src/frontend/app/sispag/boletos-dda/TabelaBoletosDda.tsx:316`
- **Evidência (objetiva)**:
  ```ts
  export interface BoletoDdaConsolidado { /* ... */ arquivos: number; /* ... */ }
  // consumidor
  {b.arquivos > 1 ? ` · em ${b.arquivos} arquivos` : ''}
  ```
  Se o FE novo bate em um backend ainda não deployado (ordem Vercel→Render), `b.arquivos` chega `undefined` — `undefined > 1 === false` evita crash, mas a tipagem `: number` promete o campo e qualquer leitor que faça cálculo (`sum`, filtros numéricos futuros) renderiza `NaN`.
- **Impacto técnico**: contrato declara obrigatório o que o runtime pode servir undefined durante rolling deploy; typecheck esconde o problema.
- **Impacto de negócio**: baixo hoje (só vira texto); mas a mesma classe de bug reaparecerá em qualquer leitor novo que não tolere undefined.
- **Métrica de baseline**: 1 campo novo obrigatório; 1 ponto de uso no FE (`TabelaBoletosDda.tsx:316`); 0 default documentado.

### F-deployability-3: Nenhum feature flag / kill switch para rollback rápido

- **Severidade**: P2
- **Tactic violada**: Rollback (dark launch / kill switch)
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:133-158`, `ConsolidacaoBoletoDda.ts:consolidar`
- **Evidência (objetiva)**: `BoletoDdaService.consolidar` sempre chama `listInativosRecentes` e `colapsarCopias`; não há flag `EnvironmentProvider` nem query param que permita desligar a nova classificação sem redeploy. Rollback = revert do commit + rebuild Render + rebuild Vercel.
- **Impacto técnico**: incidente só mitiga por revert; tempo de rollback = tempo do pior build (~5–8 min Render) + propagação Vercel.
- **Impacto de negócio**: janela de exposição a bug derivado desta mudança > 10 min antes do kill-switch funcionar, se um bug aparecer em prd.
- **Métrica de baseline**: 0 flags gatando a nova regra; 1 query extra (`listInativosRecentes`) sempre executada; MTTR estimado 10–15 min (vs. ≤2 min com flag).

### F-deployability-4: Contrato FE↔BE duplicado sem contract test

- **Severidade**: P2
- **Tactic violada**: Logical Grouping (shared type / codegen); Package Dependencies (fonte única)
- **Localização**: `src/backend/domain/interface/sispag/BoletoDda.ts` ↔ `src/frontend/lib/sispag.ts:1673-1764`
- **Evidência (objetiva)**: as duas interfaces/enums são escritas à mão em dois arquivos. Nada no CI falha se uma delas sair de sincronia. O próprio diff adiciona 5 chaves (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`, `arquivos`, `copias`, `titulosSaidos`) em ambos; qualquer esquecimento futuro passa typecheck em cada repo e explode em runtime.
- **Impacto técnico**: cada feature desta aba carrega o mesmo risco; a defasagem FE/BE acima (F-deployability-1) é um sintoma, não a causa.
- **Impacto de negócio**: tempo de debug repetido a cada ciclo; risco de incidente silencioso.
- **Métrica de baseline**: 1 duplicação de contrato (23 campos em `BoletoDdaConsolidado` espelhados manualmente); 0 contract tests.

### F-deployability-5: Sem sinal observável de que a feature está rodando pós-deploy

- **Severidade**: P3
- **Tactic violada**: Deployment observability
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts`, `BoletoDdaService.ts`
- **Evidência (objetiva)**: a emissão das novas situações não vai pro `LogService`. Não há `logService.message('TITULO_SAIU_CARTEIRA emitido', { count })` nem contador; o único sinal é a UI do analista.
- **Impacto técnico**: pós-deploy, ninguém sabe se a nova classificação acendeu até alguém abrir a aba — e se o Postgres degradou com `listInativosRecentes`, só descobre quando a página demora.
- **Impacto de negócio**: baixo — mas gratuito de adicionar e esconde regressão.
- **Métrica de baseline**: 0 contadores pós-deploy; 0 release markers no log.

## 5. Cards Kanban

### [deployability-1] Blindar a UI contra enum `BoletoDdaSituacao` desconhecido

- **Problema**
  > O enum `BoletoDdaSituacao` ganhou dois valores novos (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`) e vive duplicado entre `src/backend/domain/interface/sispag/BoletoDda.ts` e `src/frontend/lib/sispag.ts`. Durante a janela de rolling deploy (Render ≠ Vercel), o backend novo pode servir esses valores ao frontend antigo. `ORDEM_SITUACAO`, `rotulos` e os cards no FE antigo não conhecem as novas chaves — a tabela renderiza "undefined" e a ordenação fica instável.

- **Melhoria Proposta**
  > Tornar o FE tolerante a enum desconhecido (defaults em `ORDEM_SITUACAO`/`rotulosDda`/`filtrosBoletosDda`) e explicitar na review que **mudanças de enum são aditivas-com-fallback**: FE merge/deploy obrigatoriamente **antes** do BE para situações novas, ou um fallback canônico ("SEM_TITULO" ou "Outro") para unknown. Scale Rollouts via ordem de deploy documentada no `DEPLOY.md`.

- **Resultado Esperado**
  > FE antigo tolera `BoletoDdaSituacao` desconhecida (zera totais, usa rótulo "—", ordem = última). Nenhuma linha "undefined" na tabela durante rolling deploy.

- **Tactic alvo**: Scale Rollouts + Logical Grouping
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1, F-deployability-4
- **Métricas de sucesso**:
  - Linhas renderizando `undefined` em `rotulos[sit]` durante janela de deploy: 1+ possível → 0
  - Contract test que falha quando os dois enums divergem: 0 → 1
- **Risco de não fazer**: a cada feature nova da aba, o analista financeiro vê UI quebrada no minuto do deploy; perda de confiança no painel.
- **Dependências**: nenhuma.

### [deployability-2] Introduzir `arquivos` como opcional + default no FE

- **Problema**
  > `BoletoDdaConsolidado.arquivos: number` é obrigatório em ambos os lados do contrato. Se o FE novo deploy antes do BE (ordem comum: Vercel builda em <1 min, Render em 5–8 min), o FE recebe `arquivos === undefined` — tipagem mente, e qualquer uso aritmético futuro produz `NaN`.

- **Melhoria Proposta**
  > Marcar `arquivos?: number` em ambos os lados por **um release** até o backend estar em prd, com fallback `arquivos ?? 1` nos consumidores (`TabelaBoletosDda.tsx:316`); num release seguinte promover a obrigatório. Mesma receita para `copias`/`titulosSaidos` (já opcionais — OK).

- **Resultado Esperado**
  > Rolling deploy em qualquer ordem (FE→BE ou BE→FE) não produz `undefined`/`NaN` na tabela.

- **Tactic alvo**: Scale Rollouts (contrato aditivo em duas etapas)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Campos obrigatórios novos durante janela de deploy: 1 → 0
- **Risco de não fazer**: o próximo campo numérico novo repetirá o padrão e eventualmente alguém somará `NaN` numa linha do painel.
- **Dependências**: nenhuma.

### [deployability-3] Feature flag para desligar o pool consolidado DDA sem revert

- **Problema**
  > Não há flag em `EnvironmentProvider` que desligue o colapso por `codbar`, a classificação em `FORA_JANELA` / `TITULO_SAIU_CARTEIRA`, ou a leitura de `listInativosRecentes`. Rollback de um bug só por `git revert + redeploy duplo` (≥10 min).

- **Melhoria Proposta**
  > Introduzir `SISPAG_DDA_POOL_LIMPO_ENABLED` em `EnvironmentProvider`. Em `BoletoDdaService.consolidar`: quando desligado, pular `listInativosRecentes` e cair no comportamento legado (sem `copias`, sem `FORA_JANELA`, sem `TITULO_SAIU_CARTEIRA`). Documentar kill-switch no `DEPLOY.md`. Alinhado ao padrão já usado para `SISPAG_LIVE_WRITE_ENABLED` / `SISPAG_BIND_CODBAR_FILIAIS`.

- **Resultado Esperado**
  > MTTR de rollback cai de ~10 min para ≤2 min (toggle de env no Render + restart).

- **Tactic alvo**: Rollback / Dark Launch
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - MTTR de rollback: ~10 min → ≤2 min
  - Flags gatando a nova classificação: 0 → 1
- **Risco de não fazer**: um bug na `listInativosRecentes` em prd (índice ruim, carteira grande em cliente novo) só sai do ar com rebuild duplo.
- **Dependências**: nenhuma.

### [deployability-4] Fonte única de contrato (ou contract test) para `BoletoDda*`

- **Problema**
  > Backend e frontend duplicam manualmente ~25 campos do contrato `BoletoDdaConsolidado`. Este diff já teve que mexer em ambos; nada no CI falha se alguém esquecer um lado.

- **Melhoria Proposta**
  > Opção A: extrair os tipos públicos para um pacote compartilhado (`src/shared/sispag-boleto-dda.ts` importado pelos dois). Opção B (mais barata): script `scripts/check-contract.mjs` no CI que compara chaves e enum values entre os dois arquivos e falha se divergirem. Alvo tactic: Logical Grouping da definição de dados.

- **Resultado Esperado**
  > Enum / interface fora de sincronia: typecheck ou CI falha antes do merge.

- **Tactic alvo**: Logical Grouping / Package Dependencies
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-1, F-deployability-4
- **Métricas de sucesso**:
  - Contract tests FE↔BE: 0 → ≥1
  - Divergências de enum passando no CI: possível → impossível
- **Risco de não fazer**: cada feature nova nessa aba carrega 20% de chance de ter um lado esquecido; o PR de hoje é a melhor hora para blindar.
- **Dependências**: nenhuma.

### [deployability-5] Release marker + contador para novas situações

- **Problema**
  > Nenhum `logService.message` registra ocorrências de `FORA_JANELA` / `TITULO_SAIU_CARTEIRA` nem a quantidade de `copias` colapsadas. Pós-deploy, não há sinal de que a feature está viva.

- **Melhoria Proposta**
  > Em `BoletoDdaService.listar`, emitir um `logService.message('boletos dda consolidado', { counts: contagem })` por chamada. Permite monitorar via log do Render se a nova classificação está acendendo e dimensionar o custo da `listInativosRecentes` em prd.

- **Resultado Esperado**
  > Grep nos logs do Render responde em segundos "quantos boletos saíram da carteira hoje?".

- **Tactic alvo**: Deployment observability
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Contadores pós-deploy: 0 → ≥1
- **Risco de não fazer**: regressão silenciosa até o Yuri abrir a aba.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao diff não commitado (feature `dda-pool-limpo`); todas as métricas de Lambda/Terraform/tenant foram marcadas N/A — este repo roda Express+Render+Vercel (ver CLAUDE.md §Estado Atual vs. Alvo).
- Métricas de bundle Lambda e drift não medidas por deliberação de escopo (`--quick`/sem `infra/`).
- Cross-QA: F-deployability-1 e F-deployability-4 têm sobreposição direta com **Modifiability** (duplicação de contrato) e **Testability** (ausência de contract test). F-deployability-3 toca **Fault-Tolerance** (sem kill switch). F-deployability-5 cruza com **Availability** (sem sinal pós-deploy). Consolidator: evitar carda duplicado nesses eixos.
