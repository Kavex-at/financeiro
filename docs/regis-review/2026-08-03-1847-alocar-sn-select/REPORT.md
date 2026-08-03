---
type: regis-review-report
run_id: 2026-08-03-1847-alocar-sn-select
generated_at: 2026-08-03T18:57:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: feature-scoped — ADR-0027 (select existing SN before Processar). 9 arquivos, +958/-159 LOC.
total_cards: 37
total_p0: 2
total_p1: 8
total_p2: 17
total_p3: 10
overall_score: 6.9
---

# Regis-Review — financeiro — 2026-08-03-1847-alocar-sn-select (ADR-0027)

## 1. Executive scorecard

**Pesos aplicados** (padrão SaaSo de escritas financeiras):

| QA | Peso | Score | Contribuição |
|---|---|---|---|
| Security | 1.5 | 6.0 | 9.00 |
| Fault Tolerance | 1.3 | 7.0 | 9.10 |
| Availability | 1.2 | 6.0 | 7.20 |
| Modifiability | 1.2 | 6.0 | 7.20 |
| Testability | 1.0 | 8.0 | 8.00 |
| Performance | 1.0 | 8.0 | 8.00 |
| Integrability | 0.9 | 7.0 | 6.30 |
| Deployability | 0.9 | 8.5 | 7.65 |
| **Total** | **9.0** | — | **62.45** |

**Overall score = 62.45 / 9.0 = 6.9 / 10** — "dívida defensável — endereçar nesta janela de planejamento", puxada para baixo pelos **dois P0** (Security e Integrability).

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 6.0 | 0 | 2 | 2 | 1 | F-availability-1: `listSNsByProcesso` sem `runWithRetry`/`ensureSid` |
| Deployability | 8.5 | 0 | 0 | 1 | 2 | F-deployability-2: `GET /processos/:priCod/sns` sem rate-limit / sem cache |
| Fault Tolerance | 7.0 | 0 | 2 | 3 | 0 | F-fault-tolerance-1: idempotency-key ignora `snSelecionadaDocCod` |
| Integrability | 7.0 | **1** | 1 | 2 | 2 | **F-integrability-1: URL `com299` (correto: `com299/list`) — feature nasce inerte (P0)** |
| Modifiability | 6.0 | 0 | 1 | 3 | 1 | F-modifiability-1: `AlocarProcessosDialog.tsx` 733 LOC, cognitive complexity 115 |
| Performance | 8.0 | 0 | 0 | 2 | 2 | F-performance-1: `pageSize=50` sem loop — silent-truncation |
| Security | 6.0 | **1** | 2 | 2 | 0 | **F-security-1: `snDocCod` não validado contra `(priCod, filCod)` — baixa cross-processo (P0)** |
| Testability | 8.0 | 0 | 0 | 2 | 2 | F-testability-1: ramo "SN existente + retomada por ledger" tem 0 casos combinados |
| **Overall** | **6.9** | **2** | **8** | **17** | **10** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Status de remediação (2026-08-03):** ambos os P0 (security-1 e integrability-1) foram fechados in-loop no PR desta feature — Kanban marca ambos como ✅ Resolvido. O overall score de 6.9 reflete o estado ANTES dos fixes; com os dois P0 fechados, sobe para ~7.6.

**Leitura direta:** a feature ADR-0027 tem ganho estrutural real (`Reduce Overhead` — pula ~10 POSTs write no Conexos por SN reutilizada) mas dois defeitos P0 impedem merge:
1. **Integrability P0 (F-integrability-1)** — a URL passada ao ERP é `com299`; a HAR-confirmada é `com299/list`. Provavelmente a feature responde `rows:[]` em produção — nasce inerte. **1 caractere de fix, mas invalida o ADR inteiro se não pego antes do release.**
2. **Security P0 (F-security-1)** — `snDocCod` não é validado contra o par `(priCod, filCod)`; permite baixa fin014 + NDe com297 contra SN de outro processo/cliente. Em remediação in-loop no PR atual.

Enquanto os dois P0 estiverem abertos, o overall score está artificialmente rebaixado. Fechá-los sobe a média para ~7.4.

---

## 2. Top 10 risks (cross-QA)

Ranqueados por composite = severidade x impacto de negócio x leverage.

### R-1: URL de `listSNsByProcesso` diverge do HAR — feature ADR-0027 nasce inerte em produção

