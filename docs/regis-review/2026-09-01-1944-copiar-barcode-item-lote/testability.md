---
qa: Testability
qa_slug: testability
run_id: 2026-09-01-1944
agent: qa-testability
generated_at: 2026-09-01T19:44:00-03:00
scope: all
score: 6
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev alterando o `LoteCard.tsx` (a UI que colou o botão de copiar), o `ConexosSispagWriteClient` (que lê `itsNumCodbar` do fin015) ou o `SispagPainelService.linhasDigitaveisDoLote` (que compõe a lista) | Refactor local — trocar o nome do endpoint, mudar o schema Zod, alterar o handler `copiarLinha` para trocar `clipboard.writeText` por `execCommand`, ou reagir a mudança do payload do grid `finItemSispag` do Conexos | Delta desta feature: `LoteCard.tsx` +62, `ConexosSispagWriteClient.{ts,test.ts}` +141, `SispagPainelService.{ts,test.ts}` +117, `routes/sispag.{ts,test.ts}` +61 | Desenvolvimento local pré-commit; CI `npm test` no PR | Suíte falha se e só se o comportamento observável mudou; regressões no handler de UI, na regra "nunca logar 47 dígitos" e no gate de role são pegas em segundos | `# testes cobrindo o handler de UI (copiarLinha) = 0/1`; `# testes que carregam a fixture real do fin015 grid = 0/1`; `# campos declarados no contract test do fin015-item-lote / campos que o cliente lê = 5/6` (falta `itsNumCodbar`) |

> Interpretação: no backend a feature é bem testada (13 casos novos, todos com constructor injection, mock por porta, sem estado compartilhado). O flanco descoberto é o frontend (nenhum teste toca `src/frontend/app/sispag/`) e o contract test do grid do fin015, que documenta 5 dos 6 campos que o cliente novo lê. Uma mudança do Conexos no `itsNumCodbar` passa no `npm test` do dia, e a analista descobre no dia do pagamento.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes por arquivo — delta backend | 3 testes / 4 sources tocadas | 1:1 nos arquivos com lógica | ✅ | `git diff main --stat` |
| Testes por arquivo — delta frontend | 0 testes / 2 sources tocadas (`LoteCard.tsx`, `lib/sispag.ts`) | ≥ 1 por componente com estado/handler novo | ❌ | `find src/frontend/app/sispag -name '*.test.*'` → vazio |
| Casos novos backend / LOC novas backend | 13 casos / 254 LOC | ≥ 1 caso por ~30 LOC de lógica | ✅ | `git diff main` (5+5+3) |
| Casos novos frontend / LOC novas frontend | 0 casos / 62 LOC (LoteCard) + 19 LOC (lib/sispag) | ≥ 3 casos (happy path, `clipboard` reject, fetch fail) | ❌ | git diff |
| Ratio de arquivos-teste frontend (global) | 25 test / 73 tsx (0.34) | ≥ 0.5 | ⚠️ | `find src/frontend -name '*.test.tsx'` vs `find … -name '*.tsx' -not -name '*.test.tsx'` |
| Ratio de arquivos-teste frontend em `app/sispag/` | 0/4 (0.00) | ≥ 0.5 | ❌ | `find src/frontend/app/sispag -name '*.test.tsx'` |
| Ratio de arquivos-teste backend (global) | 128 test / 266 source (0.48) | ≥ 0.5 | ⚠️ | `find src/backend -name '*.test.ts'` vs source |
| Constructor injection nos testes do delta | 3/3 (100%) | 100% (per CLAUDE.md "test the service layer") | ✅ | leitura de `.test.ts` do delta — nenhum `container.resolve` em test unit; o único `container.registerInstance` é no `routes/sispag.test.ts`, que é o test de HTTP handler e é o uso correto |
| Fixtures Recordable Test Cases para o grid novo (`fin015 finItemSispag/list`) | 1 fixture existe (`2026-08-25-fin015-item-lote.json` contém `itsNumCodbar: null`); 0 teste consome | ≥ 1 caso carregando a fixture | ⚠️ | `sed -n '80,90p' src/backend/domain/interface/sispag/__fixtures__/2026-08-25-fin015-item-lote.json` |
| Campos declarados no contract test do `fin015-item-lote` | 5 (`filCod`, `docCod`, `titCod`, `itsCodSeq`, `flpCod`) | 6 (adicionar `itsNumCodbar`) | ❌ | `sed -n '99,110p' src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts` |
| Executable Assertion de segurança no delta | 1 caso: `nunca loga a linha digitável completa` (`SispagPainelService.test.ts:449-457`) | ≥ 1 por invariante de segurança | ✅ | `grep 'nunca loga' SispagPainelService.test.ts` |
| Executable Assertion de autorização no delta | 1 caso: `403 para viewer` em `GET /sispag/lotes/:id/linhas-digitaveis` (`routes/sispag.test.ts:154-164`) | ≥ 1 por endpoint que expõe destino de pagamento | ✅ | idem |
| Estado compartilhado entre casos (`beforeAll`/`afterAll` sem reset) | 0 nos 3 test files novos | 0 | ✅ | `grep 'beforeAll\|afterAll'` nos 3 files retorna vazio |
| Chamadas de rede reais nos unit tests do delta | 0 (mesmo o `routes/sispag.test.ts` sobe um Express local com `container.registerInstance` — bootstrap do container mockado) | 0 | ✅ | `sed -n '7,12p' src/backend/routes/sispag.test.ts` |
| Não-determinismo: leituras de tempo em source tocada | 1 (`SispagPainelService.ts:85` — `Date.now()` para diasAteVencimento; NÃO exercitado pelos casos novos, mas é dívida sistêmica) | 0 (injetar `ClockProvider`) | ⚠️ | `grep 'Date.now()' src/backend/domain/service/sispag/SispagPainelService.ts` |
| Cobertura de linha/branch (backend/frontend) | ⚠️ **Não medível** neste run — `--quick` proíbe rodar `--coverage` | domain/service ≥ 80% linha, ≥ 70% branch | ⚠️ | política do run |
| Testes property-based (`fast-check`) tocando o delta | 0 | ≥ 1 sobre o regex `\d{47}` da linha digitável (46, 48, 47 com letra, 47 com espaço, vazio) | ⚠️ | `grep 'fast-check' src/backend/package.json src/frontend/package.json` → **não é dep direta**; só aparece como transitiva no `package-lock.json`. O tactic é possível mas exige adicionar a dep |

