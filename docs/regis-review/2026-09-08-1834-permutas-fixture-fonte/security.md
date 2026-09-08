---
qa: Security
qa_slug: security
run_id: 2026-09-08-1834
agent: qa-security
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 7.5
findings_count: 3
cards_count: 3
---

# Security — Regis-Review

> **Delta review.** Escopo é o commit `27023a9` (10 arquivos, +558 / −19, 100%
> `src/frontend/` + 1 doc de ontologia). Nada de backend, nada de IAM, nada de
> SSM. `infra/` não existe neste repositório (CLAUDE.md marca a camada
> Terraform/SSM/Lambda como **(alvo)**), então qualquer tactic dependente de
> IAM, KMS, CloudTrail, GuardDuty, SGs, VPC ou API Gateway authorizer é
> declarada **não medível** — não é finding.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador de deploy | Configura build da Vercel com `NEXT_PUBLIC_DEMO_MODE=true` e `NEXT_PUBLIC_ENV=prd` por engano | `src/frontend/lib/api.ts` (fetch da Gestão de Permutas) | Build de produção (Vercel) | `assertDemoEnv()` roda no import de `lib/api.ts` e ESTOURA o boot da app em vez de servir fixture como se fosse o banco | Build inutilizável em runtime; nenhuma tela produtiva exibe dados falsos com nomes reais |
| Usuário autenticado | Abre `/permutas` em qualquer navegador de produção | `src/frontend/lib/permutas-fixture.ts` (bundle client-side) | Produção (Vercel), demo OFF | Fixture é `import`-ado estaticamente por `lib/api.ts` e VIAJA no chunk client mesmo com demo OFF; view-source ou download dos chunks expõe 8 exportadores reais e valores em USD | 0 nomes reais deveriam viajar no bundle — hoje viajam 227 linhas em 3 chunks |
| Backend | Responde `500 {"error":"..."}` numa carga da Gestão | `LoadErrorBanner` em `banners.tsx` | Produção, falha eventual | Banner exibe `API 500 — <detail>` ao operador com o `error` do backend verbatim | Mensagem opaca ao usuário, sem stack/SQL/paths — depende da higiene do lado do backend |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Hardcoded secrets no delta | 0 | 0 | ✅ | `git diff origin/main...HEAD` inspecionado |
| Novos `dangerouslySetInnerHTML` no delta | 0 | 0 | ✅ | `git diff …HEAD -- src/frontend \| grep dangerouslySetInnerHTML` |
| Novos `innerHTML` no delta | 0 | 0 | ✅ | idem |
| Novos usos de `localStorage`/`sessionStorage` no delta | 0 | 0 (baseline: token em localStorage já existe) | ✅ | idem |
| Nomes reais de clientes/exportadores em `permutas-fixture.ts` | 8 (DBP PIPING CO.,LTD; QINGDAO COVENANT PIPELINE CO LTD; CENTENO INTERNATIONAL LIMITED; PANTECH STAINLESS ALLOY INDUSTRIES; NORMET OY; DAH SOLAR CO LTD; JINDAL STAINLESS LIMITED; SUN MARK STAINLESS PVT LTD) | 0 no bundle client de produção | ❌ | `grep -oE "'[A-Z][A-Z ,\.]{3,}'" src/frontend/lib/permutas-fixture.ts \| sort -u` |
| Linhas do fixture com valores USD reais probados | 227 | 0 no bundle client de prd (ou pseudonimizar) | ❌ | `wc -l src/frontend/lib/permutas-fixture.ts` |
| Chunks `.next/static/chunks/*.js` contendo "DBP PIPING" (build já roda com demo OFF) | 3 (28 KB + 25 KB + 37 KB = ~91 KB) | 0 | ❌ | `find src/frontend/.next/static/chunks -name '*.js' -exec grep -l 'DBP PIPING' {} +` |
| Guards fail-fast presentes | 2 (`assertAuthEnv`, `assertDemoEnv`) | ≥2 | ✅ | `grep -rn "assert(Auth\|Demo)Env" src/frontend/lib --include='*.ts'` |
| Guards chamados a partir do root layout (fireiam em toda rota) | 1 (`assertAuthEnv` via `AuthProvider` em `app/layout.tsx`) | 2 | ⚠️ | `grep -rn "assertAuthEnv\|assertDemoEnv" src/frontend --include='*.ts' --include='*.tsx' \| grep -v test` |
| Guards chamados só em módulos consumidos por páginas de dados (`lib/api.ts`) | 1 (`assertDemoEnv`) | — | ⚠️ | idem |
| Mensagem de erro do backend surfaced ao usuário verbatim | 8 sítios (`API ${status} — ${j.error}`) | pattern documentado + sanitização servidor-side | ⚠️ | `grep -n "API \${res.status}" src/frontend/lib/api.ts` |
| Testes cobrindo os 3 caminhos de `fetchGestaoPermutas` | 7 casos novos (`permutas-fonte-dado.test.ts`) | ≥3 caminhos cobertos | ✅ | `src/frontend/__tests__/permutas-fonte-dado.test.ts` |
| `SessionExpiredError` propagada em vez de virar fixture | corrigido | propagada | ✅ | `src/frontend/lib/api.ts:117-121` + `usePermutasData.ts:44-49` |
| IAM/SSM/CloudTrail/GuardDuty/VPC/authorizer coverage | **não medível** | — | ⚠️ | `infra/` não existe neste repositório (CLAUDE.md, "Estado Atual vs. Alvo") |
| `npm audit` (frontend) | **não coletado neste delta** | critical=0, high=0 | ⚠️ | fora do escopo do delta review; alvo do `/regis-review` completo |

