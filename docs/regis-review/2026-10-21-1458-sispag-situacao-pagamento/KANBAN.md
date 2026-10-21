---
type: regis-review-kanban
run_id: 2026-10-21-1458-sispag-situacao-pagamento
scope: reduced (3/8 QAs rodados; availability, deployability, integrability, performance, security não foram executados nesta rodada por escolha de escopo)
total: 20
counts: { p0: 0, p1: 4, p2: 11, p3: 5 }
---

# Kanban — financeiro — 2026-10-21-1458-sispag-situacao-pagamento

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado (copiados verbatim dos arquivos de QA).
> Ordem: P0 (nenhum) → P1 (S → M) → P2 (S → M) → P3 (S → M).

---

## P0 — Crítico

_Nenhum achado P0 nesta rodada._

---

## P1 — Alto

### [testability-1] Blindar `validate-situacao-pagamento-v1.ts` contra executar migrations fora de HML/local

**QA**: Testability
**Tactic alvo**: Sandbox + Executable Assertions
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> O script dispara `bootstrapAppContainer()`, que executa `BootMigrator` e aplica migrations na string de conexão apontada. Em 20/10/2026, isso rodou a `0089` em produção por engano (documentado pelo próprio comentário do arquivo). A migração era aditiva/idempotente — a próxima pode não ser. O arquivo tem aviso, não guarda.

**Melhoria Proposta**
> Converter o aviso de header em guarda executável: detectar o host da `databaseConnectionString`, recusar execução se não bater com `localhost` / `127.0.0.1` / sufixo configurado para HML, salvo flag explícita `--allow-production-migrations` passada por argv **e** `NODE_ENV !== 'production'`. Alternativa complementar (Bass — Sandbox): instanciar `PostgreeDatabaseClient` com um pool somente-leitura (`SET default_transaction_read_only = on`) para o próprio job, bypassando o `BootMigrator`. Teste automatizado: um `validate-situacao-pagamento-v1.test.ts` que mocka `bootstrapAppContainer`, chama `main()` com uma URL fictícia de prod e verifica `process.exit(1)` com mensagem clara. Mesmo tratamento recomendado para TODO outro job em `src/backend/jobs/` que chame `bootstrapAppContainer` — ver `_shared-metrics.md` (há ~58 jobs compartilhando o bootstrap, conforme §Gotchas do CLAUDE.md).

**Resultado Esperado**
> Executar o script com variáveis de produção falha antes de abrir conexão; variáveis de HML/local seguem funcionando. Migrations aplicadas por engano em PRD: 1 → 0 nos próximos 180 dias; cobertura automatizada do job: 0 testes → ≥ 2 testes (feliz em HML + recusa em prod).

**Métricas de sucesso**
- Guardas automatizadas no script: 0 → 1 (verificação de host + flag `--allow-production-migrations`)
- Testes automatizados do próprio job: 0 → 2
- Incidentes de migração acidental na próxima rodada do probe: 1 → 0

**Risco de não fazer**
> Na próxima migração não-idempotente, repetir o incidente de `0061` (que esvaziou abas de pagamento por tempo mensurável em setembro/2026) — agora com um script que a própria equipe considera "só leitura".

**Dependências**: Nenhuma; segue padrão de outros jobs do repositório quando houver restrição de `databaseConnectionString` ou flag CLI.

---

### [testability-2] Gravar fixture real do `com298/list` para pinar o schema do leitor de tipo

**QA**: Testability
**Tactic alvo**: Recordable Test Cases + Executable Assertions
**Esforço**: S (depende de 1 sessão supervisionada do robô)
**Findings**: F-testability-2

**Problema**
> `listTiposDosDocumentos` (ADR-0075 I19d) é a única fonte do nome do tipo do documento ("(PERMUTA)"). Em PRD, `tpd_cod` está nulo em 1.277/1.277 títulos (medido 20/10/2026), então **o leitor nunca rodou em produção** com dado real. Os 4 testes são 100% mockados; o schema `tipoDocumentoRowSchema` nunca foi exercido contra bytes do ERP. Qualquer renomeação silenciosa de campo faz `TIPO_PERMUTA` virar `0 bloqueios` sem alarme — exatamente o modo de falha que I19l diz atacar.

