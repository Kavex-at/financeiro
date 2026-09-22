---
type: regis-review-kanban
run_id: 2026-09-22-2020-sispag-data-pagamento
total: 22
counts: { p0: 0, p1: 2, p2: 10, p3: 10 }
---

# Kanban — financeiro — 2026-09-22-2020-sispag-data-pagamento

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Escopo: delta da branch `fix/sispag-data-pagamento` (ADR-0049).
> Nota de deduplicação: `[integrability-2]` foi absorvido por `[modifiability-1]` — ver REPORT.md §7.

---

## P0 — Crítico

_Nenhum card P0 neste delta._

---

## P1 — Alto

### [testability-2] Adicionar teste de integração para o round-trip de `data_debito` (`to_char`/`::date`)

**QA**: Testability
**Tactic alvo**: Abstract Data Sources / Sandbox
**Esforço**: M (2-5d) — inclui provisionar a infra de Postgres de teste, que não existe hoje
**Findings**: F-testability-2

**Problema**
> `setDataDebito` e a leitura via `to_char(data_debito, 'YYYY-MM-DD')` só são verificados por asserção de string SQL contra um mock — nunca executados contra um Postgres real. Essa é exatamente a classe de bug (encoding de data/timezone) que esta feature existe para corrigir; o repositório inteiro (não só este método) não tem nenhum teste de integração, e o repo não tem infraestrutura de Postgres de teste.

**Melhoria Proposta**
> Provisionar um `docker-compose.test.yml` (ou script `scripts/test-pg.sh`) com um Postgres efêmero, e criar `describe('integration: LotePagamentoRepository', ...)` cobrindo no mínimo: `setDataDebito` seguido de `getLoteComItens`/`listLotes` devolve a MESMA string civil (`'YYYY-MM-DD'`) independentemente do timezone da sessão; `data_debito NULL` não aparece na chave do objeto. Tactic: Abstract Data Sources (fechar o ciclo — abstrair para unidade, mas também verificar a abstração pelo menos uma vez).

**Resultado Esperado**
> Testes de integração em `domain/repository/**`: 0 → ≥ 1 arquivo, ≥ 3 casos cobrindo o round-trip de `data_debito`. Infra de Postgres de teste: ausente → presente (reutilizável pelos próximos repositórios com SQL sensível a timezone).

**Métricas de sucesso**
- Testes de integração no repositório: 0 → ≥ 3
- Infra de Postgres de teste (`docker-compose*test*` ou equivalente): ausente → presente

**Risco de não fazer**
> A próxima migration ou próximo `ALTER` numa coluna `DATE`/`TIMESTAMPTZ` do SISPAG repete o mesmo bug de encoding que motivou o ADR-0049, e só um teste mockado (que nunca falharia) protege contra isso.

**Dependências**: decisão de onde a infra de Postgres de teste roda em CI (serviço no `.github/workflows/ci.yml` vs. `testcontainers`) — fica para o Yuri decidir o approach, não é escopo desta feature isolada.

---

### [modifiability-1] Extrair um `RemessaWriteOrchestrator` (absorve integrability-2: adapter fino para as chamadas em série do fin015)

**QA**: Modifiability, Integrability
**Tactic alvo**: Split Module / Refactor / Use an Intermediary
**Esforço**: L (1-2 semanas — função crítica, exige regressão cuidadosa)
**Findings**: F-modifiability-1, F-modifiability-2, F-integrability-2

**Problema**
> `RemessaService.gerarRemessaSerializado` tem complexidade cognitiva 91 (teto do lint: 15) e 1111 LOC no arquivo todo. Este delta seguiu o precedente certo ao criar `DebitDateService` para a regra nova, mas ainda assim inseriu 2 novos pontos de decisão dentro da função monolítica em vez de chamá-los de um orquestrador mais fino. Em paralelo, `RemessaService` concentra 10 colaboradores injetados (3 deles Clients: `ConexosSispagWriteClient`, `ConexosSispagClient`, `PostgreeDatabaseClient`), acima do limite heurístico de 2 Clients diretos por service — uma sequência síncrona de 6+ chamadas ao ERP sem uma segunda camada de anti-corrupção.

**Melhoria Proposta**
> Aplicar **Split Module**: quebrar `gerarRemessaSerializado` em passos nomeados e testáveis isoladamente (ex.: `resolverContaPagadora`, `garantirLoteNativo`, `sincronizarOuCriar`, já parcialmente esboçados como blocos comentados no código atual) — cada um como método privado curto ou service colaborador. Extrair a sequência de escrita fin015 (`criarLote` → `importarTitulos` → `finalizarLote` → `sugerirRemessa` → `gerarRemessa` → `listarArquivosRemessa`) para um objeto de orquestração dedicado (`RemessaFin015Orchestrator` ou similar) que recebe só `ConexosSispagWriteClient` + o ledger, deixando `RemessaService` como fachada que resolve data/conta pagadora e delega a escrita. Tactics **Refactor** e **Use an Intermediary**, apoiado pelos 144+321 testes de `RemessaService.test.ts` já existentes como rede de segurança.

