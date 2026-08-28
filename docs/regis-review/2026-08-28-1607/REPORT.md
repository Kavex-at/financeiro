---
type: regis-review-report
run_id: 2026-08-28-1607
generated_at: 2026-08-28T18:20:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: delta review — 2 commits on top of 617ca3b, branch fix/conexos-fallback-audit (--quick)
total_findings: 37
total_cards: 21
total_p0: 0
total_p1: 4
total_p2: 9
total_p3: 8
overall_score: 7.45
---

# Regis-Review — financeiro — 2026-08-28-1607

> **Escopo**: DELTA `main..HEAD` (2 commits sobre `617ca3b`), gate `--quick`. Este NÃO é um
> review do repo inteiro; é o quality-gate arquitetural sobre a implementação da ADR-0041
> (auditoria da queda silenciosa da sessão Conexos para o robô). Baseline em
> `_shared-metrics.md`.
>
> **Zero findings P0 nos 8 QAs** — o gate do `/feature-tweak` passa sem sub-loop de
> remediação. As 21 recomendações abaixo são para o backlog pós-merge.

## 1. Executive scorecard

Pesos aplicados ao overall_score (justificados pelo domínio — SaaSo de automação
financeira que executa escritas que movem dinheiro):
Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 ·
Performance 1.0 · Integrability 0.9 · Deployability 0.9 (peso total = 9.0).

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Security | 7.5 | 0 | 0 | 5 | 1 | F-security-1: `error.message` cru vai ao `warn` I-1 sem sanitização — defense-in-depth de 1 hop até vazamento de senha |
| Fault Tolerance | 8.0 | 0 | 0 | 2 | 3 | F-fault-tolerance-1: 6º ledger (`solicitacao_numerario`) fora da migration `0051` (**resolvido no ciclo**) |
| Availability | 7.5 | 0 | 0 | 2 | 2 | F-availability-3: `BUSINESS_WARN` emitido mas sem nenhum consumer — MTTD depende de operador varrer stdout |
| Modifiability | 7.0 | 0 | 0 | 1 | 3 | F-modifiability-2: 6º ledger sem tripwire de schema (**resolvido no ciclo**) |
| Testability | 6.0 | 0 | 2 | 2 | 1 | F-testability-1: 4 dos 5 ledgers gravam identidade sem NENHUM teste asserting a coluna |
| Performance | 8.5 | 0 | 0 | 1 | 3 | F-performance-2: overhead do provider < 50 μs/statement (positivo — confirma o desenho) |
| Integrability | 7.0 | 0 | 2 | 3 | 1 | F-integrability-2: 4 arquivos de `domain/` importam do pacote LEGADO `services/` |
| Deployability | 8.0 | 0 | 0 | 0 | 3 | F-deployability-2: `preDeployCommand` do `render.yaml` é inerte — doutrina real vive só na docstring do `BootMigrator` |
| **Overall** | **7.45** | **0** | **4** | **9** | **8** | — |