**Melhoria Proposta**
> Durante a primeira execução supervisionada da ingestão em PRD, salvar 2–3 respostas reais do `com298/list` (contendo documento com `tpdDesNome` "(PERMUTA)", um sem tipo e um ADIANTAMENTO) em `src/backend/domain/client/__fixtures__/com298-tipos-*.json`. Adicionar um teste em `ConexosSispagClient.test.ts` que carrega o fixture via `readFileSync` e passa pelo `listGenericPaginated.mockResolvedValue({ rows: fixture })`, verificando que `TIPO_PERMUTA` dispara. Formato espelha o fixture já existente `2026-10-14-fin015-vinculo-codbar.json`. Bass: Recordable Test Cases + Executable Assertions.

**Resultado Esperado**
> O schema do boundary passa a quebrar o teste quando o Conexos renomeia campo; a cobertura de defeito da regra I19d passa de "só mockada" para "contra bytes reais". Fixtures gravados: 0 → ≥ 3; testes contra fixture real: 0 → ≥ 1.

**Métricas de sucesso**
- Fixtures `com298-tipos-*.json`: 0 → ≥ 3
- Testes contra fixture real: 0 → 1
- Caminhos "renomeou campo" cobertos por teste (ex.: `tpdDesNome` ausente, campo com outro nome): 0 → ≥ 2

**Risco de não fazer**
> Na primeira variação de contrato do `com298` (ERP update, nova versão), `TIPO_PERMUTA` silencia e Columbia pode pagar documento já quitado por permuta — o cenário que motivou a ADR-0075.

**Dependências**: 1 sessão supervisionada do robô Conexos (compartilhada com o rollout da ingestão com tipo).

---

### [fault-tolerance-1] Rejeitar inclusão quando o título está fora da carteira persistida (ou carregar o contexto autoritativo ao vivo)

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking (fail-closed), Increase Competence Set
**Esforço**: S (opção A) · M (opção B)
**Findings**: F-fault-tolerance-1

**Problema**
> Em `exigirSituacaoPagavel` (LotePagamentoService.ts:332-348), o retorno `null` de `avaliarVivo` para um título que a ingestão não persistiu faz todo o conjunto de regras ADR-0075 ser pulado. `TIPO_PERMUTA`, `FORMA_NAO_SISPAG`, `VENCIDO` e `BOLETO_SEM_DDA` deixam de barrar inclusões manuais nessa população (1.277 títulos sem `tpd_cod` em PRD em 20/10/2026). Os guardas vivos restantes (pago/liberado/duplicidade) não cobrem permuta nem forma de pagamento inválida.

**Nota do consolidador**: re-checado em código. Confirmado que o caminho `null` só afeta títulos ausentes da carteira persistida, é escolha documentada, e **não é regressão vs `main`** (`main` também não bloqueava permuta/forma na inclusão manual). Mantido P1 pelo leverage de fechar a defesa que a ADR-0075 vendeu e pelo esforço baixo (opção A é S).

**Melhoria Proposta**
> Trocar o curto-circuito por **Sanity Checking fail-closed**: quando `lerPersistido` devolve `null` para um título cujo `fin064` ao vivo é válido, recusar a inclusão com `TituloNaoElegivelError('fora-da-carteira')` OU, alternativamente, construir o contexto ADR-0075 a partir do `fin064` + leitura ao vivo de `com298/list` (tipo do documento) e do `boleto_dda` para aquele docCod, para que a regra se aplique mesmo sem persistência prévia. A primeira opção é S; a segunda é M e preserva a UX (analista não é bloqueado por "ingestão ainda não rodou").

**Resultado Esperado**
> 0 inclusões manuais que escapam de `TIPO_PERMUTA`/`FORMA_NAO_SISPAG`/`VENCIDO`/`BOLETO_SEM_DDA` por título fora da carteira. Novo teste em `LotePagamentoService.test.ts` cobrindo o caso.

**Métricas de sucesso**
- Cobertura das regras ADR-0075 em `incluirTitulo` para títulos fora da carteira: 0% → 100%
- Teste cobrindo o cenário: ausente → presente

**Risco de não fazer**
> Analista inclui à mão um título de permuta (ou com forma `CHEQUE`) via `/sispag/lotes/por-filial` sem bloqueio; só é barrado na remessa (ou pior, só na frente de permutas depois do pagamento).

