---
type: regis-review-kanban
run_id: 2026-10-29-1628-sispag-confirmar-em-conjunto
feature: sispag-confirmar-em-conjunto (ADR-0080, I15t)
total: 32
counts: { p0: 0, p1: 4, p2: 18, p3: 10 }
---

# Kanban — financeiro — 2026-10-29-1628-sispag-confirmar-em-conjunto

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (nenhum) · P1 (S → XL) · P2 (S → XL) · P3 (S → XL).
> Dedup aplicado: `availability-2` + `integrability-1` fundidos em `[cents-queue-durability]` (mesma causa-raiz, mesma solução). Referência cruzada mantida nos findings.

---

## P0 — Crítico

Nenhum card P0. A feature é cirúrgica (18 arquivos, +623/−21 LOC), aditiva, e preserva as invariantes de segurança do fluxo singular. P0 só se classificaria defeito de correção/segurança introduzido por este diff com baseline numérico — nenhum achado atende.

---

## P1 — Alto

### [security-1] Rebaixar teto do batch no rate-limiter ou cobrar N slots por N linhas

**QA**: Security
**Tactic alvo**: Limit Access / Detect Service Denial
**Esforço**: S
**Findings**: F-security-1, F-security-5

**Problema**
> O `POST /sugestoes-boleto/confirmar-em-conjunto` consome 1 slot do balde `sugestao-boleto-confirmar:<sub>` (30/min) mas executa até 30 confirmações, amplificando em 30× o teto de decisões que a ADR-0068 defendia como "o teto de um humano". Uma sessão sequestrada confirma até ~900 títulos/min antes de 429 — ponto exato em que o sistema move dinheiro via remessa SISPAG.

**Melhoria Proposta**
> Alterar `limiteDecisaoBoleto` aplicado ao batch (`src/backend/routes/sispag.ts:1024`) para (a) balde dedicado `sugestao-boleto-conjunto` com `limit=1/min` por usuário, ou (b) `cost` dinâmico = `itens.length` (middleware caseiro em `src/backend/http/rateLimit.ts`). Tactic: Limit Access / Detect Service Denial.

**Resultado Esperado**
> Taxa máxima de confirmações/min por usuário cai de 900 para o teto humano (≤30/min), restaurando a defesa da ADR-0068 inclusive sob batch.

**Métricas de sucesso**
- Pico de confirmações/min por usuário: 900 → ≤30
- Teste de rate-limit cobrindo batch: ausente → presente

**Risco de não fazer**
> Um JWT comprometido confirma um lote SISPAG inteiro em minutos antes de qualquer alarme — e a confirmação alimenta a remessa Nexxera.

**Dependências**: Nenhuma

---

### [deployability-1] Introduzir flag `SISPAG_CONFIRMACAO_EM_CONJUNTO_ENABLED`

**QA**: Deployability
**Tactic alvo**: Configure Behavior / Scale Rollouts
**Esforço**: S
**Findings**: F-deployability-1

**Problema**
> A rota `POST /sispag/sugestao-boleto/confirmar-em-conjunto` só pode ser desligada em PRD revertendo commit via Render (≈5 min) ou derrubando o kill-switch global `SISPAG_LIVE_WRITE_ENABLED`, que também mata o ajuste de centavos e a confirmação singular. Qualquer incidente específico da rota em conjunto hoje tem blast radius de "todo o SISPAG write".

**Melhoria Proposta**
> Adicionar `sispagConfirmacaoEmConjuntoEnabled` ao `EnvironmentProvider` com default `true` em HML e `false` em PRD até V-PRD2 (padrão parecido com `SISPAG_BIND_CODBAR_FILIAIS`). Checar no `ConfirmacaoEmConjuntoService` e devolver 503 com mensagem "confirmação em conjunto desligada". Tactic: Configure Behavior.

**Resultado Esperado**
> Possibilidade de desligar a rota nova em ≤ 10 s via env var no Render sem derrubar SISPAG singular/ajuste de centavos. MTTR de incidente específico da feature cai de ~5 min para ~10 s.

**Métricas de sucesso**
- MTTR p/ incidente específico da rota: ~5 min → ~10 s
- Nº de flags por rota de escrita SISPAG: 1 (global) → 2 (global + conjunto)

**Risco de não fazer**
> Na primeira anomalia em PRD, operação do SISPAG inteiro é derrubada; ajuste de centavos e singular pagam pelo bug da rota em conjunto.

**Dependências**: Nenhuma

---

### [fault-tolerance-1] Varrer decisões `CONFIRMADA` sem ledger de ajuste e enfileirar o ajuste faltante

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring + Reconcile
**Esforço**: M
**Findings**: F-fault-tolerance-1, F-fault-tolerance-4

**Problema**
> Em um batch de confirmação em conjunto, `agendarEmSequencia` é fire-and-forget após o loop. Se o processo reiniciar entre o commit da decisão N e a entrada no ledger de ajuste N+1, as decisões N+1..M ficam `CONFIRMADA` sem nenhum rastro para `retomarPendentes` (que itera `ledger.listarNaoTerminais`, não decisões). Em batches de 30 (medido), a janela de perda é da ordem de 30–90 s por POST. Confirmado contra o código pelo consolidador: `retomarPendentes` só varre ledgers; a recuperação atual é o POST manual `/sispag/ajustes-centavos/tentar-novamente` por título.

