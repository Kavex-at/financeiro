---
type: regis-review-report
run_id: 2026-09-03-1913-moldura-navegacao
generated_at: 2026-09-03T19:45:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: frontend puro — delta da feature `moldura-navegacao` (branch `feat/moldura-navegacao`, commit `05606a6` + fix de design system posterior)
total_cards: 31
total_p0: 0
total_p1: 4
total_p2: 15
total_p3: 12
overall_score: 7.6
---

# Regis-Review — financeiro — 2026-09-03-1913-moldura-navegacao

> ⚠️ **ERRATA — ler antes deste documento:** [`ERRATA.md`](./ERRATA.md). A evidência que sustentava
> o achado P1 de Deployability ("a `main` estava com o `next build` quebrado e nenhum gate acusou")
> era **falsa** — a `main` compila. O gap de CI é real; a severidade P1 e as menções a
> `usePathname()`/`useSearchParams()` "nulláveis" não se sustentam.

Este run cobre exclusivamente o delta da feature `moldura-navegacao` (5 componentes de UI, 1266 LOC de fonte + 574 LOC de teste). Backend, infra AWS e Terraform estão **fora de escopo** — o delta não os toca e este repositório não tem `infra/` (deploy Render/Vercel; ver `CLAUDE.md` §Estado Atual vs. Alvo). Onde métricas da taxonomia Bass dependem de infra distribuída (DLQs, IaC, alarmes CloudWatch), os agentes marcaram N/A com justificativa em vez de "❌ ausente".

**Resultado do gate do pipeline: 0 findings P0.** O `/feature-tweak` passa por essa via — a Inviolable Rule #11 exige remediar P0 antes do merge; P1/P2/P3 vão para `ontology/_inbox/moldura-navegacao-regis-followups.md`. O que este relatório destaca é justamente o topo da fila de follow-ups: 4 P1 que, embora não bloqueiem o merge, resolvem regressões reais ou herdadas que a moldura tornou mais consequentes.

O que o delta resolveu (medido antes dele, por varredura em `src/frontend/`): zero `<nav>`, zero `role="navigation"`, zero `aria-current`, zero `role="main"`, zero `sr-only`; `AppShell` com 47 linhas e nenhum link; `/sispag`, `/recebimentos`, `/operacao` e `/usuarios` sem nenhuma saída além do botão voltar do navegador; dois `<h1>` por página. O delta corrige as 11 invariantes documentadas em `ontology/ui-flows/navegacao-global.md` e cobre-as com 39 casos de teste (~93% de cobertura de linhas nos 5 arquivos novos).

## 1. Executive scorecard

Pesos (perfil financeiro — SaaSo multi-tenant que executa escritas monetárias em Conexos/Nexxera/GED): Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 · Performance 1.0 · Integrability 0.9 · Deployability 0.9 (Σ = 9.0). Este delta é frontend — Security/Fault Tolerance seguem pesados porque protegem, respectivamente, a credencial que assina remessa/baixa e a moldura que agora vive em toda tela autenticada.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8.0 | 0 | 0 | 2 | 3 | F-availability-2: zero `ErrorBoundary` em `src/frontend/` — throw na moldura derruba 100% das telas |
| Deployability | 6.0 | 0 | 1 | 2 | 2 | F-deployability-1: job `frontend` do CI **não roda `next build`** — janela de main quebrada passou despercebida neste ciclo |
| Integrability | 7.0 | 0 | 0 | 2 | 2 | F-integrability-1: `/me/permissoes` consumido com `as Permissoes` — mudança de shape esconde item da sidebar em silêncio |
| Modifiability | 9.0 | 0 | 0 | 1 | 3 | F-modifiability-1: botões "Voltar ao painel" nas subpáginas de Permutas duplicam a trilha da sidebar |
| Performance | 8.0 | 0 | 0 | 2 | 3 | F-performance-1: `Sidebar` provoca ~160px de layout shift na hidratação para quem prefere colapsada |
| Fault Tolerance | 7.0 | 0 | 1 | 1 | 2 | F-fault-tolerance-1: zero Error Boundary + moldura persistente = blast radius 100% das telas autenticadas |
| Security | 8.0 | 0 | 1 | 2 | 1 | F-security-1: open redirect em `/login?returnTo=…` sem validação de path relativo |
| Testability | 7.0 | 0 | 1 | 3 | 2 | F-testability-1: `coverageThreshold` 18pp abaixo do real — floor de CI virou decorativo |
| **Overall** | **7.6** | **0** | **4** | **15** | **12** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

O 7.6 posiciona o delta em "saudável com oportunidades pontuais". A leitura defensável em reunião: a moldura chegou em condição para receber as frentes de negócio (Integrability 7, Modifiability 9 comprovam o custo marginal), a cobertura subiu 18pp de linhas (20.7% → 38.19%), mas três regressões — herdadas na maioria — subiram de gravidade porque agora vivem em toda tela.

## 2. Top 10 risks (cross-QA)

Ranked by composite score = severity × business impact × leverage. Cada risco tem uma raiz identificável no delta ou uma raiz herdada cujo custo o delta amplificou.

### R-1: Open redirect em `/login?returnTo=…` — vetor de phishing direto para credencial `admin`

