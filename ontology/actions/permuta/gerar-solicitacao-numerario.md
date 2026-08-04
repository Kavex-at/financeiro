---
name: gerarSolicitacaoNumerario
type: action
entity: SolicitacaoNumerario
ontology_version: "0.11"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts
  - src/backend/domain/client/ConexosGerDocProcessoClient.ts
  - src/backend/domain/repository/permutas/NumerarioExecucaoRepository.ts
  - src/backend/routes/permutas.ts
  - src/frontend/app/permutas/page.tsx
  - src/frontend/app/permutas/components/ConfirmarProcessamentoDialog.tsx
last_review: 2026-07-31
preconditions:
  - "Adiantamento EXISTE (findAdiantamento) com priCod/pesCod/filCod conhecidos."
  - "valor (= valorASerUsado do modal) > 0 e ≤ saldo do adiantamento."
  - "Requer papel admin (requireRole('admin'))."
  - "Escrita irreversível gated: só faz o POST com CONEXOS_WRITE_ENABLED=true E CONEXOS_DRY_RUN=false (default dry-run)."
postconditions:
  - "dry-run → monta e loga o payload gerDocProcesso (valor, itens Σ==valor), NENHUM POST, retorna preview."
  - "escrita → cria 1 SolicitacaoNumerario no ERP (com299/gerDocProcesso); docCod = data.messages[i].vars.docCod; trilha vira settled."
  - "UMA SN por adiantamento processado."
side_effects:
  - "Escrita irreversível no com299/gerDocProcesso (postGenericOnce, tentativa única)."
  - "Trilha write-ahead NumerarioExecucaoRepository (reconciling→settled/error), idempotência por adiantamento."
  - "NÃO executa mais a baixa fin010 no fluxo Processar (substitui a reconciliação)."
---

# gerarSolicitacaoNumerario — Processar gera a SN em vez da baixa

> **Vigência:** v0.11 (2026-07-31). O botão **"Processar"** (aba Automáticas) passa a
> **gerar uma Solicitação de Numerário** no ERP (`com299/gerDocProcesso`) em vez de
> executar a baixa `fin010`. Uma SN por adiantamento; `valor` = `valorASerUsado` do modal
> (moeda negociada, sem conversão).

## Fluxo de 3 telas (guia "telas Conexos")

`GerarSolicitacaoNumerarioService.gerarNumerario` (`src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts`)
orquestra, por adiantamento:

1. `findAdiantamento(docCod)` → `priCod`, `pesCod`, `filCod`; `valor = valorASerUsado`; data/número = hoje (DDMMYYYY).
2. **Tela 1 (com299):** `validaConfigDoc(gcdCod=150)` + `contasProj/list` → `itens[]` (`tmpMnyValor=round2(valor×total/100)`, Σ==valor);
   `gerDocProcesso` (postGenericOnce) → SN `docCod`; **finaliza** (`validate/finalizacaoDocumento` → `finalizaDocumento`). CONFIRMADO.
3. **Tela 2 (fin014):** `ConexosFin014Client.registrarRecebimento` (data crédito + conta FIN_134 + docCod da SN). **GAP → `NumerarioGapError` fail-closed.**
4. **Tela 3 (com297):** nota de débito (`Produto=41978`, `Número=0`) + fiscal "Pagamento antecipado" + observações + homologar. **GAP fail-closed nesta trilha (permutas).** A cauda fiscal (com300 `fisVldTipoNfDebito=6` → com131 observações SINIEF → com297 homologar → poll SEFAZ) já foi **especificada e implementada no lado dos Recebimentos** (v0.12, `RecebimentoNumerarioService` + `ConexosNdeFiscalClient`) — ver `actions/recebimentos/gerar-solicitacao-numerario.md`, `integrations/conexos-nde-fiscal.md` e `integrations/recebimentos-numerario-real-fiscal-spec.md`. A promoção desta trilha permutas para reusar essa cauda é follow-up.
5. **Gate:** `dryRun = !conexosWriteEnabled || conexosDryRun || override` → monta+loga os payloads das 3 telas, retorna preview (sem POST).
6. Write-ahead + retomada: `begin` → cada etapa grava progresso (`setSnDocCod`/`setEtapa`); SN já gerada NÃO é recriada; `markSettled`/`markError(etapa)`.

## Rota

`POST /permutas/adiantamentos/:docCod/gerar-numerario` (`requireRole('admin')`, `asyncHandler`),
body `{ valor: number>0, dryRun?: boolean }` → `GerarSolicitacaoNumerarioService.gerarNumerario`.
Espelha a forma de `POST /permutas/adiantamentos/:docCod/reconciliar`.

## Gating + idempotência

- **Gate de escrita:** mesmo par `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN` da baixa (default dry-run).
- **Idempotência por adiantamento:** chave `numerario:{adiantamentoDocCod}:{valor}` na trilha
  (`NumerarioExecucaoRepository`) — SN já `settled` p/ o mesmo adto+valor é pulada (evita documento duplicado,
  crítico porque `gerDocProcesso` é irreversível). Estado `reconciling` órfão (com/sem docCod) = FAIL-CLOSED
  (conferir manualmente no ERP antes de re-tentar), espelhando `ReconciliacaoPermutaService`.
- Todas as rotas `requireRole('admin')`.

## Por que está na ontologia (universalidade)

A geração de uma requisição de numerário a partir de um adiantamento de um processo de importação é
do domínio de comex (Frente I). A estrutura (derivar config/rateio do ERP → montar o documento →
gravar gated e idempotente) é invariante; os valores (`gcdCod=150`, `priCod`, `pesCod`) são instâncias
do tenant. A escolha "Processar gera a SN em vez da baixa" é decisão de produto registrada aqui.