**Melhoria Proposta**
> Dois caminhos complementares:
> 1. Em `ConfirmacaoEmConjuntoService.confirmarLinha`, após o commit da decisão, abrir sincronamente a entrada do ledger (`ledger.abrir`) no estado `pendente` com `gatilho=CONJUNTO`, ANTES de responder. O `agendarEmSequencia` passa a só executar; não precisa criar entrada.
> 2. Alternativamente/adicionalmente, estender `agendarVarredura` para também listar `DecisaoSugestao` com `decisao=CONFIRMADA` recentes que não tenham ledger associado.

**Resultado Esperado**
> `# decisões CONFIRMADA sem ledger após restart artificial`: desconhecido → 0 em teste de caos; `% ajustes de centavos aplicados por batch`: ≥99% dentro de 10 min de drenagem.

**Métricas de sucesso**
- decisões `CONFIRMADA` órfãs após restart: desconhecido → 0
- cobertura de retomada pela varredura ao abrir a tela: só-ledger → ledger + decisões recentes

**Risco de não fazer**
> Divergências silenciosas de centavos no `fin070` em batches durante janelas de deploy; divergência só aparece na conciliação do retorno, dias depois.

**Dependências**: Nenhuma. Precondição de [fault-tolerance-4].

---

### [testability-1] Adicionar integration test do `confirmar-em-conjunto` em Postgres + Conexos stub

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M
**Findings**: F-testability-1

**Problema**
> O caminho em lote (até 30 títulos por POST) só tem baseline numérico manual (36.5s → 1.3s via "um cenário por conjunto"). Nenhum teste automatizado protege a propriedade "um `cenarioParaConjunto()` por POST, N `confirmar()` reusando-o", e a regressão só aparece na gaveta do analista em PRD.

**Melhoria Proposta**
> Criar `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.integration.test.ts` seguindo o estilo de `GrupoBoletoService.integration.test.ts`: Postgres em docker (ou PRD-copy local), `ConexosClient` stub, dois cenários — (a) 30 linhas no caminho feliz (asserir `cenarioParaConjunto` chamado 1×, `confirmar` 30×, resultado 30× `CONFIRMADA`) e (b) um lote local virando `FINALIZADO` no meio (asserir `RECUSADA` + "lote já finalizado"). Tactic: Sandbox.

**Resultado Esperado**
> Integration tests do caminho `/confirmar-em-conjunto`: 0 → 2. Regressão de "cenário por linha" (36.5s) detectada automaticamente (`cenarioParaConjunto` chamado > 1).

**Métricas de sucesso**
- Integration tests em `ConfirmacaoEmConjuntoService`: 0 → 2
- Nº de chamadas a `cenarioParaConjunto` por POST assertado em CI: 0 → 1

**Risco de não fazer**
> Regressão de performance (ex.: alguém reintroduzir cenário por linha) só aparece em PRD; analista fica 36s esperando a gaveta.

**Dependências**: Nenhuma

---

## P2 — Médio

### [availability-3] Instrumentar duração e taxa de recusa por `conjuntoId`

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: S
**Findings**: F-availability-3, F-availability-4

**Problema**
> O log final emite apenas contadores (`pedidas`, `confirmadas`, `recusadas`), sem tempo total nem distribuição de motivos. Falhas 5xx são logadas como `BUSINESS_WARN` com mensagem genérica, impossibilitando alerta automático.

**Melhoria Proposta**
> Acrescentar `duracao_total_ms`, `duracao_max_linha_ms`, `motivos: Record<string, number>` no log `confirmação em conjunto concluída` e promover a severidade do catch 5xx para `BUSINESS_ERROR` com `conjuntoId`. Tactic: Monitor.

**Resultado Esperado**
> Dashboard mostra P95 e taxa de recusa por motivo em janela deslizante; alerta automático em `BUSINESS_ERROR` 5xx. MTTR percebido cai de "quando a analista reclama" para ≤ 15 min.

**Métricas de sucesso**
- Campos de duração emitidos: 0 → 2
- Severidade 5xx: `BUSINESS_WARN` → `BUSINESS_ERROR` com `conjuntoId`

**Risco de não fazer**
> Regressão de desempenho passa despercebida até o primeiro batch grande em produção.

**Dependências**: Nenhuma

---

### [deployability-2] Adicionar runbook da rota em conjunto em `DEPLOY.md`

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> A feature introduz um cap de 30 linhas (`BatchConfirmationTooLargeError` → 422), estados `JA_CONFIRMADA` / `RECUSADA` por credor divergente e dependência de `SISPAG_LIVE_WRITE_ENABLED`. Nada em runbook; o conhecimento vive em ADR-0080.

**Melhoria Proposta**
> Adicionar seção "SISPAG — confirmação em conjunto" em `DEPLOY.md` com env vars relevantes, cap de 30 e como ajustar, interpretação dos códigos de retorno por linha, procedimento de rollback.