**Dependências**: Nenhuma.

---

### [fault-tolerance-2] Propagar `fontesIndisponiveis` para `CriarLotesPorFilialResult` e recusar fail-closed quando a fonte do motivo CRÍTICO caiu

**QA**: Fault Tolerance
**Tactic alvo**: Quarantine, Sanity Checking (fail-closed na escrita), Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> No caminho de escrita (`criarLotesPorFilial` / `incluirTitulo`), uma falha em uma fonte do contexto (bloqueios, ajuste, boleto, env) silencia o motivo correspondente e segue como se o título fosse PRONTO. A UI do painel vê isso via `fontesIndisponiveis`, mas o chamador do `criarLotesPorFilial` não — o retorno não carrega o aviso.

**Melhoria Proposta**
> Adicionar `fontesIndisponiveis` ao `CriarLotesPorFilialResult` por lote. Opcionalmente, para fontes que cobrem motivos CRÍTICOS (duplicidade, boleto DDA), aplicar política **Quarantine**: recusa fail-closed enquanto a fonte está indisponível, com motivo `codigo: 'FONTE_INDISPONIVEL'`. Para fontes acessórias (ajuste pendente, confirmação de boleto), seguir com o aviso.

**Resultado Esperado**
> Toda chamada `criarLotesPorFilial` emite trilha legível quando opera com contexto degradado. Testar com mock que faz `bloqueioRepo.listAtivos` lançar: o retorno deve conter `fontesIndisponiveis: ['DUPLICIDADE']` (ou recusa, conforme política escolhida).

**Métricas de sucesso**
- Visibilidade de contexto degradado no caminho de escrita: 0% → 100%
- Fontes classificadas (crítica vs. acessória) com política documentada no ADR-0075: 0/4 → 4/4

**Risco de não fazer**
> Silêncio durante janela de instabilidade de uma fonte; o `BoletoSemCodigoBarrasError` da remessa é a última linha de defesa e cobre o pagamento duplicado, mas um lote inteiro passa pela aprovação da analista parecendo verde.

**Dependências**: Nenhuma.

---

## P2 — Médio

### [testability-3] Observabilidade do caminho `avaliarVivo = null`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> Quando o título da inclusão manual não está na carteira persistida, `SituacaoPagamentoService.avaliarVivo` devolve `null` em silêncio e `LotePagamentoService.incluirTitulo` deixa passar (teste pinna isso). Difere do caminho I19l (fonte indisponível ⇒ `fontesIndisponiveis` + WARN). Numa ingestão quebrada, 100% das inclusões caem em `null` sem acender nenhum sinal.

**Melhoria Proposta**
> Em `SituacaoPagamentoService.avaliarVivo`, quando `persistido` for `null`, emitir `logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'situação de pagamento: título fora da carteira persistida, inclusão sem avaliação', data: { chave } })`. Adicionar teste em `SituacaoPagamentoService.test.ts` que exige o `warn` em cima do atual `expect(...).toBeNull()`. Expor uma métrica/contagem (`situacao_fallback_sem_persistido_total`) para o painel operacional. Bass: Executable Assertions.

**Resultado Esperado**
> O caminho morto deixa de ser invisível. Baseline: 0 asserções de log em `avaliarVivo`-null → 1 asserção; incidentes "ingestão quebrou e ninguém viu" detectáveis em `< 10 min` em vez de só pela analista.

**Métricas de sucesso**
- Chamadas de `logService.warn` no caminho `null`: 0 → 1
- Testes exigindo o log: 0 → 1
- Métrica/contagem exposta ao painel: 0 → 1

**Risco de não fazer**
> Janela de ingestão quebrada passa calada pelo gate SISPAG, voltando ao mundo pré-ADR-0075 (descobrir "tarde") sem nenhum alarme.

**Dependências**: Nenhuma.

---

### [testability-4] Teste próprio do `AjusteCentavosExecucaoRepository` novo

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-4

**Problema**
> O repositório que alimenta I19h entrou no delta sem test file próprio. Exercitado só indiretamente via mock no `SituacaoPagamentoService.test.ts`. A query SQL do `listarUltimaEtapaPorTitulo` (que decide qual ledger entra) não tem teste.

