---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-integrability
generated_at: 2026-08-28T02:49:00-03:00
scope: backend
score: 6
findings_count: 6
cards_count: 6
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Conexos (upstream ERP) | Upgrade de versão do `fin015` — muda o `id` da pergunta, o shape do envelope `QUESTION`, ou renomeia `titVldReflexoDdaAssoc` | `ConexosSispagWriteClient` (contrato QUESTION/answers + coerção de flag DDA), `IngestaoPagamentosService`/`SispagPainelService`/`RemessaService` | Produção, remessa SISPAG (dinheiro saindo) | Detectar a mudança no boundary com falha imediata (Zod/contract test) em vez de degradar silenciosamente para `temBoleto=false`; permitir hotfix com toque em ≤ 3 arquivos | LOC/arquivos tocados para acomodar upgrade; tempo entre mudança e detecção (agora: só na próxima remessa recusada pelo banco) |

Notas:
- O protocolo `answers: Map<String,String>` foi descoberto por engenharia reversa (o Conexos vazou o tipo Java num erro de deserialização — `Cannot deserialize LinkedHashMap<String,String> from Array value`). Não está no OpenAPI, e o único registro do contrato é a prosa em `ontology/integrations/conexos.md:243-268` e o JSDoc do client.
- Cenário de replacement (trocar ERP): fora de escopo desta feature, mas o acoplamento adicionado (services de leitura passando a depender de `ConexosSispagWriteClient`) piora, não melhora, essa dimensão.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos públicos no `ConexosSispagWriteClient` (leitura vs. escrita) | 8 leituras / 4 escritas (67% do "WriteClient" é read) | ≤ 1 método "read" em client nomeado *Write* (senão, renomear) | ❌ | `grep -c "^\s*public\s" src/backend/domain/client/ConexosSispagWriteClient.ts` + inspeção manual (linhas 154/194/260/303/355/439/512/614/648/669/701/742) |
| Serviços que injetam `ConexosSispagWriteClient` só para leituras | 2 (`IngestaoPagamentosService.ts:37`, `SispagPainelService.ts:61`) | 0 (leituras em client de leitura ou classe dedicada) | ⚠️ | `grep -rn "ConexosSispagWriteClient" src/backend/domain/service` |
| Callers de `listarLotesNativos`/`listarTitulosPendentes`/`getLoteNativo`/`listarChavesDoLote`/`listarTitulosComBoletoDda` em services (não-write) | 6 pontos em 3 services | 0 | ⚠️ | `grep -rn "listarLotesNativos\|listarTitulosComBoletoDda\|listarTitulosPendentes\|listarChavesDoLote\|getLoteNativo" src/backend/domain/service` |
| Zod cobrindo o envelope da linha de pendentes (`titVldReflexoDdaAssoc`) | Ausente — coerção manual `Number(r.titVldReflexoDdaAssoc ?? 0) === 1` | Zod schema com key obrigatória (falha explícita se o ERP renomear/dropar) | ❌ | `src/backend/domain/client/ConexosSispagWriteClient.ts:481` |
| Zod cobrindo o envelope `QUESTION` | Parcial — `QUESTION_SCHEMA` exige `type: 'QUESTION'` e `questions[].id?/key?` mas `id` é `.optional()` (código depende dele para responder) | Zod exigindo `questions[0].id` obrigatório (não dá para responder sem ele) | ⚠️ | `src/backend/domain/client/ConexosSispagWriteClient.ts:59-62` |
| Fixture cru do envelope `QUESTION` do wire capturado no repo | 0 (apenas `validationError({type:'QUESTION',...})` sintetizado inline no test) | ≥ 1 fixture JSON do HML em `__fixtures__/` referenciada pelo `contrato.test.ts` | ⚠️ | `ls src/backend/domain/interface/sispag/__fixtures__/` + `grep QUESTION src/backend/domain/interface/sispag/__fixtures__/*` (0 hits) |
| Fixture do grid de pendentes cobrindo o campo `titVldReflexoDdaAssoc` | ✅ presente (`2026-08-25-fin015-titulo-pendente.json:47`) e listado no `contrato.test.ts:52` | ✅ | ✅ | `grep -n titVldReflexoDdaAssoc src/backend/domain/interface/sispag/__fixtures__/*.json` |
| Version-pinning do Conexos (URL ou header) | Ausente — path é `/fin015`, `/fin015/finItemSispag/...`, sem `/v1` nem header `api-version` | Header/URL versionado onde o upstream suportar | ⚠️ | `grep -n "v[0-9]\|version=\|api-version" src/backend/domain/client/ConexosSispagWriteClient.ts` (0 hits em URLs) |
| Endpoints `fin124/*` mapeados na doc mas não usados em runtime | 2 (`fin124/list`, `fin124/itens/list/{ddcCod}`) — só em `jobs/probe-fin124-dda.ts` | Documentar como "diagnóstico" e não em `endpoints_read` (ou remover) | ⚠️ | `grep -n "fin124" ontology/integrations/conexos.md` + `grep -rn "fin124" src/backend/domain/ --include='*.ts'` (0 hits em runtime) |
| Sondas novas no repo versionado com escrita HML | 3 (`probe-dda-assoc-write-hml.ts`, `probe-fin015-boleto-vinculo.ts` em HML mode, `probe-dda-answer-shape-hml.ts`) | Guard `if (!BASE.includes('-hml'))` presente em todas | ✅ (guard existe) / ⚠️ (pertencer ao repo é escolha) | `grep -n "hml\|RECUSAD" src/backend/jobs/probe-dda-*.ts src/backend/jobs/probe-fin015-boleto-vinculo.ts` |
| Custo de leitura adicional por rodada de ingestão | +1 leitura de `fin015/list` (lotes) + até 5 páginas de `titulosPendentes/list` (fil 2 ≈ 2195 pendentes) por filial | ≤ +1 request/filial ou uso de índice/filtro server-side | ⚠️ | `IngestaoPagamentosService.ts:63-97` + `ConexosSispagWriteClient.ts:439-462` |
| Tempo até detectar breaking-change silenciosa no wire de `titVldReflexoDdaAssoc` | ⚠️ **Não medível localmente**: sem contrato Zod estrito e sem alerta de "0% em N títulos", só percebido quando o `.REM` chegar sem barras — pode ser dias depois. Requer instrumentação de métrica `boleto_dda_flag_rate` no pipeline. | Alerta se `titVldReflexoDdaAssoc=1` cair a 0 numa filial ativa | — | recomendação |
| Testes cobrindo re-POST do body IGUAL com `answers` | ✅ 1 (`ConexosSispagWriteClient.test.ts:276-296`) | ≥ 1 | ✅ | `grep -n "responde YES à pergunta" src/backend/domain/client/ConexosSispagWriteClient.test.ts` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosSispagWriteClient` esconde HTTP/auth/pergunta ERP atrás de métodos domain-specific (`importarTitulos`, `gerarRemessa`, `listarTitulosComBoletoDda`). Não vaza `get/post/request`. Porém, o nome (Write) não reflete o conteúdo (8/12 métodos são leituras). | ⚠️ parcial | `ConexosSispagWriteClient.ts:64-88` (jsdoc "família de ESCRITA") vs. lista de públicos |
| Use an Intermediary | O `ConexosBaseClient` centraliza `ensureSid` + `postGenericOnce`/`runWithRetry`, e é reusado por Sispag/Sispag-Retorno/Sispag-Write/Baixa. Intermediário forte para HTTP/auth; falta um intermediário domain-level (SISPAG Query vs. SISPAG Command). | ⚠️ parcial | `ConexosSispagWriteClient.ts:87`, `IngestaoPagamentosService.ts:37` (dois clients Conexos injetados no mesmo service: `sispag` + `fin015`) |
| Restrict Communication Paths | Services SISPAG só falam com o Conexos via `ConexosSispagClient` + `ConexosSispagWriteClient` + `ConexosBaseClient`. `RemessaService` respeita a fronteira. **Piorou** com o delta: `IngestaoPagamentosService` (era read-only) agora depende do write client. | ⚠️ parcial | `IngestaoPagamentosService.ts:37`, `SispagPainelService.ts:61` |
| Adhere to Standards | Conexos é ERP proprietário; sem OpenAPI público. O protocolo `answers` foi descoberto por engenharia reversa (7 encodings testados, mensagem Java vazando o tipo). Não há como aderir a padrão — só documentar bem. | ❌ ausente (culpa do upstream) | `ontology/integrations/conexos.md:253-256` + `probe-dda-answer-shape-hml.ts` |
| Abstract Common Services | Retry/refresh de sid: `ConexosBaseClient` (compartilhado). Ledger/gating de escrita: `ReconciliacaoWriteLedger` + `env.conexosWriteEnabled`. Mas o `WriteClient` do fin015 diz explicitamente "não é gated internamente" — o gate é responsabilidade do service orquestrador. | ⚠️ parcial | `ConexosSispagWriteClient.ts:79-83` |
| Discover Service | SSM (produção) para base URL/credenciais — padrão do repo. Sondas HML usam `CONEXOS_BASE_URL` no ambiente. Convenção OK. | ✅ presente | `probe-dda-assoc-write-hml.ts:30-33` |
| Tailor Interface | `paraTituloPendente` faz projeção da linha crua para `TituloPendente` (interface do domínio); `raw` guardado verbatim para o `importar`. Tailor OK, mas sem Zod → coerção silenciosa se a chave sumir. | ⚠️ parcial | `ConexosSispagWriteClient.ts:465-483` |
| Configure Behavior | `associarDda?: boolean` (default `false`) é o "config" do lado do caller para pedir a associação. Allowlist `PERGUNTA_AUTO_RESPONDIVEL` é constante de módulo, não configurável — decisão coerente com segurança. | ✅ presente | `ConexosSispagWriteClient.ts:52`, `Fin015Write.ts:105` |
| Manage Resources | `postGenericOnce` para escritas não-idempotentes (tentativa única); `runWithRetry` para leituras. `listarTitulosPendentes` pagina de verdade agora (limite `maxPaginas=40` + WARN em vez de silêncio). `BoundedConcurrency` no fan-out por filial (`FANOUT_LIMIT`). | ✅ presente | `ConexosSispagWriteClient.ts:355-425`, `IngestaoPagamentosService.ts:119-129` |
| Orchestrate | O re-POST com `answers` é uma orquestração de handshake QUESTION → answer → success no próprio client; **não** vira retry cego (a única resposta permitida é allowlist de 1 chave). O `RemessaService` orquestra criar→importar→finalizar→gerar em passos com ledger. | ✅ presente | `ConexosSispagWriteClient.ts:512-567`, `RemessaService.ts:395-472` |
| Manage Resource Coupling | O grid de pendentes é lido usando um `flpCod` que é **contexto** (não filtro): usa-se o maior `flpCod` existente na conta como "âmbito de leitura" (`listarTitulosComBoletoDda`). O ERP recicla `flpCod` (ver migration 0049 mencionada no shared-metrics), o que cria acoplamento entre a integridade dessa leitura e o ciclo de vida de um artefato de outra flow. | ⚠️ parcial | `ConexosSispagWriteClient.ts:439-462` |
| Contract testing (facet) | `contrato.test.ts` cobre chaves obrigatórias no wire (inclui `titVldReflexoDdaAssoc`). **Falta** fixture do envelope `QUESTION` — só há shape sintetizado inline nos testes de unidade. | ⚠️ parcial | `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:44-58`, ausência de fixture QUESTION |
| Versioning strategy (facet) | Sem versão na URL nem em header. Convenção da instalação Columbia é "a versão é a instalação". | ❌ ausente | `grep -n "v[0-9]\|api-version" src/backend/domain/client/ConexosSispagWriteClient.ts` |
| Backward-compatibility shims (facet) | Nenhum shim; a leitura `paraTituloPendente` faz `?? 0` para o flag, o que é o **oposto** de shim — degrada em silêncio. | ❌ ausente | `ConexosSispagWriteClient.ts:481` |
| Observability of integration failures (facet) | Falhas viram `ConexosError` (com `code`, `retryable`) e `ErpPerguntaError`. Falha do enrichment de boleto vira WARN e conjunto vazio — **não** há métrica de "% de títulos com flag caindo entre rodadas" que detectaria uma quebra silenciosa do wire. | ⚠️ parcial | `IngestaoPagamentosService.ts:78-96` (WARN), sem métrica agregada |

## 4. Findings (achados)

### F-integrability-1: Contrato `QUESTION/answers` sem fixture cru do wire — só shape sintetizado

- **Severidade**: P1
- **Tactic violada**: Contract testing; Adhere to Standards (mitigation via fixture)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:52-62,553-582`, `src/backend/domain/client/ConexosSispagWriteClient.test.ts:229-296`, `src/backend/domain/interface/sispag/__fixtures__/` (ausência)
- **Evidência (objetiva)**:
  ```
  # zero fixtures capturados do envelope QUESTION
  $ grep -l QUESTION src/backend/domain/interface/sispag/__fixtures__/*.json
  # (nenhum resultado)

  # testes usam apenas shape sintetizado inline:
  const perguntaBarcode = validationError({
      type: 'QUESTION',
      questions: [{ id: '1', key: 'FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO', ... }]
  });
  ```
  E o `QUESTION_SCHEMA` marca `id` como `.optional()` (linha 61), mas em `perguntaAutoRespondivel` (`:580-581`) o código só devolve `undefined` se o `id` estiver ausente — quebrando a auto-resposta silenciosamente. Um `id` ausente do wire real vira "sobe como pergunta humana" — comportamento seguro, mas escondido do teste.