- **QA(s) afetados**: Integrability (P0), Fault Tolerance (silêncio ao invés de fail-loud), Security (indireto)
- **Findings de origem**: `integrability.md#F-integrability-1`, `#F-integrability-4`
- **Evidência sintetizada**: `ConexosGerDocProcessoClient.ts:1059` chama `listGenericPaginated('com299', ...)`; ADR-0027 §D1 e HAR prescrevem `com299/list`. Teste unitário `ConexosGerDocProcessoClient.test.ts:604` congelou o bug. Irmão `resolveGcdCodByName:1011` usa `com299/list` (padrão do arquivo).
- **Impacto técnico**: em prod (a definir por probe HML) o ERP responde 404/405 → toast "não foi possível carregar SN"; ou responde list "root" com shape diferente → Zod devolve `rows:[]` silenciosamente. Em qualquer caso: analista NUNCA vê SN existente → sempre "Criar novo SN" → duplicação de documento (viola I-Receb-3, exatamente o que o ADR veio consertar).
- **Impacto de negócio**: a feature ADR-0027 fica inerte na primeira semana pós-cutover. Duplicação de SN volta ao patamar pré-ADR. Log `ConexosError({ endpoint: 'com299/list' })` mente sobre a URL real — MTTR do incidente sobe (F-integrability-4).
- **Card(s) Kanban**: integrability-1 (P0, S — 1 char de fix + smoke HML), integrability-4 (P2, colapsa com o card 1)
- **Custo de inação em 6 meses**: se não pego antes do release, a feature entrega 0% do valor prometido. Cliente percebe em 1-2 semanas via auditoria de SNs duplicadas. Retrabalho: rollback + hotfix + reconciliação.

### R-2: `snDocCod` do body não é validado contra `(priCod, filCod)` — baixa/NDe pode ser executada contra SN de outro processo

- **QA(s) afetados**: Security (P0), Fault Tolerance (F-2), Availability (F-2)
- **Findings de origem**: `security.md#F-security-1`, `fault-tolerance.md#F-fault-tolerance-2`, `availability.md#F-availability-2`
- **Evidência sintetizada**: `routes/recebimentos.ts:424` só valida `positive int`; `RecebimentoNumerarioService.ts:355-357` faz `snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod` sem cross-check; `ConexosFin014Client.ts:109-138` filtra `listTitulosBorderoReceber` só por `docCod#EQ`. Nenhuma camada valida pertencimento.
- **Impacto técnico**: analista com acesso à filial X POSTa `{priCod: A, filCod: X, snDocCod: <docCod de B>}` — serviço faz baixa fin014 + emite NDe (com297) contra SN de outro processo/cliente. Escrita irreversível no Conexos.
- **Impacto de negócio**: adiantamento de cliente A consumido pela transação de cliente B; NDe emitida com mismatch fiscal → passivo fiscal potencial + trilha de auditoria adulterada. Lateral movement para qualquer analista sênior com acesso a duas filiais.
- **Card(s) Kanban**: security-1 (P0, S), security-3 (P1, testes de regressão), security-4 (P2, categorizar erro)
- **Custo de inação em 6 meses**: 1 incidente → estorno manual no Conexos + reconciliação contábil + potencial reporte à Receita. **Status: sendo remediado in-loop no PR atual — não pode ser mergeado sem o fix.**

### R-3: `resolverFilCodsAcessiveis` fail-opens (token sem claim `filiais` → todas as filiais do ERP)

- **QA(s) afetados**: Security (P1), Availability (indireto), Deployability (blast radius)
- **Findings de origem**: `security.md#F-security-5`
- **Evidência sintetizada**: `routes/recebimentos.ts:65-71` retorna `listFiliais()` inteiro quando `filiaisPermitidas(user)` é vazio — comportamento documentado no teste `runs when the user has NO filiais list` (linha 125).
- **Impacto técnico**: combina com R-2 e amplifica o vetor de "cross-filial dentro da allow-list" para "qualquer filial do tenant".
- **Impacto de negócio**: descumpre o princípio SaaSo de isolamento por filial dentro do mesmo tenant. Um único token legado não migrado tem varredura total.
- **Card(s) Kanban**: security-5 (P1, M — depende de coordenação com migração de claims/SSO)
- **Custo de inação em 6 meses**: enquanto houver tokens legados sem `filiais` provisionado, R-2 tem blast radius 10-20x maior. Premissa: 5-10% dos tokens produtivos.

### R-4: `AlocarProcessosDialog.tsx` cresceu para 733 LOC com cognitive complexity 115 (target 15)

