# Follow-ups — painel-operacao (ADR-0042)

> Aberto em 2026-09-01, ao fim do ciclo `/feature-new`. Nada aqui bloqueia a entrega.
> Gates: **SpecVerifier APROVADO** (35 critérios, 0 reprovados) · **PatternGuardian** 6 achados
> (2 rejeitados com justificativa, 4 resolvidos pelo item 4) · **DesignSystemReviewer** 3 achados
> (1 rejeitado, 1 aplicado, 1 vira #3) · **Regis-Review (subset: availability, fault-tolerance,
> security)** — 0 P0; **6 P1 REMEDIADOS nesta branch** (ver abaixo), demais viraram follow-up.

---

## REMEDIADOS neste ciclo (não são follow-up — ficam registrados porque mudaram o desenho)

| # | Achado | O que era |
|---|---|---|
| R1 | **ConfigDoctor rodava em todos os 58 jobs** | Estava no `bootstrapAppContainer`. Jobs recebem env estreito de propósito (`detect-staleness` passa só `databaseConnectionString`), e a janela de dedup é o instante do boot → **~144 alertas falsos/dia**. O sistema de alerta produzindo o ruído que existe para evitar. Movido para o boot do servidor HTTP. |
| R2 | **O detector era o job menos observado da frota** | Sem trilha e sem `if: failure()`. Um detector que rebenta deixaria `alertas: []` ambíguo entre "tudo bem" e "o vigia morreu". Agora escreve `job_execucao` como `operacao-detector` e entra na lista que ele mesmo vigia. |
| R3 | **Detector sem isolamento por pipeline** | Uma exceção do banco ao emitir abortava o laço: um defeito em permutas cegava extratos e SISPAG na mesma rodada. `emitirIsolado`, mesma doutrina do `entregarSeguro`. |
| R4 | **`reconciliar-nde-sefaz` fechava `success` com o ERP fora** | `hidratarNdes` degrada em silêncio e devolve `reconciliadas: 0`, indistinguível de "nada a reconciliar". A cobertura de filial agora sobe até o job, que marca `partial` — a cegueira do `pagamento_ingestao_run` que este job nasceu para não herdar. |
| R5 | **Mensagem de erro vazava credencial para o banco e para a tela** | `password authentication failed for user "…"`, connection strings inteiras, iam para `job_execucao.error_message` e `alerta.detalhe.erro` — **persistidos**, não só logados. `redactErrorMessage` redige na **fronteira de escrita**, valendo para todo job futuro sem depender do autor lembrar. |
| R6 | **Run ABANDONADA não era detectada** | Runner morto entre `createRun` e `finishRun` deixa a linha em `running`, que não é `error` — a única detecção residual era o staleness do último sucesso, até **30h de janela cega** no SISPAG. O detector passa a tratar `running` além do limite do pipeline como run abandonada. |
| R7 | **`registrarEntrega` engolia falha em silêncio** | Quebrava a promessa da própria classe de que "não chegou" fosse distinguível de "não houve alerta" — justamente no momento em que essa distinção importa. Agora registra.

---

## P1 — os pontos cegos que este slice NÃO fecha

### 1. ~~Dead-man's switch externo~~ — **IMPLEMENTADO 2026-09-01**

Os dois pontos cegos da ADR-0042 precisavam de mecanismos DIFERENTES, e é por isso que a solução
tem duas metades:

| Metade | Como | Que ponto cego fecha |
|---|---|---|
| **PULL** — `GET /health/pipelines` | Observador externo consulta; **503** quando há pipeline parado ou run abandonada | `DbAlertSink` não consegue alertar que o backend caiu — sem processo, ninguém escreve a linha. Um observador externo não depende de nada nosso estar de pé. |
| **PUSH** — `HEALTHCHECK_PING_URL` | O detector pinga ao fim de cada rodada BEM-SUCEDIDA; o serviço externo alerta quando o ping **não chega** | O detector roda no próprio GitHub Actions e não vê o Actions parar de disparar. Nada roda, logo nada reclama: a inversão é o que torna a ausência detectável. |

Decisões que valem registrar:

- **A sonda é pública e deliberadamente pobre.** O pinger não tem JWT, então ela devolve só status e
  contagens — sem nome de pipeline, sem idade, sem mensagem de erro. Detalhe fica em `/operacao`,
  atrás de `admin`. Há teste que falha se nome ou erro vazarem.
