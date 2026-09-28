---
type: regis-review-kanban
run_id: 2026-09-28-2158-auth-permissoes-modulo
total: 31
counts: { p0: 0, p1: 11, p2: 14, p3: 6 }
---

# Kanban — financeiro — 2026-09-28-2158-auth-permissoes-modulo

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Sem P0 neste run (ver REPORT.md §2).

---

## P0 — Crítico

_Nenhum card. As 8 seções Regis-Review confirmam 0 findings P0 neste delta (ver REPORT.md §2 para a verificação cruzada)._

---

## P1 — Alto

### [availability-2] Retry curto na consulta de acesso por requisição antes do fail-closed

**QA**: Availability
**Tactic alvo**: Retry
**Esforço**: S (≤1d)
**Findings**: F-availability-2

**Problema**
> `AccessService.resolver` faz uma única tentativa de `AccessRepository.findAccessBySub`; qualquer rejeição (erro de query, não necessariamente indisponibilidade sustentada) vai direto a 503 em `resolverAcesso` (`src/backend/http/acesso.ts:131-151`), sem nenhum Executor (`RetryExecutor`/`FallbackExecutor`) no caminho — diferente da abertura do pool de conexão, que já tem retry (`PostgreeDatabaseClient.ts:94-98`).

**Melhoria Proposta**
> Envolver a chamada a `accessRepository.findAccessBySub` num `RetryExecutor` com 1-2 tentativas e delay curto (ex.: 100-300ms) antes de propagar o erro para o fail-closed — usando o primitivo já existente no projeto (`src/backend/domain/libs/executor/RetryExecutor.ts`), sem mudar a semântica de fail-closed quando as tentativas se esgotarem.

**Resultado Esperado**
> Uma falha de rede de um único round-trip (não uma indisponibilidade sustentada do banco) deixa de virar 503 visível; só uma falha persistente através das tentativas continua fail-closed, como hoje. Executors na cadeia `resolverAcesso → AccessService → AccessRepository`: 0 → 1.

**Métricas de sucesso**
- Executors na cadeia `resolverAcesso → AccessService → AccessRepository`: 0 → 1

**Risco de não fazer**
> Uma falha de rede pontual num único round-trip ao Postgres — não uma indisponibilidade real do banco — já é suficiente para negar toda requisição autenticada do sistema, ampliando desnecessariamente a superfície de um fail-closed que deveria reagir só a degradação sustentada.

**Dependências**: Nenhuma.

---

### [availability-3] Dar ao `/operacao` uma via de acesso que sobrevive à degradação do Postgres

**QA**: Availability
**Tactic alvo**: Passive Redundancy
**Esforço**: S (≤1d)
**Findings**: F-availability-3

**Problema**
> `/operacao` — o próprio comentário do código o descreve como "a tela que se consulta durante um incidente" (`src/backend/http/buildApp.ts:163-167`) — está montado depois de `resolverAcesso` (`buildApp.ts:127`) e por isso herda o mesmo 503 fail-closed de qualquer outra rota quando o Postgres degrada. Antes da ADR-0053, o gate de `/operacao` (`requireOperacaoAcesso`) só lia o claim do token, sem tocar o banco.

**Melhoria Proposta**
> Dar ao guard de `operacao:ver` especificamente um fallback: se `resolverAcesso` falhar por erro do repositório (não por usuário inexistente/inativo), permitir a leitura de `/operacao` para quem tem `role: 'admin'` no claim do token (ainda emitido, por compatibilidade — D3/D12 da ADR-0053), com log explícito de que o fallback foi usado. Usar o primitivo `FallbackExecutor` já existente no projeto.

**Resultado Esperado**
> O painel de incidente permanece acessível durante uma degradação do Postgres que não seja causada por dado de usuário (inexistente/inativo) — exatamente o cenário em que ele é mais necessário. `/operacao` acessível durante um `AccessRepository` indisponível: hoje não (503) → sim (fallback pelo claim do token, logado).

**Métricas de sucesso**
- `/operacao` disponível quando `AccessRepository.findAccessBySub` falha: não → sim (via fallback logado)

**Risco de não fazer**
> A ferramenta de primeira resposta do time fica indisponível justamente durante a classe de incidente mais provável de acioná-la, aumentando o MTTR percebido de qualquer degradação do Postgres.

**Dependências**: Nenhuma. Reavaliar quando o passo 3 (Supabase Auth) remover o claim `role` do token (D12 da ADR-0053) — o fallback precisa de outra fonte secundária nessa hora.

---

### [modifiability-1] Unificar o catálogo de permissões numa única fonte gerada

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-modifiability-1 (cross-ref: F-integrability-1 — ver REPORT.md CC-2)

**Problema**
> O catálogo de 9 permissões existe em 6 listas literais (3 no backend em `Permission.ts`, 2 no `CHECK` da migration 0066, 2 no `permissoes.ts` do frontend). O teste da 0066 garante paridade backend↔banco, mas nada garante paridade backend↔frontend — um valor esquecido no espelho do frontend só se manifesta como "o item não aparece no menu", sem log nem teste.

**Melhoria Proposta**
> Aplicar a tactic Abstract Common Services: gerar `src/frontend/lib/permissoes.ts` a partir de `src/backend/domain/interface/auth/Permission.ts` num passo de build (script simples que copia o array e falha o `npm run build` do frontend se divergir), ou adicionar um teste de paridade cruzada (`__tests__/permissoes-api.test.ts` já existe — estender para comparar contra uma cópia fixa do array do backend). Dentro do backend, reduzir `PERMISSION_CATALOG` e `permissionSchema` a serem derivados de `PERMISSION` via `Object.values`, eliminando 2 das 3 listas internas.

**Resultado Esperado**
> Nº de listas literais do catálogo: 6 → 2 (backend fonte + frontend com teste de paridade automatizado). Esquecer uma permissão no frontend passa a falhar um teste, não a virar um item invisível no menu.

**Métricas de sucesso**
- Listas literais do catálogo: 6 → 2
- Teste de paridade backend↔frontend: 0 → 1 (novo)

**Risco de não fazer**
> A cada nova frente (ex.: Conciliação de Recebimentos ganhando permissão própria), o esquecimento do espelho do frontend se repete sem sinal — vira um "bug de UI" reportado pelo usuário em vez de pego no CI.

