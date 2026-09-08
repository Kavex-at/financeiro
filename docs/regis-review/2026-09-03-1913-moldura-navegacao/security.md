---
qa: Security
qa_slug: security
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-security
generated_at: 2026-09-03T19:13:00-03:00
scope: frontend
score: 8
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

> **Escopo do run.** Delta `moldura-navegacao` (commit `05606a6`), frontend only. Sete arquivos
> tocados: `components/AppShell.tsx`, `components/nav/app-nav.tsx`,
> `components/ui/{sidebar,nav-item,bottom-nav}.tsx`, `components/auth/RouteGate.tsx`,
> `app/login/page.tsx`. `--quick` (sem `npm audit`). Não há `infra/` neste repositório
> (`CLAUDE.md` §Estado Atual vs. Alvo) — tudo que dependeria de IAM/SSM/Terraform está declarado
> como não medível abaixo, e não como ausente.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Atacante externo com um link forjado (phishing) | Enviar `https://financeiro.columbia/login?returnTo=<url-controlada>` a um analista da Columbia | Página `/login` (`app/login/page.tsx`) — moldura de navegação hospeda o fluxo | Produção, usuário legítimo com credenciais válidas | Após login bem-sucedido, o app deve **navegar apenas para caminhos internos**; qualquer `returnTo` que aponte para outra origem deve ser descartado (fallback `/`) | 0 redirects para host externo mesmo com `returnTo` malformado; 100% dos `returnTo` aceitos são paths relativos que começam com `/` e não `//` |

Contexto secundário — insider oportunista com acesso ao DOM do navegador do analista (extensão
maliciosa, XSS numa página irmã) tenta ler o JWT que autoriza escritas em `/sispag`, `/permutas`
(remessa, baixa, permuta). A moldura consome o token via `useIsAdmin`/`useIsAuthenticated`, mas
não é a origem do armazenamento — é herança do fluxo de auth pré-existente
(`lib/auth/token.ts:20` guarda em `localStorage`).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded nos 7 arquivos do delta | 0 | 0 | ✅ | `grep -rEn "(password\|secret\|token\|api[_-]?key\|credential)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}"` sobre os 7 arquivos |
| Uso de `dangerouslySetInnerHTML`/`innerHTML`/`eval` no delta | 0 | 0 | ✅ | `grep -n` sobre os 7 arquivos |
| Sinks de open-redirect não validados (`router.replace(<query-string>)`) | 1 | 0 | ❌ | `app/login/page.tsx:25` (`returnTo = searchParams?.get('returnTo') \|\| '/'`) → `:34,44` (`router.replace(returnTo)`) |
| Validadores de path relativo em `returnTo` | 0 | 1 (regex `/^\/(?!\/)/`) | ❌ | `grep -n "returnTo" src/frontend/app/login/page.tsx` |
| Rotas públicas em `RouteGate.PUBLIC_ROUTES` | 2 (`/login`, `/docs`) | 2 (não ampliar sem revisão) | ✅ | `components/auth/RouteGate.tsx:11` — inalterado no delta |
| Rota indefinida (`pathname === null`) cai no gate autenticado? | sim (fail-closed) | sim | ✅ | `components/auth/RouteGate.tsx:20` (`usePathname() ?? ''` → nenhum match em `PUBLIC_ROUTES`) |
| Backend enforcement dos 3 gates que a moldura só esconde | 3/3 confirmados | 3/3 | ✅ | `src/backend/index.ts:121` (`sispagGate`), `routes/usuarios.ts:27` (`router.use(requireRole('admin'))`), `http/operacaoAcesso.ts:39` (`requireOperacaoAcesso` → 404) |
| Dados sensíveis persistidos por `sidebar.tsx` em `localStorage` | 0 (grava apenas `'true'`/`'false'` em `ds:sidebar:collapsed:v1`) | 0 | ✅ | `components/ui/sidebar.tsx:104` |
| Vazamento de token/username/valor no DOM da moldura | 0 | 0 | ✅ | Leitura direta de `AppShell.tsx`, `app-nav.tsx`, `sidebar.tsx`, `bottom-nav.tsx`, `nav-item.tsx` |
| JWT lido do `localStorage` (existente, tocado indiretamente pelo delta via `useIsAdmin`) | sim | cookie `HttpOnly; Secure; SameSite=Strict` | ⚠️ | `lib/auth/token.ts:9,20` (fora do delta, herdado) |
| Verificação de assinatura do JWT no cliente antes de usar o claim `role` | não (só backend) | não (defesa em profundidade — o server sempre re-verifica; `requireRole` no Express) | ✅ | `lib/auth/token.ts:59-70` — comentário explícito |
| CSRF token nas mutações do frontend | ausente | não aplicável enquanto o token viver em `Authorization: Bearer` (não em cookie) | N/A | `lib/auth/token.ts:26-35` (`withAuthHeaders`) — Bearer, não cookie |

