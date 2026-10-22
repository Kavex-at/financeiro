---
name: prontidao-lote
type: business-rule
entity: LotePagamento
invariant: I20
ontology_version: "0.47.0"
implementation_status: implemented
status: active
owners: [yuri]
related_files:
  - src/backend/domain/interface/sispag/SituacaoPagamento.ts
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/domain/service/sispag/ProntidaoLoteResolver.ts
  - src/backend/domain/service/sispag/ProntidaoLoteService.ts
  - src/backend/domain/service/sispag/SituacaoPagamentoService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/errors/BatchHasBlockedItemsError.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/routes/sispag.ts
  - src/frontend/lib/sispag.ts
  - src/frontend/app/sispag/lotes/
  - src/frontend/app/sispag/components/LoteCard.tsx
  - src/frontend/app/sispag/page.tsx
last_review: 2026-10-22
has_canonical_test: true
---

# Prontidão do lote em rascunho (ADR-0076)

O lote em RASCUNHO diz, antes de a analista clicar em Finalizar, se finaliza e o que falta.

## Invariantes

| Id | Regra |
|---|---|
| **I20a** | **Calculada no backend, sobre dados gravados.** `GET /sispag/lotes` devolve `prontidao` em cada lote RASCUNHO: `estado` (`PRONTO` \| `COM_PENDENCIA`), `itensQueVao`, `barram`, `saem` e `pendencias[]`. Sem chamada ao Conexos. Lote fora de RASCUNHO não tem `prontidao`. |
| **I20b** | **Cada pendência tem um efeito: `BARRA` ou `SAI`.** `BARRA`: a finalização recusa enquanto existir. `SAI`: a finalização retira o item, que volta a Títulos a pagar. Não há efeito "confira" (P1-1 do plano). `PRONTO` ⇔ nenhuma pendência. |
| **I20c** | **Pendências que barram (as guardas que a finalização já tem):** lote sem itens; lote sem conta pagadora; item sem forma de pagamento (`ModalidadePendenteError`); ajuste de centavos em andamento (`TitleAdjustmentInProgressError`); alerta de duplicidade ABERTO (`PendingDuplicateAlertError`); verificação TED/PIX `PENDENTE` (a leitura não foi possível). |
| **I20d** | **Situação de pagamento barra (nova).** Item cujo título está `BLOQUEADO` pela regra `situacao-pagamento-titulo` (I19) barra a finalização com o motivo principal, o dono e a ação do título. Item cuja situação não pôde ser avaliada (fora da carteira persistida ou fonte de contexto caída) barra como "situação não conferida" (I19s). Na lista, a situação é a da carteira gravada; na finalização, `avaliarVivo` relê aprovação, pagamento e vencimento no `fin064`, e a guarda roda **antes** da verificação TED/PIX (nada é retirado de um lote que vai ser recusado). |
| **I20e** | **Pendências que saem:** o último aviso de autorização gravado no item TED/PIX (ADR-0065): `FAVORECIDO_NAO_AUTORIZADO`, `DESTINO_ALTERADO`, `SEM_DADO_PAGAMENTO`. A tela diz "na última verificação": a finalização relê ao vivo e retira o que ainda estiver errado. |
| **I20f** | **Cada pendência diz quem resolve e o próximo passo:** `{ efeito, codigo, rotulo, detalhe?, dono, acao?, chave?, motivo? }` (`chave` ausente = pendência do lote, ex.: sem conta). `acao` ausente quando o passo é na própria tela do lote (escolher a forma, definir a conta) ou quando a finalização tenta de novo sozinha (verificação pendente); aí o `detalhe` diz o que fazer. Situação de pagamento reaproveita rótulo, dono e ação da I19. Donos: `VOCE`; `APROVADOR` para favorecido não autorizado e destino alterado ("aprova: 2ª pessoa"); `CADASTRO` (novo em `DONO_PAGAMENTO`) para sem conta nem chave PIX. Ordem: do lote primeiro, depois as que barram, depois as que saem; dentro de cada grupo, pelo valor do item. |
| **I20h** | **O botão Finalizar do lote continua habilitado com pendência.** O servidor decide e explica (a verificação pendente, por exemplo, só se resolve tentando). Só a finalização em massa se limita aos lotes `PRONTO`. |
| **I20g** | **Finalizar os prontos em massa** usa a finalização de cada lote, um por vez, só sobre lotes `PRONTO`, com resultado por lote. Um lote que falha não desfaz os outros. Sem endpoint novo. |

## Casos canônicos

1. Lote com 3 itens sem pendência → `PRONTO`, `itensQueVao = 3`.
2. Um item com alerta de duplicidade aberto → `COM_PENDENCIA`, `barram = 1`; Finalizar recusa.
3. Um item TED com `autorizacaoAviso = FAVORECIDO_NAO_AUTORIZADO` → `saem = 1`, `itensQueVao = n − 1`; não barra.
4. Item cujo título ficou `ALCADA` depois da inclusão → pendência `BARRA` com dono `APROVADOR` e ação "Abrir no Conexos"; Finalizar recusa com o motivo, sem retirar nenhum item TED/PIX.
5. Fonte `DUPLICIDADE` caída ao listar → itens com "situação não conferida" (`BARRA`).
6. Lote sem conta pagadora → pendência do lote (sem `chave`), `BARRA`.
7. "Finalizar os 3 lotes prontos" com um deles recusado no servidor → 2 finalizados + 1 recusado com a mensagem.
