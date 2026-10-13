---
adr_number: 0067
title: SISPAG — o pool DDA (fin124) sincroniza dentro da ingestão de pagamentos
date: 2026-10-13
status: accepted
type: change
related_entities: [BoletoDda, TituloAPagar]
related_actions: []
related_business_rules: [boleto-exige-codigo-de-barras]
related_state_machines: []
related_integrations: []
continues: [0040, 0060]
evidence:
  - ontology/_inbox/sispag-boleto-dda-tab.md (decisão 1 de 2026-09-24: "só botão manual, sem cron")
  - "medição de 2026-10-13: pool parado em 08/10 14:24 até o botão ser clicado; 207 de 875 títulos BOLETO sem DDA tinham boleto de mesmo valor e dia"
---

# ADR 0067: o pool DDA sincroniza dentro da ingestão de pagamentos

## Contexto

A aba "Boletos DDA (fin124)" nasceu com sincronização **só manual** (botão ou job avulso; decisão 1
da `sispag-boleto-dda-tab`, 2026-09-24). Nenhum cron chama `job:ingest-boletos-dda`. Em 13/10 o pool
estava parado desde 08/10 14:24 — cinco dias — e ninguém viu: a carteira (flag `tem_boleto`, forma
de pagamento, casamento de candidatos) é atualizada três vezes por dia útil e **lê** `boleto_dda`.
Uma carteira nova sobre um pool velho mostra "boleto sem DDA" que o próprio ERP já resolveu.

## Decisão

1. **A ingestão de pagamentos sincroniza o pool DDA antes de ler os títulos.** Cron das 07h/12h/16h
   BRT e a abertura da tela (ADR-0060) passam a mantê-lo fresco pelo mesmo caminho. Sequencial com a
   leitura de títulos, nunca paralelo (cap de sessões do robô; mesmo princípio do ADR-0066 §3).
2. **A sincronização é enriquecimento: nunca derruba a ingestão.** Falha vira WARN, aviso na run
   (`error_message` de uma run `success`) e `dda.estado = falhou` no resultado; o pool anterior fica.
   Lock já ocupado (botão/job) vira `ocupada` e não é aviso. Prazo estourado vira `parcial`.
3. **Prazo de 60 s dentro da ingestão** (`DDA_PRAZO_NA_INGESTAO_MS`). Arquivos novos vão antes dos
   relidos; o que não couber fica para a próxima rodada. A ingestão leva ~10 s; ela não pode passar a
   depender da latência do `fin124`. Botão da aba e job avulso seguem sem prazo.
4. **`titulo_a_pagar.doc_esp_numero`** (migration 0083): guarda o `docEspNumero` do fin064 (número do
   documento do fornecedor). Em 13/10, 34 de 128 pares já resolvidos pelo ERP tinham o `ditEspNumero`
   do boleto igual a ele — propriedade do **credor** (16 de 35 casam sempre, 18 nunca). Servirá para
   confirmar casamentos; esta ADR **não** o usa para decidir nada.
5. **A aba avisa quando o pool está parado** por mais de 8 h em dia útil (Brasília). Fim de semana não
   conta: o banco não manda arquivo.

## Não muda

- **Nenhuma regra de casamento.** Candidato continua "mesmo valor, vencimento ±3 dias"; o vínculo
  continua sendo do Conexos e nunca escrito por nós. Nenhuma escrita nova no ERP.
- A decisão que move dinheiro continua sendo a validação AO VIVO no envio
  (`BoletoSemCodigoBarrasError`), não o pool.

## Consequências

- O pool não envelhece mais que o intervalo entre ingestões (e o atraso do agendador do GitHub).
- Custo: até ~60 s a mais por ingestão no pior caso; típico, só os arquivos novos do dia + a releitura
  da janela de 60 dias (a medir em produção — se for lenta, reduzir `releituraDias` na ingestão).
- A carga completa inicial continua pelo job avulso (sem prazo).

## Rejeitado

- **Cron próprio para o DDA**: mais um pipeline, mais uma sessão do robô, e o resultado só importa
  junto da carteira.
- **Sincronizar depois dos títulos**: deixa o flag uma rodada atrás do pool, que é o defeito de hoje.
- **Falhar a ingestão quando o DDA falha**: a carteira é o produto principal; derrubá-la por causa do
  enriquecimento repete o erro que `titulosComBoletoDda` já evita.
