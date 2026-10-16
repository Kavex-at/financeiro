---
qa: Testability
qa_slug: testability
run_id: 2026-10-15-0130
agent: qa-testability
generated_at: 2026-10-15T01:30:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Testability — Regis-Review (reduzido ao delta ADR-0072)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança no motor de sugestão (nova regra de reserva, novo corte top-N) | `MotorSugestaoBoleto`, `BoletoSuggestionService.confirmar`, rotas `/sugestoes-boleto/*` | CI, jest, sem Conexos nem banco real (exceto `test:sql`) | Teste falha com asserção de resultado sobre a invariante I15m/I15n/I15o violada | 100% das invariantes de segurança monetária com ao menos 1 asserção de resultado; 0 regressões silenciosas no passo 2 |

## 2. Métricas observadas

Escopo: delta (`git diff origin/main HEAD`, 52 arquivos, +5215/-194). Cobertura por camada do repo inteiro não foi rodada (revisão reduzida); a tabela é do delta.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| #1 Razão teste/fonte por camada do delta | service: 4 fontes tocados / 4 com .test.ts alterado; routes: `sispag.ts` / `sispag.sugestaoBoleto.test.ts`; errors: 1 novo / 1 teste; jobs: 1 novo (+entry) / 1 teste; repository: unit + integration estendidos; frontend: 5 arquivos .ts/.tsx de produção / 7 arquivos de teste novos ou alterados | ≥ 0,5 | ✅ | `git diff origin/main HEAD --stat` |
| Cobertura line/branch por diretório | Não medível neste run (`--coverage` não executado) | 80% lines / 70% branches em `domain/service` | ⚠️ | Requer `npm test -- --coverage` |
| Baseline de suítes | backend 257 suites / 4809; `test:sql` 20 / 164; frontend 1058 (2 suites quebradas por dependência ausente no symlink) | verde | ✅ (ressalva) | `_shared-metrics.md` |
| I15m: 7 situações com asserção de resultado | UNICA_SEGURA, SO_ATENCAO, AMBIGUA, SO_FRACA, SO_VENCIDA, DISPUTADA, SEM_CANDIDATO: 7/7 no motor; 4/7 na listagem do serviço | 7/7 | ✅ | `MotorSugestaoBoleto.test.ts:541-796`, `BoletoSuggestionService.test.ts:1137-1180` |
| Top-3 por título | 1 caso (5 candidatos → 3, Δvalor 1,2,4, `totalCandidatos=5`); painel "mostrando 3 de N" | ≥1 | ✅ | `MotorSugestaoBoleto.test.ts:799`, `SugestaoBoletoPainel.desfecho.test.tsx:106` |
| Exibível ≠ confirmável (409/422) | SO_FRACA 409 com `code`; AMBIGUA 409 e destrava ao rejeitar; DISPUTADA 409 (só status); caso A 422 `OverdueBoletoNotConfirmable` mesmo com ack; trava no serviço contra regra pura "confirmável" | 5 situações | ✅ | `BoletoSuggestionService.test.ts:1269-1331,1392` |
| I15o: ack 422 e ack registrado | 422 `WarningAcknowledgementRequiredError` no serviço e na rota; grava `VENCE_ANTES_DO_TITULO`+`RECONHECEU_VENCE_ANTES`; evento `reconheceu`; conferido contra reavaliação, não cache; ack espúrio não grava; idempotência sem ack; JSONB no teste SQL | todos | ✅ | `BoletoSuggestionService.test.ts:1333-1415`, `sispag.sugestaoBoleto.test.ts:284-340`, `SugestaoBoletoRepository.integration.test.ts:184` |
| Invariância à permutação do motor | 1 teste, 4×4 itens, 3 ordenações fixas | propriedade (fast-check) | ⚠️ | `MotorSugestaoBoleto.test.ts:811` |
| Perdedor da disputa = DISPUTADA; fraco não reserva | DISPUTADA nunca SEM_CANDIDATO; fraco/vencido não reservam (boleto compartilhado) | todos | ✅ | `MotorSugestaoBoleto.test.ts:698-765` |
| Não-regressão do passo 2 (I17) | 4 testes: conjunto vinculável pinado (14), Δdias<0 segue INELEGIVEL `DATA_ANTES_DO_TITULO`, situação/âncora/ack não entram, guarda estática no fonte | mesmo conjunto antes/depois | ✅ | `domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.test.ts` (+113) |
| Fallback de resposta legada no frontend | schema aceita resposta sem campos novos; `desfechoPorTitulo` reconstrói da lista antiga; sinais novos não quebram o parse | coberto | ✅ | `sispag.sugestaoBoleto.test.ts:233,255`, `sugestaoBoleto.desfecho.test.ts:232` |
| Golden de `sugerir()` inalterado | `MotorSugestaoBoleto.test.ts`: 0 linhas removidas no diff (só adições) | 0 remoções | ✅ | `git diff origin/main HEAD -- ...MotorSugestaoBoleto.test.ts` |
| Fontes de não-determinismo novas | tempo injetado; desempate por chave; sem `Math.random` | 0 | ✅ | leitura dos testes |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `motor.desfechos()` e `analisar()` expõem a saída por título | ✅ presente | `MotorSugestaoBoleto.test.ts:811` |
| Recordable Test Cases | "14 casos reais do pool" e números da medição em `it.each`, copiados à mão, sem fixture gravada | ⚠️ parcial | `sugestaoBoleto.desfecho.test.ts:181` |
| Sandbox | Motor puro, repo mockado, SQL em Postgres real para sinais JSONB | ✅ presente | `SugestaoBoletoRepository.integration.test.ts:184` |
| Executable Assertions | Trava no serviço independente da regra pura; guarda estática de elegibilidade | ✅ presente | `BoletoSuggestionService.test.ts:1317` |
| Abstract Data Sources | Relógio e pool DDA injetados na entrada | ✅ presente | helpers `entrada({...})` |
| Limit Structural Complexity | testes de ~860 e ~1440 linhas | ⚠️ parcial | `wc -l` |
| Limit Non-Determinism | sem relógio/aleatório novos; permutação testada por exemplo | ⚠️ parcial | F-testability-1 |

