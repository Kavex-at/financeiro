---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-22-1556
agent: qa-deployability
generated_at: 2026-09-22T16:00:24Z
scope: frontend
score: 8.0
findings_count: 1
cards_count: 1
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (branch `fix/sispag-rem-download-latin1`) | PR com `fix(sispag)` corrigindo corrupção de bytes no `.REM` (CNAB 240) baixado pela tela | `src/frontend/lib/sispag.ts`, `app/sispag/components/LoteCard.tsx` (+ `sispag.test.ts` novo) | Produção single-tenant (Vercel para o frontend, `autoDeploy` no push a `main`, sem staging documentado) | CI (`ci.yml`, job `frontend`) roda typecheck/lint/test incluindo o teste novo → merge → Vercel builda e promove → rollback via "Promote to Production" se regressão | 0 P0 introduzido; teste de regressão passa com fixture de bytes latin1 (`0xC3`/`0xC7`); rollback documentado como "quase instantâneo" |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Steps de CI cobrindo os arquivos do delta (frontend) | 3 (typecheck, lint, test) | ≥3 antes do merge | ✅ | `.github/workflows/ci.yml:77-80` |
| Call sites afetados pela troca de shape de retorno (`conteudo: string` → `arquivo: Blob`) | 1 (`LoteCard.tsx`) | baixo (<3) — mudança de contrato contida | ✅ | `grep -rn baixarRemessa src/frontend` |
| Commits no delta (atomicidade) | 1 (`ca094fb`) | 1 commit atômico por fix | ✅ | `git log origin/main..HEAD` |
| Coordenação cross-service exigida (backend precisa mudar junto?) | 0 — `routes/sispag.ts` já envia `Buffer.from(conteudo, 'latin1')` | 0 | ✅ | `src/backend/routes/sispag.ts:468-474` (fora do delta, não tocado) |
| Tamanho do fixture de teste vs. remessa real | 9 bytes sintéticos (`sispag.test.ts:11`) | fixture com `.REM` real para mudanças de formato de arquivo | ⚠️ | `src/frontend/lib/sispag.test.ts` |
| Tempo de rollback do frontend | "quase instantâneo" (troca de alias Vercel) | ≤5min (meta do runbook) | ✅ | `docs/runbooks/rollback.md:1-8,60-65` |
| Staging/preview documentado para fixes financeiros antes do merge | não documentado em `DEPLOY.md` | checklist de verificação manual presente para mudanças em geração/entrega de remessa | ⚠️ | `DEPLOY.md` (sem seção de staging) |
| Bump de versão semver neste delta | ainda não feito (segue em v0.39.0) | feito no step "Bump de versão" | N/A neste checkpoint | pipeline do CLAUDE.md coloca o bump **depois** do Regis-Review gate — não é defeito, é ordem esperada |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Vercel gera Preview Deployment por PR por padrão (canário de fato), mas nada no delta ou em `DEPLOY.md` exige verificar o `.REM` baixado nesse preview antes do merge para uma mudança que toca o formato do arquivo entregue ao banco | ⚠️ parcial | `DEPLOY.md` (sem seção de staging/checklist); ver F-deployability-1 |
| Rollback | Runbook dedicado, aplicável 1:1 a este delta: frontend-only, sem migration → reversão seguro por definição da própria regra do runbook | ✅ presente | `docs/runbooks/rollback.md:16-24` (regra "código e schema não voltam juntos") + `:60-65` (Vercel "Promote to Production") |
| Script Deployment Commands | CI roda `npm ci && npm run typecheck/lint/test` automaticamente no push/PR, incluindo o teste novo deste delta; deploy do Vercel/Render é scriptado (`buildCommand`) | ✅ presente | `.github/workflows/ci.yml:64-80`; `render.yaml:18` |
| Logical Grouping | Mudança ficou inteira dentro do módulo SISPAG existente (`lib/sispag.ts` + `app/sispag/components/`), sem vazar para módulo não relacionado | ✅ presente | diff paths do delta |
| Physical Grouping | N/A — Vercel/Render é deploy único por serviço; este delta não introduz nem decide topologia física | N/A | — |
| Package Dependencies | Nenhuma dependência adicionada/alterada pelo delta | ✅ presente | `git diff origin/main..HEAD -- src/frontend/package.json` (vazio) |
| Surge Protection | N/A para este delta — troca é client-side (`res.blob()` em vez de `res.text()`); não introduz novo caminho de carga no backend, que permanece intocado | N/A | `src/backend/routes/sispag.ts` fora do diff |

## 4. Findings (achados)

### F-deployability-1: fix em geração/entrega de arquivo financeiro (CNAB 240) sem verificação manual pré-merge, apenas fixture sintético de 9 bytes