> ⚠️ **Não medível localmente**: cobertura de linha/branch por camada. Requer `npm test -- --coverage` (5–10 min neste repo). Recomendação: `--quick` deste run não roda, mas o Kanban `testability-1` pede que o próximo run cheio rode e publique.

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Backend delta: services e client instanciados diretamente com mocks tipados (`buildBase()`, `make(over)`), 100% constructor injection. Frontend delta: `LoteCard` recebe `busy`/`acao`/`onAdicionar` por prop (bom seam) — mas ninguém consome esse seam num teste. | ⚠️ parcial | `src/backend/domain/client/ConexosSispagWriteClient.test.ts:8-25` (builders); `src/frontend/app/sispag/components/LoteCard.tsx:96-108` (props) sem consumidor de teste |
| Recordable Test Cases | Repo tem `__fixtures__/` redigidas do Conexos com o envelope real; `contrato.test.ts` verifica o shape. Delta adiciona um NOVO campo lido (`itsNumCodbar`) do grid `finItemSispag`, mas **não** o registra em `CONTRATOS.campos`. | ⚠️ parcial | `src/backend/domain/interface/sispag/__fixtures__/2026-08-25-fin015-item-lote.json` linha 18 tem o campo; `contrato.test.ts:99-110` não lista |
| Sandbox | `sispag.test.ts` usa `jest.mock('../domain/appContainer.js')` para não subir Postgres/Conexos reais; sobe um Express `listen(0)` e derruba no `afterEach`. Delta backend não faz chamada de rede real. Frontend `copiarLinha` usa `navigator.clipboard` — objeto do browser, exige jsdom + patch em teste (ainda não escrito). | ✅ presente (backend) / ❌ ausente (frontend do delta) | `src/backend/routes/sispag.test.ts:7-12,68-82` |
| Executable Assertions | Delta traz 2 assertions muito específicas: (a) `nunca loga a linha digitável completa` (invariante de segurança — a linha traz agência/conta/valor do cedente); (b) `403 para viewer` no endpoint das linhas. Ambas são o padrão exemplar Bass. | ✅ presente | `SispagPainelService.test.ts:449-457`; `routes/sispag.test.ts:154-164` |
| Abstract Data Sources | Backend: `PostgreeDatabaseClient` e `ConexosBaseClient` injetados; testes trocam por mock trivialmente. Frontend: `LoteCard` usa `fetchLinhasDigitaveis`/`fetchContasPagadoras`/`fetchModalidadesDisponiveis` importados diretamente do módulo — não passam por DI/prop, então testar exige `jest.mock('@/lib/sispag')`, o que ainda funciona mas amarra o teste ao path do módulo. | ⚠️ parcial | `src/frontend/app/sispag/components/LoteCard.tsx:25-48` (imports diretos) |
| Limit Structural Complexity | `SispagPainelService.ts` bateu 429 LOC (o test file passou 457). O serviço acumulou 4 responsabilidades (`montarPainel`, `listRetornos`, `modalidadesDisponiveisDoLote`, `linhasDigitaveisDoLote`). Não é P0 — os 4 pontos de entrada têm test bloco próprio — mas o próximo delta que tocar aqui vai lidar com um arquivo em zona de refactor. | ⚠️ parcial | `wc -l src/backend/domain/service/sispag/SispagPainelService.ts` = 429 |
| Limit Non-Determinism | Delta em si é determinístico (não usa `Date.now()`, `Math.random()`, ordem de fila). Mas herda o débito sistêmico: `SispagPainelService.ts:85` lê `Date.now()` para calcular `diasAteVencimento`. Nenhum teste do delta exercita esse ramo, então o débito não morde AGORA — vai morder no primeiro teste de KPI que quiser fixar uma janela de vencimento. | ⚠️ parcial | `grep 'Date.now()' src/backend/domain/service/sispag/SispagPainelService.ts` |
| Property-based testing | `fast-check` **não é dep direta** neste repo (só aparece como transitiva). O boundary novo (regex `\d{47}` da linha digitável) é candidato natural (46, 48, 47 com letra, 47 com espaço, com caractere Unicode) mas hoje é coberto por 1 caso ad-hoc (`omite item cujo barcode não tem 47 dígitos`). | ⚠️ parcial | `grep 'fast-check' src/*/package.json` → vazio (só lock file) |
| CI gate (tests block PR merge) | ⚠️ **Não medível** neste run — não abri `.github/workflows/`; a métrica sai da revisão de deployability. | ⚠️ | fora do escopo do delta |

