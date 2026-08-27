# tasks — sispag-boleto-dda

> Tweak de `SISPAG` / `TituloAPagar` / `LotePagamento`: o boleto deixa de ser tratado como
> PIX/TED. O código de barras passa a chegar na remessa pela associação DDA do próprio ERP.
> Evidência: `ontology/_inbox/sispag-boleto-dda-sondagem.md` (4 sondas read-only em PRD +
> 2 testes de escrita em HML, mecanismo provado ponta a ponta).
> Branch: `feat/sispag-boleto-dda`.

## Contexto em uma tela

- O barcode **nunca está no título** (0% em `fin064`, `titulosPendentes`, `com308`).
- O `fin124` (DDA) tem 100% dos barcodes, mas 0% de vínculo, e o pool **não é por filial**.
- O vínculo que vale é o flag `titVldReflexoDdaAssoc` do grid de pendentes — mandamos `0` fixo.
- Mandando `1` + respondendo `answers: { "<id>": "YES" }` à pergunta
  `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`, **o ERP anexa o barcode e escolhe a
  modalidade correta sozinho** (6 = mesmo banco, 7 = outro banco).

## T1 — `importarTitulos`: associar o DDA e responder a pergunta do barcode

**Arquivo:** `src/backend/domain/client/ConexosSispagWriteClient.ts`

- `ImportarTitulosParams` ganha `associarDda?: boolean` (default `false` — comportamento atual).
- Quando `true`, `selecao.titVldReflexoDdaAssoc = 1`.
- Ao receber `QUESTION` cuja **única** pergunta é `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`,
  re-POSTar o MESMO body com `answers: { [q.id]: 'YES' }` — **uma vez só**.
- **Allowlist estrita.** Qualquer outra chave de pergunta continua virando `ErpPerguntaError`
  (a doutrina do repo é não auto-responder; `PESSOA_FAVORECIDA_SEM_CONTA_ATIVA…` altera forma de
  pagamento e segue exigindo humano). A allowlist é uma constante nomeada, não um `includes` solto.
- Log `BUSINESS_INFO` a cada auto-resposta (auditoria de escrita no ERP).

**Aceite**
- [ ] `associarDda: false` produz o body byte-a-byte igual ao de hoje (teste de regressão).
- [ ] `associarDda: true` + QUESTION do barcode → 2º POST com `answers: { '1': 'YES' }` → resolve.
- [ ] QUESTION de outra chave → `ErpPerguntaError`, **sem** 2º POST.
- [ ] Duas perguntas no mesmo envelope (uma delas fora da allowlist) → `ErpPerguntaError`.
- [ ] O re-POST acontece **no máximo uma vez** (pergunta repetida não vira loop).

## T2 — `TituloPendente` expõe o flag de DDA

**Arquivo:** `ConexosSispagWriteClient.paraTituloPendente` + `SispagInterface.ts`

- `TituloPendente` ganha `temBoletoDda: boolean` (de `titVldReflexoDdaAssoc === 1`).

**Aceite**
- [ ] `titVldReflexoDdaAssoc: 1` → `temBoletoDda: true`; ausente/`0` → `false`.
- [ ] `raw` continua verbatim (a identidade do import não pode ser reescrita).

## T3 — `RemessaService`: parar de mandar barras vazia, deixar o ERP decidir a modalidade

**Arquivo:** `src/backend/domain/service/sispag/RemessaService.ts` (`montarItensImport`)

- Remover `titEspCodbar: pendente.raw.titEspCodbar ?? ''` — medido 0%; mandar string vazia é
  o que produz segmento J sem barcode.
- Item cujo pendente tem `temBoletoDda` → `associarDda: true` no import daquele item.
- Para esses itens **não** forçar `itsVldModalidade`: o ERP deriva do banco emissor do barcode
  (medido: mandamos 6, o ERP gravou 7 porque o boleto era 745). Os demais seguem com
  `MODALIDADE_NATIVA`.
- `MODALIDADE_NATIVA.BOLETO` ganha comentário com o encoding medido (6 = mesmo banco / 7 = outro)
  e a nota de que só vale para boleto **sem** DDA.

