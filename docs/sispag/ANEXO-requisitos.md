# Frente II — SISPAG: requisitos extraídos (para gap analysis)

Repo: `/home/inteli/Área de trabalho/projects/kavex/financeiro`. Caminhos abaixo são relativos a ele.
Siglas: P=proposta (`docs/proposta/Proposta_Kavex_Columbia_Financeiro.md`), SM=`ontology/state-machines/lote-pagamento.md`,
BR=`ontology/business-rules/`, INB=`ontology/_inbox/`, ADR=`ontology/decisions/`.
Status: **DECIDIDO** / **ABERTO** (pergunta ou não-provado) / **FORA** (fora de escopo) / **PARCIAL**.
Observação: este arquivo descreve o que os DOCS dizem. Não verifiquei o código (isso é o passo seguinte).

---------------------------------------------------------------------------------------------------

## 1. Escopo contratual (o que a proposta promete)

Fonte: P:69-108 (Escopo II), P:150-157 (NFR transversais), P:170/181-186 (diagnóstico), P:199-208 (roadmap), P:212+ (comercial).

- **Uma frase (P:71):** "garantir que nenhum pagamento aprovado deixe de ser executado por falha de processo, automatizando a
  montagem do lote, o envio ao banco e a conciliação do retorno no ERP."
- **Outcome (P:76-78):** "Lote diário montado, finalizado pela analista e conciliado no ERP sem retrabalho manual."
- **Divisão (P:82-86):**
  - Analista: revisa o lote candidato, adiciona/remove títulos e **finaliza**; "a finalização é o gatilho que dispara o processamento".
  - Solução: identifica diariamente os títulos a vencer e aprovados para baixa (**com298**), monta o lote candidato, gera a remessa,
    **sobe no diretório Nexxera**, monitora o retorno do banco, concilia a baixa no ERP e registra auditoria.
- **Features contratadas (P:88-94), 7 itens:** (1) painel diário (com298); (2) montagem assistida com inclusão/exclusão; (3) gate de
  finalização que dispara o processamento; (4) geração e **envio da remessa ao diretório Nexxera**; (5) monitoramento do retorno
  bancário; (6) conciliação automática da baixa no ERP; (7) auditoria de todas as ações (sistema e usuários).
- **Fora de escopo (P:96-97):** a aprovação para baixa em si (fica com o analista); decisões financeiras sobre o que pagar; homologação
  do leiaute bancário (dependência de terceiro). Espelhado em `docs-contexto/03_ontologia_financeiro.md:181`.
- **Premissa crítica (P:99-100):** a integração Nexxera/banco "parte do zero"; geração de remessa e leitura de retorno são entregues
  no período, mas a **homologação do leiaute junto ao banco depende do cronograma da instituição**; "os marcos de envio e conciliação
  ficam condicionados a essa homologação". Repetido em P:~203 (premissas consolidadas) e docs-contexto:~75.
- **Critério de aceite (P:102-103) — o que "entregue" significa:** lote diário montado a partir dos títulos aprovados, ajustado e
  finalizado pela analista; **remessa gerada e enviada ao diretório Nexxera após a finalização**; retorno bancário monitorado e **baixa
  conciliada no ERP sem toque manual**; **zero pagamentos perdidos por falha de processo na janela de observação**.
- **Fase 2 (P:105-106), fora do contrato base:** monitorar documentos a vencer ainda sem aprovação ("dormindo") com follow-up
  automático ao responsável.
- **Prazo (P:108):** 4 semanas. Roadmap sequencial Permutas → SISPAG → Popula GED, 1ª semana de cada frente = diagnóstico + baseline
  (P:~208). Investimento R$ 23.200/mês, mínimo 3 meses (P:~212-214). (Popula GED foi descontinuada, ver memória `popula-ged-descontinuada`;
  CLAUDE.md ainda lista 4 frentes.)