## 4. Findings

### F-testability-1: `LoteCard.tsx` cresceu 62 LOC (estado, `useEffect` de fetch, `copiarLinha` com `navigator.clipboard`) sem NENHUM teste

- **Severidade**: P1 (alto — o handler novo é o entregável visível da feature; regressão hoje = a analista descobre no click)
- **Tactic violada**: Specialized Interfaces + Executable Assertions
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx` (delta +62 LOC, sem test file)
- **Evidência (objetiva)**:
  ```bash
  $ find src/frontend/app/sispag -name '*.test.*'
  # (vazio)
  $ git diff main --stat -- src/frontend/app/sispag/components/LoteCard.tsx
  # 62 LOC adicionadas: contas state, useEffect(fetchContasPagadoras),
  # disponíveis state, useEffect(fetchModalidadesDisponiveis),
  # linhas state, useEffect(fetchLinhasDigitaveis),
  # copiarLinha handler (com try/catch), botão condicional por i.modalidade === 'BOLETO'
  ```
  Os 3 casos que caberiam:
  1. Happy path: `linhas.get('100:1')` presente → click chama `navigator.clipboard.writeText('1'*47)` → toast `'Linha digitável copiada'` com descrição SEM os 47 dígitos.
  2. Rejeição do clipboard (`writeText` rejeita → toast de erro; nenhum crash).
  3. `fetchLinhasDigitaveis` falha → o `.catch(() => setLinhas(new Map()))` esvazia o mapa; o botão de copiar **não** aparece.
- **Impacto técnico**: qualquer refactor do handler (ex.: trocar `try/await` por `.then()`, ou mover o fetch pra dentro do click) passa no `npm test`. A regra "toast não repete os 47 dígitos" — que existe explicitamente no backend (`SispagPainelService.test.ts:449-457`) — não tem gêmea no frontend, onde o toast é composto.
- **Impacto de negócio**: um bug no botão de copiar não derruba pagamento, mas destrói a razão de ser da feature (colar no gerenciador do banco). Se o clipboard não copiar e o toast disser "copiado", a analista cola o conteúdo do clipboard anterior — pior que erro visível.
- **Métrica de baseline**: 0 testes / 62 LOC delta; ratio de tests do `app/sispag/` = 0/4 (0.00).

### F-testability-2: contract test do `fin015-item-lote` não declara `itsNumCodbar` — o campo que a feature INTEIRA depende

- **Severidade**: P1 (alto — o único mecanismo do repo para pegar breaking change do Conexos passa reto pelo campo novo)
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:99-110`
- **Evidência (objetiva)**:
  ```typescript
  {
      fixture: 'fin015-item-lote',
      consumidor: 'ConexosSispagWriteClient.listarChavesDoLote (retomada de import parcial)',
      campos: [
          'filCod', 'docCod', 'titCod', 'itsCodSeq', 'flpCod',
      ],
      // FALTA: 'itsNumCodbar' — lido em ConexosSispagWriteClient.ts:431
      //   linhaDigitavel: parsed.data.itsNumCodbar,
      // O `consumidor` também está desatualizado: agora inclui `listarLinhasDigitaveisDoLote`.
  }
  ```
  A fixture `2026-08-25-fin015-item-lote.json` **contém** `itsNumCodbar: null` (linha 18). Ou seja, o dado real do ERP já foi capturado; só falta o contrato de leitura declarar que o campo é lido.