**Melhoria Proposta**
> Criar `AjusteCentavosExecucaoRepository.test.ts` espelhando o padrão de `TituloAPagarRepository.test.ts` (mock de `withTransaction` + `selectMany`). 3 casos: (a) devolve a última etapa por título quando há vários ledgers, (b) título sem ledger não entra no mapa, (c) query vazia não quebra. Bass: Limit Structural Complexity (teste por unidade).

**Resultado Esperado**
> Cobertura de `AjusteCentavosExecucaoRepository`: 0% isolado → ≥ 90% (3 casos cobrem os ramos). Regressões localizadas no SQL (ordenação, GROUP BY) deixam de depender do serviço acima para serem detectadas.

**Métricas de sucesso**
- Arquivos .test para o repositório: 0 → 1
- Casos testados do método `listarUltimaEtapaPorTitulo`: 0 → ≥ 3

**Risco de não fazer**
> Uma mudança no SQL do método muda o comportamento do motivo `AJUSTE_CENTAVOS_PENDENTE` sem derrubar nenhum teste de serviço (os mocks reproduzem o novo comportamento sem alarme).

**Dependências**: Nenhuma.

---

### [modifiability-1] Testar paridade dos rótulos de motivo entre BE (`PERFIL`) e FE (`ROTULO_MOTIVO`)

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> A linha da tabela usa `situacao.rotulo` vindo do backend (`PERFIL[m].rotulo`), mas o chip do filtro, o diálogo de resultado e a tabela de regras usam `ROTULO_MOTIVO[m]` do frontend. Hoje já há 3 pares divergentes (`TIPO_PERMUTA`, `FORMA_NAO_SISPAG`, `RETIDO_CODBAR`) e nada avisa o dev que a divergência existe.

**Melhoria Proposta**
> Estender o teste de paridade de `src/frontend/lib/sispag.test.ts` para extrair o `PERFIL` do fonte do resolver (regex, do mesmo jeito que já faz com `PAGO_POR_CONEXOS_ROTULO`) e comparar `PERFIL[m].rotulo` com `ROTULO_MOTIVO[m]`. Documentar a política no cabeçalho de `rotulos.ts`: se o texto for intencionalmente diferente (chip vs linha), listar o motivo e marcar como `rotuloChip` separado. Tactic: Abstract Common Services.

**Resultado Esperado**
> Divergências de rótulo quebram CI (Backend ou Frontend) em vez de aparecer em QA visual. `3 pares divergentes → 0`.

**Métricas de sucesso**
- Pares de rótulos divergentes sem anotação: 3 → 0
- Teste de paridade cobrindo rótulos: ausente → presente

**Risco de não fazer**
> Divergência silenciosa prolifera a cada motivo novo; retrabalho de QA visual permanente.

**Dependências**: Nenhuma.

---

### [modifiability-2] Unificar `HORIZONTE_DIAS` / `JANELA_FORMACAO_DIAS` em um ponto de verdade

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services + Defer Binding (configuration)
**Esforço**: S
**Findings**: F-modifiability-2, F-modifiability-7

**Problema**
> A janela da formação automática está codada como `7` em dois lugares (`FormacaoLotesService.ts:19` e `situacaoTitulos.ts:246`). A tela promete 7 dias na prévia; o servidor forma até 7 dias. Mudar um sem o outro vira prévia mentindo.

**Melhoria Proposta**
> Opção A: expor via `GET /sispag/painel` um campo `janelaFormacaoDias` que o FE leia (contrato runtime; vale também pra tirar config do código no futuro). Opção B: colocar a constante em `src/backend/domain/interface/sispag/SispagInterface.ts` e espelhar em `src/frontend/lib/sispag.ts` com teste de paridade. Preferir A — resolve F-modifiability-7 na mesma. Tactic: Abstract Common Services + Defer Binding (configuration).

**Resultado Esperado**
> A janela vem do servidor; a tela não guarda número. `2 cópias → 1 fonte (BE)`; mudar a janela não exige coordenar FE+BE no mesmo PR.

**Métricas de sucesso**
- Cópias da constante: 2 → 1
- Fonte da janela: código BE+FE → `GET /sispag/painel` (ou `SispagInterface.ts` + paridade)

**Risco de não fazer**
> Produto pede "diminuir para 5 dias" no sprint seguinte; prévia e realidade divergem até o dev lembrar das duas.

**Dependências**: Nenhuma.

