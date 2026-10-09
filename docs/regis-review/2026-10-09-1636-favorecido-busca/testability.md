---
qa: Testability
qa_slug: testability
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-testability
generated_at: 2026-10-09T17:00:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

Escopo: delta da branch `feat/sispag-favorecido-busca` contra `origin/main` (busca de favorecido no `cmn025` + prévia do destino). O número de repositório inteiro não foi remedido: `_shared-metrics.md` traz 250 arquivos de teste no backend e 88 suítes no frontend, e o gate verde (4.016 testes backend, 884+ frontend).

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na regra de busca (ex.: Conexos confirma `#LIKE` como "começa com", ou formato de `pdcDocFederal` diferente) | `ConexosSispagClient.buscarPessoas`, `PayeeSearchService`, `SolicitarAutorizacaoDialog` | Desenvolvimento, sem acesso ao Conexos (HML recusou o usuário) | Suíte detecta a regressão sem rede, sem banco e sem relógio real | 100% dos ramos do delta exercitados por teste determinístico; suíte do diálogo < 5 s; 0 chamadas de rede |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Tabela de cobertura por camada (delta)** — ver abaixo | ver abaixo | ≥ 80% linhas em `domain/service` | ⚠️ ver nota | análise estática do delta |
| Teste por arquivo-fonte novo (backend) | 1/1 (`PayeeSearchService.test.ts`, 5 casos) | ≥ 0,5 | ✅ | `wc -l`, `grep -c "it("` |
| Teste por arquivo-fonte novo (frontend) | 1/1 (`SolicitarAutorizacaoDialog.test.tsx`, 10 casos, 180 LOC) | ≥ 0,5 | ✅ | idem |
| Casos novos no delta | 5 (service) + 7 (client) + 2 (rota) + 4 (`destinoAtual`) + 10 (diálogo) = 28 | n/a | ✅ | grep de `it(` no diff |
| Métodos públicos novos sem teste | 0 de 4 (`buscarPessoas`, `buscar`, `destinoAtual`, `buscarFavorecidos` no front) | 0 | ✅ | leitura do diff |
| Injeção por construtor / DI | `PayeeSearchService` com 4 deps via `@inject`; rota registra `registerInstance(PayeeSearchService, { buscar })` | construtor/seam | ✅ | `sispag.favorecidos.test.ts:331` |
| Relógio / aleatoriedade no código-fonte novo | 0 `Date`/`Math.random`; 1 `setTimeout` (debounce 350 ms) | 0 não injetáveis | ⚠️ | `SolicitarAutorizacaoDialog.tsx:126` |
| Fake timers no teste do diálogo | 0 usos de `useFakeTimers` | usar para debounce | ⚠️ | grep no teste |
| Teste de coalescência do debounce (digitar várias vezes → 1 chamada) | 0 (os `toHaveBeenCalledTimes(1)` cobrem "sem nova busca", não digitação rápida) | 1 | ⚠️ | `SolicitarAutorizacaoDialog.test.tsx:75,140,149` |
| Fixture gravada do `cmn025/list` | 0 (`__fixtures__` inexistente; testes usam objetos inline) | 1 por client externo | ⚠️ | `ls src/backend/domain/client/__fixtures__` |
| Verificação ao vivo da semântica `#LIKE` / formato `pdcDocFederal` | não medida | 1 amostra gravada | ❌ | `_shared-metrics.md` (Bad Credentials em HML) |
| Teste de integração do `listarVigentesPorPesCods` | presente (`AuthorizedPayeeRepository.integration.test.ts:93`) | ≥ 1 | ✅ | grep |
| Piso de cobertura em CI (`domain/service/`) | backend 88% linhas / 60% branches; frontend global 33/23/28 | ≥ 70% | ✅ backend / ⚠️ frontend | `jest.config.cjs:39`, `jest.config.js:41` |
| Tamanho dos arquivos de teste novos | maior = 190 LOC | ≤ 500 | ✅ | `wc -l` |
| Rede real nos testes novos | 0 (`jest.mock('@/lib/sispag')`, `registerInstance`) | 0 | ✅ | leitura |

**Métrica observável #1 — cobertura por camada (delta).** ⚠️ **Não medível localmente por diretório com isolamento do delta**: o `--coverage` do repositório inteiro agrega ~52k linhas e não separa o delta; rodar de novo não acrescentaria sinal além do gate verde. Estimativa por casos por camada:

| Camada (delta) | Arquivos-fonte novos/alterados | Casos de teste no delta | Ramos sem caso |
|---|---|---|---|
| `domain/service/sispag` | `PayeeSearchService`, `AuthorizedPayeeService.destinoAtual` | 5 + 4 = 9 | `situacao` ausente; `nomeFantasia` ausente; vigente `PIX` sem `TED` (parcial) |
| `domain/client` | `ConexosSispagClient.buscarPessoas/mapPessoa` | 7 | termo só com espaços; CPF formatado com 11 dígitos sem linha (cai para o formatado) |
| `routes` / `http` | `sispag.ts`, `schemas.ts` | 2 (rota) + 1 (`routePermissions`) | corpo com termo > limite coberto no caso 1 |
| `frontend app` | `SolicitarAutorizacaoDialog` (444 LOC) | 10 | debounce real; teclado/foco; troca de modalidade durante prévia pendente |
| `jobs` | `probe-cmn025-busca-hml.ts` | 0 | sonda manual, recusa base não-HML (sem teste) |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Construtor injetável nos services; `registerInstance` na rota; mock de `@/lib/sispag` no front | ✅ presente | `PayeeSearchService.ts:50`, `sispag.favorecidos.test.ts:331` |
| Recordable Test Cases | Sem fixture gravada do `cmn025/list`; linhas inline escritas à mão | ⚠️ parcial | ausência de `__fixtures__` |
| Sandbox | Sonda `probe-cmn025-busca-hml.ts` recusa base não-HML; HML inacessível com a credencial atual | ⚠️ parcial | `_shared-metrics.md`, memória de credenciais |
| Executable Assertions | Zod nos boundaries (`pessoaRowSchema`, `documentoSchema`); teste de linha inválida descartada | ✅ presente | `ConexosSispagClient.ts` (`mapPessoa`) |
| Abstract Data Sources | Repositório e client atrás de classes injetáveis; SQL coberto por integração | ✅ presente | `AuthorizedPayeeRepository.integration.test.ts:93` |
| Limit Structural Complexity | Service com 85 LOC; porém diálogo com 444 LOC e múltiplos estados (busca, prévia, escolha, pedido) num só componente | ⚠️ parcial | `SolicitarAutorizacaoDialog.tsx` |
| Limit Non-Determinism | Sem `Date`/random; debounce por `setTimeout` direto, sem fake timers no teste | ⚠️ parcial | `SolicitarAutorizacaoDialog.tsx:126` |

## 4. Findings

### F-testability-1: Semântica do `#LIKE` e formato do documento sem fixture nem verificação ao vivo

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/client/ConexosSispagClient.test.ts` (bloco `buscarPessoas`, 7 casos); `src/backend/domain/client/ConexosSispagClient.ts` (`buscarPessoas`)
- **Evidência (objetiva)**:
  ```
  ls src/backend/domain/client/__fixtures__ -> inexistente
  buscarPessoas: 7 casos, todos com linhas inline escritas à mão
  _shared-metrics.md: "#LIKE ... e formato de pdcDocFederal não medidos ao vivo"
  ```
- **Impacto técnico**: os testes provam que o código monta o filtro que o autor imaginou, não que o Conexos o interpreta assim. Se `#LIKE` for "começa com" ou o documento vier em outro formato, 7 testes verdes e busca com resultado pobre.
- **Impacto de negócio**: o analista não acha o favorecido, volta a abrir o Conexos; o ganho da feature some sem erro visível.
- **Métrica de baseline**: 0 fixtures gravadas do `cmn025/list`; 0 de 2 premissas do ERP (`#LIKE`, `pdcDocFederal`) verificadas ao vivo.

### F-testability-2: Debounce testado com relógio real e sem caso de coalescência

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `SolicitarAutorizacaoDialog.tsx:126`; `SolicitarAutorizacaoDialog.test.tsx` (0 `useFakeTimers`)
- **Evidência (objetiva)**:
  ```
  const t = setTimeout(() => setTermoAplicado(termo), DEBOUNCE_BUSCA_MS)
  grep useFakeTimers no teste -> 0 ocorrências
  ```
- **Impacto técnico**: os casos dependem de `findBy`/`waitFor` esperarem 350 ms reais (timeout padrão 1000 ms): lentos e sensíveis a CI carregado. Nenhum caso digita 3 vezes e afirma 1 chamada, que é a razão de existir do debounce e do limite de taxa (gap conhecido: sem limite na rota).
- **Impacto de negócio**: regressão no debounce multiplicaria leituras no Conexos (1–2 por tecla) sob o teto de sessões, que já derrubou sessão viva em probe.
- **Métrica de baseline**: 0 casos de coalescência; ~9 casos do diálogo pagam 350 ms reais (≈ 3 s de espera acumulada estimada).

### F-testability-3: Diálogo concentra 4 estados em 444 LOC; piso de cobertura do frontend baixo

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `SolicitarAutorizacaoDialog.tsx` (444 LOC, reescrito +373/−37); `src/frontend/jest.config.js:41`
- **Evidência (objetiva)**:
  ```
  coverageThreshold.global: lines 33, branches 23, functions 28
  componente: busca + lista + prévia + pedido no mesmo arquivo
  ```