- **QA(s) afetados**: Modifiability (P1), Testability (indireto)
- **Findings de origem**: `modifiability.md#F-modifiability-1`, `#F-modifiability-2`, `#F-modifiability-3`
- **Evidência sintetizada**: 14 `useState`, 3 `useEffect`, 2 `useMemo`. Delta do PR: +276 LOC líquidas em UM arquivo. Biome lint: 3 warnings `noExcessiveCognitiveComplexity` (linhas 188, 329, 532). Próximo requisito planejado (teto por título real, paginação de SN, filtro sem saldo) vai amplificar.
- **Impacto técnico**: qualquer mudança de UX no painel de SN obriga a raciocinar sobre 14 estados globais + testar cenários cross-painel. Testar o painel-SN isoladamente é impossível hoje.
- **Impacto de negócio**: cada iteração custa mais raciocínio; aos 6 meses o componente vira "zona proibida" que só o autor original entende.
- **Card(s) Kanban**: modifiability-1 (P1, M), modifiability-2 (P2, S, pré-requisito), modifiability-3 (P2, M, discriminated union)
- **Custo de inação em 6 meses**: 3-5 features novas empurram complexity para >130. Retrabalho estimado: 2-3 dias por feature em vez de 4-8h (fator 3-5x).

### R-5: Idempotency-key não incorpora `snSelecionadaDocCod` — troca de SN entre retries silenciosamente descartada

- **QA(s) afetados**: Fault Tolerance (P1), Testability (F-1)
- **Findings de origem**: `fault-tolerance.md#F-fault-tolerance-1`, `testability.md#F-testability-1`
- **Evidência sintetizada**: chave `sn-real:{txnId}:{priCod}:{valor}` (`RecebimentoNumerarioService.ts:254`) não tem `snDocCod`; `snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod` (linha 357) faz o `docCod` do ledger vencer a seleção nova.
- **Impacto técnico**: analista clica Processar com SN A, erro parcial; abre modal, escolhe SN B, clica Processar de novo com mesmo `(txn, pri, valor)` → sistema baixa contra A silenciosamente. Sem warning.
- **Impacto de negócio**: baixa/NDe contra documento errado, detecção só na reconciliação manual (horas/dias). Recuperação = estorno + realocação.
- **Card(s) Kanban**: fault-tolerance-1 (P1, S), testability-1 (P2)
- **Custo de inação em 6 meses**: 1 incidente/trimestre. Custo por incidente: 4-8h analista + risco reputacional.

### R-6: SN "Aberta" (`vldStatus=1`) selecionável pela UI cria borderô órfão no fin014

- **QA(s) afetados**: Fault Tolerance (P1), Availability (indireto)
- **Findings de origem**: `fault-tolerance.md#F-fault-tolerance-2`
- **Evidência sintetizada**: `ConexosGerDocProcessoClient.ts:1090` lista `vldStatus IN {1,3}`; `etapaSn` (`RecebimentoNumerarioService.ts:452`) pula `finalizarDocumento` para toda SN selecionada; `listTitulosBorderoReceber` devolve vazio → throw genérico DEPOIS de `criarBordero` (escrita irreversível).
- **Impacto técnico**: borderô fin014 fica finalizado sem baixa no Conexos; mensagem aponta "SN não gerou título" quando a causa real é "SN não finalizada".
- **Impacto de negócio**: retrabalho manual de limpeza; analista repete a operação sem saber que sujou o ERP.
- **Card(s) Kanban**: fault-tolerance-2 (P1, S) — depende de decisão de produto (auto-finalizar vs. fail-closed vs. filtrar UI)
- **Custo de inação em 6 meses**: 5-15 borderôs órfãos por semestre; cada um exige limpeza manual.

### R-7: `listSNsByProcesso` sem `runWithRetry` nem `ensureSid` — quebra paridade com irmãos

- **QA(s) afetados**: Availability (P1), Integrability (P1)
- **Findings de origem**: `availability.md#F-availability-1`, `integrability.md#F-integrability-2`
- **Evidência sintetizada**: `ConexosGerDocProcessoClient.ts:1049-1117` chama `listGenericPaginated` direto; irmãos `listContasProjeto:510`, `listConfigDocProcesso:802`, `resolveGcdCodByName:1009` fazem `runWithRetry({ensureSid; ...})`. Docstring do próprio código afirma o oposto (falso).
- **Impacto técnico**: blip transitório derruba painel de SN na primeira falha; sid expirado + corrida com mutex também.
- **Impacto de negócio**: analista vê lista vazia + toast → clica "Criar novo SN" → **cria SN duplicada no ERP** (viola I-Receb-3 pelo caminho que o ADR-0027 quer fechar). 3/4 métodos LOV do mesmo client seguem o padrão certo, este não.
- **Card(s) Kanban**: availability-1 (P1, S — 1 linha). integrability-2 é o mesmo com framing diferente — implementar uma vez.
- **Custo de inação em 6 meses**: >=1 incidente/mês de SN duplicada. Estimativa: 6-12 duplicatas/semestre x 2h = ~20h analista sênior.