Interpretação da escala:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Leitura executiva**: 7.45 é "saudável com dois vetores de melhoria concretos". O delta é
paradigmático de um bom *safety-net* arquitetural (migration idempotente, backward-compat,
seam único de identidade, LogService inofensivo por inspeção); as 21 recomendações são
*hardening* — não *fix*. As duas exceções onde a nota é mais baixa (Testability 6.0,
Integrability 7.0) apontam para o mesmo eixo: **a invariante-motivo da ADR-0041 ("todo write
no Conexos deixa rastro de identidade") depende de disciplina humana em 4 dos 5 ledgers**
porque o teste que a defenderia está ausente. Corrigir isso é o card de maior leverage do
review.

## 2. Top 10 risks (cross-QA)

Ranked por composite = severidade × impacto de negócio × leverage. Ordenados do maior ao menor.

### R-1: MTTD indefinido — `BUSINESS_WARN` sem consumer/alarme (convergência de 5 QAs)

- **QA(s) afetados**: Availability, Fault Tolerance, Performance, Security (+ eco em Testability)
- **Findings de origem**: F-availability-3, F-availability-4, F-fault-tolerance-4, F-performance-1, F-performance-2 nota "MTTD", F-security-4
- **Evidência sintetizada**: `grep -rn "BUSINESS_WARN" src/backend | grep -v test | grep -v ConexosSessionResolver` retorna vazio — o único emissor do warn é o próprio resolver; nenhum consumer. O incidente `MARILYN_MUTAFCI` de 2026-08-25 (35 execuções degradadas, 13 num dia só) levou **meses** para ser diagnosticado. A ADR-0041 promete "minutos, não meses" — a promessa depende de alguém abrir o log.
- **Impacto técnico**: o registro estruturado do `warn` fecha a auditoria retroativa (`SELECT ... FROM permuta_alocacao_execucao WHERE conexos_username = 'MPS_ROBO'`), mas a **notificação** continua no modelo pull. Sem push, o próximo vínculo quebrado (senha rotacionada, `MAX_SESSIONS`, `SecretCipher.decrypt` falhando por chave trocada) só é visto quando um usuário reclamar.
- **Impacto de negócio**: a ADR-0041 entrega metade do valor. O outro meio-valor é a notificação — sem ela, o modo default continua sendo "descobrir o problema por reclamação".
- **Card(s) Kanban relacionado(s)**: `observability-business-warn` (P2, M) — consolidação única de 6 cards originais (`availability-2`, `availability-3`, `performance-1`, `performance-2`, `security-4`, `fault-tolerance-3`).
- **Custo de inação em 6 meses**: 1 a 3 novos incidentes tipo-MARILYN (dado o histórico: 35 execuções acumuladas em 1 caso; extrapolando para 5 usuários vinculados numa janela em que uma rotação de senha ERP passe despercebida = ~50 a 150 execuções mal atribuídas por incidente). Premissa: manter o volume atual de operação; sem hardening da chave de cifra (R-3 abaixo), o multiplicador cresce.

### R-2: 4 de 5 ledgers gravam identidade sem NENHUM teste que assevere a coluna

- **QA(s) afetados**: Testability, Modifiability (change ripple)
- **Findings de origem**: F-testability-1, F-testability-2, F-modifiability-1
- **Evidência sintetizada**: `grep -c conexos_username src/backend/domain/repository/**/*Execucao*.test.ts` → permutas: 14 hits, os outros três: **1 hit** cada (só o stub `buildIdentity()` mudo); `ConciliacaoExecucaoRepository.test.ts` **não existe**. Qualquer refactor que remova `...identityProvider.currentParams()` de 4 dos 5 ledgers passa em `npm test` verde e grava NULL em produção.
- **Impacto técnico**: regride silenciosamente a invariante-motivo do delta inteiro em 4/5 frentes. A auditoria "quem assinou esta baixa?" fica cega justo em SISPAG (remessa + conciliação) e Recebimentos — as frentes com **maior volume real de execução**.
- **Impacto de negócio**: repete a natureza do incidente 2026-08-25 sem que ninguém perceba — o gate `npm test` continua verde enquanto o ledger volta a mentir.
- **Card(s) Kanban relacionado(s)**: `testability-1` (P1, S), `conciliacao-execucao-tests` (P1, S — merge de `testability-2` + `integrability-3`).
- **Custo de inação em 6 meses**: alta probabilidade de regressão silenciosa dado que SISPAG e Recebimentos são áreas ativas no roadmap; MTTD da regressão = próximo audit humano do ledger (semanas a meses).

### R-3: `CONEXOS_CRED_ENC_KEY` não declarada em config — ambiente novo degrada silenciosamente

- **QA(s) afetados**: Integrability (P1), Security (P2)
- **Findings de origem**: F-integrability-6, F-security-3
- **Status**: **DEFERRED-BY-DECISION** — decisão explícita do Yuri neste ciclo, já registrada em `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-1. Não é overlook; é seguro em produção (a chave está lá).
- **Evidência sintetizada**: `grep -rn "CONEXOS_CRED_ENC_KEY" src/backend/.env.example render.yaml` → 0 matches. Em qualquer ambiente novo (staging, PR preview, worktree de dev, futuro tenant), `SecretCipher.isEnabled()` → false, coluna Conexos some da UI, e todo vínculo cai no robô sem que o `warn` I-1 sequer dispare (o warn só sai quando o vínculo **existe**; sem chave, ninguém cadastra).
- **Impacto técnico**: a Fatia B (identidade Conexos por usuário) fica inerte em todo ambiente que não seja produção. A auditoria acumula NULL/NULL sem sinal. Se a chave for removida de produção por acidente, prod se comporta como staging.
- **Impacto de negócio**: quando o segundo tenant subir (ou um dev novo entrar), o onboarding tem uma armadilha silenciosa: sistema parece saudável (sem warns), mas 0% de atribuição individual.
- **Card(s) Kanban relacionado(s)**: `conexos-cred-enc-key-config` (P1, S, **STATUS: DEFERRED**) — merge de `integrability-5` + `security-3`.
- **Custo de inação em 6 meses**: contido enquanto o repositório tiver 1 tenant. Explode no dia do 2º tenant ou da primeira rotação acidental — cenário previsível dado o roadmap multi-tenant declarado no `CLAUDE.md`.

### R-4: 6º ledger `solicitacao_numerario` fora da migration `0051` (**RESOLVIDO NO CICLO**)

- **QA(s) afetados**: Fault Tolerance, Modifiability — descoberto INDEPENDENTEMENTE por DOIS agentes
- **Findings de origem**: F-fault-tolerance-1, F-modifiability-2 (com sinal em F-modifiability-3)
- **Status**: **CLOSED WITHIN THIS CYCLE** — o gap foi identificado por 2 agentes, verificado pelo consolidator, e está sendo remediado por commit follow-up nesta mesma branch: migration `0052_solicitacao_numerario_identidade_conexos.sql` + injeção de `ConexosIdentityProvider` no `NumerarioExecucaoRepository` (`domain/repository/permutas/`) + guard `settled`-preserva no `ON CONFLICT` + `COALESCE` nos terminais.
- **Evidência sintetizada**: `NumerarioExecucaoRepository` (permutas, tabela criada em `0032`, chamada por `routes/permutas.ts:536`) grava no Conexos via `GerarSolicitacaoNumerarioService` (hoje em dry-run por ADR-0029), mas ficou fora dos 5 ALTER TABLE de `0051`. Se `CONEXOS_WRITE_ENABLED` for religado, replica exatamente o buraco que a ADR-0041 fechou.
- **Por que fica no Top-10 mesmo resolvido**: é o **catch mais valioso deste review**. A convergência de 2 QAs independentes (Fault Tolerance por "audit trail incompleto", Modifiability por "tabela órfã sem tripwire") é o motivo pelo qual o gate encontrou o que a implementação original não viu. Registrar aqui torna público o valor da revisão cruzada.
- **Card(s) Kanban relacionado(s)**: `fault-tolerance-1` e `modifiability-3` — **AMBOS RESOLVIDOS**, não constam no Kanban. `modifiability-2` (tripwire de schema para prevenir o 7º/8º ledger) permanece OPEN como defensive net separado.
- **Custo de inação (referência)**: se não fosse pego neste ciclo, o religamento do fluxo SN 3-telas reabriria o buraco silenciosamente numa frente paralela.

### R-5: Import chain `domain/repository → domain/client` inverte fluxo DDD canônico

- **QA(s) afetados**: Integrability, Modifiability (débito de migração)
- **Findings de origem**: F-integrability-1
- **Evidência sintetizada**: 5 repositórios (`Permuta`, `SolicitacaoNumerario`, `Recebimento`, `Remessa`, `Conciliacao`) importam `ConexosIdentityProvider` de `domain/client/`. O CLAUDE.md §"DDD Layers" declara o fluxo canônico `Handler → Service → Repository → Client` — a inversão contradiz isso. `ConexosIdentityProvider` não faz I/O externo (só lê `AsyncLocalStorage`); não pertence a `client/`.
- **Impacto técnico**: quando uma sexta frente for adicionada, o autor copia o padrão errado — a inversão vira convenção de fato. Uma regra futura de `PatternGuardian` que proíba `domain/repository → domain/client` reprova 5 arquivos.
- **Impacto de negócio**: baixo hoje (funcional); custo médio a longo prazo (dificulta a migração alvo Lambda/DDD-limpo declarada no `CLAUDE.md`).
- **Card(s) Kanban relacionado(s)**: `integrability-1` (P2, S).
- **Custo de inação em 6 meses**: se 2 novas frentes forem adicionadas, o custo de refactor cresce linearmente e a convenção errada solidifica.

### R-6: `domain/` importa `ConexosService` do pacote LEGADO `services/`

- **QA(s) afetados**: Integrability
- **Findings de origem**: F-integrability-2
- **Evidência sintetizada**: `grep -rn "^import type { ConexosService }" src/backend/domain/` → 4 arquivos (`ConexosRequestContext.ts`, `ConexosSessionResolver.ts`, `ConexosIdentityProvider.test.ts`, `legacyConexosAdapter.ts`). O read `state.resolved?.getCapturedUsnCod()` exige que `state.resolved` seja uma instância viva de `ConexosService` — contrato tácito.
- **Impacto técnico**: dobra o custo de substituir o transporte legado por `ConexosBaseClient` puro na v0.2 — que era um seam de um único ponto vira dois. O método `getCapturedUsnCod` precisa manter assinatura idêntica ou o provider quebra em silêncio.
- **Impacto de negócio**: aumenta o custo do vetor de migração explícito no CLAUDE.md ("services/ deve encolher"). É débito que o delta introduziu (não herdou).
- **Card(s) Kanban relacionado(s)**: `integrability-2` (P1, S).
- **Custo de inação em 6 meses**: em qualquer sprint que ataque a migração DDD, o refactor precisa manter shim de compatibilidade só para `getCapturedUsnCod`. ~1 dia de overhead + risco de regressão.

### R-7: `avisarDegradacao` não trata falha do próprio logger — bug de log vira queda dura

- **QA(s) afetados**: Availability, Fault Tolerance
- **Findings de origem**: F-availability-1, F-availability-2, F-fault-tolerance-2, F-testability-5
- **Evidência sintetizada**: `avisarDegradacao` (`ConexosSessionResolver.ts:126-146`) e `degradarParaRobo` (linhas 118-122) estão no `catch` da escrita ao ERP mas não têm `try/catch` próprios. O comment "Nunca lança (o log não pode derrubar a execução)" é aspiracional — verdade hoje por inspeção (`LogService.warn` só faz `process.stdout.write` + `JSON.stringify` de payload plano), sem barreira estática nem runtime.
- **Impacto técnico**: um sink futuro no `LogService` (rede, arquivo, worker), ou EPIPE do stdout do container, ou SSM lançando em `getEnvironmentVars` no alvo Lambda, transforma "credencial ruim → escrita segue pelo robô" (decisão da ADR-0041) em "credencial ruim → escrita aborta com erro do logger". É o oposto da intenção.
- **Impacto de negócio**: baixo hoje; alto em qualquer futuro em que a stack de observabilidade mude. Regressão de disponibilidade escondida atrás de mudança em código de observabilidade — o pior tipo de bug para achar.
- **Card(s) Kanban relacionado(s)**: `availability-1` (P2, S), `fault-tolerance-2` (P3, S), `testability-5` (P3, S).
- **Custo de inação em 6 meses**: baixo em regime estático; alto se o `LogService` for refatorado (roadmap: sink HTTP para Better Stack/Loki/Papertrail em algum ponto). Custo de fazer = 15 LOC + 2 testes.

### R-8: Sanitização de `error.message` no `warn` I-1 depende de 3 garantias externas

- **QA(s) afetados**: Security
- **Findings de origem**: F-security-1, F-security-2
- **Evidência sintetizada**: `avisarDegradacao` passa `error instanceof Error ? error.message : String(error)` cru para o `warn`. Hoje seguro por inspeção (`SecretCipher` não inclui plaintext/ciphertext em mensagens de erro; axios `.message` não carrega body; `redactSensitive` aplicado no interceptor do `services/conexos.ts:128`). Depende de 3 garantias distintas em código que não pertence ao consumidor.
- **Impacto técnico**: uma mudança de uma linha em qualquer dos três (wrap-and-rethrow em ponto novo, remoção do redactor, adição de amostra do ciphertext ao debug do `SecretCipher`) vaza a senha Conexos para o stdout do Render.
- **Impacto de negócio**: um insider com acesso ao agregador de logs (ops Kavex, ops Columbia, sysadmin da stack de logs) extrai senha → autentica como o usuário no ERP → dispara baixas/remessas em nome dele, com trilha "assinada pelo usuário" no ledger e ninguém desconfia. O ledger que este delta introduz **pioraria** a forense do vazamento — inversão perversa.
- **Card(s) Kanban relacionado(s)**: `security-1` (P2, S), `security-2` (P2, S).
- **Custo de inação em 6 meses**: 0 se nenhuma das 3 garantias mudar; catastrófico se qualquer uma delas mudar. Custo de fazer = 1 chamada a `redactSensitive` + 2 testes.

### R-9: 60 LOC de SQL de identidade duplicadas em 5 ledgers — mudança futura toca 5 arquivos

- **QA(s) afetados**: Modifiability, Testability (change ripple sem gate)
- **Findings de origem**: F-modifiability-1, F-modifiability-3
- **Evidência sintetizada**: 25 sítios de `conexos_username` + 25 de `conexos_usn_cod` + 15 chamadas a `identityProvider.currentParams()` em 5 arquivos — total ~65 sítios textualmente equivalentes. Mudar a forma (novo campo `conexos_sid`, migração para `jsonb`, nova regra de preservação) exige tocar 5 arquivos + 5 blocos SQL no mesmo commit sem tripwire que garanta consistência.
- **Impacto técnico**: regressão comum: um ledger fica com forma antiga; auditoria mostra NULL só naquela frente e o defeito aparece semanas depois no relatório.
- **Impacto de negócio**: replica estruturalmente o padrão pré-existente de `executado_por` (que já sofre da mesma duplicação) — o delta compõe o débito em vez de introduzí-lo.
- **Card(s) Kanban relacionado(s)**: `modifiability-1` (P2, M), com dependência natural no `modifiability-2` (tripwire).
- **Custo de inação em 6 meses**: 3-5 dias de refactor futuro se um 6º/7º ledger for adicionado ou se a forma da identidade mudar (ex.: `conexos_sid` para auditoria fiscal).

### R-10: `AsyncLocalStorage` como transporte cria dependência oculta na tipagem dos ledgers

- **QA(s) afetados**: Integrability
- **Findings de origem**: F-integrability-5
- **Evidência sintetizada**: `beginExecution`/`markSettled`/`markError`/`fail` de 5 repositórios têm dependência oculta do `AsyncLocalStorage` via `...identityProvider.currentParams()`. Chamada fora de `conexosRequestContext.run(...)` grava NULL/NULL sem que o compilador avise. Os 5 call sites atuais estão sob middleware Express — seguro; mas nada bloqueia um novo job/cron.
- **Impacto técnico**: um novo job (ex.: reconciliação em massa noturna) que chame um `*ExecucaoRepository` direto grava linhas órfãs sem sinal — o `warn` I-1 nem dispara (é fora de request), o TypeScript não trava, o teste não cobre.
- **Impacto de negócio**: baixo hoje (nenhum job desse tipo existe); médio no roadmap de scheduling (EventBridge + Lambda `job/` no alvo do CLAUDE.md).
- **Card(s) Kanban relacionado(s)**: `integrability-4` (P2, S para teste-guarda / M para threading explícito).
- **Custo de inação em 6 meses**: proporcional a quantos jobs/crons forem adicionados no período.

## 3. Cross-cutting findings

Pontos onde a mesma causa-raiz apareceu em múltiplos QAs. Referência para consolidação de cards no Kanban.

### CC-1: `BUSINESS_WARN` sem consumer — a metade que falta da ADR-0041

- **Aparece em**: Availability (2 findings), Fault Tolerance (1), Performance (2), Security (1)
- **Findings**: F-availability-3, F-availability-4, F-fault-tolerance-4, F-performance-1, F-performance-2 (nota MTTD), F-security-4
- **Diagnóstico unificado**: 5 agentes independentes, olhando de ângulos distintos (Monitor, Condition Monitoring, Manage Sampling Rate, Prioritize Events, Inform Actors), aterrissaram no mesmo item: **o `warn` é emitido mas ninguém consome**. A convergência é ela mesma o argumento — não é opinião, é sinal.
- **Recomendação consolidada**: 1 card único `observability-business-warn` (P2, M) — combina alarme (destino declarado no Render/Better Stack/Loki), dedup por `conexosUsername × motivo × janela`, e métrica-contador `conexos_fallback_total{motivo, conexosUsername}`. Este é o card de maior leverage do review por consolidar 5 dias de esforço distribuído em 1 iniciativa coerente.

### CC-2: 6º ledger `solicitacao_numerario` — o catch mais valioso do review

- **Aparece em**: Fault Tolerance, Modifiability
- **Findings**: F-fault-tolerance-1, F-modifiability-2 (com sinal em F-modifiability-3)
- **Diagnóstico unificado**: a ADR-0041 fala em "cinco ledgers", mas o repo tem seis tabelas `*_execucao` que escrevem no Conexos — a 6ª (`solicitacao_numerario`, criada em `0032`, chamada por `routes/permutas.ts:536`) ficou fora da `0051`. Hoje o fluxo está em dry-run por ADR-0029, mas se `CONEXOS_WRITE_ENABLED` for religado, reabre exatamente o buraco que o delta fechou. Dois agentes independentes acharam por caminhos diferentes (audit trail vs. tripwire de schema) — evidência forte.
- **Recomendação consolidada**: **RESOLVIDO NESTE CICLO** por commit follow-up nesta mesma branch (migration `0052` + injeção de `ConexosIdentityProvider` no `NumerarioExecucaoRepository`). `modifiability-2` (tripwire de teste sobre `information_schema.columns`) permanece OPEN como defensive net para prevenir o 7º/8º ledger. Consequência para o Kanban: `fault-tolerance-1` e `modifiability-3` NÃO aparecem nos 21 cards abertos.

### CC-3: `CONEXOS_CRED_ENC_KEY` não declarada em contrato de config

- **Aparece em**: Integrability (P1), Security (P2)
- **Findings**: F-integrability-6, F-security-3
- **Diagnóstico unificado**: chave-mestra do vínculo Conexos existe em produção mas não aparece em `render.yaml` (`sync: false`) nem em `.env.example`. Ambiente novo → 100% fallback silencioso, 0 warns (o warn só sai quando o vínculo existe; sem chave, ninguém cadastra vínculo). Custo de descoberta pelo próximo dev = arqueologia.
- **Recomendação consolidada**: 1 card `conexos-cred-enc-key-config` (P1, S). **STATUS: DEFERRED-BY-DECISION** — decisão explícita do Yuri neste ciclo (já registrada em `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-1). Não é overlook: é seguro em produção. O card fica no Kanban com status DEFERRED para reingresso no próximo ciclo de planning.

