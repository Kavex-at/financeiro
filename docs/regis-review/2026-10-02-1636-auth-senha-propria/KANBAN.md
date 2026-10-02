---
type: regis-review-kanban
run_id: 2026-10-02-1636-auth-senha-propria
total: 19
counts: { p0: 0, p1: 3, p2: 10, p3: 6 }
---

# Kanban — financeiro — 2026-10-02-1636-auth-senha-propria

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> Os 24 cards originais dos 8 agentes foram deduplicados em 19. Cards mesclados trazem a linha **Absorve**; edições de texto para coerência estão listadas na seção 7 do REPORT.md. Fora isso, o texto é verbatim das seções de QA.

---

## P0 — Crítico

Nenhum. O delta `auth-senha-propria` não introduz problema crítico (ver REPORT.md, seção 1).

---

## P1 — Alto

### [performance-1] Tirar a chamada ao GoTrue de dentro da transação com lock ou limitar a concorrência da rota

**QA**: Performance (também Availability e Fault Tolerance)
**Tactic alvo**: Schedule Resources / Bound Execution Times
**Esforço**: S
**Findings**: F-performance-1, F-availability-3, F-fault-tolerance-3
**Absorve**: availability-2 (parte de teto de concorrência) e fault-tolerance-3 (registrar o custo na ADR-0059)

**Problema**
> `updatePassword` mantém conexão e `FOR UPDATE` durante o `PUT /user` (até 10 s). Com o pool em 5, poucas requisições lentas travam toda a API.

**Melhoria Proposta**
> Opção A (menor mudança): semáforo/bulkhead de no máximo 2 trocas simultâneas no processo (Schedule Resources) e timeout dedicado de 3 s para o `PUT /user` (Bound Execution Times). Opção B: manter a ordem R6 mas com `lock_timeout` curto e `SET LOCAL idle_in_transaction_session_timeout`. Tocar `OwnPasswordService.ts`, `SupabaseAuthClient.ts` (timeout por operação) e um util de concorrência. Reavaliar contra o ADR-0059.
> Complemento (de fault-tolerance-3): registrar na ADR-0059 o limite aceito e o gatilho de reavaliação.

**Resultado Esperado**
> Conexões retidas por `/me/senha` no pior caso: 5 de 5 → ≤ 2 de 5; tempo máximo de tx da feature: 10 s → 3 s.

**Métricas de sucesso**
- Conexões retidas simultâneas por `/me/senha`: 5 → ≤ 2
- Duração máxima da tx: 10 s → 3 s
- Teste de carga (10 requests concorrentes, GoTrue com 8 s de atraso): rotas não relacionadas com p95 < 1 s
- Limite aceito e gatilho de reavaliação documentados na ADR-0059: não → sim

**Risco de não fazer**
> Qualquer lentidão do GoTrue derruba as demais frentes por tempo igual ao timeout.

**Dependências**: Revisão do ADR-0059 (decisão R6).

---

### [security-1] Revogar sessões HS256 ao trocar a senha

**QA**: Security
**Tactic alvo**: Revoke Access
**Esforço**: M
**Findings**: F-security-1

**Problema**
> Em modo `local`, o token do app dura 12h e a troca de senha não invalida os outros. Quem tem um Bearer roubado continua operando depois que a vítima troca a senha.

**Melhoria Proposta**
> Adicionar `token_valid_after` (ou `password_changed_at`) em `app_user`, gravado na mesma transação do `updatePassword`. O middleware `auth` rejeita HS256 com `iat` anterior. Reduzir `TOKEN_EXPIRATION` com refresh, se o custo for aceitável. Tactic: Revoke Access. Tocar `UserRepository`, `OwnPasswordService`, `http/auth.ts`. Excluir o token do chamador (reemitir um novo no 204, ou aceitar `iat >= troca`).

**Resultado Esperado**
> Após a troca, qualquer outro token HS256 é recusado na próxima request. Janela de 12h para 0.

**Métricas de sucesso**
- Janela de sessão pós-troca: 12h → ≤ 1 request

**Risco de não fazer**
> A troca de senha continua sem efeito contra sessão roubada, justamente no cenário de comprometimento.

**Dependências**: nova migration (aditiva); cache de acesso do `resolverAcesso`.

---

### [deployability-2] Adicionar smoke pós-deploy ao pipeline

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: M
**Findings**: F-deployability-3 (pré-existente; este delta não piora)

**Problema**
> O CI não tem passo de CD nem smoke. O sucesso do deploy no Render e do BootMigrator não é checado automaticamente.