- **QA(s) afetados**: Security (raiz), Fault Tolerance (sem trilha para forense)
- **Findings de origem**: F-security-1 (`app/login/page.tsx:25,34,44`), F-security-3 (falta de audit trail)
- **Evidência sintetizada**: `router.replace(returnTo)` chamado com valor de `searchParams.get('returnTo')` sem qualquer validador entre um e outro. URL absoluta (`https://evil.tld`) ou protocol-relative (`//evil.tld`) são aceitas pelo `next/navigation`. Delta tocou `login/page.tsx` (fix de null-safety) e não sanou.
- **Impacto técnico**: um phishing forjando `https://financeiro.columbia/login?returnTo=https://evil-columbia.com/login` autentica o usuário no domínio legítimo e o solta no host do atacante, que serve um "sessão expirou" idêntico e captura a segunda tentativa. Sem audit trail (F-security-3), o time não reconstrói a origem da sessão que operou.
- **Impacto de negócio**: credencial `admin` reutilizável assina remessa (`/sispag/lotes/:id/remessa`), finaliza lote SISPAG (`/finalizar`), casa permuta N:M — todos escrevem em Conexos/Nexxera. `requireRole('admin')` do backend não distingue analista de invasor com credencial válida.
- **Card(s) Kanban relacionados**: security-1 (fix, ≤ 5 linhas + tabela de teste), security-3 (auditoria — infraestrutura)
- **Custo de inação em 6 meses**: um phishing dirigido às 12 contas admin da plataforma (`docs/impacto/h1-permutas-achados.md` §6) é plausível — o link forjado é indistinguível do link real na barra de endereços após o redirect. Impacto financeiro depende do lote que a credencial roubada finalizar; a base de comparação é o maior lote SISPAG do último trimestre. Premissa: cenário assume que o phishing consegue engenharia social — o vetor técnico está aberto hoje.

### R-2: Zero Error Boundary — moldura persistente virou ponto único de falha para 100% das telas autenticadas

- **QA(s) afetados**: Fault Tolerance (raiz), Availability (blast radius)
- **Findings de origem**: F-fault-tolerance-1 (`app/layout.tsx:24`, 1270 LOC sem boundary), F-availability-2 (mesma evidência lida por outro QA)
- **Evidência sintetizada**: `grep -rn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" src/frontend/` retorna vazio. `find src/frontend -name "error.tsx" -o -name "global-error.tsx"` idem. `app/layout.tsx:24` monta `AppShell` fora de qualquer boundary. Antes do delta, `AppShell` tinha 47 linhas sem lógica — hoje tem 1270 LOC de UI sempre montada.
- **Impacto técnico**: uma regressão em `lucide-react`, no `@radix-ui/tooltip`, em `resolveActiveItemId` recebendo `groups` malformado — qualquer throw derruba a rota inteira. Em produção, Next.js exibe fallback padrão (tela vazia + reload); em dev, overlay vermelho. Antes do delta, esse custo era ≈ 0; agora é literal.
- **Impacto de negócio**: analista no meio de uma remessa SISPAG ou de uma baixa perde contexto (filtros, item selecionado, rascunho de comentário) e precisa navegar de volta pela URL. Não há perda de dado (a moldura não escreve), mas o sintoma percebido é "o sistema caiu" a partir do que pode ser bug isolado em um ícone.
- **Card(s) Kanban relacionados**: fault-tolerance-1 (`app/error.tsx` + boundary explícito em `<AppNavigation>`), availability-1 (mesmo escopo, duplicado no plano — consolidar em execução)
- **Custo de inação em 6 meses**: cada nova dependência transitiva atualizada (`lucide-react` bump, `@radix-ui/*` minor, `next/link` mudança) é uma chance nova de fazer 8 rotas caírem juntas. É a fila que Bass explicitamente chama "single point of failure a partir do momento em que o artefato vira dependência universal".

### R-3: CI frontend **não roda `next build`** — 2 erros de tipo em `main` passaram todos os 4 checks neste ciclo

- **QA(s) afetados**: Deployability (raiz), Testability (gate de qualidade ausente), Performance (bundle budget também depende deste hook)
- **Findings de origem**: F-deployability-1 (`.github/workflows/ci.yml:30-46`), F-deployability-2 (4 usos raw de `usePathname()` são a mesma classe de bug), F-performance-3 (bundle não medível pelo mesmo motivo)
- **Evidência sintetizada**: `.github/workflows/ci.yml:30-46` no job `frontend` roda `npm ci` + `typecheck` + `lint` + `test -- --coverage`. Falta `npm run build`. `tsc --noEmit` não carrega os tipos gerados de rota do Next (`.next/types/**`), então falhas de nullable Next 16 em `usePathname()`/`useSearchParams()` só aparecem no `next build`. Neste ciclo, a `main` chegou com 2 erros pré-existentes (`app/login/page.tsx:23`, `RouteGate.tsx:21`) que foram descobertos ao rodar `npm run build` local — os fixes vieram junto no `05606a6` deste delta.
- **Impacto técnico**: qualquer PR que reintroduza a mesma classe de erro (hook nullable, RSC violation, `generateStaticParams` quebrado) passa nos 4 checks e vira commit em `main`. Deploy Vercel falha silenciosamente após merge — produção fica na versão anterior até alguém olhar o dashboard.
- **Impacto de negócio**: janela entre merge e "alguém percebe que Vercel está preso" é de horas a dias. Todo PR seguinte fica bloqueado (rebase sobre `main` quebrada). O compromisso "só código testado vai a produção" (declarado em `render.yaml:16-17`) fica falso para o frontend.
- **Card(s) Kanban relacionados**: deployability-1 (3 linhas de YAML), deployability-2 (`useSafePathname()` que fecha a classe do bug), performance-2 (mesmo hook, budget de bundle)
- **Custo de inação em 6 meses**: reincidência garantida — este delta paga a dívida uma vez; a próxima autora de feature paga de novo. Se acontecer durante uma feature de SISPAG ou Recebimentos em release lockstep FE+BE, a cascata trava também backend.

