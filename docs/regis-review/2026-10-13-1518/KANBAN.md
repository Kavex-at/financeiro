---
type: regis-review-kanban
run_id: 2026-10-13-1518
total: 23
counts: { p0: 0, p1: 0, p2: 16, p3: 7 }
---

# Kanban — financeiro — 2026-10-13-1518

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Dentro do mesmo par prioridade/esforço, a ordem segue o peso do QA (Security, Fault Tolerance, Availability, Modifiability, Testability, Performance, Integrability, Deployability).
> Escopo: delta da branch `fix/sispag-sync-ao-abrir` (ADR-0066), modo `--quick`. Cards copiados dos 8 QAs sem alteração de conteúdo; a linha "Consolidar com" foi acrescentada onde dois QAs propõem a mesma correção (ver REPORT.md, seção 7).

---

## P0 — Crítico

_Nenhum card nesta prioridade._

---

## P1 — Alto

_Nenhum card nesta prioridade._

---

## P2 — Médio

### [security-1] Limitar passadas forçadas por usuário e por janela

**QA**: Security
**Tactic alvo**: Limit Access
**Esforço**: S
**Findings**: F-security-1

**Problema**
> `POST /sispag/lotes/sincronizar` aceita `sispag:ver`, ignora TTL e cooldown e só é contido por 10 req/min por IP e pelo lock. Um viewer encadeia passadas de ~25 s e consome a sessão Conexos do robô em horário de remessa.

**Melhoria Proposta**
> Aplicar um cooldown mínimo para `forcar` (por exemplo, devolver `fresca` quando a última passada tiver menos de 60 s). Adicionar limiter por `req.user.sub` com `sessionLimiter`/`keyGenerator`, como já existe para busca de favorecido (`rateLimit.ts`). Contar passadas por `triggered_by` em `job_execucao` e alertar acima de um limiar. Tocar `SincronizacaoPassadaService.forcar` e `routes/sispag.ts`, com teste.

**Resultado Esperado**
> No máximo 1 passada forçada a cada 60 s por instalação e 6/min por usuário, contra o teto atual de uma passada contínua. O frontend continua mostrando "atualizada há X min".

**Métricas de sucesso**
- Passadas forçadas por minuto por usuário: ilimitado (até o lock) → ≤ 1
- Chaves de rate limit por usuário nas rotas pesadas do SISPAG: 0 → 2

**Risco de não fazer**
> o cap de sessões do Conexos é esgotado por um uso indevido (ou um loop de frontend), e o robô perde a sessão no meio de uma remessa.

**Dependências**: nenhuma

---

### [fault-tolerance-1] Fechar runs `running` mortas da sincronização SISPAG

**QA**: Fault Tolerance
**Tactic alvo**: Repair State
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-fault-tolerance-2

**Problema**
> Uma run `running` de processo derrubado só é ignorada na leitura (10 min) e nunca fechada; polui `job_execucao` e o painel de operação. Em paralelo, falha de log após `finishRun` pode regravar uma run de sucesso como `error`.

**Melhoria Proposta**
> Ao iniciar a passada (já sob o lock), marcar como `error` ("interrompida") as runs `running` do pipeline mais velhas que `RUN_PRESA_MS` (Repair State). Em `fechar`, isolar o `logService` em try/catch próprio para não reentrar no `catch` de erro.

**Resultado Esperado**
> Nenhuma run `running` com idade > 10 min; passada bem-sucedida nunca regravada como `error`.

**Métricas de sucesso**
- Runs `running` > 10 min: indefinido -> 0
- Caminhos de dupla finalização: 1 -> 0

**Risco de não fazer**
> painel de operação acumula runs fantasmas e dificulta diagnóstico de incidentes.

**Dependências**: nenhuma
**Consolidar com**: availability-2 (run `running` morta)

---

### [fault-tolerance-2] Alertar quando o cron pula N passadas seguidas por trava ocupada

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> O cron devolve exit 0 quando a trava está ocupada; uma trava pendurada faz o cron "passar verde" indefinidamente sem sincronizar.

**Melhoria Proposta**
> Registrar o pulo como run `skipped` (ou checar a idade da última passada finalizada) e sair com exit ≠ 0 se a última passada com sucesso for mais velha que, por exemplo, 3x o TTL (Condition Monitoring). Confirmar timeout do cliente Conexos dentro da passada.

