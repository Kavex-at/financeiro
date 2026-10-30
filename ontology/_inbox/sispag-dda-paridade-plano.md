# Plano de implementação — `sispag-dda-paridade` (entrada para o TaskScoper)

> Vale com os **defaults** da entrevista (`sispag-dda-paridade-interview.md`). Resposta diferente
> do Yuri reescreve a fatia correspondente. Nenhum código foi escrito nesta etapa.
> Restrição: os PRs draft #138/#139 mexem em `app/sispag/page.tsx` e
> `BoletosDoTituloDialog.tsx`. Aqui, `page.tsx` recebe **uma** prop nova no `<BoletosDdaTab>`
> (≈ 3 linhas, no bloco `TabsContent value="boletos-dda"`); `BoletosDoTituloDialog.tsx` não é tocado.
> `fetchBoletosDda` é usado também pela gaveta (`fetchBoletosDoTitulo`): o contrato antigo de
> query continua aceito (campos novos são opcionais).

## 1. Mapa de reuso

| Peça de Títulos | Destino na aba DDA | Como |
|---|---|---|
| `CardsSituacao` | `CardsBoletosDda` (reescrito) | **reusar o padrão**, não o componente (os cards são de outro domínio). Extrair as classes `BOTAO_PERIGO/ALERTA/INFO` (+ `BOTAO_PRIMARIO`) para `situacao/botoesDeCard.ts` e importar dos dois lados. |
| `FiltroSituacaoBarra` | `FiltroSituacaoDdaBarra` (novo, fino) | **generalizar**: extrair `SegmentosComTotal` (segmentos qtd + R$ + ponto) e `ChipFiltro` (`CHIP`/`chipMarcado`) para `components/ui/` ou `situacao/segmentos.tsx`; `FiltroSituacaoBarra` passa a usá-los sem mudar o DOM (o `TitulosAbaSituacao.test.tsx` é a rede). |
| `FaixaBloqueadosHoje` | `FaixaBoletosHoje` (novo) | **novo**, mesma anatomia (máx. 4, "Ver só estes"), tom `warning`. A faixa de Títulos tem ações de título (retenção, perdido) que não se aplicam. |
| `TabelaTitulos` cabeçalho | `TabelaBoletosDda` (novo, extraído do `BoletosDdaTab`) | **reusar** `ColumnHeaderFilter`, `FiltroTexto`, `FiltroMultipla`, `FiltroFaixaNumerica`, `FiltroPeriodo` (`components/ui/column-header-filter`) tal como estão. |
| Pílulas + "Mostrando X de Y" + "Limpar filtros" | idem | **generalizar**: extrair `PilulasFiltroAtivo` (`{id,texto,remover}[]`) de `TabelaTitulos.tsx:113-126`; `descreverFiltrosDda` (novo, puro) gera as etiquetas. |
| Paginação inline de `TabelaTitulos` (l.~449-475) | `PaginacaoTabela` (extraído) | **generalizar**: molécula `{pagina, totalPaginas, pageSize, total, onPagina}`; os dois lados usam. Sai o `Paginacao`/`FiltroBarra` legado de `permutas/components/tabela-filtro` desta aba (Permutas continua usando). |
| `FAIXAS_VENCIMENTO`/`ROTULO_FAIXA`/`FAIXAS_URGENTES` | importados | **reusar** (constantes). A classificação em faixa do boleto é feita no servidor. |
| `RegrasSituacao` | `RegrasBoletoDda` (novo, texto) | novo, curto: `regraCandidato` + o que é cada situação (reusa `SITUACAO_BADGE.title`). |
| `TableSkeleton`, `Skeleton` (`components/ui/skeleton`), `SimpleKPI loading` | primeira carga | **reusar**. Sai o `Spinner`. |
| `useTabelaTitulos` | `useTabelaBoletosDda` (novo) | **novo** (o de Títulos filtra no cliente; este monta a query do servidor). Estado num store de módulo (`useSyncExternalStore`) para sobreviver à troca de aba (Q7); debounce dos textos; `AbortController`. |

## 2. Backend