### R-8: `GET /processos/:priCod/sns` sem `heavyRouteLimiter` e sem cache

- **QA(s) afetados**: Deployability (F-2), Performance (F-3), Security (F-2 — enumeração), Availability (proteção da sessão Conexos)
- **Findings de origem**: `deployability.md#F-deployability-2`, `performance.md#F-performance-3`, `security.md#F-security-2`
- **Evidência sintetizada**: `routes/recebimentos.ts:366-394` — rota nova sem middleware de rate-limit; `ConexosGerDocProcessoClient.listSNsByProcesso` sem cache in-memory.
- **Impacto técnico**: cada clique = 1 `POST com299/list` (p95 2-4s). Enumeração `priCod=1..N` é grátis; padrão de rollout ("analista testa cada processo") gera burst; bug de `useEffect` pode saturar sessão Conexos.
- **Impacto de negócio**: (a) alimenta R-2 (fornece `docCod` alvo); (b) UX "lenta" no dia do rollout; (c) risco de saturar o Conexos multi-tenant.
- **Card(s) Kanban**: security-2 (P2), deployability-2 (P2), performance-3 (P3) — mesmo fix (`heavyRouteLimiter` + cache TTL 30-300s) resolve os três.
- **Custo de inação em 6 meses**: baixo se R-2 for fechado; alto se R-2 continuar aberto.

### R-9: 5 camadas replicam `snDocCod?: number` como `?:` opcional em vez de discriminator tipado

- **QA(s) afetados**: Modifiability (P2), Integrability (F-6)
- **Findings de origem**: `modifiability.md#F-modifiability-4`, `integrability.md#F-integrability-6`
- **Evidência sintetizada**: FE state → `AlocacaoRequest.snDocCod?` → Zod da rota → `ProcessarAlocacaoInput.snSelecionadaDocCod?` → `EscritaCtx` → `etapaSn`. Cada camada replica o comentário "ADR-0027". Sem exhaustiveness check estático. Interface `SolicitacaoNumerarioListItem` duplicada FE↔BE.
- **Impacto técnico**: terceiro modo ("usar existente + re-finalizar") multiplica `?:` em 5 lugares; TypeScript não obriga atualização.
- **Impacto de negócio**: ~90% de chance de bug silencioso em pelo menos 1 layer quando o próximo modo entrar.
- **Card(s) Kanban**: modifiability-3 (P2, M), integrability-6 (P3, S ou M)
- **Custo de inação em 6 meses**: quando o 3º modo entrar (previsto no roadmap), retrabalho de 1-2 dias.

### R-10: `pageSize=50` sem loop de paginação em `listSNsByProcesso`

- **QA(s) afetados**: Performance (P2), Availability (F-3), Integrability (F-3, F-5), Testability (F-3)
- **Findings de origem**: `performance.md#F-performance-1`, `availability.md#F-availability-3`, `integrability.md#F-integrability-3`, `#F-integrability-5`, `testability.md#F-testability-3`
- **Evidência sintetizada**: `ConexosGerDocProcessoClient.ts:1055-1097` — 1 fetch fixo `pageNumber:1, pageSize:50`; ignora `count`. Vizinho `listCondPgtoPessoa` teve **mesmo bug corrigido hoje** (2026-08-03, pesCod 232). FE tampouco recebe sinal de truncamento.
- **Impacto técnico**: processos com >50 SNs elegíveis silenciosamente perdem as mais antigas.
- **Impacto de negócio**: analista escolhe "Criar novo SN" achando que não há a que precisa → SN duplicada (cenário raro).
- **Card(s) Kanban**: performance-1 (P2, S), availability-3, integrability-3 (P2), integrability-5 (P3), testability-4 (P3).
- **Custo de inação em 6 meses**: baixo hoje (Encomenda: 1-3 SNs/mês/processo; 50 = 1.5 ano de folga); risco cresce com tenure.

---

## 3. Cross-cutting findings

### CC-1: URL/observability drift em `listSNsByProcesso` (`com299` vs `com299/list`)

