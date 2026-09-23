---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-22-2209-sispag-reter-titulo-lote
agent: qa-integrability
generated_at: 2026-09-22T22:09:00-03:00
scope: backend+frontend (delta)
score: 8.6
findings_count: 3
cards_count: 2
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Clica "Retirar do lote" na aba de títulos ou "Liberar" a retenção | `LotePagamentoService.retirarDoLote` / `liberarRetencao`, `RetencaoFormacaoRepository`, `titulo_retencao_formacao` | Runtime | A escrita fica 100% dentro do agregado próprio (Postgres), sem tocar o ERP (Conexos) nem exigir nova credencial/SSM | 0 chamadas Conexos nesta operação; 0 novos clients externos; contrato HTTP interno validado por Zod no boundary |

Este ciclo não introduz nenhuma integração externa nova nem altera contrato de client existente — é
o cenário "mais barato" de integrabilidade (mudança inteiramente dentro da fronteira já
encapsulada). O cenário relevante aqui é **custo de adicionar uma feature nova sem abrir nova
superfície de integração** — e o delta cumpre isso.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novos clients externos introduzidos no delta | 0 | 0 (feature não deveria abrir integração nova) | ✅ | `git diff --stat origin/main...HEAD -- src` (ver `_shared-metrics.md`); nenhum arquivo em `domain/client/` no diff |
| Chamadas ERP (Conexos) na escrita de retenção | 0 | 0 (ADR-0050: nenhuma escrita no ERP) | ✅ | `LotePagamentoService.ts:321-360` (`retirarDoLote`, `liberarRetencao` só chamam `db`/`retencaoRepo`) |
| Arquivos de serviço/rota do delta importando `axios`/`fetch` diretamente | 0/6 | 0 | ✅ | `grep -rn "axios\|fetch" src/backend/domain/service/sispag/*.ts src/backend/routes/sispag.ts` (sem match) |
| Endpoints novos com validação Zod no boundary | 2/2 (`retirar-do-lote`, `DELETE .../retencao`) | 100% | ✅ | `src/backend/routes/sispag.ts:107-121` (`chaveTituloSchema`, `retirarDoLoteSchema`) |
| `process.env.` cru nos arquivos não-teste do delta | 0/9 | 0 | ✅ | comando `grep -Hn "process\.env\." <cada arquivo não-teste do delta>` — 0 ocorrências |
| Clients tocados pelo delta que expõem método genérico (`get/post/request/call`) | 0 | 0 | ✅ | delta não toca `domain/client/`; `grep -ln "public get =\|public post =\|public request =\|public call ="  src/backend/domain/client/*.ts` → 0 arquivos em todo o diretório |
| Dependências injetadas em `LotePagamentoService` (após o delta) | 7 (`repo`, `tituloRepo`, `conexos`, `db`, `logService`, `retencaoRepo`, +constructor) | ≤5 recomendado para não-orquestrador | ⚠️ | `grep -c "@inject" src/backend/domain/service/sispag/LotePagamentoService.ts` → 7; 1 client Conexos direto (`ConexosSispagClient`, pré-existente) |
| Dependências injetadas em `SispagPainelService` (após o delta) | 14, sendo 4 clients Conexos diretos | ≤3 clients diretos (Discover Service/Orchestrate) | ⚠️ | `grep -n "@inject" src/backend/domain/service/sispag/SispagPainelService.ts:62-78` — delta adicionou a 14ª (`RetencaoFormacaoRepository`) a um orquestrador **pré-existente** já acima do alvo (13 antes do delta) |
| Frontend: call sites fora do wrapper único (`lib/sispag.ts`/`lib/http.ts`) nos componentes tocados | 0 | 0 (1 wrapper) | ✅ | `grep -n "fetch(\|axios" src/frontend/app/sispag/components/*.tsx src/frontend/app/sispag/page.tsx` → 0 |
| Migration idempotente / sem DML / com guarda-testes estáticos | sim | sim | ✅ | `src/backend/migrations/0062_titulo_retencao_formacao.sql` (`CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`); `src/backend/migrations/retencaoFormacao.test.ts` |
| Validação runtime (Zod) das novas respostas de API no frontend (`loteRascunho`, `retencaoFormacao`) | 0% (tipagem TS estática só) | pré-existente: 0% em todo `lib/sispag.ts` | ⚠️ **pré-existente, fora do delta** — o delta apenas estende a superfície não-validada | `src/frontend/lib/sispag.ts:1-70` (nenhum `z.object` no arquivo; `grep -c "z\."` → 0) |

