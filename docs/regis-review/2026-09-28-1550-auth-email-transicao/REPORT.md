---
type: regis-review-report
run_id: 2026-09-28-1550-auth-email-transicao
generated_at: 2026-09-28T20:00:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 19
total_p0: 0
total_p1: 2
total_p2: 9
total_p3: 8
overall_score: 7.9
---

# Regis-Review — financeiro — 2026-09-28-1550-auth-email-transicao

**Escopo:** `feat/auth-email-transicao` — passo 1/3 do plano de auth (ADR-0051). `app_user.email`,
login por e-mail OU usuário, guarda de desativação (R11), `seed-admin` sem default. 35 arquivos,
+2688/-156 linhas. Nenhuma chamada a Conexos/Nexxera/GED neste delta. Gates medidos: typecheck,
lint, 158 suites/2371 testes backend, 55/465 frontend, todos verdes (`_shared-metrics.md`).

**Nota metodológica:** dois commits chegaram na branch **depois** de os 8 agentes especialistas
gerarem suas seções — ver §7 para o detalhe de como isso afeta as referências de arquivo abaixo.

## 1. Executive scorecard

Pesos (financeiro, SaaS multi-tenant de escritas que movem dinheiro): Security 1.5, Fault Tolerance
1.3, Availability 1.2, Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9,
Deployability 0.9 (total 9.0).

> As colunas P0–P3 desta tabela refletem os achados **de cada QA isoladamente** (podem se sobrepor
> entre QAs — ex.: auditoria aparece em Security E Fault Tolerance). A linha **Overall** e o restante
> do relatório usam a contagem **deduplicada** de 19 cards únicos do `KANBAN.md` (ver §3 para o
> mapeamento das sobreposições resolvidas).

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7.5 | 0 | 0 | 1 | 2 | F-availability-2: nenhum self-test de `AUTH_JWT_SECRET` no boot |
| Deployability | 7.0 | 0 | 1 | 1 | 0 | F-deployability-1: migration 0064 sem cobertura de integração em CI |
| Integrability | 8.0 | 0 | 0 | 1 | 1 | F-integrability-1: resolução do "ator" ad-hoc, sem função única |
| Modifiability | 8.0 | 0 | 0 | 2 | 2 | F-modifiability-2: vocabulário do papel `admin` sem fonte única |
| Performance | 9.0 | 0 | 0 | 0 | 3 | F-performance-1: `listAll` sem `LIMIT`/`OFFSET` |
| Fault Tolerance | 8.0 | 0 | 1 | 1 | 1 | F-fault-tolerance-1: `setAtivo`/`deactivateGuarded` sem trilha de auditoria |
| Security | 7.2 | 0 | 1 | 1 | 1 | F-security-1: trilha de auditoria incompleta em ações administrativas |
| Testability | 8.5 | 0 | 1 | 2 | 2 | F-testability-1: guarda de concorrência só provada por gate manual |
| **Overall (dedup)** | **7.9** | **0** | **2** | **9** | **8** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Leitura direta:** nenhum P0. Zero achados de severidade Crítica em nenhuma das 8 QAs — o gate de
merge (`AutoLoopRunner`/Regis-Review) não é bloqueado por este ciclo. Os 2 P1 remanescentes são
específicos e de esforço baixo/médio (ver §2).

## 2. Top 10 risks (cross-QA)

### R-1: Trilha de auditoria ausente em ações administrativas sensíveis
- **QA(s) afetados**: Security, Fault Tolerance
- **Findings de origem**: `security.md` F-security-1, `fault-tolerance.md` F-fault-tolerance-1
- **Evidência sintetizada**: `UserAdminService.setVinculo`, `setAtivo` e `resetPassword`
  (`domain/service/auth/UserAdminService.ts:151-193`) não chamam `LogService` nem gravam
  `*_updated_by`/`*_updated_at` — ao contrário de `setEmail`, no mesmo arquivo, que faz as duas
  coisas. Cobertura medida: 2/5 ações mutantes com trilha persistida (40%).
- **Impacto técnico**: um admin (legítimo ou sessão sequestrada) reseta senha, troca vínculo
  Conexos ou reativa/desativa um usuário sem deixar rastro consultável no banco.
