---
type: regis-review-kanban
run_id: 2026-08-03-1847-alocar-sn-select
total: 37
counts: { p0: 2, p1: 8, p2: 17, p3: 10 }
resolved_in_loop: [security-1, integrability-1]  # 2 P0 fechados no mesmo PR desta feature
---

# Kanban — financeiro — 2026-08-03-1847-alocar-sn-select (ADR-0027)

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> **Nota:** ambos os P0 (security-1, integrability-1) foram remediados in-loop no PR desta feature em 2026-08-03. Ficam listados como ✅ Resolvido para preservar o registro do achado + evidência de fix; contam para `resolved_in_loop`, não para o backlog aberto.
>
> **Deduplicação identificada** (implementar como 1 edição de código, mesmo com cards separados aqui para rastreabilidade cross-QA):
> - `availability-1` ≡ `integrability-2` (mesmo fix `runWithRetry`+`ensureSid`)
> - `availability-3` ≡ `performance-1` ≡ `integrability-3` (mesmo fix de paginação)
> - `security-2` ≡ `deployability-2` ≡ `performance-3` (mesmo fix de rate-limit+cache)

---

## P0 — Crítico

### [integrability-1] ✅ Resolvido — Corrigir URL de `listSNsByProcesso` para `com299/list` + fixar teste com o path do HAR

**QA**: Integrability
**Tactic alvo**: Adhere to Standards + Contract testing
**Esforço**: S (≤1d)
**Findings**: F-integrability-1, F-integrability-4
**Status**: ✅ Resolvido in-loop no PR desta feature (2026-08-03) — URL corrigida, mensagem de erro sincronizada, teste unitário atualizado para `expect(...).toBe('com299/list')`. Card mantido no Kanban como registro do achado + evidência de remediação.

**Problema**
> O novo método POSTa em `/api/com299`, mas o HAR/ADR-0027 prescreve `POST /api/com299/list`. O teste unitário `expect(...).toBe('com299')` congelou o bug. Em produção a lista é falha silenciosa (`rows: []`) ou 404/405 — nunca traz a SN existente, tornando a feature inerte e recolocando o risco de duplicação de SN (violação de I-Receb-3).

**Melhoria Proposta**
> Trocar `listGenericPaginated<...>('com299', ...)` por `listGenericPaginated<...>('com299/list', ...)` em `ConexosGerDocProcessoClient.ts:1059` — alinhando com o irmão `resolveGcdCodByName` (`${tela}/list`). Atualizar `ConexosGerDocProcessoClient.test.ts:604` para `expect(...).toBe('com299/list')`. Se possível, adicionar um fixture-based test que use um envelope real (HAR-confirmed) para blindar o parsing. Tactic Bass: **Adhere to Standards**.

**Resultado Esperado**
> `listSNsByProcesso` bate na rota HAR-confirmada em produção; SNs existentes voltam com dados; ADR-0027 D1/D2/I-Receb-3 passam a valer. Métrica: taxa de "0 SN encontradas quando o ERP tem" cai de ~100% para ~0%.

**Métricas de sucesso**
- URL POST em `listSNsByProcesso`: `com299` → `com299/list`
- `count` do envelope em resposta HML: 0 (bug) → >0 quando existirem SNs

**Risco de não fazer**
> Feature ADR-0027 nasce morta; duplicação de SN volta em produção; a próxima frente a integrar com299 vai copiar o padrão errado.

**Dependências**: nenhuma; recomendável validar em HML com HAR antes do PR.

---

### [security-1] ✅ Resolvido — Validar posse de `snDocCod` contra `(priCod, filCod)` ANTES do fin014

**QA**: Security
**Tactic alvo**: Authorize Actors / Limit Access / Validate Input
**Esforço**: S (≤1d)
**Findings**: F-security-1, F-security-3, F-security-4, F-security-5
**Status**: ✅ Resolvido in-loop no PR desta feature (2026-08-03) — validação semântica adicionada ao `etapaSn` (cross-check de `priCod`/`filCod`/`docVldFinalizado` via `getDocumento`), 403 `NAO_PERTENCE_AO_PROCESSO` retornado antes do `beginExecution`. Card mantido no Kanban como registro do achado + evidência de remediação. Testes de tampering (security-3) continuam necessários — ver P1.

**Problema**
> O POST `/transacoes/:txnId/solicitacao-numerario` aceita `snDocCod` no body como opaque handle e o encaminha direto ao `RecebimentoNumerarioService.processarAlocacao` → `etapaFin014` → `listTitulosBorderoReceber({filCod, docCod})` sem NENHUMA validação de que a SN pertence ao `priCod`/`filCod` do body. Um analista com acesso à filial autorizada pode POSTar o `docCod` da SN de OUTRO processo/cliente da mesma filial (ou de outra dentro da allow-list) e a baixa fin014 + NDe com297 são gravadas contra a SN alheia — dinheiro sendo movido sob o documento de outro cliente. Zod (`positive int`) só cobre a forma do valor, não sua legitimidade.

**Melhoria Proposta**
> Adicionar validação SEMÂNTICA no boundary da rota (idealmente) OU no início de `etapaSn` quando `snSelecionadaDocCod !== undefined`: chamar `ConexosGerDocProcessoClient.listSNsByProcesso({filCod, priCod})` e exigir que `snSelecionadaDocCod` esteja no set devolvido — fail-closed com 403/`NAO_PERTENCE_AO_PROCESSO` senão. Alternativa mais barata (1 GET): `getDocumento({tela:'com299', filCod, docCod: snSelecionadaDocCod})` e comparar `doc.priCod === ctx.priCod` + `doc.filCod === ctx.filCod` + `doc.docVldTipo === 9` + `doc.docVldTipoAdto === 1`. Tactic: **Authorize Actors** + **Limit Access** + **Validate Input** (semantic).

**Resultado Esperado**
> 100% das requests com `snDocCod` cross-processo ou cross-filial rejeitadas com 403 antes do `beginExecution` do ledger; 0 baixas fin014 gravadas contra `docCod` que não pertence ao par `(priCod, filCod)` do body.

**Métricas de sucesso**
- Testes de tampering (cross-processo + cross-filial): 0 → ≥2
- Cross-check da posse: ausente → 1 chamada `getDocumento`/`listSNsByProcesso` por request com `snDocCod`
- Latência adicionada por request: 0 → ≤300ms (uma chamada ERP idempotente cacheável)

**Risco de não fazer**
> Um insider com acesso à UI pode, em 3 requests (listar SNs de um processo válido + copiar `docCod` + POSTar contra `priCod` DIFERENTE), consumir o adiantamento de UM cliente para quitar o pagamento de OUTRO cliente. Sem log dedicado (F-security-4), a auditoria post-hoc precisa correlacionar `ledger.docCod` × `com299/{docCod}.priCod` — descoberta acidental na melhor hipótese.

**Dependências**: nenhuma (depende só do que existe no delta)

---

## P1 — Alto

### [availability-1] Embrulhar `listSNsByProcesso` em `runWithRetry` + `ensureSid` (paridade)

**QA**: Availability
**Tactic alvo**: Retry (Recover from Faults)
**Esforço**: S (≤1d)
**Findings**: F-availability-1

**Problema**
> A leitura nova `ConexosGerDocProcessoClient.listSNsByProcesso` (`:1058`) NÃO usa `runWithRetry` nem chama `ensureSid()` antes do POST — quebra o padrão do arquivo. Um blip transitório (5xx/timeout) do `com299/list` derruba o painel de SN do modal na primeira falha; um `sid` expirado + corrida com o mutex de re-login (`services/conexos.ts:166`) idem. A docstring afirma que o `listGenericPaginated` já faz retry/ensureSid — mas o adapter (`legacyConexosAdapter.ts:37-51`) só delega ao `authenticatedPost` (401-retry único), não ao `RetryExecutor`. Efeito: analista vê lista vazia com erro, opta por "Criar novo SN" achando que não há SN → SN duplicada.

**Melhoria Proposta**
> Embrulhar o corpo de `listSNsByProcesso` em `this.base.runWithRetry(async () => { await this.base.ensureSid(); const page = await this.base.listGenericPaginated(...); ... })`, espelhando `listContasProjeto` (`:510-528`) e `resolveGcdCodByName` (`:1009-1035`). Corrigir a docstring (`:1046`) para descrever o comportamento real. Tactic: **Retry** + **Sanity Checking** (sessão). Testar com um mock que rejeita a 1ª chamada e resolve na 2ª (padrão já existente em `ConexosSispagClient.test.ts:60-66`).

**Resultado Esperado**
> `listSNsByProcesso` absorve 1 falha transitória com 500 ms de delay + jitter (política do `RetryExecutor` compartilhado). % de leituras da feature em `runWithRetry`: 0% → 100%. Falhas de sessão viram re-login uma vez em vez de erro para o usuário.

**Métricas de sucesso**
- Leituras Conexos da feature em `runWithRetry`: 0/1 → 1/1
- Chamadas com `ensureSid()` prévio: 0/1 → 1/1
- Teste unitário que valida retry em erro transitório: 0 → 1

