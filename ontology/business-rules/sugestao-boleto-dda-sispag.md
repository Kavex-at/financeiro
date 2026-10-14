---
name: sugestao-boleto-dda-sispag
type: business-rule
entity: ConfirmacaoEmissorBoleto
invariant: I15
ontology_version: "0.40.0"
implementation_status: planned
status: active
owners: [yuri]
related_files: []
last_review: 2026-10-14
has_canonical_test: false
---

# Business Rule: sugestão e confirmação de boleto DDA (I15)

> **Origem:** ADR-0068 (2026-10-14). Passo 1 de 3: **mostrar** ao analista o boleto livre do `fin124`
> que provavelmente é o do título "boleto sem DDA", e **registrar** a decisão dele por
> (credor, emissor). Passo 2 (bind do código de barras ao item do lote, exige prova em HML) e passo 3
> (automático só para pares confirmados) terão **ADR e entrevista próprias** — esta regra não os
> autoriza. **Status: planned** — ontologia à frente do código.

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
| **I15a** | **Confirmação é evidência, não autoridade.** Confirmar um par ou uma decisão não altera `temBoleto`, o lote, o título nem o Conexos. A **validação ao vivo na remessa** (`titVldReflexoDdaAssoc`, ADR-0040, `BoletoSemCodigoBarrasError`) segue sendo a **única** autoridade que move dinheiro. O pool local e qualquer confirmação nunca a substituem. |
| **I15b** | **Zero escrita no Conexos no passo 1:** nenhum `importar`, nenhum `validacao/codigoBarras`, nenhum `titVldReflexoDdaAssoc = 1`, nenhum `cancelar`. As únicas escritas são locais (confirmação, decisão, trilha). |
| **I15c** | **Sugestão calculada em camadas, não persistida** (mesma postura de I-DDA1). Para um título ativo, `forma = BOLETO`, `tem_boleto = false`, o candidato é um boleto **livre** (sem `docCod/titCod`). Tiers, do mais ao menos forte: **`CONHECIDO`** (par (`pesCod`, `emissorChave`) já `VIGENTE` **e** dentro dos limites globais); **`FORTE`** (dentro dos limites globais, candidato único nos dois sentidos); **`ATENCAO`** (fora dos limites — ex.: +1,6 % ou +R$ 10 —, mostrada com a **diferença com sinal destacada**, **nunca** como segura). **Limites globais (seguros), decididos pelo maintainer:** \|Δvalor\| ≤ R$ 0,05 **no mesmo dia**; **ou** valor igual e boleto vencendo de 1 a 5 dias **depois** do título e **não antes da data de débito** (I15h). Qualquer coisa maior é `ATENCAO`. São constantes de código globais (não por tenant), ajustáveis por ADR curta, sem mudança estrutural. |
| **I15d** | **A confirmação nunca alarga limite.** O delta (R$, %, dias, com sinal) é exibido e gravado na evidência; cada nova sugestão é reavaliada contra os limites **globais**. Um par confirmado com +R$ 0,01 não autoriza +R$ 10 nem +5 dias. Aprender tolerância por par é decisão do passo 3. |
| **I15e** | **Exclusões e disputa.** Não é candidato: (1) boleto vinculado pelo ERP a qualquer título (`docCod/titCod` preenchidos, I-DDA2); (2) boleto "usado" por título que o ERP já sinalizou (`tem_boleto = true` com mesmo valor e dia — o ERP o reservou); (3) título pago, inativo ou com `forma ≠ BOLETO`. **Disputa (Q-D, default, revisável):** quando dois títulos contestam o mesmo boleto, o boleto fica **reservado ao título de menor vencimento**; empate no vencimento desfaz-se pelo **menor `docCod`** (depois `filCod`, `titCod`, para ser determinístico). O outro título é mostrado **sem** o boleto. Um boleto, um título. |
| **I15f** | **Número do documento é sinal de apoio, nunca suficiente.** `doc_esp_numero` × `boleto_dda.numero` iguais (dígitos estritos) sobem a confiança, mas sozinhos têm ~50 % de precisão (propriedade do credor: 16 de 35 sempre casam, 18 nunca). Número igual com valor/data muito distantes é **colisão** e não é sugerido como seguro. |
| **I15g** | **Escopo = (`pesCod`, `emissorChave`).** Nunca global, nunca só por credor, nunca só por banco. MULTILOG BRASIL cc 0092740 confirmada **não** cobre MULTILOG S/A (cc 0006500) nem outra conta do mesmo credor. **Quem confirma é sempre uma pessoa** com `sispag:executar`; o sistema nunca confirma. A segunda pessoa só entra quando o par virar automático (passo 3, ADR própria). **Quem revoga** o par: qualquer pessoa com `sispag:executar`, com motivo (Q-A). Revogar cancela as decisões por título ainda não aplicadas no ERP (Q-E; no passo 1 não há nenhuma). |
| **I15h** | **Boleto que vence antes da data de débito nunca é seguro e não é confirmável no passo 1** (Q-F, default, revisável). Está vencido (juros/multa): é mostrado **só para informação**, com o motivo visível; nunca `CONHECIDO` nem `FORTE`, nunca confirmável, nunca elegível ao automático. Datas comparadas como data civil (UTC meia-noite, BRT). A data de débito é a do lote quando existe (I8, `data-debito-remessa-sispag`); **sem lote, é o vencimento do título** (Q-C, default, revisável). |
| **I15i** | **Chave genérica nunca é elegível a automático.** Só 341 e 237 têm layout verificado (`layoutEmissor`). Os demais bancos usam a chave genérica (`banco` + 8 dígitos do campo livre), podem ser sugeridos e **confirmados por humano**, mas a confirmação carrega `layoutEmissor = GENERICO` e fica **excluída** do passo 3 até o layout ser verificado. Desenhar a chave **como se** o passo 3 confiasse nela. |
| **I15j** | **Idempotência.** Sugerir é puro. Confirmar sobre par `VIGENTE` é no-op no par e, para título/boleto sem decisão ativa, apenas grava a decisão; confirmar o mesmo (título, boleto) de novo devolve a decisão existente. Revogar par não `VIGENTE` e rejeitar (título, boleto) já rejeitado são no-ops. Concorrência: índices únicos parciais; perdedor da corrida relê e devolve a linha vencedora. |
| **I15k** | **Dado sensível por permissão.** `sispag:ver` enxerga a sugestão (emissor mascarado na listagem, por higiene — **não** é controle de acesso, a linha já é visível a `ver` em `GET /boletos-dda` e no lote, ADR-0053) e **copia** a linha digitável pela rota auditada; **só** `sispag:executar` confirma/rejeita/revoga. Nunca a linha digitável completa em log, ledger, evidência ou mensagem de erro. **Toda cópia é auditada** (evento `LINHA_COPIADA`: quem, quando, título, boleto) — mais estrito que o lote atual (ADR-0053), de propósito: o controle é a trilha fail-closed. |