**Resultado Esperado**
> Defasagem > 90 min sem passada bem-sucedida gera alerta no workflow.

**Métricas de sucesso**
- Alertas por trava pendurada: 0 -> 1 na primeira ocorrência

**Risco de não fazer**
> repetição silenciosa do incidente de 23/09 (cron verde sem trabalho).

**Dependências**: nenhuma
**Consolidar com**: availability-3 (mesmo sinal: idade da última passada bem-sucedida)

---

### [availability-1] Impor prazo máximo à passada L11 sob a trava

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> A passada L11 roda sob advisory lock sem deadline. Uma leitura pendurada no Conexos retém a trava e todas as aberturas da tela recebem `em_andamento` até o cron de 15 min cortar.

**Melhoria Proposta**
> Envolver `sincronizarTodos()` em um deadline (por exemplo 3 min, via `AbortSignal`/`Promise.race`) que feche a run em `error` e libere a trava. Conferir o timeout do cliente Conexos de leitura. Arquivo: `SincronizacaoPassadaService.ts`.

**Resultado Esperado**
> Trava retida no máximo pelo prazo configurado (hoje: ilimitado → alvo: ≤ 3 min), com falha registrada e cooldown aplicado.

**Métricas de sucesso**
- Teto de duração da passada: ilimitado → ≤ 3 min

**Risco de não fazer**
> um incidente de lentidão do Conexos congela a sincronização de status até o processo reiniciar.

**Dependências**: nenhuma
**Consolidar com**: performance-1 (mesma correção: deadline na passada)

---

### [availability-2] Confirmar o estado real da trava antes de responder `em_andamento`

**QA**: Availability
**Tactic alvo**: Ignore Faulty Behavior
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> A abertura devolve `em_andamento` com base na linha `running` de `job_execucao`, mesmo quando a trava está livre (processo morto após deploy).

**Melhoria Proposta**
> Em `sincronizarSeDefasada`, tratar `running` como indício e deixar a trava decidir: tentar `executarPassada` e converter `IngestLockBusyError` em `em_andamento` (já feito em `rodarOuEmAndamento`). Alternativa: reduzir `RUN_PRESA_MS`.

**Resultado Esperado**
> Janela de bloqueio indevido de até 10 min → ≈ 0 após restart.

**Métricas de sucesso**
- Bloqueio após run morta: ≤ 10 min → ≈ 0

**Risco de não fazer**
> dado de lote velho por alguns minutos após cada deploy.

**Dependências**: nenhuma
**Consolidar com**: fault-tolerance-1 (run `running` morta)

---

### [testability-1] Testar as fronteiras exatas de TTL, run presa e cooldown

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> As três comparações de tempo que decidem se a tela dispara uma passada de ~25 s são testadas só com valores bem afastados do limite (10/45, 1/20, 2/6 min). Trocar `<` por `<=` não quebra teste algum.

**Melhoria Proposta**
> Em `SincronizacaoPassadaService.test.ts`, adicionar casos de fronteira (TTL-1 ms, TTL exato, 10 min exato, cooldown exato) usando `agora` injetado, e um caso `it.each` com os limites vindos de `sispagLotesSyncTtlMin`/`sispagLotesSyncCooldownMin` configurados distintos do padrão. Opcional: caso com `fast-check` (propriedade: `agora - finishedAt < ttl` ⇔ `fresca`).

**Resultado Esperado**
> Mutação `<` → `<=` nas 3 comparações derruba pelo menos 1 teste cada.

**Métricas de sucesso**
- Fronteiras com teste exato: 0/3 → 3/3
- `it` em `sincronizarSeDefasada`: 10 → ≥14

**Risco de não fazer**
> ajuste futuro do TTL/cooldown vira regressão silenciosa no pool de conexões.

**Dependências**: nenhuma

---

### [performance-1] Impor teto de duração à passada L11

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S (≤1d)
**Findings**: F-performance-1

**Problema**
> `sincronizarTodos()` não tem deadline; um Conexos pendurado mantém advisory lock e 1 conexão do pool presos, e toda abertura passa a responder `em_andamento`.

**Melhoria Proposta**
> Bound Execution Times: envolver `rodar` em timeout (ex. 120 s, configurável via `EnvironmentProvider`) com AbortSignal/`Promise.race`, finalizando a run como `error` e liberando a trava no `finally`. Tocar `SincronizacaoPassadaService.rodar` e teste com fake timers.

