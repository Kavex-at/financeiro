---
qa: Security
qa_slug: security
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-security
generated_at: 2026-08-28T02:55:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Security — Regis-Review

> Delta `feat/sispag-boleto-dda` (commit `5978ac5`). Escopo: **backend** (o delta de frontend
> é puramente display — adiciona coluna "Boleto" e um aviso `text-warning`, sem novos endpoints,
> sem `dangerouslySetInnerHTML`, sem armazenamento client-side de token/segredo). Modo `--quick`
> — não rodar `npm audit` profundo (endereçado em `617ca3b`, axios 1.16.1 → 1.19.0).
>
> Infra/tenants/IAM: **não medível** — este repo não tem `infra/` (deploy via Render hook,
> ver `_shared-metrics.md`).

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| ERP Conexos (comprometido ou com bug) | devolve `{type:'QUESTION'}` com uma chave arbitrária durante `POST fin015/finItemSispag/titulosPendentes/importar` | `ConexosSispagWriteClient.importarTitulos` (importação de título em lote de pagamento) | Fluxo produtivo de escrita SISPAG — `associarDda: true`, ledger `remessa_execucao` aberto, dinheiro a ser efetivado no `finalizarLote` seguinte | Só a chave EXATA `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` é auto-respondida com `YES`; envelope com 2+ perguntas ou qualquer outra chave sobe como `ErpPerguntaError` (409) para decisão humana; re-POST acontece no máximo 1×, e a decisão é auditada em log de negócio persistido | 0 auto-YES em chaves fora da allowlist; 0 loops de re-POST; 100% das auto-respostas com evento `BUSINESS_INFO` correlacionável ao `remessa_execucao.idempotencyKey` |

