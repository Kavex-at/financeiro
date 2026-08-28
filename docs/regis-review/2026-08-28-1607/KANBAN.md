---
type: regis-review-kanban
run_id: 2026-08-28-1607
scope: delta review — 2 commits on top of 617ca3b, branch fix/conexos-fallback-audit (--quick)
total: 21
counts: { p0: 0, p1: 4, p2: 9, p3: 8 }
resolved_in_cycle: 2
deferred_by_decision: 1
---

# Kanban — financeiro — 2026-08-28-1607

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (nenhum), P1 (S → XL), depois P2, P3.
>
> **Consolidações aplicadas** (ver REPORT.md §7):
> - `observability-business-warn` = merge de `availability-2` + `availability-3` + `performance-1` + `performance-2` + `security-4` + `fault-tolerance-3` (convergência de 5 QAs).
> - `conexos-cred-enc-key-config` = merge de `integrability-5` + `security-3`, **STATUS: DEFERRED-BY-DECISION**.
> - `conciliacao-execucao-tests` = merge de `testability-2` + `integrability-3` (dois agentes propuseram literalmente o mesmo card).
> - `fault-tolerance-1` + `modifiability-3` = **RESOLVIDOS no ciclo** (6º ledger `solicitacao_numerario` remediado por commit follow-up nesta mesma branch). NÃO aparecem abaixo.

---

## P0 — Crítico

_Nenhum. O `/feature-tweak` gate passa sem sub-loop._

---

## P1 — Alto

### [testability-1] Fechar a assimetria dos 4 ledgers: asserção da identidade no SQL

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> 4 dos 5 ledgers de execução (`Recebimento`, `SolicitacaoNumerario`, `Remessa`, `Conciliacao`) recebem no delta o mesmo `+22..+27 LOC` de produção que o `PermutaExecucaoRepository` — injeção do `ConexosIdentityProvider` e gravação de `conexos_username`/`conexos_usn_cod` em `beginExecution`/`markSettled`/`markError` — mas o `.test.ts` deles só ganhou um `buildIdentity()` mudo. `grep -c conexos_username` devolve **14** no de permuta e **1** em cada um dos outros três; qualquer regressão que pare de passar `conexosUsername` como parâmetro passa por `npm test` verde. É o findings F-testability-1.

**Melhoria Proposta**
> Portar os 4 `it()` de identidade do `PermutaExecucaoRepository.test.ts` (linhas 350-425 no diff) para os outros três test files, adaptando o shape esperado: "begin grava as duas colunas e PRESERVA no `ON CONFLICT` settled", "markSettled/markError usam `COALESCE(coluna, $novo)`", "sem identidade grava NULL". Manter o mesmo mock local `identidade(username, usnCod)`. Tactic Bass: `Executable Assertions`.

**Resultado Esperado**
> Razão de cobertura da nova invariante: **1/5 (20 %) → 4/5 (80 %)** (o 5º está no card `conciliacao-execucao-tests`). `# it()` no total: **+12** (4 por repo × 3 repos). LOC de código de produção sem teste correspondente: **91 → 47** (o resto vai no card `conciliacao-execucao-tests`).

**Métricas de sucesso**
- Asserções de identidade por test file: `Recebimento 1 → ≥ 4`, `SolicitacaoNumerario 1 → ≥ 4`, `Remessa 1 → ≥ 4`
- Suítes: 110 → 110 (mesmas suítes, +12 tests)
- Cobertura da nova invariante nos 5 ledgers: 20 % → 80 %

**Risco de não fazer**
> Refactor futuro dos executores (SISPAG e Recebimentos são áreas ativas) pode remover o parâmetro `conexosUsername`/`conexosUsnCod` do SQL sem que nenhum teste dispare — reproduzindo a cegueira que motivou ADR-0041 justo nas 3 frentes de maior volume.

**Dependências**: Nenhuma (o `buildIdentity()` já está no lugar).

---

### [conciliacao-execucao-tests] Criar `ConciliacaoExecucaoRepository.test.ts` — repo do fechamento SISPAG sem NENHUM teste

**QA**: Testability + Integrability (merge de `testability-2` + `integrability-3`)
**Tactic alvo**: Executable Assertions + Contract testing
**Esforço**: S (≤1d)
**Findings**: F-testability-2, F-testability-1, F-integrability-3

**Problema**
> `ConciliacaoExecucaoRepository.ts` (180 LOC, 5 métodos públicos: `findByIdempotencyKey`, `listByStatus`, `listReconcilingParadas`, `beginExecution`, `settle`, `fail`) **nunca teve** test file — é o único dos 5 ledgers `*Execucao*` sem cobertura de unit test. O delta adiciona 27 LOC nele (colunas de identidade + provider) sem gate automatizado. É o repo que fecha o lote SISPAG (transiciona para `settled`/`error`); regressão aqui = lote preso em `reconciling` na conciliação de retorno, exatamente o cenário que o `reaper-sispag-reconciling.ts` existe para mitigar. Dois agentes (Testability e Integrability) propuseram literalmente o mesmo card.

**Melhoria Proposta**
> Criar `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.test.ts` espelhando `RemessaExecucaoRepository.test.ts` (mesmo shape de repo `Execucao*` de SISPAG): asserções sobre `beginExecution` (write-ahead + preservar `settled` no `ON CONFLICT`), `settle` (SET `settled` + etapa), `fail` (COALESCE de handles), `findByIdempotencyKey`, `listByStatus`, `listReconcilingParadas` (auditoria de órfão). Incluir os 4 `it()` de identidade do card `testability-1`. Tactic Bass: `Executable Assertions` + `Abstract Data Sources`.

**Resultado Esperado**
> `describe(...)` = 0 → ≥ 3 (I-2 ledger, preservação de settled, identidade). `it(...)` = 0 → ≥ 12. Razão de cobertura da nova invariante nos 5 ledgers: **80 % → 100 %** (fecha o card `testability-1`). Cobertura por linha do repositório: 0 % → ~90 % (medível na próxima passagem sem `--quick`).