**Resultado Esperado**
> Operador de plantão resolve incidente da rota sem acionar o dev. Lead time de triagem cai.

**Métricas de sucesso**
- Linhas de runbook em `DEPLOY.md`: 0 → ≥ 30
- Perguntas no chat sobre "422 em conjunto": N → 0

**Risco de não fazer**
> Cada incidente custa 1 acordar-o-dev.

**Dependências**: [deployability-1]

---

### [deployability-3] Expor métrica estruturada de duração e rows do endpoint em conjunto

**QA**: Deployability
**Tactic alvo**: Deployment observability
**Esforço**: S
**Findings**: F-deployability-3

**Problema**
> O pior caso medido (per-row scenario) foi 36.5 s para 30 linhas; a otimização D9 leva a 1.3 s. Não há métrica estruturada que alerte quando um deploy futuro reintroduzir a regressão.

**Melhoria Proposta**
> No `ConfirmacaoEmConjuntoService`, emitir `LogService.message` estruturado com `{ route: 'sispag.confirmarEmConjunto', rows, durationMs, scenarioMode }` ao final de cada requisição. Alarme com threshold `durationMs/rows > 200ms`.

**Resultado Esperado**
> Qualquer deploy que degrade a latência média por linha acima de 200 ms dispara alerta antes do usuário reportar.

**Métricas de sucesso**
- Latência média por linha monitorada: não observada → ≤ 200 ms
- Tempo até detectar regressão de 28×: ∞ → ≤ 1 deploy

**Risco de não fazer**
> Regressão de performance detectada só por reclamação de analista.

**Dependências**: Nenhuma. Cross-link com `performance.md`.

---

### [deployability-4] Confirmar que o CI do PR roda typecheck/lint/test/build antes do deploy hook

**QA**: Deployability
**Tactic alvo**: Manage Deployment Pipeline (CI gating)
**Esforço**: S
**Findings**: F-deployability-4

**Problema**
> O diff não toca workflows; a sessão rodou os gates localmente, mas não há evidência no PR de que `.github/workflows/*.yml` força os mesmos gates antes do Render hook.

**Melhoria Proposta**
> Checklist no PR template (`.github/pull_request_template.md`): backend typecheck + lint + test + build; frontend idem. Garantir workflow `ci.yml` com required status checks na branch `main`.

**Resultado Esperado**
> Impossível merge em `main` sem gates verdes; Render hook só dispara após merge.

**Métricas de sucesso**
- Required status checks em `main`: desconhecido → ≥ 4

**Risco de não fazer**
> Build quebrado chega a PRD; precedente histórico do `.sql` não copiado mostra que gates falhos custam dias.

**Dependências**: Nenhuma

---

### [fault-tolerance-3] Adicionar timeout e feedback no `fetch` do `confirmar-em-conjunto`

**QA**: Fault Tolerance
**Tactic alvo**: Timeout
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> `confirmarEmConjunto` em `src/frontend/lib/sispag.ts` chama `fetch` sem `AbortController`. Com o batch rodando em 1.3 s em condições normais, uma rede lenta deixa a UI pendurada sem motivo.

**Melhoria Proposta**
> Envolver com `AbortController` + `signal`; deadline 60 s. Em `ConfirmacaoEmConjuntoSecao.tsx`, no `catch` do `enviar`, diferenciar `AbortError` de erro de servidor.

**Resultado Esperado**
> Timeout no `fetch`: ausente → 60 s. UX recebe mensagem acionável em 100% dos POSTs > 60 s.

**Métricas de sucesso**
- % mutações financeiras do FE com timeout: 0 → 100

**Risco de não fazer**
> Analista recarrega sem feedback; retrabalho de verificação manual.

**Dependências**: Nenhuma

---

### [integrability-2] Validar o response de `confirmar-em-conjunto` com Zod server-side

**QA**: Integrability
**Tactic alvo**: Adhere to Standards
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> O FE pina o payload com `resultadoConjuntoSchema` (`src/frontend/lib/sispag.ts:2725`), mas o backend serializa com `res.json(...)` sem validar (`src/backend/routes/sispag.ts:1033-1041`). Mudança silenciosa no shape passa nos testes do BE e explode no FE.

**Melhoria Proposta**
> Mover `irmaosConjuntoSchema` e `resultadoConjuntoSchema` para `src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts` como source of truth, importar no FE, passar o resultado por `.parse()` antes do `res.json`.

**Resultado Esperado**
> Mesma definição Zod no BE e no FE; qualquer drift falha o teste de rota do BE antes de chegar ao FE.

**Métricas de sucesso**
- Endpoints novos com response validado no BE: 0/2 → 2/2
- Schemas duplicados BE/FE: 2 → 0

**Risco de não fazer**
> Regressão de UI em prod sem sinal no CI.

**Dependências**: Nenhuma (compatível com [modifiability-3]).

---

### [modifiability-4] Reduzir cognitive complexity do `confirmar` abaixo de 15

**QA**: Modifiability
**Tactic alvo**: Refactor
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> `BoletoSuggestionService.confirmar` segue em 19 (teto 15). É possível descer a 15 com uma rodada local de "Replace Conditional with Guard Clause" sem esperar o split do card [modifiability-1].