- **NFR transversais (P:152-157):** login institucional + RBAC; **multi-filial (todas as filiais)**; auditoria completa (quem/quando/o
  quê); Conexos resiliente (sessão, retry, rate limit); observabilidade com alertas de falha; padronização com a Tecnologia da Columbia.
- **Diagnóstico a confirmar (P:170):** como "aprovado para baixa" é representado na com298; horário de corte do banco para envio do lote.
  Baselines (P:181-186): volume/dia, janela de corte, **multa/juros nos últimos 12 meses (métrica central de ROI, nunca respondida)**,
  pagamentos não feitos no prazo, tempo de montagem manual.
- **Bancos / modalidades / filiais:** a proposta NÃO nomeia banco nem modalidade. Os docs fixam: banco Itaú (conta 0641/55795-4) como
  default, Santander exceção rara por fornecedor/boleto (INB/sispag-fin015-exploration.md:~212, resposta A3 da analista secundária,
  2026-07-16); filiais com carteira: 1, 2, 4, 6, 7 (INB/sispag-remessa-ground-truth-followups.md:73-80); "a automação deve funcionar em
  TODAS as filiais" (idem:65-66, Yuri 2026-09-01). Modalidades no código/ontologia: BOLETO, TED, PIX (e crédito em conta legado)
  (BR/destino-pagamento-sispag.md:41-43). Internacional (câmbio) fora do SISPAG (ADR-0021).

### Critérios de "entregue" que a Kavex adotou no repo (diferem da letra da proposta)
- Evento medido = "remessa gerada E aceita pelo banco", unidade = título, aceito = situação AGENDADO ou PAGO (ADR-0056 D1-D3).
- "Pago" = baixa visível no título `fin064` (vldPago=1 e aberto=0), qualquer origem (ADR-0055 D1/D2).
- Baixa **automática sem toque manual** (P:102) é, hoje, feita pelo Conexos nativo (`.RET` do dia D+1 cria borderô, usuário `CONEXOS`), não
  pela Kavex; a analista às vezes baixa à mão no dia D (memória `sispag-filial-7...`, atualização 2026-10-02).

---------------------------------------------------------------------------------------------------

## 2. Fluxo de uso ponta a ponta (como o ontology descreve hoje)