- **Impacto técnico**: se o Conexos renomear `itsNumCodbar` (não é impensável — o grid tem `itsMnyValor`, `itsEspMyid`, e a família `its*` já mudou de nome duas vezes segundo o registro do próprio `contrato.test.ts:65-70`), o Zod `regex(/^\d{47}$/)` do `LINHA_DIGITAVEL_SCHEMA` rejeita CADA linha silenciosamente (`safeParse` + `continue`) e `listarLinhasDigitaveisDoLote` devolve `[]`. Combinado com o service (`SispagPainelService.linhasDigitaveisDoLote`, que absorve erro em `[]`+warn — comportamento correto e testado), a UI simplesmente para de mostrar o botão de copiar. Zero teste falha.
- **Impacto de negócio**: silêncio operacional. A analista abre o lote, esperava ver o botão de cópia (é a promessa da feature), e ele não está lá. Sem sinal automático, o time descobre por chamado — semanas depois. Este é exatamente o modo de falha que o `contrato.test.ts` foi criado para pegar (ver o próprio comentário do `ausentesConhecidos` no bloco de `fin015-titulo-pendente`, linhas 66-70).
- **Métrica de baseline**: 5/6 campos declarados no contrato do `fin015-item-lote` (`itsNumCodbar` ausente).

### F-testability-3: os 5 casos de `listarLinhasDigitaveisDoLote` são 100% mock — nenhum consome a fixture real

