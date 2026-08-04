---
type: regis-review-kanban
run_id: 2026-07-29-0243-recebimentos-sn
scope: feature-gate — gerarSolicitacaoNumerario (SN) delta on branch fix/recebimentos-alocar-sn
total: 47
counts: { p0: 0, p1: 14, p2: 24, p3: 9 }
ordering: prioridade (P0→P3), depois esforço (S < M < L < XL)
dedup_notes: 3 cards mesclados de origens múltiplas (indicados como "Contribuinte QAs")
---

# Kanban — SN (`gerarSolicitacaoNumerario`) — 2026-07-29-0243

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (nenhum) → P1 (S → M → L) → P2 → P3.
> Cards com origem em múltiplos QAs foram consolidados; a origem preservada em "Findings" cita todas as fontes.

---

## P0 — Crítico

_Nenhum card P0 identificado._ O gate passa: invariante DRY-RUN verificado (grep + teste unitário), zero caminhos de escrita ao Conexos alcançáveis.

---

## P1 — Alto

### [availability-2] FE: marcar fallback do `fetchProcessosParaTransacao`/`processarSolicitacaoNumerario` como `fonte:'fixture'` + logar

**QA**: Availability (contribuinte cross: Fault Tolerance F-6, Testability F-5)
**Tactic alvo**: Degradation + Monitor
**Esforço**: S (≤1d — dois arquivos FE + testes existentes)
**Findings**: F-availability-2, F-fault-tolerance-6, F-testability-5

**Problema**
> As duas funções do `lib/recebimentos.ts` engolem qualquer erro do backend (`catch {}`) e devolvem fixture / payload sintético construído localmente, com shape indistinguível do assinado pelo BE. O operador vê "simulação gerada" no toast mesmo quando o backend respondeu 5xx/403. O padrão já usado no `RecebimentosPainel` (`fonte:'banco'|'fixture'`) não foi replicado na modal "Alocar".

**Melhoria Proposta**
> (1) Adicionar `fonte: 'backend' | 'fallback-local'` ao retorno de `processarSolicitacaoNumerario` (e um `origem` similar para `fetchProcessosParaTransacao`). (2) Nos `catch`, `console.warn` com o status. (3) No `AlocarProcessosDialog.tsx`, quando `fonte==='fallback-local'`, mostrar um `Badge variant="warning"` + toast informativo ("Backend indisponível — payload local"). Tactic: **Degradation** (bem-implementada) + **Monitor** (restaurar sinal).

**Resultado Esperado**
> 100% das falhas de backend visíveis na UI. Operador nunca é enganado por payload sintético apresentado como se fosse "assinado" pelo backend.

**Métricas de sucesso**
- Caminhos silenciosos: 2 → 0
- Shape retornado marcando origem do fallback: 0/2 → 2/2
- Teste do FE cobrindo o caminho de fallback: adicionar 1 case por função

**Risco de não fazer**
> No dia do wire-real, o mesmo padrão fará com que uma falha real de POST ao ERP apareça como "SN dry-run gerada" — o analista assume falso sucesso. Auditoria da demo fica comprometida (payload apresentado ao cliente pode divergir do que o BE geraria).

**Dependências**: Nenhuma

---

### [deployability-1] Escrever runbook de rollback da Frente IV / SN

**QA**: Deployability
**Tactic alvo**: Manage Deployment Pipeline — Rollback
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> Existe o kill-switch (`RECEBIMENTOS_ENABLED=false` + `NotImplementedError` em `enviarAoErp`), mas nenhum runbook em `docs/runbooks/` descreve o procedimento passo-a-passo. Em um incidente, o operador precisa ler código para saber como reverter. O `fin010-write-cutover.md` já existe para a Frente I e é o modelo canônico.

**Melhoria Proposta**
> Criar `docs/runbooks/recebimentos-sn-kill-switch.md` seguindo o template do `fin010-write-cutover.md`. Documentar: (a) como flipar `RECEBIMENTOS_ENABLED=false` no Render dashboard; (b) como validar que `/recebimentos/*` responde 403 (curl + status code esperado); (c) quando redeployar commit anterior no Render vs. só desligar a flag; (d) como validar que `enviarAoErp` continua isolado (busca por `NotImplementedError` nos logs). Alvo Bass: Rollback + Configure Behavior.

**Resultado Esperado**
> Operador executa rollback em ≤ 3 min sem precisar ler código-fonte. Baseline: 0 runbooks Frente IV → 1 runbook `recebimentos-sn-kill-switch.md` referenciado no `DEPLOY.md §Rollback`.

**Métricas de sucesso**
- Runbooks Frente IV: 0 → 1
- Passos manuais fora-do-runbook para reverter SN: ~5 (leitura de código + inferência) → 0 (todos no runbook)

**Risco de não fazer**
> Em 6 meses (quando o `gcdCod` for descoberto e o seam for cabeado), um incidente de escrita indevida no Conexos vai ter MTTR alto — operador reconstruindo o path enquanto o ERP acumula lançamentos ruins.

**Dependências**: Nenhuma

---

### [integrability-1] Aceitar `ExternalCallOptions` no seam `enviarAoErp` + no `ProcessoProviderInterface`

**QA**: Integrability (contribuinte cross: Availability F-4, Performance F-1/F-2)
**Tactic alvo**: Manage Resources + Bound Execution Times
**Esforço**: S (≤1d)
**Findings**: F-integrability-1, F-availability-4, F-performance-1, F-performance-2

**Problema**
> A assinatura `enviarAoErp(_payload: GerDocProcessoSelectionDTOCab): Promise<never>` diverge dos outros ports write de Frente IV (`NexxeraGateway`, `ErpReceivablesGateway`, `NdeEmitter`), que aceitam `opts?: ExternalCallOptions` com `timeoutMs`/`signal`. O `ProcessoProviderInterface.listCandidatosParaTransacao` sofre da mesma regressão. Quando o seam for cabeado, um `await` puro sob incidente Conexos pinará o worker Express até o timeout global — reintroduzindo o cenário `LOGIN_ERROR_MAX_SESSIONS`. FE `fetchProcessosParaTransacao` também não usa `AbortController`.

**Melhoria Proposta**
> (1) Ajustar `SolicitacaoNumerarioService.enviarAoErp` para aceitar `opts?: ExternalCallOptions` (default `ERP_WRITE_TIMEOUT_MS`, `constants.ts:100`) e envolvê-lo no `RetryExecutor + timeoutMs` no futuro adapter. (2) Adicionar `opts?: ExternalCallOptions` em `ProcessoProviderInterface.listCandidatosParaTransacao`. Definir `PROCESSO_PROVIDER_TIMEOUT_MS` em `constants.ts` (default 5000ms). (3) FE: passar `signal: AbortSignal.timeout(5000)` no `apiFetch`; adicionar `AbortController` no `useEffect` do dialog com `controller.abort()` no cleanup. Tactic Bass alvo: **Manage Resources** / **Bound Execution Times**.

**Resultado Esperado**
> 4/4 ports write Frente IV com `ExternalCallOptions` (hoje 3/4). Impede regressão do incidente de sessões. FE: p95 tempo até resposta OU erro no modal: 5min (worst-case navegador) → 5s.

**Métricas de sucesso**
- Ports write Frente IV com `ExternalCallOptions`: 3/4 → 4/4
- Tempo médio de request pinando worker sob incidente Conexos: sem teto → ≤ `ERP_WRITE_TIMEOUT_MS`
- Requests órfãos após fechar o modal: N → 0

**Risco de não fazer**
> Um cabeamento futuro esquece o `timeoutMs`, reproduz `LOGIN_ERROR_MAX_SESSIONS` em 6 meses; MTTR ~4h + rollback.

**Dependências**: Nenhuma

---

### [integrability-2] Reusar Zod DTO canônico na rota e validar o payload antes do POST

**QA**: Integrability
**Tactic alvo**: Adhere to Standards
**Esforço**: S (≤1d)
**Findings**: F-integrability-2

**Problema**
> `gerDocProcessoSelectionDTOCabSchema` e `processoSchema` são exportados em `GerDocProcesso.ts:39-116` mas **nenhum** módulo do backend os importa. A rota redigita um schema inline (`recebimentos.ts:181-190`) para o mesmo shape — dois schemas convivem. `gerar()` também não valida o payload construído antes de devolver/enviar.

**Melhoria Proposta**
> (1) Trocar o inline por `processoSchema.extend({ valorTransacao: z.number() })` na rota `/solicitacao-numerario`; (2) chamar `gerDocProcessoSelectionDTOCabSchema.parse(payload)` no fim de `gerar()` — o custo é O(1) e garante que o payload dry-run já é válido para o futuro POST. Tactic Bass alvo: **Adhere to Standards / Encapsulate**. Arquivos: `routes/recebimentos.ts`, `SolicitacaoNumerarioService.ts`.

**Resultado Esperado**
> 2 schemas Zod exportados → 2 usados; 0 duplicações de shape entre rota e DTO canônico; primeira invocação de `enviarAoErp` ao vivo já sai com payload validado.

**Métricas de sucesso**
- Schemas exportados sem consumers: 2 → 0
- Boundary Zod coverage do payload SN: 0% → 100%

**Risco de não fazer**
> Primeiro POST real ao Conexos envia shape divergente; descoberta pelo erro do ERP. Custo: rodada extra HML.

**Dependências**: Nenhuma

---

### [integrability-5] Adicionar gate `SN_LIVE_WRITE_ENABLED` + `dryRun` gate no seam `enviarAoErp`

**QA**: Integrability
**Tactic alvo**: Configure Behavior
**Esforço**: S (≤1d)
**Findings**: F-integrability-5

**Problema**
> A única defesa contra um POST real com `gcdCod=0` (placeholder) é o `throw new NotImplementedError` no seam. Um patch single-line ("remover o throw") transforma o dry-run em POST inválido. O padrão `ConexosBaixaClient` (Homologação-first, citado em `conexos-com299-gerdoc.md:76-78`) usa write-enabled + dry-run gate — a Frente IV precisa herdar isso antes de cabear.

**Melhoria Proposta**
> Adicionar env flag `SN_LIVE_WRITE_ENABLED=false` (via `EnvironmentProvider`) + `dryRun: boolean` no `enviarAoErp` — recusar POST quando `!liveEnabled || dryRun || gcdCod === 0`. Tactic Bass alvo: **Configure Behavior**. Arquivos: `EnvironmentProvider`, `SolicitacaoNumerarioService.ts`, `constants.ts` (adicionar `SN_MIN_VALID_GCD_COD > 0` guard).