**Risco de não fazer**
> SN duplicada quando um blip do Conexos derruba a lista; MTTR do analista sobe (retry manual). Em 6 meses, com centenas de execuções diárias durante fechamento, é razoável esperar ≥1 incidente/mês.

**Dependências**: nenhuma.

---

### [availability-2] Gatekeeper de `snSelecionadaDocCod` em `etapaSn` (pré-validar existência/processo/filial/finalização)

**QA**: Availability
**Tactic alvo**: Exception Prevention (Prevent Faults)
**Esforço**: S (≤1d)
**Findings**: F-availability-2, F-availability-5

**Problema**
> `etapaSn` aceita `ctx.snSelecionadaDocCod` como oráculo sem verificar nada (`RecebimentoNumerarioService.ts:418-462`). Um `docCod` errado (lista stale, digitação, cache do FE em `AlocarProcessosDialog.tsx:309` que nunca invalida) só falha na etapa `fin014`, onde a mensagem culpa a SN por não estar finalizada (`RecebimentoNumerarioService.ts:1069-1072`) — enganosa. Pior: se o `docCod` referencia acidentalmente uma SN de outro processo na mesma filial e finalizada, a baixa fin014 é executada contra ela (irreversível). O `assertUserCanActOnFilial` limita o blast a SNs da mesma filial, mas não previne o erro dentro dela.

**Melhoria Proposta**
> Em `etapaSn`, quando `snSelecionada`, ANTES de retornar `snDocCod`: (1) `getDocumento({ tela: 'com299', filCod, docCod: snDocCod })` (já existe: `ConexosGerDocProcessoClient.ts:916-931`); (2) validar `priCod === ctx.priCod`, `filCod === ctx.filCod` e `docVldFinalizado === 1`; (3) falha-fechado com mensagem específica (`NumerarioGapError({ etapa: 'sn', message: "SN X não pertence ao processo Y (pertence a Z)" })` etc). Emite `logService.warn` para auditar tentativas com `docCod` inválido. Tactic: **Exception Prevention** + **Sanity Checking**.

**Resultado Esperado**
> `snDocCod` inválido/stale/errado falha na etapa `sn` (não em `fin014-done`), com mensagem que aponta a causa. 0% de baixa fin014 executada contra SN de processo diferente do enviado. MTTR do analista para caso de lista stale: alto (mensagem confusa em fin014) → baixo (mensagem exata na entrada).

**Métricas de sucesso**
- % `snSelecionadaDocCod` pré-validados: 0% → 100%
- Testes com `docCod` de outro processo (fail-closed na etapa `sn`): 0 → 1
- Testes com `docCod` inexistente: 0 → 1

**Risco de não fazer**
> Incidente com baixa fin014 executada contra SN errada (irreversível). O cenário exige coincidência (mesma filial, ambos finalizados, docCod errado), mas o custo é alto.

**Dependências**: nenhuma.

---

### [fault-tolerance-1] Preservar a seleção do analista quando `snSelecionadaDocCod` divergir do `existente.docCod`

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-fault-tolerance-4

**Problema**
> No ramo ADR-0027, se o analista clicar Processar uma segunda vez com uma SN diferente selecionada mantendo o mesmo `(txnId, priCod, valor)`, o serviço reutiliza silenciosamente o `docCod` gravado na primeira tentativa (`existente?.docCod`), ignorando a nova seleção. A baixa vai para a SN errada sem log de alerta.

**Melhoria Proposta**
> Em `RecebimentoNumerarioService.rodarEtapas` (linha 357), detectar `ctx.snSelecionadaDocCod !== undefined && existente?.docCod !== undefined && ctx.snSelecionadaDocCod !== existente.docCod` e (a) OU incorporar `snSelecionadaDocCod` na `key` (`sn-real:{txnId}:{priCod}:{valor}:{snSel|new}`) para criar uma execução separada, (b) OU fail-closed com mensagem "Alocação já executada contra SN X — para trocar, use /recebimentos/execucoes ou estorne". Alternativa mais leve: log `BUSINESS_WARN` obrigatório + preservar a seleção nova. Tactic Bass: **Idempotent Replay** + **Sanity Checking**. Arquivos: `RecebimentoNumerarioService.ts:353-357`.

**Resultado Esperado**
> Uma re-execução com SN diferente ou (a) cria nova execução com key distinta e o analista consegue baixar contra a SN correta, ou (b) devolve 409/`error` claro; nunca silenciosa. Métrica: 100% dos cenários `snSel_new != snSel_prev` gera log/erro observável (hoje: 0%).

**Métricas de sucesso**
- Divergência SN atual × SN retomada: 0 casos silenciosos (100% logados/erros)
- Teste `RecebimentoNumerarioService.test.ts`: +1 caso cobrindo `snSelecionadaDocCod` × ledger com `docCod` diferente

**Risco de não fazer**
> Baixa contra documento errado descoberta só por reconciliação manual (horas/dias); estorno + realocação exigidos pelo analista, sem trilha do erro.

**Dependências**: nenhuma

---

### [fault-tolerance-2] Guard de `vldStatus=3` (Finalizada) antes de aceitar uma SN selecionada para baixa

**QA**: Fault Tolerance
**Tactic alvo**: Self-Test
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> A rota lista SNs com `vldStatus IN {1,3}` (Aberta + Finalizada) e o serviço não verifica o status antes de criar o borderô fin014. Uma SN Aberta selecionada gera borderô órfão (`criarBordero` + `finalizarBordero` sem baixa), porque o `listTitulosBorderoReceber` devolve vazio e o serviço aborta com mensagem confusa DEPOIS de já ter tocado o ERP.

**Melhoria Proposta**
> Duas frentes: (1) no `RecebimentoNumerarioService.etapaSn` (ou preferencialmente ANTES de `etapaFin014`), quando `snSelecionada`, chamar `getDocumento({tela:'com299', docCod})` e exigir `docVldFinalizado === 1` — reusa a checagem já existente em `ConexosGerDocProcessoClient.assertDocumentoFinalizado`; senão fail-closed com "SN X selecionada está Aberta (não finalizada) — finalize no Conexos ou escolha outra". (2) OU, alternativa modelada no ADR-0027 (finalizar a SN Aberta antes da baixa) — decisão de produto pendente, já registrada como *known follow-up*. Tactic Bass: **Self-Test**. Arquivos: `RecebimentoNumerarioService.ts:412-461` + eventual filtro `vldStatus#EQ:3` na lista se a decisão for "só finalizadas na UI".

**Resultado Esperado**
> SN Aberta selecionada retorna `status='error'` ANTES de criar borderô (0 borderôs órfãos por SN Aberta). Mensagem de erro nomeia o problema real (não "título vazio"). Métrica: 100% das seleções `vldStatus!=3` bloqueadas antes do fin014 (hoje: 0%).

**Métricas de sucesso**
- Borderôs órfãos gerados a partir de SN Aberta: alvo 0 (hoje: N — não medido, mas > 0 potencial)
- Cobertura: teste `SN Aberta selecionada → error, sem chamar criarBordero`

**Risco de não fazer**
> Poluição do fin014 com borderôs vazios; retrabalho manual do analista; UX confusa quando a mensagem aponta "título vazio" mas a causa raiz é "SN não finalizada".

**Dependências**: decisão do produto (item known follow-up do prompt): finalizar automaticamente vs. fail-closed vs. filtrar na UI.

---

### [integrability-2] Envolver `listSNsByProcesso` em `runWithRetry` + `ensureSid` (paridade com os irmãos)

**QA**: Integrability
**Tactic alvo**: Manage Resources
**Esforço**: S (≤1d)
**Findings**: F-integrability-2

**Problema**
> Ao contrário de `listContasProjeto`, `listConfigDocProcesso` e `resolveGcdCodByName` (todos LOV/READ paginados), `listSNsByProcesso` chama `listGenericPaginated` sem `runWithRetry` nem `ensureSid` explícito. Micro-blip de rede/5xx → falha imediata na UI do analista. O comentário do próprio método afirma (incorretamente) que "`listGenericPaginated` já embrulha retry + ensureSid".

**Melhoria Proposta**
> Envolver a chamada no mesmo padrão dos irmãos:
> ```ts
> return await this.base.runWithRetry(async () => {
>     await this.base.ensureSid();
>     const page = await this.base.listGenericPaginated<...>(...);
>     // ...parse + filter + map
> });
> ```
> Corrigir o comentário. Tactic Bass: **Manage Resources / Adhere to Standards**.

**Resultado Esperado**
> Simetria com irmãos; um único blip do Conexos deixa de degradar a UX do modal Alocar. Métrica: taxa de falha por blip transiente cai de ~1 tentativa para ~3 tentativas antes de surfacear ao FE.

**Métricas de sucesso**
- Métodos LOV/lista do client com `runWithRetry`: 3/4 → 4/4
- Comentário do código reflete a realidade

**Risco de não fazer**
> Micro-flakes viram tickets fantasma "às vezes a lista de SN não abre" — muito caros de reproduzir e diagnosticar.

**Dependências**: nenhuma; pode ir junto com integrability-1 (colapsa com availability-1 — mesma edição).