- **Impacto de negócio**: `username` é o `sub` gravado como `executado_por`/`criado_por` em todos os
  ledgers de Permutas, SISPAG e Recebimentos (ADR-0051, D2). Sequestrar a senha ou o vínculo Conexos
  de um usuário é, na prática, sequestrar a autoria das baixas e remessas dele — sem trilha para uma
  investigação pós-incidente ou uma auditoria de compliance.
- **Card(s) Kanban relacionados**: security-1 (mesclado com fault-tolerance-1)
- **Custo de inação em 6 meses**: se houver 1 incidente de conta admin comprometida nesse intervalo
  (premissa: rotatividade normal de equipe + phishing genérico, sem evento específico conhecido), a
  investigação não consegue provar quem executou a ação — o custo não é financeiro direto, é a perda
  de capacidade forense justamente na camada que autentica todas as escritas do ERP.

### R-2: Guarda de concorrência R11 e a guarda de dado da migration 0064 só provadas manualmente
- **QA(s) afetados**: Testability, Deployability
- **Findings de origem**: `testability.md` F-testability-1, `deployability.md` F-deployability-1
- **Evidência sintetizada**: a corrida de dois admins se autodesativando (`FOR UPDATE`,
  `deactivateGuarded`) e o `RAISE EXCEPTION` da migration `0064` só foram verificados contra um
  Postgres real por um gate manual desta rodada (20/20, `_shared-metrics.md`). 0 arquivos
  `describe('integration: ...')` no repo; 0 scripts de Postgres descartável versionados; o único
  teste de `0064` é regex sobre o texto do `.sql`.
- **Impacto técnico**: nenhum mock consegue provar serialização de transação real. Uma mudança
  futura em `runMigrations.ts`, `MigrationFiles.ts` ou `deactivateGuarded` (esperada no passo 2/3 do
  ADR-0051) pode afrouxar a guarda sem que nenhum gate de CI fique vermelho.
- **Impacto de negócio**: R11 existe para impedir que a Columbia fique sem nenhum admin ativo — um
  auto-bloqueio total da gestão de acessos. O primeiro sinal de uma regressão seria produção, não PR.
- **Card(s) Kanban relacionados**: testability-1 (mesclado com deployability-1)
- **Custo de inação em 6 meses**: o passo 2/3 do ADR-0051 (próximo ciclo planejado) toca exatamente
  `UserRepository`/migrations de novo — sem o harness de integração, cada mudança nessa área repete o
  mesmo gate manual ad hoc (custo de revisão recorrente) ou arrisca merge sem essa prova.

### R-3: JWT não revogado após desativação — sessão "zumbi" de até 12h
- **QA(s) afetados**: Security, Fault Tolerance
- **Findings de origem**: `security.md` F-security-3, `fault-tolerance.md` F-fault-tolerance-3
- **Evidência sintetizada**: `setAtivo`/`deactivateGuarded` mudam `app_user.ativo`, mas
  `buildAuthMiddleware` (`http/auth.ts`, pré-existente) só valida assinatura/expiração do JWT
  (`TOKEN_EXPIRATION='12h'`) — nunca reconsulta `ativo`. Pré-existente a este delta, mas o delta
  acabou de reforçar a guarda de QUEM pode desativar (R11) sem fechar a lacuna adjacente.
- **Impacto técnico**: um usuário desativado continua autenticando em qualquer rota que não dependa
  do vínculo Conexos por até 12h.
- **Impacto de negócio**: no cenário mais provável — desligamento de funcionário ou vazamento de
  credencial — a janela entre "admin desativa" e "token expira" é o tempo em que uma credencial
  supostamente revogada ainda gera tráfego autenticado num sistema financeiro.
- **Card(s) Kanban relacionados**: security-2 (mesclado com fault-tolerance-3)
- **Custo de inação em 6 meses**: baixo se nenhum desligamento de emergência ocorrer; alto (resposta
  a incidente mais lenta, sem controle técnico de corte imediato) se ocorrer — a única mitigação hoje
  é operacional (avisar o operador para trocar `AUTH_JWT_SECRET`, o que derruba TODAS as sessões, não
  só a do usuário desativado).

