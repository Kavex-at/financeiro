---
qa: Testability
qa_slug: testability
run_id: 2026-10-14-1330
agent: qa-testability
generated_at: 2026-10-14T13:50:00-03:00
scope: all
score: 8
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review (delta `feat/sispag-sugestao-boleto-dda`)

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / CI | Mudança na regra de camadas, num SELECT ou na matriz de permissões da sugestão de boleto | Motor + Regra + BoletoSuggestionService + SugestaoBoletoRepository + rotas + painel | Pré-merge, CI (`npm test`, `test:sql`) e gate ground-truth manual | Um teste vermelho aponta a invariante quebrada (limites R$ 0,05 / 1–5 dias / antes do débito, zero Conexos, coluna faltante) | 0 regressões de invariante I15a–k escapam; cobertura dos arquivos novos ≥ 80% linhas / 70% branches |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Cobertura por camada (delta backend)** — libs/boleto `CodigoBarrasBoleto` | 100 / 100 / 100 / 100 (stmts/branch/funcs/lines) | 80 lines, 70 branch | ✅ | `jest --coverage` com collectCoverageFrom nos arquivos do delta |
| #1 — service/sispag (Regra, Motor, BoletoSuggestionService, Consolidacao) | 96.0 / 84.6 / 99.1 / 97.7 | idem | ✅ | idem |
| #1 — `RegraSugestaoBoleto.ts` | 100 / 100 / 100 / 100 | idem | ✅ | idem |
| #1 — `MotorSugestaoBoleto.ts` | 99.4 / 88.0 / 100 / 99.3 | idem | ✅ | idem |
| #1 — `BoletoSuggestionService.ts` | 92.6 / 76.4 / 97.3 / 95.7 | idem | ✅ | idem |
| #1 — repository/sispag `SugestaoBoletoRepository.ts` | 85.3 / 74.1 / 68.2 / 92.3 (funcs; linhas 165,382,392,431-449 sem cobertura unitária) | funcs ≥ 80 | ⚠️ | idem |
| #1 — routes `sispag.ts` (arquivo inteiro, não só delta) | 86.7 / 70.1 / 95.4 / 91.4 | lambda/rotas: barra menor | ✅ | idem |
| #1 — jobs `validate-sispag-sugestao-boleto-dda-v1.ts` | 0 / 0 / 0 / 0 (gate manual, não é teste) | n/a (script) | ⚠️ | idem |
| #1 — Frontend `SugestaoBoletoPainel` / `ConfirmacoesEmissorPainel` / `MotivoDecisaoDialog` / `sugestaoBoleto.ts` | 91.8 / 77.5 / 89.5 / 92.5; 97.1 / 85.3 / 88.9 / 97.1; 90.3 / 70 / 75 / 96.6; 100 / 95 / 100 / 100 | 80 / 70 | ✅ | `jest --coverage` (frontend) |
| Suítes/testes do delta executados | backend 10 suítes / 302 testes; frontend 5 suítes / 55 testes, todos verdes | 100% verde | ✅ | idem |
| Integração em Postgres real (CI `backend-sql`) | 3 suítes / 24 testes (0084 DDL, 0084 integração, `SugestaoBoletoRepository.integration`); `describe.skip` sem DSN | ≥ 1 por repositório com SQL complexo | ✅ | `ci.yml:32-62`, `package.json test:sql` |
| Relógio injetável na regra/motor/serviço | 0 leituras de `new Date()`/`Date.now` em Regra, Motor, Service, Consolidacao; serviço usa `calendar.now()` | 0 | ✅ | `grep` |
| Aleatoriedade fora de provider | 3 `randomUUID()` em `SugestaoBoletoRepository.ts:201,256,403` | 0 ou injetável | ⚠️ | `grep` |
| Testes de fronteira exata nos tiers | R$ 0,05 / 0,06; +1,+2,+3,+5 / +6 dias; antes do débito (linha 153); virada de mês; empate de ordem | todas as fronteiras | ✅ (ver F-testability-3) | `RegraSugestaoBoleto.test.ts:41-200`, `MotorSugestaoBoleto.test.ts:217` |
| Guard SELECT-vs-schema nos SELECTs NOVOS fora do repositório de sugestão | 2 SELECTs novos (`TituloAPagarRepository.buscarPorChave`, `BoletoDdaRepository.buscarPorChave`) só com linha mockada | 0 sem guard | ❌ | `git diff`; `*.integration.test.ts` inexistente para ambos |
| Prova de zero escrita/chamada Conexos | `describe('zero escrita e zero chamada ao Conexos (I15a/I15b)')` em `BoletoSuggestionService.test.ts:557` | presente | ✅ | arquivo |
| Matriz de permissões | `it.each` leituras/mutações/cópia, `ver` 403 em mutação, sem `sispag:*` 403, serviço intocado (`sispag.sugestaoBoleto.test.ts:135-165,308`) | presente | ✅ | arquivo |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Motor/Regra puros (entradas/saídas por valor); construtor-injeção com `calendar`, `repo`, `db` mockáveis; `BankingCalendar.withClock` | ✅ presente | `MotorSugestaoBoleto.ts`, `BoletoSuggestionService.ts:727` |
| Recordable Test Cases | Job ground-truth roda o motor de produção sobre dados reais (PRD, read-only), amostra cega 80 títulos; resultado não vira fixture no repo | ⚠️ parcial | `validate-sispag-sugestao-boleto-dda-v1.ts`; ver F-testability-5 |
| Sandbox | Banco temporário criado/derrubado por suíte (`CREATE/DROP DATABASE`), CI com Postgres 17; spies provam zero Conexos | ✅ presente | `SugestaoBoletoRepository.integration.test.ts:90`, `ci.yml:34-62` |
| Executable Assertions | Trigger append-only, CHECKs (23514), índices parciais (23505) testados contra o banco real; `SuggestionListingTruncatedError` falha alto | ✅ presente | `0084_...integration.test.ts:116-219` |
| Abstract Data Sources | Repositórios por interface; `DatabaseClient` mockado nas unidades; Postgres real nas integrações | ✅ presente | `SugestaoBoletoRepository.test.ts` |
| Limit Structural Complexity | Regra (165 LOC) separada do Motor (417) e do Service (730); `BoletoSuggestionService.test.ts` com 691 LOC e service de 730 LOC | ⚠️ parcial | wc/diff stat |
| Limit Non-Determinism | Sem relógio/random na lógica de decisão; empate de vencimento desempata por `docCod` e teste prova independência da ordem; UUID só em INSERT | ✅ presente | `MotorSugestaoBoleto.test.ts:217` |