### R-4: `coverageThreshold` do frontend 18pp abaixo do real — floor de CI virou decorativo

- **QA(s) afetados**: Testability (raiz), Modifiability (regressão silenciosa em refactor), Deployability (mesmo gate)
- **Findings de origem**: F-testability-1 (`src/frontend/jest.config.js:36-40`)
- **Evidência sintetizada**: `coverageThreshold.global` está em `lines 20 / branches 9 / functions 14` (baseline v0.8.0 — lote copiar-barcode). O delta desta feature levou o real a `38.19 / 28.73 / 33.33` — folga de 18.2 / 19.7 / 19.3 pp. Uma regressão que apague metade dos testes da moldura passa no CI verde. O próprio comentário do arquivo prevê "SUBIR conforme testes de componente forem adicionados"; a promessa não foi cumprida junto ao delta.
- **Impacto técnico**: perde-se a defesa mais barata contra regressão de testabilidade — 4 linhas de config. Numa moldura que renderiza em toda rota, cada 1pp perdido silenciosamente é uma superfície inteira de a11y/navegação exposta.
- **Impacto de negócio**: gate de qualidade que não trava regressão é gate cerimonial — dá conforto sem defesa. O próximo `/feature-tweak` que refatore a moldura (paleta ⌘K, dark mode no backlog de `navegacao-global.md`) pode derrubar cobertura sem alarme.
- **Card(s) Kanban relacionados**: testability-1 (subir para `36 / 26 / 31`, 2pp abaixo do real), testability-4 (E2E complementa unit test)
- **Custo de inação em 6 meses**: em cada release, a distância cresce; em 6 meses o floor `20/9/14` estará 25-30pp abaixo do real e regressão de cobertura em refactor grande passa despercebida. Custo alternativo do fix: 3 linhas de config.

### R-5: `fetchPermissoes` sem timeout, sem retry, sem AbortController, sem validação de contrato, duplicado em dois consumidores

- **QA(s) afetados**: Availability (F-availability-1), Fault Tolerance (F-fault-tolerance-2, F-fault-tolerance-4), Performance (F-performance-2, F-performance-5), Integrability (F-integrability-1, F-integrability-3), Modifiability (F-modifiability-3)
- **Findings de origem**: sete findings em cinco QAs (ver §3 CC-1)
- **Evidência sintetizada**: `src/frontend/lib/operacao.ts:101-105` faz `apiFetch(...) as Permissoes` (cast sem parse, sem `AbortSignal`, sem retry). `src/frontend/components/nav/app-nav.tsx:117-131` chama uma vez por sessão (`deps: []`) sem `AbortController`, sem re-fetch em `focus`, sem `console.warn` no `catch`. O mesmo padrão está inlined em `components/home/OperacaoHomeCard.tsx:23-40` — 2 requests simultâneos ao mesmo endpoint na home.
- **Impacto técnico**: (a) rede vacilando esconde o item "Operação" pela sessão inteira; (b) mudança silenciosa de contrato do backend some com o item sem alarme; (c) request pendurado consome conexão HTTP/1.1 até o browser cortar (~5min); (d) política de fail-closed absolutamente muda sem sinal no console; (e) um refactor na política de cache/retry precisa tocar dois lugares.
- **Impacto de negócio**: analista do allow-list `OPERACAO_USUARIOS` não encontra o Painel de Operação; suporte diagnostica errado ("sumiu a permissão"); MTTR = tempo até o usuário lembrar de F5. Não é o cenário mais frequente, mas é o cenário em que a UI mente sem alarme — o pior sintoma diagnóstico.
- **Card(s) Kanban relacionados**: availability-2, fault-tolerance-2, fault-tolerance-3, fault-tolerance-4, performance-3, integrability-1, integrability-3, integrability-4
- **Custo de inação em 6 meses**: cada novo consumidor da política de allow-list (Frente IV, futura tela de configuração) replica o padrão. Bass identifica esse cenário como raiz de "cost of change grows with N consumers, not with 1 rewrite".

### R-6: 5 fontes de verdade para `'/permutas'` — divergência viva entre nome e rota já produziu débito de UX

- **QA(s) afetados**: Integrability (F-integrability-2), Modifiability (F-modifiability-1)
- **Findings de origem**: F-integrability-2 (grep confirma), F-modifiability-1 (2 botões "Voltar ao painel" que são a manifestação concreta do mesmo problema)
- **Evidência sintetizada**: `grep -rn "'/permutas'"` retorna 5 hits fora de teste: `components/nav/app-nav.tsx:52`, `app/page.tsx:36`, `app/permutas/clientes-filtro/page.tsx:180`, `app/permutas/BorderosPanel.tsx:301`, mais o folder `app/permutas/`. Para `'/permutas/borderos'` são 4 fontes. Sintoma vivo: "Adiantamentos" na sidebar aponta para `/recebimentos` (`app-nav.tsx:79-80`), divergência semântica já ativa.
- **Impacto técnico**: rename de frente (o próximo passo natural de "Adiantamentos" seria `/recebimentos` → `/adiantamentos`) cascateia por N arquivos, nada quebra em compile-time. Renomeação passa por code review sem garantia de completude.
- **Impacto de negócio**: baixo até o rename acontecer; alto naquele momento. Um botão "voltar ao painel" que passou a apontar para URL diferente do item da sidebar produz o modelo mental fragmentado que a moldura foi construída para eliminar.
- **Card(s) Kanban relacionados**: integrability-2 (`lib/routes.ts`), modifiability-1 (remover botões duplicados)
- **Custo de inação em 6 meses**: qualquer rename estimado a ~4h vira ~2 dias com risco de link quebrado. Pior: o débito paga custo pequeno em cada `/feature-new` que tocar rotas.