**Melhoria Proposta**
> Job pós-merge que consulta `/health` (e uma rota autenticada de leitura barata) na URL de produção e falha o workflow se a versão publicada não bater com `package.json`. Tactic: Deployment observability / Script Deployment Commands.

**Resultado Esperado**
> Deploy ruim detectado em minutos. Verificações pós-deploy automáticas: 0 → 1.

**Métricas de sucesso**
- Jobs de CD/smoke: 0 → 1

**Risco de não fazer**
> Repetir o incidente de 2026-09-23 (migrations não aplicadas por semanas).

**Dependências**: endpoint de versão/health exposto.

---

## P2 — Médio

### [deployability-1] Verificar "Secure password change" do Supabase de forma automatizada

**QA**: Deployability (também Integrability)
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-1, F-integrability-1
**Absorve**: integrability-1 (checagem via `/auth/v1/settings` e alerta `AUTH_INDISPONIVEL` com motivo distinto)

**Problema**
> A troca de senha no modo `supabase` depende de `security_update_password_require_reauthentication=false`, conferido só manualmente. Se alguém religar a opção, toda troca responde 503 sem que nenhum gate perceba.

**Melhoria Proposta**
> Criar um job/script de sonda (nos moldes de `jobs/probe-*`) que lê a Management API em modo somente leitura e falha se a opção estiver `true`. Rodar manualmente antes de ligar a flag do front e, se viável, agendar. Tactic: Script Deployment Commands.
> Complemento (de integrability-1): se a leitura de `/auth/v1/settings` bastar, usar `probe-gotrue` e logar `AUTH_INDISPONIVEL` com motivo distinto, sem passar pelo `bootstrapAppContainer`.

**Resultado Esperado**
> Pré-condição verificada por 1 comando. Conferências manuais: 1 → 0.

**Métricas de sucesso**
- Verificações automáticas da pré-condição: 0 → 1
- Tempo para diagnosticar a causa: de investigação manual a um alerta com causa nomeada

**Risco de não fazer**
> A feature liga com a configuração errada e só é detectada por reclamação de usuário.

**Dependências**: token pessoal da Management API disponível ao dono do ciclo.

---

### [fault-tolerance-1] Corrigir a promessa de reparo da divergência de senha e oferecer um reparo real

**QA**: Fault Tolerance
**Tactic alvo**: Repair State
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-availability-1

**Problema**
> O log `AUTH_DIVERGENCIA` diz que o `sync-supabase-auth` repara, mas o sync mantém a senha do GoTrue e não reconcilia senha. Após falha de COMMIT depois do `PUT /user`, os dois sistemas ficam com senhas distintas sem convergência.

**Melhoria Proposta**
> Curto prazo: trocar a mensagem em `CredentialMirror.aposFalha` (operação `senha`) para "redefina a senha do usuário" com a ação operacional no `DEPLOY.md`. Opcional: no 503/500 pós-GoTrue, o service tenta um `PUT /user` de volta para a senha antiga (compensação best-effort, só possível com a senha atual em memória) ou a rota orienta o usuário a repetir a troca com a senha nova. Documentar a escolha (forward recovery) na ADR-0059.

**Resultado Esperado**
> Mensagem verdadeira e runbook escrito: divergências de senha com instrução de reparo 0 → 100%.

**Métricas de sucesso**
- Divergências de senha com reparo documentado: 0 → 1 de 1

**Risco de não fazer**
> O suporte espera um reparo que não acontece e o usuário fica com senha inconsistente entre os modos.

**Dependências**: Nenhuma

---

### [modifiability-2] Tirar `ConexosSessionResolver` do handler `/me`

**QA**: Modifiability (também Integrability)
**Tactic alvo**: Restrict Dependencies
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> `routes/me.ts` tem 18 imports e usa um client direto (`:7`), fora da cadeia Handler → Service.

**Melhoria Proposta**
> Restrict Dependencies: mover a resolução de sessão Conexos para um service de `/me` e deixar a rota só com HTTP, validação Zod e chamada ao service. Pode aproveitar a migração proporcional do legado.

**Resultado Esperado**
> Fan-out de `me.ts` 18 → ≤ 12; bypass de camada 1 → 0.

**Métricas de sucesso**
- Imports de `me.ts`: 18 → ≤ 12
- Imports de client em rotas `/me`: 1 → 0

**Risco de não fazer**
> Toda mudança de auth do Conexos continua tocando a rota.

**Dependências**: Nenhuma