1. **`PaginacaoBoletoDda.paginar` (puro)** — filtro estendido, contrato antigo preservado:
   - entrada nova (todas opcionais): `situacoes[]` (além de `situacao`), `filiais[]` com o valor
     especial `'sem'` (além de `filCod`), `bancos[]`, `faixas[]` (`VENCIDO|HOJE|1-2|3-7|8+`, com `hoje`
     injetado), `valorMin`/`valorMax`, `numero`, `titulo` (credor ou `doc/tit`), `ordem`
     (`coluna:asc|desc`, colunas `situacao|numero|valor|vencimento|banco|titulo|filial`; default
     `vencimento:asc`, desempate `ddcCod,ditCod` para paginação estável).
   - `filialDe`: vínculo → filial comum a todos os candidatos → `undefined`. **I-DDA5**: com filtro
     de filial, `undefined` só passa se `'sem'` foi pedido.
   - saída: `contagem` vira `Record<chave, {qtd, valor}>` para `todas`, 4 situações, `emGrupo`,
     `urgentes.hoje`, `urgentes.ate2Dias` (urgentes excluem `VINCULADO`). Para não quebrar a gaveta e
     o FE antigo durante o deploy, manter `contagem` numérico e acrescentar `totais` (com R$) —
     decidir no TaskScoper; default: **campo novo `totais`**, `contagem` intacto.
   - `facetas`: `filiais [{valor, qtd}]` + `semFilial`, `bancos [{valor, qtd}]`, `situacoes`,
     calculadas na base "sem o filtro da própria coluna" (padrão de faceta), ou, mais simples, na
     base de `contagem` — default: base de `contagem`, documentado.
   - `faixaDe(vencimento, hoje)` como helper puro exportado (testável).
2. **`BoletoDdaService.listar`** — passa `hoje = calendar.todayBrt()` à paginação; memo da
   consolidação (Q9) numa classe `@singleton() @injectable()` `ConsolidacaoBoletoDdaCache` (TTL 30 s,
   relógio injetável, chave `escopo|hoje|sincronizadoEm|ultimaRunCarteira`), invalidada no
   `finally` de `sincronizar` junto do `sugestoesCache.invalidar()` e no fim da ingestão de
   pagamentos. `ultimaRunCarteira` do repositório de runs (leitura barata, 1 linha).
3. **Rota `GET /sispag/boletos-dda`** — Zod estendido (listas por `,`; `faixas` enum; `ordem` regex;
   `valorMin/Max` `coerce.number().nonnegative()`); 400 para lixo, como hoje.
4. **`POST /sispag/boletos-dda/sincronizar`** — `prazoMs: DDA_PRAZO_NA_INGESTAO_MS` (mover a constante
   para `BoletoDdaService` ou um `constants` comum, para a rota não importar a ingestão). Resultado
   ganha `arquivosLidos` (= sucesso real) mantendo `arquivosNovos`/`arquivosRelidos` (planejados).
5. **(só se Q11 aprovar)** `BoletoDdaRepository.salvarArquivo`: lista vazia com `total_itens > 0`
   gravado → não apaga, lança `ArquivoDdaVazioSuspeitoError` (conta em `falhas`, `warn` em português).
6. Status da sincronização: **sem endpoint novo** (default Q10). A aba recebe o `dda` da ingestão da
   página por prop; persistir `dda_estado` na run é o follow-up performance-1 (migration).

## 3. Frontend

1. `lib/sispag.ts`: `FiltroBoletosDda` + campos novos; `BoletosDdaResposta` + `totais`/`facetas`;
   `SincronizacaoDdaResultado` + `arquivosAdiados`, `arquivosLidos`; `fetchBoletosDda(filtro, {signal})`;
   erros ≠ 2xx leem `error`/`userMessage` do corpo em `sincronizarBoletosDda` (F2).
2. `BoletosDdaTab.tsx` vira orquestrador fino (como `TitulosAbaSituacao`): cabeçalho (escopo
   `A vencer | Todos`, `DDA de …`, aviso defasado, estado da última ingestão, "Atualizar DDA") →
   `CardsBoletosDda` → `FaixaBoletosHoje` → `FiltroSituacaoDdaBarra` (+ `RegrasBoletoDda`) → busca →
   `TabelaBoletosDda` (pílulas, contagem, tabela, `PaginacaoTabela`) → `CandidatosBoletoDialog`.
