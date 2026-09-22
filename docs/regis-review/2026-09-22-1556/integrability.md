---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-22-1556
agent: qa-integrability
generated_at: 2026-09-22T15:56:00-03:00
scope: frontend
score: 8.5
findings_count: 2
cards_count: 1
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor adicionando um 3º ponto de download de arquivo binário/latin1 do backend (ex.: retorno Nexxera, PDF do GED) | Precisa buscar um `Blob` do backend, extrair `filename` do `Content-Disposition` e disparar o download sem corromper bytes | `src/frontend/lib/*.ts` (camada de cliente HTTP do frontend) | Desenvolvimento, `--quick`, delta isolado (`fix/sispag-rem-download-latin1`) | Deveria existir **um** primitivo `downloadBlob`/`parseContentDispositionFilename` compartilhado a reusar | **1** implementação de "buscar blob + extrair filename + disparar download" no repo (hoje: **2**, `lib/api.ts` e `lib/sispag.ts`, divergentes) |

O delta em si é um bug fix correto e bem-testado: substitui `res.text()` (decodifica sempre UTF-8) por `res.blob()` em `baixarRemessa`, eliminando a re-codificação que deslocava colunas fixas do CNAB 240. Do ponto de vista de Integrability, o efeito líquido é **positivo**: reduz de 2 para 1 o número de lugares que precisam saber que o `.REM` é latin1 (antes o frontend replicava `type: 'text/plain;charset=latin1'` no `Blob`; agora esse conhecimento vive só no header `Content-Type` do backend, e o `Blob` herda o tipo automaticamente). O único débito remanescente é que o fix não aproveitou o primitivo de download já existente no repo.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Call sites de `baixarRemessa` (fan-out do rename `conteudo`→`arquivo`) | 1 (`LoteCard.tsx:309`) | ≤ 2 | ✅ | `grep -rn baixarRemessa src/frontend` |
| Implementações independentes de "fetch blob + parse `Content-Disposition` + disparar download" no frontend | 2 (`lib/api.ts:585-625` `exportarRelatorio`/`parseContentDispositionFilename`; `lib/sispag.ts:450-458` `baixarRemessa`) | 1 | ⚠️ | `src/frontend/lib/api.ts:585,599-625`; `src/frontend/lib/sispag.ts:450-458` |
| Locais que codificam o conhecimento "este arquivo é latin1" (antes → depois do delta) | 2 → 1 (só o header `Content-Type` do backend; o front deixou de fixar `charset=latin1` no `Blob`) | 1 | ✅ | diff `LoteCard.tsx` (removida a linha `new Blob([conteudo], { type: 'text/plain;charset=latin1' })`) |
| `res.text()` remanescente em paths de download de arquivo no frontend | 0 | 0 | ✅ | `grep -rn "\.text()" src/frontend/lib` |
| Teste de regressão com bytes latin1 reais (0xC3/0xC7) verificando paridade byte-a-byte | 1 (`sispag.test.ts`) | ≥1 por endpoint de download binário | ✅ | `src/frontend/lib/sispag.test.ts:19-35` |
| `URL.revokeObjectURL` protegido por `try/finally` | `lib/api.ts`: sim; `LoteCard.tsx` (não tocado pelo delta): não | consistente | ⚠️ (pré-existente, fora do delta) | `lib/api.ts:616-625` vs `LoteCard.tsx:309-316` |

