# Diff de ontologia — `sispag-dda-paridade` (APROVADO e APLICADO em 2026-10-30)

> **Aprovado por Yuri em 2026-10-30** (Q6, Q10 e a guarda de Q11 inclusive). Aplicado na v0.53.0:
> `entities/boleto-dda.md` (I-DDA5, botão com prazo, lista vazia não apaga, urgência),
> emenda 2026-10-30 da ADR-0067, `_coverage.json` `_meta` e `_index.json`.

> Base: ontologia **v0.52.0** (`ontology/_coverage.json`, 2026-10-29) em `origin/main` @ `23c68339`.
> Lido: `entities/boleto-dda.md`, `entities/grupo-boleto.md` (só referência), `business-rules/
> sugestao-boleto-dda-sispag.md`, `business-rules/boleto-agrupado-sispag.md`, ADRs 0040, 0067, 0068,
> 0077, `_inbox/sispag-dda-na-ingestao-regis-followups.md`, `_inbox/sispag-boletos-dda-regis-followups.md`.
> Aplicar só depois do "aprovado" do Yuri na entrevista (`sispag-dda-paridade-interview.md`).

## Resumo

| Item | Muda? | Tipo |
|---|---|---|
| Entidade nova / ação nova / estado novo | **não** | — |
| Situação do boleto (`VINCULADO`/`CANDIDATO`/`AMBIGUO`/`SEM_TITULO`) | **não** (mesma regra I15c/I15e; a aba só agrupa) | — |
| Regra de sugestão (I15*) e de grupo (I21*) | **não** | — |
| Filial de exibição do boleto + semântica do filtro de filial (Q6) | **sim** | emenda de prosa na entidade `BoletoDda` + invariante de tela **I-DDA5** |
| Prazo do botão "Atualizar DDA" (Q10) | **sim** | emenda da ADR-0067 + frase da entidade `BoletoDda` §Sincronização |
| Urgência do boleto ("vencem hoje / até 2 dias", Q5) | **sim, pequena** | frase na entidade: dia civil BRT do vencimento do boleto, `VINCULADO` fora |
| Significado de `sincronizadoEm` / aviso "DDA parado" (F5.1) | **não** nesta feature | follow-up (muda regra de sync) |
| Janela de releitura de 60 dias (F5.2) | **não** | follow-up |
| Guarda contra lista vazia (F5.3) | só se Q11 aprovar; é proteção, não regra nova | se entrar: frase na §Sincronização |
| Totais R$, cards, filtros de coluna, skeleton, cache, abort | **não** (UI/performance, derivado) | — |

Se o Yuri recusar Q6 e Q10 (manter "boleto sem filial passa em qualquer filial" e botão sem prazo),
**nada muda na ontologia**: o tweak vira UI + fetch puro, sem ADR, e só o `related_files` da
entidade ganha os arquivos novos.

Versão proposta: **v0.53.0** (padrão do repo: emenda de entidade/ADR sobe minor). Atenção: os PRs
draft #138/#139 (renegociação) podem também subir a ontologia; quem fizer merge depois rebaseia e
renumera.

## 1. `entities/boleto-dda.md`

### 1a. §"Pool global" (Q6)

Antes:

> O pool é da **conta pagadora**, não da filial: o header `Cnx-filCod` não o escopa. Um boleto só
> ganha filial quando é vinculado (ou, na aba, pelo candidato único).

Depois:

> O pool é da **conta pagadora**, não da filial: o header `Cnx-filCod` não o escopa. Um boleto só
> ganha filial quando é vinculado. Na aba, a **filial de exibição** é a do vínculo; sem vínculo, a
> filial comum a **todos** os candidatos (um ou vários); sem isso, o boleto é **"sem filial"**.
>
> - **I-DDA5 — filtro de filial não deixa passar boleto sem filial.** Filtrar por uma ou mais
>   filiais mostra e conta só boletos daquelas filiais; "sem filial" é uma opção própria do filtro,
>   com total. (Antes da v0.53.0 o boleto sem filial passava em qualquer filtro e inflava a contagem
>   de cada filial.) A filial de exibição é derivada, não persistida, e não altera I-DDA1/I-DDA2.

### 1b. §"Sincronização" (Q10, Q5, e Q11 se aprovado)

Antes:

> - Botão "Atualizar DDA" (admin) — sem prazo.

Depois:

> - Botão "Atualizar DDA" (`sispag:executar`) — com o **mesmo prazo da ingestão** (60 s,
>   `DDA_PRAZO_NA_INGESTAO_MS`): o que está em voo termina, o resto fica para a próxima passada
>   (`arquivosAdiados`). O resultado separa arquivos lidos, adiados e com falha.

(Também corrige "(admin)": a permissão é `sispag:executar` desde a ADR-0053, como já diz §Acesso.)

Acrescentar ao fim da seção:

> **Urgência na aba.** "Vence hoje" e "vence em até 2 dias" usam o vencimento **do boleto** como dia
> civil BRT (`BankingCalendar.todayBrt`, ADR-0070) e excluem `VINCULADO`. Faixas iguais às de
> Títulos a pagar (`VENCIDO`/`HOJE`/`1-2`/`3-7`/`8+`).

Só se Q11 aprovar o item 3:

> **Lista vazia não apaga.** Se o `fin124` devolve zero itens para um arquivo que tinha itens, o
> snapshot desse arquivo é mantido e a passada registra `warn` (conta como falha do arquivo).
> Arquivo cancelado continua saindo pelo `cancelado_em`.

### 1c. Front-matter

- `ontology_version: "0.53.0"`, `last_review: 2026-10-30`.
- `related_files` += os arquivos novos (lista final no fim da implementação; ver o plano).

## 2. `decisions/0067-sispag-dda-sincroniza-dentro-da-ingestao.md` — emenda 2026-10-30 (Q10)

> **Emenda 2026-10-30 (feature `sispag-dda-paridade`).** O botão "Atualizar DDA" passa a usar o
> mesmo prazo da ingestão (60 s). Motivo: sem prazo, o botão relia todos os arquivos importados nos
> últimos 60 dias numa única requisição HTTP; a requisição podia cair no proxy enquanto o servidor
> seguia rodando com o lock, e o clique seguinte dava 409. Com prazo, a resposta sempre volta, e o
> que faltou aparece como `arquivosAdiados` ("rode de novo"). O job avulso continua sem prazo
> (carga completa). Não muda o lock, a janela de releitura nem os gatilhos.

Sem ADR nova: é um parâmetro de uma decisão existente, não uma decisão nova.

## 3. O que **não** muda (registrado de propósito)

- A situação continua derivada e não persistida; os cards e segmentos só agrupam
  `CANDIDATO`+`AMBIGUO` como "Para conferir". Nenhum rótulo novo entra no domínio.
- Totais em R$ são soma de `valor` do boleto na mesma base das contagens; não são regra.
- `sincronizadoEm` continua sendo `max(sincronizado_em)` dos arquivos. O aviso "DDA parado" (8 h,
  dia útil) e a janela de 60 dias continuam como estão: são os itens F5.1/F5.2, follow-up em
  `sispag-dda-paridade-followups.md` (a criar no fim do ciclo), junto da pergunta de negócio já aberta
  em `sispag-dda-na-ingestao-regis-followups.md`.
- `_coverage.json`: contadores inalterados (nenhuma entidade/ação/regra nova); só `_meta.version`,
  `_meta.generated` e a nota da v0.53.0.
- `_index.json`: `BoletoDda` ganha os arquivos novos.

---

# Rodada 2 (2026-10-30) — agendador + conferência rápida do DDA (APROVADA e APLICADA na v0.53.0)

> **APROVADO (Gabriel, 2026-10-30):** Q13 — formação automática nunca antes das 06:30 BRT; o slot das
> 05:07 só atualiza dados; a formação roda no primeiro slot ≥ 06:30 que não acha formação no dia, e no
> das 12:13 se os da manhã se perderem. Q14 — uma por DIA ÚTIL (BankingCalendar; nada em fim de
> semana/feriado; o cron das 07:07 continua ingerindo todo dia); manual sem trava. Q15–Q18 e o alerta:
> defaults. As duas rodadas saem juntas na ontologia v0.53.0 (app v0.81.0).

> Depende das respostas Q13–Q19 da entrevista. Versão proposta: **v0.54.0** (a v0.53.0 desta branch
> ainda não foi para a main; se o Gabriel preferir, as duas rodadas saem juntas como v0.53.0).

## Resumo

| Item | Muda? | Onde |
|---|---|---|
| Entidade nova | **não** (uma tabela técnica de 1 linha, `boleto_dda_conferencia`, é estado de sincronização da `BoletoDda`, não entidade de domínio) | — |
| Ação nova | **sim, pequena**: `conferirBoletosDda` (conferência rápida) | `entities/boleto-dda.md` §Sincronização (sem arquivo de ação próprio, como a sincronização hoje) |
| Invariante nova **I-DDA6** (conferência rápida) | **sim** | `entities/boleto-dda.md` |
| Invariante nova **I-DDA7** (aviso conta da última conferência) | **sim** | `entities/boleto-dda.md` |
| `formarLotesAutomaticos`: no máximo uma rodada do cron por dia BRT | **sim** | `actions/sispag/formar-lotes-automaticos.md` (pré/pós-condição + trilha) |
| ADR-0067 | **emenda** (gatilhos e item 5, aviso) | `decisions/0067-…` |
| ADR-0060 | **emenda** (item 1, abertura confere o DDA; item 5, horários e trava da formação) | `decisions/0060-…` |
| I-DDA1…I-DDA5, I15*, I21* | **não** | — |

