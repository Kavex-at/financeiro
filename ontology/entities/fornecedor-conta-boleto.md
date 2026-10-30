---
name: FornecedorContaBoleto
type: entity
ontology_version: "0.53.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0093_sispag_fornecedor_conta_boleto.sql
  - src/backend/domain/interface/sispag/FornecedorContaBoleto.ts
  - src/backend/domain/libs/boleto/ContaBeneficiariaBoleto.ts
  - src/backend/domain/repository/sispag/FornecedorContaBoletoRepository.ts
  - src/backend/domain/service/sispag/ConsolidacaoFornecedorConta.ts
  - src/backend/domain/service/sispag/AprendizadoFornecedorBoletoService.ts
  - src/backend/domain/service/sispag/FornecedorBoletoDda.ts
  - src/frontend/app/sispag/components/BoletosDdaTab.tsx
---

# FornecedorContaBoleto

> **Origem:** ADR-0081 (2026-10-30). Quem é o fornecedor de um boleto DDA, **aprendido** da conta do
> beneficiário codificada nas barras. É evidência para a tela, não autoridade de pagamento.

## O que é e o que não é

- **É** um mapeamento derivado `chave da conta → (pesCod, credor)`, reconstruído a cada sincronização do pool DDA.
- **Não é** `ConfirmacaoEmissorBoleto` (par credor × emissor afirmado por uma pessoa, I15). Esta é aprendida,
  sem ator humano próprio; uma decisão `CONFIRMADA` da analista é uma das suas **fontes**.
- **Não é** fonte de verdade de nada: não escreve no Conexos, não autoriza vínculo, não muda a situação do boleto.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `chave` (PK) | string | `237:<agência>/<conta>`, `341:<agência>/<conta>`, `033:<beneficiário>`, `001:<convênio>`. Só bancos com layout validado. Nunca sai por API. |
| `pesCod` · `credor` | string? · string? | Ausentes quando `ambiguo`. `credor` = o nome mais frequente do `pesCod` (empate: o mais recente). |
| `origem` | `VINCULADO \| CONFIRMADO \| INFERIDO` | A mais confiável com evidência para a chave. `INFERIDO` aparece como "provável". |
| `ambiguo` | boolean | 2+ `pesCod` distintos na origem vencedora. Nunca se nomeia. |
| `evidencias` · `ultimaEvidenciaEm` | number · Date | Boletos distintos (por barras) e a última vez vistos na origem vencedora. |

## Regras

- **I-FC1** Origem mais confiável vence; inferência nunca torna ambígua uma chave vinculada/confirmada.
- **I-FC2** 2+ fornecedores na origem vencedora → ambígua, sem nome.
- **I-FC3** Aprende-se ao fim de `BoletoDdaService.sincronizar`; a leitura da aba não escreve; o
  `bootstrapAppContainer` não aprende (gotcha do CLAUDE.md).
- **I-FC4** Banco sem layout validado não gera chave nem nome.
