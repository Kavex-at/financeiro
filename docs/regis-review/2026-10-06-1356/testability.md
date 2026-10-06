---
qa: Testability
qa_slug: testability
run_id: 2026-10-06-1356
agent: qa-testability
generated_at: 2026-10-06T14:10:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Testability — Regis-Review

Escopo: DELTA da feature `sispag-verificacoes-ted-pix` (`git diff origin/main...HEAD`), modo `--quick` (cobertura não executada).

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança numa regra I13a–m (ex.: janela FRACA de ±15 dias, ou quem pode conferir o lote) | `VerificacaoTedPixService`, `DuplicateDetector`, `ConferenciaLoteRule`, repositórios `sispag/*` | Desenvolvimento local e CI (`ci.yml`: `npm test --coverage` + job `test:sql` com Postgres) | O teste que defende a invariante falha localmente, sem Conexos nem banco de produção | 100% das invariantes I13a–m com pelo menos 1 teste nomeado; ciclo unitário do delta < 2 min; 0 testes tocando rede real |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Razão de testes por camada no delta** (arquivos fonte `.ts` tocados com `.test.ts` irmão / fonte tocado) | services `sispag/operacao`: 15/15 (100%); repositories: 7/7 (100%); libs/sispag: 1/1; clients: 2/2; routes: `sispag.ts` coberto por 2 arquivos de teste; jobs: `CalcularPerfilCanalJob` coberto por `calcular-perfil-canal.test.ts`; errors (8 classes): 0 testes próprios (exercitadas indiretamente); probes/validate scripts (4): 0 | ≥ 50% geral; 80% nas camadas de domínio | ✅ | `git diff --name-only origin/main...HEAD` |
| Arquivos de teste no delta | 42 (35 backend + 7 frontend) para ~52 fontes backend/frontend não-teste tocados | ≥ 0.5 | ✅ (≈0.8) | `git diff --name-only` |
| Cobertura por camada (lines/branches/functions) | ⚠️ **Não medível nesta rodada (`--quick`)**. Piso ratchet existente em `jest.config.cjs`: global 72/54/78; `./domain/service/` 88 lines / 60 branches | 80/70/80 em service e repository | ⚠️ | `src/backend/jest.config.cjs:39-50`; recomendação: rodar `npm test -- --coverage` na fase de consolidação |
| Invariantes I13a–m com teste nomeado `I13x` | 13/13 (I13a–m aparecem em 15 arquivos de teste; `VerificacaoTedPixService.test.ts` tem 7 menções, `DuplicateDetector.test.ts` 4, `routes/sispag.verificacao.test.ts` 4) | 100% | ✅ | `grep -c "I13" **/*.test.ts` |
| Uso de DI por construtor nos testes do delta | Serviços testados com mocks injetados (`encerrar: jest.fn()` etc.); sem `container.resolve` nos testes novos de serviço | construtor > container | ✅ | `IngestaoPagamentosService.test.ts:83` |
| Testes de integração SQL (Postgres real) do delta | 1 arquivo de domínio (`VerificacaoTedPix.integration.test.ts`, 5 casos) + 2 migrações (`0078_*.integration.test.ts`, 0067 herdado); executam em CI no job `test:sql` | ≥ 1 por repositório com SQL complexo | ⚠️ (4 repositórios novos cobertos só por 5 cenários agregados) | `VerificacaoTedPix.integration.test.ts:101,140,224,256,284`; `ci.yml:62` |
| Fixtures gravadas para API externa | 1 (`__fixtures__/fin064-fil4-6173-6702.json`, fin064 real) + testes de client `ConexosSispagClient.test.ts`/`ConexosPagamentosRealizadosClient.test.ts` | por client novo | ✅ | `domain/service/sispag/__fixtures__/` |
| Leituras de tempo não abstraídas em fonte (delta) | 1 (`PerfilCanalService.ts:87`, mas com parâmetro `input.agora` injetável: efetivamente controlável) | 0 | ✅ | `grep 'new Date()\|Date.now()'` |
| Sites de aleatoriedade em fonte (delta) | 6 (`randomUUID` em `AlertaItemLoteRepository`, `BloqueioDuplicidadeRepository`, `VerificacaoEventoRepository`, 2 cada) | 0 sem provedor | ⚠️ | `grep randomUUID domain/repository/sispag` |
| Testes com rede real | 0 no delta (clients testados com fixture/mocks; `*.e2e.hml*.integration.test.ts` ficam fora do CI por desenho) | 0 | ✅ | `ci.yml:32-34` |
| Maiores arquivos de teste (backend/sispag) | `RemessaService.test.ts` 2367, `routes/sispag.test.ts` 1562, `LotePagamentoService.test.ts` 901, `SispagPainelService.test.ts` 869; no delta novo: `VerificacaoTedPixService.test.ts` 531 | ≤ 500 | ⚠️ | `wc -l` |
| Testes no CI e coverage gate | `npm test -- --coverage` + `test:sql` em `ci.yml`; `coverageThreshold` backend e frontend presentes | presente | ✅ | `.github/workflows/ci.yml:29,62` |
| Testes frontend do delta | 7 arquivos para 8 fontes tocados (`ConferenciaLoteDialog`, `LoteCard` x2, `ResolverDuplicidadeDialog`, `pendencias-cadastro/page`, `app-nav`, `permissoes`, `sispag` lib) | ≥ 0.5 | ✅ | `git diff --name-only` |
| Property-based (`fast-check`) no delta | 0 (nenhum uso em sispag) | oportunístico | ⚠️ | `grep fast-check` |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Regras puras extraídas (`ConferenciaLoteRule`, `ChannelProfileCalculator`, `DuplicateDetector`) testáveis sem I/O; `PerfilCanalService` aceita `agora` | ✅ presente | `libs/sispag/ConferenciaLoteRule.ts`, `PerfilCanalService.ts:87` |
| Recordable Test Cases | Fixture real de fin064 (`fil4-6173-6702`); sem fixture de cmn025 (cadastro de destino) | ⚠️ parcial | `__fixtures__/fin064-fil4-6173-6702.json` |
| Sandbox | Job `test:sql` com Postgres em contêiner; testes de HML do Conexos isolados do CI; script `validate-sispag-verificacoes-ted-pix-v1.ts` como validação manual | ✅ presente | `ci.yml:32-64` |
| Executable Assertions | Erros de domínio tipados (`SelfConferenceError`, `PendingDuplicateAlertError`, `DuplicateHoldError`…) mapeados para HTTP e testados na rota | ✅ presente | `routes/sispag.verificacao.test.ts:196` |
| Abstract Data Sources | Repositórios injetados via tsyringe; serviços testados com mocks | ✅ presente | `IngestaoPagamentosService.test.ts:83` |
| Limit Structural Complexity | `routes/sispag.ts` 1163 LOC, `VerificacaoTedPixService` 490 LOC (7 invariantes num serviço); testes de 500+ LOC | ⚠️ parcial | `wc -l` |
| Limit Non-Determinism | Sem `Date.now`/`new Date()` solto nos serviços; `randomUUID` direto nos repositórios (6 sites); ordem de teste sem `beforeAll` compartilhado detectado nos novos | ⚠️ parcial | greps acima |

