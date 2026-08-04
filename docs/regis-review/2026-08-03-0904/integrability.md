---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-03-0904
agent: qa-integrability
generated_at: 2026-08-03T09:04:00-03:00
scope: backend
score: 6
findings_count: 7
cards_count: 7
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Escopo REAL: o delta de `fix/sn-titulo-condicao-fail-closed` acopla o writer de recebimentos
(`RecebimentoNumerarioService`) a UM contrato ADICIONAL do Conexos ERP — a **com194** (validador de
documento) — DENTRO da etapa de escrita da SN (com299). A decisão de aplicar (ou não) o PUT que troca
`pgtCod` passa a depender de casar um **texto em português** vindo do ERP (`fdvEspErr` / `fdvEspObs`)
contra a regex `/CONDICAO DE PAGAMENTO/`, com severidade lida por `fdvVldErr === 2`.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Upgrade do ERP Conexos (fornecedor) altera o texto da mensagem de validação `com194` (ex.: "CONDIÇÃO" → "CONDIÇÕES", "COND. DE PGTO", ou tradução) | O `fdvVldErr:2` continua chegando, mas o texto não casa mais a regex | `RecebimentoNumerarioService.requiresRegisteredPaymentCondition` + `ConexosNdeFiscalClient.listValidacoes` (com194) | Produção, papel admin, `CONEXOS_WRITE_ENABLED=true` | Detectar a mudança ANTES do primeiro documento gravado com decisão errada | # SNs geradas sem o PUT quando deveriam (→ finalização recusada pela com194) OU com PUT quando não deveriam (→ título destruído no HML). Alvo: 0 por versão do ERP. |

Cenário complementar: **substituir o ERP** (ou promover a trilha permuta) exige reimplementar o
gate "condição de pagamento obrigatória?" — hoje o conhecimento vive metade no regex, metade no
docstring, sem um contrato explícito no boundary.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients Conexos com métodos genéricos vazando (`get`/`post`/`request`) | 0 (métodos domain-specific: `validaProcessoPessoa`, `finalizarDocumento`, `listValidacoes`, …) | 0 | ✅ | `Grep public.*=` em `ConexosGerDocProcessoClient.ts` / `ConexosNdeFiscalClient.ts` |
| Zod no boundary do client fiscal (com194 → `VALIDACAO_ROW_SCHEMA`) | Parcial: `.passthrough()` + `fdvEspErr/fdvEspObs` `.nullish()` (não valida presença) | shape mínimo enforced (`fdvVldErr`, `fdvEspErr\|fdvEspObs` ao menos um) | ⚠️ | `ConexosNdeFiscalClient.ts:51-58` |
| Client novo criado para com194 (o texto do doc do fiscalClient diz "leg FISCAL da NDe") | 0 — reusa `ConexosNdeFiscalClient` para gate de SN adiantamento | 1 client ou 1 método com escopo declarado (encapsulamento explícito) | ⚠️ | `ConexosNdeFiscalClient.ts:61-71` (docstring) + `RecebimentoNumerarioService.ts:531` |
| Decisões financeiras (aplicar/não aplicar PUT) que dependem de match textual de mensagem do ERP | 1 (novo neste delta) — `CONDICAO_PAGAMENTO_REGEX` | 0 (usar código estruturado, ex.: `fdvCodErr` ou `fdvKey`) | ❌ | `RecebimentoNumerarioService.ts:62,538-541` |
| Ontologia da integração descreve o contrato do com194 (endpoint, request, response, códigos de severidade) | Parcial — banner "CICLO DE VIDA DO TÍTULO" cita a chamada e o `fdvVldErr:2`, mas endpoint/schema/wire NÃO documentados na ontologia da integração | 100% (endpoint + payload + severidade codificados) | ⚠️ | `ontology/integrations/conexos-com299-gerdoc.md:139-142` |
| Documento de integração livre de trechos VIGENTES contraditórios | Não — três "banners de correção" empilhados (linhas 30, 84, 110), seção "Posture DRY-RUN" (l. 205) e "Como sair do dry-run" (l. 214) ainda presentes contradizendo a v0.12 REAL | 1 fonte da verdade por seção | ❌ | `ontology/integrations/conexos-com299-gerdoc.md:175-221` |
| API do ERP versionada na URL/header | 0/N — Conexos não versiona (`com194/documento/list`, `com299/gerDocProcesso` — sem `/v1/`, sem `api-version`) | Fora do nosso controle; mitigar com contract tests + fixture pinning | ⚠️ | `ConexosGerDocProcessoClient.ts:299,545,687` + `ConexosNdeFiscalClient.ts:202` |
| Teste de contrato com **fixture de mensagem REAL do com194** casando a regex `CONDICAO_PAGAMENTO_REGEX` | 0 — o teste usa string sintética (`fdvEspErr: 'CONDIÇÃO DE PAGAMENTO DO DOCUMENTO DIFERENTE...'`) escrita à mão pelo dev, não coletada do ERP | ≥1 (a mensagem exata do doc 18342 da pessoa 194 em produção) | ❌ | `RecebimentoNumerarioService.test.ts:374-378` |
| Separação transporte × domínio no gate com194 | Ausente — `catch` engloba 401/403/405 e trata igual a timeout (`return false`) | Mesma doutrina do `classifyValidatorError` (405/404/401/403 → HALT) | ⚠️ | `RecebimentoNumerarioService.ts:543-556` |
| Distância entre ontologia e código (referência ao ADR-0025 na ontologia + arquivo do ADR) | ADR `ontology/decisions/0025-...md` existe e é linkado; ontologia da entidade e da ação atualizadas com a nova regra | 100% | ✅ | `ontology/decisions/0025-sn-condicao-pagamento-condicional-fail-closed.md` + `ontology/entities/solicitacao-numerario.md:118-135` |

