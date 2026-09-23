---
type: regis-review-kanban
run_id: 2026-09-22-2209-sispag-reter-titulo-lote
total: 18
counts: { p0: 0, p1: 2, p2: 9, p3: 7 }
---

# Kanban — financeiro — 2026-09-22-2209-sispag-reter-titulo-lote

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Escopo: delta da branch `fix/sispag-reter-titulo-lote` (ADR-0050).
> Notas de deduplicação (ver REPORT.md §7):
> - `[migration-0062-integration]` absorve `availability-2` + `deployability-1` + `testability-2`
> - `[audit-trail-lote]` absorve `fault-tolerance-1` + `security-2`
> - `[mttr-rollback-history]` absorve `availability-3` + `deployability-2`

---

## P0 — Crítico

_Nenhum card P0 neste delta._

---

## P1 — Alto

### [performance-1] Tirar o refresh do painel (Conexos) do caminho de escrita das ações de lote

**QA**: Performance
**Tactic alvo**: Reduce Overhead / Bound Execution Times
**Esforço**: S (alternativa 1: `Promise` não-bloqueante) / M (alternativa 2: patch otimista com dados devolvidos pela mutação)
**Findings**: F-performance-1

**Problema**
> Desde este delta, toda ação de lote (finalizar, cancelar, reabrir, marcar retorno, trocar conta pagadora, trocar modalidade de item, remover item) passou a aguardar também um `GET /sispag/painel` completo — que inclui fan-out ao Conexos (`CONEXOS_FANOUT_LIMIT=4`) e ~410 KB de carteira — antes de liberar o botão. Ações que são 100% locais (ex.: trocar modalidade de um item) ficam reféns da latência do ERP externo (`page.tsx:428-432`).

**Melhoria Proposta**
> Tactic alvo: **Reduce Overhead** / **Bound Execution Times**. Duas alternativas, da mais barata à mais completa:
> 1. (S) Fazer `recarregarPainel()` rodar em paralelo sem bloquear `busy`/o spinner do botão — atualizar `painel` quando resolver, sem segurar a UI. O usuário já vê o `lote` atualizado (resposta da própria ação); o badge de retenção/lote na aba "Títulos" pode chegar um instante depois.
> 2. (M) Fazer as rotas de mutação do lote (`finalizar`, `atualizarModalidadeItem`, `removerTitulo`, etc.) devolverem, junto com o `lote`, os dados mínimos que hoje só vêm do painel (ex.: se o título alvo ficou `emLote`/`retencaoFormacao`), e o frontend faz um patch otimista local em vez de re-buscar a carteira inteira.
> Tocar: `src/frontend/app/sispag/page.tsx` (`acaoLote`), opcionalmente `LotePagamentoService`/rotas em `src/backend/routes/sispag.ts` se for a alternativa 2.

**Resultado Esperado**
> Nº de fetches Conexos-dependentes por ação de lote local: 1 → 0 (ou, no mínimo, não-bloqueante). P95 do round-trip de uma troca de modalidade (clique → spinner desliga): hoje potencialmente múltiplos segundos (herda o p99 de 2–10s do Conexos) → alvo < 300ms (mesmo perfil de antes do delta, Postgres-only).

**Métricas de sucesso**
- Fetches Conexos por ação de lote local: 1 → 0
- P95 de `atualizarModalidadeItem` (clique → UI liberada): não medido localmente (depende do Conexos) → alvo < 300ms, independente da saúde do Conexos

**Risco de não fazer**
> Em dias de Conexos lento (p99 documentado até 10s), a tela de montagem de lote — o fluxo mais repetitivo da Frente II — fica praticamente inutilizável para revisão item a item, e ninguém vai suspeitar do painel como causa.

**Dependências**: nenhuma.

---

### [security-1] Aplicar `assertUserCanActOnFilial` às rotas de retenção do SISPAG

**QA**: Security
**Tactic alvo**: Authorize Actors / Limit Access
**Esforço**: S (≤1d) para as 2 rotas do delta; M (2-5d) para as 9 restantes
**Findings**: F-security-1

**Problema**
> As 2 rotas novas de "Retirar do lote"/"Liberar" (ADR-0050) validam `role='admin'` mas não o escopo de filial do ator, replicando um gap já documentado no próprio guard (`filialAuthz.ts:19`, escrito antes deste delta) que pedia paridade com SISPAG. Um admin de uma filial pode reter/liberar título de outra filial trocando `filCod` na URL — 0/11 rotas mutantes de SISPAG aplicam o guard, contra 8/~10 em `recebimentos.ts`.

**Melhoria Proposta**
> Importar `assertUserCanActOnFilial` de `../http/filialAuthz.js` em `src/backend/routes/sispag.ts` e chamá-lo com `req.user`/`chave.data.filCod` logo após `autorDoToken`, nas 2 rotas novas (`retirar-do-lote`, `DELETE .../retencao`) e, no mesmo PR ou como follow-up P1 dedicado, nas 9 rotas mutantes pré-existentes do arquivo (fora do escopo deste delta, mas mesma correção mecânica). Tactic Bass: Authorize Actors / Limit Access.