## 3. Tactics — Cobertura no delta

Foco nas tactics *tocadas* pelo delta. Tactics de infra (IAM, KMS, network) ficam N/A porque `infra/` não existe.

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Identify Actors | Sem mudança; `withAuthHeaders()` continua injetando o bearer em toda chamada | ✅ presente | `src/frontend/lib/api.ts:81` (não alterado no fluxo) |
| Authenticate Actors | Delta preserva; `SessionExpiredError` agora PROPAGA em vez de virar fixture — o `SessionExpiredModal` finalmente dispara na Gestão de Permutas | ✅ melhorado | `src/frontend/lib/api.ts:117-121`, `src/frontend/app/permutas/components/usePermutasData.ts:47-49,72-73` |
| Authorize Actors | Autorização é backend; delta não altera. RBAC/tenant scoping fora do escopo do fix | N/A | delta 100% frontend, sem regra de autorização |
| Limit Access | Delta reduz o "acesso" implícito da UI ao fixture: dois dos três caminhos antes usados agora exigem `NEXT_PUBLIC_DEMO_MODE=true` — reduziu de 3 caminhos silenciosos para 1 opt-in explícito | ✅ melhorado | `src/frontend/lib/api.ts:96,118` |
| Limit Exposure | Fixture com dados reais **continua** estaticamente importado por `lib/api.ts` — viaja no bundle client mesmo com demo OFF. Confidentiality intacta pré-delta; delta não regride mas também não corrige | ⚠️ parcial | `src/frontend/lib/api.ts:19` + `find .next/static/chunks -exec grep -l 'DBP PIPING'` = 3 chunks |
| Encrypt Data | N/A no delta (TLS é da Vercel/backend; nada em `crypto` foi tocado) | N/A | — |
| Separate Entities | N/A no delta | N/A | — |
| Change Default Settings | `isDemoMode()` só reconhece `'true'` literal — default OFF **em todo lugar, inclusive `local`** — divergência explícita e correta do `isSispagEnabled()` (que liga em `local` por omissão). Comentário no código justifica: "dado falso na tela nunca é o comportamento desejado por omissão" | ✅ presente | `src/frontend/lib/features.ts:36-40` |
| Validate Input | `fetchGestaoPermutas` faz coerção defensiva do JSON do backend (`json.pendentes ?? []`, `?? {}` no `totais`) mas SEM Zod. Baseline do repo, não regressão do delta | ⚠️ parcial | `src/frontend/lib/api.ts:98-113` |
| Verify Message Integrity | **Ganho central do delta.** A resposta agora carrega `fonte: 'banco' \| 'fixture'` e o `DemoDataBanner` grita quando é fixture. A tela distingue "o que está aqui é o banco" de "isto é fixture" — antes não distinguia | ✅ presente | `src/frontend/app/permutas/components/banners.tsx:23-40`, `src/frontend/lib/types.ts:22` |
| Detect Intrusion | Fora do escopo do delta (é infra/logging) | N/A | — |
| Detect Service Denial | `LoadErrorBanner` avisa o operador quando o backend cai (falha na carga) — não é *detecção* stricto sensu, é *sinalização ao humano*, mas é o que existe do lado frontend | ✅ parcial (superfície UI) | `src/frontend/app/permutas/components/banners.tsx:52-77` |
| Detect Message Delay | N/A | N/A | — |
| Revoke Access | N/A no delta | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | **Ganho do delta.** Dois banners novos (`DemoDataBanner`, `LoadErrorBanner`) informam explicitamente quando os dados não são do banco ou quando a última carga falhou. Modal de sessão expirada agora dispara (antes era engolido) | ✅ presente | `src/frontend/app/permutas/components/banners.tsx:1-80`, `src/frontend/lib/api.ts:117-121` |
| Restore | N/A no delta | N/A | — |
| Audit Trail | N/A no delta (é backend) | N/A | — |