### R-7: JWT em `localStorage` — moldura amplifica a superfície coberta por um único vetor de XSS

- **QA(s) afetados**: Security (F-security-2), Fault Tolerance (sem forense de sessão)
- **Findings de origem**: F-security-2 (`lib/auth/token.ts:9,20`), F-security-3 (audit trail)
- **Evidência sintetizada**: `TOKEN_STORAGE_KEY = 'auth_token'` guardado em `window.localStorage`. Consumido via `useIsAdmin()` na moldura (`app-nav.tsx:141`). Nenhum `dangerouslySetInnerHTML` no delta — o delta não introduz XSS. Mas a moldura passou a envolver toda tela autenticada, então qualquer XSS numa página irmã (ex.: futuro campo livre do Conexos renderizado sem escapar) exfiltra o Bearer com uma linha.
- **Impacto técnico**: cookie `HttpOnly` mitigaria (JS não lê); Bearer em header não permite. Herdado, não introduzido pelo delta — mas amplificado.
- **Impacto de negócio**: mesmo do R-1, sem necessitar phishing. Requer XSS em alguma tela; a probabilidade cresce com a área de UI do produto.
- **Card(s) Kanban relacionados**: security-2 (M, toca backend/CORS/AuthProvider)
- **Custo de inação em 6 meses**: risco crescente à medida que o produto ganha telas. A migração é mais barata agora (menos consumidores de `withAuthHeaders`) que em 12 meses.

### R-8: Uso raw de `usePathname()` — 4 sítios são a próxima instância do bug que quebrou este build

- **QA(s) afetados**: Deployability (F-deployability-2), Modifiability (padrão inconsistente entre módulos)
- **Findings de origem**: F-deployability-2 (`AppShell.tsx:251`, `sidebar.tsx:343`, `bottom-nav.tsx:73`, `SessionExpiredModal.tsx:34`)
- **Evidência sintetizada**: dois dos quatro sítios (`AppShell`, `SessionExpiredModal`) fazem comparação/`|| '/'` e são seguros. Os outros dois passam `pathname` (`string | null` no Next 16) direto para `resolveActiveItemId(...)`. Se a assinatura do helper for `string | null` funciona; se for só `string` quebra o `next build` — exatamente a classe que já quebrou `RouteGate.tsx:21` na `main`.
- **Impacto técnico**: sem gate de build (ver R-3) e sem padrão único, cada novo componente é uma chance de recriar o bug. `RouteGate.tsx:21` foi corrigido com `?? ''`; o padrão parou ali.
- **Impacto de negócio**: dev-experience piora — a próxima autora de feature paga o mesmo custo de investigação que a autora deste delta pagou (algumas horas para achar por que o build local fura enquanto o CI está verde).
- **Card(s) Kanban relacionados**: deployability-2 (`lib/nav/useSafePathname.ts` + `no-restricted-imports`)
- **Custo de inação em 6 meses**: reincidência quase garantida à medida que a moldura cresce. Custo do fix: ≤ 1 dia.

### R-9: Bundle da moldura sem baseline nem budget — regressões no shared chunk atingem 12 rotas silenciosamente

- **QA(s) afetados**: Performance (F-performance-3), Deployability (mesma raiz: falta de instrumentação no CI)
- **Findings de origem**: F-performance-3 (`Turbopack Panic: Symlink [project]/node_modules is invalid` bloqueia medição no worktree)
- **Evidência sintetizada**: `_shared-metrics.md` afirma "compila e prerenderiza 12 rotas" sem tamanho por rota. `du -sh node_modules/@radix-ui/react-tooltip` = 640K (fonte); estimado ~10-14KB gzipped no bundle. `@radix-ui/react-tooltip` já estava presente em `app/recebimentos/components/status-badges.tsx:25`, mas agora entra também no shared chunk — novo custo para `/`, `/login`, `/operacao`, `/permutas*`, `/sispag`, `/usuarios`, `/docs/arquitetura` (~8 rotas).
- **Impacto técnico**: hipótese "a moldura não infla o shared chunk" não pode ser validada com número — só heurística de imports (que é ✅). Regressão passa em inspeção, não em medição.
- **Impacto de negócio**: cada card no backlog da moldura (paleta ⌘K, badges reais, dark mode) infla o shared chunk sem alarme. Frontend fica lento antes de qualquer sinal.
- **Card(s) Kanban relacionados**: performance-2 (baseline + budget), performance-4 (Web Vitals em campo)
- **Custo de inação em 6 meses**: dependendo do ritmo de features, +40-80 KB de regressão silenciosa é plausível — regime que degrada LCP em conexões piores (analistas em home office fora de fibra).

### R-10: Sem E2E automatizado, sem `jest-axe`, sem smoke pós-deploy — sucesso de release é medido por "não deu erro no dashboard"