**Melhoria Proposta**
> Converter os ramos de exigência (reconhecimento, tier, parVigente, conjunto, divergência de data) numa cadeia de guard clauses pequenas e inlineá-las num `validarAntesDeConfirmar(input, cenario)` isolado.

**Resultado Esperado**
> `confirmar` com cognitive complexity ≤ 15; `BoletoSuggestionService.ts` com 0 warnings de `noExcessiveCognitiveComplexity`.

**Métricas de sucesso**
- Biome warnings em `BoletoSuggestionService.ts`: 3 → 0
- cognitive em `confirmar`: 19 → ≤ 15

**Risco de não fazer**
> A próxima invariante estoura o teto; cada warning convive com os já existentes.

**Dependências**: Nenhuma

---

### [performance-1] Snapshot único de `listTitulosEmLotesAbertos` por batch com reconferência barata

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> `ConfirmacaoEmConjuntoService.confirmarLinha` relê `listTitulosEmLotesAbertos()` dentro do loop (até 30× por POST). O cenário já foi reaproveitado (36.5 s → 1.3 s); este é o próximo overhead no mesmo loop.

**Melhoria Proposta**
> Carregar o snapshot `emLotesInicial` uma vez antes do loop e, antes de chamar `sugestoes.confirmar`, releitura só do título específico (consulta pontual por `filCod+docCod+titCod`). Mantém anti-TOCTOU trocando um SELECT de recordset por um SELECT por chave.

**Resultado Esperado**
> Round-trips DB por POST de 30 linhas: 30 → 1 + N por chave; p95: 1.3 s → 0.8 s.

**Métricas de sucesso**
- POST 30 linhas p95: 1.3 s → ≤ 0.8 s
- Reads de `lote_pagamento_item` por POST: 30 → 1 + 30

**Risco de não fazer**
> Carga DB cresce linear com concorrência de analistas no fechamento mensal.

**Dependências**: Nenhuma

---

### [security-4] Baldes separados por rota de decisão (single vs. batch)

**QA**: Security
**Tactic alvo**: Limit Access
**Esforço**: S
**Findings**: F-security-5, F-security-1

**Problema**
> `confirmar` single e `confirmar-em-conjunto` dividem a mesma chave `sugestao-boleto-confirmar:<sub>`. A métrica "decisões/min" vira dependente da mistura de rotas, e é impossível alarmar sobre "comportamento anormal no batch" isoladamente.

**Melhoria Proposta**
> No `buildSugestaoBoletoLimiter` incluir `'conjunto'` entre os escopos e usá-lo para o POST de conjunto. Idealmente feito junto com [security-1].

**Resultado Esperado**
> Observabilidade por rota de decisão; alarme específico para abuso de batch.

**Métricas de sucesso**
- Baldes distintos: 1 → 2
- Teste de independência dos baldes: ausente → presente

**Risco de não fazer**
> Alarme sobre abuso de batch impossível sem dividir o balde.

**Dependências**: Faz par com [security-1].

---

### [cents-queue-durability] Persistir intenção de ajuste antes do `void` (merge availability-2 + integrability-1)

**QA**: Availability + Integrability + Fault Tolerance (dedup)
**Tactic alvo**: State Resynchronization + Outbox
**Esforço**: M
**Findings**: F-availability-2, F-integrability-1

**Problema**
> `agendarEmSequencia` dispara `void this.executarEmSequencia(...)`: a promise não é awaitada e vive só em memória. Se o processo cair (deploy, SIGTERM, OOM) entre a resposta HTTP e o fim da fila, até 30 ajustes ficam pendurados até alguém reabrir a tela e disparar `retomarPendentes`. No alvo Lambda, a função termina ao retornar e a promise é descartada.

**Melhoria Proposta**
> Persistir cada `PedidoAjuste` numa tabela `ajuste_centavos_outbox` (ou reusar `AjusteCentavosExecucaoRepository` com estado `pendente`) imediatamente antes do `void`, e drenar com um worker/job dedicado. Alternativamente, acionar `retomarPendentes` como primeira coisa no boot do servidor (`ServerProcessMarker`), não só na abertura da tela.

**Resultado Esperado**
> Convergência garantida independentemente de queda do processo; MTTR de ajuste pendente ≤ 1 minuto após restart (vs "até a próxima abertura da tela"). Precondição do roadmap Lambda.

**Métricas de sucesso**
- Durabilidade da fila: 0% → 100% (pedidos sobrevivem a reinício)
- Janela de exposição por conjunto: 36,5 s → 0 s
- Promessas `void` no caminho crítico: 1 → 0

**Risco de não fazer**
> No corte para o alvo Lambda, a feature regride silenciosamente: ajustes de centavos de batches confirmados antes do fim da execução Lambda deixam de rodar.

**Dependências**: Alinha com ADR-0074 (kill-switch `SISPAG_LIVE_WRITE_ENABLED`). Complementar a [fault-tolerance-1].

---

### [fault-tolerance-2] Aceitar `Idempotency-Key` no POST `confirmar-em-conjunto`

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay (HTTP boundary)
**Esforço**: M
**Findings**: F-fault-tolerance-2