**Dependências**: Nenhuma.

---

### [modifiability-2] Remover a dependência de `AccessRepository` sobre `EffectivePermissionCalculator`

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies
**Esforço**: S (≤1d)
**Findings**: F-modifiability-2

**Problema**
> `AccessRepository` (camada Repository) importa e injeta `EffectivePermissionCalculator` (camada Service) para decidir, dentro de `lockAndCheck`, se uma escrita deixaria zero gestores ativos. É o único arquivo em `domain/repository/**` que depende de `domain/service/**`, invertendo a direção documentada em `CLAUDE.md` (`Lambda → Service → Repository → Client`).

**Melhoria Proposta**
> Aplicar Restrict Dependencies: mover `EffectivePermissionCalculator` para `domain/core/` (ou `domain/libs/`), ao lado de outras utilidades de domínio puras, já que não tem I/O e é consumida tanto por Service quanto por Repository. Alternativa mais barata: documentar em `CLAUDE.md`/PatternGuardian uma exceção explícita e nomeada para calculadoras puras de domínio.

**Resultado Esperado**
> `domain/repository/**` volta a ter zero imports de `domain/service/**` (hoje 1), ou a exceção fica registrada e testável pelo PatternGuardian em vez de implícita.

**Métricas de sucesso**
- Imports de `domain/repository/**` para `domain/service/**`: 1 → 0

**Risco de não fazer**
> O próximo repositório que precisar de uma regra de domínio replica o padrão (repository importando service), e sem um caso testado de ciclo real hoje, a primeira ocorrência de fato cíclica só aparece quando dois repositórios se importarem via dois serviços diferentes — mais caro de desfazer depois que normalizado.

**Dependências**: Nenhuma.

---

### [performance-1] Coalescer chamadas concorrentes no `AccessService` (single-flight) antes de escrever no cache

**QA**: Performance
**Tactic alvo**: Increase Concurrency
**Esforço**: S (≤1d)
**Findings**: F-performance-1

**Problema**
> `AccessService.resolver` só grava no cache depois que a consulta termina. Duas requisições concorrentes do mesmo usuário em cache frio (comprovado em código: `Promise.all` de `sispag/page.tsx:216`; e garantido a cada deploy, já que o cache em memória zera no restart) disparam duas idas ao banco em vez de compartilhar uma, competindo pelas mesmas 5 conexões do pool usado por toda a aplicação.

**Melhoria Proposta**
> Guardar no `Map` do `AccessService` a promise em voo, não só o valor resolvido: no cache miss, criar `const inflight = this.accessRepository.findAccessBySub(sub)`, colocar essa promise na entrada do cache imediatamente, e só substituir pelo valor final quando ela resolver. Chamadas concorrentes com a mesma chave devem `await` a MESMA promise.

**Resultado Esperado**
> Chamadas concorrentes do mesmo usuário em cache frio: 2 queries → 1 query. Rajada pós-deploy com 14 usuários ativos: até 14 queries simultâneas → no máximo 1 por usuário distinto.

**Métricas de sucesso**
- Queries de acesso por rajada de N requisições concorrentes do mesmo usuário: N → 1
- Conexões do pool de 5 consumidas por chamada de tela com `Promise.all` (ex. SISPAG): 2 → 1

**Risco de não fazer**
> A cada deploy (e a cada tela com chamadas paralelas), o pool de 5 conexões — compartilhado com toda a lógica de negócio — sofre uma rajada evitável de contenção exatamente no momento em que o sistema está mais vulnerável (logo após subir).

**Dependências**: Nenhuma.

---

### [fault-tolerance-2] Trilhar a reativação/reatribuição de papel feita pelo `seed-admin`

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-2 (cross-ref: F-security-1 — ver REPORT.md CC-3)

**Problema**
> `UserRepository.upsertAdmin` (usado pelo job `seed-admin`) muda `role_id` e `ativo` via `INSERT ... ON CONFLICT` cru, sem chamar `AccessRepository.recordEvent`. É o único, dos 5 caminhos de escrita de acesso do delta, que não grava na trilha `app_user_access_event`.

**Melhoria Proposta**
> Tactic alvo: Condition Monitoring (fechar a lacuna do invariante D7 da ADR-0053). Envolver o `INSERT ... ON CONFLICT` em `withTransaction`, comparar o estado antes/depois (papel e `ativo`) e chamar `this.accessRepository.recordEvent(tx, { actor: 'seed-admin', ... })` quando algo mudar — mesmo padrão de `create`/`setRole`.

**Resultado Esperado**
> Caminhos de escrita de acesso com evento persistido: 4/5 → 5/5. Reset/reativação do admin de bootstrap em produção passa a aparecer na trilha como qualquer outra mudança de acesso.

**Métricas de sucesso**
- Caminhos de escrita de acesso com `recordEvent`: 4/5 → 5/5

**Risco de não fazer**
> Um re-seed em produção (troca de senha/reativação do admin) continua invisível na trilha de auditoria, justamente na conta mais privilegiada do sistema.

**Dependências**: Nenhuma.

---

### [testability-1] Harness de integração automatizado para a migration 0066 e a guarda R9

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M (2-5d)
**Findings**: F-testability-1 (cross-ref: fault-tolerance.md §6, deployability.md §6 — ver REPORT.md CC-5; recorrência do card `testability-1` do ciclo `auth-email-transicao`)

**Problema**
> A migration 0066 (papéis, pacotes, exceções, trilha) e a guarda de concorrência `AccessRepository.lockAndCheck` (R9 — nunca zero gestores) só foram validadas ao vivo, à mão, num Postgres 16 descartável (idempotência do DDL, guarda do Q3, reverse, 27/27 checagens de repositório, 10/10 corridas concorrentes). Nada disso roda em CI. O mesmo tipo de achado já foi registrado como P1 `testability-1` no ciclo anterior (`auth-email-transicao`, migration 0064 + guarda R11, 20/20 manual) e não foi implementado — esta é a recorrência.

