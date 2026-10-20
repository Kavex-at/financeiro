> **APROVADO em 2026-10-20 pelo maintainer, como proposto** (todos os ACCEPT, arquivos #1–#24, inclusive o
> Gotcha do `CLAUDE.md` e o R-21 do ANEXO). **Renumerado para ADR-0076 / ontologia 0.47.0** (0.46.0/ADR-0075
> reservados pela branch não mergeada `docs/sispag-situacao-pagamento-ontology`; reconferir antes do ship);
> migration segue 0089; app 0.72.0 só prevista. Pontos inferidos 1–6 aceitos como escritos; respostas aos
> abertos: **7** grupo fechado com título não aprovado é exibido com o motivo e não é confirmável (nunca se
> descarta o título para sugerir subconjunto); **8** "vencido" do grupo = vencimento do boleto (dia civil em
> Brasília, ADR-0070); **9** depois de J rejeitado, o grupo volta à remessa só depois de a analista resolver o
> borderô antigo no ERP, e se ele reaparecer em `borderosPendentes` do lote novo (V7) o sistema o reaproveita;
> V7 fica no watchlist como medição. Escrito em `ontology/decisions/0076-sispag-boleto-agrupado-bordero.md`
> e arquivos relacionados. **O texto abaixo é o registro histórico da proposta** (ainda com a numeração 0075/0.46.0).

## Ontology Diff Proposal — sispag-boleto-agrupado (PROPOSTA, nada escrito na ontologia)

> `/feature-tweak`, passo 3 (OntologyCurator). Base `origin/main` 5983531. **Numeração conferida em
> 2026-10-20:** ADR **0075**, ontologia **0.45.0 → 0.46.0**, app 0.72.0, migration **0089**. Reconferir
> antes do ship (memória "versão colide entre sessões").
>
> Fontes: `_inbox/sispag-boleto-agrupado-interview.md` (as **Respostas do maintainer (2026-10-20)**
> prevalecem sobre as recomendações da entrevista) e `_inbox/sispag-boleto-agrupado-hml-achados.md`.
> O que eu tive que deduzir está marcado **[inferido]** e listado no fim. Só viram pergunta os pontos
> que mudam o desenho.

---

### Análise dos candidatos

| # | Candidato | Filtros (A universal · B onto/config · C permanente · D já modelado · E ação/estado) | Decisão |
|---|---|---|---|
| 1 | Entidade **`GrupoBoleto`** (1 boleto DDA ↔ N títulos do mesmo credor, confirmado por pessoa) | A: 2/3 (boleto que agrupa faturas existe em qualquer contas a pagar com DDA; o Conexos tem caminho nativo; 1 cliente medido, ~220 casos/40+ credores) · B: onto · C: sim (mecanismo do ERP + boleto bancário) · D: novo (`DecisaoSugestaoBoleto` é 1:1 e imutável; não comporta N títulos nem execução) · E: entidade com estados | **ACCEPT** (revisão de universalidade com o Francinei, não bloqueante, precedente Q-I do ADR-0068) |
| 2 | Regra **`boleto-agrupado-sispag` (I19a–u)** | A: 2/3 · B: estrutura onto; janelas são constantes de código · C: sim · D: novo · E: regra | **ACCEPT** |
| 3 | `ItemLote.grupoBoletoId` (N itens locais, um por título, ligados ao grupo) | P1-1(b) do maintainer · D: estende `ItemLote` · E: propriedade | **ACCEPT** |
| 4 | Ações `sugerirGruposBoleto`, `confirmarGrupoBoleto`, `anularGrupoBoleto`, `prepararBorderoDoGrupo`, `limparBorderoDoGrupo` | E: verbos com pré/pós-condição | **ACCEPT** |
| 5 | Emendas I2, I3, I4, I11, I15, I16, I17, retomada, formação automática, máquina do lote | D: estendem regras existentes | **ACCEPT** (marcadas `planned` dentro das regras, precedente ADR-0072) |
| 6 | Seção `fin010` borderô-para-SISPAG + `fin015 borderosPendentes` em `integrations/conexos.md` | camada 1, exigida pelo modelo | **ACCEPT** |
| 7 | `ItemLote.tipo = TITULO \| BORDERO` com títulos numa tabela filha | P1-1(a) | **REJECT-DUPLICATE** (decisão P1-1(b): esconderia títulos de I2/I3/I4/I11) |
| 8 | Entidade `BorderoGrupo` separada | D: o borderô é objeto do ERP; `borCod`/marcador são execução do grupo | **REJECT-DUPLICATE** (campos de execução no grupo + write-ahead) |
| 9 | Persistir a **sugestão** de grupo | I-DDA1 (candidato é calculado) | **REJECT-DUPLICATE** (só a confirmação persiste) |
| 10 | `fin146` (Baixa Agrupada) | baixa os títulos ao finalizar, antes do banco pagar (HML H1) | **REJECT-WORKAROUND** |
| 11 | Renegociar os N títulos num único título (`fin070`, "merge") que case 1:1 | muda documento, devolve à alçada (`fin103`), mais lento; o caminho nativo existe | **REJECT-WORKAROUND** |
| 12 | Pagar o boleto agrupado fora do SISPAG (status quo) | D1 do maintainer | **Rejeitado (D1)** |
| 13 | Grupo que cruza filial | P0-3(a); depende da sonda V4 | **REJECT-PREMATURE** → watchlist |
| 14 | Flag por filial / modos `off`/`shadow`/`on`; permissão do robô como portão | P0-5: rollout é operação, não domínio (precedente: emenda de 2026-10-20 do ADR-0074) | **REJECT-NOT-DOMAIN** |
| 15 | Janela ±5 d na **sugestão** (P0-2 b/c) | P0-2: sugestão só no mesmo vencimento | **Rejeitado (P0-2)** |
| 16 | Subconjunto livre (subset-sum) na sugestão | medição M1: 922/2369 falsos | **REJECT-PREMATURE** (ruído medido) |
| 17 | Absorver centavos em juros/desconto de uma baixa do borderô, ou I18 num título do grupo | P1-2(a) | **REJECT-PREMATURE** → watchlist |
| 18 | Boleto digitado/colado fora do DDA | P1-3(a) | **REJECT-PREMATURE** → watchlist |
| 19 | Caso 2: N boletos → 1 título (VIBE LOG) | fora do escopo (D2) | **REJECT-PREMATURE** → watchlist |
| 20 | Criar o borderô na confirmação do grupo | viola I1, borderô parado por dias | **REJECT-WORKAROUND** (P0-4 a) |
| 21 | Nós finalizarmos o borderô / livro paralelo de baixa por título | baixaria antes do banco; o retorno nativo baixa (D4/D7) | **REJECT-WORKAROUND** / **REJECT-DUPLICATE** |
| 22 | `gerNum` por filial como configuração | lido ao vivo do `fin005` (H10) | **REJECT-CONFIG** (nem config: leitura ao vivo) |

---

### Arquivos alterados (só os ACCEPT)

