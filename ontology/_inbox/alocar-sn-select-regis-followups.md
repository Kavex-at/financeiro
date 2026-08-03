# Regis-Review follow-ups — alocar-sn-select (ADR-0027)

**Feature:** selecionar SN existente antes de "Processar" (two-pane modal; existing-SN path = fin014 baixa + com297 NDe contra o docCod selecionado, pulando a criação/finalização da SN).
**Run:** `docs/regis-review/2026-08-03-1847-alocar-sn-select/` (REPORT.md + KANBAN.md).
**Gates no fechamento:** backend typecheck/lint/tests verdes (0 regressão; e2e `recebimentos.e2e.*` já falham na base branch por defeito HML pré-existente do fin014); frontend typecheck/lint/tests verdes; PatternGuardian PASS; DesignSystemReviewer PASS.

> **P0 já remediados EM-LOOP (não entram aqui):**
> - **F-security-1** — `snDocCod` não era validado contra `(priCod, filCod)`. Adicionado
>   `RecebimentoNumerarioService.assertSnPertenceAoProcesso` (valida posse via `listSNsByProcesso`
>   antes de qualquer escrita; fail-closed se a leitura falhar). Testes: recusa docCod alheio + fail-closed.
> - **F-integrability-1** — `listSNsByProcesso` POSTava em `com299` (documento) em vez de `com299/list`
>   (lista). Corrigido o 1º arg do `listGenericPaginated` para `com299/list` (paridade com `resolveGcdCodByName`).
>   Sem o fix a feature ficaria inerte (rows vazio / 4xx). Teste atualizado.
> - **Bônus P1 corrigido junto** (mesmo método tocado): `listSNsByProcesso` agora usa `runWithRetry` +
>   `ensureSid` (paridade com os métodos irmãos; docstring falsa corrigida) — F-availability-1 / F-integrability-2.

---

## KNOWN follow-ups (a registrar explicitamente — do enunciado)

- **(a) vldStatus→label mapping não confirmado.** O mapa `{1:'Aberta', 3:'Finalizada'}` em
  `SolicitacaoNumerarioListItem.ts` é best-effort — só `vldStatus=3` foi visto no HAR. Fallback `SN ${vldStatus}`
  já protege o desconhecido. **Confirmar em HML** os demais valores (ex. 1='Aberta'?) antes de tratar o rótulo
  como autoritativo.
- **(b) saldo REAL por-título não é mostrado na lista.** A lista é document-level (`mnyBruto`/`docMnyValor`);
  o teto de valor (≤ saldo real da SN) é imposto na baixa (fin014, leitura do título), NÃO na lista. A UI mostra
  "solicitado" e "valor" do documento, não o saldo aberto por-título. Decidir se/como surfaçar o saldo real
  (exigiria um read adicional por SN).
- **(c) SN 'Aberta' (não finalizada) selecionada precisa de finalização antes da baixa?** O caminho existing-SN
  PULA a finalização (assume a SN já finalizada). Se o analista selecionar uma SN `vldStatus=1` (Aberta), o
  fin014 fail-close (título ausente → `listTitulosBorderoReceber` vazio → erro claro), mas NÃO finaliza a SN.
  **Decidir domínio:** (i) filtrar a lista só para SN finalizáveis/finalizadas, ou (ii) finalizar a SN Aberta
  selecionada antes da baixa, ou (iii) manter o fail-close atual e orientar o analista. Corrobora F-fault-tolerance F-2.

---

## Regis-Review P1 (não implementados aqui — backlog)

- **F-availability-2 / F-fault-tolerance (P1)** — sem guard de `vldStatus`/`docVldFinalizado` na SN selecionada
  antes da baixa. Hoje o `assertSnPertenceAoProcesso` (P0) confirma posse/existência, mas não finalização.
  Ver KNOWN follow-up (c). Tactic: Condition Monitoring / Sanity Checking.