- **O status HTTP é o produto.** Nenhum uptime checker lê o nosso JSON; todos leem um 503. É isso que
  faz um serviço gratuito virar alerta sem escrever integração nenhuma.
- **`nunca-executou` e `sem-trilha` NÃO derrubam a sonda.** São estados conhecidos e declarados, não
  incidentes. Fazê-los degradar o health faria a sonda nascer vermelha — e uma sonda que nasce
  vermelha ensina o time a ignorá-la, o mesmo erro que a dedup de alerta existe para evitar.
- **O ping sai só no caminho de sucesso.** Enviado depois de uma detecção que falhou, ele diria ao
  observador externo que está tudo bem justamente quando não está.
- **Ausente a env, o ping é no-op.** Dev e teste não precisam de conta em serviço externo.

**Falta fazer (não é código):** criar o check no healthchecks.io, pôr a URL em
`secrets.HEALTHCHECK_PING_URL`, e apontar um monitor de uptime para `GET /health/pipelines`
alertando em não-200. Enquanto o secret não existir, o config doctor reporta
`HEALTHCHECK_PING_URL` como *degrada em silêncio* — a própria ferramenta cobra a configuração.

### 2. ~~O reaper não tem trilha de execução~~ — **IMPLEMENTADO 2026-09-01**

`jobs/reaper-sispag-reconciling.ts` passou a escrever em `job_execucao`, e o painel o monitora com
limite de **1h** — ele roda a cada 15 minutos, todos os dias, então 1h tolera três execuções
perdidas.

**Nenhum pipeline resta como `sem-trilha`.** A lista continua existindo, vazia, para o próximo job
que nascer sem trilha ser listado como cego em vez de sumir da tela.

Verificado ao vivo: o job rodou, gravou `success` com `{paradas:0, remessas:0, conciliacoes:0}`, e
o `GET /operacao` passou a devolver 6 pipelines monitorados e zero cegos.

Nota de desenho: o reaper fecha `success` mesmo achando execuções presas. Achar é o trabalho dele —
marcar `partial` faria o painel pintar de amarelo o funcionamento normal, e o operador aprenderia a
ignorar a cor. As execuções presas já têm canal próprio, o WARN estruturado.

---

## P2

### 2b. `alerta-workflow-falhou` sai 0 mesmo quando não consegue emitir

Deliberado — o workflow já está falhando e o passo de alerta não pode mascarar nem duplicar essa
falha (I5 no nível do CI). Mitigação parcial existente: ele faz `console.error`, e o log do Actions é
um canal secundário real, visível para quem abre a execução.

O que falta é um canal que **notifique** em vez de apenas registrar — o mesmo dead-man's switch do
item 1. Não tem conserto próprio.

### 3. `scope="col"` ausente em TODAS as tabelas do app

`components/ui/table.tsx` renderiza `<th>` sem `scope`, e nenhuma página do repositório o define
(`recebimentos`, `sispag`, `permutas` — todas com 0 ocorrências). É requisito WCAG 2.1 AA segundo o
próprio `docs/design-system/accessibility.md`.

O conserto certo é **uma linha em `TableHead`**, que corrige o app inteiro de uma vez — e é
justamente por ser app-wide que não entrou numa fatia de feature. As tabelas de `/operacao` já
receberam `aria-label`, que era a parte que cabia aqui.

### 4. ~~CLAUDE.md manda logar em inglês; o código loga em português~~ — **RESOLVIDO 2026-09-01**

Contradição **do repositório**, não deste slice. Medido: **39 de 91** mensagens de `LogService` em
`domain/service/` tinham marcas de português (`'remessa gerada'`, `'falha ao gerar remessa'`,
`'conciliação já processada'`), e os jobs existentes logam `início`, `lidas`, `deduplicadas`.

O PatternGuardian levantou 5 achados de idioma contra os arquivos novos. Tratá-los isoladamente
faria destes os únicos arquivos em inglês do repositório — trocaria uma inconsistência declarada por
uma real.

