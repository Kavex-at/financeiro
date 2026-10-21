---
adr_number: 0075
title: SISPAG — situação de pagamento do título (pronto ou bloqueado, com motivo, dono e próximo passo)
date: 2026-10-20
status: accepted
type: change
related_entities: [TituloAPagar, LotePagamento, BloqueioDuplicidade, DecisaoSugestaoBoleto]
related_business_rules: [situacao-pagamento-titulo, elegibilidade-titulo-lote, sugestao-boleto-dda-sispag, vinculo-codbar-item-sispag, ajuste-centavos-titulo-sispag]
continues: [0070, 0072, 0074]
amends: [0015]
evidence:
  - ontology/_inbox/sispag-situacao-pagamento-plan.md
  - "mockup interativo aprovado pelo maintainer (artifact v4, modo claro): https://claude.ai/artifact/9qrgoPvXrLAhF2nVt8FUy7"
  - "PRD 2026-10-20 (somente leitura, `psql` com `default_transaction_read_only=on` sobre `titulo_a_pagar`): 1.277 títulos ativos e não pagos, 1.262 aprovados, 0 com `tpd_cod`"
  - "PRD 2026-10-13 (somente leitura; registrada na memória do projeto `sispag-carteira-traz-tipos-permuta-e-adiantamento`, sem arquivo no repositório): 218 títulos `tpdCod 157` '(PERMUTA)' + 1 `156` liberados na carteira; adiantamentos `99` (1), `141` (3), `18` (1)"
  - "src/backend/domain/client/ConexosSispagClient.ts (comentários de `numOpt` e `prontoParaRemessa`): o selo 'falta cadastro?' nunca apareceu em produção"
---

# ADR 0075: situação de pagamento do título

**Branch:** `worktree-sispag-situacao-pagamento`. `/feature-tweak` (entrevista conduzida na conversa de
2026-10-20, decisões D1–D17 no plano acima). `entity_changed = true` (TituloAPagar ganha um valor derivado
e o nome do tipo persistido). **Ontologia à frente do código:** tudo `planned`.

## Contexto

A tela de títulos nasceu para listar e pagar. Nem todo título está pronto, e a analista descobria isso
**tarde**:

- um título **bloqueado** (alçada pendente) podia ser selecionado e só falhava depois de o lote nascer
  (`incluirTitulo` → `TituloNaoElegivelError`, título a título, com o lote já criado);
- título de **permuta** aparecia como título comum (218 deles na carteira de 2026-10-13);
- **boleto sem DDA** só travava na remessa (`BoletoSemCodigoBarrasError`);
- favorecido não autorizado e destino ausente só apareciam dentro do lote (I13/I14);
- o selo "falta cadastro?" (`prontoParaRemessa`) **nunca disparou em produção**: o campo é tri-estado e o
  `fin064` quase sempre responde "não sei".

Medido em PRD em 2026-10-20: o `fin064` não devolve o tipo do documento e a coluna `tpd_cod` está **vazia
em 100%** dos 1.277 títulos ativos e não pagos. O nome do tipo (que traz "(PERMUTA)") só existe no
`com298/list`. Bloquear não basta: cada bloqueio precisa dizer **o que é, quem resolve e qual o próximo
passo**.

## Decisão

1. **Nova regra `situacao-pagamento-titulo` (I19a–p, `planned`).** Todo título tem uma situação de
   pagamento **calculada no backend** por uma função única (`SituacaoPagamentoResolver`): `PRONTO` ou
   `BLOQUEADO`, com todos os `motivos` (ordem fixa de prioridade), o `principal`, o `dono` e a `acao`.
   Contrato em `src/backend/domain/interface/sispag/SituacaoPagamento.ts`, espelhado no frontend.
2. **Motivos desta fatia:** `ALCADA`, `TIPO_PERMUTA`, `VENCIDO`, `FORMA_NAO_SISPAG`, `DUPLICIDADE`,
   `RETIDO_CODBAR`, `AJUSTE_CENTAVOS_PENDENTE`, `CONFIRMACAO_A_REVISAR`, `BOLETO_SEM_DDA`.
3. **Permuta é bloqueio, por indicação (D13).** O nome do tipo contém "PERMUTA"; o título **pode já ter
   sido permutado em parte**, então a linha diz "confira o saldo em Permutas". Adiantamento **não** é
   bloqueado por esta fatia (adiantamento a fornecedor é pagamento): pergunta aberta.
