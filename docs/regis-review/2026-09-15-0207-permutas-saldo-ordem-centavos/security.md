---
qa: Security
qa_slug: security
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
agent: qa-security
generated_at: 2026-09-15T02:35:00Z
scope: backend
score: 7.5
findings_count: 5
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| (a) Analista autenticado sem `admin` (ou insider com JWT válido) OU (b) operador rodando o validador AO VIVO em produção OU (c) atacante externo tentando injeção na string de SQL do novo caminho de saldo | Chama `GET /permutas/gestao` (payload agora inclui `alocacoes` em `ja-permutado`) / dispara `validate-permutas-saldo-ordem-centavos-v1.ts` com credenciais Conexos PRD / envia `docCod` malicioso a `/permutas/adiantamentos/:docCod/*` | Backend Express + PostgreSQL (`permuta_alocacao`, `permuta_alocacao_execucao`, `permuta_bordero`, `permuta_eleicao_run`) + client Conexos + novo script `jobs/validate-permutas-saldo-ordem-centavos-v1.ts` | Produção, canal HTTPS, JWT Supabase válido, PostgreSQL via pooler | Leitura autenticada devolve **200** (payload cresce em `alocacoes` p/ `ja-permutado`, sem novos campos sensíveis); mutação exige role `admin`; validador **recusa** subir se `BASE` for PRD e `PROBE_ALLOW_PRD ≠ '1'`; transação do banco marcada `READ ONLY` e conferida via `SHOW transaction_read_only`; SQL 100% parametrizado nos 4 arquivos do delta | 100% dos ~24 endpoints de mutação em `permutas.ts` gateados por `requireRole('admin')`; 100% das novas queries com placeholders nomeados (0 interpolação de valor em SQL); 0 chamadas a endpoint de escrita do Conexos no validador (9/9 usos são GET/list/detalhe); 0 credenciais logadas |