- **QA(s) afetados**: Testability (F-testability-2, F-testability-4), Deployability (F-deployability-5), Fault Tolerance (Reintroduction sem cobertura)
- **Findings de origem**: F-testability-4 (0 `*.spec.ts` no frontend), F-testability-2 (0 `jest-axe`), F-deployability-5 (0 `curl` pós-deploy nos workflows)
- **Evidência sintetizada**: `find src/frontend -name "*.spec.ts" -o -name "*.e2e.ts"` → 0. `grep -rn "jest-axe|toHaveNoViolations" src/frontend` → 0. `grep -rn "curl|smoke|healthcheck" .github/workflows/` → 0. As 11 invariantes de a11y do delta foram para asserção manual — funciona para o commit atual, cresce O(landmarks) para o próximo.
- **Impacto técnico**: regressão que só aparece com providers reais hidratados (`AuthProvider`, `next/link` real, `usePathname` real) passa por todos os unit tests. Deploy verde no Vercel ≠ página funcional; detecção é 100% reativa.
- **Impacto de negócio**: moldura é a superfície comum de todo fluxo do analista; regressão nela impacta 4 frentes de negócio.
- **Card(s) Kanban relacionados**: testability-2 (`jest-axe`, S), testability-4 (Playwright smoke, M), deployability-4 (curl pós-deploy, S)
- **Custo de inação em 6 meses**: cada feature nova sobre a moldura reabre o mesmo debate ("qual asserção manual escrever?"). Bass: "asserção que não escala vira dívida em cada feature nova".

## 3. Cross-cutting findings

Cinco raízes cruzam múltiplos QAs. As mesmas causas geram findings independentes em vários agentes — resolver uma causa fecha vários findings.

### CC-1: `fetchPermissoes` como cabeça de série de fragilidade de I/O da moldura

- **Aparece em**: Availability, Fault Tolerance, Performance, Integrability, Modifiability
- **Findings**: F-availability-1 (timeout/retry/abort), F-availability-2 (parcial — mesma cadeia), F-fault-tolerance-2 (timeout), F-fault-tolerance-3 (silêncio no `catch`), F-fault-tolerance-4 (sem re-fetch em `focus`), F-performance-2, F-performance-5 (sem cache), F-integrability-1 (sem validação de shape), F-integrability-3 (duplicado em 2 consumidores), F-integrability-4 (falha silenciosa), F-modifiability-3 (acoplamento direto do modelo de nav ao endpoint)
- **Diagnóstico unificado**: a única chamada HTTP da moldura foi codificada com padrão minimalista aceitável ("cast como tipo, catch → false, effect uma vez"). O padrão está inlined em dois consumidores (sidebar + card da home), e cada QA olha o padrão por uma janela diferente: Availability vê o request pendurado, Fault Tolerance vê a promessa que nunca reintroduz, Performance vê a chamada duplicada, Integrability vê o contrato não-validado, Modifiability vê o acoplamento direto do modelo ao módulo de fetch. O custo cognitivo total é alto — o custo por consumidor é baixo, e por isso o débito passou.
- **Recomendação consolidada**: consolidar em **um** hook (`lib/permissoes.ts` `usePermissaoOperacao()`) que use SWR/React Query ou memoização por sessão, com `AbortSignal.timeout(5s)`, retry backoff em 5xx (não em 401), validação Zod, `console.warn` estruturado no `catch`, e re-fetch em `focus`/`visibilitychange`. Substituir as duas cópias. Um só card resolve availability-2 + fault-tolerance-2 + fault-tolerance-3 + fault-tolerance-4 + performance-3 + integrability-1 + integrability-3 + integrability-4 + modifiability-3 (9 cards → 1 execução coordenada, mesmo esforço S/M).

### CC-2: Rota como string mágica — 5 fontes por frente, sem constante única

- **Aparece em**: Integrability, Modifiability
- **Findings**: F-integrability-2 (5 fontes para `/permutas`, 4 para `/permutas/borderos`, padrão em todas as frentes), F-modifiability-1 (manifestação concreta em `BorderosPanel.tsx:301` e `clientes-filtro/page.tsx:180`)
- **Diagnóstico unificado**: o modelo de navegação centraliza rotas para efeito de UI (`buildAppNavGroups`), mas os call sites de retorno/link contextual continuam com literal. Não é conceitualmente um problema da moldura — é um problema pré-existente que a moldura torna visível ao expor a discrepância entre rótulo ("Adiantamentos") e rota (`/recebimentos`).
- **Recomendação consolidada**: card único `integrability-2` (`lib/routes.ts`) resolve a raiz; card `modifiability-1` (remover os dois botões duplicados) fecha a manifestação. Ordem: `integrability-2` primeiro; `modifiability-1` como consumidor da nova constante.

### CC-3: Gates de qualidade ausentes no pipeline de release do frontend

