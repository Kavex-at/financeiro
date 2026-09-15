---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-15-0207
agent: qa-modifiability
generated_at: 2026-09-15T02:35:00Z
scope: backend+frontend
score: 7.5
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review (delta `permutas-saldo-ordem-centavos`, --quick)

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Yuri / analista Columbia | Regra nova de tolerância monetária (ex.: passar R$1,00 → R$0,50 no gate; ou aplicar teto à INVOICE além do adiantamento) | Predicado do teto de resíduo (Gates 2 e 3), fórmula `saldoNeg = valorPermutar/taxa`, e a regra "não consumido pelo ERP" | Development-time, ciclo `/feature-tweak` em worktree dedicado, com validador AO VIVO obrigatório | 1 edição de constante em `ToleranciaResiduo.LIMITE_BRL` + 1 edição do `SaldoAlocacaoAdiantamentoService` propaga para elegibilidade, eleição, alocação, tela e âncora I-Write-6, sem gaps de convenção humana | Nº de arquivos a tocar por mudança de regra: **alvo 1–2 · atual 1** para o teto R$1,00, **atual 5** para o divisor `valorPermutar/taxa` (não extraído) |

O delta é um caso-livro de **Encapsulate** + **Abstract Common Services**: extraiu duas novas classes (`ToleranciaResiduo`, `SaldoAlocacaoAdiantamentoService`) que colapsam duplicações que já haviam gerado bugs. O único débito genuinamente introduzido pelo delta é a metade do divisor da mesma fórmula (`valorPermutar/taxa`) permanecer copiada em 5 serviços; o resto é hotspot pré-existente que o delta não piorou (e em 1 caso, melhorou).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Fan-in de `ToleranciaResiduo` (não-teste) | **5** callers backend (`ElegibilidadeService`, `EleicaoPermutasService`, `ReconciliacaoPermutaService`, `ConexosTitulosClient` [comentário/doc], `Adiantamento` [doc], `validate-*`) | ≥ 3 (elegibilidade, âncora, wire) | ✅ | `grep -rln "ToleranciaResiduo" src/backend --include="*.ts" \| grep -v test` |
| Fan-in de `SaldoAlocacaoAdiantamentoService` | **2** callers backend (`GestaoPermutasService`, `AlocacaoPermutasService`) — os 2 sítios da ADR-0046 D3 | 2 | ✅ | `grep -rln "SaldoAlocacaoAdiantamentoService" src/backend --include="*.ts" \| grep -v test` |
| Duplicação da fórmula `saldoNeg = valorPermutar/taxa` em services (não-teste) | **5 sítios** (`GestaoPermutasService.ts:262,365,586`; `AlocacaoPermutasService.ts:250,376`; `IngestaoPermutasService.ts:425`; `ReconciliacaoPermutaService.ts:899`) | 1 helper | ⚠️ | `grep -rn "valorPermutar\s*/" src/backend/domain/service \| grep -v test` |
| `sumByAdiantamento` (fonte do bug ADR-0046 D3) removido do repositório | **0 usos** — método substituído por `listByAdiantamento` + `SaldoAlocacaoAdiantamentoService.somaNaoConsumida*` | 0 | ✅ | `grep -rn "sumByAdiantamento" src/backend --include="*.ts"` |
| LOC dos serviços tocados — delta vs. `origin/main` | Gestao 588→**603** (+15); Alocacao 462→**467** (+5); Eleicao 1064→**1069** (+5); Elegibilidade 225→**233** (+8); page.tsx 1096→**1048** (-48) | serviços ≤ 600 LOC; page.tsx ≤ 800 | ⚠️ | `wc -l` vs `git show origin/main:` |
| LOC dos novos módulos | `SaldoAlocacaoAdiantamentoService.ts` **108**; `ToleranciaResiduo.ts` **50**; `historico.ts` (frontend) **121** | ≤ 200 cada (Bass — módulo pequeno e focado) | ✅ | `wc -l` |
| Cognitive-complexity de `GestaoPermutasService.toPendente` (Biome) | **46** (baseline 45, +1) | ≤ 15 | ❌ (crônico, +1 no delta) | swap in/out de `origin/main` file + `npx biome check` |
| Cognitive-complexity de `EleicaoPermutasService.hidratarInvoiceNegociada` (2ª função da CC ≥ 60) | **63** (baseline 65, -2) | ≤ 15 | ❌ (crônico, ↓2 pelo extract de `ToleranciaResiduo.adiantamentoTotalmentePago`) | idem |
| CC warnings em `permutas/service` (arquivos do delta) | **8 warnings** — 4 em Gestao (28/16/46/23) + 2 em Alocacao (23/28) + 2 em Eleicao (16/63) — Elegibilidade 0 | ≤ 8 no delta (não piorar) | ✅ (delta) / ⚠️ (crônico) | `npx biome check --max-diagnostics=100 domain/service/permutas/*.ts` |
| Repo-total warnings (baseline v0.36.4) | **73 warnings** (informado no `_shared-metrics.md` linha 98) | não piorar | ✅ | `_shared-metrics.md` |
| Convenções de código nos módulos novos (classes exportadas, arrow methods, modificadores explícitos) | `SaldoAlocacaoAdiantamentoService` ✅ `@injectable() @inject` + arrow public/private explícitos; `ToleranciaResiduo` ✅ classe com static `readonly` (arrow) — sem `!`, sem `function` no backend | 100% | ✅ | Read direto (linhas 19-50 e 42-49) |
| Cross-layer violations no delta (`routes → repository` / `service → sql` direto) | **0** — services só chamam repositórios; `SaldoAlocacaoAdiantamentoService` compõe 2 repos, sem SQL inline | 0 | ✅ | `grep -n "databaseClient\." src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts` (0 hits) |
| Circular deps no subgrafo delta | 0 (Alocacao → Saldo → {AlocacaoRepo, ExecucaoRepo}; Gestao → Saldo; sem ida-e-volta) | 0 | ✅ | Leitura dos imports |
| Externalização de constantes de negócio | `ToleranciaResiduo.LIMITE_BRL = 1` hard-coded no código; `SALDO_TOL = 1` em `format.ts` (frontend, USD); tolerâncias USD `+ 1` inline em `IngestaoPermutasService.ts:378` e `GestaoPermutasService.ts:273` e `+ 0.005` em `AlocacaoPermutasService.ts:256` | tolerâncias como constantes nomeadas em 1 lugar por moeda | ⚠️ | grep dos literais |
| Ontology `_index.json` / `_coverage.json` atualizados | ADR-0046 criada e referenciada; `_coverage.json` bumpado; `elegibilidade-permuta.md` e `avaliar-elegibilidade.md` refletem R$1,00 e prioridade | 100% acurado | ✅ | `git diff origin/main..HEAD -- ontology/` |
| Ground-truth Live executado (Conexos prod, read-only) | 247 linhas · 0 DIVERGENTE (`validate-permutas-saldo-ordem-centavos-v1.ts`, 736 LOC) | 0 DIVERGENTE | ✅ | `_shared-metrics.md` linha 86 |
| Rebase `main` sem conflitos | ✅ (feito antes do gate) | 0 conflitos pendentes | ✅ | `_shared-metrics.md` |