---

### [performance-2] Contar 503/timeout no limiter de troca de senha e limitar requests em voo por usuário

**QA**: Performance (também Security)
**Tactic alvo**: Limit Event Response
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> O limiter ignora tudo que não for 422, então tentativas que acabam em 503 não contam e custam bcrypt mais 3 chamadas externas.

**Melhoria Proposta**
> Limiter secundário por usuário (ex.: 10 requests / 5 min, qualquer status exceto 204) ou trocar `requestWasSuccessful` para só poupar 204; mais um limite de 1 request em voo por `sub`. Arquivo: `http/rateLimit.ts`, `routes/me.ts`.

**Resultado Esperado**
> Requests sem sucesso por usuário em 5 min: ilimitado (teto global 100/min/IP) → ≤ 10.

**Métricas de sucesso**
- Chamadas ao GoTrue por usuário em 5 min: sem teto → ≤ 30
- Teste unitário: 11ª requisição 503 em 5 min → 429

**Risco de não fazer**
> Rota amplifica indisponibilidade do GoTrue e consome sua cota.

**Dependências**: Nenhuma. Sequenciar com security-2 e modifiability-1 (mesmo arquivo `http/rateLimit.ts`).

---

### [security-2] Dar ao limitador de senha um store compartilhado

**QA**: Security (também Availability)
**Tactic alvo**: Limit Access
**Esforço**: S
**Findings**: F-security-2, F-security-4, F-availability-2
**Absorve**: availability-2 (parte de store compartilhado do limitador)

**Problema**
> O limitador usa o MemoryStore. Com mais de uma instância ou reinício, o teto de 5 falhas / 15 min deixa de valer.

**Melhoria Proposta**
> Opção A: contar falhas numa tabela Postgres (`app_user_senha_falha`) ou reaproveitar a trilha de acesso, que já existe. Opção B: documentar no DEPLOY.md que o serviço é single-instance e travar isso. Tactic: Limit Access.

**Resultado Esperado**
> Teto de 5 falhas por usuário independente do número de instâncias.

**Métricas de sucesso**
- Teto efetivo: 5 × N instâncias → 5

**Risco de não fazer**
> Ao escalar a 2+ instâncias, o limite se afrouxa sem ninguém notar.

**Dependências**: Nenhuma

---

### [security-3] Registrar e alertar falhas de senha atual, e avisar o dono da conta

**QA**: Security
**Tactic alvo**: Detect Intrusion
**Esforço**: S
**Findings**: F-security-3

**Problema**
> O 422 de senha atual inválida e a troca bem-sucedida não geram alerta. Não há como detectar um Bearer roubado em uso nem avisar a vítima.

**Melhoria Proposta**
> Gravar `LogService.warn` com `usuario` (sem segredo) no 422 e no 429, com tipo próprio para alarme por contagem. Avisar o e-mail da conta numa troca (hoje não há SES, então começar pelo log e pelo painel do admin). Tactic: Detect Intrusion + Inform Actors.

**Resultado Esperado**
> Rajada de 422 por usuário visível em log/alerta; troca de senha visível ao admin.

**Métricas de sucesso**
- Alarmes de falha de autenticação: 0 → ≥ 1

**Risco de não fazer**
> Um sequestro por troca de senha segue invisível até a vítima reclamar.

**Dependências**: canal de alerta (Render log drain ou similar). Mesmo canal de fault-tolerance-2.

---

### [testability-1] Fixar pisos de cobertura por arquivo para o fluxo de senha

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> O piso de `domain/service/` é agregado; os 22 testes do `OwnPasswordService` não são protegidos contra queda de cobertura isolada.

**Melhoria Proposta**
> Rodar coverage uma vez, medir `OwnPasswordService`, `PasswordPolicy` e `rateLimit.ts`, e adicionar entradas por arquivo no `coverageThreshold` (ratchet, medido arredondado para baixo).

**Resultado Esperado**
> Pisos por arquivo no delta 0 → 3; cobertura de linhas dos arquivos de senha com piso ≥ 90%.

**Métricas de sucesso**
- Entradas por arquivo no `coverageThreshold`: 0 → 3

**Risco de não fazer**
> Regressão silenciosa de branches nos caminhos de erro de segurança.

**Dependências**: Nenhuma

---

### [fault-tolerance-2] Alarme sobre `AUTH_DIVERGENCIA` e `AUTH_INDISPONIVEL`

