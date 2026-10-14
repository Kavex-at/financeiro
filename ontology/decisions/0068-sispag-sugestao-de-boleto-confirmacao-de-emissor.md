---
adr_number: 0068
title: SISPAG — sugestão de boleto DDA para título sem associação e confirmação de emissor (passo 1 de 3)
date: 2026-10-14
status: accepted
type: addition
related_entities: [ConfirmacaoEmissorBoleto, DecisaoSugestaoBoleto, BoletoDda, TituloAPagar]
related_actions: [sugerirBoletoParaTitulo, confirmarSugestaoBoleto, rejeitarSugestaoBoleto, revogarConfirmacaoEmissor, copiarLinhaDigitavel]
related_business_rules: [sugestao-boleto-dda-sispag, boleto-exige-codigo-de-barras]
related_state_machines: []
related_integrations: []
continues: [0040, 0065, 0067]
evidence:
  - ontology/_inbox/sispag-sugestao-boleto-dda-interview.md (entrevista + decisões Q1–Q5, 2026-10-14)
  - ontology/_inbox/sispag-sugestao-boleto-dda-ontology-diff.md
  - "medição PRD 2026-10-13: ~836 de ~1090 títulos BOLETO sem DDA; ERP associa valor exato + dia exato, 0 divergências em ~250 associados"
  - "medição PRD 2026-10-14: bancos emissores dos candidatos únicos — 237=162, 341=82, 104=17, 329=14, 422=7, 033=3; 341+237 = 244/290 (84 %)"
---

# ADR 0068: sugestão de boleto DDA e confirmação de emissor

**Branch:** `feat/sispag-sugestao-boleto-dda`. `/feature-new`. `entity_changed = true`. **Ontologia à
frente do código:** tudo `planned`.

## Contexto

Após a ADR-0067 o pool `fin124` fica fresco, mas a Columbia ainda vê poucos boletos associados: ~836
de ~1090 títulos BOLETO estão "sem DDA". O ERP associa **só valor exato e dia exato** (medido: 0
divergências entre ~250 associados; a hipótese de I-DDA3 está confirmada). Sobra, portanto, o que o ERP
**não pode** associar: boleto com centavos ou dias de diferença, ou de uma conta emissora que ele não
conhece. O item DDA não traz beneficiário; o emissor só sai do código de barras. Hoje a analista
confere à mão no portal do banco, título a título.

## Decisão

1. **Passo 1 mostra e registra; não escreve no ERP.** A UI sugere, para o título "boleto sem DDA", o
   boleto livre do `fin124` com a evidência (diferença de valor e de dias com sinal, número do
   documento, emissor mascarado) e permite **confirmar** ou **rejeitar**. Nenhuma escrita no Conexos
   (I15b). Passo 2 (bind no lote, prova em HML) e passo 3 (automático só para par confirmado) terão
   ADR e entrevista **próprias**.
2. **A confirmação é evidência, não autoridade (I15a).** O dinheiro continua sendo movido apenas
   pela validação **ao vivo** do envio (ADR-0040). Confirmar não altera `temBoleto` nem tira o aviso
   do lote.
3. **Duas entidades** (Q1, confirmada pelo maintainer: par + registro por título):
   `ConfirmacaoEmissorBoleto` (par `pesCod` × `emissorChave`; vigente/revogada; índice único parcial;
   trilha só-inclusão, padrão ADR-0065) e `DecisaoSugestaoBoleto` (por título; confirmada/rejeitada;
   imutável; snapshot). A sugestão em si **não** é persistida (I-DDA1).
4. **Escopo exato e limites globais (Q2, confirmada).** A confirmação vale para (credor, emissor),
   nunca mais largo, e **nunca alarga** o limite de valor/dias: o delta é mostrado e gravado, não
   abençoado (I15d, I15g).
5. **Uma pessoa, `sispag:executar` (Q3, confirmada).** Nada move dinheiro no passo 1; a segunda
   pessoa é exigida só quando o par virar automático (passo 3). `sispag:ver` vê a sugestão com o
   emissor mascarado; só `sispag:executar` copia a linha digitável, confirma, rejeita e revoga [emendado em 2026-10-14: a cópia é `sispag:ver`, ver Emenda]
   (Q4, I15k). **Quem revoga um par: qualquer pessoa com `sispag:executar` (Q-A).** **Toda cópia de
   linha digitável é auditada** (quem, quando, qual boleto).
