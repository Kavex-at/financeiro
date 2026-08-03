---
qa: Security
qa_slug: security
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-security
generated_at: 2026-08-03T18:47:00Z
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Security — Regis-Review (ADR-0027 — select existing SN before Processar)

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista malicioso (ou compromised session) com acesso a UMA filial autorizada | POSTa `snDocCod` de uma SN pertencente a OUTRO processo/filial (ex.: descoberto por enumeração incremental — `docCod` é sequencial no ERP), reaproveitando o handle no body do `POST /transacoes/:txnId/solicitacao-numerario` | Rota `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` → `RecebimentoNumerarioService.processarAlocacao` (branch `snSelecionadaDocCod`) → `etapaSn` (no-op) → `etapaFin014` (baixa fin014 gravada contra `snDocCod` arbitrário) | Produção, `conexosWriteEnabled=true`, escrita real no ERP Conexos (multi-tenant, dinheiro real) | O `snDocCod` deveria ser rejeitado (404/403) quando não pertence ao par `(priCod, filCod)` do body — a baixa/NDe só devem tocar títulos DAQUELE processo | 0 alocações cross-processo/cross-filial aceitas; 100% dos `snDocCod` do fluxo "existente" validados contra `com299/list(priCod, filCod, docVldTipo=9, docVldTipoAdto=1)` antes do fin014 |

> **Nota de escopo:** o pen-test acima é uma extensão direta do vetor multi-filial já mitigado no POST original (`assertUserCanActOnFilial(processoFilCod)`). A ADR-0027 adiciona um NOVO handle vindo do cliente (`snDocCod`) que **não** é validado contra o processo — o serviço confia no dado do body e chama `listTitulosBorderoReceber({filCod, docCod: snDocCod})` diretamente. Ver F-security-1.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Endpoints novos com Zod no boundary | 2 / 2 (GET `/processos/:priCod/sns` + campo `snDocCod` no POST) | 100% | ✅ | `src/backend/routes/recebimentos.ts:353-356, 424` |
| Rotas novas com authz por-filial | 1 / 1 (GET `/processos/:priCod/sns` chama `assertUserCanActOnFilial`) | 100% | ✅ | `src/backend/routes/recebimentos.ts:381-389` |
| Rotas escritas com `requireRole('admin')` | POST tem; **GET `/sns` intencionalmente sem `requireRole`** (é read-only) | Read-only sem admin, escrita com admin | ✅ | `src/backend/routes/recebimentos.ts:366-368, 441-445` |
| Validação de `snDocCod` como positive int no Zod | Sim (`z.coerce.number().int().positive().optional()`) | ✅ | ✅ | `src/backend/routes/recebimentos.ts:424` |
| **Validação de posse de `snDocCod` (pertence ao priCod/filCod?)** | **AUSENTE** — o serviço confia no valor do body e passa direto a `listTitulosBorderoReceber({filCod, docCod: snDocCod})` | 100% dos `snDocCod` cross-checados contra `com299/list(priCod, filCod)` ou `getDocumento` antes do fin014 | ❌ | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:355-357, 418-462`; `src/backend/domain/client/ConexosFin014Client.ts:109-138` |
| SQL parametrizado nas novas queries | N/A — a ADR-0027 não introduz SQL próprio (`com299/list` é chamada ERP) | N/A | N/A | — |
| Segredos hardcoded introduzidos no delta | 0 | 0 | ✅ | `git diff` do delta (9 arquivos) |
| `dangerouslySetInnerHTML`/XSS na UI nova (`AlocarProcessosDialog.tsx`) | 0 | 0 | ✅ | `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx` (delta 435 linhas) |
| Testes cobrindo cross-filial no delta | 3 (POST authz + GET `/sns` authz + `/transacoes/:txnId/processos` authz) | ≥ 1 por rota mutante | ✅ | `src/backend/routes/recebimentos.test.ts:216-227, 268-341, 490-506` |
| **Testes cobrindo tampering do `snDocCod` (mixing priCod × docCod)** | **0** | ≥ 1 (cross-processo E cross-filial) | ❌ | grep `snDocCod.*outro\|snDocCod.*diferente` → 0 hits |
| Preflight de ACL da conta de serviço (`NumerarioAclChecker`) roda no branch de SN existente | ✅ Sim — `requiresRole` + ACL rodam ANTES do `processarAlocacao`, independente de `snDocCod` presente | ✅ | ✅ | `src/backend/routes/recebimentos.ts:487-501` |
| Idempotency key namespacing pelo `sub` do usuário | Herdado do POST original — `sn-real:{txnId}:{priCod}:{valor}` NÃO é namespaced pelo sub (é herdado, mas o `Idempotency-Key` do `pipeline/run` é) | Namespacing por ator | ⚠️ | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:254` — chave sem `ator`; ver seção 6 (fora do escopo desta ADR, mas o SN existente aumenta a superfície) |