## 3. Tactics — Cobertura no nf-projects (recorte do delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `baixarRemessa` continua sendo o único ponto que conhece a URL/rota do endpoint; a assinatura devolve `Blob` opaco ao caller. | ✅ presente | `src/frontend/lib/sispag.ts:450-458` |
| Use an Intermediary | `apiFetch` segue como intermediário único (401 centralizado); o delta não o contorna. | ✅ presente | `src/frontend/lib/http.ts:28-34` |
| Restrict Communication Paths | Único call site (`LoteCard.tsx`) — sem novos consumidores diretos do endpoint. | ✅ presente | grep acima |
| Adhere to Standards | Content-Type/charset e `Content-Disposition` seguem o padrão HTTP; o front agora confia no header em vez de replicar a decisão. | ✅ presente | `src/backend/routes/sispag.ts:468-474` + `sispag.ts:450-458` |
| Abstract Common Services | O repo já tinha um primitivo de download por blob (`exportarRelatorio` + `parseContentDispositionFilename` em `lib/api.ts`). O delta reimplementou a mesma lógica (fetch → blob → parse filename → `createObjectURL`) em `lib/sispag.ts` em vez de extrair/reusar um helper compartilhado. | ⚠️ parcial | `src/frontend/lib/api.ts:585-625` vs `src/frontend/lib/sispag.ts:450-458` |
| Discover Service | N/A — endpoint fixo, sem descoberta em runtime. | N/A | — |
| Tailor Interface | N/A ao delta — não há adaptação de shape externo aqui, é bytes passthrough. | N/A | — |
| Configure Behavior | N/A ao delta. | N/A | — |
| Manage Resources | `URL.revokeObjectURL` chamado após `a.click()`, mas não dentro de `try/finally` em `LoteCard.tsx` (código pré-existente, não tocado pelo delta) — se `a.click()` lançar, a URL do objeto vaza. `lib/api.ts` já faz isso corretamente. | ⚠️ parcial (pré-existente) | `LoteCard.tsx:309-316` vs `lib/api.ts:616-625` |
| Orchestrate | N/A — chamada única e linear, sem coordenação de múltiplos clients. | N/A | — |
| Manage Resource Coupling | N/A ao delta. | N/A | — |
| Contract testing | Novo teste (`sispag.test.ts`) valida paridade byte-a-byte com bytes latin1 reais (0xC3/0xC7) mockando `apiFetch` — cobre a regressão específica do bug corrigido. Não é um teste de fixture contra o backend real, mas é adequado ao escopo (`--quick`, frontend-only). | ✅ presente (proporcional ao escopo) | `src/frontend/lib/sispag.test.ts:19-44` |
| Versioning strategy | N/A — contrato interno FE↔BE do mesmo monorepo, versionado em lockstep (CLAUDE.md), não é integração externa. | N/A | — |
| Backward-compatibility shims | Mudança de shape (`conteudo: string` → `arquivo: Blob`) é breaking, mas o único caller foi atualizado no mesmo commit — sem shim necessário dado o fan-out de 1. | ✅ presente (não se aplicava shim) | diff `LoteCard.tsx` |
| Observability of integration failures | Falha de rede/HTTP segue lançando `Error` genérico (`Falha ao baixar a remessa (<status>)`), sem telemetria por dependência — padrão idêntico ao pré-existente, não regressão do delta. | ⚠️ parcial (herdado, não introduzido pelo delta) | `src/frontend/lib/sispag.ts:454` |

## 4. Findings (achados)

### F-integrability-1: segunda implementação independente de "download de blob + parse de filename" no frontend

- **Severidade**: P2 (débito técnico defensável — não quebra nada hoje, mas é o padrão que causou o próprio bug corrigido por este delta)
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/frontend/lib/sispag.ts:450-458` (novo) vs `src/frontend/lib/api.ts:585-625` (já existente, não tocado)
- **Evidência (objetiva)**:
  ```ts
  // lib/api.ts:585-590 — já existe:
  function parseContentDispositionFilename(header: string | null): string | undefined {
    if (!header) return undefined
    const match = /filename="?([^"]+)"?/.exec(header)
    return match?.[1]
  }
  // lib/api.ts:611-615 — já faz blob + createObjectURL corretamente

  // lib/sispag.ts:455-457 — delta reimplementa a mesma coisa, com regex ligeiramente diferente:
  const disp = res.headers.get('Content-Disposition') ?? ''
  const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? `lote-${loteId}.REM`
  return { nome, arquivo: await res.blob() }
  ```
- **Impacto técnico**: o repositório agora tem 2 implementações de "buscar arquivo do backend e baixar no browser", com regex de `Content-Disposition` levemente divergentes (`parseContentDispositionFilename` aceita aspas opcionais; a de `sispag.ts` exige aspas). O próprio bug que este delta corrige (usar `res.text()` em vez de `res.blob()`) só existiu porque não havia um único primitivo a reusar — o padrão correto já estava em `lib/api.ts`, mas não foi descoberto/reaproveitado.
- **Impacto de negócio**: cada novo endpoint de download (GED, retorno Nexxera, PDF do SharePoint — todos no roadmap imediato) tem a mesma chance de reintroduzir a corrupção UTF-8/latin1 se implementado do zero pela 3ª vez, em vez de herdar automaticamente o comportamento correto de um helper único.
- **Métrica de baseline**: 2 implementações independentes de download-blob no frontend hoje; alvo é 1.

### F-integrability-2: `revokeObjectURL` fora de `try/finally` no único call site do delta

- **Severidade**: P3 (baixo — vazamento de URL de objeto só em caminho de erro raro, não introduzido por este delta)
- **Tactic violada**: Manage Resources
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:309-316` (código não alterado pelo diff, mas é exatamente o bloco que o delta tocou para o rename `conteudo`→`arquivo`)
- **Evidência (objetiva)**:
  ```tsx
  const url = URL.createObjectURL(arquivo)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
  ```
  Comparar com `lib/api.ts:616-625`, que envolve o mesmo padrão em `try { ... } finally { URL.revokeObjectURL(url) }`.