### R-4: Nenhum padrão de `Idempotency-Key` antes das frentes financeiras chegarem
- **QA(s) afetados**: Fault Tolerance
- **Findings de origem**: `fault-tolerance.md` F-fault-tolerance-2
- **Evidência sintetizada**: as 5 rotas de mutação deste delta são seguras a reenvio "por sorte de
  domínio" (e-mail único, operações já idempotentes) — não por um mecanismo formal. É o primeiro
  conjunto de rotas nascido sob a política DDD/Lambda-ready do CLAUDE.md, e não estabelece o padrão.
- **Impacto técnico**: nenhum nesta feature (confirmado linha a linha). O risco é estrutural para o
  que vem a seguir.
- **Impacto de negócio**: "executar permuta", "finalizar lote SISPAG" e "baixar conciliação" — as
  próximas features do roadmap — não têm chave natural tão conveniente quanto e-mail único. Um
  double-click ou retry de proxy sem `Idempotency-Key` definido vira execução financeira duplicada.
  Este é exatamente o cenário P0 que a disciplina de Fault Tolerance existe para prevenir — só ainda
  não aconteceu porque nenhuma escrita financeira nasceu sob essa lacuna ainda.
- **Card(s) Kanban relacionados**: fault-tolerance-2
- **Custo de inação em 6 meses**: se o `/feature-new` de execução de permuta ou remessa SISPAG (ambos
  no roadmap declarado) for modelado antes de este padrão existir, o retrabalho é desenhar
  idempotência sob pressão, no meio de uma feature que já mexe com dinheiro — mais caro do que
  defini-lo isolado agora.

### R-5: Vocabulário do papel `admin`/`operador` sem fonte única
- **QA(s) afetados**: Modifiability
- **Findings de origem**: `modifiability.md` F-modifiability-2
- **Evidência sintetizada**: `ADMIN_ROLE` (privado, `UserRepository.ts:58`), `USER_ROLES`
  (`UserAdminService.ts:16`) e ~40 literais `'admin'` inline em `requireRole('admin')` espalhados por
  `permutas.ts`, `sispag.ts`, `recebimentos.ts`, `operacao.ts`, `usuarios.ts` — 0 tipo/enum
  compartilhado.
- **Impacto técnico**: um typo em `requireRole('adimn')` falha silenciosamente para 403 em vez de
  erro de compilação; adicionar/renomear papel exige varredura manual.
- **Impacto de negócio**: a própria ADR-0051 já anuncia "Permissões por página/feature, lidas do
  banco" como o passo 2, exatamente a próxima mudança nesta área — chegar lá com o vocabulário
  espalhado multiplica o custo da mudança já planejada e aumenta o risco de um rollout de permissão
  bloquear (ou liberar demais) usuários sem erro visível até QA manual.
- **Card(s) Kanban relacionados**: modifiability-2
- **Custo de inação em 6 meses**: o passo 2 do ADR-0051 (RBAC granular) é replanejado ou sofre um
  incidente de rollout de permissão — o card custa M (2-5d) agora; feito durante o passo 2, some
  como retrabalho não-planejado dentro de uma feature maior.

### R-6: Resolução do "ator" (`req.user.sub ?? req.user.email`) duplicada e sem consenso de ordem
- **QA(s) afetados**: Integrability, Modifiability
- **Findings de origem**: `integrability.md` F-integrability-1, `modifiability.md` F-modifiability-3
- **Evidência sintetizada**: 20 ocorrências repo-wide (19 pré-existentes + 1 nova em
  `routes/usuarios.ts:32`), em 2 ordens de precedência divergentes já hoje (`sub ?? email` em 3
  sítios de `recebimentos.ts`, `email ?? sub` em 2). A própria ADR-0051 (seção D2, nova neste delta)
  nomeia isso como risco explícito para o passo 3 (Supabase Auth, que adiciona a claim `email`).
- **Impacto técnico**: trocar o provedor de identidade no passo 3 exige grep manual e edição
  coordenada de ~20 call-sites fora da camada de auth, em vez de 1 função.
- **Impacto de negócio**: se 1 dos ~20 sítios for esquecido na inversão do passo 3, o `triggeredBy`/
  `ator` gravado nos ledgers de Permutas/SISPAG/Recebimentos passa a registrar e-mail em vez de
  `username` **em silêncio** — quebra de auditoria e do vínculo Conexos por usuário, sem erro visível
  até uma auditoria ou incidente.