**Melhoria Proposta**
> Reaproveitar o padrão que o próprio repositório já usa para `vw_metricas_ciclo` (tactic Sandbox + Recordable Test Cases): criar `src/backend/migrations/0066_auth_permissoes_modulo.integration.test.ts` (DDL do zero, reaplicação idempotente, guarda do Q3, reverse) e `src/backend/domain/repository/auth/AccessRepository.integration.test.ts` (duas transações reais concorrentes chamando `lockAndCheck`), ambos usando o Postgres do job `backend-sql`. Ampliar o glob do script `test:sql` para incluir `domain/repository/**/*.integration.test.ts`.

**Resultado Esperado**
> Testes `*.integration.test.ts` cobrindo `migrations/0066*` e a guarda R9: 0 → pelo menos 2 arquivos, rodando no job `backend-sql` do CI. Corridas concorrentes automatizadas provando "1 sucesso + 1 `LastUserManagerError`": 0 → pelo menos 1 caso determinístico.

**Métricas de sucesso**
- Testes de integração sob `domain/repository/auth/` e `migrations/0066*`: 0 → ≥ 2
- Job `backend-sql` do CI cobrindo auth: ausente → presente

**Risco de não fazer**
> Terceira recorrência do mesmo gap no próximo `/feature-tweak` de auth (passo 3, Supabase Auth) — a guarda R9 e a migration ficam sem rede automatizada até um incidente real de "zero gestores" ou DDL não-idempotente em produção.

**Dependências**: Nenhuma; reaproveita infraestrutura já existente (`backend-sql`).

---

### [availability-1] Distinguir "serviço indisponível" de "sem permissão" no frontend, com retry curto

**QA**: Availability
**Tactic alvo**: Ignore Faulty Behavior / Degradation
**Esforço**: M (2-5d)
**Findings**: F-availability-1

**Problema**
> `PermissoesProvider` trata qualquer falha de `GET /me/permissoes` (503, timeout, erro de rede) exatamente como "usuário sem nenhuma permissão" (`src/frontend/lib/auth/PermissoesProvider.tsx:70-87`), e as 7 páginas de topo do produto renderizam "Acesso negado" em tela cheia nesse caso, sem log e sem nova tentativa automática — só um reload manual recupera.

**Melhoria Proposta**
> Adicionar um terceiro estado ao `PermissoesContextValue` (`indisponivel: boolean`, distinto de `carregando`/permissões vazias); `ExigePermissao` renderiza uma tela de "não foi possível verificar suas permissões, tentando novamente..." em vez de `AcessoNegado` quando `indisponivel = true`. Acoplar um retry curto (1-2 tentativas com backoff, ex. 2s/5s) em `fetchMinhasPermissoes` antes de marcar como indisponível.

**Resultado Esperado**
> Uma falha transitória de `/me/permissoes` se resolve sozinha em segundos, sem o usuário ver "Acesso negado"; só uma falha sustentada mostra o estado de indisponibilidade, textualmente distinto de negação de permissão. Páginas que distinguem "indisponível" de "negado": 0/7 → 7/7.

**Métricas de sucesso**
- Páginas com estado "indisponível" distinto de "negado": 0/7 → 7/7
- Retries automáticos antes de marcar indisponível: 0 → ≥1

**Risco de não fazer**
> Qualquer degradação breve do Postgres gera a aparência de perda total de acesso para todo usuário logado, em toda tela, até um reload manual — risco de pânico e tickets de suporte durante um incidente que o backend já classificou corretamente como transitório.

**Dependências**: Nenhuma.

---

### [deployability-1] Blindar migrações `NOT NULL` contra a corrida entre o boot do Render e os crons do GitHub Actions

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: M (2-5d)
**Findings**: F-deployability-1

**Problema**
> A `0066` é a primeira das 66 migrations a fazer `ALTER COLUMN ... SET NOT NULL`, e os 6 crons do GitHub Actions rodam `npm run migrate` de forma independente do `autoDeploy` do Render (janela de até 15 min, cadência do `reaper-sispag`). Nesse intervalo, `POST /usuarios` do backend antigo falha com 500.

**Melhoria Proposta**
> Aplicar Script Deployment Commands de ponta a ponta: ou (a) os 6 workflows param de rodar `npm run migrate` por conta própria e passam a checar se a migração já foi aplicada pelo Render antes de prosseguir (poll em `schema_migrations` com timeout curto), ou (b) toda migration que adiciona `NOT NULL` sem `DEFAULT` ganha uma checklist de PR obrigatória (`PatternGuardian`) que force o autor a decidir explicitamente a estratégia de compat.

**Resultado Esperado**
> Janela de exposição documentada e testada, não apenas descrita em prosa na ADR. 15 min (hoje, teórico) → 0 min (sincronizado) ou continua ≤15 min mas com teste de regressão que force a decisão consciente na próxima migration `NOT NULL`.

**Métricas de sucesso**
- Migrations `NOT NULL` com decisão de compat documentada e testada: 1/1 (só ADR em prosa) → 1/1 com gate automatizado
- Workflows de cron cientes do estado do deploy: 0/6 → 6/6

**Risco de não fazer**
> A próxima migration `NOT NULL` (ex.: recorte por filial, passo 3 da auth) repete a mesma corrida sem ninguém lembrar de revisitar manualmente, e dessa vez pode atingir uma rota mais crítica que criação de usuário.

**Dependências**: Nenhuma.

---

### [integrability-2] Dar ao `kavex-report-ciclo` uma identidade de serviço gerenciável pelo próprio sistema de permissões

**QA**: Integrability
**Tactic alvo**: Manage Resource Coupling
**Esforço**: M (2-5d)
**Findings**: F-integrability-2

**Problema**
> O único consumidor externo de `/metricas/ciclo` depende da conta humana compartilhada `admin` continuar ativa com `metricas:ver`; a única proteção contra quebrá-lo é uma frase em `DEPLOY.md` (D11/Q6 da ADR-0053), sem guarda de código equivalente à de "último gestor" (D6).

**Melhoria Proposta**
> Criar um papel `Relatório` (ou usuário de serviço dedicado) com só `metricas:ver`, migrar `FINANCEIRO_API_USUARIO` para ele, e estender a guarda de `AccessRepository.lockAndCheck` (ou uma nova, mais barata) para recusar desativar/rebaixar a última conta ativa com uma permissão marcada como "usada por consumidor externo".