- **Impacto técnico**: se `a.click()` lançar (raro, mas possível em navegadores com bloqueio de pop-up/política de segurança), a URL do objeto nunca é revogada — vazamento de memória por download.
- **Impacto de negócio**: baixo — tela usada esporadicamente por poucos operadores; não é um caminho de alta frequência.
- **Métrica de baseline**: 1 de 2 implementações de download no frontend protege `revokeObjectURL` com `finally`; a que o delta tocou não.

## 5. Cards Kanban

### [integrability-1] Extrair um `downloadBlobFromResponse` compartilhado para `lib/api.ts` e `lib/sispag.ts`

- **Problema**
  > O frontend tem duas implementações independentes de "buscar blob do backend, extrair filename do `Content-Disposition` e disparar o download" (`lib/api.ts::exportarRelatorio` e `lib/sispag.ts::baixarRemessa`), com regexes de filename ligeiramente divergentes e tratamento de `revokeObjectURL` inconsistente. O bug que este delta corrigiu (`res.text()` corrompendo bytes latin1) é sintoma direto de não haver um único primitivo testado para essa operação.

- **Melhoria Proposta**
  > Extrair um helper único (`downloadBlob(res: Response, fallbackFilename: string): Promise<{ nome: string; arquivo: Blob }>` ou equivalente, incluindo `URL.createObjectURL` + `try/finally` + disparo do `<a>`) em `lib/http.ts` ou novo `lib/download.ts`. Migrar `exportarRelatorio` e `baixarRemessa` para reusá-lo. Tactic: Abstract Common Services.

- **Resultado Esperado**
  > Implementações de download-blob no frontend: 2 → 1. Próximos endpoints de download (GED, retorno Nexxera, PDF SharePoint) herdam automaticamente byte-fidelity e `revokeObjectURL` seguro, sem reimplementar.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1, F-integrability-2
- **Métricas de sucesso**:
  - Implementações independentes de download-blob: 2 → 1
  - Call sites protegidos por `try/finally` no revoke: 1/2 → 2/2
- **Risco de não fazer**: próximo endpoint de download binário (GED/Nexxera/SharePoint, todos no roadmap `/feature-new` imediato) tem chance real de reintroduzir a mesma classe de bug corrigida aqui.
- **Dependências**: nenhuma — refactor isolado ao frontend, sem mudança de contrato de backend.

## 6. Notas do agente

- Escopo estritamente delta-only (`--quick`, frontend), conforme instrução. Não reavaliei o cliente `ConexosClient` nem os clients de backend — fora do diff.
- Nenhum P0/P1: o delta corrige um defeito real sem introduzir novo débito crítico; o efeito líquido em Integrability é positivo (reduz duplicação de conhecimento de encoding entre FE e BE de 2 para 1 lugar).
- Cross-QA: F-integrability-1 também é relevante para **Modifiability** (mesma duplicação de código aumenta custo de mudança futura em ambos os pontos) — mesmo achado, mesmo ofensor, sinalizar ao consolidator para não duplicar o card.
