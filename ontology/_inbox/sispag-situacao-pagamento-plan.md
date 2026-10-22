---
feature: sispag-situacao-pagamento
type: feature-tweak (plano, antes da entrevista formal e do diff de ontologia)
entity: TituloAPagar
entity_changed: true   # ganha um valor derivado (situacaoPagamento); regra I2 (elegibilidade) é ampliada
status: PR A + PR B entregues no PR #128 (mergeado 2026-10-22); PR C em andamento (worktree-sispag-situacao-lotes)
created: 2026-10-20
mockup: cópia local do maintainer `~/Downloads/SISPAG Rascunhos de Tela.html` ('Segunda rodada'; o link do artifact original não abre desta conta). O estado 'Confira' do mockup foi descartado depois dele.
---

# Situação de pagamento do título (SISPAG)

## 1. Problema

A tela de títulos nasceu para listar e pagar. Nem todo título está pronto, e hoje a analista descobre
isso tarde: bloqueado entra na seleção e falha **depois** de o lote nascer; permuta/adiantamento
aparece como título comum; boleto sem DDA só trava na remessa; favorecido não autorizado só aparece
dentro do lote. O badge "falta cadastro?" nunca disparou em produção (`ConexosSispagClient.ts`,
tri-estado `prontoParaRemessa`). Bloquear não basta: cada bloqueio precisa dizer **o que é, quem
resolve e qual o próximo passo**.

## 2. Decisões já tomadas (conversa de 20/10)

| # | Decisão |
|---|---------|
| D1 | Topo com 4 cards de ação: Prontos / Precisam de ação / Vencem em até 2 dias / Lotes esperando você. |
| D2 | Faixa vermelha sob os cards: **só bloqueados que vencem hoje** (vencidos fora). |
| D3 | Filtro externo `Todos | Prontos | Bloqueados`, com contagem e valor. Em Bloqueados, chips por motivo + dono. |
| D4 | Filtro e ordenação no cabeçalho de **toda** coluna. O filtro de Situação do cabeçalho e os chips editam a mesma seleção. |
| D5 | Vencimento mostra a **data** (dd/mm/aaaa) + badge relativo; filtro por faixa e por período. |
| D6 | Vencido é bloqueio **e** filtro (preset "Vencidos" na coluna Vencimento). |
| D7 | Permuta/adiantamento aparece como **bloqueado**. |
| D8 | Barra de seleção: um lote **por filial**, criado automaticamente. |
| D9 | Lotes automáticos usam **só títulos "Pronto"**. ("Pronto, confira" não existe nesta fatia, P1-1.) |
| D10 | TED/PIX contam como Pronto até existir verificação no carregamento da carteira. Voltar ao ponto depois. |
| D11 | Regras ficam atrás de um botão "?" na tela, não numa tela própria. |
| D12 | Nome: **situação de pagamento** (não "pagabilidade"). |
| D13 | Permuta/adiantamento é **bloqueio**, mesmo podendo já ter sido permutado em parte. O tipo é **indicação**, não prova: a linha avisa "pode já ter permuta parcial, confira o saldo em Permutas". (Resposta de 20/10.) |
| D14 | Forma no Conexos que não é pagável pelo SISPAG (cheque, cartão, caixa…) é **bloqueio**. Lista de códigos a confirmar (P1-2). |
| D15 | Um lote por filial: **endpoint novo** `POST /sispag/lotes/por-filial`, resultado por lote. |
| D16 | Boleto sem DDA e sem candidato fica **bloqueado, dono Você**: a analista verifica. Sai o dono "Aguardar DDA". |
| D17 | Backlog de filtros fechado: são as colunas que a tela já mostra (valor, vencimento, filial, credor, documento, forma, situação, ação). Nada além disso. |

## 3. Modelo

`situacaoPagamento` por título, calculada no backend e só desenhada pela tela:

```
estado:    PRONTO | BLOQUEADO      // CONFIRA fica de fora até existir caso real (ver §6, P1-1)
motivos:   Motivo[]            // todos os que se aplicam, em ordem de prioridade
principal: Motivo | undefined  // o mais urgente, mostrado na linha
dono:      VOCE | APROVADOR | CADASTRO | PERMUTAS | CONTAS_A_PAGAR
acao:      { codigo, rotulo }  // botão da linha ("Pedir autorização", "Abrir no Conexos"…)
detalhe?:  string              // ex.: "venceu há 4 dias", "parecido com doc 5498"
```

Constantes tipadas, nunca string crua (princípio P3).

| Motivo | Estado | Fonte (existe hoje?) | Dono | Disponível ao carregar? |
|---|---|---|---|---|
| `TIPO_PERMUTA` (permuta/adiantamento, indicação) | BLOQUEADO | **`tpd_cod` está vazio em 100% da carteira** (medido 20/10). O tipo só vem do `com298/list`. | Permutas | **Não, até resolver P0-1.** |
| `VENCIDO` (dia civil, ADR-0070) | BLOQUEADO | `vencimento` | Contas a pagar | Sim |
| `ALCADA` (não liberado) | BLOQUEADO | `liberado` | Aprovador | Sim |
| `DUPLICIDADE` | BLOQUEADO | `BloqueioDuplicidadeRepository.listAtivos` (hoje barra `incluirTitulo`) | Você | Sim |
| `RETIDO_CODBAR` | BLOQUEADO | `listarRetidosPorCodigoDeBarras` (I16g) | Você | Sim |
| `FORMA_NAO_SISPAG` (cheque, cartão, caixa…) | BLOQUEADO | `formaPagamentoConexos` (`titVldPagopor`) | Você | Sim. Forma ausente **não** bloqueia (título fora do grid). Códigos: P1-2. |
| `BOLETO_SEM_DDA` | BLOQUEADO | forma Conexos + `temBoleto` + desfecho do `BoletoSuggestionService` | Você (com ou sem candidato) | Sim, via desfecho em cache |
| `CONFIRMACAO_A_REVISAR` | BLOQUEADO | desfecho `ORFA` (ERP sinalizou o título depois da confirmação) | Você | Sim |
| `AJUSTE_CENTAVOS_PENDENTE` | BLOQUEADO | ledger do ajuste (ADR-0074): `indeterminado`, `aguardando_aprovacao_manual`, "tentar de novo" | Você | Sim |
| `SEM_DESTINO`, `FAVORECIDO_NAO_AUTORIZADO` | **fora desta fatia** | só no lote (cmn025 ao vivo, I13/I14) | Cadastro / Você | **Não** (D10) |

Ortogonal ao estado, sem virar motivo: `loteRascunho` e `loteComprometido` (já existem).

## 4. Onde mora

- **Backend:** `SituacaoPagamentoResolver` (`@injectable`, métodos arrow, puro, sem I/O) em
  `domain/service/sispag/`. Entrada: título + contexto já carregado (duplicidades ativas, retidos,
  desfechos de boleto, mapa de tipos). `SispagPainelService.montarPainel` preenche
  `titulo.situacaoPagamento` e devolve `resumo` (contagens e valores por estado, motivo e dono)
  calculado sobre a carteira **inteira**, não sobre o corte.
- **Aplicação da regra, não só exibição:** `LotePagamentoService.incluirTitulo` passa a consultar o
  mesmo resolver (substitui a checagem solta de `liberado`). `TituloNaoElegivelError` ganha os novos
  motivos. A formação automática (`FormacaoLotesService`) filtra por `PRONTO`. Assim tela, inclusão
  manual e cron não divergem.
- **Falha fecha para o lado seguro, mas visível:** se uma fonte do contexto falhar (ex.: desfechos de
  boleto), o título sai como `PRONTO` com `fontesIndisponiveis: ['boleto']`, a tela mostra um aviso
  de "situação incompleta" e a inclusão em lote continua barrada pelas guardas existentes. Nunca
  silenciar como o badge morto.
