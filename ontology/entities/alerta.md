---
name: Alerta
type: entity
ontology_version: "0.31.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0052_alerta.sql
  - src/backend/domain/interface/operacao/Alerta.ts
  - src/backend/domain/interface/operacao/AlertSink.ts
  - src/backend/domain/repository/operacao/AlertaRepository.ts
  - src/backend/domain/service/operacao/NotificacaoService.ts
  - src/backend/domain/service/operacao/DbAlertSink.ts
  - src/backend/domain/service/sispag/AjusteCentavosTituloService.ts
last_review: 2026-10-21
properties:
  - id
  - tipo
  - alvo
  - severidade
  - dedupKey
  - janelaInicio
  - detalhe
  - criadoEm
  - notificadoEm
  - sinkResultados
---

# Alerta

> Um incidente operacional detectado pelo sistema, **persistido** antes de ser notificado.

## Por que persistir

Três razões, nesta ordem:

1. **Deduplicação (I1).** Um staleness que dispara a cada rodada do detector vira ruído, e um canal
   ruidoso é um canal que o time aprende a ignorar. O `dedupKey` é o que impede isso.
2. **O próprio painel é um sink.** `DbAlertSink` é o que faz o alerting funcionar no dia 1, sem
   credencial nenhuma — o alerta aparece no Painel de Operação (ADR-0042).
3. **Histórico.** "Isso já aconteceu antes?" é a primeira pergunta de qualquer investigação, e hoje
   ela não tem resposta.

## `dedupKey`

Derivado de `(tipo, alvo, janela)`. Mesmo incidente na mesma janela → o `Alerta` já existe e nada
novo é emitido. Janela nova → alerta novo, porque um pipeline parado há dois dias merece ser dito
de novo.

## Tipos

| `tipo` | `alvo` | Origem |
|---|---|---|
| `job-falhou` | `pipeline` | run terminou `error` |
| `job-parcial` | `pipeline` | run terminou `partial` (contas/filiais falhadas) |
| `job-parado` | `pipeline` | `detectarStaleness` — sem `success` dentro do limite |
| `config-ausente` | nome da var | `validarConfiguracao` — var obrigatória não configurada |
| `sispag-baixa-divergente` | id do lote | `sincronizarStatus` — título antes pago voltou a aberto, ou item `REJEITADO` com título pago (I11f, ADR-0055) |
| `sispag-lote-retornado` | id do lote | transição para `RETORNADO` (L10/L11, ADR-0055) |
| `sispag-destino-alterado` | `favorecido:{pesCod}:{modalidade}` | destino do favorecido autorizado mudou no cadastro — reaprovação aberta (ADR-0065, F4) |
| `sispag-ajuste-centavos-parado` | `{filCod}:{docCod}/{titCodOrigem}` | ajuste de centavos (ADR-0074, I18h) parou em `indeterminado` (severidade `erro`: resolver a renegociação no `fin070`; o lote do título não finaliza) ou `aguardando_aprovacao_manual` (severidade `aviso`: aprovar o título novo no `fin103`). Janela = início do dia civil BRT (`BankingCalendar.startOfTodayBrt`): no máximo um alerta por ajuste parado por dia. `detalhe.acao` diz o que fazer; nunca código de barras completo (só máscara 5+4). Migração 0088. |
| `sispag-bordero-grupo-pendente` | id do `GrupoBoleto` | borderô `fin010` de um boleto agrupado (ADR-0077, `implemented`) que o sistema não pode limpar sozinho: J rejeitado com o borderô ainda em cadastro (I21r), limpeza pedida depois de o lote nativo ser finalizado ou ter `.REM` gerado (I21q), borderô antigo não resolvido numa nova remessa, ou reconhecimento `indeterminado` (dois ou mais borderôs na busca por janela de `borTimCad`; `borCod` reusado pelo ERP com outro `borTimCad`) (I21s). `detalhe` cita `borCod`, filial, os títulos e o que fazer (excluir/cancelar no ERP, ou deixá-lo pendente para reaproveitamento); nunca código completo. |

## Teto conhecido deste desenho

`DbAlertSink` não pode alertar sobre o backend estar fora — se o processo não sobe, ninguém escreve
a linha. Mesma classe do ponto cego do detector em GH Actions (ADR-0042). É o argumento mais forte
para o pinger externo, registrado como follow-up e fora deste slice.