## 4. Findings

### F-security-1: Fixture com nomes reais de exportadores viaja no bundle client de produção

- **Severidade**: P2 (débito de confidencialidade — não é regressão do delta, mas é o vetor de risco que o delta *não* fecha)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/frontend/lib/api.ts:19` (import estático); `src/frontend/lib/permutas-fixture.ts:1-227`; artefatos: `src/frontend/.next/static/chunks/3w7mukm2k1bdh.js`, `2wrztmgxb657m.js`, `1t1gsd32h8hb9.js`
- **Evidência (objetiva)**:
  ```
  # nomes reais no fonte
  $ grep -oE "'[A-Z][A-Z ,\.]{3,}'" src/frontend/lib/permutas-fixture.ts | sort -u
  'CENTENO INTERNATIONAL LIMITED'
  'DAH SOLAR CO LTD'
  'DBP PIPING CO.,LTD'
  'JINDAL STAINLESS LIMITED'
  'NORMET OY'
  'PANTECH STAINLESS ALLOY INDUSTRIES'
  'QINGDAO COVENANT PIPELINE CO LTD'
  'SUN MARK STAINLESS PVT LTD'

  # chunks do build de produção que carregam o fixture (build já roda com demo OFF)
  $ find src/frontend/.next/static/chunks -name '*.js' -exec grep -l 'DBP PIPING' {} +
  src/frontend/.next/static/chunks/3w7mukm2k1bdh.js       28 KB
  src/frontend/.next/static/chunks/2wrztmgxb657m.js       25 KB
  src/frontend/.next/static/chunks/1t1gsd32h8hb9.js       37 KB
  ```
  E o comentário no cabeçalho do fixture confirma a origem: *"Dados ancorados no que foi sondado contra o Conexos real (dev tenant Columbia, filCod=2, 2026-06-18): exportadores e referências reais (DBP PIPING, QINGDAO COVENANT, CENTENO INTERNATIONAL, PANTECH, etc.), valores plausíveis em moeda negociada (USD)"*.
- **Impacto técnico**: `lib/api.ts` faz `import { gestaoPermutasFixture } from './permutas-fixture'` estaticamente. Mesmo com `NEXT_PUBLIC_DEMO_MODE` desligado, o Turbopack/webpack inclui o módulo no bundle client — o guard `assertDemoEnv()` apenas evita que o fixture seja *renderizado*, não evita que o *código* viaje. Qualquer pessoa com URL de produção consegue baixar os chunks e ler os 8 nomes de fornecedores + linhas digitáveis fictícias + valores em USD.
- **Impacto de negócio**: nomes de fornecedores da Columbia Trading são informação comercial sensível (relacionamento com o exportador, exposição por país, mix de suppliers). Publicá-los no bundle client — mesmo que sejam "só o mockup" — é vazá-los para qualquer visitante autenticado ou não (chunks static costumam ser servidos sem authz na Vercel). Também compromete a promessa multi-tenant do estado-alvo: o fixture é da Columbia; se amanhã o mesmo frontend for o de outro cliente, sobe com nomes do outro embutidos.
- **Métrica de baseline**: 8 nomes reais em 227 linhas, presentes em 3 chunks (~91 KB) do build atual → alvo 0 no bundle client de produção.

### F-security-2: Cobertura do fail-fast `assertDemoEnv()` é assimétrica com `assertAuthEnv()`

- **Severidade**: P2 (não bloqueante hoje — todas as rotas que consomem dados importam `lib/api.ts` — mas o padrão é frágil e o comentário do próprio código afirma paridade com `assertAuthEnv` que não é bem verdade)
- **Tactic violada**: Change Default Settings (o próprio guard) + Limit Exposure (extensão da cobertura)
- **Localização**: `src/frontend/lib/features.ts:51-61` (definição); `src/frontend/lib/api.ts:23` (invocação); comparar com `src/frontend/lib/auth/AuthProvider.tsx:11` + `src/frontend/app/layout.tsx:23`
- **Evidência (objetiva)**:
  ```
  # AuthProvider está no root layout — TODA rota Next.js carrega
  $ grep -n "AuthProvider" src/frontend/app/layout.tsx
  23:        <AuthProvider>
  # AuthProvider chama assertAuthEnv() no topo do módulo
  $ grep -n "assertAuthEnv" src/frontend/lib/auth/AuthProvider.tsx
  11:assertAuthEnv()
  # assertDemoEnv() é chamado apenas por lib/api.ts (import estático):
  $ grep -rn "assertDemoEnv" src/frontend --include='*.ts' --include='*.tsx' | grep -v test
  src/frontend/lib/features.ts:51:export const assertDemoEnv = (): void => {
  src/frontend/lib/api.ts:23:assertDemoEnv()
  ```
  Rotas que **não importam** `lib/api.ts` (`/login`, páginas estáticas, `not-found`, `error`, layouts intermediários) carregam a app sem disparar `assertDemoEnv()`. A crash é lazy — só ocorre quando a rota-alvo (`/permutas`, etc.) é aberta.
- **Impacto técnico**: um deploy misconfigurado com `NEXT_PUBLIC_DEMO_MODE=true, NEXT_PUBLIC_ENV=prd` renderiza a home / login normalmente e só estoura quando o operador clica em Permutas. Diferente do `assertAuthEnv()`, que quebra a app inteira ANTES de qualquer render. Complicador: como `NEXT_PUBLIC_*` é *inline* no build da Vercel, o guard é avaliado contra as envs **do build**, não do runtime — um build feito com `ENV=local, DEMO=true` promovido para produção passa pelo guard sem estourar. Isso é sistêmico e vale para os dois guards, mas neste caso o fixture leaked reforça o dano.
- **Impacto de negócio**: janela de tempo em que operadores vêem a tela funcionar (login, home) antes do crash — abre espaço para "parece que funcionou", especialmente se o QA smoke não abre `/permutas`. E preserva o risco de F-security-1 se demo é acidentalmente habilitado.
- **Métrica de baseline**: 1 dos 2 guards (`assertAuthEnv`) fireia em todas as rotas via root layout; `assertDemoEnv` fireia em subconjunto de rotas. Diferença: **N rotas onde o guard NÃO roda** (contagem exata depende do App Router — mínimo `/login` + `_not-found` + `error` boundary).

### F-security-3: Mensagem do backend surfaced verbatim ao usuário (`API {status} — {j.error}`)

- **Severidade**: P3 (baixo — depende inteiramente da higiene do backend, que este delta não toca; mas é o primeiro delta a *expor* o campo ao humano na tela)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/frontend/lib/api.ts:47-53,89-95,167-173,178-184,209-215,232-238,254-260,354-360,378-384` (8 sítios); rendering em `src/frontend/app/permutas/components/banners.tsx:66-72` (`<span className="opacity-80">({message})</span>`)
- **Evidência (objetiva)**:
  ```
  # padrão repetido:
  if (!res.ok) {
      let detail = ''
      try {
          const j = await res.json()
          detail = j?.error ? ` — ${j.error}` : ''
      } catch {}
      throw new Error(`API ${res.status}${detail}`)
  }
  ```
  Esse `Error.message` chega ao `LoadErrorBanner` como texto entre parênteses, exibido ao usuário no navegador.
- **Impacto técnico**: se o backend Express (legado) retornar `{ error: "PostgresError: relation \"permutas\" does not exist at ..." }` ou similar, o operador vê o texto na tela. Não é XSS (é renderizado como texto, não HTML), mas é vazamento de detalhe de implementação. Baseline pré-delta: o mesmo padrão já existia em outros fetchers; o delta apenas materializou o campo dentro de um banner visível.
- **Impacto de negócio**: reconhecimento passivo do stack (nomes de tabelas, mensagens em inglês da lib) para qualquer usuário — inclusive um agressor com credencial válida em ambiente onde a hipótese de acesso não-nulo não é confiável. Pequeno. Real.
- **Métrica de baseline**: 8 sítios em `lib/api.ts` que compõem o pattern; 0 sítios com sanitização/tradução server-side documentada. Alvo defendível: manter estilo curto (`API {status}`) na UI, deixar o `j.error` só no console do dev / no `LogService` do backend.

## 5. Cards Kanban

### [security-1] Não publicar nomes reais de exportadores no bundle client de produção

- **Problema**
  > `lib/permutas-fixture.ts` traz 8 nomes reais de fornecedores (DBP PIPING, QINGDAO COVENANT, CENTENO INTERNATIONAL, PANTECH, NORMET OY, DAH SOLAR, JINDAL STAINLESS, SUN MARK) e valores em USD sondados no Conexos real. `lib/api.ts` faz `import { gestaoPermutasFixture } from './permutas-fixture'` estaticamente, então o fixture viaja no bundle client mesmo com `NEXT_PUBLIC_DEMO_MODE=false`. O build atual (`.next/static/chunks/*.js`) tem 3 chunks contendo "DBP PIPING" (~91 KB). Nomes de fornecedor da Columbia são informação comercial; publicá-los no bundle é vazá-los para qualquer visitante do site (chunks estáticos costumam servir sem authz na Vercel). O delta corrigiu o comportamento de *renderização*, mas não removeu o material do bundle.

- **Melhoria Proposta**
  > Duas opções (a preferida é a primeira):
  > 1) **Dynamic import gated**: trocar o `import { gestaoPermutasFixture } from './permutas-fixture'` no topo de `lib/api.ts` por `await import('./permutas-fixture')` dentro do branch `if (isDemoMode())`. Com bundler moderno, o fixture cai em chunk separado e o bundler o carrega SÓ quando demo mode está ligado no build. Bass: **Limit Exposure**.
  > 2) **Pseudonimizar**: substituir os 8 nomes reais por rótulos fictícios (`EXPORTADOR ALPHA`, `FORNECEDOR BETA`, etc.) e valores redondos. Preserva o "aparência de dado real" para demo sem vazar o mapa de fornecedores. Combinável com (1).
  > Arquivos a tocar: `src/frontend/lib/api.ts`, `src/frontend/lib/permutas-fixture.ts`. Adicionar teste que confirma que o chunk `.next` de uma build com demo OFF **não** contém string "DBP PIPING" (pode ser um `check-bundle.mjs` no CI).