- **Impacto técnico**: para cobrir um ramo da prévia o teste monta o fluxo de busca inteiro; hook de busca (debounce + dedupe de termo) não é testável isolado.
- **Impacto de negócio**: custo de teste por mudança no pedido de autorização continua alto; piso de 33% não trava queda no frontend.
- **Métrica de baseline**: 444 LOC por componente; 10 casos; piso frontend 33% linhas.

### F-testability-4: Sonda de HML sem teste da guarda "recusa base não-HML"

- **Severidade**: P3
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/jobs/probe-cmn025-busca-hml.ts` (`process.exit(1)` em linhas 19 e 100)
- **Evidência (objetiva)**:
  ```
  2 saídas process.exit(1); 0 testes no arquivo
  ```
- **Impacto técnico**: a única barreira contra rodar a sonda em produção (memória: derruba sessão viva) é código sem cobertura.
- **Impacto de negócio**: sonda rodada em PRD cai o login do robô e congela leitura de carteira.
- **Métrica de baseline**: 0 testes; 2 caminhos de saída.

## 5. Cards Kanban

### [testability-1] Gravar fixture real do `cmn025/list` e fixar a semântica do `#LIKE`

- **Problema**
  > Os 7 casos de `buscarPessoas` usam linhas inline; a semântica do `#LIKE` e o formato de `pdcDocFederal` nunca foram vistos ao vivo, então os testes defendem uma suposição, não o contrato.

- **Melhoria Proposta**
  > Com credencial HML válida, rodar `probe-cmn025-busca-hml.ts` uma vez, gravar a resposta sanitizada em `src/backend/domain/client/__fixtures__/cmn025-list.json` e fazer os testes de `buscarPessoas` consumi-la. Adicionar caso que documente "contém" ou "começa com". Tactic: Recordable Test Cases.

- **Resultado Esperado**
  > Premissas do ERP cobertas por fixture: 0 → 2 (`#LIKE`, `pdcDocFederal`). Fixtures de client externo na busca: 0 → 1.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Fixtures gravadas do `cmn025/list`: 0 → 1
  - Premissas do ERP verificadas: 0/2 → 2/2
- **Risco de não fazer**: busca que acha menos do que o analista espera, sem alarme, e confiança errada em 7 testes verdes.
- **Dependências**: credencial HML válida (hoje Bad Credentials).

### [testability-2] Testar o debounce com fake timers e afirmar coalescência

- **Problema**
  > O debounce de 350 ms roda em tempo real nos testes e nenhum caso prova que digitação rápida gera uma única leitura no Conexos.

- **Melhoria Proposta**
  > Em `SolicitarAutorizacaoDialog.test.tsx`, `jest.useFakeTimers()` com `userEvent.setup({ advanceTimers })`; adicionar caso "3 teclas em < 350 ms → `buscarFavorecidos` 1 vez" e "pausa de 350 ms → dispara". Opcional: extrair `useDebouncedTerm`.

- **Resultado Esperado**
  > Casos de debounce com relógio controlado: 0 → 2; espera real acumulada na suíte do diálogo ≈ 3 s → ≈ 0 s.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Casos de coalescência: 0 → 2
  - `useFakeTimers` no teste do diálogo: 0 → 1
- **Risco de não fazer**: regressão no debounce multiplica leituras 1–2 por tecla sob o teto de sessões do Conexos.
- **Dependências**: nenhuma. Liga a Performance (carga no ERP) e Modifiability (relógio injetável).

### [testability-3] Cobrir a guarda da sonda e dividir o diálogo em hook + apresentação

- **Problema**
  > A guarda que impede rodar a sonda em produção não tem teste, e o diálogo de 444 LOC mistura busca, prévia e pedido, encarecendo cada caso.

- **Melhoria Proposta**
  > Extrair a checagem de base HML da sonda para função exportada num módulo e testar 2 casos (HML passa, não-HML recusa). Extrair o hook de busca do diálogo e testá-lo isolado. Subir o piso do frontend junto quando a cobertura subir.

- **Resultado Esperado**
  > Testes da guarda: 0 → 2. Diálogo: 444 LOC → ≤ 300 LOC com hook de busca testado isolado (0 → ≥ 4 casos).

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - Casos da guarda da sonda: 0 → 2
  - LOC do diálogo: 444 → ≤ 300
- **Risco de não fazer**: custo de teste por mudança no pedido permanece alto; uma sonda em PRD derruba a sessão do robô.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo só no delta; cobertura por camada é estimada por casos, não por `--coverage`, que agrega o repositório (~52k linhas) e não isola o delta. Nenhum finding P0/P1: não há baseline numérico que sustente.
- Pontos fortes a preservar: 28 casos novos, 0 rede, 0 `Date`/random, DI por construtor, integração SQL existente para `listarVigentesPorPesCods`, backend com piso 88% em `domain/service/`.
- Cross-QA: Integrability (fixture = contract test do `cmn025`), Performance (debounce e leitura 1–2 por termo), Security (POST para CPF/CNPJ fora da URL já testado), Modifiability (relógio injetável).