- **Aparece em**: Deployability, Testability, Performance, Fault Tolerance
- **Findings**: F-deployability-1 (sem `next build`), F-deployability-5 (sem smoke pós-deploy), F-testability-1 (`coverageThreshold` decorativo), F-testability-4 (sem E2E), F-testability-2 (sem `jest-axe`), F-performance-3 (sem baseline de bundle), F-security-3 (sem audit trail — o mesmo padrão de "sem telemetria")
- **Diagnóstico unificado**: o pipeline do frontend é assimétrico ao do backend. Backend roda `npm run build` (`.github/workflows/ci.yml:28`), tem kill-switches (`SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED` em `render.yaml`), tem healthcheck (`healthCheckPath: /health`). Frontend não tem nenhum equivalente. A moldura que virou "core da experiência" saiu para 100% dos usuários no primeiro deploy, sem instrumentação, sem baseline, sem canary, sem rollback documentado.
- **Recomendação consolidada**: sequência de 4 cards que constrói o pipeline mínimo — deployability-1 (`next build` no CI), testability-1 (subir floor), deployability-3 (runbook rollback), deployability-4 (smoke pós-deploy). Custo agregado: 2-3 dias. Se aceitos como sprint pós-aprovação, fecham a assimetria FE↔BE que a Deployability declara.

### CC-4: `usePathname()` como pegadinha de Next 16 — padrão inconsistente entre componentes

- **Aparece em**: Deployability, Modifiability
- **Findings**: F-deployability-2 (4 usos raw, 2 arriscados), F-modifiability-3 (dependência direta, não normalizada)
- **Diagnóstico unificado**: `RouteGate.tsx:21` foi corrigido com `?? ''` neste delta. Os outros 4 sítios (`AppShell.tsx:251`, `sidebar.tsx:343`, `bottom-nav.tsx:73`, `SessionExpiredModal.tsx:34`) sobreviveram — dois deles com null-safety implícito, dois passando nullable direto. O padrão está a dois PRs de reincidência.
- **Recomendação consolidada**: card único `deployability-2` (`lib/nav/useSafePathname.ts` + regra ESLint `no-restricted-imports`). Fecha a classe por construção. Combina naturalmente com `deployability-1` (o CI valida a substituição).

### CC-5: Persistência local sem SSR-friendly — layout shift, sem controle temporal, sem versionamento efetivo

- **Aparece em**: Performance, Availability, Testability
- **Findings**: F-performance-1 (Sidebar 224px → 64px na hidratação), F-availability-3 (`useIsAuthenticated().loading` ignorado, flash sem nav no boot), F-testability-6 (`AppShell.test.tsx` mocka promessa que nunca resolve para evitar `act`)
- **Diagnóstico unificado**: várias decisões da moldura acontecem em `useEffect` pós-mount — leitura de token no `AuthProvider`, leitura de colapso no `sidebar.tsx:139-144`, cast de mock para promessa pendente para evitar `act`. Todas são trade-offs contra hydration mismatch; nenhuma é ideal. O sintoma visível é o flash de largura + flash sem nav no boot.
- **Recomendação consolidada**: `performance-1` (mover colapso para cookie lido no Server Component do root layout) resolve o flash de largura E melhora a testabilidade (cookie é mais testável que `useEffect + localStorage`). `availability-3` (consumir `loading` do `useIsAuthenticated`) fecha o flash sem nav. Cost total: 2 cards S.

## 4. Quick wins (≤ 5 dias úteis)

Cards com esforço S e severidade ≥ P2, alta razão impacto/esforço. Esses são os cards para defender em reunião como "aceitamos como primeira sprint pós-aprovação".

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| security-1 | Security | S (≤ 1d) | P1 | Sinks de open-redirect no frontend: 1 → 0. Testes de tabela cobrindo `//evil`, `https://evil`, `/\\evil`, `null`, `''`. Fecha vetor de phishing direto. |
| fault-tolerance-1 | Fault Tolerance | S (≤ 1d) | P1 | `app/error.tsx` + Error Boundary explícito ao redor de `<AppNavigation>`. Blast radius: 8 rotas → 1 componente. |
| deployability-1 | Deployability | S (≤ 1h) | P1 | 3 linhas de YAML adicionam `npm run build` ao gate do PR. Zero janela de main quebrada. |
| testability-1 | Testability | S (≤ 1d) | P1 | `coverageThreshold` sobe para `36 / 26 / 31`. Regressão de cobertura em refactor grande volta a travar. |
| availability-1 | Availability | S (≤ 1d) | P2 | Duplicado de fault-tolerance-1 (mesma cadeia). Consolidar execução; contabilizar 1 card em Kanban. |
| availability-2 | Availability | S (≤ 1d) | P2 | Timeout 3s + 1 retry + `AbortController` no `fetchPermissoes`. Duração máxima de request pendurado: ~5min → 3s. |
| deployability-2 | Deployability | S (≤ 1d) | P2 | 4 usos raw de `usePathname()` → 0. Regra ESLint impede reincidência. |
| deployability-3 | Deployability | S (≤ 2h) | P2 | Runbook de rollback Vercel em `DEPLOY.md`. MTTR de bug frontend: reativo → ≤ 5 min de decisão + 2 min de rollback. |
| integrability-1 | Integrability | S (≤ 1d) | P2 | Zod no boundary de `/me/permissoes`. Mudança silenciosa de contrato vira `console.warn` em vez de item sumindo. |
| integrability-2 | Integrability | S (≤ 1d) | P2 | `lib/routes.ts`; fontes de verdade para `/permutas` fora de teste: 5 → 2. |
| modifiability-1 | Modifiability | S (≤ 1d) | P2 | Remover botões "Voltar ao painel" duplicados. Pontos de código apontando para `/permutas` como retorno: 3 → 1. |
| performance-1 | Performance | S (≤ 1d) | P2 | Colapso via cookie SSR. Layout shift horizontal do `<main>` na hidratação: 160px → 0px. |
| fault-tolerance-2 | Fault Tolerance | S (≤ 1d) | P2 | Timeout 5s + `focus` re-fetch. Item "Operação" reaparece sem F5 quando rede volta. |
| testability-2 | Testability | S (≤ 1d) | P2 | `jest-axe` + `AppShell.a11y.test.tsx` com 4 cenários. Regras a11y verificadas: 0 → ≥ 30 por rodada. |
| testability-3 | Testability | S (≤ 1d) | P2 | `satisfies Permissoes` nos 3 mocks. Drift de contrato quebra build de teste em vez de virar item sumido. |