## 4. Findings

### F-testability-1: invariância à permutação testada por exemplo, não por propriedade

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.test.ts:811-837`
- **Evidência (objetiva)**:
  ```
  4 títulos x 4 boletos, 3 ordenações fixas (de 576 x 24 possíveis)
  ```
- **Impacto técnico**: desempate da disputa (menor vencimento, docCod) e do top-3 provado em 3 permutações; desempate dependente de ordem em empate triplo passaria.
- **Impacto de negócio**: o motor decide qual título leva o boleto; resultado dependente da ordem do sync mudaria a sugestão entre execuções.
- **Métrica de baseline**: 3 permutações; `fast-check` é dependência, 0 uso no backend.

### F-testability-2: DISPUTADA 409 sem `code`; confirmar em SEM_CANDIDATO sem teste dedicado

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.test.ts:1299-1316`
- **Evidência (objetiva)**:
  ```
  rejects.toMatchObject({ statusCode: 409 })  // sem code/userMessage, ao contrário de SO_FRACA
  ```
- **Impacto técnico**: o código de erro pode mudar sem teste vermelho; o frontend depende dele.
- **Impacto de negócio**: baixo; o bloqueio (nada gravado) está pinado.
- **Métrica de baseline**: 1 de 4 casos de recusa com `code` asserido.

### F-testability-3: arquivos de teste grandes

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `BoletoSuggestionService.test.ts` (~1440 linhas), `MotorSugestaoBoleto.test.ts` (~860)
- **Evidência (objetiva)**: +345 e +337 linhas neste delta sobre arquivos já acima de 500.
- **Impacto técnico**: serviço acumula cache, confirmar, anular, copiar e desfecho no mesmo arquivo.
- **Impacto de negócio**: custo de manutenção crescente a cada tweak do SISPAG.
- **Métrica de baseline**: 2 arquivos acima de 800 linhas.

Nenhum P0: toda invariante monetária do escopo (não confirmar não-seguro, ack no servidor, passo 2 intocado, golden intacto) tem asserção de resultado.

## 5. Cards Kanban

### [testability-1] Converter invariância à permutação em propriedade com fast-check

- **Problema**
  > A invariância do motor à ordem de entrada é provada com 3 permutações fixas sobre 4×4 itens.
- **Melhoria Proposta**
  > Adicionar `fc.property` com gerador de títulos/boletos de valores e datas colidentes, comparando `desfechos()` sob `fc.shuffledSubarray`. Tactic: Limit Non-Determinism.
- **Resultado Esperado**
  > Permutações verificadas: 3 → 100+ aleatórias com empates forçados.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - testes property-based no backend: 0 → 1
- **Risco de não fazer**: desempate dependente de ordem passa despercebido até produção.
- **Dependências**: nenhuma

### [testability-2] Asserir `code` no 409 de DISPUTADA e cobrir confirmar em SEM_CANDIDATO

- **Problema**
  > O 409 da disputa só verifica o status.
- **Melhoria Proposta**
  > Estender o teste com `code` e `userMessage` e adicionar caso de confirmar em SEM_CANDIDATO.
- **Resultado Esperado**
  > Casos de recusa com `code` asserido: 1/4 → 4/4.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - casos 409 com `code`: 1/4 → 4/4
- **Risco de não fazer**: mudança de código de erro quebra o frontend sem teste vermelho.
- **Dependências**: nenhuma

### [testability-3] Dividir BoletoSuggestionService.test.ts por responsabilidade

- **Problema**
  > ~1440 linhas misturam cache, confirmar, anular, copiar linha e desfecho.
- **Melhoria Proposta**
  > Separar em `*.desfecho.test.ts`, `*.confirmar.test.ts`, `*.cache.test.ts` com helper `montar` compartilhado.
- **Resultado Esperado**
  > Maior arquivo de teste do serviço: ~1440 → < 500 linhas.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - arquivos de teste > 800 linhas no serviço: 2 → 0
- **Risco de não fazer**: o arquivo continua crescendo a cada tweak.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: delta ADR-0072; `--coverage` e a suíte não foram executados (revisão reduzida); baseline vem do `_shared-metrics.md`.
- "Mesmo conjunto vinculável antes/depois" é pinado por literal (14), não por execução shadow contra o commit base.
- Cross-QA: guarda estática da elegibilidade toca Modifiability; ack conferido no servidor toca Security.