### Apêndice A — Módulos NOVOS deste delta (LOC + fan-in)

| Módulo (novo) | LOC | Callers (não-teste) | Comentário |
|---|---|---|---|
| `src/backend/domain/interface/permutas/ToleranciaResiduo.ts` | 50 | 5 (Elegibilidade, Eleicao, ReconciliacaoPermuta, doc em ConexosTitulosClient/Adiantamento, validate) | Encapsulate + Abstract Common Services — colapsa a tolerância R$1,00 dos gates 2/3 e da âncora I-Write-6 num único predicado |
| `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts` | 108 | 2 (GestaoPermutasService, AlocacaoPermutasService) | Encapsulate — regra ADR-0046 D3 ("não consumido pelo ERP") como fonte única; substitui o extinto `sumByAdiantamento` |
| `src/frontend/app/permutas/components/historico.ts` | 121 | 1 (page.tsx) | Split Module — extraiu ~85 LOC de lógica do page.tsx, permitindo cobertura isolada (273 LOC de teste) e liberando o page.tsx a 1048 LOC (baseline 1096) |

### Apêndice B — Arquivos EXISTENTES tocados pelo delta (LOC e CC)

| Arquivo | LOC pré | LOC pós | Δ | CC warnings (Biome) pré→pós | Nota |
|---|---|---|---|---|---|
| `src/backend/domain/service/permutas/GestaoPermutasService.ts` | 588 | **603** | +15 | `toPendente` 45→46 (+1); 4 warnings totais (28/16/46/23) | Crescimento tolerado; CC do `toPendente` marginalmente pior (novo `saldoRestante` via serviço injetado) |
| `src/backend/domain/service/permutas/EleicaoPermutasService.ts` | 1064 | **1069** | +5 | 65→63 na 2ª função (-2) | Extract de `ToleranciaResiduo` reduziu CC em -2 pontos; arquivo segue >1000 LOC (débito crônico, F-modifiability-4 do delta anterior — não re-raised) |
| `src/backend/domain/service/permutas/AlocacaoPermutasService.ts` | 462 | **467** | +5 | 23/28 (unchanged) | Troca de `sumByAdiantamento` por `SaldoAlocacaoAdiantamentoService` — mesma CC |
| `src/backend/domain/service/permutas/ElegibilidadeService.ts` | 225 | **233** | +8 | 0 (unchanged) | Uso de `ToleranciaResiduo.semSaldoPermutar` + reorganização de prioridade dos motivos |
| `src/frontend/app/permutas/page.tsx` | 1096 | **1048** | **-48** | n/a (não linted por complexidade backend) | Melhoria líquida — lógica de histórico extraída para módulo dedicado |