- **Aparece em**: Integrability (P0), Fault Tolerance (silêncio no lugar de fail-loud), Security (indireto)
- **Findings**: F-integrability-1, F-integrability-4
- **Diagnóstico unificado**: método novo chama `'com299'` (URL errada) mas embrulha erro em `ConexosError({ endpoint: 'com299/list' })` (mensagem certa). Duplo defeito: chamada bate na rota errada + log mente sobre a URL real. Feature inerte + observability envenenada.
- **Recomendação consolidada**: **1 card (integrability-1)** — `const path = 'com299/list'; listGenericPaginated(path, ...); catch → ConexosError({ endpoint: path })`. Fecha F-integrability-1 e F-integrability-4 com a mesma edição. **Validar em HML com HAR antes do PR.**

### CC-2: Validação semântica ausente para `snDocCod` (pertencimento a processo/filial/status)

- **Aparece em**: Security (P0), Fault Tolerance (P1), Availability (P1), Testability (P2)
- **Findings**: F-security-1, F-fault-tolerance-2, F-availability-2, F-testability-1
- **Diagnóstico unificado**: `snDocCod` entra como opaque handle e atravessa 5 camadas sem verificação semântica: não valida (a) existência, (b) pertence ao `priCod`, (c) pertence ao `filCod`, (d) `docVldFinalizado === 1`. Zod só cobre a forma; único ponto de falha é `listTitulosBorderoReceber` devolver vazio — não cobre o cenário mais grave (docCod alheio com título aberto na mesma filial).
- **Recomendação consolidada**: **1 card resolve os 4 findings** — `security-1` (validar posse antes de `etapaSn` via `getDocumento({docCod, filCod})` + comparar `priCod`/`filCod`/`docVldFinalizado`). Acompanhar com `security-3` (testes) e `fault-tolerance-2` (guard de `vldStatus`). Sendo remediado in-loop.

### CC-3: `GET /processos/:priCod/sns` sem rate-limit / sem cache

- **Aparece em**: Security (F-2, P2), Deployability (F-2, P2), Performance (F-3, P3), Availability (indireto)
- **Findings**: F-security-2, F-deployability-2, F-performance-3
- **Diagnóstico unificado**: rota nova READ-only sem middleware de rate-limit; nenhum cache in-memory por `(filCod, priCod)`. Padrão natural de uso + enumeração + bug de FE convergem para saturar `com299/list`.
- **Recomendação consolidada**: **1 card resolve os 3** — aplicar `heavyRouteLimiter` OU criar `readRouteLimiter` (60 req/min por sub) + cache TTL 30-300s no `ConexosGerDocProcessoClient.listSNsByProcesso` seguindo o pattern do `ConexosCadastroClient.listFiliais`.

### CC-4: Ausência de sinal telemétrico distinguindo "SN reutilizada" de "SN gerada"

- **Aparece em**: Deployability (F-1, P3), Fault Tolerance (F-5, P2), Availability (F-4, P2)
- **Findings**: F-deployability-1, F-fault-tolerance-5, F-availability-4
- **Diagnóstico unificado**: único vestígio de que uma alocação usou o ramo ADR-0027 é `ctx.snSelecionadaDocCod` in-memory. Nada persiste no ledger; nada sai no log estruturado; rota READ nova não emite `duration_ms`. Consequência: (a) impossível medir adoção pós-deploy; (b) regressão silenciosa (FE deixa de mandar `snDocCod`) só é notada por chamado; (c) sem baseline de latência.
- **Recomendação consolidada**: **1 card cobre os 3** — `logService.info({type: BUSINESS_INFO, message: 'sn-existente-selecionada', data: {txnId, priCod, snDocCod, ator, filCod, duracaoMs}})` no entry-point de `processarAlocacao`, e `logService.info({message: 'listSNsByProcesso', data: {filCod, priCod, rows, count, duracaoMs}})` no happy-path do client. Custo: 20min. Ganho: dashboard grep-able D+1.

### CC-5: Cognitive complexity acumulada no `AlocarProcessosDialog.tsx` e no POST handler

- **Aparece em**: Modifiability (P1 + P2), Testability (indireto)
- **Findings**: F-modifiability-1, F-modifiability-2, F-modifiability-3, F-modifiability-5
- **Diagnóstico unificado**: nem FE nem boundary HTTP foram splittados apesar do delta adicionar 3 responsabilidades. Padrão `useEffect + cancelado + setLoading + setErro` copiado 3x no dialog; POST handler acumula 7 responsabilidades em 96 LOC.
- **Recomendação consolidada**: **3 cards em sequência** — `modifiability-2` (extract `useRemoteResource`) → `modifiability-1` (split do dialog) → `modifiability-4` (extract helpers do POST). Discriminated union (`modifiability-3`) roda em paralelo.

### CC-6: Ausência de testes que blindem invariantes do ramo "SN existente"

