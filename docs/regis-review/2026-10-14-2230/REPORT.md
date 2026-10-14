# Regis-Review reduzido 2026-10-14-2230 — `feat/sispag-passo2-vinculo-codbar` (ADR-0071)

Escopo: delta contra `origin/main` (v0.67.0). 4 QAs escolhidos pelo risco: Fault Tolerance, Security,
Integrability, Testability. Os demais (Availability, Deployability, Modifiability, Performance) não foram
rodados: sem infra, sem mudança de deploy além de uma flag, e o ponto de performance (3 leituras de
rascunho por item, teto ~750k linhas/execução) está registrado como P2 em Fault Tolerance.

| QA | Nota | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Fault Tolerance | 8 | 0 | 1 (corrigido) | 3 | 1 |
| Security | 8 | 0 | 0 | 1 | 4 |
| Integrability | 7,5 | 0 | 1 | 3 | 1 |
| Testability | 8 | 0 | 0 | 1 | 3 |

**Nenhum P0.** Dois itens foram corrigidos por julgamento do orquestrador (`1d28494`):

- **FT F-ft-1 (P1, segurança financeira):** anular a confirmação depois do vínculo deixava o código no item
  do ERP e a retomada o tratava como digitado à mão; o boleto anulado podia seguir para `finalizar`.
  Agora o item vinculado por nós cuja decisão deixou de ser `CONFIRMADA` é retirado pela máquina I16d
  (`VINCULO_CODIGO_BARRAS_FALHOU`, motivo `DECISAO_NAO_CONFIRMADA`) antes de finalizar; em lote nativo
  FINALIZADO aborta; a decisão é relida imediatamente antes do PUT.
- **Testability F-1:** caminhos de falha de `validarCodigoBarras` (recusa de negócio → retira; transitória →
  aborta) agora têm teste.

Demais achados: `ontology/_inbox/sispag-passo2-vinculo-codbar-regis-followups.md`.

Não medível aqui: contrato em PRD (0 de 3 endpoints novos confirmados; V6, V-PRD1, V-PRD2 abertos), que
condiciona `on` em PRD. O código entrega `off`/`shadow` por padrão.