4. **A ingestão passa a gravar o tipo (migration 0089).** Lê o `com298/list` por `docCod` (já há uma
   leitura `com298` por filial na ingestão, para excluir o exterior), grava `tpd_cod` e `tpd_des_nome`;
   falha de leitura preserva o valor anterior (COALESCE), nunca apaga. Tipo desconhecido nunca bloqueia.
5. **Forma no Conexos que não é pagável pelo SISPAG bloqueia (D14):** `titVldPagopor` ∈ {1 cheque,
   4 extra-caixa, 5 cartão de crédito, 7 caixa}. Os demais códigos e a forma ausente não bloqueiam; o
   código de TED não está confirmado e não se deduz.
6. **Boleto sem DDA e sem candidato fica bloqueado, dono `VOCE` (D16):** a analista verifica. Não existe
   dono "aguardar DDA".
7. **Sem estado "pronto, confira".** Os casos que o código tem hoje são todos bloqueios resolvidos por uma
   ação simples (confirmação órfã, ajuste de centavos pendente, boleto sem DDA). O aviso "boleto vence
   antes do título" só existe para candidato ainda não confirmado, e confirmar já exige reconhecê-lo
   (I15o). Reabrir quando aparecer um título **pronto** que ainda peça conferência.
8. **A mesma função aplica a regra, não só a exibe (I19m):** painel (`situacaoPagamento` por título e
   `resumoSituacao` sobre a carteira inteira), `incluirTitulo` (recusa `BLOQUEADO` com o motivo; alçada e
   `ja-pago` seguem checados ao vivo) e formação automática (só `PRONTO`).
9. **Um lote por filial, por endpoint novo (D15):** `POST /sispag/lotes/por-filial`, resultado por lote,
   um lote que falha não desfaz os outros (I19p).
10. **Falha de fonte nunca é silêncio (I19l):** a fonte indisponível sai em `fontesIndisponiveis`, a tela
    avisa e as guardas existentes continuam.
11. **Inclusão fail-closed (I19s, adendo de 2026-10-21 após o Regis-Review):** na escrita, título que a
    regra não avaliou por inteiro não entra no lote: fora da carteira persistida, leitura falhou ou fonte
    de contexto caída. A versão anterior deixava passar com só os guardas ao vivo (`nao-liberado`,
    `ja-pago`), o que reabria, para esses títulos, exatamente a porta que esta ADR fecha (permuta, forma
    fora do SISPAG). Custo aceito: título recém-criado no Conexos só entra depois da próxima ingestão, e
    uma fonte instável recusa a inclusão até voltar (a analista tenta de novo). A tela segue fail-open
    com aviso; a formação automática também, sem mudança.

### Decisões de tela (para o PR de frontend)

| # | Decisão |
|---|---------|
| D1 | Topo com 4 cards de ação: Prontos / Precisam de ação / Vencem em até 2 dias / Lotes esperando você. |
| D2 | Faixa vermelha sob os cards: **só bloqueados que vencem hoje** (vencidos ficam fora). |
| D3 | Filtro externo `Todos \| Prontos \| Bloqueados` com contagem e valor; em Bloqueados, chips por motivo e dono. |
| D4 | Filtro e ordenação no cabeçalho de **toda** coluna; o filtro de Situação do cabeçalho e os chips editam a mesma seleção. |
| D5 | Vencimento mostra a **data** (dd/mm/aaaa) com badge relativo; filtro por faixa e por período. |
| D6 | Vencido é bloqueio **e** filtro (preset "Vencidos" na coluna Vencimento). |
| D7 | Permuta aparece como **bloqueada**. |
| D8 | Barra de seleção: um lote **por filial**, criado automaticamente (o endpoint da decisão 9). |
| D11 | As regras ficam atrás de um botão "?" na tela, não numa tela própria. |

Outras decisões da conversa: D9 (lotes automáticos só com `PRONTO`), D10 (TED/PIX contam como pronto até
existir verificação no carregamento), D12 (nome "situação de pagamento"), D17 (backlog de filtros fechado:
são as colunas que a tela já mostra).

## Rejeitado

- **Estado `CONFIRA` ("pronto, confira").** Sem caso real hoje (decisão 7); mais um conceito na tela sem
  ação distinta. Reabrir com caso.
- **Calcular só na tela.** Duas fontes de verdade: tela, inclusão manual e cron divergiriam. A função
  única no backend é a que a inclusão e a formação automática também usam.
- **Bloquear só na inclusão (status quo ampliado).** Corrige a falha tardia, mas a analista continua sem
  ver o que está parado, por quê e com quem.
- **Juntar o `com298` ao vivo no painel.** Mais lento, mais sessões do robô (têm teto) e o tipo é dado
  estável do documento; persistir na ingestão mantém o resolver puro.
