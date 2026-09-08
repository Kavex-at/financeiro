# Follow-ups — `fix/permutas-baixa-integridade` (curadoria de ontologia, 2026-09-08)

> Origem: Regis-Review `docs/regis-review/2026-09-08-1414-permutas/` — R-1 (P0, card
> `fault-tolerance-1`) e R-2 (card `fault-tolerance-4`). Escopo aceito e escrito na ontologia:
> ADR-0043 (I-Recon-5/6/7, I-Write-8a/8b, estado `PARCIAL_AGUARDANDO_FINALIZACAO`/B1', correção da
> chave de idempotência). O que segue **não** entrou, e por quê.

> **Atualização 2026-09-08 (mesmo dia) — o ciclo fechou: a implementação entrou.** Este arquivo foi
> escrito quando a ontologia estava à frente do código; não está mais. A seção 4 virou registro do
> que foi entregue, e a seção 5 (riscos abertos em produção) foi requalificada. `_coverage.json`
> devolveu `Permuta.impl_pct` a 90, `idempotencia-reconciliacao` e `status-permuta-bordero` viraram
> `implemented`. Seguem **abertos**: a guarda de truncamento (§4-bis), a re-execução da sonda contra
> invoices que **não** baixamos (§4-bis), a revisão do comportamento de re-alocação (§1) e a
> divergência de contagem (§3).
>
> **Precisão que não pode se perder:** "implementado" aqui significa **existe na branch
> `fix/permutas-baixa-integridade` e passa nos gates** (backend typecheck + lint + 123 suites / 1768
> testes; frontend typecheck + lint + 27 suites / 201 testes). **Não há commit, PR nem release** — em
> produção **nada disso está rodando**. Quem diagnostica incidente confere a vigência por
> `GET /health` (campo `version`) e pelo `CHANGELOG.md`, como o runbook
> `docs/runbooks/fin010-write-cutover.md` já instrui.

## 1. Comportamento de re-alocação — REJECT-WORKAROUND (deferido por decisão do Yuri)

A chave de idempotência inclui o `atualizado_em` da alocação
(`ReconciliacaoPermutaService.ts:161`), então **re-alocar um par que já tem execução terminal cunha
chave nova e libera um novo lançamento no ERP**. Isso é hoje a *feature* que resolve o resíduo de
uma execução `parcial` — e é também a porta por onde um relançamento acidental passaria.

Decisão de 2026-09-08: **só documentar** (feito — `I-Recon-1`, cláusula 1). Nada muda no
comportamento.

**A decidir depois:** re-alocar um par com execução `settled`/`parcial` deveria exigir confirmação
explícita na UI (ou um campo "motivo" na trilha), para separar *"estou resolvendo o resíduo"* de
*"não vi que já tinha baixado"*? Hoje as duas intenções produzem exatamente a mesma chamada.

**Status após a implementação (2026-09-08): SEGUE ABERTO — e ficou mais afiado.** Agora que `parcial`
existe como terminal, "resolver o resíduo por re-alocação" deixou de ser hipótese e virou o caminho
previsto. As duas intenções continuam produzindo a mesma chamada; o que mudou é que uma delas agora
tem nome. Registrado também como `open_gap` em `_index.json`
(`business_rules.idempotencia-reconciliacao`).

## 2. Âncoras `file:line` stale em `entities/permuta.md` — REJECT-NOT-DOMAIN (escopo)

O Regis-Review achou 5 referências `file:line` desatualizadas naquele arquivo. **Não corrigidas neste
ciclo, de propósito** — é o card `modifiability-9` do mesmo run, e misturá-lo aqui tornaria o diff
de R-1/R-2 irreviewável. As âncoras novas escritas neste ciclo foram conferidas contra o código.

## 3. Divergência de contagem em `business-rules` — para `/retro-ontology`

Três números que deveriam ser um só:

