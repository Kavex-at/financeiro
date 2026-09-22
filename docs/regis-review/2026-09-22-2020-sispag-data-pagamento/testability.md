---
qa: Testability
qa_slug: testability
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-testability
generated_at: 2026-09-22T20:00:00-03:00
scope: backend + frontend (delta de `fix/sispag-data-pagamento`, `git diff origin/main...HEAD`)
score: 8
findings_count: 3
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG, no diálogo "Gerar remessa" | Escolhe (ou omite) uma `dataDebito` fora da janela `[hoje BRT, menor vencimento] ∩ dias úteis`, ou o lote já tem um lote nativo do fin015 com outra data congelada | `DebitDateService` + `RemessaService.gerarRemessa` + `BankingCalendar` | Lote `FINALIZADO`; pode haver tentativa anterior falha em retomada (`error`/`reconciling`); fuso BRT ≠ UTC (o bug original era exatamente este) | Sistema barra a escrita ANTES de qualquer POST no ERP (fail-closed), devolve `DebitDateOutsideWindowError`/`DebitDateFrozenError` tipado com `motivo` estruturado | 100% dos motivos de recusa (`nao_util`, `antes_de_hoje`, `depois_do_vencimento`, `titulo_vencido`, `sem_dia_util`, `titulo_sem_vencimento`, `diferente`, `no_passado`) têm caso de teste direto — medido por leitura de `DebitDateService.test.ts` e do describe `data de débito (I8, ADR-0049)` em `RemessaService.test.ts` |

## 2. Métricas observadas

**Métrica #1 — Cobertura por camada, arquivos de lógica tocados no delta (file-level, contagem manual do diff):**

| Camada | Fontes de lógica tocadas | Arquivos de teste dedicados | Ratio | Status | Fonte |
|---|---|---|---|---|---|
| `domain/errors` (novo) | 2 (`DebitDateFrozenError.ts`, `DebitDateOutsideWindowError.ts`) | 1 (`DebitDateErrors.test.ts`, cobre os 2 com `describe` próprio para cada) | 100% | ✅ | leitura direta |
| `domain/libs/calendar` (novo) | 1 (`BankingCalendar.ts`) | 1 (`BankingCalendar.test.ts`, 35 casos via `it.each`) | 100% | ✅ | leitura direta |
| `domain/repository/sispag` (modificado) | 1 (`LotePagamentoRepository.ts`) | 1 (5 casos novos, todos mock-based) | 100% arquivo, **0% execução real de SQL** | ⚠️ | ver F-testability-2 |
| `domain/service/sispag` (novo + modificado) | 2 (`DebitDateService.ts` novo, `RemessaService.ts` modificado) | 2 (`DebitDateService.test.ts` 27 casos; describe `data de débito` em `RemessaService.test.ts` ~20 casos) | 100% | ✅ | leitura direta |
| `routes` (modificado) | 1 (`sispag.ts`, nova rota `GET .../janela` + Zod em `POST .../remessa`) | 1 (`sispag.test.ts`, +150 linhas, 7 casos novos) | 100% | ✅ | leitura direta |
| `jobs/*` (modificado) | 2 (`execute-fin015-prd.ts`, `validate-retomada-remessa-v1.ts`) | 0 | 0% | N/A — convenção do repo: `jobs/` são "scripts de job/probe rodados à mão", não cobertos por `.test.ts` (CLAUDE.md) | `find src/backend/jobs -name '*.test.ts'` → vazio |
| `frontend/components/sispag` (novo + modificado) | 2 (`GerarRemessaDialog.tsx` novo, `LoteCard.tsx` modificado) | 1 (só `GerarRemessaDialog.test.tsx`, 11 casos) | **50%** | ⚠️ | ver F-testability-1 |
| `frontend/app/sispag` (modificado) | 1 (`page.tsx`, 2 branches novas de erro→toast) | 0 | **0%** | ⚠️ | `find src/frontend/app/sispag -name 'page.test.tsx'` → vazio; ver F-testability-1 |
| `frontend/lib` (modificado) | 1 (`sispag.ts`) | 1 (`sispag.test.ts`, estendido) | 100% | ✅ | leitura direta |
| **Total do delta (excl. tipos/SQL/jobs)** | **10** | **8** | **80%** | ✅ (alvo ≥ 50%, heurística do template) | soma acima |