> ⚠️ **Não medível localmente**: taxa de erro/latência por-dependência (com194/com299/com300) em
> produção — requer CloudWatch/observabilidade que não existe hoje (Render + Express).
> Recomendação: registrar métricas por endpoint no `LogService` para exportação futura.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Cada rota do Conexos vira método nomeado no client (ex.: `finalizarDocumento`, `atualizarDocumento`, `listValidacoes`). Nenhum caller usa axios direto. | ✅ presente | `ConexosGerDocProcessoClient.ts:716,924` |
| Use an Intermediary | Serviço orquestra 4 clients Conexos (gerDoc, fin014, fiscal, nde) — não há anti-corruption layer entre serviço e ERP; a lógica de casar texto+severidade vive no serviço, não numa camada de tradução. | ⚠️ parcial | `RecebimentoNumerarioService.ts:186-202,526-557` |
| Restrict Communication Paths | Serviço fala com 5 clients (gerDoc, fin014, fiscal, nde, log) + 2 repos + 3 utilitários — no limite do razoável para orquestrador; nenhum outro serviço fala com com194. | ✅ presente | `RecebimentoNumerarioService.ts:188-202` |
| Adhere to Standards | O contrato do ERP não é padrão (sem versionamento, mensagens em texto livre em pt-BR); nosso lado adota Zod nos boundaries e um discriminador-por-etapa consistente (mesma doutrina da leg fiscal). A NOVA superfície — decidir por regex sobre texto — quebra o padrão que o resto do serviço estabeleceu. | ⚠️ parcial | `RecebimentoNumerarioService.ts:62,538-541` vs `ConexosGerDocProcessoClient.ts:748-771` (discriminador estrutural `docVldFinalizado===1`) |
| Abstract Common Services | `ConexosBaseClient` centraliza `ensureSid`/`runWithRetry`/`postGeneric`/`postGenericOnce`/`putGenericOnce` — o cliente fiscal reusa consistentemente. Bom nível de abstração. | ✅ presente | `ConexosNdeFiscalClient.ts:87-92,108-112` |
| Discover Service | SSM (env) descobre URL/credenciais do Conexos; `EnvironmentProvider` centraliza. O ERP em si não expõe descoberta de contratos (WSDL/OpenAPI). | ✅ presente (nosso lado) / ⚠️ ausente no ERP | `EnvironmentProvider` (referenciado em `RecebimentoNumerarioService.ts:211`) |
| Tailor Interface | `ConexosNdeFiscalClient` foi criado para a leg FISCAL da NDe (com300/com131/com194/poll com297) — a docstring l.61-71 declara esse escopo. Chamar `listValidacoes` a partir de um contexto de SN adiantamento (com299) desalinha o método do escopo declarado do client. | ⚠️ parcial | `ConexosNdeFiscalClient.ts:61-71` (docstring) + `RecebimentoNumerarioService.ts:531` |
| Configure Behavior | Escrita irreversível gated por `CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`; `env.solicitacaoNumerarioGcdCod` como fallback. `VALIDACAO_BLOQUEANTE=2` e `CONDICAO_PAGAMENTO_REGEX` são constantes de código, não configuráveis por tenant — apesar do próprio docstring reconhecer que "quem exige é o cadastro da pessoa, por-pessoa". | ⚠️ parcial | `RecebimentoNumerarioService.ts:54-62,211-213` |
| Manage Resources | `runWithRetry` + `ensureSid` em cada leitura; POSTs irreversíveis via `postGenericOnce` (sem 401-retry). Coerente. | ✅ presente | `ConexosGerDocProcessoClient.ts:300-329,687-701` |
| Orchestrate | `processarAlocacao` orquestra 7 etapas com retomada (`etapaSn→etapaFin014→…→etapaPoll`) — orquestração explícita, linear, com discriminador próprio por etapa. A NOVA sub-etapa `applyPaymentConditionIfRequired` continua o padrão. | ✅ presente | `RecebimentoNumerarioService.ts:346-388` |
| Manage Resource Coupling | Cada etapa registra progresso no ledger; retomada não redispara escritas — desacopla falhas transientes. | ✅ presente | `RecebimentoNumerarioService.ts:337-345,417-430` |
| Contract testing (fixture-based) | O client fiscal tem 1 teste de mapeamento de `listValidacoes`, mas o teste do serviço usa strings **sintéticas** para a mensagem em português — nenhuma prova ancorada em resposta real do ERP para `fdvEspErr` da pendência de condição de pagamento. | ⚠️ parcial | `RecebimentoNumerarioService.test.ts:374-378` + `ConexosNdeFiscalClient.test.ts:100-115` |
| Versioning strategy (external API) | Ausente do lado do ERP (fornecedor não versiona); nosso lado não pinha versão via header ou fixture-hash. | ❌ ausente | `ConexosGerDocProcessoClient.ts` (nenhum `x-api-version`) |
| Backward-compatibility shims | Ontologia da integração usa "banners de correção" empilhados em vez de um contrato canônico versionado — o leitor tem que sintetizar a verdade a partir de 3 sobreposições. Custo alto para novo integrador. | ⚠️ parcial | `ontology/integrations/conexos-com299-gerdoc.md:30-165` |
| Observability of integration failures | `LogService` grava BUSINESS_WARN/BUSINESS_ERROR por-etapa com `txnId`/`docCod`/`priCod`. Sem métricas agregadas por-dependência (Render/Express, sem CloudWatch). | ⚠️ parcial | `RecebimentoNumerarioService.ts:544-554,1259-1265` |