| # | Arquivo | Tipo |
|---|---|---|
| 1 | `ontology/entities/grupo-boleto.md` | **novo** |
| 2 | `ontology/business-rules/boleto-agrupado-sispag.md` | **novo** (I19) |
| 3–7 | `ontology/actions/sispag/{sugerir-grupos-boleto,confirmar-grupo-boleto,anular-grupo-boleto,preparar-bordero-do-grupo,limpar-bordero-do-grupo}.md` | **novos** |
| 8 | `ontology/decisions/0075-sispag-boleto-agrupado-bordero.md` | **novo** (texto na Parte B) |
| 9 | `ontology/entities/lote-pagamento.md` | emenda (`ItemLote.grupoBoletoId`, relação, invariantes) |
| 10 | `ontology/business-rules/elegibilidade-titulo-lote.md` (I2) | emenda |
| 11 | `ontology/business-rules/nao-duplicacao-titulo-lote.md` (I3) | emenda |
| 12 | `ontology/business-rules/lote-uma-filial.md` (I4) | emenda |
| 13 | `ontology/business-rules/sincronizacao-status-lote-sispag.md` (I11) | emenda |
| 14 | `ontology/business-rules/sugestao-boleto-dda-sispag.md` (I15) | emenda |
| 15 | `ontology/business-rules/boleto-exige-codigo-de-barras.md` (I16 + regra de ausência) | emenda |
| 16 | `ontology/business-rules/vinculo-codbar-item-sispag.md` (I17) | emenda |
| 17 | `ontology/business-rules/retomada-remessa-sispag.md` | emenda (etapa `preparar_bordero`) |
| 18 | `ontology/state-machines/lote-pagamento.md` | emenda (L2, L3, L6, L8, L11) |
| 19 | `ontology/actions/sispag/{formar-lotes-automaticos,gerenciar-lote-candidato,finalizar-lote,vincular-codigo-barras-ao-item}.md` | emendas curtas |
| 20 | `ontology/entities/{boleto-dda,decisao-sugestao-boleto,bloqueio-duplicidade,alerta}.md` | relação/enum |
| 21 | `ontology/integrations/conexos.md` | seção nova |
| 22 | `ontology/glossary.md` | termos novos |
| 23 | `ontology/_index.json`, `ontology/_coverage.json`, `ontology/CHANGELOG.md`, `ontology/_inbox/_watchlist.md` | metadados |
| 24 | `docs/sispag/ANEXO-requisitos.md` (R-21) | doc-as-code |

---

## Parte A — Diffs

### A1. `ontology/entities/grupo-boleto.md` (NOVO)

```yaml
---
name: GrupoBoleto
type: entity
ontology_version: "0.46.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []   # a preencher pelo TaskScoper (migration 0089)
properties: [id, filCod, pesCod, credor, emissorChave, ddcCod, ditCod, numeroBoleto, codbarMascarado, valorBoleto, vencimentoBoleto, titulos, somaTitulos, origem, intercambiavel, avisosReconhecidos, confirmacaoEmissorId, estado, confirmadoPor, confirmadoEm, anuladoPor, anuladoEm, motivoAnulacao, pagoObservadoEm, versao, execucao]
relationships:
  - "GrupoBoleto 1—N(≥2) TituloAPagar (via GrupoBoletoTitulo: filCod/docCod/titCod + snapshot de valor líquido e vencimento)"
  - "GrupoBoleto N—1 BoletoDda (ddcCod/ditCod; snapshot, relido ao vivo na remessa)"
  - "GrupoBoleto N—0..1 ConfirmacaoEmissorBoleto (par (pesCod, emissorChave) VIGENTE ou confirmado no mesmo ato)"
  - "GrupoBoleto 1—0..N ItemLote (os N itens locais do lote, um por título, via ItemLote.grupoBoletoId)"
  - "GrupoBoleto 1—0..N borderô fin010 (externo; um por remessa em que o grupo entrou; borCod no write-ahead)"
last_review: 2026-10-20
universality_evidence:
  - "Medição PRD 2026-10-19: ~220 casos de 1 boleto → N títulos, 40+ credores (memória boleto-agrupado-n1-e-1n-medicao)"
  - "HML 2026-10-19: o Conexos paga 1 boleto por N títulos nativamente (borderô fin010 em cadastro → 1 item SISPAG com borCod → retorno baixa os N) — _inbox/sispag-boleto-agrupado-hml-achados.md"
  - "Conceito universal: fatura/boleto consolidado de um fornecedor que quita várias obrigações; toda conciliação assistida guarda quem aprovou qual agrupamento"
  - "1 cliente apenas: revisar universalidade com o Francinei (não bloqueante)"
---
```

```markdown
# GrupoBoleto

> **Origem:** ADR-0075 (2026-10-20). Registro de que **uma pessoa** confirmou que **um** boleto DDA
> paga **N ≥ 2** títulos do mesmo credor, com soma exata ao centavo. É a unidade que entra no lote
> (N `ItemLote` ligados ao grupo) e que vira **um** item nativo no `fin015`, via borderô `fin010`.
> Code-facing: `GroupedBoleto`. Tabelas propostas: `sispag_grupo_boleto` + `sispag_grupo_boleto_titulo`.
> **Status: planned.** Regras: `business-rules/boleto-agrupado-sispag.md` (I19).

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `filCod` | number | Filial de **todos** os títulos (I19d). |
| `pesCod` · `credor` | number · string | Credor único (H3: um borderô = um favorecido). |
| `emissorChave` | string | Do código do boleto; par com `pesCod` (I15g). |
| `ddcCod` · `ditCod` · `numeroBoleto` · `codbarMascarado` | | Boleto do `fin124`. Linha completa nunca persistida (I17j). |
| `valorBoleto` · `vencimentoBoleto` | number · Date | Snapshot; data civil (UTC meia-noite). |
| `titulos[]` | `{ filCod, docCod, titCod, valorLiquido, vencimento }` | Snapshot na confirmação; relido ao vivo na remessa (I19b/c). |
| `somaTitulos` | number | Σ `valorLiquido`, em centavos igual a `valorBoleto` (I19b). |
| `origem` | `SUGERIDO \| MANUAL` | Sugestão do sistema confirmada, ou composição manual (I19e/I19g). |
| `intercambiavel` | boolean | Partição fixa entre títulos e boletos iguais (I19f). |
| `avisosReconhecidos` | lista | Ex.: `TITULO_VENCE_ANTES_DO_BOLETO` (composição manual, I19g). |
| `confirmacaoEmissorId` | string | Par usado ou criado no ato. |
| `estado` | `CONFIRMADO \| ANULADO \| PAGO` | Ver "Estados". |
| `confirmadoPor` · `confirmadoEm` | string · Date | `sispag:executar`; nunca `sistema`. |
| `anuladoPor` · `anuladoEm` · `motivoAnulacao` | | Preenchidos só em `ANULADO` (CHECK); motivo 10–500. |
| `pagoObservadoEm` | Date? | Sincronização que viu os N títulos pagos (I19r). |
| `versao` | number | Lock otimista. |
| `execucao` | derivado do write-ahead | `{ flpCod, borCod, gerNum, marcador, baixas[{titulo, bxaCodSeq}], etapa }` por remessa. Forma da tabela: TaskScoper. |

## Estados

| Estado | Entra por | Sai para |
|---|---|---|
| `CONFIRMADO` | `confirmarGrupoBoleto` | `ANULADO` (pessoa, ou cascata da revogação do par) · `PAGO` (sincronização) |
| `ANULADO` | `anularGrupoBoleto` | terminal |
| `PAGO` | `sincronizarStatus` com os N pagos no `fin064` | terminal |

**Situação derivada (não persistida, só exibição):** `DISPONIVEL` (confirmado, sem lote vivo) ·
`EM_LOTE` (N itens num lote `RASCUNHO`/`FINALIZADO`) · `EM_REMESSA` (lote `REMESSA_GERADA`) ·
`REJEITADO` (J rejeitado; volta a `DISPONIVEL`, I19r) · `DIVERGENTE` (parte paga, I19r) ·
`ORFAO` (I19u). Rejeição não é estado: segue P1-5(a), "volta a confirmado, sem lote".

## Invariantes aplicáveis

I19a–u (`boleto-agrupado-sispag`); I2/I3/I4 por título (emendados); I11 com consistência de grupo;
I16a (um código, um item nativo); I17d/e/f/i/j/m (vínculo da barra ao item de borderô).
```

### A2. `ontology/business-rules/boleto-agrupado-sispag.md` (NOVO — I19)

```yaml
---
name: boleto-agrupado-sispag
type: business-rule
entity: GrupoBoleto
invariant: I19
ontology_version: "0.46.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-20
has_canonical_test: false
universality_evidence:
  - "HML 2026-10-19 (borderô 252, lote 48, PG191081.REM, retorno gar 7); PRD 2026-10-19 (PEDRONI 38883–38885 → boleto 332841)"
  - "1 cliente apenas: universalidade a revisar com o Francinei (não bloqueante)"
---
```