### CC-4: Sanitização defensiva do `warn` (defense-in-depth)

- **Aparece em**: Security (2 findings), Testability (1 finding)
- **Findings**: F-security-1, F-security-2, F-testability-5 (asserção explícita "log não derruba" complementa)
- **Diagnóstico unificado**: `error.message` cru + ausência de teste que trave o vetor de vazamento. Dois lados do mesmo problema — o código não sanitiza, e o teste não impede regressão de sanitização.
- **Recomendação consolidada**: manter cards separados (`security-1` = a defesa, `security-2` = o teste que impede regressão) mas mergeá-los como bundle no mesmo PR. Baixo custo total (S + S = ≤ 1d cada), alto retorno em defense-in-depth.

### CC-5: `ConciliacaoExecucaoRepository` — arquivo de teste inexistente

- **Aparece em**: Testability (P1), Integrability (P2)
- **Findings**: F-testability-2, F-integrability-3
- **Diagnóstico unificado**: dois agentes propuseram literalmente o mesmo card ("criar `ConciliacaoExecucaoRepository.test.ts` espelhando `RemessaExecucaoRepository.test.ts`"). Convergência textual — nenhum ganho em manter duplicados.
- **Recomendação consolidada**: 1 card `conciliacao-execucao-tests` (P1, S). Prioridade = máxima das duas.

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S e severidade ≥ P2, alta razão impacto/esforço. Recomendados como primeira sprint pós-aprovação.

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `testability-1` | Testability | S | P1 | 4/5 ledgers com asserção de identidade no SQL; cobertura da invariante-motivo do delta sobe de 20% para 80% |
| `conciliacao-execucao-tests` | Testability + Integrability (merge) | S | P1 | 5/5 ledgers cobertos; +12 tests; único repo `*Execucao*` sem testfile do projeto sai do estado 0/180 LOC coberto |
| `integrability-2` | Integrability | S | P1 | 4 imports de `services/ConexosService` em `domain/` → 0; substituição do transporte legado na v0.2 deixa de exigir shim |
| `availability-1` | Availability | S | P2 | Duas barreiras `try/catch` no path de fallback; "log nunca derruba escrita" deixa de ser aspiração e vira invariante testada |
| `security-1` | Security | S | P2 | `redactSensitive` aplicado ao campo `erro` do `warn` I-1; defense-in-depth ganha 1 barreira |
| `security-2` | Security | S | P2 | 2 testes explícitos travam regressão do vetor de vazamento coberto por `security-1` |
| `integrability-1` | Integrability | S | P2 | 5 imports `domain/repository → domain/client` → 0; provider migrado para `domain/libs/requestContext/` |
| `integrability-4` | Integrability | S (teste-guarda) | P2 | 5 test-guards documentando comportamento de `beginExecution` fora de `conexosRequestContext.run(...)` |