- **Card(s) Kanban relacionados**: modifiability-3 (mesclado com integrability-1)
- **Custo de inação em 6 meses**: o passo 3 do ADR-0051 (Supabase Auth) é o marco que materializa
  esse risco — se chegar antes do helper existir, o card de extração (S, ≤1d) vira um item bloqueante
  dentro de uma migração de provedor de identidade, sob mais pressão.

### R-7: Nenhum self-test de `AUTH_JWT_SECRET` no boot
- **QA(s) afetados**: Availability
- **Findings de origem**: `availability.md` F-availability-2
- **Evidência sintetizada**: `AuthService.signToken` só descobre a ausência de `AUTH_JWT_SECRET`
  quando o primeiro usuário tenta logar, retornando 500 — não há checagem no boot da instância,
  apesar de a variável já estar rastreada pelo `CONFIG_MANIFESTO`/`ConfigDoctor`.
- **Impacto técnico**: um deploy sem a variável sobe verde (build/typecheck/lint não dependem do env
  real) e só quebra no primeiro login real.
- **Impacto de negócio**: bloqueio total de acesso (Permutas/SISPAG/GED, todos atrás de login) sem
  nenhum sinal automático antes da primeira tentativiva de um usuário — em um sistema single-instance
  sem CloudWatch/alertas, o "detector" é um analista reportando "não consigo entrar".
- **Card(s) Kanban relacionados**: availability-1
- **Custo de inação em 6 meses**: 1 incidente de rotação de segredo mal executada (evento plausível,
  sem data prevista) custa o tempo entre o deploy e o primeiro relato manual de um usuário —
  hoje sem piso superior conhecido, porque não há alerta.

### R-8: `BCRYPT_ROUNDS` hardcoded em 2 sítios independentes
- **QA(s) afetados**: Modifiability (relevante para Security)
- **Findings de origem**: `modifiability.md` F-modifiability-1
- **Evidência sintetizada**: `UserAdminService.ts:13` e `seed-admin.ts:19` declaram
  `BCRYPT_ROUNDS = 12` de forma idêntica, com comentário que admite a duplicação em vez de
  eliminá-la.
- **Impacto técnico**: um ajuste de custo do bcrypt (hardening plausível, dado o histórico do
  repositório) em 1 sítio sem o outro produz política de hashing divergente, sem erro de build.
- **Impacto de negócio**: parâmetro de segurança vira política implícita de 2 sítios — um deles
  (`seed-admin`, que semeia a conta admin inicial) pode ficar com hashing mais fraco sem alerta.
- **Card(s) Kanban relacionados**: modifiability-1
- **Custo de inação em 6 meses**: baixo isoladamente (custo de fix é S, ≤1d); o risco é a divergência
  silenciosa se um hardening futuro tocar só 1 dos 2 sítios.

### R-9: Rotas novas não toleram a janela "Vercel na frente do Render"
- **QA(s) afetados**: Deployability
- **Findings de origem**: `deployability.md` F-deployability-2
- **Evidência sintetizada**: `POST /usuarios` (só `email`) e `PATCH /usuarios/:id/email` não têm
  teste para a direção de risco real (front novo × back antigo); só a direção inversa (front antigo ×
  back novo) é testada. Recomendação de documentar a ordem de deploy já existe desde a revisão de
  2026-09-16 e segue não implementada.
- **Impacto técnico**: numa janela de poucos minutos a cada deploy que toque `/usuarios`, um admin
  vê 400/404 ao tentar cadastrar um colega ou corrigir um e-mail.
- **Impacto de negócio**: baixa frequência (feature admin-only), autorrecuperável — mas é um sintoma
  recorrente de uma classe de risco já conhecida e não endereçada há 2 ciclos.
- **Card(s) Kanban relacionados**: deployability-2
- **Custo de inação em 6 meses**: cada feature futura que tocar `/usuarios` ou `/auth` reintroduz a
  mesma janela — custo cumulativo de suporte, não de dado corrompido.

### R-10: Oráculo de tempo no login permite enumerar contas ativas
- **QA(s) afetados**: Security
- **Findings de origem**: `security.md` F-security-2
- **Evidência sintetizada**: identificador inexistente ou conta inativa retorna sem tocar
  `bcrypt.compare`; senha errada só retorna depois de um `bcrypt.compare` custo-12 (~80-150ms) —
  diferença estrutural de tempo entre os 3 caminhos de falha do login, apesar do código declarar a
  intenção de resposta uniforme.