**Resultado Esperado**
> Passada pendurada encerra em <= 120 s e libera trava/conexão; teto de duração: infinito -> 120 s.

**Métricas de sucesso**
- Tempo máximo de retenção da trava: ilimitado -> <= 120 s
- Conexões de pool presas após timeout: 1 -> 0

**Risco de não fazer**
> um incidente do Conexos congela a sincronização de lotes até reiniciar o processo.

**Dependências**: nenhuma
**Consolidar com**: availability-1 (mesma correção: deadline na passada)

---

### [integrability-2] Serializar o uso da sessão do robô Conexos no servidor

**QA**: Integrability
**Tactic alvo**: Manage Resource Coupling
**Esforço**: S (≤1d)
**Findings**: F-integrability-2

**Problema**
> A ordem carteira→lotes é imposta pelo hook do frontend; o botão forçado e o cron usam outra chave de lock e podem concorrer com a ingestão pela mesma sessão do robô.

**Melhoria Proposta**
> Introduzir um lock de "sessão Conexos" compartilhado (ou checar a run `running` da ingestão antes de iniciar a passada e devolver `em_andamento`), no `SincronizacaoPassadaService`/`CarteiraAtualizacaoService`. Tactic: Manage Resource Coupling.

**Resultado Esperado**
> Passada L11 e ingestão nunca rodam simultaneamente; leituras com Bad Credentials/sessão derrubada por concorrência: não medido → 0.

**Métricas de sucesso**
- Recursos compartilhados protegidos por um único lock: 0 → 1

**Risco de não fazer**
> Falhas intermitentes de sincronização difíceis de diagnosticar em horário de pico.

**Dependências**: integrability-1 (opcional)

---

### [integrability-3] Validar as respostas de sincronização no frontend com Zod e fixar um teste de contrato

**QA**: Integrability
**Tactic alvo**: Adhere to Standards
**Esforço**: S (≤1d)
**Findings**: F-integrability-3, F-integrability-4

**Problema**
> O frontend usa `as SincronizacaoLotes` e mantém tipos duplicados; mudanças de contrato não são detectadas.

**Melhoria Proposta**
> Schema Zod em `src/frontend/lib/` para `SincronizacaoLotes` e um teste que parseia uma fixture JSON gerada pelo teste do backend. Extrair o helper de POST/erro comum a `atualizarCarteiraSeDefasada`. Tactic: Adhere to Standards.

**Resultado Esperado**
> Quebra de contrato falha no CI. Respostas validadas: 0/2 → 2/2.

**Métricas de sucesso**
- Respostas validadas por schema: 0 → 2
- Testes de contrato: 0 → 1

**Risco de não fazer**
> Regressão silenciosa de tela quando o backend evoluir o contrato.

**Dependências**: nenhuma

---

### [deployability-1] Adicionar flag de desligamento da sincronização ao abrir a tela

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> A sincronização de lotes ao abrir a tela (ADR-0066) só pode ser neutralizada por revert, porque TTL ≤ 0 volta ao default de 30 min. Se a passada atrapalhar as sessões do Conexos, a mitigação demora um deploy.

**Melhoria Proposta**
> Adicionar `SISPAG_LOTES_SYNC_ON_OPEN_ENABLED` (default `true`) em `EnvironmentVars`/`EnvironmentProvider`. Com `false`, `sincronizarSeDefasada` devolve `fresca` ou um novo estado `desativada`, sem tocar o Conexos. O botão forçado e o cron continuam. Documentar em `DEPLOY.md`. Tactic: Scale Rollouts.

**Resultado Esperado**
> Desligar o gatilho de abertura por env var em ≤ 5 min, sem redeploy de código.

**Métricas de sucesso**
- Tempo para desligar o gatilho: ciclo de deploy → ≤ 5 min
- Flags de desligamento: 0 → 1

**Risco de não fazer**
> um incidente de sessão Conexos causado pela tela só se contém com revert e redeploy em horário comercial.

**Dependências**: nenhuma

---

### [deployability-2] Reduzir o tempo de conexão presa durante a passada de L11

**QA**: Deployability
**Tactic alvo**: Surge Protection
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> `withAdvisoryLock` segura uma conexão do pool de 5 durante toda a passada (~25 s) só para manter o lock. As demais rotas disputam as 4 restantes.

**Melhoria Proposta**
> Opção 1: medir o p95 de espera por conexão durante a passada e, se relevante, usar um pool pequeno dedicado ao lock. Opção 2: subir o `max` do pool para 8 apenas no servidor. Tactic: Surge Protection.