**Volume**: 8 cards, todos S. Estimativa agregada: 5-7 dias úteis para 1 dev ou 3-4 dias para 2 devs em paralelo (cards são independentes entre si).

**Efeito líquido**: fecha 2 dos 3 P1 abertos (o terceiro é o CONEXOS deferido), 4 dos 9 P2, e amarra o defense-in-depth de Security. Sprint defensável como "fechamento da metade que falta da ADR-0041".

## 5. Strategic moves (M / L / XL)

Cards de maior fôlego, com justificativa amarrada a métrica.

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `observability-business-warn` (merge de 6 cards) | Availability + Fault Tolerance + Performance + Security | M | Monitor + Inform Actors + Manage Sampling Rate | MTTD de vínculo Conexos quebrado hoje = *meses* (baseline: incidente 2026-08-25); alvo = ≤ 15 min. Consolida 5 iniciativas paralelas em 1 stack — ROI é 5× vs implementar em silos. |
| `modifiability-1` | Modifiability | M | Abstract Common Services / Encapsulate | 25 sítios de `conexos_username` + 15 chamadas de `currentParams()` → 5 e ≤ 5. Nova ledger custa 22 LOC hoje → ≤ 5. Amortiza no 6º ledger (que sabemos que vai voltar via Frente I SN). |
| `testability-3` | Testability | M | Sandbox | 0/51 migrations com asserção de shape hoje. Alvo: 1 script `test:migrations` cobrindo todas com `information_schema.columns`. Custo humano de validar migration à mão em cada PR × 51 migrations projetadas em 12 meses = economia mensurável. |
| `testability-4` | Testability | M | Executable Assertions | 0 testes end-to-end do fio `resolver → provider → ledger`; alvo ≥ 5 (1 por ledger). Trava o refactor futuro do `AsyncLocalStorage` (roadmap: OpenTelemetry Context) que hoje passaria em verde e quebraria a publicação de identidade. |
| `security-5` | Security | M | Revoke Access | Rotação de `CONEXOS_CRED_ENC_KEY` hoje = janela de dias em que 100% das baixas assinam como robô. Um runbook + script de re-encrypt com secondary key transforma janela em minutos. Justifica-se pelo cenário post-incident, quando rotação é obrigatória. |