> Contexto: esta é a **primeira** superfície do repo que responde uma pergunta do ERP sem
> humano. A doutrina antiga (`ErpPerguntaError`) é NÃO responder — ela foi relaxada para
> UMA chave, precedida por sondagem que provou que `POST QUESTION` não é escrita parcial
> (a contagem de itens do lote não muda antes do re-POST). O escrutínio é sobre o guard
> e sobre a rastreabilidade.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chaves do ERP na allowlist de auto-resposta | **1** (`FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`) | ≤ 3, todas justificadas por sondagem | ✅ | `ConexosSispagWriteClient.ts:52` |
| Comparação da allowlist | igualdade exata (`===`) — sem `includes` / regex | igualdade exata | ✅ | `ConexosSispagWriteClient.ts:582` |
| Recusa envelope com 2+ perguntas | sim (`parsed.data.questions.length !== 1`) | sim | ✅ | `ConexosSispagWriteClient.ts:580` + teste `client.test.ts:322` |
| Zod no boundary do envelope QUESTION | sim (`QUESTION_SCHEMA.safeParse`) | sim | ✅ | `ConexosSispagWriteClient.ts:58-61` |
| Re-POST único (sem laço) | sim — 2ª QUESTION vira `ErpPerguntaError` | 1 retry no máximo | ✅ | `ConexosSispagWriteClient.ts:551-565` + teste `client.test.ts:346` |
| Log `BUSINESS_INFO` a cada auto-resposta ao ERP | **0** — nunca é emitido | 1 por auto-resposta (tasks.md T1) | ❌ | `grep 'logService' ConexosSispagWriteClient.ts` → 0 hits |
| Ledger `remessa_execucao` registra fato "auto-YES" | **não** — só grava `{itens, flpCod}` | grava discriminador da auto-resposta | ❌ | `RemessaService.ts:462` (`setRequestPayload`) |
| Fail-closed BOLETO sem DDA antes do POST de escrita | sim — `BoletoSemCodigoBarrasError` (409) | sim, antes do 1º `postGenericOnce` | ✅ | `RemessaService.ts:876` + `BoletoSemCodigoBarrasError.ts` |
| Probes de escrita — guard de base HML | substring `BASE.includes('-hml')` | allowlist exata da host | ⚠️ | `probe-dda-assoc-write-hml.ts:31`, `probe-dda-answer-shape-hml.ts:24` |
| Probes read-only — guard de PRD | `!IS_HML && PROBE_PRD !== '1'` (opt-in explícito) | opt-in explícito | ✅ | `probe-fin124-dda.ts:41`, `probe-boleto-fonte.ts:26`, `probe-com308-codbar.ts:21`, `probe-fin015-boleto-vinculo.ts:33` |
| Segredos hardcoded no delta | 0 | 0 | ✅ | `git show 5978ac5 \| grep -inE 'password\|senha\|token\|secret\|AKIA'` — só `seed-admin.ts` pré-existente (fora do delta) |
| CNPJ / nomeFav no delta | 0 | 0 | ✅ | `git show 5978ac5 \| grep -nE 'CNPJ\|itsEspNomeFav\|pesNome'` |
| Barcodes de PRD no delta | **1** literal (47 dígitos, bank 745 = Citibank BR) | 0 (redigir com hash/máscara) | ⚠️ | `ontology/_inbox/sispag-boleto-dda-sondagem.md:117` |
| Interpolação de SQL string no delta | 0 | 0 | ✅ | `git show 5978ac5 -- '*.ts' \| grep -E '\\\`.*(SELECT\|INSERT\|UPDATE\|DELETE)'` |
| `dangerouslySetInnerHTML` no delta | 0 | 0 | ✅ | `git show 5978ac5 -- 'src/frontend/**'` |
| IAM / tenants / CloudTrail / GuardDuty | ⚠️ **não medível** | — | — | `infra/` não existe (`_shared-metrics.md`) |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | N/A no delta — nenhum novo detector; a superfície de escrita é interna (`ConexosBaseClient` autentica com o SID do Conexos, sem mudança) | N/A | — |
| Detect Service Denial | Paginação com `console.warn` quando trunca (herdado, tocado pela adição de `listarTitulosComBoletoDda` que atravessa até 40 páginas) | ⚠️ parcial | `ConexosSispagWriteClient.ts:415-421` |
| Verify Message Integrity | Zod na resposta do ERP: `LOTE_CRIADO_SCHEMA` no `criarLote`, `SUCESSO_SCHEMA` no `gerarRemessa`, `QUESTION_SCHEMA` no envelope de pergunta antes de auto-responder | ✅ presente | `ConexosSispagWriteClient.ts:22-30, 33-36, 58-61, 578` |
| Detect Message Delay | N/A no delta — retry/timeout do transporte ficam no `ConexosBaseClient` (não tocado) | N/A | — |
| Identify Actors | N/A no delta — nenhum consumidor novo do endpoint HTTP; o `ImportarTitulosParams.associarDda` é parâmetro interno de serviço | N/A | — |
| Authenticate Actors | N/A no delta — auth de app (login usuário/senha, `seed-admin.ts`) e SID do Conexos permanecem intocados | N/A | — |
| Authorize Actors | N/A no delta — nenhuma rota nova; `associarDda` é derivada server-side pelo `RemessaService.montarItensImport` a partir do `TituloPendente.temBoletoDda` (leitura do ERP), não do cliente | N/A | `RemessaService.ts:875` |
| Limit Access | Probes de escrita recusam base ≠ `-hml`; probes read-only exigem `PROBE_PRD=1` para PRD | ⚠️ parcial — guard de escrita é `substring`, ver F-security-3 | `probe-dda-assoc-write-hml.ts:31`, `probe-dda-answer-shape-hml.ts:24` |
| Limit Exposure | Fail-closed no ENVIO: BOLETO sem `temBoletoDda` gera `BoletoSemCodigoBarrasError` (409) ANTES do primeiro POST de escrita — a remessa não pode sair com segmento J vazio; escopo da auto-resposta é UMA chave, e responder `YES` só anexa o código de barras que o próprio ERP casou (não move valor, não escolhe favorecido, não altera modalidade — o ERP a deriva do banco emissor do barcode) | ✅ presente | `RemessaService.ts:876-886`, `BoletoSemCodigoBarrasError.ts`, `ConexosSispagWriteClient.ts:40-53` |
| Encrypt Data | N/A no delta — canal HTTPS ao Conexos é pré-existente; nenhum dado novo persistido em claro além do flag booleano `tem_boleto` | N/A | — |
| Separate Entities | Allowlist estreita com igualdade exata + recusa de envelope com 2+ perguntas (mesmo se uma delas for a allowlistada) — impede que uma pergunta nova entre de carona; e as duas leituras do fluxo (`perguntaAutoRespondivel` → só a chave allowlistada; `perguntaDoErp` → toda pergunta) estão em métodos separados | ✅ presente | `ConexosSispagWriteClient.ts:578-585`, teste `client.test.ts:322` |
| Change Default Settings | `ImportarTitulosParams.associarDda?: boolean` com default `false` — o comportamento histórico (mandar `titVldReflexoDdaAssoc: 0`) permanece a menos que o serviço peça explicitamente | ✅ presente | `Fin015Write.ts:97-108`, `ConexosSispagWriteClient.ts:513` |
| Validate Input | Zod nos 3 shapes de resposta do ERP tocados no delta (ver Verify Message Integrity); no import, o `id` da pergunta que volta ao ERP como CHAVE do map `answers` é validado via `QUESTION_SCHEMA` (`z.string().optional()`) e o VALOR é a constante `'YES'` — atacante controlando o ERP não injeta valor de resposta arbitrário | ✅ presente | `ConexosSispagWriteClient.ts:58-61, 556-565` |
| Revoke Access | N/A no delta | N/A | — |
| Lock Computer | N/A no delta | N/A | — |
| Inform Actors | `BoletoSemCodigoBarrasError.userMessage` nomeia `docCod/titCod` e diz o que sanear ("importe o arquivo DDA no fin124 ou troque a forma de pagamento"); no painel, o `LoteCard` avisa "sem boleto DDA — a remessa sairia sem código de barras" | ✅ presente | `BoletoSemCodigoBarrasError.ts:25-28`, `LoteCard.tsx:417-424` |
| Restore | Ledger `remessa_execucao` (pré-existente) permite retomada após queda entre `criarLote` e `setNativeFlpCod` — não tocado por este delta | ✅ presente (fora do delta) | `RemessaService.ts:340, 396-436` |
| Audit Trail | **GAP**: a auto-resposta ao ERP não emite log de negócio; o ledger `remessa_execucao` só registra `{itens, flpCod}` no `setRequestPayload`, sem discriminar "auto-YES à FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO". Contradiz o item explícito de `sispag-boleto-dda-tasks.md` T1 | ❌ ausente | Ver F-security-1 |