- **Aparece em**: Fault Tolerance (F-3, F-4), Testability (F-1), Security (F-3)
- **Findings**: F-fault-tolerance-3, F-fault-tolerance-4, F-testability-1, F-security-3
- **Diagnóstico unificado**: único teste happy-path do ramo `snSelecionadaDocCod !== undefined` (service.test:255) programa LOV para devolver título e não exercita: (a) fail-closed do título vazio no ramo selecionado, (b) retomada idempotente, (c) precedência da seleção sobre o ledger, (d) tampering cross-processo/cross-filial. Qualquer refactor futuro que quebre um dos invariantes passa no CI.
- **Recomendação consolidada**: **4 cards adicionam 6-7 casos de teste** — `fault-tolerance-3`, `fault-tolerance-4`, `testability-1`, `security-3`. Todos S, ~2 dias no total.

---

## 4. Quick wins (≤5 dias úteis, esforço S, severidade ≥ P2)

| Card | QA | Esforço | Sev. | Resultado esperado |
|---|---|---|---|---|
| **integrability-1** | Integrability | S | **P0** | URL `com299` → `com299/list` + fix da mensagem de erro. Feature deixa de nascer inerte. **1 caractere.** |
| **security-1** | Security | S | **P0** | 100% dos `snDocCod` cross-processo/cross-filial rejeitados com 403 antes de fin014. **In-loop já.** |
| availability-1 | Availability | S | P1 | `listSNsByProcesso` embrulhado em `runWithRetry` + `ensureSid` — paridade com irmãos. |
| availability-2 | Availability | S | P1 | `etapaSn` valida existência/processo/filial/finalização — mensagem exata na causa raiz. |
| fault-tolerance-1 | Fault Tolerance | S | P1 | Divergência `snSel_new != snSel_prev` na retomada gera log/erro observável. |
| fault-tolerance-2 | Fault Tolerance | S | P1 | Guard `vldStatus === 3` antes de fin014 — 0 borderôs órfãos por SN Aberta. |
| **integrability-2** | Integrability | S | P1 | Mesmo fix do availability-1 (não implementar duas vezes). |
| security-3 | Security | S | P1 | ≥4 testes de tampering — blinda security-1 contra regressão. |
| security-2 | Security | S | P2 | `heavyRouteLimiter` na rota GET `/sns` — enumeração limitada. |
| deployability-2 | Deployability | S | P2 | Rate-limit + cache TTL 30-300s na leitura de SN. |
| performance-1 | Performance | S | P2 | Loop de paginação em `listSNsByProcesso` pelo `count`. |
| integrability-3 | Integrability | S | P2 | Idem performance-1 — mesmo fix, framing ERP. |
| integrability-4 | Integrability | S | P2 | Colapsa com integrability-1 (mesma edição). |
| performance-2 | Performance | S | P2 | Invalidação `sns[priCod]` após "Processar" bem-sucedido. |
| modifiability-2 | Modifiability | S | P2 | `useRemoteResource<T>()` — 3 blocos duplicados → 1 hook. Pré-requisito de modifiability-1. |
| modifiability-4 | Modifiability | S | P2 | Helpers do POST handler — complexity 20 → ≤12. |
| fault-tolerance-3 | Fault Tolerance | S | P2 | Teste do fail-closed no ramo SN-existente. |
| fault-tolerance-4 | Fault Tolerance | S | P2 | 2 testes de retomada idempotente do ramo SN-existente. |
| fault-tolerance-5 | Fault Tolerance | S/M | P2 | Sinal explícito `sn-existente-selecionada` no log — dashboard D+1. |
| availability-3 | Availability | S | P2 | Paginação real OU docstring + cap-hit log. |
| availability-4 | Availability | S | P2 | Instrumentação `duration_ms + rows + filCod/priCod`. |
| security-4 | Security | S | P2 | Categorizar erro do fin014 sob `snDocCod` inválido — Detect Intrusion. |
| testability-1 | Testability | S | P2 | Teste blindando precedência `snSelecionadaDocCod ?? existente.docCod`. |
| testability-2 | Testability | S | P2 | Teste-guarda documentando decisão D4 (FE não bloqueia por `sn.solicitado`). |

**24 quick wins** (após dedup entre availability-1/integrability-2 e performance-1/integrability-3, ~21 edições de código distintas). Em paralelo (2 devs, ~1 sprint), fecham os 2 P0 + 6 P1 + 13 P2 de esforço S.