## 4. Findings (achados)

### F-integrability-1: Decisão financeira depende de match de string em português do ERP

- **Severidade**: P1 (alto — degrada QA mensurável; o próximo upgrade do Conexos pode virar a decisão sem sinal)
- **Tactic violada**: Adhere to Standards; Tailor Interface; Contract testing
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:57-62,536-542`
- **Evidência (objetiva)**:
  ```
  // service:
  const CONDICAO_PAGAMENTO_REGEX = /CONDICAO DE PAGAMENTO/;
  ...
  return validacoes.some(
      (v) =>
          v.fdvVldErr === VALIDACAO_BLOQUEANTE &&
          CONDICAO_PAGAMENTO_REGEX.test(
              this.stripAccents(`${v.fdvEspErr ?? ''} ${v.fdvEspObs ?? ''}`),
          ),
  );
  ```
  ```
  // teste — a "mensagem real" é escrita à mão pelo dev:
  const VALIDACAO_CONDICAO = {
      fdvCodSeq: 2, fdvVldErr: 2,
      fdvEspErr: 'CONDIÇÃO DE PAGAMENTO DO DOCUMENTO DIFERENTE DA SUGERIDA NO CADASTRO DE PESSOA...'
  };
  ```
- **Impacto técnico**: qualquer upgrade do Conexos que altere a frase — plural ("CONDIÇÕES"), abreviação ("COND. DE PGTO"), tradução, ou i18n — silencia o gate. O `fdvVldErr:2` continuará chegando, o `some()` devolverá `false`, o PUT não roda, e a finalização será recusada uma etapa depois com uma mensagem que aponta para o lugar errado (é EXATAMENTE o antipadrão que a doutrina "discriminador por etapa" tenta evitar). O oposto também vale: uma NOVA validação bloqueante cujo texto CONTENHA "CONDICAO DE PAGAMENTO" (ex.: "PRODUTO XYZ EXIGE CONDICAO DE PAGAMENTO ESPECIAL") dispararia o PUT indevidamente e poderia destruir o título.
- **Impacto de negócio**: retrabalho por analista para cada SN travada (o fluxo já quebrou uma vez, em HML, exatamente por decisão errada de casar texto — SKYJACK / SN 731 recebeu condição de terceiro; ver `docs/e2e/gap-titulos-diagnostico.md`). Escala com o volume de documentos.
- **Métrica de baseline**: 1 decisão de fluxo financeiro por match de string; 0 testes com fixture real do ERP; regex sem escopo (`.test`, não `^...$`).

### F-integrability-2: `ConexosNdeFiscalClient.listValidacoes` reusado fora do escopo declarado (leg fiscal da NDe → decisor de SN adiantamento)

- **Severidade**: P2 (médio — débito técnico defensável; nada quebra hoje)
- **Tactic violada**: Encapsulate; Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:61-71,189-218` + `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:531-535`
- **Evidência (objetiva)**:
  ```
  // client — docstring declara o escopo:
  * ConexosNdeFiscalClient — a leg FISCAL da Nota de Débito Eletrônica ...
  *   (c) com194 — validações (leitura), logadas quando a homologação volta `docVldComvalidacoes===2`.
  ```
  ```
  // service — chamada NOVA, com propósito DIFERENTE (decidir PUT numa SN adiantamento — pré-homologação):
  const validacoes = await this.fiscalClient.listValidacoes({
      filCod: ctx.filCod,
      docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
      docCod: snDocCod,   // docCod da SN (com299), NÃO da NDe (com297)
  });
  ```