---

### [modifiability-4] Extrair cabeçalhos de coluna repetidos em `TabelaTitulos.tsx`

**QA**: Modifiability
**Tactic alvo**: Reduce Size of Module
**Esforço**: S
**Findings**: F-modifiability-4

**Problema**
> `TabelaTitulos.tsx` tem 427 LOC com 8 blocos `<ColumnHeaderFilter>` quase idênticos (credor, documento, valor, vencimento, forma, situação, próxima ação, filial). Cada nova coluna exige copiar ~15 LOC + ir no `useTabelaTitulos`.

**Melhoria Proposta**
> Mover a definição de coluna para um array declarativo tipado (`{ id, label, rotulosOrdem?, ativo, onLimpar, renderFiltro }`), iterar no `TableHeader`. A linha do `TableBody` pode seguir em um sub-componente `LinhaDoTitulo` recebendo as mesmas props que já são passadas. Tactic: Reduce Size of Module.

**Resultado Esperado**
> `427 LOC → ≤ 300 LOC`; adicionar coluna = 1 entrada em um array + 1 clause em `valorDaColuna`.

**Métricas de sucesso**
- LOC: 427 → ≤ 300
- Blocos duplicados de cabeçalho: 8 → 1 iterador

**Risco de não fazer**
> Qualquer nova coluna acelera o crescimento do arquivo.

**Dependências**: Testes já cobrem (`TitulosAbaSituacao.test.tsx`); refactor sem risco funcional.

---

### [fault-tolerance-3] Aceitar `Idempotency-Key` em `POST /sispag/lotes/por-filial`

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> Endpoint não lê `Idempotency-Key`. Retry (duplo-clique após timeout TCP, F5 pós-504) com `mover: true` CANCELA os lotes criados na primeira tentativa e cria lotes novos com IDs diferentes — qualquer referência operacional ao lote antigo (print, mensagem, anotação) fica órfã.

**Melhoria Proposta**
> Honrar `Idempotency-Key` no router (`routes/sispag.ts:272-289`). Persistir `(idempotencyKey, resultadoJson)` em `pagamento_ingestao_run` ou tabela própria `lote_idempotency` (mesma estratégia já usada em remessa/retorno/ingestão). Retornar o resultado anterior em replay, sem reexecutar.

**Resultado Esperado**
> Replay do mesmo `Idempotency-Key` devolve o mesmo `CriarLotesPorFilialResult` sem criar lote adicional. Teste em `routes/sispag.test.ts` cobrindo o replay.

**Métricas de sucesso**
- Endpoints criadores de agregado SISPAG aceitando `Idempotency-Key`: 3/4 (remessa, retorno, ingestão) → 4/4
- Trilha de operação estável sob retry: inconsistente → determinística

**Risco de não fazer**
> Inconsistência operacional em caminhos de rede instável (recorrente em clientes com proxy corporativo); dívida pequena, mas cumulativa.

**Dependências**: Nenhuma.

---

### [fault-tolerance-4] Logar WARN quando o descarte do lote vazio falha em `criarLotesPorFilial`

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S (≤1h)
**Findings**: F-fault-tolerance-4

**Problema**
> `cancelarSeVazio(lote.id).catch(() => false)` (LotePagamentoService.ts:289) descarta silenciosamente a falha do UPDATE. Em caso de falha, um `RASCUNHO` sem itens persiste e nenhum log é emitido.

**Melhoria Proposta**
> Trocar o `.catch(() => false)` por `.catch((e) => { this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'criação por filial: falha ao descartar lote vazio', data: { loteId: lote.id, erro: ... } }); return false; })`. Sem alterar a resposta ao cliente.

**Resultado Esperado**
> Toda falha de descarte do lote vazio aparece em `BUSINESS_WARN` com o `loteId`; o painel de "Lotes candidatos" para de acumular empty `RASCUNHO` sem rastro.

**Métricas de sucesso**
- Observabilidade da falha de descarte: 0 → 1 WARN por falha

**Risco de não fazer**
> Baixa; cosmético.

**Dependências**: Nenhuma.

---

### [fault-tolerance-5] Auditoria agregada do `criarLotesPorFilial`

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S (≤1h)
**Findings**: F-fault-tolerance-5