| # | Passo | Quem | Ação / rota / transição | Fonte |
|---|-------|------|--------------------------|-------|
| 1 | Ingestão da carteira | cron (`job:ingest-pagamentos`, GH Actions `ingest-sispag`) + manual `POST /sispag/ingestao` | lê `fin064` + alçada `com308`, UPSERT `titulo_a_pagar`, anti-fantasma, run auditada, advisory lock | actions/sispag/ingerir-pagamentos.md:34-60 |
| 2 | Painel diário | analista | `GET /sispag/painel`: janela -15d..+45d, aging, KPIs, `aprovado`/`pago`; lotes `fin015` e borderôs `fin010` como contexto | montar-painel-pagamentos.md:41-60 |
| 3 | Formação automática de lote candidato | cron `job:formar-lotes` + manual `POST /sispag/lotes/formar` | agrupa por **filial**, a vencer <=7d, nasce RASCUNHO `automatico=true`; desfaz auto-lote com título vencido (L6) | formar-lotes-automaticos.md:34-60; SM:95,100 |
| 4 | Montagem assistida | analista (admin) | criar/incluir/remover título (L1/L2), escolher modalidade por item, conta pagadora, destino TED/PIX | gerenciar-lote-candidato.md:37-60; SM:95-96 |
| 5 | Gate de finalização | analista | `finalizarLote` L3: >=1 item, revalida I2, modalidade definida, destino TED/PIX resolvível. Reversível por L4 | finalizar-lote.md; SM:97-98 |
| 6 | Gerar remessa | analista (pedido) | `gerarRemessa` L8: `fin015` `criarLote → importarTitulos → finalizarLote → gerarRemessa`; ledger write-ahead `remessa_execucao`; advisory lock; data de débito escolhível (I8); BOLETO exige DDA | SM:102; BR/retomada-remessa-sispag.md:28-75 |
| 7 | **Enviar ao banco** | **EXTERNO e MANUAL** (pasta de rede -> VAN Nexxera); o sistema NÃO observa. Não existe estado ENVIADO | `REMESSA_GERADA != ENVIADO`; marcado como `lacuna` na tela de arquitetura | SM:77-84, 129-130 |
| 8 | Retorno do banco | Columbia/Nexxera/Conexos: `.RET` carregado e processado nativamente (~08:30, usuário `CONEXOS`, `fin052`) | D (remessa) -> `.RET` com `BD` agendado; D+1 -> `.RET` com `00` efetuado cria e finaliza borderô | memória `sispag-filial-7...` (2026-10-02) |
| 9 | Sincronizar status / conciliar | cron `sincronizar-lotes-sispag` (:48) + botão "Sincronizar agora" (L11, read-only); `conciliarRetorno` L9/L10 admin (escreve `processar` no `fin052`) | lê `fin064` por docCod, eventos `fin052`, baixas `com308`; fecha lote: todos PAGO -> `BAIXADO`; algum REJEITADO -> `RETORNADO`; senão permanece `REMESSA_GERADA` | SM:103-105, 153-190; BR/sincronizacao-status-lote-sispag.md |
| 10 | Rejeição | analista | `RETORNADO` exige sanear cadastro e reenviar (sem transição nossa de reenvio descrita) | SM:70, 239-241 |
| 11 | Reaper | cron `reaper-sispag-reconciling` | publica execuções órfãs em `reconciling`; só sinaliza | memória `sispag-filial-7...`; SM:226-227 |
| 12 | Auditoria | transversal | ledgers `remessa_execucao`/`conciliacao_execucao`, `GET /sispag/execucoes`, trilha só-inclusão do destino manual | SM:211-227; BR/destino:I10g |

Estados do lote: RASCUNHO, FINALIZADO, REMESSA_GERADA, RETORNADO, BAIXADO, CANCELADO (SM:37). Fora de escopo: ENVIADO, PROCESSANDO (SM:38).
L7 `marcarRetorno` aposentada, rota responde 410 (SM:101).

---------------------------------------------------------------------------------------------------

## 3. Requisitos R-01..