> ⚠️ **Não medível localmente**: probing real do ERP para confirmar que o `com299/list?docCod=<X>` de outro processo/filial DE FATO devolve o mesmo `titulo` que o `fin014` consome — a evidência aqui é do CÓDIGO (nenhuma validação server-side existe entre a rota e o `listTitulosBorderoReceber`). Recomendação: exercitar em HML com um `snDocCod` conhecido de outro processo antes de deploy em prod.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | Herdado (JWT → `req.user.sub`/`email`) | ✅ presente | `src/backend/routes/recebimentos.ts:484` |
| Authenticate Actors | Herdado do middleware upstream (fora do delta) | ✅ presente | (fora do delta) |
| Authorize Actors | `requireRole('admin')` no POST + `assertUserCanActOnFilial` no GET novo E no POST; **NÃO valida posse de `snDocCod`** | ⚠️ parcial | `src/backend/routes/recebimentos.ts:366-395` (GET) e `441-482` (POST); ver F-security-1 |
| Limit Access | GET novo escopa consulta ao par `(priCod, filCod)` e Zod exige `filCod` obrigatório; **POST não escopa `snDocCod` ao par (priCod, filCod)** | ⚠️ parcial | `src/backend/routes/recebimentos.ts:353-356` vs. `RecebimentoNumerarioService.ts:355-357` |
| Limit Exposure | Guard defensivo (`docVldTipo===9 && docVldTipoAdto===1`) impede que uma NC/ND vaze do `com299/list` para o analista via a nova rota | ✅ presente | `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1104-1113` |
| Encrypt Data | Herdado (HTTPS/TLS na rota; SSM SecureString no ERP creds) — delta não introduz storage novo | ✅ presente | (fora do delta) |
| Separate Entities | O `snSelecionadaDocCod` no ctx separa o "criar novo" do "usar existente" e a etapa de finalização é pulada só na branch selecionada (não re-finaliza) | ✅ presente | `RecebimentoNumerarioService.ts:355-357, 425, 450-460` |
| Change Default Settings | Default é dry-run (`conexosWriteEnabled=false`) — a branch SN existente também o respeita | ✅ presente | `RecebimentoNumerarioService.ts:224-227` |
| Validate Input | Zod nos dois novos boundaries; **falta validação SEMÂNTICA** (`snDocCod` pertence ao processo?) — Zod só garante `positive int` | ⚠️ parcial | `src/backend/routes/recebimentos.ts:396-427` |
| Detect Intrusion | Herdado — nenhum novo detector (a chegada de um `snDocCod` inválido só apareceria como erro do fin014 "SN não gerou título", sem sinalizar tampering) | ❌ ausente | `RecebimentoNumerarioService.ts:1068-1073` (a mensagem cobre "SN incompleta", não "SN de outro dono") |
| Detect Service Denial | Herdado (`heavyRouteLimiter` no POST; GET novo NÃO tem rate-limit — enumeração de `priCod` fica open) | ⚠️ parcial | `src/backend/routes/recebimentos.ts:366-368` (GET sem `heavyRouteLimiter`) |
| Verify Message Integrity | N/A no delta (não há file upload / message signing na ADR-0027) | N/A | — |
| Detect Message Delay | N/A no delta | N/A | — |
| Revoke Access | Herdado (session revocation upstream — fora do delta) | ✅ presente | (fora do delta) |
| Lock Computer | N/A (frontend web) | N/A | — |
| Inform Actors | Log `BUSINESS_INFO`/`BUSINESS_WARN` na branch SN existente segue o padrão existente | ✅ presente | `RecebimentoNumerarioService.ts:264-277` (dry-run log inclui a classificação) |
| Restore | Herdado (retomada por etapa via ledger `SolicitacaoNumerarioExecucaoRepository`) — o `snSelecionadaDocCod` tem precedência sobre o `existente?.docCod`, mas isso é **funcional**, não vira vetor de ataque desde que resolvido F-security-1 | ✅ presente | `RecebimentoNumerarioService.ts:355-357` |
| Audit Trail | O ledger grava `docCod` (usa o `snSelecionadaDocCod` quando presente), etapa e ator — audit trail preservado | ✅ presente | `RecebimentoNumerarioService.ts:334-342, 445` (`setDocCod`) |