**Problema**
> O serviço não emite um registro `BUSINESS_INFO` próprio da operação (apenas os registros individuais de `criarLote` e `incluirTitulo`). Investigar uma criação parcial exige correlacionar por tempo + ator, especialmente se dois analistas rodam em janela próxima.

**Melhoria Proposta**
> Antes do `return`, chamar `this.logService.info({ type: LOG_TYPE.BUSINESS_INFO, message: 'SISPAG lote: criarLotesPorFilial', data: { ator, titulosPedidos, lotesCriados, recusadosPorFilial, mover } })`.

**Resultado Esperado**
> Um log por chamada de `criarLotesPorFilial`, com o ator e o resumo; MTTR de triagem pós-fato reduz.

**Métricas de sucesso**
- % de operações `criarLotesPorFilial` com log agregado: 0% → 100%

**Risco de não fazer**
> Dívida de observabilidade; dor sentida no primeiro incidente.

**Dependências**: Nenhuma.

---

### [testability-5] Teste focado em `TabelaTitulos.tsx` (maior componente FE do delta)

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M (2–5d — exige fixtures de títulos e setup react-testing-library)
**Findings**: F-testability-5

**Problema**
> `TabelaTitulos.tsx` (427 LOC) só é exercitado dentro do teste de integração `TitulosAbaSituacao.test.tsx` (29 casos). Regressões localizadas (ordenação numérica, aria-sort, caixa de seleção condicional por papel) ficam invisíveis até o teste integrado quebrar — e quando quebra, aponta para o container, não para a tabela.

**Melhoria Proposta**
> Criar `TabelaTitulos.test.tsx` com 5–8 casos focados: (1) ordena por vencimento asc por padrão, (2) clique no cabeçalho `Valor` alterna asc/desc e seta `aria-sort`, (3) linha BLOQUEADA não tem checkbox e mostra motivo/dono/botão, (4) papel `viewer` (sem `sispag:executar`) oculta checkboxes e botões de ação, (5) filtro de credor renderiza etiqueta removível. Bass: Limit Structural Complexity.

**Resultado Esperado**
> Diagnóstico de regressão de UI passa de "a aba toda quebrou" para "a tabela ordenou errado". Arquivos .test direcionados ao componente: 0 → 1; casos: 0 → ≥ 5.

**Métricas de sucesso**
- Arquivo .test direcionado a `TabelaTitulos`: 0 → 1
- Casos focados: 0 → ≥ 5
- Cobertura do componente: estimada ~70% (indireta) → ≥ 90% (direta)

**Risco de não fazer**
> Baixo isoladamente; triagem fica mais lenta. Não vira defeito-de-produção enquanto `TitulosAbaSituacao` continuar bem coberto.

**Dependências**: Nenhuma.

---

### [modifiability-3] Planejar o split do `LotePagamentoService` antes do próximo endpoint

**QA**: Modifiability
**Tactic alvo**: Split Module + Increase Semantic Coherence
**Esforço**: M (refactor + mover testes do suite de 228 LOC do PR + mais 300 LOC prévios)
**Findings**: F-modifiability-3

**Problema**
> `LotePagamentoService.ts` chegou a 832 LOC com 11 deps e 13 métodos públicos: criar/atualizar/listar/get, incluir/remover/retirar, finalizar/reabrir/cancelar e agora `criarLotesPorFilial`. O PR adicionou 135 LOC e 1 dep sem refactor compensatório. O próximo endpoint (ex.: lote-por-prioridade, lote-por-credor) encosta no teto de 1000 LOC.

**Melhoria Proposta**
> Candidatos a extração, pela coerência semântica atual:
> 1. `LoteLifecycleService` — `criarLote`, `finalizarLote`, `reabrirLote`, `cancelarLote`, `atualizarContaPagadora`.
> 2. `LoteItemService` — `incluirTitulo`, `removerTitulo`, `retirarDoLote`, `exigirSituacaoPagavel`.
> 3. `LoteQueryService` — `listarLotes`, `getLote`, `loteCompleto`.
> O `criarLotesPorFilial` fica como orquestrador fino que compõe `LoteLifecycleService.criarLote` + `LoteItemService.incluirTitulo`. Tactic: Split Module + Increase Semantic Coherence.

**Resultado Esperado**
> `832 LOC em um arquivo → ~3 arquivos de 200–350 LOC`; `11 deps → 4–6 por classe`; o próximo endpoint não cresce o host.