Métricas explicitamente **não medíveis** neste run:

> ⚠️ **Não medível — `npm audit`**: flag `--quick` ativa suprime a coleta. Ver o run
> completo para o inventário de CVEs de dependências do frontend.
> ⚠️ **Não medível — IAM/SSM/CloudTrail/GuardDuty/CORS por tenant**: não existe `infra/` neste
> repositório (deploy via Render hook; ver `CLAUDE.md` §Estado Atual vs. Alvo). Recomendação:
> repetir o QA quando o scaffold Terraform for criado (`/feature-new infra "…"`).
> ⚠️ **Não medível — CSP (`Content-Security-Policy`)** em resposta HTTP: exigiria capturar o
> cabeçalho servido pela Vercel/Render. Registrado no cross-QA para o Deployability revisar em
> conjunto.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Nenhum sinal do frontend chega a WAF/IDS; a moldura não emite log de tentativa suspeita | ❌ ausente | Nada em `src/frontend/` toca telemetria de segurança |
| Detect Service Denial | Fora do escopo do frontend | N/A | — |
| Verify Message Integrity | Backend valida assinatura do JWT em toda request (`requireRole` só passa após o middleware de auth); frontend não re-verifica (correto — evita falso senso de segurança) | ✅ presente | `lib/auth/token.ts:59-70` (comentário deliberado), `src/backend/http/auth.ts:requireRole` |
| Detect Message Delay | N/A neste QA para o frontend | N/A | — |
| Identify Actors | Login com usuário/senha (`app/login/page.tsx`), token com claim `sub`/`email` (`http/operacaoAcesso.ts:34`) | ✅ presente | Fluxo funcional |
| Authenticate Actors | `POST /auth/login` autentica; `RouteGate` bloqueia rota não pública sem token | ✅ presente | `RouteGate.tsx:20` (fail-closed para pathname indefinido), `AuthProvider.tsx:signIn` |
| Authorize Actors | Server-side em três dimensões, confirmado neste run: `sispagGate` (feature flag), `requireRole('admin')` (papel), `requireOperacaoAcesso()` (allow-list por identidade, 404). Frontend **esconde**, backend **decide** | ✅ presente | `src/backend/index.ts:121`, `routes/usuarios.ts:27`, `http/operacaoAcesso.ts:29-46`, `routes/sispag.ts` (12 `requireRole('admin')`) |
| Limit Access | Sidebar/BottomNav respeitam allow-list de Operação (`fetchPermissoes()`) e claim de admin — ergonomia; gate real no backend (verificado) | ✅ presente (ergonômico) | `components/nav/app-nav.tsx:119-137` (fail-fechado se `fetchPermissoes` rejeita) |
| Limit Exposure | `RouteGate` protege por padrão (allow-list de 2 rotas públicas: `/login`, `/docs`); rota indefinida cai no protegido | ✅ presente | `RouteGate.tsx:11,20` — mudança do delta preservou fail-closed |
| Encrypt Data | HTTPS assumido (Vercel/Render); JWT no `localStorage` (não HttpOnly) — exposto a XSS | ⚠️ parcial | `lib/auth/token.ts:20` (fora do delta) |
| Separate Entities | Frontend/backend separados por HTTP; um monólito Express hoje; SaaSo por-tenant está no alvo, não no atual | ⚠️ parcial | `CLAUDE.md` §Estado Atual vs. Alvo |
| Change Default Settings | `NEXT_PUBLIC_DEV_AUTH_BYPASS` falha-crash no build não local (`assertAuthEnv()`); default do SISPAG é OFF em build deployado (`lib/features.ts:12-16`) | ✅ presente | `lib/auth/env.ts`, `lib/features.ts:15` |
| Validate Input | **Falha no `returnTo` do login** — string arbitrária de query-string alimenta `router.replace()` sem checar se é path relativo | ❌ ausente (no ponto tocado pelo delta) | `app/login/page.tsx:25,34,44` |
| Revoke Access | `signOut()` limpa `localStorage`; `notifySessionExpired` também descarta o token na hora do 401 | ✅ presente | `AuthProvider.tsx:signOut`, `notifySessionExpired` |
| Lock Computer | Fora do escopo | N/A | — |
| Inform Actors | Modal de sessão expirada com `sessionExpiredAt` real (do `exp` do JWT) informa o usuário; `ConexosStatusBanner` na moldura avisa quando o vínculo Conexos caiu | ✅ presente | `AuthProvider.tsx:notifySessionExpired`, `AppShell.tsx:280` |
| Restore | Fora do escopo do frontend | N/A | — |
| Audit Trail | Frontend não gera trilha de segurança (login/logout/tentativa); backend guarda `audit_log` em outras frentes — não neste delta | ⚠️ parcial | Nenhum log de segurança em `app/login/page.tsx` ou `AuthProvider.tsx:signIn` |