## 4. Findings (achados)

### F-security-1: `snDocCod` do body não é validado contra o par (`priCod`, `filCod`) antes do fin014 — cross-processo/cross-filial dentro da mesma allow-list

- **Severidade**: **P0** (crítico — risco de baixa/NDe emitida contra a SN de OUTRO processo/cliente na mesma filial que o usuário tem acesso, e — pior — de OUTRA filial se o `snDocCod` alvo existir na filial DO PROCESSO escolhido)
- **Tactic violada**: Authorize Actors + Limit Access + Validate Input (validação semântica, não sintática)
- **Localização**:
  - `src/backend/routes/recebimentos.ts:424` (Zod só valida `positive int`; NÃO faz o cross-check)
  - `src/backend/routes/recebimentos.ts:529-531` (encaminha `snDocCod` cru como `snSelecionadaDocCod`)
  - `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:355-357` (`snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod` — precedência sem validação)
  - `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:418-462` (`etapaSn` no-op na branch selecionada — não relê / não valida)
  - `src/backend/domain/client/ConexosFin014Client.ts:109-138` (`listTitulosBorderoReceber({filCod, docCod})` filtra APENAS por `docCod#EQ:<X>`; nenhum filtro por `priCod`)
- **Evidência (objetiva)**:
  ```typescript
  // routes/recebimentos.ts:424
  snDocCod: z.coerce.number().int().positive().optional(),

  // routes/recebimentos.ts:529-531 — encaminha cru
  ...(parsed.data.snDocCod !== undefined
      ? { snSelecionadaDocCod: parsed.data.snDocCod }
      : {}),

  // RecebimentoNumerarioService.ts:355-357 — precedência SEM validação
  // SN existente escolhida pelo analista (ADR-0027) tem precedência sobre o docCod do ledger:
  // não geramos nem finalizamos uma SN já existente — só baixamos/emitimos a NDe contra ela.
  let snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod;

  // ConexosFin014Client.ts:109-138 — filtro por docCod apenas
  filterList: { 'docCod#EQ': docCod, borVldFinalizado: 0, exibirTitulos: 1 },
  ```
  Nem `etapaSn` nem `etapaFin014` chamam `getDocumento({docCod: snDocCod})` para conferir `priCod` do documento, nem chamam `listSNsByProcesso({filCod, priCod})` para conferir que o `docCod` está lá.
- **Impacto técnico**: Um analista com acesso à filial X (allow-list contém `filCod=4`) POSTa `{priCod: 3254, filCod: 4, snDocCod: 18202}` mas o `docCod 18202` é a SN de um OUTRO processo (`priCod: 9999`, também na filial 4, ou até de outro cliente). O `etapaSn` PULA validação (é a branch "existente"); o `etapaFin014` faz `listTitulosBorderoReceber({filCod:4, docCod:18202})` e pega o título REAL da SN alheia, gera borderô, baixa contra a `gerNum` do PAGAMENTO do atacante, finaliza, emite NDe (com297) contra o mesmo `docCod`. Resultado: o ADIANTAMENTO de um cliente (Bonduelle) é consumido/baixado pela transação de OUTRO cliente (Skyjack) — mesmo problema classe do bug já corrigido de "condição de pagamento de terceiro", elevado a um nível: o próprio DOCUMENTO alvo é de terceiro.
- **Impacto de negócio**: Baixa de adiantamento de cliente errado → contabilidade de recebíveis fica adulterada; a NDe emitida (com297) leva o `docCod` da SN alheia mas os fiscal fields (endCodFis/pdcDocFederal) do processo escolhido pelo atacante — mismatch fiscal em nota emitida, potencial passivo fiscal. Para clientes multi-filial na mesma allow-list do atacante, é lateral movement dentro da instituição: qualquer analista sênior com acesso a duas filiais pode "reciclar" a SN de uma filial contra o pagamento da outra, ofuscando trilha de auditoria (o ledger grava o `docCod`, mas não o `priCod` da SN — precisaria correlacionar depois).
- **Métrica de baseline**: 0 chamadas a `getDocumento`/`listSNsByProcesso` na branch `snSelecionadaDocCod !== undefined` do `etapaSn`; 0 testes cobrindo o cenário "snDocCod pertence a OUTRO priCod". A rota `GET /processos/:priCod/sns` (a fonte legítima das opções) NÃO devolve pertencimento aplicado no POST.