**Problema**
> A rota não aceita `Idempotency-Key`. Replay por timeout de rede refaz o batch com novo `conjuntoId` (UUID), gerando trilha de auditoria com dois `conjunto.id` para a mesma ação do analista. A idempotência por linha protege o estado financeiro, mas não o audit trail.

**Melhoria Proposta**
> Ler `Idempotency-Key` do header, persistir a tupla `(key, ator, hash do body)` → `conjuntoId` por 24 h. Hit = replay devolve o `ResultadoConjunto` original, não reexecuta.

**Resultado Esperado**
> Replay de HTTP preserva `conjuntoId`; 0 duplicatas no replay.

**Métricas de sucesso**
- % POSTs de mutação financeira SISPAG com `Idempotency-Key` aceita: 0% → 100%

**Risco de não fazer**
> Trilhas de auditoria com múltiplos `conjuntoId` por decisão em cenários de retry; dificulta forense.

**Dependências**: Nenhuma

---

### [performance-2] Bound e telemetria para a fila `agendarEmSequencia` do ajuste de centavos

**QA**: Performance (cross: Availability, Fault Tolerance)
**Tactic alvo**: Bound Queue Sizes
**Esforço**: M
**Findings**: F-performance-2

**Problema**
> O ajuste de centavos pós-conjunto é `void this.executarEmSequencia(...)` sem retentor global, sem gauge e sem limite agregado. O invariante "nunca N renegociações simultâneas no `fin070`" é respeitado dentro de uma fila, mas se dois batches confirmam no mesmo instante há duas filas em paralelo. Sem contador, só o retorno do banco revelaria lentidão.

**Melhoria Proposta**
> Centralizar os pedidos num singleton (`AjusteCentavosQueue`) com `maxConcurrency=1`, `maxDepth` configurável e logs em cada enqueue/complete/drop. Expor gauge `sispag_ajuste_centavos_fila_depth` e counter `..._falhas_total`.

**Resultado Esperado**
> No máximo 1 ajuste em flight por processo; depth e falhas visíveis no painel; drops explícitos quando `maxDepth` for excedido.

**Métricas de sucesso**
- Ajustes concorrentes no `fin070` por processo: potencialmente N → 1
- Observabilidade da fila: 0 counters → 2

**Risco de não fazer**
> Incidente de lentidão no Conexos durante pico fica invisível até o retorno do banco; cross-batch concorrência pode disparar lock no `fin070`.

**Dependências**: Converge com [availability-3] (observability) e [cents-queue-durability] (bounded queues).

---

### [security-2] Persistir trilha durável por linha RECUSADA do conjunto

**QA**: Security (cross: Fault Tolerance)
**Tactic alvo**: Audit Trail
**Esforço**: M
**Findings**: F-security-2

**Problema**
> Linhas que o `confirmarLinha` recusa (filial divergente, lote finalizado, erro inesperado) só retornam no response e num `logService.info` agregado. Confirmações CONFIRMADAs são persistidas pelo `confirmar` reusado, mas recusas não têm registro durável — a proposta exige trilha "quem, quando, o quê" para toda ação sobre documento financeiro.

**Melhoria Proposta**
> No `ConfirmacaoEmConjuntoService.confirmarLinha`, gravar cada linha RECUSADA numa tabela de audit (reusar `DecisaoSugestaoBoleto` com status "RECUSADA_EM_CONJUNTO" ou criar `AuditoriaConjuntoRecusa`) com `conjuntoId`, chave do título, motivo pt-BR, ator e timestamp.

**Resultado Esperado**
> 100% das linhas RECUSADAs com registro durável; reconstrução pós-incidente deixa de depender de retenção do log de aplicação.

**Métricas de sucesso**
- Linhas RECUSADAs persistidas: 0% → 100%
- Query de auditoria por `conjuntoId` retorna confirmadas + recusadas: parcial → completa

**Risco de não fazer**
> Em disputa com a Columbia sobre lote fechado, falta prova durável do que foi rejeitado.

**Dependências**: Cross-ref Fault Tolerance.

---

### [modifiability-2] Particionar `routes/sispag.ts` por sub-escopo

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-3

**Problema**
> `routes/sispag.ts` tem 1927 LOC e cada feature SISPAG empilha mais rotas. A feature atual acrescentou +51 LOC. Toda PR paralela do SISPAG conflita aqui.

**Melhoria Proposta**
> Dividir em `routes/sispag/{lotes,sugestoes,grupo,retorno,painel}.ts` montados por um `router.use()` em `routes/sispag/index.ts`. Mover as duas rotas de I15t para `routes/sispag/sugestoes.ts`.

**Resultado Esperado**
> Nenhum arquivo em `routes/sispag/*` acima de 500 LOC; conflitos de merge concentrados por sub-domínio.

**Métricas de sucesso**
- max LOC em `routes/sispag/*`: 1927 → ≤ 500
- nº de PRs com conflito nessa pasta: ↓ 50%

**Risco de não fazer**
> Contenção crescente em merges paralelos de SISPAG.

**Dependências**: Nenhuma

---

