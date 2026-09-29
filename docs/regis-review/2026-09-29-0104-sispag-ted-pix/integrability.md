---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-29-0104
agent: qa-integrability
generated_at: 2026-09-28T00:00:00Z
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Integrability — Regis-Review

Modo `--quick` (sem rede, sem chamada ao Conexos). Feature `sispag-ted-pix` (ADR-0054). Cada finding é classificado IN_DELTA (introduzido por `git diff origin/main...HEAD`) ou PRE_EXISTING.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex / Conexos (mudança de schema de `cmn025`) | Campo do CPF/CNPJ (`pesNumCpfCnpj`, hipótese) ou campos `cixVld*` do `cmnPessoasPix` diferem do real, ou o Conexos muda o payload do `fin015` | `ConexosSispagClient` (`cmn025/list`, `cmn025/cmnPessoasPix/list`), `DestinoPagamentoResolver`, `RemessaService.montarItensImport` | Teste supervisionado em PRD (sem HML), flags OFF por padrão | Divergência detectada na borda do client (Zod), falha fechada, sem vazar dado sensível; correção confinada ao client | 1 arquivo de produção alterado (client) + 1 fixture; 0 remessas com destino errado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients com métodos HTTP genéricos vazados (`ConexosSispagClient`) | 0 (9 métodos públicos, todos de domínio) | 0 | ✅ | `ConexosSispagClient.ts:304-591` |
| Service/repo importando axios/fetch | 0 (os matches são só comentários) | 0 | ✅ | grep `axios\|fetch(` em `domain/service`, `domain/repository` |
| Leitores do client com Zod na borda | 5 de 8 (delta adicionou 2, ambos com Zod) | ≥80% | ⚠️ (arquivo) / ✅ (delta) | `ConexosSispagClient.ts:124-152, 419-517` |
| Campos de payload confirmados por leitura real | Documento: 0 (hipótese explícita); chave PIX: campos `cix*` sem fixture gravada | 100% para integração falível | ❌ | `ConexosSispagClient.ts:143` |
| Fixtures gravadas para os novos endpoints | 0 de 2 (`cmnPessoasPix`, `cmn025/list`) | 2 de 2 | ❌ | `domain/interface/sispag/__fixtures__/` (só `cmn025-conta-favorecido`) |
| Endpoints com versão explícita | 0 (Conexos não expõe versão na URL) | N/A no provedor | ⚠️ | paths `cmn025/...` |
| Dependências de construtor do `RemessaService` | 12 (era 10; delta +2) | ≤8 | ⚠️ | `RemessaService.ts:165-178` |
| Config das 3 flags novas via `EnvironmentProvider` | 3 de 3 | 100% | ✅ | `EnvironmentProvider.ts`, `EnvironmentVars.ts` |
| Latência/taxa de erro por chamada ao Conexos | ⚠️ **Não medível localmente**: sem rede em `--quick`. Requer sonda supervisionada/produção. Recomendação: contador por endpoint (card integrability-2). | n/d | ⚠️ | `jobs/probe-sispag-ted-pix-supervisionado.ts` |
| Contract tests do lado de escrita (Nexxera/GED/SharePoint) | N/A: integrações ainda não construídas | n/d | ⚠️ | `ontology/integrations/` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Toda leitura de `cmn025` passa por `ConexosSispagClient`; o resolver consome tipos de domínio | ✅ presente | `DestinoPagamentoResolver.ts:98`, `ConexosSispagClient.ts:419-517` |
| Use an Intermediary | `DestinoPagamentoResolver` (novo) é anticorruption layer entre cadastro Conexos, destino digitado e serializador; `LotePagamentoApiView` mascara a saída | ✅ presente | `DestinoPagamentoResolver.ts`, `LotePagamentoApiView.ts` |
| Restrict Communication Paths | Frontend só chega ao Conexos via `routes/sispag.ts`; serviços só via client | ✅ presente | `routes/sispag.ts` |
| Adhere to Standards | CNAB 240 validado por `RemessaCnabValidator` (segmento B, forma de lançamento TED/PIX) | ✅ presente | `RemessaCnabValidator.ts` |
| Abstract Common Services | Retry/paginação/sessão em `ConexosBaseClient`; sem duplicação de `performInit` nos novos métodos | ✅ presente | `ConexosSispagClient.ts:427-431` |
| Discover Service | Sem `infra/`/SSM; config via `EnvironmentProvider` + `ConexosSessionResolver` | ⚠️ parcial | Não medível: não existe `infra/` |
| Tailor Interface | Client normaliza campos crus (`cixVldTipo` -> `tipo`, `pctVldDefault` -> `padrao`) | ✅ presente | `ConexosSispagClient.ts:471-482` |
| Configure Behavior | 3 flags default OFF; OFF = byte-idêntico ao main (testes de paridade) | ✅ presente | `EnvironmentProvider.ts`, `RemessaService.test.ts` |
| Manage Resources | `runWithRetry`, páginas de 50/5 linhas; `getDocumentoFavorecido` é chamada ao vivo por item, sem cache | ⚠️ parcial | `ConexosSispagClient.ts:500-517` |
| Orchestrate | `RemessaService.gerarRemessaSerializado` orquestra linearmente; complexidade cognitiva 91 -> 93 | ⚠️ parcial | lint do delta (shared-metrics) |
| Manage Resource Coupling | Payload do `fin015` depende do resolver e das flags; coberto por teste de paridade | ⚠️ parcial | `RemessaService.montarItensImport` |
| Contract testing | Só fixture de `cmn025/ctcorr` (pré-existente); `cmnPessoasPix` e `cmn025/list` só com mocks manuais | ⚠️ parcial | `__fixtures__/2026-08-25-cmn025-conta-favorecido.json` |
| Versioning strategy | Ausente; defesa é `safeParse` + `passthrough` | ⚠️ parcial | `ConexosSispagClient.ts:124-139` |
| Backward-compat shims | Flags OFF preservam o caminho antigo; custo = ramos duplicados em `RemessaService` (+464 linhas no arquivo) | ⚠️ parcial | `RemessaService.ts` |
| Observability of integration failures | Linhas descartadas contadas em log sem ecoar dado; sem taxa de erro por dependência | ⚠️ parcial | `ConexosSispagClient.ts:484-488` |

