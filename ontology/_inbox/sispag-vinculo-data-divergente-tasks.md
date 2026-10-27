# Tasks — sispag-vinculo-data-divergente (ADR-0078)

Branch `feat/sispag-vinculo-data-divergente` · `/feature-tweak`, `entity_changed = true` (ontologia 0.49.0, já aplicada).
Escopo: caminho `DATA_DIVERGENTE` do vínculo de código de barras (I17p), reconhecimento tipado (I15r), 7º check do
fator de vencimento (I17d(7)), data candidata do lote (I8c), prazo efetivo `prazoBoleto` (I19t) e guarda de data do
`.REM` (I17q). **Fase 2 do produto** (ajustar a data do título no ERP) fica fora (REJECT-PREMATURE).

## Convenções (valem para toda tarefa)

- TDD: o teste da tarefa nasce vermelho antes do código. Teste colocado ao lado do fonte (`*.test.ts`).
- Classes exportadas, métodos arrow `public x = () => {}`, modificadores explícitos, `@injectable()`/`@singleton()`,
  `EnvironmentProvider` (nunca `process.env` em service), Zod nas bordas, SQL parametrizado (`$1`...).
- Identificadores e nomes de erro em inglês; **mensagens de log e de erro ao operador em português** (CLAUDE.md, ADR-0042).
- Datas: dia civil via `BankingCalendar` (`todayBrt`, `fromErpEpoch`, `toErpEpoch`, `nextBusinessDay`); nunca `Date.now()`
  para "vencido" (ADR-0070). Código de barras completo nunca em log/resposta: só máscara 5+4 (I17j).
- Gate padrão de toda tarefa de código (G): `cd src/backend && npm run typecheck && npm run lint && npm test` (e o
  equivalente em `src/frontend` se tocar). Ao fim de cada fase: PatternGuardian. Tarefas FE: DesignSystemReviewer.
- **Nada de escrita em PRD.** HML só nas tarefas da Fase 0 e nos portões da Fase 2, sempre com o guard `hmlEnvFile`.
- Legenda: **[FE]** toca `src/frontend` (DesignSystemReviewer) · **[QA]** precisa de roteiro do QaCoach.

## Fatos do código atual que moldam as tarefas

- `CodigoBarrasBoleto.decodificar(codigo, referencia)` JÁ decodifica o fator (ciclos de 9000 dias a partir de 07/10/1997,
  escolhe o ciclo mais próximo de `referencia`; `0000` ⇒ sem `vencimento`). Falta: contrato explícito do reinício em
  22/02/2025 (fator 1000), cruzamento com o DDA e ser a **única** definição. A referência hoje é o vencimento do TÍTULO;
  o 7º check precisa da referência = vencimento do DDA.
- `ElegibilidadeVinculoCodigoBarras.motivoDeData` hoje nega `Δ<0` (`DATA_ANTES_DO_TITULO`) e `Δ>5` (`DATA_FORA_DA_JANELA`);
  `VINCULO_DIAS_MIN = 0` e `DIAS_DEPOIS_MAX = 5` vêm de `RegraSugestaoBoleto`.
- `RegraSugestaoBoleto.avaliar` compara `diasEntre(dataDebito, boleto.vencimento) < 0` ⇒ `VENCIDO_INFORMATIVO` (sem rolagem).
  Já emite `VENCE_ANTES_DO_TITULO` quando `Δ<0` (dentro do envelope ±10) e `ENVELOPE_DIAS = 10`.
- `BoletoSuggestionService.confirmar` recebe `reconheceAvisos?: SinalSugestao[]` (`ConfirmarSugestaoBodySchema`, `.strict()`),
  chama `exigirReconhecimento` e grava o sinal `RECONHECEU_VENCE_ANTES` em `sinais` + evento `DECISAO_CONFIRMADA`.
- `VinculoCodigoBarrasService.vincularItem` (passo 2): leitura fresca → `avaliar` → `validarCodigoBarras` → `confirmarCodigoBarras`
  → `divergenciaPosConfirma` (check 5 compara `itsDtaPgtoResult` com a data da barra) → PUT → releitura. Modo via
  `SISPAG_BIND_CODBAR_FILIAIS` (`ModoVinculoCodigoBarras` + `ModoPorFilial`, kill-switch `sispagLiveWriteEnabled`).
- Última migration: `0089_sispag_titulo_tipo.sql`; `0090` reservada por `feat/sispag-boleto-agrupado`. Esta feature usa **0091**.
- Frontend: `filtroDatas.diaDoErp(t.vencimento)` alimenta `filtrosAbas.ts` (de/até) e `situacao/situacaoTitulos.ts`
  (`passaColunas`, faixa "Vencidos"); `FaixaBloqueadosHoje.tsx`; `ReconhecerAvisoDialog.tsx` (checkbox simples de Δ<0).

---

# FASE 0 — Medição HML (somente leitura/probe; nada em PRD)

