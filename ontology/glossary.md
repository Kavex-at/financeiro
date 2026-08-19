# Glossário do Domínio — Financeiro (Columbia Trading)

Vocabulário das cinco frentes da Automação Financeira. Capturado da proposta
([`docs/proposta/`](../docs/proposta/)) e refinado pelas entrevistas do `OfficeHoursInterviewer`.
Termos transversais da plataforma (tenant, filial/`filCod`, ERP Conexos) vivem em
[`../docs-contexto/03_ontologia.md`](../docs-contexto/03_ontologia.md).

## Frente I — Permutas

| Termo | Definição |
|-------|-----------|
| **Permuta** | Reconciliação entre um adiantamento (débito) e a fatura correspondente (crédito), refletida na baixa do ERP. |
| **Adiantamento / PROFORMA** | Valor pago antecipadamente ao exportador, antes da fatura definitiva. Lado "débito" da permuta. |
| **Invoice / Fatura** | Fatura definitiva do exportador. Lado "crédito" da permuta. |
| **Caso 1:1 (direto)** | Uma proforma casa exatamente com uma invoice em um processo — permuta automática, sem intervenção. |
| **Caso N:M (composto)** | Múltiplas proformas/invoices a alocar — exige aprovação e alocação de valores pelo analista. |
| **Alocação** | Link adto↔invoice com **valor parcial** em moeda negociada (entidade `Permuta`, tabela `permuta_alocacao`). Rascunho editável; sobrevive à re-ingestão. A baixa no ERP (`fin010`) é a Fase 3. |
| **Casamento manual** | N:M **no mesmo processo** que passou nos 4 gates: falta o analista alocar a(s) invoice(s) (ADR-0005). Tipos `multiplas` (1 adto→N inv) e `cross-over` (N adtos↔M inv). |
| **Permuta manual / cross-process** | Adto de **cliente-filtro** (pago + saldo, sem D.I no processo): a invoice vem de **outro processo**, escolhida manualmente (ADR-0007). Tipo `cross-process`. |
| **Cliente filtro** | Importador cadastrado cujos adiantamentos a pipeline roteia para `permuta-manual` em vez de `bloqueada` (entidade `ClienteFiltro`, ADR-0007). Lista mantida pelo analista (config do cliente). |
| **tipoPermuta** | Rótulo **derivado** (apresentação/abas), não persistido: `simples` / `multiplas` / `cross-over` / `cross-process` (ADR-0009). |
| **Backlog elegível** | Pendências com adiantamento pago + INVOICE disponível, prontas para permuta, com idade (aging). |
| **Pendência bloqueada** | Caso que depende de terceiros (ex.: INVOICE ainda não emitida) — reportado, não contado como falha. |

## Frente II — SISPAG (Pagamentos)

| Termo | Definição |
|-------|-----------|
| **SISPAG** | Sistema/fluxo de pagamentos em lote enviado ao banco. |
| **Título** | Documento financeiro a pagar (parcela/obrigação) no ERP. |
| **Aprovado para baixa** | Status do título habilitado a entrar no lote de pagamento (representação a confirmar na `com298`). |
| **Lote (candidato / finalizado)** | Conjunto de títulos a pagar no dia; montado pela solução, ajustado e **finalizado** pela analista. |
| **Gate de finalização** | Ação da analista que dispara o processamento do lote (palavra final sobre o que será pago). |
| **Remessa** | Arquivo de pagamento gerado e enviado ao banco. |
| **Retorno** | Resposta do banco sobre o processamento da remessa, usada para conciliar a baixa. |
| **Nexxera** | Gateway/diretório bancário onde a remessa é depositada e o retorno é lido. |
| **Baixa** | Quitação do título refletida no ERP após a conciliação do retorno. |
| **Janela de corte** | Horário-limite do banco para envio do lote (a confirmar no diagnóstico). |

## Frente III — Popula GED