## 4. Findings

### F-security-1: Auto-resposta `YES` ao ERP em fluxo de pagamento não é auditada

- **Severidade**: P1 (audit trail ausente sobre decisão automatizada em fluxo write-to-money; contrato explícito de T1 violado)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:544-567` (bloco do re-POST), `src/backend/domain/service/sispag/RemessaService.ts:462-478` (chamador)
- **Evidência (objetiva)**:
  ```
  # Cliente que executa a auto-resposta NÃO tem LogService injetado:
  $ grep -c 'LogService\|logService' src/backend/domain/client/ConexosSispagWriteClient.ts
  0

  # Contrato explícito em sispag-boleto-dda-tasks.md T1:
  "Log `BUSINESS_INFO` a cada auto-resposta (auditoria de escrita no ERP)."

  # RemessaService.setRequestPayload grava só shape, sem discriminar auto-resposta:
  RemessaService.ts:462  await this.ledger.setRequestPayload(key, { itens: montados.length, flpCod });
  ```
- **Impacto técnico**: Uma auto-resposta bem-sucedida deixa 0 rastro do lado do sistema. Se o ERP futuramente inverter o sentido da chave (`YES` = "não use este boleto"), se o mapeamento `id → 'YES'` for adulterado por um proxy MITM entre nós e o ERP, ou se o próprio guard for regredido para aceitar mais uma chave, não há evento persistido correlacionável ao `remessa_execucao.idempotencyKey` que permita reconstituir "em que lote, com que resposta, para qual `titCod`". A única evidência hoje é indireta: o item do lote passou a ter `itsNumCodbar` preenchido — mas isso é o resultado, não a decisão.
- **Impacto de negócio**: SISPAG é o caminho de dinheiro saindo da empresa. Em incidente pós-morte ("por que este pagamento saiu com o barcode X?"), o time não consegue provar do próprio log se foi o ERP que casou, se o sistema disse `YES` para uma pergunta diferente, ou se houve reprocessamento. Não é hipotético: `tasks.md` colocou o log como acceptance criterion justamente porque a decisão é automatizada e envolve o ERP anexar identificador de destino (barcode) ao item.
- **Métrica de baseline**: `0` chamadas de `logService.*` no arquivo que executa a auto-resposta (`grep -c`). Total de auto-respostas emitidas hoje sem registro em `BUSINESS_INFO`: **100%** dos itens BOLETO importados via `associarDda: true` que caírem no QUESTION path.

### F-security-2: Código de barras real de produção commitado em texto claro

- **Severidade**: P2 (dado de terceiro real em repositório versionado; sem risco de crédito direto — barcode não abre login em lugar nenhum — mas identifica uma relação comercial e permite reconstituir valor/vencimento se o repo vazar)
- **Tactic violada**: Limit Exposure
- **Localização**: `ontology/_inbox/sispag-boleto-dda-sondagem.md:117` (também referenciado em `229` no diff completo do commit)
- **Evidência (objetiva)**:
  ```
  $ git show 5978ac5 | grep -nE '\b[0-9]{40,}\b'
  174:+| `itsNumCodbar` | `74593180079362001100201010433181712720000048980` (47 díg.) |

  # Prefixo 745 = Citibank BR. É o barcode do item real doc 452/1
  # importado no lote de teste flp 24 (fil 2, bnc 4) — HML, mas gerado a partir
  # de um arquivo DDA real do fornecedor.
  ```
- **Impacto técnico**: O barcode carrega, no próprio conteúdo, o banco beneficiário, o "nosso número" da cobrança, o valor e o vencimento — em posições fixas do padrão CNAB/FEBRABAN. Qualquer pessoa com acesso ao repositório (incluindo eventual leak público) pode ler direto do arquivo.
- **Impacto de negócio**: Baixo em risco direto (o barcode não move dinheiro sem uma remessa autenticada indo do banco pagador ao banco beneficiário). Real em confidencialidade de dado de terceiro: revela um fornecedor da Columbia, um valor pago e a data. Em vazamento do repo, dá insumo para *engenharia social* dirigida ao fornecedor identificado, ou para reconciliação cruzada com outros vazamentos. É também o tipo de dado que a Columbia contratou a Kavex assumindo que não seria versionado.
- **Métrica de baseline**: 1 barcode real (47 dígitos) em 1 arquivo do delta; 0 CNPJs; 0 nomes de favorecido; 0 credenciais. O restante das medições da sondagem é agregada (contagens 32/36, 41/41, 8/8), que é o formato correto — só este único literal escapou.

### F-security-3: Guard de PRD dos probes de escrita usa substring match

- **Severidade**: P3 (hardening defense-in-depth; hoje o ambiente Conexos da Columbia não expõe host contendo `-hml` em URL de produção, então o guard funciona — mas o critério é frágil)
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/jobs/probe-dda-assoc-write-hml.ts:30-33`, `src/backend/jobs/probe-dda-answer-shape-hml.ts:23-26`
- **Evidência (objetiva)**:
  ```typescript
  // probe-dda-assoc-write-hml.ts
  const BASE = process.env.CONEXOS_BASE_URL ?? '';
  if (!BASE.includes('-hml')) {
      console.error(`RECUSADO: este teste ESCREVE e só roda em HML. Base atual: ${BASE}`);
      process.exit(1);
  }
  ```