### [testability-4] Partir os test files SISPAG acima de 1000 LOC por eixo

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M
**Findings**: F-testability-4

**Problema**
> `BoletoSuggestionService.test.ts` (1974 LOC) e `AjusteCentavosTituloService.test.ts` (975 LOC) são o monólito onde cada nova invariante SISPAG costura mais um `describe`. O custo marginal de leitura/edição cresce linearmente.

**Melhoria Proposta**
> Separar os `describe` por invariante / eixo em sibling files (ex.: `BoletoSuggestionService.confirmar.test.ts`, `BoletoSuggestionService.cenario.test.ts`, `BoletoSuggestionService.desfecho.test.ts`), reusando helpers em `__fixtures__`.

**Resultado Esperado**
> Maior test file em `domain/service/sispag/` cai de 1974 LOC para ≤700 LOC.

**Métricas de sucesso**
- Maior test file em `domain/service/sispag/`: 1974 → ≤700 LOC
- Nº de arquivos de teste por serviço SISPAG hot: 1 → 3–4

**Risco de não fazer**
> Toda feature SISPAG seguinte acresce 100–300 LOC no mesmo arquivo; chegada aos 3000 LOC em 2–3 ciclos.

**Dependências**: Nenhuma

---

### [fault-tolerance-4] Job diário de reconciliação SISPAG × `fin070`

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile
**Esforço**: L
**Findings**: F-fault-tolerance-4, F-fault-tolerance-1

**Problema**
> Não há sweep diário que confirme que as decisões `CONFIRMADA` do dia correspondem a títulos ajustados no `fin070`. Divergências aparecem só na conciliação do retorno (dias depois).

**Melhoria Proposta**
> Criar job (hoje `src/backend/jobs/`) que, para a janela D-1, cruza `decisao_sugestao_boleto` com o estado do ledger e com uma leitura do `fin070` em modo shadow, gerando log de divergência consumido pelo painel-operacao.

**Resultado Esperado**
> Taxa de divergência SISPAG × `fin070` detectada em D-1: desconhecida → medida; MTTR de divergência: dias → horas.

**Métricas de sucesso**
- job presente: não → sim
- divergências detectadas em D-1: desconhecido → métrica diária

**Risco de não fazer**
> Divergências silenciosas acumuladas.

**Dependências**: [fault-tolerance-1] (preencher o ledger primeiro).

---

### [modifiability-1] Dividir `BoletoSuggestionService` por caso de uso

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: L
**Findings**: F-modifiability-1, F-modifiability-2

**Problema**
> `BoletoSuggestionService.ts` chegou a 1402 LOC com fan-in 11 e três hotspots de complexity ≥ 16. Toda feature de SISPAG passa por ele; a feature atual precisou de helpers extras só pra não piorar o cognitive em `confirmar`, e um ciclo de perf (D9) foi gasto porque o `confirmar` chamava `sugerirAgora()` 30× no laço.

**Melhoria Proposta**
> Extrair pelo menos (a) `CenarioSugestoesService` (cache + `sugerirAgora`/`desfechosEmCache`/`cenarioParaConjunto`), (b) `ConfirmacaoSugestaoService` (fluxo de `confirmar` + helpers), (c) `RevogacaoSugestaoService`. Manter `BoletoSuggestionService` apenas como fachada readonly do cenário.

**Resultado Esperado**
> `BoletoSuggestionService.ts` ≤ 600 LOC; `confirmar` isolado num arquivo ≤ 400 LOC; cognitive complexity em `confirmar` recuar para ≤ 15.

**Métricas de sucesso**
- LOC `BoletoSuggestionService.ts`: 1402 → ≤ 600
- Cognitive complexity em `confirmar`: 19 → ≤ 15

**Risco de não fazer**
> A próxima invariante empurrará `confirmar` para >22 de complexity.

**Dependências**: Nenhuma

---

### [modifiability-3] Compartilhar schemas Zod entre backend e frontend

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services / Encapsulate
**Esforço**: L
**Findings**: F-modifiability-4

**Problema**
> `frontend/lib/sispag.ts` tem 3169 LOC e redeclara schemas Zod que já existem em `src/backend/domain/interface/sispag/*`. A feature atual duplicou `irmaoConjuntoSchema`, `irmaosConjuntoSchema`, `resultadoConjuntoSchema` (102 LOC). Toda mudança de DTO custa 2x e corre risco de drift.

**Melhoria Proposta**
> Mover os schemas Zod para `src/shared/sispag/` (ou publicar via `src/backend/domain/interface/**` consumido pelo FE). Alternativa pragmática: gerar os tipos TS do FE a partir dos schemas Zod do BE em build-time.

**Resultado Esperado**
> `frontend/lib/sispag.ts` encolhe (fetchers only); zero drift entre contratos; mudança de DTO custa 1 arquivo de schema.

**Métricas de sucesso**
- LOC `frontend/lib/sispag.ts`: 3169 → ≤ 800
- Schemas Zod duplicados FE/BE: ≥ 20 → 0

**Risco de não fazer**
> Drift silencioso de contrato; bug em produção já aconteceu em features anteriores por diferença de `optional()` entre BE e FE.

