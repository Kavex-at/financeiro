---
name: sugestao-boleto-dda-sispag
type: business-rule
entity: ConfirmacaoEmissorBoleto
invariant: I15
ontology_version: "0.44.0"
implementation_status: implemented
status: active
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/RegraSugestaoBoleto.ts"
  - "src/backend/domain/service/sispag/MotorSugestaoBoleto.ts"
  - "src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts"
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx"
last_review: 2026-10-19
has_canonical_test: true
---

# Business Rule: sugestão e confirmação de boleto DDA (I15)

> **Origem:** ADR-0068 (2026-10-14). Passo 1 de 3: **mostrar** ao analista o boleto livre do `fin124`
> que provavelmente é o do título "boleto sem DDA", e **registrar** a decisão dele por
> (credor, emissor). O passo 2 (vínculo do código de barras ao item do lote, **só valor igual**) é a
> regra `vinculo-codbar-item-sispag` (I17, ADR-0071, `planned`); o passo 3 (automático só para pares
> confirmados) terá **ADR e entrevista próprias** — esta regra não o autoriza. **Status: implemented (v0.66.0)** — ontologia à frente do código. **I15m–o e as emendas de I15c/I15e/I15h do ADR-0072 estão `planned` (v0.43.0)**; I15a–l seguem implementadas.

## Decisões do maintainer (2026-10-14)

Confirmadas pelo maintainer: Q1 (par + registro por título), Q2 (par confirmado nunca alarga limite),
Q3 (uma pessoa com `sispag:executar` no passo 1; segunda pessoa só quando o par virar automático, passo
3), Q4 (re-decidida em 2026-10-14: `sispag:ver` vê a sugestão e **copia** a linha digitável, toda cópia
auditada; `sispag:executar` confirma, rejeita e revoga), Q5 (layout real só para 341 e 237 — 244 de 290 candidatos únicos, 84 %, medido em PRD
2026-10-14; 104=17, 329=14, 422=7, 033=3, demais ≤1), Q-A (quem revoga: qualquer pessoa com
`sispag:executar`), Q-B (limites globais abaixo). Auditoria de cópias: **sim**, toda cópia de linha
digitável é auditada (quem, quando, qual boleto).

Escolhidas pelo orquestrador como **default, revisável**: Q-C (data de débito de título sem lote = o
vencimento do título), Q-D (disputa por boleto: ver I15e), Q-E (revogar o par cancela as decisões ainda
não aplicadas no ERP; no passo 1 não há nenhuma), Q-F (boleto vencido: só informativo, não confirmável
no passo 1), Q-H (métricas ficam no log), Q-I (revisão de universalidade com o Francinei, não
bloqueante). Q-G (implementação) é do TaskScoper.

## Regras