## 6. O que está bem (e por quê)

Reuniões defensivas caem na armadilha de "tudo está ruim". O delta faz várias coisas certas. Ancorá-las mantém a credibilidade do resto do relatório.

1. **Migration `0051` é paradigma de backward-compatible bem feito**. Tactic: *Update the artifact / Configuration parameters*. `IF NOT EXISTS`, nullable, sem `NOT NULL`/`DEFAULT`, cinco tabelas na mesma migration, tudo assinado pelo `BootMigrator` com advisory lock. Rollback é seguro por observação empírica (`git grep conexos_username 617ca3b -- src/backend` = vazio). Evidência: `_shared-metrics.md` linha 43-44 (aplicada em Postgres local, 2ª execução no-op).

2. **Seam único de identidade — a única decisão de fallback está em um lugar**. Tactic: *Encapsulate*. `ConexosSessionResolver.resolveForUser` é o único ponto que decide se cai no robô ou não; `ConexosIdentityProvider.current()` é o único ponto que lê o `AsyncLocalStorage`. Cada camada tem uma responsabilidade. Cobertura excelente para ambos.

3. **Nenhuma senha vaza no `warn` — trava testada explicitamente**. Tactic: *Limit Exposure*. `ConexosSessionResolver.test.ts:170-186` (teste "não vaza senha nem ciphertext no `warn`"). Fica como precedente para o `security-2` (que estende a trava, não a cria).