### F-security-2: GET `/recebimentos/processos/:priCod/sns` sem rate-limiting nem paginação hard-cap — enumeração de `priCod` amplifica reconnaissance

- **Severidade**: P2 (médio — reconnaissance/scraping; não move dinheiro por si, mas fornece o `docCod` alvo do F-security-1)
- **Tactic violada**: Detect Service Denial + Limit Exposure
- **Localização**: `src/backend/routes/recebimentos.ts:366-394`
- **Evidência (objetiva)**:
  ```typescript
  router.get(
      '/processos/:priCod/sns',
      asyncHandler(async (req, res) => {
          // …
          const sns = await client.listSNsByProcesso({ filCod, priCod: priCod.data });
          res.json({ priCod: priCod.data, sns });
      }),
  );
  ```
  A rota POST usa `heavyRouteLimiter` (`recebimentos.ts:157, 443, 601`); a GET nova NÃO. `listSNsByProcesso` pageia com `pageSize=50` e faz UMA chamada ao Conexos por invocação (`ConexosGerDocProcessoClient.ts:1055, 1058`) — barato individualmente, mas um analista pode varrer `priCod=1..10000` na filial dele e mapear (a) quais processos EXISTEM (200 vs. resposta vazia) e (b) quais SNs (`docCod`) existem em cada, alimentando o F-security-1.
- **Impacto técnico**: Cada request é 1 hit ao `com299/list` do Conexos (dentro da filial autorizada — não é cross-tenant). Sem rate-limiting o atacante enumera todo o espaço de `priCod` autorizado. O ERP Conexos tem SLA finito e a Frente II já sofreu com fan-out de sessões.
- **Impacto de negócio**: (a) alimenta o F-security-1 (fornece `docCod` alvo); (b) risco reputacional se o volume derrubar o Conexos (multi-tenant compartilhado — o `fechamento-processos` divide o mesmo ERP).
- **Métrica de baseline**: `heavyRouteLimiter` presente em 3/4 rotas mutantes de `recebimentos.ts`; presente em 0/2 rotas read-only novas.

### F-security-3: Ausência de teste de cross-processo tampering do `snDocCod` — a branch "existente" só tem happy-path