**QA**: Fault Tolerance (também Availability)
**Tactic alvo**: Condition Monitoring
**Esforço**: M
**Findings**: F-fault-tolerance-2, F-availability-1
**Absorve**: availability-1 (alarme sobre `AUTH_DIVERGENCIA`). A parte "agendar o `sync-supabase-auth` diariamente" de availability-1 foi descartada: o sync não reconcilia senha (F-fault-tolerance-1), então agendá-lo não repara a divergência.

**Problema**
> As divergências de credencial só existem como linha de log; sem contador ou alerta ninguém é avisado.

**Melhoria Proposta**
> Quando houver observabilidade (Render log drain ou métrica), alertar em qualquer ocorrência de `AUTH_DIVERGENCIA` e em taxa alta de `AUTH_INDISPONIVEL`. Cobrir os 4 pontos de emissão, não só o delta.

**Resultado Esperado**
> Tempo para notar uma divergência: indefinido → menos de 1 dia útil.

**Métricas de sucesso**
- Alertas sobre `AUTH_DIVERGENCIA`: 0 → 1

**Risco de não fazer**
> Divergências acumulam sem dono.

**Dependências**: decisão de plataforma de logs/alertas

---

### [integrability-2] Gravar fixtures do GoTrue para `PUT /user`, `/logout?scope=others` e rodar a sonda na CI

**QA**: Integrability (também Testability)
**Tactic alvo**: Contract testing / Versioning strategy
**Esforço**: M
**Findings**: F-integrability-2, F-testability-2
**Absorve**: testability-2 (fixtures em `__fixtures__/` capturadas do GoTrue local; meta de fixtures 0 → 6 em vez de 0 → 4). O esforço do bloco de fixtures isolado é S; o M vem da sonda na CI com container pinado.

**Problema**
> O comportamento de sessão do GoTrue foi validado só manualmente na v2.197. Os testes usam mocks, então uma mudança do provedor não é detectada.

**Melhoria Proposta**
> Gravar respostas reais (sucesso, 422 weak/same_password, 401 token revogado) como fixtures e fazer o `SupabaseAuthClient.test.ts` parseá-las. Opcionalmente, rodar `probe-gotrue-local` num job com o container pinado e registrar a versão esperada em `DEPLOY.md`.

**Resultado Esperado**
> Regressão de semântica do `PUT /user` quebra um teste. Fixtures gravadas: 0 → 4.

**Métricas de sucesso**
- Fixtures gravadas do GoTrue: 0 → 4 (testability-2 propõe 6)
- Versão do GoTrue verificada automaticamente: não → sim

**Risco de não fazer**
> Regressão de segurança no pós-troca (sessões não revogadas) sem aviso. Upgrade do GoTrue quebra a troca de senha sem sinal em CI.

**Dependências**: Nenhuma

---

### [modifiability-3] Quebrar `UserRepository` por responsabilidade

**QA**: Modifiability (também Testability)
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-3

**Problema**
> `UserRepository` tem 664 LOC e acumula leitura, escrita de credencial e trilha. `SupabaseAuthClient` tem 434 LOC.

**Melhoria Proposta**
> Split Module: extrair as mutações de credencial (`updatePassword` e afins) para um `UserCredentialRepository`, mantendo a transação e o evento de trilha. Fazer só quando o próximo `/feature-tweak` tocar o arquivo.

**Resultado Esperado**
> `UserRepository` 664 → ≤ 450 LOC; nenhum arquivo do módulo auth acima de 600 LOC.

**Métricas de sucesso**
- LOC de `UserRepository.ts`: 664 → ≤ 450

**Risco de não fazer**
> O arquivo passa de 800 LOC na próxima feature de auth.

**Dependências**: Nenhuma

---

## P3 — Baixo

### [availability-3] Documentar o reverso da migration 0073

**QA**: Availability (também Deployability e Security)
**Tactic alvo**: Software Upgrade
**Esforço**: S
**Findings**: F-availability-4, F-deployability-4

**Problema**
> A 0073 não tem reverse; o schema não volta atrás depois que existirem eventos `SENHA`.

**Melhoria Proposta**
> Software Upgrade: registrar em `DEPLOY.md` que o rollback do código é seguro sem reverter a migration e qual script de reverso usar (convertendo ou removendo eventos `SENHA` antes de reduzir o CHECK).

**Resultado Esperado**
> Procedimento de rollback escrito antes do próximo incidente.

**Métricas de sucesso**
- Rollback documentado da 0073: não → sim

**Risco de não fazer**
> Baixo; improvisação sob pressão em um rollback de schema.