- **Persistir o estado em coluna.** Ficaria velho a cada decisão de boleto, alçada ou ajuste; é derivado
  (I19n).

## Consequências

- `TituloAPagar` ganha `tpdDesNome` (persistido) e `situacaoPagamento` (derivado). `SispagPainelResponse`
  ganha `resumoSituacao`. `TituloNaoElegivelError` passa a cobrir os motivos de situação.
- **Amenda I2** de `elegibilidade-titulo-lote`: elegível = `liberado ∧ ¬pago ∧ situação PRONTO`. L1 e L2 do
  `lote-pagamento` ganham notas; **nenhum estado novo**.
- Títulos de boleto sem DDA deixam de entrar em lote até a confirmação com vínculo ligado: é a mudança de
  comportamento mais visível. Efeito esperado, pedido pelo maintainer.
- O bloqueio de permuta **só dispara depois da primeira ingestão com o leitor de tipo** e só para títulos
  que o `com298/list` devolve; título sem tipo segue sem bloqueio. Validar ao vivo (medição read-only) antes
  de ligar a tela.
- Migration **0089** aditiva (`tpd_des_nome`; `tpd_cod` já existe e passa a ser preservada no UPSERT).
- Ontologia 0.46.0; app: minor (`feat`), versão a conferir na `main` antes do bump.

## Medição somente leitura em PRD (2026-10-20)

Script `src/backend/jobs/validate-situacao-pagamento-v1.ts` sobre a carteira persistida (1.294 títulos ativos e
não pagos), antes da primeira ingestão com o leitor de tipo:

| Estado / motivo principal | Títulos | Valor |
|---|---:|---:|
| PRONTO | 153 | R$ 1.624.025 |
| BLOQUEADO | 1.141 | R$ 7.018.944 |
| · `BOLETO_SEM_DDA` | 984 | R$ 5.052.360 |
| · `VENCIDO` | 129 | R$ 1.708.143 |
| · `ALCADA` | 16 | R$ 212.138 |
| · `FORMA_NAO_SISPAG` (todos caixa) | 12 | R$ 46.301 |

`TIPO_PERMUTA`, `DUPLICIDADE`, `RETIDO_CODBAR`, `AJUSTE_CENTAVOS_PENDENTE` e `CONFIRMACAO_A_REVISAR`: zero (o
tipo ainda não está gravado; as demais fontes estavam vazias). Soma dos motivos = bloqueados; nenhum título sem
situação. Das formas no Conexos, 1.081 títulos são BOLETO sem DDA associado e 129 com; dos 1.081, 375 vencem em até
7 dias, 278 em 8–15, 219 em 16–30, 115 em mais de 30 e 94 já venceram.

**Leitura:** o motivo `BOLETO_SEM_DDA` domina a carteira (76% dos títulos). É o que o fluxo já fazia na remessa
(`BoletoSemCodigoBarrasError`), agora visível na lista. O desfecho de sugestão desses títulos (ADR-0072) separa o
que tem um boleto sugerido para confirmar do que não tem, e é onde está o trabalho da analista. Decisão pendente do
maintainer: subdividir o motivo por desfecho nos chips, e se boleto com vencimento distante (mais de 15 dias) deve
ser tratado como bloqueio acionável.

## Perguntas abertas

1. **Adiantamento:** os tipos `99`, `141`, `18` (carteira de 2026-10-13) não bloqueiam nesta fatia; algum
   deles deve entrar em `TIPO_PERMUTA`?
2. **TED/PIX no carregamento:** verificar conta/chave e autorização do favorecido ao montar a carteira
   exige leitura em lote do cadastro ou valor guardado na ingestão (D10: voltar ao ponto depois).
3. **Pagamento parcial real com `vldPago = 0`** aparece com a face cheia; risco de pagar em dobro, fora
   desta fatia (o resolver deixa lugar para um motivo futuro).
4. **Códigos de forma:** confirmar o código de TED em `titVldPagopor` e se `2, 3, 8, 9, 10` seguem sem
   bloqueio.
5. **Backlog de filtros:** fechado em D17; reabrir só se a analista pedir coluna nova.
6. **Volume de `BOLETO_SEM_DDA`** (984 títulos, 76% da carteira). **Subdividir por desfecho: decidido
   (2026-10-21), sim**, ver I19r da regra: cinco grupos (para confirmar, a escolher, só candidato fraco, sem
   boleto no DDA, confirmado aguardando vínculo) como sub-chips e rótulo do botão. **Vencimento distante (mais de
   15 dias) como bloqueio acionável: em aberto**, o maintainer vai levantar os casos antes de decidir.
