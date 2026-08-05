---
name: gerarSolicitacaoNumerario
type: action
entity: SolicitacaoNumerario
ontology_version: "0.13"
implementation_status: partial
status: revogada-desligada-da-ui
owners: [yuri]
related_files:
  - src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts
  - src/backend/domain/client/ConexosGerDocProcessoClient.ts
  - src/backend/domain/repository/permutas/NumerarioExecucaoRepository.ts
  - src/backend/routes/permutas.ts
  - src/frontend/app/permutas/page.tsx
  - src/frontend/app/permutas/components/ConfirmarProcessamentoDialog.tsx
last_review: 2026-08-05
preconditions:
  - "REVOGADA como efeito do Processar (ADR-0029): esta ação NÃO é mais disparada por nenhuma tela."
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
  - "NENHUM no fluxo Processar — o Processar voltou a executar a baixa fin010 (ADR-0029)."
---

# gerarSolicitacaoNumerario — REVOGADA como efeito do "Processar"

> ## ⛔ REVOGADA em 2026-08-05 (ADR-0029) — trilha DESLIGADA DA UI, NÃO validada em produção
>
> O botão **"Processar"** (aba Automáticas) **voltou a executar a baixa `fin010`**
> (`reconciliarAdiantamento` → `ReconciliacaoPermutaService`), como era até 2026-07-30. A regra vigente
> do Processar é a de 2026-06-24 ("Automáticas baixam") — ver `actions/permuta/reconciliar.md`.
>
> **Por que:** a SN da **Frente I (Permutas)** e a SN da **Frente IV (Recebimentos)** são **processos
> DIFERENTES**. A semelhança entre `GerarSolicitacaoNumerarioService` e `RecebimentoNumerarioService`
> fez as duas trilhas serem tratadas como uma só: todas as correções medidas contra o ERP real foram
> para o lado dos Recebimentos e nenhuma para cá. Em produção o Processar quebrou — 3 SNs falharam,
> porque este payload ainda envia `items[]` (SELECTION_ERROR, HAR doc 18339), não manda
> `pdcDocFederal`/`endCodFis` reais e não completa o documento antes de finalizar.
>
> **Invariante I-Permuta-6:** trilha de Permuta e trilha de Recebimento são independentes. Uma
> correção validada numa **não** vale na outra por semelhança de código.
>
> O serviço e a rota `POST /permutas/adiantamentos/:docCod/gerar-numerario` continuam no repositório,
> só para experimentação em **dry-run**. Religá-los exige HAR próprio e validação própria. O texto
> abaixo descreve a trilha **como implementada**, e permanece como ponto de partida — **não** como
> regra vigente do Processar.
>
> **Vigência anterior (revogada):** v0.11 (2026-07-31) — o Processar gerava a SN em vez da baixa.

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