- **Tamanho:** `TITULOS_CAP = 5000` para ~1,5 mil títulos. Filtro e ordenação no cabeçalho rodam no
  cliente sem risco de truncar. Se `truncado`, o filtro da coluna avisa que vale só para o recorte.
- **Frontend:** o kit `useTabelaFiltro` (compartilhado com Permutas) não tem filtro por cabeçalho.
  Criar `ColumnHeaderFilter` (popover) sem alterar o contrato de Permutas. Os cards e a faixa saem de
  `painel.resumo`. Seguir os componentes do app (`Badge` outline, `Button`, `Table`), não o CSS do mockup.

## 5. Fatias e tarefas

Três PRs, nessa ordem. O backend sozinho já corrige a falha tardia.

**PR A: backend (contrato + regra aplicada)**
1. Ontologia: regra `situacao-pagamento-titulo`; ampliar `elegibilidade-titulo-lote` (I2); glossário;
   ADR-0075 (checar o próximo número livre no merge); `_index.json`/`_coverage.json`.
2. Ingestão grava o tipo do título (P0-1 a). `SituacaoPagamentoResolver` + testes tabela (um caso por motivo, prioridade, motivos múltiplos,
   fronteira de vencimento por dia civil, fonte indisponível).
3. Painel: `situacaoPagamento` por título + `resumo`; testes do serviço e do contrato HTTP.
4b. `POST /sispag/lotes/por-filial`: recebe os títulos, agrupa por filial, cria um lote por filial e
   devolve o resultado por lote (criado, parcial, recusado, com o motivo). Lote que falha não desfaz o outro.
4. `incluirTitulo` e `FormacaoLotesService` usando o resolver; testes de regressão (bloqueado não
   entra; auto-lote só com PRONTO; L6 desfazer-vencidos continua valendo).
5. Medição read-only em PRD: distribuição por estado/motivo da carteira real, antes de ligar a tela.

**PR B: frontend (títulos)**
6. Cards + faixa de hoje + filtro externo + chips de motivo/dono + botão "?".
7. Tabela com filtro e ordenação em todas as colunas, coluna de data, chips de filtros ativos.
8. Barra de seleção chamando `POST /sispag/lotes/por-filial` e botão de lotes automáticos com
   pré-visualização. (O endpoint e o contrato nascem no PR A, tarefa 4b.)
9. Backlog das analistas: coletar a lista antes de codar (P1-5). DesignSystemReviewer obrigatório.

**PR C: frontend (lotes)**
10. Resumo de prontidão no card do lote, lista de pendências com dono e botão, filtro/ordem da lista,
    "Finalizar os N lotes prontos". Depende de a verificação TED/PIX/autorização ser exposta por lote
    (já existe `fetchModalidadesDisponiveis`).

**Decisões do PR C (2026-10-22, ADR-0076, regra `prontidao-lote`):**

| # | Decisão |
|---|---------|
| D18 | Prontidão calculada no **backend sobre dados gravados** (`GET /lotes` → `prontidao` por lote RASCUNHO), sem Conexos. TED/PIX pelo último aviso gravado, rotulado "na última verificação"; a finalização relê ao vivo. |
| D19 | Item com situação de pagamento `BLOQUEADO` (ou não avaliada) **barra a finalização**, com motivo, dono e ação. Fail-closed, como a I19s. |
| D20 | "Finalizar os N lotes prontos": confirmação com a lista e o total, finaliza um por vez pelo endpoint existente, resultado por lote. Sem endpoint novo. |
| D21 | "O boleto vence antes do título" não vira pendência de lote (confirmar já exige reconhecer). |

Dois efeitos por pendência, **Barra a finalização** e **Sai do lote**; sem "Confira". Ordenação da lista:
pendências primeiro (barram, depois saem), vencimento, valor, filial.