- **Impacto técnico**: `String.prototype.includes('-hml')` aceita qualquer URL que contenha `-hml` em qualquer posição — por exemplo `prod-hml-backup.example.com`, `columbiatrading.conexos.cloud/api?env=-hml`, ou uma faixa de query string colada por engano num script wrapper. Um alias PRD futuro com essa substring passa. O guard também não distingue esquema (`http://` vs `https://`).
- **Impacto de negócio**: Baixo hoje — o host HML atual é `columbiatrading-hml.conexos.cloud` e o PRD é `columbiatrading.conexos.cloud`, dois nomes distintos e estáveis. Mas os probes ESCREVEM no ERP (cria lote nativo, associa DDA), e o custo de um disparo em PRD por acaso é um lote fantasma no fin015 real. A cintura de segurança do repo não deveria depender de uma convenção de naming da Conexos.
- **Métrica de baseline**: 2 probes de escrita usando `includes('-hml')`; 0 usando allowlist positiva de host.

## 5. Cards Kanban

### [security-1] Emitir `BUSINESS_INFO` a cada auto-resposta ao ERP no import SISPAG

- **Problema**
  > O `ConexosSispagWriteClient.importarTitulos` responde `YES` sozinho à pergunta `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` do ERP num fluxo que termina em `.REM` bancária, mas não deixa rastro auditável do lado do sistema. O único vestígio é indireto (o item passa a ter `itsNumCodbar` no ERP). O `tasks.md` da própria feature (T1) previa o log; ele não foi implementado. Em incidente pós-morte, não é possível reconstituir do log local qual `docCod/titCod`/`flpCod` recebeu auto-resposta.

