---
qa: Security
qa_slug: security
run_id: 2026-09-08-2011-permuta-snapshot-estados
agent: qa-security
generated_at: 2026-09-08T20:35:00Z
scope: backend
score: 7.5
findings_count: 5
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Ator interno (analista com credencial legítima, mas fora do papel `admin`) OU insider malicioso com acesso ao repo | Tenta invocar mutação financeira (`POST /permutas/eleicao`, `POST /permutas/ingestao`, `POST /permutas/adiantamentos/:docCod/alocacoes`) OU tenta ler a projeção de gestão inteira (`GET /permutas/gestao`) | Backend Express + Postgres com o snapshot da eleição e o modelo relacional de permutas (`permuta_candidata_snapshot`, `permuta_adiantamento`, `permuta_eleicao_run`) | Produção, JWT Supabase válido, canal HTTPS | Mutações rejeitadas com **403** pelo `requireRole('admin')`; leituras autenticadas devolvem **200** e são gravadas com `triggered_by` na trilha de auditoria; SQL 100% parametrizado; nenhuma escrita fora dos 5 estados da máquina | 100% das rotas de mutação exigem role `admin` (7/7 medidas); 100% das rotas de leitura autenticam (JWT obrigatório); 0 interpolações de SQL; auditoria (`triggered_by`) presente em todas as escritas |