Objetivo: fechar V10–V12 e decidir (a) o destino do Δ>0 (débito na data do título ou da barra) e (b) se o `on` do
caminho novo é viável. **Bloqueia a Fase 2 inteira; não bloqueia a Fase 1.**

## T0.1 — Probe `probe-hml-vinculo-data-divergente.ts` (V10, V11)
- Arquivos: `src/backend/jobs/probe-hml-vinculo-data-divergente.ts` (novo, no padrão de `probe-hml-vinculo-codbar-v1.ts`:
  `hmlEnvFile`, client de produção `ConexosSispagWriteClient`, saída em JSON no scratchpad/`docs`, **mascarar** códigos).
- Mede, em lote HML de rascunho criado pelo probe e limpo ao fim (padrão do V1–V9; o HML só tem 1 título futuro, então
  usar `seed-hml-vencimento.ts` se necessário):
  - **V10:** `validarCodigoBarras` + `confirmarCodigoBarras` com barra ANTES do título (Δ=-1,-2,-5) e DEPOIS (Δ=+6,+10):
    o que o ERP devolve em `itsDtaPgtoResult`; recusa de negócio?
  - **V11:** `editarItemDoRascunho` com `itsDtaPgto` menor e maior que o título e `finalizarLote` com `dataDebito`
    entre/fora; confirmar a regra R2 (`dataDebito ≤ min(itsDtaPgto)`), a R1 (≥ hoje) e se a barra de sábado/feriado é
    comparada rolada ou não (ADR-0078 R8).
- Critério de aceite: relatório com uma linha por caso (Δ, banco, `itsDtaPgtoResult`, recusa/aceite, mensagem do ERP), lido
  só do que o probe observou (sem suposição); probe é idempotente e remove o rascunho; `--dry` lista os casos sem chamar o ERP.
- Teste: unitário do montador de casos e do mascaramento (`probe-*.test.ts` ao lado, sem rede).
- Deps: nenhuma. Gate: G (typecheck/lint/test do que for lógica pura) + execução HML pelo Yuri/QaCoach.

## T0.2 — Probe do segmento J do `.REM` (V12)
- Arquivos: `src/backend/jobs/probe-hml-vinculo-data-divergente-rem.ts` (novo) reutilizando o gerador CNAB existente
  (`domain/libs/cnab`, `RemessaService`) **em dry-run** sobre o lote do T0.1: extrair do segmento J a data de pagamento
  e comparar com `itsDtaPgto` do item e com o vencimento do título e da barra.
- Critério de aceite: tabela `caso → J.data == título? == barra? == itsDtaPgto?`; nenhum envio ao banco, nenhum `.REM`
  persistido fora do scratchpad, código sempre mascarado.
- Deps: T0.1 (lote com itens de data divergente). Gate: G + execução HML.

## T0.3 — Registro da medição e decisão
- Arquivos: `ontology/_inbox/sispag-vinculo-data-divergente-medicao.md` (novo; OntologyCurator transcreve V10–V12 para
  `vinculo-codbar-item-sispag` e abre/atualiza a ADR se J ≠ barra).
- Critério de aceite (decisão explícita, escrita pelo Yuri):
  - J == `itsDtaPgto` da barra ⇒ Δ>0 debita na data da barra? ou do título? (escolha registrada) ⇒ T2.* liberadas.
  - J == título ⇒ caminho fica `off`; fase 2 vira pré-requisito; **T2.* ficam congeladas** (a Fase 1 inteira continua valendo).
- Deps: T0.1, T0.2. Gate: pausa humana (InfoGapBroker se faltar resposta).

---

# FASE 1 — Independentes da medição

Todas valem com o caminho `DATA_DIVERGENTE` ainda `off`: entregam o ack, a visibilidade do prazo e o 7º check sem
escrever nada novo no ERP.

## T1.1 — Decodificador do fator de vencimento (puro) [módulo único]
- Arquivos: `src/backend/domain/libs/boleto/FatorVencimentoBoleto.ts` (+ `.test.ts`); `CodigoBarrasBoleto.decodificar`
  passa a delegar a ele (remover o laço de ciclos inline; manter a assinatura pública).
- Contrato: `decodificar(fator: number | string, referencia: CivilDate) → { semVencimento: true } | { vencimento: CivilDate }`.
  Fator `0000` ⇒ `semVencimento`; módulo 9000 com **fator 1000 = 22/02/2025** (reinício) e ciclos anterior/seguinte;
  escolhe o ciclo mais próximo de `referencia` **sem consultar o relógio**; empate/fora do ciclo plausível ⇒ `undefined`.
- Aceite (testes): 1000→2025-02-22; 1001→2025-02-23; 9999→2049-... (fim do ciclo); 0000→sem vencimento; fator 0999
  (antigo ciclo) com referência de 2025-02-20 ⇒ data do ciclo anterior; mesma entrada com `referencia` de 2024 e de 2026
  dá ciclos diferentes e determinísticos; entrada inválida (`NaN`, 5 dígitos) ⇒ `undefined`; nenhum `Date.now()`/`new Date()`
  sem argumento (teste com relógio falso não muda o resultado). Os testes atuais de `CodigoBarrasBoleto.decodificar`
  continuam verdes sem edição.