**Resultado Esperado**
> Rotas do SISPAG sem degradação perceptível durante a passada: p95 de espera por conexão < 100 ms.

**Métricas de sucesso**
- Conexões livres durante a passada: 4 de 5 → ≥ 4 de 5 sem disputa medida (ou 7 de 8)

**Risco de não fazer**
> lentidão pontual nas telas quando cron, botão e abertura se encontram.

**Dependências**: nenhuma. Cruza com o QA de Performance.
**Consolidar com**: performance-3 (pressão sobre o pool de 5 conexões)

---

### [modifiability-1] Extrair política "atualizar se defasada" compartilhada

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: M (2–5d)
**Findings**: F-modifiability-1

**Problema**
> Carteira e lotes implementam TTL, cooldown e "em andamento" em services separados, com 4 vars de env para uma só política. Ajustar a regra exige tocar dois lugares.

**Melhoria Proposta**
> Criar helper/classe `PoliticaDefasagem` (puro, relógio injetável) usada por `CarteiraAtualizacaoService` e `SincronizacaoPassadaService`; mover `RUN_PRESA_MS` para a mesma política. Tactic: Abstract Common Services.

**Resultado Esperado**
> Uma única implementação testada da decisão; novas fontes SWR custam 1 service fino.

**Métricas de sucesso**
- Implementações da decisão TTL/cooldown: 2 -> 1

**Risco de não fazer**
> A 3ª fonte SWR copia o padrão pela 3ª vez e as regras divergem.

**Dependências**: nenhuma
**Consolidar com**: integrability-1 (mesma extração da política de defasagem)

---

### [testability-2] Extrair o relógio para um ClockProvider injetável e alinhar `ultimaSincronizacaoEm` ao `finished_at` da run

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: M (2–5d, se estendido a outros serviços; S só neste)
**Findings**: F-testability-2

**Problema**
> O relógio é um campo opcional `agora` nas entradas públicas e dois `Date.now()` de fallback; `ultimaSincronizacaoEm` em `atualizada` é o instante da requisição, não o `finished_at` real da run.

**Melhoria Proposta**
> Criar `ClockProvider` (`@singleton() @injectable()`, `now(): number`), injetar no serviço e remover `agora` da API; devolver `passada.finishedAt` (ou ler a run) em `ultimaSincronizacaoEm`. Adotar o mesmo provider nos demais serviços com `Date.now()` (ver Modifiability). Teste de skew: relógio do app ±2 min vs `finished_at`.

**Resultado Esperado**
> `Date.now()` no serviço: 2 → 0; API pública sem parâmetro de teste; 1 teste de skew novo.

**Métricas de sucesso**
- Leituras diretas de `Date.now()` no serviço: 2 → 0
- Testes de skew app/banco: 0 → 1

**Risco de não fazer**
> a decisão de TTL continua misturando dois relógios sem cobertura.

**Dependências**: card de Modifiability sobre clock injetável (cross-QA)

---

### [testability-3] Teste de integração da trava e de `listRecentRuns` contra Postgres real, e asserts de log nos erros

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M (2–5d)
**Findings**: F-testability-3, F-testability-4

**Problema**
> A invariante "uma passada por vez" e a ordenação `started_at DESC` só são provadas por mocks; os caminhos de erro não assertam o log `FLOW_ERROR`.

**Melhoria Proposta**
> Criar `describe('integration: SincronizacaoPassadaService')` (Postgres de teste, marcado e fora do `npm test` padrão) com 2 conexões disputando `SISPAG_SINCRONIZACAO_LOCK_KEY` e um caso de `listRecentRuns` com run `running` intercalada. Nos 2 testes de erro existentes, acrescentar `expect(logService.error).toHaveBeenCalledWith(...FLOW_ERROR...)`.

**Resultado Esperado**
> Integração com Postgres real para a trava: 0 → 2 casos; caminhos de erro com assert de log: 0/2 → 2/2.

**Métricas de sucesso**
- Casos de integração (trava + ordenação): 0 → 3
- Asserts de log em erro: 0/2 → 2/2

**Risco de não fazer**
> passadas duplicadas ou log mudo só descobertos em produção.

**Dependências**: banco de teste no CI (ver Deployability)

---

### [integrability-1] Extrair política de TTL/cooldown/estado para um componente comum