---

### [modifiability-1] Splittar `AlocarProcessosDialog` em painel-esquerdo (Processos) + painel-direito (SN + Processar) + hook de coordenação

**QA**: Modifiability
**Tactic alvo**: Split Module + Increase Semantic Coherence + Use an Intermediary
**Esforço**: M (2–5d)
**Findings**: F-modifiability-1, F-modifiability-2, F-modifiability-3

**Problema**
> O componente cresceu para 733 LOC e cognitive complexity 115 (target 15) — três warnings do Biome no arquivo. 14 `useState`, 3 `useEffect` e 2 `useMemo` num único componente. Cada requisito novo da Frente IV (multi-filial, `saldoRestante`, `snDocCod` seletivo, `gerNum` guard, pré-flight) aterrissou aqui. A próxima iteração provável (teto por título real, paginação de SN, filtro de SN sem saldo) vai amplificar.

**Melhoria Proposta**
> **Split Module** ao longo do eixo estrutural já visível no layout: `AlocarProcessosDialog` (shell + cabeçalho + saldo + seletor de cliente + 2 grid) delega para `<ProcessosPanel processos onSelect selected/>` (painel esquerdo, encapsula o `radiogroup` de processos e os badges de "Processado") e `<SolicitacaoNumerarioPanel processo sns snEscolhida onSnChange valor onValorChange onProcessar processando resultado/>` (painel direito, encapsula radio de "Criar novo" + lista + MoneyInput + botão Processar + ResultadoAlocacao). Extrair `useAlocacaoOrchestrator({ transacao, open })` como hook que devolve `{ clientes, pesCod, processos, sns, processar, saldoRestante, valores, resultados }`. Mover o `processar()` para dentro do hook e devolvê-lo já parametrizado.

**Resultado Esperado**
> Cada mudança de UX no painel direito toca ≤ 2 arquivos (`SolicitacaoNumerarioPanel.tsx` + teste). Cognitive complexity de cada componente ≤ 15. Testes do painel direito podem montar o componente isoladamente com props mockadas — sem carregar clientes/processos.

**Métricas de sucesso**
- Cognitive complexity `AlocarProcessosDialog` raiz: 115 → ≤ 15
- LOC `AlocarProcessosDialog.tsx`: 733 → ≤ 250 (shell)
- Novos arquivos: `ProcessosPanel.tsx` ≤ 180 LOC, `SolicitacaoNumerarioPanel.tsx` ≤ 220 LOC, `useAlocacaoOrchestrator.ts` ≤ 200 LOC
- Warnings Biome `noExcessiveCognitiveComplexity` no dialog: 3 → 0

**Risco de não fazer**
> O próximo requisito (validador de teto por título; paginação de SN quando o processo tiver > 50) vai adicionar 4º `useEffect` + 3º branch no `processar()` e empurrar a complexity acima de 130. Aos 6 meses o componente vira zona proibida de mexer sem quebrar cenários vizinhos (o teste do dialog já é 393 LOC).

**Dependências**: nenhuma — testes atuais servem como safety net do refactor.

---

### [security-3] Cobrir cross-processo/cross-filial tampering do `snDocCod` com testes de regressão

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S (≤1d)
**Findings**: F-security-3, F-security-1

**Problema**
> Os testes atuais da ADR-0027 (`recebimentos.test.ts:410-425`, `RecebimentoNumerarioService.test.ts:255-283`) validam APENAS o happy-path da branch "SN existente": que o `snDocCod` atravessa como `snSelecionadaDocCod` e que o serviço não re-finaliza. Não há teste que: (a) rejeite um `snDocCod` de outro `priCod` na mesma filial; (b) rejeite um `snDocCod` de outra `filCod` dentro da allow-list; (c) rejeite `snDocCod` inválido/inexistente. Sem eles, a remediação de F-security-1 pode ser removida em refactor futuro sem quebrar CI.

**Melhoria Proposta**
> Adicionar em `src/backend/routes/recebimentos.test.ts`: 3 casos no `describe` do `solicitacao-numerario` — (a) `403 quando snDocCod pertence a outro priCod`; (b) `403 quando snDocCod pertence a outra filial da allow-list`; (c) `403 quando snDocCod não existe no ERP`. Stubbar `listSNsByProcesso` (ou `getDocumento`) para devolver o set/documento correspondente. Complementar em `RecebimentoNumerarioService.test.ts` com 1 caso unitário do `etapaSn`. Tactic: **Validate Input** (defense-in-testing).

**Resultado Esperado**
> Cobertura de tampering do `snDocCod`: 0 → ≥ 4 testes; qualquer regressão da validação semântica quebra CI.

**Métricas de sucesso**
- Testes de tampering (cross-processo + cross-filial + inexistente): 0 → ≥4
- Mutação do `snDocCod`-check quebra CI: não → sim

**Risco de não fazer**
> F-security-1 remediado hoje pode ser revertido silenciosamente amanhã.

**Dependências**: security-1 (a validação semântica precisa existir para testar)

---

### [security-5] Fail-closed no `resolverFilCodsAcessiveis` quando o token não tem claim `filiais`

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: M (2–5d — precisa coordenar com a migração de claims/SSO)
**Findings**: F-security-5, F-security-1

**Problema**
> `resolverFilCodsAcessiveis` (linhas 65-71) fail-opens: quando `req.user.filiais` é nulo/vazio, retorna TODAS as filiais do ERP. O teste `runs when the user has NO filiais list (claim not provisioned)` (recebimentos.test.ts:125) documenta que isso é comportamento aceito ("role gate still applies"). Combinado com F-security-1, um ator legado sem migração de claims pode fabricar `snDocCod` de QUALQUER filial do tenant, não só da sua allow-list — regride o princípio SaaSo de isolamento.

**Melhoria Proposta**
> Após migração de claims completa: mudar o default para fail-closed (`return []` quando `filiais` ausente) OU exigir uma flag explícita `SN_ALLOW_UNSCOPED_LEGACY_USERS=true` para manter o fail-open, com log `BUSINESS_WARN` a cada uso e alerta operacional quando o tráfego cair para zero (sinal de que a migração terminou e a flag pode ser removida). Tactic: **Authorize Actors** (fail-safe defaults). Arquivos: `src/backend/routes/recebimentos.ts:65-71`; `src/backend/http/filialAuthz.ts` (se a lógica de fallback vive lá).

**Resultado Esperado**
> Um token sem claim `filiais` responde 403 (ou é surfaced via warn+deny) em vez de ganhar acesso a todas as filiais.

**Métricas de sucesso**
- Fail-opens observados em produção: X → 0 (após migração completa)
- Warns por request unscoped: 0 → 1 (durante a transição)

**Risco de não fazer**
> Um token legado transforma F-security-1 (limitado à allow-list) em vetor cross-filial completo dentro do tenant.

**Dependências**: migração de claims/SSO em progresso (fora do escopo desta ADR, mas o SN existente aumenta a superfície de risco)

---

## P2 — Médio

### [availability-3] Paginação real (ou docstring explícita) em `listSNsByProcesso`

**QA**: Availability
**Tactic alvo**: Sanity Checking (Detect Faults)
**Esforço**: S (≤1d)
**Findings**: F-availability-3

**Problema**
> `listSNsByProcesso` faz um único fetch `pageNumber:1, pageSize:50` (`ConexosGerDocProcessoClient.ts:1092-1093`) sem loop e sem parada por `count`. Um processo com >50 SNs (vldStatus∈{1,3}) tem SNs invisíveis silenciosamente — o mesmo padrão que `listCondPgtoPessoa` (`:843-879`) diagnosticou para condições de pagamento. Risco: analista escolhe "Criar novo SN" porque não vê a que precisa, criando duplicata.

**Melhoria Proposta**
> Duas opções (custo/benefício): (a) paginar pelo `count` como `listCondPgtoPessoa` faz, com cap `MAX_PAGES` e log `BUSINESS_WARN` no cap-hit; (b) manter single-page mas emitir `logService.warn` quando `page.rows.length === pageSize` e adicionar cláusula na docstring assumindo o cap explicitamente. Escolha (a) se o produto quiser suportar processos com >50 SNs; (b) se aceitar-se documentar o limite. Tactic: **Sanity Checking** + **Monitor**.

**Resultado Esperado**
> Nenhum SN elegível é silenciosamente escondido. Painel de SN mostra tudo ou avisa que truncou.

**Métricas de sucesso**
- Cap-hit logado quando rows === pageSize: 0 → 1
- Se paginar: cobertura de processos com >50 SNs: 0% → 100%

**Risco de não fazer**
> SN duplicada em caso raro (processo com histórico longo).

**Dependências**: nenhuma.

---

### [availability-4] Instrumentar `listSNsByProcesso` — duração + contagem + `filCod`/`priCod`

**QA**: Availability
**Tactic alvo**: Monitor (Detect Faults)
**Esforço**: S (≤1d)
**Findings**: F-availability-4

