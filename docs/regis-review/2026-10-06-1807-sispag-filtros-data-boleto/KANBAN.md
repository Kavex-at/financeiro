---
type: regis-review-kanban
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
total: 13
counts: { p0: 0, p1: 0, p2: 3, p3: 10 }
---

# Kanban — financeiro — 2026-10-06-1807-sispag-filtros-data-boleto

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
>
> **Nota de consolidação:** 17 cards de origem viraram 13. Os 5 cards que pediam a mesma coisa
> (validar data de calendário real e rejeitar intervalo invertido em `GET /sispag/boletos-dda`) foram fundidos em
> `sispag-datas-1`: `availability-1`, `fault-tolerance-1`, `integrability-1`, `security-1`, `testability-2`.
> Os demais 12 cards estão verbatim, com o ID original.

---

## P0 — Crítico

_Nenhum card P0 neste run._

---

## P1 — Alto

_Nenhum card P1 neste run._

---

## P2 — Médio

### [modifiability-2] Promover o kit de filtro para módulo compartilhado e dividir por responsabilidade

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies
**Esforço**: S (≤1d)
**Findings**: F-modifiability-2

**Problema**
> `tabela-filtro.tsx` está em `permutas/components`, é usado por 11 arquivos de 3 domínios e já tem 362 LOC. O próximo critério de filtro o leva acima de 400 e o caminho do import induz a erro sobre quem é o dono.

**Melhoria Proposta**
> Restrict Dependencies + Split Module: mover para `src/frontend/components/` (por exemplo `tabela-filtro/`) e separar o hook `useTabelaFiltro` da `FiltroBarra` (UI). Manter reexport em `permutas/components/tabela-filtro.tsx` durante a transição, para não quebrar imports. Preservar os testes de opt-in existentes.

**Resultado Esperado**
> Kit com dono explícito, cada arquivo abaixo de 250 LOC, e 0 imports de `sispag/` ou `recebimentos/` apontando para `permutas/`.

**Métricas de sucesso**
- Imports cross-domínio para `permutas/components/tabela-filtro`: 6 (SISPAG ×3, Recebimentos ×3) → 0
- LOC por arquivo do kit: 362 → ≤ 250

**Risco de não fazer**
> Mudança de filtro numa frente quebra outra sem que o dono perceba. O arquivo ultrapassa o p95 de 400 LOC.

**Dependências**: Nenhuma. Fazer antes de uma terceira extensão do kit.

---

### [testability-1] Cobrir o wiring de filtros por aba em `sispag/page.test.tsx`

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> O wiring dos filtros de data/boleto de cada aba SISPAG em `page.tsx` não tem teste de página; só os accessors puros são testados. Trocar o accessor de uma aba passa verde.

**Melhoria Proposta**
> Adicionar a `page.test.tsx` um caso por aba (títulos, candidatos, finalizados, REM, RET) que aplica um intervalo e afirma que só a linha da data correta permanece; extrair o wiring da aba REM para componente próprio se o teste ficar pesado.

**Resultado Esperado**
> Testes de página com filtro 0 → 5; accessor trocado é detectado em CI.

**Métricas de sucesso**
- testes de página por filtro de aba: 0 → 5
- `page.tsx` linhas: 1402 → < 1300 (se extrair REM)

**Risco de não fazer**
> filtro errado em uma aba chega a produção sem sinal; cada nova coluna repete o risco.

**Dependências**: Nenhuma

---

### [modifiability-1] Extrair o wiring de filtros por aba de `sispag/page.tsx`

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M (2–5d)
**Findings**: F-modifiability-1

**Problema**
> `sispag/page.tsx` tem 1402 LOC e 32 imports, e cresceu 69 linhas neste delta. Cada aba nova ou critério novo de filtro reabre o mesmo arquivo, o que aumenta conflitos de merge e regressões cruzadas entre abas.

**Melhoria Proposta**
> Split Module: mover cada aba (REM, RET, Finalizados, Candidatos) para um componente próprio em `src/frontend/app/sispag/components/`, como `BoletosDdaTab.tsx` já faz. Manter em `page.tsx` só a navegação e o estado compartilhado. Fazer de forma incremental, a cada `/feature-tweak` que tocar a aba, conforme a política de migração proporcional.

**Resultado Esperado**
> `page.tsx` abaixo de 700 LOC (alvo final 600) e abaixo de 20 imports. Nova aba de filtro toca no máximo 2 arquivos.