**Resultado Esperado**
> Complexidade cognitiva da função principal: 91 → ≤ 30 na primeira passada (alvo final ≤ 15). LOC de `RemessaService.ts`: 1111 → ≤ 700. Colaboradores injetados: 10 → ≤ 6; Clients injetados diretamente: 3 → ≤ 1 (via o novo orquestrador).

**Métricas de sucesso**
- Complexidade cognitiva de `gerarRemessaSerializado`: 91 → ≤ 15
- LOC de `RemessaService.ts`: 1111 → ≤ 700
- Colaboradores injetados em `RemessaService`: 10 → ≤ 6
- Clients injetados diretamente: 3 → ≤ 1

**Risco de não fazer**
> Cada `/feature-tweak` de SISPAG nos próximos 6 meses (já são 5 commits recentes só para a data de débito, e há 3 perguntas P1 já abertas sobre esta mesma regra) volta a tocar esta função; a probabilidade de uma regressão silenciosa no fluxo que move dinheiro real cresce a cada adição não isolada. A próxima mudança no gateway bancário (Nexxera) ou versão do fin015 tem custo de revisão crescente sem essa extração.

**Dependências**: nenhuma decisão de produto — é refactor puro; recomenda-se fazer depois de estabilizar a ADR-0049 em produção para não competir por atenção de QA manual.

---

## P2 — Médio

### [availability-2] Logar/instrumentar `data_debito` órfão (persistido sem `native_flp_cod`)

**QA**: Availability
**Tactic alvo**: Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-availability-2

**Problema**
> `setDataDebito` grava a data no Postgres antes de chamar `criarLote` no fin015 (write-ahead correto), mas se o processo cair entre as duas chamadas, o valor fica órfão — sem `native_flp_cod` — e é silenciosamente recalculado na próxima tentativa, sem nenhum log que sinalize a inconsistência (`RemessaService.ts:449-462,1049-1057`).

**Melhoria Proposta**
> Em `resolverDataDebito`, quando `flpCodExistente` é `undefined` mas `lote.dataDebito` já está preenchido (o sinal do órfão), emitir `logService.warn` com `loteId`/`dataDebito anterior`/`dataDebito recalculada` antes de seguir. Tactic alvo: Condition Monitoring. Tocar `RemessaService.ts` (método `resolverDataDebito`).

**Resultado Esperado**
> Toda ocorrência de `data_debito` órfã fica visível no log estruturado (grep-ável, e instrumentável em dashboard quando a infra existir), em vez de silenciosa. Métrica: cobertura de log do cenário órfão 0% → 100%.

**Métricas de sucesso**
- Cenário "órfão detectado e logado": 0% → 100% dos casos em que `flpCodExistente === undefined && lote.dataDebito !== undefined`

**Risco de não fazer**
> Uma investigação futura de incidente lendo `lote_pagamento.data_debito` direto no banco pode concluir erroneamente que essa foi a data efetivamente usada no ERP, quando na verdade foi substituída numa tentativa seguinte.

**Dependências**: nenhuma.

---

### [deployability-1] Adicionar cohort de validação antes de liberar `dataDebito` escolhida pela analista para todas as filiais

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤1d) — reusa o mecanismo `dryRunOverride` já existente
**Findings**: F-deployability-1

**Problema**
> O deploy da escolha de data de débito (ADR-0049/I8) vai para 100% do tráfego de remessa SISPAG assim que o Render termina o health check (`autoDeploy: true`, sem canary — F-deployability-1). `BankingCalendar` já documenta um gap conhecido (feriados municipais/estaduais fora de escopo), então um erro de cálculo afeta a primeira remessa real pós-deploy, não uma amostra controlada.

**Melhoria Proposta**
> Tactic alvo: **Scale Rollouts**. Como o Render Starter não tem canary nativo, simular via aplicação: introduzir uma flag temporária (`SISPAG_DEBIT_DATE_MANUAL_REVIEW`, no padrão `sync: false` já usado em `render.yaml`) que, quando ligada, força `dryRunOverride: true` no `RemessaService.gerarRemessa` mesmo com `SISPAG_LIVE_WRITE_ENABLED=true` — permitindo rodar em produção contra dados reais sem escrever, por N remessas de validação, antes de liberar a escrita de verdade. Remover a flag depois do go-live.

**Resultado Esperado**
> A primeira exposição da lógica de calendário bancário a dados reais de produção acontece em modo simulado (dry-run forçado), não em escrita real. Métrica: 0 → N remessas de validação geradas em dry-run antes da primeira escrita real pós-deploy desta feature.

**Métricas de sucesso**
- Remessas em dry-run de validação antes da 1ª escrita real: 0 → ≥3 (cobrindo pelo menos uma janela com fim de semana/feriado)
- Incidentes de data de débito incorreta pós-go-live: sem baseline (feature nova) → 0

