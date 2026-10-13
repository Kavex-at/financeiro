---
adr_number: 0066
title: SISPAG — os lotes sincronizam com o ERP ao abrir a tela, e o "Sincronizar agora" vira um só
date: 2026-10-13
status: accepted
type: change
related_entities: [LotePagamento]
related_actions: [sincronizarStatus]
related_business_rules: [sincronizacao-status-lote-sispag]
related_state_machines: [lote-pagamento]
related_integrations: []
continues: [0055, 0060]
evidence:
  - ontology/_inbox/sispag-sync-ao-abrir-ontology-diff.md (proposta aprovada em 2026-10-13, com a emenda do botão único)
---

# ADR 0066: os lotes sincronizam ao abrir a tela, e o "Sincronizar agora" vira um só

## Contexto

O cron `sincronizar-lotes-sispag.yml` (`48 11-22 * * 1-5`, 12 passadas por dia útil) rodou de fato
2–3 vezes por dia: em 07/10 às 17:57 e 23:19 UTC, em 08/10 às 17:59 e 23:33 UTC e em 09/10 nenhuma
vez até 14:06 UTC. Lotes já baixados no Conexos ficaram em `REMESSA_GERADA` até a analista clicar
em "Sincronizar agora" no card. A analista espera ver a tela atualizada ao abri-la, como já
acontece com a carteira (ADR-0060). O atraso do agendador do GitHub Actions não está sob nosso
controle.

## Decisão

1. **Abertura da tela** vira gatilho de L11 `sincronizarStatus`, com *stale-while-revalidate*: a
   passada completa roda só se a última run **finalizada** do pipeline `sispag-sincronizacao` em
   `job_execucao` tiver mais que o TTL (default 30 min, configuração).
2. **Freios do ADR-0060**: TTL, uma passada por vez (run em andamento mais nova que o limiar de
   stale bloqueia outra) e cooldown depois de passada que falhou. Contenção nunca é erro para a tela.
3. **Depois da carteira, nunca junto.** Cada uma faz fan-out 4 no Conexos, e o robô tem cap de
   sessões (`LOGIN_ERROR_MAX_SESSIONS`).
4. **Um único "Sincronizar agora"** na tela substitui o botão por lote: força a passada completa
   (ignora TTL e cooldown, respeita "uma por vez"). Toda passada (abertura, botão, cron) grava run
   em `job_execucao` e conta para o TTL. A rota por lote (`POST /sispag/lotes/:id/sincronizar`)
   responde `410`, como a L7 aposentada.
5. **Permissão `sispag:ver`** para os dois gatilhos de tela: L11 só lê o ERP (I11a/I11g). Antes o
   botão por lote era admin.
6. **Prazo da passada** (default 120 s, configuração; a passada leva ~25 s): estourado, a run fecha
   em `error` com o motivo, a trava é solta e a passada para antes do próximo lote. Sem prazo, uma
   leitura pendurada no Conexos prenderia a trava até o processo reiniciar: toda abertura diria
   "em andamento" e o cron pularia em silêncio (achado do Regis-Review 2026-10-13-1518). O prazo é
   da passada, não do client HTTP do Conexos, que também escreve (retry depois de timeout duplicaria
   escrita). O lote que estiver no meio quando o prazo estoura pode terminar depois; o optimistic
   lock (I6) cobre a corrida com a passada seguinte.
7. **O cron continua** como rede de segurança. **Nenhuma invariante I11a–h muda.**

## Consequências

- Quem abre a tela vê o status com no máximo TTL de defasagem, sem depender do GitHub Actions.
- Custo: no máximo uma passada por TTL na abertura, serializada atrás da carteira. O botão custa
  uma passada completa (~25 s medidos no cron, a maior parte lendo o `fin052`), não ~1 s de um lote;
  a tela mostra "sincronizando…" enquanto isso.
- Passada sem mudança não sobe `versao` (I11h): aberturas repetidas não geram conflito de versão.

## Rejeitado

- **Só consertar o cron**: o atraso do agendador não é nosso (REJECT-NOT-DOMAIN).
- **Rodar junto com a carteira**: até 8 sessões simultâneas do robô, risco de derrubar os crons.
- **Manter o botão por lote ao lado do global**: dois caminhos para a mesma coisa, e a passada de
  um lote não grava run, então não contaria para o TTL.