```markdown
# Business Rule: boleto agrupado no SISPAG — 1 boleto paga N títulos (I19)

> **Origem:** ADR-0075 (2026-10-20). Escopo: caso 1 (1 boleto → N títulos do mesmo credor). O ERP paga
> pelo **borderô** do `fin010`: em cadastro, uma baixa por título, importado como **um** item do lote
> SISPAG; o retorno do banco finaliza o borderô e baixa os N. **Sem flag e sem modos** (P0-5): ativo
> após o merge, sob o kill-switch existente `sispagLiveWriteEnabled` e o dry-run do Conexos.

## Decisões do maintainer (2026-10-20)

| # | Decisão |
|---|---|
| P0-1 | O sistema **sugere** grupos fechados; a analista **confirma** cada um; também pode **compor à mão** (o sistema só valida). Valores iguais ⇒ partição fixa "intercambiável", confirmada. |
| P0-2 | **Sugestão:** só **mesmo vencimento**. **Composição manual:** títulos até **10 dias antes** do vencimento do boleto, com aviso. |
| P0-3 | Grupo que cruza filial **bloqueado** ("não suportado, pagar à mão"); sonda V4 é follow-up. |
| P0-4 | Borderô nasce na **geração da remessa** (write-ahead, antes do `importar`). Antes do lote nativo finalizado, o sistema apaga **só o que criou**; com `vldHasRemessaPgto = 1`, nunca apaga nem cancela: `Alerta` + decisão da analista. |
| P0-5 | **Sem flag, sem off/shadow/on.** Permissões do robô conferidas pelo maintainer, **não** são portão. Primeiro `.RET` real: watchlist. |
| P1-1 | N `ItemLote` (um por título) ligados ao `GrupoBoleto`; um grupo = um item nativo; mover/retirar agem no grupo inteiro. |
| P1-2 | Soma exata ou não há grupo. Sem shadow. |
| P1-3 | Só boleto do **DDA**, par emissor `VIGENTE` ou confirmado no mesmo ato. |
| P1-4 | Grupo confirmado é **uma unidade** na formação automática; nunca dividido; títulos dele não entram avulsos. |
| P1-5 | `PAGO` só com os N pagos; parcial ⇒ divergência + `Alerta`; J rejeitado ⇒ grupo inteiro `REJEITADO`, volta a confirmado sem lote. |

## Invariantes

| # | Invariante |
|---|---|
| **I19a** | **Forma do grupo.** Um boleto DDA **livre** (sem `docCod/titCod`, I15e(1)) e **N ≥ 2** títulos do **mesmo `pesCod`** (H3). O par (`pesCod`, `emissorChave`) está `VIGENTE` ou é confirmado no mesmo ato, pela mesma pessoa (I15g, P1-3). Um título = caminho 1:1 existente (I15/I17), nunca grupo. **[inferido: N ≥ 2]** |
| **I19b** | **Soma exata ao centavo (D3, P1-2).** `round(valorBoleto×100) == Σ round(abertoLiquido(t)×100)`, com `abertoLiquido` pela régua da I17b (`fin064.totalLiquido` conferido; divergência ou campo ausente ⇒ `VALOR_ABERTO_INDISPONIVEL`, fail-closed). `valorBoleto` decodificado por nós do código. Nenhuma tolerância; a I18 não se aplica a título de grupo. Conferido na confirmação (snapshot) e **de novo ao vivo** na remessa. |
| **I19c** | **Cada título elegível.** I2 (`liberado ∧ ¬pago`), ativo, `forma = BOLETO`, `tem_boleto ≠ true` (sem DDA do ERP), sem `DecisaoSugestaoBoleto CONFIRMADA`, sem `BloqueioDuplicidade ATIVO`, fora de lote comprometido (ADR-0064) e fora de outro grupo `CONFIRMADO`. |
| **I19d** | **Uma filial (P0-3).** Todos os títulos na mesma `filCod`; o borderô e o lote são dessa filial (I4; §4 de `sispag-fin052-retorno-provado-hml.md`). Conjunto que cruza filial aparece com o motivo `CRUZA_FILIAL`, **não confirmável** ("não suportado, pagar à mão"). |
| **I19e** | **Sugestão = grupo fechado no mesmo vencimento (P0-1, P0-2).** Calculada, **não persistida** (I-DDA1). Para um boleto livre com par `VIGENTE` (ou candidato a par), o conjunto é **todos** os títulos em aberto do `pesCod` na filial com `vencimento == vencimentoBoleto` (dia civil). Só é sugerido se Σ == boleto (I19b). Nunca subconjunto (M1). Título do conjunto que falha I19c ⇒ sugestão exibida com o motivo, **não confirmável**. **[inferido: exibir em vez de omitir]** |
| **I19f** | **Intercambiáveis (PEDRONI).** K ≥ 2 boletos livres do mesmo (`pesCod`, `emissorChave`, vencimento, valor) e conjunto fechado de títulos **todos de mesmo valor**, com `valorBoleto = m × valorTitulo` (m inteiro) e Σ títulos = K × valorBoleto ⇒ partição determinística: boletos por (`ddcCod`, `ditCod`), títulos por (vencimento, `docCod`, `titCod`); o k-ésimo boleto leva o k-ésimo bloco de m títulos; grupo marcado `intercambiavel`; a analista confirma **cada** grupo. Qualquer outro caso com K ≥ 2 ⇒ sem sugestão (composição manual). **[inferido: a generalização acima de "mesmo valor"]** |
| **I19g** | **Composição manual (P0-1, P0-2).** A analista escolhe boleto e títulos; o sistema valida I19a–d e I19h. Janela por título: `0 ≤ vencimentoBoleto − vencimentoTitulo ≤ 10` dias (dia civil); fora dela ⇒ recusa (`GroupedBoletoDueWindowError`, 422). Algum título com Δ > 0 ⇒ aviso `TITULO_VENCE_ANTES_DO_BOLETO`, que exige **reconhecimento validado no servidor** (padrão I15o) e é gravado em `avisosReconhecidos`. O grupo manual **não** precisa ser fechado. **[inferido: reconhecimento no servidor]** |
| **I19h** | **Datas.** `vencimentoBoleto ≥ dataDebito` do lote (I15h); boleto vencido nunca é confirmável. Sem lote, a data de referência é o `vencimentoBoleto` (Q-C adaptada). Revalidado na inclusão e na remessa. |
| **I19i** | **Confirmação é humana e auditada.** Só `sispag:executar` confirma/anula; o sistema nunca confirma. Trilha só-inclusão: `GRUPO_CONFIRMADO`, `GRUPO_ANULADO`, `GRUPO_RETIRADO`, `BORDERO_PREPARADO`, `BORDERO_LIMPO`, `GRUPO_PAGO`, `GRUPO_DIVERGENTE`, com quem, quando, chaves e código **mascarado** (I17j). Confirmar o mesmo (boleto, títulos) de novo devolve o grupo existente (idempotência); índices únicos parciais `WHERE estado = 'CONFIRMADO'` em (boleto) e em (título). |
| **I19j** | **Unidade indivisível no lote (P1-1, P1-4).** O grupo entra no lote como N `ItemLote` (`modalidade = BOLETO`, `grupoBoletoId`), na mesma transação, ou não entra. Mover, retirar e cancelar agem no grupo inteiro; retirar **um** título do grupo ⇒ `GroupedBoletoIndivisibleError` (409). A formação automática põe o grupo inteiro no lote do **vencimento do boleto** e nunca põe título de grupo avulso. Para L6 (desfazer auto-lote com vencido), o "vencido" do grupo é o do **boleto** (ADR-0070, dia civil). **[inferido: L6 pelo vencimento do boleto]** |
| **I19k** | **Um grupo = um item nativo.** Na remessa, título de grupo **nunca** vai em `importarTitulos`; o grupo vai por borderô (I19l–n). |
| **I19l** | **Borderô do grupo (`prepararBorderoDoGrupo`, P0-4).** Etapa `preparar_bordero` do L8, depois de `criarLote` e antes de `importar`, por grupo: (1) write-ahead: marcador de correlação gravado **antes** do `POST`; (2) `POST fin010` `{ filCod do lote, borVldTipo 2, borVldFinalizado 0, borDtaMvto = dataDebito, gerNum }`, `borCod` persistido logo após; (3) por título: `fin010/baixas/validacao/tituloBaixa` → `POST fin010/baixas` (juros/multa/desconto 0, líquido = valor validado); (4) releitura: N baixas, cada uma do título esperado, e `vlrTotalLiquido == valorBoleto` em centavos. `gerNum` = conta financeira da **conta pagadora do lote**, lida ao vivo do `fin005` (H2/H10); ausente ⇒ falha **antes** do `POST`. Identidade Conexos registrada (I-2). |
| **I19m** | **Nós nunca finalizamos o borderô (D4).** Nenhuma chamada a `finalizarBordero`, `cancelarBordero` ou `fin146` sobre borderô de grupo. Quem o finaliza é o processamento nativo do retorno (`PRC_BAIXA_RETORNO_PAGFOR`, H7). |
| **I19n** | **Importar o borderô.** `fin015/finItemSispag/borderosPendentes/list/{fil}/{bnc}/{flp}` deve trazer a linha com o `borCod` do grupo (ausente ⇒ `BORDERO_NAO_PENDENTE`, determinística, causa provável `gerNum` — H2) → `borderosPendentes/importar` com a linha lida + `filCodLote`, `bncCod`, `flpCod`, **`itemy: 1`**, `op: 1`, `bncCodFin015`. O sucesso é **observado na releitura**: item com o `borCod`, sem `docCod/titCod`, `itsMnyValor == valorBoleto`. Resposta `SUCESSO` sem item observado (H4) ⇒ falha ambígua (aborta e retoma), nunca sucesso. |
| **I19o** | **Barra no item de borderô.** Mesma sequência da I17e sobre o item com `borCod`. Elegibilidade: `GrupoBoleto CONFIRMADO`, não órfão, par `VIGENTE`, boleto relido do pool (substitui a decisão por título da I17a); valor pela I19b **e** `== itsMnyValor` do item (vem do borderô, H6; a I17n não se aplica); datas pela I19g/h (substitui a I17c). Modalidade: `7` se banco da barra ≠ banco do lote; `6` (título próprio) se igual (H5). Valem I17d, I17f, I17i, I17j e I17m. **Independe do modo I17k** (P0-5): só o kill-switch o desliga. **[inferido: 6 = "título próprio"; confirmar no HML, V5]** |
| **I19p** | **Falhas.** (1) **Antes de qualquer escrita** (grupo inelegível ao vivo: título pago/não liberado, soma, boleto fora do pool, par revogado): `GroupedBoletoNotEligibleAtRemittanceError` (409) barra a remessa, nada escrito (espelho de I14a/I17g(1)). **[inferido: barrar em vez de retirar]** (2) **Depois do borderô, transitória/ambígua** (timeout, 5xx, releitura inconclusiva): aborta, ledger `failed`, borderô e rascunho preservados; a retomada continua (I19s). (3) **Depois do borderô, determinística** (recusa 4xx de baixa, `BORDERO_NAO_PENDENTE`, divergência de valor, barra recusada, código repetido — I16): o grupo é **retirado** pela maquinaria da I16d (motivo `GRUPO_BOLETO_FALHOU`, N marcas de retenção), o borderô é limpo (I19q) e a remessa segue com os demais. |
| **I19q** | **Limpeza do borderô (`limparBorderoDoGrupo`, P0-4).** Só **antes** de `finalizarLote` nativo, só com `vldHasRemessaPgto = 0`, só o borderô achado pelo **marcador do nosso write-ahead**. Ordem: `DELETE` do item nativo (se importado) → releitura (ausência) → `excluirBaixa` de cada baixa → `excluirBordero` → releitura (ausência). Sucesso = ausência observada. Disparos: retirada I19p(3)/I16d, lote local cancelado com rascunho nativo aberto. **Depois** de `vldHasRemessaPgto = 1` ou do lote nativo finalizado: **nunca** exclui nem cancela; `Alerta` `sispag-bordero-grupo-pendente` e a analista decide. |
| **I19r** | **Retorno e sincronização (P1-5).** I11 roda por título (os N `ItemLote`). Fechamento do grupo: os N `PAGO` no `fin064` ⇒ grupo `PAGO` (terminal, evento `GRUPO_PAGO`); parte paga ⇒ `divergencia` nos N itens + `Alerta` `sispag-baixa-divergente`, nunca "parcialmente pago"; J rejeitado (evento do `fin052` casado pela chave do item nativo) ⇒ os N `REJEITADO`, lote `RETORNADO`, grupo volta a `DISPONIVEL` + `Alerta` `sispag-bordero-grupo-pendente` (o borderô continua em cadastro no ERP). `borVldFinalizado` do borderô é corroboração, não prova (nível 4 de I11). |
| **I19s** | **Retomada.** Ver emenda em `retomada-remessa-sispag.md`. Borderô reconhecido **ao vivo**: pelo `borCod` do write-ahead, ou pelo marcador quando a resposta se perdeu (exatamente um ⇒ adota; dois ou mais ⇒ `indeterminado`); baixas faltantes completadas; baixa de título que não é do grupo ⇒ `indeterminado` (terceiro); borderô já importado ⇒ pula; borderô **finalizado** antes da remessa ⇒ `indeterminado` + `Alerta` (alguém baixou por fora). |
| **I19t** | **Anulação.** Pessoa com `sispag:executar`, motivo 10–500. Libera títulos e boleto. Em lote `RASCUNHO`, retira os N itens na mesma transação. **[inferido]** Em lote comprometido, vale o espelho da I17l: a tela avisa, e a próxima `gerarRemessa`/retomada retira o grupo antes do `finalizar` (ou erro nomeado se o lote nativo já finalizou). Revogar o par anula os grupos `CONFIRMADO` dele na mesma transação (cascata I15l(2)). |
| **I19u** | **Grupo órfão.** `CONFIRMADO` cujo boleto saiu do pool ou ganhou vínculo do ERP, ou com algum título pago, inativo, com DDA do ERP, ou com líquido diferente do snapshot ⇒ `orfao = true` com motivo; não entra em lote; anulável. Nunca some em silêncio. |

## Erros nomeados (planned)

| Erro | Onde | HTTP |
|---|---|---|
| `GroupedBoletoSumMismatchError` | confirmar: Σ ≠ boleto (I19b) | 422 |
| `GroupedBoletoTitleIneligibleError` | confirmar/incluir: título falha I19c | 409 |
| `GroupedBoletoCrossBranchError` | confirmar: filiais diferentes (I19d) | 422 |
| `GroupedBoletoDueWindowError` | confirmar manual fora de [0, 10] d (I19g) | 422 |
| `GroupedBoletoIndivisibleError` | retirar/mover um título de grupo (I19j) | 409 |
| `GroupedBoletoNotEligibleAtRemittanceError` | remessa, antes de escrita (I19p(1)) | 409 |
| `GroupBorderoIncompleteError` | remessa, falha transitória pós-borderô (I19p(2)) | 409 |
| `WarningAcknowledgementRequiredError` | reutilizado: aviso I19g sem reconhecimento | 422 |

## Teste canônico

PEDRONI fil 2: 38883/38884/38885 (3 × R$ 525,00, venc. 21/10) → boleto 332841 R$ 1.575,00 venc. 21/10 ⇒
sugerido, confirmado, 3 `ItemLote`, 1 borderô com 3 baixas, 1 item nativo, 1 J de R$ 1.575,00. Caso
333111 (venc. 26/10 × títulos 25/10): **não** sugerido; aceito na composição manual com aviso. HML AR
SOLUÇÕES (552/1 + 558/1 → borderô 252 → flp 48 → gar 7). Negativos: ±R$ 0,01; dois credores; outra
filial; título pago na remessa; título em outro lote vivo; `gerNum` errado; `importar` sem item observado.
```