**Risco de não fazer**
> Se `BankingCalendar` tiver um erro sutil (ex.: feriado estadual não coberto, calculado incorretamente como dia útil), a primeira remessa real já sai com a data errada, exigindo cancelamento manual do lote nativo no fin015 — documentado como "a única falha irrecuperável do fluxo" se a marca d'água se perder.

**Dependências**: nenhuma — usa infraestrutura de flag já existente no `render.yaml`.

---

### [integrability-1] Validar a resposta de `/remessa/janela` e `/remessa` com Zod no frontend

**QA**: Integrability
**Tactic alvo**: Adhere to Standards / Contract testing
**Esforço**: S (≤1d)
**Findings**: F-integrability-1

**Problema**
> `lib/sispag.ts` consome `JanelaDataDebito` e `GerarRemessaResult` com um cast `as T` sem checagem de forma em runtime (`src/frontend/lib/sispag.ts:503`); o tipo é uma cópia manual do backend (`SispagInterface.ts:291-312`), então drift entre as duas pontas só aparece como comportamento errado na tela, não como erro explícito.

**Melhoria Proposta**
> Adicionar um schema Zod espelhando `JanelaDataDebito`/`GerarRemessaResult` em `lib/sispag.ts` (ou um módulo `lib/schemas/sispag.ts`) e trocar o `body as T` de `sispagRequest` por `schema.parse(body)` nos dois endpoints tocados pelo delta (`fetchJanelaDataDebito`, `gerarRemessa`). Tactic alvo: **Adhere to Standards** / **Contract testing**.

**Resultado Esperado**
> Resposta fora de forma lança erro explícito e logado (`Error: shape inválido de JanelaDataDebito`) em vez de silenciosamente quebrar `explicarJanelaVazia`/`erroDaData`. Métrica: 0 → 2 endpoints com Zod no frontend do módulo SISPAG.

**Métricas de sucesso**
- Arquivos de frontend com Zod nos boundaries SISPAG: 0 → ≥2 (`fetchJanelaDataDebito`, `gerarRemessa`)

**Risco de não fazer**
> Um campo renomeado no backend (ex.: `vazia.motivo` ganhar um novo valor) muda o comportamento da tela sem qualquer sinal de erro visível ao time.

**Dependências**: nenhuma — isolado ao arquivo `lib/sispag.ts`.

---

### [modifiability-3] Gerar (ou compartilhar) os tipos/enums do contrato SISPAG entre backend e frontend

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies / Abstract Common Services
**Esforço**: S (≤1 dia) para a correção pontual do enum; M para explorar geração automática
**Findings**: F-modifiability-4

**Problema**
> `MOTIVO_FORA_DA_JANELA` (backend, 6 valores, `as const`) e `JanelaDataDebito`/`DebitDateOutsideWindowError` (frontend, união literal parcial + `string` solto) são mantidos manualmente em sincronia. Um novo motivo no backend não quebra o build do frontend — só produz uma tela sem tradução para o caso novo.

**Melhoria Proposta**
> Não é escopo reescrever a stack para monorepo com tipos compartilhados agora (`--quick`, fora do raio deste delta), mas registrar a lacuna como débito e, na próxima vez que `MOTIVO_FORA_DA_JANELA` mudar, propagar o enum completo para `src/frontend/lib/sispag.ts` (união literal com os 6 valores, não só 3) e trocar `motivo?: string` de `DebitDateOutsideWindowError.details` por uma união de fato. Avaliar, a médio prazo, gerar os tipos de contrato SISPAG a partir de um schema Zod único exportável para o frontend via build step.

**Resultado Esperado**
> `DebitDateOutsideWindowError.details.motivo` deixa de ser `string` solto e passa a ser a união dos 6 valores; qualquer novo motivo adicionado ao backend gera erro de compilação no frontend até ser tratado.

**Métricas de sucesso**
- Nº de fontes de verdade para `MOTIVO_FORA_DA_JANELA`: 2 → 1 (ou 2 com verificação estrutural automatizada)

**Risco de não fazer**
> A próxima resposta aos gaps P1-1/P1-2 (`ontology/_inbox/sispag-data-pagamento-gap.md`) provavelmente adiciona um motivo novo; sem o link de tipos, é fácil esquecer o lado frontend e a analista ver uma mensagem genérica no exato momento em que a regra de dinheiro real mais precisa ser clara.

**Dependências**: nenhuma.

---

### [testability-1] Cobrir a integração LoteCard → GerarRemessaDialog → toast de erro

**QA**: Testability
**Tactic alvo**: Specialized Interfaces / Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> `LoteCard.tsx` ganhou o estado `gerandoRemessa` e o gatilho do diálogo, e `page.tsx` ganhou dois `else if` novos (`DebitDateOutsideWindowError`, `DebitDateFrozenError`) mapeando erro para toast — nenhum dos dois arquivos tem teste. `GerarRemessaDialog.test.tsx` só testa o diálogo com `acao` mockada, não a integração real.