**Resultado Esperado**
> `grep -c assertUserCanActOnFilial src/backend/routes/sispag.ts`: 0 → ≥2 (rotas do delta) → 11 (paridade total, se o follow-up for aceito). Requisição para `filCod` fora do allow-list do usuário passa a devolver 403 `FILIAL_NAO_AUTORIZADA` em vez de 200.

**Métricas de sucesso**
- Rotas com `assertUserCanActOnFilial`: 0/11 → 2/11 (mínimo, este delta) → 11/11 (alvo do repo)
- Teste automatizado cobrindo 403 cross-filial nas 2 rotas novas: 0 → ≥2 casos

**Risco de não fazer**
> Em 6 meses, com mais filiais e mais analistas com role `admin`, a ausência do guard vira um vetor real de interferência operacional entre filiais, sem log de "por que este título nunca é lotado" apontar para o ator errado.

**Dependências**: nenhuma — `filialAuthz.ts` já existe e já é usado em `recebimentos.ts` como referência de uso.

---

## P2 — Médio

### [availability-1] Tolerar falha da nova leitura de retenções sem derrubar o painel SISPAG

**QA**: Availability
**Tactic alvo**: Degradation / Ignore Faulty Behavior
**Esforço**: S (≤1d)
**Findings**: F-availability-2

**Problema**
> O `montarPainel` passou a fazer `Promise.all` de 4 leituras Postgres (a leitura de `titulo_retencao_formacao` foi adicionada pelo delta na linha 91-96 do `SispagPainelService.ts`). Se qualquer uma falhar, o painel inteiro devolve 500 — inclusive quando a que falha é apenas a leitura ornamental que alimenta o `RetencaoBadge`. O mesmo arquivo já demonstra o padrão certo em `linhasDigitaveisDoLote` (`try/catch` → `BUSINESS_WARN` + lista vazia) e em `contarExecucoesParadas`.

**Melhoria Proposta**
> Tactic alvo: **Degradation** (Recover from Faults — Preparation & Repair) + **Ignore Faulty Behavior**. Trocar `Promise.all` por `Promise.allSettled` para as leituras ornamentais e emitir `BUSINESS_WARN` quando `retencaoRepo.listAtivas()` falhar; a tela mostra o painel sem badges de retenção (funcionalmente igual ao estado antes do delta) em vez de 500. Aplicável também a `runRepo.findLatestSuccessFinishedAt` (ornamento) e, com cuidado, ao `loteRepo.listTitulosEmRascunho` (que marca `emLote` para bloqueio de I3 — este é dado de decisão, deveria continuar mandatório).

**Resultado Esperado**
> Painel SISPAG serve sob falha transitória da SELECT de retenções (perde o badge, mantém a tomada de decisão). Métrica: leituras auxiliares tolerantes no `SispagPainelService.montarPainel` — 0/2 (retenção + última-run) → 2/2 tolerantes; leituras críticas (títulos + emLote) permanecem mandatórias e explicitamente rotuladas.

**Métricas de sucesso**
- Falhas em `retencaoRepo.listAtivas()` derrubam o painel: sim → não
- Cobertura de teste do caminho degradado (mock rejeita → resposta 200 com badges vazios): 0 → 1

**Risco de não fazer**
> Em janela de saturação transitória do Supabase, a analista perde a tela de pagamentos inteira por causa de uma leitura ornamental adicionada por esta feature. Baixo risco em regime normal; alto em incidente.

**Dependências**: nenhuma; padrão já existe no mesmo arquivo.

---

### [migration-0062-integration] Integration test da migration 0062 e do `RetencaoFormacaoRepository` contra Postgres real

> Card mesclado: absorve `availability-2` (F-availability-1), `deployability-1` (F-deployability-1) e `testability-2` (F-testability-2). Os 3 agentes recomendaram explicitamente a mescla — mesmo integration test, mesma infra de CI já existente (script `test:sql` + `postgres:17-alpine`).

**QA**: Availability + Deployability + Testability
**Tactic alvo**: Abstract Data Sources / Self-Test / Idempotent Deploys
**Esforço**: S (≤1d) — infra `test:sql` já pronta
**Findings**: F-availability-1, F-deployability-1, F-testability-2

**Problema**
> A migration `0062_titulo_retencao_formacao.sql` cria uma tabela nova com **índice único parcial** (`WHERE removido_em IS NULL`), **três CHECK constraints** (pareamento de nulos, enum de motivo_remocao, tamanho do motivo) e o `RetencaoFormacaoRepository.insertAtiva` usa `ON CONFLICT (…) WHERE removido_em IS NULL DO NOTHING`. Nenhuma dessas regras é exercitada contra um Postgres real: o teste do repo mocka `PostgreeDatabaseClient` e o teste da migration só faz regex sobre o texto SQL. O repo já tem 15 arquivos `*.integration.test.ts` (o script `test:sql` no `package.json`); o padrão está pronto para uso. A rede de segurança do `BootMigrator` não cobre o cenário mais insidioso: o `CREATE INDEX` passa, o `INSERT` no runtime é que falha — 500 no primeiro `retirarDoLote`.