**Aceite**
- [ ] Nenhum item de import sai com `titEspCodbar: ''`.
- [ ] Item com `temBoletoDda` → `importarTitulos` recebe `associarDda: true`.
- [ ] Item sem DDA e modalidade não-boleto → payload inalterado (regressão).
- [ ] `importarTitulos` segue sendo chamado **um item por chamada** (regra do `SELECTION_ERROR`).

## T4 — Invariante: BOLETO sem barcode não vira remessa (fail-closed no envio)

**Arquivos:** novo `domain/errors/BoletoSemCodigoBarrasError.ts`, `RemessaService.ts`

- Antes do import, item com `modalidade === 'BOLETO'` **e** pendente sem `temBoletoDda` →
  `BoletoSemCodigoBarrasError` (código `BOLETO_SEM_CODIGO_BARRAS`, 409, `userMessage` dizendo
  qual doc/tit e que o boleto precisa entrar pelo arquivo DDA ou mudar a forma de pagamento).
- Validação **ao vivo no envio** (decisão do Yuri: não bloqueia o rascunho).

**Aceite**
- [ ] BOLETO + sem DDA → erro tipado **antes** de qualquer POST de escrita.
- [ ] BOLETO + com DDA → passa.
- [ ] Mensagem nomeia `docCod/titCod` (a analista precisa saber qual título sanear).

## T5 — Carteira: `tem_boleto` passa a vir do flag de DDA

**Arquivos:** `IngestaoPagamentosService.ts`, `TituloAPagarRepository.ts`, `ConexosSispagClient.ts`

- `mapTitulo` para de derivar `temBoleto` de `titEspCodbar` (sempre `null`) — passa a ser
  preenchido pela ingestão a partir do grid de pendentes.
- Na ingestão, por filial: `listarLotesNativos(filCod, bncCod Itaú)` → maior `flpCod` como
  **contexto de leitura** → `listarTitulosPendentes` → conjunto de `filCod:docCod:titCod` com
  `temBoletoDda` → alimenta `tem_boleto` no upsert.
- Filial sem lote nenhum → degrada em silêncio (`tem_boleto = false`) + `BUSINESS_WARN`.
  Nunca derruba a ingestão (mesma doutrina do fan-out por filial).

**Aceite**
- [ ] Título no conjunto do grid → `tem_boleto = true` persistido.
- [ ] Filial sem lote → ingestão conclui `success`, warn emitido, títulos persistidos.
- [ ] Falha na leitura do grid de UMA filial não afeta as outras.
- [ ] `mapTitulo` não referencia mais `titEspCodbar` para decidir boleto.

## T6 — UI: coluna na carteira + badge no lote

**Arquivos:** `src/frontend/app/sispag/page.tsx`, `components/LoteCard.tsx`, `lib/sispag.ts`

- Carteira: coluna **"Boleto"** — badge quando `temBoleto` (persistido, palpite).
- `LoteCard`: badge por item a partir da leitura **ao vivo**, e aviso visível quando a
  modalidade é BOLETO sem boleto disponível (o caso que o T4 vai barrar no envio).

**Aceite**
- [ ] Coluna renderiza sem quebrar o layout responsivo da tabela.
- [ ] Badge distingue "tem boleto" de "sem boleto" sem depender só de cor.
- [ ] `DesignSystemReviewer` verde.

## T7 — Ontologia + ADR

- `entities/titulo-a-pagar.md`: redefinir `temBoleto` (fonte = flag DDA do grid, não `titEspCodbar`).
- `integrations/conexos.md`: registrar `fin124` (leitura), o protocolo `answers` como
  `Map<id,String>` e a allowlist de auto-resposta.
- ADR novo: "boleto SISPAG vem da associação DDA do ERP" — inclui a decisão de auto-responder
  **uma** pergunta allowlistada e por que as demais continuam humanas.
- `business-rules/`: regra do fail-closed do T4.

**Aceite**
- [ ] `_index.json` / `_coverage.json` atualizados.
- [ ] ADR numerado sem colidir com `origin/main`.

## Fora de escopo (follow-up)

- Ingerir o `fin124` para dentro do nosso banco: o pool é global e sem vínculo — não agrega
  sobre o flag do ERP. Só vale se aparecer necessidade de exibir o boleto cru.
- Resíduo manual (73% dos boletos reais em PRD têm barras sem `vldVinculoDda`): confirmar com a
  Flávia se o caminho DDA cobre tudo. Ver P1 na sondagem.