**Métricas de sucesso**
- `find … ConciliacaoExecucaoRepository.test.ts | wc -l`: 0 → 1
- Suítes: 110 → 111
- Tests: 1493 → ≥ 1505
- Repositórios de execução com teste unitário: 4/5 → 5/5

**Risco de não fazer**
> Bug em `settle`/`fail` da conciliação passa em qualquer PR; um `beginExecution` que regrida `settled` (o pior caso — segundo `processar` de um lote já baixado) fica indetectável. Como o ledger é `NULL`-permissivo, a regressão de identidade só aparece na auditoria dias/semanas depois.

**Dependências**: Nenhuma (o padrão do sibling `RemessaExecucaoRepository.test.ts` é copiável).

---

### [integrability-2] Substituir `ConexosRequestState.resolved: ConexosService` por uma interface mínima `{ getCapturedUsnCod(): string | null }`

**QA**: Integrability
**Tactic alvo**: Encapsulate
**Esforço**: S (≤1d)
**Findings**: F-integrability-2

**Problema**
> 4 arquivos de `domain/` importam a classe `ConexosService` do pacote LEGADO `services/`. Isso é o contrário do vetor de migração (`services/` deve encolher). Além disso, congela um contrato tácito: a v0.2 do transporte Conexos precisa manter `getCapturedUsnCod` assinatura idêntica, senão o `ConexosIdentityProvider.current()` quebra silenciosamente.

**Melhoria Proposta**
> Declarar em `ConexosRequestContext.ts` uma interface `ConexosSessionCapture { getCapturedUsnCod(): string | null }` e tipar `resolved?: ConexosSessionCapture`. `ConexosService` continua satisfazendo estruturalmente. Remover os 4 `import type { ConexosService }` de `domain/`. **Tactic Bass alvo: Encapsulate.**

**Resultado Esperado**
> `grep -rn "import type { ConexosService }" src/backend/domain/` retorna 0 (hoje: 4). Substituir `services/conexos.ts` por `domain/client/ConexosBaseClient` puro na v0.2 deixa de exigir manter esse método específico — basta satisfazer a interface.

**Métricas de sucesso**
- `import type { ConexosService }` em `src/backend/domain/`: 4 → 0
- Arquivos que a v0.2 precisa manter assinatura-compatível: 1 (`ConexosService`) → 0 (satisfaz interface)

**Risco de não fazer**
> Em 6 meses, quem for migrar `services/conexos.ts` para `domain/client/` descobre o acoplamento tarde e precisa manter shim de compatibilidade só para o `getCapturedUsnCod` — dobra o custo da substituição.

**Dependências**: Nenhuma (pode acontecer antes ou depois de `integrability-1`)

---

### [conexos-cred-enc-key-config] Declarar `CONEXOS_CRED_ENC_KEY` em `render.yaml` (`sync: false`) e no `.env.example`

**QA**: Integrability (P1) + Security (P2) — merge de `integrability-5` + `security-3`
**Tactic alvo**: Configure Behavior + Change Default Settings
**Esforço**: S (≤1d)
**Findings**: F-integrability-6, F-security-3

**STATUS: DEFERRED-BY-DECISION** — decisão explícita do Yuri neste ciclo, já registrada em `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-1. Não é overlook; é seguro em produção (a chave está lá). Card mantido no Kanban para reingresso no próximo ciclo de planning.

**Problema**
> A chave de cifra do vínculo Conexos existe em produção mas não está declarada em nenhum arquivo de contrato de config. Todo ambiente que não seja produção (staging futuro, dev pessoal, tenant novo) roda com `SecretCipher.isEnabled()` = false — a Fatia B inteira desliga silenciosamente, todo usuário vinculado degrada para o robô. O `warn` I-1 sequer dispara nesse caso (é o caminho "sem vínculo", não "vínculo presente inutilizável"). Se a chave for **removida** de produção por acidente, o mesmo cenário se instala em prod.

**Melhoria Proposta**
> Adicionar `CONEXOS_CRED_ENC_KEY: { sync: false }` no `render.yaml` (bloco `envVars` do serviço backend) e um placeholder comentado em `src/backend/.env.example` (com instrução de como gerar via `node -e "..."`). Opcional: fail-fast no bootstrap se a chave estiver ausente **fora** de produção-legada, para que dev novo bata na parede em vez de operar em modo degradado. Complemento útil: smoke-test em boot que loga um `warn` se `SecretCipher.isEnabled() === false` **e** houver usuários com `conexos_username != null` no DB — sinaliza "vínculos cadastrados sem chave para decifrar". **Tactic Bass alvo: Configure Behavior.**

**Resultado Esperado**
> `grep -rn "CONEXOS_CRED_ENC_KEY" src/backend/.env.example render.yaml` retorna 2 matches. Novo dev/staging sabe **antes de rodar** que precisa de uma chave; se subir sem ela, o boot falha ou grita. Ambientes com atribuição individual = 100% (hoje: prod=100%, staging/local=0%).

**Métricas de sucesso**
- Arquivos de contrato de config declarando a chave: 0/2 → 2/2
- Ambientes que degradam silenciosamente: N → 0 (com fail-fast opcional)

**Risco de não fazer**
> O segundo tenant sobe sem a chave e ninguém percebe. A Fatia B fica de enfeite lá; a auditoria de identidade acumula `NULL/NULL` porque o vínculo sempre falha em `decrypt`. Se a chave sair de prod, silencia até que auditoria repare.

**Dependências**: Nenhuma. Já registrado no `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-1 como "segurado pelo Yuri". Dois QAs independentes (Integrability P1, Security P2) confirmam a materialidade — o adiamento é conhecido, não é subestimativa.

---

## P2 — Médio

### [availability-1] Blindar `avisarDegradacao` e `degradarParaRobo` contra exceções do path de observabilidade

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: S (≤1d)
**Findings**: F-availability-1, F-availability-2

**Problema**
> `ConexosSessionResolver.avisarDegradacao` (linha 126) e `degradarParaRobo` (linha 118) estão no `catch` da escrita ao ERP mas não têm `try/catch` próprio. O comentário promete "Nunca lança (o log não pode derrubar a execução)" — hoje é verdade por inspeção (`LogService.warn` só faz `stdout.write`), mas nada impõe. Um sink futuro que introduza `throw` em `warn`, ou um SSM instável no alvo Lambda, transforma "credencial ruim → escrita segue pelo robô" (decisão de ADR-0041) em "credencial ruim → escrita aborta com erro do logger".