- **Severidade**: P1 (alto — a ausência de regressão faz o F-security-1 permanecer aberto silenciosamente após remediação)
- **Tactic violada**: Validate Input (defense-in-testing)
- **Localização**: `src/backend/routes/recebimentos.test.ts:410-425`; `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:255-283`
- **Evidência (objetiva)**:
  ```typescript
  // recebimentos.test.ts:410-425 — só valida que o snDocCod atravessa como snSelecionadaDocCod
  it('encaminha snDocCod do body como snSelecionadaDocCod ao orquestrador (SN existente)', async () => {
      const res = await post(
          `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
          snPayload({ snDocCod: 18202 }),
      );
      expect(processar).toHaveBeenCalledWith(
          expect.objectContaining({ snSelecionadaDocCod: 18202 }),
      );
  });
  ```
  Nenhum teste verifica: (a) que um `snDocCod` de outro `priCod` retorna 403/404; (b) que um `snDocCod` de outra `filCod` (mesmo dentro da allow-list) é rejeitado; (c) que o serviço rejeita quando `com299/list(priCod, filCod)` não contém o `docCod`.
- **Impacto técnico**: Regressão silenciosa possível depois da remediação de F-security-1.
- **Impacto de negócio**: Sem cover de teste, a validação semântica pode ser removida em refactor futuro sem quebrar CI.
- **Métrica de baseline**: 0 testes de tampering na `git diff` (`recebimentos.test.ts` +108 linhas, `RecebimentoNumerarioService.test.ts` +30 linhas — cobrem happy-path e retomada, não abuso).

### F-security-4: Mensagem de erro do fin014 sob `snDocCod` inválido mascara a causa (não distingue "SN não finalizada" de "SN de outro dono")

- **Severidade**: P2 (médio — impacto no triagem de incidentes/detecção de intrusão)
- **Tactic violada**: Detect Intrusion
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1068-1073`
- **Evidência (objetiva)**:
  ```typescript
  // etapaFin014 quando o LOV volta vazio:
  if (titulo === undefined) {
      throw new Error(
          `SN ${snDocCod} não gerou título a receber (lov/TituloBorderoReceber vazio) — ` +
              'a SN não ficou finalizável (valor/condição de pagamento). Não há o que baixar no fin014.',
      );
  }
  ```
  Se o `snDocCod` de outro processo devolver título vazio (ex.: SN dele foi baixada há tempo), a mensagem culpa "SN não finalizável" — omitindo a possibilidade de tampering. Se o `snDocCod` alheio TIVER título aberto, a baixa passa silenciosamente (F-security-1).
- **Impacto técnico**: A observabilidade não distingue "usuário legítimo tentando reprocessar" de "usuário forjando `docCod` de terceiro" — só o segundo caso é incidente.
- **Impacto de negócio**: MTTR mais alto quando F-security-1 for explorado; auditoria post-mortem difícil.
- **Métrica de baseline**: 1 categoria de erro genérica ("SN não gerou título"); 0 categorias de erro dedicadas a "docCod-processo mismatch".

### F-security-5: A `resolvedFilCodsAcessiveis` (allow-list nula → todas as filiais do ERP) amplifica o F-security-1

- **Severidade**: P1 (alto — o F-security-1 fica exponencialmente pior quando `req.user.filiais` não é provisionada)
- **Tactic violada**: Authorize Actors (fail-open default)
- **Localização**: `src/backend/routes/recebimentos.ts:65-71` (comportamento já pré-existente, mas a ADR-0027 USA para popular o dropdown de SNs que alimenta o F-security-1)
- **Evidência (objetiva)**:
  ```typescript
  const resolverFilCodsAcessiveis = async (user: FilialScopedUser | undefined): Promise<number[]> => {
      const permitidas = filiaisPermitidas(user);
      if (permitidas && permitidas.length > 0) return permitidas;
      const cadastro = container.resolve(ConexosCadastroClient);
      const filiais = await cadastro.listFiliais();
      return filiais.map((f) => Number(f.filCod)).filter((n) => Number.isInteger(n) && n > 0);
  };
  ```
  Um usuário SEM claim `filiais` (legacy/token não-migrado — teste `runs when the user has NO filiais list (claim not provisioned)` linha 125-135) recebe TODAS as filiais do ERP. Combinado com F-security-1, o vetor deixa de ser "cross-filial dentro da allow-list" e vira "qualquer filial do tenant". O teste de linha 125 confirma que isso é comportamento aceito (`role gate still applies`).
- **Impacto técnico**: Sem migração completa dos claims, um único ator legado tem varredura total do tenant.
- **Impacto de negócio**: Descumpre o princípio SaaSo de "compromise em tenant A não vaza tenant B" quando aplicado por analogia a "filial A não vaza filial B dentro do mesmo tenant".
- **Métrica de baseline**: 1 caminho fail-open detectado (linhas 66-70); 0 alertas quando ele é acionado (nada loga "usuário sem filiais — expandindo para todas").

## 5. Cards Kanban

### [security-1] Validar posse de `snDocCod` contra `(priCod, filCod)` ANTES do fin014