### 3.1 Contratuais (proposta)
- **R-01** Painel diário dos títulos a vencer e aprovados para baixa (com298/fin064). P:88. DECIDIDO (ontology: ADR-0015, montar-painel-pagamentos.md).
- **R-02** Identificar diariamente os títulos a vencer e aprovados (cadência diária, cron). P:84. DECIDIDO (ingerir-pagamentos.md:34-50). Obs.: docs tratam "aprovado" como AND de `titVld1/2/3libera` (R-14).
- **R-03** Montar lote candidato automaticamente a partir dos aprovados. P:84. DECIDIDO (ADR-0018; formar-lotes-automaticos.md).
- **R-04** Montagem assistida: analista inclui/exclui títulos. P:89. DECIDIDO (gerenciar-lote-candidato.md:37-60).
- **R-05** Gate de finalização pela analista que dispara o processamento; analista tem a palavra final. P:90,83. DECIDIDO (finalizar-lote.md; SM:97). Nota: o doc de ação ainda diz "sem downstream nesta fatia" (finalizar-lote.md:23,53) mas SM:102 diz que o downstream (L8) existe: doc `finalizar-lote.md` desatualizado (`implementation_status: planned`).
- **R-06** Gerar a remessa (CNAB 240) após a finalização. P:91. DECIDIDO/implementado via `fin015` nativo do Conexos, não escrevemos CNAB (INB/sispag-remessa-ground-truth-followups.md:13-26; SM:102).
- **R-07** **Enviar a remessa ao diretório Nexxera.** P:91, P:102. **ABERTO / divergente da proposta**: ontologia decidiu que o transporte é externo e manual e o Conexos não transmite (SM:77-84; INB/sispag-native-vs-nexxera.md:83-116, 202-207). B1 (caminho da pasta/SharePoint do Nexxera, Ricardo/TI) segue sem resposta registrada (INB/sispag-perguntas-analista-2026-07-13.md:128-135). Depende da homologação do banco (P:99-100).
- **R-08** Monitorar o retorno bancário. P:92. PARCIAL: retorno processado nativamente pelo Conexos; nós lemos por sincronização read-only (ADR-0055). Não há poller do `.RET` nosso; `RetornoOrquestracaoService` era esqueleto (INB/sispag-perguntas-analista-2026-07-13.md:147).
- **R-09** Conciliar a baixa no ERP automaticamente, sem toque manual. P:93,102. PARCIAL/ABERTO: nossa `ConciliacaoRetornoService` só roda manual (admin, `POST /sispag/retornos/conciliar`), nenhum cron a chama; a baixa real hoje vem do `.RET` D+1 nativo do Conexos ou da analista à mão (memória `sispag-filial-7...` 2026-09-28/10-02; SM:103-105). O desenho decidiu que "pago" é fato do título, não do arquivo (ADR-0055).
- **R-10** Auditoria de todas as ações do sistema e usuários (quem aprovou/ajustou/finalizou). P:94, 154. PARCIAL: ledgers de execução + trilha do destino manual existem; trilha de auditoria das transições de lote e da situação dos itens é follow-up P1 não implementado (INB/sync-status-lote-sispag-regis-followups.md:19 `fault-tolerance-3`; INB/sispag-reter-titulo-lote-regis-followups.md:48 `audit-trail-lote`).
- **R-11** Multi-filial: operar em todas as filiais. P:153; Yuri 2026-09-01 (INB/sispag-remessa-ground-truth-followups.md:65-66, 159-163). DECIDIDO; ABERTO na prova: filiais 4, 6, 7 "nunca exercitadas" até 2026-09-01; fil 7 teve remessa rejeitada em 16/09 (memória).
- **R-12** Zero pagamentos perdidos por falha de processo na janela de observação. P:103,77. Meta; mensuração: baseline ROI ainda sem o dado central (multa/juros 12m) (docs/impacto/h2-sispag-achados.md §4). ABERTO.
- **R-13** NFR: login institucional + RBAC; Conexos resiliente; observabilidade com alertas. P:152,155,156. PARCIAL (auth em 3 passos, PRs #92/#93/#99; RBAC por módulo no banco ADR-0053). Gaps conhecidos: 9 rotas mutantes de `routes/sispag.ts` sem `assertUserCanActOnFilial` (INB/sispag-reter-titulo-lote-regis-followups.md:38,106); `app_user.role DEFAULT 'admin'` torna RBAC no-op em prod no momento do review (INB/sispag-data-pagamento-regis-followups.md:44); alerta ativo para remessa falha/indeterminada é P2 aberto (INB/sispag-ted-pix-regis-followups.md:99).

### 3.2 Regras de negócio / invariantes (ontologia)
- **R-14** (I2) Só entra no lote título aprovado (`titVld1/2/3libera` todos =1) E não pago; bloqueio com mensagem; revalidado na finalização. BR/elegibilidade-titulo-lote.md:20-47. DECIDIDO. Abertos: níveis de alçada que a Columbia usa de fato (Flávia) e tolerância de centavos para "pago" no SISPAG (:14-15).
- **R-15** (I3) Mesmo título não em dois lotes vivos; UNIQUE parcial no banco. BR/nao-duplicacao-titulo-lote.md:17-35. DECIDIDO (cobertura exata RASCUNHO+FINALIZADO é decisão de implementação). Bug conhecido: `listElegiveisParaFormacao` só exclui título em RASCUNHO, título em remessa enviada volta a lote automático (memória, 2026-10-02; caso 3143 em `0ebbc4bf`). ABERTO (bug não corrigido segundo a memória).
- **R-16** (I4) Um lote = uma filial (`filCod` do lote = `filCod` do título); virou requisito duro de conciliação (parser do `.RET` exige filial título = filial lote). BR/lote-uma-filial.md:19-31; SM:243-245; INB/sispag-fin052-retorno-provado-hml.md §4. DECIDIDO. Agrupar também por banco/conta: ABERTO (BR/lote-uma-filial.md:14).
- **R-17** (I5/I6) Toda transição grava ator+timestamp; optimistic lock por `versao`. SM:88-91. DECIDIDO.
- **R-18** (I7 retirada) Internacional fora do SISPAG; filtrar `ufEspSigla='EX'` na ingestão. ADR-0021; BR/lote-uniforme-nacional-internacional.md:17-27. FORA/DECIDIDO.
- **R-19** (I8) Data de débito escolhível: janela = [hoje BRT, min(`itsDtaPgto` dos itens)] ∩ dias úteis bancários; bloquear fora da janela, nunca corrigir em silêncio; imutável após `criarLote`; backend fonte única do calendário; default = hoje. BR/data-debito-remessa-sispag.md:32-56, 69-75, 110-130; ADR-0049. DECIDIDO; verificação ao vivo em HML "pendente" (:146). Reverte a resposta A5 ("sempre hoje"). Abertos: feriados municipais/estaduais, tratamento do Itaú para débito em dia não útil, 31/12, envio do arquivo no dia D ou antes (INB/sispag-data-pagamento-gap.md:7-41).
- **R-20** (I9?) Modalidade por item definida pela analista antes de finalizar (`ModalidadePendenteError`). SM:97; migration 0031. DECIDIDO.
- **R-21** BOLETO exige boleto DDA associado (`titVldReflexoDdaAssoc=1`), validado ao vivo no envio (não no rascunho); sem isso `BoletoSemCodigoBarrasError` (409) antes de qualquer escrita; boleto não exige conta do favorecido. BR/boleto-exige-codigo-de-barras.md:21-61; ADR-0040. DECIDIDO. A origem do código de barras é o ERP (fin124), o casamento por número é inviável (INB/sispag-remessa-ground-truth-followups.md:263-266). ABERTO: cobertura DDA (73% dos itens boleto reais com barras sem `vldVinculoDda`), hipótese de que o ERP só associa com vencimento idêntico (INB/sispag-boleto-dda-tab.md:20-38; INB/sispag-boleto-dda-regis-followups.md:79-87).
- **R-22** (I10a-k) TED/PIX: destino resolvível antes do `criarLote`; oferta = envio (mesma função); TED qualquer banco (`itsVldModalidade=5`); PIX só com chave; digitado vence cadastro e não é gravado no cmn025; congelado após import; trilha só-inclusão; conta/chave mascaradas e nunca em log; titularidade = CPF/CNPJ do favorecido; conta digitada nasce pendente de aprovação (`sispag:aprovar_destino`); preferir chave CPF/CNPJ. BR/destino-pagamento-sispag.md:45-82. DECIDIDO; **PARCIAL**: implementado atrás de 3 flags desligadas (`SISPAG_TED_ENABLED`, `SISPAG_DESTINO_MANUAL_ENABLED`, `SISPAG_PIX_ENABLED`) e **nada provado em produção** (H1, H3-H7, campo CPF/CNPJ do cmn025) (:100-110). Quatro-olhos retirado (ADR-0054 D3).
- **R-23** (I11) Status do lote segue a baixa do título; read-only no ERP; evidência hierárquica (fin064 > veto fin052 `tpret=2` > agenda BD/00 > enriquecimento com308); precedência por item REJEITADO > 00 > BD; estorno vira divergência + Alerta `sispag-baixa-divergente`; `BAIXADO` terminal; idempotente. BR/sincronizacao-status-lote-sispag.md:31-74; ADR-0055. DECIDIDO.
- **R-24** Retomada fail-closed: onde o ERP expõe estado, consultar (flpVldStatus, titulosCount, finItemSispag, processadoEm); onde não, `RemessaEmDuvidaError`/`ConciliacaoEmDuvidaError`; marca d'água + chave nativa composta `(fil,bnc,flp)`; `flpCod` não é monotônico. BR/retomada-remessa-sispag.md:37-75; ADR-0039. DECIDIDO, provado em HML (C1-C3 verdes, INB/sispag-retomada-gap.md:149-157).
- **R-25** Escritas do `fin015`/`fin052` não são idempotentes: ledger write-ahead + advisory lock por lote; gates `conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun`; `SISPAG_ENABLED` fail-safe (bloqueado em produção sem a var). SM:102,56-58; DEPLOY.md:108. DECIDIDO.
- **R-26** Remessa verificada antes de virar entregável (`RemessaCnabValidator`, `RemessaCorrompidaError`); fixtures redigidos de `.REM` real; `.REM` cru nunca commitado. INB/sispag-boleto-dda-regis-followups.md:43; INB/sispag-remessa-ground-truth-followups.md:179-204. DECIDIDO/implementado.
- **R-27** Cancelar só até FINALIZADO; reabrir só FINALIZADO->RASCUNHO; depois da remessa, desfazer é decisão humana no `fin015`. SM:98-99, 231-233. DECIDIDO.
- **R-28** Retirar título do lote pela aba de títulos (sem reter da formação automática). ADR-0050. DECIDIDO.
- **R-29** Lotes manuais nunca tocados pelo cron; auto-lote com título vencido é desfeito (L6, não é CANCELADO). SM:100, 191-207; ADR-0018. DECIDIDO. Política de janela "a vencer <=7d" pode ser estreita demais (A5 original) mas docs/impacto/h2-sispag-achados.md §3 mostra que a Columbia paga no vencimento (85% no prazo): ABERTO se a janela de 7d deve ser revista (formar-lotes-automaticos.md; fin015-exploration:~226).
- **R-30** Conta pagadora: default Itaú; exceção Santander por fornecedor (só boleto, rara). INB/sispag-fin015-exploration.md:~212. DECIDIDO (resposta da analista secundária); roteamento por fornecedor em implementação não verificado aqui.
- **R-31** Carteira vem do `fin064`+`com308`; título "sumiu" investigar primeiro `pagamento_ingestao_run` e `Bad Credentials`. Crons Conexos usam secrets próprios do GitHub (desatualizados desde ~20/09; run com 0 títulos aparece como `success`). Memória `crons-gh-actions-secrets-conexos-desatualizados` (2026-09-28/30). ABERTO (operacional).
- **R-32** Métricas do ciclo medem SISPAG: título de remessa gerada aceita pelo banco, semana da geração, exclui CANCELADO/error/dry-run. ADR-0056. DECIDIDO.
- **R-33** Download do `.REM` sem corromper acentos (latin1). INB/sispag-rem-download-latin1-*.md. DECIDIDO (PR #79).

### 3.3 Fora de escopo (decididos)
- **R-F1** Aprovação para baixa e decisão do que pagar (P:97; docs-contexto:181).
- **R-F2** Homologação do leiaute bancário (dependência de terceiro) (P:97, P:99-100).
- **R-F3** Pagamento internacional/câmbio (ADR-0021; resposta A4).
- **R-F4** Estados ENVIADO e PROCESSANDO (SM:38,77-84).
- **R-F5** Escrever o destino digitado no cadastro `cmn025` (ADR-0054 D1: "pode entrar depois").
- **R-F6** Feriados municipais/estaduais (REJECT-PREMATURE, INB/_watchlist.md:97-106).
- **R-F7** Retenção de título retirado contra a formação automática (retirada pelo usuário, ADR-0050; _watchlist:108-115).
- **R-F8** Fase 2 "documentos dormindo" com follow-up automático (P:105).

---------------------------------------------------------------------------------------------------

## 4. Perguntas abertas, trilha de produção e follow-ups conhecidos

### 4.1 Perguntas pendentes da Columbia (analista/TI)
1. **Transporte (passos 6-7):** como a remessa chega ao banco e o retorno volta? Caminho da pasta/SharePoint do Nexxera (B1, Ricardo). INB/sispag-perguntas-analista*.md; sem resposta registrada. Decide se R-07 será entregue pela Kavex ou declarado fora.
2. **Feriados municipais**, **tratamento do Itaú para débito em dia não útil** (rejeita / paga D+1 / paga D-1), **31/12**, **arquivo no dia do débito ou antes**. INB/sispag-data-pagamento-gap.md:7-41.
3. **Cobertura DDA:** o caminho DDA cobre 100% dos boletos ou sobra resíduo? Confirmar hipótese "vencimento idêntico". INB/sispag-boleto-dda-regis-followups.md:79-83; sispag-boleto-dda-tab.md.
4. **Lote misto (TED+boleto)** é rotina? (GT-3 não confirmado.) INB/sispag-remessa-ground-truth-followups.md:165-170.
5. **Níveis de alçada** usados de fato (1-3) e tolerância de centavos em "pago". BR/elegibilidade-titulo-lote.md:14-15.
6. **Agrupamento por banco+conta** além de filial. BR/lote-uma-filial.md:14.
7. **Multa/juros nos últimos 12 meses** (métrica central de ROI, P:184) e horário de corte do banco (P:170): sem resposta registrada (docs/impacto/h2-sispag-achados.md §4).
8. Remessa rejeitada (16/09, `PG160901.REM`): Columbia disse "diferença de data"; causa raiz não confirmada. Dois testes de 21-25/09 aceitos (PG230901.REM, fil 1/flp 8 e fil 2/flp 24, Itaú, débito 24/09), geração nossa.

### 4.2 Trilha dos testes em produção (memória `sispag-filial-7-primeira-remessa-nao-validada`)
- 16/09: `PG160901.REM` (fil 7, Itaú, R$ 2.599,88) rejeitada pelo banco; lote cancelado. Mesmo dia: 8 títulos da fil 7 falharam por boleto sem DDA.
- 22-23/09: PEDRONI 34697/1 (fil 2) e ADP 5046/1 (fil 1) pararam em boleto sem vínculo DDA -> motivou aba Boletos DDA (#85).
- 24/09: dois `.REM` aceitos. `.RET` traz só `BD` agendado; baixa foi manual (borderô 22320, ERICA_VIANA) -> motivou ADR-0055.
- 28/09-02/10 (CORRIGE 29/09): fluxo Itaú real = remessa D -> `.RET` D+1 `BD` -> débito -> `.RET` D+1 do débito com `00` (`fbeVldTpret=1`) -> Conexos (usuário `CONEXOS`) cria e finaliza borderô sozinho. Baixa manual da analista no dia D duplica se não for estornada.
- **Bugs nossos registrados e não corrigidos até 02/10:** (a) `.RET` multi-filial tem `filCod=null` no header -> `mapArquivo` vira 0 -> `fin050` HTTP 500 -> `codigosQueDecidem` descarta calado, `eventosNaoLidos=0`; (b) `listElegiveisParaFormacao` re-lota título de remessa enviada (R-15); (c) timestamps do Conexos são BRT gravado como UTC.
- Mudança de interpretação: "conciliação automática" que a Flavia descreveu é do lado Columbia/Conexos, não da Kavex; não reivindicar.

### 4.3 Itens implementados mas NÃO provados ao vivo
- TED/PIX/destino manual (flags desligadas; H1, H3-H7, campo CPF/CNPJ do cmn025, goldens `.REM` pendentes). BR/destino-pagamento-sispag.md:100-110; INB/sispag-ted-pix-regis-followups.md:44,76-79.
- Data de débito em D+1 útil finalizando no `fin015` em HML (pendente). BR/data-debito-remessa-sispag.md:146.
- Segmento J com código de barras e `itsVldModalidade` batendo com o banco emissor (341->6, outro->7): "acompanhar a primeira remessa real" (INB/sispag-boleto-dda-regis-followups.md:85-87).
- Retorno real: o `.RET` sintético validou só nosso caminho (INB/sispag-fin052-retorno-provado-hml.md:3-8).

### 4.4 Follow-ups registrados e não implementados (principais; fontes em `ontology/_inbox/*-regis-followups.md`)
- **P0 da retomada, bloqueavam 1ª remessa/conciliação real:** advisory lock em `gerarRemessa`, agendar reaper, protocolo QUESTION nas escritas, gate ao vivo da conciliação, fixtures da volta (INB/sispag-retomada-regis-followups.md:13-20). Tratados depois? O SM:102 cita advisory lock, DEPLOY cita reaper; confirmar no código.
- P1: auditoria da transição de lote e itens (`fault-tolerance-3`); staleness do sync sensível à janela útil (`availability-2`); `assertUserCanActOnFilial` nas rotas mutantes; reaper/reconciliação diária com `fin015` (`fault-tolerance-3` do ted-pix); `console.error(e)` pode vazar senha do Conexos nos jobs (`security-1`); tirar refresh do Conexos do caminho de escrita (`performance-1`); `TituloAPagar.valor` com `?? 0` vira R$ 0,00 (`bfc-1`); paginação fixa em `listarChavesDoLote`/`listarArquivosRemessa` (`bfc-3`); testes de integração Postgres do round-trip `data_debito`/SQL de destino.
- P1 arquitetural: `routes/sispag.ts` resolve client/repositório direto (bfc-5..7, modifiability-3); `RemessaService` monolítico (testes de 2.057 LOC); `LotePagamentoRepository` 633 LOC.
- Documentação desatualizada: `actions/sispag/finalizar-lote.md` (`planned`, "sem downstream"); BR de elegibilidade/lote-uma-filial/não-duplicação com `implementation_status: planned`; `ontology/_index.json` marca LotePagamento como planned (INB/sispag-data-pagamento-regis-followups.md:57). Falta arquivo de ação para `gerarRemessa`/`conciliarRetorno` em `ontology/actions/sispag/` (só 5 ações listadas).
- `ontology/integrations/nexxera.md` é histórico, supersedido pelo ADR-0023 (foi a Frente IV); não há integração `nexxera` viva para o SISPAG.
- Dívida de template: Express (não Lambda), sem `infra/`; O3 (escrita no ERP) já superado pelos writers (`ConexosSispagWriteClient`); O4 (sem scheduler) mitigado por GitHub Actions crons que throttlam (5-7x/dia, memória).

### 4.5 Contrastes proposta x ontologia (candidatos a gaps contratuais)
1. P:91/102 "envia ao diretório Nexxera" x ontologia "transporte externo e manual, sem estado ENVIADO" (R-07).
2. P:93/102 "baixa conciliada sem toque manual" x realidade: baixa vem do `.RET` D+1 nativo do Conexos ou manual; nossa conciliação é manual/admin (R-09).
3. P:84 "monitora o retorno" x sincronização lê título/`fin052`, sem poller de `.RET` nosso (R-08).
4. P:94 auditoria completa x trilha de transições de lote ainda follow-up (R-10).
5. P:153 todas as filiais x filiais 4, 6, 7 pouco/nada exercitadas; bug do `.RET` multi-filial (R-11).
6. P:152 RBAC x rotas mutantes sem checagem de filial; role default (R-13).
