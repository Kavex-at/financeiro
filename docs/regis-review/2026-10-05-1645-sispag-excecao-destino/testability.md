---
qa: Testability
qa_slug: testability
run_id: 2026-10-05-1645
agent: qa-testability
generated_at: 2026-10-05T16:45:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev/analista Kavex | Mudança na regra de exceção de destino (cadastro, 4-olhos, aprovação, aposentadoria) | `ExcecaoDestinoService`, `ExcecaoSubstituicaoService`, `ExcecaoDestinoRepository`, `ExcecaoDestinoRule`, rotas `/sispag/excecoes*`, 2 jobs | CI (jest + `test:sql` com Postgres 17) | Regressão detectada sem Conexos/banco real nos unitários; SQL provado no Postgres real | 100% dos métodos públicos com teste; 0 chamadas de rede; transições PENDENTE→APROVADA/REJEITADA/REVOGADA/SUBSTITUIDA cobertas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Razão de teste por camada (escopo ADR-0060)** — service: 2 fontes / 2 com teste (100%); repository: 1/1 (100%); libs/sispag (Rule): 1/1 (100%); migration 0075: 1/1 (+integration); routes: 1/1; jobs: 2 fontes / 0 testes (0%) | service 100%, repo 100%, libs 100%, routes 100%, jobs 0% | ≥ 50% por camada | ⚠️ (jobs) | `ls` de `domain/*/sispag`, `jobs/` |
| Cobertura de linhas/branches (%) | Não medível (`--coverage` não rodado nesta run) | 80/70 service+repo | ⚠️ | — |
| Testes unitários novos | Service 34+7, Repo 20, Rule 16, = 77 `it()`; rotas: 5 `describe` de `/sispag/excecoes*` | — | ✅ | `grep -c "it("` |
| Testes de integração Postgres real | 5 (service) + 11 (repo) + migration 0075 = 3 arquivos `*.integration.test.ts` | ≥1 por repo com SQL complexo | ✅ | `npm run test:sql`, 86 testes verdes |
| Métodos públicos do `ExcecaoDestinoService` com teste | 8/8 (`registrar, aprovar, rejeitar, revogar, listar, obter, eventos, aposentarSubstituidas`) | 100% | ✅ | `ExcecaoDestinoService.test.ts` (it em 106–468), integration:172 |
| Asserção de log (incl. não-vazamento de dado sensível) | `expect(logado).not.toContain('99887766')` em ExcecaoDestinoService.test.ts:239 | presente em caminho de erro/sucesso | ✅ | grep |
| Leituras de tempo/aleatório não injetáveis no escopo | 3 (`randomUUID` Repo:128,312; `new Date(cadastradoEm)` Substituicao:152 é conversão, não relógio) → 2 reais | 0 | ⚠️ | grep `randomUUID` |
| Maior arquivo de teste no escopo | `routes/sispag.test.ts` 1537 LOC (pré-existente; `ExcecaoDestinoService.test.ts` 495) | ≤ 500 | ⚠️ | `wc -l` |
| Testes de rede real | 0 no escopo | 0 | ✅ | testes via mocks de DI |
| Cobertura de testes de frontend (excecoes/) | `page.test.tsx`, `ExcecoesTable.test.tsx`, `Dialogos.test.tsx`, `InformarDestinoDialog.test.tsx` (4 arquivos p/ 5 .tsx) | ≥ 0,5 | ✅ | `ls app/sispag/excecoes` |
| `coverageThreshold` em CI | global 72/54/78; `domain/service/` 88/60 | presente | ✅ (global, não por arquivo novo) | `jest.config.cjs:39-47` |
| CI roda `test:sql` | sim | sim | ✅ | `.github/workflows/ci.yml:62` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `ExcecaoDestinoRule`/`MaskDestino`/`DestinoManualValidator` puros, testáveis sem DI | ✅ | `domain/libs/sispag/*` |
| Recordable Test Cases | Sem fixtures gravadas; titularidade lida "ao vivo" é mockada à mão | ⚠️ | ExcecaoDestinoService.test.ts:296 |
| Sandbox | Postgres 17 local nos `*.integration.test.ts` (`test:sql`) | ✅ | package.json:24, ci.yml:62 |
| Executable Assertions | Invariantes I12b (aprovador ≠ cadastrante), motivo obrigatório, falha fechada testados | ✅ | Service.test.ts:245–378 |
| Abstract Data Sources | Repository injetado por construtor; titularidade/Conexos via interface | ✅ | Service.test.ts |
| Limit Structural Complexity | Service 354 LOC, Repository 474 LOC; `routes/sispag.ts` 991 LOC | ⚠️ | `wc -l` |
| Limit Non-Determinism | `randomUUID` e relógio do banco sem provider injetável | ⚠️ | Repository.ts:128,312 |

## 4. Findings