- Deps: nenhuma. Gate: G + PatternGuardian.

## T1.2 — 7º check de I17d: fator × DDA
- Arquivos: `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts` (+ test);
  `domain/interface/sispag/…` (`MOTIVO_INELEGIVEL_VINCULO` += `FATOR_VENCIMENTO_DIVERGE`, `FATOR_SEM_VENCIMENTO`);
  `VinculoCodigoBarrasService.avaliar` passa `poolVencimento` como referência do decodificador.
- Aceite: (a) fator decodificado com `referencia = poolVencimento` ≠ `poolVencimento` ⇒ `INELEGIVEL(FATOR_VENCIMENTO_DIVERGE)`,
  também na janela padrão; (b) fator `0000`: janela padrão **inalterada** (continua elegível/`DATA_INDISPONIVEL` como hoje),
  caminho novo ⇒ inelegível (`FATOR_SEM_VENCIMENTO`, ficará testado em T2.2); (c) o check (5) pós-confirma
  (`divergenciaPosConfirma`/`DATA`) não é tocado e segue independente; (d) pós-import a divergência é determinística (I17g(3)):
  teste no service que o item é retirado com detalhe nomeado; (e) o motivo novo não vaza código (máscara).
- Deps: T1.1. Gate: G + PatternGuardian.

## T1.3 — Vigência da barra com rolagem ao próximo dia útil (I15h) + exigência de reconhecimento
- Arquivos: `src/backend/domain/service/sispag/RegraSugestaoBoleto.ts` (+ test), `domain/interface/sispag/SugestaoBoleto.ts`
  (`AvaliacaoSugestao` += `exigeReconhecimento: 'NENHUM' | 'DATA_DIVERGENTE'`, `prazoFinalBoleto`), `PrazoFinalBoleto` novo em
  `domain/libs/boleto/PrazoFinalBoleto.ts` (+ test) que usa `BankingCalendar.nextBusinessDay`.
- Aceite: barra de sábado/domingo/feriado nacional tem prazo final = próximo dia útil bancário; `VENCIDO_INFORMATIVO`
  passa a ser `prazoFinal < dataDebito` (barra de sábado com débito na segunda **não** é vencida); título continua sem
  rolagem (ADR-0070); `exigeReconhecimento = DATA_DIVERGENTE` se e só se `Δcentavos = 0` e `Δdias ∈ [-10,-1] ∪ [6,10]` e
  não vencida; `ATENCAO`, limites (`LIMITE_VALOR_MESMO_DIA`, `DIAS_DEPOIS_MAX`) e o envelope **inalterados** (teste de regressão
  da tabela atual); regra segue pura (sem relógio; o calendário entra por argumento ou helper puro injetado).
- Deps: nenhuma (usa `BankingCalendar`, já existente). Gate: G + PatternGuardian. Atenção: `RegraSugestaoBoleto` é
  `@injectable()` sem dependências e usada em ~10⁵ pares pelo motor; manter sem I/O e sem alocação por par nova relevante.

## T1.4 — Data candidata do item (I8c) — função pura e janela por lote
- Arquivos: `src/backend/domain/libs/boleto/DataCandidataItem.ts` (+ test) e `domain/service/sispag/DebitDateService.ts` (+ test).
- Aceite: `candidata = min(vencimentoTitulo, prazoFinalBoleto)` só é possível se `≥ hoje_BRT` e dia útil bancário (I8a);
  Δ<0 de um item **não puxa** a janela dos demais: `computeWindow` considera, por lote, o `min` dos itens daquele lote;
  sem data possível ⇒ resultado `INFORMATIVO` (não vincula, não bloqueia os demais); I8a/I8b inalteradas (um lote ⇒ uma
  `dataDebito` congelada após `criarLote`); itens sem `caminho` (o legado) têm janela idêntica à de hoje (teste de regressão).
  O **uso** pelo `FormacaoLotesService` (separar por data efetiva) é T2.6 (depende do `caminho` no item).
- Deps: T1.3. Gate: G + PatternGuardian.

## T1.5 — Migration 0091 + repositórios
- Arquivos: `src/backend/migrations/0091_sispag_reconhecimento_divergencia.sql` (+ `.test.ts` no padrão de 0086/0089 e
  entrada em `rollbacks/0091_…rollback.sql` + `rollbacks.test.ts`); repositórios `SugestaoBoletoRepository` e
  `LotePagamentoRepository`; `domain/interface/sispag/{SugestaoBoleto,SispagInterface}.ts`.