### Apêndice C — Fan-in (não-teste) dos serviços de `permutas/` (baseline v0.36.4)

| Serviço | Fan-in | Comentário |
|---|---|---|
| ReconciliacaoPermutaService | 2 | — |
| EleicaoPermutasService | 2 | Orquestrador — fan-in modesto |
| SaldoAlocacaoAdiantamentoService | 2 | Novo (Gestao + Alocacao) — atinge exatamente os 2 sítios que a ADR-0046 D3 pede |
| RelatorioExportService | 1 | — |
| ReconciliacaoLotePermutaService | 1 | — |
| IngestaoPermutasService | 1 | — |
| GestaoPermutasService | 1 | — |
| Todos os demais | 1 | — |

> ⚠️ **Não medível localmente**: fan-in dinâmico em produção (quantas requisições por rota tocam cada serviço). Requer traces (`Logger.info` já emite `type`/`data`) agregados em CloudWatch/Grafana — o painel Kavex-Ops (`/operacao`) ainda não expõe esse recorte. Recomendação: consolidar via `JobRunReadModel` quando as métricas de rota entrarem.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Aplicado no frontend: `montarHistorico` extraído de `page.tsx` (1096→1048 LOC, -48). Não aplicado a `EleicaoPermutasService` (1069 LOC, crônico — pré-existente, F-modifiability-4 do delta anterior, não re-raised). | ✅ (frontend) / ⚠️ (backend crônico) | `wc -l` page.tsx; `historico.ts:47` (nova função) |
| **Increase Semantic Coherence** | `SaldoAlocacaoAdiantamentoService` isola UMA responsabilidade — "quanto das alocações ainda NÃO foi abatido" — usada por 2 sítios; `ToleranciaResiduo` isola UMA responsabilidade — "resíduo ≤ R$1,00 é zero" — usada por 5 sítios. `historico.ts` isola a construção do histórico da tela. | ✅ presente | `SaldoAlocacaoAdiantamentoService.ts:42-108`; `ToleranciaResiduo.ts:19-50` |
| **Encapsulate** | Comparação em centavos (`Math.round(v*100)`) fica **dentro** de `ToleranciaResiduo.dentroDoLimite`; mudar unidade/precisão altera 1 linha. O predicado `adiantamentoTotalmentePago` encapsula o fallback `pago?` do wire. `SaldoAlocacaoAdiantamentoService.naoConsumido` encapsula a regra por-versão (execução ≥ `atualizado_em`) e a semântica de `parcial` (`min(valorResidualUsd, valorAlocado)`). | ✅ presente | `ToleranciaResiduo.ts:38-49`; `SaldoAlocacaoAdiantamentoService.ts:52-71` |
| **Use an Intermediary** | Repositórios continuam o único caminho serviço→SQL. `SaldoAlocacaoAdiantamentoService` compõe 2 repositórios sem tocar SQL: intermediário limpo. | ✅ presente | `SaldoAlocacaoAdiantamentoService.ts:44-49` (só injeta repos, zero SQL) |
| **Restrict Dependencies** | Fluxo `Elegibilidade/Eleicao → ToleranciaResiduo` unidirecional; `Gestao/Alocacao → Saldo → Alocacao/ExecucaoRepo` sem ciclo. `sumByAdiantamento` (fonte antiga do bug) removida — não é mais possível chamar a soma "burra" por engano. | ✅ presente | `grep -rn "sumByAdiantamento" src/backend --include="*.ts"` → 0 hits |
| **Refactor** | Refactor cirúrgico: `ElegibilidadeService.motivoDoGateFalho` reordenado para a prioridade ADR-0046 D2; `AlocacaoPermutasService.alocar` troca `alocacaoRepository.sumByAdiantamento` por `saldoAlocacaoService.somaNaoConsumidaDoAdiantamento`; `GestaoPermutasService.toPendente` usa `somaNaoConsumida` em vez do sum inline. Nenhum call site do bug antigo sobreviveu. | ✅ presente | `ElegibilidadeService.ts:164-183`; `AlocacaoPermutasService.ts:252-262`; `GestaoPermutasService.ts:363-371` |
| **Abstract Common Services** | Aplicado às duas metades do problema: o **predicado do resíduo** (`ToleranciaResiduo`) e a **regra de saldo consumido** (`SaldoAlocacaoAdiantamentoService`). ⚠️ NÃO aplicado à **outra metade da fórmula do saldo** — `saldoNeg = valorPermutar / taxa` continua copiado em 5 services (ver F-modifiability-1). | ⚠️ parcial | 2 classes novas ok; `grep -rn "valorPermutar\s*/\s*(taxa\|adto)" src/backend/domain/service` → 5 hits |
| **Defer Binding — polymorphism/DI** | `SaldoAlocacaoAdiantamentoService` é `@injectable()` e injetado nos dois consumidores via tsyringe; `ToleranciaResiduo` é classe utilitária de estáticos (aceitável — o predicado é matemática pura, sem estado). Nenhuma variabilidade em runtime, coerente com o padrão do repo. | ✅ presente | `SaldoAlocacaoAdiantamentoService.ts:42`; `AlocacaoPermutasService.ts:86-87` |
| **Defer Binding — configuration files** | `LIMITE_BRL = 1` é constante hard-coded no código; `SALDO_TOL = 1` no frontend também. Aceitável: mudar o teto é decisão que exige ADR + Ground-Truth Validation + backfill mental, então **redeploy é o binding time correto** (não seria seguro externalizar para SSM sem circuit-breaker). Documentado no próprio `ToleranciaResiduo.ts:20`. | ✅ presente (justificado) | `ToleranciaResiduo.ts:20-21`; ADR-0046 D1 (rejeitados: 0,10 e proporcional) |
| **Defer Binding — plugin/runtime registration** | N/A — domínio single-workflow (permuta cambial), não há espaço legítimo. | N/A | — |