| Termo | Definição |
|-------|-----------|
| **NC / ND** | Nota de Crédito / Nota de Débito. Nasce em planilha, sobe ao ERP como rascunho. **Não confundir com a NDe da Frente IV** — a Frente III não emite NC/ND, apenas anexa o documento justificativo que destrava a baixa. |
| **Rascunho** | Estado da NC/ND no ERP enquanto falta o documento justificativo — não pode ser baixada. |
| **GED** | Gestão Eletrônica de Documentos: repositório onde o documento justificativo é anexado para destravar a baixa. |
| **SharePoint** | Diretório de origem onde o PDF justificativo é gerado. |
| **Chave de correspondência** | Critério que liga o PDF à NC/ND — por nome de arquivo (nº da nota) ou por conteúdo (a confirmar). |
| **Fila de exceções** | PDFs sem correspondência automática, roteados para supervisão do analista. |

## Frente IV — Conciliação de Recebimentos (Nexxera ↔ Baixa ↔ NDe)

Contrapartida de **entrada** (contas a receber) da Frente II. Pipeline de 6 módulos: importar → casar →
ratear → aplicar regras → baixar/emitir NDe → observar. Ver [ADR-0022](decisions/0022-bootstrap-frente-iv-recebimentos-nde.md).

| Termo | Definição |
|-------|-----------|
| **NDe** | **Nota de Débito Eletrônica.** Artefato **terminal** de um `Recebimento` executado (1—1). **Emitida pelo Conexos ERP** — nós apenas disparamos a emissão dentro de `executarRecebimento`; o registro local existe só para idempotência e auditoria. **Não é a "ND" da Frente III** (documento comercial preso em rascunho): o único elo é a palavra "débito". |
| **TransacaoBancaria** | Movimento bancário único importado da Nexxera (crédito/débito/estorno/tarifa/juros). Onde o `correlationId` nasce; deduplicado por chave natural. |
| **DocumentoAReceber** | Read-model do recebível em aberto lido do Conexos — o alvo da baixa. Sem tabela própria. |
| **Recebimento** | **Agregado raiz** da conciliação: liga 1 `TransacaoBancaria` a N `DocumentoAReceber`. Ciclo `rascunho → aprovado → executado → estornado`. |
| **RateioRecebimento** | Parcela de alocação dentro de um `Recebimento` (espelha `permuta_alocacao` da Frente I). Toda parcela tem finalidade identificada. |
| **CreditoCliente** | Adiantamento **DE cliente** (inbound): o cliente paga antes de o recebível maturar. **Oposto direcional do `Adiantamento`/PROFORMA da Frente I** (que é adiantamento **A** um exportador). É saldo local consumível, **não é documento fiscal — não se "emite" um CreditoCliente**. |
| **RegraRecebimento** | Regra configurável, versionada e explicável (encomenda %, adiantamento de cliente, multa/juros). Semântica deferida à Fase 4. |
| **Classificação de match** | `única` \| `múltiplas` \| `parcial` \| `nenhuma`. Incerto **nunca** auto-baixa — vai para a fila manual. |
| **Fila manual** | Créditos com match incerto ou ausente, roteados para decisão do analista. |
| **Solicitação de Numerário (SN)** | Documento de **encomenda** gerado no Conexos via `com299/gerDocProcesso`. Hoje **dry-run**: o payload é montado e exibido, nenhuma escrita alcança o ERP. Não confundir com a NDe. |
| **Write-ahead ledger** | Tabela `recebimento_execucao`: grava a intenção **antes** de chamar o ERP, garantindo que retry nunca produza dupla baixa nem NDe duplicada (invariante I-Receb-2). |

## Frente V — Workflow de Aprovação (trilha dos títulos a pagar)

Painel **read-only** que responde *"este título precisou de aprovação? de quem? quanto tempo levou?
em que pé está?"*. Não aprova nada, não escreve nada no ERP, não emite documento nenhum. Ver
[ADR-0038](decisions/0038-bootstrap-frente-v-workflow-aprovacao.md).

