---
qa: Security
qa_slug: security
run_id: 2026-08-12-1315
agent: qa-security
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Security — Regis-Review

> Escopo restrito ao delta `fix/nde-descricao-item`: novo ponto de ESCRITA no ERP (PUT
> `com297/comDocProdutos` — gravação de `dprLngDescrNf` do item da NDe quando o ERP a deixou vazia),
> nova env opcional `NDE_DESCRICAO_ITEM_FALLBACK` e sonda read-only de diagnóstico
> (`recebimentos.e2e.descricaoNfeNde.integration.test.ts`). CIA analisada sob a ótica de
> multi-tenant (por filial) + hardening da nova escrita.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado (ou atacante com JWT válido) dispara `POST /recebimentos/transacoes/:txnId/alocacoes` para um `priCod` cuja NDe ainda não homologou | Nova etapa `etapaDescricaoItem` executa `PUT com297/comDocProdutos` com a linha inteira e `dprLngDescrNf` derivada de env/ERP/cadastro do produto | `RecebimentoNumerarioService.etapaDescricaoItem` + `ConexosNdeFiscalClient.gravarDescricaoItemNde` + `NDE_DESCRICAO_ITEM_FALLBACK` | Produção multi-tenant (uma conta AWS por cliente é o alvo; hoje Render + Supabase; caminho gated por `conexosWriteEnabled && !conexosDryRun`) | Escrita só sai com filial autorizada (`assertUserCanActOnFilial`), com filCod DO PROCESSO no header, contra o `ndDocCod` que a mesma execução gerou; RMW preserva os ~104 outros campos do item; ACL do ERP nega 403 no fail-closed; texto é trim+slice(4000) antes do PUT | 0 escritas fora da filial autorizada · 0 escritas com `dprLngDescrNf` vazia · 0 vazamento de segredo em log ou dump da sonda · 100% das leituras da sonda dentro da allowlist de 6 regex |