## 4. Findings (achados)

### F-modifiability-1: fórmula `saldoNeg = valorPermutar / taxa` duplicada em 5 sítios de `service/`

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services (a ADR-0046 explicita "uma única fonte da regra"; a metade do "não consumido" foi extraída, a metade do divisor não)
- **Localização** (todas não-teste):
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:262` (dentro de `adtosQueUltrapassamInvoice`)
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:365` (dentro de `toPendente`)
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:586` (dentro de `toCasamentos`)
  - `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:250` (dentro de `alocar`)
  - `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:376` (dentro de `autoAlocarMultiplas`)
  - `src/backend/domain/service/permutas/IngestaoPermutasService.ts:425` (dentro de `saldoDisponivelNeg`)
  - `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:899` (dentro de `saldoNegDoAdto`)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "valorPermutar\s*/\s*\(adto\.\|a\.\|taxaAdto\)taxa" src/backend/domain/service/permutas --include="*.ts" | grep -v test
  GestaoPermutasService.ts:262:                    ? adto.valorPermutar / adto.taxa
  GestaoPermutasService.ts:365:                ? a.valorPermutar / a.taxa
  GestaoPermutasService.ts:586:                    ? adto.valorPermutar / adto.taxa
  AlocacaoPermutasService.ts:250:                ? adto.valorPermutar / taxaAdto
  AlocacaoPermutasService.ts:376:        const saldoNeg = adto.valorPermutar / adto.taxa;
  IngestaoPermutasService.ts:425:            return a.valorPermutar / a.taxa;
  ReconciliacaoPermutaService.ts:899:            ? valorPermutar / taxa
  ```
  A mesma pré-condição (`valorPermutar !== undefined && taxa !== undefined && taxa > 0`) é reescrita em 4 dos 5 sítios (GestaoPermutasService.ts:261, :364, :585; AlocacaoPermutasService.ts:249). Duas variantes de fallback: `Ingestao` cai para `valorMoedaNegociada ?? 0`; `Alocacao` deixa `undefined`.