6. **Chave do emissor (Q5).** Layout real só para 341 e 237 (244 de 290 candidatos únicos, 84 %,
   medido em PRD 2026-10-14; 104=17, 329=14, 422=7, 033=3, demais ≤1). Demais bancos usam chave
   genérica (banco + 8 dígitos do campo livre), podem ser sugeridos e confirmados por humano e
   **nunca** são elegíveis a automático até o layout ser verificado (I15i).
7. **Regra em camadas** (I15c) substitui "valor exato ±3 dias": `CONHECIDO` / `FORTE` / `ATENCAO`.
   **Limites globais decididos (Q-B):** seguro = \|Δvalor\| ≤ R$ 0,05 no mesmo dia, **ou** valor igual
   com o boleto vencendo de 1 a 5 dias **depois** do título e não antes da data de débito; qualquer
   coisa maior (ex.: +1,6 %, +R$ 10) é `ATENCAO`, com a diferença com sinal destacada. Boleto vencendo
   antes da data de débito nunca é seguro (I15h); número do documento só apoia (I15f).
8. **`BoletoDda` I-DDA3** troca a hipótese pelo fato medido; nasce I-DDA4.

### Padrões escolhidos pelo orquestrador (default, revisável)

- **Q-C** — data de débito de título sem lote = o vencimento do título.
- **Q-D** — dois títulos disputando um boleto: o boleto é reservado ao título de **menor vencimento**;
  empate desfeito pelo **menor `docCod`**; o outro título é mostrado sem o boleto (substitui o
  "AMBIGUO sem confirmável" da proposta).
- **Q-E** — revogar o par cancela as decisões ainda não aplicadas no ERP (no passo 1 não existe
  nenhuma).
- **Q-F** — boleto vencido (antes da data de débito) é mostrado só para informação e **não** pode ser
  confirmado no passo 1.
- **Q-G** — parsing de agência/conta, tabelas e rota são do TaskScoper (fora da ontologia).
- **Q-H** — métricas ficam no log, não no modelo.
- **Q-I** — revisão de universalidade com o Francinei, não bloqueante (1 cliente).

## Não muda

- Nenhuma escrita no Conexos; nenhuma regra da remessa; `BoletoSemCodigoBarrasError` e a validação
  ao vivo (ADR-0040) intactas; vínculo continua sendo do ERP; sincronização do pool (ADR-0067).

## Consequências

- Mais boletos ficam **visivelmente** casados para o analista, sem risco de pagamento errado: o passo 1
  não move dinheiro. O aviso "sem boleto DDA" do lote permanece até o passo 2 existir (honesto).
- Os dados do par e das decisões alimentam o passo 2 (decisão por título → bind) e o passo 3 (par).
  A chave foi desenhada **como se** o passo 3 confiasse nela.
- Custo: 2 tabelas + trilha, uma rota nova de sugestão por título, parsing de agência/conta em
  `CodigoBarrasBoleto` (implementação).
- Risco: confirmação errada vira evidência errada exibida (sem dinheiro). Mitigado por revogação,
  trilha, escopo exato e pela validação ao vivo.
- **`BoletoDda` fica `implemented` com `open_gap`:** o código ainda usa a janela "valor exato ±3
  dias" (`JANELA_CANDIDATO_DIAS`), que diverge da regra em camadas até a implementação. A mudança
  (fim da janela que aceita dias **antes** do título) é comportamental e deve constar dos critérios
  de aceite da tasks.md.

## Rejeitado