**Resultado Esperado**
> Desativar a conta `admin` no dia em que os papéis reais da Columbia chegarem deixa de depender de alguém lembrar de ler o `DEPLOY.md`. Guardas de código para identidades externas: 0 → 1.

**Métricas de sucesso**
- Contas de serviço com permissão dedicada (não herdada de "todo mundo é Administrador"): 0 → 1
- Guarda de código contra desativar a última conta com `metricas:ver`: ausente → presente, com teste de corrida

**Risco de não fazer**
> O report semanal para de atualizar no exato momento em que a feature de papéis reais é entregue — o timing de maior risco é também o de menor atenção.

**Dependências**: Nenhuma bloqueante; pode andar em paralelo à modelagem de papéis reais da Columbia.

---

### [fault-tolerance-1] Tornar atômica (ou compensada) a edição composta de acesso

**QA**: Fault Tolerance
**Tactic alvo**: Compensating Transaction
**Esforço**: M (2-5d)
**Findings**: F-fault-tolerance-1

**Problema**
> `EditarAcessoDialog` salva papel e exceções como duas chamadas HTTP sequenciais e independentes (`atribuirPapel` então `definirExcecoes`), cada uma com sua própria transação. Falha na 2ª depois da 1ª já ter comitado deixa o usuário-alvo com papel novo e exceções antigas, sem aviso de sucesso parcial; nenhum dos 8 testes do diálogo cobre esse caminho.

**Melhoria Proposta**
> Opção A (preferida): endpoint único `PUT /usuarios/:id/acesso { papelId?, excecoes? }` que chama `setRole` e `replaceExceptions` dentro da MESMA `withTransaction` (reaproveitando `lockAndCheck` uma única vez, simulando o estado final combinado antes de decidir o 409). Opção B (mínima): se o combinado não for viável neste ciclo, o diálogo deve, ao falhar a 2ª chamada após a 1ª ter sucesso, reverter explicitamente a 1ª antes de mostrar o erro.

**Resultado Esperado**
> Edição composta 0/1 atômica → 1/1 atômica (ou com compensação testada); testes do diálogo cobrindo o cenário combinado e a falha intercalada: 0/8 → ≥2/9.

**Métricas de sucesso**
- Edições compostas cobertas por transação única ou compensação testada: 0/1 → 1/1
- Testes do diálogo cobrindo papel+exceções no mesmo submit: 0/8 → ≥1

**Risco de não fazer**
> Em 6 meses, com mais papéis reais na Columbia, edições compostas ficam mais comuns; o estado intermediário some na rotina até um incidente de acesso indevido forçar a investigação da trilha.

**Dependências**: Nenhuma — pode ser feito como `/feature-tweak` isolado sobre `usuarios.ts` e `AccessRepository`.

---

## P2 — Médio

### [availability-4] Logar a falha de `/me/permissoes` no frontend

**QA**: Availability
**Tactic alvo**: Exception Detection
**Esforço**: S (≤1d)
**Findings**: F-availability-4

**Problema**
> `PermissoesProvider.tsx:70` engole qualquer erro de rede/parse com `.catch(() => { ... })`, sem nenhum log — ao contrário do backend, que sempre loga a mesma classe de falha via `LogService.error` com `requestId`.

**Melhoria Proposta**
> Trocar o catch silencioso por um `console.warn` (ou telemetria de frontend, se existir) com o erro e o `token` (sem vazar dado sensível), sem mudar o comportamento de fail-closed.

**Resultado Esperado**
> Uma falha sustentada de `/me/permissoes` deixa rastro no console do navegador, útil para suporte/triagem, sem mudar o comportamento visual atual. Catches silenciosos no caminho crítico: 1 → 0.

**Métricas de sucesso**
- Catches sem log em `PermissoesProvider.tsx`: 1 → 0

**Risco de não fazer**
> Baixo isoladamente; some ao déficit de visibilidade que agrava a detecção do cenário de F-availability-1/2/3.

**Dependências**: Nenhuma. Pode ser feito junto com `availability-1`.

---

### [deployability-2] Corrigir a tabela de decisão do runbook de rollback para o caso "coluna NOT NULL sem default"

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> `docs/runbooks/rollback.md` classifica toda "migration aditiva" como segura para reverter só o código, mas isso é falso quando a coluna nova é `NOT NULL` e consumida por um `INSERT` do código antigo — exatamente o caso de `0066`.

**Melhoria Proposta**
> Acrescentar uma 4ª linha à tabela de decisão: "migration aditiva com coluna `NOT NULL` sem `DEFAULT`" → "depende: reverter código é seguro só se nenhum caminho de escrita do código anterior grava a tabela afetada; confira `DEPLOY.md`/ADR da migration".

**Resultado Esperado**
> Runbook usado sob pressão deixa de ter uma afirmação genérica incorreta. 3 categorias na tabela de decisão → 4.

**Métricas de sucesso**
- Categorias de migration cobertas pela tabela de decisão do runbook: 3 → 4

**Risco de não fazer**
> A próxima migration `NOT NULL` que afete um caminho de escrita mais crítico (SISPAG, Permutas) é classificada erroneamente como "seguro reverter só o código".

**Dependências**: Nenhuma (documentação pura).

---

### [integrability-1] Gerar o catálogo de permissões do frontend a partir do backend (ou travar a paridade por teste)

**QA**: Integrability
**Tactic alvo**: Adhere to Standards
**Esforço**: S (≤1d)
**Findings**: F-integrability-1 (cross-ref: F-modifiability-1 — ver REPORT.md CC-2; tratar como a mesma entrega de `modifiability-1`)

**Problema**
> O catálogo de 9 permissões existe em 3 cópias manuais (`Permission.ts`, `lib/permissoes.ts`, snapshot hardcoded do teste FE) sem nenhum link verificável entre backend e frontend — só a paridade backend↔banco é testada.

**Melhoria Proposta**
> Caminho mais barato sem monorepo de tipos: publicar `PERMISSION_CATALOG` como JSON estático gerado no build do backend (ex.: `scripts/export-permission-catalog.ts` → `src/frontend/lib/permission-catalog.generated.json`) e o teste FE importar esse arquivo gerado em vez do array hardcoded. Alternativa mais leve: script de CI que compara as duas listas e falha o PR se divergirem.