| Fonte | Contagem (antes deste ciclo) | Depois |
|---|---|---|
| Arquivos em `ontology/business-rules/` | 28 | 28 |
| Chaves em `_index.json.business_rules` | 24 | 25 |
| `_coverage.json.summary.business_rules_total` | 21 | 22 |
| `_coverage.json.by_business_rule` (linhas) | 20 | 21 |

**Quarto número, medido em 2026-09-08:** `_coverage.json.by_business_rule` tem **21 linhas**, das
quais 11 `implemented` e 7 com `has_test` — enquanto os contadores de `summary` dizem 13 e 9. O
`summary` roda **+2** à frente das linhas nas duas dimensões, e já rodava antes deste ciclo (era 12
vs 10 e 8 vs 6). A promoção de `idempotencia-reconciliacao` **preservou o delta** em vez de
"consertá-lo" no meio de uma feature — mesma disciplina do parágrafo abaixo.

Divergência **pré-existente**; a convenção de contagem não é derivável do que está escrito. Aplicado
apenas o `+1` (que preserva o invariante interno `implemented + planned = total`, hoje `13 + 9 =
22`). **Não** tentar "consertar" os outros números sem antes fixar a convenção — é trabalho de
`/retro-ontology`, não de um ciclo de feature.

Achado adjacente, já corrigido: `business-rules/idempotencia-reconciliacao.md` existia desde a Fase 3
e **nunca esteve mapeado** em `_index.json`. Entrada criada neste ciclo. Vale varrer se há outros
arquivos órfãos do índice — provavelmente há (28 ≠ 25).

## 4. Implementação — ENTREGUE (2026-09-08, na branch)

Era o handoff para o TaskScoper: "o que a ontologia agora exige e o código ainda não faz". **Fechou
no mesmo dia.** Mantido como checklist auditável — item a item, com a âncora do que atende:

| Item exigido pela ontologia | Status | Onde |
|---|---|---|
| Migration `0054_permuta_execucao_parcial.sql` (`CHECK` com `'parcial'` + `valor_residual_usd`) | ✅ | `src/backend/migrations/0054_permuta_execucao_parcial.sql`, idempotente |
| `ExecucaoStatus` espelhado à mão em dois lugares — **nada forçava a paridade** | ✅ **resolvido, não só espelhado** | guarda de paridade FE↔BE em `src/frontend/lib/types.test.ts` (era o "follow-up próprio" pedido aqui) |
| `PermutaStatus` + filtro `r.status !== 'settled'` | ✅ | `BorderoGestaoService.ts:37` e `:593` |
| `beginExecution` preserva `parcial` no `ON CONFLICT` | ✅ | `PermutaExecucaoRepository.ts` — as 5 `CASE`s |
| `markParcial` como **irmão** de `markSettled` | ✅ | `PermutaExecucaoRepository.ts:287-338` |
| `ReconciliacaoEmAndamentoError` (409) e `AlocacaoSemCoberturaError` (422) | ✅ | `src/backend/domain/errors/` |
| `ConexosTitulosClient`: `fieldList` pede `pago`, `titMnyTotPago`, `titFltTaxaMneg` | ✅ | `ConexosTitulosClient.ts`; `pago` entra como **corroboração** (`BUSINESS_WARN`), nunca recusa |
| Card `cc-reaper-permutas` ganha o alvo `parcial` | ❌ **NÃO entrou** | ver abaixo |

**I-Recon-5** (serialização) e **I-Write-8a** (pré-checagem) foram além do checklist: `withAdvisoryLock`
+ `chaveDeLock` (hash int32) em `ReconciliacaoPermutaService.ts:100-153`, com **teste de concorrência
real** (dois POSTs no mesmo adto ⇒ **1×** `gravarBaixaPermuta`; adiantamentos distintos não se
bloqueiam); `assertCobertura` antes do 1º POST com a fórmula derivada da §4-bis, **pulada** no
fallback de título único via `titulosDoErp: boolean` (a origem da lista é rastreada
explicitamente, não inferida de `titulos.length === 1`).