- **Melhoria Proposta**
  > Injetar `LogService` no `ConexosSispagWriteClient` (já é `@singleton() @injectable()`) e emitir `logService.info({ type: LOG_TYPE.BUSINESS_INFO, message: 'auto-resposta YES à pergunta do ERP', data: { path, filCod, bncCod, flpCod, docCod, titCod, questionKey: PERGUNTA_AUTO_RESPONDIVEL, questionId } })` **antes** do re-POST. Alternativa mais fina: erguer o log um nível, no `RemessaService`, correlacionado ao `remessa_execucao.idempotencyKey` — o ledger já é o correlator canônico. Cross-ref cards de Fault Tolerance sobre audit trail; aproveitar o mesmo enriquecimento do `LogService` (metadata do handler).

- **Resultado Esperado**
  > 100% das auto-respostas com evento `BUSINESS_INFO` persistido, correlacionável a `idempotencyKey`. Em produção, `SELECT` na tabela de logs por `data.questionKey = 'FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO'` devolve N eventos = N vezes que auto-respondemos, e cada evento nomeia o título afetado.

- **Tactic alvo**: Audit Trail
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - `# auto-respostas registradas em BUSINESS_INFO` / `# re-POSTs executados`: 0/N → N/N
  - `grep -c 'logService' src/backend/domain/client/ConexosSispagWriteClient.ts`: 0 → ≥1
- **Risco de não fazer**: Incidente em que um pagamento sai para o beneficiário errado com barcode inesperado é atribuído a "bug do ERP" sem prova em contrário — e a feature vive sob a expectativa de que "o ERP casou certo", sem meio local de refutar. Compliance/auditoria vai pedir esse log na primeira revisão.
- **Dependências**: nenhuma; o `LogService` já é usado por `RemessaService`, `IngestaoPagamentosService` e `LotePagamentoService` no delta.

### [security-2] Redigir barcode real de produção do arquivo de sondagem

- **Problema**
  > `ontology/_inbox/sispag-boleto-dda-sondagem.md:117` contém o barcode `74593180079362001100201010433181712720000048980` verbatim — 47 dígitos que codificam banco beneficiário (Citibank 745), valor, vencimento e "nosso número" de um pagamento real de um fornecedor da Columbia. É o único dado individual (não agregado) da sondagem; todos os demais números do arquivo são contagens.

- **Melhoria Proposta**
  > Substituir o literal por uma máscara redigida que preserve o formato para fim didático (`74593xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (47 díg., banco 745)`) e uma nota de rodapé apontando para o item real por chave interna (`item doc 452/1 do lote flp 24 em HML`, que já está no próprio arquivo). Se o barcode for tecnicamente necessário para reprodução do teste, salvar em `docs/_snippets/` fora do git (via `.gitignore`) ou em cofre. Considerar `git filter-repo` para eliminar o valor do histórico se o repo for público — caso contrário, redação prospectiva basta.

