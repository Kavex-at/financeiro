---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-29-1628
agent: qa-integrability
generated_at: 2026-10-29T16:28:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 4
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG dispara "confirmar em conjunto" com N linhas (≤30) na gaveta de boletos | Fluxo cruza 2 novas rotas HTTP (`GET irmaos`, `POST confirmar-em-conjunto`), 2 serviços novos (`ConfirmacaoEmConjuntoService`, `RegraIrmaosConjunto`) e reusa `BoletoSuggestionService.confirmar` + fila de ajuste de centavos (`AjusteCentavosTituloService.agendarEmSequencia`) que escreve no Conexos `fin070` | Boundary HTTP + camada de serviço + integrador Conexos (renegociação) | Produção/HML, `SISPAG_LIVE_WRITE_ENABLED=on`, servidor Express | Confirmação por linha, releitura ao vivo dentro do `confirmar`; renegociações seriais, fire-and-forget, sem bloquear a resposta; ERP é tocado via cliente dedicado (sem acoplar o novo serviço ao `ConexosRenegociacaoClient`) | 0 chamadas diretas a axios/fetch no novo código · 100% dos boundaries validados por Zod no request · POST 30 linhas < 2 s de resposta (medido 1,3 s) · 0 novos clients adicionados |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novos integradores externos (clients) introduzidos pela feature | 0 | 0 (feature não adiciona dependência externa; reusa `BoletoSuggestionService.confirmar` e `AjusteCentavosTituloService`) | ✅ | `git diff origin/main --stat` (nenhum `domain/client/**` tocado) |
| Novos boundaries HTTP validados por Zod no request | 2/2 (GET irmaos via `TituloSugestaoQuerySchema`, POST via `ConfirmarEmConjuntoBodySchema`) | 100% dos endpoints novos | ✅ | `src/backend/routes/sispag.ts:1006,1030`; `src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts:66,78` |
| Response schema validado server-side antes de serializar | 0/2 | ≥1 (ao menos o POST, que compõe `ResultadoConjunto` sem schema runtime) | ⚠️ | `src/backend/routes/sispag.ts:1033-1041` (res.json direto; FE pina via `irmaosConjuntoSchema`/`resultadoConjuntoSchema` em `src/frontend/lib/sispag.ts:2716,2725`) |
| Chamadas a `axios`/`fetch` em services/routes do delta | 0 | 0 | ✅ | `rg -n "axios\|fetch\(" src/backend/domain/service/sispag/{Confirmacao,RegraIrmaosConjunto,AjusteCentavosTitulo}*.ts src/backend/routes/sispag.ts` |
| Colaboradores injetados em `ConfirmacaoEmConjuntoService` | 7 (`BoletoSuggestionService`, `RegraIrmaosConjunto`, `TituloAPagarRepository`, `LotePagamentoRepository`, `BoletoDdaRepository`, `AjusteCentavosTituloService`, `LogService`) | ≤3 clients diretos (heurística Bass); todos os 7 são serviços/repos internos | ⚠️ | `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:48-57` |
| Clients `@singleton @injectable` tocados pela feature | 0 (via `BoletoSuggestionService` indireto chega em `ConexosRenegociacaoClient` só por fila) | — | ✅ | diff |
| Testes de contrato novos (routes + FE Zod) | 3 (`sispag.sugestaoBoleto.test.ts`, `ConfirmacaoEmConjuntoService.test.ts`, `sispag.confirmacaoEmConjuntoApi.test.ts`) | ≥1 por boundary novo | ✅ | arquivos listados em `git status` |
| Fila de ajuste de centavos pós-confirmação | in-process `void this.executarEmSequencia(...)` (não durável) | fila persistente (DB outbox / SQS) ao escrever no Conexos | ⚠️ | `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts:316-324` |
| Versionamento de URL pública do novo endpoint | nenhum (`/sispag/sugestoes-boleto/...`) | consistente com os demais endpoints internos (não versionados) | ✅ | `src/backend/routes/sispag.ts:1004,1024` |
| Terraform/SSM/paths SSM afetados | — | — | ✅ | não medível (não existe `infra/` — alvo) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | O novo serviço não resolve nem usa cliente HTTP; a escrita no ERP continua atrás de `BoletoSuggestionService.confirmar` e, para a renegociação, atrás de `AjusteCentavosTituloService` (que já encapsula `ConexosRenegociacaoClient`) | ✅ presente | `ConfirmacaoEmConjuntoService.ts:48-57,117-120` |
| Use an Intermediary | `BoletoSuggestionService.confirmar` serve de anti-corruption layer entre a confirmação em conjunto e o Conexos; a renegociação é mediada pela fila `AjusteCentavosTituloService.agendarEmSequencia` | ✅ presente | `ConfirmacaoEmConjuntoService.ts:117,133`; `AjusteCentavosTituloService.ts:316-324` |
| Restrict Communication Paths | Rotas usam `exigirPermissao` + `limiteDecisaoBoleto`; o serviço não é acessível fora da fachada de rotas | ✅ presente | `src/backend/routes/sispag.ts:1005-1006,1025-1027` |
| Adhere to Standards | Boundary de entrada 100% Zod; nomes de erro em inglês (`BatchConfirmationTooLargeError`); mensagem ao operador em pt-BR | ✅ presente | `BatchConfirmationTooLargeError.ts`; schemas em `SugestaoBoletoSchemas.ts:66,78` |
| Abstract Common Services | Reuso de `chaveDoTitulo`, `LOTE_STATUS`, `isHandlerError`; não duplica lógica de confirmação | ✅ presente | `RegraIrmaosConjunto.ts:30-32`; `ConfirmacaoEmConjuntoService.ts:26-30` |
| Discover Service | N/A — nenhum serviço remoto novo precisa ser descoberto (reusa infra já configurada por SSM via clients existentes) | N/A | — |
| Tailor Interface | `GET irmaos` devolve só o que a tela precisa (origem + irmaos + maximo); `POST` devolve resultado POR LINHA — não espelha a interface do ERP | ✅ presente | `ConfirmacaoEmConjunto.ts` (interface); `ConfirmacaoEmConjuntoService.ts:62-93` |
| Configure Behavior | Nenhum novo flag SSM; o `SISPAG_LIVE_WRITE_ENABLED` e `ServerProcessMarker` já controlam a execução do ajuste (herdado) | ✅ presente | `AjusteCentavosTituloService.ts` (imports) |
| Manage Resources | `agendarEmSequencia` serializa as renegociações para evitar N chamadas simultâneas ao `fin070`; cada linha confirma em transação própria | ✅ presente | `AjusteCentavosTituloService.ts:316-324`; comentário "UM DEPOIS DO OUTRO" |
| Orchestrate | Orquestração linear no `confirmarEmConjunto`: cenário → N confirmarLinha → fila de ajuste; log final consolidado | ✅ presente | `ConfirmacaoEmConjuntoService.ts:95-146` |
| Manage Resource Coupling | Dependência indireta ao Conexos: a feature nunca injeta `ConexosRenegociacaoClient` nem `ConexosSispagClient`; só repositórios e serviços de domínio | ✅ presente | `ConfirmacaoEmConjuntoService.ts:48-57` |
| Contract testing (modern facet) | Rotas: `sispag.sugestaoBoleto.test.ts` cobre os 2 endpoints; Service: `ConfirmacaoEmConjuntoService.test.ts`; FE: `sispag.confirmacaoEmConjuntoApi.test.ts` pina com Zod | ✅ presente | arquivos no diff |
| Versioning strategy (modern facet) | Endpoints internos não versionados — consistente com o resto da API; sem contrato externo publicado | ⚠️ parcial | `src/backend/routes/sispag.ts:1004,1024` |
| Backward-compat shims (modern facet) | N/A — endpoints novos; `BoletoSuggestionService.confirmar` manteve assinatura (parâmetro `conjunto` é opcional) | N/A | `BoletoSuggestionService.ts` (diff) |
| Observability of integration failures (modern facet) | Falha de linha vira `BUSINESS_WARN` com `conjuntoId`+`titulo`+`erro`; falha de ajuste em sequência também logada por título; sucesso agrega `confirmadas/novas/recusadas` | ✅ presente | `ConfirmacaoEmConjuntoService.ts:174-186,129-144`; `AjusteCentavosTituloService.ts:328-340` |

