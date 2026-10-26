---
type: regis-review-kanban
run_id: 2026-10-26-1700-sispag-boleto-agrupado
total: 19
counts: { p0: 0, p1: 4, p2: 11, p3: 4 }
remediated: [security-1, security-3, fault-tolerance-1]
---

# Kanban — financeiro — 2026-10-26-1700-sispag-boleto-agrupado

> Review reduzido (fault-tolerance, security, integrability, testability) do delta da branch `feat/sispag-boleto-agrupado`.
> Cada card completo (Problema / Melhoria / Resultado) está na seção do QA indicado. Ordem: P0, P1, P2, P3.
> Remediados nesta rodada: security-1 e security-3 (`8b81e760`), fault-tolerance-1 (`a7de54fa`).

## P0 — Crítico

Nenhum.

## P1 — Alto

| Card | QA | Esforço | Estado |
|---|---|---|---|
| [security-1] Aplicar `assertUserCanActOnFilial` em anular/incluir/retirar grupo | Security | S | REMEDIADO em `8b81e760` |
| [fault-tolerance-1] Endurecer o reconhecimento do borderô pós-queda além da janela de 120s | Fault Tolerance | S | REMEDIADO em `a7de54fa` (varredura larga ±24h, falha fechada) |
| [fault-tolerance-2] Provar `falha`, `retomada` e `v7` em HML + medição PRD GT1/GT2 antes do flag | Fault Tolerance | M | Aberto (exige HML/PRD) |
| [integrability-3] Correr HML V7 e `falha`/`retomada` antes de habilitar PRD | Integrability | M | Aberto (mesmo trabalho do fault-tolerance-2) |

## P2 — Médio

| Card | QA | Esforço | Estado |
|---|---|---|---|
| [security-2] Fail-closed quando o claim `permissions.filiais` estiver ausente | Security | S | Aberto (depende do provisionamento do claim) |
| [fault-tolerance-3] Revalidar `gerNum` do item nativo no `concluirImport` | Fault Tolerance | S | Aberto |
| [fault-tolerance-4] Usar `bxaMnyValor` observado em `anotarBaixa` | Fault Tolerance | S | Aberto |
| [fault-tolerance-5] Fechar `gravarBaixaSimples` + `registrarBaixa` (write-ahead da baixa) | Fault Tolerance | M | Aberto |
| [fault-tolerance-6] Eventos terminais `GRUPO_PAGO`/`GRUPO_J_REJEITADO` na trilha | Fault Tolerance | S | Aberto |
| [fault-tolerance-7] Reaper + bloqueio para partial-pay sem decisão há > N dias | Fault Tolerance | M | Aberto |
| [integrability-1] Fixtures HAR reais do borderô do grupo (consolidado com testability-1) | Integrability | S | Aberto |
| [integrability-2] Contador de parse-failure Zod por endpoint | Integrability | S | Aberto |
| [integrability-5] Reforçar o match do retorno com `filCod`/`bncCod`/`flpCod` | Integrability | S | Aberto |
| [testability-1] Respostas reais do `fin010` como fixtures do client | Testability | S | Aberto |
| [testability-3] Provar retomada e varredura larga em HML | Testability | M | Aberto (mesma prova do fault-tolerance-2) |

## P3 — Baixo

| Card | QA | Esforço | Estado |
|---|---|---|---|
| [security-3] Testes de regressão de 403 por filial nas 3 rotas por UUID | Security | S | REMEDIADO em `8b81e760` |
| [security-4] Documentar na ADR-0077 a autorização por filial (fail-open atual) | Security | S | Aberto |
| [integrability-4] Pinning de versão do Conexos com o fornecedor | Integrability | S/M | Aberto |
| [testability-2] Quebrar `BorderoGrupoBoletoService.test.ts` e extrair o fake do ERP | Testability | M | Aberto |

> Total de origem: 4 + 7 + 5 + 3 = 19 cards; nenhuma fusão feita (as sobreposições estão anotadas).