- **Problema**
  > O POST `/transacoes/:txnId/solicitacao-numerario` aceita `snDocCod` no body como opaque handle e o encaminha direto ao `RecebimentoNumerarioService.processarAlocacao` → `etapaFin014` → `listTitulosBorderoReceber({filCod, docCod})` sem NENHUMA validação de que a SN pertence ao `priCod`/`filCod` do body. Um analista com acesso à filial autorizada pode POSTar o `docCod` da SN de OUTRO processo/cliente da mesma filial (ou de outra dentro da allow-list) e a baixa fin014 + NDe com297 são gravadas contra a SN alheia — dinheiro sendo movido sob o documento de outro cliente. Zod (`positive int`) só cobre a forma do valor, não sua legitimidade.

- **Melhoria Proposta**
  > Adicionar validação SEMÂNTICA no boundary da rota (idealmente) OU no início de `etapaSn` quando `snSelecionadaDocCod !== undefined`: chamar `ConexosGerDocProcessoClient.listSNsByProcesso({filCod, priCod})` e exigir que `snSelecionadaDocCod` esteja no set devolvido — fail-closed com 403/`NAO_PERTENCE_AO_PROCESSO` senão. Alternativa mais barata (1 GET): `getDocumento({tela:'com299', filCod, docCod: snSelecionadaDocCod})` e comparar `doc.priCod === ctx.priCod` + `doc.filCod === ctx.filCod` + `doc.docVldTipo === 9` + `doc.docVldTipoAdto === 1`. Tactic: **Authorize Actors** + **Limit Access** + **Validate Input** (semantic). Arquivos: `src/backend/routes/recebimentos.ts` (adicionar cheque antes do `service.processarAlocacao`) OU `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` (linha 425, dentro de `etapaSn` quando `snSelecionada === true`, antes de qualquer chamada ao ERP downstream).

- **Resultado Esperado**
  > 100% das requests com `snDocCod` cross-processo ou cross-filial rejeitadas com 403 antes do `beginExecution` do ledger; 0 baixas fin014 gravadas contra `docCod` que não pertence ao par `(priCod, filCod)` do body.

- **Tactic alvo**: Authorize Actors / Limit Access / Validate Input
- **Severidade**: P0
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1, F-security-3, F-security-4, F-security-5
- **Métricas de sucesso**:
  - Testes de tampering (cross-processo + cross-filial): 0 → ≥ 2
  - Cross-check da posse: ausente → 1 chamada `getDocumento`/`listSNsByProcesso` por request com `snDocCod`
  - Latência adicionada por request: 0 → ≤ 300ms (uma chamada ERP idempotente cacheável)
- **Risco de não fazer**: Um insider com acesso à UI pode, em 3 requests (listar SNs de um processo válido + copiar `docCod` + POSTar contra `priCod` DIFERENTE), consumir o adiantamento de UM cliente para quitar o pagamento de OUTRO cliente. Sem log dedicado (F-security-4), a auditoria post-hoc precisa correlacionar `ledger.docCod` × `com299/{docCod}.priCod` — descoberta acidental na melhor hipótese.
- **Dependências**: nenhuma (depende só do que existe no delta)

### [security-2] Adicionar `heavyRouteLimiter` e um cap defensivo de páginas no GET `/processos/:priCod/sns`

- **Problema**
  > A rota nova GET `/recebimentos/processos/:priCod/sns` não está atrás do `heavyRouteLimiter` que protege as três rotas mutantes do arquivo. Um analista dentro da allow-list de filiais pode enumerar `priCod=1..N` sem throttling, mapeando (a) quais processos existem na filial autorizada e (b) quais `docCod` de SN existem em cada — reconhecimento direto para F-security-1 e carga desnecessária no `com299/list` do Conexos (ERP compartilhado com `fechamento-processos`).

- **Melhoria Proposta**
  > (a) Adicionar `heavyRouteLimiter` como middleware do GET (mesma configuração das rotas mutantes do arquivo). (b) Se o `heavyRouteLimiter` for muito agressivo para leituras, introduzir um `readRouteLimiter` com quota maior (ex.: 100 req/min por `sub`) reutilizando `src/backend/http/rateLimit.ts`. Tactic: **Detect Service Denial** + **Limit Exposure**. Arquivo: `src/backend/routes/recebimentos.ts:366` (adicionar middleware).