**Melhoria Proposta**
> Criar `LoteCard.test.tsx` cobrindo pelo menos: clicar em "Gerar remessa (.REM)" abre o diálogo; `onOpenChange(false)` fecha; sucesso dispara o toast certo. Adicionar (ou estender um teste de `page.tsx` já existente no padrão dos outros 4 `page.test.tsx` do app) um caso por `instanceof` novo em `page.tsx`, renderizando o componente com `gerarRemessa` mockado para rejeitar com cada erro e asserindo o texto do toast (tactic: Executable Assertions, camada de apresentação).

**Resultado Esperado**
> Cobertura de arquivos de lógica de frontend do delta: 50% (2/4) → 100% (4/4). `LoteCard.tsx` e `sispag/page.tsx`: 0 casos de teste diretos → ≥ 3 e ≥ 2 respectivamente.

**Métricas de sucesso**
- Arquivos de lógica de frontend com teste dedicado no módulo sispag: 2/4 → 4/4
- Casos de teste cobrindo `DebitDateOutsideWindowError`/`DebitDateFrozenError` na camada de apresentação: 0 → ≥ 2

**Risco de não fazer**
> Uma regressão no mapeamento de erro→toast (ex.: mensagem genérica no lugar da instrução de cancelar o flp no fin015) só aparece em produção, quando a analista já não sabe o que fazer.

**Dependências**: nenhuma.

---

### [testability-3] Quebrar `RemessaService.test.ts` por responsabilidade

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S (≤1d) — é extração de arquivo, não reescrita de caso
**Findings**: F-testability-3

**Problema**
> `RemessaService.test.ts` chegou a 1452 LOC — maior arquivo de teste do backend — misturando gate de estado, idempotência/órfãos, retry, DDA, integridade do `.REM` e agora data de débito no mesmo arquivo com um `make()` compartilhado. `RemessaService.ts` já era, antes deste delta, o método de maior complexidade cognitiva do lint.

**Melhoria Proposta**
> Extrair o describe `data de débito (I8, ADR-0049)` (≈260 linhas) para `RemessaService.dataDebito.test.ts`, reaproveitando um `make()` local mais enxuto. Avaliar extrair também DDA e integridade do `.REM` para arquivos próprios. Tactic: Limit Structural Complexity — arquivo de teste espelha a decomposição que já foi feita no lado da produção.

**Resultado Esperado**
> `RemessaService.test.ts`: 1452 LOC → ≤ 900 LOC, com o restante distribuído em 1-2 arquivos-satélite por responsabilidade, sem perder nenhum dos ~20 casos de `data de débito`.

**Métricas de sucesso**
- LOC de `RemessaService.test.ts`: 1452 → ≤ 900
- Casos de teste preservados: 100% (nenhuma asserção perdida na extração)

**Risco de não fazer**
> Cada `/feature-tweak` futuro em SISPAG paga o custo de navegar um arquivo de 1450+ linhas para entender o blast radius de uma mudança — o "cost-multiplier" que a testabilidade deveria reduzir cresce a cada feature.

**Dependências**: nenhuma; pode ser feito em qualquer momento após este merge.

---

### [fault-tolerance-1] Estender a checagem de órfão (marca d'água) para retomadas a partir de `status='error'` sem `nativeFlpCod`

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile / Condition Monitoring
**Esforço**: M (2-5d)
**Findings**: F-fault-tolerance-1

**Problema**
> Uma queda de rede durante `write.criarLote` (escrita única, não-idempotente) grava `status='error'` no ledger via `RemessaExecucaoRepository.fail()`. Como a busca por lote órfão (`adotarPorMarcaDagua`) só roda dentro de `sincronizarComErp`, gated por `anterior.status === 'reconciling'` (`RemessaService.ts:238`), uma retomada a partir de `error` sem `nativeFlpCod` chama `criarLote` de novo sem nunca checar se a tentativa anterior já criou o lote no ERP — comprovado por `RemessaService.test.ts:796-801`, que hoje EXIGE `criarLote` chamado 1× sem checagem prévia.

**Melhoria Proposta**
> Unificar o ponto de entrada: sempre que `flpCodExistente === undefined` E o ledger anterior tiver `request_payload.marcaFlpCods` gravado (independente do `status` ser `reconciling` ou `error`), rodar a mesma lógica de `adotarPorMarcaDagua` antes de chamar `write.criarLote`. Em paralelo, estender a detecção (`RemessaExecucaoRepository`) com uma query irmã de `listReconcilingParadas` para `status='error' AND native_flp_cod IS NULL AND request_payload->>'marcaFlpCods' IS NOT NULL`, surfaced no mesmo painel/canal do reaper `reconciling`. Tactic Bass: **Reconcile** + **Condition Monitoring**.

**Resultado Esperado**
> 100% das retomadas sem `nativeFlpCod` passam por checagem de órfão antes de criar um lote novo (hoje: só as que estão em `reconciling`, ~50% dos casos possíveis por desenho atual). `RemessaService.test.ts:796-801` passa a asserir que `listarLotesNativos` é chamado antes de `criarLote` mesmo com `status='error'`.