**Melhoria Proposta**
> Tactic alvo: *Abstract Data Sources* / *Sandbox* / *Self-Test*. Criar `src/backend/migrations/tituloRetencaoFormacao.integration.test.ts` no padrão de `vwMetricasCiclo.integration.test.ts`: aplica a 0062 num Postgres efêmero, insere uma retenção, prova (i) migration aplica limpo, (ii) reaplicar é no-op, (iii) o índice parcial rejeita a segunda ativa para a mesma chave, (iv) permite reter de novo depois de `removido_em IS NOT NULL`, (v) `ON CONFLICT DO NOTHING` no `insertAtiva` não vira erro, (vi) o CHECK rejeita `motivo_remocao = 'foobar'`, (vii) `char_length(motivo) <= 500` conta code points (500 emojis passa; 501 falha), (viii) o pareamento CHECK rejeita `removido_em IS NOT NULL AND motivo_remocao IS NULL`.

**Resultado Esperado**
> Integration tests contra Postgres real para 0062: 0 → ≥6 casos. Comportamento do índice parcial e dos CHECKs deixa de ser "confiança no que a regex viu" e passa a ser "o Postgres 17 concorda". Se um dia o `pg` driver mudar a semântica do `WHERE` em `ON CONFLICT` (aconteceu na história do PG), o CI pega.

**Métricas de sucesso**
- Migrations do delta validadas em CI contra Postgres real: 0/1 → 1/1
- Comportamento do índice parcial testado: não → sim
- `time-to-availability` da feature no cenário de defeito de DDL: 2 ciclos de deploy → 0

**Risco de não fazer**
> O único caminho pelo qual um bug no índice parcial aparece hoje é um 500 em produção no primeiro `retirarDoLote` após deploy — a analista clica, recebe 500, e o título fica sem retenção; na próxima rodada do cron ele volta ao lote automático, exatamente o que a feature existe para impedir.

**Dependências**: nenhuma; usa a mesma infraestrutura de CI que os 15 integration tests já rodam.

---

### [audit-trail-lote] Persistir a trilha de auditoria das transições de lote em tabela consultável

> Card mesclado: absorve `fault-tolerance-1` (F-fault-tolerance-2) e `security-2` (F-security-2). Mesma causa raiz vista de dois ângulos (Fault Tolerance como "trilha para reconciliação pós-incidente"; Security como "trilha para auditoria de compliance").

**QA**: Fault Tolerance + Security
**Tactic alvo**: Audit Trail / Repair State
**Esforço**: M (2-5d) — depende de quantas ações do domínio financeiro entram no escopo
**Findings**: F-fault-tolerance-2, F-security-2

**Problema**
> As transições do lote (`criarLote`, `atualizarContaPagadora`, `atualizarModalidadeItem`, `finalizarLote`/`reabrirLote`/`cancelarLote`) só deixam rastro em `process.stdout` via `LogService` — 22 serviços do backend replicam o mesmo padrão. O próprio delta desta feature mostra a alternativa melhor (tabela dedicada `titulo_retencao_formacao` com `marcado_por`/`removido_por`/`motivo_remocao` + timestamps), mas não a generaliza para as demais ações do mesmo agregado. Consequência: 5/6 transições continuam sem trilha em SQL, e a única fonte de verdade é a retenção de log do Render — sem índice por ator/lote/ação.

**Melhoria Proposta**
> Modelar uma tabela de auditoria dedicada `sispag_lote_evento` (ou reaproveitar o padrão de `titulo_retencao_formacao` para outras ações-chave do SISPAG) via `/feature-new`, cobrindo ao menos as transições de status do lote (`finalizarLote`, `cancelarLote`) e `atualizarContaPagadora`. Schema: `lote_id`, `acao`, `ator`, `criado_em`, `dados` (jsonb). Gravar dentro da MESMA transação de cada `withTransaction` do `LotePagamentoService` — o padrão já existe neste delta para `titulo_retencao_formacao`; a extensão é mecânica. Tactic alvo Bass: **Audit Trail** / **Repair State**.

**Resultado Esperado**
> Consulta SQL confiável de "quem fez o quê, quando" para as ações críticas do lote, sem depender de retenção/rotação de log de aplicação. Toda transição de lote de pagamento reconstruível por query, com retenção de auditoria alinhada à política de compliance financeiro do cliente. Métrica: 5/6 → 0/6 transições sem trilha persistida no agregado `LotePagamento`.

**Métricas de sucesso**
- Tabelas de audit trail dedicadas para transição de lote: 0 → 1
- Transições de lote reconstruíveis via SQL sem depender de log externo: 0% → 100%
- Serviços críticos com trilha "audit" só em stdout: 22 → alvo definido por `/feature-new` (não necessariamente 0, mas explícito)

**Risco de não fazer**
> Em auditoria de compliance financeiro (ex.: investigação de um lote cancelado indevidamente), a trilha pode já ter expirado no provedor de log — a ÚNICA ação deste delta com trilha garantida em tabela é a retenção, não as demais transições.

**Dependências**: nenhuma; pode ser feito independente deste delta.

---