**Métricas de sucesso**
- LOC de `sispag/page.tsx`: 1402 → ≤ 700
- Imports de `sispag/page.tsx`: 32 → ≤ 20

**Risco de não fazer**
> Em 6 meses o arquivo passa de 1,6k LOC, e cada ajuste do SISPAG, que é a frente com mais feedback de produção, vira conflito de merge.

**Dependências**: Nenhuma. Fazer junto com a próxima mudança na aba afetada. Sinergia com `testability-1`.

---

## P3 — Baixo

### [sispag-datas-1] Rejeitar com 400 data de calendário inexistente e intervalo invertido em `GET /sispag/boletos-dda`

> **Card consolidado** (ID novo). Origem: `availability-1`, `fault-tolerance-1`, `integrability-1`, `security-1`, `testability-2`.

**QA**: Availability, Fault Tolerance, Integrability, Security, Testability
**Tactic alvo**: Sanity Checking (Availability, Fault Tolerance) / Tailor Interface (Integrability) / Validate Input (Security) / Executable Assertions (Testability)
**Esforço**: S (≤1d)
**Findings**: F-availability-1, F-fault-tolerance-1 (+ F-fault-tolerance-2, parte de documentação), F-integrability-1, F-security-1, F-testability-2

**Problema**
> O Zod valida só o formato `^\d{4}-\d{2}-\d{2}$`. `vencimentoDe=2026-13-45` (ou `2026-99-99`) e `vencimentoDe > vencimentoAte` retornam 200 com `total: 0`, indistinguível de "sem boletos no período". Sem risco de injeção ou crash (comparação por string, sem SQL), mas um cliente HTTP que não use o `<input type="date">`, ou uma digitação invertida, pode ler "vazio" como "nada a pagar". Hoje há 0 testes para data inexistente e 0 para intervalo invertido.

**Melhoria Proposta**
> Em `boletosDdaSchema` (`routes/sispag.ts`), trocar o `regex` por `refine` que valida o calendário (round-trip `Date.UTC`/ISO) e adicionar `superRefine` impondo `vencimentoDe <= vencimentoAte`, respondendo 400 com mensagem em português e `details`. Em `FiltroBarra`, avisar/desabilitar quando de > até. Adicionar 2 casos de rejeição em `routes/sispag.test.ts` e 1 em `PaginacaoBoletoDda.test.ts`. Registrar que a UI deve sinalizar listas truncadas nas abas com filtro client-side, se existirem (F-fault-tolerance-2, ainda não verificado).

**Resultado Esperado**
> Entradas impossíveis ou invertidas retornam 400 acionável (hoje: 200 com lista vazia). Parâmetros de data com validação semântica: 0 de 2 → 2 de 2; classes de entrada inválida aceitas: 2 → 0; casos inválidos testados na rota: 2 → 4.

**Métricas de sucesso**
- Parâmetros de data com validação semântica: 0/2 → 2/2
- Classes de entrada inválida aceitas pela rota (data impossível, de > ate): 2 → 0
- Testes de rejeição para esses casos: 0 → 2 (rota: 2 → 4 casos inválidos no total)

**Risco de não fazer**
> Leitura enganosa ocasional ("sem boletos") por cliente HTTP ou digitação invertida; consumidores futuros (script, integração) depuram no escuro. Sem risco financeiro direto nem de segurança.

**Dependências**: Nenhuma. `integrability-2` e `modifiability-3` reaproveitam o mesmo schema.

---

### [availability-2] Medir o tamanho do pool DDA e a latência de `/sispag/boletos-dda`

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: S (≤1d)
**Findings**: F-availability-2

**Problema**
> O filtro roda em memória sobre o pool inteiro (F-availability-2) e não há métrica local de tamanho de pool nem de latência da rota. Sem número, não dá para saber quando o padrão deixa de ser seguro.

**Melhoria Proposta**
> Logar via `LogService` o total de linhas do pool e a duração do `listar` (campo estruturado), e registrar um limiar de revisão (ex.: pool > N linhas → mover filtro para SQL parametrizado). Tactic: Exception Prevention.

**Resultado Esperado**
> Tamanho do pool e p95 da rota passam de "não medido" a "medido"; decisão de migrar para SQL baseada em dado.

**Métricas de sucesso**
- Pool DDA monitorado: não medido → medido
- p95 de `/sispag/boletos-dda`: não medido → medido

**Risco de não fazer**
> degradação gradual descoberta pelo analista, não por um alarme.