### A3. Ações novas (frontmatter; corpo segue o padrão de `vincular-codigo-barras-ao-item.md`)

**`actions/sispag/sugerir-grupos-boleto.md`** — `name: sugerirGruposBoleto`, `entity: GrupoBoleto`, `planned`
- pre: boleto livre no pool; par `VIGENTE` ou candidato; leitura do pool e da carteira legíveis.
- post: lista calculada de grupos fechados (I19e) e intercambiáveis (I19f), cada um com `confirmavel` e motivo; nada persistido.
- side_effects: nenhum (só leitura local).

**`actions/sispag/confirmar-grupo-boleto.md`** — `name: confirmarGrupoBoleto`, `planned`
- pre: `sispag:executar`; I19a–d, I19g/h reavaliados ao vivo (anti-TOCTOU, nunca do cache); avisos reconhecidos quando exigidos.
- post: `GrupoBoleto CONFIRMADO` + N `GrupoBoletoTitulo`; par criado/reutilizado; evento `GRUPO_CONFIRMADO`; títulos fora da sugestão 1:1 (`EM_GRUPO`).
- side_effects: escrita só local; zero escrita no Conexos.

**`actions/sispag/anular-grupo-boleto.md`** — `name: anularGrupoBoleto`, `planned`
- pre: grupo `CONFIRMADO`; motivo 10–500; `sispag:executar`.
- post: `ANULADO`; títulos e boleto liberados; em `RASCUNHO`, N itens retirados (I19t); evento `GRUPO_ANULADO`.
- side_effects: local; aviso se o grupo está em lote comprometido.

