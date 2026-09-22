# tasks.md — SISPAG: o `.REM` baixado pela tela chega com os bytes do ERP

> `/feature-tweak sispag "fix: o .REM baixado sai corrompido — res.text() decodifica como UTF-8
> e o Blob regrava em UTF-8; acento no favorecido desloca as colunas do CNAB 240"`
> Branch: `fix/sispag-rem-download-latin1`
> Ontologia: sem diff — bug de implementação (a regra "o arquivo entregue é byte-a-byte o do ERP"
> já é o que o backend faz em `routes/sispag.ts`, que manda `Buffer` latin1 de propósito).

## Estado de partida

O backend responde `GET /sispag/lotes/:id/remessa/arquivo` com `Buffer.from(conteudo, 'latin1')`.
O frontend desfazia isso em dois passos:

1. `lib/sispag.ts` `baixarRemessa` lia com `res.text()`, que decodifica **sempre** como UTF-8. Cada
   byte latin1 ≥ 0x80 (Ã, Ç, É…) vira U+FFFD.
2. `LoteCard.tsx` montava `new Blob([string])`, e o Blob codifica a string em UTF-8 (o
   `charset=latin1` no `type` não muda os bytes). Cada U+FFFD vira 3 bytes.

Resultado: um favorecido com acento → registro 2 bytes mais longo por caractere → colunas fixas
do CNAB 240 deslocadas.

---

### Task 1: `baixarRemessa` devolve os bytes, e a tela os entrega sem reencodar

**Files to change:**
- `src/frontend/lib/sispag.ts`
- `src/frontend/app/sispag/components/LoteCard.tsx`
- `src/frontend/lib/sispag.test.ts` (novo)

**Acceptance criteria:**
- `baixarRemessa` usa `res.blob()` e devolve `{ nome, arquivo: Blob }`, não mais uma string.
- O `LoteCard` cria a URL de download direto desse `Blob`, sem string intermediária.
- Teste de regressão: bytes latin1 com `0xC3`/`0xC7` saem do `baixarRemessa` idênticos, com o
  mesmo tamanho.
- Resposta não-ok continua lançando `Falha ao baixar a remessa (<status>)`.
- `npm run typecheck`, `npm run lint` e `npm test` do frontend verdes.

**Dependencies:** none