- **Impacto técnico**: uma mudança futura na definição de "saldo negociado do adto" (ex.: teto por moeda estrangeira, ou aplicar `Math.max(0, ...)` para evitar negativos após a correção D3) precisa de 5 edições coordenadas; o compilador não avisa se uma for esquecida. A metade complementar (o menos deste minuendo) JÁ está encapsulada em `SaldoAlocacaoAdiantamentoService.somaNaoConsumida` — a assimetria é o que fere a modifiability.
- **Impacto de negócio**: baixo hoje (o valor é 1 divisão simples, cobertura de teste por sítio); médio na próxima mudança de regra de saldo. Não pode causar dinheiro errado por si só neste delta.
- **Métrica de baseline**: 5 sítios com a mesma fórmula; 0 helper compartilhado; 4 sítios com pré-condição repetida.

### F-modifiability-2: `ToleranciaResiduo` como classe de comportamento reside em `domain/interface/` (pasta reservada a tipos)

- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence (a estrutura de pastas conta uma versão da arquitetura, o conteúdo do arquivo conta outra)
- **Localização**: `src/backend/domain/interface/permutas/ToleranciaResiduo.ts`
- **Evidência (objetiva)**: a pasta `domain/interface/permutas/` contém, em produção, apenas tipos/enums (`Adiantamento`, `EstadoElegibilidade`, `Gestao`, `Invoice`, `PermutaCandidata`, …). `ToleranciaResiduo` é a única classe **com comportamento** (predicados estáticos) na pasta. O CLAUDE.md diz "Export classes only" (aplicável a services); classes-utilitárias de domínio típicamente vivem em `domain/libs/` (ex.: `EnvironmentProvider`, `Logger`, `Executors`, `Handlers`).
- **Impacto técnico**: baixo — o import funciona; risco é convenção divergir com o tempo (um dev pode replicar o padrão colocando serviço novo em `interface/`).
- **Impacto de negócio**: nenhum imediato.
- **Métrica de baseline**: 1 classe com comportamento em `interface/` (deveria ser 0); nenhum outro exemplo do padrão no repo, então é sítio único isolado.