**`actions/sispag/preparar-bordero-do-grupo.md`** — `name: prepararBorderoDoGrupo`, `entity: LotePagamento`, `planned`
- pre: L8 em curso; lote nativo aberto; grupo elegível ao vivo (I19p(1)); `gerNum` lido; kill-switch ligado.
- post: borderô em cadastro com N baixas conferidas (I19l), importado como um item (I19n), barra vinculada (I19o); `BORDERO_PREPARADO`.
- side_effects: escrita no ERP (`fin010`, `fin010/baixas`, `fin015 borderosPendentes/importar`, sequência I17e); write-ahead com marcador e identidade (I-2).

**`actions/sispag/limpar-bordero-do-grupo.md`** — `name: limparBorderoDoGrupo`, `planned`
- pre: `vldHasRemessaPgto = 0`; lote nativo não finalizado; borderô achado pelo nosso marcador.
- post: item nativo, baixas e borderô ausentes na releitura; `BORDERO_LIMPO`.
- side_effects: `DELETE finItemSispag`, `excluirBaixa`, `excluirBordero`; nunca `cancelarBordero`.

### A4. `entities/lote-pagamento.md`

- frontmatter `properties` + `itens[].grupoBoletoId`; `relationships` + `"ItemLote N—0..1 GrupoBoleto (os N títulos de um boleto agrupado; um grupo = um item nativo no fin015; ADR-0075, planned)"`.
- tabela `ItemLote`, nova linha:

```
+ | `grupoBoletoId` | string? | `lote_pagamento_item.grupo_boleto_id` *(migration 0089)* | Grupo a que o item pertence (ADR-0075, `planned`). Os N itens do grupo entram, saem e se movem juntos (I19j); na remessa viram **um** item nativo de borderô (I19k). `vinculoCodigoBarras` fica nulo nesses itens: o vínculo é do grupo (I19o). |
```

- "Invariantes aplicáveis": acrescentar `- **I19 (boleto agrupado, ADR-0075, planned):** ver business-rules/boleto-agrupado-sispag.md.`

### A5. Emendas de regras existentes

**I2 — `elegibilidade-titulo-lote.md`** (nova seção antes de "Teste canônico")
```
+ ## Emenda ADR-0075 (`planned`) — título de boleto agrupado
+ A regra vale **por título** do grupo, nos dois pontos (inclusão e finalização). Um título do grupo
+ inelegível barra a inclusão do grupo inteiro e, no `finalizarLote`, barra a finalização listando o grupo;
+ nunca se paga parte de um grupo. Na remessa, a revalidação ao vivo é a I19p(1).
```

**I3 — `nao-duplicacao-titulo-lote.md`**
```
+ ## Emenda ADR-0075 (`planned`) — grupos
+ - Título em `GrupoBoleto CONFIRMADO` não entra avulso em lote nem em outro grupo (UNIQUE parcial em
+   `sispag_grupo_boleto_titulo` `WHERE estado = 'CONFIRMADO'`); o boleto também (um grupo por boleto,
+   e nunca grupo + `DecisaoSugestaoBoleto CONFIRMADA`).
+ - A UNIQUE de `ItemLote` segue por título: os N itens do grupo a ocupam normalmente. Mover/retirar
+   aplicam-se ao grupo inteiro na mesma transação (I19j).
```

**I4 — `lote-uma-filial.md`**
```
+ ## Emenda ADR-0075 (`planned`)
+ Os títulos do grupo e o borderô são da filial do lote (I19d). Grupo que cruza filial não é confirmável
+ nesta entrega (sonda V4 no watchlist).
```

**I11 — `sincronizacao-status-lote-sispag.md`** (após "Invariantes")
```
+ - **I11i — consistência do grupo (ADR-0075, `planned`).** Os N itens de um `GrupoBoleto` são lidos como
+   hoje, por título. O evento do `fin052` do item nativo de borderô (chave fil/bnc/flp/its) vale para os N.
+   Os N `PAGO` ⇒ grupo `PAGO`; parte paga ⇒ `divergencia` nos N + `Alerta` `sispag-baixa-divergente`
+   (I11f); rejeição ⇒ os N `REJEITADO` (I11d) + `Alerta` `sispag-bordero-grupo-pendente`. Ver I19r.
```

**I15 — `sugestao-boleto-dda-sispag.md`**
```
+ | **I15q** | **Boleto agrupado (ADR-0075, `planned`).** Título em `GrupoBoleto CONFIRMADO` tem o desfecho
+ `EM_GRUPO` (I15m) e sai da sugestão 1:1; o boleto do grupo não é candidato de nenhum título (exclusão (4)
+ da I15e). Título com `DecisaoSugestaoBoleto CONFIRMADA` não entra em grupo. A sugestão de grupos é a I19e/f,
+ separada desta. |
```
- I15e: acrescentar exclusão `(4) boleto de GrupoBoleto CONFIRMADO`. I15m: `+ EM_GRUPO` no enum.

**I16 / regra de ausência — `boleto-exige-codigo-de-barras.md`**
```
+ > **Emenda ADR-0075 (`planned`) — item de borderô.**
+ > - **I16a** vale sobre o item nativo de borderô (o grupo é **um** item; a barra aparece uma vez).
+ > - **I16d** retirar o item de borderô retira o **grupo inteiro** (N `ItemLote`, N marcas `BloqueioDuplicidade`
+ >   origem `GRUPO_BOLETO`) e dispara `limparBorderoDoGrupo` (I19q). Motivo novo em `SystemRemovalReason`:
+ >   `GRUPO_BOLETO_FALHOU`.
+ > - **I16d.1** o item de borderô de grupo confirmado conta como "com decisão humana vigente" no desempate.
+ > - **I16e** a mensagem cita `borCod`, os títulos do grupo e o código mascarado.
+ > - **I16h** `nossas` = títulos avulsos do lote ∪ `borCod`s dos grupos do write-ahead; item nativo com
+ >   `borCod` que não é nosso é **intruso**.
+ > - **Ausência (ADR-0040):** item de borderô sem barra observada antes do `finalizar` aborta como hoje.
```

