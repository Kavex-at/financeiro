---
qa: Performance
qa_slug: performance
run_id: 2026-09-22-1556
agent: qa-performance
generated_at: 2026-09-22T15:56:00Z
scope: frontend
score: 9
findings_count: 0
cards_count: 0
---

# Performance — Regis-Review

> Escopo: `--quick`, delta-only (`git diff origin/main..HEAD`), 3 arquivos: `src/frontend/lib/sispag.ts`,
> `src/frontend/app/sispag/components/LoteCard.tsx`, `src/frontend/lib/sispag.test.ts`. Mudança: `baixarRemessa`
> passa de `res.text()` (decodifica UTF-8, depois reempacota em `new Blob([conteudo], ...)`) para `res.blob()`
> (repassa o `Response` binário direto ao `URL.createObjectURL`). Motivação declarada é correção (acento
> quebrava colunas fixas do CNAB 240), não performance — mas o efeito colateral é estritamente performático.

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Clica "Baixar .REM" num lote fechado | `baixarRemessa()` (`src/frontend/lib/sispag.ts`) + handler de download em `LoteCard.tsx` | Browser, lote com N registros CNAB 240 já gerado no backend (latin1, `Buffer`) | Bytes chegam ao navegador sem decode/reencode intermediário e disparam o download | Bytes do arquivo baixado == bytes do buffer do backend; nº de cópias em memória do payload: 1 (Blob nativo do `fetch`) em vez de 2 (string UTF-16 + `new Blob`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cópias em memória do payload no caminho de download | 1 (`res.blob()` → `Blob` nativo) | ≤ 1 para arquivo binário | ✅ | `src/frontend/lib/sispag.ts:456` (`await res.blob()`) |
| Cópias em memória antes do delta | 2 (`res.text()` decodifica para string UTF-16 + `new Blob([conteudo])` reempacota) | — | — (baseline histórico, não é o estado atual) | `git diff origin/main..HEAD -- src/frontend/lib/sispag.ts` |
| Dependências/bundle novas introduzidas pelo delta | 0 | 0 | ✅ | diff (nenhum import novo) |
| Timeout explícito na chamada de download (`apiFetch`) | Não alterado pelo delta (pré-existente) | 100% dos clients com timeout | ⚠️ fora do escopo do delta | `src/frontend/lib/sispag.ts:452-457` — sem mudança de comportamento de timeout |

> ⚠️ **Não medível localmente**: tamanho real dos arquivos `.REM` em produção (p95 de linhas/bytes por lote) e tempo de resposta do endpoint `GET /sispag/lotes/:id/remessa/arquivo` sob carga. Requer amostra de produção/CloudWatch. Não é crítico aqui — download é ação pontual, humana, um arquivo por vez, e a extensão do delta (blob passthrough) não piora esse perfil em nenhum tamanho de arquivo; ao contrário, elimina a expansão de string UTF-16 que crescia com o tamanho do arquivo.

## 3. Tactics — Cobertura no nf-projects (aplicada ao delta)

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — não há amostragem envolvida | N/A | — |
| Limit Event Response | N/A — clique único, sem loop/batch | N/A | — |
| Prioritize Events | N/A — não há fila de eventos | N/A | — |
| Reduce Overhead | ✅ presente — remove o round-trip decode(UTF-8)→reencode(Blob) que existia antes; `res.blob()` repassa o stream do `Response` direto ao `Blob` consumido por `createObjectURL` | ✅ | `src/frontend/lib/sispag.ts:456`; diff de `sispag.ts` e `LoteCard.tsx` |
| Bound Execution Times | Não tocado pelo delta — `apiFetch` sem timeout explícito é pré-existente, não introduzido aqui | N/A (fora do delta) | `src/frontend/lib/sispag.ts:452` (`apiFetch(...)` sem `timeout`/`AbortSignal`) |
| Increase Resource Efficiency | ✅ presente — 1 cópia binária em memória em vez de 2 (string + Blob); elimina expansão UTF-16 proporcional ao tamanho do arquivo | ✅ | mesmo diff |
| Increase Resources | N/A | N/A | — |
| Increase Concurrency | N/A | N/A | — |
| Maintain Multiple Copies of Computations | N/A | N/A | — |
| Maintain Multiple Copies of Data | N/A | N/A | — |
| Bound Queue Sizes | N/A | N/A | — |
| Schedule Resources | N/A | N/A | — |
| Cold start budget | N/A — mudança é frontend puro, sem Lambda | N/A | — |
| Cache strategy | N/A — download não é cacheável (arquivo por lote) | N/A | — |
| Index discipline | N/A — nenhum SQL no delta | N/A | — |
| Bundle leanness | ✅ neutro — nenhuma dependência nova; `res.blob()` é API nativa do `fetch`, sem custo de bundle adicional | ✅ | diff (zero imports novos) |

## 4. Findings (achados)

Nenhum finding de Performance neste delta. A mudança troca `res.text()` por `res.blob()` e remove um
reempacotamento de `Blob`, o que é estritamente uma melhoria (menos cópias, sem expansão UTF-16) e não
introduz nenhuma regressão de latência, memória ou bundle. Não há loop, não há chamada a repositório/SQL,
não há nova dependência, e o teste novo (`sispag.test.ts`) cobre o caminho binário sem overhead adicional
de execução.

## 5. Cards Kanban

Nenhum card — não há finding de Performance associado a este delta (ver Seção 4).

## 6. Notas do agente

- Escopo estritamente delta-only: o `apiFetch` sem timeout explícito usado por `baixarRemessa` é
  pré-existente (não alterado por este diff) — não vira finding de Performance aqui, mas é o mesmo padrão
  já sinalizável por `qa-availability`/`qa-fault-tolerance` (chamada de rede sem timeout prende a UI em
  caso de backend/Conexos lento).
- Cross-QA: nenhuma mudança de bundle (0 deps novas) — sem overlap com `qa-deployability` neste delta.
- Cross-QA: nenhuma mudança de schema/SQL — sem overlap com `qa-modifiability` neste delta.
- `_shared-metrics.md` já cobria LOC/typecheck/lint/test; não houve necessidade de comandos adicionais
  dado o tamanho do delta (3 arquivos, ~95 linhas).