> ### Leia isto antes de usar a palavra "aprovação"
>
> Quatro frentes já usam algum sentido de "aprovar", e **nenhum deles é o da Frente V**:
>
> | Onde | O que "aprovar" significa lá | Quem age |
> |------|------------------------------|----------|
> | **Frente I** (Permutas) | botão **Aprovar** do borderô = `finalizarBordero`, a finalização da baixa no `fin010`. É **escrita no ERP** (ADR-0030) | a analista, na nossa UI |
> | **Frente II** (SISPAG) | **"aprovado para baixa"** = flag de alçada (`vldLib` do `fin064`) que torna o título **elegível a entrar no lote**. É um **predicado de elegibilidade**, não um evento datado | ninguém — é estado lido |
> | **Frente IV** (Recebimentos) | `aprovarRecebimento` = **gate human-in-the-loop** que autoriza a execução de um `Recebimento` rascunho. Estado **local**, nosso | a analista, na nossa UI |
> | **Frente V** | o **trânsito histórico do título pelas alçadas do ERP**: quem liberou, quando recebeu, quando agiu, quanto demorou. **Observado**, nunca comandado | os aprovadores da Columbia, **dentro do Conexos** |
>
> Regra prática: se a palavra "aprovar" aparece num **botão nosso**, é Frente I ou IV. Se aparece
> como **coluna de elegibilidade de pagamento**, é Frente II. Se aparece como **fato datado com nome
> de pessoa**, é Frente V.
>
> E a Frente V **não tem nenhuma relação com NC/ND (Frente III) nem com a NDe (Frente IV)** — não
> anexa, não emite e não baixa documento algum. O único vocabulário compartilhado é a palavra
> "título".

| Termo | Definição |
|-------|-----------|
| **Bloqueio** | O mecanismo do ERP que **é** o workflow de aprovação: uma linha em `FinTituloBloq` prendendo o título até que alguém de uma alçada o libere. No Conexos não existe módulo "workflow" — existe bloqueio. Um título com bloqueio pendente não segue para pagamento. **Não confundir com** `titVldBloq`/`vldIsBloqueado` (flag de estado do título) nem com o "bloqueio" contábil de período fechado da Frente I (ADR-0030). |
| **Etapa** (`EtapaAprovacao`) | Nosso nome de domínio para **uma** linha de `FinTituloBloq` (P1: modela como o negócio fala). Carrega quem, quando recebeu, quando agiu e — derivado dos dois — quanto tempo levou. É a unidade que a frente existe para expor. |
| **Trilha** | O conjunto ordenado das etapas de **um** título. Zero etapas é resultado legítimo (`SEM_WORKFLOW`), não falha de ingestão: ~metade dos títulos da filial 2 não passa por aprovação nenhuma, e saber quais é parte do diagnóstico. **Não confundir com** "trilha de auditoria" (transversal), que é o log das **nossas** ações. |
| **Alçada** | O nível/grupo autorizado a liberar um título — na prática, o campo `aprovador` da etapa. ⚠️ **Rótulo, não identidade:** mistura setor (`COMPRAS`) e pessoa (`RICARDO DO PRADO`) no mesmo campo, então não serve como dimensão de análise (**PV-10**). A configuração real de alçadas vive em `fin102`/`fin106`, hoje inacessíveis (**PV-07**). |
| **Aprovador** | A pessoa que **agiu** na etapa — `usnDesNomeCmd` (ex.: `DANILO_LARA`). É a chave do analítico da Fase 2. ⚠️ Hoje a identidade é o **nome normalizado**, porque `usnCodCmd` não vem na projeção acessível (**PV-10**): se alguém trocar de nome de usuário, vira duas pessoas no agregado. **Não é** o campo `aprovador` da linha — esse é a alçada (ver acima); a colisão de nomes é do ERP, não nossa. |
| **Comando** | A ação registrada pelo aprovador sobre a etapa, com seu instante (`ftbTimCmd`) e seu autor (`usnDesNomeCmd`). "Comando" é o vocabulário do ERP (`fin103/aplicarComando`, `ftbEspObsCmd`); nós **lemos** comandos, **nunca aplicamos** — o endpoint de aplicar existe e libera pagamento, e por isso o port de leitura da frente não o expõe. |
| **Liberação / `LIBERAR`** | Um dos dois rótulos de comando observados em `fbaDesNome` (122× na amostra); o outro é `APROVAR` (34×). São **duas ações distintas configuradas no ERP**, não sinônimos. Ambas são tratadas como conclusão positiva da etapa — premissa **PV-02**, não validada: se `APROVAR` for etapa intermediária (aprova mas não libera para pagamento), o status agregado do título está otimista. O rótulo bruto é preservado e exibido na timeline. |
| **`wffUuid`** | UUID do workflow no schema `FinTituloBloq`, que correlacionaria as etapas de **uma mesma execução** do fluxo — a chave natural exata para distinguir "esta trilha" da "trilha regerada" por `regerarBloqueios`. ⚠️ **Não vem na projeção acessível hoje** (depende de **PV-07**). Está no glossário porque é citado no spike e no ADR: ao lê-lo em algum documento, saiba que é uma **capacidade futura**, não um campo que temos. |
| **Duração da etapa** | `agidoEm − recebidoEm`, em segundos **corridos** (não dias úteis). Fechada e imutável. Só existe em etapa resolvida — pendente é `null`, **nunca estimada**. Ver [regra](business-rules/duracao-etapa-aprovacao.md). |
| **Parada há** | `agora − recebidoEm` de uma etapa **pendente**. Métrica **diferente** da duração: é aberta e cresce a cada leitura. Campo distinto no contrato e rótulo distinto na UI — misturar as duas enviesaria o tempo médio para baixo. |
| **Lacuna** | Registro explícito do que **não** conseguimos afirmar sobre um título, e por quê (ex.: `SEM_DATA_FINALIZACAO`, `STATUS_ETAPA_DESCONHECIDO`). Um painel financeiro auditável não apresenta número inferido como se fosse registro do ERP; a ausência é informação e a UI a exibe. |
| **`INDETERMINADO`** | Estado de **primeira classe**, não erro nem fallback envergonhado: o ERP devolveu algo que ainda não sabemos ler. Precede "aprovado" na derivação — se uma etapa é ilegível, qualquer afirmação sobre o título pode estar errada. Ver [regra](business-rules/status-etapa-fail-safe.md). |
| **Snapshot / `observadoEm`** | O painel **não é ao vivo**: lê o nosso Postgres, que é um espelho observado do Conexos. `observadoEm` é a idade desse espelho e é **obrigatório na tela**. Sem ele, o analista não tem como saber se está olhando o ERP de agora ou o de ontem. |
| **`PV-nn`** | ID de uma **pendência de validação com o time** (`_inbox/frente-v-pendencias-validacao.md`, PV-01..PV-10). Cada uma tem uma premissa fail-safe adotada no código e o ID citado no ponto exato onde a premissa vive — fechar uma pendência começa por `grep -rn "PV-0n"`. |