- **Persistir a sugestão** (REJECT-DUPLICATE de I-DDA1): candidato muda com o pool e a carteira.
- **Confirmar só o par, sem registro por título** (Q1a): o passo 2 não teria o que ligar.
- **Confirmar o par somente após N instâncias** (Q1c): atrito sem ganho de segurança no passo 1.
- **Par que abençoa tolerância** (Q2b/c): alarga limite em silêncio; fica para a entrevista do passo 3.
- **Duas pessoas já no passo 1** (Q3b): atrito sem dinheiro em jogo; a analista deixaria de usar.
- **Linha digitável só para `admin`** (Q4c): o lote já a entrega a `ver`; mas a **cópia** é auditada.
- **Chave genérica elegível a automático** (Q5b): errada é pior do que ausente — o passo 3 a obedeceria.
- **Marcar o item do lote como resolvido** (Q8): enganaria o analista; a remessa segue barrada.
- **Reaproveitar `FavorecidoAutorizado`**: conceito, chave e quantidade de pessoas diferentes.
- **Máquina de estados própria** para a confirmação: 2 estados, 1 transição; documentada na entidade.
- **Bind no ERP e automático (passos 2 e 3)**: REJECT-PREMATURE, na watchlist.
- **Valores numéricos como `RegraNegocioCliente`**: REJECT-CONFIG; constantes globais de código
  (1 tenant), citadas na regra.

## Emenda 2026-10-14 — Q4 re-decidida (cópia da linha digitável)

A premissa de Q4 ("`GET /sispag/boletos-dda` é só `admin`") era **falsa**: desde a ADR-0053 essa rota
e as linhas digitáveis do lote são `sispag:ver`. Decisão do maintainer: **`sispag:ver` copia a linha
digitável pela rota nova, e toda cópia segue auditada (`LINHA_COPIADA`, fail-closed)**. Confirmar,
rejeitar e revogar permanecem `sispag:executar`. O emissor mascarado na listagem fica por higiene,
não como controle de acesso. Estado conhecido e aceito: `GET /boletos-dda` entrega `linhaDigitavel`
sem auditoria.

## Implementação (2026-10-14, v0.66.0)

Entrou como especificado, em três pacotes: migration 0084 (par, decisão e trilha só-inclusão), motor/regra/serviço com seis rotas (`/sispag/sugestoes-boleto`, `/sispag/confirmacoes-emissor`) e a tela (sugestão no diálogo do título, selo na coluna de pagamento, lista de emissores confirmados). O que mudou na prática: (1) a cópia da linha digitável é `sispag:ver` (ver Emenda); (2) título com dois candidatos seguros de mesma força fica sem sugestão; (3) a regra de candidato da aba "Boletos DDA" passou a ser a de camadas — a janela "valor exato ±3 dias" saiu. Nada é escrito no Conexos.

## Emenda 2026-10-14 (2) — a confirmação tem saída (I15l)

O Regis-Review da feature (FT-1, P1) mostrou que a decisão `CONFIRMADA` não tinha saída: nenhum
`UPDATE` fora dos testes, a revogação do par só mudava o par (a Q-E prometia cancelar as decisões, e
o código não cumpria), e em quatro situações (arquivo DDA cancelado, ERP vincula o boleto, título
pago/inativo, título sinalizado) a confirmação sumia da tela mas seguia ocupando título e boleto
pelos índices únicos. Decisão do maintainer, antes do PR:

- **Novo estado terminal `ANULADA`**, só a partir de `CONFIRMADA`. Os índices únicos parciais já
  valiam só para `CONFIRMADA`; anular libera título e boleto. Colunas `anulada_por`, `anulada_em`,
  `motivo_anulacao` (CHECK: todas em `ANULADA`, nenhuma fora dela), `versao` (lock otimista) e o
  evento `DECISAO_ANULADA`. Migration **0084 editada no lugar** (ainda não implantada).
- **Ação `anularDecisaoSugestaoBoleto`** (`sispag:executar`, motivo 10–500, idempotente, ator do
  token). **`revogarPar` faz cascata** na mesma transação (implementa a Q-E).
- **Órfã visível**: o motor devolve a `CONFIRMADA` cujo boleto saiu do pool, ou cujo título o ERP
  sinalizou, com `orfa` e `motivoOrfa`; não confirmável; a tela oferece "Anular confirmação".
- **FT-2 (P2) fechado junto**: confirmar trava o par (`FOR SHARE`) dentro da transação; a revogação
  espera e a cascata enxerga a decisão recém-gravada. Nunca `CONFIRMADA` sob par `REVOGADA`.

Rejeitado: expirar confirmação por tempo (esconde o erro humano e some com a trilha) e reaproveitar
`REJEITADA` como saída (muda de significado: esconde aquele boleto para aquele título).
