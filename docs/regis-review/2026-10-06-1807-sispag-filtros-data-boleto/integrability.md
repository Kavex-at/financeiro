---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-06-1807
agent: qa-integrability
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 8.5
findings_count: 3
cards_count: 2
---

# Integrability — Regis-Review

Escopo: apenas o delta (65d1fdf, da095fa). O delta não toca nenhum client externo, SSM, Conexos, Nexxera, GED nem SharePoint. A integrabilidade é medida na fronteira frontend↔backend (contrato `GET /sispag/boletos-dda`) e no kit de filtro compartilhado.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / frontend consumidor | Novo parâmetro de filtro (`vencimentoDe/Ate`) adicionado a um endpoint existente | `GET /sispag/boletos-dda` + `fetchBoletosDda` + `PaginacaoBoletoDda` | Operação normal, cliente e servidor versionados juntos (lockstep FE==BE) | Parâmetros opcionais, validados por Zod na borda, repassados sem quebrar chamadores antigos; entrada malformada vira 400 | 0 chamadores existentes quebrados; 100% das entradas fora do formato rejeitadas; arquivos tocados por novo filtro ≤ 5 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients externos tocados pelo delta | 0 | 0 (delta de UI/filtro) | ✅ | `git show --stat 65d1fdf da095fa` |
| Service/repo importando axios/fetch no delta | 0 | 0 | ✅ | `git diff 65d1fdf~1 da095fa -- src/backend` (sem axios/fetch fora de teste) |
| Params novos aditivos/opcionais (compat. retroativa) | 2 de 2 | 100% | ✅ | `src/backend/routes/sispag.ts:873-874` (`.optional()`) |
| Validação Zod na borda dos novos params | 2 de 2 com regex estrita | 100% | ✅ | `src/backend/routes/sispag.ts:873-874` |
| Teste de contrato da rota (200 repasse + 400 malformado) | 3 casos (1 positivo, 2 negativos) | ≥ 1 por param | ✅ | `src/backend/routes/sispag.test.ts` (diff) |
| Arquivos tocados para propagar 1 filtro novo ponta a ponta | 6 (Paginacao, Service, rota, `lib/sispag.ts`, `BoletosDdaTab`, tipos) | ≤ 5 | ⚠️ | diff de `65d1fdf` |
| Arquivos backend com o padrão de regex de data civil `\d{4}-\d{2}-\d{2}` | 10 (mais 1 constante nova exportada, `DATA_CIVIL_REGEX`) | 1 fonte | ⚠️ | `grep -rln "\d{4}-\d{2}-\d{2}" src/backend` |
| Validação de calendário / `de <= ate` | ausente | presente | ⚠️ | `PaginacaoBoletoDda.ts:104-111` |
| Versionamento de API (URL/header) | ausente (rotas sem `/v1`) | N/A p/ API interna lockstep | ⚠️ | `routes/sispag.ts` (pré-existente) |
| Observabilidade por dependência externa | N/A no delta | — | ⚠️ **Não medível no delta**: nenhuma dependência externa nova; requer métricas por client em produção | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Filtro de vencimento vive em `PaginacaoBoletoDda` (puro, sem I/O); rota só valida e repassa; frontend usa `fetchBoletosDda` | ✅ presente | `PaginacaoBoletoDda.ts:94-109`, `lib/sispag.ts:1108-1139` |
| Use an Intermediary | `BoletoDdaService` repassa o filtro; conversões ERP-dia vs instante isoladas em `filtroDatas.ts` (anti-corruption local de datas) | ✅ presente | `BoletoDdaService.ts:80-81`, `filtroDatas.ts:1-31` |
| Restrict Communication Paths | HTTP do frontend passa por `apiFetch` + `withAuthHeaders`; nenhum fetch novo direto | ✅ presente | `lib/sispag.ts:1139` |
| Adhere to Standards | Datas civis ISO-8601 `YYYY-MM-DD`, alinhadas ao `<input type="date">` | ✅ presente | `filtroDatas.ts` |
| Abstract Common Services | Kit `useTabelaFiltro`/`FiltroBarra` compartilhado, extensão opt-in (`extras`, `rotuloData`, `filtroBoleto`) sem alterar Permutas | ✅ presente | `tabela-filtro.tsx` (diff), `tabela-filtro.test.tsx` |
| Discover Service | N/A: sem novo serviço externo; SSM não tocado | N/A | — |
| Tailor Interface | Parâmetros opcionais aditivos; ausência = comportamento anterior | ✅ presente | `routes/sispag.ts:873-874`, teste `semIntervalo.total = 4` |
| Configure Behavior | Intervalo por query string; sem flag/env nova | ✅ presente | `routes/sispag.ts` |
| Manage Resources | Filtro em memória antes da paginação; teto de 100 linhas/resposta preservado | ✅ presente | `PaginacaoBoletoDda.ts`, `BOLETO_DDA_TAMANHO_MAX` |
| Orchestrate | N/A: sem orquestração nova no delta | N/A | — |
| Manage Resource Coupling | Filtro das demais abas client-side (acoplado ao payload completo) vs DDA server-side; duas estratégias coexistem | ⚠️ parcial | `filtrosAbas.ts` vs `PaginacaoBoletoDda.ts` |
| Contract testing | Teste de rota fixa o contrato (valores repassados, 400 em lixo/formato); sem fixture compartilhada FE↔BE | ⚠️ parcial | `routes/sispag.test.ts` (diff) |
| Versioning strategy | Lockstep FE==BE; params aditivos dispensam versão | ⚠️ parcial | CLAUDE.md (bump lockstep) |
| Backward-compat shims | Nenhum necessário (params opcionais) | ✅ presente | `routes/sispag.ts:873-874` |
| Observability of integration failures | N/A no delta: sem dependência externa nova | N/A | — |