## 4. Findings (achados)

### F-integrability-1: Fila de ajuste de centavos pós-confirmação é in-process e não durável

- **Severidade**: P2 (débito técnico defensável — o padrão herdado já era este; a feature apenas amplia a janela ao enfileirar N por lote)
- **Tactic violada**: Manage Resources (durabilidade da fila)
- **Localização**: `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts:316-324`; chamada em `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:133`
- **Evidência (objetiva)**:
  ```ts
  public agendarEmSequencia = (pedidos: Array<Omit<PedidoAjuste, 'gatilho'>>): void => {
      if (pedidos.length === 0) return;
      void this.executarEmSequencia(pedidos);
  };
  ```
- **Impacto técnico**: se o processo Express cai entre a resposta HTTP e a conclusão da sequência de `ajustar`, os títulos restantes do conjunto perdem a renegociação. Não há reagendamento automático exceto pela varredura `retomarPendentes` por filial no fim do loop — que também é in-process. Janela medida: até 36,5 s por conjunto de 30 (medição `_shared-metrics.md`).
- **Impacto de negócio**: títulos ficam no estado "confirmado sem ajuste" até alguém reabrir o SISPAG (que dispara `agendarVarredura`). Em pico de fechamento, aumenta o retrabalho do analista e o risco de o lote ser gerado sem o ajuste de centavos propagado.
- **Métrica de baseline**: janela de exposição 1,3 s (ideal) a 36,5 s (p99) por conjunto; 0% de persistência da fila entre reinícios do processo.