## 4. Findings

### F-testability-1: SELECTs `buscarPorChave` novos só têm teste de linha mockada (a mesma classe do miss anterior)
- **Severidade**: P1
- **Tactic violada**: Abstract Data Sources / Executable Assertions
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts` (`buscarPorChave`, lista de 17 colunas + `ativo`), `BoletoDdaRepository.ts` (`buscarPorChave`, 12 colunas), testes `TituloAPagarRepository.test.ts` (+39 linhas), `BoletoDdaRepository.test.ts` (+29)
- **Evidência (objetiva)**:
  ```
  ls domain/repository/sispag/*.integration.test.ts
  AuthorizedPayeeRepository / SugestaoBoletoRepository / VerificacaoTedPix   (nenhum p/ TituloAPagar nem BoletoDda)
  ```
  Esses dois SELECTs alimentam a releitura anti-TOCTOU do passo de confirmação. Um SELECT que omita coluna (`ativo`, `pronto_para_remessa`, `valor`) passa nos testes unitários, porque a linha é fabricada pelo teste.
- **Impacto técnico**: o guard SELECT-vs-schema existe só para as 3 tabelas novas (integração mapeia numéricos/datas, `:213`). Para as duas leituras pontuais a regressão é invisível até produção; a confirmação usaria título/boleto com campos `undefined` e decidiria sobre dado errado.
- **Impacto de negócio**: confirmação do emissor baseada em releitura corrompida; é exatamente a falha já ocorrida uma vez nesta feature.
- **Métrica de baseline**: 2 SELECTs novos, 0 testes contra Postgres real (0/2); cobertura de integração da camada de repositório do delta 1 de 3 arquivos alterados.

### F-testability-2: Contagem de coluna sem teste estrutural genérico
- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `SugestaoBoletoRepository.test.ts` (PAR_ROW/DECISAO_ROW literais)
- **Evidência**: os testes unitários usam `*_ROW` escritos à mão; a defesa depende de a integração rodar (`describe.skip` quando `METRICAS_CICLO_TEST_DSN` ausente — localmente `npm test` ignora `*.integration.test.ts` via `testPathIgnorePatterns`). No CI roda (`backend-sql`), mas o `npm test` local nunca vê.
- **Impacto técnico**: o desenvolvedor só descobre no CI; o gate é correto, o laço de feedback é longo.
- **Impacto de negócio**: retrabalho de PR; sem risco de produção.
- **Métrica de baseline**: 24 testes SQL fora do `npm test` (0 no laço local).

### F-testability-3: Cobertura de branches/funções do repositório e do service abaixo do restante do delta
- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `SugestaoBoletoRepository.ts` funcs 68.2% (linhas 382, 392, 431-449 sem cobertura unitária); `BoletoSuggestionService.ts` branches 76.4% (linhas 195, 224, 297, 370, 503-504, 668-671)
- **Evidência**: tabela da seção 2. As linhas 431-449 do repositório são cobertas apenas pela integração, que não entra no `--coverage` do CI unitário. Fronteiras das regras (R$ 0,05; 1–5 dias; antes do débito) estão testadas com valores exatos, então este finding não é sobre as fronteiras.
- **Impacto técnico**: ramos de erro/empate do service sem asserção própria.
- **Impacto de negócio**: baixo; ramos de falha-fechada merecem prova explícita.
- **Métrica de baseline**: funcs 68.2% no repositório; branches 76.4% no service (meta 80/70, branches já ≥ 70).

### F-testability-4: Gate ground-truth é script manual, sem asserção automática e com viés de seleção
- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/jobs/validate-sispag-sugestao-boleto-dda-v1.ts`
- **Evidência**: amostra = títulos que o ERP JÁ flagou (leave-one-out), 98 reproduzem, 0 divergem, 44 empates, 26 compartilhados; a população-alvo (953 não flagados, 248 FORTE / 40 VENCIDO_INFORMATIVO / 4 ATENCAO) **não tem ground truth** (descrito no próprio cabeçalho). Roda em PRD read-only, sem saída persistida no repo, 0% cobertura, e nada falha o CI se divergir.
- **O que ele não vê**: (a) boletos que o ERP recusou por motivo desconhecido (viés: só enxerga o que o ERP aceitou, onde valor+dia são iguais por construção, logo não exercita deltas de centavos nem +1 a +5 dias); (b) tier ATENCAO (4 casos) e VENCIDO_INFORMATIVO; (c) revogação/rejeição/par; (d) regressão no tempo, pois o resultado não é salvo como baseline.
- **Impacto técnico**: o 0 DIVERGE prova sanidade do desempate por valor+dia, não a precisão dos tiers de centavos/dias, que dependem só dos testes unitários.
- **Impacto de negócio**: confiança no tier FORTE (248 títulos) baseada em prova indireta; o analista confirma, então o risco é limitado (confirmação é evidência, não autoridade).
- **Métrica de baseline**: 0 de 248 FORTE não flagados com ground truth; 0 testes automatizados do gate.

### F-testability-5: `randomUUID()` direto no repositório
- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `SugestaoBoletoRepository.ts:201,256,403`
- **Evidência**: 3 sítios; os testes não conseguem fixar o id sem `jest.mock('node:crypto')`.
- **Impacto técnico**: ids imprevisíveis em asserções; contornável (`expect.any(String)`).
- **Impacto de negócio**: nenhum direto.
- **Métrica de baseline**: 3 sítios de aleatoriedade sem provider.

## 5. Cards Kanban

### [testability-1] Cobrir `buscarPorChave` de Título e Boleto com integração em Postgres real

- **Problema**
  > Os 2 SELECTs novos da releitura anti-TOCTOU só são testados com linha mockada: 0/2 contra o banco. É o mesmo padrão do miss anterior (SELECT omite coluna, teste passa).

- **Melhoria Proposta**
  > Criar `TituloAPagarRepository.integration.test.ts` e `BoletoDdaRepository.integration.test.ts` (padrão `describeComBanco`, DB efêmero, incluído em `npm run test:sql`) que insiram a linha completa e afirmem todos os campos de `TituloAPagar`/`BoletoDda`, inclusive `ativo=false` e arquivo cancelado → `null`. Opcional: helper que compara colunas do SELECT com `information_schema`.

- **Resultado Esperado**
  > Integração dos repositórios alterados 1/3 → 3/3; +6 casos SQL; qualquer coluna omitida quebra o CI.

- **Tactic alvo**: Abstract Data Sources / Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1, F-testability-2
- **Métricas de sucesso**:
  - SELECTs novos com teste em Postgres real: 0/2 → 2/2
  - Testes SQL: 24 → ≥ 30
- **Risco de não fazer**: releitura de confirmação decidir sobre campo `undefined` e só aparecer em produção.
- **Dependências**: nenhuma (reusa o job `backend-sql`).

### [testability-2] Fechar ramos de erro do repositório e do service de sugestão

- **Problema**
  > `SugestaoBoletoRepository` com funções em 68.2% e `BoletoSuggestionService` com branches em 76.4%; ramos de falha-fechada (linhas 668-671, 503-504 do service; 431-449 do repositório) sem asserção unitária.

- **Melhoria Proposta**
  > Adicionar casos unitários para os trechos listados (erro de auditoria, versão velha, falha na releitura) com `jest.fn` no `DatabaseClient`.

- **Resultado Esperado**
  > Repositório funcs 68.2% → ≥ 85%; service branches 76.4% → ≥ 85%.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - funcs do repositório: 68.2% → 85%
  - branches do service: 76.4% → 85%
- **Risco de não fazer**: ramo de falha-fechada alterado sem alarme.
- **Dependências**: nenhuma.

### [testability-3] Persistir o resultado do gate ground-truth como baseline e falhar em divergência

- **Problema**
  > O gate roda à mão em PRD, tem 0% de cobertura e não deixa baseline; só valida desempate por valor+dia da população já flagada, não os tiers de centavos/dias.

- **Melhoria Proposta**
  > Extrair a classificação de veredito para uma função pura testada, gravar o resumo (contagens por veredito/tier) em `docs/` ou `ontology/` por execução e sair com código ≠ 0 se `DIVERGE_OUTRO_BOLETO > 0`. Documentar no cabeçalho a limitação (viés de seleção).

- **Resultado Esperado**
  > Cobertura do gate 0% → ≥ 80% na lógica de veredito; 1 baseline versionado; divergência = exit 1.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Baselines versionados do gate: 0 → 1
  - Cobertura da lógica de veredito: 0% → 80%
- **Risco de não fazer**: mudança futura na regra altera a precisão sem trilha comparável.
- **Dependências**: acesso PRD read-only (já existe).

### [testability-4] Injetar gerador de id nos repositórios de sugestão

- **Problema**
  > 3 `randomUUID()` diretos tornam ids não fixáveis nos testes.

- **Melhoria Proposta**
  > Receber `idFactory` (default `randomUUID`) no construtor de `SugestaoBoletoRepository`.

- **Resultado Esperado**
  > Sítios de aleatoriedade sem provider 3 → 0.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - `randomUUID` direto: 3 → 0
- **Risco de não fazer**: apenas atrito em testes futuros.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: só o delta; cobertura medida com `collectCoverageFrom` nos arquivos novos. O `--coverage` unitário não inclui os `*.integration.test.ts` (ignorados por `testPathIgnorePatterns`); os 24 testes SQL não foram executados aqui (sem DSN), os números deles vêm de `_shared-metrics.md` e do CI.
- Ressalva do mantenedor: 2 suítes de frontend falham por `@radix-ui/react-dropdown-menu` ausente (ambiental); não contam como finding.
- Acessibilidade: 27 asserções por role/status/alert no painel, incluindo "uma única região role=status, sem alert aninhado" (`SugestaoBoletoPainel.test.tsx:370`); não há teste automático de axe, o que é aceitável.
- Cross-QA: F-testability-1 toca Fault Tolerance (releitura anti-TOCTOU); F-testability-4 toca Integrability (fixtures de dados reais).