## 1. `entities/boleto-dda.md` §Sincronização

Antes (v0.53.0): "Três gatilhos, todos incrementais (arquivos novos + releitura dos importados nos
últimos 60 dias)…".

Depois:

> Quatro gatilhos. Os três primeiros são a **passada completa** (arquivos novos + releitura dos
> importados nos últimos 60 dias — é neles que o Conexos ainda grava vínculo): ingestão de pagamentos
> (cron e abertura com carteira velha), botão "Atualizar DDA" e job avulso. O quarto é a
> **conferência rápida**:
>
> - **I-DDA6 — conferência rápida ao abrir a tela.** Com a carteira recente (ADR-0060 não roda a
>   ingestão), a abertura confere o `fin124` se a última conferência tem mais de
>   `SISPAG_DDA_CONFERENCIA_MIN` (10 min): UMA listagem de arquivos comparada com `boleto_dda_arquivo`.
>   Arquivo **novo** → lê e grava os itens. Arquivo **cancelado ou com status/nome trocado** →
>   atualiza **só o cabeçalho**. Arquivo que sumiu → nada (nunca apaga). Nada mudou → só registra
>   `conferido_em`. Não relê arquivos conhecidos: o vínculo que o Conexos grava num arquivo já
>   importado **não** aparece aqui (a listagem não traz marca de alteração), só na passada completa.
>   Mesmo advisory lock, mesmo prazo (60 s), mesmo teto de leituras e mesma sequência da abertura
>   (ADR-0066 §3) da passada completa.
> - **Conferido em.** Toda listagem bem-sucedida do `fin124` (rápida ou completa) grava
>   `conferido_em` (`boleto_dda_conferencia`, migration 0092). Falha na listagem não grava.
> - **I-DDA7 — o aviso "DDA parado" conta da última conferência.** Defasado = mais de 8 h, em dia útil,
>   desde `conferido_em` (não desde o último arquivo gravado). Enquanto a abertura está conferindo ou
>   ingerindo, a aba não avisa.

(Substitui "A aba mostra aviso quando o pool está parado há mais de 8 h em dia útil".)

## 2. `actions/sispag/formar-lotes-automaticos.md`

Pré-condição nova:

> - "Gatilho **cron**: no máximo UMA rodada concluída (`success`/`partial`) por dia civil de Brasília
>   (`BankingCalendar.startOfTodayBrt`), conferida DENTRO do advisory lock na trilha `job_execucao`
>   (pipeline `sispag-formacao-lotes`). Rodada a mais no mesmo dia termina `ja_formado_hoje` sem tocar
>   lote. Gatilho **manual** (rota e `workflow_dispatch`) não tem a trava."

Pós-condição nova: "Toda rodada grava trilha em `job_execucao` (métricas: lotes formados, títulos,
desfeitos, ou o motivo de pular)."

Motivo registrado: duas rodadas no mesmo dia criam um segundo lote por filial com os títulos que
ficaram elegíveis no intervalo (o anti-join impede duplicar título, não impede fragmentar). A trava
sai do workflow (`github.event.schedule == '0 10 * * *'`), que deixa de servir com dois slots de manhã.

## 3. ADR-0060 — emenda 2026-10-30

> **Item 1:** com a carteira recente, a abertura também faz a conferência rápida do DDA (I-DDA6),
> na mesma requisição.
> **Item 5:** os crons saem do minuto :00 (o GitHub atrasa mais os schedules da hora cheia; o das
> 19:00 UTC não disparou nos últimos 3 dias úteis e o das 10:00 saiu ~16:23 UTC) e ganham uma rede de
> segurança cedo: `7 8 * * 1-5` (05:07 BRT), `7 10 * * *` (07:07), `13 15,19 * * 1-5` (12:13, 16:13).
> A formação roda nos dois slots da manhã e a regra "uma por dia" passa para o serviço (ver
> `formarLotesAutomaticos`). Continua grátis (GitHub Actions); Render Cron segue descartado (pago).

## 4. ADR-0067 — emenda 2026-10-30 (segunda)

> Gatilhos: soma-se a conferência rápida (I-DDA6). Item 5: o aviso conta de `conferido_em` (I-DDA7).
> Fecha em parte o follow-up F5.1 (a marca passa a andar com qualquer listagem bem-sucedida); o limiar
> de 8 h e a regra de dia útil não mudam.

## 5. O que não muda

Janela de 60 dias e releitura completa (só cron/ingestão/botão/job); lock, prazo e teto; ninguém escreve
no `fin124`; staleness do ADR-0042 (`sispag-pagamentos` 30 h). `_coverage.json`: actions_total +1
(`conferirBoletosDda`, planned→implemented na mesma feature) se o Gabriel quiser a ação contada;
senão, contadores iguais.