- **Impacto técnico**: um atacante mede latência para distinguir "conta não existe/inativa" de
  "conta existe, senha errada".
- **Impacto de negócio**: baixo isoladamente (não vaza credencial), mas informa quais e-mails são
  contas ativas da Columbia — insumo direto para phishing direcionado contra pessoas reais.
- **Card(s) Kanban relacionados**: security-3
- **Custo de inação em 6 meses**: baixo e não-financeiro direto; o card custa S (≤1d) e fecha uma
  classe de vulnerabilidade clássica antes que o número de usuários cresça o suficiente para o risco
  de enumeração ficar mais atrativo.

## 3. Cross-cutting findings

### CC-1: Trilha de auditoria aplicada de forma inconsistente dentro do mesmo serviço
- **Aparece em**: Security, Fault Tolerance
- **Findings**: F-security-1 (Security), F-fault-tolerance-1 (Fault Tolerance)
- **Diagnóstico unificado**: `UserAdminService` introduziu o padrão certo (coluna `*_updated_by/at` +
  `LogService.info`) para `setEmail`, no mesmo commit/arquivo — mas não o replicou para
  `setVinculo`/`setAtivo`/`resetPassword`. Não é ausência de convenção; é aplicação parcial de uma
  convenção que o próprio delta estabeleceu.
- **Recomendação consolidada**: card único (`security-1`, mesclado) que estende o padrão de
  `setEmail` às outras três ações — 1 migration aditiva + 3 chamadas de `LogService`, mesmo formato
  já testado.

### CC-2: JWT sem revogação ativa pós-mudança de estado de autorização
- **Aparece em**: Security, Fault Tolerance
- **Findings**: F-security-3 (Security), F-fault-tolerance-3 (Fault Tolerance)
- **Diagnóstico unificado**: o middleware de auth (pré-existente, `http/auth.ts`) só verifica
  assinatura/expiração do JWT — nunca reconsulta o estado de `app_user.ativo`. O delta adiciona duas
  guardas novas sobre QUEM pode desativar (R11) sem fechar a lacuna adjacente de QUANDO o efeito da
  desativação realmente se propaga para uma sessão já emitida.
- **Recomendação consolidada**: card único (`security-2`, mesclado) com dois caminhos — mitigação
  tática (checagem de `ativo` cacheada com TTL curto nas rotas admin) como passo intermediário, e
  redução do `TOKEN_EXPIRATION` como fallback mais simples; a solução definitiva continua sendo o
  passo 2 do ADR-0051 (permissões lidas do banco por requisição).

### CC-3: Resolução do "ator" duplicada, sem função única — risco nomeado pelo próprio ADR-0051
- **Aparece em**: Integrability, Modifiability
- **Findings**: F-integrability-1 (Integrability), F-modifiability-3 (Modifiability)
- **Diagnóstico unificado**: o padrão `req.user?.sub ?? req.user?.email` (ou a ordem inversa) está
  espalhado por 20 sítios em 5 arquivos de rota, sem nenhum encapsulamento. O `sub` continua sendo
  `username` hoje (decisão deliberada do passo 1), mas o passo 3 do ADR-0051 adiciona a claim
  `email` — e o próprio ADR já documenta que os sítios divergentes precisam ser invertidos "no mesmo
  PR" sob risco de gravar e-mail em vez de `username` na trilha de auditoria financeira em silêncio.
- **Recomendação consolidada**: card único (`modifiability-3`, mesclado) extraindo
  `actorFromRequest(req)`/`resolveAtor(req)` único, consumido pelos 20 sítios — não bloqueia este
  ciclo, mas deve ser pré-requisito do `/feature-new` que implementar o passo 3.

### CC-4: Garantias de concorrência/migração provadas só manualmente, não versionadas como teste
- **Aparece em**: Testability, Deployability
- **Findings**: F-testability-1 (Testability), F-deployability-1 (Deployability)
- **Diagnóstico unificado**: tanto a guarda R11 (`FOR UPDATE`) quanto a guarda de dado da migration
  `0064` (`RAISE EXCEPTION` condicional a `username` duplicado) dependem de comportamento real do
  Postgres que um mock não reproduz — e o repositório já tem o padrão certo para isso
  (`vwMetricasCiclo.integration.test.ts`, de uma revisão anterior), só não o aplicou aqui. A raiz é a
  mesma: falta um harness de Postgres descartável versionado e reutilizável em CI.