O delta *não introduz* novas superfícies de ataque — remove uma (`GET /permutas/painel` e `PainelService`) e endurece o parsing de dois campos lidos do banco. O ponto alto da revisão é uma **descoberta de método**: em `origin/main`, a asserção de RBAC de leitura no `permutas.test.ts` era um teste-vitrine que passava por acidente (mock registrado com o nome de método errado, resposta 500 aceita por `.not.toBe(403)`). O delta corrige isso e a sonda passa a exercitar o caminho real.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded introduzidos pelo delta (`password|secret|token|api[_-]?key|credential|AKIA…`) | 0 | 0 | ✅ | `grep -rEn '(password\|secret\|token\|api[_-]?key\|credential\|AKIA)' src/backend/migrations/0054_estado_ja_permutado.sql src/backend/jobs/probe-impacto-*.ts` |
| `.env` / `*.tfstate` no diff | 0 | 0 | ✅ | `git status` do worktree — nenhum arquivo com esses padrões |
| Interpolação de valor em SQL (`` ` … ${var} … ` ``) nos arquivos do delta | 0 | 0 | ✅ | `grep -nE '\`.*(SELECT\|INSERT\|UPDATE\|DELETE).*\\\$\{' src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts …` |
| Rotas de mutação sem `requireRole('admin')` no `permutas.ts` | 0 de 7 mensuradas | 0 | ✅ | `src/backend/routes/permutas.test.ts:614-627` — array `mutacoes` cobre 7 combinações method+path, todas retornam 403 quando `role:'authenticated'` |
| Sonda de RBAC de leitura efetivamente exercitando o handler | 1 de 1 (`GET /permutas/gestao`) | 1 de 1 | ✅ | `src/backend/routes/permutas.test.ts:646-653` — `exporGestao` mockado, `expect(leitura.status).toBe(200)`, `expect(exporGestao).toHaveBeenCalled()` |
| Sondas de RBAC com asserção fraca (`.not.toBe(403)` / `.not.toBe(200)` / `.not.toBe(401)`) em `src/backend/routes/*.test.ts` | 0 vivas (1 ocorrência sobreviveu apenas como texto de comentário de auditoria) | 0 | ✅ | `grep -n 'not\.toBe(403)\|not\.toBe(401)\|not\.toBe(200)' src/backend/routes/*.test.ts` → único hit é `permutas.test.ts:632` **dentro do comentário** que documenta o defeito removido |
| Rotas de leitura sem RBAC (só autenticadas) | 1 conhecida (`GET /permutas/gestao`) — decisão de produto assumida | ⚠️ | `src/backend/routes/permutas.ts:423-431` (sem `requireRole`) — pré-existente em `origin/main`; o delta apenas nomeia o comportamento no teste |
| Novos endpoints públicos abertos pelo delta | 0 (na verdade **-1** — `GET /permutas/painel` removido) | ≤ 0 | ✅ | `src/backend/routes/permutas.ts:772-778` (comentário de revogação); grep por `router.` no arquivo confirma que não sobrou handler órfão |
| Auditoria (`triggered_by`) presente nas escritas do delta | 4 de 4 sítios de mutação (POST /eleicao, POST /ingestao, EleicaoPermutasService, IngestaoPermutasService) | 100% | ✅ | `grep -rn 'triggered_by\|triggeredBy' src/backend/routes/permutas.ts src/backend/domain/service/permutas/` |
| Casts `as` não-guardados sobre leitura de banco introduzidos/mantidos no delta | 4 (`motivoBloqueio`, `variante`, `bloqueadas_by_motivo`, `RunStatus`); 2 endurecidos com `parseX` que faz `throw` (`estado_elegibilidade`, `status` do snapshot) | 0 idealmente, mas superfície é confiada (Postgres próprio) | ⚠️ | `grep -nE 'as [A-Z]' src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts src/backend/domain/repository/permutas/PermutaRelationalRepository.ts` |
| Vazamento de dado sensível em `RAISE EXCEPTION` da migration 0054 | Só `run_id` (UUID interno) + contagens agregadas (inteiros); zero PII / valor financeiro / credencial | Nenhum PII / segredo | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:108-121` |
| CORS `*` / bind `0.0.0.0` novo no delta | 0 | 0 | ✅ | `grep -rEn '0\.0\.0\.0\|Access-Control-Allow-Origin' src/backend` — nenhum sítio novo |
| XSS surface (`dangerouslySetInnerHTML` / `innerHTML`) no delta | ⚠️ Não aplicável — `src/frontend/` não tem arquivo no diff | 0 | N/A | shared-metrics: "src/frontend/ no diff: ✅ nenhum arquivo" |
| CloudTrail / GuardDuty / IAM least-privilege | ⚠️ **Não medível localmente** — não existe `infra/` neste repo (deploy via Render hook), auth é Supabase JWT (não IAM AWS). CLAUDE.md marca a infra AWS como estado-alvo. | — | N/A | `ls infra/ 2>&1` → não existe |
| `npm audit` (CVE) | ⚠️ **Não coletado** — modo `--quick` (shared-metrics linha 80) | crítico=0, alto=0 | N/A | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Trilha de auditoria persistida grava `triggered_by` em cada eleição/ingestão manual, correlacionando invocação anômala a uma identidade | ⚠️ parcial | `src/backend/routes/permutas.ts:193-200,227-230` — mas não há alarme para tentativas repetidas de mutação por role não-admin (só `expect(res.status).toBe(403)` no teste; nada agrega em produção) |
| Detect Service Denial | Fora de escopo do delta (`IngestaoCoalescerService` cuida de coalescência, medido em Availability) | N/A | Cross-QA — ver Availability/Fault Tolerance |
| Verify Message Integrity | Snapshot da run + header convergem por construção (`persistRun` grava ambos numa transação; `EleicaoTotals` é o mesmo shape do bloco de totais do header). A migration 0054 aborta se a reconciliação de 250 runs históricas não fechar. | ✅ presente | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:31-53`; `src/backend/migrations/0054_estado_ja_permutado.sql:105-146` (bloco DO/RAISE) |
| Detect Message Delay | N/A neste delta | N/A | — |
| Identify Actors | JWT Supabase resolve `req.user.sub`/`email`; propagado como `triggered_by` na trilha | ✅ presente | `src/backend/routes/permutas.ts:193,227` |
| Authenticate Actors | Middleware global de auth (Supabase JWT); rejeita 401 quando ausente. Testes reproduzem o middleware em `buildApp` e cobrem 401. | ✅ presente | `src/backend/routes/permutas.test.ts:41-52` (mock do middleware), `:104-110` (assert 401) |
| Authorize Actors | `requireRole('admin')` em 7 mutações de `/permutas` (cobertura verificada por teste; asserção deste ciclo passou a ser real). Leitura em `/permutas/gestao` autentica mas NÃO gateia por role — documentado no teste. | ⚠️ parcial | `src/backend/routes/permutas.test.ts:614-651`. Leitura sem RBAC: `src/backend/routes/permutas.ts:423-431` |
| Limit Access | Só `admin` executa mutação; leitura autenticada libera projeção inteira de permutas | ⚠️ parcial | idem |
| Limit Exposure | **Delta reduz superfície**: `GET /permutas/painel` e `PainelService` removidos (ADR-0043 §5) — endpoint público a menos, e o segundo implementador de `exporNoPainel` que era o vetor de dessincronia entre snapshot e header sai do repo. | ✅ presente | `src/backend/routes/permutas.ts:772-778`; `PainelService.ts` / `PainelService.test.ts` deletados (git status) |
| Encrypt Data | Não medível — `src/frontend/` fora do delta; TLS é do Render (não configurável no repo). Segredos em Supabase (env externo). | N/A | — |
| Separate Entities | Multi-tenant AWS-por-cliente é estado-alvo — não medível neste repo (não há `infra/`). | N/A | CLAUDE.md, seção "Estado Atual vs. Alvo" |
| Change Default Settings | N/A neste delta | N/A | — |
| Validate Input | SQL 100% parametrizado nos arquivos tocados (INSERT multi-row usa `SqlBuilder` com `$nome_i`, valores no objeto `params`, tuplas só interpolam nomes de placeholder). `parseStatusSnapshot` e `parseEstadoElegibilidadeRow` **falham alto** (throw) em valor fora da máquina — substituem o catch-all silencioso que era o próprio bug do ADR-0043. Casts `as` remanescentes (`motivoBloqueio`, `variante`, `bloqueadas_by_motivo`, `RunStatus`) leem de colunas próprias com CHECK ou taxonomia aberta; documentados, não endurecidos. | ✅ presente (com dívida P3) | `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:95-109,375-410`; `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:45-60,627` |
| Revoke Access | Fora de escopo do delta (rotação de JWT é do Supabase) | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | Feedback 403 explícito nas mutações; `RAISE EXCEPTION` da 0054 traz números dos dois lados da reconciliação (operabilidade no incidente) | ✅ presente | `src/backend/migrations/0054_estado_ja_permutado.sql:141-148` |
| Restore (overlap Availability) | 0054 é auto-abortante — se a asserção falha, `ROLLBACK` implícito da transação simples do runner, sem estado intermediário | ✅ presente | `src/backend/migrations/0054_estado_ja_permutado.sql:59-64` (comentário do runner), `146-148` (RAISE) |
| Audit Trail | Cada mutação persiste `triggered_by` = `req.user.sub` (fallback `email`, fallback `'unknown'`); `permuta_eleicao_run` liga run_id → identidade → totais | ✅ presente | `src/backend/routes/permutas.ts:193-200,227-230`; `src/backend/domain/service/permutas/EleicaoPermutasService.ts:388,423`; `src/backend/domain/service/permutas/IngestaoPermutasService.ts:92,134,193` |

