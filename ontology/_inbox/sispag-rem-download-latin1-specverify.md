# SpecVerify — sispag-rem-download-latin1  (v1, 2026-09-22T00:00:00Z)

| Task | Criterion | Veredito | Evidência (arquivo:linha ou output) |
|------|-----------|----------|--------------------------------------|
| Task 1 | `baixarRemessa` usa `res.blob()` e devolve `{ nome, arquivo: Blob }`, não mais string | APROVADO | `src/frontend/lib/sispag.ts:456-461` — assinatura `Promise<{ nome: string; arquivo: Blob }>`, `return { nome, arquivo: await res.blob() }` |
| Task 1 | `LoteCard` cria a URL de download direto desse `Blob`, sem string intermediária | APROVADO | `src/frontend/app/sispag/components/LoteCard.tsx:309-312` — `const { nome, arquivo } = await baixarRemessa(l.id)` seguido de `URL.createObjectURL(arquivo)`, sem `new Blob([string])` |
| Task 1 | Teste de regressão: bytes latin1 `0xC3`/`0xC7` saem de `baixarRemessa` idênticos, mesmo tamanho | APROVADO | `src/frontend/lib/sispag.test.ts:15-33` — `expect(arquivo.size).toBe(bytes.length)` e `expect(Array.from(await lerBytes(arquivo))).toEqual(Array.from(bytes))`; execução: `npx jest lib/sispag.test.ts` → `Tests: 2 passed, 2 total` |
| Task 1 | Resposta não-ok continua lançando `Falha ao baixar a remessa (<status>)` | APROVADO | `src/frontend/lib/sispag.ts:451` (`if (!res.ok) throw new Error(...)`, inalterado) + teste `sispag.test.ts:35-38` (`rejects.toThrow('Falha ao baixar a remessa (404)')`), passou |
| Task 1 | `npm run typecheck`, `npm run lint` e `npm test` do frontend verdes | APROVADO | `npm run typecheck` → sem erros (`tsc --noEmit` limpo); `npm run lint` → exit 0, "20 problems (0 errors, 20 warnings)" — os 20 warnings são `react-hooks/set-state-in-effect` em arquivos não tocados por este diff (sidebar.tsx, AuthProvider.tsx, metricas/page.tsx etc.), nenhum em `sispag.ts`/`LoteCard.tsx`/`sispag.test.ts`; `npm test` → `Test Suites: 46 passed, Tests: 379 passed` |

## Veredito final: APROVADO

## AMBIGUOS (defeitos de spec → InfoGapBroker P1)
Nenhum.