**Métricas de sucesso**
- Cobertura de checagem de órfão por status do ledger: hoje `reconciling` apenas → alvo `reconciling` + `error` com marca gravada
- Alertas de lote fantasma no painel operacional: hoje 0 (só aparecem via SQL manual) → alvo: mesmo canal do reaper `reconciling`

**Risco de não fazer**
> Acúmulo silencioso de lotes vazios no fin015 a cada timeout de rede durante `criarLote`, sem qualquer sinal no sistema; com a `data_debito` agora escolhível pela analista, cada lote fantasma carrega uma data que ninguém mais consegue rastrear até o lote correto.

**Dependências**: nenhuma.

---

### [security-1] Provisionar um segundo papel RBAC real (`viewer`/`analista`) antes do próximo cliente

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: M (2–5d)
**Findings**: F-security-1

**Problema**
> Todo usuário nasce com `role='admin'` no Postgres (`app_user.role DEFAULT 'admin'`), então o `requireRole('admin')` que já guarda `POST /sispag/lotes/:id/remessa` — inclusive o novo parâmetro `dataDebito` desta feature — não separa ninguém em produção hoje. O próprio time documentou isso no comentário de teste de `routes/sispag.test.ts:42-44`.

**Melhoria Proposta**
> Definir e provisionar pelo menos um segundo papel (`viewer`/`analista`) com escrita financeira restrita, alinhado ao requisito cross-cutting de RBAC da proposta (Authorize Actors, Bass). Não é escopo desta feature reescrever o modelo de auth — é um card de trilha própria que a `dataDebito` deixa mais urgente, porque aumenta o número de decisões de negócio (qual data) que um "admin" universal pode tomar sozinho.

**Resultado Esperado**
> `requireRole('admin')` volta a separar atores de fato: papéis efetivos em produção 1 → ≥2, com pelo menos uma rota de escrita SISPAG comprovadamente recusando um usuário `viewer`.

**Métricas de sucesso**
- Papéis efetivos em produção: 1 → ≥2
- Teste de integração que prova `role='viewer'` recebendo 403 em `POST /sispag/lotes/:id/remessa`: ausente → presente

**Risco de não fazer**
> Em 6 meses, com mais clientes e mais analistas na mesma conta, qualquer credencial vazada ou reaproveitada dentro da empresa move dinheiro sem que o RBAC ofereça qualquer atrito — o controle existe só no papel.

**Dependências**: nenhuma bloqueante; pode andar em paralelo a outras features SISPAG.

---

### [modifiability-2] Remediar o layer-skip em `routes/sispag.ts` (rota → repository/client direto)

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies
**Esforço**: M (2-5 dias)
**Findings**: F-modifiability-3

**Problema**
> `routes/sispag.ts` importa `ConexosSispagClient` e 3 repositories diretamente, contrariando a cadeia `Lambda/route → Service → Repository → Client` que o CLAUDE.md declara sem exceções e que o `PatternGuardian` deveria bloquear. Não foi introduzido por este delta, mas o arquivo foi tocado (+43 linhas) sem correção.

**Melhoria Proposta**
> Aplicar **Restrict Dependencies**: mover as chamadas de `ConciliacaoExecucaoRepository`, `PagamentoIngestaoRunRepository`, `RemessaExecucaoRepository` e `ConexosSispagClient` para dentro do service correspondente (provavelmente `ConciliacaoRetornoService`/`SispagPainelService`), deixando a rota falar só com services. Abrir como `/feature-tweak` dedicado para não misturar com regra de negócio nova.

**Resultado Esperado**
> Imports de `domain/repository/*`/`domain/client/*` em `routes/sispag.ts`: 4 → 0. `PatternGuardian` passa a ter um exemplo limpo para comparar contra novos endpoints.

**Métricas de sucesso**
- Imports de repository/client em `routes/sispag.ts`: 4 → 0

**Risco de não fazer**
> Cada novo endpoint em `routes/sispag.ts` (e o arquivo já tem 609 linhas) copia o padrão de pular a camada Service, ampliando o acoplamento HTTP↔persistência.

**Dependências**: nenhuma.

---

## P3 — Baixo

### [availability-3] Uniformizar rate limiting nas leituras sensíveis do fluxo de remessa

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: S (≤1d)
**Findings**: F-availability-3

**Problema**
> `GET /sispag/lotes/:id/remessa/janela` (rota nova desta feature) não usa `heavyRouteLimiter`, diferente da rota irmã de escrita (`POST .../remessa`) e do precedente já registrado no mesmo arquivo para `/contas-pagadoras` ("leitura de conta corrente não é menos sensível que escrita" — `routes/sispag.ts:395-400`).

**Melhoria Proposta**
> Aplicar `heavyRouteLimiter` (ou um limiter mais leve dedicado a leituras) na rota `/lotes/:id/remessa/janela`, mantendo a ausência de `requireRole('admin')` se a leitura for de fato equivalente às demais leituras de lote (decisão a confirmar com o time, não assumida aqui). Tactic alvo: Exception Prevention. Tocar `routes/sispag.ts`.

