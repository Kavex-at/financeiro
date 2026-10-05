---
qa: Testability
qa_slug: testability
run_id: 2026-10-05-2134-permuta-centavos-adto
agent: qa-testability
generated_at: 2026-10-05T21:45:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na regra de teto do líquido (I-Write-10) ou no `LIMITE_BRL` | `ReconciliacaoPermutaService.limitarAoDisponivelDoAdto` + testes + job de ground truth | Teste local/CI, ERP Conexos stubado, sem rede | Forçar cada ramo (sem excesso, fechável, fora do teto, juros negativo, disponível ausente) e observar payload gravado e logs | 100% dos ramos da função com asserção; suíte do arquivo < 5 s; 0 chamadas ao ERP |

## 2. Métricas observadas

(Delta-scoped, `--quick`: sem rodada de cobertura completa. Cobertura por camada do repo inteiro **não medida** nesta rodada.)

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (tabela por diretório) | ⚠️ **Não medível nesta rodada** (`--quick`). Substituto: ramos do código novo cobertos por teste = 4 de 6 (ver F-testability-1) | 80% linhas / 70% branches em `domain/service` | ⚠️ | análise de `limitarAoDisponivelDoAdto` vs. 4 testes do describe I-Write-10 |
| Arquivos de teste backend | 226 | — | ✅ | `_shared-metrics.md` |
| Suíte do arquivo alterado | 54/54 passam, 2,4 s | verde, determinística | ✅ | `npx jest domain/service/permutas/ReconciliacaoPermutaService.test.ts` |
| Suíte backend | 203 suites / 3773 testes verdes | verde | ✅ | `_shared-metrics.md` |
| Testes novos por ramo de decisão novo | 4 testes / 6 ramos (4 cobertos) | 1 por ramo | ⚠️ | diff de `c099a55` |
| Injeção por construtor (DI) nos testes novos | `buildDeps()` com mocks, `container.resolve` ausente | construtor | ✅ | test.ts, describe I-Write-10 |
| Leitura de tempo/aleatoriedade no código novo | 0 (`Date`/`Math.random` ausentes em `limitarAoDisponivelDoAdto`) | 0 | ✅ | diff |
| Rede real nos testes novos | 0 | 0 | ✅ | diff |
| Replay com dado real | 196 execuções reais reproduzidas: 192 IDENTICO / 3 FECHADO / 1 FORA_TETO / 0 DIVERGENTE | 0 divergente | ✅ | `jobs/validate-permuta-centavos-adto-v1.ts` |
| Tamanho do arquivo de teste | `ReconciliacaoPermutaService.test.ts` ≈ 1575 LOC (era ~1430) | ≤ 500 | ❌ (pré-existente, agravado +146) | `wc -l` / diff |
| Tamanho da unidade sob teste | `ReconciliacaoPermutaService.ts` 1231 LOC | ≤ 500 | ❌ (pré-existente, +71) | `_shared-metrics.md` |
| Asserção de `logService.info` (ramo LIMITADA) | 0 | 1 | ⚠️ | test.ts |
| Teste do job de validação | 0 (script, acessa método privado por cast) | n/a | ⚠️ | `jobs/validate-...:54` |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Método privado, alcançado só via `reconciliar()` ponta a ponta (6 chamadas ao ERP stubadas) e por cast `as unknown as` no job | ⚠️ parcial | `jobs/validate-...:54` |
| Recordable Test Cases | Números reais dos borderôs 23184 e 23188 transcritos nos testes; job reexecuta 196 execuções de produção contra a função real | ✅ presente | test.ts "borderô 23184/23188"; job |
| Sandbox | ERP totalmente stubado; job read-only, DB apenas, zero chamadas ao ERP | ✅ presente | job cabeçalho; `_shared-metrics.md` |
| Executable Assertions | Invariante `líquido == disponível` asserida (`p2.bxaMnyLiquido === p2.bxaMnyValorPermuta`); job classifica veredito automaticamente | ✅ presente | test.ts; job:99-105 |
| Abstract Data Sources | `buildDeps()` injeta repositórios e clients mockados | ✅ presente | test.ts |
| Limit Structural Complexity | Serviço de 1231 LOC, teste de ~1575 LOC; a função nova é pequena e com contrato claro, mas vive no monólito | ⚠️ parcial | `ReconciliacaoPermutaService.ts` |
| Limit Non-Determinism | Sem relógio, sem aleatoriedade, sem rede; aritmética via `round2` determinística | ✅ presente | diff |

## 4. Findings (achados)