## 4. Findings (achados)

### F-security-1: Open redirect em `/login?returnTo=…` — sem validação de path relativo

- **Severidade**: P1 (alto — vetor de phishing plausível num sistema que movimenta dinheiro; o fix é ≤ 5 linhas)
- **Tactic violada**: Validate Input
- **Localização**: `src/frontend/app/login/page.tsx:25,34,44`
- **Evidência (objetiva)**:
  ```
  25:  const returnTo = searchParams?.get('returnTo') || '/'
  34:      router.replace(returnTo)
  44:      router.replace(returnTo)
  ```
  `router.replace()` do `next/navigation` aceita URL absoluta e faz navegação plena — `router.replace('https://evil-columbia.com/login')` redireciona para outra origem. Protocol-relative (`//evil.com`) também é resolvido pelo navegador como cross-origin. Nenhum validador entre o `searchParams.get` e o `replace`.
- **Impacto técnico**: um link forjado `https://financeiro.columbia/login?returnTo=https://evil-columbia.com/login` autentica o usuário no domínio legítimo (o formulário funciona) e, no `router.replace(returnTo)` do `useEffect` (linha 34) ou do `handleSubmit` (linha 44), sai para o host do atacante — que serve uma tela idêntica de "sessão expirou, entre de novo" e captura o par usuário/senha na segunda tentativa. O token JWT permanece no `localStorage` do domínio original (não é vazado diretamente), mas a credencial reutilizável foi entregue.
- **Impacto de negócio**: credencial de analista `admin` reutilizável em qualquer horário é o que assina remessa (`/sispag/lotes/:id/remessa`), finaliza lote SISPAG (`/sispag/lotes/:id/finalizar`) e casa permuta N:M (`/permutas/...`). O `requireRole('admin')` do backend não distingue analista autêntico de invasor com a mesma credencial — porque a credencial é válida. Um phishing bem-sucedido em uma das 12 contas admin da plataforma (`docs/impacto/h1-permutas-achados.md` §6) equivale à movimentação financeira sem consentimento.
- **Métrica de baseline**: 1 sink (`router.replace(returnTo)` em 2 pontos, mesmo `returnTo`) · 0 validadores de path relativo · 100% dos valores possíveis de query-string aceitos.