**Problema**
> Nenhum sinal telemétrico é emitido pela leitura nova. Se a rota passar a falhar 20% do tempo, ninguém percebe até chegar chamado. Contraste com o padrão do arquivo (`applyPaymentConditionIfRequired:508-518` — `logService.info` de eventos raros; `requiresRegisteredPaymentCondition:615-629` — `logService.warn` em degradação). Sem métrica, a promessa de availability é opaca.

**Melhoria Proposta**
> Emitir `logService.info({ type: BUSINESS_INFO, message: 'listSNsByProcesso', data: { filCod, priCod, rows: envelope.rows.length, count: envelope.count, duracaoMs } })` no happy path e enriquecer o `ConexosError` da falha com o `filCod`/`priCod` no `data`. Se houver métrica CloudWatch/APM configurada (fora do delta), plugar. Tactic: **Monitor**.

**Resultado Esperado**
> Dashboard de produção mostra latência p50/p95 + taxa de erro por filial. Alarme se erro > 2%/5min.

**Métricas de sucesso**
- Logs estruturados de sucesso: 0 → 1 por chamada
- Contexto no erro: `endpoint` + `filCod` + `priCod`

**Risco de não fazer**
> Incidentes silenciosos até um analista ligar.

**Dependências**: nenhuma.

---

### [deployability-2] Aplicar rate-limit e cache TTL na rota `GET /processos/:priCod/sns`

**QA**: Deployability
**Tactic alvo**: Surge Protection
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> Cada clique num processo do modal dispara um `POST com299/list` no Conexos (`ConexosGerDocProcessoClient.listSNsByProcesso`). A rota GET nova não está atrás do `heavyRouteLimiter` e não há cache por-processo — no dia do rollout, o padrão de "analista testando cada processo" gera burst desnecessário contra o ERP.

**Melhoria Proposta**
> (a) Aplicar um `readLimiter` (ou o próprio `heavyRouteLimiter`) em `routes/recebimentos.ts:366-394`; (b) instanciar um cache in-memory com TTL curto (≥ 30s, ≤ 5min) por `(filCod, priCod)` no `ConexosGerDocProcessoClient.listSNsByProcesso`, seguindo o pattern que o `ConexosCadastroClient` já usa para `listFiliais`. Tactic alvo: Surge Protection.

**Resultado Esperado**
> Múltiplos cliques no mesmo processo dentro do TTL respondem do cache; burst de N processos em cadeia é rate-limitado. Métrica: 100% dos hits repetidos dentro do TTL saem do cache; taxa por-IP ≤ N req/min.

**Métricas de sucesso**
- `com299/list requests / open-do-modal`: N (todos) → 1 no primeiro clique + 0 no reclique dentro do TTL
- `# 429 do Conexos na rota nova`: monitorar; alvo: 0

**Risco de não fazer**
> No dia do rollout, o Conexos passa a lento; o modal aparenta bug ("SNs demoram para carregar"); percepção do usuário fica ruim justamente na estreia do ADR-0027.

**Dependências**: alinhar com card `performance-*` do consolidator (mesma raiz: chamadas Conexos sem cache).

---

### [fault-tolerance-3] Cobrir com teste o fail-closed do título vazio no ramo SN-existente

**QA**: Fault Tolerance
**Tactic alvo**: Self-Test
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> O guard `RecebimentoNumerarioService.ts:1068-1073` (throw quando `listTitulosBorderoReceber` devolve vazio) é o último defesa do ramo SN-existente contra uma SN "vazia" selecionada, mas o novo teste `SN existente selecionada` (linha 255) programa o LOV para devolver título e não exercita o vazio. Regressão silenciosa possível.

**Melhoria Proposta**
> Adicionar em `RecebimentoNumerarioService.test.ts` um caso `it('SN existente selecionada com título vazio (fail-closed): error na etapa fin014 sem escrever baixa', ...)` que programe `listTitulosBorderoReceber.mockResolvedValue([])`, chame `processarAlocacao({snSelecionadaDocCod: 18202})` e verifique (a) `out.status === 'error'`, (b) `out.etapa === 'fin014'`, (c) `gravarBaixa` **não** chamado, (d) mensagem contém o `docCod` selecionado. Tactic Bass: **Self-Test** (cobertura da própria checagem).

**Resultado Esperado**
> Guarda de regressão executável para o ponto de falha mais provável do ramo SN-existente. Métrica: cobertura do fail-closed no branch selecionado 0% → 100%.

**Métricas de sucesso**
- Testes cobrindo fail-closed no ramo SN-existente: 0 → ≥1

**Risco de não fazer**
> Um refactor futuro derruba silenciosamente a proteção e o próximo bug aparece só em produção.

**Dependências**: nenhuma

---

### [fault-tolerance-4] Teste de retomada idempotente do ramo SN-existente (re-POST → `skipped`/`settled`)

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay
**Esforço**: S
**Findings**: F-fault-tolerance-4, F-fault-tolerance-1

**Problema**
> O ADR-0027 afirma que a idempotência `sn-real:{txn}:{pri}:{valor}` continua valendo para o ramo SN-existente, mas o único teste de retomada (`retomada (ledger mostra etapa concluída)`) só cobre "Criar novo SN". Sem prova executável, uma regressão futura no `etapaSn`/`etapaFin014` do ramo selecionado passa nos testes.

**Melhoria Proposta**
> Adicionar dois casos ao `RecebimentoNumerarioService.test.ts`: (1) `SN existente selecionada + ledger settled: retorna skipped sem chamar clients Conexos`, (2) `SN existente selecionada + ledger etapa='fin014-done': retoma na etapaNotaDebito sem re-baixar`. Cada um programa `repo.findByIdempotencyKey.mockResolvedValue({...})` e asserta ausência de `fin014.criarBordero` / `gerDoc.finalizarDocumento`. Tactic Bass: **Idempotent Replay** (cobertura).

**Resultado Esperado**
> Cobertura executável da promessa do ADR-0027. Métrica: 2 novos testes; 0 chamadas Conexos duplicadas no re-POST.

**Métricas de sucesso**
- Cenários retomada SN-existente cobertos: 0 → 2

**Risco de não fazer**
> Regressão futura pode re-executar baixa/NDe na retomada; visível só na reconciliação manual.

**Dependências**: nenhuma

---

### [fault-tolerance-5] Sinal explícito de "SN reutilizada" no ledger e/ou log estruturado

**QA**: Fault Tolerance
**Tactic alvo**: Timestamp (audit trail)
**Esforço**: S (log) / M (coluna + migração)
**Findings**: F-fault-tolerance-5

**Problema**
> O ledger `solicitacao_numerario_execucao` guarda o `doc_cod` da SN mas não diferencia "gerada por nós" de "reutilizada pelo analista via ADR-0027". Auditoria de adoção da feature e investigação de incidentes ficam cegas.

**Melhoria Proposta**
> Preferencialmente: adicionar coluna `origem_sn TEXT CHECK (origem_sn IN ('gerada','reutilizada'))` no ledger + persistir no `beginExecution`. Alternativa leve (sem migração): emitir `logService.info({type: LOG_TYPE.BUSINESS_INFO, message: 'sn-existente-selecionada', data: {txnId, priCod, snDocCod, ator}})` na entrada do `processarAlocacao` quando `snSelecionadaDocCod !== undefined` — combinado com o `LogService` estruturado do handler, dá trilha grep-able. Tactic Bass: **Timestamp / audit trail**. Arquivos: `RecebimentoNumerarioService.ts:217-348` + migração opcional.

**Resultado Esperado**
> Query "quantas alocações usaram SN existente em X" respondível em 1 SQL ou `grep`. Métrica: sinal explícito presente em 100% das execuções do ramo SN-existente (hoje: 0%).

**Métricas de sucesso**
- % execuções ramo SN-existente com sinal explícito: 0% → 100%

**Risco de não fazer**
> Feedback loop cego sobre a adoção do ADR-0027; investigação de incidentes precisa inferir por join custoso.

**Dependências**: opcional — coordenar com o card de audit trail cross-cutting (se existir) para reusar o mesmo shape.

---

### [integrability-3] Paginar `listSNsByProcesso` pelo `count` do envelope (nunca truncar em silêncio)

**QA**: Integrability
**Tactic alvo**: Configure Behavior
**Esforço**: S (≤1d)
**Findings**: F-integrability-3, F-integrability-5

**Problema**
> O método pede `pageSize=50` e busca só `pageNumber:1`. O envelope tem `count`, mas ele é descartado. Um processo com >50 SN perde as antigas — invisíveis para o analista. Combina mal com F-integrability-1: mesmo depois de corrigir a URL, o teto continua em 50. O irmão `listCondPgtoPessoa` documenta esse exato modo de falha ("HML 2026-08-03, ERP ignora pageSize").

**Melhoria Proposta**
> Reusar a mesma doutrina de `listCondPgtoPessoa` (loop while `acumulado < count` OU página vazia, teto de segurança em N páginas). Alternativa mais simples: subir o `pageSize` para 500 (paridade com `resolveGcdCodByName`) e exigir 1 página só como caso normal; se `count > pageSize`, logar `BUSINESS_WARN` e retornar o que tem + `truncated: true` no DTO. Tactic Bass: **Configure Behavior**.