### F-integrability-2: Resposta do `POST confirmar-em-conjunto` não é validada por schema server-side

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards (contract pinning simétrico)
- **Localização**: `src/backend/routes/sispag.ts:1033-1041`; schema de referência existe no FE: `src/frontend/lib/sispag.ts:2716,2725`
- **Evidência (objetiva)**:
  ```ts
  res.json(
      await confirmacaoEmConjunto().confirmarEmConjunto({ ...body.data, ator: ator(req) }),
  );
  ```
- **Impacto técnico**: o schema de contrato só existe no FE (`irmaosConjuntoSchema`, `resultadoConjuntoSchema`). Mudança silenciosa na forma do `ResultadoConjunto` passa pelos testes do backend mas quebra o FE em runtime; não há *drift detector*.
- **Impacto de negócio**: regressão de UI em produção quando o backend evoluir o payload (ex.: adicionar campos em `ResultadoLinhaConjunto`) — detectada só na tela do analista.
- **Métrica de baseline**: 0/2 endpoints novos com validação de response server-side; 2/2 pinados no FE.

### F-integrability-3: `ConfirmacaoEmConjuntoService` injeta 7 colaboradores (orquestrador >3)

- **Severidade**: P3
- **Tactic violada**: Manage Resource Coupling (heurística)
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:48-57`
- **Evidência (objetiva)**:
  ```ts
  @inject(BoletoSuggestionService) private readonly sugestoes,
  @inject(RegraIrmaosConjunto) private readonly regra,
  @inject(TituloAPagarRepository) private readonly tituloRepo,
  @inject(LotePagamentoRepository) private readonly loteRepo,
  @inject(BoletoDdaRepository) private readonly boletoRepo,
  @inject(AjusteCentavosTituloService) private readonly ajusteCentavos,
  @inject(LogService) private readonly logService,
  ```
- **Impacto técnico**: orquestrador síncrono. Substituir `BoletoSuggestionService.confirmar` ou mudar a assinatura de `AjusteCentavosTituloService.agendarEmSequencia` cascata para cá. Nenhum é client externo — por isso só P3.
- **Impacto de negócio**: aumenta custo marginal de upgrade do caminho de confirmação (ex.: trocar motor de sugestão) por acoplamento concreto, não por interface.
- **Métrica de baseline**: 7 dependências no construtor; 0 interfaces entre elas (classes concretas).

### F-integrability-4: Comportamento "fire-and-forget" da fila invisível ao cliente HTTP

- **Severidade**: P3
- **Tactic violada**: Tailor Interface (contrato observável)
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:133`; retorno em `ConfirmacaoEmConjuntoService.ts:135-144`
- **Evidência (objetiva)**: `agendarEmSequencia` é chamado antes de montar o `ResultadoConjunto`; a resposta HTTP não inclui identificador da sequência de ajustes nem flag `ajusteAgendado` por linha. O FE sabe que confirmou, mas não sabe que o ajuste ainda está em andamento.
- **Impacto técnico**: ao integrar com outro frontend (ex.: automação futura ou dashboard), não há como consultar o status do ajuste da confirmação em conjunto sem rodar query no repositório de execuções.
- **Impacto de negócio**: tela do SISPAG precisa continuar polando o estado do título para saber se o ajuste completou — contrato implícito.
- **Métrica de baseline**: `ResultadoConjunto` tem 4 campos (`conjuntoId`, `resultados`, `confirmadas`, `recusadas`); 0 referentes ao estado da fila de ajuste.

## 5. Cards Kanban

### [integrability-1] Tornar a fila de ajuste de centavos durável entre reinícios

- **Problema**
  > A confirmação em conjunto enfileira até 30 renegociações `fin070` com `void this.executarEmSequencia(...)` dentro do processo Express (`AjusteCentavosTituloService.ts:316-324`). Se o processo cai ou é redeploy'ado durante o lote, os ajustes restantes somem até alguém reabrir a tela e disparar `agendarVarredura`.
