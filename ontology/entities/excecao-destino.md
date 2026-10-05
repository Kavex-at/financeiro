---
name: ExcecaoDestino
type: entity
ontology_version: "0.1"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0075_sispag_excecao_destino.sql
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/domain/repository/sispag/ExcecaoDestinoRepository.ts
  - src/backend/domain/service/sispag/ExcecaoDestinoService.ts
  - src/backend/domain/service/sispag/ExcecaoSubstituicaoService.ts
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/domain/libs/sispag/ExcecaoDestinoRule.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/excecoes/page.tsx
  - src/frontend/app/sispag/excecoes/components/ExcecoesTable.tsx
  - src/frontend/app/sispag/excecoes/components/CadastrarExcecaoDialog.tsx
  - src/frontend/app/sispag/excecoes/components/AprovarExcecaoDialog.tsx
  - src/frontend/app/sispag/excecoes/components/RevogarExcecaoDialog.tsx
  - src/frontend/lib/sispag.ts
properties: [id, pesCod, filCod?, tipo, bancoCod, agencia, agenciaDv, conta, contaDv, chavePixTipo, chavePix, titularDocumento, estado, origem, cargaId?, justificativa, cadastradoPor, cadastradoEm, decididoPor, decididoEm, motivoDecisao, substituidaEm, versao]
relationships:
  - "ExcecaoDestino N—1 Favorecido (pesCod no cmn025; sem entidade local, como em TituloAPagar)"
  - "ItemLote N—0..1 ExcecaoDestino (a exceção usada, congelada no import; ADR-0060)"
  - "ExcecaoDestino 1—N EventoExcecaoDestino (trilha só-inclusão; é o ledger, não entidade de domínio)"
last_review: 2026-10-05
universality_evidence:
  - "Entrevista do usuário (Columbia/Yuri), 2026-10-05: cadastro desatualizado/ausente (12/21 favorecidos sem conta, 0 chave PIX; PRD 2026-09-28, ADR-0054) exige caminho controlado fora do cadastro"
  - "Conceito: toda trading que paga fornecedor com conta diferente da cadastrada precisa de exceção com segunda aprovação (controle antifraude). Estrutura (registro por favorecido, duas pessoas, auditoria) é ontologia; valores (contas) são dado operacional. 1 cliente apenas: revisar universalidade quando aparecer o 2º (gap Q11, Francinei)"
---

# ExcecaoDestino

> **Origem:** ADR-0060 (2026-10-05). Destino de pagamento (conta TED ou chave PIX) de um favorecido
> **diferente do cadastro do Conexos**, registrado e aprovado por duas pessoas, reutilizável em
> qualquer lote. Substitui o `DestinoManual` por item da ADR-0054. Estados em
> `state-machines/excecao-destino.md`; regras em `business-rules/excecao-destino-sispag.md`.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | Identificador. |
| `pesCod` | number | Favorecido no `cmn025`. Escopo da exceção (por favorecido, não por item). |
| `filCod?` | number | Só se o gap Q9 decidir por filial. Hoje **não** faz parte da chave. |
| `tipo` | `CONTA \| CHAVE_PIX` | `CONTA` serve a TED; `CHAVE_PIX` a PIX. |
| `bancoCod` · `agencia` · `agenciaDv?` · `conta` · `contaDv` | string | Só `CONTA`. Gravados completos, exibidos mascarados (I10h). |
| `chavePixTipo` · `chavePix` | enum · string | Só `CHAVE_PIX`; **só `CPF_CNPJ`**, e a chave = `pdcDocFederal` do favorecido (I10i). |
| `titularDocumento` | string (CPF/CNPJ) | Obrigatório; igual a `pdcDocFederal` lido ao vivo (I10i). |
| `estado` | enum | `PENDENTE \| APROVADA \| REJEITADA \| SUBSTITUIDA \| REVOGADA` (constantes tipadas). |
| `origem` | enum | `MANUAL \| PLANILHA`. |
| `cargaId?` | string | Id da carga, quando `origem = PLANILHA`. |
| `justificativa` | string | Por que o destino difere do cadastro. |
| `cadastradoPor` / `cadastradoEm` | string / Date | Id do usuário autenticado. |
| `decididoPor` / `decididoEm` / `motivoDecisao` | string / Date / string | Aprovação, rejeição ou revogação. Motivo obrigatório em rejeição e revogação. |
| `substituidaEm` | Date? | Quando o cadastro assumiu; a divergência vai na trilha. |
| `versao` | number | Controle otimista. |

**Unicidade (I12a):** no máximo 1 `APROVADA` por (favorecido, tipo). **Sem expiração.**

## Diferenças para entidades vizinhas

- `DestinoManual` (ADR-0054): era value object **por item** e prevalecia sobre o cadastro; foi
  retirado. A exceção é por favorecido e só vale quando o cadastro não tem destino válido.
- `ExcecaoPermuta`: outro domínio (Frente I), outro ciclo de vida.