- **F-modifiability-1 (P1)** — `AlocarProcessosDialog.tsx` com cognitive complexity ~115 (target 15), 14 `useState`,
  3 `useEffect`. Split sugerido: `ProcessosPanel` + `SolicitacaoNumerarioPanel` + `useAlocacaoOrchestrator`.
  (Consistente com warnings de complexidade já existentes em handlers irmãos.) Tactic: Split Module.
- **F-security-3 (P1)** — testes de regressão de tampering cross-processo/cross-filial (parcialmente coberto
  pelos 2 testes do P0; ampliar para cross-filial explícito e para o caminho via ledger pré-existente).
- **F-security-5 (P1)** — `resolverFilCodsAcessiveis` faz fail-OPEN quando o token não tem claim `filiais`
  (varre todas as filiais do ERP). Pré-existente à feature, mas amplifica o vetor do P0. Avaliar fail-closed.

## Regis-Review P2 (backlog)

- **F-performance-2 / F-availability-5 / F-deployability (P2)** — cache `sns[priCod]` no dialog NÃO é
  invalidado após um "Criar novo SN" bem-sucedido; num split intra-modal o analista pode não ver a SN que
  acabou de criar (risco de duplicata contra o espírito de I-Receb-3). Invalidar/atualizar o cache pós-processar.
- **F-integrability-3 / F-availability-3 / F-performance-1 (P2)** — `listSNsByProcesso` lê só a página 1
  (`pageSize=50`), ignora `count`. Mesmo foot-gun que `listCondPgtoPessoa` corrigiu (2026-08-03). p99 de SN/processo
  estimado ≤ 30, então margem fina — paginar por `count` ou logar cap-hit.
- **F-security-2 / F-deployability-2 / F-performance-3 (P2)** — GET `/processos/:priCod/sns` sem
  `heavyRouteLimiter` (contraste com o POST). Cliques em cadeia batem `com299/list` sem freio; também é
  amplificador de reconnaissance. Adicionar rate-limit ao READ.
- **F-modifiability-3 (P2)** — trocar `snSelecionadaDocCod?: number` por um `AlocacaoIntent` (discriminated union)
  atravessando as camadas, eliminando o spread condicional replicado ("ADR-0027") em 5 arquivos.
- **F-modifiability-4 (P2)** — extrair helpers do handler POST (`carregarTransacaoOu422`, `resolverAcessoOu403`);
  o try/catch de `FilialForbiddenError` está copiado ~5x na rota.
- **F-security-4 (P2)** — categoria de log dedicada (`SECURITY_WARN`) para "SN selecionada sem título/posse".
- **F-testability-1/2 (P2)** — teste combinando `snSelecionadaDocCod` + ledger pré-existente (precedência `??`);
  teste-guarda de que o FE NÃO valida `valor` contra `sn.solicitado` (ADR-0027 D4: enforcement no título).

## Regis-Review P3 (nice-to-have)

- **F-deployability-1 (P3)** — flag `snReutilizada` em log/ledger p/ métrica de adoção pós-deploy.
- **F-deployability-3 (P3)** — sem feature-flag específica do ramo (só `RECEBIMENTOS_ENABLED` da frente inteira).
- **F-availability-4 (P3)** — sem telemetria (latência/rows/erro) no novo read path.
- **F-performance-4 (P3)** — cache de SN é por-sessão-de-modal (cache-hit inter-modal 0%).
- **F-integrability-5/6 (P3)** — `count`/`truncated` não chegam ao FE; DTO duplicado BE↔FE.
- **F-modifiability-2/5 (P3)** — extrair `useRemoteResource<T>()` p/ os 3 effects de fetch; golden-tests do
  invariante "SN selecionada nunca é regenerada nem re-finalizada" no `etapaSn`.
- **DesignSystemReviewer (P3)** — containers de skeleton sem `role="status"` (loading anunciado); opacidade
  `border-*/40` é Tailwind padrão já usada em `status-badges.tsx` (OK, sem ação).
- **F-testability-3/4 (P3)** — contrato do helper `fetchSNsDoProcesso`; decidir/testar paginação.
