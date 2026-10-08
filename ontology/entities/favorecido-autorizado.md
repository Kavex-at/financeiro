---
name: FavorecidoAutorizado
type: entity
ontology_version: "0.38.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties: [id, pesCod, credor, modalidade, estado, fingerprint, fingerprintChaveId, destinoMascarado, avisos, fingerprintObservado, destinoObservadoMascarado, origemSolicitacao, solicitadoPor, solicitadoEm, decididoPor, decididoEm, motivoDecisao, ultimaConferenciaEm, ultimaConferenciaResultado, versao]
relationships:
  - "FavorecidoAutorizado N—1 Favorecido (pesCod no cmn025; sem entidade local, como em TituloAPagar)"
  - "ItemLote N—0..1 FavorecidoAutorizado (id gravado no congelamento I10f; só rastreio, nunca o valor)"
  - "FavorecidoAutorizado 1—N EventoFavorecidoAutorizado (trilha só-inclusão; ledger, não entidade de domínio)"
last_review: 2026-10-08
universality_evidence:
  - "Entrevista do usuário (Columbia/Yuri), 2026-10-08: a conferência por lote (ADR-0063) foi rejeitada pelo custo; a troca de conta no cmn025, vetor clássico de fraude, não era comparada com nenhum valor aprovado"
  - "Conceito universal de contas a pagar: dados bancários do fornecedor aprovados por segunda pessoa e revalidados a cada pagamento (vendor bank master verification). Estrutura = ontologia; a lista e os destinos = dado operacional"
  - "1 cliente apenas: revisar universalidade com o Francinei (não bloqueante, decisão do Yuri em 2026-10-08)"
---

# FavorecidoAutorizado

> **Origem:** ADR-0065 (2026-10-08). Fornecedor (favorecido) que **pode receber por TED ou PIX**,
> amarrado ao **destino exato** lido do cadastro do Conexos (`cmn025`) no momento da aprovação, por
> duas pessoas. Substitui a conferência por lote (ADR-0063) e a `ExcecaoDestino` (ADR-0061, apagada).
> Code-facing: `AuthorizedPayee` (constante `AUTHORIZED_PAYEE_STATE`). Tabelas propostas:
> `sispag_favorecido_autorizado` e trilha só-inclusão `sispag_favorecido_autorizado_evento`
> (trigger recusa UPDATE/DELETE/TRUNCATE). Estados em `state-machines/favorecido-autorizado.md`;
> regras em `business-rules/favorecido-autorizado-sispag.md` (I14).

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `pesCod` · `credor` | number · string | Favorecido no `cmn025`; `credor` = snapshot do nome. Sem `filCod` (o cadastro é global). |
| `modalidade` | `TED \| PIX` | Autorizações separadas: trocar a chave PIX não derruba o TED, e aprovar TED não libera PIX. |
| `estado` | enum | `PENDENTE \| AUTORIZADO \| REJEITADO \| REAPROVACAO_PENDENTE \| REVOGADO`. **No máximo 1 vigente** (`PENDENTE`, `AUTORIZADO`, `REAPROVACAO_PENDENTE`) por (`pesCod`, `modalidade`). |
| `fingerprint` | string? | Impressão digital keyed (HMAC, segredo do tenant) do destino normalizado que o resolvedor I10 escolhe **no momento da aprovação**. TED: banco + agência + DV + conta + DV; PIX: tipo + chave. Nulo enquanto nunca aprovado. |
| `fingerprintChaveId` | string? | Versão do segredo usado. Rotação do segredo não é "destino mudou": compara-se só na mesma versão. |
| `destinoMascarado` | string? | Exibição: banco e agência completos, conta com os 4 últimos dígitos; PIX com o tipo e um trecho da chave. O valor completo **não** é persistido (fonte = `cmn025`). |
| `avisos` | lista | Não bloqueiam a aprovação. Ex.: `PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO`. |
| `fingerprintObservado` · `destinoObservadoMascarado` | string? | Preenchidos quando o sistema abre `REAPROVACAO_PENDENTE` (antes × agora). |
| `origemSolicitacao` | `ITEM \| RELATORIO \| MANUAL` | De onde veio o pedido. |
| `solicitadoPor` · `solicitadoEm` | string? · Date? | Quem pediu (ou, na reaprovação, quem confirmou o pedido), com `sispag:executar`. **Nunca** `sistema`: na reaprovação fica nulo até alguém confirmar. |
| `decididoPor` · `decididoEm` · `motivoDecisao` | string? · Date? · string? | Aprovação, rejeição ou revogação. Motivo obrigatório em rejeição e revogação. |
| `ultimaConferenciaEm` · `ultimaConferenciaResultado` | Date? · enum? | `IGUAL \| DIFERENTE \| SEM_DADO \| FALHA_LEITURA`. Alimenta o selo de conferência. |
| `versao` | number | Lock otimista. |

**Sem expiração.** Vive até ser revogada.

## Diferenças para entidades vizinhas

- `ExcecaoDestino` (ADR-0061, **apagada** pela ADR-0065): era um destino **fora** do cadastro. Aqui o
  destino é **sempre** o do cadastro; o que se aprova é o par (favorecido, destino).
- `PerfilCanalFornecedor`: estatística de canal; alimenta o relatório de candidatos, nunca autoriza.
- `BloqueioDuplicidade`: bloqueia um **título**; a autorização libera um **favorecido**.