- **Resultado Esperado**
  > Enumeração larga (>N req/min por usuário) responde 429; carga no `com299/list` cai em cenários adversariais; F-security-1 fica menos amplificado.

- **Tactic alvo**: Detect Service Denial / Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Rotas read-only novas com rate-limit: 0/1 → 1/1
  - 429 rate observed sob teste de enumeração (≥100 req/s por sub): 0 → ≥ 1
- **Risco de não fazer**: reconnaissance grátis alimenta o vetor F-security-1; risco secundário de saturar o ERP Conexos multi-tenant.
- **Dependências**: nenhuma

### [security-3] Cobrir cross-processo/cross-filial tampering do `snDocCod` com testes de regressão

- **Problema**
  > Os testes atuais da ADR-0027 (`recebimentos.test.ts:410-425`, `RecebimentoNumerarioService.test.ts:255-283`) validam APENAS o happy-path da branch "SN existente": que o `snDocCod` atravessa como `snSelecionadaDocCod` e que o serviço não re-finaliza. Não há teste que: (a) rejeite um `snDocCod` de outro `priCod` na mesma filial; (b) rejeite um `snDocCod` de outra `filCod` dentro da allow-list; (c) rejeite `snDocCod` inválido/inexistente. Sem eles, a remediação de F-security-1 pode ser removida em refactor futuro sem quebrar CI.

- **Melhoria Proposta**
  > Adicionar em `src/backend/routes/recebimentos.test.ts`: 3 casos no `describe` do `solicitacao-numerario` — (a) `403 quando snDocCod pertence a outro priCod`; (b) `403 quando snDocCod pertence a outra filial da allow-list`; (c) `403 quando snDocCod não existe no ERP`. Stubbar `listSNsByProcesso` (ou `getDocumento`) para devolver o set/documento correspondente. Complementar em `RecebimentoNumerarioService.test.ts` com 1 caso unitário do `etapaSn`. Tactic: **Validate Input** (defense-in-testing).

- **Resultado Esperado**
  > Cobertura de tampering do `snDocCod`: 0 → ≥ 4 testes; qualquer regressão da validação semântica quebra CI.

- **Tactic alvo**: Validate Input
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3, F-security-1
- **Métricas de sucesso**:
  - Testes de tampering (cross-processo + cross-filial + inexistente): 0 → ≥ 4
  - Mutação do `snDocCod`-check quebra CI: não → sim
- **Risco de não fazer**: F-security-1 remediado hoje pode ser revertido silenciosamente amanhã.
- **Dependências**: security-1 (a validação semântica precisa existir para testar)

### [security-4] Diferenciar a mensagem de erro do fin014 sob `snDocCod` inválido — sinalizar potencial tampering

- **Problema**
  > Quando o `listTitulosBorderoReceber({filCod, docCod})` volta vazio na branch de SN existente, o serviço lança "SN não gerou título — não ficou finalizável" (`RecebimentoNumerarioService.ts:1069-1073`). A mesma mensagem cobre dois cenários DISTINTOS: (i) SN legítima mas incompleta; (ii) `snDocCod` forjado (tampering). Sem separação, a observabilidade não sinaliza incidente de segurança — MTTR sobe.

