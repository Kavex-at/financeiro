---
adr_number: 0042
title: O sistema passa a relatar a própria execução — read-model sobre as tabelas de run existentes, alerta persistido atrás de um port, e diagnóstico de configuração no boot
date: 2026-09-01
status: accepted
type: change
related_entities: [JobRun, Alerta]
related_actions: [exporOperacao, detectarStaleness, notificarFalha, validarConfiguracao]
related_integrations: []
supersedes_decisions: []
amends_decisions: [0038]
---

# ADR 0042: o sistema relata a própria execução

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`feat/painel-operacao` (worktree, base `main`). **Fonte:** `/feature-new` com o Yuri (2026-09-01), a
partir de uma revisão de produto das telas de Permutas e Recebimentos. **`entity_changed = true`.**

## Contexto

O sistema executa bem e **não sabe dizer que está executando**.

Quatro crons em GitHub Actions alimentam as três frentes: `ingest-permutas` (`0 9,15,21 * * *`),
`ingest-extratos` (`20 * * * *`), `ingest-sispag` (`0 10 * * *`) e `reaper-sispag`
(`10,25,40,55 * * * *`). **Nenhum tem `if: failure()`.** Não há canal de notificação, não há rota de
métricas, e `/health` devolve `{status:'ok', version}` — que responde "o processo subiu", não "o
pipeline rodou". O comentário do próprio `reaper-sispag.yml` já registrava o problema: *"uma queda na
sexta à noite ficaria invisível até segunda."*

O único detector de falha em produção é um analista notar que "últ. ingestão" parece antiga.

Em paralelo, a configuração que decide comportamento de negócio vive em 33 env vars invisíveis pelo
produto, e **duas delas já produziram defeito visível**:

- `RECEBIMENTO_TITULARES_INTERNOS` ausente → `transferencia_interna = 0` em 338 linhas; o ruído de
  tesouraria contamina a carteira na tela do analista, não só o relatório.
- `COM297_GCD_NOTA_DEBITO` ausente → a única falha real de valor da Frente IV, R$ 477.741,70.

Ambas são uma linha de configuração, e ambas falharam no instante de tocar dinheiro em vez de no
deploy.

## Decisão

### 1. `JobRun` é read-model, não tabela nova

Adapters por fonte normalizando `permuta_eleicao_run`, `recebimento_ingestao_run` e
`pagamento_ingestao_run`. **Nenhuma migration, nenhum writer tocado.**

A alternativa — tabela `job_run` unificada — daria vocabulário único e herança automática para jobs
futuros, mas exigiria migrar três writers em caminhos que movem dinheiro, com backfill. Fazer isso
**enquanto ainda não existe alerta nenhum** inverte a ordem: seria a mudança mais arriscada do
repositório executada no exato momento de menor capacidade de detectar que ela quebrou algo. O
read-model entrega a mesma tela com risco zero, e a tabela unificada continua possível depois, já
sob observabilidade.

Preço aceito: **pipeline sem adapter é invisível no painel.** Não há herança automática.

`partial` é preservado, nunca achatado em `success`. Duas das três fontes o distinguem; o SISPAG
não — e essa **cegueira herdada** (run com filial falhada indistinguível de run limpa) fica como
follow-up, não corrigida aqui, porque corrigi-la significaria tocar um writer vivo. Ver
`entities/job-run.md`.

### 2. `AlertSink` é um port; e-mail fica para depois, sem bloquear

O canal preferido do Yuri é **e-mail**, mas o acesso é mais difícil de obter e a decisão explícita
foi que isso **não pode bloquear o slice**.

- **`DbAlertSink` entra agora.** Persiste o `Alerta`; o próprio Painel de Operação o exibe. Alerting
  funcional no dia 1, sem credencial nenhuma.
- **`EmailAlertSink` entra atrás de config**, quando o acesso existir. Ligar vira um flip de
  configuração, não uma reescrita. Vendor deliberadamente **não** escolhido agora — escolher sem ter
  o acesso seria decidir sem informação.

### 3. O detector de staleness roda em GitHub Actions

Quinto workflow. Decisão do Yuri, com o ponto cego conhecido e aceito (ver Consequências).

### 4. A reconciliação SEFAZ sai do browser (emenda à ADR-0038)

A ADR-0038 moveu a hidratação da NDe para `GET /recebimentos/painel/enriquecimento`, **que só o
navegador chama**. A gravação do número do SEFAZ e do flag `ndeAutorizado` no ledger passou a
depender de alguém ter a aba aberta: relatórios que leem `ndeAutorizado` do Postgres mentem até a
próxima carga de alguém.

A reconciliação passa a ter job próprio — primeiro consumidor real da plumbing nova, o que a prova
de ponta a ponta. `GET /painel/enriquecimento` continua existindo para a tela, mas deixa de ser o
único escritor. Fecha os follow-ups **F1** e (por consequência, ao tirar a escrita de baixo de um
GET sem role) **F3** de `recebimentos-ux-loading-modal-regis-followups.md`.

## Consequências

### Dois pontos cegos, nomeados de propósito

1. **O detector não vê o GH Actions falhar.** Schedules do GitHub são best-effort e podem atrasar ou
   ser descartados sob carga; um detector hospedado ali não enxerga exatamente o cenário em que ele
   próprio não roda. Mitigação parcial: **I6** — `exporOperacao` computa staleness **na leitura**, de
   modo que um humano abrindo o painel vê a verdade mesmo numa janela em que o detector nunca
   disparou. O cron *alerta*; o painel *sempre sabe*.
2. **`DbAlertSink` não pode alertar que o backend caiu.** Se o processo não sobe, ninguém escreve a
   linha.

As duas têm a mesma solução completa — um dead-man's switch externo pingando uma rota
`/health/pipelines` — e ela está **fora deste slice**, registrada como follow-up. Registrar o teto
por escrito é o ponto: sem isso, o próximo a olhar assume cobertura que não existe.

### O que melhora já

- A aba "Ingestões" do painel de Recebimentos deixa de ser um `EmptyState` placeholder.
- As 5 runs `partial` com 77 contas falhas param de ser invisíveis.
- As duas classes de defeito de configuração passam a ser detectadas no boot.

## Alternativas descartadas

- **Substituir GH Actions por scheduler real (EventBridge/worker).** É a resposta certa a prazo, mas
  o alvo Lambda não existe e trocar o scheduler agora misturaria duas mudanças grandes. Tornar o
  scheduler atual **observável** entrega a maior parte do valor a uma fração do custo. Revisitar
  quando o trabalho de escala da Tier 1 chegar.
- **Alertar na primeira execução perdida.** Descartado: schedules best-effort atrasam por
  comportamento normal, e um canal ruidoso é um canal ignorado — o modo de falha mais caro, porque
  desativa todos os outros alertas junto. Ver `business-rules/staleness-por-pipeline.md`.