## 4. Findings (achados)

### F-integrability-1: Regex de data civil não valida calendário nem ordem do intervalo

- **Severidade**: P3
- **Tactic violada**: Tailor Interface
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:28-30`, `src/backend/routes/sispag.ts:873-874`
- **Evidência (objetiva)**:
  ```
  export const DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  vencimentoDe: z.string().regex(DATA_CIVIL_REGEX).optional(),
  ```
  `2026-13-45` passa; `vencimentoDe > vencimentoAte` devolve lista vazia com 200.
- **Impacto técnico**: o contrato aceita valores inválidos que resultam em listas vazias silenciosas. Seguro (comparação por string, sem SQL), mas o consumidor de API não recebe 400 acionável.
- **Impacto de negócio**: baixo; o frontend usa `<input type="date">`, que impede isso. Um consumidor futuro (script/integração) teria diagnóstico pobre.
- **Métrica de baseline**: 0 validações de calendário e de ordem; 2 params expostos.

### F-integrability-2: Duas estratégias de filtro de data coexistem (server-side no DDA, client-side nas demais abas)

- **Severidade**: P3
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/frontend/app/sispag/components/filtrosAbas.ts`, `src/frontend/app/sispag/components/BoletosDdaTab.tsx:111-120`
- **Evidência (objetiva)**:
  ```
  DDA: vencimentoDe/Ate -> query string -> PaginacaoBoletoDda (servidor)
  Títulos/Candidatos/Finalizados/REM/RET: getDatas() no cliente sobre o payload inteiro
  ```
- **Impacto técnico**: cada aba nova decide a estratégia; o filtro client-side exige carregar o conjunto inteiro e escala mal se o payload crescer. A semântica (dia ERP vs. instante BRT) existe só no frontend, então um consumidor server-side de outra aba reimplementa a conversão.
- **Impacto de negócio**: baixo hoje; relevante se as listas do SISPAG crescerem ou se outro consumidor (relatório, integração) precisar do mesmo filtro.
- **Métrica de baseline**: 1 aba server-side vs 5 client-side.

### F-integrability-3: `DATA_CIVIL_REGEX` nasce num módulo de DDA e convive com cópias locais do mesmo padrão

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:29`; outras ocorrências em `src/backend/domain/interface/perfil/PerfilQuerySchemas.ts`, `src/backend/routes/metricas.ts`
- **Evidência (objetiva)**:
  ```
  grep -rln "\d{4}-\d{2}-\d{2}" src/backend  -> 10 arquivos
  ```
- **Impacto técnico**: a constante canônica é exportada de um serviço de domínio específico, o que convida a importações cruzadas ou a mais cópias.
- **Impacto de negócio**: desprezível; custo de evoluir o formato multiplicado por N locais.
- **Métrica de baseline**: 10 arquivos com o padrão, 0 em módulo compartilhado.

## 5. Cards Kanban

### [integrability-1] Endurecer o contrato de intervalo de datas da API (calendário + de<=ate)

- **Problema**
  > O Zod aceita `2026-13-45` e `vencimentoDe > vencimentoAte`, devolvendo 200 com lista vazia. O contrato não comunica o erro a consumidores que não usam `<input type="date">`.

- **Melhoria Proposta**
  > Em `routes/sispag.ts`, trocar o regex puro por um schema de data civil (`.refine` com round-trip de `Date`) e um `.refine` de ordem em `boletosDdaSchema`, respondendo 400 com mensagem em português. Tactic: Tailor Interface.

- **Resultado Esperado**
  > Entradas inválidas rejeitadas com 400 acionável; casos de teste negativos 2 → 4.

- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Classes de entrada inválida aceitas pela rota: 2 → 0
- **Risco de não fazer**: consumidores futuros recebem listas vazias silenciosas e depuram no escuro.
- **Dependências**: nenhuma.

### [integrability-2] Extrair `DataCivilSchema` compartilhado e reutilizar nos filtros de data

- **Problema**
  > O formato `YYYY-MM-DD` é redeclarado em ~10 arquivos; a nova `DATA_CIVIL_REGEX` nasceu dentro de `PaginacaoBoletoDda`. Qualquer filtro de data novo repete a decisão, e o filtro client-side vs server-side é escolhido caso a caso.

- **Melhoria Proposta**
  > Criar um schema Zod único em `domain/interface/` (ex.: `DataCivilSchema`) e fazer `routes/sispag.ts` consumi-lo, migrando as demais cópias oportunisticamente em `/feature-tweak`. Documentar a regra "lista grande = filtro no servidor". Tactic: Abstract Common Services.

- **Resultado Esperado**
  > Declarações do regex de data civil: 10 → 1 fonte (migração gradual).

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2, F-integrability-3
- **Métricas de sucesso**:
  - Declarações do regex fora do módulo compartilhado: 10 → ≤ 3 no primeiro passo
- **Risco de não fazer**: divergência silenciosa de formato entre rotas ao longo de 6 meses.
- **Dependências**: integrability-1 (mesmo schema).

## 6. Notas do agente

- Escopo: delta apenas; nenhum client externo foi alterado, então as métricas de clients/SSM/Discover Service do plano não se aplicam.
- Nenhum P0/P1: params aditivos, opcionais, validados, com testes 200/400.
- Cross-QA: F-integrability-1 (Validate Input) toca Security; a rota rejeita lixo tipo `' OR 1=1` (teste presente) e nada chega a SQL.
- F-integrability-2 toca Performance (filtro client-side sobre payload completo) — sinalizar ao consolidator.