**Melhoria Proposta**
> Envolver `logService.warn(...)` em `avisarDegradacao` num `try/catch` que loga o erro do próprio logger em `process.stderr.write` (último recurso, síncrono) e retorna. Envolver o `await this.environmentProvider.getEnvironmentVars()` em `degradarParaRobo` num `try/catch` que degrada mesmo assim (`state.identity = { conexosUsername: 'unknown-robot', viaRobo: true }`; o ledger grava `unknown-robot`, não NULL — e passa a ser marcador distinto de "identidade não capturada"). Tactic Bass alvo: **Exception Prevention**. Adicionar teste que injeta `logService.warn` throwing e `environmentProvider` throwing e verifica que `resolve()` ainda devolve `ROBOT`.

**Resultado Esperado**
> Nenhum defeito na camada de observabilidade pode abortar uma escrita ao ERP. "Nunca lança" deixa de ser aspiração e vira invariante testada. Métrica: `catch` defensivos no path de fallback: 0 → 2. Casos de teste que injetam falha no logger e no env: 0 → 2.

**Métricas de sucesso**
- `try/catch` em torno de `logService.warn` no path de escrita: 0 → 1
- `try/catch` em torno de `environmentProvider.getEnvironmentVars` no fallback: 0 → 1
- Teste que injeta logger throwing e verifica `resolve() === ROBOT`: ausente → presente

**Risco de não fazer**
> Uma mudança futura no `LogService` (sink de rede, `pino`, worker) passa despercebida em code review porque o resolver "está seguro"; o próximo incidente é uma escrita financeira derrubada pelo logger em vez de protegida pelo fallback — regressão de disponibilidade oculta atrás de uma mudança em código de observabilidade.

**Dependências**: Nenhuma.

---

### [observability-business-warn] Instrumentar consumer + alarme + dedup sobre o `BUSINESS_WARN` com `motivo in (decrypt, login)`

**QA**: Availability + Fault Tolerance + Performance + Security (merge de `availability-2` + `availability-3` + `performance-1` + `performance-2` + `security-4` + `fault-tolerance-3`)
**Tactic alvo**: Monitor + Inform Actors + Manage Sampling Rate + Prioritize Events
**Esforço**: M (2–5d)
**Findings**: F-availability-3, F-availability-4, F-fault-tolerance-4, F-performance-1, F-performance-2 (nota MTTD), F-security-4

**Problema**
> O delta fecha a lacuna de **registro** (`warn` estruturado com `platformUsername`, `conexosUsername`, `motivo`, `erro`) mas não a de **notificação**. Nenhum consumer lê o log — `grep -rn "BUSINESS_WARN" src/backend | grep -v test | grep -v ConexosSessionResolver` retorna vazio. O incidente `MARILYN_MUTAFCI` de 2026-08-25 (35 execuções degradadas, 13 num dia só, meses sem detecção) prova que ninguém abre log por conta própria: sem push, o warn continua invisível. Além disso, sob configuração ausente de `CONEXOS_CRED_ENC_KEY` em massa (dívida F-1 dos follow-ups), o warn sem dedup vira flood (~1000 linhas/dia projetadas para 5 usuários × 200 req/dia). Cinco agentes (Availability × 2, Fault Tolerance, Performance × 2, Security) convergiram no mesmo item — a convergência é o próprio argumento para prioridade.

**Melhoria Proposta**
> Três frentes coordenadas na mesma stack (não em três iniciativas separadas):
> 1. **Dedup no emissor** (`ConexosSessionResolver`): `Map<`${conexosUsername}:${motivo}`, number>` em memória (TTL 1h). `avisarDegradacao` só emite se `Date.now() - lastAt > 3600_000`; senão incrementa contador `suppressed` que sai no próximo warn como `data.suppressed = N`. Sem persistência, sem lock. Tactic: `Manage Sampling Rate`.
> 2. **Métrica dedicada** `conexos_fallback_total{conexosUsername, motivo}` (Prometheus/CloudWatch/o que o `LogService` expor no futuro), incrementada em `avisarDegradacao`. Alarme sobre `rate(conexos_fallback_total[15m]) > 0`. Tactic: `Prioritize Events`.
> 3. **Consumer/alarme** no destino de log (Better Stack / Grafana Loki / Papertrail — Render suporta sink HTTP): "1 ocorrência de `type=BUSINESS_WARN` e `data.motivo in (decrypt, login)` em janela de 10min → aviso ao canal de operações Kavex; 5 ocorrências do mesmo `data.conexosUsername` em 24h → escalar para o Yuri". Tactic: `Inform Actors`. Documentar em `ontology/integrations/conexos.md` §"Identidade da sessão".

**Resultado Esperado**
> MTTD (mean time to detect) de vínculo Conexos quebrado cai de "meses (foi o caso 2026-08-25)" para ≤ 15 minutos. Volume de warns sob falha em massa cai de ~1000 linhas/dia para ~120 linhas/dia. O operador é notificado no canal onde já mora, sem precisar abrir log. Substitui F-5 dos followups.

**Métricas de sucesso**
- Alarmes/regras consumindo `BUSINESS_WARN` com `motivo in (decrypt, login)`: 0 → ≥1
- MTTD estimado para "usuário com vínculo cai no robô": não medível hoje → ≤ 15 min
- Warns/dia sob cenário de falha em massa: ~1000 → ~120
- Warns/dia sob cenário normal (13 execuções em pico): 13 → 13 (sem regressão)
- Métrica `conexos_fallback_total{motivo, conexosUsername}`: ausente → presente
- Documentação em `ontology/integrations/conexos.md`: ausente → presente

**Risco de não fazer**
> Outro incidente análogo ao de 2026-08-25 acontece — o warn agora existe, mas passa despercebido pelas mesmas semanas até um usuário reclamar. A ADR-0041 entrega metade do valor sem esta iniciativa. Sem dedup, quando o alarme existir, o excesso de sinal fatiga o canal justamente em picos (fechamento de mês, chave rotacionada) — quando o sinal é mais necessário.