4. **`ConexosIdentityProvider` é 56 LOC com uma responsabilidade — mockável em 6 linhas**. Tactic: *Specialized Interfaces*. Vale como padrão-referência para revisões futuras (sinalizado pelo agent de Testability).

5. **Overhead do provider é sub-milissegundo — o desenho é confirmado empiricamente**. Tactic: *Reduce Overhead*. Hash lookup + field access + spread; `getCapturedUsnCod()` é `return this.usnCod;`. Latência adicional < 50 μs vs. INSERT/UPDATE típico de 5-30 ms Postgres (Supabase) = < 0.1%. Evidência: F-performance-2.

6. **Comportamento "fallback silencioso ao usuário" preservado; a ADR-0041 não muda contrato para quem clica "Executar"**. Tactic: *Availability by Design*. MTTR percebido pelo usuário = 0.

7. **Gates verdes sem regressão de warning no lint**. `npm run lint` baseline vs. HEAD: 57 warnings idênticos (não mais, não menos), sobre 394 vs. 392 arquivos. `npm test`: 1493 passed / 110 suites. Evidência: `_shared-metrics.md` linhas 40-42.

8. **Ontologia validada contra código — `ontology/integrations/conexos.md` §"Identidade da sessão" bate 1:1 com `ConexosSessionResolver.resolve`**. Um único gap doc-código sinalizado (menção implícita ao valor `usnCod` — ver notas do agent de Integrability).