| # | Regra |
|---|---|
| **I15a** | **Confirmação é evidência, não autoridade (emendada pelo ADR-0071).** Confirmar um par ou uma decisão não altera `temBoleto`, o lote, o título nem o Conexos. No passo 1 a **validação ao vivo na remessa** (`titVldReflexoDdaAssoc`, ADR-0040, `BoletoSemCodigoBarrasError`) é a **única** autoridade que move dinheiro. **Com o passo 2 em modo `on` (I17k)** a decisão `CONFIRMADA` passa a ser **condição necessária** do vínculo do código ao item, nunca **suficiente**: o vínculo só ocorre depois das verificações nossas (I17b–d) e da releitura (I17e); a validação ao vivo segue sendo a autoridade **do caminho DDA**. O pool local e qualquer confirmação nunca substituem as verificações. |
| **I15b** | **Zero escrita no Conexos no passo 1:** nenhum `importar`, nenhum `validacao/codigoBarras`, nenhum `titVldReflexoDdaAssoc = 1`, nenhum `cancelar`. As únicas escritas são locais (confirmação, decisão, trilha). **Vale para o passo 1:** há **duas** exceções, cada uma na sua regra: o passo 2 (ADR-0071, I17) e o ajuste de centavos do título (ADR-0073, I18, `planned`), disparado **depois** do commit do `confirmar`, fora da transação dele. A UI do passo 1 nunca dispara I17; o `confirmar` em si continua só com escrita local. |
| **I15c** | **Sugestão calculada em camadas, não persistida** (mesma postura de I-DDA1). Para um título ativo, `forma = BOLETO`, `tem_boleto = false`, o candidato é um boleto **livre** (sem `docCod/titCod`). Tiers, do mais ao menos forte: **`CONHECIDO`** (par (`pesCod`, `emissorChave`) já `VIGENTE` **e** dentro dos limites globais); **`FORTE`** (dentro dos limites globais, candidato único nos dois sentidos); **`ATENCAO`** (fora dos limites — ex.: +1,6 % ou +R$ 10 —, mostrada com a **diferença com sinal destacada**, **nunca** como segura). **Limites globais (seguros), decididos pelo maintainer:** \|Δvalor\| ≤ R$ 0,05 **no mesmo dia**; **ou** valor igual e boleto vencendo de 1 a 5 dias **depois** do título e **não antes da data de débito** (I15h). Qualquer coisa maior é `ATENCAO`. **`ATENCAO` é exibida em duas formas (ADR-0072): com âncora (par vigente ou número igual; confirmável) e sem âncora (informativa, nunca confirmável; I15m).** São constantes de código globais (não por tenant), ajustáveis por ADR curta, sem mudança estrutural. **Nota (ADR-0073, `planned`):** par confirmado com 0 < \|Δ\| ≤ R$ 0,05 no mesmo dia, número igual e par `VIGENTE` é exibido com o derivado `ajuste` da decisão (`AGUARDANDO`, `SIMULADO`, `EM_ANDAMENTO`, `AJUSTADO`, `AGUARDANDO_APROVACAO_MANUAL`, `RECUSADO(motivo)`, `DESLIGADO`), nunca como "pronto para pagar" antes de `AJUSTADO`. O limite **não muda** e o ajuste não alarga tolerância (I15d). O título ajustado continua com Δ = +0,01 contra a base da carteira (`titMnyValor`); a UI mostra também o líquido. |
| **I15d** | **A confirmação nunca alarga limite.** O delta (R$, %, dias, com sinal) é exibido e gravado na evidência; cada nova sugestão é reavaliada contra os limites **globais**. Um par confirmado com +R$ 0,01 não autoriza +R$ 10 nem +5 dias. Aprender tolerância por par é decisão do passo 3. |
| **I15e** | **Exclusões e disputa.** Não é candidato: (1) boleto vinculado pelo ERP a qualquer título (`docCod/titCod` preenchidos, I-DDA2); (2) boleto "usado" por título que o ERP já sinalizou (`tem_boleto = true` com mesmo valor e dia — o ERP o reservou); (3) título pago, inativo ou com `forma ≠ BOLETO`. **Disputa (Q-D, default, revisável):** quando dois títulos contestam o mesmo boleto, o boleto fica **reservado ao título de menor vencimento**; empate no vencimento desfaz-se pelo **menor `docCod`** (depois `filCod`, `titCod`, para ser determinístico). O outro título é mostrado **sem** o boleto. Um boleto, um título. **Ambiguidade por título (emendada pelo ADR-0072):** quando um título tem **dois ou mais** candidatos seguros (CONHECIDO/FORTE) de mesma força, o título fica com a situação `AMBIGUA`: os candidatos são **listados e ranqueados** (limite de exibição), com o motivo "mais de um candidato"; **nenhum é confirmável**, e a analista resolve **rejeitando** os que não são (I15j, ação existente); o último restante volta a ser único. Nenhum `ATENCAO` é inventado para desempatar. **Disputa (Q-D):** o perdedor passa a mostrar o boleto como `DISPUTADA`, com a referência ao título que o reservou (I15n). |
| **I15f** | **Número do documento é sinal de apoio, nunca suficiente.** `doc_esp_numero` × `boleto_dda.numero` iguais (dígitos estritos) sobem a confiança, mas sozinhos têm ~50 % de precisão (propriedade do credor: 16 de 35 sempre casam, 18 nunca). Número igual com valor/data muito distantes é **colisão** e não é sugerido como seguro. |
| **I15g** | **Escopo = (`pesCod`, `emissorChave`).** Nunca global, nunca só por credor, nunca só por banco. MULTILOG BRASIL cc 0092740 confirmada **não** cobre MULTILOG S/A (cc 0006500) nem outra conta do mesmo credor. **Quem confirma é sempre uma pessoa** com `sispag:executar`; o sistema nunca confirma. **Transferir não é confirmar (ADR-0073, M1, I18j):** quando o título é renegociado pela I18, o sistema anula a decisão do título antigo (`tipoAnulacao = TITULO_RENEGOCIADO`) e grava a mesma decisão no título novo, **herdando** `decididoPor`/`decididoEm` da pessoa e registrando `origemDecisaoId` e `transferidaPor = 'sistema'`; mesmo boleto, mesmo par. É o único caso em que o sistema anula uma decisão. A segunda pessoa só entra quando o par virar automático (passo 3, ADR própria). **Quem revoga** o par: qualquer pessoa com `sispag:executar`, com motivo (Q-A). Revogar anula (I15l) as decisões `CONFIRMADA` do par, na mesma transação (Q-E). |
| **I15h** | **Boleto que vence antes da data de débito nunca é seguro e não é confirmável no passo 1** (Q-F, default, revisável). Está vencido (juros/multa): é mostrado **só para informação**, com o motivo visível; nunca `CONHECIDO` nem `FORTE`, nunca confirmável, nunca elegível ao automático. Datas comparadas como data civil (UTC meia-noite, BRT). A data de débito é a do lote quando existe (I8, `data-debito-remessa-sispag`); **sem lote, é o vencimento do título** (Q-C, default, revisável). **Emenda (ADR-0072):** boleto que vence antes do vencimento do título (Δdias < 0), ainda que no ou depois do débito, carrega o sinal `VENCE_ANTES_DO_TITULO` e o aviso de atraso (I15o); só é confirmável se já o era (âncora) e **com reconhecimento explícito validado no servidor**. Vencer antes da data de débito segue sendo `VENCIDO_INFORMATIVO`, **não confirmável, inalterado**. |
| **I15i** | **Chave genérica nunca é elegível a automático.** Só 341 e 237 têm layout verificado (`layoutEmissor`). Os demais bancos usam a chave genérica (`banco` + 8 dígitos do campo livre), podem ser sugeridos e **confirmados por humano**, mas a confirmação carrega `layoutEmissor = GENERICO` e fica **excluída** do passo 3 até o layout ser verificado. Desenhar a chave **como se** o passo 3 confiasse nela. |
| **I15j** | **Idempotência.** Sugerir é puro. Confirmar sobre par `VIGENTE` é no-op no par e, para título/boleto sem decisão ativa, apenas grava a decisão; confirmar o mesmo (título, boleto) de novo devolve a decisão existente. Revogar par não `VIGENTE` e rejeitar (título, boleto) já rejeitado são no-ops. Concorrência: índices únicos parciais; perdedor da corrida relê e devolve a linha vencedora. |
| **I15k** | **Dado sensível por permissão.** `sispag:ver` enxerga a sugestão (emissor mascarado na listagem, por higiene — **não** é controle de acesso, a linha já é visível a `ver` em `GET /boletos-dda` e no lote, ADR-0053) e **copia** a linha digitável pela rota auditada; **só** `sispag:executar` confirma/rejeita/revoga. Nunca a linha digitável completa em log, ledger, evidência ou mensagem de erro. **Toda cópia é auditada** (evento `LINHA_COPIADA`: quem, quando, título, boleto) — mais estrito que o lote atual (ADR-0053), de propósito: o controle é a trilha fail-closed. |
| **I15l** | **A confirmação por título tem saída, e confirmação órfã é visível.** (1) `CONFIRMADA → ANULADA` é terminal, por título, com motivo (10–500), quem e quando; libera título e boleto (os índices únicos valem só para `CONFIRMADA`); idempotente; `REJEITADA` não muda. (2) **Revogar o par ANULA, na mesma transação, toda decisão `CONFIRMADA` dele** (Q-E) — nunca existe `CONFIRMADA` sob par `REVOGADA`; confirmar trava o par (`FOR SHARE`) para a corrida confirmar × revogar não furar isto. (3) **Órfã**: `CONFIRMADA` cujo boleto saiu do pool/foi vinculado pelo ERP, ou cujo título o ERP sinalizou, volta na listagem com `orfa = true` e `motivoOrfa`, não confirmável, para ser anulada — nunca some em silêncio. Título pago/inativo não aparece e a decisão dele não reserva o boleto, mas é anulável pela rota. (4) Anular nunca altera o par nem o ERP (I15a/b). |
| **I15m** | **Todo título elegível tem um desfecho visível** (ADR-0072, `implemented` v0.69.0). `SituacaoSugestaoTitulo` ∈ {`UNICA_SEGURA`, `AMBIGUA`, `SO_ATENCAO`, `SO_FRACA`, `SO_VENCIDA`, `DISPUTADA`, `SEM_CANDIDATO`} (+ `CONFIRMADA`/`ORFA`, I15l), **derivado** do cenário e **não persistido** (I-DDA1). Título elegível = `forma = BOLETO`, ativo, não pago, `tem_boleto != true`, com vencimento. Candidato exibido **sem âncora** (`SO_FRACA`), **ambíguo**, disputado ou vencido tem `confirmavel = false` e o `confirmar` do servidor o **recusa** (409 `BoletoSuggestionNotAvailableError`, com o motivo da situação); **rejeitar** segue possível nos que têm boleto (exceto vencido, I15h). O envelope (I15c/I15d: R$ 10 ou 2 %, ±10 d) é **inalterado**: fora dele é `SEM_CANDIDATO`, nunca "o menos pior"; **nunca** se inventa boleto sintético nem candidato fora do envelope. Cada desfecho informa `totalCandidatos` e o motivo de não ser sugestão única; a lista exibida tem teto de exibição (constante de código, N = 3, não regra de domínio). `SEM_CANDIDATO` informa a hora da última sincronização do pool; com defasagem > 8 h (ADR-0067) é "sem candidato no pool de há N h", nunca afirmação absoluta. Confirmação (I15c/I15d) e passo 2 (I17) **não leem nenhum campo novo**. |
| **I15n** | **Candidato fraco não reserva boleto** (ADR-0072, `implemented` v0.69.0). Só `CONHECIDO/FORTE`, `ATENCAO` **com âncora** e `CONFIRMADA` reservam (Q-D, I15e). `SO_FRACA` e `VENCIDO_INFORMATIVO` não reservam; o mesmo boleto pode aparecer na lista de dois títulos, marcado `compartilhado`. O título que **perdeu** a disputa de um boleto seguro/ancorado mostra-o como `DISPUTADA` com `reservadoParaTitulo`. Um título nunca fica em `SEM_CANDIDATO` por ter perdido uma disputa. A confirmação, o índice único parcial e a guarda I16 continuam impedindo dois títulos com o mesmo boleto. |
| **I15o** | **Boleto vencendo antes do título é avisado, e o aviso exige reconhecimento no servidor** (ADR-0072, `implemented` v0.69.0). `Δdias = vencimentoBoleto − vencimentoTitulo` (data civil, UTC meia-noite) `< 0` ⇒ sinal `VENCE_ANTES_DO_TITULO` e `diasVencidoNoDebito = max(0, dataDebito − vencimentoBoleto)`. Dois casos: **A** (boleto < débito; sempre o caso de título sem lote, Q-C) é `VENCIDO_INFORMATIVO`, não confirmável (I15h), aviso crítico; **B** (boleto ≥ débito, lote com débito antecipado) é `ATENCAO`, confirmável só com âncora **e** com `reconheceAvisos` contendo `VENCE_ANTES_DO_TITULO`; sem o reconhecimento ⇒ **422** `WarningAcknowledgementRequiredError` (texto do aviso). O reconhecimento é conferido contra a avaliação **recalculada ao vivo** (nunca o cache) e gravado no snapshot (`sinais` += `RECONHECEU_VENCE_ANTES`; quem/quando já na trilha). O sinal **nunca** altera tier, limite (I15d) nem elegibilidade do passo 2 (I17c já exclui Δ < 0; `shadow` registra `INELEGIVEL`). Atraso por **dia civil** (ADR-0070), sem calendário bancário; o texto manda confirmar no portal do banco. O aviso é recalculado a cada cenário (mudança de lote/data de débito); o ack vale só para a confirmação a que foi gravado (anulada e refeita ⇒ novo ack). **Sem aviso** para título já associado a DDA pelo ERP (valor+dia exatos ⇒ Δ ≠ 0 não ocorre). |
| **I15p** | **Âncora DPS (ADR-0073, `implemented` v0.70.0).** O emissor de NFS-e numera o boleto como `<DPS>000` (DPS = Declaração de Prestação de Serviço, lida do PDF da NFS-e no GED; o Conexos não a guarda). (1) **DPS conhecido:** título com DPS lido (`TituloDps` `LIDO`) casa o boleto `<DPS>000` (sinal `DPS_IGUAL`). (2) **Ordem:** no escopo (`pesCod`, `emissorChave`) **provado** por ≥ 1 DPS lido que casou um boleto do pool (livre ou vinculado), um grupo conexo de candidatos com tantos títulos quanto boletos casa o k-ésimo título por NFS-e (`doc_esp_numero`) com o k-ésimo boleto por número (sinal `ORDEM_DPS`); contagens diferentes, título sem NFS-e, boleto fora de `N000`, boleto disputado por título de fora do grupo, par que cruza um DPS conhecido ou par fora do envelope = **sem âncora** (vai para a leitura do PDF). (3) Âncora DPS é âncora no sentido de I15c (ATENCAO ancorada é confirmável), desempata `AMBIGUA` e **reserva o boleto antes das demais camadas**, só quando é o candidato DPS único do título num boleto que nenhum outro título reivindica por DPS. Não sobe tier, não alarga limite (I15d), não altera I15h/I15o; quem confirma é a analista (I15g). Sem DPS lido, nada muda. |