**Dependências**: Nenhuma. Sobrepõe-se ao lado de medição de `performance-1` (fazer o log uma vez só).

---

### [deployability-1] Documentar ordem de deploy BE→FE para mudanças com query params novos

**QA**: Deployability
**Tactic alvo**: Package Dependencies
**Esforço**: S
**Findings**: F-deployability-1

**Problema**
> O filtro DDA depende de backend novo para funcionar; FE deployado antes mostra datas sem efeito (F-deployability-1).

**Melhoria Proposta**
> Acrescentar ao `DEPLOY.md` a regra "backend primeiro quando o FE passa a enviar params novos" (Package Dependencies). Opcional: checklist de PR.

**Resultado Esperado**
> Janela de inconsistência FE/BE: ~minutos → 0 para mudanças aditivas.

**Métricas de sucesso**
- Regra de ordem de deploy documentada: não → sim

**Risco de não fazer**
> Confusão pontual em deploys futuros com contratos novos; baixo.

**Dependências**: Nenhuma

---

### [integrability-2] Extrair `DataCivilSchema` compartilhado e reutilizar nos filtros de data

**QA**: Integrability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-integrability-2, F-integrability-3

**Problema**
> O formato `YYYY-MM-DD` é redeclarado em ~10 arquivos; a nova `DATA_CIVIL_REGEX` nasceu dentro de `PaginacaoBoletoDda`. Qualquer filtro de data novo repete a decisão, e o filtro client-side vs server-side é escolhido caso a caso.

**Melhoria Proposta**
> Criar um schema Zod único em `domain/interface/` (ex.: `DataCivilSchema`) e fazer `routes/sispag.ts` consumi-lo, migrando as demais cópias oportunisticamente em `/feature-tweak`. Documentar a regra "lista grande = filtro no servidor". Tactic: Abstract Common Services.

**Resultado Esperado**
> Declarações do regex de data civil: 10 → 1 fonte (migração gradual).

**Métricas de sucesso**
- Declarações do regex fora do módulo compartilhado: 10 → ≤ 3 no primeiro passo

**Risco de não fazer**
> divergência silenciosa de formato entre rotas ao longo de 6 meses.

**Dependências**: `sispag-datas-1` (mesmo schema; antes `integrability-1`).

---

### [modifiability-3] Centralizar o contrato de dia civil e documentar o critério de filtro DDA

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-modifiability-3, F-modifiability-4

**Problema**
> O formato `YYYY-MM-DD` é validado com regex próprio no backend (`DATA_CIVIL_REGEX`) e em `perfil/periodo.ts`, sem validação de calendário. Cada critério novo do DDA exige editar rota, service e `filtro` manualmente.

**Melhoria Proposta**
> Abstract Common Services: validar a data de calendário no Zod do backend (por exemplo, `refine` com `Date.parse`) e reaproveitar o mesmo schema nas rotas que aceitem dia civil. No frontend, reaproveitar `filtroDatas.ts` em `perfil/periodo.ts`. Agrupar os parâmetros de filtro DDA em um schema Zod único, derivado do tipo `filtro`.

**Resultado Esperado**
> 1 definição do formato por runtime. Novo critério DDA editado em 1 schema em vez de 3 pontos.

**Métricas de sucesso**
- Definições do regex de data civil: 2 → 1 por runtime
- Pontos de edição por parâmetro DDA: 3 → 1

**Risco de não fazer**
> Divergência silenciosa de formato entre telas. Custo marginal, mas cresce a cada filtro novo.

**Dependências**: Nenhuma. Executar junto com `integrability-2` e `sispag-datas-1` (mesmo schema de data civil).

---

### [performance-1] Aplicar debounce às datas de vencimento do DDA e medir a latência do endpoint

**QA**: Performance
**Tactic alvo**: Manage Sampling Rate
**Esforço**: S
**Findings**: F-performance-1, F-performance-3

**Problema**
> Datas de vencimento do DDA disparam um GET por alteração (F-performance-1) e a latência p95 de `GET /sispag/boletos-dda` com filtro de vencimento no escopo "todos" nunca foi registrada (F-performance-3), então não há evidência de que o filtro novo fique dentro do orçamento.

**Melhoria Proposta**
> Reusar o mecanismo de debounce da busca (`buscaAplicada`) para `vencimentoDe`/`vencimentoAte` em `BoletosDdaTab.tsx` (Manage Sampling Rate). Registrar a duração de `paginar` e o `total` retornado via `LogService` para obter p50/p95 reais.