### [integrability-1] Extrair um `SispagOrquestradorConexosClient` (ou reduzir o fan-out) antes da próxima feature em `SispagPainelService`

**QA**: Integrability
**Tactic alvo**: Use an Intermediary
**Esforço**: M (2-5d)
**Findings**: F-integrability-1

**Problema**
> `SispagPainelService` já tinha 13 colaboradores injetados antes deste delta, 4 deles clients Conexos diretos (`ConexosSispagClient`, `ConexosSispagWriteClient`, `ConexosSispagRetornoClient`, `ConexosBaseClient`); este delta adiciona o 14º (`RetencaoFormacaoRepository`), sem reduzir o fan-out de clients. Cada feature nova da Frente II tende a crescer este serviço por inércia — ele é hoje o ponto de maior raio de blast para uma troca de gateway bancário (Nexxera) ou upgrade de versão do Conexos.

**Melhoria Proposta**
> Aplicar **Use an Intermediary**: consolidar os 4 clients Conexos usados por `SispagPainelService` atrás de uma fachada única (`SispagLeituraConexosFacade` ou similar) que expõe só os métodos de domínio que o painel precisa (`obterContextoLotes`, `obterBorderos`, etc.), deixando o service com 1 dependência de leitura Conexos em vez de 4. Não é urgente hoje (não é P0/P1), mas deve ser feito **antes** de o primeiro `/feature-new` de Nexxera (SISPAG escopo II) adicionar mais colaboradores a este mesmo serviço.

**Resultado Esperado**
> `SispagPainelService`: 4 clients Conexos diretos → 1 fachada. Total de dependências injetadas: 14 → ≤11 (repositórios + fachada + infra). Métrica "dependências injetadas em SispagPainelService" volta a ficar defensável contra o alvo de ≤3 clients diretos.

**Métricas de sucesso**
- Clients Conexos injetados diretamente em `SispagPainelService`: 4 → 1
- Total de `@inject` no construtor: 14 → ≤11

**Risco de não fazer**
> A próxima feature de Nexxera (que o roadmap já anuncia para SISPAG) provavelmente adiciona mais 2-3 colaboradores a este mesmo service, tornando o refactor cada vez mais caro (mais código para migrar, mais testes para reescrever).

**Dependências**: nenhuma — pode ser feito isoladamente antes do próximo `/feature-new` que toque SISPAG/Nexxera.

---

### [integrability-2] Validar com Zod as respostas de `GET /sispag/painel` no frontend antes de expor os novos campos de retenção

**QA**: Integrability
**Tactic alvo**: Contract testing (boundary validation)
**Esforço**: S (≤1d) para os campos deste delta; M para o arquivo inteiro
**Findings**: F-integrability-2

**Problema**
> `src/frontend/lib/sispag.ts` tipa as respostas da API só com interfaces TS estáticas — nenhum `z.object` valida o payload em runtime em nenhum ponto do arquivo, antes ou depois deste delta. O delta adiciona 2 campos novos (`loteRascunho`, `retencaoFormacao`) a essa superfície já não validada, herdando o débito em vez de corrigi-lo.

**Melhoria Proposta**
> Aplicar **Contract testing / boundary validation** (regra do CLAUDE.md "validate external inputs... with Zod at boundaries", hoje não cumprida no frontend): introduzir um schema Zod para a resposta de `GET /sispag/painel` em `lib/sispag.ts`, começando pelos campos tocados por este delta (`loteRascunho`, `retencaoFormacao`) e expandindo por `/feature-tweak` conforme o resto do arquivo for tocado. Não bloqueia esta feature (débito pré-existente), mas deveria ser o primeiro item pego no próximo `/feature-tweak` que tocar `lib/sispag.ts`.

**Resultado Esperado**
> Drift de contrato backend→frontend (rename de campo, mudança de tipo) falha com erro explícito no fetch, não com `undefined` silencioso na tela. Cobertura Zod em `lib/sispag.ts`: 0% → cobre ao menos os campos novos deste delta.

**Métricas de sucesso**
- Campos `loteRascunho`/`retencaoFormacao` validados por Zod: 0 → 2
- Cobertura Zod em `lib/sispag.ts` (arquivo inteiro, meta de longo prazo): 0% → ≥80%

**Risco de não fazer**
> A próxima integração real de dinheiro por este mesmo painel (retorno Nexxera) herda o mesmo vácuo de validação, agora num payload que decide se um pagamento saiu ou não.

**Dependências**: nenhuma.

---

### [modifiability-1] Split de `LotePagamentoRepository.ts` em `LoteRepository` + `ItemLoteRepository`

**QA**: Modifiability
**Tactic alvo**: Split Module (Reduce Size of Module)
**Esforço**: M (~1–2d) — reescrita mecânica, testes já são por método, `PatternGuardian` valida
**Findings**: F-modifiability-1

**Problema**
> `LotePagamentoRepository.ts` está em 633 LOC / 26 métodos e mistura 4 razões de mudança (CRUD do lote raiz, CRUD dos itens, leitura para o painel, metadados da remessa nativa). O delta o empurrou pela primeira vez acima do teto de 600 LOC. Sem intervenção, as próximas features (Fatias 3–4) vão continuar acumulando ali.

