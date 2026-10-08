# Tasks — SISPAG: títulos a pagar (filtro de comprometidos, selecionar todos, export)

> **Feature:** `sispag-titulos-filtro-export` · **Branch:** `fix/sispag-titulos-filtro-export`
> **Modo:** `/feature-tweak` — implementação/UI; sem mudança de entidade, ação ou invariante
> (sem diff de ontologia). ADR-0064 (lote de uma filial só; comprometido não se move) segue intacta.

## Decisões (entrevista, 2026-10-08)
- **D1** — Títulos em lote **comprometido** (`FINALIZADO` ou `REMESSA_GERADA`, ADR-0064) ficam
  **ocultos por padrão** na aba "Títulos a pagar". Um botão de filtro "Em lote finalizado/remessa (N)"
  os traz de volta. Nenhum deles é selecionável, então escondê-los não muda o que a analista pode fazer.
- **D2** — "Selecionar todos" **mantém o bloqueio** com várias filiais no filtro; o motivo deixa de
  ser só tooltip de um checkbox desabilitado e aparece como texto visível ao lado da contagem.
- **D3** — Export `.xlsx` dos títulos a pagar respeitando o **filtro atual** da aba (faixa, filial,
  busca, vencimento, boleto, comprometidos). O front manda as chaves das linhas filtradas; o back relê
  a carteira persistida (fonte do painel) e monta a planilha — nunca confia em valores vindos do cliente.

## Tasks

| # | Task | Acceptance |
|---|------|-----------|
| 1 | Filtro de comprometidos na aba Títulos | Por padrão, título com `loteComprometido` não aparece na tabela nem na contagem do filtro; o botão mostra quantos estão ocultos e, ligado, eles voltam com o cadeado de hoje. Teste puro cobre o filtro. |
| 2 | Motivo do "selecionar todos" visível | Com o bloqueio ativo (várias filiais ou nada selecionável), o texto do motivo aparece ao lado da contagem de selecionados; regra de bloqueio inalterada. |
| 3 | `TitulosAPagarExportService` + `POST /sispag/titulos/exportar` | Zod: 1..5000 chaves compactas `filCod:docCod:titCod` (objetos estourariam o limite de 100 KB do `express.json()` — 5000 chaves realistas cabem, com teste); `SISPAG_VER`; `heavyRouteLimiter`. Relê `listAtivos` + lotes rascunho/comprometidos; mantém a ordem pedida; chave fora da carteira ativa é ignorada e contada no log. Colunas: Filial, Credor, Documento, Valor, Moeda, Vencimento, Dias p/ vencer, Boleto DDA, Aprovação, Pronto p/ remessa, Lote, Banco. Linha de totais. Testes do service (projeção) e da rota (400/200). |
| 4 | Botão "Exportar (.xlsx)" na aba Títulos | Exporta `abaTitulos.filtrados` (todas as páginas, não só a visível); desabilitado com 0 linhas; toast de sucesso/erro; sessão expirada não vira toast. Teste do cliente `lib/sispag`. |

## Gates
typecheck · lint · test (BE+FE) · PatternGuardian · DesignSystemReviewer · SpecVerifier · Regis-Review (`--quick`, escopo do delta) · rebase main · bump `feat` → minor.
Ground-Truth: N/A — não há lógica monetária alimentada pelo Conexos (projeção da carteira já ingerida).