- Escopo SQL (aditivo, idempotente, `IF NOT EXISTS`, nenhuma linha reescrita): `sispag_sugestao_boleto_decisao` ganha
  colunas nuláveis `reconhecimento_tipo`, `reconhecimento_motivo`, `reconhecimento_delta_dias_visto`,
  `reconhecimento_valor_boleto_visto_centavos`, `reconhecido_por`, `reconhecido_em` com CHECKs (tipo ∈ {`DATA_DIVERGENTE`};
  motivo 10–500 quando o tipo existe; tudo-ou-nada); `lote_pagamento_item` ganha `vinculo_caminho`
  (`JANELA_PADRAO | DATA_DIVERGENTE`), `vinculo_delta_dias`, `vinculo_reconhecimento_id`; a trilha de eventos aceita
  `RECONHECIMENTO_INVALIDADO` como detalhe do `VINCULO_CODIGO_BARRAS_FALHOU` (sem tipo novo de evento, ADR-0078 §ack).
  **Numeração: confirmar no rebase** (ver riscos); o trigger só-inclusão da 0084 não é tocado.
- Aceite: teste SQL/estrutural da migration; round-trip do repositório (grava e lê decisão com reconhecimento e item com
  `caminho/deltaDias/reconhecimentoId`); decisão antiga continua lendo `reconhecimento = undefined`; imutabilidade
  preservada (reconfirmar cria linha nova, I15l); SQL parametrizado.
- Deps: nenhuma. Gate: G (inclui integration test de migration quando houver DB local) + PatternGuardian.

## T1.6 — Reconhecimento tipado: schema, erros e validade derivada (backend)
- Arquivos: `domain/interface/sispag/SugestaoBoletoSchemas.ts` (+ test): `ReconhecimentoDivergenciaSchema =
  { tipo: 'DATA_DIVERGENTE', aceito: true, motivo (10–500, trim), deltaDiasVisto: int, valorBoletoVisto: int centavos }`
  `.strict()`, em `ConfirmarSugestaoBodySchema` como `reconhecimento?`; **`reconheceAvisos` permanece aceito** para
  Δ<0 com valor diferente (I15o). Erros novos em `domain/errors/`: `DivergenceAcknowledgementRequiredError` e
  `DivergenceAcknowledgementStaleError` (422; mensagem pt-BR com Δ com sinal, valores e código mascarado).
  `domain/libs/boleto/ReconhecimentoDivergencia.ts` (+ test): `valido(reconhecimento, {deltaDiasAtual, valorBoletoAtual})`
  puro (igualdade exata de ambos).
- Aceite: schema rejeita `aceito:false`, motivo curto/longo, campos extras, `tipo` desconhecido, autor/`reconhecidoPor` no
  corpo (400); `valido` é falso se Δ **ou** valor mudarem por 1 unidade; erros mapeados para 422 em `respondLoteError`
  e documentados no comentário da rota; mensagens em português sem as barras completas.
- Deps: T1.3 (usa `exigeReconhecimento`/Δ). Gate: G + PatternGuardian.

## T1.7 — `confirmar`: exigir e gravar o reconhecimento na mesma transação
- Arquivos: `BoletoSuggestionService.confirmar` (+ test), `SugestaoBoletoRepository.inserirDecisao`, `routes/sispag.ts`
  (`POST /sugestoes-boleto/confirmar`: corpo novo, `decisaoParaApi` expõe `reconhecimento` + `reconhecimentoValido`,
  comentário de status 422), `routes/sispag.sugestaoBoleto.test.ts`.
- Aceite: (a) candidato com `exigeReconhecimento = DATA_DIVERGENTE` sem `reconhecimento` ⇒ 422 `…RequiredError`
  (isto inclui **Δ>5 com valor igual**, que hoje confirma sem nada; atualizar o teste existente e a nota no ADR);
  (b) `deltaDiasVisto`/`valorBoletoVisto` conferidos contra a avaliação **recalculada ao vivo** (nunca `SugestaoBoletoCache`);
  divergência ⇒ 422 `…StaleError`; (c) válido ⇒ grava `reconhecimento` na decisão e no payload de `DECISAO_CONFIRMADA`,
  mesma transação, `reconhecidoPor/Em` do JWT (`ator(req)`), nunca do corpo, nunca `sistema`; (d) ack tipado válido
  **implica** `RECONHECEU_VENCE_ANTES` quando Δ<0 e grava o sinal `DATA_DIVERGENTE_RECONHECIDA`; `reconheceAvisos` simples
  ainda vale para Δ<0 com valor diferente; (e) zero escrita no ERP (I15b) e `ajusteCentavos.agendarAposConfirmar` continua
  só pós-commit; (f) idempotência (201/200) e corrida (`inserirDecisao`) inalteradas; (g) mesma analista, sem segunda pessoa.
- Deps: T1.3, T1.5, T1.6. Gate: G + PatternGuardian.