**Melhoria Proposta**
> Tactic alvo: *Split Module + Increase Semantic Coherence*. Separar em (a) `LoteRepository` — só `lote_pagamento` (criar, transicionar, `lerEstadoParaEdicao`, `atualizarContaPagadora`, `tocarLote`, `marcarManual`, metadados da remessa nativa/data-débito); (b) `ItemLoteRepository` — só `lote_pagamento_item` (`adicionarItem`, `removerItem`, `atualizarModalidadeItem`, `contarItens`, `contarItensSemModalidade`, `listTitulosEmRascunho`). Manter `LotePagamentoService` como orquestrador do agregado — as duas classes vivem sob o mesmo aggregate root, o SQL só se separa. Feito num `/feature-tweak lote-pagamento "split repository"` ANTES da Fatia 3 encostar no arquivo.

**Resultado Esperado**
> Dois repositórios de ~300 LOC · ~13 métodos cada, ambos abaixo do teto. Fan-in de cada um permanece 4 (mesmos callers, dois handles em vez de um). Nenhuma mudança de comportamento — só shape.

**Métricas de sucesso**
- `LotePagamentoRepository.ts` LOC: 633 → ≤ 350
- Métodos por classe: 26 → ≤ 15 em cada
- Testes: 146 suites verdes se mantêm

**Risco de não fazer**
> Em 6 meses, no ritmo médio de crescimento observado (+50 LOC/feature nas últimas 3 features SISPAG que mexeram no arquivo), o repositório passa de 800 LOC e vira o próximo `RecebimentoNumerarioService.ts` (2415 LOC — o topo do repo hoje).

**Dependências**: nenhuma; não depende de outra Fatia.

---

### [modifiability-3] Extrair abas de `src/frontend/app/sispag/page.tsx` em componentes por responsabilidade

**QA**: Modifiability, Testability
**Tactic alvo**: Split Module + Increase Semantic Coherence
**Esforço**: L (~3–4d) — extração cuidadosa, muitos props para inferir; `DesignSystemReviewer` obrigatório porque mexe em UI
**Findings**: F-modifiability-4, F-testability-3

**Problema**
> `page.tsx` (1229 LOC) é kitchen-sink: gerencia estado da carteira, seleção múltipla, lotes candidatos, finalizados, ingestão, formação automática, retornos e agora retenção — tudo dentro de `SispagPanel`. Cada Fatia acrescenta 100–150 LOC no mesmo arquivo. Testes de UI ficam acoplados a estado global do painel — nenhum teste de componente existe para o arquivo.

**Melhoria Proposta**
> Tactic alvo: *Split Module + Increase Semantic Coherence*. Extrair 4–5 subcomponentes em `src/frontend/app/sispag/components/`: `TitulosTab` (a tabela de títulos a pagar + retenção + retirar), `LotesCandidatosTab` (montagem + finalizar), `LotesFinalizadosTab` (remessa + baixa), `RetornosTab` (fin052), `IngestaoBloco` (banner + botão + trilha). `SispagPanel` fica só com a orquestração de abas e o estado transversal (`painel`, `lotes`, `carregar`).

**Resultado Esperado**
> `page.tsx` ≤ 400 LOC (composição das abas + guard-rails + wiring). Cada aba um arquivo próprio, testável com estado isolado. Fatias futuras encostam só no arquivo da sua aba.

**Métricas de sucesso**
- `page.tsx`: 1229 → ≤ 400 LOC
- Nº de componentes top-level em `src/frontend/app/sispag/components/`: 6 → ~10
- Testes E2E SISPAG (49 suites hoje): mesma passagem

**Risco de não fazer**
> Cada nova Fatia adiciona 100+ LOC em `page.tsx`. Em 6 meses o arquivo passa de 1500 LOC e cada revisão de PR do painel passa a levar meia hora só para ler o diff.

**Dependências**: recomendado ANTES da Fatia 4 (Recebimentos-NDe já provou que kitchen-sink de painel escala mal — `recebimentos/page.tsx` está em 727 LOC e ainda assim é limpo por conta da separação em subcomponentes; SISPAG deveria imitar).

---

### [security-3] Alarmar falhas de autenticação/autorização acima de um limiar

**QA**: Security
**Tactic alvo**: Detect Intrusion
**Esforço**: M (2-5d) — depende de qual provedor de observabilidade está disponível no Render/Supabase atual (não medido neste ciclo)
**Findings**: F-security-3

**Problema**
> 401/403 em todo o backend (incluindo as 2 rotas novas deste delta) só geram `console.warn`, sem métrica agregada nem alarme. Um ataque de enumeração de `filCod`/`docCod`/`titCod` ou uma credencial comprometida só aparece em auditoria manual retroativa de log.

**Melhoria Proposta**
> Instrumentar `buildAuthMiddleware`/`requireRole` com uma métrica contável (ex.: incremento em `LogService` com `type: SECURITY_ALERT` mais um contador no provedor de observabilidade já em uso) e configurar um alarme de limiar (ex.: >20 401/403 por usuário/IP em 5min). Tactic Bass: **Detect Intrusion**.