Gates: typecheck, lint, testes, PatternGuardian, DesignSystemReviewer (PR B/C), Regis-Review reduzido
(delta + risco: testability, modifiability e fault-tolerance), rebase, bump de versão (feat) à mão
nos dois `package.json` (sem pwsh nesta máquina) e CHANGELOG.

## 6. Perguntas abertas

**P0 (bloqueia o motivo `TIPO_PERMUTA`; o resto do PR A segue)**
- **P0-1. De onde vem o tipo do título?** Medido em PRD (20/10, leitura somente leitura):
  1.277 títulos ativos e não pagos, **0 com `tpd_cod`**. O `fin064` não devolve tipo; o mapper só
  guarda a face. O tipo só existe no `com298/list` (junção por `filCod+docCod`), e ~1.570 títulos de
  NF comum nem estão lá. Sem fonte, o bloqueio de permuta não dispara. Opções:
  (a) a ingestão passa a juntar o `com298/list` e gravar `tpd_cod`/`tpd_des_nome`/`doc_vld_tipo_adto`
      (recomendado: custo uma leitura por filial na ingestão, dado persistido, resolver continua puro);
  (b) o painel faz a junção ao vivo (mais lento, mais sessões do robô, que têm teto);
  (c) adiar o motivo e entregar o PR A sem ele.
  Recomendo (a) como Task própria do PR A. O que o tipo **não** dispensa: `com298/{docCod}` tem
  `mnyTitPermuta` (quanto já foi permutado), mas só no detalhe; a linha continua dizendo "confira o saldo".

**P1 (decidir durante a fatia)**
- **P1-1. "Pronto, confira".** Os casos que o código tem hoje são todos bloqueios (confirmação
  órfã, ajuste de centavos pendente, boleto sem DDA). O aviso "boleto vence antes do título" só existe
  para candidato ainda não confirmado, e confirmar já exige reconhecê-lo. Não achei título **Pronto**
  que ainda peça conferência. Recomendo **tirar o estado CONFIRA desta fatia** (menos um conceito na
  tela) e reabrir quando aparecer um caso real. A decisão D9 (fora do auto-lote) vira vazia.
- **P1-2. Códigos de forma que bloqueiam.** Tabela atual: 1 cheque, 2 TEF, 3 carteira, 4 extra-caixa,
  5 cartão de crédito, 6 boleto, 7 caixa, 8 transação, 9 documento, 10 transação automática. O código
  de TED **não está confirmado**; não deduzir. Proposta inicial a validar com a analista:
  bloquear 1, 4, 5 e 7; não bloquear 2, 3, 8, 9, 10 até confirmar.
- P1-3. (decidido, D15.)
- P1-4. Pagamento parcial real com `vldPago=0` aparece com a face cheia (risco de pagar em dobro).
  Risco separado; fora desta fatia, mas o resolver deve ter lugar para um motivo futuro.
- P1-5. (fechado, D17.) P1-6. (fechado, D16.)

## 7. Fora de escopo

Verificação de TED/PIX no carregamento (D10), pagamento parcial (P1-4), mudar o fluxo de remessa,
retorno e conciliação, e o modo escuro (o app é claro).

## 8. Riscos

- Duas fontes de verdade se o resolver for copiado na tela: mitigado por ele ser a única origem.
- Desempenho do painel: o desfecho de boleto vem de cache (`SugestaoBoletoCache`); medir antes/depois.
- Versão, ADR e versão da ontologia colidem entre sessões paralelas. Em 20/10 a `main` está no app
  v0.71.0, ontologia 0.45.0 e último ADR 0074 (ajuste de centavos, já mergeado). Próximos: v0.72.0,
  ontologia 0.46.0, ADR-0075. Conferir `main` de novo antes de bumpar (o PR #57 de Aprovações segue aberto).