- **Melhoria Proposta**
  > Persistir cada `PedidoAjuste` numa tabela `ajuste_centavos_outbox` (ou reusar `AjusteCentavosExecucaoRepository` com estado `pendente`) imediatamente antes do `void`, e drenar com um worker/job dedicado (ou com `retomarPendentes` chamado no boot do servidor, já existente). Tactic: *Manage Resources* + outbox pattern.
- **Resultado Esperado**
  > Reinício do processo no meio do lote não perde ajustes.
- **Tactic alvo**: Manage Resources
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Durabilidade da fila: 0% → 100% (pedidos sobrevivem a reinício)
  - Janela de exposição por conjunto: 36,5 s → 0 s (pedido já é durável antes do `void`)
- **Risco de não fazer**: lotes de fim de mês com conjunto grande deixam títulos "confirmados sem ajuste"; analista detecta só na geração da remessa.
- **Dependências**: nenhuma — `AjusteCentavosExecucaoRepository` já existe.

### [integrability-2] Validar o response de `confirmar-em-conjunto` com Zod server-side

- **Problema**
  > O FE pina o payload com `resultadoConjuntoSchema` (`src/frontend/lib/sispag.ts:2725`), mas o backend serializa com `res.json(...)` sem validar (`src/backend/routes/sispag.ts:1033-1041`). Mudança silenciosa no shape passa nos testes do BE e explode no FE.
- **Melhoria Proposta**
  > Mover `irmaosConjuntoSchema` e `resultadoConjuntoSchema` para `src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts` como *source of truth*, importar no FE, e passar o resultado por `.parse()` antes do `res.json`. Tactic: *Adhere to Standards*.
- **Resultado Esperado**
  > Mesma definição Zod no BE e no FE; qualquer drift falha o teste de rota do BE antes de chegar ao FE.
- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Endpoints novos com response validado no BE: 0/2 → 2/2
  - Schemas duplicados BE/FE: 2 → 0
- **Risco de não fazer**: regressão de UI em prod sem sinal no CI quando o `ResultadoConjunto` evoluir.
- **Dependências**: nenhuma.

### [integrability-3] Expor estado da fila de ajuste no `ResultadoConjunto`

- **Problema**
  > A resposta do POST não indica que a renegociação ainda está em andamento. O FE descobre pelo polling do título, contrato implícito que acopla UIs futuras ao schema de execução.
- **Melhoria Proposta**
  > Adicionar `ajusteAgendado: boolean` por linha e `sequenciaAjusteId?: string` no agregado, retornado pelo `agendarEmSequencia`. Tactic: *Tailor Interface*.
- **Resultado Esperado**
  > Qualquer cliente HTTP consegue correlacionar a confirmação com o estado da fila sem consultar repositório.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Campos do `ResultadoConjunto` referentes à fila: 0 → 2
- **Risco de não fazer**: segundo consumidor (automação / dashboard) precisará duplicar lógica.
- **Dependências**: integrability-1 (torná-la durável primeiro para o id fazer sentido).

### [integrability-4] Reduzir fan-out de dependências do `ConfirmacaoEmConjuntoService`

- **Problema**
  > O serviço injeta 7 colaboradores concretos (`ConfirmacaoEmConjuntoService.ts:48-57`), extrapolando a heurística de orquestrador >3. Nenhum é client externo — mas o acoplamento concreto encarece trocar `BoletoSuggestionService.confirmar` ou o motor de ajuste.
- **Melhoria Proposta**
  > Extrair um *reader* (`listarIrmaos`) e um *writer* (`confirmarEmConjunto`), ou agregar `TituloAPagarRepository`+`LotePagamentoRepository`+`BoletoDdaRepository` sob um `CarteiraLeituraService` que o conjunto consome. Tactic: *Manage Resource Coupling*.
- **Resultado Esperado**
  > Serviço com ≤4 dependências; teste unitário sem 7 mocks.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Colaboradores no construtor: 7 → ≤4
- **Risco de não fazer**: evolução futura do confirmar (ex.: nova fonte de boletos) exige rework proporcional.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Scope limitado ao diff: feature NÃO adiciona cliente externo, SSM path, nem toca `domain/client/**`. Integrabilidade estrutural intacta; findings são sobre durabilidade da fila e simetria de contrato.
- Cross-QA: F-integrability-1 reaparece em **Fault Tolerance** (perda silenciosa em crash) e **Availability** (janela de exposição por conjunto). F-integrability-2 cruza **Modifiability** (schema único vs duplicado) e **Testability** (teste de contrato BE↔FE).
- "Discover Service" marcado N/A: a feature reusa SSM já configurado por `ConexosRenegociacaoClient` via `AjusteCentavosTituloService` — nenhum novo endpoint remoto para descobrir.
- Métrica "Terraform/SSM" não medível localmente (infra é alvo, não existe `infra/`).