- **Recomendação consolidada**: card único (`testability-1`, mesclado, esforço M) que cria o harness
  de integração de uma vez — cobre `UserRepository`/R11 (o pedido de Testability) e a guarda da
  `0064` (o pedido de Deployability) na mesma infraestrutura, com `npm run test:integration`
  reutilizável por qualquer feature futura que precise da mesma prova.

### CC-5: Números mágicos e vocabulário de domínio sem fonte única
- **Aparece em**: Modifiability (com leitura relevante para Security e Deployability)
- **Findings**: F-modifiability-1 (`BCRYPT_ROUNDS`), F-modifiability-2 (vocabulário de papéis)
- **Diagnóstico unificado**: dois parâmetros com peso de política (custo de hashing, papéis de
  autorização) são declarados de forma independente em múltiplos sítios, sem um módulo único que o
  compilador amarre. O padrão correto já existe no delta (`EnvironmentProvider`/`CONFIG_MANIFESTO`
  para config; `SET_EMAIL_RESULT`/`DEACTIVATE_RESULT` como enum para resultado) — só não foi aplicado
  a esses dois casos específicos.
- **Recomendação consolidada**: dois cards pequenos e independentes (`modifiability-1`,
  `modifiability-2`) — não há ganho em mesclá-los (mudam arquivos diferentes), mas valem ser
  planejados juntos por serem da mesma classe de dívida e ambos esforço baixo/médio.

### CC-6: Falhas silenciosas e ausência de timeout em chamadas HTTP do frontend
- **Aparece em**: Availability, Performance
- **Findings**: F-availability-1, F-availability-4 (Availability), F-performance-2 (Performance)
- **Diagnóstico unificado**: `apiFetch`/`fetch` (mecanismo pré-existente, `lib/http.ts`, fora do
  diff) não tem `AbortController`/timeout; o padrão é reproduzido pela nova `definirEmail` e pelo
  novo `fetchTransicaoEmail`, que além disso engolem qualquer erro sem log (`.catch(() => undefined)`
  — hoje em `src/frontend/app/login/page.tsx:44`, ver nota de escopo em §7). Nenhum dos dois é
  regressão introduzida por este delta — é dívida sistêmica tocada por ele.
- **Recomendação consolidada**: `availability-3` (padronizar timeout em `lib/http.ts`, follow-up de
  ciclo futuro) resolve a causa raiz para toda a tela `/usuarios` e `/login` de uma vez;
  `availability-2` (log da falha do banner) é o remendo local e imediato enquanto o follow-up não
  entra.

## 4. Quick wins (≤5 dias úteis)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| security-1 | Security + Fault Tolerance | S | P1 | Auditoria (autor+timestamp) em 100% das ações administrativas (`setVinculo`/`setAtivo`/`resetPassword`), hoje 40% |
| availability-1 | Availability | S | P2 | `AUTH_JWT_SECRET` ausente detectado no boot, não só no 1º login real |
| deployability-2 | Deployability | S | P2 | Ordem de deploy Render→Vercel documentada em `DEPLOY.md`; 3/3 rotas novas testadas para front-novo×back-antigo |
| modifiability-1 | Modifiability | S | P2 | `BCRYPT_ROUNDS` em 1 fonte única, não mais 2 sítios divergentes |
| modifiability-3 | Modifiability + Integrability | S | P2 | Helper único `actorFromRequest`, substitui 20 ocorrências inline |
| testability-2 | Testability | S | P2 | `seed-admin.ts` com teste direto dos caminhos exit 0/1 |
| testability-3 | Testability | S | P2 | Piso de `coverageThreshold` do frontend deixa de ser decorativo (33/23/28 → valor medido) |