**Métricas de sucesso**
- Maior arquivo: 832 LOC → ≤ 400 LOC
- `@inject` por classe: 11 → ≤ 6

**Risco de não fazer**
> Em 2 features o arquivo cruza 1000 LOC; qualquer regressão exige snorkel.

**Dependências**: Alinhar com PatternGuardian para não falhar durante o refactor.

---

### [fault-tolerance-6] Promover `validate-situacao-pagamento-v1.ts` a job de reconciliação periódica com alerta

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile, Comparison (contínua), Condition Monitoring
**Esforço**: M
**Findings**: F-fault-tolerance-6

**Problema**
> Não existe reconciliação periódica da carteira local contra `fin015/fin064`. A ingestão sobrescreve a carteira a cada rodada, mas não compara nem alerta quando a divergência excede um limite. O `validate-situacao-pagamento-v1.ts` já tem a esqueleto certo (soma de motivos vs. estados).

**Melhoria Proposta**
> Promover para job agendado (hoje: cron do Render; alvo: EventBridge quando a infra existir) com cadência diária, saída em formato de métrica (Prometheus/CloudWatch) e alerta quando `semSituacao > 0`, `somaMotivos ≠ bloqueados` ou `nomesPermuta ≠ TIPO_PERMUTA.qtd` em mais de 1% da carteira. Adicionar uma segunda verificação que compara `SELECT COUNT(*) FROM titulo_a_pagar WHERE ativo=TRUE AND pago=FALSE` com `ConexosSispagClient.listTitulosAPagar` agregado por filial — divergência sistemática denuncia drift de contrato.

**Resultado Esperado**
> Divergência silenciosa deixa de existir; qualquer uma vira sinal em até 24h.

**Métricas de sucesso**
- Jobs de reconciliação periódica da carteira SISPAG: 0 → 1 (diário)
- Tempo de detecção de divergência local × ERP: indefinido → ≤ 24h

**Risco de não fazer**
> O painel mente sobre o status de um título entre rodadas de ingestão, o analista baseia decisões num snapshot stale sem saber.

**Dependências**: Definição de SLA de latência da ingestão (cruzar com qa-performance — não rodado nesta rodada).

---

## P3 — Baixo

### [modifiability-6] Mover `chaveDe({filCod, docCod, titCod})` para um util

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤ 1h)
**Findings**: F-modifiability-6

**Problema**
> 5 cópias (4 BE + 1 FE) de `` `${filCod}:${docCod}:${titCod}` ``.

**Melhoria Proposta**
> Adicionar `export const chaveTitulo = (c: ChaveTitulo): string => ...` em `src/backend/domain/interface/sispag/SispagInterface.ts` e espelhar em `src/frontend/lib/sispag.ts`. Tactic: Abstract Common Services.

**Resultado Esperado**
> `5 cópias → 1 BE + 1 FE`; busca por "`:${docCod}:${titCod}`" devolve 2 hits.

**Métricas de sucesso**
- Reimplementações: 5 → 2

**Risco de não fazer**
> Zero funcional; só higiene.

**Dependências**: Nenhuma.

---

### [modifiability-5] Encapsular as fontes do `SituacaoPagamentoService` em uma fachada

**QA**: Modifiability
**Tactic alvo**: Encapsulate + Use an Intermediary
**Esforço**: S
**Findings**: F-modifiability-5

**Problema**
> O service tem 8 `@inject` e cada nova fonte (OFAC, verificação de credor, etc.) vira +1 dep. O padrão `this.ler(fonte, …)` já desacopla erro, mas não desacopla identidade.

**Melhoria Proposta**
> Criar `SituacaoContextoLoader` com uma interface que receba `env` e devolva `ContextoCarregado`. O service passa a injetar `[resolver, loader, calendar, tituloRepo, logService]` (5), e o loader concentra bloqueios/ajustes/desfechos/env. Tactic: Encapsulate + Use an Intermediary.

**Resultado Esperado**
> `8 deps → 5`; nova fonte não aparece na assinatura do service.

**Métricas de sucesso**
- `@inject` no service: 8 → 5
- Teste de "fonte indisponível" permanece no loader (não no service)

