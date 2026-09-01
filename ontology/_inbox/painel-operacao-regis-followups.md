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

### 1. Dead-man's switch externo (fecha DOIS pontos cegos de uma vez)

A ADR-0042 nomeia duas lacunas que têm a MESMA solução:

- o detector de staleness roda no próprio GitHub Actions e não vê o Actions parar de disparar;
- `DbAlertSink` não consegue alertar que o backend caiu — se o processo não sobe, ninguém escreve a
  linha.

Encaminhamento: expor `GET /health/pipelines` (read-only, sem auth ou com token) devolvendo a idade
da última run de cada pipeline, e apontar um pinger externo (healthchecks.io, cronitor) para ele,
configurado para alertar tanto no não-200 quanto na AUSÊNCIA do ping.

Mitigação parcial já entregue: **I6** — o painel computa staleness na leitura, então um humano que
abra a tela vê a verdade mesmo numa janela em que o detector não rodou.

### 2. O reaper não tem trilha de execução

`jobs/reaper-sispag-reconciling.ts` não escreve linha de run — é o único job que o painel não
consegue vigiar por staleness, e é justamente aquele cuja cegueira já estava documentada por escrito
no comentário do próprio workflow ("uma queda na sexta à noite ficaria invisível até segunda").

Hoje ele aparece LISTADO como `sem-trilha` (nunca omitido) e ganhou alerta de falha de workflow
(T7), o que recupera parte da cegueira — mas um reaper que roda e não faz nada de útil segue
invisível.

**O destino já existe:** basta ele passar a escrever em `job_execucao` (migration `0053`) via
`JobExecucaoRepository`, exatamente como `reconciliar-nde-sefaz.ts` faz. É trabalho pequeno e
aditivo; não entrou aqui só por ser escopo de outra frente.

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
