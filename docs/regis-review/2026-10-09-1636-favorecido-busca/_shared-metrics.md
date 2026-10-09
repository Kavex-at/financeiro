# Shared metrics — 2026-10-09-1636-favorecido-busca

Escopo: **delta** da branch `feat/sispag-favorecido-busca` contra `origin/main` (17874ea), chamado
pelo gate pós-implementação do `/feature-tweak FavorecidoAutorizado`. Worktree:
`.claude/worktrees/sispag-favorecido-busca`. Mudanças ainda não commitadas (ler com
`git diff origin/main` + arquivos novos listados abaixo).

## O que a feature faz

Quem pede a autorização de um favorecido (ADR-0065) acha o favorecido no cadastro do Conexos
(`cmn025/list`) por nome, nome fantasia, CPF/CNPJ ou código, sem abrir o Conexos e sem digitar
código. A lista traz o CPF/CNPJ mascarado (`MaskDestino.documento`), a situação no Conexos e a
autorização vigente por modalidade. Escolhido o favorecido, uma prévia mostra o destino do cadastro
mascarado (I14l). Read-only: nenhuma escrita local ou no ERP.

- `POST /sispag/favorecidos-autorizados/busca` (body `{termo}`; POST para o CPF/CNPJ não cair em
  URL/log) — `sispag:executar`.
- `GET /sispag/favorecidos-autorizados/destino-atual?pesCod&modalidade` — `sispag:executar`, sem
  impressão HMAC.
- Leituras no Conexos: busca = 1–2 por termo (doc: dígitos, depois formatado; texto: razão social +
  fantasia; código: 1); prévia = as do resolvedor I10 (contas ou chaves PIX + documento). Debounce
  350 ms no frontend; texto mínimo de 3 letras; até 20 linhas por leitura.

## Delta (git diff origin/main --stat -- src) + novos

| Arquivo | +/− |
|---|---|
| src/backend/domain/client/ConexosSispagClient.ts | +107 |
| src/backend/domain/client/ConexosSispagClient.test.ts | +121 |
| src/backend/domain/interface/sispag/SispagInterface.ts | +19 |
| src/backend/domain/service/sispag/AuthorizedPayeeService.ts | +18 |
| src/backend/domain/service/sispag/AuthorizedPayeeService.test.ts | +40 |
| src/backend/http/schemas.ts | +11 |
| src/backend/http/routePermissions.test.ts | +7/−? |
| src/backend/routes/sispag.ts | +33 |
| src/backend/routes/sispag.favorecidos.test.ts | +64 |
| src/frontend/app/sispag/favorecidos-autorizados/components/SolicitarAutorizacaoDialog.tsx | +373/−37 (reescrito) |
| src/frontend/lib/sispag.ts | +48 |
| src/frontend/…/CandidatosTab.test.tsx, page.test.tsx | ajustes de mock |
| **NOVO** src/backend/domain/service/sispag/PayeeSearchService.ts (+ .test.ts) | ~90 + ~100 |
| **NOVO** src/frontend/…/SolicitarAutorizacaoDialog.test.tsx | ~190 |
| **NOVO** src/backend/jobs/probe-cmn025-busca-hml.ts | sonda read-only, recusa base não-HML |
| ontology: actions/sispag/buscar-favorecido-conexos.md (novo), _index, _coverage, CHANGELOG | v0.39.0 |

## Baseline do repositório

| Métrica | Valor |
|---|---|
| Backend LOC (não-teste, sem node_modules) | 80.073 |
| Backend arquivos de teste | 250 (jest: 225 suites) |
| Frontend LOC (não-teste) | 31.764 |
| Frontend arquivos de teste | 88 suites |
| Terraform modules / tenants | ⚠️ Não medível: não existe `infra/` (deploy Render/Vercel) |

## Gates (rodados nesta branch, 2026-10-09)

| Gate | Resultado |
|---|---|
| backend `npm run typecheck` | ✅ 0 erros |
| backend `npm run lint` | ✅ 0 erros, 87 warnings (pré-existentes; nenhum nos arquivos do delta) |
| backend `npm test` | ✅ 225 suites, 4.016 testes |
| frontend `npm run typecheck` | ✅ |
| frontend `npm run lint` | ✅ 0 erros, 19 warnings (pré-existentes; 0 no diálogo novo) |
| frontend `npm test` | ✅ 88 suites, 884+ testes (pasta do diálogo 25/25 após última correção) |
| PatternGuardian | ✅ PASS; P1 (CPF/CNPJ na query logado por middlewares) corrigido → POST; P3 curingas `%`/`_` removidos |
| DesignSystemReviewer | V1–V3 corrigidos e confirmados; N1 (laço de nova busca em erro) corrigido com teste |

## Não medido / gaps conhecidos

- ⚠️ Semântica do `#LIKE` do `cmn025` ("contém" × "começa com", acento, caixa) e formato de
  `pdcDocFederal` **não medidos ao vivo**: HML recusou o usuário do `.env` de produção (Bad
  Credentials); sonda em produção não foi rodada (derruba sessão viva no teto de sessões).
- Sem limite de taxa específico na rota de busca além do debounce do frontend.