**B1'** ganhou ramo próprio no badge (`src/frontend/app/permutas/components/ui.tsx:124-143`, 4 testes
de render) — e não um `else` reaproveitado, que era exatamente o defeito que a ADR-0043 pediu para
não cometer.

### O requisito duro de B1' — satisfeito **por construção**, e é melhor assim

A ADR-0043 exige que `parcial-aguardando-finalizacao` **não** remova o adiantamento da elegibilidade
(senão o resíduo perde a cobrança, e o defeito do R-2 só muda de lugar). Verificado: não há guarda
que garanta isso — **não é preciso haver**. `ElegibilidadeService.ts` não referencia status de
execução, nem `parcial`, nem `statusPorAdiantamento` (grep vazio); a elegibilidade sai do **saldo**
do adto, e o badge chega por consulta lazy separada (`GET /permutas/status`). É **desacoplamento
estrutural**, não guarda removível — não há linha que alguém possa apagar por engano e reintroduzir o
defeito. Registrado no `_index.json` (`state_machines.status-permuta-bordero`) para que uma futura
refatoração que **acople** as duas coisas seja lida como regressão, e não como limpeza.

### Continua ABERTO: `cc-reaper-permutas` — I-Recon-7 fica meio-cumprido

I-Recon-7 exige que um terminal `parcial` seja visível por construção em **três** pernas. Duas
entraram: **(a)** `BUSINESS_WARN` com `adiantamentoDocCod`, `invoiceDocCod`, `borCod` e
`valorResidualUsd`; **(b)** `GET /permutas/adiantamentos/:docCod/execucoes`. A perna **(c)** — `parcial`
como alvo do detector proativo — depende do card `cc-reaper-permutas`, **que não existe**: o único
reaper no repo é `src/backend/jobs/reaper-sispag-reconciling.ts`. O card ficou fora do escopo deste
ciclo por decisão registrada no `tasks.md`, e a exclusão é **consciente**, não esquecimento.

Enquanto (c) não existir, vale o que a própria ADR nomeou como risco: *`parcial` é trabalho pendente,
não linha de log* — hoje, quem não abrir a trilha do adiantamento não é avisado por ninguém. Está
registrado como `open_gap` em `_index.json` (`business_rules.idempotencia-reconciliacao`) e em
`_coverage.json` (`by_business_rule`), para não sumir com o fechamento deste arquivo.

## 4-bis. Ground-truth de `titVldStatus` / `pago` — **FECHADO POR MEDIÇÃO** (2026-09-08)

Não é follow-up aberto; é registro de um gap que existiu e foi fechado antes de virar código.

A primeira redação de I-Write-8a somava a **face** dos títulos ATIVOS (`Σ titulos.usd`) como se
fosse "o em aberto da invoice". A sonda `src/backend/jobs/probe-com308-cobertura.ts` (read-only,
endpoint único `POST com308/financeiroAPagar/list/{docCod}`, 20 invoices / 22 títulos em **produção**)
refutou a premissa:

- `titVldStatus` é **ciclo de vida do registro** (`1 ATIVO · 2 RENEGOCIADO · 3 CANCELADO`); a
  dimensão "em aberto" é `pago` (`1 TOTALMENTE · 2 PARCIALMENTE · 3 NÃO PAGO`) — swagger versionado
  `docs/conexos-api/070-com3.json`, schema `FinTituloFin`;
- **19 de 20** invoices devolveram títulos `titVldStatus = 1` com face cheia e aberto **zero**; pior
  caso doc **9320** (filial 2), face **USD 83.476,12**, aberto **0**, marcado ATIVO;
- `filterList: {'pago#NE': '1'}` ⇒ **HTTP 500** — sem filtro server-side;
- `pago` **é** retornável no `fieldList`; `titMnyTotPagoMneg` **não existe** no schema.

