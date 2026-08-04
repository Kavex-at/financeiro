---
adr_number: 0024
title: NDe eletrônica = documento fiscal com297 homologado (corrige a suposição com299 docVldTipo=7 do plano §8.B); homologação como passo terminal live-capable gated OFF; rota contingência × normal por vldTpNf (predicado finDocIsContingenciaHomologacao invertido p/ fail-loud); leg de geração com297 = info-gap
date: 2026-07-30
status: accepted
type: correction
related_entities: [NotaDebitoEletronica, Recebimento]
related_actions: [executarRecebimento]
supersedes_decisions: []
amends_decisions: [0022]
---

# ADR 0024: NDe eletrônica = com297 homologado (não com299)

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:** `fix/recebimentos-nde-com297`
(worktree, base `fix/recebimentos-alocar-sn` / PR #36). **Relacionado:** ADR-0022 (bootstrap Frente IV;
este ADR **emenda** a decisão D1 sobre o canal de emissão da NDe), `integrations/conexos-com299-gerdoc.md`
(leg financeira), `business-rules/idempotencia-quitacao-nde.md` (I-Receb-2). **Fonte:** homologação
`homologaNfe`/`homologaNfeContingencia` (engenharia reversa do controller Angular do `com297`) +
`docx telas Conexos.docx` (cadeia manual com299 → fin014 → com297). **`entity_changed = true`** —
canal de emissão da NDe pinado; +1 integração, +1 business-rule (I-Receb-3).

## Contexto

O plano de Frente IV (§8.B) assumiu que a **Nota de Débito Eletrônica** seria um documento **com299**
`docVldTipo=7` ("NOTA DEBITO"), finalizado via `com299/finalizaDocumento`. Ao detalhar a fatia de
"Geração da NDe", duas fontes concretas mostraram outra coisa:

1. **O contrato de homologação** (`homologaNfe`/`homologaNfeContingencia`) opera no **`com297`**
   ("Fiscais de Saída" — NF-e de saída), com um passo final de **homologação** (autorização SEFAZ).
2. **O docx** descreve a cadeia manual real: **com299** (gerar o doc **financeiro** do adiantamento) →
   **fin014** (baixa) → **com297** (gerar o doc fiscal: produto `41978`, número `0`, "Tipo de nota de
   débito = Pagamento antecipado", gerar observações, **homologar**).

Ou seja: o com299 `docVldTipo=7` é a leg **financeira** (já modelada como Solicitação de Numerário,
`conexos-com299-gerdoc.md`); a NDe **eletrônica** propriamente dita é o **com297 homologado** — é a
**homologação** que a torna *eletrônica* (documento fiscal autorizado).

## Decisão

1. **Canal FISCAL da NDe = com297 homologado.** A NDe eletrônica é emitida gerando um documento fiscal
   de saída no `com297` e **homologando-o** (`POST com297/{homologaNfe|homologaNfeContingencia}/{docCod}`,
   body `{}`, `docCod` no PATH). Isto **emenda** a D1 do ADR-0022 (que dizia "endpoint a confirmar Fase
   5, junto do write O3"): o endpoint terminal está confirmado.

2. **Escopo desta fatia = só a homologação (passo terminal).** A leg de **GERAÇÃO** do com297 (que
   mint o `docCod`: gerar-documento, setar tipo-de-débito via Fiscal, gerar-observações) é só **UI** no
   docx — **info-gap** (`_inbox/recebimentos-nde-com297-gap.md`), próxima fatia.

3. **Live-capable, gated OFF.** O `ConexosNdeClient.homologar` faz o **POST real** (`postGenericOnce`,
   fail-closed), mas o orquestrador (`ConexosNdeEmitter`) só dispara com escrita ligada
   (`conexosWriteEnabled && !conexosDryRun`) **e** `Recebimento.emissaoNde` presente. O binding default
   de `NDE_EMITTER_TOKEN` segue no stub; o swap é o passo de go-live.

4. **Rota por `vldTpNf`, fail-loud.** A decisão contingência × normal é uma função pura de `vldTpNf`
   (predicado original `["11","12"].indexOf(vldTpNf) !== -1`). Invertemos o predicado fail-open do UI:
   `{11,12}` → contingência; allowlist normal explícita → normal; ausente/desconhecido → **recusa**
   (`VldTpNfAusenteError`/`VldTpNfDesconhecidoError`). Ver `business-rules/homologacao-nde-com297.md`
   (I-Receb-3).

5. **200 ≠ sucesso.** Branch obrigatório em `docVldComvalidacoes` (1 emitida / 2 emitida-com-aviso /
   default recusa). Nunca marcar um 200 como concluído.

## Consequências

- **Positivas:** a NDe deixa de ser "endpoint a confirmar" e ganha um contrato terminal implementado e
  testado; a decisão de contingência (antes tida como fiscal-policy) reduz-se a uma regra pura + uma
  questão de dado (distribuição de `vldTpNf`); a doutrina de escrita irreversível (postGenericOnce,
  não-retryable) protege contra dupla-homologação.
- **Custos / dívidas:** o fluxo end-to-end ainda **não** roda — falta a leg de GERAÇÃO com297 (mint do
  `docCod`) e o **seed** de `NDE_NORMAL_TP_NF_CONHECIDOS` (hoje vazio → recusa docs normais de
  propósito). Ambos gated-before-live no info-gap. O canal com299 `docVldTipo=7` do plano §8.B fica
  reclassificado como leg financeira (não é a NDe fiscal).

## Alternativas consideradas

- **Manter com299 `docVldTipo=7` como a NDe** (plano §8.B): rejeitado — contradiz o contrato de
  homologação e o docx; o com299 é a leg financeira que *precede* a fiscal.
- **Replicar o predicado do UI como está** (fail-open p/ normal): rejeitado — silenciaria códigos
  novos (ex.: variante SVC) roteando-os p/ normal; preferimos recusar e alertar (fail-loud).
- **Dry-run seam (NotImplementedError) como a SN:** rejeitado nesta fatia — o contrato de homologação é
  completo, então a decisão foi por um client **live-capable** (POST real) gated OFF, em vez de um seam
  inerte.