- **Severidade**: P2 (médio — os mocks provam a lógica do parser, não o formato do grid)
- **Tactic violada**: Sandbox (uso incompleto — a fixture existe, ninguém a carrega)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.test.ts:499-568`
- **Evidência (objetiva)**:
  ```typescript
  base.listGenericPaginated.mockResolvedValue({
      rows: [
          { docCod: '10400', titCod: '1', itsNumCodbar: '1'.repeat(47) },
          { docCod: '10500', titCod: '1', itsNumCodbar: null },
      ],
  });
  ```
  Compare com `contrato.test.ts:172-180`, que carrega o JSON real e provas o shape. Nenhum dos 5 casos do delta faz isso — todos constroem `rows` sintéticos com só os 3 campos que interessam ao caso, quando o grid real tem 50+ colunas.
- **Impacto técnico**: se a paginação real do fin015 vier com `{ data: { rows: [...] } }` (envelope duplo, que o próprio `LOTE_CRIADO_SCHEMA` já sabe desembrulhar em outro endpoint da mesma família — `ConexosSispagWriteClient.ts:23-33`) em vez do `{ rows: [...] }` esperado, o mock aceita e o real falha. É a mesma classe do bug que o `preprocess` acima corrige em `POST fin015`.
- **Impacto de negócio**: primeira ocorrência em HML fica invisível até um humano abrir o lote; em produção o botão some silenciosamente (F-testability-2 já cobre esse modo).
- **Métrica de baseline**: 0 casos de `listarLinhasDigitaveisDoLote` que carregam `2026-08-25-fin015-item-lote.json`.

### F-testability-4: `Date.now()` em `SispagPainelService.ts:85` sem injeção — débito herdado que o delta amplifica

- **Severidade**: P3 (baixo — os testes do delta não dependem de hora; é dívida sistêmica que já existia)
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:85`
- **Evidência (objetiva)**:
  ```typescript
  const now = Date.now();
  // …
  diasAteVencimento: t.vencimento !== undefined
      ? Math.round((t.vencimento - now) / DAY_MS)
      : undefined,
  ```
  O test `montarPainel` do delta driblou o problema fixando `vencimento: Date.now() + 3 * DAY` no builder — reintroduzindo não-determinismo pela porta dos fundos (o `Date.now()` do test e o do service correm em momentos ligeiramente diferentes). Funciona hoje porque o intervalo (7 dias) é generoso e a janela (3 dias) tem folga; **quebra** no dia em que alguém escrever um caso `>= 7 && < 8 dias`.
- **Impacto técnico**: teste flaky de fronteira só sob carga do CI. O delta não introduziu esse débito, mas cimentou o padrão.
- **Impacto de negócio**: nenhum agora; risco baixo de CI vermelho sem causa aparente no futuro.
- **Métrica de baseline**: 1 leitura de tempo em `SispagPainelService.ts` (fora de teste); 0 `ClockProvider` no repo.

### F-testability-5: `fast-check` não é dep direta — o boundary novo (regex 47 dígitos) fica em 1 caso ad-hoc

- **Severidade**: P3 (baixo — o comportamento é correto; a cobertura é rasa)
- **Tactic violada**: — (uma tactic Bass adicional; não é `Limit Non-Determinism` nem `Executable Assertions` stricto sensu, mas é a versão property-based de ambos)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:80-90` (schema) e `.test.ts:530-548` (caso único de rejeição)
- **Evidência (objetiva)**:
  ```
  $ grep '"fast-check"' src/backend/package.json src/frontend/package.json
  # (vazio — só transitiva no package-lock.json)
  ```
  O caso ad-hoc é o único: `itsNumCodbar: '111'` (3 dígitos, rejeitado). Não cobre: 46 dígitos, 48 dígitos, 47 com letra no meio, 47 com espaço, string com caractere Unicode (`'٠'.repeat(47)` — o `\d` do JavaScript é ambíguo aqui e o regex do arquivo é `/^\d{47}$/`, portanto Unicode aritmético entra).
- **Impacto técnico**: exemplos ausentes; o próximo bug do regex vai passar por baixo do teste único.
- **Impacto de negócio**: baixo — o Zod já é conservador (rejeita e omite); um input malicioso resulta em botão ausente, não em pagamento errado.
- **Métrica de baseline**: 1 caso / 5+ classes de input relevantes.

## 5. Cards Kanban

### [testability-1] Escrever teste de `LoteCard` cobrindo o handler `copiarLinha`

- **Problema**
  > O delta adicionou 62 LOC no `LoteCard.tsx` com estado (`contas`, `disponiveis`, `linhas`), três `useEffect` de fetch e o handler `copiarLinha` que chama `navigator.clipboard.writeText` e emite `toast.success`. Nenhum teste toca `src/frontend/app/sispag/` — o ratio é 0/4. A promessa central da feature (copiar sem repetir os 47 dígitos no toast) é verificada só por olho.

- **Melhoria Proposta**
  > Criar `src/frontend/app/sispag/components/LoteCard.test.tsx` com Testing Library + jsdom, patchando `navigator.clipboard.writeText` via `Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn() } })` e mockando `@/lib/sispag` por `jest.mock`. Casos mínimos: (1) happy path — botão de copiar aparece quando `i.modalidade === 'BOLETO'` E `linhas.get(chave)` está setado; click chama `writeText('1'*47)` uma vez e emite `toast.success` cuja descrição **não contém** `'1'*47`; (2) `writeText` rejeita → `toast.error` sem crash; (3) `fetchLinhasDigitaveis` rejeita → botão nunca renderiza. Tactic Bass: **Executable Assertions** + **Specialized Interfaces** (o próprio `LoteCard` já expõe seams via props — o teste consuma-os).

- **Resultado Esperado**
  > `# testes cobrindo LoteCard = 0 → ≥ 3`; `ratio de tests do app/sispag = 0/4 → 1/4`; regra "toast não repete os 47 dígitos" passa a ter gêmea no frontend, simétrica ao caso existente no `SispagPainelService.test.ts:449-457`.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes cobrindo `LoteCard.tsx`: 0 → 3
  - Ratio de arquivos-teste em `src/frontend/app/sispag/`: 0.00 → 0.25
  - Invariante "descrição do toast não contém a linha completa" verificada por 1 assertion tipada