**Dependências**: Nenhuma

---

### [deployability-3] Kill switch de runtime para `/me/senha`

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> Desligar a troca de senha em incidente exige rollback ou deploy do front, porque a rota do backend está sempre ativa.

**Melhoria Proposta**
> Env `OWN_PASSWORD_CHANGE_ENABLED` lida via `EnvironmentProvider`; quando `false`, `POST /me/senha` responde 503 explícito, e `GET /politica` devolve `habilitada:false`. Tactic: Scale Rollouts (dark launch).

**Resultado Esperado**
> Tempo para desligar: 1 deploy → 1 mudança de env. Sem novo deploy de código.

**Métricas de sucesso**
- Tempo para desativar a feature: ~minutos de deploy → <1 min (restart do Render)

**Risco de não fazer**
> Baixo; mitigação por rollback segue funcionando.

**Dependências**: Nenhuma

---

### [integrability-3] Distinguir senha rejeitada pelo GoTrue de indisponibilidade na rota `POST /me/senha`

**QA**: Integrability
**Tactic alvo**: Tailor Interface
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> Todo 4xx do GoTrue no `PUT /user` vira 503. Uma política do provedor mais restrita que a local aparece como "fora do ar".

**Melhoria Proposta**
> Mapear `weak_password` / `same_password` para `PasswordPolicyError` (400) e manter 503 só para sessão revogada e 5xx. Tocar `OwnPasswordService.gravar` e o teste de rota.

**Resultado Esperado**
> O usuário recebe causa acionável; 4xx de política tratados como 503: 100% → 0%.

**Métricas de sucesso**
- Códigos de política do GoTrue mapeados a 400: 0 → 2

**Risco de não fazer**
> Chamados de suporte por "serviço indisponível" quando a senha era fraca.

**Dependências**: integrability-2 (fixtures dos códigos reais).

---

### [modifiability-1] Externalizar limites do limiter da troca de senha

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> Contagem de falhas e janela de 15 min do `buildOwnPasswordLimiter` são constantes de código (`rateLimit.ts:89`). Alterar exige build e deploy.

**Melhoria Proposta**
> Defer Binding: ler os limites via `EnvironmentProvider` com default igual ao atual, e juntar as constantes de limiter em um só objeto de configuração. Tocar `http/rateLimit.ts` e o provider.

**Resultado Esperado**
> Limites ajustáveis por env: 0 → 2 parâmetros configuráveis, defaults inalterados e testados.

**Métricas de sucesso**
- Limites configuráveis do limiter: 0 → 2

**Risco de não fazer**
> Ajuste de limite em incidente espera deploy; efeito pequeno.

**Dependências**: Nenhuma. Sequenciar com performance-2 e security-2 (mesmo arquivo).

---

### [performance-3] Medir o custo real do bcrypt e registrar duração da troca

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S
**Findings**: F-performance-3

**Problema**
> O custo (2 hashes JS puro, custo 12) é estimado, não medido. Sem latência no log, não há como confirmar o orçamento.

**Melhoria Proposta**
> Adicionar `duracaoMs` ao log de sucesso de `OwnPasswordService` e medir um `bcrypt.hash` na máquina da Render. Só trocar para `bcrypt` nativo se > 400 ms por hash.

**Resultado Esperado**
> Custo por troca: estimativa (~0,6 s) → valor medido, com alvo p95 ≤ 1,5 s em `/me/senha`.

**Métricas de sucesso**
- Campo `duracaoMs` presente no log: 0% → 100%
- Hash medido: não medido → ≤ 400 ms

**Risco de não fazer**
> Decisões de custo seguem no escuro; impacto baixo.

**Dependências**: Nenhuma

---

### [testability-3] Injetar `Clock` no `SupabaseAuthClient` e injetar deps em `me.test.ts`

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-3, F-testability-4

**Problema**
> 4 `Date.now()` no client e um `container.resolve.bind` no teste de rota deixam estado global e tempo real nos testes de auth.

**Melhoria Proposta**
> Introduzir um `ClockProvider` injetável no client; trocar o bind do container por `buildMeRouter(deps)` com mocks.

**Resultado Esperado**
> Leituras de tempo não injetáveis no client 4 → 0; usos de container em teste de rota 1 → 0.

**Métricas de sucesso**
- `Date.now()` no client: 4 → 0
- `container.resolve` em `me.test.ts`: 1 → 0

**Risco de não fazer**
> Baixo; testes de expiração continuam dependendo de fake timers.

**Dependências**: Nenhuma
