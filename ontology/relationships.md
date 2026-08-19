# Relacionamentos entre Entidades

> Relações do domínio, por frente. Atualizado pelo `OntologyCurator` a cada entidade/relação aceita.
> Sync 2026-06-21 (commit df90fa6): adiciona `Permuta` (alocação) e `ClienteFiltro`
> (ADR-0007/0008/0009). Sync 2026-08-19 (ADR-0038): adiciona a **Frente V** e registra
> explicitamente a **não-relação** entre `TituloAprovacao` e `TituloAPagar`.
>
> As Frentes II, III e IV ainda não têm seção aqui — suas relações estão descritas nos arquivos de
> entidade. Preencher num `/retro-ontology`.

## Frente I — Permutas

| Origem | Relação | Destino | Cardinalidade |
|--------|---------|---------|---------------|
| `Adiantamento` | vinculado por `priCod` a | `Invoice` | 1—1 na permuta automática (P0-6: 1 invoice FINALIZADA); N:M → casamento-manual/permuta-manual |
| `Adiantamento` | tem declaração (Gate 4) | `DeclaracaoImportacao` | 1—1 (D.I XOR DUIMP, I2) — dispensada na permuta-manual (cliente-filtro) |
| `Adiantamento` | roteado por (via `pesCod`) | `ClienteFiltro` | N—1 (importador cadastrado → permuta-manual, ADR-0007) |
| `PermutaCandidata` | tem lado-débito | `Adiantamento` | 1—1 |
| `PermutaCandidata` | tem lado-crédito (quando casada) | `Invoice` | 1—1 (casada = exatamente 1 invoice FINALIZADA, P0-6) |
| `PermutaCandidata` | tem data-base via | `DeclaracaoImportacao` | 1—1 (existência/XOR; data-base P0-4 RESOLVIDO) |
| `PermutaCandidata` | tem cálculo derivado | `VariacaoCambial` | 1—1 (classificação por TAXA de câmbio, P0-1) |
| `PermutaCandidata` | origina (permuta-manual/casamento-manual) | `Permuta` | 1—* (alocações N:M, ADR-0008) |
| `Permuta` | tem lado-débito (link livre) | `Adiantamento` | N—1 (via `adiantamentoDocCod`) |
| `Permuta` | tem lado-crédito (link livre, pode ser cross-process) | `Invoice` | N—1 (via `invoiceDocCod`) |
| `Permuta` | tem variação (valor parcial, taxa da invoice) | `VariacaoCambial` | 1—1 |