## T1.8 — Validade, órfã e anulação (I15r/I15l/I19i)
- Arquivos: `BoletoSuggestionService` (derivar `orfa` + `motivoOrfa` pt-BR "reconhecimento de data divergente invalidado"
  quando `valido()` é falso), transferência da I18j (herda o ack só se Δ e valor recomputados ainda baterem; senão a
  decisão nova nasce com ack inválido), `SituacaoPagamentoService`/`SituacaoPagamentoResolver` (I19i: órfã por ack inválido).
- Aceite: após mudar o vencimento do título (Δ muda) ou o valor, a decisão segue `CONFIRMADA` (o sistema não a anula,
  I15g) mas aparece `orfa` com `motivoOrfa`; anular + reconfirmar com novo ack volta ao normal; `valido` nunca é coluna;
  testes cobrindo transferência com valores iguais e diferentes.
- Deps: T1.5, T1.6, T1.7. Gate: G + PatternGuardian.

## T1.9 — `prazoBoleto` derivado (I19t) no backend
- Arquivos: `domain/interface/sispag/SituacaoPagamento.ts` (`PrazoBoleto = { prazoEfetivo, origem: TITULO | BOLETO_SUGERIDO,
  vencimentoTitulo, vencimentoBoleto?, totalCandidatos?, perdido }`), `SituacaoPagamentoService`/`Resolver` (+ tests), as
  rotas que devolvem a lista de títulos (`routes/sispag.ts`), `TituloAPagar` na interface do FE em `src/frontend/lib/sispag.ts`.
- Aceite (os 6 casos canônicos 15–20 da I19t como testes): Δ=-2, valor igual, âncora ⇒ `prazoEfetivo = vencimentoBoleto`,
  `origem = BOLETO_SUGERIDO`; barra de sábado ⇒ segunda útil; 2 seguros ⇒ prazo do mais cedo e `totalCandidatos = 2`;
  `SO_FRACA` ⇒ prazo = título; barra `< hoje` ⇒ `perdido = true`; `VENCIDO` (I19e) e a ordem de motivos (I19b) **inalterados**
  (título que vence hoje não é vencido). Acionável = `CONHECIDO/FORTE` (inclui ambíguos seguros), `ATENCAO` ancorada ou
  `CONFIRMADA` não órfã; `VENCIDO_INFORMATIVO` e perdedor de disputa não puxam. Falha da fonte `BOLETO` (I19l) ⇒
  `origem = TITULO` + `fontesIndisponiveis` (fail-open com aviso). **Nunca persistido** (sem coluna, sem cache além do
  existente `SugestaoBoletoCache`); reaproveita `situacaoPorTitulo`/`desfechosAgora` sem N+1 (um batch por carteira).
- Deps: T1.3. Gate: G + PatternGuardian + QA-performance (é por-título na carteira inteira: medir tempo com a carteira de PRD
  sintética, meta sem regressão perceptível).

## T1.10 — Frontend: tipos, `prazoBoleto` e filtros [FE]
- Arquivos: `src/frontend/lib/sispag.ts` (+ `sispag.sugestaoBoletoApi.test.ts`), `components/filtroDatas.ts`,
  `components/filtrosAbas.ts`, `situacao/situacaoTitulos.ts`, `situacao/filtrosAtivos.ts` (+ tests de cada).
- Aceite: função única `prazoDoTitulo(t)` (dia civil) usada por (a) contagem e lista da faixa "bloqueados vencem hoje",
  (b) faixa/filtro "Vencidos" (inclui o "perdido", **sem** virar motivo `VENCIDO` e sem entrar em "vencem hoje"), (c) filtro
  de/até de vencimento no lugar de `diaDoErp(t.vencimento)` isolado (`passaColunas` e `filtrosAbas.getDatas`);
  título sem `prazoBoleto` (fonte indisponível/legado) cai no vencimento do título (regressão dos testes atuais).
- Deps: T1.9. Gate: G (FE: typecheck/lint/test) + DesignSystemReviewer.

## T1.11 — Frontend: linha da causa, faixa e "perdido" [FE] [QA]
- Arquivos: `situacao/FaixaBloqueadosHoje.tsx`, `situacao/TabelaTitulos.tsx`, `situacao/VencimentoCelula.tsx`,
  `situacao/rotulos.ts` (+ tests; `page.situacao.test.tsx`, `TitulosAbaSituacao.test.tsx`).
- Aceite: linha com prazo vindo do boleto mostra "Boleto sugerido vence hoje · título vence dd/mm" (e "N candidatos"
  quando ambíguo); "perdido, resolver no portal do banco" em linha separada, fora do pagamento do dia e presente no
  filtro "Vencidos"; mesmo botão "Confirmar boleto sugerido" da faixa; tokens/atoms do design system (sem cor hard-coded),
  acessível (texto, não só cor), foco e teclado nos botões; textos em português. Texto/layout é decisão desta tarefa
  (REJECT-NOT-DOMAIN na ontologia).
