---
name: PendenciaCadastro
type: entity
ontology_version: "0.36.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/interface/auth/Permission.ts
  - src/backend/routes/sispag.ts
properties: [id, pesCod, credor, tipo, estado, origens, comExcecaoAprovada, abertaPor, abertaEm, resolvidaPor, resolvidaEm, ultimaConferenciaEm]
relationships:
  - "PendenciaCadastro N—1 Favorecido (pesCod no cmn025; sem entidade local)"
  - "PendenciaCadastro 1—N TituloAPagar de origem (filCod:docCod:titCod + loteId de onde a verificação partiu)"
  - "PendenciaCadastro 0..1—0..1 ExcecaoDestino (quando o item ficou no lote pela exceção APROVADA)"
last_review: 2026-10-05
universality_evidence:
  - "PRD 2026-09-28 (ADR-0054): 12/21 favorecidos sem conta e 0 com chave PIX no cmn025; cadastro desatualizado é dor medida, não hipótese"
  - "ADR-0061: cadastro ruim é problema operacional a corrigir no Conexos; a exceção é ponte, não substituto — falta o laço que leva o problema a quem corrige"
  - "Conceito universal: cadastro mestre de fornecedor é mantido por outra área (cadastro/compras); o pagamento que encontra dado faltante abre pendência para essa área"
---

# PendenciaCadastro

> **Origem:** ADR-0063 (2026-10-05). Registro de que um **favorecido precisa de dado de pagamento no
> cadastro do Conexos** (`cmn025`): conta para TED ou chave PIX para PIX. Aberta pela verificação
> TED/PIX (I13j), resolvida **só** quando o cadastro passa a ter o dado (I13k). Code-facing:
> `PayeeRegistrationIssue`; tabela proposta `sispag_pendencia_cadastro`.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `pesCod` · `credor` | string | Favorecido e nome (snapshot para a fila). |
| `tipo` | enum | `CONTA \| CHAVE_PIX` (mesmo vocabulário de `ExcecaoDestino.tipo`). |
| `estado` | enum | `ABERTA \| RESOLVIDA` (constante `PAYEE_ISSUE_STATE`). **No máximo 1 `ABERTA` por (pesCod, tipo).** |
| `origens` | lista | Títulos (`filCod:docCod:titCod`), `loteId`, instante e desfecho do item (`RETIRADO` \| `MANTIDO_POR_EXCECAO`). Ocorrência nova acrescenta origem; não abre pendência nova. |
| `comExcecaoAprovada` | boolean (derivado) | Há `ExcecaoDestino` `APROVADA` do favorecido/tipo: o pagamento segue, mas o cadastro continua por corrigir. |
| `abertaPor` · `abertaEm` | string · Date | `sistema` (verificação). |
| `resolvidaPor` · `resolvidaEm` | string? · Date? | `sistema` (reconferência). |
| `ultimaConferenciaEm` | Date? | Última leitura bem-sucedida do `cmn025` para esta pendência. |

## Ciclo de vida

| De → Para | Gatilho |
|---|---|
| `(novo) → ABERTA` | `verificarItensTedPix` não acha o dado no cadastro (I13j) |
| `ABERTA → ABERTA` | ocorrência nova: acrescenta origem |
| `ABERTA → RESOLVIDA` | reconferência acha o dado: ao abrir/atualizar a fila "Pendências de cadastro" ou em qualquer verificação do favorecido |

Não há resolução manual nem cancelamento: a única saída é o cadastro corrigido. Leitura do `cmn025`
que falha não resolve nem abre (I13b). Quando resolve e havia `ExcecaoDestino` `APROVADA`, a
exceção vai a `SUBSTITUIDA` pela regra já existente (I12c).

## Acesso

Fila "Pendências de cadastro" (in-app) para quem tem **`sispag:cadastro`** (responsável pelo
cadastro). Sem e-mail. Conta/chave nunca aparecem aqui: a pendência é a **ausência** do dado.