Estes 7 cards são a proposta defensável de "primeira sprint pós-aprovação": nenhum é P0, mas
endereçam os dois P1 do ciclo e 5 P2 de alto leverage, todos ≤1 dia de esforço individual.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| testability-1 | Testability + Deployability | M | Sandbox | Fecha a lacuna que deixa a guarda R11 e a migration `0064` sem prova reproduzível — o repo já tem o precedente (`vwMetricasCiclo.integration.test.ts`), este card generaliza para `UserRepository`; sem ele, 0/1 migrations com guarda condicional têm cobertura de integração em CI (métrica de `deployability.md`) |
| modifiability-2 | Modifiability | M | Increase Semantic Coherence | O passo 2 do ADR-0051 ("Permissões por página/feature") já está anunciado como próximo; hoje 2 declarações + ~40 literais de papel sem vínculo de tipo — fazer isto antes reduz o custo da mudança já planejada, não é trabalho especulativo |
| fault-tolerance-2 | Fault Tolerance | M | Idempotent Replay | 0/5 endpoints deste delta honram `Idempotency-Key` (mitigados só por chave natural); é o primeiro conjunto de rotas nascido sob a política DDD/Lambda-ready — definir o padrão agora custa 1 ADR/doc, definir sob pressão durante "executar permuta" custa uma decisão de arquitetura no meio de uma feature financeira |
| security-2 | Security + Fault Tolerance | M | Revoke Access | Janela de acesso residual pós-desativação hoje é 12h (TTL do token), 0 mecanismos de revogação server-side — direto relevante para resposta a incidente de credencial comprometida num sistema que autentica escritas financeiras |
| modifiability-4 | Modifiability | M | Abstract Common Services | 3 arquivos de rota (`usuarios.ts`, `permutas.ts`, `recebimentos.ts`) reinventam o mapeamento erro-de-domínio→HTTP; toda rota nova de `/feature-new` volta a copiar o padrão — consolidar agora achata o custo incremental de cada feature futura |

## 6. O que está bem (e por quê)

1. **Zero P0 em 8 QAs simultâneas** — nenhum achado bloqueia o merge; o delta passa nos próprios
   critérios que ele reforça (guardas novas, sem regressão).
2. **Exception Detection em login ambíguo** — `AuthService.login` recusa (401 + log) quando um
   identificador casa com >1 usuário, em vez de autenticar de forma indeterminística. Coberto por
   teste (`AuthService.ts:62-76`, `AuthService.test.ts:77`). Achado positivo de Availability.
3. **Credencial default hardcoded removida** — `seed-admin` tinha `ADMIN_PASSWORD ?? 'columbia2026'`
   público no repositório em `origin/main`; o delta troca por validação Zod sem `.default()`, que
   falha alto (exit 1) em vez de semear uma senha conhecida. Achado positivo de Security (tactic
   Change Default Settings), era P0 histórico, hoje remediado.
4. **Guarda transacional de "último admin ativo" (R11)** — `deactivateGuarded` usa `FOR UPDATE` numa
   transação, provado 20/20 contra Postgres real: exatamente 1 dos 2 admins concorrentes passa, resta
   sempre ≥1 ativo. Tactic Transactions/Removal from Service, Availability e Fault Tolerance.
5. **`GET /auth/transicao` devolve o mínimo necessário** — só `{ ativo: boolean }`, nenhuma contagem,
   nome ou e-mail vazado numa rota deliberadamente pública. Tactic Limit Exposure, Security.
6. **100% dos boundaries novos validados com Zod** (login, criação/edição de usuário, ativação,
   reset de senha, vínculo Conexos) — 8/8 rotas. Consistente com a convenção do CLAUDE.md.
7. **Mudança contida na camada certa** — 0 arquivos fora de `domain/*/auth`, `routes/{auth,usuarios}`
   e o frontend de `usuarios`/`login` tocados; o maior arquivo do delta (`UserRepository.ts`, 379
   LOC) ficaria em 15º lugar no ranking de tamanho do repositório inteiro. Modifiability.
8. **O próprio ciclo se autocorrigiu durante a revisão** — o commit `6decb8d` moveu 3 classes de erro
   de dentro de `UserRepository.ts` para `domain/errors/`, alinhando com a convenção já estabelecida
   no repositório, sem regressão de typecheck/lint. Tactic Refactor, Modifiability — evidência de que
   o pipeline (AutoLoopRunner + PatternGuardian) funciona mesmo depois do código já estar "verde".

## 7. Limitações da análise

**Métricas declaradas não-medíveis localmente pelos agentes:**
- MTTR real de um incidente de login em produção (Availability) — requer logs/alertas do Render, que
  não existem hoje (sem CloudWatch neste stack).