## 4. Findings

### F-testability-1: Integração SQL do delta concentra 13 invariantes em 5 cenários "caminho feliz"

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/sispag/VerificacaoTedPix.integration.test.ts:101-284`
- **Evidência (objetiva)**:
  ```
  it('alerta: criar, reconfirmar, resolver JUSTIFICADA e fechar OBSOLETA, com trilha')
  it('lote: verificação do item, remoção pelo sistema, conferir e devolver')
  it('bloqueio: criar (idempotente por título), formação ignora o título, ingestão encerra')
  it('pendência: abrir, acrescentar origem sem duplicar, resolver só pelo sistema')
  it('perfil: upsert da rodada substitui só o recalculado')
  ```
  Cada `it` junta vários passos; nenhum cobre concorrência (duas verificações simultâneas, I13k "no máximo uma ABERTA por favorecido+tipo") nem a unicidade de bloqueio `ATIVO` sob corrida.
- **Impacto técnico**: uma falha num passo mascara os seguintes; garantias que dependem de índice único parcial no Postgres só são provadas sequencialmente. Os testes unitários dos repositórios usam mocks de `query`, que não validam o SQL.
- **Impacto de negócio**: pendência de cadastro duplicada ou bloqueio duplicado gera ruído na fila da analista e retrabalho; o gate de duplicidade (pagamento em dobro) é o ponto de maior valor financeiro da feature.
- **Métrica de baseline**: 5 casos de integração para 4 repositórios novos e 13 invariantes; 0 casos de concorrência.

### F-testability-2: Aleatoriedade (`randomUUID`) acoplada nos repositórios

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `AlertaItemLoteRepository.ts`, `BloqueioDuplicidadeRepository.ts:109`, `VerificacaoEventoRepository.ts`
- **Evidência (objetiva)**:
  ```
  import { randomUUID } from 'node:crypto';   // 3 repositórios, 6 ocorrências
  const id = randomUUID();
  ```
- **Impacto técnico**: testes de repositório não podem afirmar o `id` gerado sem `jest.spyOn` em módulo nativo; testes de trilha (I13m) ficam menos precisos.
- **Impacto de negócio**: baixo; custo é de manutenção dos testes.
- **Métrica de baseline**: 6 sites de `randomUUID` sem provedor injetável.

### F-testability-3: Arquivos grandes sob teste e sob o teste

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/routes/sispag.ts` (1163 LOC), `routes/sispag.test.ts` (1562), `VerificacaoTedPixService.ts` (490) / `.test.ts` (531), `RemessaService.test.ts` (2367, tocado pelo delta)
- **Evidência (objetiva)**:
  ```
  2367 RemessaService.test.ts | 1562 routes/sispag.test.ts | 901 LotePagamentoService.test.ts | 531 VerificacaoTedPixService.test.ts
  ```