- **Resultado Esperado**
  > Nomes de fornecedor da Columbia não circulam no bundle client de builds de produção. `grep -l "DBP PIPING" .next/static/chunks/*.js` retorna 0.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Chunks do bundle contendo "DBP PIPING": 3 → 0
  - Bytes de fixture no bundle client (demo OFF): ~91 KB → 0
  - Nomes reais no `permutas-fixture.ts`: 8 → 0 (se optar por pseudonimizar)
- **Risco de não fazer**: relacionamentos comerciais da Columbia expostos no HTML servido pela Vercel. Em 6 meses o repo pode ter mais fixtures da mesma safra (Frente III/IV também "ancoraram" em dados reais); a prática vira norma.
- **Dependências**: nenhuma

### [security-2] Chamar `assertDemoEnv()` no root layout, alinhando com `assertAuthEnv()`

- **Problema**
  > `assertAuthEnv()` roda no topo do módulo `AuthProvider.tsx`, que é importado pelo root layout (`app/layout.tsx`) — logo é executado em TODA rota. `assertDemoEnv()` roda no topo de `lib/api.ts` — logo só é executado em rotas que importam esse módulo. O próprio comentário em `features.ts` reivindica paridade ("Fail-fast, espelhando `assertAuthEnv()`"), mas ela não existe: um build com `DEMO=true, ENV=prd` renderiza `/login` e a home normalmente e só quebra ao abrir `/permutas`. Isso abre janela onde o QA smoke pode declarar "verde" enquanto a rota crítica está armada.