## 4. Findings (achados)

### F-security-1: A sonda de RBAC de leitura em `origin/main` passava por acidente — delta corrige e a asserção passa a exercitar o caminho real

- **Severidade**: P1 (achado *neutralizado pelo delta* — reportado para não ser esquecido no consolidator e para justificar a métrica de sweep no repo)
- **Tactic violada**: Authorize Actors + (meta) Testability — a defesa existia no código, mas o teste que a "provava" não a exercitava
- **Localização**: `src/backend/routes/permutas.test.ts:646-653` (novo); `origin/main` tinha em `:685-690` a versão defeituosa
- **Evidência (objetiva)**:
  ```
  # origin/main (defeito):
  container.registerInstance(PainelService, {
      montarPainel: jest.fn().mockResolvedValue({ pendencias: [], totais: {} }),
  } as never);
  const leitura = await fetch(`${server.url}/permutas/painel`);
  expect(leitura.status).not.toBe(403);
  #
  # A rota chamava `service.exporNoPainel(...)` — método NÃO registrado no mock —
  # o container devolvia um objeto sem esse método → TypeError → 500. E 500 !== 403,
  # então `.not.toBe(403)` passava. Zero cobertura efetiva da regra de RBAC de leitura.
  ```
  ```
  # fix/permuta-snapshot-estados (correto):
  const exporGestao = jest.fn().mockResolvedValue({ fonte: 'banco', ... });
  container.registerInstance(GestaoPermutasService, { exporGestao } as never);
  const leitura = await fetch(`${server.url}/permutas/gestao`);
  expect(leitura.status).toBe(200);
  expect(exporGestao).toHaveBeenCalled();
  ```