O delta é **defensivo por natureza** (não introduz endpoint público novo, não muda RBAC, não cria segredo). Traz três superfícies novas a auditar: (1) `SaldoAlocacaoAdiantamentoService` + `listConsumosFinalizados` (repository query com JOIN a 3 tabelas), (2) exposição de `alocacoes` em `ja-permutado` no payload de `/gestao`, e (3) o **validador AO VIVO em Conexos PRD** (`validate-permutas-saldo-ordem-centavos-v1.ts`, 736 linhas) — a única superfície verdadeiramente nova em termos de risco de escrita e vazamento.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded introduzidos pelo delta (`password|secret|token|api[_-]?key|credential|AKIA…`) | 0 | 0 | ✅ | `grep -rEn '(password\|secret\|token\|api[_-]?key\|credential\|AKIA)' src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts …/ToleranciaResiduo.ts …/PermutaExecucaoRepository.ts …/PermutaAlocacaoRepository.ts …/GestaoPermutasService.ts …/ElegibilidadeService.ts jobs/validate-permutas-saldo-ordem-centavos-v1.ts src/frontend/app/permutas/page.tsx src/frontend/app/permutas/components/historico.ts src/frontend/lib/types.ts` → 0 hits |
| `.env` / `*.tfstate` no diff | 0 | 0 | ✅ | `git diff --stat origin/main..HEAD` — nenhum arquivo com esses padrões |
| Interpolação de valor em SQL (`` ` … ${var} … ` ``) nos arquivos do delta | 0 | 0 | ✅ | `grep -nE '\`.*(SELECT\|INSERT\|UPDATE\|DELETE).*\$\{'` em `PermutaAlocacaoRepository.ts`, `PermutaExecucaoRepository.ts` e o validador — os únicos hits do repo são `${SELECT_COLS}` (constante) em `NumerarioExecucaoRepository.ts` (fora do delta) e `${pairList}` (lista de placeholders nomeados, sem valor) em `PermutaExecucaoRepository.ts:589` (fora do delta desta feature) |
| Novos endpoints públicos abertos pelo delta | 0 | ≤ 0 | ✅ | `git diff origin/main..HEAD -- src/backend/routes/permutas.ts` — nenhuma linha `router.` acrescentada |
| Endpoints de mutação novos SEM `requireRole('admin')` | 0 | 0 | ✅ | idem (o delta não muda `permutas.ts`) |
| Rotas de mutação em `permutas.ts` gateadas por `requireRole('admin')` | 24 de 24 | 100% | ✅ | `grep -n 'router.post\|router.delete\|router.put' src/backend/routes/permutas.ts` → 24 hits; `grep -n requireRole …` → 22 hits + 2 handlers privados sem escrita direta (`/permutas/adiantamentos/:docCod/execucoes` GET, `/borderos` GET) |
| Rotas de leitura sensíveis sem RBAC | 1 (`GET /permutas/gestao`) — pré-existente ADR-0043, agravada marginalmente pela adição de `alocacoes` em `ja-permutado` | 0 sem ADR | ⚠️ | `src/backend/routes/permutas.ts:425-433` (sem `requireRole`); `src/backend/domain/service/permutas/GestaoPermutasService.ts:358-362` (novo `exibeAlocacoes = podeAlocar \|\| status === 'ja-permutado'`) |
| Superfície de escrita do validador AO VIVO contra Conexos PRD | 0 chamadas de escrita / 9 chamadas de leitura | 0 escritas | ✅ | `grep -n 'baixa\.\|titulos\.\|cadastro\.' jobs/validate-permutas-saldo-ordem-centavos-v1.ts` → `getDetalheTitulos`, `listBorderos`, `listBaixas`, `getBordero`, `listDeclaracaoByProcesso` (todas READ). Confere com o docblock (linhas 46-53) |
| Guards do validador contra PRD | 3 camadas: (a) recusa `BASE` sem `-hml` sem `PROBE_ALLOW_PRD=1`, (b) `SET TRANSACTION READ ONLY` + `SHOW transaction_read_only='on'`, (c) só endpoints de leitura importados | 3+ | ✅ | `jobs/validate-permutas-saldo-ordem-centavos-v1.ts:58-62,161-167` |
| Guards enforçados no código do validador vs. só documentados no docblock | 2/3 documentadas E enforçadas (URL + READ ONLY); `CONEXOS_WRITE_ENABLED=false`/`CONEXOS_DRY_RUN=true` só documentado (linha 55) | 3/3 | ⚠️ | `jobs/validate-permutas-saldo-ordem-centavos-v1.ts:54-57` (docblock) — nenhum `if (process.env.CONEXOS_WRITE_ENABLED === 'true') exit(1)` no início do `main` |
| Credenciais / tokens logados pelo validador | 0 (log só `BASE` + docCod + valores em BRL + situação de borderô + Δ) | 0 | ✅ | `grep -n 'console\.' jobs/validate-permutas-saldo-ordem-centavos-v1.ts` → 8 hits, todos sobre docCod / número / mensagem operacional |
| Dado sensível (CNPJ/valor/PII) logado pelo `GestaoPermutasService` | Só `requestId`, `pendentes` (contagem), `invoicesEmAberto` (contagem), `casamentos` (contagem) | Só agregados | ✅ | `src/backend/domain/service/permutas/GestaoPermutasService.ts:211-220` |
| Casts `as` não-guardados introduzidos pelo delta em leitura de banco | 0 novos (o mapper novo `mapConsumo` faz guard explícito com `if (status !== 'settled' && status !== 'parcial') return null`) | 0 | ✅ | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:629-642` |
| CORS `*` / bind `0.0.0.0` novo no delta | 0 | 0 | ✅ | `git diff origin/main..HEAD -- src/backend` — nenhum sítio |
| XSS (`dangerouslySetInnerHTML` / `innerHTML`) no delta | 0 | 0 | ✅ | `grep -rEn 'dangerouslySetInnerHTML\|innerHTML' src/frontend/app/permutas src/frontend/lib` → 0 hits |
| Uso de `localStorage`/`sessionStorage` para dado sensível no delta | 0 | 0 | ✅ | `grep -rn 'localStorage\|sessionStorage' src/frontend/app/permutas src/frontend/lib/types.ts` → 0 hits |
| CloudTrail / GuardDuty / IAM least-privilege | ⚠️ **Não medível** — repo não tem `infra/` (deploy Render/Vercel), auth Supabase JWT (sem IAM AWS) | — | N/A | `ls infra/ 2>&1` → não existe |
| `npm audit` (CVEs) | ⚠️ **Não coletado** — modo `--quick` (shared-metrics) | crítico=0, alto=0 | N/A | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Trilha `permuta_alocacao_execucao` grava `executado_por` + `conexos_username`/`conexos_usn_cod` em cada baixa/borderô; `permuta_eleicao_run.triggered_by` grava quem disparou eleição/ingestão. O delta preserva isso — nada removido. Ausente ainda: alarme para padrão anômalo (múltiplas tentativas `403`, execução do validador em PRD por não-operador). | ⚠️ parcial | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:344-346,458-460,486-488` (preservação de identidade em terminais) |
| Detect Service Denial | Fora de escopo do delta — a nova query `listConsumosFinalizados` faz 3 JOINs sobre tabelas ≤ centenas de milhares de linhas; sem impacto agudo. | N/A | Cross-QA — ver Performance/Availability |
| Verify Message Integrity | (a) `SaldoAlocacaoAdiantamentoService.naoConsumido` compara `criadoEm >= atualizadoEm` no MESMO relógio Postgres (integridade da versão da alocação); (b) `mapConsumo` só devolve status ∈ `{settled, parcial}` (guarda explícita); (c) guarda de frescor `b.atualizado_em < r.started_at` impede contar consumo sobre `valorPermutar` ainda não abatido. Sentido "na dúvida não conta" preserva o invariante I-Permuta-1 (Σ alocado ≤ saldo). | ✅ presente | `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts:52-71`; `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211,629-642` |
| Detect Message Delay | Guarda de frescor documentada e enforçada (execução só conta quando o cache viu o borderô finalizado ANTES do início da ingestão). É literalmente uma detecção de "mensagem em atraso" (finalização de borderô que o cache ainda não refletiu). | ✅ presente | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:182-186,200-202` |
| Identify Actors | JWT Supabase → `req.user`; propagado ao `executado_por` / `triggered_by`. Não alterado pelo delta. | ✅ presente | `src/backend/http/auth.ts` (pré-existente) |
| Authenticate Actors | Middleware global de auth (Supabase JWT); rejeita 401 quando ausente. Não alterado. | ✅ presente | `src/backend/http/auth.ts` (pré-existente) |
| Authorize Actors | `requireRole('admin')` em 22 mutações de `/permutas`; 2 leituras administrativas (`/borderos` GET, `/execucoes` GET) também gatiadas. Leitura `/permutas/gestao` **autentica** mas **não** aplica `requireRole` — pré-existente ADR-0043; o delta expande a projeção (adiciona `alocacoes` em `ja-permutado`) mas mantém a política. | ⚠️ parcial | `src/backend/routes/permutas.ts:186-778` (grep `requireRole` = 22 hits); `:425-433` sem gate |
| Limit Access | Mesma constatação: escrita gatiada por `admin`, leitura de projeção inteira aberta a qualquer autenticado. Delta amplia marginalmente o payload de leitura. | ⚠️ parcial | idem |
| Limit Exposure | Delta **não abre nada novo publicamente** (0 rotas novas); expõe apenas o campo `alocacoes` em uma classe de linha que antes não o carregava. O validador AO VIVO é ferramenta de operador (chamado à mão), fora do servidor HTTP. | ✅ presente (marginal) | `src/backend/domain/service/permutas/GestaoPermutasService.ts:358-362`; `jobs/validate-permutas-saldo-ordem-centavos-v1.ts` (não é rota HTTP) |
| Encrypt Data | Não medível — TLS é do Render; segredos em Supabase (env externo). Delta não muda. | N/A | — |
| Separate Entities | Multi-tenant AWS-por-cliente é estado-alvo (CLAUDE.md); repo hoje é single-tenant Columbia via Supabase. Delta não muda. | N/A | — |
| Change Default Settings | Validador **recusa** rodar contra a URL default (PRD) sem `PROBE_ALLOW_PRD=1` explícito. Regra defensiva — "seguro por default". | ✅ presente | `jobs/validate-permutas-saldo-ordem-centavos-v1.ts:58-62` |
| Validate Input | SQL 100% parametrizado nos 4 arquivos do delta (todos os placeholders nomeados via `SqlBuilder`; único uso de template literal com `${…}` no repo é a lista de placeholders `($fil_${i}, $bor_${i})` do `INSERT`/`DELETE` de `permuta_bordero`, fora do delta desta feature — nomes de bind, não valores). `ToleranciaResiduo.adiantamentoTotalmentePago` valida `Number.isFinite` antes de comparar. `mapConsumo` faz guard explícito no status. `ElegibilidadeService.motivoDoGateFalho` é puro sobre entrada tipada. | ✅ presente | `src/backend/domain/repository/permutas/PermutaAlocacaoRepository.ts:114-126,129-141`; `PermutaExecucaoRepository.ts:188-211,629-642`; `src/backend/domain/interface/permutas/ToleranciaResiduo.ts:38-49` |
| Revoke Access | Fora de escopo do delta. | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | Feedback estruturado no validador (grupo/docCod/veredito/razão) — o operador identifica o motivo (`ERP mudou desde a entrevista`, `baixa do par EXISTE em borderô finalizado`, etc.) sem inspecionar dado cru. `AlocacaoExcedeSaldoError` no frontend informa por que a alocação foi recusada. | ✅ presente | `jobs/validate-permutas-saldo-ordem-centavos-v1.ts:414-458,695-728`; `src/frontend/app/permutas/page.tsx:314-320` |
| Restore (overlap Availability) | O delta é reversível por deploy simples (código puro + query nova; sem migration). Reverter restaura o comportamento anterior (que subestimava/superestimava o saldo mas não travava nada mais). | ✅ presente | `git diff --stat origin/main..HEAD` — sem `migrations/*.sql` no delta |
| Audit Trail | Todas as escritas que ficam encadeadas ao novo saldo (upsert de `permuta_alocacao`, `beginExecution`/`markSettled`/`markParcial`/`markError` em `permuta_alocacao_execucao`) preservam identidade (`executado_por` + `conexos_username`/`conexos_usn_cod`) — nada mexido pelo delta. `SaldoAlocacaoAdiantamentoService` é puro/leitura, sem escrita. | ✅ presente | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:344-346,408-409,458-460,486-488` |

## 4. Findings (achados)

### F-security-1: Validador AO VIVO documenta `CONEXOS_WRITE_ENABLED=false`/`CONEXOS_DRY_RUN=true` no docblock, mas **não** os enforça no `main()`

- **Severidade**: P2 (defesa-em-profundidade; sem P0 hoje porque a superfície importada é 100% READ)
- **Tactic violada**: Change Default Settings + Limit Exposure
- **Localização**: `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts:54-62`
- **Evidência (objetiva)**:
  ```typescript
  // Run:
  //   cd src/backend && CONEXOS_WRITE_ENABLED=false CONEXOS_DRY_RUN=true PROBE_ALLOW_PRD=1 \
  //     npx tsx jobs/validate-permutas-saldo-ordem-centavos-v1.ts
  const BASE = process.env.CONEXOS_BASE_URL ?? '';
  if (!BASE.includes('-hml') && process.env.PROBE_ALLOW_PRD !== '1') {
      console.error(`RECUSADO: base é PRODUÇÃO (${BASE}); rode com PROBE_ALLOW_PRD=1.`);
      process.exit(1);
  }
  ```
  Não há `if (process.env.CONEXOS_WRITE_ENABLED === 'true') exit(1)` nem check equivalente para `CONEXOS_DRY_RUN`.
- **Impacto técnico**: hoje **nulo**, porque o script só chama `getDetalheTitulos`, `listBorderos`, `listBaixas`, `getBordero`, `listDeclaracaoByProcesso` (todos GET/list). Amanhã, se alguém acrescentar uma sonda `getBaixa(...)`/`postSomething(...)` "só pra debugar" reutilizando este arquivo, o `.env` do desenvolvedor com `CONEXOS_WRITE_ENABLED=true` (uso normal do backend) subiria a escrita SEM alerta. A instrução do docblock é fácil de ignorar (não é executada).
- **Impacto de negócio**: baixo hoje, alto no cenário de reuso do script como template para outros validadores. Uma escrita acidental em PRD sob a identidade do operador que rodou o script é P0 em qualquer cliente com controle contábil (Columbia audita `usn_cod` do borderô).
- **Métrica de baseline**: 2/3 guards enforçados no código (URL PRD + READ ONLY do banco); 1/3 apenas documentado (`CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`).

### F-security-2: `GET /permutas/gestao` expõe agora `alocacoes` também em `ja-permutado` — leitura sem RBAC, ampliação marginal da projeção pré-existente

- **Severidade**: P2 (débito pré-existente ADR-0043 agravado marginalmente; sem regressão de superfície pública)
- **Tactic violada**: Limit Access, Authorize Actors (granularidade)
- **Localização**: `src/backend/routes/permutas.ts:425-433` (rota sem `requireRole`); `src/backend/domain/service/permutas/GestaoPermutasService.ts:358-362`
- **Evidência (objetiva)**:
  ```typescript
  // GestaoPermutasService.toPendente
  const podeAlocar = status === 'permuta-manual' || status === 'casamento-manual';
  // `ja-permutado` também leva as alocações, SÓ para exibição: o Histórico mostra o
  // que entrou no borderô e deriva o tipo (cross-process) delas (ADR-0046 D4).
  const exibeAlocacoes = podeAlocar || status === 'ja-permutado';
  const alocacoes =
      exibeAlocacoes && alocacoesDoAdto.length > 0
          ? alocacoesDoAdto.map((al) => this.toAlocacaoDetalhe(al))
          : undefined;
  ```
  Um usuário autenticado com role qualquer (ex. `viewer`) recebe agora, além dos campos que já vazavam para `permuta-manual`/`casamento-manual`, o mesmo `alocacoes[]` (invoiceDocCod, invoicePriCod, valorAlocado, taxa, criadoPor, criadoEm) também para os adiantamentos `ja-permutado`. É o mesmo shape, apenas para uma nova classe de linha.
- **Impacto técnico**: nenhum vetor de mutação; a leitura já vazava os mesmos campos para dois outros status. O delta amplia o universo em ~+41% (63 `ja-permutado` da entrevista + 43 executados-sem-DI reclassificados vs. o restante do painel). Nenhum dos campos é PII novo — invoiceDocCod, priCod, valor em USD e nome do analista (`criadoPor` = `usn_cod` do Conexos) já estavam no payload dos outros status.
- **Impacto de negócio**: mesmo do card [security-1] da ADR-0043 (formalizar ADR ou aplicar `requireRole`). Este ciclo não regride nada, mas se a decisão for "leitura tem que ser gatiada por role", o payload agora expõe mais um subconjunto e o ADR precisa contemplá-lo.
- **Métrica de baseline**: 1 rota de leitura sensível sem RBAC (idem ADR-0043); campos `alocacoes[]` agora expostos em 3 status (`permuta-manual`, `casamento-manual`, `ja-permutado`) vs. 2 anteriormente.

### F-security-3: SQL do delta é 100% parametrizado; JOIN novo em `listConsumosFinalizados` não introduz superfície de injeção

- **Severidade**: P3 (positivo — não gera card)
- **Tactic**: Validate Input
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211`; `src/backend/domain/repository/permutas/PermutaAlocacaoRepository.ts:114-126,129-141`
- **Evidência (objetiva)**:
  ```typescript
  // listConsumosFinalizados (delta):
  `SELECT e.adiantamento_doc_cod, e.invoice_doc_cod, e.status, e.valor_residual_usd,
          e.criado_em
   FROM permuta_alocacao_execucao e
   JOIN permuta_bordero b ON b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod
   JOIN permuta_adiantamento a ON a.doc_cod = e.adiantamento_doc_cod
   JOIN permuta_eleicao_run r ON r.id = a.last_ingest_run_id
   WHERE e.dry_run = false
     AND e.status IN ('settled', 'parcial')
     AND b.bor_vld_finalizado = 1
     AND b.bor_cod_estornado IS NULL
     AND b.atualizado_em < r.started_at
     AND ($adtoDocCod::text IS NULL OR e.adiantamento_doc_cod = $adtoDocCod)
   ORDER BY e.adiantamento_doc_cod, e.criado_em`,
  { adtoDocCod: adiantamentoDocCod ?? null },
  ```
  Um único parâmetro externo (`adiantamentoDocCod`), passado como `$adtoDocCod` (bind nomeado), com fallback `null` explícito. `sumByInvoice` do `PermutaAlocacaoRepository` segue o mesmo padrão: `WHERE ($excludeAdto::text IS NULL OR adiantamento_doc_cod <> $excludeAdto)`.
- **Impacto técnico**: 0 vetor de injeção. Nome de tabela, colunas e valores literais (`'settled'`, `'parcial'`) são estáticos.
- **Impacto de negócio**: baixo — reforça a regra #5 do CLAUDE.md.
- **Métrica de baseline**: 0 template literals com `${…}` de valor em SQL nos 4 arquivos do delta (2 `.ts` de repositório + 2 `.ts` de service).

### F-security-4: `mapConsumo` faz guard explícito de status, endurecendo a fronteira leitura-de-banco → domínio

- **Severidade**: P3 (positivo — não gera card; fecha parcialmente o card `security-3` de ADR-0043 na área tocada)
- **Tactic**: Validate Input (defesa em profundidade)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:629-642`
- **Evidência (objetiva)**:
  ```typescript
  /** Guard explícito do terminal: status fora de `settled`/`parcial` é descartado (sem cast). */
  private mapConsumo = (r: Record<string, unknown>): ConsumoExecucaoRow | null => {
      const status = r.status;
      if (status !== 'settled' && status !== 'parcial') return null;
      return {
          adiantamentoDocCod: String(r.adiantamento_doc_cod),
          invoiceDocCod: String(r.invoice_doc_cod),
          status,
          ...(r.valor_residual_usd != null
              ? { valorResidualUsd: Number(r.valor_residual_usd) }
              : {}),
          criadoEm: new Date(r.criado_em as string | Date),
      };
  };
  ```
  Contrasta com `mapRow` na mesma classe (`status: r.status as ExecucaoStatus`, cast cru — dívida pré-existente, escopo do card `security-3` de ADR-0043). O novo caminho de leitura escolheu o padrão defensivo por default.
- **Impacto técnico**: o WHERE da query já filtra `status IN ('settled', 'parcial')`, então o guard é **cinto + suspensório**; mas se o WHERE for editado erradamente amanhã, um status fora do enum não vira `ConsumoExecucaoRow` — vira `null`, descartado no `.flatMap`. Sem cast, sem risco de mentir sobre o dado (que foi o cenário raiz de ADR-0043).
- **Impacto de negócio**: baixo — evita reintrodução de uma classe de bug.
- **Métrica de baseline**: 1 novo mapper de leitura de banco no delta, com guard-com-throw/return-null: 1/1 (100%). Cobertura de parse-com-guard nos mappers do repo (`mapConsumo`, `parseStatusSnapshot`, `parseEstadoElegibilidadeRow`, `mapRow`, `mapRowAlocacao`, …): 3/8 ≈ 37,5% (33% antes do delta).

### F-security-5: Validador loga `docCod` + valores em BRL a stdout; zero credencial / token / JWT logado

- **Severidade**: P3 (informativo — não gera card)
- **Tactic**: Inform Actors vs. minimização de log
- **Localização**: `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts:695-728`
- **Evidência (objetiva)**:
  ```
  console.log('\n=== GROUND TRUTH — permutas-saldo-ordem-centavos v1 (ADR-0046) ===');
  console.log(`BASE ${BASE} · execuções reais terminais=${execucoes.length} · adtos V1=${adtosComExecucao.size}`);
  …
  console.log(`  [${l.veredito}] ${l.docCod}: esperado ${l.esperado} · observado ${l.observado}${l.razao ? ` · razão: ${l.razao}` : ''}`);
  ```
  O conteúdo interpolado é: `BASE` (URL do ERP, não secret), `docCod` (id opaco do documento), valores em BRL/USD, `borCod`, situação de borderô. Nenhum JWT, session token, `Bearer …`, ou credencial Conexos. `ConexosBaseClient` (não tocado no delta) já esconde a sessão dos logs (uso indireto via `runWithRetry`).
- **Impacto técnico**: log operacional — vai para o terminal do operador (não para logs centralizados). Se o operador exportar/compartilhar o output, expõe passivo financeiro (BRL/USD por adiantamento) — dado sensível de negócio, não credencial. Mesma sensibilidade do XLSX de relatório que o próprio painel já exporta.
- **Impacto de negócio**: baixo — output é para uso interno do desenvolvedor no gate `GroundTruthValidator`.
- **Métrica de baseline**: 0 credenciais / 0 tokens / 0 headers de auth logados; N valores financeiros logados por execução (esperado — é a natureza do validador).

## 5. Cards Kanban

### [security-1] Enforçar `CONEXOS_WRITE_ENABLED=false`/`CONEXOS_DRY_RUN=true` no `main()` do validador AO VIVO (defesa em profundidade)

- **Problema**
  > `jobs/validate-permutas-saldo-ordem-centavos-v1.ts:54-57` documenta no docblock que o validador deve rodar com `CONEXOS_WRITE_ENABLED=false CONEXOS_DRY_RUN=true PROBE_ALLOW_PRD=1`, mas apenas o guard de URL (`PROBE_ALLOW_PRD`) e a `SET TRANSACTION READ ONLY` do banco são checados no código. Hoje isso não vaza (o script só chama endpoints GET/list do Conexos). Amanhã, um desenvolvedor que copie este arquivo como template para uma outra sonda e acrescente uma chamada de escrita "temporária" passa a rodar com o `CONEXOS_WRITE_ENABLED=true` do próprio `.env` (default de trabalho no backend) sem alarme.

- **Melhoria Proposta**
  > Duas linhas defensivas no topo do `main()`:
  > ```typescript
  > if (process.env.CONEXOS_WRITE_ENABLED !== 'false') { console.error('RECUSADO: rode com CONEXOS_WRITE_ENABLED=false'); process.exit(1); }
  > if (process.env.CONEXOS_DRY_RUN !== 'true') { console.error('RECUSADO: rode com CONEXOS_DRY_RUN=true'); process.exit(1); }
  > ```
  > Se preferir centralizar (padrão para futuras sondas), extrair `requireReadOnlyEnv()` em `src/backend/jobs/_shared/readOnlyEnv.ts` e chamar dos scripts `validate-*` e `probe-*`. Tactic: Change Default Settings + Limit Exposure.

- **Resultado Esperado**
  > Os 3 guards documentados passam a ser 3 guards executados. Guards do validador enforçados vs. documentados: 2/3 → 3/3.

- **Tactic alvo**: Change Default Settings + Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Env vars checadas no início do `main()`: 1 (`PROBE_ALLOW_PRD`) → 3 (`+CONEXOS_WRITE_ENABLED`, `+CONEXOS_DRY_RUN`)
  - Sondas futuras que reusam o padrão (via `_shared/readOnlyEnv.ts`, se adotado): 0 → N
- **Risco de não fazer**: em 6 meses, um `probe-*.ts` ou `validate-*.ts` novo é escrito a partir deste template e um desenvolvedor acrescenta um `POST` "só pra testar" com o `.env` do backend. A escrita vai para PRD sob a identidade do operador. É a versão sondaAO_VIVO do bug que a Regis-Review da ADR-0043 já pegou (asserção fraca em RBAC): defesa "documentada" que nunca foi exercitada é decorativa.
- **Dependências**: nenhuma

### [security-2] Reavaliar leitura sem RBAC de `/permutas/gestao` à luz da expansão do payload (delta adiciona `alocacoes` em `ja-permutado`)

- **Problema**
  > Card `security-1` da ADR-0043 já apontou que `GET /permutas/gestao` responde 200 para qualquer autenticado. Este delta amplia marginalmente a projeção: `alocacoes[]` (invoiceDocCod, invoicePriCod, valorAlocado, taxa, criadoPor) agora aparece também em `ja-permutado` — não é PII novo, mas amplia o universo do vazamento (~+41% em contagem de linhas na entrevista: 63 novos `ja-permutado` INOX + 43 executados reclassificados sem D.I). Enquanto o card [security-1] ADR-0043 não fecha (formalização de ADR ou aplicação de `requireRole`), este ciclo só piora marginalmente a mesma exposição.

- **Melhoria Proposta**
  > Fechar o card `security-1` de ADR-0043 (ADR curta OU `requireRole` na rota), reconhecendo no texto que o payload cresceu para incluir `alocacoes[]` em `ja-permutado`. Se o caminho escolhido for `requireRole('analyst')`, ele passa a proteger 3 classes de status (`permuta-manual`, `casamento-manual`, `ja-permutado`) que hoje carregam alocação. Tactic: Authorize Actors + Limit Access.

- **Resultado Esperado**
  > Política de leitura de `/permutas/gestao` documentada por ADR (referenciando D4 de ADR-0046) OU gatiada por role. Rotas de leitura sensíveis sem RBAC e sem ADR: 1 → 0 (contagem mantida com justificativa) ou 0 (contagem zerada).

- **Tactic alvo**: Authorize Actors + Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — fechamento do card pré-existente
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Rotas de leitura sensíveis sem RBAC e sem ADR justificando: 1 → 0
  - ADR referenciando D4 de ADR-0046 (exposição de `alocacoes` em `ja-permutado`): 0 → 1
- **Risco de não fazer**: cada nova feature amplia o payload de `/gestao` marginalmente; em 6 meses, a projeção acumula campos e o vazamento cresce sem que o RBAC seja revisitado. A discussão de política volta em cada Regis-Review e a decisão fica postergada.
- **Dependências**: [security-1] da ADR-0043 (`fix/permuta-snapshot-estados`), ainda em aberto.

### [security-3] Alarme de execução do validador AO VIVO em PRD (correlacionar `PROBE_ALLOW_PRD=1` a operador identificado)

- **Problema**
  > O validador AO VIVO tem 3 guards contra escrita acidental (ver F-security-1), mas nenhum sinal de observabilidade externa: se rodar em PRD, ninguém fora do terminal do operador sabe. As chamadas a Conexos aparecem no log do ERP como leituras normais do usuário de serviço, sem carimbo distintivo. Um insider poderia rodar o validador para varrer a base de adiantamentos (BRL/USD por linha) sem levantar suspeita.

- **Melhoria Proposta**
  > Duas ações combinadas:
  > 1. Enviar 1 evento estruturado ao logger central (Sentry/CloudWatch — o que existir) no início da execução do validador quando `PROBE_ALLOW_PRD=1` estiver ativo: `{ script: 'validate-permutas-saldo-ordem-centavos-v1', base: BASE, operator: process.env.USER ?? 'unknown', started_at: new Date().toISOString() }`.
  > 2. Documentar em `CLAUDE.md` (seção "Ground truth AO VIVO"): "Toda execução do validador contra PRD gera alarme no canal `#ops-ground-truth`; a intenção é revisão retroativa, não bloqueio". Tactic: Detect Intrusion + Audit Trail.

