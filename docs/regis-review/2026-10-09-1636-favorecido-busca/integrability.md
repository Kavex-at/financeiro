---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-integrability
generated_at: 2026-10-09T16:50:00-03:00
scope: all
score: 7.5
findings_count: 4
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Conexos muda o `#LIKE` do `cmn025/list` ("começa com" em vez de "contém"), o formato de `pdcDocFederal` ou o schema da linha de pessoa | `ConexosSispagClient.buscarPessoas` + `PayeeSearchService` + `SolicitarAutorizacaoDialog` | Produção, analista pedindo autorização de favorecido | A mudança é absorvida no client (1 arquivo), o schema Zod descarta a linha inválida e a busca degrada para "acha menos", não "erra" | <= 1 arquivo de produção tocado; 0 linhas inválidas vazando para a tela; regressão detectada por teste de fixture antes do deploy |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos HTTP genéricos expostos pelo client novo (`get/post/request`) | 0 (`buscarPessoas` é método de domínio; `listGenericPaginated` fica no `ConexosBaseClient`) | 0 | ✅ | `ConexosSispagClient.ts:773`, `ConexosBaseClient.ts:209` |
| Arquivos de service/rota/lambda do delta que importam axios/fetch | 0 (frontend usa `apiFetch` de `lib/http`) | 0 | ✅ | `grep axios\|fetch` no delta; `src/frontend/lib/sispag.ts:4` |
| Clients tocados pelo service novo | 1 (`ConexosSispagClient`) + 1 repositório + `MaskDestino` | <= 2 | ✅ | `PayeeSearchService.ts:44-49` |
| Zod na resposta externa nova | 1 schema de linha (`pessoaRowSchema`) + `documentoSchema` reaproveitado; linha inválida vira `undefined` | >= 80% | ✅ | `ConexosSispagClient.ts:229-238, 819-832` |
| Zod no corpo da rota nova | 1 schema (`termo`) em `http/schemas.ts` (+11 linhas) | 100% | ✅ | `routes/sispag.ts:578-590` |
| `process.env` cru no delta | 0 (usa `EnvironmentProvider.sispagCadastroFilCod`) | 0 | ✅ | `PayeeSearchService.ts:56` |
| Endpoint do Conexos com versão explícita | 0 de 1 (`cmn025/list` não tem versão na URL; a API não expõe) | N/A se o provedor não suporta | ⚠️ | `ConexosSispagClient.ts:794` |
| Teste de parsing com linha realista (fixture) para `buscarPessoas` | 1 bloco `describe`, ~121 linhas, linhas sintéticas escritas à mão; 0 respostas gravadas do ERP | 100% fixture real em integração instável | ⚠️ | `ConexosSispagClient.test.ts:442-560` |
| Semântica do `#LIKE` e formato de `pdcDocFederal` medidos ao vivo | 0 de 2 | 2 de 2 | ⚠️ | `_shared-metrics.md` (HML recusou credencial) |
| Leituras Conexos por busca | 1 a 3 sequenciais (texto: 2; documento sem achado: 2; sem paralelismo) | declarado | ✅ | `ConexosSispagClient.ts:808-812` |
| Padrão duplicado `performInit/tryAcquireLock` | 0 no delta (auth/retry via `ConexosBaseClient.runWithRetry`) | 0 | ✅ | `ConexosSispagClient.ts:792` |
| Chamadas de API no frontend sem wrapper | 0 novas (usam `apiFetch`) | 0 | ✅ | `src/frontend/lib/sispag.ts` (+48) |
| Terraform/SSM path convention | ⚠️ Não medível localmente: não existe `infra/` | 100% | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Toda a gramática do `cmn025` (campos, filtros `#EQ/#LIKE`, formato do documento) fica em `buscarPessoas`/`mapPessoa`; o service só vê `PessoaCadastro` | ✅ presente | `ConexosSispagClient.ts:773-832` |
| Use an Intermediary | `ConexosBaseClient` (sessão, retry) entre client e ERP; `PayeeSearchService` faz a ACL (documento mascarado, autorização local) | ✅ presente | `ConexosSispagClient.ts:792`, `PayeeSearchService.ts:67-78` |
| Restrict Communication Paths | Frontend só fala com a rota; a rota só com o service; o CPF/CNPJ completo não sai do backend (`MaskDestino`) | ✅ presente | `PayeeSearchService.ts:70` |
| Adhere to Standards | REST/JSON; busca por POST para o documento não cair em URL | ✅ presente | `routes/sispag.ts:578` |
| Abstract Common Services | Retry, sessão e paginação reaproveitados do `ConexosBaseClient`; `documentoSchema` reaproveitado | ✅ presente | `ConexosSispagClient.ts:213, 792` |
| Discover Service | Filial lida do `EnvironmentProvider` (config por tenant); sem registry | ⚠️ parcial | `PayeeSearchService.ts:56` |
| Tailor Interface | `PessoaCadastro` / `BuscaPessoasResultado` desacoplam a linha do ERP (campos `dpe*`, `pdc*`) do domínio | ✅ presente | `SispagInterface.ts` (+19) |
| Configure Behavior | `BUSCA_PESSOAS_LIMITE=20` e `TEXTO_MINIMO=3` são constantes de código, não configuração | ⚠️ parcial | `ConexosSispagClient.ts:217`, `PayeeSearchService.ts:11` |
| Manage Resources | Debounce 350 ms, página única de 20, leituras sequenciais; sem rate limit no servidor | ⚠️ parcial | `_shared-metrics.md` |
| Orchestrate | Orquestração linear e curta no service (busca, depois autorizações em lote por `pesCod`); sem N+1 | ✅ presente | `PayeeSearchService.ts:58-62` |
| Manage Resource Coupling | Leitura pura, sem escrita local nem no ERP; sonda recusa base não-HML | ✅ presente | `probe-cmn025-busca-hml.ts` |
| Contract testing | Testes de parsing com linhas sintéticas; sem fixture gravada do ERP | ⚠️ parcial | `ConexosSispagClient.test.ts:442` |
| Versioning strategy | Sem versão na URL (API do Conexos não expõe); drift contido por Zod com descarte de linha | ⚠️ parcial | `ConexosSispagClient.ts:819-822` |
| Backward-compatibility shims | Fallback de dois formatos de `pdcDocFederal` (dígitos, depois formatado) é um shim barato (+1 leitura só no caso sem achado) | ✅ presente | `ConexosSispagClient.ts:809-811` |
| Observability of integration failures | Linhas fora do schema são descartadas em silêncio em `mapPessoa` (o `cmnPessoasPix` vizinho loga a contagem em `:727`) | ⚠️ parcial | `ConexosSispagClient.ts:819-822` vs `:727` |