**Resultado Esperado**
> Alarme de falha de autenticação/autorização presente e testado; MTTD de uma tentativa de força bruta ou credencial vazada cai de "descoberto em auditoria manual" para minutos.

**Métricas de sucesso**
- Alarmes de falha de autenticação configurados: 0 → 1

**Risco de não fazer**
> Compromisso de credencial de `admin` (que hoje pode agir em qualquer filial — ver security-1) passa despercebido até auditoria manual.

**Dependências**: nenhuma direta; maior valor se combinado com security-1 (o alarme também cobre tentativas de `FILIAL_NAO_AUTORIZADA` depois que o guard existir).

---

### [testability-1] Testar `RetirarDoLoteDialog.tsx` e `RetencaoBadge.tsx` (motivo trim, botão disabled, reset por chave, contador a11y)

**QA**: Testability
**Tactic alvo**: Specialized Interfaces / Executable Assertions (Control & Observe)
**Esforço**: S (≤1d — o padrão está no repo, é copiar `GerarRemessaDialog.test.tsx` e adaptar)
**Findings**: F-testability-1

**Problema**
> O dialog que a analista usa para digitar o motivo da retenção (`RetirarDoLoteDialog.tsx`, 133 LOC de estado React + regras de UI) não tem teste. As regras que não estão asseridas incluem: **reset do texto quando muda o título aberto** (`chave !== chaveAtual`), **botão desabilitado quando `texto.trim().length > 500`**, **trim antes de chamar `onConfirmar`**, **`aria-live` do contador**. A feature-irmã ADR-0049 (`GerarRemessaDialog.tsx`, mesma tela) tem 222 LOC de teste — este delta pulou o mesmo passo.

**Melhoria Proposta**
> Tactic alvo: *Specialized Interfaces* / *Executable Assertions*. Criar `src/frontend/app/sispag/components/RetirarDoLoteDialog.test.tsx` seguindo o padrão de `GerarRemessaDialog.test.tsx`: `render` + `userEvent`, casos: (i) reset ao mudar de título, (ii) contador atualiza e vira "danger" acima de 500, (iii) confirmar dispara `onConfirmar(texto.trim())`, (iv) botão desabilita quando `salvando`, (v) motivo whitespace-only vai como string vazia. Bônus (P3): teste separado ou junto para `RetencaoBadge.tsx` — o `aria-label` compõe as três linhas do `detalheRetencao(...)` (já testado em `retencao.test.ts`), portanto vale mais assegurar que o `TooltipTrigger` recebe `tabIndex={0}` (foco por teclado).

**Resultado Esperado**
> Componentes UI do delta com teste: 0/2 → 2/2 (dialog + badge). Cobertura do diretório `app/sispag/components/` do delta sobe de "helpers puros testados, componentes stateful não" para "todos os componentes novos com teste de comportamento". `RetirarDoLoteDialog.test.tsx` com 5 casos mínimos; `RetencaoBadge.test.tsx` com 2 (tooltip abre por foco de teclado, aria-label contém motivo).

**Métricas de sucesso**
- Arquivos `.test.tsx` no delta: 0 → 2
- Casos que exercitam reset-por-chave e limite 500 no dialog: 0 → ≥3

**Risco de não fazer**
> Uma regressão que apague o `setTexto('')` do reset por chave silenciosamente troca a autoria do motivo entre títulos; nenhum teste hoje falha.

**Dependências**: nenhuma (já tem `@testing-library/react` no `package.json`).

---

## P3 — Baixo

### [mttr-rollback-history] Registrar histórico de MTTR real de rollback para a próxima janela de 3 incidentes

> Card mesclado: absorve `availability-3` (F-availability-5) e `deployability-2` (F-deployability-3). Mesma métrica de instrumentação de runbook.

**QA**: Availability + Deployability
**Tactic alvo**: Monitor (deployment observability) / Rollback
**Esforço**: S (≤1d) — disciplina de preenchimento, sem código
**Findings**: F-availability-5, F-deployability-3

**Problema**
> `docs/runbooks/rollback.md:5` define meta ≤5 min "sem consultar ninguém", mas 0 rollbacks reais foram cronometrados. Sem baseline, defender no comitê que o delta é reversível em ≤5 min depende de aspiração, não de medida.

**Melhoria Proposta**
> Tactic alvo: **Monitor**. Adicionar ao runbook uma seção "Histórico" com 1 linha por rollback real: data, hora do deploy quebrado, hora do `/health` 200 confirmado, cumpriu ≤5 min?. Baixo custo — o próprio "Depois" do runbook já pede timeline pós-incidente.

**Resultado Esperado**
> Após os próximos 3 rollbacks, a meta de ≤5min vira métrica observada (ex.: "3/3 rollbacks em ≤5min" ou "2/3, o outro levou 8min por causa do rebuild do Render") em vez de aspiração.

**Métricas de sucesso**
- Rollbacks com tempo real registrado: 0 → ≥3 (janela dos próximos 6 meses)

**Risco de não fazer**
> Nenhum risco técnico direto; o custo é seguir defendendo "≤5 min" como aspiração em vez de fato.

