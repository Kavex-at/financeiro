---
name: PerfilCanalFornecedor
type: entity
ontology_version: "0.36.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/jobs/probe-canal-por-fornecedor.ts
  - src/backend/domain/client/ConexosExtratoClient.ts
properties: [pesCod, credor, contagens, pagamentosUnicos, mesesDistintos, grupoDominante, participacao, confianca, janelaInicio, janelaFim, calculadoEm, jobRunId]
relationships:
  - "PerfilCanalFornecedor 1—1 Favorecido (pesCod; um perfil por favorecido)"
  - "PerfilCanalFornecedor 1—N AlertaItemLote CANAL_HABITUAL"
  - "PerfilCanalFornecedor N—1 JobRun (a rodada de calcularPerfilCanal que o gravou)"
last_review: 2026-10-05
universality_evidence:
  - "probe-canal-por-fornecedor.ts (PRD, 2026-10-05): baixa a pagar (fin010) casada com débito do extrato (fin095), só casamentos únicos; 89% do valor pago em fornecedores de confiança ALTA"
  - "Conceito universal: o canal pelo qual um fornecedor costuma receber é uma linha de base para detectar desvio (fraude de troca de dados bancários); a estrutura é do domínio, os limiares são do cliente"
---

# PerfilCanalFornecedor

> **Origem:** ADR-0063 (2026-10-05). **Read model persistido**: por qual grupo de canal um
> favorecido costuma ser pago, com nível de confiança. Pré-calculado por `calcularPerfilCanal`
> (job periódico, read-only no ERP). Consumido pela verificação TED/PIX (I13i). Code-facing:
> `SupplierChannelProfile`; tabela proposta `sispag_perfil_canal_fornecedor`.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `pesCod` · `credor` | string | Chave (1 perfil por favorecido). A probe agrupou por **nome**; a chave por `pesCod` depende do gap Q4. |
| `contagens` | objeto | Pagamentos com casamento **único** por grupo: `BOLETO`, `TED_PIX`, `OUTROS`. |
| `pagamentosUnicos` | number | Soma das contagens. Casamentos ambíguos não entram. |
| `mesesDistintos` | number | Meses com ≥1 pagamento único. |
| `grupoDominante` | enum | `BOLETO \| TED_PIX \| OUTROS` (constante `CHANNEL_GROUP`). |
| `participacao` | number (0–1) | Fração do grupo dominante. |
| `confianca` | enum | `ALTA \| MEDIA \| BAIXA`. ALTA = limiares do tenant (default ≥5 pagamentos, ≥3 meses, ≥95%). Só ALTA gera alerta. |
| `janelaInicio` · `janelaFim` | Date | Janela de histórico lida. |
| `calculadoEm` · `jobRunId` | Date · string | Rodada que gravou. |

## Grupos de canal

O canal vem do histórico do lançamento no extrato: `PIX` e `TED/DOC/TRANSF` → `TED_PIX`;
`BOLETO/TÍTULO/COBRANÇA/código de barras` → `BOLETO`; tributo, `SISPAG` sem canal e o resto →
`OUTROS`. O vocabulário de histórico é do banco da Columbia (config/heurística de implementação,
não ontologia).

## Regras

- Só casamento **único** baixa × débito (valor exato, data ±1,5 dia) conta. Ambíguo é descartado.
- Favorecido sem perfil = sem alerta de canal. Perfil não-ALTA = sem alerta.
- Rodada que falha não apaga o perfil anterior; o perfil guarda `calculadoEm` para a tela dizer a idade.