## 4. Findings (achados)

### F-integrability-1: Semântica do filtro `#LIKE` e formato do documento assumidos, não medidos

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts:762-772, 809-811`
- **Evidência (objetiva)**:
  ```
  "O formato guardado no cadastro não foi medido ao vivo; as duas leituras cobrem os dois casos."
  "Se o `#LIKE` do ERP for 'começa com' e não 'contém', a busca acha menos, mas não erra."
  ```
- **Impacto técnico**: se o `#LIKE` for sensível a acento ou a caixa, ou se o documento vier em terceiro formato, a busca retorna vazio sem erro e não há como distinguir de "não cadastrado".
- **Impacto de negócio**: o analista conclui que o favorecido não existe e abre chamado ou cadastra duplicado no Conexos.
- **Métrica de baseline**: 0 de 2 premissas do ERP medidas ao vivo; 0 respostas gravadas.

### F-integrability-2: Linhas de pessoa fora do schema são descartadas sem contagem nem log

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts:819-822` (compare `:727`)
- **Evidência (objetiva)**:
  ```
  const parsed = pessoaRowSchema.safeParse(row);
  if (!parsed.success) return undefined;
  ```
- **Impacto técnico**: uma mudança de campo no `cmn025/list` (por exemplo, `dpeNomPessoa` renomeado) zera a busca e ninguém é avisado; o método irmão `cmnPessoasPix` já loga a contagem de descartes.
- **Impacto de negócio**: degradação silenciosa descoberta só por reclamação do analista.
- **Métrica de baseline**: 0 logs de descarte em `buscarPessoas`; 1 de 2 leituras de `cmn025` do client com log de descarte.

### F-integrability-3: Fixtures de teste sintéticas para a resposta do ERP

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/client/ConexosSispagClient.test.ts:442-560`
- **Evidência (objetiva)**:
  ```
  const pessoa = (over = {}) => ({ pesCod: 77, dpeNomPessoa: 'ACME LTDA', ... })
  ```