**Resultado Esperado**
> Rotas GET novas do fluxo de remessa com limiter: 0/1 → 1/1, alinhado ao padrão do arquivo.

**Métricas de sucesso**
- Rotas GET novas com rate limiter: 0/1 → 1/1

**Risco de não fazer**
> Baixo isoladamente; acumula inconsistência de política entre rotas do mesmo arquivo, dificultando auditoria futura.

**Dependências**: nenhuma. (Recomenda-se implementar junto de `[security-2]` — mesmo bloco de código, ver REPORT.md CC-5.)

---

### [availability-4] Retry com backoff no fetch da janela de débito (frontend)

**QA**: Availability
**Tactic alvo**: Retry
**Esforço**: S (≤1d)
**Findings**: F-availability-4

**Problema**
> `fetchJanelaDataDebito` é uma chamada única sem retry; uma falha de rede transitória vira um erro definitivo na tela do diálogo "Gerar remessa" (`GerarRemessaDialog.tsx:120-135`), exigindo que a analista feche e reabra o diálogo manualmente para tentar de novo.

**Melhoria Proposta**
> Envolver a chamada em um pequeno helper de retry com backoff (1-2 tentativas, delay curto) no `lib/sispag.ts`, reaproveitando o padrão de `RetryExecutor` do backend como referência de contrato (mesmo que a implementação do frontend seja mais simples). Tactic alvo: Retry. Tocar `src/frontend/lib/sispag.ts` (`fetchJanelaDataDebito`) e, se necessário, `GerarRemessaDialog.tsx`.

**Resultado Esperado**
> Uma falha de rede isolada não interrompe mais o fluxo sem tentativa automática. Métrica: tentativas automáticas de retry em `fetchJanelaDataDebito` 0 → ≥1 antes de reportar erro definitivo.

**Métricas de sucesso**
- Retries automáticos configurados: 0 → ≥1

**Risco de não fazer**
> Fricção operacional recorrente em rede instável; não é um risco de disponibilidade do sistema, só de experiência.

**Dependências**: nenhuma.

---

### [deployability-2] Separar o kill-switch de escrita do fin015 (remessa) do de conciliação (fin052)

**QA**: Deployability
**Tactic alvo**: Logical Grouping
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> `SISPAG_LIVE_WRITE_ENABLED` cobre duas capacidades não relacionadas (geração de remessa e conciliação de retorno). Um incidente isolado na lógica de data de débito (I8) só pode ser contido desligando as duas.

**Melhoria Proposta**
> Tactic alvo: **Logical Grouping**. Dividir em `SISPAG_REMESSA_WRITE_ENABLED` e `SISPAG_CONCILIACAO_WRITE_ENABLED` (ou equivalente), cada um lido no ponto de escrita correspondente (`RemessaService`/`ConciliacaoRetornoService`), mantendo o comportamento atual combinado como default até a migração ser validada em produção.

**Resultado Esperado**
> Um bug isolado em uma das duas capacidades passa a ser contido sem desligar a outra. Métrica: 1 kill-switch cobrindo 2 capacidades → 2 kill-switches independentes, 1 por capacidade.

**Métricas de sucesso**
- Capacidades cobertas por um único switch: 2 → 1 (remessa isolada de conciliação)

**Risco de não fazer**
> Baixo no curto prazo (mitigado por dry-run e validação R1/R2 do ERP); cresce se mais capacidades forem penduradas no mesmo switch ao longo do roadmap das 4 frentes.

**Dependências**: nenhuma.

---

### [integrability-3] Gravar um fixture real do fin015 para `RemessaService`/`DebitDateService`

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: M (2-5d) — depende de acesso a HML para capturar o payload
**Findings**: F-integrability-3

**Problema**
> Os testes do delta mockam `ConexosSispagWriteClient` com `jest.fn()` sintético; não há um payload gravado (JSON) de uma resposta real de `criarLote`/`listarLotesNativos`/`listarTitulosPendentes` observada em HML, apesar do próprio `RemessaService.ts` documentar várias invariantes "medidas em HML" nos comentários.

**Melhoria Proposta**
> Capturar 1-2 payloads reais (dry-run em HML, sem dado sensível) e versionar como fixture em `src/backend/domain/client/__fixtures__/fin015/`; adicionar um teste de `ConexosSispagWriteClient` que faz o parse desse fixture e valida os campos que `RemessaService` depende (`flpCod`, `titulosCount`, `dataDebito`). Tactic alvo: **Contract testing**.

**Resultado Esperado**
> Pelo menos 1 teste de client cobrindo o parsing de um payload real do fin015, reduzindo a chance de o time só descobrir mudança de formato do ERP em produção.

**Métricas de sucesso**
- Testes de `ConexosSispagWriteClient` com fixture real: 0 → ≥1

**Risco de não fazer**
> Debt aceitável no curto prazo; o risco só se materializa quando o Conexos alterar o schema do fin015 sem aviso, o que já aconteceu de fato pelo menos uma vez segundo os comentários do código (encoding de `itsVldModalidade` sobrescrito pelo ERP).