**Resultado Esperado**
> Teto real vira ~500 (ou N × 500 no loop); `count` deixa de ser um dado descartado; qualquer truncamento vira log auditável.

**Métricas de sucesso**
- Teto de SN por processo: 50 → 500 (ou ∞ via loop, com cap-hit auditável)
- `count` do envelope: descartado → usado

**Risco de não fazer**
> Em 6 meses, processo com > 50 SN aparece em produção (backfill/tenant antigo) e a analista recria SN silenciosamente, quebrando I-Receb-3.

**Dependências**: integrability-1 (o URL correto tem que estar em pé antes de exercitar loops).

---

### [integrability-4] Manter `endpoint` do `ConexosError` sincronizado com a URL real

**QA**: Integrability
**Tactic alvo**: Observability of integration failures
**Esforço**: S (≤1h)
**Findings**: F-integrability-4

**Problema**
> `throw new ConexosError({ endpoint: 'com299/list', cause })` reporta um path que NÃO é o chamado (`'com299'`). Log/alarme aponta para o lugar errado no dia de incidente.

**Melhoria Proposta**
> Ou definir `const path = 'com299/list'` UMA vez e reusá-lo tanto na chamada (`listGenericPaginated(path, ...)`) quanto no `ConexosError({ endpoint: path, ... })` — resolve F-4 e F-1 juntos. Padrão dos irmãos. Tactic Bass: **Observability of integration failures**.

**Resultado Esperado**
> Log de falha aponta para o URL efetivamente chamado; diagnóstico direto.

**Métricas de sucesso**
- `endpoint` do `ConexosError`: divergente → consistente com URL POST

**Risco de não fazer**
> MTTR do próximo incidente com299 fica maior; padrão errado propaga.

**Dependências**: integrability-1 (implementar junto).

---

### [modifiability-2] Extrair `useRemoteResource<T>()` para os três `useEffect` de fetch do dialog

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d — refactor mecânico com cobertura de testes existente)
**Findings**: F-modifiability-3, F-modifiability-1

**Problema**
> Três `useEffect` no dialog repetem o padrão `let cancelado; setLoading(true); setErro(null); fetchX().then...catch...finally(setLoading(false))` com pequenas divergências (o terceiro precisou de `eslint-disable exhaustive-deps` porque `sns` inflaria a re-execução). Cada fetch novo copia o padrão + adiciona um par `useState<boolean>` + um `useState<string|null>` de erro. Contribui direto para a complexity 115 do F-modifiability-1.

**Melhoria Proposta**
> **Abstract Common Services**: criar `useRemoteResource<T, K>({ key, fetch, enabled }) => { data, loading, error, refetch }` (`src/frontend/lib/useRemoteResource.ts`), aplicar aos três fetches (`fetchClientes`, `fetchProcessosParaTransacao`, `fetchSNsDoProcesso`). Manter o pattern `cancelado` internamente. O SN por `priCod` vira cache do próprio hook (elimina o `Record<number, SN[]>` explícito e o `eslint-disable`).

**Resultado Esperado**
> 6 `useState` (`loading`/`erro` × 3 recursos) → 0 (encapsulados no hook). Adicionar um 4º fetch (ex.: título real da SN selecionada para validar teto) custa 1 linha, não um bloco.

**Métricas de sucesso**
- `useState` no dialog: 14 → ≤ 8 (ganho direto de 6, mais outros que ficam encapsulados)
- Ocorrências de `eslint-disable-next-line react-hooks/exhaustive-deps` no dialog: 1 → 0
- Linhas dedicadas a coordenar fetches remotos no dialog: ≈80 → ≈15

**Risco de não fazer**
> Cada novo requisito de leitura remota (teto por título, refresh de SN, refresh de processos após aloc) copia o mesmo bloco, agravando o F-modifiability-1.

**Dependências**: se feita ANTES do card modifiability-1, reduz o escopo dele. Recomendo esta ordem.

---

### [modifiability-3] Trocar `snSelecionadaDocCod?: number` por um `AlocacaoIntent` tipado (discriminated union) atravessando FE → HTTP → service

**QA**: Modifiability
**Tactic alvo**: Refactor + Restrict Dependencies + Defer Binding
**Esforço**: M (2–3d)
**Findings**: F-modifiability-4

**Problema**
> O invariante "criar novo SN vs. usar existente" está codificado como AUSÊNCIA de um campo opcional (`snDocCod?`) replicado em 5 lugares com comentários iguais ("ADR-0027"). O `etapaSn` computa `snSelecionada = ctx.snSelecionadaDocCod !== undefined` e usa isso como flag em dois `if`. Adicionar um terceiro modo (ex.: "usar existente + re-finalizar" ou "usar existente + adicionar item complementar") vai multiplicar os `?:` em todas as 5 camadas sem que o TypeScript force exaustividade.

**Melhoria Proposta**
> **Refactor + Restrict Dependencies**: introduzir `type AlocacaoIntent = { modo: 'novo' } | { modo: 'existente'; docCod: number }` em `src/backend/domain/interface/recebimentos/AlocacaoIntent.ts` e em `src/frontend/lib/recebimentos.ts`. Substituir o campo opcional em: (1) `AlocarProcessosDialog.processar()` (mapeia `snEscolhida === CRIAR_NOVO_SN` → `{ modo: 'novo' }`, senão → `{ modo: 'existente', docCod }`), (2) `AlocacaoRequest.intent`, (3) Zod do handler POST (discriminated union), (4) `ProcessarAlocacaoInput.intent`, (5) `EscritaCtx.intent`. No `etapaSn`, `switch (ctx.intent.modo)` — o `default` inalcançável vira erro de compilação se um novo modo for adicionado.

**Resultado Esperado**
> Um novo modo de alocação (o próximo do roadmap) é adicionado tocando 1 tipo + 5 `switch` que o compilador exige. Zero risco de omitir um layer.

**Métricas de sucesso**
- Campos opcionais espalhados por `snDocCod`/`snSelecionadaDocCod`: 5 → 0
- Exaustividade estática garantida: sim (via `never` no default do switch)
- Novo teste "adicionar 3º modo" quebra em compilação nos 5 lugares certos

**Risco de não fazer**
> Quando surgir o 3º modo (o comentário em `AlocacaoIntent` sinaliza que já está no radar), a implementação vai esquecer uma das 5 camadas — 90% de chance de bug silencioso em pelo menos uma.

**Dependências**: independente. Ganha se rodar depois do card modifiability-1 (o `processar()` já estará numa função menor).

---

### [modifiability-4] Extrair helpers do POST `solicitacao-numerario` handler para baixar a cognitive complexity

**QA**: Modifiability
**Tactic alvo**: Split Module + Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-modifiability-5

**Problema**
> O handler está em cognitive complexity 20 (target 15) por warning pré-existente do Biome — este PR adicionou o campo `snDocCod` (linhas 419-424 e 529-531) sem aliviar. Acumula parse Zod + load transação + guard 422 + authz try/catch + resolução de dryRun + pré-flight de ACL condicional + dispatch com 7 spreads condicionais em 96 LOC.

**Melhoria Proposta**
> **Split Module (extract-function)**: extrair (a) `carregarTransacaoOu422(txnId, res) → TransacaoBancaria | null` (encapsula o 404 e o 422 de `gerNum` ausente), (b) `mapearProcessoFields(parsed) → RecebimentoNumerarioProcessoFields` (encapsula os 5 spreads condicionais), (c) `resolverAcessoOu403(user, filCod, res) → boolean` (encapsula o try/catch de authz reutilizado em todas as rotas — hoje repetido em 5 handlers deste arquivo). Handler-alvo fica com ≈ 40 LOC lineares.

**Resultado Esperado**
> Cognitive complexity ≤ 12; adicionar um 3º campo opcional custa 1 spread no dispatch, não amplifica a árvore de `if`.

**Métricas de sucesso**
- Cognitive complexity POST handler: 20 → ≤ 12
- Ocorrências de `try { assertUserCanActOnFilial } catch (err) { if (err instanceof FilialForbiddenError) { res.status(403).json(...); return } throw err }` no arquivo: 5 → 0 (todas via helper)
- Warnings Biome `noExcessiveCognitiveComplexity` em `routes/recebimentos.ts`: 1 → 0

**Risco de não fazer**
> As próximas features (parcelas por título, header `Idempotency-Key`, resposta enriquecida) vão aterrissar aqui e empurrar a complexity acima de 25.

**Dependências**: nenhuma.

---

### [performance-1] Paginar `listSNsByProcesso` até esgotar o `count` (mesmo padrão de `listCondPgtoPessoa`)

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S (≤ 1 dia — replicar loop existente, adicionar teste que verifica 2 páginas)
**Findings**: F-performance-1

**Problema**
> `listSNsByProcesso` lê APENAS a 1ª página do `com299/list` (pageSize=50) e ignora o `count` do envelope. Um processo com >50 SNs históricas silenciosamente perde as mais antigas na UI. Vizinho no mesmo arquivo (`listCondPgtoPessoa`) teve o MESMO bug corrigido hoje (comentário live 2026-08-03 sobre pesCod 232).