> Cenário fantasma (não coberto pelo delta) para o consolidador: "insider com acesso ao repo/deploy
> seta `NDE_DESCRICAO_ITEM_FALLBACK` com texto embarcando dado sensível ou instrução ao fiscal" —
> vira `xProd` da NF-e emitida por até N clientes na janela até alguém notar. Contorno: escopo por
> tenant já garantido pelo modelo Render env/tenant (uma env por tenant), mas a governance do valor
> não é do código.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novos endpoints de ESCRITA no ERP introduzidos pelo delta | 1 (`PUT com297/comDocProdutos`) | inventariado + gated | ✅ | `src/backend/domain/client/ConexosNdeFiscalClient.ts:383-419` |
| Gating `conexosWriteEnabled && !conexosDryRun` respeitado pelo novo caminho | Sim (etapa vive dentro de `rodarEtapas`, chamado só após early-return de dry-run) | 100% | ✅ | `RecebimentoNumerarioService.ts:272, 302, 340-421, 455` |
| Filial no header (`Cnx-filCod`) nas 4 novas chamadas do client | 4/4 (`listItensNde`, `lerItemNde`, `preDescricaoProdutoNf`, `gravarDescricaoItemNde` — todas passam `{ filCod }`) | 100% | ✅ | `ConexosNdeFiscalClient.ts:275, 313, 342, 401` |
| Novos segredos hardcoded no delta | 0 | 0 | ✅ | `git diff main -- src/ \| grep -Ei "(password\|secret\|token\|key\|credential).*=.*['\"]"` — nenhum hit em código |
| Novas envs sensíveis (segredo) introduzidas | 0 (`NDE_DESCRICAO_ITEM_FALLBACK` é texto de negócio, não segredo) | 0 | ✅ | `EnvironmentVars.ts:133-144`, `EnvironmentProvider.ts:178,237` |
| Validação de input no boundary do client (Zod + truncamento) | Zod `passthrough` no eco + `trim+slice(0, DESCRICAO_IMPRESSAO_MAX=4000)` antes do PUT + recusa de string vazia | Zod + limite físico | ✅ | `ConexosNdeFiscalClient.ts:68-77, 80, 383-396` |
| Sanitização de caracteres de controle / injeção em `dprLngDescrNf` (que vira o `xProd` da NF-e) | Ausente — só `trim`+`slice(4000)` | strip de `\p{Cc}` / normalize NFC | ⚠️ | `ConexosNdeFiscalClient.ts:389` (`.trim().slice(0, DESCRICAO_IMPRESSAO_MAX)`) |
| Granularidade da ACL preflight cobrindo `com297/comDocProdutos UPDATE` | Ausente — `ACL_REQUERIDAS` só casa substring `'com297'` (bate com HOMOLOGAR também); não distingue UPDATE de item vs HOMOLOGAR | grant explícito para o novo verbo | ⚠️ | `NumerarioAclChecker.ts:19-24` |
| Permissões do dump da sonda (`<tmp>/nde-descricao-diagnostico.json`) | `writeFileSync` sem `mode` → obedece umask (0022 padrão → mode 0644 em `/tmp`) | 0600 ou `mkdtempSync` com 0700 | ⚠️ | `recebimentos.e2e.descricaoNfeNde.integration.test.ts:210-212` |
| Allowlist da sonda cobrindo todos os verbos de escrita | Sim — 6 verbos envelopados (`getGeneric`, `postGeneric`, `postGenericOnce`, `putGenericOnce`, `deleteGeneric`, `postMultipartOnce`); 6 regex de leitura | 100% | ✅ | `recebimentos.e2e.descricaoNfeNde.integration.test.ts:44-51, 177-200` |
| Credenciais do probe manuseadas via env do shell (não commitadas) | Sim — `exigirEnv('CONEXOS_PROBE_USERNAME'/'CONEXOS_PROBE_PASSWORD')`, senha NUNCA gravada no dump | 100% | ✅ | `recebimentos.e2e.descricaoNfeNde.integration.test.ts:92-101, 135-155` |
| Log `BUSINESS_WARN` da nova etapa vaza segredo | Não — payload traz `descricaoGravada`/`descricaoEco` (texto de NF-e), `prdCod`, `dprCodSeq`, `priCod`, `txnId`, `ndDocCod`; nenhum credential/CNPJ nesse ponto | 0 segredos | ✅ | `RecebimentoNumerarioService.ts:1491-1505` |
| `npm audit` do delta | ⚠️ **Não medível localmente no escopo `--quick`** — nenhuma nova dependência foi adicionada (verificado no diff: `src/backend/package.json` intocado). Sem novas superfícies de CVE por transitiva. | — | ⚠️ | `git diff main -- src/backend/package*.json` (vazio) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do escopo do delta (nenhum WAF/IDS novo). | N/A | delta é uma etapa fiscal, não sensor de perímetro |
| Detect Service Denial | Fora do escopo do delta. | N/A | — |
| Verify Message Integrity | Discriminador in-band da etapa: PUT só é sucesso se o eco Zod-parsed trouxer `dprLngDescrNf` NÃO-vazia (aceita normalização do ERP, mas exige que a gravação existiu). | ✅ presente | `ConexosNdeFiscalClient.ts:404-413` |
| Detect Message Delay | Fora do escopo do delta (a etapa é síncrona; delay do poll SEFAZ é da etapa `etapaPoll`, não desta). | N/A | — |
| Identify Actors | Rota `/recebimentos/transacoes/:txnId/alocacoes` já roda com `req.user` (JWT). Etapa herda o `ator` do input do orquestrador e o coloca no ledger de execução. | ✅ presente | `recebimentos.ts:484`, `RecebimentoNumerarioService.ts:266, 415` |
| Authenticate Actors | NextAuth/Supabase JWT na rota (fora do delta). Delta não abre bypass. | ✅ presente | `recebimentos.ts` mid-layer (auth existente, não tocada) |
| Authorize Actors | `assertUserCanActOnFilial(req.user, processoFilCod)` amarra à filial DO PROCESSO. Pré-flight `NumerarioAclChecker` (`NDE_ACL_PREFLIGHT`, default TRUE) consulta `permissoes/new/com297` fail-closed ANTES de qualquer escrita — porém a lista de grants não foi ampliada para o novo verbo `PUT com297/comDocProdutos` (a checagem `'com297'` por substring cobre por acidente, não por design). | ⚠️ parcial | `recebimentos.ts:484, 498`, `NumerarioAclChecker.ts:19-24` |
| Limit Access | RMW: a etapa só substitui `dprLngDescrNf` da linha ecoada pelo `lerItemNde` (chave composta `docCod+fisCod+prdCod+dprCodSeq`); não cria linha nova, não muda `prdCod`/quantidade/preço. `snSelecionadaDocCod` validado por `assertSnPertenceAoProcesso` antes (já existente). | ✅ presente | `RecebimentoNumerarioService.ts:1476-1490`, `ConexosNdeFiscalClient.ts:398-403` |
| Limit Exposure | Sonda de diagnóstico envelopa 6 verbos e permite APENAS 6 regex de LEITURA — qualquer rota fora morre na máquina antes de sair para o ERP; ainda seta `CONEXOS_WRITE_ENABLED=false`+`CONEXOS_DRY_RUN=true` como cinto+suspensório. Gating global `conexosWriteEnabled && !conexosDryRun` continua o único portão da escrita real (etapa vive dentro de `rodarEtapas`, chamada só após early-return de dry-run). | ✅ presente | `recebimentos.e2e.descricaoNfeNde.integration.test.ts:44-51, 150-155, 177-200`; `RecebimentoNumerarioService.ts:272, 302, 455` |
| Encrypt Data | SSM `SecureString` para credenciais Conexos é a política (fora do delta). Delta não introduz canal novo de dado. TLS do axios base para o Conexos idem. | ✅ presente | `EnvironmentProvider.ts:182-215` (fluxo Lambda: `parseSSMCredentials`) |
| Separate Entities | `filCod` obrigatório e propagado NO HEADER (`Cnx-filCod`) nas 4 novas chamadas — nunca na URL. Requisição escreve num `ndDocCod` gerado por essa MESMA execução (retornado por `etapaNotaDebito`). Multi-filial preservado. | ✅ presente | `ConexosNdeFiscalClient.ts:275, 313, 342, 401`; `RecebimentoNumerarioService.ts:1451-1490` |
| Change Default Settings | Escrita default OFF: `conexosDryRun` default true, `conexosWriteEnabled` default false; nova env `NDE_DESCRICAO_ITEM_FALLBACK` é OPCIONAL (default cai em `preDescrProdutoNf` → `prdDesNome` → `NDE_GERACAO_DEFAULTS.produtoNome`) — não exige o operador saber o texto. | ✅ presente | `EnvironmentProvider.ts:148-149, 178, 237`; `RecebimentoNumerarioService.ts:1520-1541` |
| Validate Input | Zod `ITEM_NDE_SCHEMA` (`.passthrough()` para preservar RMW, campos-chave `.coerce.number().int()`, descrições `nullish`) na LEITURA e no ECO; recusa string vazia (`descricao === '' → ConexosError`); truncamento defensivo em 4000 (limite físico do campo). **Falta**: sanitização de caracteres de controle / normalização Unicode antes de escrever no `xProd` da NF-e. | ⚠️ parcial | `ConexosNdeFiscalClient.ts:68-77, 82-87, 383-396` |
| Revoke Access | Fora do escopo do delta. | N/A | — |
| Lock Computer | N/A. | N/A | — |
| Inform Actors | Nova gravação anunciada como `BUSINESS_WARN` (nível deliberadamente warn — a esmagadora maioria das emissões NÃO deveria disparar essa etapa; toda ocorrência é sinal de cadastro do cliente em modo DI). Log carrega `txnId`, `ndDocCod`, `priCod`, `prdCod`, `dprCodSeq`, `descricaoGravada`, `descricaoEco`. | ✅ presente | `RecebimentoNumerarioService.ts:1491-1505, 1466-1473` |
| Restore | Escrita é RMW num item que a MESMA execução gerou; falha na etapa é fail-closed ANTES de `etapaFiscal`/`etapaObservacoes`/`etapaHomologar`, então rollback = simplesmente não homologar (nenhum artefato SEFAZ produzido). Retomada re-executa a etapa (auto-idempotente pelo estado do documento). | ✅ presente | `RecebimentoNumerarioService.ts:1441-1456, 489-491` (`registrarFalha`) |
| Audit Trail | Ledger `SolicitacaoNumerarioExecucaoRepository` guarda a execução; o log `BUSINESS_WARN` acima é o rastro da gravação. **Gap**: sem etapa dedicada no ledger (por design — auto-idempotente) — se a linha do log for perdida, a auditoria só sabe "a NDe homologou", não "a Kavex reescreveu a descrição do item X para Y". Cross-QA para Fault Tolerance. | ⚠️ parcial | `RecebimentoNumerarioService.ts:1441-1450, 1491-1505` |