- **Impacto técnico**: O único registro material do contrato descoberto por engenharia reversa é (a) prosa em `ontology/integrations/conexos.md` e (b) um shape sintético no test. Se o Conexos, num upgrade, mudar o nome do campo (`answers` → `answer`, ou `id` → `questionId`), o teste continua verde (porque ele mesmo produz o shape) e o defeito só aparece no `.REM` sem barras chegando ao banco.
- **Impacto de negócio**: Regressão silenciosa no caminho de **dinheiro saindo da empresa** (SISPAG). Descoberta tardia — quando o banco recusa a liquidação — significa retrabalho de remessa + risco de multa por atraso de fornecedor.
- **Métrica de baseline**: 0 fixtures do envelope `QUESTION` em `src/backend/domain/interface/sispag/__fixtures__/`. Único método de detecção hoje = falha do banco (não instrumentado).

### F-integrability-2: `ConexosSispagWriteClient` acumula leituras e vira dependência de services read-only

- **Severidade**: P2
- **Tactic violada**: Encapsulate / Restrict Communication Paths (nome do artefato não reflete o contrato)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:64-88` (JSDoc "família de ESCRITA"), `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:37`, `src/backend/domain/service/sispag/SispagPainelService.ts:61`
- **Evidência (objetiva)**:
  ```
  # public methods do "WriteClient" — 8 leituras / 4 escritas
  Leituras:
    listarLotesNativos, getLoteNativo, listarChavesDoLote,
    listarTitulosPendentes, listarTitulosComBoletoDda,
    sugerirRemessa, listarArquivosRemessa, baixarRemessa
  Escritas:
    criarLote, importarTitulos, finalizarLote, gerarRemessa
  ```
  Antes do delta já eram 7/11 leituras (o padrão veio da fatia de retomada em ADR-0039). O delta adicionou a 8ª leitura (`listarTitulosComBoletoDda`) e **acoplou `IngestaoPagamentosService`** (que é read-only por definição) e `SispagPainelService` a um client cuja doc declara ser "1ª superfície de escrita do SISPAG que quebra a invariante I1".
- **Impacto técnico**: O leitor do código, ao ver `@inject(ConexosSispagWriteClient) fin015` num service de ingestão, precisa parar e checar a documentação para saber que **nada de escrita** está sendo importado ali. O `PatternGuardian` não vai bloquear porque a assinatura é técnica correta, mas a mensagem semântica ("este service pode escrever") está errada. Também dificulta um audit de "quem escreve no ERP?".
- **Impacto de negócio**: Baixo direto; alto indireto. Se amanhã se quiser gatear o `WriteClient` por `env.conexosWriteEnabled` (padrão do `ConexosBaixaClient`), o gating **quebra a ingestão** porque a leitura do flag DDA passa pelo mesmo client.
- **Métrica de baseline**: 2 services read-only depedendo do `WriteClient`; 8/12 métodos públicos do "WriteClient" são leituras (67%). O nome não é diagnóstico.

### F-integrability-3: Zod ausente na projeção de `TituloPendente` — a mesma armadilha do `titEspCodbar`

- **Severidade**: P1
- **Tactic violada**: Tailor Interface / Contract testing (schema pinning no boundary)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:465-483`, `src/backend/domain/interface/sispag/Fin015Write.ts:76`
- **Evidência (objetiva)**:
  ```typescript
  // ConexosSispagWriteClient.ts:481
  temBoletoDda: Number(r.titVldReflexoDdaAssoc ?? 0) === 1,
  ```
  `TituloPendente.temBoletoDda: boolean` (não-opcional). Não há Zod schema para `TituloPendente` — a projeção é 100% coerção manual. Se o Conexos renomear `titVldReflexoDdaAssoc` num upgrade, o `?? 0` faz o campo cair silenciosamente para `false` em 100% dos títulos — **exatamente a mesma classe de defeito que a feature resolve** (o `titEspCodbar` null em 100% que a auto-detecção antiga usava e que "nunca disparou").