**Dependências**: escolha do sink de log (decisão do Yuri; hoje o Render envia stdout apenas para o console interno). Longer-term: requer decisão de stack de métricas (StatsD? OTel? CloudWatch EMF via `LogService`?).

---

### [integrability-1] Mover `ConexosIdentityProvider` para fora de `domain/client/` (é query in-process, não adapter externo)

**QA**: Integrability
**Tactic alvo**: Restrict Communication Paths
**Esforço**: S (≤1d)
**Findings**: F-integrability-1

**Problema**
> 5 repositórios (`Permuta`, `SolicitacaoNumerario`, `Recebimento`, `Remessa`, `Conciliacao`) agora importam de `domain/client/`, invertendo o fluxo canônico `Handler→Service→Repository→Client` do CLAUDE.md. `ConexosIdentityProvider` não faz I/O externo — só lê `AsyncLocalStorage` — logo não é um "client" no sentido Bass/DDD do projeto.

**Melhoria Proposta**
> Mover para `src/backend/domain/libs/requestContext/ConexosIdentityProvider.ts` (ou `src/backend/domain/service/ConexosIdentityProvider.ts` se ficar mais confortável ao PatternGuardian). Ajustar os 5 imports nos repositórios. **Tactic Bass alvo: Restrict Communication Paths.**

**Resultado Esperado**
> `grep -c "domain/client" src/backend/domain/repository/**/*ExecucaoRepository.ts` cai para 0 (hoje: 5). PatternGuardian pode adicionar regra "domain/repository não importa domain/client".

**Métricas de sucesso**
- Repositórios importando de `domain/client`: 5 → 0
- Regra de PatternGuardian nova: 0 → 1

**Risco de não fazer**
> Quando uma sexta frente for adicionada (`fin010` write, por exemplo), o autor copia o padrão errado; a inversão de camada se solidifica como convenção de fato.

**Dependências**: Nenhuma.

---

### [integrability-4] Trocar o `AsyncLocalStorage` implícito por um teste-guarda que impeça chamar `ExecucaoRepository.begin*` fora de `conexosRequestContext.run(...)`

**QA**: Integrability
**Tactic alvo**: Manage Resource Coupling
**Esforço**: S (opção teste-guarda) / M (opção threading explícito)
**Findings**: F-integrability-5

**Problema**
> `beginExecution`/`markSettled`/`markError`/`fail` têm dependência oculta do `AsyncLocalStorage`. Chamada fora de request grava `NULL/NULL` sem que o compilador avise. Threading explícito (`begin(input, identity)`) resolveria mas custa 5 refactors de assinatura pública; o compromisso mínimo é uma barreira em runtime que faça o teste falhar.

**Melhoria Proposta**
> Adicionar em `ConexosIdentityProvider.current()` (ou num wrapper) uma modo `strict` que lance quando `conexosRequestContext.getStore()` é `undefined` **e** o repositório está prestes a escrever `NOT NULL`-esperado. Alternativa mais barata: um `describe`-guarda em cada `*ExecucaoRepository.test.ts` que rode `beginExecution` sem `.run(...)` e afirme que grava NULL — documentando o comportamento em vez de mudá-lo. **Tactic Bass alvo: Manage Resource Coupling.**

**Resultado Esperado**
> Uso do repositório fora de contexto vira erro **explícito** (ou fica coberto por teste declarativo). Novos autores enxergam a dependência sem precisar ler `ConexosIdentityProvider.ts`.

**Métricas de sucesso**
- Métodos públicos com dependência de `AsyncLocalStorage` sem barreira: 5 → 0
- Testes-guarda documentando o comportamento fora de request: 0 → 5

**Risco de não fazer**
> Um novo job/cron chama o repositório direto (achando que "identidade opcional = ok"), grava `NULL/NULL`, e a coluna nova perde poder de auditoria justamente onde é mais valiosa — jobs de conciliação em massa.

**Dependências**: Benefícia de `integrability-1` (provider fora de `domain/client/`), mas independe dele.

---

### [modifiability-1] Extrair fragmento SQL de identidade Conexos em helper compartilhado dos ledgers

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services / Encapsulate
**Esforço**: M (2–5d)
**Findings**: F-modifiability-1

**Problema**
> O delta replicou textualmente ~60 linhas de SQL de identidade Conexos (`CASE WHEN status='settled' … END` e `COALESCE(conexos_username, $conexosUsername)`) em 5 repositórios `*Execucao`, mais 15 chamadas de `identityProvider.currentParams()`. Uma mudança futura de forma (novo campo, nova regra de preservação, migração para `jsonb`) exige tocar todos os 5 no mesmo commit — sem nada que garanta consistência entre eles. Repete estruturalmente o padrão pré-existente de `executado_por` (que já sofre da mesma duplicação), compondo o débito em vez de introduzí-lo.

**Melhoria Proposta**
> Aplicar **Abstract Common Services**: extrair um `ExecucaoIdentitySql` (ou similar) em `src/backend/domain/repository/_shared/` que exporte 3 fragmentos parametrizados — `insertColumns()`, `insertValues()`, `onConflictPreserve(tableName)`, `updateCoalesce()` — e um método `mergeParams(base, identity)`. Cada `beginExecution`/`markSettled`/`markError` compõe seus INSERTs/UPDATEs consumindo o helper. Alternativa mais radical (rejeitar por ora): interface `IExecucaoLedger` + template method — leaky abstraction, pois cada ledger tem colunas materialmente diferentes.

**Resultado Esperado**
> 5 sítios de `CASE WHEN status='settled'` → 1 função pura testada isoladamente. Nova coluna de auditoria custa 1 edição em vez de 5. Ocorrências de `identityProvider.currentParams()` caem de 15 → ≤ 5. `PermutaExecucaoRepository.ts` sai de 479 LOC para <460 (o efeito é modesto, mas centraliza o *ponto de mudança*).

**Métricas de sucesso**
- Linhas SQL duplicadas de identidade (`grep -c 'conexos_username' src/backend/domain/repository/**/*Execucao*.ts` somado): 25 → ≤ 5
- Chamadas de `identityProvider.currentParams()`: 15 → ≤ 5
- Nova ledger custa (LOC no repo novo referente a identidade): ~22 hoje → ≤ 5