**QA**: Integrability
**Tactic alvo**: Abstract Common Services
**Esforço**: M (2–5d)
**Findings**: F-integrability-1

**Problema**
> `CarteiraAtualizacaoService` e `SincronizacaoPassadaService` repetem a decisão fresca/em_andamento/falha_recente/atualizada com a mesma configuração. O próximo gatilho (Nexxera retorno, GED) seria a terceira cópia.

**Melhoria Proposta**
> Criar uma classe `AtualizacaoSeDefasadaPolicy` (classe exportada, arrow methods) em `domain/service/sispag/` parametrizada por pipeline, TTL e cooldown, que recebe `listRecentRuns` e devolve a decisão. Os dois serviços passam a chamar a política e só executam a ação. Tactic: Abstract Common Services.

**Resultado Esperado**
> Uma única implementação testada; novo gatilho em ≤ 40 linhas. 2 cópias → 1.

**Métricas de sucesso**
- Implementações de SWR: 2 → 1
- LOC de decisão por serviço: ~80 → ≤ 15

**Risco de não fazer**
> Divergência de comportamento entre telas e custo repetido a cada integração nova.

**Dependências**: nenhuma
**Consolidar com**: modifiability-1 (mesma extração da política de defasagem)

---

### [modifiability-2] Quebrar page/lib/routes SISPAG por subdomínio

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: L (1–2sem)
**Findings**: F-modifiability-2

**Problema**
> `lib/sispag.ts` (1807), `page.tsx` (1582) e `routes/sispag.ts` (1270) acumulam toda a Frente II e cresceram neste delta.

**Melhoria Proposta**
> Dividir por subdomínio (carteira, lotes, remessa, retorno) em módulos/rotas/componentes; começar movendo o bloco de sincronização de lotes (hook + botão + cliente) para `app/sispag/lotes/`. Tactic: Split Module.

**Resultado Esperado**
> Nenhum arquivo SISPAG > 600 LOC; features tocam 1 subdomínio.

**Métricas de sucesso**
- Max LOC dos 3 arquivos: 1807 -> <= 600

**Risco de não fazer**
> Cada feature SISPAG fica mais cara e conflituosa.

**Dependências**: aplicar de forma proporcional em `/feature-tweak`

---


## P3 — Baixo

### [security-2] Atribuir o ator da passada à transição de lote e sanear `motivo`

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S
**Findings**: F-security-2, F-security-3

**Problema**
> A transição de status de lote provocada por `sispag:ver` fica atribuída ao job. O texto de falha é devolvido ao cliente por blacklist de padrões.

**Melhoria Proposta**
> Gravar `triggeredBy` (runId) no evento de transição do lote em `SincronizacaoLoteService`. Para papéis sem `sispag:executar`, devolver `motivo` genérico ("falha ao ler o Conexos, ver o painel de operação") e manter o detalhe redigido em `job_execucao`. Atualizar o ADR-0066 com a decisão.

**Resultado Esperado**
> 100% das transições de status com ator rastreável pelo `runId`, e nenhum texto livre de erro devolvido ao papel `ver`.

**Métricas de sucesso**
- Transições de lote com runId/ator: não verificado → 100%
- Campos de texto livre de erro expostos ao papel `ver`: 1 → 0

**Risco de não fazer**
> em uma auditoria de pagamento, a origem de uma transição de lote exige cruzar timestamps à mão.

**Dependências**: nenhuma

---

### [fault-tolerance-3] Rechecar o TTL após adquirir o lock

**QA**: Fault Tolerance
**Tactic alvo**: Comparison
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> A decisão "defasada?" é tomada antes do lock; duas aberturas quase simultâneas rodam duas passadas em sequência.

**Melhoria Proposta**
> Dentro de `rodar` (quando disparado por abertura), reler `listRecentRuns` e retornar `fresca` se já houver sucesso dentro do TTL (double-checked locking).

**Resultado Esperado**
> Passadas redundantes na janela de corrida: até 1 por rajada -> 0.

**Métricas de sucesso**
- Passadas dentro do TTL: possível -> 0

**Risco de não fazer**
> carga extra marginal no Conexos.

**Dependências**: nenhuma
**Consolidar com**: performance-2 (recheck do TTL dentro da trava)

---

### [modifiability-3] Aposentar stubs 410 e `sincronizarLote` após janela de cache

**QA**: Modifiability
**Tactic alvo**: Refactor
**Esforço**: S (≤1d)
**Findings**: F-modifiability-3