**I17 — `vinculo-codbar-item-sispag.md`** (nova linha na tabela)
```
+ | **I17o** | **Item de borderô (ADR-0075, `planned`).** Para o item nativo com `borCod` de um `GrupoBoleto`:
+ I17a ⇒ grupo `CONFIRMADO` não órfão + par `VIGENTE` (sem decisão por título); I17b ⇒ I19b e `== itsMnyValor`;
+ I17c ⇒ I19g/h; **I17n não se aplica** (o valor vem do borderô, H6); modalidade 7/6 pela I19o; I17d, I17e,
+ I17f, I17i, I17j e I17m inalteradas. **Não** depende do modo I17k (P0-5). Ordem da I17h:
+ `importar (títulos + borderôs) → vincular_codbar → guarda I16 → finalizar → gerar_remessa`. |
```

**Retomada — `retomada-remessa-sispag.md`** (após a emenda ADR-0071)
```
+ > **Emenda ADR-0075 (`planned`) — etapa `preparar_bordero`.** Entre `criarLote` e `importar`, **persistida**
+ > no write-ahead (escreve no ERP; diferente de `vincular_codbar`): marcador antes do `POST fin010`, `borCod`
+ > logo depois. Reconhecimento ao vivo:
+ >
+ > | Estado observado | Ação |
+ > |---|---|
+ > | marcador gravado, `borCod` ausente, nenhum borderô com o marcador | cria |
+ > | exatamente um borderô com o marcador | adota |
+ > | dois ou mais | `indeterminado` |
+ > | borderô com parte das baixas | completa só as faltantes |
+ > | baixa de título que não é do grupo | `indeterminado` (terceiro) |
+ > | borderô completo, não importado | `importar` |
+ > | item com o `borCod` no rascunho | pula |
+ > | borderô finalizado antes da remessa | `indeterminado` + `Alerta` |
+ >
+ > A tabela "Aberto, com PARTE das chaves" passa a contar `borCod`s como chaves. Lote nativo **finalizado**
+ > nunca limpa borderô (I19q).
```

**Máquina — `state-machines/lote-pagamento.md`**
```
+ ## Emenda ADR-0075 (`planned`) — boleto agrupado
+ - **L2:** `incluirGrupo`/`moverGrupo`/`removerGrupo` (N itens na mesma transação, I19j); remover um título de
+   grupo ⇒ `GroupedBoletoIndivisibleError`.
+ - **L3:** I2 revalidada por título; grupo com título inelegível barra a finalização.
+ - **L5:** cancelar com rascunho nativo aberto dispara `limparBorderoDoGrupo` (I19q).
+ - **L6:** "vencido" do grupo = vencimento do boleto.
+ - **L8:** `criarLote → preparar_bordero → importar (títulos avulsos + borderôs) → vincular_codbar → guarda I16
+   → finalizar → gerar_remessa`. Sem estado novo de lote.
+ - **L11:** I11i.
```

**Ações existentes (uma linha cada):** `formar-lotes-automaticos` (I19j, P1-4); `gerenciar-lote-candidato`
(incluir/mover/remover grupo); `finalizar-lote` (I2 por grupo); `vincular-codigo-barras-ao-item` (I17o).

**Entidades (uma linha cada):** `boleto-dda` + `"BoletoDda 0..1—0..N GrupoBoleto"`; `decisao-sugestao-boleto`
nota "título em grupo não tem decisão 1:1"; `bloqueio-duplicidade` `origem` + `GRUPO_BOLETO`; `alerta`
+ `sispag-bordero-grupo-pendente` (id do grupo; I19q/I19r).

### A6. `integrations/conexos.md` — seção nova (após "renegociação de centavos")

```markdown
### ESCRITA SISPAG — borderô do boleto agrupado (ADR-0075, `planned`)

Provado em HML em 2026-10-19 (`_inbox/sispag-boleto-agrupado-hml-achados.md`). Reaproveita `ConexosBaixaClient`
(`criarBordero`, `listBaixas`, `excluirBaixa`, `excluirBordero`) e `ConexosSispagClient.listContasCorrentes`.

| # | Chamada | Corpo / regra |
|---|---|---|
| 1 | `fin005/list` | `gerNum` da conta pagadora do lote (H2, H10). Ausente ⇒ falha antes de escrever. |
| 2 | `POST fin010` | `{ filCod, borVldTipo 2, borVldFinalizado 0, frontModelName 'bordero', borDtaMvto, gerNum }` ⇒ `borCod`. Marcador de correlação num campo de observação **(nome a medir no HML)**. |
| 3 | `POST fin010/baixas/validacao/tituloBaixa` | `{ filCod, borCod, borVldTipo 2, docTip 2, docCod, titCod, bxaVldSistema 0, bxaVldCcorrente 0, bxaVldCorrenteDc 1, bxaVldAdto 0, frontModelName 'baixa' }` ⇒ `bxaMnyValor`. |
| 4 | `POST fin010/baixas` | `responseData` + chave + `gerNum`, juros/multa/desconto 0, `bxaMnyLiquido = bxaMnyValor`. Títulos continuam em aberto. |
| 5 | `GET fin015/finItemSispag/borderosPendentes/list/{fil}/{bnc}/{flp}` | Linha `{ borCod, pesCod, dpeNomPessoa, vlrTotal, borVldTipo, filCod, pesCodCont, itemy 0 }`. Só aparece se `gerNum` = conta do lote; o filtro **não** é a filial. |
| 6 | `POST …/borderosPendentes/importar` | `{ items: [{ …linha, filCodLote, bncCod, flpCod, itemy: 1 }], op: 1, bncCodFin015 }`. **`itemy 0` ⇒ `SUCESSO` sem importar** (H4): sucesso só pela releitura. |
| 7 | vínculo da barra | sequência I17e no item (`borCod`, sem `docCod/titCod`, nasce modalidade 4); `7` banco ≠, `6` banco = (H5). |
| 8 | `finalizarLote` / `gerarRemessa` | inalterados; o J paga o total do borderô (H6); `vldHasRemessaPgto` do borderô vira 1 (H9). |
| 9 | retorno (`fin052` `processar`) | parser `ger015.gtbLngSql`: `BOR_COD` não nulo → `FIN_BORDERO` → `FIN_TITULO_RETBANCO` com `BOR_COD` → `PRC_BAIXA_RETORNO_PAGFOR('BAIXAR')`: finaliza o borderô e baixa os N (H7). Chave do J nas posições 183–202 (`fil(2) bnc(4) flp(7) its(7)`), ocorrência em 231. `.RET` sintético com J-52 falha (limite do sintético, H8). |
| 10 | limpeza | `DELETE finItemSispag` → `excluirBaixa` × N → `excluirBordero`; só em cadastro e com `vldHasRemessaPgto 0`. Nunca `finalizarBordero`/`cancelarBordero`/`fin146`. |

Frontmatter: `consumes` + `"fin010 (SISPAG — borderô do boleto agrupado, WRITE, ADR-0075 planned)"` e
`"fin015 borderosPendentes list/importar (WRITE, ADR-0075 planned)"`; `direction` deixa de dizer "SISPAG READ-only".
```

### A7. Glossário

```
+ **Boleto agrupado** — um boleto DDA que paga N títulos do mesmo credor (soma exata). Modelo: `GrupoBoleto` (ADR-0075).
+ **Borderô pendente (SISPAG)** — borderô `fin010` em cadastro, na conta financeira da conta pagadora do lote, que o
+ `fin015` oferece para importar como item. Não confundir com borderô de permuta (Frente I).
```

### A8. Metadados (planejados)