> ⚠️ **Não medível localmente (percentual de linhas/branches por diretório)**: `--quick` não rodou `npm test -- --coverage`. `_shared-metrics.md` confirma `144 suites` (backend) / `48 suites` (frontend) passando, mas não o breakdown percentual por diretório. O piso já existe e é enforced: `src/backend/jest.config.cjs` tem `coverageThreshold` global (`lines: 72, branches: 54, functions: 78`) e um piso mais alto só para `./domain/service/` (`lines: 88, branches: 60`) — os dois arquivos de serviço tocados neste delta (`DebitDateService.ts`, `RemessaService.ts`) já caem sob esse piso mais estrito. Recomendação: rodar `cd src/backend && npm test -- --coverage --silent` numa próxima passada não-`--quick` e anexar o delta de cobertura do diretório `domain/service/sispag` especificamente.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Casos de teste novos/estendidos dedicados a I8/I8b (backend) | ≈ 60 (`DebitDateService.test.ts` 27 + describe `data de débito` em `RemessaService.test.ts` ~20 + `DebitDateErrors.test.ts` 6 + `sispag.test.ts` 7) | — (referência) | ✅ | contagem manual de `it(`/`it.each` |
| `RemessaService.test.ts` — LOC | 1452 | ≤ 500 (heurística Limit Structural Complexity) | ⚠️ | `wc -l` |
| Testes de integração (`describe('integration:`) em `domain/repository/**` | 0 (repo inteiro, não só o delta) | ≥ 1 por repositório com SQL complexo | ⚠️ | `grep -rln "describe(.integration" src/backend --include="*.test.ts"` → vazio |
| Infra de teste com Postgres real (`docker-compose*test*`, `scripts/*test-pg*`) | ausente | presente | ⚠️ | `find . -iname "*docker-compose*test*"` → vazio |
| Leituras de `new Date()`/`Date.now()` fora de teste, no delta | 1 (`BankingCalendar.ts:41`, é o próprio ponto de injeção — `private clock: () => Date = () => new Date()`) | 0 "vazamentos" não abstraídos | ✅ | `grep -n "new Date()" <arquivos do delta>` |
| `Math.random`/`crypto.random*` no delta (fora de teste) | 0 | 0 | ✅ | grep |
| Testes usando injeção via construtor (`new XService(mock as any)`) nos arquivos do delta | 100% dos testes de serviço/rota (`make()` em `RemessaService.test.ts`, `DebitDateService.test.ts`) | maioria | ✅ | leitura de `make()` |
| `container.resolve` em arquivos `.test.ts` do delta | 0 | 0 em unit tests | ✅ | grep |
| Chamadas de rede real (`axios.`/`fetch(`) em testes do delta | 0 | 0 | ✅ | grep |
| `beforeAll`/`afterAll` (estado compartilhado) nos 6 arquivos de teste novos/tocados centrais | 0 | 0 | ✅ | grep por arquivo |
| Asserção de log em caminho de erro/aviso (`log.warn`/`log.info`) | presente — caso "lote legado" (`log.warn`) e caso dry-run (`log.info`) em `RemessaService.test.ts` | presente nos caminhos de erro relevantes | ✅ | `RemessaService.test.ts:1404-1419`, `:1444-1448` |
| CI roda os testes como gate | presente (`.github/workflows/ci.yml`) | presente, bloqueante | ✅ | `grep -rn "npm test\|jest" .github/workflows` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `BankingCalendar.withClock(clock)` — factory estático que injeta um relógio fixo só para teste, sem mexer no construtor de produção | ✅ presente | `src/backend/domain/libs/calendar/BankingCalendar.ts:44-48`; usado em todo `DebitDateService.test.ts` e no `make()` de `RemessaService.test.ts` |
| Recordable Test Cases | Builders locais (`item()`, `lote()`, `janela()`) fazem o papel de fixture reutilizável para os objetos de domínio; o delta não toca o `ConexosSispagWriteClient` na camada HTTP, então não há gravação de payload real do ERP aqui | ⚠️ parcial — N/A para o client HTTP porque este delta não o modifica; a lacuna de fixtures do Conexos é pré-existente, fora de escopo | `DebitDateService.test.ts:12-33`, `RemessaService.test.ts` (`buildWrite`, `buildLote` etc.) |
| Sandbox | O flag de dry-run (`dryRunOverride`/`conexosDryRun`) já existia e foi estendido para cobrir a validação de `dataDebito` antes de qualquer escrita | ✅ presente | `RemessaService.test.ts:1422-1450` (`describe('dry-run')` dentro de `data de débito`) |
| Executable Assertions | Erros de domínio (`DebitDateOutsideWindowError`, `DebitDateFrozenError`) expõem `code`/`statusCode`/`retryable`/`details` estruturados — os testes fazem `toMatchObject`/`toBeInstanceOf` sobre esses campos, não `toContain` em string solta (exceto `userMessage`, que é conteúdo para humano e é testado à parte) | ✅ presente | `DebitDateErrors.test.ts`, `RemessaService.test.ts:1192` (`rejects.toMatchObject({ code, details: { motivo } })`) |
| Abstract Data Sources | Toda a cadeia de serviço/rota testada com o repositório e o client mockados via interface (`jest.fn()`); nenhum teste de serviço toca Postgres real | ✅ presente para unit tests — mas é also o motivo do gap de F-testability-2: a abstração nunca é "furada" por um teste de integração que confirme o `to_char`/`::date` real | `LotePagamentoRepository.test.ts` (`buildDb()`), `RemessaService.test.ts` (`make()`) |
| Limit Structural Complexity | Split correto do novo: `DebitDateService` nasceu como classe própria (194 LOC) em vez de crescer dentro de `RemessaService`. Mas o dispatch de `resolverDataDebito` ficou inline em `RemessaService.ts`, que já era (por nota do `_shared-metrics.md`) o arquivo com maior complexidade cognitiva do backend, e seu teste chegou a 1452 LOC | ⚠️ parcial | ver F-testability-3; `_shared-metrics.md` linha 49 ("`RemessaService.gerarRemessaSerializado` já era o maior") |
| Limit Non-Determinism | `hojeUtc()` (meia-noite UTC, a causa raiz do bug original) foi removido de `RemessaService.ts` e dos dois jobs, substituído por `BankingCalendar` injetável via tsyringe/`withClock`. Zero leitura de `new Date()`/`Date.now()` não abstraída no delta | ✅ presente, exemplar | `RemessaService.ts:1033` (diff, função antiga removida); `BankingCalendar.ts:41-48`; `jobs/execute-fin015-prd.ts`, `jobs/validate-retomada-remessa-v1.ts` (ambos passaram a usar `container.resolve(BankingCalendar)`) |

