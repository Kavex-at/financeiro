# Glossário do Domínio — Financeiro (Columbia Trading)

Vocabulário das quatro frentes da Automação Financeira. Capturado da proposta
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

## Transversais

| Termo | Definição |
|-------|-----------|
| **Human-in-the-loop** | Princípio: a solução faz o mecânico e audita; o analista decide o que exige julgamento. |
| **Trilha de auditoria** | Registro persistido de toda ação (quem, quando, o quê), de sistema e de usuário. |
| **Usuario** | A linha `app_user` — **não** o registro em `auth.users`. É a entidade que decide *o que pode* (`role`, `ativo`) e *como se chama* (`username`); o registro no GoTrue é apenas o **custodiante da credencial**. Existir no provedor de identidade **não é** existir na plataforma (ADR-0030). |
| **Ator (da trilha)** | Quem executou/criou uma ação, gravado em `executado_por` / `criado_por` / `created_by`. É **sempre o `username`** (o e-mail), **nunca** o `sub` do provedor de identidade — é o que mantém a trilha contínua através de qualquer troca de IdP (I-Usuario-1). |
| **Usuário-robô** | Credencial genérica do Conexos usada quando o usuário logado **não tem vínculo próprio** com o ERP. Não é erro: é **degradação silenciosa** — as baixas continuam saindo, atribuídas à máquina em vez da pessoa. Por isso `GET /me/conexos-status` é exibido logo após o login. |
| **Identidade × Autorização** | Duas camadas deliberadamente separadas. **Identidade** = *quem é* (JWT ES256 do GoTrue, `sub` = UUID). **Autorização** = *o que pode* (`role`/`ativo` lidos de `app_user` **a cada request**). A claim `role` do JWT é sempre `'authenticated'` e é **descartada** (ADR-0030, amenda a ADR-0011). |
| **Multi-filial** | As soluções operam sobre todas as filiais, não apenas uma. |
| **Diagnóstico / baseline** | Primeira semana de cada frente: confirma escopo e levanta métricas para apurar ROI. |