**Resultado Esperado**
> Menos requisições redundantes por interação de data e uma linha de base de latência do endpoint em produção.

**Métricas de sucesso**
- Requisições por troca de intervalo De/Até no DDA: 2 a 4 -> ≤ 2 (agrupadas pelo debounce)
- p95 de `GET /sispag/boletos-dda` (escopo "todos", com vencimento): não medido -> medido e ≤ 500 ms

**Risco de não fazer**
> carga redundante sobre o pool de 24 mil linhas se o uso crescer; regressão de latência sem baseline para detectá-la.

**Dependências**: Nenhuma. Compartilha a instrumentação de latência com `availability-2`.

---

### [performance-2] Registrar o First Load JS das rotas /sispag e /permutas em cada ciclo

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> O delta soma ~190 linhas ao kit compartilhado `tabela-filtro.tsx`, carregado também pela rota `/permutas`, e o tamanho do bundle não foi medido neste ciclo (F-performance-2 trata do custo de runtime; o de bundle segue sem baseline).

**Melhoria Proposta**
> Executar `cd src/frontend && npm run build` e anexar a tabela de First Load JS de `/sispag` e `/permutas` ao `_shared-metrics.md`; alertar se p95 > 200 KB (Bundle leanness).

**Resultado Esperado**
> Bundle das duas rotas medido e comparável entre ciclos.

**Métricas de sucesso**
- First Load JS `/sispag`: não medido -> medido, alvo ≤ 200 KB
- First Load JS `/permutas`: não medido -> medido; delta vs. main ≤ +2 KB

**Risco de não fazer**
> crescimento silencioso do bundle do kit de filtro compartilhado ao longo dos ciclos.

**Dependências**: Nenhuma

---

### [security-2] Aplicar limiter de leitura às rotas de listagem SISPAG

**QA**: Security
**Tactic alvo**: Detect Service Denial
**Esforço**: S (≤1d)
**Findings**: F-security-2

**Problema**
> `GET /sispag/boletos-dda` não tem limiter; os filtros novos somam trabalho O(n) em memória por chamada.

**Melhoria Proposta**
> Aplicar um `readRouteLimiter` (mais frouxo que `heavyRouteLimiter`) às listagens paginadas do SISPAG. Tactic: Detect Service Denial / Limit Exposure.

**Resultado Esperado**
> Rajadas abusivas de um usuário retornam 429; uso normal inalterado. Limiters em rotas GET de listagem: 0 → 1.

**Métricas de sucesso**
- Rotas GET de listagem SISPAG com limiter: 0 → todas

**Risco de não fazer**
> Latência degradada sob abuso de usuário autenticado.

**Dependências**: Nenhuma

---

### [testability-3] Adicionar propriedades fast-check ao filtro de intervalo

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> Bordas de inclusividade e fuso são cobertas só por exemplos manuais.

**Melhoria Proposta**
> Propriedade: para qualquer conjunto de datas e intervalo, o resultado equivale a um oráculo ingênuo `filter(de <= d <= ate)`; e `diaEmBrasilia` estável entre 00:00 e 23:59 BRT.

**Resultado Esperado**
> Propriedades no delta 0 → 2; uso de `fast-check` em `app/sispag` 0 → 1 arquivo.

**Métricas de sucesso**
- propriedades: 0 → 2

**Risco de não fazer**
> erro de borda de um dia continua dependendo do exemplo escolhido.

**Dependências**: Nenhuma

---

### [deployability-2] Adicionar smoke test pós-deploy para endpoints SISPAG de leitura

**QA**: Deployability
**Tactic alvo**: Deployment observability
**Esforço**: M
**Findings**: F-deployability-2

**Problema**
> O CI não valida o backend implantado; regressões em filtros só aparecem para o usuário (F-deployability-2).

**Melhoria Proposta**
> Passo pós-deploy no workflow (ou job manual) que chama `/health` e `/sispag/boletos-dda?vencimentoDe=...&vencimentoAte=...` com token de serviço e verifica 200 (Deployment observability).

**Resultado Esperado**
> Smoke tests pós-deploy: 0 → 1 cobrindo SISPAG; detecção de regressão antes do analista.

**Métricas de sucesso**
- Smoke tests pós-deploy: 0 → 1

**Risco de não fazer**
> Regressões de leitura seguem detectadas por usuário.

**Dependências**: credencial de serviço para o smoke