**Resultado Esperado**
> 0 gates → 3 gates (env flag + dryRun + placeholder-detection). Impede que uma remoção acidental de `throw` alcance produção sem passar por config explícita.

**Métricas de sucesso**
- Gates independentes protegendo POST live: 1 (throw) → 3 (throw + env flag + placeholder guard)
- Chance de POST com `gcdCod=0` após 1 patch trivial: alta → efetivamente nula

**Risco de não fazer**
> 1 PR sem revisão remove o throw e cria documento SN inválido no ERP; efeito colateral irreversível.

**Dependências**: Nenhuma

---

### [modifiability-1] Extrair `gcdCod` para env/SSM e remover placeholder duplicado

**QA**: Modifiability (contribuinte cross: Integrability, Fault Tolerance)
**Tactic alvo**: Defer Binding — configuration files
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> O `SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod = 0` está hardcoded no backend (`constants.ts:132`) e replicado no fallback do frontend (`lib/recebimentos.ts:397`). Quando o HAR de HML confirmar o valor real, o time terá que editar 2 arquivos em 2 stacks; esquecer um deles causa divergência entre preview e payload efetivo.

**Melhoria Proposta**
> Mover `gcdCod` para env (`EnvironmentProvider.solicitacaoNumerarioGcdCod`, com default `0` só em `NODE_ENV=development`). Backend passa a ler via provider; o fallback do frontend passa a receber a config via prop ou API `GET /recebimentos/config-sn` (single source). Tactic: **Defer Binding — configuration files**.

**Resultado Esperado**
> Trocar o `gcdCod` real em HML = editar 1 valor SSM/env, 0 arquivos de código. Preview FE e payload BE nunca divergem.

**Métricas de sucesso**
- Sítios de mudança para trocar `gcdCod`: 2 → 1 (ou 0 se ficar em SSM)
- Duplicação de constante entre BE/FE: 1 → 0

**Risco de não fazer**
> No dia do go-live HML, o valor real é editado no BE; o FE segue mostrando `gcdCod=0` no preview de fallback → operador aprova simulação diferente do que sobe ao ERP.

**Dependências**: HML/HAR confirmando o `gcdCod` real (Fase 2)

---

### [modifiability-2] Remover `buildDryRunFallback` do frontend (ou reduzir a "erro amigável")

**QA**: Modifiability (contribuinte cross: Integrability F-3, Fault Tolerance F-6)
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> `lib/recebimentos.ts:392-428` reconstrói localmente o payload `GerDocProcessoSelectionDTOCab` como fallback quando o BE falha. É 37 linhas espelhando o `SolicitacaoNumerarioService.gerar` (40 linhas). Qualquer mudança de shape (novo campo do com299, novo item de rateio) exige edição sincronizada em 2 repos.

**Melhoria Proposta**
> Trocar o fallback por: (a) toast de erro com `retry`, mantendo a rede de segurança de UX sem duplicar payload; ou (b) mock que devolve `{ dryRun:true, payload:null, mensagem:'BE indisponível' }` e o dialog mostra um estado de "sem preview". Tactic: **Abstract Common Services** — o builder canônico vive no service backend. Remover `buildDryRunFallback` inteiro.

**Resultado Esperado**
> 1 lugar canônico para o payload SN. Novo campo do com299 = editar apenas `SolicitacaoNumerarioService.ts`.

**Métricas de sucesso**
- LOC de `lib/recebimentos.ts`: 524 → ≤ 487
- Funções duplicando o shape do payload: 2 → 1

**Risco de não fazer**
> Bug silencioso em produção quando FE e BE divergirem — o operador vê um payload no dialog que não é o que sobe ao ERP.

**Dependências**: Nenhuma

---

### [modifiability-3] Isolar a regra "encomenda-percentuais" em pure function testável antes de resolver

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> `SolicitacaoNumerarioService.ts:60-62` usa `valorSn = valorTransacao` com dois `TODO(encomenda-percentuais)`. Quando a regra chegar, existe risco real de virar cascata de `if` dentro de `gerar()` — inflando o service para além do ceiling e misturando responsabilidades (payload builder + calculadora de percentual).

**Melhoria Proposta**
> Extrair, mesmo agora (antes da regra chegar), um `calcularValorSolicitacaoNumerario(valorTransacao, processo, config): number` como pure function em `domain/service/recebimentos/EncomendaValorCalculator.ts`. Hoje retorna `valorTransacao` (mesmo comportamento). Testar isoladamente. Quando a regra chegar, mudar 1 arquivo. Tactic: **Encapsulate** + **Increase Semantic Coherence**.

**Resultado Esperado**
> A resolução da regra de percentual mexe em 1 arquivo (`EncomendaValorCalculator.ts`) e não altera `SolicitacaoNumerarioService.gerar`.

**Métricas de sucesso**
- Arquivos alterados para implementar a fórmula de percentual: previsão de 3+ → 1
- Cobertura de teste da fórmula (isolada): 0% → 100%

**Risco de não fazer**
> Quando a regra chegar (com dependência de `processo.moeCod` para conversão, ou de tabela de percentuais por cliente), o service explode para 200+ LOC misturando I/O de payload com aritmética de negócio.

**Dependências**: Nenhuma (pode ser feito ANTES da regra chegar — é o ponto)

---

### [fault-tolerance-4] Bloquear o wire-up do `enviarAoErp` até que `encomenda-percentuais` esteja resolvida (guard-rail no código)

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking (Detect) + Substitution (Avoid)
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> O `valor` da SN é hoje `valorTransacao` cru (`TODO(encomenda-percentuais)`), com a regra 0,1% / 0,9% oficialmente **não-resolvida**. O `PayloadPreview` do modal exibe esse valor ao analista, que pode confundir "preview aprovado" com "valor final". No dia do wire-up, se o TODO ainda existir, todas as SNs saem com valor errado.

**Melhoria Proposta**
> Adicionar um guard determinístico no `SolicitacaoNumerarioService.gerar`: `throw new Error('encomenda-percentuais rule unresolved — cannot leave dry-run')` **atrás de** uma flag `ENCOMENDA_PERCENTUAIS_RESOLVED = false` em `constants.ts`. Enquanto a flag for `false`, o dry-run continua funcionando (o guard só dispara se `enviarAoErp` for cabeado em um futuro PR sem trocar a flag). No preview, adicionar rótulo `"valor bruto (regra encomenda pendente)"`.

**Resultado Esperado**
> Impossível cabear o emit real sem antes resolver a regra + flippar a flag. Métrica: `1` flag guard; `1` rótulo visível no preview; `0` risco de POST com valor cru.

**Métricas de sucesso**
- Flag guard existente: 0 → 1
- Rótulo `"valor bruto (regra pendente)"` no preview: 0 → 1

**Risco de não fazer**
> Primeira leva de SNs no live sai com valores errados; retrabalho manual pesado, dano contábil.

**Dependências**: resolução da regra pelo stakeholder (dependência externa — bloqueada por §7 Q4 do `frente-iv-recebimentos-nde-plan.md`)

---

### [security-5] Atualizar `axios` para ≥1.18.0 (backend) — fecha 3 CVE high

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-5

**Problema**
> `npm audit` no backend reporta 3 high + 2 moderate no `axios` (range `>=1.0.0 <1.18.0`) — GHSA-42h9-826w-cgv3, GHSA-xj6q-8x83-jv6g (prototype pollution auth), GHSA-pmv8-rq9r-6j72. Feature SN não usa axios diretamente (stub in-memory), mas o `BcbClient` sim e o futuro cliente Conexos (quando `enviarAoErp` for cabeado) também dependerá.

**Melhoria Proposta**
> `npm install axios@^1.18.0` (ou latest LTS) em `src/backend/`, rodar `npm audit fix`, revalidar `npm test` e `npm run typecheck`. Se o bump quebrar `BcbClient`, seguir migration guide (mudanças de tipos em interceptors).

**Resultado Esperado**
> `npm audit --json` no backend: `high: 3 → 0`.

**Métricas de sucesso**
- Backend `high` vulns: 3 → 0
- Backend `moderate` vulns: 2 → 0

**Risco de não fazer**
> Quando `enviarAoErp` for cabeado, o cliente HTTP que envia payload SN ao Conexos é uma versão CVE-vulnerable — DoS por recursion em resposta malformada do ERP derruba o worker.

**Dependências**: Nenhuma (dep herdada, não introduzida pela feature)

---

### [deployability-2] Provisionar ambiente de staging (Render + Vercel) para smoke test pré-prod

**QA**: Deployability (contribuinte cross: Testability)
**Tactic alvo**: Manage Deployment Pipeline — Test Deployment
**Esforço**: M (2–5d) — provisionar Render + Vercel + Supabase e cabear as vars
**Findings**: F-deployability-2, F-deployability-5

**Problema**
> O `ci.yml` só roda `typecheck/lint/test/build` em CI; a primeira execução real de `POST /solicitacao-numerario` (com Zod + `heavyRouteLimiter` + `requireRole('admin')` + `assertUserCanActOnFilial`) contra HTTP verdadeiro acontece em produção. Sem ambiente pré-prod, cada deploy é a "primeira execução real" da rota.

**Melhoria Proposta**
> Criar `render-staging.yaml` (serviço `financeiro-backend-staging`, branch `dev`, `plan: starter`, DB Supabase separado) + projeto Vercel staging apontando para `dev`. Adicionar job `smoke-staging` no `ci.yml` (após `backend`/`frontend`, antes do merge em `main`) que faz `curl` em `GET /health` do staging e valida version + status. Alvo Bass: Test Deployment.

**Resultado Esperado**
> 100% dos deploys em `main` passaram por staging equivalente. Baseline: 0 ambientes → 1 ambiente staging + 1 smoke job na CI. Reduz roll-forward fixes em prod.

**Métricas de sucesso**
- Ambientes pré-prod: 0 → 1
- % deploys com smoke test verde antes de prod: 0% → 100%

**Risco de não fazer**
> Cada deploy da Frente IV (e das outras frentes) continua sendo experimento em produção. Regressões de UX/API descobertas por analista financeiro real, não por CI.

**Dependências**: definir dono do custo do serviço extra Render + DB Supabase de staging.

---

### [security-4] Provisionar claim `permissions.filiais` no JWT Supabase e travar guard

**QA**: Security (contribuinte cross: Availability, Modifiability)
**Tactic alvo**: Authorize Actors
**Esforço**: M
**Findings**: F-security-4