### ⚠️ `titVld1Libera` / `titVld2Libera` / `titVld3Libera` — **vestigial, não é a trilha**

Uma "escada de três liberações" gravada no próprio título parece — pelo nome — ser o workflow de
aprovação. **Não é.** A sondagem em produção (2026-08-18) mostrou que essas flags valem **`1` em 100%
dos títulos**, sem timestamp e sem nome de pessoa associados.

Ler `titVld2Libera = 1` como *"o nível 2 aprovou"* é **falso**. Um painel construído sobre elas
diria que **tudo está aprovado, sempre** — e essa armadilha já custou uma rodada inteira de sondagem
antes de o mecanismo real (`FinTituloBloq`) aparecer.

Duas consequências que valem lembrar:

- **A Frente V não usa essas flags em lugar nenhum.** O status vem das etapas.
- **A Frente II não depende delas na prática:** o código do SISPAG usa `vldLib` do `fin064`
  (`ConexosSispagClient.ts`) e está correto. Mas `ontology/entities/titulo-a-pagar.md` **ainda
  descreve** `aprovado` como o AND de `titVld1/2/3libera` — a ontologia é que está errada ali, não o
  código. Corrigir em ciclo próprio da Frente II (follow-up registrado no ADR-0038).

> Cuidado extra com a **grafia**: o mesmo campo aparece como `titVld1Libera` no `fin026/list` e
> `titVld1libera` no `fin026/infoTitulo` — não são intercambiáveis, e trocá-los devolve 500.

## Transversais

| Termo | Definição |
|-------|-----------|
| **Human-in-the-loop** | Princípio: a solução faz o mecânico e audita; o analista decide o que exige julgamento. |
| **Trilha de auditoria** | Registro persistido de toda ação (quem, quando, o quê), de sistema e de usuário. |
| **Multi-filial** | As soluções operam sobre todas as filiais, não apenas uma. |
| **Diagnóstico / baseline** | Primeira semana de cada frente: confirma escopo e levanta métricas para apurar ROI. |