**Decisão (Yuri, 2026-09-01): o CLAUDE.md passa a refletir a prática.** A seção `Conventions →
Language` foi reescrita: identificadores, tipos de erro e commits em inglês; mensagens de log e de
erro voltadas ao operador em português, porque é a língua de quem lê o log durante um incidente.
Uma regra que 40% do código viola faz todo gate gastar tempo com falso-positivo.

Consequência: os 5 achados do PatternGuardian deixam de ser achados. Nenhuma normalização
retroativa é necessária.

### 5. Rota resolve `Repository` direto, sem `Service` no meio

`routes/operacao.ts` resolve `AlertaRepository` para duas operações triviais (listar abertos,
reconhecer). O `CLAUDE.md` descreve a cadeia `route → Service → Repository`.

**Rejeitado como defeito deste slice:** é o padrão vigente — `routes/permutas.ts` resolve
`PermutaSnapshotRepository`, `ClienteFiltroRepository`, `PermutaRelationalRepository` e
`PermutaProcessamentoRepository` da mesma forma. Um `AlertasService` de passagem pura acrescentaria
uma camada sem comportamento e faria um arquivo divergir de todos os vizinhos.

Vale como pergunta de arquitetura para o repositório inteiro (leituras finas podem pular o Service?),
não como correção pontual.

---

## P3

### 6. Deep-linking da aba de `/operacao`

`patterns.md §3` manda a aba ativa ir para a URL. Hoje é estado local. Numa tela de incidente,
compartilhar o link já apontando para a aba certa tem valor real — só não é bloqueante.

### 7. Sem validação Zod no boundary do front

`fetchOperacao()` faz cast do JSON para `OperacaoPainel` sem validar. Nenhuma lib do front usa Zod
hoje (`lib/recebimentos.ts`, `lib/api.ts`, `lib/sispag.ts` — todas fazem cast), então adotar aqui
sozinho divergiria. Mesma natureza do item 4: decisão de repositório.

### 7b. `GET /operacao` é `Promise.all` — uma leitura lenta derruba a tela inteira

`routes/operacao.ts` faz `Promise.all([exporSaude, listarAbertos])`. Se a tabela `alerta` estiver
presa num lock, a resposta inteira 500a — e o operador abriu a tela justamente porque suspeitou de
incidente. Contradiz a própria promessa da docstring ("é a tela que se abre quando o ERP está fora")
para o caso simétrico de UMA leitura do Postgres estar lenta.

`ConfigDoctor.diagnosticar()` é síncrono e nem toca o banco — deveria conseguir renderizar sozinho.
Conserto: `Promise.allSettled` com uma seção `erros[]` no payload; a UI já é por aba e a API pode
espelhar. Não entrou aqui porque muda o contrato da resposta e merece a sua própria fatia.

### 7c. `hidratarNdes` percorre as NDes com `await` sequencial

Backlog grande pós-outage pode encostar no `timeout-minutes: 20` do workflow e cair no caso da run
abandonada (agora detectado, mas ainda assim uma rodada perdida).

### 8. `partial` no `pagamento_ingestao_run` (SISPAG)

A fonte do SISPAG fecha `success` mesmo com filial falhada, então uma run com filial quebrada é
indistinguível de uma limpa. O read-model NÃO inventa o estado e carrega a ressalva até a tela
(`distinguePartial: false`, com aviso na coluna).

Corrigir exige tocar um writer vivo — exatamente o que a ADR-0042 decidiu não fazer neste ciclo.

---

## Rejeitados (com justificativa registrada)

| Achado | Origem | Por quê |
|---|---|---|
| "Usar `DataTable` em vez de `<table>` cru" | DesignSystemReviewer | **`DataTable` não existe neste repositório.** O que se usa é o compound `Table` do próprio design system, igual a todas as outras páginas. |
| "Criar `AlertasService` entre rota e repositório" | PatternGuardian | Ver item 5 — contraria o padrão vigente em `routes/permutas.ts`; viraria camada sem comportamento. |

## Validado ao vivo (não é follow-up, é registro)

- Migrations `0052` e `0053` **aplicadas de fato** contra Postgres 16 local; schema conferido.
- **Dedup provado no banco**, não só no mock: dois `INSERT ... ON CONFLICT (dedup_key) DO NOTHING`
  idênticos → 1 linha, e o segundo devolve 0 linhas — que é exatamente o sinal de que
  `AlertaRepository.criarSeNovo` depende para devolver `null`.