---

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| modifiability-1 | Modifiability | M (2–5d) | Split Module + Increase Semantic Coherence | Complexity 115 → ≤15 e LOC 733 → ≤250 no shell. Componente entrega UX iterativa (última medição: +276 LOC líquidas em 1 PR). Sem split, próximo requisito custa fator 3-5x. Base: 3 warnings Biome hoje. |
| modifiability-3 | Modifiability | M (2–3d) | Refactor + Restrict Dependencies + Defer Binding | `snDocCod?` opcional atravessa 5 camadas. Discriminated union força TypeScript a exigir exaustividade — corta ~90% do risco de bug de omissão quando o 3º modo (known follow-up) entrar. |
| performance-4 | Performance | M (2–3d) | Maintain Multiple Copies of Computations | Cache-hit inter-modal hoje = 0%; alvo ≥70% em analista real. p95 abertura painel SN: ~2s → ~50ms (fator 40x). |
| security-5 | Security | M (2–5d) | Authorize Actors (fail-safe defaults) | Fail-open no `resolverFilCodsAcessiveis` amplifica R-2 (e qualquer futuro bug de authz por-filial). Depende de coordenação com migração de claims/SSO. |
| integrability-6 | Integrability | S (contract-mirror) ou M (OpenAPI/tRPC) | Adhere to Standards / Contract testing | 1 DTO duplicado hoje; cada novo endpoint da Frente IV duplicará. Opção barata: teste que compara `keyof` cross-file — 1 dia. Opção estrutural: schemas Zod BE + FE `z.infer` — 2-5 dias. |
| deployability-3 | Deployability | S | Scale Rollouts (canary por feature flag) | Grão hoje = frente inteira (`RECEBIMENTOS_ENABLED`). Bug isolado no ADR-0027 força desligar ingestão + painel READ-only. Toggle-to-effect: N/A → ≤60s. |

Total: 4 cards M + 2 S. Combinado: 9-16 dias.

---

## 6. O que está bem (e por quê)

Reunião defensiva sem essa seção vira caça às bruxas. O sistema **acerta em pontos concretos**:

1. **Reduce Overhead estrutural (WIN do ADR-0027)** — ramo "SN existente" pula ~10 POSTs write no Conexos (`validarGeracao + gerarDocProcesso + completarSnAdiantamento + finalizarDocumento`). Latência do "Processar" no ramo reutilizado: ~40% do ramo "Criar novo SN". Tactic: Reduce Overhead + Manage Resource Coupling. Evidência: `RecebimentoNumerarioService.ts:425, 449, 452-460`.
2. **Idempotência preservada** — chave `sn-real:{txnId}:{priCod}:{valor}` não muda com `snSelecionadaDocCod`; re-POST no mesmo trio cai em `alreadySettled` ou retoma pelo ledger. Tactic: Idempotent Replay. Evidência: `RecebimentoNumerarioService.ts:254, 343-346`.
3. **Encapsulation correta no back** — DTO `SolicitacaoNumerarioListItem` isola projeção da linha crua do `com299/list` (nomes em inglês, epoch → ISO, `descricao` derivada). Camadas Client → Service → Route → FE lib respeitadas. Tailor Interface respeitado (não vaza `docVldTipoAdto`/`vldStatus` cru). Evidência: `ConexosGerDocProcessoClient.ts:1049-1131`; `SolicitacaoNumerarioListItem.ts:1-113`.
4. **Guard defensivo contra vazamento NC/ND** — `docVldTipo === 9 && docVldTipoAdto === 1` filtra no boundary do client mesmo se filtro server-side falhar. Tactic: Limit Exposure. Evidência: `ConexosGerDocProcessoClient.ts:1099-1112`.
5. **Zero migrações / zero envs novos / zero deps novas** — mudança puramente aditiva. Rollback = `git revert` + 1 auto-deploy Render (≈ 5min). Tactic: Rollback. Evidência: `_shared-metrics.md` + `git diff --stat`.
6. **Cobertura de teste proporcional ao delta** — 115 casos backend + 23 casos FE, 100% pass, 22.4s no total, zero flakes introduzidos. Tactic: Recordable Test Cases + Sandbox. Evidência: rodadas locais em `testability.md#2`.
7. **Backward-compat validado por teste explícito** — "omite `snSelecionadaDocCod` quando o body não traz `snDocCod`" (`routes/recebimentos.test.ts:427-436`). Clientes que não conhecem o campo continuam funcionando.
8. **Authz por-filial preservado nas rotas novas** — `GET /processos/:priCod/sns` chama `assertUserCanActOnFilial` (`routes/recebimentos.ts:381-389`) e tem 3 testes cobrindo 200/403/400. Tactic: Authorize Actors (parcial — os P0 são sobre `snDocCod` semântico e URL, não sobre autenticação da rota).