**Dependências**: nenhuma.

---

### [fault-tolerance-2] Registrar teste de fault injection para falha de I/O do Postgres durante `withTransaction`

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Self-Test
**Esforço**: M (2-5d) — requer infraestrutura de teste com Postgres real
**Findings**: F-fault-tolerance-1 (positivo, este card fortalece a garantia)

**Problema**
> A garantia de atomicidade do `retirarDoLote` é validada com mocks (erro síncrono do repositório), não com uma falha real de rede/I/O durante o `COMMIT`. O comportamento sob partição de rede do Postgres não é medível localmente hoje.

**Melhoria Proposta**
> Cross-QA com Testability: adicionar um teste de integração (ambiente com Postgres real/testcontainer) que mate a conexão no meio do `COMMIT` de `withTransaction` e confirme que a transação fica de fato revertida (nenhum item removido, nenhuma retenção parcial). Tactic alvo: **Detect Faults — Self-Test / Condition Monitoring** aplicado ao pipeline de CI.

**Resultado Esperado**
> Confiança empírica (não só lógica) de que o `ROLLBACK` do driver `pg` cobre falha de I/O, não só exceção de aplicação. Métrica: 0 → 1 teste de fault injection para o caminho `retirarDoLote`.

**Métricas de sucesso**
- Testes de fault injection de I/O no `withTransaction`: 0 → ≥1

**Risco de não fazer**
> Baixo — o driver `pg` e o padrão `BEGIN/COMMIT/ROLLBACK` são bem estabelecidos; risco residual é teórico.

**Dependências**: infraestrutura de teste com Postgres (testcontainers ou similar) — hoje ausente no repo. Sinergia com `migration-0062-integration`: ambos precisam de Postgres real em CI.

---

### [fault-tolerance-3] Reduzir a janela de duplo-clique no frontend com desabilitação síncrona

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Condition Monitoring (camada UI)
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3

**Problema**
> `salvandoRetencao`/`busy` são setados dentro da função assíncrona, deixando uma janela de um tick de render em que um duplo-clique rápido pode disparar duas requisições. O backend já neutraliza o efeito (índice único parcial + `FOR UPDATE`), mas o usuário pode ver um toast de erro espúrio.

**Melhoria Proposta**
> Usar um ref síncrono (`useRef<boolean>`) checado e setado antes do primeiro `await`, ou desabilitar o botão via `event.currentTarget.disabled = true` no handler de clique, antes do `setState` assíncrono. Tactic alvo: **Detect Faults — Condition Monitoring** na camada de UI.

**Resultado Esperado**
> Zero requisições duplicadas originadas por duplo-clique, mesmo antes do primeiro re-render. Métrica: janela de corrida no clique — presente → eliminada.

**Métricas de sucesso**
- Requisições duplicadas por duplo-clique em teste manual: possível (teórico) → eliminado

**Risco de não fazer**
> Mínimo — o servidor já garante integridade; o único custo é UX (toast de erro ocasional).

**Dependências**: nenhuma.

---

### [modifiability-2] Centralizar o teto do motivo da retenção numa constante compartilhada

**QA**: Modifiability
**Tactic alvo**: Defer Binding (Configuration Externalization)
**Esforço**: S (≤ 1h)
**Findings**: F-modifiability-3

**Problema**
> O número `500` (teto do campo `motivo`) aparece em 3 sítios paralelos: CHECK da migration 0062, `.max(500)` do Zod no route, `MOTIVO_RETENCAO_MAX` no frontend. Mudar o teto exige 3 edições coordenadas; ficar 2/3 em fase é bug silencioso.

**Melhoria Proposta**
> Tactic alvo: *Defer Binding*. Exportar `MOTIVO_RETENCAO_MAX = 500` de `src/backend/domain/interface/sispag/SispagInterface.ts` e importar no `routes/sispag.ts` (Zod). O frontend continua com seu próprio `MOTIVO_RETENCAO_MAX` (o monorepo não compartilha código entre `src/backend` e `src/frontend`), MAS os dois passam a citar a mesma origem por comentário `/** deve casar com SispagInterface.MOTIVO_RETENCAO_MAX (backend) e o CHECK da migration 0062 */` — pelo menos torna a intenção auditável. O CHECK do Postgres permanece como fonte AUTORITATIVA (é a última linha de defesa), mas passa a citar o mesmo comentário.

**Resultado Esperado**
> Mudar o teto → 1 constante no backend + 1 constante no frontend + 1 migration aditiva. 3 arquivos hoje → 3 arquivos amanhã, mas com dependência declarada em vez de coincidência.

**Métricas de sucesso**
- Sítios de escrita coordenada: 3 → 3 (mas com fonte declarada, não mágico)
- Testes: 1 novo teste em `retencaoFormacao.test.ts` afirmando que o CHECK do SQL e a constante do backend têm o mesmo valor (regex sobre o SQL)

**Risco de não fazer**
> Baixo hoje (o valor é estável). Custo do card também é baixo — vale fazer junto com a próxima mudança no dialog.

**Dependências**: nenhuma.