**Dependências**: acesso a ambiente HML com dado de teste (não produção).

---

### [modifiability-4] Corrigir o status de `LotePagamento` em `ontology/_index.json` (retro-ontologia)

**QA**: Modifiability
**Tactic alvo**: Defer Binding (confiabilidade do mapa entidade→implementação para planejamento)
**Esforço**: S (≤1 dia)
**Findings**: F-modifiability-5

**Problema**
> `entities.LotePagamento.status` permanece `"planned"` com 14 `impl_files` que cobrem repository, service, rota e frontend — a entidade central do SISPAG está de fato implementada e em produção. Este delta adicionou `RemessaService.ts` à lista sem corrigir o status.

**Melhoria Proposta**
> Rodar `/retro-ontology` focado em `LotePagamento` (e, se o tempo permitir, nas demais 18 entidades para medir o drift total do `_coverage.json`) e atualizar `status` para `"implemented"` ou `"partial"` conforme o que realmente falta.

**Resultado Esperado**
> `entities.LotePagamento.status` = `"implemented"` (ou `"partial"` com gap explícito), coerente com os 14 arquivos já referenciados.

**Métricas de sucesso**
- `LotePagamento.status`: `"planned"` → `"implemented"`/`"partial"` correto

**Risco de não fazer**
> Estimativas de esforço para futuras mudanças em `LotePagamento` continuam calibradas por um mapa que subestima o que já existe.

**Dependências**: nenhuma; pode rodar em paralelo com qualquer outro card.

---

### [performance-1] Memoizar `BankingCalendar.holidays(year)` por ano

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S (≤1d)
**Findings**: F-performance-1

**Problema**
> `holidays(year)` recalcula a Páscoa e remonta+ordena o array de feriados a cada chamada de `isBusinessDay`, inclusive dentro do mesmo laço de `computeWindow` que itera vários dias do mesmo ano seguidas. O custo unitário é baixo, mas é trabalho 100% redundante e cresce linearmente com o tamanho da janela.

**Melhoria Proposta**
> Tactic **Increase Resource Efficiency**: adicionar um cache `Map<number, CivilDate[]>` por ano em `BankingCalendar` (`private holidaysCache`), populado sob demanda em `holidays(year)`. Como o `BankingCalendar` é `@singleton()`, o cache sobrevive entre requisições no mesmo processo Express — sem invalidação necessária. Tocar só `src/backend/domain/libs/calendar/BankingCalendar.ts`.

**Resultado Esperado**
> Recomputações de `holidays(year)` por chamada de `computeWindow`: até ~30 (pior caso hoje) → 1 por ano distinto na janela. CPU gasta no cálculo de feriados por requisição: reduzida a uma fração fixa, independente do tamanho da janela.

**Métricas de sucesso**
- Recomputações de `holidays(year)` por `computeWindow`: N (dias na janela) → 1 por ano distinto
- Cobertura de teste: `BankingCalendar.test.ts` ganha um caso que verifica (via spy/contador) que `easter()` roda 1 vez para N chamadas de `isBusinessDay` no mesmo ano

**Risco de não fazer**
> Nenhum incidente hoje; se a Frente II passar a calcular janelas de várias dezenas de lotes de uma vez, o custo agregado deixa de ser desprezível.

**Dependências**: nenhuma.

---

### [performance-2] Explicitar um teto de dias na janela de débito e validar a distância do vencimento na inclusão manual

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S (≤1d)
**Findings**: F-performance-2

**Problema**
> O laço de `computeWindow` que monta `naoUteis` não tem cota superior de iterações — ele confia que o `vencimento` mais distante do lote seja "razoavelmente próximo", uma garantia que hoje só existe fora do domínio (painel corta em 30d; formação automática em 7d), não dentro de `incluirTitulo` ou `computeWindow`.

**Melhoria Proposta**
> Tactic **Bound Execution Times**: (a) em `DebitDateService.computeWindow`, aplicar um teto explícito (ex.: 90 dias) ao tamanho da janela antes de iterar, devolvendo `vazia` com um motivo dedicado (`JANELA_MUITO_LONGA` ou similar) se excedido — fail-closed, alinhado ao estilo já usado no arquivo; (b) opcionalmente, debater com o ownership do domínio (owner Yuri) se `incluirTitulo` deveria também recusar títulos além de um horizonte de negócio.

**Resultado Esperado**
> `computeWindow` passa a ter uma cota superior determinística e testável (0 casos de laço > 90 iterações), documentada e coberta por teste em `DebitDateService.test.ts`.

**Métricas de sucesso**
- Teto de iterações do laço de `naoUteis`: indefinido → 90 dias (valor sugerido, a confirmar com o owner de domínio)
- Teste novo em `DebitDateService.test.ts`: janela com vencimento > teto → `vazia` com motivo dedicado

**Risco de não fazer**
> Baixo isoladamente; some ao risco geral de "regra de domínio garantida só por convenção entre camadas".

**Dependências**: nenhuma; card independente do performance-1.

---