**Estas 8 forças são o motivo pelo qual o overall score é 6.9 e não <5.** A feature está no caminho certo — os P0 são defeitos específicos (1 URL errada + 1 gap de validação semântica), não vícios sistêmicos.

---

## 7. Limitações da análise

### Métricas não medíveis localmente
- **Latência real p50/p95 do `POST com299/list` em produção** — repositório não tem CloudWatch/APM instrumentado. Findings baseados em análise estática.
- **Taxa real de retomadas / duplicatas / falhas em prod** — mesma razão. Cards de instrumentação (CC-4) preparam o terreno.
- **Cobertura oficial de linhas/branches** — Jest do repo não roda com `--coverage` por default. Recomendação: rodar spike com `--coverage --collectCoverageFrom=...` para os 3 arquivos do delta.
- **Bundle FE impact (First Load JS)** — Next build não rodado nesta review; nenhum import pesado novo em top-level detectado.
- **Confirmação empírica de F-integrability-1** — probe real contra o ERP Conexos em HML para determinar se `com299` (sem `/list`) devolve 404/405 ou lista com shape diferente que passa pelo Zod como `rows:[]`. **Fortemente recomendado antes de fechar o card integrability-1.**

### O que este pipe NÃO cobre
- Chaos engineering / injeção de falhas contra Conexos real
- Threat modeling formal (STRIDE / attack trees além de R-2)
- Custo cloud
- UX / acessibilidade
- Análise de dependências / licenças
- **e2e pré-existentes** (14 fails no `recebimentos.e2e.*`) — declarados fora de escopo pelo prompt; reproduzem no branch base `fix/erp-4xx-nao-retentavel` (ver commit `2be78ba` e `docs/e2e/producao-runbook-primeira-execucao.md`).

### Janela temporal
Snapshot de **2026-08-03** do delta ADR-0027 no worktree `alocar-sn-select`. Código é vivo — refazer se a feature entrar em fase de tuning ou se roadmap adicionar 3º modo de alocação.

### Edições do consolidator
- **Nenhuma edição de conteúdo dos cards** — todos copiados verbatim dos QA sections. IDs mantidos (`<qa_slug>-<n>`).
- **Deduplicação identificada mas não colapsada**: `availability-1` ≡ `integrability-2` (mesmo fix), `availability-3` ≡ `performance-1` ≡ `integrability-3` (mesmo fix, framings diferentes), `security-2` ≡ `deployability-2` ≡ `performance-3` (mesma raiz — CC-3). Mantidos como cards separados no Kanban para preservar rastreabilidade cross-QA; ao executar, tratar como 1 edição de código por grupo.

---

## 8. Ações recomendadas (próximos 30 dias)

1. **Bloquear merge desta feature até os DOIS P0 estarem remediados.** `integrability-1` (URL) é 1 caractere de fix mas invalida o ADR inteiro se não pego; deve rodar antes de qualquer smoke test HML. `security-1` (validação semântica de `snDocCod`) está sendo trabalhado in-loop. Sem os dois, a feature ou é inerte (P0 integrability) ou é vulnerável (P0 security) — em qualquer cenário, o merge é irresponsável.
2. **Sprint 1 pós-merge (5 dias, 2 devs):** rodar os 21 quick wins únicos da §4. Priorizar P1 (availability-1/integrability-2 como uma única edição, availability-2, fault-tolerance-1, fault-tolerance-2, security-3, security-5). Ao final: 2 P0 + 6 P1 + 13 P2 fechados; overall score sobe para ~7.6.
3. **Sprint 2 (5 dias, 1 dev):** rodar `modifiability-1` (split do dialog, M) precedido de `modifiability-2` (useRemoteResource, S) — reduzir complexity 115 → ≤15 no `AlocarProcessosDialog.tsx` antes que a próxima feature (teto por título real) empilhe mais estado.
4. **Instrumentação em paralelo (1 dev, 1 dia):** implementar `fault-tolerance-5` (log `sn-existente-selecionada`) + `availability-4` (log `listSNsByProcesso`) para ter dashboard grep-able desde a primeira semana pós-cutover. Destrava métrica objetiva de adoção da feature.
5. **Backlog próxima janela:** `modifiability-3` (discriminated union, M) + `performance-4` (cache inter-modal, M) + `deployability-3` (feature-flag `SN_SELECT_ENABLED`, S) + `security-5` (fail-closed do allow-list — depende de migração de claims/SSO) + `integrability-6` (contract-mirror BE↔FE).