### F-testability-1: Jobs novos sem nenhum teste
- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/jobs/aposentar-excecoes-substituidas.ts` (45 LOC), `jobs/probe-destino-manual-uso.ts` (65 LOC)
- **Evidência**: nenhum `*.test.ts` para eles; a lógica de aposentadoria é coberta via `service.aposentarSubstituidas` (integration:172), mas o wiring/exit code do job não.
- **Impacto técnico**: falha de composição (container, env estreito) só aparece no cron.
- **Impacto de negócio**: exceção substituída continua ativa sem alerta (cron com 0 itens aparece como success).
- **Métrica de baseline**: 0 testes / 2 jobs (110 LOC).

### F-testability-2: `randomUUID` embutido no repositório
- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `ExcecaoDestinoRepository.ts:128,312`
- **Evidência**: `const id = randomUUID();`
- **Impacto técnico**: ids de exceção/evento não podem ser fixados em asserts; testes usam `expect.any(String)`.
- **Impacto de negócio**: baixo; dificulta golden tests da trilha de auditoria.
- **Métrica de baseline**: 2 sítios não injetáveis.

### F-testability-3: Piso de cobertura não cobre os arquivos novos
- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `jest.config.cjs:39-52`
- **Evidência**: só `global` e `./domain/service/` (88/60); `domain/repository/` e `domain/libs/sispag/` sem piso.
- **Impacto técnico**: queda de cobertura no repo (474 LOC) some no bucket global.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 0 pisos por arquivo para os 6 novos arquivos de código; cobertura real não medida.

### F-testability-4: `routes/sispag.test.ts` com 1537 LOC
- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `routes/sispag.test.ts`, `routes/sispag.ts` (991 LOC)
- **Evidência**: `wc -l` 1537; 5 `describe` de exceções adicionados ao mesmo arquivo.
- **Impacto técnico**: tempo de leitura/manutenção; acoplamento de setup.
- **Impacto de negócio**: custo de revisão crescente.
- **Métrica de baseline**: 1537 LOC (alvo ≤ 500).

## 5. Cards Kanban

### [testability-1] Cobrir os jobs de exceção com teste de wiring
- **Problema**
  > Os dois jobs novos não têm teste; falha de composição só aparece no cron, e cron sem itens aparece como success.
- **Melhoria Proposta**
  > Extrair o corpo do job para função/classe exportável e testar com service mockado (exit code, log de resultado, env estreito). Tactic: Executable Assertions.
- **Resultado Esperado**
  > Jobs com teste: 0/2 → 2/2; ao menos 3 casos (sucesso, zero itens, erro do service).
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - testes de job: 0 → ≥ 4
- **Risco de não fazer**: aposentadoria de exceção falha silenciosa por meses.
- **Dependências**: nenhuma

### [testability-2] Injetar gerador de id no ExcecaoDestinoRepository
- **Problema**
  > `randomUUID` direto no repositório impede asserts determinísticos da trilha de auditoria.
- **Melhoria Proposta**
  > Provider `IdGenerator` injetável (default `randomUUID`), usado em `registrar` e na gravação de eventos.
- **Resultado Esperado**
  > Sítios não injetáveis: 2 → 0; asserts com `expect.any(String)` no repo: substituídos por ids fixos.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - `randomUUID` em `domain/repository/sispag/Excecao*`: 2 → 0
- **Risco de não fazer**: continua replicando o padrão em novos repositórios.
- **Dependências**: nenhuma

### [testability-3] Pisos de cobertura para repositório e regra de exceção
- **Problema**
  > O ratchet só protege `domain/service/`; repo e Rule novos podem regredir sem alarme.
- **Melhoria Proposta**
  > Medir cobertura uma vez e adicionar piso em `coverageThreshold` para `ExcecaoDestinoRepository.ts` e `ExcecaoDestinoRule.ts`; dividir `routes/sispag.test.ts` por recurso (`sispag.excecoes.test.ts`).
- **Resultado Esperado**
  > Pisos por arquivo: 0 → 2; maior arquivo de teste de rotas 1537 → ≤ 800 LOC.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - arquivos novos com piso: 0 → 2
  - LOC de `routes/sispag.test.ts`: 1537 → ≤ 800
- **Risco de não fazer**: erosão silenciosa da cobertura do caminho de 4-olhos.
- **Dependências**: rodar `npm test -- --coverage` para obter baseline.

## 6. Notas do agente

- Escopo: arquivos da feature (inclui os não rastreados: Excecao*, 0075, jobs); cobertura não medida por instrução.
- Sem P0/P1: todos os métodos públicos e transições de estado têm teste unitário e integração em Postgres real.
- Cross-QA: pisos de cobertura/`test:sql` em CI (Deployability); `randomUUID`/relógio injetáveis (Modifiability); transições da exceção (Fault Tolerance); jobs sem teste (Availability).