### F-modifiability-3: `GestaoPermutasService.toPendente` cognitive-complexity subiu 45→46 (crônico piorou +1)

- **Severidade**: P3
- **Tactic violada**: Reduce Size of Module / Refactor
- **Localização**: `src/backend/domain/service/permutas/GestaoPermutasService.ts:322-429` (`toPendente`)
- **Evidência (objetiva)** — swap in/out do arquivo `origin/main`:
  ```
  # baseline (origin/main)
  ! Excessive complexity of 45 detected (max: 15).
  # HEAD (delta)
  ! Excessive complexity of 46 detected (max: 15).
  ```
  O incremento vem da nova ramificação `saldoRestante = podeAlocar && saldoNeg !== undefined ? saldoNeg - this.saldoAlocacaoService.somaNaoConsumida(...) : undefined` (linha 367-371). O ganho de correção (não descontar duplicado) justifica; o custo é que essa função — já com 6 responsabilidades de composição (status, candidatas, alocações, saldo, tipoPermuta, autoElegivel) — ficou marginalmente mais densa.
- **Impacto técnico**: baixo por si só (+1 ponto de CC); confirma o F-modifiability-4 do delta anterior (`toPendente` já era o hotspot #1 do arquivo).
- **Impacto de negócio**: baixo. Sinal de que a próxima adição em `toPendente` sem refactor vai continuar acumulando dívida.
- **Métrica de baseline**: CC `toPendente` 45 → 46 (Biome, max=15). Delta agregado do arquivo: 4 warnings inalteradas em número (28/16/45→46/23), inchada em 1 ponto.

### F-modifiability-4: tolerâncias inline em "moeda negociada" (USD ~1) permanecem como magic numbers em 3 sítios

- **Severidade**: P3
- **Tactic violada**: Encapsulate (`ToleranciaResiduo` cobre BRL; a metade "USD/moeda negociada" continua espalhada)
- **Localização**:
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:273` — `if (g.saldo - g.usado <= 1) continue;` (comentário: "tolerância de 1 (moeda negociada) p/ ruído de ponto flutuante")
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:401` — `saldoNeg + 1 >= somaInvoicesProcesso` (tolerância de 1 USD para centavos)
  - `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:256` — `+ 0.005` (epsilon de ponto flutuante, semântica distinta)
  - `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:378` — `saldoNeg + 1 < somaInvoices`
  - `src/frontend/app/permutas/components/format.ts:26` — `SALDO_TOL = 1` (frontend, usado em `page.tsx:564`)
- **Evidência (objetiva)**: 5 literais `1`/`0.005` com comentário explicando que são tolerância de resíduo. Nenhum importa `ToleranciaResiduo` (que é BRL, unidade diferente); a semântica é a mesma ("centavos são zero"), a unidade não.
- **Impacto técnico**: baixo hoje — todos são o mesmo valor. O dia em que a tolerância de resíduo em USD virar decisão explícita (ex.: R$1 ↔ USD 0,20 na taxa média), reeditar 5 sítios sem quebra de build.
- **Impacto de negócio**: baixo. Prevenção.
- **Métrica de baseline**: 5 literais + 0 constantes nomeadas em moeda negociada; 1 constante nomeada `SALDO_TOL` (frontend, isolada) sem paridade no backend.

## 5. Cards Kanban

### [modifiability-1] Extrair helper único para `saldoNeg(adto)` (`valorPermutar / taxa`) e migrar os 5 call sites

- **Problema**
  > A ADR-0046 pede "uma única fonte da regra para todo lugar que desconta alocações do saldo do adto". A metade do MINUENDO (as alocações não consumidas) foi extraída em `SaldoAlocacaoAdiantamentoService`. A metade do MINUENDO oposto (o saldo do ERP em moeda negociada, `valorPermutar / taxa`) segue duplicada em 5 sítios de `service/`, cada um reescrevendo a mesma pré-condição `valorPermutar !== undefined && taxa !== undefined && taxa > 0`.

- **Melhoria Proposta**
  > Aplicar **Abstract Common Services**. Adicionar um método estático `saldoNegDoAdto(adiantamento: { valorPermutar?: number; taxa?: number }): number | undefined` a `SaldoAlocacaoAdiantamentoService` (ou a uma nova classe pura `SaldoNegociadoCalculator` se `SaldoAlocacaoAdiantamentoService` não deve depender do shape do adto). Substituir os 5 sítios: `GestaoPermutasService.ts:262,365,586`; `AlocacaoPermutasService.ts:250,376`; `IngestaoPermutasService.ts:425`; `ReconciliacaoPermutaService.ts:899`. Manter a divisão local no `ReconciliacaoPermutaService.saldoNegDoAdto` só se o teste de âncora I-Write-6 exigir shape diferente do adto — atualmente não exige.

- **Resultado Esperado**
  > Uma edição futura na definição de "saldo negociado" (ex.: aplicar `Math.max(0, ...)`; ou usar a **última** taxa em vez da carimbada) toca 1 arquivo. Duplicação de fórmula em services: 5 → 0. Duplicação de pré-condição: 4 → 0.

- **Tactic alvo**: Abstract Common Services · Refactor
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — cirúrgico, 5 sítios, cada com teste próprio já cobrindo.
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Sítios com `valorPermutar / taxa` inline em `domain/service/permutas/`: 5 → 0
  - Sítios com pré-condição `valorPermutar !== undefined && taxa !== undefined && taxa > 0`: 4 → 0
- **Risco de não fazer**: baixo hoje; se a próxima ADR de saldo mexer na definição, custo linear no nº de sítios e sem alarme de compilador.
- **Dependências**: nenhuma.

### [modifiability-2] Mover `ToleranciaResiduo` de `domain/interface/permutas/` para `domain/libs/permutas/` (ou `domain/service/permutas/`)

- **Problema**
  > `ToleranciaResiduo` é a única classe **com comportamento** em `domain/interface/permutas/`, pasta que o repo reserva para tipos e enums. A convenção do CLAUDE.md sugere `domain/libs/` para utilitários (padrão de `EnvironmentProvider`, `Logger`, `Executors`) — a classe é um utilitário de domínio, não uma interface de dados.

- **Melhoria Proposta**
  > Aplicar **Increase Semantic Coherence**. Mover o arquivo para `src/backend/domain/libs/permutas/ToleranciaResiduo.ts` (ou o caminho equivalente adotado no repo — checar se `domain/libs/` aceita subpastas por bounded context) e ajustar os 7 imports (2 comentários, 5 usos). Nenhuma mudança semântica.

- **Resultado Esperado**
  > A estrutura de pastas volta a refletir o tipo do arquivo (tipos em `interface/`, comportamento em `service/` ou `libs/`). Precedente removido para futuras classes serem colocadas fora do lugar.

- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — apenas move + adjust imports (test coverage intacta).
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Classes com comportamento em `domain/interface/`: 1 → 0
  - Convenção documentada em CLAUDE.md ou ADR pequena
- **Risco de não fazer**: baixo. Convenção reproduzir-se com o tempo (o próximo dev pode ver e replicar).
- **Dependências**: nenhuma.

### [modifiability-3] Consolidar as tolerâncias em "moeda negociada" (USD) num único helper

- **Problema**
  > A tolerância de resíduo em BRL foi consolidada em `ToleranciaResiduo.LIMITE_BRL`. A tolerância equivalente em moeda negociada — usada para comparar saldos em USD/EUR — continua espalhada como literal `1` em 4 sítios de `service/permutas/` (Gestao ×2, Alocacao ×2) e como `SALDO_TOL = 1` no frontend, com um `+ 0.005` (float epsilon) em Alocacao com semântica distinta que só o comentário de código deixa claro.

- **Melhoria Proposta**
  > Aplicar **Encapsulate**. Adicionar `ToleranciaResiduo.LIMITE_MOEDA_NEGOCIADA = 1` (ou constante em módulo separado se a unidade não pertence a `ToleranciaResiduo` conceitualmente) com um helper `dentroDoLimiteMoedaNegociada`. Substituir os 4 literais em `service/permutas/`. Manter o `+ 0.005` só se for genuinamente epsilon de ponto flutuante — nesse caso, extrair como `EPSILON_FLOAT = 1e-6` (typical) ou `TOLERANCIA_ARREDONDAMENTO_USD = 0.005` com JSDoc explicando. No frontend, mudar `SALDO_TOL` para importar do contrato compartilhado se possível (cross-QA com Integrability, card F-modifiability-1 do delta anterior).

- **Resultado Esperado**
  > 5 literais numéricos com semântica de tolerância → 1 (ou 2) constante(s) nomeada(s) com JSDoc. A próxima decisão de negócio ("tolerância em USD ≠ tolerância em BRL") pode ser aplicada em 1 edição.

- **Tactic alvo**: Encapsulate · Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Literais `1`/`0.005` com semântica de tolerância em `service/permutas/`: 5 → 0
  - Constantes nomeadas de tolerância: 1 (BRL) → 2 (BRL + moeda negociada), com JSDoc justificando cada
- **Risco de não fazer**: baixo. Redundância inofensiva enquanto BRL≈USD nesse teto de 1.
- **Dependências**: preferível vir junto com [modifiability-1] (mesmo arquivo, mesma passada).

## 6. Notas do agente

- **Delta líquido positivo para modifiability**: extrai 2 classes de domínio (`ToleranciaResiduo`, `SaldoAlocacaoAdiantamentoService`) que colapsam duplicações antes espalhadas; remove o método fonte-do-bug (`sumByAdiantamento`); reduz `page.tsx` em 48 LOC ao extrair `montarHistorico`. Score 7,5 reflete "melhora real com débito residual não-crítico".
- **Débitos crônicos NÃO re-raised**: `EleicaoPermutasService` a 1069 LOC (F-modifiability-4 anterior — piorou +5 LOC, mas o hotspot de CC baixou 65→63); 8 warnings de CC em `permutas/service` (F-modifiability-5 anterior — 8 no delta vs. 8 antes, sem regressão além do `+1` em `toPendente` reportado como F-modifiability-3). Verificar `_shared-metrics.md` linha 98 (73 warnings de repo, inalterado).
- **Cross-QA — Refactor + Encapsulate** (F-1): sobrepõe com Integrability — helper único para `saldoNeg` também é a fronteira natural de tipo compartilhado backend↔frontend quando o painel expor a fórmula de saldo.
- **Cross-QA — Reduce Size + CC alto = hard to test** (F-3): `toPendente` a CC=46 é o mesmo sinal que o qa-testability vai capturar; refatorar seu núcleo (extract das 6 sub-decisões) alivia os dois QAs de uma vez.
- **Cross-QA — Magic numbers** (F-4): não colide com Deployability aqui, porque a decisão do ADR-0046 foi que R$1,00 **deve** ser hard-coded (redeploy é o binding time correto); a card [modifiability-3] só pede nomear a constante, não externalizar.
