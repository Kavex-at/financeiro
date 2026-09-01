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

#### Emenda de implementação (mesmo dia): jobs NOVOS nascem com trilha (`job_execucao`, 0053)

A decisão de não criar tabela vale para os **três writers que já existem**. Ao implementar o
reconciliador da NDe (item 4) ficou claro que aplicá-la a um job **novo** produziria o resultado
oposto ao pretendido: o job nasceria sem trilha, exatamente como o `reaper-sispag`, e este slice
entregaria um **segundo** ponto cego dentro do trabalho que existe para eliminá-los.

Então: `job_execucao` (migration `0053`) é a trilha dos jobs criados daqui em diante. É **aditiva** —
nenhum writer existente é tocado, o que preserva a restrição acima — e traz `partial` desde o
nascimento, para não herdar a cegueira do `pagamento_ingestao_run`. O read-model ganha um quarto
adapter, genérico: qualquer job futuro fica visível sem código novo.

É também o destino pronto do follow-up "dar trilha ao reaper": basta ele passar a escrever aqui.

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

## Emenda (2026-09-01): o painel é recortado por IDENTIDADE, não por papel

O painel nasceu atrás de `requireRole('admin')`, o que não recortava nada: **12 de 12 contas da
plataforma são `admin`** (`docs/impacto/h1-permutas-achados.md` §6). Na prática, "só admin" queria
dizer "todo mundo".

Ele também não pertence à mesma prateleira das outras telas. Permutas, SISPAG e Recebimentos são do
analista financeiro; a Operação é de quem opera a plataforma. Estavam lado a lado na home por
inércia, não por decisão.

**`OPERACAO_USUARIOS` (CSV)** passa a recortar por username. Três escolhas dentro disso:

1. **Allow-list, não usuário único.** Um painel de incidente que só uma pessoa enxerga é um painel
   que ninguém enxerga quando essa pessoa está dormindo. E um username fixo no código quebraria ao
   renomear a conta.
2. **Fail-OPEN quando a lista está vazia.** Env ausente = comportamento de hoje (qualquer admin).
   Trancar a porta por causa de configuração faltando, justamente numa ferramenta de incidente,
   troca uma exposição por um lockout silencioso durante uma queda. O `ConfigDoctor` reporta a
   ausência como `degrada-silenciosamente`, então o buraco fica visível.
3. **404, não 403.** O pedido era que a tela não aparecesse para quem não opera; um 403 confirma
   que ela existe e entrega metade do que se queria esconder.

O gate é **server-side** nas duas rotas. `GET /me/permissoes` existe só para a home saber se mostra
o card — o front não reimplementa a regra, e um front desatualizado esconde ou mostra um card, nunca
abre porta.

A sonda `GET /health/pipelines` **continua pública**: ela é para máquina, não para gente, e já
devolve o mínimo (status e contagens, sem nomes).