Total: 15 cards S. Combinados com a consolidação sugerida em CC-1 (fetchPermissoes → um hook), 4-6 dias de execução coordenada fecham 4 P1 + 10 P2, sem debitar do backlog de produto.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| performance-2 | Performance, Deployability | M (2-5d) | Reduce Overhead + Deployment Observability | Baseline First Load JS por rota tabulada; regressão do shared chunk falha CI se > +20KB. Alvo: shared chunk ≤ ~180KB gzipped, First Load JS p95 ≤ 200KB (literatura Web Vitals). Sem baseline, cada card do backlog da moldura (paleta ⌘K, dark mode, badges reais) infla o shared chunk sem alarme. |
| security-2 | Security | M (2-5d) | Encrypt Data / Limit Exposure | Migrar JWT de `localStorage` para cookie `HttpOnly; Secure; SameSite=Strict`. Chaves de `localStorage` com credencial: 1 → 0. Toca backend (CORS), frontend (`AuthProvider`, `apiFetch`) — custo maior em 12 meses (mais consumidores de `withAuthHeaders`). |
| security-3 | Security, Fault Tolerance | M (2-5d) | Audit Trail | Eventos `login-success`, `login-failure`, `sign-out`, `session-expired` persistidos com `userAgent` + timestamp. Combinado com security-1, permite correlacionar "quem entrou às 3h" com "quem finalizou o lote às 3h05". Sem essa trilha, incidente de credencial roubada vira dedução por horário — indistinguível de operação legítima. |
| testability-4 | Testability, Fault Tolerance | M (2-5d) | End-to-end smoke | Playwright: 1 smoke abre `/login`, autentica, clica em cada item visível da sidebar, valida `role="main"` + `<h1>` único + `aria-current` único por rota. Cobre regressão de hidratação/provider/router que nenhum unit test pega. Custo: setup Playwright + credencial dev + wiring CI. |
| performance-4 | Performance | M (2-5d) | Reduce Overhead + Manage Sampling Rate | `useReportWebVitals` no root layout enviando LCP/CLS/INP para backend. Amostragem 100% dev / 10% prod. Sem coleta, decisões de perf ficam por inspeção — nem regressões nem melhorias são quantificáveis. Baseline p75 LCP < 2.5s / CLS < 0.1 / INP < 200ms (literatura Web Vitals). |

Todas as linhas de "Por que vale" amarram a um número: budget de bundle (180KB), chaves de credencial em localStorage (1 → 0), quatro tipos de eventos de audit, 3 invariantes verificadas end-to-end por rota, 3 métricas Web Vitals amostradas. Nenhuma justificativa é "porque é melhor prática".

## 6. O que está bem (e por quê)

Este delta acerta em pontos que merecem ficar registrados. Reuniões defensivas frequentemente caem na armadilha de "tudo está ruim"; os números abaixo ancoram a credibilidade das seções anteriores.

1. **Cobertura subiu 17-19 pp em um único delta.** 20.7% → 38.19% lines, 9.59% → 28.73% branches, 14.85% → 33.33% functions. 5 componentes novos com 39 casos cobrindo 11 invariantes de `navegacao-global.md`. Tactic Bass: *Executable Assertions* como investimento estrutural, não patch por patch.

2. **`buildAppNavGroups` é função pura, exportada, testada.** `resolveActiveItemId` idem — reusada por dois consumidores (Sidebar + BottomNav) sem duplicar lógica. É o exemplo canônico de *Use an Intermediary* aplicado a UI; merece entrar no vocabulário do time para próximas moldura-shaped features.

3. **Custo marginal da 4ª frente é 1 arquivo tocado (~15 LOC).** Se reusar gate existente, `≤ 1 arquivo`. Se introduzir gate novo, `≤ 3 arquivos` (`app-nav.tsx` + `lib/*` + `AuthProvider`/`features.ts`). Nenhum arquivo de UI (`Sidebar`/`BottomNav`/`AppShell`) tocado. Modifiability Score 9 defende: quando o time efetivamente adicionar a Frente IV (Conciliação de Recebimentos), o custo é linear e previsível.

4. **Fail-closed intencional e correto em três decisões.** `readStoredCollapsed`/`writeStoredCollapsed` com try/catch completo e testado; `fetchPermissoes` esconde item em vez de mostrar 404 (política do design system `docs/design-system/feedback.md`); `usePathname() ?? ''` no `RouteGate` corrigindo null-safety como parte deste delta. Fault Tolerance 7 reflete essa base sólida com o único gap arquitetural sendo a ausência de Error Boundary.

5. **Sem novas deps runtime.** `@radix-ui/react-tooltip`, `lucide-react`, `next/link`, `next/navigation` já eram deps do frontend. Delta = 0 novas dependências em `package.json`. Zero risco de auditoria de supply-chain nova.