- **Impacto técnico**: quem for renomear/mover o client fiscal, ou variar o payload/handling para o caso "log pós-homologação da NDe", vai quebrar silenciosamente o caso "gate pré-PUT da SN". O nome do método (`listValidacoes`) e o docstring dizem que ele é para a NDe; a nova chamada está no meio de uma etapa de com299. Boundary confuso = custo alto para o próximo dev.
- **Impacto de negócio**: risco médio de regressão numa refatoração do client fiscal. Não bloqueia entrega.
- **Métrica de baseline**: 1 método com 2 propósitos não-relacionados (leg fiscal NDe + gate SN); docstring desatualizado.

### F-integrability-3: com194 não modelado na ontologia de integração; contrato vive só no código

- **Severidade**: P2 (médio)
- **Tactic violada**: Discover Service; Adhere to Standards
- **Localização**: `ontology/integrations/conexos-com299-gerdoc.md:139-142` (só citação no banner de vigência); endpoint/request/response não documentados
- **Evidência (objetiva)**:
  ```
  // ontologia — o com194 aparece SÓ como referência textual no banner:
  > 2. `POST com194/documento/list` (`filterList: {docTip, docCod, fdvVldTperr: 1}`) — **o ERP** diz se exige
  >    a condição do cadastro: validação **BLOQUEANTE** (`fdvVldErr === 2`) cujo texto menciona condição de
  >    pagamento.
  ```
  A wire real (path, filterList, fieldList, campos que voltam — `fdvVldErr`, `fdvEspErr`, `fdvEspObs`, `fdvCodSeq` — e severidade) vive só em `ConexosNdeFiscalClient.ts:192-218` e no `.test.ts`. Não há entrada `ontology/integrations/conexos-com194-validacoes.md` ou seção equivalente.
- **Impacto técnico**: quem tentar substituir/upgradar o ERP (ou orquestrar outro produto atrás do mesmo gate) tem que ler o código para descobrir o contrato — a ontologia não é fonte da verdade para essa dependência crítica.
- **Impacto de negócio**: onboarding lento; custo alto de migração se o vendor mudar o schema.
- **Métrica de baseline**: 0 arquivos `ontology/integrations/*.md` documentam com194 como contrato; a única menção é um bullet num banner vigente da ontologia de com299.

### F-integrability-4: Ontologia da integração acumula banners de correção contraditórios — não há "fonte da verdade" única

- **Severidade**: P2 (médio — débito técnico)
- **Tactic violada**: Backward-compatibility shims (má gestão); Adhere to Standards (documentação)
- **Localização**: `ontology/integrations/conexos-com299-gerdoc.md:30-166` (três banners empilhados) e `l.175-221` (seções "Endpoint (write — dry-run)", "Posture DRY-RUN", "Como sair do dry-run" — todas contradizendo a realidade v0.12 REAL)
- **Evidência (objetiva)**:
  ```
  # l.30-63:  ⚠️ CORREÇÃO DE CONTRATO (HAR-confirmado 2026-07-30)
  # l.84-108: ⚠️ CORREÇÃO DE CONTRATO (execução REAL no HML, 2026-08-03 — SN nº 731)
  # l.110-165: ⚠️ CICLO DE VIDA DO TÍTULO + SEQUÊNCIA VIGENTE DA SN (medido no HML 2026-08-03)
  # l.175-221: seção "## Endpoint (write — dry-run)" + "## Posture DRY-RUN (por que não há write ao vivo)"
  #            + "## Como sair do dry-run (próxima fatia)" — inteiramente OBSOLETAS (write é REAL desde v0.12)
  ```