3. Estados: primeira carga = skeleton; erro = `EmptyState` de erro (F1); "não sincronizado" só com
   resposta OK sem `sincronizadoEm`; empty state por permissão (sem `executar`, nada de "clique em
   Atualizar DDA").
4. Toast do sync (F3): "N lidos · M adiados · K com falha"; `adiados > 0` ou `falhas > 0` = `warning`
   com "rode de novo"; sucesso = `success`; em ambos recarrega.
5. Recarga (F4): prop `ingestao?: { versao: number; dda?: DdaNaIngestao }`; `versao` muda → refetch;
   `dda.estado ∈ {parcial, falhou, ocupada}` → linha `role="status"` no cabeçalho.
   `page.tsx`: incrementar `versao` onde a página já recarrega o painel depois da ingestão
   (`recarregarPainel`/`carregar`) — avaliar no TaskScoper se cabe sem tocar as linhas de #138/#139;
   se não couber, a aba usa só o `sincronizadoEm` (refetch ao voltar a ficar visível).
6. `DesignSystemReviewer` obrigatório (frontend tocado).

## 4. Testes — RED primeiro (ordem de escrita)

Backend (`vitest`, ao lado do fonte):
1. `PaginacaoBoletoDda.test.ts`
   - RED **I-DDA5**: boleto sem filial **não** aparece nem conta com `filiais=[1]`; aparece com
     `filiais=['sem']`; ambíguo com 2 candidatos da filial 1 conta na filial 1.
   - RED totais: `totais.CANDIDATO = {qtd, valor}` somando `valor` do boleto; base = antes do filtro
     de situação, depois de filial/busca/colunas; grupo conta uma vez.
   - RED urgentes: `hoje` injetado; `HOJE` e `1-2` por dia civil; `VINCULADO` excluído; vencimento
     ausente não é urgente.
   - RED faixas/valor/banco/número/título/situações múltiplas; ordenação estável por coluna e
     desempate; página fora do intervalo continua limitada (teste existente segue verde).
   - Regressão: `situacao`/`filCod`/`vencimentoDe/Ate` antigos continuam funcionando (gaveta).
2. `BoletoDdaService.test.ts`
   - RED: sync sem `prazoMs` explícito na rota usa o prazo (teste da rota); `arquivosLidos` exclui
     falhas e adiados.
   - RED cache: duas `listar` seguidas na mesma chave consolidam uma vez; `sincronizar` invalida;
     `sincronizadoEm` ou run da carteira diferente → reconsolida; TTL vencido → reconsolida (relógio fake).
3. `routes/sispag.test.ts`: Zod aceita listas/enum/ordem e rejeita lixo (400); POST sincronizar
   repassa `prazoMs`.
4. (Q11) `BoletoDdaRepository.integration.test.ts`: lista vazia sobre arquivo cheio não apaga.

Frontend (`vitest` + Testing Library):
5. `BoletosDdaTab.test.tsx`
   - RED **F1**: GET pendente → skeleton e **sem** "DDA ainda não sincronizado"; GET com erro → erro e
     sem a frase; OK sem `sincronizadoEm` → a frase.
   - RED empty state sem `sispag:executar` não cita "Atualizar DDA".
   - RED **F3**: resposta `{arquivosNovos: 5, falhas: 2, arquivosAdiados: 3}` → toast `warning` com
     "0 lidos"/"3 adiados"/"2 com falha" (não "5 novos").
   - RED **F2**: 500 com `{error: 'x'}` → toast mostra "x".
   - RED **F4**: trocar filtro duas vezes aborta a primeira (`signal.aborted`); mudar `ingestao.versao`
     refaz o GET.
   - RED estado sobrevive a desmontar/remontar (troca de aba).
   - RED paridade: cards com R$; um só controle de situação (clicar o card marca o segmento); chip
     Em grupo ortogonal; pílula de filtro remove o filtro; "Mostrando X de Y"; página de 25.
6. `FaixaBoletosHoje.test.tsx`: só não-casados de hoje, máx. 4, "Ver só estes" liga `HOJE`.
7. `CardsBoletosDda.test.tsx`: cores/botões cheios, `—` enquanto carrega, "Pagam vários títulos" não
   usa `info`.
8. Rede de segurança dos extraídos: `TitulosAbaSituacao.test.tsx` e testes de `TabelaTitulos`
   verdes **sem edição** depois de extrair `SegmentosComTotal`/`ChipFiltro`/`PilulasFiltroAtivo`/
   `PaginacaoTabela`.
9. `BoletosDdaTab.grupos.test.tsx` existente: verde (compor/confirmar/anular grupo não muda).

Medição antes do GREEN do cache: tempo de `consolidar` + `paginar` no escopo "todos" (fixture de
~24 mil linhas no teste de performance existente, se houver; senão log temporário em HML).

## 5. Fora (follow-ups ao fim do ciclo)

F5.1 (aviso "DDA parado" por rodada esperada), F5.2 (janela por vencimento, não importação),
F5.3 (se Q11 recusar), `dda_estado` na run (performance-1), endpoint de status/202, mesmo store de
estado para a aba Títulos, filtros na URL.

---

# Rodada 2 (2026-10-30) — plano: agendador + conferência rápida + aviso

> Vale com os defaults Q13–Q19. Nada escrito ainda. Rebase sobre `origin/main` (v0.80.0, já tem a
> renegociação em `page.tsx`) antes do PR.

## A. Agendador (`.github/workflows/ingest-sispag.yml`, grátis)

1. `schedule`: `7 8 * * 1-5`, `7 10 * * *`, `13 15,19 * * 1-5`. Comentário do arquivo atualizado
   (minutos fora da hora cheia, rede da manhã, mapa dos outros crons).
2. Passo de formação: `if: github.event_name == 'workflow_dispatch' || github.event.schedule == '7 8 * * 1-5' || github.event.schedule == '7 10 * * *'`.
   `workflow_dispatch` ganha input `forcar_formacao` (default `true`, comportamento de hoje); o job
   recebe `--forcar` só nesse caso.
3. `jobs/formar-lotes.ts`: `triggeredBy: 'cron'` + `forcar` do argumento; imprime `ja_formado_hoje`.
4. `FormacaoLotesService.formar`: dentro do `FORMACAO_LOCK_KEY`, se `triggeredBy === 'cron'` e não
   `forcar`, consulta `JobExecucaoRepository` (novo método `existeConcluidaDesde(pipeline, desde)`,
   SQL parametrizado) com `calendar.startOfTodayBrt()`; achou → devolve `{ pulado: 'ja_formado_hoje' }`
   sem tocar lote. Toda rodada abre/fecha `job_execucao` (`sispag-formacao-lotes`; `error` em exceção).
   O resultado ganha campo opcional (`pulado?`), sem quebrar a rota manual.
5. `stalenessLimits`: registrar `sispag-formacao-lotes` só se o Gabriel quiser alerta (default: não,
   para não criar alerta novo nesta feature).

## B. Conferência rápida do DDA

1. Migration `0092_boleto_dda_conferencia.sql` (aditiva): tabela de uma linha
   (`id SMALLINT PRIMARY KEY CHECK (id = 1)`, `conferido_em TIMESTAMPTZ NOT NULL`, `origem TEXT`,
   `arquivos_lidos INT`, `arquivos_cabecalho INT`). Sem backfill (ausente = cai em `sincronizadoEm`).
2. `BoletoDdaRepository`: `listArquivosEstado()` (ddc → nome/status/cancelado_em),
   `atualizarCabecalho(arquivo)` (UPDATE só do cabeçalho, sem itens), `registrarConferencia(...)`
   (UPSERT da linha 1), `ultimaConferencia()`.
3. `BoletoDdaService.conferir({ triggeredBy, prazoMs })`: try-lock DDA (ocupado → `ocupada`);
   `listarArquivos` (falha → `falhou`, não grava `conferido_em`); diff; novos → `listarItens` +
   `salvarArquivo` (bounded 3, prazo 60 s); mudados → `atualizarCabecalho`; sumidos → `warn`;
   `registrarConferencia`; invalida caches só se gravou. A passada completa (`executarSincronizacao`)
   também chama `registrarConferencia` depois de listar com sucesso.
4. `CarteiraAtualizacaoService.atualizarSeDefasada`: no caminho `fresca`, se
   `agora − ultimaConferencia > SISPAG_DDA_CONFERENCIA_MIN` (novo no `EnvironmentProvider`, default 10),
   chama `conferir`; falha da conferência **nunca** muda o estado da carteira (vira `dda: { estado }`
   no retorno). Resposta ganha `dda?` opcional.
5. `GET /sispag/boletos-dda`: `conferidoEm` = `max(conferido_em, sincronizadoEm)`.

## C. Aviso

1. `BoletosDdaTab`: `horasDdaDefasado(conferidoEm ?? sincronizadoEm)`; prop `atualizandoCarteira`
   esconde o aviso; cabeçalho "DDA conferido às … · dados de …".
2. `page.tsx`: 1 linha no bloco do `<BoletosDdaTab>` (`atualizandoCarteira={refresh === 'atualizando'}`).
   O `refresh` já existe (`useCarteiraAoAbrir`).

## Testes (RED primeiro, nesta ordem)

Backend:
1. `JobExecucaoRepository`: `existeConcluidaDesde` parametrizado (`$pipeline`, `$desde`), só
   `success`/`partial`.
2. `FormacaoLotesService`: (a) cron com rodada concluída hoje → `ja_formado_hoje`, nenhum lote tocado;
   (b) rodada concluída ONTEM às 23:30 BRT não trava hoje (fronteira do dia BRT, relógio fixo 02:30Z);
   (c) rodada `error` hoje não trava; (d) manual/`forcar` ignora a trava; (e) a checagem acontece DENTRO
   do lock (duas chamadas concorrentes → uma forma, a outra pula ou dá lock ocupado); (f) trilha aberta
   e fechada (`success` com métricas; `error` na exceção).
3. `BoletoDdaRepository`: `atualizarCabecalho` não toca `boleto_dda`; `registrarConferencia` é UPSERT da
   linha 1; integração (Postgres local): conferência num arquivo sem mudança não reescreve itens
   (`sincronizado_em` dos itens igual antes e depois).
4. `BoletoDdaService.conferir`: novo → lê só ele; cancelado → só cabeçalho, nenhum `listarItens`;
   sumido → `warn`, nada apagado; nada mudou → só `registrarConferencia`, nenhum `salvarArquivo`,
   nenhuma invalidação; listagem falhou → não registra; lock ocupado → `ocupada`; prazo estourado →
   adiados; guarda de lista vazia continua valendo. Passada completa registra conferência.
5. `CarteiraAtualizacaoService`: `fresca` + conferência velha → confere; `fresca` + conferência < 10 min →
   não confere; `atualizada` → não confere à parte; conferência que lança → estado continua `fresca`.
6. Rota GET devolve `conferidoEm`; `EnvironmentProvider` lê `SISPAG_DDA_CONFERENCIA_MIN` (default 10).
7. Migration 0092 aplicada no teste de integração das migrations (se existir o padrão) e presente em
   `dist/migrations` após `npm run build` (o teste de `MigrationFiles` cobre).

Frontend:
8. `BoletosDdaTab`: aviso usa `conferidoEm`; `atualizandoCarteira` esconde o aviso; cabeçalho com as
   duas marcas; backend antigo (sem `conferidoEm`) cai em `sincronizadoEm`.
9. `ddaDefasado.test.ts` inalterado (regra de 8 h/dia útil igual).

Workflow (sem teste automático): revisão do YAML + `actionlint` se disponível; conferir depois do merge
os três primeiros disparos em `gh run list --workflow ingest-sispag.yml`.

## Riscos

- O slot das 05:07 forma lotes antes do expediente (Q13).
- Conferência rápida não traz vínculo novo do Conexos (limite da API, I-DDA6); o aviso pode ficar quieto
  com vínculos de horas atrás. É o comportamento esperado: vínculo continua no cadence do cron.
- `page.tsx` muda em 2 linhas no bloco do DDA; a main já tem a renegociação (v0.80.0) mexendo em
  `page.tsx` — rebase antes do PR.