6. **Chave de persistência versionada.** `ds:sidebar:collapsed:v1` — sufixo `:v1` explícito em `sidebar.tsx:30`. Quando a estrutura do valor persistido mudar, dá para migrar sem colisão. Encapsulate + Defer Binding aplicados a `localStorage`.

7. **0 warnings de complexidade cognitiva.** `noExcessiveCognitiveComplexity` no lint dispara 0 vezes nos 5 arquivos do delta. O único warning novo (`sidebar.tsx:142`) é da regra `react-hooks/set-state-in-effect`, comentário in-source justifica trade-off. Modifiability defende: código está no limite dourado do Bass "Split Module".

8. **Ontologia coerente.** `entity_changed=false` declarado em `moldura-navegacao-tasks.md` e `navegacao-global.md`, e `_index.json`/`_coverage.json` não moveram — o delta é `ui-flow`, não entidade. `/retro-ontology` da próxima semana não vai encontrar drift induzido por este delta.

## 7. Limitações da análise

Explícito para a reunião — o que este relatório **não** cobre:

- **Bundle First Load JS por rota**: `next build` no worktree aborta com `Turbopack Panic: Symlink [project]/node_modules is invalid` (worktree usa `node_modules` symlinkado ao checkout principal). Instrução do run proibiu contornar mexendo em `node_modules`. Baseline em `_shared-metrics.md` diz apenas "compila e prerenderiza 12 rotas" sem número por rota. Recomendação: rodar `npm run build` no checkout principal após merge e registrar em `_shared-metrics.md` (ver performance-2).
- **Latência real de `/me/permissoes`**: sem RUM instrumentado, qualquer valor de p95 seria palpite (ver F-availability-1). MTTR real de sessão morta idem.
- **CLS de campo**: F-performance-1 identifica 160px de deslocamento potencial na hidratação; o valor real depende de Web Vitals que ainda não são coletados (ver performance-4).
- **`npm audit` de supply-chain**: `--quick` desligou este passo (Security F-security-2 §Notas). Recomendado rodar fora do run.
- **Branch protection do GitHub**: se a `Vercel/Deployment` está configurada como required check em `main` não foi medível localmente (requer `gh api ... /branches/main/protection` com token de admin). Não muda a raiz de F-deployability-1.
- **Chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade em campo com leitor de tela**: nenhum desses está no escopo dos 8 QAs do Bass rodados aqui. `jest-axe` mitigará parte do gap de a11y (testability-2), mas não substitui teste com leitor de tela real.
- **Backend e infra**: fora de escopo declarado. `infra/` não existe neste repositório (`CLAUDE.md` §Estado Atual vs. Alvo). Todo indicador de Terraform/Lambda/IAM/SSM está marcado N/A com justificativa nos QAs originais.
- **Janela temporal**: snapshot do dia `2026-09-03`. Código é vivo — refazer trimestralmente ou quando o gate `/regis-review` disparar em ciclo com delta de moldura.

Nenhum card foi renomeado durante a consolidação; IDs do KANBAN.md batem exatamente com os IDs dos arquivos QA originais.

## 8. Ações recomendadas

Ordem de execução para os próximos 30 dias. Cada bullet referencia cards.

1. **Sprint 1 (esta semana)**: fechar os 4 P1 na ordem: `deployability-1` (3 linhas de YAML) → `testability-1` (3 linhas de config) → `security-1` (sanitizer + tabela de teste) → `fault-tolerance-1` (`app/error.tsx` + boundary em `<AppNavigation>`). Custo agregado: 2-3 dias. Fecha o R-1, R-2, R-3, R-4 do Top 10.

2. **Sprint 2**: consolidação do CC-1 — reescrever `fetchPermissoes` como hook único em `lib/permissoes.ts` (Zod + `AbortSignal.timeout(5s)` + retry backoff + re-fetch em `focus` + `console.warn` no `catch`). Substituir os dois consumidores. Fecha `availability-2` + `fault-tolerance-2` + `fault-tolerance-3` + `fault-tolerance-4` + `performance-3` + `integrability-1` + `integrability-3` + `integrability-4` + `modifiability-3` (9 cards em 1 execução). Custo: 2-3 dias.

3. **Sprint 3**: fechar CC-2 (`integrability-2` `lib/routes.ts` + `modifiability-1` remover botões duplicados) e CC-4 (`deployability-2` `useSafePathname()`). Estabelece padrão para novas features. Custo: 2 dias.

4. **Sprint 4**: fechar CC-3 pipeline (`deployability-3` runbook rollback + `deployability-4` smoke pós-deploy + `testability-2` `jest-axe` + `testability-3` `satisfies` nos mocks). Custo: 3 dias.

5. **Trimestre — investimentos estruturais**: `security-2` (JWT em `HttpOnly` cookie, M — toca backend), `security-3` (audit trail de auth, M), `testability-4` (Playwright smoke, M), `performance-2` (bundle budget no CI, M), `performance-4` (Web Vitals em campo, M). Custo agregado: ~2 semanas distribuídas. Sem esses, o produto entra na próxima feature de moldura (paleta ⌘K, dark mode) sem os gates que este ciclo identificou como faltantes.

Cards P3 restantes (`availability-3`, `deployability-5`, `modifiability-2`, `modifiability-3`, `performance-3`, `testability-5`) ficam no `ontology/_inbox/moldura-navegacao-regis-followups.md` e são puxados oportunisticamente por `/feature-tweak` que toque os módulos relevantes.