**Melhoria Proposta**
> Adotar o mesmo padrão de `listCondPgtoPessoa` (`ConexosGerDocProcessoClient.ts:854-873`): loop `for (pageNumber = 1; pageNumber <= TETO; ...)`, para em página vazia ou `acumulado.length >= count`. Manter `pageSize` alto (200) para minimizar round-trips no caso quente e ainda paginar quando o processo tiver > 200. Ordem `docCod desc` já garante que a 1ª página traz as mais úteis; a paginação só custa quando realmente precisa. Tactic: `Bound Execution Times` + `Manage Sampling Rate`.

**Resultado Esperado**
> 100% da lista de SN elegíveis exibida independente do histórico. Custo esperado: 1 round-trip Conexos para p99 dos processos (≤ 200 SNs), 2 para p99.9. Silent-truncation eliminada.

**Métricas de sucesso**
- Cobertura de SN listadas: ~85-100% (assumindo p99=30) → 100%
- Round-trips Conexos por chamada: 1 (p50) → 1 (p50) / 2 (p99.9)

**Risco de não fazer**
> Em 18 meses, com uso intenso, um processo comex-continuous pode passar de 50 SNs; o analista escolherá "Criar novo SN" sem saber que existe uma antiga válida — reintroduzindo a duplicata que o ADR-0027 D3 (I-Receb-3.b) proíbe.

**Dependências**: nenhuma

---

### [performance-2] Invalidar cache `sns[priCod]` após "Processar" bem-sucedido em ramo "Criar novo SN"

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Data
**Esforço**: S (≤ 0.5 dia — 3 linhas + teste)
**Findings**: F-performance-2

**Problema**
> Após criar SN nova no ERP via "Processar", o cache in-memory `sns[priCod]` no dialog continua com a lista antiga. Se o analista alocar outra fatia do saldo no mesmo processo, ele não vê a SN que acabou de gerar — pode duplicar. Contradiz o objetivo do ADR-0027 D3 (I-Receb-3.b, "sem duplicata").

**Melhoria Proposta**
> Em `AlocarProcessosDialog.tsx:329-374` (função `processar`), após `resultado.status === 'settled'` E `snDocCod === undefined` (ramo "Criar novo SN"), invalidar o bucket: `setSns((prev) => { const c = { ...prev }; delete c[processo.priCod]; return c })`. O useEffect subsequente (linha 305-327) refetch quando o processo for re-selecionado. Alternativa: fazer optimistic append usando o `resultado.snDocCod`. Tactic: `Maintain Multiple Copies of Data (bounded staleness)`.

**Resultado Esperado**
> 100% de refresh do painel de SN no processo alterado após "Criar novo SN" quitar. Elimina a janela de duplicata em split-payment intra-modal.

**Métricas de sucesso**
- % de decisões de "Criar novo SN" em split-payment com lista atualizada: 0% → 100%
- Duplicatas silenciosas em split-payment intra-modal: risco atual "possível" → 0

**Risco de não fazer**
> SN duplicadas em fluxo split — infringe invariante I-Receb-3.b registrado no ADR-0027.

**Dependências**: nenhuma

---

### [security-2] Adicionar `heavyRouteLimiter` e um cap defensivo de páginas no GET `/processos/:priCod/sns`

**QA**: Security
**Tactic alvo**: Detect Service Denial / Limit Exposure
**Esforço**: S (≤1d)
**Findings**: F-security-2

**Problema**
> A rota nova GET `/recebimentos/processos/:priCod/sns` não está atrás do `heavyRouteLimiter` que protege as três rotas mutantes do arquivo. Um analista dentro da allow-list de filiais pode enumerar `priCod=1..N` sem throttling, mapeando (a) quais processos existem na filial autorizada e (b) quais `docCod` de SN existem em cada — reconhecimento direto para F-security-1 e carga desnecessária no `com299/list` do Conexos (ERP compartilhado com `fechamento-processos`).

**Melhoria Proposta**
> (a) Adicionar `heavyRouteLimiter` como middleware do GET (mesma configuração das rotas mutantes do arquivo). (b) Se o `heavyRouteLimiter` for muito agressivo para leituras, introduzir um `readRouteLimiter` com quota maior (ex.: 100 req/min por `sub`) reutilizando `src/backend/http/rateLimit.ts`. Tactic: **Detect Service Denial** + **Limit Exposure**. Arquivo: `src/backend/routes/recebimentos.ts:366` (adicionar middleware).

**Resultado Esperado**
> Enumeração larga (>N req/min por usuário) responde 429; carga no `com299/list` cai em cenários adversariais; F-security-1 fica menos amplificado.

**Métricas de sucesso**
- Rotas read-only novas com rate-limit: 0/1 → 1/1
- 429 rate observed sob teste de enumeração (≥100 req/s por sub): 0 → ≥ 1

**Risco de não fazer**
> Reconnaissance grátis alimenta o vetor F-security-1; risco secundário de saturar o ERP Conexos multi-tenant.

**Dependências**: nenhuma

---

### [security-4] Diferenciar a mensagem de erro do fin014 sob `snDocCod` inválido — sinalizar potencial tampering

**QA**: Security
**Tactic alvo**: Detect Intrusion
**Esforço**: S (≤1d)
**Findings**: F-security-4, F-security-1

**Problema**
> Quando o `listTitulosBorderoReceber({filCod, docCod})` volta vazio na branch de SN existente, o serviço lança "SN não gerou título — não ficou finalizável" (`RecebimentoNumerarioService.ts:1069-1073`). A mesma mensagem cobre dois cenários DISTINTOS: (i) SN legítima mas incompleta; (ii) `snDocCod` forjado (tampering). Sem separação, a observabilidade não sinaliza incidente de segurança — MTTR sobe.