### F-testability-1: Ramos do teto sem teste (disponível ausente, fronteira R$1,00, DESCONTO fora do teto, excesso == 0)

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` (`limitarAoDisponivelDoAdto`) e describe I-Write-10 no test.ts
- **Evidência (objetiva)**:
  ```
  if (p.bxaMnyValorPermuta === undefined) return { juros, desconto };   // nenhum teste: ERP sem o campo
  if (excesso > limiteResiduo || jurosTeto < 0)                          // testado com 1,50 e 0,80; 1,00 exato (aceito) e 1,01 não
  isDesconto ? round2(desconto + excesso) ...                            // só o caso feliz (472,06→472,07); nenhum teste DESCONTO com excesso > 1
  ```
  Os 4 testes: multi-título JUROS, N:M DESCONTO, excesso 1,50, juros 0,30. Aceite no ground truth (192 IDENTICO) cobre "sem excesso" em produção, mas não no CI.
- **Impacto técnico**: Uma regressão de `>` para `>=` ou a remoção do guard de `undefined` passa a suíte. O `undefined` é plausível (resposta do passo 3 sem o campo) e o comportamento correto (não mexer) é só convenção.
- **Impacto de negócio**: Fronteira do teto é a regra monetária; erro aqui reintroduz a recusa do ERP no Finalizar (caso do borderô 23184) ou ajusta um valor que não devia.
- **Métrica de baseline**: 4 de 6 ramos de decisão com teste (67%); 0 testes de fronteira.

### F-testability-2: Ramo LIMITADA sem asserção de log e função privada testada só de ponta a ponta

- **Severidade**: P3
- **Tactic violada**: Specialized Interfaces
- **Localização**: test.ts (describe I-Write-10); `jobs/validate-permuta-centavos-adto-v1.ts:54`
- **Evidência (objetiva)**:
  ```
  # testes de sucesso não afirmam logService.info BUSINESS_INFO 'LIMITADA'; só os 2 de aviso afirmam warn
  const limitar = (service as unknown as Limitar).limitarAoDisponivelDoAdto;   // job acessa o privado por cast
  ```
- **Impacto técnico**: Cada caso exige montar 6 stubs do ERP; o job depende do nome do método privado (renomear quebra o validador em runtime, não no typecheck).
- **Impacto de negócio**: O log `LIMITADA` é o único rastro de que o valor enviado ao ERP difere do calculado; sem asserção pode sumir sem alarme.
- **Métrica de baseline**: 0 asserções de `info` LIMITADA; 1 acoplamento por cast.

### F-testability-3: Arquivo de teste e serviço continuam crescendo

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `ReconciliacaoPermutaService.ts` (1231 LOC) e `.test.ts` (54 testes)
- **Evidência (objetiva)**:
  ```
  delta: serviço +71 LOC, teste +146 LOC; testes 50 -> 54
  ```
- **Impacto técnico**: Navegar e isolar falhas custa mais; função pura de aritmética está presa à classe.
- **Impacto de negócio**: Custo de teste de cada mudança futura de permuta cresce com o tamanho.
- **Métrica de baseline**: 1231 LOC no serviço (alvo ≤ 500).

Nenhum P0: o delta não introduz defeito de teste; a suíte passa (54/54) e o replay de produção tem 0 divergentes.

## 5. Cards Kanban

### [testability-1] Cobrir fronteira e ramos restantes do teto I-Write-10

- **Problema**
  > `limitarAoDisponivelDoAdto` tem 6 ramos de decisão e 4 testes. Faltam: `bxaMnyValorPermuta` ausente, excesso exato R$1,00 (ajusta) vs R$1,01 (não ajusta), DESCONTO com excesso > R$1,00 e excesso 0.

- **Melhoria Proposta**
  > Acrescentar 4 casos no describe I-Write-10 de `ReconciliacaoPermutaService.test.ts` (ou, com testability-3, direto na função extraída), com `it.each` para a fronteira. Tactic: Executable Assertions.

- **Resultado Esperado**
  > Ramos de decisão do teto com teste 4/6 → 6/6; testes de fronteira 0 → 2.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Ramos cobertos: 4/6 → 6/6
  - Casos do describe I-Write-10: 4 → 8
- **Risco de não fazer**: Mudança de `>` para `>=` no teto passa o CI e reabre a recusa do ERP no Finalizar.
- **Dependências**: nenhuma

### [testability-2] Afirmar o log LIMITADA e expor a função para o validador sem cast

- **Problema**
  > O log `BUSINESS_INFO` 'LIMITADA' não é afirmado em nenhum teste e o job de validação acessa o método privado por cast.

- **Melhoria Proposta**
  > Adicionar `expect(logService.info)` nos dois testes de sucesso. Tornar o método `public` (ou parte do módulo extraído de testability-3) para o job deixar de usar `as unknown as`. Tactic: Specialized Interfaces.

- **Resultado Esperado**
  > Asserções do log LIMITADA 0 → 2; casts em job 1 → 0.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Asserções do log LIMITADA: 0 → 2
  - Acoplamentos por cast: 1 → 0
- **Risco de não fazer**: Renomear o método quebra o validador só em runtime; o log some sem alarme.
- **Dependências**: nenhuma

### [testability-3] Extrair a aritmética de teto/âncora do serviço de 1231 LOC

- **Problema**
  > A regra monetária (âncora I-Write-6 + teto I-Write-10) é aritmética pura presa a `ReconciliacaoPermutaService` (1231 LOC) e testada com 6 stubs de ERP por caso.

- **Melhoria Proposta**
  > Extrair para um `@injectable` ou módulo de domínio puro (ex.: `AjusteCentavosPermuta`), com testes unitários diretos; manter a orquestração no serviço. Tactic: Limit Structural Complexity.

- **Resultado Esperado**
  > LOC do serviço 1231 → ≤ 1100 no primeiro corte; casos de teste de aritmética sem stub de ERP 0 → 8; tamanho de cada caso ≈ 6 stubs → 1 objeto de entrada.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - LOC do serviço: 1231 → ≤ 1100
  - Casos de aritmética sem stub de ERP: 0 → 8
- **Risco de não fazer**: Cada ajuste monetário futuro soma LOC e stubs ao monólito; aumenta o custo de teste por mudança.
- **Dependências**: fazer testability-1 antes, para ter rede de segurança na extração

## 6. Notas do agente

- Escopo: só o delta de `c099a55`; `--quick`, sem cobertura completa, então a tabela por camada (métrica 1) está declarada como não medível.
- Rodei `ReconciliacaoPermutaService.test.ts`: 54/54 verdes em 2,4 s.
- Ponto forte: o job reexecuta a função real contra 196 execuções de produção (Recordable Test Cases + Sandbox), com 0 divergentes.
- Cross-QA: o teto é Fault Tolerance/Integrability (recusa do ERP no Finalizar); a extração (testability-3) cruza Modifiability.