### F-security-2: JWT no `localStorage` (exposto a XSS de qualquer página irmã)

- **Severidade**: P2 (débito defensável — herdado, não introduzido pelo delta; a moldura amplifica a superfície ao envolver todas as rotas autenticadas)
- **Tactic violada**: Encrypt Data / Limit Exposure
- **Localização**: `src/frontend/lib/auth/token.ts:9,20`; consumido por `components/nav/app-nav.tsx:141` via `useIsAdmin()`
- **Evidência (objetiva)**:
  ```
  token.ts:9   export const TOKEN_STORAGE_KEY = 'auth_token'
  token.ts:20  return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined
  ```
- **Impacto técnico**: qualquer XSS em qualquer página envolvida pelo `AppShell` (todo o app autenticado) executa `localStorage.getItem('auth_token')` e exfiltra o Bearer. O delta não introduz XSS (`grep` de `dangerouslySetInnerHTML`/`innerHTML` = 0 nos 7 arquivos), mas passa a ser a moldura pela qual toda página protegida trafega. Cookie `HttpOnly` mitigaria — Bearer em header não permite.
- **Impacto de negócio**: mesmo do F-security-1, sem necessitar phishing — basta uma injection numa das telas do domínio.
- **Métrica de baseline**: 1 chave (`auth_token`) em `localStorage`; alternativa (`HttpOnly` cookie) exigiria migração de `withAuthHeaders` + `POST /auth/login` para setar cookie.

### F-security-3: Frontend não emite trilha de auditoria de eventos de segurança

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/frontend/app/login/page.tsx`, `src/frontend/lib/auth/AuthProvider.tsx:signIn`, `signOut`, `notifySessionExpired`
- **Evidência (objetiva)**: nenhum `console.log`, POST para endpoint de audit, nem métrica de "tentativa de login" no fluxo do delta. Falha de login lança `Error` para o formulário; sucesso apenas guarda token.
- **Impacto técnico**: um analista que reclama "eu não fiz esse login às 3h" não tem como o time reconstruir se foi o próprio dispositivo, outro navegador ou um atacante com a credencial roubada. Combinação com F-security-1 e F-security-2 é crítica: se um phishing der certo, não há registro de qual sessão iniciou a remessa fraudulenta.
- **Impacto de negócio**: sem trilha de `login-success`/`login-failure`/`session-expired`/`sign-out` correlacionada com as ações financeiras subsequentes, forense pós-incidente vira dedução por horário de tabela.
- **Métrica de baseline**: 0 eventos de auth reportados a backend/telemetria.

### F-security-4: `PUBLIC_ROUTES` inclui `/docs` — verificar que nada sensível cai lá

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/frontend/components/auth/RouteGate.tsx:11`
- **Evidência (objetiva)**:
  ```
  const PUBLIC_ROUTES = ['/login', '/docs']
  ```
  A lista não foi ampliada neste delta (verificado). `/docs/arquitetura` é a única rota abaixo de `/docs` construída hoje (ver rotas prerenderizadas em `_shared-metrics.md`).
- **Impacto técnico**: qualquer rota nova sob `/docs/*` nasce pública. Se um dia alguém colocar diagnóstico interno ali (métricas Prometheus estilizadas, dump de tenants, tela de "backoffice em rascunho"), fica exposto sem senha.
- **Impacto de negócio**: hoje, nenhum — `/docs/arquitetura` é doc de arquitetura, publicado por design. É finding de higiene: quem revisa PR precisa saber que `/docs/*` é lista de exceção.
- **Métrica de baseline**: 1 rota renderizada em produção sob `/docs/*` (`/docs/arquitetura`), sem PII ou credencial visível.