- **Resultado Esperado**
  > `git grep -E '\b[0-9]{40,}\b'` no repo devolve 0 hits. Nenhum dado individual de fornecedor terceiro em arquivo versionado.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - `# barcodes reais de PRD versionados`: 1 → 0
  - `# arquivos com dado individual de terceiro`: 1 → 0
- **Risco de não fazer**: Se o repositório vazar (ou virar público no futuro), o dado identifica uma relação comercial da Columbia com um credor específico e permite reconstituir o valor e vencimento do pagamento. Também estabelece precedente ruim: os próximos probes reais colam dado real em `_inbox/` "porque o outro tem".
- **Dependências**: confirmar com o Yuri se `git filter-repo` é necessário (depende do quão público for o histórico atual).

### [security-3] Trocar `BASE.includes('-hml')` por allowlist positiva de host

- **Problema**
  > Os dois probes que escrevem em HML (`probe-dda-assoc-write-hml.ts`, `probe-dda-answer-shape-hml.ts`) recusam bases que não contenham `-hml`. É substring match — passa em qualquer URL que contenha `-hml` em qualquer posição, e é sensível a mudanças de naming da Conexos que fujam da convenção. O impacto real hoje é baixo porque os hosts oficiais são distintos, mas o custo de um disparo em PRD por acidente é um lote fantasma no `fin015` real.

- **Melhoria Proposta**
  > Substituir o guard por uma allowlist positiva de host (via `URL(BASE).host`), tipo:
  > `const ALLOWED = new Set(['columbiatrading-hml.conexos.cloud'])`
  > `if (!ALLOWED.has(new URL(BASE).host)) { ... exit(1) }`.
  > E aplicar o mesmo padrão aos probes de leitura em PRD, promovendo `PROBE_PRD=1` de flag mágica a par `PROBE_HOST=columbiatrading.conexos.cloud`. Alternativa mais radical: mover os probes para fora do `src/backend/jobs/` (para um `scripts/probes/` fora do path de execução dos jobs canônicos), garantindo que um `tsx src/backend/jobs/*.ts` de CI nunca os toque.

- **Resultado Esperado**
  > Nenhum probe de escrita executa contra host fora da lista, mesmo com URL colada por acidente com `-hml` embutido em querystring/path. `# probes com guard substring`: 2 → 0.

- **Tactic alvo**: Limit Access
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - `# probes de escrita com allowlist positiva de host`: 0 → 2
  - `grep -c "includes('-hml')" src/backend/jobs/*.ts`: 2 → 0
- **Risco de não fazer**: Aceitável enquanto os hosts da Conexos não mudarem. Cresce se a Kavex passar a operar probes em CI (uma variável de ambiente mal setada dispara escrita em PRD).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Guard do auto-YES é bem construído em 4 dimensões independentes (Zod boundary, contagem `!== 1`, `===` estrito por chave, re-POST single-shot com fallthrough para `ErpPerguntaError`) e todas as 4 têm teste unitário explícito (`ConexosSispagWriteClient.test.ts:276-345`). Não abri finding contra o desenho — só contra a instrumentação (F-security-1).
- Cross-QA: **F-security-1 (Audit Trail)** overlap direto com Fault Tolerance (auditoria da retomada) e com Modifiability (o `RemessaService` já centraliza logs; injetar `LogService` no client duplica caminho — alertar o `qa-consolidator` para não abrir 2 cards paralelos). **F-security-2 (Limit Exposure)** overlap com Deployability (política de arquivos versionáveis). **Validate Input via Zod** no boundary QUESTION overlap com Integrability.
- Métricas de infra (IAM, CloudTrail, GuardDuty, per-Lambda policy, tenant isolation, CORS, WAF) são **não medíveis** neste repo: `infra/` não existe e o deploy é via Render hook. Não gerei findings sobre isso — é estado documentado em `CLAUDE.md`.
- `npm audit` profundo pulado por `--quick` (último endereçado em `617ca3b`).