- Deps: T1.9, T1.10. Gate: G + DesignSystemReviewer. **[QA]** roteiro: conferir no tenant dev uma carteira com título a
  vencer e barra no dia, barra de sábado, barra passada e ambíguos.

## T1.12 — Frontend: diálogo do reconhecimento tipado [FE] [QA]
- Arquivos: `components/ReconhecerAvisoDialog.tsx` (generalizar ou novo `ReconhecerDivergenciaDialog.tsx`; renomear com
  cuidado, manter exports usados), `components/SugestaoBoletoPainel.tsx`, `components/CandidatosBoletoDialog.tsx`,
  `sugestaoBoleto.ts` (+ tests), `lib/sispag.ts` (`confirmarSugestaoBoleto` envia `reconhecimento`).
- Aceite: ao confirmar candidato com `exigeReconhecimento = DATA_DIVERGENTE` abre o diálogo com checkbox + motivo (10–500,
  contador) e mostra Δ dias com sinal e valor vistos; botão só habilita com checkbox marcado e motivo válido; envia
  `{tipo, aceito:true, motivo, deltaDiasVisto, valorBoletoVisto}` calculados do que a tela exibe; 422 `Stale/Required` aparece
  dentro do diálogo e ele continua aberto (padrão do `ReconhecerAvisoDialog`); Δ<0 com valor diferente mantém o aviso
  simples atual; sem segunda pessoa; órfã por ack inválido exibe o `motivoOrfa` e oferece anular/reconfirmar.
- Deps: T1.7, T1.8. Gate: G + DesignSystemReviewer. **[QA]** roteiro: confirmar com Δ=-3, Δ=+7, Δ=+11 (fora do envelope),
  valor igual e diferente; alterar a data do título no ERP e ver o par virar órfão.

## T1.13 — Fechamento da Fase 1 (cobertura da ontologia)
- Arquivos: `ontology/_index.json` (`impl_files` das regras/entidades tocadas), `ontology/_coverage.json`
  (`open_gap` reduzido ao que é Fase 2), `ontology/CHANGELOG.md` — pelo OntologyCurator, com aprovação do Yuri.
- Aceite: I17a(parcial)/I17d(7)/I15h/I15m/I15o/I15r/I8c/I19i/I19t passam de `planned` a `implemented` apenas se a tarefa
  correspondente estiver verde; I17p/I17q/I17k(modo novo)/I17l(ack) continuam `planned`.
- Deps: T1.1–T1.12. Gate: aprovação humana do diff da ontologia.

---

# FASE 2 — Dependentes da medição (só após T0.3 liberar)

## T2.1 — Modo próprio do caminho: `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`
- Arquivos: `domain/libs/environment/EnvironmentProvider.ts` (+ test, dois caminhos: env e SSM), `model/EnvironmentVars.ts`,
  `domain/libs/boleto/ModoDataDivergente.ts` (+ test; reusa `ModoPorFilial`, tipo `ModoVinculo`), `DEPLOY.md`/`.env.example`
  se existirem.
- Aceite: parse fail-closed (inválido ⇒ `off` em tudo), mesma sintaxe `on`/`shadow`/`off` global ou `"fil:modo"`; default
  vazio ⇒ `off`; modo do vínculo `off` ⇒ caminho novo `off`; kill-switch `sispagLiveWriteEnabled=false` ⇒ `off`;
  `shadow` do caminho sob vínculo `on` não escreve nada novo; **nunca** `process.env` em service.
- Deps: T0.3. Gate: G + PatternGuardian.

## T2.2 — Elegibilidade pura do caminho `DATA_DIVERGENTE`
- Arquivos: `ElegibilidadeVinculoCodigoBarras.ts` (+ test), `MOTIVO_INELEGIVEL_VINCULO` (+ `RECONHECIMENTO_AUSENTE`,
  `RECONHECIMENTO_INVALIDO`, `SEM_DATA_CANDIDATA`), interface do resultado (`caminho`, `deltaDias`).
- Aceite: elegível quando I17a/b/d(1)–(7)/h cumpridas **e** valor igual em centavos (sem tolerância), `Δ ∈ [-10,-1] ∪ [6,10]`,
  `ATENCAO` por data **com âncora**, reconhecimento válido, barra vigente na data de débito (rolada), data candidata possível
  (T1.4), fator ≠ `0000`; `ATENCAO` por valor, sem âncora, ambíguo, disputado ou vencido **nunca** vincula; Δ∈[0,5] segue
  `JANELA_PADRAO` sem ler ack; `|Δ|>10` fora. Tabela de decisão completa em teste (Δ de -11 a +11).
- Deps: T1.2, T1.3, T1.4, T1.6, T2.1. Gate: G + PatternGuardian.