**Risco de não fazer**
> Cada nova frente financeira soma mais ~22 LOC de duplicado por ledger e amplia a superfície de "esquecer um deles". O incidente que motivou o delta foi exatamente uma execução silenciosamente assinada errado — se em 6 meses um ledger sair de forma, o remédio deixa de funcionar naquela frente sem alarme.

**Dependências**: Nenhuma; pode entrar como próximo `/feature-tweak` sobre a mesma família de arquivos.

---

### [security-1] Sanitizar `erro` no `warn` I-1 e travar por teste

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S (≤1d)
**Findings**: F-security-1, F-security-2

**Problema**
> `ConexosSessionResolver.avisarDegradacao` passa `error.message` cru para o log. Hoje, os dois caminhos de origem (`SecretCipher.decrypt` e `ConexosService.ensureSid`) produzem mensagens seguras, mas a garantia é indireta e frágil: depende do `redactSensitive` do interceptor axios, de ninguém wrap-and-rethrow do `err.config.data`, e de `SecretCipher` nunca incluir amostras do ciphertext em mensagens. Uma mudança de uma linha em qualquer desses três lugares vaza a senha Conexos do usuário para o stdout do Render — de onde qualquer insider com acesso ao agregador de logs extrai e usa para assinar baixas em nome do usuário sem levantar suspeita.

**Melhoria Proposta**
> Aplicar `redactSensitive` (já existente em `src/backend/services/conexos.ts:53`) ao campo `erro` do `warn` — o consumidor sanitiza, sem confiar no produtor (**Limit Exposure** em defesa-em-profundidade). Além disso, opcional: reduzir o `erro` a um shape estável (`{ name, code, statusCode }`) em vez do `.message` cru, para o log virar métrica sem ficar dependente de string livre.

**Resultado Esperado**
> Payload do `warn` provavelmente livre de qualquer valor sensível, independente de mudanças upstream no axios ou no SecretCipher. Métrica: campos do `data` do `warn` passando por sanitizador antes de sair — 0 → 1 (o `erro`).

**Métricas de sucesso**
- Chamadas ao `LogService` no delta com campo cru vindo de `error.message`: 1 → 0
- Testes que asseveram ausência de padrões sensíveis no `data.erro`: 0 → ≥2 (um por `motivo`)

**Risco de não fazer**
> Uma mudança futura (bem-intencionada, para "melhorar o debug") vaza a senha Conexos para o log sem quem tocou perceber; sem gate CI, ninguém acusa.

**Dependências**: —

---

### [security-2] Teste explícito de sanitização do payload do `warn` I-1

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S (≤1d)
**Findings**: F-security-1, F-security-2

**Problema**
> Os testes atuais do resolver cobrem que o `warn` dispara e que os campos estruturais estão certos, mas não têm asserção do tipo "se o erro contiver a string da senha, o log não deve contê-la". Sem essa trava, `security-1` pode ser desfeito silenciosamente numa refatoração.

**Melhoria Proposta**
> Adicionar dois testes em `ConexosSessionResolver.test.ts`: um mocka `SecretCipher.decrypt` para lançar `new Error('senha=<PLAINTEXT_MARKER>')`; outro mocka `service.ensureSid` para lançar `new Error('body=<CIPHERTEXT_MARKER>')`. Ambos asseveram que `logService.warn` não recebe nenhuma das marcações no `data.erro`. Fica como regressão para `security-1`.

**Resultado Esperado**
> CI trava qualquer alteração que reintroduza payload sensível no `warn`. Métrica: 0 → 2 testes de sanitização.

**Métricas de sucesso**
- Testes de sanitização do `warn`: 0 → 2
- Regressão de vazamento detectada por CI antes do PR: 0% → 100%

**Risco de não fazer**
> Mesmo risco de `security-1` mais "fica invisível quando quebrar".

**Dependências**: Idealmente merge junto com `security-1`.

---

### [testability-3] Teste de aplicação de migrations em Postgres docker (`Sandbox`)

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M (2-5d) — inclui subir docker no CI Render
**Findings**: F-testability-3

**Problema**
> Nenhuma das 51 migrations do repo tem teste de aplicação. `_shared-metrics.md` linha 43 registra que `0051` foi validada "em Postgres LOCAL (docker) sobre schema em `0050`" — validação à mão, sem gate automatizado. Não há `docker-compose.test.yml`, não há `describe('integration: ...')` nas migrations, não há script `test:migrations`. Os 4 critérios de T2 (`IF NOT EXISTS` idempotente, NULLABLE sem default, sem backfill/índice, aplica limpo sobre 0050) são todos validados manualmente. F-testability-3.

**Melhoria Proposta**
> Adicionar `src/backend/scripts/test-migrations.sh` que suba um Postgres docker efêmero (`postgres:16-alpine`), rode `migrations/migrate.ts` até `0051`, execute `\d+ permuta_alocacao_execucao` (e as outras 4) via `psql`, faça asserções sobre a presença/tipo/nullability de `conexos_username` e `conexos_usn_cod`, e re-rode `migrate.ts` para verificar idempotência (segunda aplicação = no-op). Publicar como target `npm run test:migrations` (fora do `npm test` default, para não exigir docker localmente). Adicionar chamada no CI (GitHub Actions do deploy Render). Tactic Bass: `Sandbox` + `Specialized Interfaces` (shape assertion sobre `information_schema.columns`).

**Resultado Esperado**
> `# testes de migration` no repo: 0 → 1 (script) cobrindo 51 migrations. Critérios T2 automatizados: 0/4 → 4/4. Deteção automática de: `ADD COLUMN` sem `IF NOT EXISTS`, `NOT NULL` sem default, `DEFAULT 'MPS_ROBO'` (violação da regra "NULL = não capturada").

**Métricas de sucesso**
- Migrations com asserção de shape: 0 → 51
- Idempotência automatizada: sim
- Tempo do gate no CI: alvo < 30s