- **Impacto técnico**: um novo dev tem que decodificar qual banner sobrescreve qual seção (o próprio delta ATUALIZOU `endpoints_write` no frontmatter — l.19 — sem reescrever as seções que o contradizem). Alto risco de decisões baseadas em texto invalidado.
- **Impacto de negócio**: a integração é o ponto mais frágil da Frente IV; a documentação, o único artefato compartilhável fora do código, está em estado de "geological layers".
- **Métrica de baseline**: 3 banners de correção vigentes + 3 seções OBSOLETAS mantidas — 0 seções "atual/canônico" auto-contido.

### F-integrability-5: Zod no boundary do com194 é frouxo — não valida presença de `fdvEspErr`/`fdvEspObs`

- **Severidade**: P2 (médio; agrava P1 do finding 1)
- **Tactic violada**: Tailor Interface; Contract testing
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:51-58`
- **Evidência (objetiva)**:
  ```
  const VALIDACAO_ROW_SCHEMA = z
      .object({
          fdvCodSeq: z.coerce.number().int().optional(),
          fdvEspErr: z.string().nullish(),
          fdvEspObs: z.string().nullish(),
          fdvVldErr: z.coerce.number().int().optional(),
      })
      .passthrough();
  ```
- **Impacto técnico**: se um upgrade do ERP renomear `fdvEspErr` para `fdvErrMsg` (ou similar), a validação passa (todos os campos são `optional/nullish`), o `stripAccents(`${undefined ?? ''} ${undefined ?? ''}`)` devolve string vazia, a regex não casa e o gate silenciosamente decide "não aplicar PUT" — reproduzindo exatamente o cenário do finding 1 sem nenhum sinal.
- **Impacto de negócio**: falha invisível — o comportamento parece normal (SN gerada, `fdvVldErr:2` observado nos logs mas ignorado). Detecção só via reclamação do analista.
- **Métrica de baseline**: 4 campos load-bearing, 0 exigidos pelo schema; 0 fixture-based tests com resposta REAL do ERP.

### F-integrability-6: Gate com194 não separa transporte × domínio (diferente do gate `classifyValidatorError` na mesma classe)

- **Severidade**: P2 (médio)
- **Tactic violada**: Manage Resources; Adhere to Standards (doutrina interna)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:543-556` vs `l.805-825`
- **Evidência (objetiva)**:
  ```
  // NOVO catch — engoloba QUALQUER erro (401/403/405/500/timeout) → false:
  } catch (cause) {
      await this.logService.warn({ ... 'com194 unavailable ...' ... });
      return false;
  }
  ```
  ```
  // Doutrina INTERNA existente (mesma classe, l.805-825): 405/404/401/403 → TRANSPORT_ERROR (HALT):
  private classifyValidatorError = (err: unknown, endpoint: string, ...) => {
      const status = this.extractHttpStatus(err);
      if (status === 405 || status === 404 || status === 401 || status === 403) {
          return { classificacao: PREFLIGHT_CLASSIFICACAO.TRANSPORT_ERROR, ... };
      }
      ...
  };
  ```
- **Impacto técnico**: um 403 na conta de serviço (grant `com194 SELECT` retirado — cenário 4 do `recebimentos.e2e.falhas.test.ts:911`) resulta em "seguir sem PUT" — semanticamente EQUIVALENTE a "não há pendência" — mascarando problema de configuração como se fosse decisão de domínio.
- **Impacto de negócio**: bug de ACL invisível vira "por que o Conexos está travando na finalização?" — diagnóstico caro.
- **Métrica de baseline**: 1 gate (novo) sem separação transporte/domínio; a doutrina oposta (`classifyValidatorError`) já implementada na mesma classe.

### F-integrability-7: Ausência de contract-test com fixture REAL da mensagem `com194`