- **Impacto técnico**: quatro problemas se combinaram — (a) endpoint sondado (`/painel`) sem consumidor no frontend; (b) mock com nome de método divergente do handler; (c) asserção negativa (`not.toBe`); (d) sem verificação de invocação do mock. Uma regressão de RBAC de leitura em `/permutas/painel` teria passado com 100% verde.
- **Impacto de negócio**: a asserção que "provava" que a leitura estava aberta a qualquer papel era decorativa. Se amanhã alguém acrescentar `requireRole('admin')` na leitura por engano ou o inverso — remover `requireRole` de uma mutação —, este tipo de teste-vitrine não protege. O ganho concreto do delta: uma sonda que **falha** quando o comportamento real muda.
- **Métrica de baseline**: pattern "`.not.toBe(403|401|200)`" em `src/backend/routes/*.test.ts` = **0** ocorrências vivas após o delta (1 hit no comentário de auditoria do próprio `permutas.test.ts`). Antes do delta: **1** ocorrência ativa em teste RBAC.

### F-security-2: Sweep no repo — nenhuma outra sonda RBAC com asserção fraca

- **Severidade**: P3 (positivo — não gera card)
- **Tactic**: Authorize Actors
- **Localização**: `src/backend/routes/*.test.ts` (11 arquivos varridos)
- **Evidência (objetiva)**:
  ```
  $ grep -n "not\.toBe(403)\|not\.toBe(401)\|not\.toBe(200)" src/backend/routes/*.test.ts
  src/backend/routes/permutas.test.ts:632: // 500 e o `not.toBe(403)` passava POR ACIDENTE, sem exercitar o
  # (único hit é dentro do comentário de auditoria — não é asserção ativa)
  ```
  ```
  $ grep -n "\.toBe(403)" src/backend/routes/{operacao,sispag,recebimentos,permutas}.test.ts | wc -l
  35
  # Todas asserções positivas de equalidade. Os testes RBAC no sispag.test.ts
  # (linhas 157-680) e recebimentos.test.ts (linhas 95-447) usam `expect(res.status).toBe(403)`
  # com role `viewer`/`user` — padrão sadio.
  ```
- **Impacto técnico**: baixo — a asserção defeituosa era localizada. Padrão dominante no repo já é o correto.
- **Impacto de negócio**: reforça que o *defeito de teste* que a ADR-0043 destravou era pontual, não sistêmico.
- **Métrica de baseline**: 0 ocorrências vivas do anti-padrão em 11 arquivos de teste de rotas.

### F-security-3: `GET /permutas/gestao` — leitura autenticada, mas sem RBAC — libera a projeção inteira do domínio a qualquer role

- **Severidade**: P2 (débito pré-existente — não introduzido pelo delta, mas o delta é a primeira vez que o comportamento é *explicitamente afirmado* em teste, o que o torna revisável)
- **Tactic violada**: Limit Access, Authorize Actors (granularidade)
- **Localização**: `src/backend/routes/permutas.ts:423-431` (handler sem `requireRole`); `src/backend/routes/permutas.test.ts:629-651` (teste que verbaliza a decisão)
- **Evidência (objetiva)**:
  ```typescript
  router.get(
      '/gestao',
      asyncHandler(async (req, res) => {
          await bootstrapAppContainer();
          const service = container.resolve(GestaoPermutasService);
          const gestao = await service.exporGestao(req.requestId);
          res.json(gestao);
      }),
  );
  ```
  ```
  # Payload devolvido em `exporGestao`: pendentes[], invoicesEmAberto[], casamentos[],
  # totais{elegiveis, bloqueadas, casamentoManual, permutaManual, jaPermutado, ...}.
  # Cada pendente carrega `docCod`, `priCod`, `pesCod` do importador, valores em BRL,
  # aging. Um usuário autenticado com role qualquer (ex. `authenticated`, `viewer`)
  # lê a lista inteira, mesmo sem poder alterar nada.
  ```