## 5. Cards Kanban

### [security-1] Validar `returnTo` do login como path relativo antes de `router.replace`

- **Problema**
  > `/login?returnTo=<query>` alimenta `router.replace(returnTo)` sem checar o formato. Uma URL absoluta ou protocol-relative (`https://evil-columbia.com`, `//evil.com`) é aceita e o navegador sai para outra origem depois do login bem-sucedido. Vetor de phishing direto para credencial `admin` — cenário do F-security-1.

- **Melhoria Proposta**
  > Introduzir um sanitizador `safeReturnTo(raw: string | null): string` em `src/frontend/lib/nav/returnTo.ts` que aceita apenas strings que começam com `/`, não começam com `//`, não contêm `\\` (bypass do Node URL parser em alguns navegadores) e não incluem `://`. Fallback para `/` em qualquer outro caso. Consumir esse helper em `app/login/page.tsx:25` e em qualquer futuro `router.replace(returnTo)` — cobrir com teste de tabela (`'/permutas'` → aceito; `'https://evil'` → `/`; `'//evil'` → `/`; `'/\\evil'` → `/`; `''` → `/`; `null` → `/`). Tactic alvo: **Validate Input**.

- **Resultado Esperado**
  > 100% das strings possíveis de `returnTo` que resolveriam para outra origem são reduzidas a `/`. Validador coberto por teste dedicado no `jest`. Métrica: sinks de open-redirect não validados no frontend: **1 → 0**.

- **Tactic alvo**: Validate Input
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Sinks de open-redirect sem validação: 1 → 0
  - Testes cobrindo o sanitizer: 0 → ≥ 6 casos (aceitos + rejeitados)
  - `returnTo` cross-origin resulta em navegação para outra origem: sim → não
- **Risco de não fazer**: um phishing dirigido a um dos 12 usuários admin da plataforma captura credencial reutilizável para assinar remessa e finalizar lote SISPAG. O `requireRole('admin')` do backend não distingue credencial legítima de credencial roubada.
- **Dependências**: nenhuma.

### [security-2] Migrar JWT de `localStorage` para cookie `HttpOnly; Secure; SameSite=Strict`

- **Problema**
  > `auth_token` mora em `localStorage` (`lib/auth/token.ts:20`) e é lido a cada montagem via `getAccessToken()`. Qualquer XSS em qualquer página do app envolvida pela nova moldura `AppShell` exfiltra o Bearer com uma linha de JavaScript. A moldura não introduz XSS, mas passou a ser o padrão pelo qual toda tela autenticada é renderizada — aumenta a superfície coberta por um único vetor de exfiltração.

- **Melhoria Proposta**
  > `POST /auth/login` no backend passa a devolver `Set-Cookie: auth=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/`. O `withAuthHeaders` para de anexar `Authorization: Bearer` (cookie é enviado pelo navegador). `getAccessToken` deixa de existir; o cliente descobre "está logado?" via `GET /me` (`credentials: 'include'`) em vez de espiar o token. Tactic alvo: **Encrypt Data / Limit Exposure**. Impacta backend (CORS `Access-Control-Allow-Credentials: true`), `AuthProvider`, `apiFetch`. Mudança grande de propósito — é o único jeito de tirar o token do alcance do JS da página.

- **Resultado Esperado**
  > `document.cookie` não expõe o token (flag `HttpOnly`). XSS em qualquer página do app deixa de ser vetor direto de roubo de sessão. Métrica: chaves de `localStorage` contendo credencial: 1 → 0.

- **Tactic alvo**: Encrypt Data / Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — toca backend, frontend, CORS)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Chaves de `localStorage` com credencial: 1 → 0
  - Token acessível via `document.cookie` do JS da página: sim → não