## 4. Findings (achados)

### F-testability-1: Nova interação de UI (abrir diálogo, mapear erro para toast) sem nenhum teste de componente/página

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces / Executable Assertions (camada de apresentação)
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:250-262` (estado `gerandoRemessa`, botão que abre `<GerarRemessaDialog>`), `src/frontend/app/sispag/page.tsx:370-383` (dois `else if` novos: `DebitDateOutsideWindowError` → toast, `DebitDateFrozenError` → toast)
- **Evidência (objetiva)**:
  ```
  $ find src/frontend/app/sispag -name "*.test.tsx" -o -name "*.test.ts"
  src/frontend/app/sispag/components/GerarRemessaDialog.test.tsx

  # LoteCard.tsx (modificado, +50/-24 linhas neste delta) e page.tsx (modificado,
  # +15 linhas neste delta) não têm arquivo de teste.
  ```
  `GerarRemessaDialog.test.tsx` injeta `acao` como `jest.fn()` — testa o diálogo isolado, nunca o `acao` real que `LoteCard.tsx` passa (que chama `gerarRemessa` de fato e constrói o toast de sucesso). O mapeamento `DebitDateOutsideWindowError`/`DebitDateFrozenError` → mensagem de toast em `page.tsx` também não tem asserção própria — só existe cobertura indireta de que `sispagRequest` lança a classe certa (`src/frontend/lib/sispag.test.ts:105-129`).
- **Impacto técnico**: uma regressão em `LoteCard.tsx` (ex.: o botão parar de abrir o diálogo, ou `onOpenChange` não fechar depois do sucesso) ou em `page.tsx` (a condição `e instanceof DebitDateFrozenError` nunca bater por causa de um `instanceof` que quebra com bundling/transpile diferente) passaria pela suíte inteira sem nenhum teste vermelho.
- **Impacto de negócio**: a mensagem "Data de débito já fixada no Conexos (fin015)" é o que diz à analista para cancelar o lote nativo em vez de tentar de novo — se cair no branch genérico de erro, ela perde a instrução acionável e pode reabrir um chamado com a Kavex por algo que a UI já sabia explicar.
- **Métrica de baseline**: 2 de 4 arquivos de lógica de frontend tocados neste delta têm teste dedicado (50%, ver tabela da seção 2).

### F-testability-2: Persistência da data de débito (`setDataDebito`, `to_char`/`::date`) sem nenhum teste de execução real contra Postgres

- **Severidade**: P1
- **Tactic violada**: Abstract Data Sources (levado ao limite — nunca "des-abstraído" por um teste de integração)
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts:494-508` (`setDataDebito`), `:197-201` e `:216-219` (`to_char(data_debito, 'YYYY-MM-DD') AS data_debito`)
- **Evidência (objetiva)**:
  ```
  $ grep -rln "describe(.integration" src/backend --include="*.test.ts"
  (vazio)
  $ find . -iname "*docker-compose*test*" -o -iname "*test-pg*"
  (vazio)
  ```
  Os 5 novos testes de `LotePagamentoRepository.test.ts` para `dataDebito` verificam a STRING do SQL (`expect(sql).toContain("to_char(data_debito, 'YYYY-MM-DD') AS data_debito")`) e os parâmetros passados ao mock — nunca executam a query contra um Postgres real.