- **Impacto técnico**: setup compartilhado extenso, difícil localizar qual teste defende qual invariante; a rota de 1163 LOC mistura roteamento com mapeamento de erro.
- **Impacto de negócio**: custo crescente de cada mudança em SISPAG (frente II, a mais exercida em produção).
- **Métrica de baseline**: 5 arquivos de teste > 500 LOC no diretório sispag; 1 rota com > 1000 LOC.

### F-testability-4: Cobertura do delta não é guardada por piso por arquivo e scripts/errors ficam sem teste

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/jest.config.cjs:39-50`; `jobs/probe-*.ts`, `jobs/validate-sispag-verificacoes-ted-pix-v1.ts`; `domain/errors/*Error.ts` (8 novas)
- **Evidência (objetiva)**:
  ```
  coverageThreshold: global 72/54/78; ./domain/service/ 88 lines, 60 branches
  (sem entrada para ./domain/repository/ nem ./domain/libs/sispag/)
  ```
- **Impacto técnico**: uma regressão de cobertura em repositórios ou na regra de conferência não derruba o CI. Os 4 scripts de probe/validação (manuais) e as 8 classes de erro não têm teste direto.
- **Impacto de negócio**: baixo; probes são descartáveis, e os erros são cobertos indiretamente pelos testes de rota.
- **Métrica de baseline**: 0 pisos por diretório para `domain/repository` e `libs/sispag`; 4 scripts + 8 erros sem teste direto. Cobertura real: não medida (`--quick`).

## 5. Cards Kanban

### [testability-1] Quebrar e ampliar a integração SQL da verificação TED/PIX

- **Problema**
  > A integração SQL do delta tem 5 cenários longos, em sequência, para 13 invariantes e 4 repositórios. Nada prova sob concorrência que existe no máximo uma `PendenciaCadastro` ABERTA por (favorecido, tipo) ou um `BloqueioDuplicidade` ATIVO por título.

- **Melhoria Proposta**
  > Em `VerificacaoTedPix.integration.test.ts`, dividir cada cenário em casos independentes (setup por teste) e adicionar casos: duas aberturas concorrentes de pendência (`Promise.all`), dois bloqueios simultâneos, `OBSOLETA` na troca de contraparte (I13h) e `desfazer` com motivo auditado (I13g). Tactic: Sandbox.

- **Resultado Esperado**
  > Casos de integração do delta 5 → ~14; invariantes com prova em Postgres real (I13g, h, k) 3 → 3 com cenário de corrida; 0 casos de concorrência → 2.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Casos de integração SQL do delta: 5 → 14
  - Casos de concorrência: 0 → 2
- **Risco de não fazer**: Uma regressão do índice único passa no CI e a fila da analista acumula pendências duplicadas.
- **Dependências**: nenhuma (job `test:sql` já existe).

### [testability-2] Injetar gerador de ids nos repositórios do sispag

- **Problema**
  > Três repositórios novos chamam `randomUUID()` direto (6 sites), então os testes não controlam ids nem afirmam a trilha com precisão.

- **Melhoria Proposta**
  > Criar `IdProvider` (`@singleton() @injectable()`) em `domain/libs/` e injetá-lo em `AlertaItemLoteRepository`, `BloqueioDuplicidadeRepository`, `VerificacaoEventoRepository`. Tactic: Limit Non-Determinism.

- **Resultado Esperado**
  > Sites de aleatoriedade sem provedor no delta 6 → 0; testes de repositório afirmam o id exato.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - `randomUUID` direto em `repository/sispag/`: 6 → 0
- **Risco de não fazer**: Cada novo repositório copia o padrão; o custo de teste da trilha cresce.
- **Dependências**: nenhuma.

### [testability-3] Dividir `routes/sispag.ts` e os testes de 500+ LOC

- **Problema**
  > `routes/sispag.ts` tem 1163 LOC e `routes/sispag.test.ts` 1562; `RemessaService.test.ts` chega a 2367. O custo de cada mudança em SISPAG inclui navegar esses arquivos.

- **Melhoria Proposta**
  > Extrair as rotas de verificação/conferência/pendências para `routes/sispagVerificacao.ts` (o teste `sispag.verificacao.test.ts` já aponta o corte) e mover os erros → HTTP para um mapeador testável. Partir `VerificacaoTedPixService.test.ts` por invariante (I13a–j). Tactic: Limit Structural Complexity.

- **Resultado Esperado**
  > Maior arquivo de rota 1163 → < 600 LOC; arquivos de teste > 500 LOC em `sispag/` 5 → ≤ 3.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - LOC de `routes/sispag.ts`: 1163 → < 600
  - Testes > 500 LOC em sispag: 5 → 3
- **Risco de não fazer**: O arquivo de rota passa de 1500 LOC na próxima feature de SISPAG.
- **Dependências**: nenhuma.

### [testability-4] Cobrir repositórios e regra de conferência com piso de cobertura

- **Problema**
  > O piso de cobertura cobre `./domain/service/` (88/60) mas não `./domain/repository/` nem `./domain/libs/sispag/`, onde estão a regra de segunda pessoa (I13l) e o SQL do gate de duplicidade.

- **Melhoria Proposta**
  > Rodar `npm test -- --coverage` uma vez, anotar a cobertura real e adicionar entradas em `coverageThreshold` para `./domain/repository/sispag/` e `./domain/libs/sispag/` (piso = medido, arredondado para baixo, como o comentário do arquivo prescreve). Adicionar testes diretos de 1 linha para as 8 classes de erro (nome e código HTTP) se o piso exigir. Tactic: Executable Assertions.

- **Resultado Esperado**
  > Diretórios do delta com piso de cobertura 0 → 2; regressão de cobertura nesses diretórios passa a quebrar o CI.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Entradas de `coverageThreshold` por diretório do delta: 0 → 2
- **Risco de não fazer**: A cobertura de repositório decai sem aviso no ciclo seguinte.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Cobertura (`--coverage`) e execução de testes não foram rodadas (`--quick`); as razões vêm de `git diff` e `grep`. Os números de cobertura real ficam como "não medível nesta rodada".
- Nenhum P0/P1: as 13 invariantes I13a–m têm teste nomeado, existe integração SQL em CI e as regras são testadas por construtor/mocks. A lacuna é de profundidade (concorrência) e de tamanho.
- Cross-QA: `randomUUID`/`agora` injetável liga a Modifiability; `test:sql` e `coverageThreshold` ligam a Deployability; testes de conferência/devolução (L8, L12, L13) ligam a Fault Tolerance; fixture fin064 liga a Integrability.