**`_index.json`**
- `_meta.version` `0.45.0 → 0.46.0`; `_meta.generated` `2026-10-20`; `note` prefixada com
  `v0.46.0 (2026-10-20, ADR-0075, feature sispag-boleto-agrupado): NEW entity GrupoBoleto (planned), NEW business rule boleto-agrupado-sispag (I19a-u, planned), 5 NEW actions (planned); emendas I2/I3/I4/I11i/I15q/I16/I17o, retomada preparar_bordero, L2/L3/L5/L6/L8/L11; integração fin010 borderô + fin015 borderosPendentes. Migration prevista 0089.`
- `entities.GrupoBoleto = { file: "entities/grupo-boleto.md", status: "planned", impl_files: [] }`
- `business_rules.boleto-agrupado-sispag = { file, entity: "GrupoBoleto", invariant: "I19", status: "planned", has_canonical_test: false, impl_files: [] }`
- `actions.{sugerirGruposBoleto, confirmarGrupoBoleto, anularGrupoBoleto}` (entity `GrupoBoleto`) e
  `{prepararBorderoDoGrupo, limparBorderoDoGrupo}` (entity `LotePagamento`), todos `planned`, `impl_files: []`.

**`_coverage.json` (`summary`)**
| Campo | Antes | Depois |
|---|---|---|
| `entities_total` / `entities_planned` | 28 / 5 | **29 / 6** |
| `entities_coverage_pct` | 74 | recalcular pela fórmula vigente (+1 entidade planned no denominador) |
| `actions_total` / `actions_planned` | 45 / 7 | **50 / 12** |
| `business_rules_total` / `business_rules_planned` | 30 / 11 | **31 / 12** |

Regras emendadas mantêm o status atual (emendas marcadas `planned` dentro do arquivo, precedente ADR-0072).
`by_entity.GrupoBoleto` e `by_business_rule.boleto-agrupado-sispag` com `status: planned`, `impl_pct: 0`.

**`ontology/CHANGELOG.md`**: entrada `## v0.46.0 — SISPAG: boleto agrupado (1 boleto → N títulos) pelo borderô do fin010 (2026-10-20, ADR-0075)`.

**`_inbox/_watchlist.md`** — nova seção `## 2026-10-20 — sispag-boleto-agrupado (ADR-0075)`:
- Primeiro `.RET` **real** do Itaú com item de borderô (V6) — acompanhar, não é portão (P0-5).
- Permissões do CLONEX em PRD (`fin010` borderô/baixa, `borderosPendentes/list|importar`, leitura de itens `fin015`; V1) — conferência do maintainer, não portão.
- V2: título com baixa em borderô em cadastro segue "em aberto" no `fin015`/carteira? Risco de baixa manual paralela ou import avulso por terceiro.
- V3: ordem `DELETE` item → `excluirBaixa` → `excluirBordero` depois de importado (medir no HML durante o TDD).
- V4: grupo que cruza filial (INTERNACIONAL SERV. ADUANEIROS).
- V5: código de "título próprio" para barra do banco da conta (341).
- V7: borderô com `vldHasRemessaPgto 1` reaparece em `borderosPendentes` depois de rejeição/cancelamento?
- Quase-grupos ±R$ 0,05 (P1-2): medição pontual, se desejada.
- Caso 2 (VIBE LOG, N boletos → 1 título): baixa parcial em dois borderôs?
- Boleto digitado fora do DDA (P1-3 b).

### A9. Doc-as-code — `docs/sispag/ANEXO-requisitos.md` (R-21)

```
+ Emenda (ADR-0075, 2026-10-20, planned): boleto que paga N títulos do mesmo credor entra como **um** item,
+ via borderô `fin010` em cadastro importado no `fin015` (`borderosPendentes`); a analista confirma o grupo
+ (soma exata, mesma filial). O retorno do banco finaliza o borderô e baixa os N títulos.
```
`CLAUDE.md` (raiz) — **proposta** de Gotcha curto: "Boleto agrupado (ADR-0075): o borderô do grupo só aparece
pendente no lote se `gerNum` = conta financeira da conta pagadora; `importar` exige `itemy: 1` (com 0 responde
SUCESSO e não importa); nós nunca finalizamos o borderô."

---

## Parte B — Texto do ADR `ontology/decisions/0075-sispag-boleto-agrupado-bordero.md`

