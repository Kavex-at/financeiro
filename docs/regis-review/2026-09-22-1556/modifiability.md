---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-22-1556
agent: qa-modifiability
generated_at: 2026-09-22T15:56:00-03:00
scope: frontend
score: 8.7
findings_count: 2
cards_count: 2
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev do time Kavex | Precisa corrigir um bug de encoding no download de um artefato binário/latin1 (CNAB 240) sem afetar as outras 46 suites de teste do frontend | `src/frontend/lib/sispag.ts` (`baixarRemessa`), `LoteCard.tsx`, `sispag.test.ts` | Codebase em desenvolvimento, `--quick`, escopo frontend | A mudança fica contida no par produtor/consumidor (`baixarRemessa` → único call site em `LoteCard.tsx`), com teste de regressão cobrindo o caso binário que motivou o fix | 1 função alterada, 1 call site atualizado, 1 arquivo de teste novo (44 linhas), 0 quebras de tipo em outros consumidores |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Call sites de `baixarRemessa` afetados pela mudança de assinatura (`conteudo: string` → `arquivo: Blob`) | 1 (`LoteCard.tsx:309`) | Baixo (idealmente ≤2) | ✅ | `grep -rn "baixarRemessa" src/frontend` |
| Implementações estruturalmente duplicadas do padrão "fetch blob → parse `Content-Disposition` → `createObjectURL` → trigger `<a download>`" após o delta | 2 (`src/frontend/lib/api.ts:599-625` `exportarRelatorio`, `src/frontend/lib/sispag.ts:450-457`+`LoteCard.tsx:309-317` `baixarRemessa`) | 1 (helper compartilhado) | ⚠️ | `grep -n "res.blob()\|createObjectURL" src/frontend/lib/api.ts src/frontend/lib/sispag.ts src/frontend/app/sispag/components/LoteCard.tsx` |
| Cobertura de teste nova para o comportamento alterado | 2 casos (bytes latin1 preservados; erro 404 propagado) em `sispag.test.ts` | ≥1 caso cobrindo o defeito corrigido | ✅ | `src/frontend/lib/sispag.test.ts:19-44` |
| LOC do delta (não-teste) | `sispag.ts` 643 LOC total (11 linhas tocadas), `LoteCard.tsx` 556 LOC total (9 linhas tocadas) | Split Module a partir de 600 LOC | ⚠️ (pré-existente, não agravado pelo delta) | `wc -l`, `git diff --stat` |
| Magic strings de encoding removidas do call site | 1 (`'text/plain;charset=latin1'` hardcoded no `Blob` constructor, removido) | 0 | ✅ | diff `LoteCard.tsx` |

## 3. Tactics — Cobertura no nf-projects (aplicada ao delta)

| Tactic (Bass) | Implementação atual no delta | Status | Evidência |
|---|---|---|---|
| Split Module | N/A ao delta — nenhum arquivo cruzou limiar de tamanho por causa desta mudança | N/A | `wc -l` acima, delta de 9-11 linhas por arquivo |
| Increase Semantic Coherence | Parcialmente violada: `arquivo` agora nomeia um `Blob` no retorno de `baixarRemessa` (`sispag.ts:450`) enquanto `arquivo?: string` já nomeia um filename em `GerarRemessaResult` (`sispag.ts:289`) no mesmo arquivo | ⚠️ parcial | `sispag.ts:289`, `sispag.ts:450` |
| Encapsulate | `baixarRemessa` continua sendo o único ponto de contato com o backend para este download; o `LoteCard` não conhece detalhes de encoding, só recebe o `Blob` | ✅ presente | `sispag.ts:441-457` |
| Use an Intermediary | Mesmo | ✅ presente (a função já era o intermediário; o delta não introduz novo) | — |
| Restrict Dependencies | Assinatura mudou (`conteudo: string` → `arquivo: Blob`); apenas 1 consumidor existia, então o "raio de restrição" já era mínimo — não há evidência de acoplamento amplo a ser restringido aqui | ✅ presente (efeito colateral de um único call site) | `grep -rn "baixarRemessa"` acima |
| Refactor | O fix é, em si, um refactor pontual e local (troca `.text()` por `.blob()`), sem introduzir complexidade nova | ✅ presente | diff `sispag.ts` |
| Abstract Common Services | Ausente — o delta reimplementa (não extrai) o mesmo padrão blob-download já existente em `api.ts:exportarRelatorio`, sem compartilhar helper | ❌ ausente | `api.ts:599-625` vs `sispag.ts:441-457` + `LoteCard.tsx:309-317` |
| Defer Binding (config/polimorfismo) | Melhoria de defer-binding: o MIME type do `Blob` deixa de ser hardcoded (`'text/plain;charset=latin1'`) no frontend e passa a vir do `Content-Type` que o backend declarar em `res.blob()` | ✅ presente (introduzida pelo delta) | diff `LoteCard.tsx` (linha removida) |

## 4. Findings (achados)