## 4. Findings (achados)

### F-security-1: `NDE_DESCRICAO_ITEM_FALLBACK` grava texto arbitrário no `xProd` da NF-e sem sanitização de caracteres de controle

- **Severidade**: P2 (médio — a superfície é limitada mas a saída é regulatória)
- **Tactic violada**: Validate Input
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:389`, `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1520-1541`
- **Evidência (objetiva)**:
  ```typescript
  // ConexosNdeFiscalClient.ts:388-389
  const { filCod, item } = params;
  const descricao = params.descricao.trim().slice(0, DESCRICAO_IMPRESSAO_MAX);
  // ...
  await this.base.putGenericOnce<unknown>(
      'com297/comDocProdutos',
      { ...item, dprLngDescrNf: descricao },  // <— vai direto para o eco XML da NF-e
      { filCod },
  );
  ```
  Nada bloqueia ` `..`` (exceto `\t\n\r`), ``, direction-override (`‮`), zero-width joiners, PUA — todos aceitos e persistidos no `dprLngDescrNf` que vira o `xProd` do XML da NF-e emitido pelo Conexos.
- **Impacto técnico**: O SEFAZ tem seu schema (limite de caracteres XML válidos), então o pior caso realista é REJEIÇÃO da homologação — mas há passivo diagnóstico irritante (mensagem de erro do SEFAZ opaca, retrabalho manual) e a possibilidade de char de controle "quebrar" tooling downstream (parser de PDF, ledger contábil, integrações do cliente que consumam o XML) — cada um com sua tolerância.
- **Impacto de negócio**: O texto do fallback é definido POR-TENANT via env (governado pelo deploy, não pelo analista). Um valor mal formado (colado com BOM invisível, aspas curly, quebra Windows CRLF) grava em N notas até alguém rodar uma NDe e sentir. Não há loop humano na trilha: o texto entra silencioso e sai no XML sem revisão.
- **Métrica de baseline**: 0 chars filtrados hoje; alvo: strip de `\p{Cc}` (exceto `\n`), normalização Unicode NFC, colapso de whitespace consecutivo.

### F-security-2: ACL preflight não valida grant específico para `PUT com297/comDocProdutos` (nova superfície de escrita)

- **Severidade**: P2 (médio — o ERP ainda fail-closed no 403; é gap de defense-in-depth)
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/domain/service/recebimentos/NumerarioAclChecker.ts:19-24`
- **Evidência (objetiva)**:
  ```typescript
  const ACL_REQUERIDAS: readonly string[] = [
      'com300', // UPDATE fiscal
      'com131', // GERAR OBS
      'com297', // HOMOLOGAR / HOMOLOGAR CONTINGENCIA
      'com194', // SELECT validações
  ];
  ```
  A checagem casa a permissão devolvida por `permissoes/new/com297` por SUBSTRING (`texto.includes('com297')`) — qualquer permissão contendo "com297" (ex. HOMOLOGAR) satisfaz. O novo verbo introduzido é `PUT com297/comDocProdutos` (UPDATE de item), grant DISTINTO da homologação no modelo do ERP.
