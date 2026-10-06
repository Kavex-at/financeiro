# sispag-remessa-download-export — tasks

`/feature-tweak lote-pagamento "download da remessa visível e confiável + exportar títulos das remessas em XLSX"`
(lote C do batch paralelo A/B/C, escopo decidido pelo usuário — entrevista pulada). `entity_changed=false`:
nenhum estado, transição ou invariante novo; é leitura/projeção do que o lote já guarda.

## Causa-raiz do "não vi / funciona mal" (investigação, antes do fix)

1. **Visibilidade (causa principal, provada no código e pelo print de produção v0.55.0).** O botão do
   `LoteCard` exige `l.remessaArquivo`. A lista que alimenta a aba Finalizados vem de
   `GET /sispag/lotes` → `LotePagamentoRepository.listLotes`, cujo `SELECT` **não traz** `native_*`,
   `remessa_arquivo`, `remessa_num`, `remessa_gerada_em`, `cco_cod`, `ger_num` (só `getLoteComItens`
   traz). Resultado: em toda carga de página `remessaArquivo` chega `undefined` e o botão some. Ele só
   aparecia logo após "Gerar remessa" (a ação devolve o lote via `getLoteComItens`) e sumia no próximo
   reload/refresh — o "às vezes vi, às vezes não".
2. **Falha silenciosa no download.** `baixarArquivo` procura o arquivo pelo nome em
   `listarArquivosRemessa` (página única, `pageSize: 20`) e exige `gabLngDados` na linha. Se o `flpCod`
   reciclado acumular >20 arquivos, ou a grade vier sem o conteúdo, devolve `null` → 404
   `"lote sem remessa gerada"` (mensagem falsa: o lote TEM remessa). Já guardamos `native_gab_cod`;
   o `GET download/{gabCod}` (`baixarRemessa`) é o caminho direto e não depende da página.
3. **Erro opaco na tela.** O frontend mostrava `Falha ao baixar a remessa (404)` sem ler o corpo.
4. `remessa_gerada_em` era mapeado com `String(Date)` (formato `Tue Oct 06 …`), inutilizável em export.

## Tasks

### T1 — `listLotes` devolve as chaves nativas e os dados da remessa
- Arquivo: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- AC1: o `SELECT` de `listLotes` inclui `native_fil_cod, native_bnc_cod, native_flp_cod, native_gab_cod,
  remessa_arquivo, remessa_num, remessa_gerada_em, cco_cod, ger_num` (mesma projeção de `getLoteComItens`).
- AC2: teste prova que `listLotes` devolve `remessaArquivo`/`remessaNum`/`nativeGabCod`.
- AC3: `remessaGeradaEm` sai em ISO 8601 quando o driver devolve `Date`.

### T2 — `baixarArquivo` robusto, com erro claro em português
- Arquivos: `RemessaService.ts`, novo `errors/RemessaArquivoIndisponivelError.ts`, `routes/sispag.ts`.
- AC1: casa pelo nome registrado (regra de segurança mantida: nunca "o primeiro com conteúdo").
- AC2: se o nome não está na grade (ou veio sem conteúdo) e há `native_gab_cod`, baixa por `gabCod`
  (`write.baixarRemessa`); nunca usa outro `gabCod` que não o registrado no lote.
- AC3: lote inexistente ou sem remessa → `null` → 404 `"Este lote não tem remessa gerada."`.
- AC4: lote com remessa cujo arquivo não é achado no Conexos → `RemessaArquivoIndisponivelError`
  (404, `code: REMESSA_ARQUIVO_INDISPONIVEL`, mensagem em português nomeando arquivo e lote nativo).
- AC5: testes unitários com mocks (sem Conexos real) para os 4 caminhos.

### T3 — Serviço de export XLSX dos títulos de remessas
- Arquivos: novo `domain/service/sispag/RemessaTitulosExportService.ts` (+ teste),
  `LotePagamentoRepository.listLotesPorIds`.
- AC1: `@injectable`, arrow methods, `montarDefinicao` (testável sem bytes) separado de `serializar` (exceljs).
- AC2: uma aba, uma linha por título: lote, remessa nº, arquivo, gerada em, filial, banco/conta pagadora,
  data de débito, status do lote, credor, documento, vencimento, valor, modalidade, situação, pago em,
  valor pago, retorno do banco. Linha final de totais (quantidade e somas de valor / valor pago).
- AC3: só exporta lotes com remessa (`REMESSA_GERADA`/`RETORNADO`/`BAIXADO`); id inexistente ou sem
  remessa → erro 422 em português nomeando os ids.
- AC4: SQL parametrizado (`id = ANY($ids)`).

### T4 — Endpoint `POST /sispag/remessas/titulos/exportar`
- AC1: body Zod `{ loteIds: uuid[] }`, 1..50, únicos; 400 fora disso.
- AC2: permissão `SISPAG_VER` (mesmos dados que `GET /sispag/lotes` já mostra; não expõe destino do
  favorecido), `heavyRouteLimiter`.
- AC3: responde xlsx com `Content-Disposition` (nome com data).

### T5 — Frontend
- `lib/sispag.ts`: `exportarTitulosRemessas(loteIds)`; `baixarRemessa` lê a mensagem do corpo no erro.
- `LoteCard.tsx`: botão **"Baixar remessa"** no cabeçalho de todo lote `REMESSA_GERADA`/`RETORNADO`/
  `BAIXADO` (com `SISPAG_EXECUTAR`, regra LGPD mantida), ao lado de "Sincronizar agora"; atalho
  **"Exportar títulos"** por card; checkbox opcional de seleção (props `selecionado`/`onSelecionar`).
- Novo `components/ExportarTitulosBarra.tsx`: contador, "Exportar títulos (.xlsx)", "Limpar seleção".
- `page.tsx`: edição mínima (estado de seleção + barra + props no `LoteCard` da aba Finalizados).
- AC: testes jest dos dois componentes e do client.

### Fora de escopo
- Mudar a permissão do `.REM` (continua `SISPAG_EXECUTAR`).
- Paginar `listarArquivosRemessa` (o fallback por `gabCod` torna desnecessário para o download).