**Problema**
> `filialAuthz.ts:45-50` é backwards-compatible: se o token não tem `filiais` claim, o guard passa (`return true`). Isso é intencional (docstring), mas em produção HOJE nenhum token traz o claim — então a defesa "cross-filial" da SN e do pipeline/run é uma promessa não-materializada. Um `admin` de SP hoje faz POST SN com `filCod: 9` (MG) e recebe 200.

**Melhoria Proposta**
> Duas frentes complementares: (1) Emitir claim `permissions.filiais: number[]` no JWT Supabase via Edge Function `on_login` (lê `app_user_filial`); (2) Mudar `filialAuthz.ts:47` para `if (permitidas === undefined) return false` (deny-by-default) ASSIM QUE todos os tokens ativos carregarem o claim (rollout coordenado). Ontology follow-up já registra em `_inbox/frente-iv-recebimentos-nde-plan.md`.

**Resultado Esperado**
> Chamada com `filCod` fora da allow-list do usuário retorna 403 em 100% dos casos. Métrica CloudWatch `RecebimentosAuthzDenied` incrementa.

**Métricas de sucesso**
- Tokens Supabase com claim `filiais`: 0% → 100%
- `userCanActOnFilial(user_sem_claim, X)`: `true` → `false` (após deny-by-default)

**Risco de não fazer**
> Quando `enviarAoErp` sair do `NotImplementedError`, um analista de SP posta SN de MG e move dinheiro real — o guard existe estruturalmente mas nunca dispara. Overlap direto com o cenário multi-tenant do Bass (blast radius).

**Dependências**: alinhamento com plataforma Supabase (custom claim setup) e com tabela `app_user_filial`.

---

### [security-6] Triagem e patching de 6 CVE high no frontend

**QA**: Security (contribuinte cross: Availability)
**Tactic alvo**: Limit Exposure
**Esforço**: M
**Findings**: F-security-6

**Problema**
> `npm audit` no frontend reporta 6 high + 1 low. Feature SN não introduz deps novas, mas monta UI money-adjacent (painel de conciliação) sobre esse baseline vulnerável.

**Melhoria Proposta**
> Rodar `cd src/frontend && npm audit --json > audit.json`, triar cada high (root cause + fix availability), aplicar `npm audit fix` onde não-breaking, abrir cards individuais para os que exigem major bump (Next.js/React ecosystem tende a exigir migration). Priorizar packages com superfície de execução (XSS, prototype pollution).

**Resultado Esperado**
> `npm audit --json` no frontend: `high: 6 → 0` (ou justificativa por CVE com risco documentado).

**Métricas de sucesso**
- Frontend `high` vulns: 6 → 0

**Risco de não fazer**
> XSS ou prototype pollution no painel money-adjacent onde analistas revisam contrapartes de PIX/TED — potencial vetor para hijack de sessão e disparo de POST SN em nome do analista quando a rotação de escrita for cabeada.

**Dependências**: audit_json disponível para triagem por-CVE

---

### [fault-tolerance-3] Modelar handle de idempotência/reconciliação wire-level (`docVldFinalizado` ou o equivalente real do com299)

**QA**: Fault Tolerance (contribuinte cross: Integrability F-4)
**Tactic alvo**: Reconcile (Recover) + Comparison (Detect)
**Esforço**: S (só docs/ontologia) — implementação vem depois com o HAR
**Findings**: F-fault-tolerance-3, F-integrability-4 (parcial)

**Problema**
> A ontologia `integrations/conexos-com299-gerdoc.md` lista 3 open-gaps (gcdCod, encomenda-percentuais, gerdoc-payload-fields) mas **não** cita um handle wire-level para reconciliar "o que a Columbia acredita ter emitido × o que o com299 mostra como emitido". Sem esse contrato, o `Idempotency-Key` local (card fault-tolerance-2) só evita re-execução do MESMO processo — não protege contra "envio duplicado por dois processos/hosts" nem permite reconciliação retroativa. Os irmãos Permutas (`business-rules/idempotencia-reconciliacao.md`) e NDe (`business-rules/idempotencia-quitacao-nde.md`) já modelam esse handle; SN não.

**Melhoria Proposta**
> Adicionar 4º open-gap na integration `conexos-com299-gerdoc.md`: `idempotencia-e-reconciliacao-wire`. Especificar como parte da captura HAR de HML: (i) qual campo/estado o com299 devolve após `gerDocProcesso` que identifica unicamente o documento criado (candidato: `docCodSeq`, `titCodSeq`, ou combinação `{filCod, priCod, gcdCod, docDtaEmissao}`); (ii) se há um flag "finalizado" (o prompt sugere `docVldFinalizado 0→1` — validar no HAR). Documentar o job de reconciliação futura (parity com `SispagRetornoService` / `PermutaReconciler`).

**Resultado Esperado**
> Contrato de reconciliação SN documentado antes do wire-up. Métrica: open-gaps da integration `3 → 4` (novo gap explicitado); business-rule `idempotencia-solicitacao-numerario.md` criado apontando para o handle real capturado.

**Métricas de sucesso**
- Menções de handle wire-level na integration: 0 → ≥1
- Business-rule dedicada: 0 → 1

**Risco de não fazer**
> Fase "sair do dry-run" fica com passo silencioso faltando; primeiro reprocess da era live pode duplicar SN por falta de reconciliação.

**Dependências**: captura HAR HML (dependência externa)

---

## P2 — Médio

### [availability-1] Traduzir `HandlerError.statusCode`/`code`/`userMessage` no `errorMiddleware`

**QA**: Availability
**Tactic alvo**: Exception Handling
**Esforço**: S (≤1d)
**Findings**: F-availability-1

**Problema**
> O `errorMiddleware` central sempre responde `HTTP 500 {error:'Internal server error'}` — mesmo para erros que implementam `HandlerError` com `statusCode` explícito (ex.: `NotImplementedError` = 501, `FilialForbiddenError` já é tratado inline). Quando o wire-real do `enviarAoErp` for cabeado, um endpoint deliberadamente desativado vai gerar ruído de 500 nos alarms.

**Melhoria Proposta**
> No `errorMiddleware.ts`, detectar `HandlerError` (via duck-typing em `code/statusCode/userMessage`) e usar `err.statusCode` + `{error: err.userMessage, code: err.code}`. Manter fallback 500 para erros genéricos. Cobrir com teste que injeta `NotImplementedError` e valida HTTP 501 + `code:'NOT_IMPLEMENTED'`. Tactic: **Exception Handling**.

**Resultado Esperado**
> Rotas continuam devolvendo 500 para exceções não-classificadas; endpoints deliberadamente desativados devolvem 501 sem falso-positivo em métricas de disponibilidade.

**Métricas de sucesso**
- `HandlerError.statusCode` traduzidos: 0% → 100%
- Teste `errorMiddleware.test.ts` cobrindo `NotImplementedError → 501`: 0 → 1

**Risco de não fazer**
> Quando o wire-real cair, alarmes de 5xx vão soar para toda tentativa de envio-antes-do-tempo, mascarando incidentes reais.

**Dependências**: nenhuma (auto-contido no `http/`)

---

### [availability-4] Wrap do `enviarAoErp` com `RetryExecutor` + `ExternalCallOptions.timeoutMs`

**QA**: Availability (contribuinte cross: Integrability, Performance — parcialmente coberto por integrability-1)
**Tactic alvo**: Retry + Timeout (via `ExternalCallOptions`)
**Esforço**: S (≤1d — padrão já cabeado nos irmãos)
**Findings**: F-availability-4

**Problema**
> O seam `enviarAoErp` hoje lança `NotImplementedError`. Quando for cabeado, precisa herdar o mesmo envelope que os outros ports Frente IV já declaram (`ExternalCallOptions`, timeouts em `constants.ts:99-105`, `RECEBIMENTO_RETRY_ATTEMPTS=3`, `RECEBIMENTO_RETRY_DELAY_MS=1000`).

**Melhoria Proposta**
> Ao implementar `enviarAoErp`: injetar `RetryExecutor` + `ConexosClient`, aceitar `opts?: ExternalCallOptions` com default `ERP_WRITE_TIMEOUT_MS = 8000`, e passar `AbortSignal` para o `axios.request`. O template já existe nos outros gateways (`ErpReceivablesGatewayInterface` em `ports.ts:193-201`). Tactic: **Retry** + timeout (Bass — Recover from Faults).

**Resultado Esperado**
> Zero requests do worker Express pinados sob incidente Conexos. Teto de latência SN = `ERP_WRITE_TIMEOUT_MS × RECEBIMENTO_RETRY_ATTEMPTS` = 24s (negociável).

**Métricas de sucesso**
- `enviarAoErp` wrap em `RetryExecutor`: 0 → 1
- `enviarAoErp` honrando `timeoutMs`: 0 → 1

**Risco de não fazer**
> Um Conexos travado durante a janela de execução das SNs pina workers e degrada as OUTRAS rotas do Express (via pool esgotado / rate-limit). Já é o incidente que `LOGIN_ERROR_MAX_SESSIONS` motivou no SISPAG.

**Dependências**: bloqueado por HML/HAR (`gcdCod` real + shape) — mesma pré-condição do wire-real.

---

### [availability-3] Adicionar idempotency namespacing na rota `POST .../solicitacao-numerario` (pré-requisito do wire-real)

**QA**: Availability (mesma raiz que fault-tolerance-2)
**Tactic alvo**: Transactions + Exception Prevention
**Esforço**: M (2–5d — precisa cabear o ledger)
**Findings**: F-availability-3 (ver também fault-tolerance-2)

**Problema**
> A rota `/pipeline/run` já monta `Idempotency-Key` como `receb:${sub}:${headerKey ?? correlationId}` (evita denial-of-execution cross-ator). A rota `POST .../solicitacao-numerario` não faz nada disso. Enquanto for dry-run, é irrelevante; no primeiro dia do wire-real de `enviarAoErp`, um duplo-clique cria SNs duplicadas no ERP.

**Melhoria Proposta**
> Herdar o padrão de `/pipeline/run:83-86`: aceitar `Idempotency-Key` header, montar chave namespaced por `sub`, e — antes de invocar `enviarAoErp` — chamar `RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN.beginExecution` + `setRequestPayload`, `markSettled/markError` nos terminais. Tactic: **Transactions** (Bass — Prevent Faults). Não precisa cabear tudo agora, mas o esqueleto (`beginExecution` retornando `alreadySettled=true` → short-circuit 200) deve entrar no delta ou no card imediatamente seguinte.

**Resultado Esperado**
> No dia do wire-real, retries/duplo-clique NUNCA geram SN duplicada no ERP. Baseline: 0 SNs duplicadas por retry.