**Risco de não fazer**
> Baixo; serviço continua operável. Importa quando a quinta fonte entrar.

**Dependências**: Nenhuma.

---

### [testability-6] Property-based test da identidade `∑ porMotivo = porEstado.BLOQUEADO`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-6

**Problema**
> A invariante I19b (soma dos bloqueados por motivo principal = total bloqueados) tem 1 teste por exemplo com 2 títulos. A invariante é estrutural: vale para qualquer tamanho e qualquer combinação. `fast-check` já é dependência do projeto.

**Melhoria Proposta**
> Adicionar em `SituacaoPagamentoResolver.test.ts` 1 property-based test: `fc.array(arbTitulo, { minLength: 0, maxLength: 50 })` → avaliar com ctx vazio → `expect(sum(porMotivo.qtd) === porEstado.BLOQUEADO.qtd)`. Idem para `porDono`. Bass: Executable Assertions com fuzzing de domínio.

**Resultado Esperado**
> A identidade da regra é verificada em 100 carteiras aleatórias por run, em vez de 1 exemplo. Casos cobertos por run: 2 → 100 (default `fast-check`).

**Métricas de sucesso**
- Property-based tests no delta: 0 → 1
- Casos verificados por run: 2 → 100

**Risco de não fazer**
> Baixo; só a confiança marginal da invariante global.

**Dependências**: Nenhuma; `fast-check` já é dep do repositório.

---

### [fault-tolerance-7] Distinguir "fonte caiu" de "falha interna" no `avaliarSituacao` do painel

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-7

**Problema**
> `SispagPainelService.avaliarSituacao` loga um único tipo de erro (`FLOW_ERROR`) para qualquer falha interna do cálculo, incluindo falhas de infraestrutura (Postgres caiu) e bugs do resolver. A granularidade dificulta triagem.

**Melhoria Proposta**
> Dividir o log entre `INFRA_ERROR` (quando o erro tem `code` de pg, timeout de rede, etc.) e `FLOW_ERROR` (resto). Pequeno; defensivo.

**Resultado Esperado**
> Triagem de "painel sem situação" por classe de erro, não por `grep` em mensagem.

**Métricas de sucesso**
- Tipos de log distintos para falha do `avaliarSituacao`: 1 → 2

**Risco de não fazer**
> Nenhum material.

**Dependências**: Nenhuma.

---

### [modifiability-7] Externalizar janela, lock-key e textos user-facing para configuração

**QA**: Modifiability
**Tactic alvo**: Defer Binding (configuration)
**Esforço**: M
**Findings**: F-modifiability-7

**Problema**
> `HORIZONTE_DIAS = 7`, `FORMACAO_LOCK_KEY = 615243789` e `EFEITO_MOTIVO` / `ORIENTACAO_NO_CONEXOS` são hardcoded. Cada ajuste pedido pelo produto gasta um release.

**Melhoria Proposta**
> Janela e textos user-facing: expor via `/sispag/painel` (ou `/sispag/recursos`) em um campo `configSituacao`. Lock-key: deixar como constante compartilhada mas documentar que é imutável (quem muda arrisca double-run). Tactic: Defer Binding (configuration).

**Resultado Esperado**
> Mudar "renegociar vencimento no Conexos" para "renegociar no fin070" = PR no backend sem reinstalar o FE. Janela ajustada por produto sem redeploy do FE (resolve F-modifiability-2 por tabela).

**Métricas de sucesso**
- Strings user-facing hardcoded nesta fatia: 3+ → 0
- Janela em `GET /sispag/painel`: ausente → presente

**Risco de não fazer**
> Baixa frequência de mudança, mas o custo-por-ciclo é alto quando acontece.

**Dependências**: `[modifiability-2]` compõe parte desse esforço — fazer juntos.


## Errata do orquestrador (2026-10-21)

A baseline "1.277 títulos" citada para `fault-tolerance-1` / R-1 está **mal atribuída**: 1.277 é o número de títulos
da carteira persistida **sem `tpd_cod`** (medição de 20/10), que estão **na** carteira e portanto são avaliados por
`avaliarVivo`. A população exposta ao `null` é outra: títulos que ainda **não** estão na carteira persistida
(criados no Conexos depois da última ingestão). Essa população não foi medida. A prioridade P1 se mantém pelo
leverage e pelo esforço S, não pelo volume.