## 4. Findings

### F-integrability-1: Nome do campo de CPF/CNPJ do favorecido é hipótese não confirmada por leitura real

- **Severidade**: P2
- **Classificação**: IN_DELTA
- **Tactic violada**: Contract testing / Adhere to Standards
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts:136-152, 500-517`
- **Evidência (objetiva)**:
  ```
  export const CAMPO_DOCUMENTO_FAVORECIDO = 'pesNumCpfCnpj';
  // "Nenhuma leitura de produção mostrou esse campo ainda."
  ```
- **Impacto técnico**: se o nome real diferir, `getDocumentoFavorecido` devolve sempre `undefined` e a titularidade (I10i) falha fechada: nenhuma remessa TED/PIX manual sai. É seguro, mas indisponível. A troca é confinada a 1 constante (bom raio de explosão).
- **Impacto de negócio**: o teste supervisionado em PRD pode falhar por um nome de campo, gastando a janela com o banco.
- **Métrica de baseline**: 0 leituras reais confirmando o campo; 0 de 2 fixtures novas. Não é P0: fail-closed e flag OFF.

### F-integrability-2: Sem fixtures gravadas para `cmnPessoasPix` e `cmn025/list`

- **Severidade**: P2
- **Classificação**: IN_DELTA
- **Tactic violada**: Contract testing
- **Localização**: `ConexosSispagClient.test.ts` (+148 linhas), `domain/interface/sispag/__fixtures__/`
- **Evidência (objetiva)**:
  ```
  ls __fixtures__ | grep -i "pix\|cmn025"  ->  2026-08-25-cmn025-conta-favorecido.json (só ctcorr)
  ```
- **Impacto técnico**: `chavePixRowSchema` (`cixCod`, `cixDesChave`, `cixVldSituacao`, `cixVldDefault`) foi escrito a partir de nomes presumidos; os testes provam parsing de linhas montadas à mão, não do formato do ERP.
- **Impacto de negócio**: mudança silenciosa do Conexos degrada para "0 chaves PIX" (destino ausente) em vez de erro.
- **Métrica de baseline**: 0 de 2 endpoints novos com fixture; alvo 2 de 2.

### F-integrability-3: Client mistura leitura tipada (Zod) e leitura crua com `Number()` / `String()`

- **Severidade**: P3
- **Classificação**: PRE_EXISTING (`listContasCorrentes`, `listContasFavorecido`, `listExteriorDocCods`); o delta seguiu o padrão bom
- **Tactic violada**: Tailor Interface
- **Localização**: `ConexosSispagClient.ts:389-450`
- **Evidência (objetiva)**:
  ```
  pctCodSeq: Number(c.pctCodSeq),  // sem safeParse; NaN passa
  ```
- **Impacto técnico**: `pctCodSeq` inválido vira `NaN` e alimenta o import do `fin015`.
- **Impacto de negócio**: baixo enquanto a conta vem de cadastro conferido pelo analista.
- **Métrica de baseline**: 5 de 8 leitores com Zod; 3 sem.

### F-integrability-4: `RemessaService` cresce como orquestrador com 12 dependências

- **Severidade**: P2
- **Classificação**: IN_DELTA (agravamento de PRE_EXISTING; 10 -> 12 deps, complexidade cognitiva 91 -> 93)
- **Tactic violada**: Orchestrate / Encapsulate (cruza com Modifiability)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:165-178`
- **Evidência (objetiva)**:
  ```
  constructor(... 12 @inject ...)
  ```
- **Impacto técnico**: trocar o gateway (Nexxera) ou o formato do `fin015` toca o mesmo serviço; o resolver foi extraído (bom), o resto segue acoplado.
- **Impacto de negócio**: a integração Nexxera futura herda um ponto de mudança pesado.
- **Métrica de baseline**: 12 deps (alvo ≤8); 1 orquestrador síncrono com >3 chamadas em série.