**Problema**
> Rotas 410 e o método por lote sem chamador permanecem como superfície de manutenção.

**Melhoria Proposta**
> Após 1 release, remover as rotas 410; reavaliar `sincronizarLote` conforme testes de decisão por lote (intencional hoje). Tactic: Refactor.

**Resultado Esperado**
> Menos superfície de API sem chamador.

**Métricas de sucesso**
- Rotas 410 de sincronização: 2 -> 0

**Risco de não fazer**
> Resíduo de API permanente.

**Dependências**: nenhuma

---

### [performance-2] Aplicar rate limit e reavaliar TTL dentro da trava

**QA**: Performance
**Tactic alvo**: Limit Event Response
**Esforço**: S (≤1d)
**Findings**: F-performance-2

**Problema**
> A rota de abertura não tem limiter e o TTL é lido antes da trava, permitindo passada redundante em rajada.

**Melhoria Proposta**
> Limit Event Response: adicionar limiter leve (ex. 10/min por usuário) a `/sincronizar-se-defasado` e, em `sincronizarSeDefasada`, rechecar o TTL dentro do callback `onAcquired` antes de `rodar`.

**Resultado Esperado**
> Passadas redundantes por rajada de aberturas: <= 1 -> 0; rota com limiter 0 -> 1.

**Métricas de sucesso**
- Passadas duplicadas em 10 aberturas simultâneas após TTL vencido: 1 possível -> 0

**Risco de não fazer**
> carga redundante ocasional sobre o Conexos.

**Dependências**: nenhuma
**Consolidar com**: fault-tolerance-3 (recheck do TTL dentro da trava)

---

### [deployability-3] Declarar as variáveis de sync no render.yaml

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (≤1d)
**Findings**: F-deployability-3

**Problema**
> `SISPAG_LOTES_SYNC_TTL_MIN` e `SISPAG_LOTES_SYNC_COOLDOWN_MIN` (e as da carteira) existem só em `DEPLOY.md`.

**Melhoria Proposta**
> Declarar as quatro em `render.yaml` com `sync: false` e os defaults documentados em comentário.

**Resultado Esperado**
> Configuração visível no blueprint: 0 de 4 → 4 de 4.

**Métricas de sucesso**
- Variáveis declaradas no blueprint: 0/4 → 4/4

**Risco de não fazer**
> baixo; confusão sobre qual valor está ativo.

**Dependências**: nenhuma

---

### [availability-3] Alertar quando a última passada bem-sucedida passa de um limite

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: M
**Findings**: F-availability-3

**Problema**
> A única notificação de falha é o aviso na tela de quem abre e o cron vermelho, que roda 2–3x/dia.

**Melhoria Proposta**
> Expor a idade da última passada `success`/`partial` no painel de operação e notificar quando passar de N horas úteis (Monitor). Reaproveitar os dados de `job_execucao`.

**Resultado Esperado**
> Detecção de credencial vencida ou Conexos fora em horas, sem depender de um analista abrir a tela.

**Métricas de sucesso**
- Alarmes sobre idade da sincronização: 0 → 1

**Risco de não fazer**
> repetir o padrão de 23/09, com falha silenciosa descoberta pelo usuário.

**Dependências**: painel de operação existente
**Consolidar com**: fault-tolerance-2 (mesmo sinal: idade da última passada bem-sucedida)

---

### [performance-3] Tornar a abertura assíncrona (202 + polling do estado)

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: M (2–5d)
**Findings**: F-performance-3

**Problema**
> A abertura mantém uma requisição HTTP de ~25 s e o front reconfere por até 48 s.

**Melhoria Proposta**
> Reduce Overhead: a rota de abertura inicia a passada em background e devolve `em_andamento` imediatamente; o front consulta um GET barato do estado. Só vale se o pool/timeout do proxy virarem restrição; ao migrar para Lambda, mover a passada para SQS/job.

**Resultado Esperado**
> Latência da rota de abertura de ~25 s -> < 300 ms p95.

**Métricas de sucesso**
- p95 da rota `sincronizar-se-defasado`: ~25 s -> < 0,3 s

**Risco de não fazer**
> na migração para Lambda a requisição síncrona de 25 s esbarra no timeout do API Gateway (29 s).

**Dependências**: performance-1
**Consolidar com**: deployability-2 (pressão sobre o pool de 5 conexões)

---

