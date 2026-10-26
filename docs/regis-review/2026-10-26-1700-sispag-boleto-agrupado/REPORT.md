# Regis-Review — sispag-boleto-agrupado (2026-10-26-1700)

> Escopo: delta da branch `feat/sispag-boleto-agrupado` contra `origin/main` (182 arquivos, ADR-0077, regra
> `boleto-agrupado-sispag` I21a-u, migration 0090). Review REDUZIDO: Fault Tolerance, Security, Integrability e
> Testability. Availability, deployability, modifiability e performance ficaram de fora por escolha de escopo.
> Seções por QA nesta pasta; cards em [`KANBAN.md`](KANBAN.md).

## Veredito

**Score geral: 7,6. Nenhum P0.** Havia 2 P1 corrigíveis em código; os dois foram corrigidos nesta rodada.
Restam 2 P1 que dependem de HML/PRD (provas vivas da retomada e do CNAB v7), a cumprir antes de ligar
`SISPAG_LIVE_WRITE_ENABLED` em PRD.

## Placar

| QA | Score | Peso |
|----|------:|-----:|
| Security | 7,8 | 1,5 |
| Fault Tolerance | 7,5 | 1,3 |
| Integrability | 7,0 | 0,9 |
| Testability | 8,0 | 1,0 |
| **Geral (ponderado, 4 QAs)** | **7,6** | |

## Remediado nesta rodada

- **security-1 e security-3** (`8b81e760`): `anular`, `incluir` e `retirar` agora resolvem a filial do grupo/lote
  (`GrupoBoletoService.filialDoGrupo`, `LotePagamentoService.filialDoLote`) e respondem 403
  `FILIAL_NAO_AUTORIZADA` antes de chamar o serviço. As 4 rotas de escrita chamam o guard (antes 1/4). Testes novos
  cobrem o 403 fora da allow-list, a passagem dentro dela e o grupo/lote inexistente (o serviço responde).
- **fault-tolerance-1** (`a7de54fa`): na retomada, janela vazia não cria mais o segundo borderô às cegas. Uma
  varredura larga (mesma conta e data, ±24h) procura borderô do robô; o que não for de outra execução nossa leva a
  `indeterminado` + alerta `sispag-bordero-grupo-pendente`, com mensagem em português. Falha fechada: o custo é um
  `indeterminado` a mais (analista confere), nunca um borderô duplicado.

## O que foi verificado e está correto

- Write-ahead (`t0` antes do `POST fin010`), `registrarBordero` idempotente, optimistic lock nas etapas, limpeza
  condicionada ao kill-switch e ao `fin015` aberto, alerta com dedupe diário.
- Todas as rotas do grupo com `exigirPermissao`; bodies com Zod `.strict()`; SQL com parâmetros nomeados; sem segredos.
- Conciliação do retorno com chave de idempotência e consulta ao `processadoEm`; partial-pay nunca leva o lote a `BAIXADO`.

## Top 5 riscos restantes

1. **Retomada e CNAB v7 sem prova viva**: HML só passou `canonico` (6/6). Cards fault-tolerance-2, integrability-3, testability-3.
2. **Allow-list fail-open**: sem o claim `permissions.filiais` o guard libera tudo (security-2, security-4).
3. **Baixa gravada no ERP e ausente do ledger** numa queda entre `gravarBaixaSimples` e `registrarBaixa` (fault-tolerance-5, 4).
4. **Partial-pay sem SLA observável**, dependente da analista (fault-tolerance-7); trilha sem evento terminal (fault-tolerance-6).
5. **Contrato do ERP sem fixtures reais nem contador de parse-failure** (integrability-1, 2; testability-1).

## Gates (medidos após as correções)

- Backend: `npx tsc --noEmit` 0 erros; biome sem erros nos arquivos tocados (1 aviso de complexidade pré-existente em `LotePagamentoService`);
  jest nas pastas `domain/service/sispag`, `domain/client/ConexosBaixaClient`, `routes/sispag`: 60 suites / 1.740 testes verdes.
- Frontend não tocado.

## Follow-ups

Cards abertos em `ontology/_inbox/sispag-boleto-agrupado-regis-followups.md`.