- **Impacto técnico**: nenhuma escrita é possível sem `admin` (verificado no teste `RBAC — requireRole nas rotas de mutação`, 7 combinações). Mas o inventário completo de adiantamentos pendentes, invoices em aberto, valores e importadores é legível por qualquer conta autenticada.
- **Impacto de negócio**: se o produto exige que "analista sem role admin não vê passivo consolidado" (não é o caso hoje — decisão de produto assumida), a rota vaza. Se a decisão é intencional (dashboard operacional para todos os autenticados), formalizar em ADR fecha a revisão. **Este achado não bloqueia o delta**; sinaliza-se ao consolidator porque a nova sonda de RBAC o tornou observável.
- **Métrica de baseline**: 1 rota de leitura sensível sem RBAC vs. 7 rotas de mutação com RBAC = *split* 87,5% mutação gatiada / 0% leitura gatiada. Confirma a política atual: gate na escrita, não na leitura.

### F-security-4: Casts `as` não-guardados em leitura de banco — 4 sítios, superfície confiada, sem vetor de injeção

- **Severidade**: P3 (dívida de robustez; sem risco de injeção)
- **Tactic**: Validate Input (defesa em profundidade)
- **Localização**:
  - `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:255` — `JSON.parse(row.bloqueadas_by_motivo) as Record<string, number>`
  - `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:303` — `status: r.status as RunStatus`
  - `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:432` — `motivoBloqueio: String(r.motivo_bloqueio) as MotivoBloqueio`
  - `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:666` — `variante: String(r.variante) as DeclaracaoRow['variante']`
- **Evidência (objetiva)**:
  ```typescript
  // Delta ENDURECEU 2 casts (parseStatusSnapshot / parseEstadoElegibilidadeRow, ambos throw
  // em valor fora do enum) e DEIXOU 4. Motivos documentados:
  //  - motivo_bloqueio: coluna TEXT livre no banco (sem CHECK), taxonomia aberta, endurecer
  //    trocaria perda de informação por perda de disponibilidade (comentário :425-432).
  //  - variante: fechada pela CHECK do banco (ADR fora do ciclo).
  //  - bloqueadas_by_motivo: JSON escrito pelo próprio serviço na mesma tx.
  //  - RunStatus (mapRunSummary): fechado por CHECK.
  ```
- **Impacto técnico**: **não é vetor de injeção** — os valores já estão em colunas TEXT do próprio Postgres, gravados pelo próprio serviço, e vão para JSON de resposta (não para SQL, shell ou eval). Um valor fora do enum passa como `string` e o frontend renderiza como texto. A pior consequência: tipo TS mente sobre o dado, e uma métrica agregada quebra silenciosamente (retomando o próprio bug que a ADR-0043 corrige). O delta endureceu exatamente onde havia histórico de sinal errado.
- **Impacto de negócio**: baixo; ver acima.
- **Métrica de baseline**: 4 casts não-guardados / 6 casts totais em leitura de banco no delta = 33% cobertura de parse-com-throw. Antes do delta: 0/6.

### F-security-5: `RAISE EXCEPTION` da migration 0054 emite `run_id` (UUID) e contagens agregadas — nenhum PII ou valor financeiro