**Melhoria Proposta**
> Após F-security-1 remediado, categorizar o erro por classe: se `snSelecionadaDocCod` chegou ao fin014 é porque passou pela validação de posse — nunca deve dar "título vazio" na happy-path da SN existente (a SN selecionada já está finalizada por definição). Se acontecer, é anomalia — logar `LOG_TYPE.SECURITY_WARN` com `docCod`, `priCod`, `ator`, `filCod` e reprojetar o erro. Tactic: **Detect Intrusion**. Arquivo: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1068-1073`.

**Resultado Esperado**
> Categorias de erro dedicadas para "docCod-processo mismatch" e "SN selecionada mas sem título" (anomalia); alertas de segurança levantam quando o segundo caso ocorre em produção.

**Métricas de sucesso**
- Categorias distintas de erro: 1 → ≥ 2
- Alertas gerados para o cenário "SN selecionada sem título": 0 → 1 por ocorrência

**Risco de não fazer**
> Incidentes de segurança passam por incidentes de negócio ("cliente reclamando de baixa errada") — MTTR alto e trilha de auditoria fraca.

**Dependências**: security-1

---

### [testability-1] Adicionar teste combinando `snSelecionadaDocCod` + ledger pré-existente (precedência da seleção)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> O ramo "SN existente + retomada por ledger" (`service.ts:357`) usa `??` para dar precedência à seleção do analista sobre o docCod que já está no ledger. Zero testes cobrem esse combined branch — um refactor que troque `??` por `||` ou inverta a ordem quebraria a precedência silenciosamente e a baixa iria contra a SN errada.

**Melhoria Proposta**
> Adicionar 1 caso em `RecebimentoNumerarioService.test.ts` no bloco "retomada": stub de `findByIdempotencyKey` retornando `{ docCod: 999, ... }` **junto com** `baseInput({ snSelecionadaDocCod: 18202 })`. Assertar `out.snDocCod === 18202` (não 999) E `fin014.listTitulosBorderoReceber` chamado com `{ docCod: 18202 }`. Tactic Bass: Executable Assertions ancorada no invariante "seleção do humano tem precedência sobre estado persistido" (ADR-0027 D3).

**Resultado Esperado**
> O ramo combined (seleção + ledger) fica coberto por teste dedicado. Cobertura do ramo `??`: 0 → 1 caso.

**Métricas de sucesso**
- Casos que combinam `snSelecionadaDocCod` + `existente.docCod` populado: 0 → 1
- Suite `RecebimentoNumerarioService.test.ts`: 42 → 43 casos

**Risco de não fazer**
> Um dev que "arrume" o `??` para `||` (comportamento sutilmente diferente com `docCod=0`) ou inverta a precedência em uma refatoração passa no CI e chega em produção. Baixa contra SN errada = incidente financeiro que só o analista pega ao conciliar.

**Dependências**: nenhuma

---

### [testability-2] Teste-guarda documentando que o FE NÃO valida `valor` contra o `solicitado`/`valor` da SN (ADR-0027 D4)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-4

**Problema**
> A decisão D4 do ADR-0027 é explícita: o teto do valor alocado ≤ saldo é enforced na baixa `fin014` (que lê o título via `lov/TituloBorderoReceber`), não no FE — porque `com299/list` é document-level e não carrega o saldo por-título. Essa decisão não tem teste que a documente. Um dev futuro pode achar que "falta gating" e adicionar validação client-side pelo `sn.solicitado`, quebrando alocações válidas onde o título já foi parcialmente baixado.

**Melhoria Proposta**
> Adicionar 1 caso em `AlocarProcessosDialog.test.tsx`: escolher SN existente com `snExistente.solicitado = 100`, digitar valor `15000` (< saldo do pagamento), assertar que o botão "Processar" continua **habilitado** (o FE não bloqueia; o backend decide). Comentário do teste amarra ao ADR-0027 D4. Tactic Bass: Executable Assertions ancorada em decisão de arquitetura.

**Resultado Esperado**
> A decisão D4 vira asserção. Cobertura do gate "FE não bloqueia por sn.solicitado": 0 → 1 caso; um refactor bem-intencionado que adicione gate client-side quebra este teste.

**Métricas de sucesso**
- Casos que documentam ADR-0027 D4 no FE: 0 → 1
- Suite `AlocarProcessosDialog.test.tsx`: 23 → 24 casos

**Risco de não fazer**
> Dev futuro adiciona validação client-side "óbvia" pelo valor da lista, quebra alocações reais (título parcialmente baixado tem saldo < valor original), analista fica sem conseguir alocar e liga para suporte. Fix requer re-derivar a decisão D4 do zero.

**Dependências**: nenhuma

---

## P3 — Baixo

### [availability-5] Invalidar cache `sns[priCod]` no FE após um `Processar` bem-sucedido

**QA**: Availability
**Tactic alvo**: State Resynchronization (Reintroduction)
**Esforço**: S (≤1d)
**Findings**: F-availability-5

**Problema**
> O FE cacheia por `priCod` a lista de SN (`AlocarProcessosDialog.tsx:309`) e nunca invalida — nem depois de um `Processar` que cria uma SN nova ou consome uma existente. Se o analista voltar ao mesmo processo, vê lista stale. Efeito prático raro (o modal já mostra `ResultadoAlocacao` do processo), mas fora do contrato de State Resynchronization.

**Melhoria Proposta**
> No `processar` (`:329-374`), após `resultado.status === 'settled'` (ou `skipped`), remover a entrada `sns[processo.priCod]` do estado (`setSns((prev) => { const next = { ...prev }; delete next[processo.priCod]; return next })`), para forçar re-fetch se o analista retornar. Tactic: **State Resynchronization**.

**Resultado Esperado**
> Sem lista stale após operação. Custo: 1 re-fetch adicional por processo processado (aceitável).

**Métricas de sucesso**
- Reincidência de lista stale após `Processar`: qualquer → 0

**Risco de não fazer**
> Caso raro de SN duplicada por retomar processo já operado.

**Dependências**: nenhuma. (Redundante com performance-2 — implementar uma vez.)

---

### [deployability-1] Emitir contador/flag `snReutilizada` no ledger e no log de settle

**QA**: Deployability
**Tactic alvo**: Deployment observability
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> Após o deploy do ADR-0027, o operador não consegue medir com um `grep`/dashboard quantas alocações reusaram SN existente vs. geraram uma nova. O único sinal está no `ctx.snSelecionadaDocCod`, que morre no scope do service e não vai para o `execucao_repository` nem para o log estruturado.

**Melhoria Proposta**
> Adicionar `snReutilizada: boolean` (derivado de `ctx.snSelecionadaDocCod !== undefined`) em: (a) log INFO do dry-run e do settle (`LogService.info` em `RecebimentoNumerarioService.ts:264-283, 381-386`); (b) opcionalmente, uma coluna do `solicitacao_numerario_execucao` (numa migration nova quando houver outra razão para tocar a tabela — não abrir migration só para isso). Tactic alvo: Deployment observability.

**Resultado Esperado**
> Operador consegue rodar `grep 'snReutilizada":true' render.log | wc -l` e obter a contagem imediata; dashboard consegue plotar % adoção do novo ramo. Métrica: 0 → 100% dos settles carregam o flag.

**Métricas de sucesso**
- `# logs com flag snReutilizada / # settles do dia`: 0 → 1.0
- Tempo para responder "quantas SNs foram reusadas na 1ª semana?": manual grep multi-campo → 1 query

**Risco de não fazer**
> Uma regressão silenciosa (ex.: FE deixa de mandar `snDocCod`) só é detectada quando um analista reclama de SN duplicada no ERP — dias de latência.

**Dependências**: nenhuma. Redundante com fault-tolerance-5 — implementar uma vez.

---

### [deployability-3] Feature-flag específica `SN_SELECT_ENABLED` para cutover gradual do ramo

**QA**: Deployability
**Tactic alvo**: Scale Rollouts (canary por feature flag)
**Esforço**: S (≤1d)
**Findings**: F-deployability-3

**Problema**
> O ramo "SN existente" fica disponível a 100% dos analistas assim que `main` deploya. Um bug isolado no `listSNsByProcesso` (novo Zod, novo filtro no ERP) só é contornável desligando a frente inteira (`RECEBIMENTOS_ENABLED=false`), o que apaga ingestão e painel READ-only já operacionais.

**Melhoria Proposta**
> Adicionar `SN_SELECT_ENABLED` no `EnvironmentProvider` (fail-safe: em prod, ausência = **desligado**), gatear a rota `GET /processos/:priCod/sns` (retornar `[]`) e a UI (esconder a lista, manter só o default "Criar novo SN"). Ligar por-cliente via dashboard Render (`sync: false`). Tactic alvo: Scale Rollouts.

**Resultado Esperado**
> Cutover gradual: liga a env em dev/HML primeiro, promove a prod só depois de ≥ 24h estáveis. Rollback do ramo = 1 toggle no dashboard, sem redeploy. Métrica: MTTR do ramo isolado ≤ 5min (era: reverter binário ~= 5-10min).

**Métricas de sucesso**
- `# envs granulando o cutover da Frente IV`: 1 (`RECEBIMENTOS_ENABLED`) → 2 (+ `SN_SELECT_ENABLED`)
- Toggle-to-effect time: N/A → ≤ 60s (Render env change trigger)

**Risco de não fazer**
> Um incidente que atinja apenas o ramo novo derruba a frente inteira; o operador não tem "circuito de escape" granular.

**Dependências**: nenhuma; complementa deployability-1/fault-tolerance-5 (que dão o telemetry para saber quando ligar/desligar).

---

### [integrability-5] Expor `total`/`truncated` no DTO do endpoint `GET /processos/:priCod/sns`

**QA**: Integrability
**Tactic alvo**: Tailor Interface
**Esforço**: S (1d)
**Findings**: F-integrability-3, F-integrability-5

**Problema**
> A resposta atual é `{ priCod, sns }` — o FE não sabe se a lista está completa. Combinado com o teto de 50 (F-3), o silêncio é duplo. O envelope Conexos já traz `count`.

**Melhoria Proposta**
> Devolver `{ priCod, sns, total, truncated }` (onde `total = count` do envelope e `truncated = sns.length < total`). No FE, quando `truncated`, exibir um discreto "Mostrando as N mais recentes de M — refine o filtro" no painel direito. Tactic Bass: **Tailor Interface**.

**Resultado Esperado**
> FE sinaliza truncamento em vez de esconder; analista sabe quando precisa buscar diferente.

**Métricas de sucesso**
- Sinal de truncamento no FE: 0 → 1
- Cards com > 50 SN: silêncio → aviso visível

**Risco de não fazer**
> Baixo em greenfield; agrava com backfill.

**Dependências**: integrability-3 (o mesmo caminho de código).

---

### [integrability-6] Compartilhar o DTO `SolicitacaoNumerarioListItem` entre FE e BE (ou gerar do schema)

**QA**: Integrability
**Tactic alvo**: Adhere to Standards / Contract testing
**Esforço**: M (2-5d) para (a); S (≤1d) para (b)
**Findings**: F-integrability-6

**Problema**
> `interface SolicitacaoNumerarioListItem` está declarada em `src/backend/domain/interface/recebimentos/SolicitacaoNumerarioListItem.ts:96-113` e reescrita em `src/frontend/lib/recebimentos.ts:435-452` com os MESMOS campos e comentários. Adicionar/renomear um campo exige tocar dois lados em compasso; um miss compila silenciosamente até quebrar em runtime.

**Melhoria Proposta**
> Ou: (a) publicar os schemas Zod do BE como fonte única (build-time) e derivar os tipos no FE via `z.infer`; (b) manter a duplicação mas adicionar um teste "contract mirror" que importa AMBOS os arquivos e falha se os campos divergirem (via `keyof` compare); (c) no médio prazo (Frente XI), formalizar OpenAPI/tRPC. Este delta pode aceitar (b) como amortização barata. Tactic Bass: **Adhere to Standards**.

**Resultado Esperado**
> Drift FE↔BE detectado no CI, não em produção.

**Métricas de sucesso**
- DTOs BE↔FE cobertos por assertion cross-boundary: 0 → 1 (deste delta)
- Latência do drift (build → runtime): infinita → CI

**Risco de não fazer**
> Cada novo DTO da Frente IV duplica; drift eventual em produção.

**Dependências**: nenhuma; recomendável fazer em conjunto com o card modifiability-3 (discriminated union).