## 7. Limitações da análise

Registro explícito do que este relatório **não** cobre — decisões conscientes do consolidator e do escopo `--quick`.

- **Escopo `--quick` (delta review, não repo completo)**: as métricas de Executors/DLQ/CloudWatch, chaos engineering, threat modeling formal, análise de custo cloud, UX, acessibilidade — **fora do escopo**. Este é um gate arquitetural sobre 2 commits, não um health check do sistema.
- **Consolidações aplicadas pelo consolidator** (documentar para o leitor não perder o rastro dos cards originais):
  - `availability-2`, `availability-3`, `performance-1`, `performance-2`, `fault-tolerance-3`, `security-4` → merged em **`observability-business-warn`** (P2, M). Cinco QAs convergiram no mesmo item.
  - `fault-tolerance-1`, `modifiability-3` → **RESOLVIDOS no ciclo** (6º ledger). Não aparecem no Kanban. `modifiability-2` (tripwire) permanece OPEN.
  - `integrability-5`, `security-3` → merged em **`conexos-cred-enc-key-config`** (P1, S, STATUS: DEFERRED-BY-DECISION).
  - `testability-2`, `integrability-3` → merged em **`conciliacao-execucao-tests`** (P1, S). Os dois cards eram textualmente o mesmo pedido; manter separados seria ruído.