- **Resultado Esperado**
  > Execuções do validador contra PRD são visíveis fora do terminal do operador. Sinal de "quem rodou o quê contra qual BASE" fica auditável mesmo depois do terminal fechar.

- **Tactic alvo**: Detect Intrusion + Audit Trail
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1, F-security-5
- **Métricas de sucesso**:
  - Execuções do validador contra PRD com evento estruturado emitido: 0 → 100%
  - Presença de subseção em `CLAUDE.md` documentando o alarme: 0 → 1
- **Risco de não fazer**: baixo — o validador ainda é ferramenta de desenvolvedor. Alto se num ano ele virar uma sonda de rotina disparada por múltiplos operadores; sem sinal externo, um mal-uso vira invisível.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo estrito ao delta.** Não re-abri o card `security-1` de ADR-0043 (leitura sem RBAC) como novo P0/P1 — o delta amplia a projeção marginalmente (F-security-2), então virou card P2 [security-2] que **depende** de fechar o card pré-existente. Sem regressão nova, sem P0.
- **F-security-1 (validador) é o achado central do delta.** Reportado como P2 e não P0/P1 porque a superfície *importada* é 100% READ hoje — a exposição é pela porta aberta ao futuro, não pela porta aberta agora. Métrica de baseline objetiva: 2/3 guards enforçados vs. 3/3 documentados. Se amanhã alguém adicionar uma chamada de escrita, o achado escala para P0.
- **Cross-QA:**
  - *Validate Input* — `mapConsumo` com guard explícito (F-security-4) é insumo do agent **Integrability** (fronteira leitura-de-banco → domínio) e do **Fault Tolerance** (WHERE da query + guard = defesa dupla contra status fora do enum).
  - *Limit Exposure* — alerta ao agent **Availability** que o payload de `/permutas/gestao` cresceu (`alocacoes` em `ja-permutado`); custo de rede/serialização proporcional à contagem de `ja-permutado` (63+43 na entrevista) — cross-check com Performance.
  - *Audit Trail* — nada mexido pelo delta; o card `[fault-tolerance-*]` da ADR-0043 sobre `triggered_by` continua vivo.
  - *Change Default Settings* — o validador é um caso didático da tactic: URL PRD é o default do `.env` do dev, o script tem que **recusar** por default. Coordenar com o agent **Deployability** (gate `GroundTruthValidator`).
- **Métricas que tentei coletar e falhei:** `npm audit` (modo `--quick`), IAM/CloudTrail (repo não tem `infra/`).