- **Impacto técnico**: A conta de serviço passa o pré-flight sem ter o grant específico para atualizar item; a etapa nova roda até o ERP negar 403; o fail-closed subsequente joga a etapa em `error` DEPOIS de já ter gasto sessão, log e latência.
- **Impacto de negócio**: Um provisionamento de tenant que esqueça de conceder "UPDATE ITEM COM297" passa a promessa "está tudo checado antes de escrever" enquanto na prática só descobre no primeiro cliente com cadastro `dpeVld1DescrNfe=4` (a esmagadora minoria). O rastro do erro é claro (a etapa fica em `error` com o 403 do ERP), mas a promessa do preflight é enfraquecida.
- **Métrica de baseline**: 4 grants na lista, 1 novo verbo introduzido pelo delta, 0 grants adicionados. Alvo: 5 grants (incluir marcador para `com297.*UPDATE.*ITEM` / `com297.*comDocProdutos`) — ou trocar a estratégia por lookup por rótulo esperado.

### F-security-3: dump da sonda de diagnóstico grava em `/tmp` com mode 0644 (padrão do umask)

- **Severidade**: P3 (baixo — dev/test artifact, tem PII de negócio, não credencial)
- **Tactic violada**: Encrypt Data (em repouso — dumps de PII em disco compartilhado) / Limit Exposure
- **Localização**: `src/backend/routes/recebimentos.e2e.descricaoNfeNde.integration.test.ts:210-212`
- **Evidência (objetiva)**:
  ```typescript
  const destino = (process.env.PROBE_OUT ?? '').trim() || join(tmpdir(), 'nde-descricao-diagnostico.json');
  // ...
  writeFileSync(destino, JSON.stringify(relatorio, null, 2), 'utf8');
  ```
  `writeFileSync` sem `mode:` respeita o umask do processo (default 0022 → mode 0644). O relatório contém, entre outros: `pesCod`, `dpeNomPessoa`, `docEspNumero`, item inteiro do com297 (~105 campos, inclusive valores), validações `com194`, cadastro `cmn025` (código do cliente + descrição). Não contém credenciais — a senha só transita em `process.env.CONEXOS_PASSWORD`, nunca gravada.