### F-integrability-5: Sem taxa de erro por dependência e sem versionamento explícito do Conexos

- **Severidade**: P3
- **Classificação**: PRE_EXISTING
- **Tactic violada**: Observability of integration failures / Versioning strategy
- **Localização**: `ConexosSispagClient.ts:484-488`, `ConexosBaseClient.ts`
- **Evidência (objetiva)**:
  ```
  Logger.warn(`[SISPAG] cmn025/cmnPessoasPix: ${descartadas} linha(s) fora do schema descartada(s) ...`)
  ```
- **Impacto técnico**: descarte por schema existe só como texto de log, não como métrica; sem contagem por endpoint não há alerta de drift.
- **Impacto de negócio**: drift do ERP é percebido pelo analista, não pelo time.
- **Métrica de baseline**: 0 métricas por endpoint. Não medível localmente (requer produção).

## 5. Cards Kanban

### [integrability-1] Confirmar o campo de CPF/CNPJ e gravar fixtures de `cmn025/list` e `cmnPessoasPix`

- **Problema**
  > `CAMPO_DOCUMENTO_FAVORECIDO='pesNumCpfCnpj'` é hipótese e o `chavePixRowSchema` nunca viu uma linha real. Sem fixture, o teste só prova o que foi escrito à mão.

- **Melhoria Proposta**
  > Rodar a sonda `probe-sispag-ted-pix-supervisionado.ts` no teste supervisionado, gravar a resposta mascarada em `__fixtures__/`, ajustar a constante e trocar os mocks de `ConexosSispagClient.test.ts` por fixture. Tactic: Contract testing.

- **Resultado Esperado**
  > Fixtures gravadas: 0 -> 2; campo documento confirmado: 0 -> 1.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1, F-integrability-2
- **Métricas de sucesso**:
  - Endpoints novos com fixture: 0/2 -> 2/2
  - Campos hipotéticos: 1 -> 0
- **Risco de não fazer**: o teste em PRD falha por nome de campo, ou drift do ERP degrada para "sem destino" sem erro.
- **Dependências**: teste supervisionado em PRD (checklist do tasks.md).

### [integrability-2] Alertar drift de schema por endpoint Conexos

- **Problema**
  > Linhas descartadas por schema só viram `Logger.warn`; não há contador por endpoint nem alerta.

- **Melhoria Proposta**
  > Emitir contagem estruturada (`endpoint`, `descartadas`, `total`) via `LogService` e definir limiar de alerta. Tactic: Observability of integration failures.

- **Resultado Esperado**
  > Drift detectável em minutos; métricas por endpoint do SISPAG: 0 -> 1 por endpoint.

- **Tactic alvo**: Manage Resources / Observability
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Métricas por endpoint: 0 -> 1 por endpoint
- **Risco de não fazer**: mudança silenciosa do ERP só é vista pelo analista.
- **Dependências**: nenhuma.

### [integrability-3] Extrair a montagem do `fin015` de `RemessaService`

- **Problema**
  > `RemessaService` tem 12 dependências e complexidade 93; qualquer mudança de payload ou de gateway passa por ele.

- **Melhoria Proposta**
  > Extrair `Fin015ImportBuilder` (`montarItensImport`) atrás de interface, deixando `RemessaService` só orquestrar. Fazer junto com a integração Nexxera (`/feature-new`). Tactic: Encapsulate / Orchestrate.

- **Resultado Esperado**
  > Dependências 12 -> ≤8; trocar o formato do `fin015` toca 1 arquivo.

- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Deps do construtor: 12 -> ≤8
  - Complexidade de `gerarRemessaSerializado`: 93 -> <60
- **Risco de não fazer**: o Nexxera entra em cima de um orquestrador ainda maior.
- **Dependências**: testes de paridade do delta (rede de segurança).

### [integrability-4] Padronizar leitores do client com Zod

- **Problema**
  > `listContasCorrentes`, `listContasFavorecido` e `listExteriorDocCods` usam `Number()`/`String()` sem validação.

- **Melhoria Proposta**
  > Aplicar `safeParse` com descarte contado, no padrão de `listChavesPixFavorecido`. Tactic: Tailor Interface. Fazer no próximo `/feature-tweak` que tocar esses leitores.

- **Resultado Esperado**
  > Leitores com Zod: 5/8 -> 8/8; `NaN` não chega ao import.

- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Leitores com Zod: 5/8 -> 8/8
- **Risco de não fazer**: `pctCodSeq` inválido chega ao import do lote.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo `--quick`: nenhuma chamada de rede; latência e taxa de erro por dependência não medíveis. Contagem "5 de 8 leitores com Zod" é estimativa por leitura do arquivo, não grep exaustivo.
- O delta no client é bem encapsulado (0 métodos genéricos, Zod nos 2 novos leitores, falha fechada, sem eco de dado sensível). O risco é validação contra o formato real, não estrutura.
- Cross-QA: F-integrability-4 se sobrepõe a Modifiability (Encapsulate); F-integrability-1/2 a Testability e Fault Tolerance (Validate Input).