**Métricas de sucesso**
- Rota SN com `Idempotency-Key` namespaced: 0/1 → 1/1
- Teste cobrindo idempotency `POST → POST` retornando o mesmo resultado: 0 → 1

**Risco de não fazer**
> SN duplicada no ERP = numerário duplicado. Reconciliação manual + estorno + risco de compliance financeiro.

**Dependências**: obrigatoriamente **antes** de fechar o card do Módulo 5 wire-real (`enviarAoErp`). Nota: converge com fault-tolerance-2 (mesmo cabo).

---

### [fault-tolerance-2] Aplicar `Idempotency-Key` namespaced-por-ator na rota SN antes de qualquer wire-up do emit

**QA**: Fault Tolerance (mesma raiz que availability-3 — recomenda-se fechar juntos)
**Tactic alvo**: Idempotent Replay (Recover)
**Esforço**: M
**Findings**: F-fault-tolerance-2

**Problema**
> A rota `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` não consulta `Idempotency-Key`, não cria ledger e não hash-namespaceia (ao contrário da rota irmã `POST /recebimentos/pipeline/run:84-86` que faz `receb:${ator}:${headerKey ?? correlationId}`). Em dry-run o custo é zero — dois cliques = dois logs. No dia em que `enviarAoErp` for cabeado sem antes fechar essa lacuna, dois cliques = **duas SNs criadas no ERP** (o exato anti-padrão "double-execution de financial write" do dossiê fault-tolerance).

**Melhoria Proposta**
> Portar o mesmo padrão do `pipeline/run` para a rota SN: aceitar `Idempotency-Key` do header, montar `sn:${ator}:${headerKey ?? txnId}:${priCod}`. Persistir a chave em um ledger próprio (nova tabela `solicitacao_numerario_execucao` ou reusar `recebimento_execucao` se semanticamente couber). Retornar `200` idempotente (mesmo payload) se a chave já existir. Adicionar teste "duplo-POST devolve mesmo payload / não re-loga business event duas vezes".

**Resultado Esperado**
> Rota SN idempotente antes de o gate abrir. Métrica: `0 → 1` rotas SN honrando idempotência; `1` teste de replay comprovando não-duplicação. Pré-requisito para qualquer PR que remova o `throw` do `enviarAoErp`.

**Métricas de sucesso**
- Rotas SN com idempotência: 0/1 → 1/1
- Testes de replay: 0 → 1

**Risco de não fazer**
> No primeiro dia da era live, um duplo-clique/retry de rede gera SN duplicada no Conexos; reconciliação manual pesada.

**Dependências**: fault-tolerance-1 (para amarrar o pré-requisito na business rule)

---

### [fault-tolerance-5] Persistir rastro do "Processar" em ledger (mesmo em dry-run) — fonte da fila de exceção do analista

**QA**: Fault Tolerance (contribuinte cross: Security F-3)
**Tactic alvo**: Condition Monitoring (Detect)
**Esforço**: M
**Findings**: F-fault-tolerance-5

**Problema**
> O log `BUSINESS_INFO` do `SolicitacaoNumerarioService.gerar` roda em memória (via `LogService`) e não é persistido em nenhum repositório. Um analista não consegue reconstruir a lista de SNs simuladas ontem via query. Quando a era live começar, a conciliação "simulado × emitido" não terá fonte.

**Melhoria Proposta**
> Estender `RecebimentoExecucaoRepository` para aceitar tipo `solicitacao_numerario_dry_run` (ou criar novo repo `SolicitacaoNumerarioExecucaoRepository` — decisão do Ontology-Curator). Persistir: `{ txnId, priCod, filCod, ator, gcdCod, valor, dryRun:true, criadoEm, payloadHash }`. Testar "toda invocação de gerar() insere 1 linha".

**Resultado Esperado**
> Rastro auditável e consultável de todas as SNs (simuladas + eventualmente reais). Métrica: 0 → 1 writes DB por invocação de `gerar()`; endpoint READ (`GET /recebimentos/solicitacoes-numerario`) pode ser adicionado depois.

**Métricas de sucesso**
- Persistência por invocação: 0 → 1
- Cobertura de teste: 0 → 1 "gerar insere 1 linha em ledger"

**Risco de não fazer**
> Fase live começa sem base de conciliação; retrabalho manual e risco de duplicidade não-detectável.

**Dependências**: fault-tolerance-2 (idempotência precisa do ledger)

---

### [fault-tolerance-6] Tornar o fallback `buildDryRunFallback` do frontend explícito (nunca silencioso)

**QA**: Fault Tolerance (mesma raiz que availability-2, testability-5)
**Tactic alvo**: Sanity Checking (Detect)
**Esforço**: S
**Findings**: F-fault-tolerance-6

**Problema**
> `processarSolicitacaoNumerario` no frontend cai em `buildDryRunFallback` (payload construído localmente) em qualquer erro do backend (`catch {}`), sem logar, sem toast e sem sinal visual — o analista vê `toast.success('simulação gerada')` mesmo se o backend estiver caído/rejeitando 403. Detecção de incidente = 0; drift de contrato invisível.

**Melhoria Proposta**
> No `catch`: (i) chamar `toast.warning('Backend indisponível — usando simulação local (aviso: pode divergir do servidor)')`; (ii) etiquetar o `SolicitacaoNumerarioDryRun` com um flag `source: 'server' | 'client-fallback'`; (iii) no `PayloadPreview`, exibir badge amarela quando `source === 'client-fallback'`. Idealmente, remover o fallback silencioso e obrigar o operador a re-tentar quando o backend falhar.

**Resultado Esperado**
> Zero falhas silenciosas de backend mascaradas como sucesso. Métrica: 1 → 0 fallbacks silenciosos; 0 → 1 toast/badge de aviso quando o cliente cai no fallback.

**Métricas de sucesso**
- Fallbacks silenciosos: 1 → 0
- Cobertura de teste: 0 → 1 (mock 500 do backend → `toast.warning` disparado)

**Risco de não fazer**
> Um bug de contrato/auth no backend passa despercebido por dias; SNs simuladas divergem entre cliente e servidor sem que ninguém note.

**Dependências**: Nenhuma. Nota: converge com availability-2 e testability-5 — recomenda-se fechar como PR único.

---

### [performance-1] Adicionar `ExternalCallOptions.timeoutMs` ao `ProcessoProviderInterface`

**QA**: Performance (coberto principalmente por integrability-1 — mantido como P2 dedicado)
**Tactic alvo**: Bound Execution Times
**Esforço**: S (≤1d)
**Findings**: F-performance-1

**Problema**
> O port `ProcessoProviderInterface.listCandidatosParaTransacao` não aceita `opts?: ExternalCallOptions` como os outros ports do módulo (`NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`, `NdeEmitterInterface`). Quando o Módulo 2b trocar o stub pelo provider real (Conexos), o consumer não terá como forçar `timeoutMs`, e uma chamada hung ao ERP (p95 estimado 2–10s) prenderá o worker Express pelo request timeout global.

**Melhoria Proposta**
> Espelhar a assinatura dos ports pares — adicionar `opts?: ExternalCallOptions` em `listCandidatosParaTransacao`. Definir `PROCESSO_PROVIDER_TIMEOUT_MS` em `constants.ts` (default 5000ms, alinhado ao `NEXXERA_FETCH_TIMEOUT_MS`). Passar `opts` a partir de `routes/recebimentos.ts:176`. Adapter real MUST honrar o timeout (aborta via `AbortController`).

**Resultado Esperado**
> Contrato do port impõe `timeoutMs`; nenhuma chamada Conexos futura pode prender worker Express além de 5s. Baseline: sem timeout → 30s (worst-case Express) → 5s (alvo).

**Métricas de sucesso**
- Cobertura do `opts?: ExternalCallOptions` nos ports do módulo Recebimentos: 3/4 → 4/4
- p95 latência do `GET /…/processos` sob incidente Conexos (futuro): worst-case 30s → 5s

**Risco de não fazer**
> Quando o provider real for cabeado, replicamos o incidente de session-pool que já ocorreu (referência: `arch-review card security-6 / F-security-9`); analista trava a UI sem feedback.

**Dependências**: Nenhuma. Nota: idealmente fechar junto de integrability-1.

---

### [performance-2] Adicionar `AbortController` + timeout no `fetchProcessosParaTransacao`

**QA**: Performance (coberto por integrability-1)
**Tactic alvo**: Bound Execution Times
**Esforço**: S (≤1d)
**Findings**: F-performance-2

**Problema**
> O `fetchProcessosParaTransacao` (`frontend/lib/recebimentos.ts:435-453`) chama `apiFetch` sem `signal`. Se o backend real ficar preso, o modal fica em `loading` indeterminado, o `useEffect` só tem `cancelado` flag (não aborta o request), e o navegador segura o slot HTTP até o server responder ou o tab fechar.

**Melhoria Proposta**
> Passar `signal: AbortSignal.timeout(5000)` no `apiFetch`; no `useEffect` do `AlocarProcessosDialog.tsx:87-106`, criar `AbortController` local e chamar `controller.abort()` no cleanup. Mostrar mensagem de erro específica "Tempo esgotado (5s) — tente novamente" em vez do `EmptyState` genérico.

**Resultado Esperado**
> Modal cancela requests pendentes ao fechar OU após 5s; usuário sempre vê spinner OU erro, nunca loading indeterminado. Baseline: sem timeout no fetch → timeout do navegador (~5min HTTP/1.1) → 5s (alvo).

**Métricas de sucesso**
- p95 tempo até resposta OU erro no modal: 5min (worst-case navegador) → 5s
- Requests órfãos após fechar o modal: N → 0

**Risco de não fazer**
> UX degrada silenciosamente quando o ERP estiver lento; o analista clica repetidamente, gerando requests concorrentes.

**Dependências**: performance-1 (server-side timeout). Nota: converge com integrability-1.

---

### [modifiability-4] Fatiar `src/frontend/lib/recebimentos.ts` (524 LOC → 4 arquivos)

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: S
**Findings**: F-modifiability-4

**Problema**
> `lib/recebimentos.ts` acumula 4 responsabilidades: mirrors de DTOs, fixtures (rede de segurança do demo), tipos SN + fixture de processos, fetchers + fallback builder. 524 LOC em 1 arquivo dificulta review e vira gargalo de merge quando >1 pessoa toca Frente IV.

**Melhoria Proposta**
> Split em: `lib/recebimentos/types.ts` (tipos/mirrors + computeKpis), `lib/recebimentos/fixtures.ts` (fixtures painel + fixtureProcessos), `lib/recebimentos/api.ts` (fetchPainelRecebimentos), `lib/recebimentos/solicitacao-numerario.api.ts` (fetchProcessosParaTransacao + processarSolicitacaoNumerario). Re-export via `lib/recebimentos/index.ts` para não quebrar consumidores. Tactic: **Split Module** + **Increase Semantic Coherence**.