**Risco de não fazer**
> Uma migration futura remove `IF NOT EXISTS` (ou pior, adiciona `DEFAULT 'MPS_ROBO'`) e o problema só aparece 6 semanas depois quando alguém for auditar por identidade.

**Dependências**: Decisão do Yuri sobre docker no CI (o deploy é Render hook — o CI hoje é mínimo). Cross-QA: overlap com **Deployability** (gate antes de deploy) e com **Fault Tolerance** (invariante de idempotência).

---

### [testability-4] Teste de integração leve: resolver → provider → ledger com PG mockado

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: M (2-5d)
**Findings**: F-testability-4, F-testability-1

**Problema**
> As 3 peças novas — `ConexosSessionResolver` (publica `state.identity`), `ConexosIdentityProvider` (lê e achata em `currentParams`), `*ExecucaoRepository` (persiste as duas colunas) — são testadas peça a peça mas **nunca fechadas** por um teste que exercite as três com o `AsyncLocalStorage` real. Um refactor que quebre a publicação (por exemplo, `Object.assign(state, {identity})` vs `state.identity = …` num proxy) passa por todos os 17 tests novos. F-testability-4.

**Melhoria Proposta**
> Um novo test file (`ConexosIdentityFlow.test.ts`) que instancia `SessionResolver` + `IdentityProvider` reais (só `PostgreeDatabaseClient`, `UserRepository`, `ConexosSessionRegistry` mockados), roda `conexosRequestContext.run({ platformUsername: 'x@kavex.com' }, async () => { await resolver.resolve(); await repo.beginExecution(...); await repo.markSettled(...); })` para uma matriz `[vínculo válido, decrypt-fail, login-fail, sem-vínculo, fora-de-request] × [Permuta, Recebimento, SolicitacaoNumerario, Remessa, Conciliacao]` e asserta os parâmetros do INSERT/UPDATE mockado. Tactic Bass: `Executable Assertions` + `Limit Structural Complexity` (o teste vira o gate do encanamento).

**Resultado Esperado**
> `# testes end-to-end da identidade`: 0 → 25 (5 cenários × 5 ledgers) ou pelo menos 5 (1 por ledger). Cobertura dos critérios T3 "vínculo válido → login do usuário" e "fallback → login do robô": mocks isolados → fio real. Refactor que quebre a publicação **falha** o teste.

**Métricas de sucesso**
- Testes end-to-end da identidade: 0 → ≥ 5 (1 por ledger)
- Critérios T3 com asserção end-to-end: 0/2 → 2/2

**Risco de não fazer**
> Refactor futuro do `ConexosRequestContext` (por exemplo, migrar para OpenTelemetry Context) quebra silenciosamente a publicação; as 5 frentes voltam a gravar NULL como se estivessem fora de request.

**Dependências**: cards `testability-1` e `conciliacao-execucao-tests` (o 5º ledger precisa ter test file).

---

## P3 — Baixo

### [deployability-1] Portar `bump-version.ps1` para um sibling shell/node executável na máquina Linux

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (≤1d) — a lógica cabe em ~120 LOC de Node puro
**Findings**: F-deployability-1

**Problema**
> O único script canônico de release é pwsh, ausente na máquina de desenvolvimento atual. O bump da v0.31.1 foi feito à mão — bateu byte a byte com o script (verificado), mas nada garante que a próxima replicação seja fiel. Um bump com FE/BE fora de lockstep, ou entrada de CHANGELOG na posição errada, é o modo de falha esperado.

**Melhoria Proposta**
> Criar `scripts/bump-version.mjs` (Node puro, sem dependências externas) espelhando a lógica documentada no cabeçalho do `.ps1`: leitura semver + detecção de nível pelos conventional-commits de `origin/main..HEAD` + escrita FE+BE em lockstep + inserção da entrada no CHANGELOG após o header. Manter o `.ps1` como referência para Windows. Adicionar `bump:dry`/`bump:execute` no `package.json` da raiz (novo) ou de `src/backend/`.

**Resultado Esperado**
> `node scripts/bump-version.mjs` (dry-run) e `node scripts/bump-version.mjs --execute` funcionam nesta máquina. Toda release futura passa por script, não por replicação manual. Zero divergência entre `package.json` de FE e BE em qualquer commit `chore(release):`.

**Métricas de sucesso**
- `# scripts de release executáveis nesta máquina`: 0 → 1
- `# releases feitas por replicação manual` (medido em `git log --oneline --grep "chore(release)" main..HEAD` ao longo dos próximos 3 meses): trending → 0

**Risco de não fazer**
> Divergência FE≠BE numa release futura, tempo de depuração de "que versão do FE tem esse bug" quando o `/health` do BE mentir sobre o app.

**Dependências**: Nenhuma.

---

### [deployability-2] Alinhar `render.yaml` com a realidade (`BootMigrator` é a autoridade de ordering) ou reativar o pre-deploy

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (opção a: minutos) / M (opção b: reconfiguração + validação)
**Findings**: F-deployability-2

**Problema**
> O `render.yaml` declara `preDeployCommand: npm run migrate && npm run seed:admin`, que **nunca roda** (o serviço foi configurado pelo dashboard e pre-deploy é plano pago). A doutrina real — migrar dentro do boot antes de `listen()` — só está escrita na docstring do `BootMigrator`. Este delta adiciona a migração `0051`; sua segurança depende de ninguém "arrumar" o yaml achando que resolve o problema.

**Melhoria Proposta**
> Duas alternativas, escolher uma no PR:
> **(a) Documentar a inércia no próprio yaml**: substituir a linha `preDeployCommand:` por um comentário `# preDeployCommand INERTE — serviço configurado pelo dashboard, ver src/backend/migrations/BootMigrator.ts` e apagar o comando; a fonte de verdade fica única.
> **(b) Reativar o pre-deploy**: upgrade do plano do Render + reconfigurar via Blueprint; então o `preDeployCommand` volta a rodar e o `BootMigrator` vira defense-in-depth (mantém o advisory lock e o guard-rail local, mas o caminho normal é pre-deploy). Custo mensal + trabalho de reconfiguração.

**Resultado Esperado**
> O operador que ler o `render.yaml` entende quem aplica migrações, sem precisar abrir docstring de código.