- **Impacto técnico**: o teste prova o mapeamento do que o autor imaginou; não pega drift real (campo nulo, tipo numérico vs. texto).
- **Impacto de negócio**: regressões de contrato só aparecem em produção.
- **Métrica de baseline**: 0 fixtures gravadas de `cmn025/list` no repo para o fluxo de busca.

### F-integrability-4: Busca sem limite de taxa no servidor; cada chamada custa até 3 leituras no ERP

- **Severidade**: P3
- **Tactic violada**: Manage Resources
- **Localização**: `src/backend/routes/sispag.ts:578-590`, `ConexosSispagClient.ts:808-812`
- **Evidência (objetiva)**:
  ```
  for (const filterList of leituras) await ler(filterList);   // 1..2 + 1 do fallback de documento
  ```
- **Impacto técnico**: o debounce de 350 ms é a única proteção; vários analistas ou um cliente fora do frontend multiplicam leituras na sessão Conexos (que tem teto de sessões).
- **Impacto de negócio**: risco baixo hoje (`sispag:executar`, poucos usuários), mas a sessão do robô é compartilhada.
- **Métrica de baseline**: até 3 leituras Conexos por requisição; 0 limites de taxa por usuário na rota.

## 5. Cards Kanban

### [integrability-1] Medir ao vivo o `#LIKE` e o `pdcDocFederal` do `cmn025` e gravar fixtures

- **Problema**
  > A busca assume "contém" para o `#LIKE` e dois formatos para o documento, sem medição (HML recusou a credencial). Se a premissa estiver errada, a busca devolve vazio sem erro.

- **Melhoria Proposta**
  > Rodar `probe-cmn025-busca-hml.ts` com credencial HML válida (nunca em produção, para não derrubar a sessão viva), registrar a semântica (contém ou começa com, acento, caixa) no JSDoc e em `ontology/actions/sispag/buscar-favorecido-conexos.md`, e gravar 2 a 3 respostas anonimizadas como fixtures em `ConexosSispagClient.test.ts`. Tactic: Contract testing.

- **Resultado Esperado**
  > Premissas medidas 0/2 → 2/2; testes de `buscarPessoas` rodando sobre resposta gravada.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1, F-integrability-3
- **Métricas de sucesso**:
  - Premissas do ERP medidas: 0/2 → 2/2
  - Fixtures gravadas de `cmn025/list`: 0 → >= 2
- **Risco de não fazer**: busca que "não acha" favorecidos existentes e gera cadastro duplicado.
- **Dependências**: credencial HML válida.

### [integrability-2] Logar contagem de linhas descartadas em `buscarPessoas`

- **Problema**
  > `mapPessoa` descarta linhas fora do schema em silêncio; uma mudança de campo no ERP zera a busca sem alerta.

- **Melhoria Proposta**
  > Contar as descartadas em `ler()` e emitir `console.warn`/`LogService` em português, no mesmo formato de `cmnPessoasPix` (`ConexosSispagClient.ts:727`). Tactic: Observability of integration failures.

- **Resultado Esperado**
  > Descarte visível no log; leituras de `cmn025` com log de descarte 1/2 → 2/2.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Leituras de `cmn025` com log de descarte: 1/2 → 2/2
- **Risco de não fazer**: drift do contrato do Conexos descoberto só por reclamação.
- **Dependências**: nenhuma.

### [integrability-3] Limitar taxa da rota de busca por usuário

- **Problema**
  > Cada requisição custa até 3 leituras no Conexos e só o debounce do frontend contém a taxa.

- **Melhoria Proposta**
  > Aplicar um limitador simples por usuário na rota `POST /sispag/favorecidos-autorizados/busca`, ou cachear por termo por poucos segundos. Tactic: Manage Resources.

- **Resultado Esperado**
  > Teto explícito de leituras por usuário por minuto (hoje sem teto).

- **Tactic alvo**: Manage Resources
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Limite de taxa na rota: 0 → 1
- **Risco de não fazer**: baixo; pressão eventual sobre o teto de sessões do Conexos.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: só o delta. Nenhum P0/P1: o delta respeita a fronteira do client, valida com Zod e não vaza HTTP genérico.
- Não medido: semântica real do `cmn025` (sem credencial HML); `infra/` inexistente.
- Cross-QA: F-integrability-2 liga-se a Fault Tolerance/Observability; a validação de `termo` na rota liga-se a Security. `ConexosSispagClient.ts` chegou a 935 linhas (+107 no delta) e já concentra leituras de `cmn025` que também existem em `ConexosCadastroClient`; sinalizar a Modifiability.