### [fault-tolerance-2] Testar o mismatch de `dataDebito` no candidato a órfão (espelhar o teste de `ccoCod`)

**QA**: Fault Tolerance
**Tactic alvo**: Self-Test
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-2

**Problema**
> `adotarPorMarcaDagua` filtra candidatos por `ccoCod` E `dataDebito` (`RemessaService.ts:860-861`), mas só o mismatch de `ccoCod` tem teste dedicado (`RemessaService.test.ts:469-494`). O comportamento correto está implementado; falta a rede de segurança contra regressão.

**Melhoria Proposta**
> Adicionar um teste espelho: "lote acima da marca com a MESMA conta mas OUTRA data de débito não é candidato", seguindo exatamente o padrão do teste de `ccoCod` já existente. Tactic Bass: **Self-Test**.

**Resultado Esperado**
> 2 de 2 dimensões da assinatura de órfão (`ccoCod`, `dataDebito`) com teste de mismatch dedicado, em vez de 1 de 2.

**Métricas de sucesso**
- Testes de mismatch da assinatura de órfão: 1/2 → 2/2

**Risco de não fazer**
> Uma regressão futura no filtro de `dataDebito` (ex.: removido num refactor de `adotarPorMarcaDagua`) passaria despercebida pela suíte até se manifestar em produção como adoção de lote errado.

**Dependências**: nenhuma.

---

### [fault-tolerance-3] Atomizar a marca d'água (`setDataDebito` + `setRequestPayload`) numa transação

**QA**: Fault Tolerance, Availability
**Tactic alvo**: Rollback
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3, F-availability-2

**Problema**
> As duas escritas que compõem o write-ahead de criação de um lote nativo novo (`loteRepo.setDataDebito` em `lote_pagamento`, `ledger.setRequestPayload` em `remessa_execucao`) rodam como dois `UPDATE`s sequenciais sem `TransactionClient` compartilhado (`RemessaService.ts:454-459`). O sistema já é fail-closed nessa janela (`RemessaEmDuvidaError`, `RemessaService.test.ts:496-508`), mas cada queda exatamente ali gera uma escalação humana evitável.

**Melhoria Proposta**
> Envolver as duas escritas em `db.withTransaction`, passando o mesmo `tx` para `loteRepo.setDataDebito` e `ledger.setRequestPayload` — ambos os métodos já aceitam (ou podem aceitar) um `TransactionClient` opcional, padrão já usado em outros fluxos do mesmo repositório. Tactic Bass: **Rollback** (elimina a janela em vez de só detectá-la). Resolve por construção também o achado F-availability-2 (dado órfão) — ver REPORT.md CC-4.

**Resultado Esperado**
> 0 janelas onde `data_debito` está persistida sem a marca d'água correspondente — a queda nesse ponto passa a não deixar rastro parcial, eliminando a classe de `RemessaEmDuvidaError` gerada especificamente por essa janela.

**Métricas de sucesso**
- Escritas do write-ahead de criação compartilhando transação: 0/2 → 2/2

**Risco de não fazer**
> Taxa marginal (mas não-zero) de `RemessaEmDuvidaError` evitáveis, cada uma exigindo intervenção humana para confirmar o que aconteceu no fin015.

**Dependências**: nenhuma. (Ao implementar este card, reavaliar se `[availability-2]` ainda é necessário — ver REPORT.md CC-4.)

---

### [security-2] Alinhar `GET /lotes/:id/remessa/janela` ao padrão de proteção das rotas de dado de fornecedor

**QA**: Security
**Tactic alvo**: Limit Access
**Esforço**: S (≤1d)
**Findings**: F-security-2

**Problema**
> A rota nova desta feature devolve `credor` e `documento` do título limitante sem `requireRole`, enquanto as rotas irmãs que tocam dado de fornecedor (`/linhas-digitaveis`, `/remessa/arquivo`) exigem `admin` explicitamente, citando LGPD Art. 6º / LC 105 no próprio código.

**Melhoria Proposta**
> Adicionar `requireRole('admin')` em `GET /lotes/:id/remessa/janela` (Limit Access, Bass), ou — se a decisão de produto for manter leituras de lote abertas a qualquer autenticado — documentar essa decisão no mesmo lugar onde as rotas irmãs documentam o oposto, para que a próxima pessoa não trate a assimetria como acidente.

**Resultado Esperado**
> As três rotas que tocam identidade de fornecedor dentro de `/sispag/lotes/:id/*` seguem a mesma política de acesso, documentada num único lugar.

**Métricas de sucesso**
- Rotas de dado de fornecedor sob `/sispag/lotes/:id/*` com política de acesso documentada e consistente: 2/3 → 3/3

**Risco de não fazer**
> Baixo agora (mesma exposição já existe em `GET /lotes/:id`); cresce se outras rotas de leitura endurecerem sem que esta acompanhe, virando um esquecimento acumulado.

**Dependências**: nenhuma. (Recomenda-se implementar junto de `[availability-3]` — mesmo bloco de código, ver REPORT.md CC-5.)