## T2.3 — `VinculoCodigoBarrasService`: execução e `shadow` do caminho
- Arquivos: `VinculoCodigoBarrasService.ts` (+ test; **arquivo de 1053 linhas: extrair o ramo novo para uma classe/arquivo
  irmão em vez de crescer o `vincularItem`**), `avaliar` (reler a decisão **e o reconhecimento** do banco no instante da
  decisão), `registrarSimulado`, `persistir` (grava `caminho/deltaDias/reconhecimentoId` no item), `VINCULO_APLICADO` com os
  três campos.
- Aceite: `on`: mesma sequência de I17e (sem passo novo), `itsDtaPgto` acompanha a barra; `shadow`: só verificações locais,
  **zero chamada ao ERP**, grava `VINCULO_SIMULADO` com `deltaDias`, `caminho = DATA_DIVERGENTE`, reconhecimento presente/válido
  e motivo do `INELEGIVEL`; `off` ⇒ comportamento atual byte a byte; ack inválido entre o confirmar e o PUT ⇒ item retirado
  com `VINCULO_CODIGO_BARRAS_FALHOU` / `RECONHECIMENTO_INVALIDADO` relido imediatamente antes do PUT (I17l), decisão segue
  `CONFIRMADA` e vira órfã (T1.8); falha determinística retira, transitória aborta e retoma (I17g); nunca altera título nem
  decisão; log sem barras completas.
- Deps: T1.5, T1.7, T1.8, T2.2. Gate: G + PatternGuardian + QA-fault-tolerance (retomada com caminho novo).

## T2.4 — Guarda de data do `.REM` (I17q), fail-closed
- Arquivos: `RemessaService.ts` e o gerador do segmento J (+ tests; achar o ponto do gate pós-geração da I16b(2) e o
  espelho da I17m de valor), erro nomeado 409 em `domain/errors/`, rota de remessa.
- Aceite: em todo J com barra de vencimento ≠ `0000`, `J.dataPagamento == itsDtaPgto` do item; divergência ⇒ erro 409 nomeado,
  código mascarado, nada enviado ao banco, tratado pelo gate pós-geração; itens sem `caminho` ou `JANELA_PADRAO` com barra
  `0000` não mudam (regressão dos testes atuais de remessa); a guarda vale para os dois caminhos se a medição V12 mostrar
  que o J carrega a data da barra, e só para `DATA_DIVERGENTE` caso contrário (decidir em T0.3).
- Deps: T0.2, T0.3, T2.3. Gate: G + PatternGuardian + QA-fault-tolerance.

## T2.5 — Destino do Δ>0 (data de débito) conforme a medição
- Arquivos: `DataCandidataItem.ts`, `DebitDateService.ts` (+ tests).
- Aceite: implementa exatamente a decisão de T0.3 (débito na data do título ou da barra para Δ∈[6,10]); I8a/I8b intactas.
  Se T0.3 ficou "caminho `off`", esta tarefa é cancelada e o Δ>0 permanece sem vincular (só o ack sem efeito de vínculo).
- Deps: T0.3, T1.4. Gate: G + PatternGuardian.

## T2.6 — Formação por data efetiva (I8c) no `FormacaoLotesService`
- Arquivos: `FormacaoLotesService.ts` (+ test), `LotePagamentoService.ts` se criar lote usa `dataDebito` do primeiro item.
- Aceite: itens `DATA_DIVERGENTE` com data candidata distinta caem no lote da sua data (Δ<0 não puxa os demais itens do
  lote para trás); sem data possível o item fica fora e informativo; regra I4 (mesma filial) e as demais não mudam.
- Deps: T1.4, T2.3, T2.5. Gate: G + PatternGuardian.

## T2.7 — Portões HML antes do `on` e rollout [QA]
- Arquivos: `probe-hml-vinculo-data-divergente-e2e.ts` (novo, reaproveita T0.1/T0.2 contra o **serviço real** com repositórios
  em memória), roteiro do QaCoach em `ontology/_inbox/…-qa.md`.
- Aceite: (a) `confirm` com barra antes/depois do título; (b) `finalizar` com `itsDtaPgto` menor e maior que o título;
  (c) J do `.REM` bate com o `itsDtaPgto`; (d) caminho `shadow` em HML sem nenhuma chamada nova ao ERP; (e) `on` só em HML
  por filial. **`on` em PRD só com V-PRD1/V-PRD2 e aprovação do Yuri** (nenhuma tarefa liga a flag).
- Deps: T2.1–T2.6. Gate: pausa humana (QaCoach).

## T2.8 — Fechamento da Fase 2
- OntologyCurator: I17p/I17q/I17k/I17l → `implemented` ou mantidos conforme o resultado; ADR-0078 `accepted` → `partial`/final
  só no ship. Deps: T2.7. Gate: aprovação humana.

---

## Ordem de execução sugerida

`T0.1 → T0.2 → (T0.3 em paralelo humano)` ∥ `T1.1 → T1.2` ∥ `T1.3 → T1.4` ∥ `T1.5` → `T1.6 → T1.7 → T1.8` → `T1.9 → T1.10 → T1.11` ∥ `T1.12` → `T1.13` → (liberada T0.3) `T2.1 → T2.2 → T2.3 → T2.4 → T2.5 → T2.6 → T2.7 → T2.8`.