**Resultado Esperado**
> Adicionar uma permissão no backend sem replicar no frontend passa a falhar um gate automatizado, em vez de só sumir silenciosamente da tela. Cópias manuais sem link: 3 → 1 fonte + 1 artefato derivado.

**Métricas de sucesso**
- Cópias manuais sem verificação automática: 3 → 0
- Teste de paridade cross-pacote: ausente → 1

**Risco de não fazer**
> Cada nova permissão carrega risco de "sumiço silencioso" de funcionalidade na UI, descoberto só em QA manual ou por usuário reportando.

**Dependências**: Nenhuma.

---

### [integrability-3] Auditar e listar explicitamente todo sítio que trata `sub` como nome de usuário antes do passo 3 (Supabase Auth)

**QA**: Integrability
**Tactic alvo**: Tailor Interface
**Esforço**: S (≤1d)
**Findings**: F-integrability-3

**Problema**
> ADR-0053 D3 afirma que o passo 3 muda "só a primeira metade do lookup" (`AccessRepository.findAccessBySub`), mas 32 sítios em `routes/*.ts` e o middleware `conexosIdentity.ts` (não tocados por esta feature) tratam `req.user.sub` como o nome de usuário Conexos ou como identificador legível de auditoria.

**Melhoria Proposta**
> Antes de iniciar o passo 3, gerar (via grep/script, não manualmente) a lista completa de sítios que consomem `req.user.sub` como string legível e decidir, por sítio, se ele precisa de um segundo campo (`req.user.username`/`displayName`, resolvido no mesmo lookup do `AccessService`). Registrar a lista em `ontology/_inbox/auth-supabase-migracao-gap.md` para o `/feature-new` do passo 3 herdar pronta.

**Resultado Esperado**
> O `/feature-new` do passo 3 começa com o raio de mudança real (33 arquivos) em vez do raio otimista (1 arquivo) hoje escrito na ADR-0053.

**Métricas de sucesso**
- Sítios que tratam `sub` como username, catalogados: 0 → 33
- Inbox do passo 3 com a lista pronta: ausente → presente

**Risco de não fazer**
> O passo 3 é subestimado no escopo, reabrindo (silenciosamente) a lacuna "sem vínculo, opera via robô" que a ADR-0051 fechou, desta vez para usuários que TÊM vínculo mas cujo `sub` deixou de casar.

**Dependências**: Nenhuma; é insumo para o `/feature-new` do passo 3, não bloqueia esta feature.

---

### [modifiability-3] Generalizar `usePodeExecutarPermutas` para os três módulos

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-modifiability-3

**Problema**
> A mesma expressão (`!carregando && tem(PERMISSAO.X_EXECUTAR)`) está duplicada 4 vezes entre Sispag (3x) e Recebimentos (1x), enquanto Permutas tem um hook dedicado (`usePodeExecutarPermutas`).

**Melhoria Proposta**
> Generalizar para `usePodeExecutar(permissao: Permissao): boolean` em `src/frontend/lib/auth/` e substituir as 4 ocorrências duplicadas e o próprio `usePodeExecutarPermutas`.

**Resultado Esperado**
> Duplicações da lógica de "pode executar": 4 → 0; 1 hook compartilhado reutilizado em 3 módulos.

**Métricas de sucesso**
- Ocorrências de `tem(PERMISSAO.*_EXECUTAR)` fora de um hook compartilhado: 4 → 0

**Risco de não fazer**
> Cada novo módulo (Frente IV) repete a cópia manual; uma mudança futura na regra de "pode executar" precisa de 4-5 edições em vez de 1.

**Dependências**: Nenhuma.

---

### [modifiability-4] Derivar a contagem por mount do teste de rotas a partir da própria tabela

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S (≤1d)
**Findings**: F-modifiability-4

**Problema**
> `routePermissions.test.ts` fixa `27/27/15/10/2/1/2/1` como números literais além de manter `TABELA` com 85 linhas — os dois precisam ser atualizados juntos a cada rota nova, e o número redundante não adiciona proteção que `TABELA.length` filtrado por mount não já dê.

**Melhoria Proposta**
> Substituir a asserção por uma comparação contra um `Record<string, number>` único e comentado, ou remover o teste (o segundo teste — "o conjunto de rotas montadas é EXATAMENTE o da tabela" — já cobre a integridade real).

**Resultado Esperado**
> Rota nova exige 1 edição (linha na `TABELA`) em vez de 2 (linha + número da contagem).

**Métricas de sucesso**
- Pontos de edição por rota nova no teste de cobertura: 2 → 1

**Risco de não fazer**
> Fricção recorrente e falso-negativo pedagógico (o teste falha por um número desatualizado antes de o desenvolvedor ver o teste que realmente importa).

**Dependências**: Nenhuma.

---

### [security-1] Auditar reset de senha e vínculo Conexos como o resto do acesso

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S (≤1d)
**Findings**: F-security-1 (cross-ref: F-fault-tolerance-2 — ver REPORT.md CC-3)

**Problema**
> `resetPassword` e `setVinculo` mutam a conta de um usuário — inclusive a identidade que assina baixas e permutas no ERP — sem gravar linha na trilha `app_user_access_event` nem log via `LogService`, ao contrário de papel/exceção/ativo, cobertos pela mesma ADR-0053.

**Melhoria Proposta**
> Acrescentar `ACCESS_EVENT_TYPE.SENHA` e `ACCESS_EVENT_TYPE.VINCULO` (migration de dados, sem quebrar o `CHECK` existente) e chamar `AccessRepository.recordEvent` a partir de `UserAdminService.resetPassword` e `UserAdminService.setVinculo`, com o `actorUsername` já disponível nas rotas.

**Resultado Esperado**
> Cobertura da trilha de mutação de conta sobe de 3/5 para 5/5 tipos de ação. Toda mudança de "quem pode agir como quem" no financeiro fica reconstruível por SQL.

**Métricas de sucesso**
- Tipos de mutação de conta cobertos pela trilha: 3/5 → 5/5
- Chamada de `recordEvent` presente em `resetPassword`/`setVinculo`: 0 → 2

**Risco de não fazer**
> Em um incidente de conta comprometida, a pergunta "quem trocou a senha/o vínculo Conexos de fulano, e quando" não tem resposta no banco — só em logs efêmeros do Render, se ainda existirem.