---

### [modifiability-5] Reforçar o teste do `etapaSn` no modo "SN existente" para blindar o guard `snSelecionada`

**QA**: Modifiability
**Tactic alvo**: (reforço de testabilidade em suporte a Modifiability)
**Esforço**: S (≤0.5d)
**Findings**: F-modifiability-4

**Problema**
> O guard `if (!snSelecionada && (existente?.etapa === undefined || existente.etapa === 'sn'))` (linha 452) codifica DOIS invariantes acoplados: (a) não re-gerar uma SN existente, (b) não re-finalizar uma SN já finalizada. Se algum refactor futuro (por exemplo o card modifiability-3, ou uma retomada de "SN em rascunho selecionada pelo analista") mexer nesse `if`, o risco de re-finalizar um documento pronto ou de re-gerar SN duplicada (viola I-Receb-3) é real.

**Melhoria Proposta**
> **Increase Semantic Coherence**: garantir dois testes de contrato no `RecebimentoNumerarioService.test.ts`: (1) `snSelecionadaDocCod` presente → `gerDocClient.gerarDocProcesso` NUNCA chamado E `gerDocClient.finalizarDocumento` NUNCA chamado, e (2) retomada com `existente.etapa === 'sn-finalizar'` e `snSelecionadaDocCod` presente → mesmo assim NÃO re-finaliza. Ambos são golden-tests do invariante; qualquer refactor do `etapaSn` que quebre um deles é acusado de imediato. Se já existirem (o arquivo cresceu +30 linhas neste PR — `_shared-metrics.md`), promovê-los a um `describe('invariantes ADR-0027')` explícito.

**Resultado Esperado**
> O invariante "SN selecionada nunca é regenerada nem re-finalizada" fica testável em ≤ 20 LOC e resistente a refactor do card modifiability-3.

**Métricas de sucesso**
- Testes explicitamente rotulados como "invariantes ADR-0027": 0 → ≥ 2
- Cobertura de mutação do `etapaSn` no branch `snSelecionada`: verificável em spike com Stryker (opcional)

**Risco de não fazer**
> Quando o card modifiability-3 (discriminated union) rodar, o risco de deslizar num dos 5 pontos de refactor é o cenário canônico de bug silencioso — o teste do invariante é a rede de segurança.

**Dependências**: independente; recomendo rodar ANTES do card modifiability-3.

---

### [performance-3] Aplicar rate limit dedicado ao `GET /processos/:priCod/sns`

**QA**: Performance
**Tactic alvo**: Limit Event Response
**Esforço**: S (≤ 0.5 dia — decorator middleware)
**Findings**: F-performance-3

**Problema**
> Rota nova sem rate limit próprio. Cada chamada é 1× `POST com299/list` no Conexos (p95 2-4s). Um bug de `useEffect` no FE ou um cliente HTTP mal-comportado pode saturar a sessão Conexos do tenant.

**Melhoria Proposta**
> Adicionar `readRouteLimiter` (ou criar um limiter de leitura leve — 60 req/min por usuário) na rota `GET /processos/:priCod/sns` em `routes/recebimentos.ts:366`. Reusar o middleware que já existe no repo. Tactic: `Limit Event Response`.

**Resultado Esperado**
> Rota READ com teto explícito: 60 req/min/usuário → 429 acima disso. Sessão Conexos protegida contra loop acidental. Um `useEffect` bugado vira `429` em vez de N × 2s de Conexos.

**Métricas de sucesso**
- Rate limit rota READ: ausente → 60 req/min/usuário
- Chamadas em burst absurdo (>100 req/min): permitidas → bloqueadas

**Risco de não fazer**
> Baixo até um bug de FE (ou porte para SWR/React Query com refetch-on-focus) transformar o `useEffect` num loop.

**Dependências**: nenhuma — verificar se `heavyRouteLimiter` é apropriado ou precisa de `readRouteLimiter` novo. Redundante com security-2 / deployability-2.

---

### [performance-4] Elevar cache de SN de per-modal-session para per-tab-session (leve)

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: M (2-3 dias — store + testes + coordenação com card `performance-2`)
**Findings**: F-performance-4

**Problema**
> Cache atual é local ao `AlocarProcessosDialog`. Analista que processa 5-10 transações do mesmo cliente numa manhã revisita os mesmos processos → refetch em cada abertura de modal. Cache-hit inter-modal: 0%.

**Melhoria Proposta**
> Extrair o cache para um store de módulo (React Context ou Zustand em `src/frontend/lib/recebimentos-cache.ts`) com TTL curto (5min) e key `${priCod}:${filCod}`. Invalidar no logout/troca de tenant e no evento "processar novo SN" (ver card `performance-2`). Tactic: `Maintain Multiple Copies of Computations`.

**Resultado Esperado**
> Cache-hit inter-modal para o mesmo `(priCod, filCod)` em ≤ 5min: 0% → ≥ 70% em analista real. p95 de latência de abertura do painel de SN em sessão longa: ~2s → ~50ms.

**Métricas de sucesso**
- Cache-hit-ratio inter-modal: 0% → ≥ 70%
- Chamadas `com299/list` por analista/dia: baseline → -50%

**Risco de não fazer**
> UX percebida como "lenta e repetitiva" — cosmético. Não bloqueia.

**Dependências**: `performance-2` (a invalidação pós-processamento tem que coexistir com o store maior).

---

### [testability-3] Teste de contrato do helper `fetchSNsDoProcesso` (URL + error propagation)

**QA**: Testability
**Tactic alvo**: Specialized Interfaces
**Esforço**: S (≤1d)
**Findings**: F-testability-2

**Problema**
> `fetchSNsDoProcesso` (`src/frontend/lib/recebimentos.ts:526`) monta a URL do backend com dois `encodeURIComponent` e propaga erros HTTP como `throw new Error('API ${res.status}')`. Só é exercitado transitivamente pelo dialog test (que mocka o módulo inteiro) — nenhum teste direto assertaria uma troca acidental da rota (`/sns` → `/solicitacoes`) ou falha de escape.

**Melhoria Proposta**
> Criar `src/frontend/lib/recebimentos.test.ts` (ou reutilizar arquivo se existir) com 2 casos: (a) `fetch` mockado devolve `{sns:[snExistente]}` → assert URL é `/recebimentos/processos/3254/sns?filCod=4` (composição correta); (b) `fetch` mockado devolve 500 → assert `await fetchSNsDoProcesso(3254, 4)` rejeita com `Error('API 500')`. Tactic Bass: Specialized Interfaces (contrato do wire FE→BE testado sem UI).

**Resultado Esperado**
> O contrato do wire FE→BE do ADR-0027 fica testado sem depender do dialog. Cobertura direta de `fetchSNsDoProcesso`: 0 → 2 casos.

**Métricas de sucesso**
- Casos diretos em `lib/recebimentos.test.ts` para `fetchSNsDoProcesso`: 0 → 2

**Risco de não fazer**
> Baixo. Refactor puro do lib (renomear função, alterar composição da URL) pode passar no CI mesmo quebrando o contrato — só o e2e pega, e o e2e do repo tem 14 fails pré-existentes que mascaram o sinal.

**Dependências**: nenhuma

---

### [testability-4] Paginação de `listSNsByProcesso` — decidir e testar (top-N vs. paginação completa)

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S (opção a) / M (opção b)
**Findings**: F-testability-3

**Problema**
> `listSNsByProcesso` (`ConexosGerDocProcessoClient.ts:1049`) chama `listGenericPaginated({pageNumber: 1, pageSize: 50})` uma única vez — comportamento intencional (top-N por `docCod desc`), mas não assertado como invariante. Se um processo tiver > 50 SNs históricas, o analista só vê as 50 mais recentes; nenhum teste mede isso, ao contrário do `listCondPgtoPessoa` que TEM 3 casos de paginação.

**Melhoria Proposta**
> Duas opções — decidir com o Yuri antes de implementar:
> (a) **Manter top-N** (posição atual): adicionar 1 caso que assert `listGenericPaginated.toHaveBeenCalledTimes(1)` E que documente "top-N desc" no comment.
> (b) **Paginar completo** (paridade com `listCondPgtoPessoa`): refatorar `listSNsByProcesso` para acumular até `count`, adicionar 2 casos (envelope com count > pageSize; envelope sem count → 1 página só).
> Tactic Bass: Limit Non-Determinism (comportamento explícito) + Executable Assertions.

**Resultado Esperado**
> Comportamento de paginação da nova rota READ fica documentado por teste. Cobertura: 0 → 1 caso (opção a) ou 0 → 2 casos (opção b).

**Métricas de sucesso**
- Casos que documentam a paginação de `listSNsByProcesso`: 0 → 1 (a) ou 0 → 2 (b)

**Risco de não fazer**
> Baixo hoje (cliente novo → poucas SNs por processo). Cresce com tenure — em 2 anos, cliente antigo com > 50 SNs históricas pode reciclar uma SN antiga que o analista não vê na tela → duplicata financeira.

**Dependências**: decisão de produto (Yuri) sobre top-N vs. paginação completa. Consolida com performance-1 / integrability-3.