## Trilha só-inclusão

Eventos: `PAR_CONFIRMADO`, `DECISAO_CONFIRMADA`, `DECISAO_REJEITADA`, `DECISAO_ANULADA`,
`PAR_REVOGADO`, `LINHA_COPIADA`; (ADR-0071) `VINCULO_SIMULADO`, `VINCULO_APLICADO`, `VINCULO_FALHOU`;
(ADR-0073, `planned`) `AJUSTE_SIMULADO`, `TITULO_RENEGOCIADO`, `DECISAO_TRANSFERIDA`, `AJUSTE_RECUSADO`,
`AJUSTE_CANCELADO`, `AJUSTE_FALHOU`. Cada um com quem, quando, chaves envolvidas e (rejeição/revogação) o motivo.
Trigger recusa UPDATE/DELETE/TRUNCATE (padrão ADR-0065, I14j). Métricas (taxa de confirmação por
tier, concordância posterior com o ERP) ficam no log, fora do modelo (Q-H).

## Erros nomeados (sugestão)

| Erro | Onde | HTTP |
|---|---|---|
| `BoletoSuggestionNotAvailableError` | confirmar: boleto deixou de ser livre / título ganhou vínculo desde que a sugestão foi mostrada (anti-TOCTOU) | 409 |
| `BoletoAlreadySuggestedToOtherTitleError` | confirmar: boleto já `CONFIRMADA` para outro título, ou reservado a outro por I15e | 409 |
| `IssuerConfirmationReasonRequiredError` | rejeitar/revogar sem motivo; anular com motivo < 10 caracteres | 422 |
| `OverdueBoletoNotConfirmableError` | confirmar boleto que vence antes da data de débito (I15h) | 422 |
| `DecisionNotConfirmedError` | anular título sem decisão `CONFIRMADA` (I15l) | 409 |
| `WarningAcknowledgementRequiredError` | confirmar candidato com `VENCE_ANTES_DO_TITULO` sem `reconheceAvisos` (I15o, ADR-0072, `implemented` v0.69.0) | 422 |
| `BoletoCodigoBarrasRepetidoError` | **remessa** (não é da sugestão; `planned`): dois itens BOLETO do lote com o mesmo código de barras de 44 dígitos, ou código presente porém inválido (I16a–c, ADR-0069). Pré-requisito do passo 2. Mensagem pt-BR com `docCod/titCod`, valor, vencimento e código mascarado | 409 |

## Ver também

`decisions/0068-*.md` · `entities/confirmacao-emissor-boleto.md` · `entities/decisao-sugestao-boleto.md` ·
`entities/boleto-dda.md` (I-DDA1–4) · `business-rules/boleto-exige-codigo-de-barras.md` ·
`business-rules/favorecido-autorizado-sispag.md` (I14, padrão da trilha e da máscara)
`decisions/0069-*.md` (guarda de repetição de código de barras, pré-requisito do passo 2)
`decisions/0071-*.md` · `business-rules/vinculo-codbar-item-sispag.md` (passo 2, I17)
`decisions/0072-*.md` (desfecho por título e aviso "vence antes do título", I15m–o)
`decisions/0073-*.md` · `entities/titulo-dps.md` (âncora DPS, I15p) ·
`decisions/0074-*.md` · `business-rules/ajuste-centavos-titulo-sispag.md` (ajuste de centavos no título, I18)