- **Melhoria Proposta**
  > Mover a chamada `assertDemoEnv()` para o mesmo lugar de `assertAuthEnv()` — topo de `AuthProvider.tsx` (ou de um módulo carregado pelo root layout, ex.: `src/frontend/app/layout.tsx` importando um novo `lib/env-guards.ts` que agrega os dois asserts). Manter a chamada em `lib/api.ts` como cinto-e-suspensório é aceitável. Bass: **Change Default Settings**.
  > Adicionar teste E2E (Playwright / smoke) que roda `NEXT_PUBLIC_DEMO_MODE=true NEXT_PUBLIC_ENV=prd next build` e valida que qualquer navegação estoura na primeira rota renderizada — não só em `/permutas`.

- **Resultado Esperado**
  > Um build misconfigurado com `DEMO=true, ENV≠local` estoura na primeira rota renderizada, independente de qual seja. Guards fail-fast em coverage paridade com autenticação.

- **Tactic alvo**: Change Default Settings
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2, F-security-1 (mitigação secundária)
- **Métricas de sucesso**:
  - Rotas onde `assertDemoEnv()` NÃO roda: N → 0
  - Guards executados no root layout: 1 → 2
- **Risco de não fazer**: um deploy acidental com demo ligado renderiza login e home antes de estourar; QA visual pode dar "verde"; a hora que estoura é a hora que o analista tenta trabalhar.
- **Dependências**: nenhuma