**Resultado Esperado**
> Nenhum arquivo do slice FE-recebimentos acima de 200 LOC. Fixture nunca é lido quando a página só precisa de tipos.

**Métricas de sucesso**
- Max LOC em `lib/recebimentos/**`: 524 → ≤ 200
- Imports transitivos ao editar um fetcher: 1 (só o api.ts) vs. hoje ler 524 linhas

**Risco de não fazer**
> Cada nova rota FE (aprovar, estornar, etc.) engorda o arquivo; em 3 iterações passa de 700 LOC.

**Dependências**: [modifiability-2] (fazer depois para não retrabalhar o `buildDryRunFallback`)

---

### [modifiability-5] Corrigir `set-state-in-effect` em `AlocarProcessosDialog` antes de expandir o dialog

**QA**: Modifiability (contribuinte cross: Testability)
**Tactic alvo**: Refactor
**Esforço**: S
**Findings**: F-modifiability-5

**Problema**
> `AlocarProcessosDialog.tsx:90` dispara `setLoading(true)` / `setErro(null)` / `setResultados({})` direto no corpo do `useEffect`, disparando o warning `react-hooks/set-state-in-effect`. Modifiability: qualquer feature que expanda o dialog (paginação, busca, seleção múltipla) precisa primeiro entender esse hack — retrabalho garantido.

**Melhoria Proposta**
> Refatorar para: (a) migrar o fetch para `useQuery` (React Query já usado no projeto? confirmar) ou (b) usar `useReducer` com uma única ação `RESET_AND_LOAD` disparada no ciclo síncrono do effect. Tactic: **Refactor**.

**Resultado Esperado**
> 0 warnings de lint em SN files. Dialog pronto para receber features de expansão sem "cuidado com o efeito" tribal knowledge.

**Métricas de sucesso**
- Warnings de lint em `AlocarProcessosDialog.tsx`: 1 → 0
- Cascading renders visíveis no React DevTools: presente → ausente

**Risco de não fazer**
> Warning acumula com os 28 pré-existentes de permutas/sispag/conexos, aumentando o ruído do gate; próxima feature "Alocar avançado" (Fase 2) esbarra na dívida.

**Dependências**: confirmar se React Query já está no bundle da Frente IV

---

### [security-1] Adicionar teste de regressão `role != admin` para POST SN

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: S
**Findings**: F-security-1

**Problema**
> A rota `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` aplica `requireRole('admin')` (`recebimentos.ts:202`), mas o teste `recebimentos.test.ts:234-287` não cobre o caminho `role: 'user' → 403`. Uma remoção acidental do middleware ao refatorar não é pega pelo suite atual (740/740 green).

**Melhoria Proposta**
> Adicionar `it('403 when role is not admin')` no describe de SN, montando `buildApp({ sub: 'u', role: 'user', filiais: [4] })` e postando `snPayload()`. Espera `res.status === 403`. Mesmo padrão do teste `role: 'user'` já usado no pipeline/run (`recebimentos.test.ts:196-207`).

**Resultado Esperado**
> 1 novo test case verde exercendo `requireRole('admin')` na SN — remove a possibilidade de regressão silenciosa.

**Métricas de sucesso**
- Test cases cobrindo `requireRole` na SN: 0/1 → 1/1
- Suite: 740 → 741 passes

**Risco de não fazer**
> 6 meses depois, ao unificar middlewares recebimentos+sispag, alguém encapsula `requireRole` num factory e esquece de aplicá-lo à SN — o suite fica verde e a rota vira aberta a qualquer usuário autenticado.

**Dependências**: Nenhuma

---

### [security-2] Redigir campo `ator` no log de negócio da SN (nunca vazar email)

**QA**: Security (contribuinte cross: Testability F-2)
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-2

**Problema**
> `SolicitacaoNumerarioService.ts:97-107` loga `data: { …, ator }` onde `ator = req.user?.sub ?? req.user?.email ?? 'unknown'` (`recebimentos.ts:219`). Hoje `sub` é sempre presente (garantido por `toAuthUser` em `auth.ts:61-73`), mas o fallback pela via da rota abre porta para email cair em log estruturado — que Render/CloudWatch coleta sem redaction.

**Melhoria Proposta**
> Trocar a resolução do `ator` para sempre um id opaco (`req.user?.sub`) e rejeitar (500) quando `sub` faltar. Se `email` for útil para operação, gravar em campo separado `actorEmailHash` (SHA-256 truncado) ou emitir só no log de auth, não no log de negócio. Alternativa mais barata: remover `ator` do `data:` do `logService.info` e deixar o middleware de auth ser a única fonte de identidade.

**Resultado Esperado**
> Log-line de `gerarSolicitacaoNumerario` nunca carrega email do analista. LGPD: email não é PII persistida sem controle.

**Métricas de sucesso**
- Campos com email cru no log de negócio SN: 1 → 0
- Teste que asserte `expect(logCall.data.ator).not.toMatch(/@/)`: 0 → 1

**Risco de não fazer**
> Log rotation de 90 dias em Render/CloudWatch acumula emails de analistas em plain-text — vetor para scraping se logs vazarem, e não-conformidade com controle LGPD de dados de colaboradores.

**Dependências**: Nenhuma

---

### [security-3] Provisionar tabela `audit_log` (append-only) e persistir a SN dry-run nela

**QA**: Security (contribuinte cross: Fault Tolerance — mesma raiz que fault-tolerance-5)
**Tactic alvo**: Audit Trail
**Esforço**: M
**Findings**: F-security-3

**Problema**
> A ação `gerarSolicitacaoNumerario` (mesmo em dry-run) é observada apenas via `logService.info` → stdout (`SolicitacaoNumerarioService.ts:97-107` + `LogService.ts:26`). Não há tabela persistida queryable. A proposta Kavex e a ontology (`gerar-solicitacao-numerario.md`) exigem audit persistido em toda ação — enquanto o volume ainda é dry-run, o custo de criar a estrutura é baixo. Quando `enviarAoErp` sair do `NotImplementedError`, essa dívida vira P0.

**Melhoria Proposta**
> Provisionar tabela `audit_log(id, action, entity, entity_id, actor_sub, filCod, payload_hash, occurred_at)` e um `AuditLogRepository` (SQL parametrizado, sem valores brutos — só hash). Injetar no `SolicitacaoNumerarioService` e chamar `.append()` antes do `return`. Espelhar padrão da Frente II (SISPAG) que já tem `sispag_audit` (se ainda não tem, criar juntas, um só schema).

**Resultado Esperado**
> Toda geração de SN (dry-run e futura real) fica queryable: `SELECT * FROM audit_log WHERE entity='solicitacao_numerario' AND actor_sub=$1 AND occurred_at BETWEEN $2 AND $3`.

**Métricas de sucesso**
- Ações SN persistidas em `audit_log`: 0 → 100%
- Query `SELECT COUNT(*) FROM audit_log WHERE action='gerar_solicitacao_numerario'` retorna valor coerente com contagem de POSTs no CloudWatch

**Risco de não fazer**
> No dia em que a Columbia pedir "quem gerou a SN X do processo Y em 3 meses atrás", a única evidência é log-line rotado — resposta "não sei". Compliance + reputação da automação em risco.

**Dependências**: alinhar schema com Fault Tolerance (fault-tolerance-5 é a mesma implementação) e com o time do SISPAG (mesma tabela).

---

### [testability-1] Cobrir o ramo `throw err` (não-`FilialForbiddenError`) nas 3 rotas de recebimentos

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤ 1d)
**Findings**: F-testability-1

**Problema**
> As 3 rotas de recebimentos (`/pipeline/run`, `/transacoes/:txnId/processos`, `/transacoes/:txnId/solicitacao-numerario`) fazem `throw err` quando o erro do `assertUserCanActOnFilial` não é `FilialForbiddenError`. Nenhum dos 3 sites é exercitado pelos testes atuais — `routes/recebimentos.ts` fica em 63.63% de branches. O ramo existe para deixar o `errorMiddleware` catar erros inesperados; sem teste, uma regressão que engula o erro passa despercebida.

**Melhoria Proposta**
> Adicionar 3 testes (um por rota) que injetam um `assertUserCanActOnFilial` que lança um `Error` genérico (por exemplo mockando `../http/filialAuthz.js` com `jest.spyOn`) e afirmam que a resposta é `500` (ou o comportamento definido pelo `errorMiddleware`) — provando que o `throw err` propaga. Tactic Bass: **Executable Assertions**. Arquivos a tocar: `src/backend/routes/recebimentos.test.ts`.

**Resultado Esperado**
> Branches em `routes/recebimentos.ts`: **63.63% → ≥ 80%**. Ramo "não-`FilialForbiddenError`" coberto em 3/3 rotas.

**Métricas de sucesso**
- `routes/recebimentos.ts` branch coverage: 63.63% → ≥ 80%
- Testes na suíte de rotas: 11 → 14

**Risco de não fazer**
> Regressão silenciosa quando alguma dependência do `try` (Zod change, novo pre-check) começar a lançar tipo diferente; um `500` pode virar `undefined` sem alarme.

**Dependências**: Nenhuma

---

### [testability-2] Afirmar o BUSINESS_INFO emitido pelo `SolicitacaoNumerarioService` (guard de LGPD + auditoria dry-run)

**QA**: Testability (contribuinte cross: Security)
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤ 0.25d)
**Findings**: F-testability-2

**Problema**
> O `SolicitacaoNumerarioService.gerar` emite um `logService.info` com `type:'BUSINESS_INFO'`, `dryRun:true` e um `data` propositalmente sem PII (só `priCod`, `filCod`, `gcdDesNome`, `ator`). O teste mocka `logService.info = jest.fn()` mas nunca afirma sobre a chamada. Se um dev adicionar `dpeNomPessoa` ou `priEspRefcliente` ao `data` (violando o guard de PII do MetricsPort do módulo 6), o gate não detecta. Também é a única prova estruturada de que a chamada foi dry-run — remover o log deixa a auditoria cega.

**Melhoria Proposta**
> Adicionar 1 asserção no `SolicitacaoNumerarioService.test.ts`: `expect(logStub.info).toHaveBeenCalledWith(expect.objectContaining({ type:'BUSINESS_INFO', data: expect.objectContaining({ dryRun:true, priCod:…, filCod:…, gcdDesNome:… }) }))` e uma segunda que afirma `expect(logStub.info).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dpeNomPessoa: expect.anything() }) }))` (negativa explícita anti-PII). Tactic Bass: **Executable Assertions**.