**Dependências**: ADR curta sobre `src/shared/`.

---

## P3 — Baixo

### [availability-1] Impor timeout por linha no laço batch (rebaixado pelo consolidador)

**QA**: Availability
**Tactic alvo**: Exception Prevention + Retry (bounded)
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> Hoje, uma iteração do `for` em `ConfirmacaoEmConjuntoService.confirmarLinha` não tem corte temporal explícito.
>
> **Nota do consolidador (rebaixamento)**: a hipótese original de "um Conexos pendurado trava o batch inteiro" não se materializa — `BoletoSuggestionService.confirmar` chamado por linha é read-only no DB local; não há chamada Conexos no caminho síncrono do laço. A renegociação `fin070` acontece após o response via `agendarEmSequencia`. Mantido como P3 por defesa em profundidade (budget para o SELECT/INSERT local se o Postgres pendurar).

**Melhoria Proposta**
> Envolver cada iteração num `AbortController`/`Promise.race` com budget 5 s (configurável via `SISPAG_BATCH_LINE_TIMEOUT_MS`). Timeout vira `RECUSADA` com motivo "O servidor não respondeu a tempo".

**Resultado Esperado**
> Teto superior por batch bounded; linha hung por DB vira RECUSADA.

**Métricas de sucesso**
- P95 de duração por linha: desconhecido → ≤ 500 ms
- Linhas acima do budget: n/d → métrica no log

**Risco de não fazer**
> Baixo com o entendimento atual do laço.

**Dependências**: Nenhuma

---

### [integrability-3] Expor estado da fila de ajuste no `ResultadoConjunto`

**QA**: Integrability
**Tactic alvo**: Tailor Interface
**Esforço**: S
**Findings**: F-integrability-4

**Problema**
> A resposta do POST não indica que a renegociação ainda está em andamento. O FE descobre pelo polling do título, contrato implícito.

**Melhoria Proposta**
> Adicionar `ajusteAgendado: boolean` por linha e `sequenciaAjusteId?: string` no agregado, retornado por `agendarEmSequencia`.

**Resultado Esperado**
> Qualquer cliente HTTP correlaciona confirmação com estado da fila sem consultar repositório.

**Métricas de sucesso**
- Campos do `ResultadoConjunto` referentes à fila: 0 → 2

**Risco de não fazer**
> Segundo consumidor duplicará lógica.

**Dependências**: [cents-queue-durability] (durabilidade primeiro para o id fazer sentido).

---

### [integrability-4] Reduzir fan-out de dependências do `ConfirmacaoEmConjuntoService`

**QA**: Integrability
**Tactic alvo**: Manage Resource Coupling
**Esforço**: M
**Findings**: F-integrability-3

**Problema**
> O serviço injeta 7 colaboradores concretos, extrapolando a heurística de orquestrador >3.

**Melhoria Proposta**
> Extrair um reader (`listarIrmaos`) e um writer (`confirmarEmConjunto`), ou agregar `TituloAPagarRepository`+`LotePagamentoRepository`+`BoletoDdaRepository` sob um `CarteiraLeituraService`.

**Resultado Esperado**
> Serviço com ≤4 dependências; teste unitário sem 7 mocks.

**Métricas de sucesso**
- Colaboradores no construtor: 7 → ≤4

**Risco de não fazer**
> Evolução futura exige rework proporcional.

**Dependências**: Nenhuma

---

### [modifiability-5] Catalogar mensagens de recusa do SISPAG num único arquivo

**QA**: Modifiability
**Tactic alvo**: Defer Binding — configuration
**Esforço**: S
**Findings**: F-modifiability-5

**Problema**
> A feature introduziu 7 literais pt-BR de recusa espalhados entre `RegraIrmaosConjunto`, `ConfirmacaoEmConjuntoService`.

**Melhoria Proposta**
> Criar `domain/interface/sispag/MensagensSispag.ts` com objetos nomeados (`MOTIVO_CONJUNTO.FORA_DA_FILIAL`, etc.).

**Resultado Esperado**
> Alteração de wording = 1 arquivo editado + 0 regressão de teste.

**Métricas de sucesso**
- literais pt-BR em `service/sispag/*.ts` fora do catálogo: ~40 → ≤ 5

**Risco de não fazer**
> Baixo hoje; vira trabalho de descoberta no dia que entrar i18n ou white-label.

**Dependências**: Nenhuma

---

### [performance-3] Métrica de cache-hit do cenário no GET `/titulo/irmaos`

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-3

**Problema**
> GET quente = 30 ms, mas cold path é dominado por recomputar ~1.4 s do motor. Sem métrica distinguindo os dois, a UX do drawer "trava" aleatoriamente após deploys.

**Melhoria Proposta**
> Expor `cache_hit=true|false` no retorno do `desfechosEmCache()` e um counter `sispag_cenario_cache_hit_total{result}`.

**Resultado Esperado**
> Hit-rate observável; alvo p95 GET cold ≤ 2.5 s.

**Métricas de sucesso**
- Visibilidade de cache-hit: 0 → counter + gauge
- GET cold p95: desconhecido → ≤ 2.5 s