- **Risco de não fazer**: um XSS em qualquer futura tela do sistema — inclusive uma tabela SISPAG que renderize um campo livre do Conexos sem escapar — vira exfiltração de sessão admin sem log, sem alarme e sem trilha.
- **Dependências**: alinhar com backend (formato do `Set-Cookie`, `CORS`), decidir se `signOut` chama `POST /auth/logout` para invalidar server-side.

### [security-3] Emitir trilha de auditoria dos eventos de auth do frontend

- **Problema**
  > O fluxo de login/logout/sessão expirada não deixa registro em lugar nenhum. Um analista que questiona "eu não fiz essa remessa" não tem como o time correlacionar qual sessão iniciou aquela ação — nem se houve login suspeito na noite anterior. Combinado com o F-security-1 e o F-security-2, forense pós-incidente vira dedução por horário.

- **Melhoria Proposta**
  > Adicionar `POST /audit/security-event` (backend novo, ver Fault Tolerance para o esquema de tabela) e emitir dele nos quatro eventos do frontend: `login-success`, `login-failure` (sem senha, só usuário + motivo), `sign-out`, `session-expired`. Payload mínimo: `{ event, username, userAgent, at }`. Chamada `void`, `keepalive: true` (usa Beacon-like fetch). Tactic alvo: **Audit Trail**.

- **Resultado Esperado**
  > Eventos de auth do frontend aparecem na trilha ao lado das ações financeiras (remessa, baixa, permuta), permitindo correlacionar "quem entrou às 03h" com "quem finalizou o lote às 03h05". Métrica: eventos de auth reportados por dia útil: 0 → ≥ 3 por usuário ativo (login + logout + eventual expiração).

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — precisa da tabela `audit_log` server-side aceitar novos tipos)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Eventos de auth persistidos: 0 → ≥ 4 tipos (login-success, login-failure, sign-out, session-expired)
  - Cobertura por usuário ativo em amostra semanal: 0% → 100%
- **Risco de não fazer**: incidente sem chance de reconstrução — o cenário "credencial roubada por phishing operou às 3h" fica indistinguível de "o analista fez o pagamento e esqueceu".
- **Dependências**: Fault Tolerance (formato do `audit_log`), definição de retenção com o time da Columbia.

## 6. Notas do agente

- **Achados positivos que ficam sem card** (não é regressão, é reforço): (a) `RouteGate` continua fail-closed para `pathname === null` — o `?? ''` do delta preserva o padrão. (b) `PUBLIC_ROUTES` não foi ampliada. (c) `writeStoredCollapsed` grava só `'true'`/`'false'` — a moldura não polui `localStorage` com dado sensível. (d) A afirmação do delta de que as três "permissões" da sidebar são só ergonomia foi **verificada no backend**: `sispagGate` no `index.ts:121`, `router.use(requireRole('admin'))` em `routes/usuarios.ts:27`, `requireOperacaoAcesso` retornando 404 em `http/operacaoAcesso.ts:39`.
- **Cross-QA**: F-security-3 (audit) reforça achados de **Fault Tolerance** — a trilha `audit_log` já existe para outras frentes, é reuso, não estreia. F-security-2 (JWT em `localStorage`) toca **Deployability** (Set-Cookie exige coordenação de CORS/domínio Vercel↔Render). F-security-1 (open redirect) é puramente **Validate Input** — sem overlap.
- **Não medível neste run**: `npm audit` (`--quick`), CSP no header HTTP servido, e tudo que é IAM/SSM/CloudTrail/GuardDuty (não há `infra/`).
- **Score 8/10**: um P1 real introduzido por 1 linha do delta (`returnTo` sem validação), dois P2 herdados que ficam mais visíveis com a moldura, e o restante bem: sem segredo hardcoded, sem `dangerouslySetInnerHTML`, sem `localStorage` sensível, gates de backend confirmados.