- **Risco de não fazer**: qualquer refactor do handler passa verde e a analista descobre no click; falha silenciosa do fetch fica indistinguível de "lote sem boleto".
- **Dependências**: nenhuma

### [testability-2] Adicionar `itsNumCodbar` ao contract test do `fin015-item-lote`

- **Problema**
  > `contrato.test.ts` foi criado exatamente para pegar breaking change do grid do Conexos. O `CONTRATOS.fixture: 'fin015-item-lote'.campos` lista 5 campos (`filCod`, `docCod`, `titCod`, `itsCodSeq`, `flpCod`) mas a feature nova lê um SEXTO — `itsNumCodbar` — que a fixture `2026-08-25-fin015-item-lote.json` já traz (com valor `null`). Se o Conexos renomear o campo, o `LINHA_DIGITAVEL_SCHEMA.safeParse` rejeita silenciosamente, `listarLinhasDigitaveisDoLote` devolve `[]`, o serviço absorve em `[]`+warn, a UI para de mostrar o botão. Zero teste falha.

- **Melhoria Proposta**
  > Editar `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:99-110`: adicionar `'itsNumCodbar'` à lista `campos` e atualizar `consumidor` para incluir `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote`. Nada mais precisa mudar — a fixture já contém o campo. Tactic Bass: **Recordable Test Cases** (é o mecanismo já em uso no repo, só ampliar).

- **Resultado Esperado**
  > `# campos declarados no contrato do fin015-item-lote / campos lidos pelo cliente = 5/6 → 6/6`; se o Conexos remover ou renomear `itsNumCodbar`, o `ainda devolve os campos lidos por ...` falha no CI antes do PR merge.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P1
- **Esforço estimado**: S (≤1h)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Campos declarados no contrato: 5 → 6
  - MTTR percebido de breaking change do fin015 no campo `itsNumCodbar`: "descoberto pela analista em produção" → "PR falha no CI"
- **Risco de não fazer**: bug de silêncio operacional — a UI simplesmente para de oferecer o botão, sem alerta.
- **Dependências**: nenhuma

### [testability-3] Adicionar 1 caso de `listarLinhasDigitaveisDoLote` que carregue a fixture real (Sandbox → boundary)

- **Problema**
  > Os 5 casos novos de `ConexosSispagWriteClient.test.ts:499-568` são mocks sintéticos: `{ rows: [{ docCod, titCod, itsNumCodbar }] }` com só os 3 campos que interessam. O grid real do fin015 tem 50+ colunas (visíveis em `2026-08-25-fin015-item-lote.json`). Se o envelope real vier com `{ data: { rows: [...] } }` (padrão que o próprio `LOTE_CRIADO_SCHEMA` do arquivo já corrige em outro endpoint da mesma família), o mock aceita e o real falha em HML.