**Dependências**: Nenhuma.

---

### [security-2] Persistir e alarmar tentativas de acesso negado

**QA**: Security
**Tactic alvo**: Detect Intrusion
**Esforço**: M (2-5d)
**Findings**: F-security-2

**Problema**
> 401 (sessão encerrada) não gera nenhum log; 403 (sem permissão) gera só `console.warn`, sem `requestId`, sem `LogService`, sem contagem — ao contrário do caminho de erro do banco na mesma função, que já loga estruturado. Não há como detectar um padrão de tentativas repetidas antes de um incidente.

**Melhoria Proposta**
> Trocar o `console.warn` do 403 e acrescentar log no 401 (`LogService.warn`) em `src/backend/http/acesso.ts`, com `usuario`, `rota`, `requestId`. Acrescentar uma métrica agregada (contagem por usuário/IP numa janela) e um alarme quando o limiar for cruzado (Painel de Operação, ADR-0042).

**Resultado Esperado**
> 100% das negativas de autorização (401 e 403) viram log estruturado e persistido; um limiar configurável dispara alerta visível no Painel de Operação.

**Métricas de sucesso**
- Negativas de acesso persistidas: 0% → 100%
- Alarme por limiar de negativas repetidas: ausente → presente

**Risco de não fazer**
> Um ex-funcionário com token ainda válido (até 12h) ou uma credencial vazada pode sondar rotas financeiras sem deixar rastro acionável.

**Dependências**: Nenhuma; pode reusar a infraestrutura do Painel de Operação (ADR-0042).

---

### [security-3] Fechar o recorte por filial com dado do banco, como as permissões de módulo

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: L (1-2 sem)
**Findings**: F-security-3

**Problema**
> `filialAuthz` continua lendo um claim `filiais` que nenhum token emitido hoje carrega, então as 9 checagens de filial em Recebimentos são fail-open na prática — o mesmo padrão (autorização no token) que a ADR-0053 corrigiu para permissão de módulo continua ativo para filial.

**Melhoria Proposta**
> Estender o modelo de acesso (`app_user` → tabela `app_user_filial` ou coluna equivalente) e trocar `filiaisFromClaims`/`filialAuthz` para consultar o banco pelo mesmo `AccessService`/`AccessRepository`, em vez do claim do token — replicando o padrão I1 desta ADR.

**Resultado Esperado**
> As 9 chamadas de `assertUserCanActOnFilial` deixam de resolver `true` incondicionalmente; um usuário só age nas filiais que o banco autoriza para ele.

**Métricas de sucesso**
- Chamadas de `assertUserCanActOnFilial` resolvidas por dado do banco (não por claim): 0% → 100%

**Risco de não fazer**
> O "recorte real por frente" que a ADR-0053 entrega para módulo não existe para filial — um analista de uma filial segue podendo agir em processos de outra, silenciosamente.

**Dependências**: Nenhuma diretamente, mas compartilha desenho com o passo 3 do plano de auth (Supabase Auth) — vale desenhar os dois juntos.

---

### [testability-2] Trocar os fakes de transação por regex-sobre-SQL por um dublê que valida contrato, não texto

**QA**: Testability
**Tactic alvo**: Abstract Data Sources
**Esforço**: S (≤1d)
**Findings**: F-testability-2

**Problema**
> `AccessRepository.test.ts` e `UserRepository.test.ts` implementam a transação falsa despachando por `RegExp.test(sql)` sobre o texto cru da query. O teste está acoplado à redação exata do SQL, não ao contrato de entrada/saída; um refactor inócuo do SQL pode casar a branch errada da regex sem que nenhum teste avise.

**Melhoria Proposta**
> Trocar o dispatch por regex por um identificador estável por consulta (tag de comentário fixa que o fake casa por igualdade de string), ou extrair as constantes de SQL e fazer o fake comparar por referência/import da própria constante.

**Resultado Esperado**
> 0 fakes de transação que despacham por regex sobre o texto do SQL nos testes de `domain/repository/auth/`; contrato de ordem de chamadas continua coberto, agora por comparação estável.

**Métricas de sucesso**
- Arquivos de teste com dispatch por regex sobre SQL cru: 2 → 0

**Risco de não fazer**
> O próximo `/feature-tweak` que tocar `ACCESS_STATE_SELECT` herda um fake frágil que pode mascarar regressão na guarda R9.

**Dependências**: Nenhuma; pode ser feito junto do card `testability-1`.

---

### [testability-3] Confirmar rede de proteção da introspecção de rotas contra upgrade do Express

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S (≤1d)
**Findings**: F-testability-3

**Problema**
> `routePermissions.test.ts` lê `router.stack`/`layer.route.stack`/`layer.route.methods` — estrutura interna não documentada do Express 5. A própria ADR-0053 já registra o risco, mitigado pelo teste comportamental por linha (346 casos via HTTP real), mas não há nada fixando a versão do Express nem um teste de fumaça que avise antes de um upgrade maior.

**Melhoria Proposta**
> Adicionar um comentário/pin explícito da major do Express no `package.json` do backend referenciando este teste, e considerar extrair a introspecção (`introspectar`) para um helper único e testado isoladamente.

**Resultado Esperado**
> Upgrade de major do Express passa a exigir revisão explícita (CI ou changelog) antes de rodar.

**Métricas de sucesso**
- Pin/nota de risco no `package.json`/CI para majors do Express: ausente → presente

**Risco de não fazer**
> Baixo — o teste já falha alto e há rede comportamental secundária; o custo é só o tempo de diagnóstico na próxima falha em massa.

**Dependências**: Nenhuma.

---

### [deployability-3] Tornar a invariante "1 instância web" testável ou alertável, não só comentada

**QA**: Deployability
**Tactic alvo**: Surge Protection / Physical Grouping
**Esforço**: M (2-5d) para LISTEN/NOTIFY; S (≤1d) para o item de checklist
**Findings**: F-deployability-3 (cross-ref: F-security-4, F-modifiability-5 — ver REPORT.md CC-1)

**Problema**
> `AccessService` depende de haver exatamente uma instância do backend para que a invalidação de cache em memória (30s TTL) valha; hoje isso só existe como comentário no código (`AccessService.ts:30-31`), sem teste, `ConfigDoctor` ou alerta que dispare se alguém ligar `numInstances > 1` no Render.