## 3. Tactics — Cobertura no financeiro (foco no que o delta toca)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Encapsulate** | `RetencaoFormacaoRepository` e `TituloAPagarRepository` só falam com `PostgreeDatabaseClient`; nenhuma chamada ERP na escrita da retenção | ✅ presente | `src/backend/domain/repository/sispag/RetencaoFormacaoRepository.ts:1-9` |
| **Use an Intermediary** | `LotePagamentoService` é o único ponto que orquestra repo + retenção + Conexos (leitura em `incluirTitulo`); rota não fala com repositório/client direto | ✅ presente | `src/backend/routes/sispag.ts` (rota só resolve `LotePagamentoService`) |
| **Restrict Communication Paths** | Nenhum novo caminho de rede aberto pelo delta (0 clients tocados); escrita 100% Postgres interno | ✅ presente | métrica "Chamadas ERP" acima |
| **Adhere to Standards** | SQL 100% parametrizado (`$filCod`, `$docCod`...), `@injectable()`/singleton mantidos, Zod nos 2 endpoints novos | ✅ presente | `RetencaoFormacaoRepository.ts:59-71`; `sispag.ts:107-121` |
| **Abstract Common Services** | Reaproveita `PostgreeDatabaseClient.withTransaction`/`withAdvisoryLock` já existentes — nenhuma infra de retry/lock duplicada pelo delta | ✅ presente | `LotePagamentoService.ts:475-491` (`removerItemDoLote` usa `this.db.withTransaction`) |
| **Discover Service** | N/A para este delta — não há SSM novo (nenhum client tocado) | N/A — feature não abre integração nova |  |
| **Tailor Interface** | Endpoints novos usam verbos e payload mínimos e específicos (`POST .../retirar-do-lote`, `DELETE .../retencao`), não genéricos | ✅ presente | `src/backend/routes/sispag.ts:281-336` |
| **Configure Behavior** | Nenhuma configuração nova via SSM/env; `MOTIVO_RETENCAO_MAX` é constante de domínio compartilhada FE/BE (duplicada como literal, não lida de config) | ⚠️ parcial | `src/frontend/app/sispag/components/retencao.ts:9` (`500` hardcoded, espelha o `CHECK` da migration — ver Finding 3) |
| **Manage Resources** | Advisory lock e transação reaproveitados; retenção usa `ON CONFLICT ... DO NOTHING` para concorrência, sem lock extra | ✅ presente | `RetencaoFormacaoRepository.ts:59-71` |
| **Orchestrate** | `LotePagamentoService.retirarDoLote`/`removerItemDoLote` orquestra remoção + retenção numa única transação (atômico, sem coreografia via fila) | ✅ presente | `LotePagamentoService.ts:464-491` |
| **Manage Resource Coupling** | `titulo_retencao_formacao` deliberadamente **sem FK** para `titulo_a_pagar` — decisão de acoplamento fraco documentada na própria migration, para sobreviver a rebuild da carteira | ✅ presente, decisão explícita | `src/backend/migrations/0062_titulo_retencao_formacao.sql:20-26` |
| **Contract testing** | Repositório novo testado com DB mockado (não fixture de resposta real, mas não é boundary externo — é Postgres próprio); migration tem guarda estática de schema | ✅ presente (adequado ao tipo de boundary — não é integração externa) | `RetencaoFormacaoRepository.test.ts`; `retencaoFormacao.test.ts` |
| **Versioning strategy** | N/A — nenhuma API externa nova ou alterada pelo delta | N/A |  |
| **Backward-compatibility shims** | Migration usa `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` (idempotente, sem shim de versão de API necessário) | ✅ presente | `0062_titulo_retencao_formacao.sql:38-58` |
| **Observability of integration failures** | Erros de domínio (`TituloForaDeLoteError`, `RetencaoInexistenteError`) mapeados para HTTP com `code`/`statusCode`/`userMessage`; log de auditoria (`BUSINESS_INFO`) em cada operação | ✅ presente | `LotePagamentoService.ts:333-359`; `RetencaoInexistenteError.ts` |

## 4. Findings (achados)

### F-integrability-1: `SispagPainelService` cresce para 14 colaboradores injetados, 4 deles clients Conexos diretos