> **Fase 3 (fora de escopo):** a `Permuta` consumada (alocação) **já é modelada** (`permuta_alocacao`,
> READ-ONLY). O que falta é a **baixa efetiva** no ERP via a ação `reconciliarPermuta` (escrita
> `fin010`) — caminho de write-back não validado (risco #1, ADR-0002/0003 O3). Por isso `Permuta` é
> `partial`.

## Frente V — Workflow de Aprovação

Sync 2026-08-19 (ADR-0038, fatias F1+F2). O grafo da Frente V é pequeno de propósito: a frente
observa um mecanismo do ERP e não cria agregado revisável nenhum.

| Origem | Relação | Destino | Cardinalidade |
|--------|---------|---------|---------------|
| `TituloAprovacao` | tem a trilha (via `filCod:docCod:titCod`) | `EtapaAprovacao` | 1—N (N = 0 é **legítimo**: `statusWorkflow = SEM_WORKFLOW`, ~metade dos títulos da filial 2) |
| `TituloAprovacao` | teve seu status derivado das | `EtapaAprovacao` | 1—N (derivação, não posse: `status_workflow` é recalculado a cada ingestão, nunca lido do ERP) |
| `TituloAprovacao` | foi observado na | `AprovacaoIngestaoRun` | N—1 (via `ingestaoRunId` — auditoria de cadência; a run **não é entidade de domínio**, é registro operacional da tabela `aprovacao_ingestao_run`) |
| `EtapaAprovacao` | pertence a | `TituloAprovacao` | N—1 (chave natural completa: `filCod:docCod:titCod:fblCod:ftbCod`) |
| `EtapaAprovacao` | foi observada na | `AprovacaoIngestaoRun` | N—1 (via `ingestaoRunId`) |
| `EtapaAprovacao` | aponta para uma pessoa **por nome** | _(sem entidade)_ | N—1 **conceitual, não modelada** — a identidade é o texto normalizado de `usnDesNomeCmd`; `usnCodCmd` não vem na projeção acessível (**PV-10**). Sem código estável, criar uma entidade `Aprovador` seria inventar uma chave |
| `EtapaAprovacao` | carrega um rótulo de alçada | _(sem entidade)_ | **não modelada** — o campo `aprovador` mistura setor (`COMPRAS`) e pessoa (`RICARDO DO PRADO`), então não é dimensão confiável. A configuração real de alçadas vive em `fin102`/`fin106`, hoje inacessíveis (**PV-07**) |

### `TituloAprovacao` × `TituloAPagar` — a NÃO-relação (leia antes de "unificar")

As duas entidades descrevem títulos do **mesmo ERP**, com nomes quase iguais, e **não são a mesma
coisa**. Não compartilham tabela, não compartilham ingestão e não devem ser fundidas.

| | `TituloAPagar` (Frente II — SISPAG) | `TituloAprovacao` (Frente V) |
|---|---|---|
| Pergunta que responde | "o que eu pago hoje?" | "quem aprovou, e quanto demorou?" |
| Fonte no Conexos | `fin064/list` (carteira corrente) + alçada `com298` | `psq014/list` (pesquisa/histórico) + `fin026/infoTitulo/list` |
| Recorte | janela de **vencimento**, doméstico (ADR-0021) | janela de **emissão**, histórico, 12 meses (PV-08) |
| Cadência | diária, volátil — a carteira de hoje não é a de ontem | histórica; um título resolvido não muda mais |
| Tabela | `titulo_a_pagar` | `aprovacao_titulo` |
| Anti-fantasma | **global** (`marcarInativosForaDaRun`) | **por título** — o global seria destrutivo num backfill parcial |

**A evidência de que os universos são disjuntos:** o doc 4156 (filial 1), que tem trilha de aprovação
completa e é o caso canônico dos testes, **não aparece** no `fin064`/carteira corrente. Uma entidade
única precisaria de duas ingestões, duas janelas e dois anti-fantasmas contraditórios sobre a mesma
tabela.

**O que se perderia ao unificar:** `TituloAprovacao` herdaria as regras de elegibilidade de lote da
Frente II (`elegibilidade-titulo-lote`, `lote-uma-filial`, ADR-0021) — regras sobre *o que pode ser
pago*, que nada dizem sobre *quem aprovou*. E o anti-fantasma global do SISPAG marcaria como inativo
todo o histórico de aprovação apenas não revisitado na última passada do backfill.

**Como as duas se tocam, se um dia precisarem:** por `(filCod, docCod, titCod)`, em consulta
explícita, quando os recortes coincidirem. É um **join oportunista**, nunca uma chave estrangeira —
a interseção dos universos não é garantida em nenhuma direção. Decisão registrada em ADR-0038 D4.

> **Armadilha herdada:** `ontology/entities/titulo-a-pagar.md` (Frente II) ainda afirma que `aprovado`
> deriva do AND de `titVld1/2/3libera`. A sondagem provou que essas flags são **vestigiais** (valem
> `1` em 100% dos títulos, sem timestamps). O **código** da Frente II usa outra fonte (`vldLib` do
> `fin064`) e está correto — a **ontologia** é que descreve o campo errado. Corrigir em ciclo próprio
> da Frente II; ver `glossary.md` § Frente V.