**Melhoria Proposta**
> Adicionar uma checagem de boot que leia uma env exposta pelo Render (contagem, se disponível) ou, na ausência de sinal confiável, documentar explicitamente em `DEPLOY.md` como item de checklist de "antes de escalar horizontalmente". Alternativa mais forte: mover a invalidação para um canal compartilhado (`LISTEN/NOTIFY` do Postgres) antes de qualquer aumento de `numInstances`.

**Resultado Esperado**
> A dependência de instância única deixa de ser tribal knowledge em comentário e vira algo verificável. 0 alertas/testes hoje → ≥1 mecanismo antes de qualquer mudança de `numInstances`.

**Métricas de sucesso**
- Mecanismo de defesa da invariante "1 instância": 0 → 1

**Risco de não fazer**
> Se a Columbia crescer e alguém escalar o Render sem revisitar esta ADR, usuários desativados mantêm acesso por até 30s em instâncias que não receberam a invalidação — numa área financeira, essa é exatamente a lacuna que a ADR-0053 foi criada para fechar.

**Dependências**: Nenhuma para o checklist; avaliação de custo do Supavisor para `LISTEN/NOTIFY`.

---

### [deployability-4] Exercitar o reverse da 0066 (e dos demais rollbacks) em CI, contra Postgres real

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: M (2-5d)
**Findings**: F-deployability-4

**Problema**
> O `test:sql` do CI só roda `migrations/.*\.integration\.test\.ts`; os 4 scripts em `migrations/rollbacks/*.rollback.sql` (incluindo `0066`) nunca são executados automaticamente — só a existência e o nome do arquivo são verificados.

**Melhoria Proposta**
> Acrescentar ao job `backend-sql` do `ci.yml` um passo que, para cada par migration+reverse, aplique as migrations do zero, aplique o reverse do alvo e confirme que o schema resultante bate com o esperado.

**Resultado Esperado**
> Rollback deixa de ser "documentado e testado uma vez" para "testado a cada PR que toque `migrations/`". 0/4 reverses exercitados em CI → 4/4.

**Métricas de sucesso**
- Reverses cobertos por execução automatizada em CI: 0/4 → 4/4

**Risco de não fazer**
> Uma mudança futura não relacionada quebra silenciosamente o reverse de `0066`, e isso só é descoberto durante um incidente real, quebrando a promessa de "reverter em ≤5 min" do runbook.

**Dependências**: Nenhuma; reaproveita a infraestrutura já existente do job `backend-sql`.

---

### [performance-2] Reduzir o escopo do lock em `lockAndCheck` para não crescer O(usuários ativos)

**QA**: Performance
**Tactic alvo**: Schedule Resources
**Esforço**: M (2-5d)
**Findings**: F-performance-2

**Problema**
> Toda escrita de acesso (`setRole`, `replaceExceptions`, `deactivateGuarded`) trava, com `FOR UPDATE`, TODAS as linhas de `app_user` ativas antes de checar a invariante "existe pelo menos 1 gestor ativo". Hoje são 14 linhas (trivial); a própria ADR-0053 já registra que isso "vira ponto de contenção só se a base crescer muito", sem quantificar o limite.

**Melhoria Proposta**
> Restringir o lock ao subconjunto relevante para a invariante — travar só os usuários ativos que hoje têm `usuarios:gerenciar` efetivo. Alternativa mais simples: um advisory lock (`pg_advisory_xact_lock`) dedicado à escrita de acesso.

**Resultado Esperado**
> Escopo do lock por escrita: O(usuários ativos) (14 hoje) → O(gestores ativos) ou O(1) via advisory lock.

**Métricas de sucesso**
- Linhas travadas por escrita de acesso: 14 → número de gestores ativos (hoje, provavelmente ≤ 5)
- Corridas concorrentes de "último gestor": mantém 10/10 corretas

**Risco de não fazer**
> Se a Columbia expandir o número de usuários com acesso à plataforma, cada edição de papel/exceção/desativação fica proporcionalmente mais lenta sob concorrência.

**Dependências**: Nenhuma, mas deve rodar contra o mesmo Postgres descartável usado na validação ao vivo original para reconfirmar as 10/10 corridas.

---

## P3 — Baixo

### [modifiability-5] Externalizar `CACHE_TTL_MS` via `EnvironmentProvider`

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S (≤1d)
**Findings**: F-modifiability-5 (cross-ref: F-security-4, F-deployability-3 — ver REPORT.md CC-1)

**Problema**
> O TTL de 30s do cache de acesso (`AccessService.CACHE_TTL_MS`) é uma constante de código. O próprio ADR-0053 identifica que ele é o "pior caso" de propagação de uma revogação feita fora da tela, e que a decisão precisa ser revisitada se `numInstances` subir — hoje essa revisão exige código + deploy, não uma variável.