**Resultado Esperado**
> `logService.info` do service passa a ser um contrato testado (não só uma convenção). Cross-QA com Security: guard automatizado anti-PII em log.

**Métricas de sucesso**
- Asserções em `logStub.info` no test SN: 0 → 2 (positiva + negativa)
- Testes na suíte SN service: 6 → 8

**Risco de não fazer**
> PII vaza para log sem detecção; ou o log é removido em refactor e a auditoria "dry-run" desaparece.

**Dependências**: Nenhuma

---

### [testability-3] Injetar clock na rota SN + afirmar `docDtaEmissao`/`dtaVencimento` no teste de rota

**QA**: Testability (contribuinte cross: Modifiability)
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S (≤ 1d)
**Findings**: F-testability-3

**Problema**
> A rota `POST /solicitacao-numerario` constrói `new Date()` inline (`routes/recebimentos.ts:232`) e o passa como `dataReferencia` para o service. O service unit test já fixa a data e afirma sobre `docDtaEmissao`/`dtaVencimento` (bom); o teste de rota, porém, NÃO afirma essas 2 chaves. Uma regressão que troque `dataReferencia: new Date()` por `new Date(0)` ou `undefined` passaria no gate. Quando `enviarAoErp` for cabeado, isto vira risco financeiro (vencimento errado no ERP).

**Melhoria Proposta**
> (a) Extrair um `getNow: () => Date` do service ou do handler (via DI ou parâmetro default) para permitir fake clock (`jest.useFakeTimers().setSystemTime(new Date('2026-07-28…'))`). (b) Adicionar asserções no teste de rota SN: `expect(body.payload.docDtaEmissao).toBe(FIXED_ISO)` e `expect(body.payload.dtaVencimento).toBe(FIXED_ISO)`. Aplicar o mesmo padrão para `routes/recebimentos.ts:38, 87` e o `buildDryRunFallback` do FE (`lib/recebimentos.ts:396`). Tactic Bass: **Limit Non-Determinism**. Cross-QA com Modifiability (clock injetável = uma dependência a menos).

**Resultado Esperado**
> Sites `new Date()` não-injetáveis no delta (BE+FE): **5 → ≤ 1** (só o painel stub). Testes de rota afirmando timestamps do payload: **0 → 1**.

**Métricas de sucesso**
- `new Date()` inline no delta: 5 → ≤ 1
- Asserções sobre `docDtaEmissao`/`dtaVencimento` no teste de rota: 0 → 2

**Risco de não fazer**
> Regressão silenciosa do timestamp; risco real quando o wire ao ERP existir (vencimento errado no borderô).

**Dependências**: Nenhuma; alinhar com o padrão de clock que a Frente IV eventualmente adotar.

---

### [testability-4] Cobrir os 2 estados restantes do `AlocarProcessosDialog` (erro + processando)

**QA**: Testability (contribuinte cross: Availability)
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤ 0.5d)
**Findings**: F-testability-4

**Problema**
> O dialog tem 5 estados observáveis (loading, erro, vazio, lista, processando, processado) e o teste cobre 3 (lista/vazio/processado). Falta o ramo de erro (`setErro`, EmptyState "Não foi possível carregar") e o ramo `processandoPri` (spinner + `disabled` do botão). Regressões que quebrem esses estados passam despercebidas; um analista poderia clicar "Processar" duas vezes em rápida sucessão (potencial dupla-emissão quando o seam ERP for cabeado).

**Melhoria Proposta**
> Adicionar 2 testes em `AlocarProcessosDialog.test.tsx`: (1) `mockFetch.mockRejectedValue(new Error('boom'))` → afirmar que "Não foi possível carregar" e a mensagem `'boom'` aparecem; (2) usar `mockProcessar.mockImplementation(() => new Promise(r => setTimeout(r, 50)))` para segurar a promessa e afirmar `expect(botao).toBeDisabled()` durante o processamento. Tactic Bass: **Executable Assertions**. Cross-QA com Availability (proteção contra dupla-submissão).

**Resultado Esperado**
> Estados testados no dialog: **3/5 → 5/5**. Testes no dialog: **3 → 5**.

**Métricas de sucesso**
- Estados testados: 3/5 → 5/5
- Testes no dialog: 3 → 5

**Risco de não fazer**
> Regressão silenciosa da UX de erro; dupla-submissão silenciosa quando o wire ao ERP existir.

**Dependências**: Nenhuma

---

### [integrability-6] Emitir `MetricsEvent` por-dependência no `gerar` e `enviarAoErp` (usar `METRICS_PORT_TOKEN`)

**QA**: Integrability (contribuinte cross: Availability F-5, Performance F-4)
**Tactic alvo**: Observability of integration failures
**Esforço**: S (≤1d)
**Findings**: F-integrability-6, F-availability-5

**Problema**
> `SolicitacaoNumerarioService` só emite `LogService.info` (`SolicitacaoNumerarioService.ts:97-107`). O port `METRICS_PORT_TOKEN` (`ports.ts:209-218`) — desenhado justamente para observabilidade por-dependência — não é injetado no service SN. Quando o seam cabear, a taxa de erro Conexos ficará misturada com o resto do coordinator; alerta seletivo em "SN error rate" fica impossível sem re-instrumentar.

**Melhoria Proposta**
> Injetar `@inject(METRICS_PORT_TOKEN) metricsPort: MetricsPortInterface` no `SolicitacaoNumerarioService` e emitir `MetricsEvent { stage: 'gerar-sn', outcome, attributes: { dryRun, filCod } }` em `gerar()` e (futuramente) em `enviarAoErp()`. Respeitar o invariante `no-PII` do port (contraparte/pesCod fora — só `filCod`/`dryRun`/`outcome`). Tactic Bass alvo: **Observability of integration failures**. Arquivos: `SolicitacaoNumerarioService.ts` + tests.

**Resultado Esperado**
> 0 `MetricsEvent` emitidos por SN → 1 por chamada; base para alerta "SN error rate > X%" no cabeamento.

**Métricas de sucesso**
- Chamadas `gerar()` com metric emitida: 0% → 100%
- Alertabilidade seletiva por-dependência (SN): não → sim

**Risco de não fazer**
> MTTR maior em incidente Conexos pós-cabeamento; próximas features Frente IV copiam o anti-padrão.

**Dependências**: Nenhuma

---

### [integrability-3] Compartilhar tipos SN entre backend e frontend (evitar redigitar DTO)

**QA**: Integrability (contribuinte cross: Modifiability — mesma raiz que modifiability-1/2)
**Tactic alvo**: Use an Intermediary
**Esforço**: M (2–5d) — envolve build config (paths, tsconfig references)
**Findings**: F-integrability-3

**Problema**
> `Processo`, `TmpCom068DTOItem`, `GerDocProcessoSelectionDTOCab`, `DocConfig`, `SolicitacaoNumerarioDryRun` estão duplicados 1:1 em `src/frontend/lib/recebimentos.ts:311-362` (redigitados à mão) e ainda há uma **fábrica de fallback** (`buildDryRunFallback`, `recebimentos.ts:392-428`) que reimplementa a montagem do payload — inclusive re-hardcoding `790` (moeda) e `'SN'` (docTip). Drift latente garantido.

**Melhoria Proposta**
> Extrair os DTOs para um módulo `shared/` (ou publicar como pacote), consumido por FE e BE. Alternativa mínima: expor um endpoint `/recebimentos/sn/schema` que devolve a config canônica (`gcdCod`, `docTip`, `moeCod`) e o FE lê no boot — matando o fallback duplicado. Tactic Bass alvo: **Use an Intermediary**. Arquivos: `src/frontend/lib/recebimentos.ts`, `src/backend/domain/interface/recebimentos/GerDocProcesso.ts` (extrair `shared/dto/gerdoc.ts`).

**Resultado Esperado**
> 4 interfaces duplicadas → 0; 1 fábrica duplicada → 0; qualquer tweak do swagger com299 muda **1** arquivo.

**Métricas de sucesso**
- Interfaces SN duplicadas FE/BE: 4 → 0
- Constantes SN hardcoded no FE: 2 (`790`, `'SN'`) → 0

**Risco de não fazer**
> Em 6 meses, um deploy FE-only diverge do BE após atualização de swagger; sintoma é UI mostrando payload obsoleto no preview.

**Dependências**: [integrability-2] (ter o DTO canônico como fonte única já ajuda).

---

### [integrability-4] Capturar HAR HML do `gerDocProcesso` e adicionar contract test de parsing

**QA**: Integrability (contribuinte cross: Fault Tolerance — coberto por fault-tolerance-3)
**Tactic alvo**: Contract testing
**Esforço**: S (≤1d) uma vez que HML esteja acessível
**Findings**: F-integrability-4

**Problema**
> Não existe fixture HAR real do `gerDocProcesso` versionada; `SolicitacaoNumerarioService.test.ts` cobre só a construção. Quando `enviarAoErp` for cabeado, o parse da resposta será exercitado pela primeira vez em runtime — mesmo pattern do que já viveu Frente II (Zod tardio nos returns do fin010).

**Melhoria Proposta**
> Capturar 1 HAR real do `gerDocProcesso` em HML (dentro do próximo ciclo com credencial) → salvar em `__fixtures__/gerDocProcesso.har.json` → criar `SolicitacaoNumerarioService.contract.test.ts` que roda `gerDocProcessoSelectionDTOCabSchema.parse(harRequest)` e um `gerDocProcessoResponseSchema.parse(harResponse)` a ser criado. Tactic Bass alvo: **Contract testing**. Arquivos: novo `__fixtures__/gerDocProcesso.har.json`, novo `GerDocProcesso.contract.test.ts`.

**Resultado Esperado**
> 0 fixtures HAR → 1; 0 contract tests → 1; garantia de que o primeiro POST live vem de payload já parseado contra shape real.

**Métricas de sucesso**
- Fixtures HAR SN versionadas: 0 → 1
- Testes de parse contra HAR: 0 → 1

**Risco de não fazer**
> Primeira homologação vira "test-in-prod" HML; rodadas extras.

**Dependências**: acesso credenciado ao HML (bloqueio externo — trata como pré-req).

---

### [deployability-3] Segmentar a flag `RECEBIMENTOS_ENABLED` por `filCod` (canário por filial)

**QA**: Deployability
**Tactic alvo**: Manage Deployment Pipeline — Scale Rollouts (Canary)
**Esforço**: M (2–5d) — código + testes de gate + docs no `DEPLOY.md`
**Findings**: F-deployability-3