- **Impacto técnico**: Em máquina Linux compartilhada (workstation multi-user, runner CI), qualquer usuário local lê o dump da última execução da sonda.
- **Impacto de negócio**: Vazamento de nome/código de cliente + dados de item fiscal. É telemetria de diagnóstico rodada só por operadores, mas cai em `/tmp` que persiste até o boot / cleanup.
- **Métrica de baseline**: mode 0644 em `/tmp/nde-descricao-diagnostico.json` (calculado por `0666 & ~0022`). Alvo: mode `0600` ou `mkdtempSync` com prefixo dedicado (0700).

### F-security-4: gravação da descrição sem etapa dedicada no ledger — audit trail depende do log `BUSINESS_WARN`

- **Severidade**: P3 (baixo — trade-off deliberado por auto-idempotência; documentar como aceito ou compensar)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1441-1450, 1491-1505`
- **Evidência (objetiva)**:
  ```typescript
  // 3.5 — garante a descrição de impressão do item ANTES da leg fiscal. Sem etapa própria no
  // ledger de propósito: é auto-idempotente pelo estado do documento (ver `etapaDescricaoItem`).
  await this.etapaDescricaoItem(ctx, existente, ndDocCod);
  ```
  A etapa NÃO grava linha no `SolicitacaoNumerarioExecucaoRepository`; o único rastro persistido de que a Kavex REESCREVEU o campo `dprLngDescrNf` é o log `BUSINESS_WARN` (linhas 1491-1505). Se o log for retido menos que o ledger (política atual: log ~ Render/Vercel, ledger em Postgres), a auditoria só sabe "a NDe homologou".
- **Impacto técnico**: Cross-QA com Fault Tolerance: em uma investigação de "por que o `xProd` da NF-e X ficou 'PAGAMENTO ANTECIPADO' se o cadastro do cliente diz 'Descrição DI'?", a resposta precisa vir do log — o ledger não distingue "cliente com cadastro `dpeVld1DescrNfe=1`" de "Kavex reescreveu para não travar".
- **Impacto de negócio**: Rastro fraco para o fiscal em disputa (SEFAZ, cliente, auditor externo). "Quem escreveu esse texto na minha nota?" — a resposta hoje só existe em log estruturado, não em base de dados versionada.
- **Métrica de baseline**: 0 linhas no ledger dedicadas à etapa; 1 log warn por execução. Alvo: coluna/tag no ledger indicando `descricao_reescrita=true` + `descricao_reescrita_texto` (opt-in), OU política formal de retenção do log alinhada com o ledger.

## 5. Cards Kanban

### [security-1] Sanitizar `dprLngDescrNf` antes de gravar (strip de caracteres de controle)

- **Problema**
  > A gravação do `dprLngDescrNf` só faz `.trim().slice(0, 4000)` (`ConexosNdeFiscalClient.ts:389`). Um texto do env `NDE_DESCRICAO_ITEM_FALLBACK` — ou (menos provável) uma sugestão anômala do próprio ERP — pode conter caracteres de controle, BOM, direction-override, aspas curly, CRLF, PUA. Esse valor vira o `xProd` do XML da NF-e emitida pelo Conexos e propaga para tooling downstream sem revisão humana.

- **Melhoria Proposta**
  > Introduzir uma normalização no boundary do client (mesmo lugar do `trim/slice`): NFC + strip de `\p{Cc}` (mantendo `\n` só se realmente necessário — checar contrato do `xProd`), colapso de whitespace, rejeição imediata de string que sobre vazia após saneamento. Tactic Bass alvo: **Validate Input**. Arquivo único: `src/backend/domain/client/ConexosNdeFiscalClient.ts` (função `gravarDescricaoItemNde`, junto do `textoOuIndefinido`). Cobrir com teste em `ConexosNdeFiscalClient.test.ts` (BOM, `‮`, ``, curly quotes, CRLF).

- **Resultado Esperado**
  > 100% dos caracteres não-imprimíveis filtrados antes do PUT. Métrica observável: `# chars fora do range XML 1.0 aceito` no payload real → 0. `NDE_DESCRICAO_ITEM_FALLBACK` copiado com CRLF por acidente deixa de contaminar o `xProd`.