- **Melhoria Proposta**
  > Após F-security-1 remediado, categorizar o erro por classe: se `snSelecionadaDocCod` chegou ao fin014 é porque passou pela validação de posse — nunca deve dar "título vazio" na happy-path da SN existente (a SN selecionada já está finalizada por definição). Se acontecer, é anomalia — logar `LOG_TYPE.SECURITY_WARN` com `docCod`, `priCod`, `ator`, `filCod` e reprojetar o erro. Tactic: **Detect Intrusion**. Arquivo: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1068-1073`.

- **Resultado Esperado**
  > Categorias de erro dedicadas para "docCod-processo mismatch" e "SN selecionada mas sem título" (anomalia); alertas de segurança levantam quando o segundo caso ocorre em produção.

- **Tactic alvo**: Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4, F-security-1
- **Métricas de sucesso**:
  - Categorias distintas de erro: 1 → ≥ 2
  - Alertas gerados para o cenário "SN selecionada sem título": 0 → 1 por ocorrência
- **Risco de não fazer**: incidentes de segurança passam por incidentes de negócio ("cliente reclamando de baixa errada") — MTTR alto e trilha de auditoria fraca.
- **Dependências**: security-1

### [security-5] Fail-closed no `resolverFilCodsAcessiveis` quando o token não tem claim `filiais`

- **Problema**
  > `resolverFilCodsAcessiveis` (linhas 65-71) fail-opens: quando `req.user.filiais` é nulo/vazio, retorna TODAS as filiais do ERP. O teste `runs when the user has NO filiais list (claim not provisioned)` (recebimentos.test.ts:125) documenta que isso é comportamento aceito ("role gate still applies"). Combinado com F-security-1, um ator legado sem migração de claims pode fabricar `snDocCod` de QUALQUER filial do tenant, não só da sua allow-list — regride o princípio SaaSo de isolamento.

- **Melhoria Proposta**
  > Após migração de claims completa: mudar o default para fail-closed (`return []` quando `filiais` ausente) OU exigir uma flag explícita `SN_ALLOW_UNSCOPED_LEGACY_USERS=true` para manter o fail-open, com log `BUSINESS_WARN` a cada uso e alerta operacional quando o tráfego cair para zero (sinal de que a migração terminou e a flag pode ser removida). Tactic: **Authorize Actors** (fail-safe defaults). Arquivos: `src/backend/routes/recebimentos.ts:65-71`; `src/backend/http/filialAuthz.ts` (se a lógica de fallback vive lá).

- **Resultado Esperado**
  > Um token sem claim `filiais` responde 403 (ou é surfaced via warn+deny) em vez de ganhar acesso a todas as filiais.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — precisa coordenar com a migração de claims/SSO)
- **Findings relacionados**: F-security-5, F-security-1
- **Métricas de sucesso**:
  - Fail-opens observados em produção: X → 0 (após migração completa)
  - Warns por request unscoped: 0 → 1 (durante a transição)
- **Risco de não fazer**: um token legado transforma F-security-1 (limitado à allow-list) em vetor cross-filial completo dentro do tenant.
- **Dependências**: migração de claims/SSO em progresso (fora do escopo desta ADR, mas o SN existente aumenta a superfície de risco)

## 6. Notas do agente

- Escopo restrito ao delta da ADR-0027 (9 arquivos do `_shared-metrics.md`). Não auditei `filialAuthz.ts`, o middleware de auth ou o `ConexosBaseClient` — mas o F-security-5 tocou uma nota fora do delta porque a nova rota USA o fallback fail-open que já existia.
- O achado central (F-security-1) foi confirmado por três caminhos ortogonais: (a) o Zod da rota (`recebimentos.ts:424`) só valida forma; (b) o serviço (`RecebimentoNumerarioService.ts:355-357, 418-462`) delega o `snDocCod` a partir do body sem `getDocumento`/`listSNsByProcesso`; (c) o client fin014 (`ConexosFin014Client.ts:109-138`) filtra o LOV apenas por `docCod#EQ:<X>` — nenhum dos três layers valida pertencimento.
- Métricas não medíveis localmente: enumeração real do `com299/list` cross-`priCod` (requereria HML) e latência da validação semântica proposta (`getDocumento` do com299 — depende do ERP).
- Cross-QA para o consolidator:
  - **Fault Tolerance**: F-security-1 abre uma classe de "success com dado errado" (baixa passa contra SN alheia) que a etapa fin014 não detecta — overlap direto com o Audit Trail tactic (o ledger grava `docCod` mas não `priCod` da SN; a correlação post-hoc é frágil).
  - **Integrability**: a validação semântica proposta (security-1) é feita via chamada ERP (`getDocumento` ou `listSNsByProcesso`) — cria dependência adicional no Conexos que Integrability precisa considerar.
  - **Availability**: F-security-2 tem impacto direto de disponibilidade (enumeração satura o `com299/list` compartilhado).
  - **Performance**: security-1 adiciona ≤1 chamada ERP idempotente por POST na branch SN existente — Performance deve marcar como aceitável para o caso de uso (é sob `heavyRouteLimiter` já).