- **Severidade**: P2 (débito técnico defensável — hotspot pré-existente, delta o agrava marginalmente)
- **Tactic violada**: Use an Intermediary / Orchestrate
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:61-78`
- **Evidência (objetiva)**:
  ```
  @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
  @inject(ConexosSispagWriteClient) private readonly fin015: ConexosSispagWriteClient,
  @inject(ConexosSispagRetornoClient) ...
  @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
  ...
  @inject(RetencaoFormacaoRepository)     // <- adicionado por este delta
  private readonly retencaoRepo: RetencaoFormacaoRepository,
  ```
  `grep -c "@inject" SispagPainelService.ts` → 14 (13 antes do delta, medido via `git show origin/main:.../SispagPainelService.ts | grep -c "@inject"` = 13).
- **Impacto técnico**: cada novo colaborador aumenta o raio de blast de um refactor ou de uma troca de provedor por trás de um dos 4 clients Conexos — `SispagPainelService` já é o ponto que mais teria de ser tocado numa troca de gateway bancário ou upgrade de API Conexos.
- **Impacto de negócio**: nenhum risco imediato (é leitura, não escrita), mas cada feature nova na Frente II tende a entrar aqui por inércia, elevando o custo de qualquer upgrade futuro de integração.
- **Métrica de baseline**: 13 → 14 injeções (`+1` no delta), 4 delas clients ERP diretos — acima do alvo de ≤3 definido no plano de inspeção (item 10).
- **Nota de escopo**: o hotspot em si (13 colaboradores, 4 clients diretos) é **pré-existente, fora do delta**; o que este delta faz é adicioná-lo em +1, sem reduzi-lo. Não é P0/P1 desta feature.

### F-integrability-2: Frontend não valida em runtime os novos campos `loteRascunho`/`retencaoFormacao` vindos da API

- **Severidade**: P2 (pré-existente, fora do delta na causa raiz; o delta estende a superfície afetada)
- **Tactic violada**: Contract testing / boundary validation (CLAUDE.md: "Validate external inputs... with Zod at boundaries")
- **Localização**: `src/frontend/lib/sispag.ts:1-70` (nenhum `z.object` no arquivo — os novos tipos `LoteRascunhoRef`/`RetencaoFormacao` são só interfaces TS, confiadas cegamente ao `res.json()`)
- **Evidência (objetiva)**:
  ```
  export interface RetencaoFormacao {
    marcadoPor: string
    marcadoEm: string
    motivo?: string
  }
  ```
  Sem `zod` parseando a resposta de `GET /sispag/painel` antes de popular `TituloAPagar[]`.
- **Impacto técnico**: um drift de contrato (ex.: backend renomeia `marcadoPor` → `retidoPor` num `/feature-tweak` futuro) só quebra em runtime na tela (undefined silencioso), não no build — `RetencaoBadge.tsx` renderizaria `undefined` sem erro.
- **Impacto de negócio**: risco baixo por ora — é um badge informativo, não uma decisão financeira. Mas é o mesmo padrão em toda a superfície `lib/sispag.ts`, e a próxima feature dessa família (retorno Nexxera, por exemplo) herdaria o mesmo vácuo de validação num payload que já move dinheiro.
- **Métrica de baseline**: 0% de cobertura Zod em `src/frontend/lib/sispag.ts` (0 ocorrências de `z\.` no arquivo), tanto antes quanto depois do delta — a causa raiz é pré-existente; o delta adiciona 2 campos a essa superfície não validada.

### F-integrability-3: Limite de 500 caracteres do motivo duplicado como literal em 3 lugares (migration, rota, frontend) sem fonte única

- **Severidade**: P3 (baixo — melhoria opcional; nenhum dos 3 pontos pode divergir silenciosamente hoje, mas nada impede)
- **Tactic violada**: Configure Behavior / Adhere to Standards
- **Localização**: `src/backend/migrations/0062_titulo_retencao_formacao.sql:44` (`char_length(motivo) <= 500`), `src/backend/routes/sispag.ts:120` (`z.string().trim().max(500)`), `src/frontend/app/sispag/components/retencao.ts:9` (`export const MOTIVO_RETENCAO_MAX = 500`)
- **Evidência (objetiva)**: três literais `500` independentes, sem import/constante compartilhada entre backend e frontend (não há um pacote de contrato compartilhado neste monorepo).
- **Impacto técnico**: se o limite mudar num `/feature-tweak` futuro, é preciso lembrar de tocar os 3 lugares; hoje o comentário em `retencao.ts:9` ("o backend recusa acima disto com 400") é a única âncora textual entre eles.
- **Impacto de negócio**: nenhum hoje — os 3 valores estão sincronizados e cobertos por teste estático da migration. Risco é де drift silencioso em manutenção futura, não em produção agora.
- **Métrica de baseline**: 3 ocorrências do literal `500` sem fonte compartilhada (`grep -rn "500" <3 arquivos citados>`).

## 5. Cards Kanban

### [integrability-1] Extrair um `SispagOrquestradorConexosClient` (ou reduzir o fan-out) antes da próxima feature em `SispagPainelService`

- **Problema**
  > `SispagPainelService` já tinha 13 colaboradores injetados antes deste delta, 4 deles clients Conexos diretos (`ConexosSispagClient`, `ConexosSispagWriteClient`, `ConexosSispagRetornoClient`, `ConexosBaseClient`); este delta adiciona o 14º (`RetencaoFormacaoRepository`), sem reduzir o fan-out de clients. Cada feature nova da Frente II tende a crescer este serviço por inércia — ele é hoje o ponto de maior raio de blast para uma troca de gateway bancário (Nexxera) ou upgrade de versão do Conexos.

- **Melhoria Proposta**
  > Aplicar **Use an Intermediary**: consolidar os 4 clients Conexos usados por `SispagPainelService` atrás de uma fachada única (`SispagLeituraConexosFacade` ou similar) que expõe só os métodos de domínio que o painel precisa (`obterContextoLotes`, `obterBorderos`, etc.), deixando o service com 1 dependência de leitura Conexos em vez de 4. Não é urgente hoje (não é P0/P1), mas deve ser feito **antes** de o primeiro `/feature-new` de Nexxera (SISPAG escopo II) adicionar mais colaboradores a este mesmo serviço.

- **Resultado Esperado**
  > `SispagPainelService`: 4 clients Conexos diretos → 1 fachada. Total de dependências injetadas: 14 → ≤11 (repositórios + fachada + infra). Métrica "dependências injetadas em SispagPainelService" volta a ficar defensável contra o alvo de ≤3 clients diretos.

- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Clients Conexos injetados diretamente em `SispagPainelService`: 4 → 1
  - Total de `@inject` no construtor: 14 → ≤11
- **Risco de não fazer**: a próxima feature de Nexxera (que o roadmap já anuncia para SISPAG) provavelmente adiciona mais 2-3 colaboradores a este mesmo service, tornando o refactor cada vez mais caro (mais código para migrar, mais testes para reescrever).
- **Dependências**: nenhuma — pode ser feito isoladamente antes do próximo `/feature-new` que toque SISPAG/Nexxera.

### [integrability-2] Validar com Zod as respostas de `GET /sispag/painel` no frontend antes de expor os novos campos de retenção

- **Problema**
  > `src/frontend/lib/sispag.ts` tipa as respostas da API só com interfaces TS estáticas — nenhum `z.object` valida o payload em runtime em nenhum ponto do arquivo, antes ou depois deste delta. O delta adiciona 2 campos novos (`loteRascunho`, `retencaoFormacao`) a essa superfície já não validada, herdando o débito em vez de corrigi-lo.

- **Melhoria Proposta**
  > Aplicar **Contract testing / boundary validation** (regra do CLAUDE.md "validate external inputs... with Zod at boundaries", hoje não cumprida no frontend): introduzir um schema Zod para a resposta de `GET /sispag/painel` em `lib/sispag.ts`, começando pelos campos tocados por este delta (`loteRascunho`, `retencaoFormacao`) e expandindo por `/feature-tweak` conforme o resto do arquivo for tocado. Não bloqueia esta feature (débito pré-existente), mas deveria ser o primeiro item pego no próximo `/feature-tweak` que tocar `lib/sispag.ts`.

- **Resultado Esperado**
  > Drift de contrato backend→frontend (rename de campo, mudança de tipo) falha com erro explícito no fetch, não com `undefined` silencioso na tela. Cobertura Zod em `lib/sispag.ts`: 0% → cobre ao menos os campos novos deste delta.

- **Tactic alvo**: Contract testing (boundary validation)
- **Severidade**: P2 (causa raiz pré-existente, fora do delta — não é P0/P1 desta feature)
- **Esforço estimado**: S (≤1d) para os campos deste delta; M para o arquivo inteiro
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Campos `loteRascunho`/`retencaoFormacao` validados por Zod: 0 → 2
  - Cobertura Zod em `lib/sispag.ts` (arquivo inteiro, meta de longo prazo): 0% → ≥80%
- **Risco de não fazer**: a próxima integração real de dinheiro por este mesmo painel (retorno Nexxera) herda o mesmo vácuo de validação, agora num payload que decide se um pagamento saiu ou não.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo respeitado: delta não abre nenhuma integração externa nova (0 clients tocados) — a maior parte
  da missão genérica (Nexxera/GED/SharePoint/Conexos-write) é **N/A para este ciclo específico**, não
  "ausente por falha". Isso é coerente com a descrição da feature (`_shared-metrics.md`): "Nenhuma
  escrita no ERP, nenhum cálculo monetário".
- F-integrability-1 é rebaixado a P2 por ser hotspot **pré-existente** (13→14 colaboradores); o delta só
  agrava marginalmente, não cria. F-integrability-2 mesma lógica (causa raiz 0% pré-existente).
- **Cross-QA**: F-integrability-1 (fan-out em `SispagPainelService`) também é achado de Modifiability
  (custo de mudança concentrado); alertar o consolidator para não duplicar o card. F-integrability-2
  (validação de boundary) também é achado de Security/Fault Tolerance (input não confiável do backend
  renderizado sem guarda) — mesma recomendação de não duplicar.