- **Tactic alvo**: Validate Input
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - `# chars fora do range XML 1.0 aceito no payload PUT com297/comDocProdutos`: desconhecido (não medido) → 0
  - `# testes cobrindo saneamento`: 0 → 4 (BOM, direction-override, control char, CRLF)
- **Risco de não fazer**: Uma NDe recusada por SEFAZ com mensagem opaca ("erro no xProd") custa manhã de diagnóstico do fiscal; um caractere invisível colado no env do tenant contamina N notas em silêncio.
- **Dependências**: nenhuma

### [security-2] Ampliar `NumerarioAclChecker` para exigir grant específico de `PUT com297/comDocProdutos`

- **Problema**
  > O pré-flight de ACL (`NumerarioAclChecker.ts:19-24`) casa permissão por substring (`'com297'`) — a mesma checagem cobre HOMOLOGAR e UPDATE por acidente. O delta introduz um verbo distinto (`PUT com297/comDocProdutos` — UPDATE de ITEM), grant separado no modelo do ERP. A promessa "está tudo checado antes de escrever" passa a mentir para tenants que só conceberam HOMOLOGAR.

- **Melhoria Proposta**
  > Enriquecer `ACL_REQUERIDAS` com um marcador dedicado ao UPDATE de item — ou (melhor) trocar a estratégia de match-por-substring por lookup contra os rótulos exatos que o `permissoes/new/com297` devolve, com um `EnumSet` no domínio. Tactic Bass alvo: **Authorize Actors**. Arquivos: `NumerarioAclChecker.ts` e o teste `NumerarioAclChecker.test.ts` (não visto no delta — criar se faltar). Se a extensão da lista for suficiente por ora, documentar em `ontology/integrations/conexos-nde-fiscal.md` sob `Gating + posture` (o arquivo já lista "ACL adicional (0)" como pendência).

- **Resultado Esperado**
  > Fail-closed no pré-flight quando falta o grant específico de UPDATE de item, ANTES da primeira sessão consumida. Métrica: `# etapas iniciadas com 403 no PUT com297/comDocProdutos` → 0 (pré-flight nega antes).

- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - `# grants no ACL_REQUERIDAS`: 4 → 5 (ou 4 rótulos exatos, se troca a estratégia)
  - `# testes cobrindo 'só HOMOLOGAR sem UPDATE' → deny`: 0 → 1
- **Risco de não fazer**: Provisionamento de tenant esquecendo o grant é descoberto no primeiro cliente com cadastro `dpeVld1DescrNfe=4` — em produção, com sessão gasta e passivo de rerun. Trai a promessa do pré-flight.
- **Dependências**: nenhuma

### [security-3] Restringir permissões do dump da sonda de diagnóstico