- **Métricas declaradas como "não medíveis localmente"** pelos agents:
  - MTTR real de um vínculo quebrado (nenhum incidente pós-delta observado). Baseline disponível: 2 meses (incidente 2026-08-25). Alvo do card `observability-business-warn`: ≤ 15 min.
  - p99 latência do `resolveForUser` em produção. Overhead calculado por inspeção < 100 μs; produção não medida (sem stack de observabilidade).
  - Taxa de flaky em CI sem histórico (não medível daqui — 1 run passou verde).
  - Cobertura por linha (não rodada porque `--quick` veta coverage report).
  - `count(*)` de execuções pré-`0051` que ficam com `conexos_username` NULL nas 5 tabelas: só medível via `psql` contra produção, que a instrução explícita vetou.
- **Infra-agnóstico**: `infra/`, Terraform, SSM, Lambda, tenants — **não existem** no repo (deploy via Render hook, ver CLAUDE.md §"Estado Atual vs. Alvo"). Qualquer tactic Bass que dependa deles foi registrada como "N/A neste delta", não como falha.
- **Frontend não tocado**: o delta é 100% backend. Nenhum sinal de qa-testability sobre o frontend; DesignReviewer não acionado.
- **Janela temporal**: snapshot do dia 2026-08-28. Código vive; recomendo Regis-Review cheio (sem `--quick`) trimestralmente ou quando uma frente nova for adicionada aos ledgers.
- **Zero P0 em 8 QAs** — o `/feature-tweak` passa sem sub-loop de remediação; os 21 cards vão para `ontology/_inbox/conexos-fallback-audit-regis-followups.md` conforme contrato do pipe.

## 8. Ações recomendadas

Ordem de execução para os 30 dias seguintes, sempre referenciando cards.

1. **Fechar os 3 P1 abertos nesta sprint pós-merge** (custo S, S, S = 1-2 dias): `testability-1` (asserção nos 4 ledgers), `conciliacao-execucao-tests` (fechar 5/5 com testfile do repo mais crítico do SISPAG), `integrability-2` (interface `ConexosSessionCapture` no lugar do `import type { ConexosService }`). Após estes, o backlog aberto fica sem P1 exceto o CONEXOS deferido.

2. **Amarrar defense-in-depth de Security no mesmo PR** (custo S+S): `security-1` (sanitizar `erro`) + `security-2` (teste que trava o vetor). Baixo custo, alto valor simbólico ("Kavex não confia no produtor, sanitiza no consumidor").

3. **Priorizar `observability-business-warn` (P2, M) para a sprint seguinte**. Fecha a metade que falta da ADR-0041 e resolve 6 cards em 4 QAs distintos numa iniciativa única. ROI = 5× vs. implementar em silos.

4. **Endereçar `conexos-cred-enc-key-config` (P1, deferido) no próximo ciclo de planning**. Colocar como precondição do 2º tenant / 1º ambiente staging — o que vier primeiro. Manter a nota no `_regis-followups.md` até ser fechado.

5. **Planejar `modifiability-1` (helper compartilhado, M) para amortizar o custo do 6º ledger** (que está sendo religado agora via commit follow-up desta branch) e de qualquer 7ª frente futura. Sem isso, o débito de duplicação cresce a cada nova integração Conexos.