- **Severidade**: P1
- **Tactic violada**: Scale Rollouts (canary / staged verification)
- **Localização**: `src/frontend/lib/sispag.test.ts:11-16` (fixture); `DEPLOY.md` (ausência de checklist de staging para SISPAG)
- **Evidência (objetiva)**:
  ```
  const bytes = new Uint8Array([0x4a, 0x4f, 0xc3, 0x4f, 0x20, 0xc7, 0x41, 0x0d, 0x0a]) // 9 bytes
  ```
  `DEPLOY.md` não tem seção de staging/homolog para o frontend; `ci.yml` roda `test`/`lint`/`typecheck`
  mas não compara o `.REM` gerado com um arquivo real. O único portão antes de produção é o teste
  unitário acima.
- **Impacto técnico**: o fix corrige exatamente a classe de defeito (deslocamento de coluna no CNAB
  240 por reencode) que só se manifesta com nomes de favorecido reais e arquivos de centenas de
  linhas — um fixture de 9 bytes cobre a lógica de bytes, não a forma real do arquivo que o banco
  recebe.
- **Impacto de negócio**: SISPAG já teve um caso real de remessa não validada chegando perto de
  produção — a 1ª remessa da filial 7 (`PG160901.REM`, gerada 16/09) foi cancelada depois de subir,
  e o 2º teste parou num boleto sem código de barras (nota de memória do operador). Um novo problema
  de formato só apareceria de novo em produção, com o analista já submetendo o arquivo ao banco.
- **Métrica de baseline**: fixture de teste = 9 bytes sintéticos; nenhum passo documentado de abrir o
  `.REM` do Preview Deployment da Vercel (que já existe por padrão) num validador CNAB 240 ou
  compará-lo a um arquivo aceito pelo banco antes do merge.

## 5. Cards Kanban

### [deployability-1] Checklist de verificação manual do `.REM` no Preview Deployment antes de mergear fixes de formato SISPAG

- **Problema**
  > O fix deste delta corrige corrupção de bytes no CNAB 240 entregue ao banco, mas o único portão
  > antes de produção é um teste unitário com fixture sintético de 9 bytes. SISPAG já teve remessa
  > não validada perto de produção (filial 7, `PG160901.REM`), então a ausência de uma verificação
  > com arquivo real antes do merge é um risco concreto, não hipotético.

- **Melhoria Proposta**
  > Acrescentar a `DEPLOY.md` (ou a um novo `docs/runbooks/sispag-remessa-checklist.md`) um passo
  > obrigatório para PRs que tocam geração/entrega de remessa: baixar o `.REM` do Vercel Preview
  > Deployment (gerado automaticamente por PR) e validar num leitor CNAB 240 / comparar com um
  > arquivo já aceito pelo banco, antes de aprovar o merge. Tactic alvo: Scale Rollouts, usando a
  > infraestrutura de preview que a Vercel já provê sem custo adicional.

- **Resultado Esperado**
  > Toda mudança em `lib/sispag.ts` / rotas de remessa passa por um humano abrindo o arquivo real
  > gerado no preview antes de ir a produção. Fixture de teste sintético (9 bytes) → mantido para
  > regressão de unidade + checklist manual documentado (0 → 1) cobrindo o caso de arquivo real.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Checklist de verificação manual documentado para mudanças de formato SISPAG: 0 → 1
  - Fixture de teste de regressão com `.REM` real (não só bytes sintéticos): 0 → 1
- **Risco de não fazer**: repetição do padrão já visto na filial 7 — remessa com defeito de formato
  só descoberta depois de chegar perto do banco, em produção, com o analista no meio.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito aos 3 arquivos do delta (`sispag.ts`, `LoteCard.tsx`, `sispag.test.ts`); `infra/`
  Terraform e Lambda são "alvo" inexistente neste repo (CLAUDE.md) — tactics de infra (Physical
  Grouping, Surge Protection) marcadas N/A por não se aplicarem a este stack Render/Vercel atual.
  Deploy real: Render (backend, inalterado) + Vercel (frontend) — não o `npx serve@latest out`
  descrito na missão genérica, que não corresponde a este repo (`next.config.js` sem `output: export`).
- Ausência de bump de versão/CHANGELOG neste checkpoint **não** é finding: o pipeline do CLAUDE.md
  coloca o passo de bump **depois** do gate do Regis-Review, então checar isso agora daria falso-positivo.
- **Cross-QA**: F-deployability-1 tangencia Testability (fixture sintético vs. arquivo real) e
  Fault-Tolerance/negócio (recorrência do incidente da filial 7) — sinalizar ao consolidator para não
  duplicar o card caso qa-testability já tenha flagueado a cobertura do fixture.