Forma decidida (normativa em `fin010-write-contract.md`, I-Write-8a):
`abertoUsd = titMnyValorMneg − (titMnyTotPago / titFltTaxaMneg)`, somado sobre os ATIVOS.

**Ressalva de amostragem, a repetir sempre que este número for citado:** a amostra veio de
`permuta_alocacao_execucao` — invoices que **nós já baixamos**, logo tendentes a estar pagas. Os
19/20 provam o **mecanismo**, **não a frequência** com que um candidato real de pré-checagem estaria
quitado. Não estimar taxa de disparo de 8a a partir disso.

**Truncamento: inconclusivo** — 1–2 títulos por invoice na amostra, `count` nunca divergiu de
`rows.length`. A guarda cai de requisito para **defensiva opcional**; se implementada, o critério é
`count !== rows.length`, não `rows.length === pageSize`.

**Sonda re-executável:** `PROBE_ALLOW_PRD=1 npx tsx jobs/probe-com308-cobertura.ts`
(de `src/backend/`). Vale re-rodar antes de implementar 8a, e depois, contra invoices **não**
baixadas por nós — é o que responderia a pergunta de frequência que esta amostra não responde.

**Status após a implementação (2026-09-08): a §4-bis é a única seção que a entrega NÃO fechou.**
I-Write-8a virou código com a forma decidida aqui, mas os dois débitos de medição continuam de pé, e
não são fechados por implementar:

1. **Re-rodar a sonda contra invoices que NÃO baixamos** — ABERTO. A amostra atual (20 invoices
   tiradas de `permuta_alocacao_execucao`) mede o **mecanismo**, nunca a **frequência**: são invoices
   que nós já baixamos, logo tendentes a estar pagas. Sem essa segunda execução, **não existe** base
   para estimar quantas vezes 8a vai disparar na fila real — e a tentação de citar "19 de 20" como se
   fosse taxa de disparo só cresce agora que o código existe. Não citar.
2. **Guarda de truncamento** — ABERTA e **deliberadamente não implementada**. A própria ADR-0043 a
   rebaixou de requisito para **defensiva opcional** (população medida: 1–2 títulos por invoice,
   `count` nunca divergiu de `rows.length`). Se um dia for implementada, o critério é
   `count !== rows.length` — **não** `rows.length === pageSize`, que é frágil e já foi medido falhando
   neste repo.

## 5. Riscos abertos em produção ATÉ **a release entrar** (não: até o código existir)

O título desta seção mudou em 2026-09-08, e a mudança é o ponto: o código **existe** (§4), mas está
na branch `fix/permutas-baixa-integridade` — **sem commit, sem PR, sem release**. Em produção,
portanto, os dois riscos abaixo seguem **exatamente tão abertos quanto estavam**. Escrever
"implementado" e parar aí seria trocar um registro falso ("a ontologia está à frente") por outro
("já está protegido").

Enquanto a versão em produção não trouxer a ADR-0043 — confira por `GET /health` (campo `version`) e
pelo `CHANGELOG.md` da release, como manda a nota de vigência do runbook
`docs/runbooks/fin010-write-cutover.md`:

- **dois analistas no mesmo adto em janela sobreposta ⇒ dois borderôs e duas baixas** (R-1). Mitigação
  manual: combinar quem reconcilia qual adiantamento.
- **título renegociado/cancelado após a alocação ⇒ `settled` com resíduo mudo** (R-2). Mitigação
  manual: cruzar `valorPermutar` (ERP) × soma das baixas registradas.
  *(Corrigido em 2026-09-08: "título baixado externamente" **não** é o gatilho — esse caso já lança
  erro no passo 2 por I-Recon-3, e responde por parte das 12 falhas reais de produção.)*

O `_coverage.json` não registra mais isso derrubando `Permuta.impl_pct` (voltou a 90, com a
implementação). O que ele registra agora, e que **não** se fecha com código nenhum, é o gap de
sempre: **validação em produção do 1º caso real de baixa `fin010`**. Implementado ≠ validado.