## Trilha só-inclusão

Eventos: `PAR_CONFIRMADO`, `DECISAO_CONFIRMADA`, `DECISAO_REJEITADA`, `PAR_REVOGADO`,
`LINHA_COPIADA`. Cada um com quem, quando, chaves envolvidas e (rejeição/revogação) o motivo.
Trigger recusa UPDATE/DELETE/TRUNCATE (padrão ADR-0065, I14j). Métricas (taxa de confirmação por
tier, concordância posterior com o ERP) ficam no log, fora do modelo (Q-H).

## Erros nomeados (sugestão)

| Erro | Onde | HTTP |
|---|---|---|
| `BoletoSuggestionNotAvailableError` | confirmar: boleto deixou de ser livre / título ganhou vínculo desde que a sugestão foi mostrada (anti-TOCTOU) | 409 |
| `BoletoAlreadySuggestedToOtherTitleError` | confirmar: boleto já `CONFIRMADA` para outro título, ou reservado a outro por I15e | 409 |
| `IssuerConfirmationReasonRequiredError` | rejeitar/revogar sem motivo | 422 |
| `OverdueBoletoNotConfirmableError` | confirmar boleto que vence antes da data de débito (I15h) | 422 |

## Ver também

`decisions/0068-*.md` · `entities/confirmacao-emissor-boleto.md` · `entities/decisao-sugestao-boleto.md` ·
`entities/boleto-dda.md` (I-DDA1–4) · `business-rules/boleto-exige-codigo-de-barras.md` ·
`business-rules/favorecido-autorizado-sispag.md` (I14, padrão da trilha e da máscara)
