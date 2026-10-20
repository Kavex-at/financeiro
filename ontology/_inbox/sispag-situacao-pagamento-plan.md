---
feature: sispag-situacao-pagamento
type: feature-tweak (plano, antes da entrevista formal e do diff de ontologia)
entity: TituloAPagar
entity_changed: true   # ganha um valor derivado (situacaoPagamento); regra I2 (elegibilidade) é ampliada
status: planejamento — nenhum código escrito
created: 2026-10-20
mockup: https://claude.ai/artifact/9qrgoPvXrLAhF2nVt8FUy7 (v4, modo claro)
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
| D9 | Lotes automáticos usam **só títulos "Pronto"**. Premissa a confirmar: "Pronto, confira" também fica de fora. |
| D10 | TED/PIX contam como Pronto até existir verificação no carregamento da carteira. Voltar ao ponto depois. |
| D11 | Regras ficam atrás de um botão "?" na tela, não numa tela própria. |
| D12 | Nome: **situação de pagamento** (não "pagabilidade"). |

## 3. Modelo

`situacaoPagamento` por título, calculada no backend e só desenhada pela tela:

```
estado:    PRONTO | CONFIRA | BLOQUEADO
motivos:   Motivo[]            // todos os que se aplicam, em ordem de prioridade
principal: Motivo | undefined  // o mais urgente, mostrado na linha
dono:      VOCE | APROVADOR | CADASTRO | PERMUTAS | CONTAS_A_PAGAR | AGUARDAR_DDA
acao:      { codigo, rotulo }  // botão da linha ("Pedir autorização", "Abrir no Conexos"…)
detalhe?:  string              // ex.: "venceu há 4 dias", "parecido com doc 5498"
```

Constantes tipadas, nunca string crua (princípio P3).

| Motivo | Estado | Fonte (existe hoje?) | Dono | Disponível ao carregar? |
|---|---|---|---|---|
| `TIPO_NAO_PAGAMENTO` (permuta/adiantamento) | BLOQUEADO | `tpd_cod` persistido; **nome do tipo só vem do `com298/list`** | Permutas | **Parcial. Ver P0-1.** |
| `VENCIDO` (dia civil, ADR-0070) | BLOQUEADO | `vencimento` | Contas a pagar | Sim |
| `ALCADA` (não liberado) | BLOQUEADO | `liberado` | Aprovador | Sim |
| `DUPLICIDADE` | BLOQUEADO | `BloqueioDuplicidadeRepository.listAtivos` (hoje barra `incluirTitulo`) | Você | Sim |
| `RETIDO_CODBAR` | BLOQUEADO | `listarRetidosPorCodigoDeBarras` (I16g) | Você | Sim |
| `BOLETO_SEM_DDA` | BLOQUEADO | forma Conexos + `temBoleto` + desfecho do `BoletoSuggestionService` | Você (há candidato) / Aguardar DDA (sem candidato) | Sim, via desfecho em cache |
| `BOLETO_CONFERIR` (vence antes do título/do débito) | CONFIRA | aviso do desfecho (ADR-0072) | Você | Sim |
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
2. `SituacaoPagamentoResolver` + testes tabela (um caso por motivo, prioridade, motivos múltiplos,
   fronteira de vencimento por dia civil, fonte indisponível).
3. Painel: `situacaoPagamento` por título + `resumo`; testes do serviço e do contrato HTTP.
4. `incluirTitulo` e `FormacaoLotesService` usando o resolver; testes de regressão (bloqueado não
   entra; auto-lote só com PRONTO; L6 desfazer-vencidos continua valendo).
5. Medição read-only em PRD: distribuição por estado/motivo da carteira real, antes de ligar a tela.

**PR B: frontend (títulos)**
6. Cards + faixa de hoje + filtro externo + chips de motivo/dono + botão "?".
7. Tabela com filtro e ordenação em todas as colunas, coluna de data, chips de filtros ativos.
8. Barra de seleção com "um lote por filial" (cliente orquestra; ver P1-3) e botão de lotes automáticos
   com pré-visualização.
9. Backlog das analistas: coletar a lista antes de codar (P1-5). DesignSystemReviewer obrigatório.

**PR C: frontend (lotes)**
10. Resumo de prontidão no card do lote, lista de pendências com dono e botão, filtro/ordem da lista,
    "Finalizar os N lotes prontos". Depende de a verificação TED/PIX/autorização ser exposta por lote
    (já existe `fetchModalidadesDisponiveis`).

Gates: typecheck, lint, testes, PatternGuardian, DesignSystemReviewer (PR B/C), Regis-Review reduzido
(delta + risco: testability, modifiability e fault-tolerance), rebase, bump de versão (feat) à mão
nos dois `package.json` (sem pwsh nesta máquina) e CHANGELOG.

## 6. Perguntas abertas

**P0 (bloqueiam código)**
- **P0-1. O que "(PERMUTA)" significa na prática, e o dado existe?** O `fin064` não traz `tpdCod`
  nem `docVldTipoAdto`; o nome vem do `com298/list`, e ~1.570 títulos de NF comum não existem lá. Se
  `tpd_cod` não estiver populado na carteira persistida, `TIPO_NAO_PAGAMENTO` só pega parte. Além
  disso, não foi confirmado com a Flavia se um título "(PERMUTA)" já está quitado pela permuta ou
  aguarda a permuta (memória `sispag-carteira-traz-tipos-permuta-e-adiantamento`). Medir a cobertura
  de `tpd_cod` na carteira e perguntar à Flavia antes de bloquear 218 títulos.

**P1 (decidir durante a fatia)**
- P1-1. "Pronto, confira" fica fora do auto-lote? (D9, premissa.)
- P1-2. Forma Conexos cheque/cartão/caixa/carteira: bloquear ou só avisar?
- P1-3. Um lote por filial: endpoint novo (`POST /sispag/lotes/por-filial`, resultado por lote) ou
  orquestração no cliente como hoje (`useCriarLoteManual`, título a título)? Recomendo o endpoint:
  atomicidade por lote e um único erro legível.
- P1-4. Pagamento parcial real com `vldPago=0` aparece com a face cheia (risco de pagar em dobro).
  Risco separado; não entra nesta fatia, mas o resolver deve ter lugar para um motivo futuro.
- P1-5. Lista de filtros que as analistas pediram (backlog). Falta receber.
- P1-6. Dono de `BOLETO_SEM_DDA` sem candidato: "Aguardar DDA" (ninguém age) ou escalar a quem?

## 7. Fora de escopo

Verificação de TED/PIX no carregamento (D10), pagamento parcial (P1-4), mudar o fluxo de remessa,
retorno e conciliação, e o modo escuro (o app é claro).

## 8. Riscos

- Duas fontes de verdade se o resolver for copiado na tela: mitigado por ele ser a única origem.
- Desempenho do painel: o desfecho de boleto vem de cache (`SugestaoBoletoCache`); medir antes/depois.
- Versão, ADR e versão da ontologia colidem entre sessões paralelas. Em 20/10 a `main` está no app
  v0.71.0, ontologia 0.45.0 e último ADR 0074 (ajuste de centavos, já mergeado). Próximos: v0.72.0,
  ontologia 0.46.0, ADR-0075. Conferir `main` de novo antes de bumpar (o PR #57 de Aprovações segue aberto).