---

### [performance-2] Adicionar teto defensivo em `RetencaoFormacaoRepository.listAtivas()`

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S (≤1d)
**Findings**: F-performance-2

**Problema**
> A query de retenções ativas não tem `LIMIT`, ao contrário da convenção já usada no mesmo serviço (`TITULOS_CAP=5000` para a carteira). Hoje é inofensivo (índice parcial mantém o conjunto pequeno), mas é uma exceção silenciosa à convenção do arquivo.

**Melhoria Proposta**
> Tactic alvo: **Reduce Overhead**. Adicionar `ORDER BY marcado_em DESC LIMIT $N` (ex. 10.000) em `listAtivas`, com um comentário explicando que é guard-rail, não limite de trabalho — mesmo padrão do comentário de `TITULOS_CAP`.

**Resultado Esperado**
> `RetencaoFormacaoRepository.listAtivas()` ganha teto explícito, coerente com o restante do arquivo; nenhuma mudança de comportamento observável hoje (volume atual bem abaixo do teto).

**Métricas de sucesso**
- `selectMany` sem `LIMIT` no arquivo: 1 → 0

**Risco de não fazer**
> Baixo — só materializa se a semântica de "retenção ativa" mudar para permitir múltiplas por título sem revisar este ponto.

**Dependências**: nenhuma.

---

### [performance-3] Revisar em conjunto a política de purge das tabelas de decisão local (`titulo_retencao_formacao`, `cliente_filtro`, `permuta_excecao_manual`)

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: M (2–5d, cobre as 3 tabelas)
**Findings**: F-performance-3

**Problema**
> `titulo_retencao_formacao` soma-se a um padrão já existente de tabelas soft-delete sem purge. Isoladamente inofensivo (o índice parcial isola a leitura quente do histórico), mas o time já reconhece a dívida nas tabelas irmãs — não faz sentido resolver uma tabela de cada vez sem uma política comum.

**Melhoria Proposta**
> Tactic alvo: **Reduce Overhead**. Não é ação isolada desta feature — recomenda-se um item de backlog único cobrindo as 3 tabelas (`cliente_filtro`, `permuta_excecao_manual`, `titulo_retencao_formacao`): decidir horizonte de retenção do histórico (`removido_em IS NOT NULL`) e, se necessário, um job de arquivamento.

**Resultado Esperado**
> Política de retenção documentada (mesmo que a decisão seja "não arquivar, monitorar tamanho"); se decidir arquivar, tamanho físico das 3 tabelas com teto conhecido em vez de crescimento indefinido.

**Métricas de sucesso**
- Política de purge documentada: ausente → existente (ADR ou nota em `ontology/`)

**Risco de não fazer**
> Baixo/médio em horizonte de anos — custo de armazenamento e `VACUUM`, não latência de leitura (a leitura quente já está isolada pelo índice parcial).

**Dependências**: decisão de produto/dados sobre horizonte de retenção — não é só técnica.

---

### [testability-3] Anexar cobertura % por diretório do delta ao próximo Regis-Review

**QA**: Testability
**Tactic alvo**: Executable Assertions (Observe System State)
**Esforço**: XS (<1h — só rodar e recortar)
**Findings**: F-testability-4

**Problema**
> `_shared-metrics.md:52` diz "Cobertura (%) — não medida nesta rodada". O CI **já mede** (`npm test -- --coverage` em `.github/workflows/ci.yml:27`), e o `coverageThreshold` do backend já impõe piso de 88 lines / 60 branches em `domain/service/`. Sem anexar o número, nenhum revisor consegue afirmar se `LotePagamentoService.ts` está em 95% (esperado dado o ratio 1,38 de teste-por-fonte) ou se um ramo escapou.

**Melhoria Proposta**
> Tactic alvo: *Executable Assertions*. No próximo `/regis-review` pós-rebase, rodar `cd src/backend && npm test -- --coverage --silent 2>&1 | tail -50` e `cd src/frontend && npm test -- --coverage --silent --watchAll=false 2>&1 | tail -50`, recortar as linhas de `domain/service/sispag/`, `domain/repository/sispag/`, `routes/`, `app/sispag/components/` e `lib/sispag.ts`, e anexar em `_shared-metrics.md` na tabela de gates. Bônus: subir o `coverageThreshold` do `domain/service/` para o **medido menos 2 pontos** (ratchet), aplicando o padrão que o frontend `jest.config.js` já documenta.

**Resultado Esperado**
> Cobertura % por diretório do delta anexada nas próximas 3 rodadas de Regis-Review. Ratchet do `coverageThreshold` para `domain/service/` reasentado ~2 pontos abaixo do medido — evita a decoração que o próprio comentário do frontend admite.

**Métricas de sucesso**
- Rodadas de Regis-Review com cobertura % anexada: 0 → ≥3 nas próximas features
- `coverageThreshold` do `domain/service/` ratchetado após esta feature: não → sim

**Risco de não fazer**
> Nenhum imediato; o gate binário CI já protege. O custo é só perder a chance de ver o número real e travar regressão pequena antes que ela vire grande.

**Dependências**: nenhuma.