**Risco de não fazer**
> Percepção de UX inconsistente; mascara regressão futura.

**Dependências**: Nenhuma

---

### [performance-4] Filtrar `listBoletos` do GET irmaos por credor

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S
**Findings**: F-performance-4

**Problema**
> O pool DDA buscado no GET para o aviso "idênticos" é filtrado só por `vencimentoDesde`; cresce com o volume total do pool, não com os irmãos do credor.

**Melhoria Proposta**
> Adicionar filtro `pesCod` em `BoletoDdaRepository.listBoletos` (parâmetro opcional, novo índice se preciso) e usar no `listarIrmaos`.

**Resultado Esperado**
> Pool lido: O(27k) → O(centenas) por credor; p95 do GET resiliente ao dobro do volume.

**Métricas de sucesso**
- Linhas lidas no `listBoletos` do GET: full-pool-desde → só do credor
- GET irmaos p95 projetado a 2× volume: ≤ 100 ms

**Risco de não fazer**
> Regressão silenciosa quando o DDA crescer.

**Dependências**: Validar com qa-modifiability se o filtro justifica novo índice.

---

### [security-3] Aproximar teto HTTP do teto de domínio (200 → 30)

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S
**Findings**: F-security-3

**Problema**
> `ConfirmarEmConjuntoBodySchema` aceita até 200 chaves; o serviço rejeita acima de 30 com 422. Até 170 chaves são parseadas e descartadas por request.

**Melhoria Proposta**
> Deixar `.max(CONFIRMACAO_CONJUNTO_MAXIMO)` no Zod, e manter a mensagem 422 só para o caso de duplicatas no corpo que virem 31 após dedup.

**Resultado Esperado**
> Teto HTTP alinhado ao teto de domínio; carga de parsing cai de até 200 para até 30 chaves/request.

**Métricas de sucesso**
- Razão teto HTTP / teto de domínio: 6,67× → 1×

**Risco de não fazer**
> DoS leve persistente.

**Dependências**: Nenhuma

---

### [testability-2] Expor `UuidProvider` injetável e usá-lo no `conjunto.id`

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> `ConfirmacaoEmConjuntoService.ts:106` chama `randomUUID()` direto; o `conjunto.id` é o campo de trilha. Teste contorna com `size===1` em vez de asserir identidade.

**Melhoria Proposta**
> Criar `src/backend/domain/libs/uuid/UuidProvider.ts` (`@singleton() @injectable()`, `generate = () => randomUUID()`); injetar no construtor.

**Resultado Esperado**
> Testes conseguem fixar `conjuntoId` e asserir no log/trilha diretamente.

**Métricas de sucesso**
- Chamadas de `randomUUID` fora de provider em código novo: 1 → 0
- Testes que asseguram `log.conjuntoId === fixedUuid`: 0 → ≥1

**Risco de não fazer**
> Baixo isolado; vira padrão silencioso em outras features.

**Dependências**: Nenhuma

---

### [testability-3] Testar o descarte do fire-and-forget de `agendarEmSequencia` (rebaixado pelo consolidador)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> `agendarEmSequencia` descarta a promise com `void`.
>
> **Nota do consolidador (rebaixamento)**: `executarEmSequencia` envolve cada `await` em try/catch; só um `logService` que lance antes do primeiro `await` escaparia. Rejeição não observada é extremamente improvável. Mantido como P3 por completude.

**Melhoria Proposta**
> Em `AjusteCentavosTituloService.test.ts`, acrescentar teste que mocka `ajustar` com throw síncrono via `jest.spyOn` e assegura que nenhum `unhandledRejection` sobe. Wrap do `void` com `.catch(err => this.logService.error(...))` como defesa em profundidade.

**Resultado Esperado**
> Fire-and-forgets defendidos em código novo: 0 → 1.

**Métricas de sucesso**
- Testes de descarte de promise: 0 → 1
- `.catch` protegendo fire-and-forget: 0 → 1

**Risco de não fazer**
> Baixíssimo com o entendimento atual do try/catch envolvente.

**Dependências**: Nenhuma

---

### [testability-5] Teste de contrato de erro BE→FE para `BatchConfirmationTooLargeError`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-5

**Problema**
> O FE assume `{ error, code: 'CONFIRMACAO_CONJUNTO_ACIMA_DO_LIMITE', retryable: false, status: 422 }`, mas nenhum teste de BE confirma que a rota devolve exatamente esse envelope quando o service lança `BatchConfirmationTooLargeError`.

**Melhoria Proposta**
> Em `src/backend/routes/sispag.sugestaoBoleto.test.ts`, um `it` que mocka `confirmarEmConjunto` para rejeitar com `new BatchConfirmationTooLargeError({ pedidas: 31, maximo: 30 })` e assegura status/code/retryable/error exatos.

**Resultado Esperado**
> Contrato de erro em lote assegurado em CI.

**Métricas de sucesso**
- Testes de envelope de erro para `/confirmar-em-conjunto`: 0 → 1

**Risco de não fazer**
> Refactor do handler muda silenciosamente o envelope; diálogo FE deixa de mostrar "no máximo 30".

**Dependências**: Nenhuma

---