**Métricas de sucesso**
- `# fontes de verdade divergentes para "quem aplica migrações"`: 2 → 1

**Risco de não fazer**
> Alguém "consertar" o yaml num futuro `chore(deploy):` e reativar o bug de 2026-08-10 na próxima migração destrutiva.

**Dependências**: Se escolher (b), precisa de aprovação de custo mensal no plano do Render.

---

### [deployability-3] Runbook de release + verificação pós-deploy do `/health`

**QA**: Deployability
**Tactic alvo**: Rollback + Deployment observability
**Esforço**: S (≤1d) — documento de ~1 página + job opcional no CI
**Findings**: F-deployability-3

**Problema**
> Este delta ship DDL em produção (5× `ALTER TABLE`), e a versão do app sobe para 0.31.1 — mas não existe checklist de release enumerando o passo trivial de `curl https://<render-url>/health` para confirmar o swap, nem de `SELECT name FROM schema_migrations WHERE name='0051_execucao_identidade_conexos.sql'` para confirmar a aplicação. Rollback (Render dashboard → previous deploy) também não está documentado. Durante um incidente na janela do próximo release, MTTR sobe pelo custo de contexto.

**Melhoria Proposta**
> Criar `docs/runbooks/release.md` (genérico, não por versão) com:
> 1. Como verificar que o Render promoveu: `curl -s $URL/health | jq .version` == versão do `package.json`.
> 2. Como verificar que a migração aplicou: `SELECT name, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 3`.
> 3. Como fazer rollback: dashboard Render → Deploys → "Rollback to this deploy". O que acontece com o schema (backward-compat = colunas ficam, código antigo ignora).
> 4. Sinais de que o `BootMigrator` travou (log `outra instância está migrando`) e como intervir.
> Opcional: novo job pós-deploy no `ci.yml` que faça `curl $URL/health` e asserte `version === $EXPECTED`.

**Resultado Esperado**
> Operador que promove a `main` executa o runbook em < 2 min e sabe se a release deu certo, sem abrir código-fonte.

**Métricas de sucesso**
- `# releases com verificação automatizada de /health`: 0 → 1 (com o job no CI)
- MTTR estimado do próximo incidente de release: baseline não medido → alvo < 15 min

**Risco de não fazer**
> Próxima release com DDL não-idempotente ou não-backward-compat (ex.: `DROP COLUMN`, `ADD COLUMN NOT NULL`) chega em produção sem checklist e o MTTR fica preso ao tempo de leitura de docstring.

**Dependências**: Nenhuma (documento) / lockstep com `deployability-1` se quiser padronizar scripts de release num só lugar.

---

### [fault-tolerance-2] Defender `avisarDegradacao` contra falha do logger

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking
**Esforço**: S (≤1d — 15 linhas + 1 teste)
**Findings**: F-fault-tolerance-2

**Problema**
> O caminho de degradação (`resolveForUser` → `catch` → `avisarDegradacao` → `await logService.warn`) não tem try/catch em torno da chamada ao logger. `LogService.warn` hoje só escreve em stdout — risco baixo — mas se um dia ganhar persistência em DB (ou o stdout do container falhar com EPIPE), a exceção sobe até `resolve()` e derruba a escrita financeira. Ou seja: um bug de logging transforma o fallback silencioso corrigido pela ADR-0041 numa queda dura da baixa/remessa/conciliação.

**Melhoria Proposta**
> Envolver a chamada em try/catch dentro de `avisarDegradacao` (`ConexosSessionResolver.ts:143-151`), engolindo o erro com um `process.stderr.write` de último recurso. Adicionar 1 teste no `ConexosSessionResolver.test.ts` que mocka `logService.warn` para lançar e verifica que `resolve()` ainda devolve o robô. Tactic Bass: **Sanity Checking** aplicada ao próprio ponto de detecção.

**Resultado Esperado**
> Log jamais derruba caminho de escrita financeira. Semântica: "fallback silencioso ao usuário" ficou observável, "fallback silencioso à operação" continua observável, "log quebrado" nunca vira indisponibilidade.

**Métricas de sucesso**
- Testes que cobrem "warn lança → resolver segue devolvendo robô": 0 → 1
- `try { await this.logService.warn(...) } catch { ... }` presente em `avisarDegradacao`

**Risco de não fazer**
> Um refactor futuro do `LogService` (ex.: adicionar sink de DB por observabilidade) reintroduz risco de indisponibilidade num ponto que a ADR-0041 promete "não interromper ninguém".

**Dependências**: Nenhuma. Overlap operacional com `availability-1` — pode ser feito no mesmo PR.

---

### [fault-tolerance-4] Documentar (e testar) a semântica de identidade sob retry cross-identity

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3

**Problema**
> A cláusula `COALESCE(conexos_username, $conexosUsername)` nos terminais é first-wins, mas o `beginExecution` sobrescreve identidade para estados não-`settled`. Efeito líquido: sob retry por identidade DIFERENTE após um timeout-com-sucesso-oculto do ERP, o ledger pode discordar do ERP sobre quem assinou. O caso é raro, mas a coluna promete "identidade da sessão que assinou", e a semântica real é mais sutil.

**Melhoria Proposta**
> (a) Acrescentar um parágrafo em `identidade-execucao-conexos.md` explicando: "identidade gravada = quem estava resolvido na hora do write-ahead que precede o `markSettled`; retry cross-identity após timeout com sucesso oculto do ERP é caso de exceção coberto pela checagem obrigatória de `fin010` antes de retry (`idempotencia-reconciliacao.md`)". (b) 1 teste em `PermutaExecucaoRepository.test.ts` fixando explicitamente a semântica atual (retry com identidade diferente sobrescreve). Tactic Bass: **Reconcile** (documentar limite da promessa).

**Resultado Esperado**
> A semântica fica explícita; um futuro leitor não interpreta a coluna como "verdade última do ERP" quando é "verdade última do nosso write-ahead".

**Métricas de sucesso**
- Teste explícito de retry cross-identity: 0 → 1
- Doc atualizado

**Risco de não fazer**
> Baixo — na prática o caso quase nunca acontece. Vale como higiene documental.