- **Problema**
  > `recebimentos.e2e.descricaoNfeNde.integration.test.ts:210-212` grava o dump com `writeFileSync` sem `mode:`, respeitando umask default (0022 → 0644) em `<tmp>/nde-descricao-diagnostico.json`. O dump contém PII de negócio (pesCod, nome do cliente, item fiscal, cadastro `cmn025`) — não credenciais, mas o suficiente para vazar em máquina compartilhada.

- **Melhoria Proposta**
  > Trocar por `mkdtempSync` (dir 0700) + `writeFileSync(destino, ..., { mode: 0o600 })`. Tactic Bass alvo: **Limit Exposure** / **Encrypt Data** (em repouso). Arquivo único: `src/backend/routes/recebimentos.e2e.descricaoNfeNde.integration.test.ts`. Documentar no cabeçalho da sonda que o dump é sensível.

- **Resultado Esperado**
  > `# leitores possíveis do dump`: local users → 1 (o próprio usuário). Métrica: `stat -c "%a" <dump>` → `600`.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - `mode do dump em /tmp`: `0644` → `0600`
  - `nota explícita no cabeçalho sobre sensibilidade do dump`: 0 → 1
- **Risco de não fazer**: Baixo, mas cumulativo — sondas de diagnóstico tendem a se multiplicar; padrão frouxo hoje vira dívida institucional em três iterações.
- **Dependências**: nenhuma

### [security-4] Persistir a reescrita da descrição no ledger (audit trail formal)

- **Problema**
  > A `etapaDescricaoItem` não grava linha no ledger de execução (por design — auto-idempotência pelo estado do documento). O único rastro persistido é o log `BUSINESS_WARN` (`RecebimentoNumerarioService.ts:1491-1505`). Em disputa fiscal ("quem escreveu esse texto no meu `xProd`?"), a resposta depende de retenção do log, que hoje não está alinhada com o ledger no Postgres.

- **Melhoria Proposta**
  > Adicionar duas colunas no ledger (`descricao_reescrita boolean`, `descricao_reescrita_texto text`) OU um evento dedicado no `SolicitacaoNumerarioExecucaoRepository` para a etapa. Alternativa mais leve: política formal de retenção do log alinhada com o ledger + query padronizada. Tactic Bass alvo: **Audit Trail** (cross-QA com Fault Tolerance). Migração + repositório + teste; cross-check com o card equivalente em `fault-tolerance.md` do consolidador.

- **Resultado Esperado**
  > A pergunta "esta NDe teve `dprLngDescrNf` reescrita pela Kavex?" é respondida com um `SELECT` no ledger, sem depender de retenção de log. Métrica: `# execuções com etapa de reescrita rastreada em base`: 0 → 100% das que passam por `etapaDescricaoItem`.

- **Tactic alvo**: Audit Trail
- **Severidade**: P3
- **Esforço estimado**: M (2–5d) — inclui migração de esquema e adaptação do repository
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - `SELECT count(*) FROM sn_execucao WHERE descricao_reescrita`: métrica passa a existir
  - `# consultas de auditoria dependentes de log-app`: N → 0
- **Risco de não fazer**: Em uma disputa fiscal com o cliente (por que o `xProd` da minha nota mudou vs. o cadastro?), a resposta hoje sai de log estruturado, com risco de já ter caído da janela de retenção.
- **Dependências**: coordenar com o card do Fault Tolerance sobre o mesmo ledger para não bifurcar decisões de esquema.

## 6. Notas do agente

- Escopo estrito ao delta: nada de auditar Supabase/NextAuth/CORS/CSP/CloudTrail — nenhuma dessas camadas foi tocada em `fix/nde-descricao-item`.
- Positivos deliberadamente não viraram card: gating `conexosWriteEnabled+conexosDryRun` respeitado, `filCod` no header em 4/4 novas chamadas, sonda com allowlist agressiva (envelopa 6 verbos), Zod boundary + recusa de string vazia + trunc(4000).
- Cross-QA: F-security-4 (Audit Trail) sobrepõe Fault Tolerance — sinalizar ao consolidator para não duplicar. Cross-check Availability: gating global também é blast-radius — mesma sensibilidade citada aqui e lá.
- Métrica que tentei coletar e falhou: contagem de caracteres fora de XML 1.0 no payload real do `preDescrProdutoNf` — só a sonda contra tenant real produz. Fica como "não medível localmente".