```markdown
---
adr_number: 0075
title: SISPAG — boleto agrupado (1 boleto → N títulos) pago pelo borderô do fin010
date: 2026-10-20
status: accepted
type: addition
related_entities: [GrupoBoleto, LotePagamento, TituloAPagar, BoletoDda, ConfirmacaoEmissorBoleto, DecisaoSugestaoBoleto]
related_business_rules: [boleto-agrupado-sispag, vinculo-codbar-item-sispag, sugestao-boleto-dda-sispag, boleto-exige-codigo-de-barras, elegibilidade-titulo-lote, nao-duplicacao-titulo-lote, lote-uma-filial, sincronizacao-status-lote-sispag, retomada-remessa-sispag]
continues: [0040, 0068, 0069, 0071, 0074]
evidence:
  - ontology/_inbox/sispag-boleto-agrupado-interview.md
  - ontology/_inbox/sispag-boleto-agrupado-hml-achados.md
  - "HML 2026-10-19: borderô 252 (gerNum 38) → lote flp 48 → PG191081.REM (um J de 2.346,94) → retorno gar 7: 552/1 e 558/1 pagos, borderô finalizado"
  - "PRD 2026-10-19 (só leitura): ~220 casos 1→N, 40+ credores; subset-sum livre = 922/2369 falsos"
---

# ADR 0075: boleto agrupado pago pelo borderô do fin010

**Branch:** `feat/sispag-boleto-agrupado`. `/feature-tweak`. `entity_changed = true`. Ontologia **0.46.0**
(entidade, regra e ações `planned`). Migration prevista: **0089**. App: 0.72.0.

## Contexto

Um boleto que paga vários títulos do mesmo credor (PEDRONI: 3 × R$ 525,00 → um boleto de R$ 1.575,00) não
cabe no SISPAG hoje: o item do lote é sempre um título, a sugestão casa um boleto com um título e o vínculo
(I17b) exige barra igual ao líquido de cada título. A analista tira os títulos do lote e paga à mão. Em HML,
o Conexos mostrou o caminho nativo: um borderô `fin010` em cadastro com uma baixa por título é oferecido pelo
`fin015` como **um** item (sem título, com `borCod`), recebe a barra, o J paga o total do borderô e o retorno
do banco finaliza o borderô e baixa os N títulos.

## Decisão

1. **Entidade nova `GrupoBoleto`** (1 boleto DDA ↔ N ≥ 2 títulos, confirmado por pessoa) e **regra nova
   `boleto-agrupado-sispag` (I19a–u)**: mesmo credor, mesma filial, soma exata ao centavo, títulos aprovados
   e não pagos, boleto do DDA com par de emissor vigente.
2. **Sugestão só de grupo fechado no mesmo vencimento**; a analista confirma. **Composição manual** aceita
   títulos até 10 dias antes do vencimento do boleto, com aviso reconhecido.
3. No lote, **N itens (um por título) ligados ao grupo**, que entram, saem e se movem juntos; na remessa,
   **um** item nativo de borderô.
4. O borderô nasce **na geração da remessa** (etapa `preparar_bordero`, write-ahead com marcador), na conta
   financeira (`gerNum`) da conta pagadora do lote, lida ao vivo do `fin005`. **Nós nunca finalizamos o
   borderô**: quem finaliza é o retorno do banco.
5. Antes do lote nativo finalizado, o sistema desfaz **só o borderô que criou**. Depois da remessa
   (`vldHasRemessaPgto = 1`) nunca apaga nem cancela: `Alerta` e decisão da analista.
6. O grupo é `PAGO` só com os N títulos pagos; parte paga é divergência; J rejeitado devolve o grupo inteiro
   para "confirmado, sem lote".
7. **Sem flag e sem modos.** Ativo após o merge, sob o kill-switch existente (`sispagLiveWriteEnabled`) e o
   dry-run do Conexos. O vínculo da barra ao item de borderô **não** depende do modo da I17k.

## Decisões do maintainer (2026-10-20)

| # | Decisão |
|---|---|
| P0-1 | Sugere grupos fechados; a analista confirma; composição manual possível; valores iguais ⇒ partição fixa "intercambiável". |
| P0-2 | Sugestão: mesmo vencimento. Manual: até 10 dias antes do vencimento do boleto, com aviso. |
| P0-3 | Grupo que cruza filial bloqueado; V4 é follow-up. |
| P0-4 | Borderô na geração da remessa; limpeza só do que criamos, só antes do lote nativo finalizado; depois, `Alerta`. |
| P0-5 | Sem flag/modos; permissões do robô conferidas pelo maintainer, não são portão; primeiro `.RET` real em watchlist. |
| P1-1 | N `ItemLote` ligados ao grupo; um grupo = um item nativo. |
| P1-2 | Soma exata ou nada. |
| P1-3 | Só boleto do DDA, par vigente ou confirmado no ato. |
| P1-4 | Grupo é uma unidade na formação automática. |
| P1-5 | `PAGO` com os N; parcial = divergência + `Alerta`; rejeição devolve o grupo. |

## Rejeitado

- **`fin146` (Baixa Agrupada)** — REJECT-WORKAROUND: baixa os títulos ao finalizar, antes de o banco pagar
  (HML, bagCod 1 cancelado).
- **Juntar os N títulos num só pelo `fin070`** — REJECT-WORKAROUND: altera o documento, volta à alçada
  (`fin103`), é mais lento, e o caminho nativo existe.
- **Deixar o boleto agrupado fora do SISPAG** — rejeitado pelo maintainer (D1).
- **Grupo que cruza filial** — REJECT-PREMATURE: depende da sonda V4 (o parser do retorno exige item e lote
  na mesma filial). Watchlist.
- **Flag por filial, modos `off/shadow/on`, permissão do robô como portão** — REJECT-NOT-DOMAIN (P0-5):
  rollout é operação, não modelo; precedente da emenda de 2026-10-20 do ADR-0074.
- **Janela de ±5/10 dias na sugestão** — rejeitado (P0-2): a sugestão é só no mesmo vencimento.
- **Subconjunto livre (subset-sum)** — REJECT-PREMATURE: 922 de 2369 falsos na medição de PRD.
- **`ItemLote.tipo = BORDERO` com títulos numa tabela filha** — REJECT-DUPLICATE (P1-1): esconderia os títulos
  de I2/I3/I4/I11.
- **Entidade `BorderoGrupo`** — REJECT-DUPLICATE: o borderô é do ERP; `borCod` e marcador são execução do grupo.
- **Criar o borderô na confirmação** — REJECT-WORKAROUND: viola I1 e deixa borderô parado por dias.
- **Finalizar o borderô nós mesmos / livro paralelo de baixa** — REJECT-WORKAROUND / REJECT-DUPLICATE: o
  retorno nativo baixa; a I11 observa o título.
- **Absorver centavos numa baixa do borderô ou aplicar a I18 a um título do grupo** — REJECT-PREMATURE (P1-2).
- **Boleto digitado fora do DDA** — REJECT-PREMATURE (P1-3).
- **Caso 2 (N boletos → 1 título, VIBE LOG)** — REJECT-PREMATURE: fora do escopo (D2). Watchlist.
- **`gerNum` como configuração por filial** — REJECT-CONFIG: é lido ao vivo do `fin005`.

## Consequências

- **O item nativo do lote deixa de ser sempre um título.** Guarda I16, vínculo I17, retomada e sincronização
  passam a reconhecer o item de borderô (I16h: `borCod` nosso não é intruso).
- **A I1 continua:** nada vai ao ERP antes de `FINALIZADO`; o borderô faz parte do L8.
- **A I17n não vale para o item de borderô** (o valor vem do borderô); a I17m (barra == pagamento do J) vale.
- O SISPAG passa a escrever no `fin010` (antes só Permutas e Recebimentos); a identidade Conexos é registrada (I-2).
- Um J rejeitado deixa um borderô em cadastro no ERP: `Alerta` e decisão da analista (sem limpeza automática).
- Universalidade: 1 cliente; revisão com o Francinei não bloqueante.

## Premissas e verificações (não bloqueiam; P0-5)

Permissões do CLONEX em PRD (V1, conferência do maintainer); primeiro `.RET` real com item de borderô (V6);
V2, V3, V5, V7 medidas no HML durante o TDD; V4 é follow-up.

## CHANGELOG (app, para a analista)

> **Boleto que paga vários títulos agora vai pelo SISPAG.** Quando um fornecedor manda **um** boleto para
> pagar **vários** títulos (por exemplo, três de R$ 525,00 num boleto de R$ 1.575,00), o sistema sugere o
> grupo se os títulos do fornecedor que vencem no mesmo dia do boleto somam exatamente o valor dele. Você
> confere e confirma. Também dá para montar o grupo à mão, com títulos que vencem até 10 dias antes do
> boleto (o sistema avisa e pede sua confirmação). No lote, o grupo aparece numa linha só, que abre para
> mostrar os títulos; ele entra, sai e muda de lote inteiro. Na remessa, o sistema cria um borderô no
> Conexos com uma baixa por título e paga o boleto **uma vez**; quando o banco devolve o retorno, o Conexos
> baixa todos os títulos. A soma precisa bater ao centavo e todos os títulos precisam ser da mesma filial;
> se não for o caso, o pagamento continua sendo feito à mão.
```

---

## Pontos inferidos (o que eu deduzi)

Não mudam o desenho, salvo os marcados com **(?)**; TaskScoper pode seguir com o default:

1. N ≥ 2 títulos (I19a); 1 título segue o caminho 1:1.
2. Aviso da composição manual exige reconhecimento no servidor, como a I15o (I19g).
3. `borDtaMvto` = data de débito do lote (o probe usou o débito); marcador de correlação em campo de observação do `fin010` com nome a medir.
4. Modalidade `6` = "título próprio" para barra do banco da conta (I19o; o ANEXO já registra 341→6). Confirmar no HML (V5).
5. Grupo inelegível na remessa **barra** a remessa antes de escrever (I19p(1)), espelho da I14a, em vez de retirar.
6. Anular grupo em lote `RASCUNHO` retira os N itens na mesma transação (I19t).
7. **(?) Sugestão com título do conjunto fechado ainda não aprovado (I19e):** exibir como "não confirmável, aguardando alçada" (default) ou ignorar o título e sugerir os demais se somarem? A segunda opção quebra o "grupo fechado" e reabre ruído; recomendo a primeira.
8. **(?) Formação automática/L6 (I19j):** o "vencido" do grupo é o vencimento do **boleto**. Sem isso, um grupo manual com título vencendo antes do boleto seria desfeito pelo cron no dia do vencimento do título. Recomendo vencimento do boleto.
9. **(?) Volta depois de J rejeitado (I19r):** o borderô antigo fica em cadastro com `vldHasRemessaPgto = 1`. Default proposto: o grupo só volta a uma remessa quando a analista resolve o borderô antigo no ERP; se ele reaparecer em `borderosPendentes` do lote novo (V7), o sistema **reaproveita** em vez de criar outro. Se preferir nunca reaproveitar, a regra fica mais simples (sempre exige a resolução manual).

---
Para revisar e responder:
- **approve** — escrever como proposto, criar o ADR 0075, atualizar `_index`/`_coverage`/CHANGELOG/watchlist
- **edit [arquivo] [instrução]** — alterar antes de escrever
- **reject [motivo]** — bloquear o diff inteiro (crio um ADR de "decisão de não mudar")
- **partial [aceitar itens …] [rejeitar itens …]**