### [security-3] Não jogar mensagem de erro do backend crua no banner

- **Problema**
  > `lib/api.ts` compõe `Error("API ${res.status} — ${j.error}")` em 8 fetchers e o `LoadErrorBanner` renderiza esse texto entre parênteses para o operador. Se o backend responde `{ error: "PostgresError: ..." }` ou um traceback, o operador vê. Não é XSS (React escapa), mas é vazamento passivo de stack (nomes de tabela, biblioteca, path de arquivo).

- **Melhoria Proposta**
  > No frontend: manter só `API ${status}` na `Error.message` e mover o `j.error` para `console.warn`/telemetria. Alternativa mais leve: mapear `res.status` para uma mensagem humana em pt-BR (`500 → 'erro interno no backend'`, `502/503/504 → 'backend indisponível'`, `401 → já tratado pelo SessionExpiredModal`) e usar `j.error` só quando ele vier de um erro *de negócio* explícito (ex.: 409 de ingestão em andamento, 422 de saldo — que já têm tratamento próprio). No backend (fora deste delta, mas necessário como par): sanitizar o `error` do JSON antes de responder — nunca mandar stack. Bass: **Limit Exposure**.
  > Arquivos a tocar: `src/frontend/lib/api.ts` (pattern `if (!res.ok)`), `src/frontend/app/permutas/components/banners.tsx` (opcional: mudar a formatação).

- **Resultado Esperado**
  > Mensagens de erro que chegam ao operador têm forma humana (`erro interno no backend`) em pt-BR, sem trecho do backend. Detalhes ficam em `console` / telemetria para debug.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Sítios em `lib/api.ts` que fazem `throw new Error("API ${status} — ${j.error}")`: 8 → 0 (ou mapa curado)
  - Mensagens de erro renderizadas ao usuário contendo trecho verbatim do backend: >0 → 0
- **Risco de não fazer**: reconhecimento passivo de stack backend em cada erro de produção. Baixo isoladamente, real em conjunto com outros achados (F-security-1).
- **Dependências**: pareamento com uma passagem de sanitização no Express (fora deste delta).

## 6. Notas do agente

- **Delta melhora a postura de segurança em duas frentes reais e uma auxiliar.** (i) Verify Message Integrity: a tela agora sabe se o número é do banco ou do fixture (banner obrigatório). (ii) Inform Actors: `SessionExpiredError` não é mais engolida pelo fallback do fixture — o modal de reautenticação passa a disparar na Gestão de Permutas. (iii) Change Default Settings: novo flag `DEMO_MODE` é OFF em toda parte, inclusive `local` — assimétrico e correto em relação ao `SISPAG_ENABLED`.
- **A única regressão que o delta *não* introduz mas *não corrige* é confidencialidade do fixture no bundle** (F-security-1 / card `security-1`). É a razão da nota 7.5 e não 8.5+.
- **`infra/` não existe** — todas as tactics dependentes de IAM/SSM/CloudTrail/GuardDuty/VPC/authorizer estão declaradas não medíveis, não como findings. `npm audit` está fora do escopo de um delta review.
- **Cross-QA**: `LoadErrorBanner` + preservação de dados prévios sob falha é `Fault Tolerance` (masking / graceful degradation) — alertar o consolidator. `DemoDataBanner` + `fonte: 'banco'|'fixture'` é `Integrability` (contrato explicíto de proveniência do dado) — também cross-QA.