- **Severidade**: P3 (informativo — não gera card)
- **Tactic**: Inform Actors vs. minimização de log
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:105-148`
- **Evidência (objetiva)**:
  ```sql
  mensagem := format(
      'Migration 0054 ABORTADA: %s run(s) de eleicao divergem entre o header gravado e o '
      'snapshot reclassificado por motivo. ...  Divergencias: %s',
      divergentes, detalhe
  );
  RAISE EXCEPTION '%', mensagem;
  ```
  O conteúdo interpolado é `d.run_id` (UUID interno), contagens `header_elegiveis`, `snapshot_elegiveis`, `header_bloqueadas`, `snapshot_bloqueadas`, `header_candidatas`, `snapshot_candidatas` — todos inteiros ou identificadores opacos.
- **Impacto técnico**: nenhum vazamento de CNPJ, valor em BRL, credencial, chave de conexão. A mensagem é operacional (o on-call precisa dos números dos dois lados para diagnosticar). Vai para o log do runner de migration + `stderr` do container Render.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 0 campos PII / 0 credenciais / 6 inteiros + 1 UUID por linha divergente.

## 5. Cards Kanban

### [security-1] Formalizar a decisão "leitura de `/permutas/gestao` é aberta a qualquer autenticado"

- **Problema**
  > `GET /permutas/gestao` responde 200 para qualquer role (o teste `RBAC — requireRole nas rotas de mutação` afirma isso explicitamente ao mockar `exporGestao` e assertar `expect(leitura.status).toBe(200)`). O payload traz o passivo consolidado — pendentes, invoicesEmAberto, casamentos e totais por estado, incluindo `pesCod`/`importador` e valores. Enquanto as 7 mutações medidas são gatiadas por `requireRole('admin')`, a leitura mais rica do domínio não é. Não é claro no repo se essa é uma decisão de produto ou uma omissão histórica — este ciclo é a primeira vez que o comportamento é assumido por teste.

- **Melhoria Proposta**
  > Uma de duas ações concretas, à escolha do produto (ADR curta em `ontology/decisions/`):
  > 1. **Se é intencional** (dashboard operacional visível a todo analista autenticado): registrar ADR-0044 "Leitura de `/permutas/gestao` é aberta a todo autenticado" e adicionar comentário explícito em `src/backend/routes/permutas.ts:423` remetendo à ADR. O teste atual já documenta o comportamento — só falta a justificativa de negócio ao lado.
  > 2. **Se não é**: aplicar `requireRole('analyst')` (ou role a definir) no handler e adicionar caso `role: 'viewer'` → 403 no bloco RBAC do teste. Tactic: Authorize Actors + Limit Access.

- **Resultado Esperado**
  > Política de leitura em `/permutas/gestao` documentada por ADR OU gatiada por role — nunca "porque o teste diz que sim". Rotas de leitura sem RBAC no `permutas.ts`: 1 → **0 sem justificativa ADR** (aceito 1 com ADR).

- **Tactic alvo**: Authorize Actors / Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Rotas de leitura sensíveis sem RBAC e sem ADR justificando: 1 → 0
  - Presença de ADR sobre a política de leitura de `/gestao`: 0 → 1
- **Risco de não fazer**: em 6 meses, uma discussão sobre "quem pode ver o passivo consolidado" ressurge (SOX, compliance, cliente demandando LGPD do CNPJ) e o repositório não tem resposta escrita. Alguém acrescenta `requireRole` sem contexto, quebra fluxos de analista sem role admin, ou o contrário: mantém o comportamento e não sabe defender por quê.
- **Dependências**: nenhuma

### [security-2] Rodar sweep periódico do anti-padrão `.not.toBe(4xx|2xx)` em asserções de autorização

- **Problema**
  > O achado F-security-1 mostra que uma sonda de RBAC ficou vazia por meses porque combinava (a) mock com nome de método errado + (b) asserção negativa (`.not.toBe(403)`) + (c) ausência de `toHaveBeenCalled`. A varredura atual no worktree mostra que o anti-padrão está morto no repo (0 hits vivos em `src/backend/routes/*.test.ts`), mas nada impede sua reintrodução — biome/eslint não têm regra para "asserção negativa em teste de autorização".

- **Melhoria Proposta**
  > Duas opções, empilháveis:
  > 1. Regra custom simples de biome/eslint ou script `scripts/lint-tests-authz.sh` chamado no CI: proíbe `\.not\.toBe\((200|201|401|403)\)` em `**/*.test.ts` dentro de descrição contendo `RBAC|requireRole|role|auth`. Falha o build com mensagem `"asserção negativa em teste de autorização — use expect(status).toBe(200) e expect(mock).toHaveBeenCalled()"`.
  > 2. Convenção documentada em `CLAUDE.md` (Testing rules): "Testes de RBAC afirmam por igualdade (`.toBe(N)`) e verificam invocação do mock do serviço (`.toHaveBeenCalled()`) — nunca `.not.toBe`".
  > Tactic: Authorize Actors (indireta, via qualidade da defesa).

- **Resultado Esperado**
  > Anti-padrão `.not.toBe(...)` em teste de autorização é rejeitado no CI ou pelo linter. Contagem futura: **0 sustentada**.

- **Tactic alvo**: Authorize Actors (via robustez do teste)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Ocorrências vivas de `\.not\.toBe\((401|403|200)\)` em `**/*.test.ts` de rotas: 0 (mantido)
  - Presença de check automatizado no CI ou lint: 0 → 1
- **Risco de não fazer**: em 12 meses, com 200+ suítes de teste, alguém escreve `.not.toBe(403)` porque não sabe qual código esperar. A defesa aparente cresce, a defesa efetiva estagna. F-security-1 se repete em outro endpoint.
- **Dependências**: nenhuma

### [security-3] Endurecer os 4 casts `as` remanescentes com parse-com-throw (defesa em profundidade)

- **Problema**
  > O delta endureceu `parseStatusSnapshot` e `parseEstadoElegibilidadeRow` para lançar em valor fora do enum — que é *exatamente* a origem do bug que a ADR-0043 corrige. Restam 4 casts sem parse: `motivoBloqueio` (coluna sem CHECK, taxonomia aberta — endurecer trocaria perda de informação por perda de disponibilidade), `variante` (CHECK no banco), `bloqueadas_by_motivo` (JSON escrito pelo próprio serviço na mesma tx), `RunStatus` (CHECK no banco). Nenhum é vetor de injeção. Mas a assimetria — 2 endurecidos, 4 não — cria dívida cognitiva: por que este cast falha alto e aquele não?

- **Melhoria Proposta**
  > Duas ações complementares:
  > 1. **Endurecer os fechados por CHECK** (`variante`, `RunStatus`): trocar o cast por um `parseVariante` / `parseRunStatus` no mesmo padrão de `parseStatusSnapshot` — throw em valor desconhecido. Custo: 20 linhas. Ganho: se um dia a CHECK for relaxada por engano, a leitura falha alto no MESMO instante em que a escrita passa a divergir.
  > 2. **Manter documentado** o cast de `motivoBloqueio` (aberto por decisão) e do JSON `bloqueadas_by_motivo` (superfície confiada), com o comentário atual referenciando este card por chave estável.
  > Tactic: Validate Input.

- **Resultado Esperado**
  > Casts de leitura de banco sobre colunas com CHECK são todos guardados por `parseX` que lança em valor fora do enum. Casts remanescentes (2, sobre superfície aberta por design) estão documentados com link para ADR/card. Cobertura de parse-com-throw: 33% → 67%.

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Casts `as` sobre coluna com CHECK, sem parse-com-throw: 2 → 0
  - Casts `as` sobre coluna aberta / JSON próprio, com comentário linkando este card: 2 → 2 (todos documentados)
- **Risco de não fazer**: baixo — não é vetor de injeção. Consequência realista: a próxima vez que a taxonomia de estados mudar (ex.: novo estado terminal), a inconsistência entre parse-guardados e cast-cru se manifesta em um relatório aparente-correto, e o time gasta 2h descobrindo por que só metade das linhas trocou de balde. É basicamente o cenário original da ADR-0043 em uma quinta dimensão.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo:** ateve-se ao delta. Segredo/AWS/CORS/XSS: 0 mudanças introduzidas — reportei métricas mas não gerei cards. IAM/Terraform: marcado explicitamente como não medível (não há `infra/` neste repo).
- **F-security-1 é o achado central**, e o delta já o resolveu. Reportei mesmo assim porque a descoberta (uma asserção "verde" que não exercia o caminho) é um alerta metodológico para outros ciclos do consolidator — daí o card [security-2] de sweep automatizado.
- **F-security-3 (leitura `/gestao` sem RBAC) é pré-existente.** O delta apenas *tornou o comportamento visível no teste*, o que é positivo. Marcado P2 porque exige decisão de produto, não é regressão do ciclo.
- **Cross-QA:**
  - *Audit Trail* — `triggered_by` gravado em toda mutação. Reforça finding do agent **Fault Tolerance** sobre trilha de auditoria (invariante O6).
  - *Validate Input* — parse-com-throw em `parseStatusSnapshot`/`parseEstadoElegibilidadeRow` é *também* uma defesa contra dessincronia snapshot↔header. Alerta para o agent **Integrability**: a invariante I5 se apoia neste throw.
  - *Limit Exposure* — remoção de `GET /permutas/painel` reduz superfície pública. Alerta ao agent **Availability**: um endpoint a menos para instrumentar/proteger; blast-radius menor.
- **Métricas que tentei coletar e falhei:** `npm audit` (bloqueado por modo `--quick`), IAM policies (não há `infra/`).