**Problema**
> Hoje `isRecebimentosEnabled()` (FE) e `recebimentosGate` (BE) são booleans globais. Quando a SN for liberada, 100% dos analistas de todas as filiais veem o modal "Alocar" + "Processar" simultaneamente. Não há rollout parcial nem filial-piloto.

**Melhoria Proposta**
> Evoluir o gate para aceitar uma lista de filiais habilitadas: `RECEBIMENTOS_ENABLED_FILCOD=2,7,15` (ou tri-state `all|list|none`). Atualizar `EnvironmentProvider.resolveRecebimentosEnabled` para retornar `{ enabled: true, allowedFilCods: Set<number> }`, `recebimentosGate` para cruzar com o `filCod` do request (query/body/user), e `isRecebimentosEnabled(filCod?)` no FE para esconder o botão nas filiais não incluídas. Alvo Bass: Scale Rollouts (Canary).

**Resultado Esperado**
> Rollout controlado da SN por filial. Baseline: 1 dimensão de segmentação (env global) → 2 dimensões (env + `filCod`). Enables "liga em Santos primeiro por 1 semana, depois liga o resto".

**Métricas de sucesso**
- Dimensões de segmentação da flag: 1 (global) → 2 (global + `filCod`)
- Filial-piloto para primeiro rollout da SN: 0 → 1 (definida no runbook)

**Risco de não fazer**
> Big-bang rollout da SN quando o `gcdCod` for descoberto. Se o payload tiver bug em uma filial específica, o incidente afeta todas ao mesmo tempo.

**Dependências**: [deployability-1] (runbook) deve documentar a semântica da nova flag.

---

### [deployability-4] Drift detector semanal para env vars `sync: false` no Render

**QA**: Deployability (contribuinte cross: Security, Modifiability)
**Tactic alvo**: Manage Deployment Pipeline — Drift Detection
**Esforço**: S (≤1d)
**Findings**: F-deployability-4

**Problema**
> 12 chaves em `render.yaml` estão em `sync: false` (incluindo `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN` — todas críticas). O blueprint declara existência mas não valor. Uma mudança acidental no dashboard não deixa rastro no repo, e o `render.yaml` já comenta "Regis P0 deployability — yaml brigando com dashboard".

**Melhoria Proposta**
> Criar `.github/workflows/env-drift.yml` (cron semanal) que usa a Render API (`GET /services/{id}/env-vars`) para exportar as vars atuais e comparar com uma snapshot em `infra/render-env-baseline.json` (commitado). Alerta Slack `#deploys` quando houver diff, especialmente em `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`. Alvo Bass: Drift Detection.

**Resultado Esperado**
> Mudanças de env em prod deixam rastro auditável em ≤ 7 dias. Baseline: 0 alertas de drift → cron semanal + baseline versionado. Compliance-friendly.

**Métricas de sucesso**
- Vars monitoradas contra drift: 0 → 12
- Tempo até detecção de drift: ∞ → ≤ 7 dias

**Risco de não fazer**
> Um operador desliga `CONEXOS_DRY_RUN` sem PR e sem log. Semanas depois, alguém audita e não sabe quando/por que. Para o SN, quando o seam for cabeado, esse tipo de flip cego é o vetor de incidente mais provável.

**Dependências**: [deployability-1] (runbook precisa referenciar a baseline).

---

### [deployability-5] Coordenar deploy BE→FE (ordem determinística com smoke)

**QA**: Deployability (contribuinte cross: Availability)
**Tactic alvo**: Manage Deployment Pipeline — Version Consistency
**Esforço**: M (2–5d) — CI wiring + Vercel API token + trocar o modo de deploy Vercel
**Findings**: F-deployability-5

**Problema**
> BE (Render) e FE (Vercel) auto-deployam em paralelo após o commit `chore(release)`. Em uma janela de ~4 min pode existir dessincronia: FE já servindo o novo dialog `AlocarProcessosDialog` que chama `POST /solicitacao-numerario` enquanto o BE ainda serve o binário antigo (rota 404). Mitigado hoje pelo `recebimentosGate` (403 default), mas estrutural.

**Melhoria Proposta**
> Adicionar job `wait-backend-then-trigger-frontend` no `ci.yml` (após `tag-release`): (a) polling `GET /health` do Render até `version == package.json.version` (timeout 10 min); (b) só então dispara o deploy Vercel via API (`vercel deploy --prod` ou webhook). Desligar auto-deploy do Vercel no push, mover o trigger para o CI. Alvo Bass: Version Consistency at deploy time.

**Resultado Esperado**
> FE nunca vai ao ar antes do BE compatível. Baseline: janela BE↔FE de até ~5 min → 0s (FE só sobe após BE `/health` bater a versão). Reduz "flash de 404" pós-deploy.

**Métricas de sucesso**
- Janela de dessincronia FE/BE: até ~5 min → 0s (deterministicamente ordenado)
- Deploys com FE ahead of BE: eventual → 0

**Risco de não fazer**
> Cada nova rota introduzida no BE que o FE consome (o SN é exemplo) tem uma janela de "toast vermelho para o analista" no primeiro momento pós-deploy.

**Dependências**: [deployability-2] (staging permite testar o wiring da coordenação antes de prod).

---

### [performance-4] Instrumentar rotas de Recebimentos com Otel/APM

**QA**: Performance (contribuinte cross: Availability, Integrability)
**Tactic alvo**: (meta-tactic — todas dependem de instrumentação para auditoria)
**Esforço**: M (2–5d)
**Findings**: F-performance-4

**Problema**
> Sem APM instalado no backend Express (Render), as métricas de p95/p99 declaradas nos cenários Bass deste doc são especulativas. Impossível provar regressão pós-deploy ou triar reclamação de "está lento" sem hipótese.

**Melhoria Proposta**
> Instalar `@opentelemetry/sdk-node` + auto-instrumentation `express` + exportador (Console em dev, OTLP para Grafana Cloud/New Relic em prod). Envolver as rotas de Recebimentos com o middleware; garantir que o `correlationId` do payload vira `trace_id` no span (já namespaced em `receb:*`). Configurar SSM key para o endpoint OTLP via `EnvironmentProvider`.

**Resultado Esperado**
> Toda rota de Recebimentos publica span com latência, status HTTP e `filCod`. Baseline: 0 traces → 100% das rotas cobertas.

**Métricas de sucesso**
- Cobertura de instrumentação: 0 → 100% das rotas `/recebimentos/*`
- MTTD para reclamação "está lento": não medível → < 5min com dashboard

**Risco de não fazer**
> Cada issue de perf vira arqueologia. Métricas alvo (p95 GET < 50ms, POST < 20ms) permanecem indefensáveis.

**Dependências**: nenhuma; é infra transversal, poderia ser cross-frente (aproveitar por Permutas/SISPAG também)

---

## P3 — Baixo

### [availability-5] Instrumentar `MetricsPortInterface.emit` no `SolicitacaoNumerarioService.gerar`

**QA**: Availability (coberto por integrability-6 — mantido como referência)
**Tactic alvo**: Condition Monitoring + Monitor
**Esforço**: S (≤1d)
**Findings**: F-availability-5

**Problema**
> O service só emite `logService.info`. `MetricsPortStub` já está registrado (`recebimentosContainer.ts:53`) mas não é injetado. Sem contador na fase dry-run, não há baseline histórica de uso para o dia do wire-real.

**Melhoria Proposta**
> Injetar `MetricsPortInterface` no `SolicitacaoNumerarioService`; emitir `{stage:'sn_dryrun_gerado', correlationId, outcome:'ok', attributes:{filCod, priCod}}` no fim do `gerar`; emitir `outcome:'error'` no `catch` externo (na rota). Tactic: **Condition Monitoring** (Bass — Detect Faults). Sem PII (contraparte, nome de pessoa, valor) — só counters/enums, como o docstring do port exige.

**Resultado Esperado**
> Baseline de uso dry-run coletada por ≥ 30 dias antes do wire-real. No dia do wire, dashboard já tem eixo de comparação.

**Métricas de sucesso**
- Métricas emitidas por chamada SN: 0 → ≥ 1
- Cobertura de `outcome:'ok'|'error'`: 0/2 → 2/2

**Risco de não fazer**
> Entrada no wire-real cega — sem baseline de "quantas SNs por dia é o normal". Falsos alarmes / picos passam despercebidos.

**Dependências**: Nenhuma. Nota: converge com integrability-6.

---

### [availability-6] Sem healthcheck/readiness da rota SN

**QA**: Availability
**Tactic alvo**: Ping/Echo (Bass — Detect Faults)
**Esforço**: S
**Findings**: F-availability-6

**Problema**
> O `/recebimentos/painel` já expõe superfície viva; SN não precisa de healthcheck próprio hoje. Para o operador validar rapidamente "a rota SN está viva", tem que disparar um POST com admin + filial autorizada (nada trivial).

**Melhoria Proposta**
> Aceitável no delta (P3). Considerar `GET /recebimentos/health-sn` retornando `{ enabled: RECEBIMENTOS_ENABLED, seamLive: false }` quando conveniente.

**Resultado Esperado**
> Aceitável no delta atual; documentado como P3 para não bloquear.

**Métricas de sucesso**
- 0 endpoint de health dedicado (aceito).

**Risco de não fazer**
> Baixo — no runtime Express single-process, se o painel abre, a rota também está viva.

**Dependências**: Nenhuma

---

### [performance-3] Aplicar `heavyRouteLimiter` no `GET /…/processos` quando o provider virar real

**QA**: Performance (contribuinte cross: Security)
**Tactic alvo**: Limit Event Response
**Esforço**: S (≤1d)
**Findings**: F-performance-3

**Problema**
> `GET /recebimentos/transacoes/:txnId/processos` hoje só tem o `globalLimiter` (100 req/min/IP). No dry-run com stub in-memory isso é irrelevante. Quando o Módulo 2b trocar por Conexos real, cada request vira 1 chamada ERP; 100 req/min por IP é fanout suficiente para replicar o incidente conhecido de esgotamento de session-pool.

**Melhoria Proposta**
> Aplicar `heavyRouteLimiter` (10 req/min/IP) na rota GET, com toggle por `EnvironmentProvider` (feature-flag `RECEBIMENTOS_PROCESSO_PROVIDER=real`) para não penalizar o stub. Alternativa: adicionar o limiter incondicionalmente agora — 10 req/min é folgado para analista humano.

**Resultado Esperado**
> GET protegido pelo mesmo teto que o POST irmão. Baseline: 100 req/min/IP → 10 req/min/IP na rota crítica (fanout ao ERP).