### F-modifiability-1: Padrão de download por blob duplicado entre `api.ts` e `sispag.ts` sem abstração comum

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/frontend/lib/api.ts:599-625` (`exportarRelatorio`) vs `src/frontend/lib/sispag.ts:441-457` (`baixarRemessa`) + `src/frontend/app/sispag/components/LoteCard.tsx:309-317`
- **Evidência (objetiva)**:
  ```
  // api.ts (pré-existente, fora do delta)
  const blob = await res.blob()
  const filename = parseContentDispositionFilename(res.headers.get('content-disposition')) ?? ...
  const url = URL.createObjectURL(blob)
  ... anchor.click() ... URL.revokeObjectURL(url)

  // sispag.ts (alterado neste delta) + LoteCard.tsx
  const disp = res.headers.get('Content-Disposition') ?? ''
  const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? `lote-${loteId}.REM`
  return { nome, arquivo: await res.blob() }
  // ... LoteCard.tsx: URL.createObjectURL(arquivo) ... a.click() ... URL.revokeObjectURL(url)
  ```
- **Impacto técnico**: antes do delta, `baixarRemessa` usava `res.text()` e divergia estruturalmente de `exportarRelatorio`. O fix aproxima os dois para o mesmo shape (fetch blob → parse filename do header → `createObjectURL` → `<a download>` → `revoke`), mas sem extrair um helper comum — a regex de parsing do `Content-Disposition` já existe duas vezes com implementações ligeiramente diferentes (`parseContentDispositionFilename` vs regex inline).
- **Impacto de negócio**: o próximo bug de encoding/nome-de-arquivo (ex.: `Content-Disposition` sem aspas, ou filename com `%`-encoding) provavelmente será corrigido em um dos dois lugares e não no outro, repetindo o ciclo desta correção.
- **Métrica de baseline**: 2 implementações estruturalmente idênticas do padrão blob-download no frontend após o delta (era 1 antes, já que `baixarRemessa` usava `.text()`).

### F-modifiability-2: Colisão semântica do identificador `arquivo` (Blob vs filename) no mesmo módulo

- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/frontend/lib/sispag.ts:289` (`GerarRemessaResult.arquivo?: string`) vs `src/frontend/lib/sispag.ts:450` (retorno de `baixarRemessa`: `arquivo: Blob`)
- **Evidência (objetiva)**:
  ```ts
  export interface GerarRemessaResult {
    ...
    arquivo?: string   // nome do arquivo de remessa
    ...
  }
  ...
  export async function baixarRemessa(loteId: string): Promise<{ nome: string; arquivo: Blob }> {
  ```
- **Impacto técnico**: no mesmo arquivo, `arquivo` significa "nome do arquivo" em um lugar e "conteúdo binário" em outro. Um dev futuro lendo `sispag.ts` isoladamente (sem abrir `LoteCard.tsx`) pode assumir o tipo errado ao reusar o campo.
- **Impacto de negócio**: baixo risco imediato — é confusão de leitura, não bug funcional — mas aumenta o custo cognitivo de qualquer próxima mudança em `sispag.ts` (643 LOC).
- **Métrica de baseline**: 2 ocorrências do identificador `arquivo` com tipos incompatíveis (`string` vs `Blob`) no mesmo arquivo de 643 LOC.

## 5. Cards Kanban

### [modifiability-1] Extrair helper compartilhado para download de arquivo (blob + Content-Disposition)

- **Problema**
  > O fix desta branch aproxima `baixarRemessa` (`sispag.ts`) do mesmo padrão já usado por `exportarRelatorio` (`api.ts`) — fetch blob, parse do nome via `Content-Disposition`, `createObjectURL`, `<a download>`, `revokeObjectURL` — mas cada um mantém sua própria cópia da lógica, incluindo parsing de filename divergente (helper dedicado vs regex inline).

- **Melhoria Proposta**
  > Extrair um `downloadFile(res: Response, fallbackFilename: string): Promise<{ nome: string; arquivo: Blob }>` (ou equivalente) em `src/frontend/lib/download.ts`, usado por `exportarRelatorio` e `baixarRemessa`. Tactic: Abstract Common Services.

- **Resultado Esperado**
  > 1 implementação do padrão blob-download em vez de 2. Métrica: duplicações estruturais do padrão 2 → 1.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Implementações duplicadas do padrão blob-download: 2 → 1
  - Parsers de `Content-Disposition` distintos: 2 → 1
- **Risco de não fazer**: o próximo bug de nome/encoding de arquivo baixado (SISPAG, Permutas, ou frente futura) será corrigido em apenas um dos dois lugares, reproduzindo o retrabalho já visto nesta branch.
- **Dependências**: nenhuma.

### [modifiability-2] Renomear campo `arquivo: Blob` em `baixarRemessa` para evitar colisão com `GerarRemessaResult.arquivo: string`

- **Problema**
  > `sispag.ts` usa `arquivo` para dois significados incompatíveis no mesmo módulo: nome do arquivo (`GerarRemessaResult.arquivo?: string`, linha 289) e conteúdo binário (`baixarRemessa` retorno, linha 450, `Blob`).

- **Melhoria Proposta**
  > Renomear o campo do retorno de `baixarRemessa` para `blob` ou `bytes` (ajustando `LoteCard.tsx:309` e `sispag.test.ts`). Tactic: Increase Semantic Coherence.

- **Resultado Esperado**
  > Nenhuma ocorrência de `arquivo` com tipos incompatíveis no mesmo arquivo.

- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-2
- **Risco de não fazer**: custo cognitivo marginal a cada leitura futura de `sispag.ts`; baixo, mas acumulável em um arquivo de 643 LOC que já concentra 3 fatias de domínio (remessa, conciliação, geração).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estritamente delta-only (3 arquivos: `sispag.ts`, `LoteCard.tsx`, `sispag.test.ts`); `api.ts` foi lido apenas para comparação estrutural (confirmado pré-existente via `git diff origin/main..HEAD --stat -- src/frontend/lib/api.ts` vazio).
- Nenhum P0/P1 encontrado: a mudança de assinatura de `baixarRemessa` tem 1 único call site e vem acompanhada de teste de regressão — risco de ruptura já mitigado pelo próprio delta.
- Cross-QA: F-modifiability-1 (duplicação de padrão blob-download) tem overlap com Integrability (dois clientes HTTP divergentes para o mesmo tipo de resposta do backend) — sinalizar para o consolidator. Sem overlap relevante com Testability/Deployability neste delta (sem magic numbers, sem números hardcoded de config).