**Melhoria Proposta**
> Mover `CACHE_TTL_MS` para `EnvironmentProvider` (Inviolable Rule #8) com o valor atual (30000) como default, permitindo reduzir o TTL em produção sem deploy se `numInstances` subir antes de a invalidação distribuída ser implementada.

**Resultado Esperado**
> TTL de cache configurável por ambiente; mitigação de emergência (reduzir TTL) deixa de exigir deploy.

**Métricas de sucesso**
- TTL configurável sem deploy: não → sim

**Risco de não fazer**
> Baixo enquanto há 1 instância; se `numInstances` subir sem essa mudança, a mitigação de emergência exige o mesmo ciclo de deploy que o incidente que ela mitigaria.

**Dependências**: Nenhuma — mas some de relevância se/quando a invalidação distribuída for implementada primeiro.

---

### [performance-3] Paginar `GET /usuarios` (ou documentar a isenção) antes do padrão se espalhar

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S (≤1d) para documentar a isenção; M (2-5d) para paginação real
**Findings**: F-performance-3

**Problema**
> `UserRepository.listAll` e `AccessRepository.listAccessForUsers` fazem `SELECT` sem `LIMIT`, contrariando o `Dynamic WHERE Pattern` documentado no `CLAUDE.md`. Hoje inofensivo (15 linhas, crescimento ligado a headcount), mas é um precedente de código que outra feature pode copiar para uma tabela de alta cardinalidade.

**Melhoria Proposta**
> Adicionar paginação (`LIMIT`/`OFFSET`, com contrato de resposta incluindo total), OU registrar explicitamente em comentário/ADR por que esta tabela está isenta.

**Resultado Esperado**
> `GET /usuarios`: 2 consultas sem `LIMIT` → 2 consultas paginadas (página default 50) OU isenção documentada explicitamente.

**Métricas de sucesso**
- Linhas retornadas por `GET /usuarios` sem limite: ilimitado → paginado (50/página) OU isenção documentada com justificativa numérica

**Risco de não fazer**
> Baixo isoladamente; o risco é de precedente copiado para uma tabela que cresce com volume transacional, gerando um table-scan real em produção.

**Dependências**: Nenhuma.

---

### [fault-tolerance-3] Automatizar (ou testar) o export da trilha antes do rollback da 0066

**QA**: Fault Tolerance
**Tactic alvo**: Recovery (backward)
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3

**Problema**
> O reverse da 0066 derruba `app_user_access_event` sem confirmação; o `\copy` que preserva a trilha é só um comentário no script, não executado nem testado.

**Melhoria Proposta**
> Adicionar ao próprio `.rollback.sql` um passo que falha alto se a tabela tiver linhas e nenhuma flag de "já exportei" for passada, ou mover o `\copy` para um script wrapper que sempre exporta antes de aplicar.

**Resultado Esperado**
> Passo de export deixa de depender de o operador lembrar do comentário: 0 automatizado → 1 automatizado ou obrigatório.

**Métricas de sucesso**
- Export da trilha antes do rollback: manual/comentado → automatizado ou bloqueante

**Risco de não fazer**
> Perda silenciosa da trilha de auditoria num rollback feito sob pressão de incidente — baixo (cenário raro), mas o custo de corrigir agora é de horas.

**Dependências**: Nenhuma.

---

### [testability-4] Teste por propriedade para `EffectivePermissionCalculator` (e adicionar `fast-check` como dependência direta)

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S (≤1d)
**Findings**: F-testability-4

**Problema**
> A álgebra `efetivas = fecho(pacote ∪ concedidas) − revogadas` (fecho `executar → ver`, revogar vence conceder) só tem cobertura por exemplo (100% de linhas, 0 propriedades). `fast-check` não é dependência direta do backend nem do frontend — só aparece transitivamente no lockfile.

**Melhoria Proposta**
> Adicionar `fast-check` como `devDependency` de `src/backend/package.json`, e escrever propriedades para `EffectivePermissionCalculator.calcular`: (1) revogar uma permissão nunca aumenta o conjunto efetivo; (2) o fecho é idempotente; (3) toda permissão `X:executar` no resultado implica `X:ver`; (4) pacote vazio + exceções vazias → conjunto vazio.

**Resultado Esperado**
> `fast-check`: dependência transitiva → devDependency direta; propriedades testadas: 0 → ≥ 4.

**Métricas de sucesso**
- Propriedades (`fc.assert`) em `EffectivePermissionCalculator.test.ts`: 0 → ≥ 4

**Risco de não fazer**
> Baixo no curto prazo; risco cresce quando papéis reais da Columbia (múltiplos pacotes) entrarem em produção e o espaço combinatório deixar de ser trivial de enumerar à mão.

**Dependências**: Nenhuma.

---

### [testability-5] Subir o piso de cobertura de `./lib/auth/` no frontend para acompanhar o código novo

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-5

**Problema**
> O `coverageThreshold` do frontend fixa `./lib/auth/` em 24% de linhas, mas o código novo desta feature (`PermissoesProvider.tsx`, `permissoes.ts`) já entrega 100%. O piso não pega regressão real nesse diretório — já era o follow-up P2 `testability-3` do ciclo anterior, ainda não implementado.

**Melhoria Proposta**
> Recalibrar `coverageThreshold['./lib/auth/']` no `jest.config.js` do frontend para perto do valor medido hoje (ratchet, não meta aspiracional).

**Resultado Esperado**
> Piso de `./lib/auth/`: 24% linhas → ≥ 70% linhas (valor medido nesta feature, arredondado para baixo).

**Métricas de sucesso**
- `coverageThreshold['./lib/auth/'].lines`: 24 → ≥ 70

**Risco de não fazer**
> Uma regressão de cobertura em `AuthProvider.tsx`/`PermissoesProvider.tsx` passa despercebida pelo CI até virar bug em produção.

**Dependências**: Nenhuma; card equivalente já registrado como `testability-3` no follow-up de `auth-email-transicao` — considerar fundir os dois ao invés de duplicar.

---

### [security-4] Revisitar a invalidação de cache de acesso antes de escalar para mais de uma instância

**QA**: Security
**Tactic alvo**: Revoke Access
**Esforço**: M (2-5d)
**Findings**: F-security-4 (cross-ref: F-deployability-3, F-modifiability-5 — ver REPORT.md CC-1)

**Problema**
> `AccessService` guarda o acesso resolvido em memória de processo; a invalidação síncrona pós-escrita só alcança a instância que recebeu a escrita. A ADR-0053 documenta que, com `numInstances > 1`, o pior caso de uma desativação pela tela deixa de ser "imediato" e passa a ser "até 30s" nas outras instâncias, sem alarme para acusar a mudança de comportamento.

**Melhoria Proposta**
> Antes de qualquer mudança em `render.yaml` que suba `numInstances`, substituir a invalidação in-process por um mecanismo distribuído (`LISTEN/NOTIFY` do Postgres) e adicionar um teste que falhe caso `numInstances` mude sem essa revisão.

**Resultado Esperado**
> A garantia "acesso revogado pela tela é efetivo imediatamente" deixa de depender do número de instâncias, ou o time decide conscientemente aceitar até 30s em todas elas.

**Métricas de sucesso**
- Teste/gate que acusa `numInstances > 1` sem invalidação distribuída: ausente → presente

**Risco de não fazer**
> Se alguém escalar o Render por motivo de disponibilidade (não relacionado a segurança), a garantia de revogação em 30s regride silenciosamente para "até 30s por instância", sem que ninguém tenha decidido isso conscientemente.

**Dependências**: Nenhuma até o dia em que `numInstances` subir; cross-ref com Availability/Deployability.