**Métricas de sucesso**
- Fanout máximo ao Conexos via GET (futuro): 100 req/min/IP → 10 req/min/IP

**Risco de não fazer**
> Repete o incidente `arch-review card security-6 / F-security-9` (session-pool do ERP saturado por request-flood).

**Dependências**: Módulo 2b (provider real) — deve entrar junto no mesmo delta

---

### [performance-5] Migrar filtro do provider para SQL indexado quando escalar

**QA**: Performance (contribuinte cross: Modifiability)
**Tactic alvo**: Reduce Overhead + Increase Resource Efficiency
**Esforço**: M (2–5d — parte do delta Módulo 2b)
**Findings**: F-performance-5

**Problema**
> O stub `ProcessoProviderStub.listCandidatosParaTransacao` faz `.filter` in-memory com 2 `toLowerCase()` + `includes` bidirecional por candidato. Aceitável em 4 itens; problemático se um provider real trouxer 5.000 processos abertos por filial ao invés de já filtrar no ERP.

**Melhoria Proposta**
> Ao substituir o stub pelo provider real (Módulo 2b), passar o filtro para o próprio ERP (`WHERE fil_cod = $1 AND lower(dpe_nom_pessoa) ILIKE $2`) — indexar `dpe_nom_pessoa` com `LOWER(...)` no schema local (se cache/persistência local for adotada). Nunca trazer todos os processos abertos e filtrar no Node.

**Resultado Esperado**
> Response size da chamada ao ERP fica no order-of-magnitude do número de candidatos reais (≤ 20 típico), não do total de processos abertos.

**Métricas de sucesso**
- Payload médio da resposta do ERP: sem filtro (5.000 itens) → filtrado (≤ 20 itens)
- String ops (`toLowerCase`/`includes`) por request no Node: O(n) linear em N → 0

**Risco de não fazer**
> Matching engine real acaba num loop O(n) sem índice, e o `req_timeout` do Express (30s) vira teto real.

**Dependências**: Módulo 2b (matching engine real)

---

### [performance-6] Instrumentar `bootstrapAppContainer` idempotency como métrica

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S (≤1d)
**Findings**: F-performance-6

**Problema**
> `bootstrapAppContainer` é awaited em cada handler (`routes/recebimentos.ts:37, 60, 156, 204`). É idempotente (`isRegistered` guard), mas o custo `if + await` roda por request. Sem medição, se um dia alguém quebrar a idempotência (registrando tokens múltiplas vezes), degradação é silenciosa.

**Melhoria Proposta**
> Adicionar um `counter` no bootstrap: `bootstrapCallCount` (increments) vs `bootstrapActualRegisterCount` (increments SÓ na primeira). Expor via `/health` ou log estruturado. Alertar se `actual > 1`.

**Resultado Esperado**
> Regressão de idempotência do bootstrap é detectada em <1min. Baseline: 0 medição → 100% coverage do bootstrap.

**Métricas de sucesso**
- `bootstrapActualRegisterCount` por processo: alvo == 1 (invariante)

**Risco de não fazer**
> Risco baixo; feature específica não regride nada — vira issue só se outro dev refatorar o container.

**Dependências**: [performance-4] (idealmente sobre a mesma stack de observabilidade)

---

### [modifiability-6] Preparar split de `routes/recebimentos.ts` quando cruzar 300 LOC

**QA**: Modifiability
**Tactic alvo**: Split Module (planejado)
**Esforço**: S (comentário agora); M (o split quando disparar)
**Findings**: F-modifiability-6

**Problema**
> `routes/recebimentos.ts` está em 239 LOC com 17 imports (acima do teto de 15). Adicionar as próximas rotas de Frente IV (aprovar, estornar, listar processos por período, etc.) faz o arquivo crescer rápido — vai virar "route hub".

**Melhoria Proposta**
> Não fazer split agora (prematuro). Adicionar TODO comentado no topo do arquivo com o gatilho: "quando LOC > 300 OU imports > 20, fatiar em `routes/recebimentos/{painel,pipeline,alocar}.ts` e montá-los via `routes/recebimentos/index.ts`". Fica documentado como Cards de Kanban não-imediatos. Tactic: **Split Module** (deferido).

**Resultado Esperado**
> Ninguém do time é surpreendido quando o arquivo cruzar o teto; o refactor tem escopo definido antes de doer.

**Métricas de sucesso**
- Comentário-gatilho presente: ausente → presente
- LOC de qualquer arquivo em `routes/recebimentos/**`: ≤ 300 na Fase 2

**Risco de não fazer**
> O split é feito "de emergência" no PR errado, misturando refactor com feature — Regis-Review pega.

**Dependências**: Nenhuma

---

### [fault-tolerance-1] Documentar formalmente o invariante DRY-RUN e ancorar como decisão de arquitetura

**QA**: Fault Tolerance
**Tactic alvo**: Substitution + Predictive Model (Bass — Avoid Faults)
**Esforço**: S
**Findings**: F-fault-tolerance-1

**Problema**
> A propriedade "não existe caminho de escrita ao Conexos alcançável pela rota SN" é o pilar de segurança desta iteração — evidenciada por grep e por 1 teste unitário. Mas ela vive espalhada em (a) comentários JSDoc do serviço, (b) o `NotImplementedError`, (c) a integration `.md`. Sem um ADR/regra invariante nomeada, um dev futuro pode "só cabear rapidinho" o `enviarAoErp` sem passar pelas checagens (gcdCod, encomenda-percentuais, idempotência, timeout, ledger). Regis mira: transformar a propriedade em **regra invioável documentada**.

**Melhoria Proposta**
> Adicionar uma business-rule `ontology/business-rules/dry-run-only-com299-gerdoc.md` listando os 4 pré-requisitos que o merge do `enviarAoErp` deve cumprir (F-2 idempotência da rota, F-3 handle de reconciliação, F-4 encomenda-percentuais resolvida, F-5 ledger persistido) — cada um mapeando para o card correspondente. Referenciar do JSDoc do `enviarAoErp` e do `NotImplementedError`.

**Resultado Esperado**
> O invariante DRY-RUN vira uma checklist rastreável; qualquer PR que remova o `throw new NotImplementedError` obriga a apontar os 4 cards fechados. Métrica: 0 → 1 business-rule dedicada; JSDoc do `enviarAoErp` referencia a rule.

**Métricas de sucesso**
- Business-rules SN dedicadas: 0 → 1
- Referências cruzadas JSDoc → rule: 0 → 2 (no seam + no error)

**Risco de não fazer**
> Um refactor no médio prazo pode remover o seam por "código morto", eliminando a Substitution.

**Dependências**: Nenhuma

---

### [testability-5] Marcar `fonte:'fixture'|'backend'` nos fallbacks de `fetchProcessosParaTransacao` e `processarSolicitacaoNumerario`

**QA**: Testability (mesma raiz que availability-2, fault-tolerance-6 — mantido para preservar métricas)
**Tactic alvo**: Executable Assertions
**Esforço**: M (2–3d — inclui propagar até o UI)
**Findings**: F-testability-5

**Problema**
> `fetchProcessosParaTransacao` e `processarSolicitacaoNumerario` fazem `try { … } catch { return fallback }` sem sinalizar ao chamador que caiu no fixture nem logar a falha. `fetchPainelRecebimentos` já tem `fonte:'fixture'|'banco'` — as outras duas não. Durante uma review de negócio, a UI mostra o payload dry-run "com sucesso" mesmo quando o backend está fora do ar; o QA acredita estar exercitando a integração quando na verdade é fixture puro.

**Melhoria Proposta**
> (a) Mudar as duas funções para devolverem `{ fonte:'backend'|'fixture', data:… }` (ou aceitar um callback `onFallback`) e propagar até o dialog, que pode mostrar um badge "modo simulação local"; (b) adicionar `console.warn` no `catch` para o console do browser gravar a falha; (c) adicionar testes que afirmam a marca `fonte:'fixture'` no fallback e `fonte:'backend'` no happy. Tactic Bass: **Executable Assertions** (visibilidade da falha silenciosa).

**Resultado Esperado**
> Funções com marca `fonte`: 1/3 → 3/3. `catch {}` totalmente silencioso no delta: 3 → 0.

**Métricas de sucesso**
- Funções que expõem `fonte`: 1/3 → 3/3
- `catch {}` silenciosos: 3 → 0

**Risco de não fazer**
> Durante o demo/HML, alguém aprova a feature acreditando ter visto o backend responder quando era fixture; falha real do ERP não é detectada até vir tickets de negócio.

**Dependências**: alinhar com o padrão de indicação de modo demo que a Frente IV já usa em `fetchPainelRecebimentos` (`fonte:'banco'|'fixture'`). Nota: converge com availability-2 e fault-tolerance-6.

---

### [testability-6] Adicionar 1 property-based test para as invariantes do builder de payload SN

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤ 0.25d)
**Findings**: F-testability-6

**Problema**
> `SolicitacaoNumerarioService.gerar` é uma função pura ideal para property testing, mas os 5 testes atuais são gold-masters (exemplos fixos). O repo já tem `fast-check` como dep. Invariantes universais óbvias — `payload.valor === items[0].total === items[0].tmpMnyValor`, `payload.docDtaEmissao === payload.dtaVencimento`, `moeCod = processo.moeCod || DEFAULT` — só são defendidas para os 3 valores exemplo. Cobrir a branch L83 (`moeCod || DEFAULT`) explicitamente é um efeito colateral bem-vindo.

**Melhoria Proposta**
> 1 property em `SolicitacaoNumerarioService.test.ts`: `fc.assert(fc.property(fc.float({min:0.01, max:1e9, noNaN:true}), fc.integer({min:0, max:999}), (valor, moeCod) => { const out = service.gerar({ processo: buildProcesso({ moeCod }), valorTransacao: valor, dataReferencia: DATA, ator:'a' }); expect(out.payload.valor).toBe(valor); expect(out.payload.items[0].total).toBe(valor); expect(out.payload.moeCod).toBe(moeCod || SOLICITACAO_NUMERARIO_MOE_COD); }))`. Tactic Bass: **Executable Assertions**.

**Resultado Esperado**
> Properties no delta SN: 0 → 1. Branch coverage do service: 50% → 100% (elimina L83 uncovered).

**Métricas de sucesso**
- Properties no service SN: 0 → 1
- Branch coverage `SolicitacaoNumerarioService.ts`: 50% → 100%

**Risco de não fazer**
> Baixo hoje (dry-run); médio quando o seam for cabeado (o builder é a última barreira antes do ERP).

**Dependências**: nenhuma; `fast-check` já é dep.