- **Melhoria Proposta**
  > Adicionar 1 caso na suíte `listarLinhasDigitaveisDoLote`: carregar `2026-08-25-fin015-item-lote.json` via `readFileSync`, mockar `base.listGenericPaginated` para devolver `{ rows: [fixture.linha, {...fixture.linha, itsNumCodbar: '1'.repeat(47)}] }`, e assertar que a chamada devolve 1 item (o primeiro tem `itsNumCodbar: null`, o segundo tem uma linha válida). Isso amarra o parser ao SHAPE real do grid — mudança no ERP quebra o teste. Tactic Bass: **Sandbox** (fixture redigida como referência controlada).

- **Resultado Esperado**
  > `# casos de listarLinhasDigitaveisDoLote que consomem fixture real = 0 → 1`; regressão de envelope (`{data:{rows}}` vs `{rows}`) é pega no CI, não em HML.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: S (≤2h)
- **Findings relacionados**: F-testability-3, F-testability-2
- **Métricas de sucesso**:
  - Casos consumindo `2026-08-25-fin015-item-lote.json`: 0 → 1
  - Cobertura do envelope `{ rows: [...] }` vs `{ data: { rows: [...] } }`: implícita → explícita
- **Risco de não fazer**: mocks divergem do real — a família de bugs que o `LOTE_CRIADO_SCHEMA` já teve que corrigir uma vez, mas para leitura.
- **Dependências**: idealmente após `testability-2` (contrato atualizado dá segurança à fixture)

### [testability-4] Cobrir o regex `\d{47}` com testes de fronteira (46, 48, letra, espaço, Unicode)

- **Problema**
  > O boundary da linha digitável (`LINHA_DIGITAVEL_SCHEMA` em `ConexosSispagWriteClient.ts:80-90`) tem 1 caso ad-hoc de rejeição (3 dígitos). Faltam as fronteiras (46, 48), o caso "47 posições com uma letra no meio", "47 com espaço", e o caso Unicode (`\d` do JS regex aceita `٠` — 0 arábico). O comportamento é correto (rejeita + omite), mas a cobertura é rasa.

- **Melhoria Proposta**
  > Adicionar 5 casos parametrizados via `it.each` cobrindo cada fronteira. Não requer dep nova — `fast-check` não é dep direta neste repo (só transitiva), e `it.each` do Jest é suficiente. Tactic Bass: **Executable Assertions** (versão parametrizada).

- **Resultado Esperado**
  > `# classes de input relevantes cobertas / total = 1/5 → 5/5`; regressão do regex é pega no CI.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1h)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Casos parametrizados sobre `\d{47}`: 1 → 5
- **Risco de não fazer**: baixo — o próximo bug do regex passa por baixo, mas o modo de falha é "botão ausente", não "pagamento errado".
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo estritamente delta (`--quick`). Cobertura por camada NÃO foi coletada — o run é `--quick` e o custo de `npm test -- --coverage` neste repo (114 suítes / 1616 testes backend + 25/189 frontend) fura o orçamento; a métrica ficou marcada como "não medível localmente" em §2.
- `fast-check` **não é dep direta** deste repo (contrariamente ao contexto herdado): só aparece como transitiva no `package-lock.json`. Ajustei o card `testability-4` para usar `it.each` do Jest, evitando forçar uma dep nova para um débito P3.
- Cross-QA detectados: F-testability-2 (Recordable Test Cases) reforça Integrability; F-testability-4 (Date.now sem clock) empurra Modifiability; F-testability-1 (`LoteCard` sem teste) empurra Modifiability do frontend; a assertion "nunca loga a linha completa" e o `403 para viewer` são pontes com Security. O consolidator deve ligar `testability-2` ↔ card equivalente de Integrability.
- Positivo a destacar no consolidator: 3/3 test files do delta usam constructor injection direta (aderente a CLAUDE.md), 0 estado compartilhado entre casos, 2 executable assertions muito específicas (segurança + autorização). O backend do delta é sólido; o rombo é o frontend.