- **Impacto técnico**: o bug original que esta feature corrige (`hojeUtc()` gravando meia-noite UTC, que o node-pg leria como o dia anterior em hora local) era exatamente um bug de "o SQL parece certo mas o encoding de data está errado". A doc da própria migration (`0061_lote_data_debito.sql`) alerta: "Lida sempre com `to_char(...)` para não passar pelo parse DATE -> Date local do node-pg" — é precisamente a classe de bug que um teste mock não pega, porque o mock nunca invoca o driver `pg` de verdade.
- **Impacto de negócio**: se o cast `::date`/`to_char` se comportar diferente do esperado em produção (ex.: timezone da sessão do pool divergente do assumido), a "data congelada" que a analista vê na tela pode não bater com o que está no Conexos — silenciosamente, porque nenhum teste executa esse caminho.
- **Métrica de baseline**: 0 testes de integração em `domain/repository/**` (repositório inteiro, não só o novo método); 0 infraestrutura de Postgres de teste (`docker-compose`/script) no repo.

### F-testability-3: `RemessaService.test.ts` chegou a 1452 LOC — maior arquivo de teste do backend, mistura ~16 responsabilidades num único `describe` de topo

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/sispag/RemessaService.test.ts` (1452 linhas, +321/-… neste delta)
- **Evidência (objetiva)**:
  ```
  $ wc -l src/backend/domain/service/sispag/RemessaService.test.ts
  1452 src/backend/domain/service/sispag/RemessaService.test.ts
  ```
  O arquivo cobre, no mesmo `describe('RemessaService', ...)` e mais 4 `describe` de topo adjacentes: gate de estado, idempotência/órfãos (12 casos), retry, boleto/DDA, integridade do `.REM`, e agora `data de débito (I8, ADR-0049)` (mais 20 casos). `_shared-metrics.md` já registrava, antes deste delta, que `RemessaService.gerarRemessaSerializado` era o método de maior complexidade cognitiva do lint.
- **Impacto técnico**: um `describe` de 1452 linhas é caro para navegar quando um teste falha em CI — o Jest aponta a linha, mas entender qual das ~16 responsabilidades quebrou exige ler o arquivo inteiro; o `make()` compartilhado (linha 183) acopla todos os cenários ao mesmo conjunto de mocks, então mudar a assinatura de um mock (ex.: `buildWrite()`) arrisca quebrar testes de áreas não relacionadas.
- **Impacto de negócio**: aumenta o custo (tempo) de qualquer `/feature-tweak` futuro que toque `RemessaService` — exatamente o "cost-multiplier" que a testabilidade deveria reduzir, e aqui está crescendo.
- **Métrica de baseline**: 1452 LOC vs. heurística de 500 LOC do template; o describe `data de débito` sozinho soma ~260 linhas dentro do arquivo.

## 5. Cards Kanban

### [testability-1] Cobrir a integração LoteCard → GerarRemessaDialog → toast de erro

- **Problema**
  > `LoteCard.tsx` ganhou o estado `gerandoRemessa` e o gatilho do diálogo, e `page.tsx` ganhou dois `else if` novos (`DebitDateOutsideWindowError`, `DebitDateFrozenError`) mapeando erro para toast — nenhum dos dois arquivos tem teste. `GerarRemessaDialog.test.tsx` só testa o diálogo com `acao` mockada, não a integração real.

- **Melhoria Proposta**
  > Criar `LoteCard.test.tsx` cobrindo pelo menos: clicar em "Gerar remessa (.REM)" abre o diálogo; `onOpenChange(false)` fecha; sucesso dispara o toast certo. Adicionar (ou estender um teste de `page.tsx` já existente no padrão dos outros 4 `page.test.tsx` do app) um caso por `instanceof` novo em `page.tsx`, renderizando o componente com `gerarRemessa` mockado para rejeitar com cada erro e asserindo o texto do toast (tactic: Executable Assertions, camada de apresentação).

- **Resultado Esperado**
  > Cobertura de arquivos de lógica de frontend do delta: 50% (2/4) → 100% (4/4). `LoteCard.tsx` e `sispag/page.tsx`: 0 casos de teste diretos → ≥ 3 e ≥ 2 respectivamente.

- **Tactic alvo**: Specialized Interfaces / Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Arquivos de lógica de frontend com teste dedicado no módulo sispag: 2/4 → 4/4
  - Casos de teste cobrindo `DebitDateOutsideWindowError`/`DebitDateFrozenError` na camada de apresentação: 0 → ≥ 2
- **Risco de não fazer**: uma regressão no mapeamento de erro→toast (ex.: mensagem genérica no lugar da instrução de cancelar o flp no fin015) só aparece em produção, quando a analista já não sabe o que fazer.
- **Dependências**: nenhuma.

### [testability-2] Adicionar teste de integração para o round-trip de `data_debito` (`to_char`/`::date`)

- **Problema**
  > `setDataDebito` e a leitura via `to_char(data_debito, 'YYYY-MM-DD')` só são verificados por asserção de string SQL contra um mock — nunca executados contra um Postgres real. Essa é exatamente a classe de bug (encoding de data/timezone) que esta feature existe para corrigir; o repositório inteiro (não só este método) não tem nenhum teste de integração, e o repo não tem infraestrutura de Postgres de teste.

- **Melhoria Proposta**
  > Provisionar um `docker-compose.test.yml` (ou script `scripts/test-pg.sh`) com um Postgres efêmero, e criar `describe('integration: LotePagamentoRepository', ...)` cobrindo no mínimo: `setDataDebito` seguido de `getLoteComItens`/`listLotes` devolve a MESMA string civil (`'YYYY-MM-DD'`) independentemente do timezone da sessão; `data_debito NULL` não aparece na chave do objeto. Tactic: Abstract Data Sources (fechar o ciclo — abstrair para unidade, mas também verificar a abstração pelo menos uma vez).

- **Resultado Esperado**
  > Testes de integração em `domain/repository/**`: 0 → ≥ 1 arquivo, ≥ 3 casos cobrindo o round-trip de `data_debito`. Infra de Postgres de teste: ausente → presente (reutilizável pelos próximos repositórios com SQL sensível a timezone).

- **Tactic alvo**: Abstract Data Sources / Sandbox
- **Severidade**: P1
- **Esforço estimado**: M (2-5d) — inclui provisionar a infra de Postgres de teste, que não existe hoje
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes de integração no repositório: 0 → ≥ 3
  - Infra de Postgres de teste (`docker-compose*test*` ou equivalente): ausente → presente
- **Risco de não fazer**: a próxima migration ou próximo `ALTER` numa coluna `DATE`/`TIMESTAMPTZ` do SISPAG repete o mesmo bug de encoding que motivou o ADR-0049, e só um teste mockado (que nunca falharia) protege contra isso.
- **Dependências**: decisão de onde a infra de Postgres de teste roda em CI (serviço no `.github/workflows/ci.yml` vs. `testcontainers`) — fica para o Yuri decidir o approach, não é escopo desta feature isolada.

### [testability-3] Quebrar `RemessaService.test.ts` por responsabilidade

- **Problema**
  > `RemessaService.test.ts` chegou a 1452 LOC — maior arquivo de teste do backend — misturando gate de estado, idempotência/órfãos, retry, DDA, integridade do `.REM` e agora data de débito no mesmo arquivo com um `make()` compartilhado. `RemessaService.ts` já era, antes deste delta, o método de maior complexidade cognitiva do lint (nota em `_shared-metrics.md`).

- **Melhoria Proposta**
  > Extrair o describe `data de débito (I8, ADR-0049)` (≈260 linhas) para `RemessaService.dataDebito.test.ts`, reaproveitando um `make()` local mais enxuto. Avaliar extrair também DDA e integridade do `.REM` para arquivos próprios. Tactic: Limit Structural Complexity — arquivo de teste espelha a decomposição que já foi feita no lado da produção (o `DebitDateService` nasceu como classe própria; o teste dele já é um arquivo próprio).

- **Resultado Esperado**
  > `RemessaService.test.ts`: 1452 LOC → ≤ 900 LOC, com o restante distribuído em 1-2 arquivos-satélite por responsabilidade, sem perder nenhum dos ~20 casos de `data de débito`.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — é extração de arquivo, não reescrita de caso
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - LOC de `RemessaService.test.ts`: 1452 → ≤ 900
  - Casos de teste preservados: 100% (nenhuma asserção perdida na extração)
- **Risco de não fazer**: cada `/feature-tweak` futuro em SISPAG paga o custo de navegar um arquivo de 1450+ linhas para entender o blast radius de uma mudança — o "cost-multiplier" que a testabilidade deveria reduzir cresce a cada feature.
- **Dependências**: nenhuma; pode ser feito em qualquer momento após este merge.

## 6. Notas do agente

- Escopo `--quick`: não rodei `npm test -- --coverage`; a tabela de cobertura por camada (seção 2) usa contagem de arquivos de teste vs. fontes de lógica no diff, não percentual de linhas/branches. Recomendo rodar coverage completo numa passada não-`--quick`.
- Cross-QA: `BankingCalendar.withClock` (Limit Non-Determinism) é o mesmo seam que a Modifiability deveria citar como exemplo de "clock injetável" — não duplicar a recomendação, só referenciar este achado positivo.
- Cross-QA: a nova rota `GET /sispag/lotes/:id/remessa/janela` é testada ponta a ponta (`sispag.test.ts`) e devolve um contrato espelhado no frontend (`JanelaDataDebito` em `lib/sispag.ts`) — isso é ao mesmo tempo Sandbox/Specialized Interfaces (testability) e um contrato de Integrability; falar com o `qa-integrability` antes de sugerir um contract test formal para não duplicar o card.
- Achado positivo notável (não virou card por não ser gap): `RemessaService.test.ts` já tem um `describe('serialização por lote (regis: fault-tolerance-1)')` — evidência de que o time já usa os achados de rodadas anteriores do Regis-Review como referência direta em nome de teste; sinalizar ao `qa-fault-tolerance` que a serialização por lote segue coberta.