## Quadro de gates especiais

| Tarefa | DesignSystemReviewer | QaCoach roteiro | Revisão extra |
|---|---|---|---|
| T1.10, T1.11, T1.12 | sim | T1.11, T1.12 | — |
| T0.1, T0.2, T2.7 | não | sim (execução HML) | — |
| T1.9 | não | não | QA-performance (derivado por título) |
| T2.3, T2.4 | não | via T2.7 | QA-fault-tolerance |
| Backend demais | não | não | PatternGuardian ao fim de cada fase |

Regis-Review obrigatório após o verde (CLAUDE.md #11); só P0 re-entra no loop.

## Riscos

1. **Medição pode matar o Δ>0 ou o `on`** (J ≠ barra ⇒ fase 2 do produto vira pré-requisito). Mitigação: Fase 1 é útil sozinha
   (ack, prazo, 7º check) e não escreve nada novo no ERP.
2. **Mudança de comportamento no passo 1:** Δ>5 com valor igual passa a exigir ack (hoje confirma sem). Atualizar testes e
   avisar a analista no release note; o botão não pode ficar morto sem o diálogo (T1.12 sai junto com T1.7).
3. **Rolagem da barra é "nossa", o ERP (R2) compara `itsDtaPgto` não rolado:** pode aceitarmos o que o ERP recusa. Fail-closed
   até V11 (T0.1); manter a regra mais restritiva.
4. **7º check pode retirar boletos já vinculados em produção** (DDA ≠ fator): é o ganho, mas comunicar; verificar em `shadow`
   quantos itens de PRD seriam afetados antes de ligar (usar `vinculos-previstos`).
5. **`VinculoCodigoBarrasService` (1053 l) e `routes/sispag.ts` (1657 l)** já são grandes: extrair, não inchar (modifiability).
6. **`prazoBoleto` por título na carteira inteira** pode custar (cache `SugestaoBoletoCache`, um passe por carteira); T1.9 mede.
7. **`bootstrapAppContainer` é compartilhado com ~58 jobs:** a nova leitura de env (T2.1) deve ficar no `EnvironmentProvider`
   com default seguro (`off`), sem diagnóstico no bootstrap (gotcha do `painel-operacao`).
8. **Produção roda `dist/`:** a migration 0091 (arquivo `.sql`) já é coberta pelo copy do `build`; conferir `MigrationFiles.ts`.
9. **Ack e transferência (I18j):** edge cases de herdar/invalidar; coberto em T1.8, mas é a parte mais sutil.
10. **Universalidade:** 1 cliente (Columbia); revisão com o Francinei não bloqueante.

## Conflito previsto com `feat/sispag-boleto-agrupado` (não mergeada)

Base comum = `456bd9c6` (HEAD desta branch). Medido por `git diff --stat` do merge-base: aquela branch altera
`src/backend/routes/sispag.ts` (+198), `src/frontend/lib/sispag.ts` (+237), `src/frontend/app/sispag/page.tsx` e
`components/LoteCard.tsx`, `domain/interface/sispag/Fin015Write.ts`, a migration **`0090_sispag_grupo_boleto.sql`** e
`rollbacks.test.ts`, mais ontologia: `_index.json`, `_coverage.json`, `CHANGELOG.md`, `glossary.md`,
`entities/decisao-sugestao-boleto.md`, `entities/lote-pagamento.md` e ADR **0077** / ontologia **0.48.0**.
- **Arquivos em comum com esta feature (conflito textual previsto):** `routes/sispag.ts` (T1.7, T1.9), `frontend/lib/sispag.ts`
  (T1.10, T1.12), `ontology/{_index,_coverage}.json`, `CHANGELOG.md`, `glossary.md`, `decisao-sugestao-boleto.md`,
  `lote-pagamento.md`; e `vinculo-codbar-item-sispag.md` (`last_review`). `VinculoCodigoBarrasService.ts`,
  `RemessaService.ts` e `rollbacks.test.ts`: confirmar no rebase (agrupado mexe em `Fin015Write`/`ConexosBaixaClient`, vizinhos).
- **Numeração:** esta feature reserva ADR 0078, ontologia 0.49.0 e migration 0091. Se aquela branch cair fora ou mergear
  antes: reconferir/renumerar (migration pode voltar a 0090; ontologia 0.48.0), inclusive nomes nos testes de migration.
- **Estratégia:** manter o código novo em arquivos novos (`FatorVencimentoBoleto`, `PrazoFinalBoleto`, `DataCandidataItem`,
  `ReconhecimentoDivergencia`, `ModoDataDivergente`) e tocar `routes/sispag.ts` e `lib/sispag.ts` com blocos pequenos e
  contíguos; rebase da `main` antes do PR (Inviolable Rule #12); conflito não trivial pausa para o Yuri.
