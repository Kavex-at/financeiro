---
adr_number: 0060
title: A carteira do SISPAG se atualiza ao abrir a tela (TTL de 30 min) e o cron passa a 3 execuções por dia útil
date: 2026-10-05
status: accepted
type: change
related_entities: [TituloAPagar]
related_actions: [ingerirPagamentos]
related_integrations: []
continues: [0016, 0042, 0053]
evidence:
  - src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts
  - src/backend/domain/service/sispag/CarteiraAtualizacaoService.test.ts
  - src/backend/routes/sispag.ts
  - src/backend/http/routePermissions.test.ts
  - src/backend/domain/libs/environment/EnvironmentProvider.ts
  - src/frontend/app/sispag/useCarteiraAoAbrir.ts
  - src/frontend/app/sispag/page.tsx
  - .github/workflows/ingest-sispag.yml
---

# ADR-0060 — Carteira do SISPAG atualizada ao abrir a tela

## Contexto

A carteira de títulos a pagar (`titulo_a_pagar`) era atualizada **uma vez por dia**, pelo cron do GitHub
Actions, mais o botão manual "Ingestão de dados" (`sispag:executar`). Para pagamento, a analista precisa
da carteira quase em tempo real: aprovação de alçada e baixa acontecem o dia todo no Conexos.

O cron não resolve sozinho. O GitHub dispara schedules com atraso: a ingestão marcada para 07:00 BRT
saiu entre 11:29 e 13:48 BRT nas últimas execuções (2 a 5 h depois). A ingestão em si é barata:
**~9 s** medidos no log do cron de 04/10 (7 filiais, ~1,4 mil títulos).

## Decisão

1. **Ao abrir `/sispag`, a tela mostra a carteira já gravada e pede um refresh.** O backend decide se
   roda: só se a última ingestão bem-sucedida tem **mais de 30 min** (`SISPAG_CARTEIRA_TTL_MIN`).
   Quando a ingestão termina, a tela recarrega o painel sozinha (sem spinner de página).
2. **Quem só tem `sispag:ver` pode disparar** (`POST /sispag/carteira/atualizar`). A rota só **lê** o
   Conexos (I1 do SISPAG: nenhuma escrita no ERP) e escreve no Postgres próprio, o mesmo que o cron
   faz. É por isso que o gatilho não exige `sispag:executar`, e o papel Analista (SISPAG só leitura,
   v0.52.0) precisa dele para ver a carteira atual.
3. **Três freios** impedem uma ingestão por abertura de tela: o **TTL**; o **advisory lock** da
   ingestão (uma por vez; contenção devolve `em_andamento`, nunca 409); e o **cooldown** de
   `SISPAG_CARTEIRA_COOLDOWN_MIN` (5 min) depois de uma ingestão que falhou, para que um 403 do robô
   não vire uma tentativa por abertura. Uma run `running` com mais de 10 min é run morta e não bloqueia.
4. **A formação automática de lotes NÃO roda na abertura da tela.** Formar lote cria e desfaz lotes
   que a analista pode estar editando. Continua no cron e no botão explícito.
5. **O cron passa a 07:00 todo dia + 12:00 e 16:00 BRT em dia útil** (`0 10 * * *` e
   `0 15,19 * * 1-5`), como rede de segurança. A formação roda só na execução da manhã e no disparo
   manual (`github.event.schedule == '0 10 * * *'`), o comportamento de antes: várias formações por dia
   fragmentariam os lotes.

## Consequências

- A carteira passa a ter no máximo ~30 min de idade para quem abre a tela, mesmo com o cron atrasado.
- Cada refresh de abertura é uma run em `pagamento_ingestao_run` com `triggered_by = abertura:<usuário>`;
  a tela de histórico mostra "(ao abrir a tela)".
- **A staleness do ADR-0042 não muda**: o limite do `sispag-pagamentos` (30 h) continua valendo; as runs
  novas só deixam a carteira mais fresca. O maior gap normal continua sendo o do fim de semana (24 h).
- O refresh só mantém o **painel** atual. Gerar remessa já relê o título ao vivo no ERP antes de
  escrever (anti-drift), então uma carteira defasada não causa pagamento errado.
- Custo: sessões do Conexos. O TTL, o lock e o cooldown limitam a uma ingestão por vez e a no máximo uma
  a cada 30 min em regime normal.

## Alternativas descartadas

- **Só mais crons**: o GitHub atrasa schedules; mais execuções não dão frescor previsível.
- **Refresh em segundo plano (202 + polling)**: exigiria trabalho após a resposta, o que quebra no alvo
  Lambda. A chamada síncrona (~10 s) é compatível com os dois ambientes.
- **Formar lotes na abertura**: muda a tela de quem está editando (ver decisão 4).

## Reversão

`SISPAG_CARTEIRA_TTL_MIN` alto (por exemplo 1440) torna o refresh de abertura inerte sem redeploy de
código; voltar o cron a `0 10 * * *` desfaz o item 5.