**Dependências**: Nenhuma.

---

### [modifiability-2] Adicionar tripwire de schema — teste que exige `conexos_username`/`conexos_usn_cod` em toda tabela `*_execucao`

**QA**: Modifiability
**Tactic alvo**: Encapsulate (reifica o invariante) + Restrict Dependencies
**Esforço**: S (≤1d)
**Findings**: F-modifiability-2, F-modifiability-3

**Problema**
> O schema tem 6 tabelas `*_execucao` (5 cobertas pelo `0051` + `solicitacao_numerario` da Frente I SN — a 6ª está sendo remediada por commit follow-up nesta branch, mas o padrão de "esquecer o próximo" não é resolvido pela remediação pontual). Nada no repo — nem teste, nem lint, nem checagem de migration — chama atenção para futuras divergências. Se um `/feature-tweak` futuro adicionar uma 7ª ledger, a probabilidade de reintroduzir o defeito de 2026-08-25 (execução no ERP sem identidade capturada) é alta e **silenciosa**.

**Melhoria Proposta**
> Novo teste em `src/backend/domain/repository/_shared/execucaoIdentitySchema.test.ts` que:
>   1. faz `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%\_execucao' OR table_name = 'solicitacao_numerario'`;
>   2. para cada uma, exige `conexos_username TEXT` + `conexos_usn_cod TEXT` (ou registra a tabela em uma allowlist com justificativa por ADR).
> O teste roda contra o Postgres local (docker) do CI, não contra produção. Se falhar, mensagem explícita: "Tabela X não tem identidade Conexos — cobrir em nova migration ou justificar em `_shared/execucaoIdentitySchema.allowlist.ts`".

**Resultado Esperado**
> Divergência de schema entre ledgers vira erro no `npm test` — mesma família de gate que `PatternGuardian` para DDD. Uma tabela nova sem identidade **não passa em verde**. F-modifiability-2 fica coberto por default para qualquer *feature-tweak* futuro.

**Métricas de sucesso**
- Tabelas `*_execucao` cobertas por identidade Conexos: hoje 6/6 (após remediação da 6ª nesta branch) → mantido em 100% por gate automatizado
- Tripwires automatizados: 0 → 1 teste rodando em CI
- Tempo médio para detectar uma nova ledger sem identidade: hoje = "quando estourar em produção"; alvo = "no `npm test` do PR"

**Risco de não fazer**
> Reincidência do incidente de 2026-08-25 no instante em que uma nova frente entrar. O time paga o custo humano da revisão manual em toda `/feature-new` — a `Regis-Review` funciona, mas depende do agent ser acionado; um `--urgent` fura o gate.

**Dependências**: `modifiability-1` (o helper compartilhado é o lugar natural do teste).

---

### [security-5] Runbook + script de rotação de `CONEXOS_CRED_ENC_KEY`

**QA**: Security
**Tactic alvo**: Revoke Access
**Esforço**: M (2–5d)
**Findings**: F-security-4

**Problema**
> Rotacionar a chave hoje quebra 100% dos vínculos (todos os blobs viram indecifráveis). O delta pelo menos **detecta** via `warn` I-1 (`motivo=decrypt`), mas não recupera — cada usuário precisaria re-cadastrar a senha. Sem procedimento escrito, uma rotação por incidente vira janela de dias em que toda baixa sai como robô.

**Melhoria Proposta**
> Escrever runbook em `docs/runbooks/rotate-conexos-cred-enc-key.md` e implementar `scripts/rotate-conexos-cred-enc-key.ts` que aceita `(oldKey, newKey)`, itera `app_user` com `conexos_password_enc != null`, decifra com a antiga e recifra com a nova em transação. Suporte a duas chaves ativas por N horas (secundária como fallback de leitura) evita janela de indisponibilidade.

**Resultado Esperado**
> Rotação vira operação segura, sem janela de "todo mundo virou robô". Métrica: procedimento documentado (0 → 1) + tempo de rotação sem impacto (∞ → minutos).

**Métricas de sucesso**
- Runbook publicado: 0 → 1
- Script com teste E2E contra Postgres local: 0 → 1

**Risco de não fazer**
> Um incidente que force rotação de chave desabilita atribuição individual por dias, exatamente quando ela mais importa (post-incidente).

**Dependências**: Pode encostar em `conexos-cred-enc-key-config` para reaproveitar a validação de chave.

---

### [testability-5] Asserção explícita "log falhar não derruba a execução" no `SessionResolver`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-5

**Problema**
> O critério T1 "nenhum caminho passa a lançar" está implicitamente coberto pelo `expect(out).toBe(ROBOT)`, mas nenhum `it()` explicita "quando `logService.warn` rejeita, `resolve()` ainda devolve o robô". Se a `avisarDegradacao` for refatorada para `await` sem `try/catch`, o log passa a poder derrubar a execução — regredindo silenciosamente a invariante "o registro do fallback NUNCA interrompe o usuário". F-testability-5.

**Melhoria Proposta**
> Um `it('quando o log de degradação falha, a execução ainda cai no robô', …)` em `ConexosSessionResolver.test.ts` — configurar `logService.warn.mockRejectedValue(new Error('log offline'))`, disparar o caminho de `login`-fail dentro de `conexosRequestContext.run`, `expect(resolver.resolve()).resolves.toBe(ROBOT)`. Tactic Bass: `Executable Assertions`.

**Resultado Esperado**
> `# asserções "log falhar não derruba"`: 0 → 1 nos dois motivos (`decrypt` e `login`, idealmente ambos). Critério T1 "nenhum caminho passa a lançar": ⚠️ → ✅.

**Métricas de sucesso**
- Tests: +1 (ou +2 se cobrir os dois motivos)
- Todos os 7 critérios T1 com asserção explícita: 6/7 → 7/7

**Risco de não fazer**
> Baixo (a semântica está no código; só a asserção é implícita) — mas é o tipo de invariante que um refactor de logging pode quebrar sem que ninguém perceba.

**Dependências**: Nenhuma. Overlap operacional com `availability-1` e `fault-tolerance-2` — pode ser feito no mesmo PR (todos endereçam o mesmo eixo "log não pode derrubar escrita").