- **Severidade**: P2 (médio; complementa P1 do finding 1)
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:372-427` + `src/backend/domain/client/ConexosNdeFiscalClient.test.ts:100-115`
- **Evidência (objetiva)**:
  ```
  // TESTE — mensagem escrita à mão pelo dev, não coletada do ERP:
  const VALIDACAO_CONDICAO = {
      fdvCodSeq: 2, fdvVldErr: 2,
      fdvEspErr:
          'CONDIÇÃO DE PAGAMENTO DO DOCUMENTO DIFERENTE DA SUGERIDA NO CADASTRO DE PESSOA. ' +
          'PESSOA:555, SUGESTIVA: CLIENTE EXEMPLO - DUPLICATA',
  };
  ```
  ```
  // TESTE do client — 1 fixture sintética (mock), sem gravar/replay do HAR real:
  it('listValidacoes: mapeia as linhas fdv* do com194', async () => { ... postGeneric.mockResolvedValueOnce({ rows: [...] }); ... });
  ```
  O `ontology/_inbox/com299-sn-generation-har.md` (mencionado nas medições) NÃO foi vinculado ao teste como fixture.
- **Impacto técnico**: o gate está protegido apenas contra a variação de acentuação que o dev antecipou. Uma variação real diferente (plural, abreviação, ordem invertida) passa despercebida até o incidente.
- **Impacto de negócio**: janela de detecção = "primeiro cliente que reclama". Piora com o volume.
- **Métrica de baseline**: 0 fixtures HAR-derivadas para com194; 5 cenários de teste, todos com string escrita à mão.

## 5. Cards Kanban

### [integrability-1] Substituir o match de string do com194 por discriminador estruturado (ou envolver em anti-corruption layer)

- **Problema**
  > A decisão de aplicar o PUT que troca a condição de pagamento (escrita irreversível num documento financeiro) depende de `CONDICAO_PAGAMENTO_REGEX.test(...)` sobre um texto em português vindo do ERP. Um upgrade do Conexos que mude a frase silencia o gate; um texto novo que contenha a substring dispara PUT indevido. O próprio delta reconhece isso como "medido em produção no doc 18342" — a frase é um dado empírico, não um contrato.

- **Melhoria Proposta**
  > Investigar se o com194 devolve algum campo estruturado (código de validação — `fdvCodErr`, `fdvKey`, ID da regra) que identifique "pendência de condição de pagamento" sem depender do texto. Se sim: casar por código. Se NÃO: encapsular a regra num intermediário nomeado (ex.: `Com194PendingRuleDetector` — client dedicado ou service específico) com contrato explícito, fixtures reais e um único ponto de mudança. Tactic Bass: **Use an Intermediary** (anti-corruption layer) + **Tailor Interface**. Arquivos: `RecebimentoNumerarioService.ts:54-62,526-557`, novo `Com194PendingRuleDetector.ts` (ou método nomeado em client dedicado).

- **Resultado Esperado**
  > O caller pergunta "há pendência bloqueante de condição de pagamento?" e recebe boolean — sem depender de texto do ERP. Contrato canônico documentado. Volume esperado de mudanças ao upgradar o Conexos: 1 arquivo (o detector), com um teste de fixture-HAR verde ANTES do upgrade e VERMELHO se o wire mudar.

- **Tactic alvo**: Use an Intermediary; Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — inclui um probe HAR para descobrir campos estruturados)
- **Findings relacionados**: F-integrability-1, F-integrability-5, F-integrability-7
- **Métricas de sucesso**:
  - Decisões de fluxo financeiro baseadas em match de string: 1 → 0
  - Fixtures REAIS do com194 no repo: 0 → ≥1
  - Arquivos a tocar para adaptar a mudança de wire do com194: > 3 → 1
- **Risco de não fazer**: próximo upgrade do Conexos vira o gate silenciosamente; SNs travam na finalização com mensagem apontando o lugar errado (repetindo o bug SKYJACK/SN 731).
- **Dependências**: probe HAR na tela com194 para confirmar existência (ou ausência) de campo de código estruturado.

### [integrability-2] Extrair um client dedicado (`ConexosCom194Client`) OU renomear/reescopar `ConexosNdeFiscalClient`

- **Problema**
  > `ConexosNdeFiscalClient.listValidacoes` foi criado com escopo declarado "leg FISCAL da NDe, logada pós-homologação". O delta reusa esse método para decidir uma escrita numa SN adiantamento (pré-homologação, tela com299 — não com297). O nome do client, o docstring e o docstring do método continuam dizendo outra coisa. Boundary confuso, refatoração perigosa.

- **Melhoria Proposta**
  > Extrair `ConexosCom194Client` com um único método `listPendencias({ filCod, docTip, docCod, apenasBloqueantes? })` — ou, alternativa mais barata, renomear `ConexosNdeFiscalClient` para algo neutro (`ConexosDocumentValidationsClient`) e atualizar os docstrings. Tactic Bass: **Encapsulate**. Arquivos: `ConexosNdeFiscalClient.ts:61-71,192-218`, injeção no `RecebimentoNumerarioService`.

- **Resultado Esperado**
  > 1 client por família de rotas com escopo declarado que reflete o uso REAL. Docstrings consistentes com callers.

- **Tactic alvo**: Encapsulate; Tailor Interface
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Métodos com propósito duplo não-relacionado: 1 → 0
  - Docstrings do client que refletem os callers reais: parcial → 100%
- **Risco de não fazer**: refatoração futura do client fiscal quebra o gate de SN sem sinal claro.
- **Dependências**: idealmente sequenciar depois de `integrability-1` (o refactor de encapsulamento fica mais claro depois de decidir se o detector é um client ou um service).

### [integrability-3] Criar `ontology/integrations/conexos-com194-validacoes.md` — contrato explícito

- **Problema**
  > O com194 hoje é uma dependência de contrato crítica (decisor da escrita PUT) mas não existe como entrada de ontologia — vive só como bullet num banner de vigência dentro do doc do com299. Endpoint, request-shape, response-shape e semântica de severidade não estão modelados.

- **Melhoria Proposta**
  > Novo arquivo `ontology/integrations/conexos-com194-validacoes.md` com: endpoint (`POST /api/com194/documento/list`), request-shape (`filterList: {docTip, docCod, fdvVldTperr: 1}`, `pageSize`), response-shape (linhas com `fdvCodSeq/fdvVldErr/fdvEspErr/fdvEspObs`), tabela de severidade (`fdvVldErr` 1 = aviso; 2 = bloqueante), lista de mensagens conhecidas (com fonte: HAR/HML/produção) e o que cada uma governa em NOSSO fluxo. Linkar do `conexos-com299-gerdoc.md` e do `conexos-nde-fiscal.md`. Tactic Bass: **Discover Service** (nossa documentação de contrato) + **Adhere to Standards**.

- **Resultado Esperado**
  > Contrato do com194 documentado numa fonte única, versionada com a ontologia, referenciada por ambas as legs (SN adiantamento e NDe fiscal).

- **Tactic alvo**: Discover Service; Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Arquivos `ontology/integrations/*.md` documentando com194: 0 → 1
  - Cross-links (com299/gerdoc, nde-fiscal): 0 → 2
- **Risco de não fazer**: migração/substituição do ERP fica dependente de leitura de código; onboarding continua lento.
- **Dependências**: nenhuma.

### [integrability-4] Consolidar `ontology/integrations/conexos-com299-gerdoc.md` numa única fonte da verdade (retirar seções OBSOLETAS)

- **Problema**
  > O doc acumula 3 "banners de correção" empilhados e 3 seções antigas ("Endpoint (write — dry-run)", "Posture DRY-RUN", "Como sair do dry-run") que contradizem o estado REAL (v0.12, write ativo). O delta atualizou o frontmatter (`endpoints_write`) sem tocar nas seções que dizem o oposto.

- **Melhoria Proposta**
  > Reescrever o doc em UMA seção canônica que descreva a sequência VIGENTE (linha de item → com194 → condição condicional → verificação → finalização → releitura `docVldFinalizado===1`). Mover o que já aconteceu (banners de correção antigos, seções DRY-RUN) para uma seção `## Histórico / Correções` no rodapé — ou para `_inbox/` — sem contradizer o presente. Tactic Bass: **Backward-compatibility shims** (organizadas), **Adhere to Standards** (documentação).

- **Resultado Esperado**
  > Um leitor novo lê a primeira seção e sabe o estado atual. As correções ficam auditáveis, mas não competem pela leitura.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Seções obsoletas com conteúdo contraditório no corpo principal: 3 → 0
  - Banners de correção "vigentes" no corpo principal: 3 → 0 (consolidados numa seção canônica)
- **Risco de não fazer**: decisões futuras baseadas em texto invalidado; retrabalho e bugs de premissa.
- **Dependências**: idealmente depois de `integrability-3` (para linkar o novo doc de com194).

### [integrability-5] Zod estrito no boundary do com194: exigir presença mínima e ao menos um dos campos de texto

- **Problema**
  > `VALIDACAO_ROW_SCHEMA` deixa todos os campos load-bearing como `optional`/`nullish` com `.passthrough()`. Se o ERP renomear `fdvEspErr` no upgrade, a validação passa, a regex nunca casa, e o gate decide silenciosamente "não aplicar PUT".

- **Melhoria Proposta**
  > `fdvVldErr` como `.int()` (exigido — a severidade é o pivô da decisão) e `z.union([fdvEspErr obrigatório, fdvEspObs obrigatório])` (ao menos um dos campos de texto tem que vir preenchido — não faz sentido uma validação sem descrição). Tactic Bass: **Tailor Interface**. Arquivo: `ConexosNdeFiscalClient.ts:51-58`.

- **Resultado Esperado**
  > Rename silencioso no ERP quebra o parse (ZodError) em vez de virar decisão errada. Falha visível na etapa correta.

- **Tactic alvo**: Tailor Interface
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-5, F-integrability-1
- **Métricas de sucesso**:
  - Campos load-bearing do com194 validados como presentes: 0/4 → 2/4 mínimos (`fdvVldErr` + união `fdvEspErr|fdvEspObs`)
  - Falhas de rename detectáveis via parse: 0 → 100%
- **Risco de não fazer**: o mesmo "silenciamento" descrito em F-integrability-1 pode acontecer por rename de campo, não só por mudança de texto.
- **Dependências**: pode ser feito independente ou junto do card `integrability-1`.

### [integrability-6] Separar transporte × domínio no gate `requiresRegisteredPaymentCondition` (reusar `classifyValidatorError`)

- **Problema**
  > O `catch (cause)` engloba QUALQUER erro (401/403/405/500/timeout) e devolve `false` — "seguir sem PUT". A doutrina "transporte × domínio" já existe na mesma classe (`classifyValidatorError`, l.805-825) para o pré-flight, mas não foi aplicada aqui.

- **Melhoria Proposta**
  > Reusar `extractHttpStatus` + `classifyValidatorError`. 401/403/405/404 → propagar como transport error (log ERROR e falhar-fechado ou registrar TRANSPORT_ERROR na etapa); timeout/5xx → best-effort `return false` como hoje. Tactic Bass: **Manage Resources**; **Adhere to Standards** (doutrina interna). Arquivo: `RecebimentoNumerarioService.ts:543-556`.

- **Resultado Esperado**
  > Uma retirada acidental do grant `com194 SELECT` (cenário 4 do `e2e.falhas.test.ts`) para na etapa, com mensagem clara, em vez de virar comportamento "não há pendência" mascarado.

- **Tactic alvo**: Manage Resources
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Gates com194 que separam transporte × domínio: 0 → 1
- **Risco de não fazer**: bugs de ACL viram investigação cara.
- **Dependências**: nenhuma (helpers já existem na mesma classe).

### [integrability-7] Adicionar um contract-test fixture-based para o com194 (mensagem REAL do doc 18342)

- **Problema**
  > A regex `CONDICAO_PAGAMENTO_REGEX` é hoje testada só contra strings escritas à mão pelo dev. A mensagem REAL do ERP (doc 18342 em produção, pessoa 194) foi observada mas nunca gravada como fixture.

- **Melhoria Proposta**
  > Capturar (via `curl`/HAR autorizado) UMA resposta real do `com194/documento/list` para um documento com pendência de condição de pagamento; salvar como fixture (`src/backend/testing/fixtures/com194-condicao-pagamento.json`); teste no client garante o parse Zod; teste no service garante que a regex casa. Tactic Bass: **Contract testing**. Arquivo: novo fixture + `RecebimentoNumerarioService.test.ts`.

- **Resultado Esperado**
  > Qualquer mudança de wording do ERP quebra o teste ANTES do primeiro documento processado errado em produção.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — depende de acesso a HAR real
- **Findings relacionados**: F-integrability-7, F-integrability-1
- **Métricas de sucesso**:
  - Fixtures HAR-derivadas para com194: 0 → ≥1
  - Testes que provam "a regex casa a mensagem real": 0 → 1
- **Risco de não fazer**: a proteção do gate depende da imaginação do dev, não da realidade do ERP.
- **Dependências**: acesso ao HAR de produção (o `_inbox/com299-sn-generation-har.md` sugere que esse acesso existe).

## 6. Notas do agente

- Escopo restrito honrado: o delta central adiciona 128 linhas ao `RecebimentoNumerarioService.ts` e liga a com194 (via `ConexosNdeFiscalClient`) DENTRO da etapa de escrita da SN. Foco em Integrabilidade dos DOIS acoplamentos novos (contrato de texto + reuso de client fiscal fora do escopo).
- Positivos que NÃO viraram card: (a) o discriminador "título tem que continuar == valor" após o PUT segue a doutrina "200 nunca é sucesso" da leg fiscal — excelente reuso de padrão; (b) o ADR-0025 documenta a decisão com evidência quantitativa, e a ontologia foi atualizada no MESMO delta (baixa distância doc↔código para o QUE é decidido); (c) o teste E2E de falhas (`recebimentos.e2e.falhas.test.ts:824-828`) já reconhece que agora a etapa da SN também consulta o com194.
- Não medível localmente: taxa de erro por dependência em produção — Render/Express sem CloudWatch. Recomendação já registrada.
- Cross-QA:
  - **Fault Tolerance**: o "best-effort catch → return false" (F-integrability-6) sobrepõe-se ao QA de tolerância a falhas — flag conjunto.
  - **Testability**: F-integrability-7 (ausência de fixture real) também é achado de Testability.
  - **Modifiability**: F-integrability-2 e F-integrability-4 (client com escopo confuso + doc com múltiplas verdades) elevam o custo marginal de qualquer mudança na integração — flag conjunto.
  - **Security**: F-integrability-6 (403 silencioso) também tem leitura de segurança (perda de grant tratada como domínio) — flag conjunto.