- **Impacto técnico**: A feature endereça o defeito passado, mas replica sua causa raiz. Sem schema estrito, uma quebra do wire equivale a "nenhum título tem boleto" — passa como estado normal e a analista escolhe TED/PIX pelos motivos errados (ou o `BoletoSemCodigoBarrasError` deixa de proteger porque `associarDda` fica sempre `false`).
- **Impacto de negócio**: A remessa deixa de sair com boletos (regressão do valor entregue pela feature) OU sai sem barras e o banco recusa — mesmo cenário do bug histórico. O `contrato.test.ts` capta a ausência do CAMPO na fixture (bom), mas em runtime a coerção continua muda.
- **Métrica de baseline**: 1 campo obrigatório (`temBoletoDda`) derivado de coerção manual `?? 0`; 0 schemas Zod cobrindo `TituloPendente`; 0 alertas se `titVldReflexoDdaAssoc=1` cair a 0 numa filial ativa. Fixture existe (54/173, 136/500 etc), mas a fixture só valida `contrato.test.ts` — não trava o mapper em produção.

### F-integrability-4: Impedance mismatch — dado de carteira lido usando `flpCod` reciclável como contexto

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:439-462`
- **Evidência (objetiva)**:
  ```typescript
  const lotes = await this.listarLotesNativos({ filCod, bncCod });
  const contexto = lotes.reduce<number | undefined>(
      (maior, l) => (maior === undefined || l.flpCod > maior ? l.flpCod : maior),
      undefined,
  );
  if (contexto === undefined) return new Set();
  const pendentes = await this.listarTitulosPendentes({ filCod, bncCod, flpCod: contexto, ... });
  ```
  O grid de pendentes exige um `flpCod` para responder algo que é do TÍTULO (`titVldReflexoDdaAssoc`). Solução: pegar o `flpCod` **maior** da conta como âmbito de leitura. `_shared-metrics.md` observa: "**o ERP RECICLA flpCod** (ver migration 0049)". O comentário do próprio `listarTitulosComBoletoDda` diz "lê igual em lote finalizado" (o que é conforto), mas nada garante estabilidade se o ERP reciclar o `flpCod` para outra conta ou cancelar o lote entre duas rodadas.
- **Impacto técnico**: A leitura da carteira ficou acoplada ao ciclo de vida de um artefato de outro fluxo (o lote nativo mais recente). Uma operação da analista (cancelar um lote no ERP entre duas rodadas de ingestão) muda o `contexto` e potencialmente muda o conjunto de `temBoleto=true`. Não há teste unitário cobrindo "reciclagem do flpCod" — só o caminho feliz (`test.ts:409-437`).
- **Impacto de negócio**: Flutuação inexplicável de "quais títulos têm boleto" entre rodadas — a analista vê "hoje 12 boletos, amanhã 5" sem mudança real do ERP, e perde confiança na coluna Boleto do painel.
- **Métrica de baseline**: 1 leitura de carteira depende de 1 leitura auxiliar de artefato externo com semântica reciclável. 0 assertions locais de que "o mesmo `docCod`/`titCod` mantém `temBoletoDda` estável entre `flpCod`s consecutivos". Custo de leitura extra por rodada: +1 `fin015/list` + até 5 páginas de `titulosPendentes/list` por filial (fil 2 ≈ 2195 pendentes / 500 por página).

### F-integrability-5: `fin124` mapeado como endpoint de leitura mas não usado em runtime — dívida de sondas versionadas

- **Severidade**: P3
- **Tactic violada**: Encapsulate (superfície do repo espelha o que o código realmente usa)
- **Localização**: `ontology/integrations/conexos.md:233` (linha adicionada no delta), `src/backend/jobs/probe-fin124-dda.ts` (novo, 259 linhas), 6 outras sondas novas
- **Evidência (objetiva)**:
  ```
  # runtime: 0 hits para fin124 em domain/*
  $ grep -rn "fin124" src/backend/domain/ --include='*.ts'
  # (nenhum)

  # jobs: 1 sonda dedicada a fin124 (+ referência em 2 outras)
  $ grep -l "fin124" src/backend/jobs/*.ts
  src/backend/jobs/probe-fin124-dda.ts
  src/backend/jobs/probe-boleto-fonte.ts
  ```
  O ADR-0040 é explícito: matching nosso via `fin124` não é confiável, quem casa é o ERP. A tabela `endpoints_read` em `ontology/integrations/conexos.md:233` lista `fin124/list · fin124/itens/list/{ddcCod}` com nota "Não usado em runtime". A nota mitiga, mas mistura "endpoint que a solução consome" com "endpoint que a sondagem consumiu" — atrito para o próximo dev que ler a tabela como catálogo de dependências.
- **Impacto técnico**: Reads listados no contrato de integração passam a sinalização de dependência real (o painel, o job, a rota) — não a "onde o levantamento passou". Sondas HML no repo (`probe-dda-*-hml.ts`, `probe-fin015-boleto-vinculo.ts`) têm guard (`if (!BASE.includes('-hml')) exit 1`) e são úteis para reprodutibilidade das medições, mas passam a inflar `jobs/` (9.027 LOC — o dobro de `domain/repository/`) e diluem o sinal de "quais jobs são runtime".
- **Impacto de negócio**: Baixo. É higiene de documentação/estrutura. Ignorado por 6 meses, `endpoints_read` deixa de servir como contrato de "o que o serviço lê do ERP".
- **Métrica de baseline**: `jobs/` tem 51 arquivos / 9.027 LOC (shared-metrics). 7 novos neste delta. `endpoints_read` tem 8 endpoints listados; 1 deles (`fin124/*`) é "diagnóstico". 12,5% de "ruído catalogado" — abaixo do gatilho de refactor, mas em trajetória.

### F-integrability-6: Sem version-pinning explícito no Conexos — upgrade quebra em silêncio

- **Severidade**: P3
- **Tactic violada**: Versioning strategy (facet moderna)
- **Localização**: todos os `path`s dos clients Conexos — ex. `ConexosSispagWriteClient.ts:159,199,266,309,373,514,620,654,671,707,744`
- **Evidência (objetiva)**:
  ```
  # zero rotas versionadas
  $ grep -E "'/?v[0-9]|api-version" src/backend/domain/client/ConexosSispagWriteClient.ts
  # (nenhum)
  # exemplos de path atual:
  'fin015'
  'fin015/finItemSispag/titulosPendentes/importar'
  ```
  O Conexos não expõe versão em URL/header (é ERP proprietário, upgrade in-place). Não é culpa do repo, mas a ausência combinada com F-1/F-3 (contrato descoberto por engenharia reversa + coerção sem Zod) transforma qualquer upgrade em "descubra em produção".
- **Impacto técnico**: Zero mecanismo automatizado para detectar breaking-change de upgrade. Depende exclusivamente do contact humano entre Kavex e Conexos.
- **Impacto de negócio**: Uma janela cega entre upgrade e detecção — a única detecção material hoje é o banco recusar a remessa. Para SISPAG, dinheiro saindo, essa janela deve ser 0.
- **Métrica de baseline**: 0 endpoints com versão pinned; 0 headers `api-version`. Mitigação existente: fixtures capturados datados (`2026-08-25-fin015-titulo-pendente.json` etc) + `contrato.test.ts` — bom, mas só se roda no CI, não em produção contra o ERP vivo.

## 5. Cards Kanban

### [integrability-1] Capturar fixture cru do envelope `QUESTION` e trancar `answers` no boundary

- **Problema**
  > O contrato `answers: Map<String,String>` chaveado pelo `id` da pergunta foi descoberto por engenharia reversa (7 encodings testados até o erro Java vazar o tipo). O único registro material dele no código é prosa em `ontology/integrations/conexos.md:243-268` e um shape SINTETIZADO inline no `ConexosSispagWriteClient.test.ts:229-296`. Um upgrade que mude `answers` para `answer` (ou `id` para `questionId`) mantém o teste verde e só é descoberto quando o banco recusar a próxima remessa.

- **Melhoria Proposta**
  > (a) Capturar o envelope real em `src/backend/domain/interface/sispag/__fixtures__/2026-08-27-fin015-question-barcode.json` a partir da sonda `probe-dda-answer-shape-hml.ts` (que já pesquisou o shape). (b) Estender `contrato.test.ts` para exigir `type=QUESTION` + `questions[0].id` + `questions[0].key` + `answerList[].id in {YES,NO}` na fixture. (c) Endurecer `QUESTION_SCHEMA` (`ConexosSispagWriteClient.ts:59-62`): `id` obrigatório (não `.optional()`), `answerList` obrigatório com `id: 'YES'` presente na allowlist. (d) Adicionar um teste do request de resposta que serializa e valida `{ answers: { "1": "YES" } }` como `Map<String,String>` no wire (não o TS type).

- **Resultado Esperado**
  > Uma alteração unilateral do Conexos no shape do QUESTION ou do `answers` **falha o CI**, não o banco. Custo de detecção: minutos, não dias.
  > Fixtures do envelope QUESTION: 0 → ≥ 1. `QUESTION_SCHEMA.questions[0].id` optional → required. Testes de contrato de request cobrindo `answers`: 0 → 1.

- **Tactic alvo**: Contract testing (facet); Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Fixtures capturados do QUESTION real: 0 → ≥ 1
  - `id` obrigatório no schema Zod: false → true
  - Teste que serializa e valida `answers` como map: 0 → 1
- **Risco de não fazer**: Regressão silenciosa no caminho de pagamento. A doutrina "descobri porque o Java vazou o tipo" não é reproduzível a cada upgrade.
- **Dependências**: nenhuma

### [integrability-2] Tratar `titVldReflexoDdaAssoc` como campo obrigatório no boundary (Zod estrito)

- **Problema**
  > `ConexosSispagWriteClient.paraTituloPendente` coage `Number(r.titVldReflexoDdaAssoc ?? 0) === 1` (linha 481) para produzir `TituloPendente.temBoletoDda: boolean` (não-opcional). Não há Zod schema para `TituloPendente`. Se o Conexos renomear o campo (upgrade, hot-patch, feature-flag do lado deles), `?? 0` degrada silenciosamente para `false` em 100% dos títulos — a mesma classe do bug do `titEspCodbar` que esta feature resolve.

- **Melhoria Proposta**
  > Criar `TITULO_PENDENTE_SCHEMA = z.object({ filCod: z.coerce.number(), docCod: z.union([z.string(), z.number()]), titCod: z.union([z.string(), z.number()]), titVldReflexoDdaAssoc: z.union([z.literal(0), z.literal(1)]), ...opcionais })` e aplicar no `paraTituloPendente`. Em caso de `safeParse` falho, jogar `ConexosError` com endpoint identificado — o mesmo tratamento do envelope de criação de lote (`LOTE_CRIADO_SCHEMA`, `:22-31`). Adicional: instrumentar no `IngestaoPagamentosService` uma métrica agregada `boleto_dda_flag_rate` por filial e alertar se cair a 0 numa filial que historicamente tinha >0.

- **Resultado Esperado**
  > Uma mudança silenciosa do wire vira falha explícita na próxima rodada de ingestão, não uma remessa vazia meses depois. Contrato TS deixa de mentir para o resto do código.
  > Zod schemas cobrindo `TituloPendente`: 0 → 1. Coerções silenciosas `?? 0` em campos boundary: 1 → 0.

- **Tactic alvo**: Tailor Interface; Contract testing (facet)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Schemas Zod cobrindo `TituloPendente`: 0 → 1
  - Falha explícita quando `titVldReflexoDdaAssoc` está ausente: coerção silenciosa → ConexosError
  - Métrica de taxa do flag por filial (alerta se cair a 0): ausente → presente
- **Risco de não fazer**: Reintrodução do defeito histórico. A causa raiz (coerção silenciosa em vez de contrato) não foi endereçada — só o sintoma (mudou a fonte do sinal).
- **Dependências**: nenhuma

### [integrability-3] Separar leitura e escrita do `fin015` — renomear ou dividir `ConexosSispagWriteClient`

- **Problema**
  > O client `ConexosSispagWriteClient` tem 8 leituras e 4 escritas (67% read). `IngestaoPagamentosService` (read-only) e `SispagPainelService` agora dependem dele só para leitura. O JSDoc do client diz explicitamente "1ª superfície de ESCRITA do SISPAG que quebra a invariante I1" e "não é gated internamente" — mas dois services que **não escrevem nada** dependem dele. Se amanhã quisermos gatear o client por `env.conexosWriteEnabled` (padrão do `ConexosBaixaClient`), quebramos a ingestão.

- **Melhoria Proposta**
  > Duas opções: **(A) renomear** para `ConexosFin015Client` (o que o client realmente é: toolbox do fin015, reads + writes), e mover para o service (dentro de `importarTitulos`/`gerarRemessa`) a decisão de "isto é escrita, precisa gate". **(B) extrair** um `ConexosSispagLotesReadClient` com as 8 leituras (delegando para o mesmo `ConexosBaseClient`), deixar em `ConexosSispagWriteClient` só as 4 escritas, e migrar os services de leitura. A opção A é S (rename + docs); a B é M (extração + tests). Recomendo A pelo custo/benefício, com nota no JSDoc de que gate é externo.

- **Resultado Esperado**
  > O nome do client passa a refletir o contrato; um audit "quem escreve no ERP" fica trivial (grep pelas 4 escritas). Um futuro gate `conexosWriteEnabled` no client não quebra caminho de leitura.
  > Services read-only dependendo de classe nomeada `*Write*`: 2 → 0. Cognitive load do próximo dev que ler `@inject(ConexosSispagWriteClient) fin015` em `IngestaoPagamentosService.ts:37`: alto → baixo.

- **Tactic alvo**: Encapsulate; Restrict Communication Paths
- **Severidade**: P2
- **Esforço estimado**: S (opção A) / M (opção B)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - % de métodos "read" no client `*Write*`: 67% → 0% (opção B) ou N/A (opção A, renomeado)
  - Services read-only importando o "WriteClient": 2 → 0
- **Risco de não fazer**: A separação I1 (read-only) declarada na ontologia deixa de valer na prática. Auditoria de "quem escreve" fica ambígua. Um gate futuro por env-flag vira breaking-change.
- **Dependências**: nenhuma direta; se optar por B, coordenar com o card de retomada (usa `listarLotesNativos`/`getLoteNativo`/`listarChavesDoLote`).

### [integrability-4] Endurecer o contexto do grid de pendentes contra reciclagem de `flpCod`

- **Problema**
  > `listarTitulosComBoletoDda` usa o **maior `flpCod`** da conta pagadora como contexto de leitura do grid — um `flpCod` que o próprio ERP recicla (migration 0049). O grid responde algo que é do TÍTULO usando um artefato de outro fluxo como âmbito. Nada valida "o contexto ainda é o mesmo entre duas rodadas", e nenhum teste cobre "e se o `flpCod` do contexto for cancelado ou reciclado entre chamadas?".

- **Melhoria Proposta**
  > Três camadas: (a) preferir um lote **finalizado** (`status=1`) como contexto — evitar rascunho, que a analista pode cancelar/reciclar; se não houver, cair no maior aberto com WARN. (b) Adicionar um teste que injeta duas rodadas com `flpCod`s consecutivos diferentes e verifica que o conjunto de `docCod` com `temBoletoDda=true` é estável para os títulos que não mudaram no ERP (fixture). (c) Registrar no log da ingestão qual `flpCod` foi usado como contexto por filial, para permitir correlação a posteriori quando a coluna Boleto oscilar.

- **Resultado Esperado**
  > A leitura da carteira deixa de depender do estado transitório do rascunho de lote da conta. A analista pode confiar que a coluna Boleto só muda por evento do ERP, não por operação dela em outra tela.
  > Testes cobrindo reciclagem/cancelamento do `flpCod` de contexto: 0 → ≥ 2. `flpCod` usado como contexto logado por rodada: ausente → presente.

- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Preferência por `status=1`: implementada
  - Teste de estabilidade entre rodadas com `flpCod` diferente: 0 → ≥ 1
  - Log estruturado do contexto por filial: ausente → presente
- **Risco de não fazer**: Flutuação da coluna Boleto entre rodadas quando a analista mexe em rascunho de lote no ERP. Chamado de suporte "por que sumiu o boleto?" recorrente.
- **Dependências**: nenhuma

### [integrability-5] Definir política de sondas versionadas e mover `fin124` para "diagnóstico"

- **Problema**
  > O delta adiciona 7 sondas em `src/backend/jobs/` (3 delas escrevem em HML). Todas têm guard (`if (!BASE.includes('-hml')) exit 1`), o que é bom. Mas `jobs/` acumulou 51 arquivos / 9027 LOC (mais que `domain/repository/`), diluindo o sinal de "quais jobs rodam em produção". Além disso, `endpoints_read` na doc de integração lista `fin124/*` como leitura do sistema — mas em runtime ninguém consulta `fin124`; só as sondas.

- **Melhoria Proposta**
  > (a) Separar `src/backend/jobs/probes/` de `src/backend/jobs/` (runtime), ou mover as sondas para `docs/probes/`/branch dedicada. (b) Na `ontology/integrations/conexos.md`, mover `fin124/list` da tabela `endpoints_read` para uma sub-seção "Diagnóstico (só sondas, não runtime)", removendo a linha da tabela principal. (c) Documentar no `CLAUDE.md`/AGENTS a política: "sondas HML que escrevem ficam no repo se e só se referenciadas por um ADR aceito; senão, `git worktree` descartável".

- **Resultado Esperado**
  > `endpoints_read` volta a listar só o que a solução realmente consome — a doc de integração serve como contrato, não como diário de bordo. `jobs/` volta a caber num screen sem scroll.
  > Endpoints em `endpoints_read` que 0 código de runtime referencia: 1 → 0. Sondas HML em `src/backend/jobs/` (top level): 7 → 0 (movidas ou catalogadas).

- **Tactic alvo**: Encapsulate (repo layout como contrato)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Endpoints em `endpoints_read` não referenciados em `src/backend/domain/**`: 1 → 0
  - Sondas HML fora do runtime path: definido pela política
- **Risco de não fazer**: Diluição do sinal — o próximo dev que ler `ontology/integrations/conexos.md` vai gastar tempo procurando o código que consome `fin124` (não existe).
- **Dependências**: precede/coordena com futura decisão do time sobre "onde vivem sondas de campo"

### [integrability-6] Instrumentar breaking-change do Conexos com observabilidade agregada

- **Problema**
  > A ausência de version-pinning na API do Conexos (não é culpa do repo — ERP proprietário sem `v1`/header) combinada com o contrato descoberto por engenharia reversa (F-1) e coerções sem Zod (F-3) significa que a única detecção de breaking-change hoje é o banco recusar a remessa. Não há métrica agregada que diga "algo mudou no wire".

- **Melhoria Proposta**
  > Sem infra AWS ainda (Render), o incremento é modesto: (a) contar por rodada de ingestão, por filial, a taxa de `titVldReflexoDdaAssoc=1` e persistir num `pagamento_ingestao_run.metrics` JSONB (ou coluna dedicada); (b) job de retro/dashboard que compare "última rodada vs. média das últimas N" e emita `LOG_TYPE.OPERATIONAL_ALERT` se a taxa cair para 0% ou pular de 0% para 100%; (c) mesma métrica para o QUESTION que precisou de re-POST (contagem por chave); (d) executar `contrato.test.ts` também em pipeline de smoke pós-deploy contra HML.

- **Resultado Esperado**
  > Uma quebra do wire vira alerta na próxima rodada, não na próxima recusa do banco. Diferença de tempo-de-detecção: dias → minutos.
  > Métricas de saúde de integração: 0 → 3 (taxa DDA por filial, contagem de re-POST por chave, latência do fin015). Alertas configurados: 0 → 2.

- **Tactic alvo**: Observability of integration failures (facet); Versioning strategy (compensação)
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-6, F-integrability-1, F-integrability-3
- **Métricas de sucesso**:
  - Tempo médio de detecção de "flag DDA caiu a 0": indeterminado → ≤ 1 rodada
  - Alertas de integração: 0 → 2
- **Risco de não fazer**: Manter o modelo "detecção pelo banco" — inaceitável para caminho de pagamento. Em 6 meses, garantidamente uma remessa quebra em produção antes da detecção humana.
- **Dependências**: coordena com `qa-observability`/`qa-fault-tolerance` (mesma instrumentação atende os três QAs).

## 6. Notas do agente

- Fatos que mudaram o julgamento: (i) o `WriteClient` **já** hospedava 4 leituras antes do delta — o delta adicionou a 5ª (`listarTitulosComBoletoDda`) e a **1ª** dependência de um service read-only (ingestão) — então o problema é agravado, não introduzido, aqui. (ii) `contrato.test.ts` **já cobre** `titVldReflexoDdaAssoc` na fixture do grid, o que reduz F-3 de P0 para P1. (iii) o re-POST com `answers` **não** fere ADR-0013 (o POST que devolve QUESTION é pré-commit, medido em HML).
- Cross-QA que o consolidator deve costurar: **F-1/F-3 (Contract/Zod)** cruzam com `qa-security` (validação de input externo) e `qa-fault-tolerance` (falha em vez de degradação silenciosa). **F-2 (Encapsulate)** cruza com `qa-modifiability` — o próximo `/feature-new` que quiser gatear o WriteClient tropeça no mesmo lugar. **F-6 (Observability)** é o mesmo card que `qa-observability` provavelmente vai levantar — mesma instrumentação atende ambos.
- Não medível localmente: tempo real de detecção de breaking-change no Conexos (exigiria produção + monitoramento); custo real das leituras extras por rodada em latência (exige medição contra ERP vivo — a sondagem só amostrou contagens).