- Latência real (p50/p95) de `POST /auth/login` e `GET /usuarios` em produção (Performance) — sem
  APM instrumentado.
- Custo real do `bcryptjs` sob carga concorrente (Performance) — requer benchmark isolado, não
  medido nesta rodada `--quick`.
- Taxa de erro por dependência/endpoint em produção (Integrability) — requer dashboard agregado do
  Render.
- `npm audit` profundo e cobertura de linha/branch real (todas as QAs) — omitidos por instrução
  explícita do run (`--quick`), já declarados assim em `_shared-metrics.md`.
- Timing empírico do oráculo de tempo no login (Security, F-security-2) — achado estrutural de
  código, não medido em produção.

**O que o pipe não cobre:** chaos engineering, threat modeling formal, custo cloud, UX/acessibilidade
das telas novas, penetration testing. Terraform/infra/multi-tenant por conta AWS são o **estado-alvo**
do CLAUDE.md — não existem neste repositório hoje, então toda métrica correspondente foi tratada
como N/A pelos 8 agentes, não como ausência penalizável.

**Achados já remediados ou deslocados durante a janela de revisão (2 itens, conforme instrução do
orquestrador):**
1. **Classes de erro movidas para `src/backend/domain/errors/`** (commit `6decb8d`) — chegou na
   branch durante a revisão de Modifiability; essa seção já reflete o estado pós-refactor (evidência
   citada com o hash do commit). Nenhuma ação pendente; citado em §6 como sinal positivo.
2. **`TransicaoEmailBanner` tornado presentacional, fetch içado para `LoginForm`** (commit `62310c4`)
   — este NÃO é a correção de um achado, é um refactor estrutural que chegou depois de Availability e
   Performance terem gerado suas seções. O efeito prático: a lógica de `fetch` + `.catch(() =>
   undefined)` que F-availability-1/card `availability-2` referenciam em
   `TransicaoEmailBanner.tsx:20-24` **ainda existe, com o mesmo comportamento silencioso** — só que
   hoje mora em `src/frontend/app/login/page.tsx:38-48` (`LoginForm`, verificado nesta consolidação).
   O card `availability-2` no `KANBAN.md` já aponta para a localização atual; o achado **não está
   remediado**, só mudou de arquivo.

**Inconsistência de metadado (não bloqueante):** `integrability.md` e `testability.md` declaram
`run_id: 2026-09-28-1550` no frontmatter (sem o sufixo `-auth-email-transicao` que as outras 6 seções
usam). Conteúdo e nome de arquivo confirmam se tratar da mesma rodada; tratado como erro cosmético de
geração, não como falha de validação.

**Janela temporal:** este é um snapshot de 2026-09-28. Refazer a cada ciclo relevante que tocar a
camada `auth`/`usuarios` — em particular, antes e depois dos passos 2 e 3 do ADR-0051.

## 8. Ações recomendadas

1. Fechar os 2 P1 na próxima sprint: `security-1` (trilha de auditoria, S) e `testability-1` (harness
   de integração para R11 + migration `0064`, M) — nenhum bloqueia o merge já feito, mas ambos
   protegem invariantes que o próprio delta introduziu ou reforçou.
2. Rodar os 7 quick wins de §4 como a primeira sprint pós-aprovação (todos S, ≤1 dia cada,
   endereçam 2 P1 + 5 P2).
3. Tratar `modifiability-3` (helper `actorFromRequest`) e `fault-tolerance-2` (padrão de
   `Idempotency-Key`) como pré-requisitos — não bloqueantes deste ciclo, mas a fazer **antes** do
   `/feature-new` que implementar o passo 3 do ADR-0051 (Supabase Auth) e antes do primeiro
   `/feature-new` de execução financeira sem chave natural (permuta/remessa SISPAG), respectivamente.
4. Planejar `modifiability-2` (vocabulário de papéis) para o mesmo ciclo do passo 2 do ADR-0051
   (RBAC granular) — fazer antes reduz o custo da mudança já anunciada, não depois de ela começar.
5. Abrir `security-2` (revogação de JWT pós-desativação) como item de segurança operacional
   independente, não amarrado ao roadmap do ADR-0051 — é a mitigação que reduz o tempo de resposta a
   um incidente de credencial comprometida hoje, com ou sem o passo 2 completo.
