---
type: regis-review-kanban
run_id: 2026-10-08-1958-sispag-titulos
total: 10
counts: { p0: 0, p1: 0, p2: 5, p3: 5 }
---

# Kanban — financeiro — 2026-10-08-1958-sispag-titulos

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> Origem: 13 cards dos 8 QAs, consolidados em 10 (3 fusões, listadas em cada card e no REPORT seção 7). Escopo `--quick`: somente o delta do commit e832057.

---

## P0 — Crítico

Nenhum card. O delta é read-only, sem I/O externo, sem fila e sem escrita financeira.

---

## P1 — Alto

Nenhum card.

---

## P2 — Médio

### [availability-1] Registrar duração do export e limitar tempo de query

**QA**: Availability (consolida também `performance-1`, Performance)
**Tactic alvo**: Monitor (Availability) / Reduce Overhead (Performance)
**Esforço**: S
**Findings**: F-availability-1, F-performance-1, F-performance-2

**Problema**
> O export não registra `durationMs` e não tem limite de tempo próprio; query lenta ocuparia o pool compartilhado sem sinal. (De Performance: o export relê toda a carteira ativa e serializa o .xlsx de forma síncrona; hoje, com ~1,5 mil linhas, é barato, mas não há métrica de duração que avise quando deixar de ser.)

**Melhoria Proposta**
> Incluir `durationMs` no log `títulos a pagar exportados` (`BUSINESS_INFO` de `exportar`) e aplicar `statement_timeout` nas leituras do export (tactic Monitor). Se o p95 passar do alvo, tratar via `availability-2`.

**Resultado Esperado**
> Latência do export observável; queries limitadas (hoje: sem medição → p95 acompanhado). Duração do export observável no log; alerta quando p95 > 2s.

**Métricas de sucesso**
- Log com `durationMs`: ausente → presente
- p95 do export com 1,5 mil títulos: não medido → < 2s

**Risco de não fazer**
> Lentidão do export só descoberta por reclamação; crescimento da carteira degrada o export sem aviso.

**Dependências**: Nenhuma

---

### [modifiability-1] Centralizar o teto de títulos do painel/export

**QA**: Modifiability (consolida também `integrability-2`, Integrability)
**Tactic alvo**: Abstract Common Services (Modifiability) / Configure Behavior (Integrability)
**Esforço**: S
**Findings**: F-modifiability-1, F-integrability-2

**Problema**
> O 5000 existe em `TITULOS_CAP` (BE), `MAX_TITULOS_EXPORT` e na validação da rota; divergência causa truncamento silencioso. Os tetos também dependem do limite de 100 KB do body do Express.

**Melhoria Proposta**
> Exportar uma constante única no BE (interface sispag) usada por painel e rota; o FE recebe o teto no payload do painel ou mantém espelho com teste de paridade. Alternativa mínima: teste que afirme `MAX_TITULOS_EXPORT >= TITULOS_CAP`.

**Resultado Esperado**
> 3 cópias -> 1 fonte (+1 teste de paridade FE). Divergência possível entre tela e export: sim -> não.

**Métricas de sucesso**
- Cópias do teto: 3 -> 1
- Constantes independentes sem asserção: 2 -> 0

**Risco de não fazer**
> Alteração do cap do painel quebra o export sem falha de teste; export parcial em relação ao que o analista vê.

**Dependências**: Nenhuma

---

### [security-1] Registrar o usuário autor no log de export de títulos a pagar

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S
**Findings**: F-security-1

**Problema**
> O export de `/sispag/titulos/exportar` entrega credores, valores e bancos da carteira, mas o log de negócio guarda só `requestId` e contagens. Não dá para dizer quem extraiu a planilha sem cruzar logs de acesso.

**Melhoria Proposta**
> Passar o identificador do ator (`req.user`) da rota para `exportar` e incluí-lo em `data` do `logService.info`. Aplicar o mesmo padrão ao `RemessaTitulosExportService`. Tactic: Audit Trail.

**Resultado Esperado**
> Todo export fica atribuível a um usuário no log: 0 de 2 exports com identidade hoje, 2 de 2 depois.

**Métricas de sucesso**
- Exports SISPAG com userId no log: 0 de 2 → 2 de 2

**Risco de não fazer**
> Um vazamento de lista de fornecedores por usuário interno não é atribuível sem investigação manual.

**Dependências**: Nenhuma

---

### [testability-1] Cobrir `PlanilhaXlsxWriter` com teste direto

**QA**: Testability
**Tactic alvo**: Specialized Interfaces
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> O writer foi extraído para `domain/libs/xlsx` e serve a dois exports, mas só é exercitado indiretamente (F-testability-1).

**Melhoria Proposta**
> Criar `PlanilhaXlsxWriter.test.ts`: serializar uma `PlanilhaExport` pequena, reler o buffer e afirmar cabeçalho, `numFmt` de moeda e data, e a linha de totais. Tactic: Specialized Interfaces.

**Resultado Esperado**
> Testes diretos do writer 0 → 3 casos; regressões de formato falham no teste da lib, não no do service.

**Métricas de sucesso**
- Testes diretos do `PlanilhaXlsxWriter`: 0 → 3

**Risco de não fazer**
> Um ajuste de formato quebra dois exports e só é percebido na planilha aberta.

**Dependências**: Nenhuma

---

### [modifiability-2] Extrair rotas e componentes de títulos de sispag.ts / page.tsx

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: L
**Findings**: F-modifiability-2, F-modifiability-3

**Problema**
> Rota e página SISPAG superam 1200 LOC e recebem toda feature nova da frente.

**Melhoria Proposta**
> Split Module: mover rotas de export para `routes/sispag/exportacao.ts` e a aba Títulos para componente próprio, incrementalmente, no próximo `/feature-tweak` que tocar a área. (F-modifiability-3: unificar `FMT_MOEDA`/`FMT_DATA`/`chaveDe` entre os dois exports.)

**Resultado Esperado**
> routes/sispag.ts 1257 -> <600; page.tsx 1475 -> <600.

**Métricas de sucesso**
- LOC rota: 1257 -> <600
- LOC page: 1475 -> <600

**Risco de não fazer**
> Conflitos de merge e revisão cada vez mais lentos.

**Dependências**: Nenhuma

---

## P3 — Baixo

### [availability-2] Filtrar a carteira por chaves no SQL quando o pedido for pequeno

**QA**: Availability (consolida também `security-2`, Security)
**Tactic alvo**: Increase Competence Set (Availability) / Detect Service Denial (Security)
**Esforço**: S
**Findings**: F-availability-2, F-security-2

**Problema**
> O export relê toda a carteira ativa para atender qualquer quantidade de chaves. Sob rajada de um usuário autenticado, o custo fica limitado só pelo `heavyRouteLimiter`.

**Melhoria Proposta**
> Repositório com busca por chaves (`= ANY($1)`, parametrizado) usada quando `chaves.length` for pequeno. Se o uso crescer, reaproveitar a leitura do painel (cache de segundos) ou reduzir o limite do `heavyRouteLimiter` para esta rota.

**Resultado Esperado**
> Custo proporcional ao pedido (hoje ~1,5 mil linhas lidas por export → apenas as pedidas). Leituras completas da carteira por export: 1 → 0 em cache hit.

**Métricas de sucesso**
- Linhas lidas por export pequeno: ~1,5 mil → ≈ nº de chaves

**Risco de não fazer**
> Custo cresce com a carteira; baixo hoje.

**Dependências**: Nenhuma (priorizar após medição de `availability-1`)

---

### [integrability-1] Centralizar o formato da chave de título

**QA**: Integrability
**Tactic alvo**: Manage Resource Coupling
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> O formato `filCod:docCod:titCod` é definido no regex da rota e montado no FE separadamente (F-integrability-1).

**Melhoria Proposta**
> Extrair helper de formatar/parsear chave num módulo de interface do backend e adicionar teste de paridade com o FE.

**Resultado Esperado**
> Definições do formato sem teste de paridade: 2 → 0.

**Métricas de sucesso**
- Testes de paridade de chave: 0 → 1

**Risco de não fazer**
> Quebra silenciosa em refactor futuro da chave.

**Dependências**: Nenhuma

---

### [testability-2] Afirmar dedupe, lista vazia e escala em `TitulosAPagarExportService`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-2, F-testability-3

**Problema**
> Chave duplicada, `chaves=[]` e um caso de 5000 chaves não têm afirmação explícita (F-testability-2, F-testability-3).

**Melhoria Proposta**
> Adicionar 3 `it`: duplicata conta como `ignorados` e gera uma linha só; lista vazia gera planilha com total 0; 5000 chaves sobre carteira sintética terminam rápido, em teste de sanidade sem relógio. Opcional: propriedade `fast-check` (total em centavos igual à soma das linhas). Tactic: Executable Assertions.

**Resultado Esperado**
> Casos do service 6 → 9; ramos sem afirmação 2 → 0.

**Métricas de sucesso**
- `it` em `TitulosAPagarExportService.test.ts`: 6 → 9

**Risco de não fazer**
> Baixo; a regra de dedupe pode mudar sem que nada falhe.

**Dependências**: Nenhuma

---

### [deployability-1] Documentar ordem de deploy backend antes do frontend para rotas novas

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> O botão de export no frontend depende da rota nova no backend, e os dois deploys são independentes. Há uma janela curta com 404 se a ordem se inverter.

**Melhoria Proposta**
> Registrar em `DEPLOY.md` a regra "rota aditiva: backend primeiro". Opcionalmente, o botão trata 404 com mensagem clara ("atualize a página"). Tactic: Scale Rollouts.

**Resultado Esperado**
> Janela de inconsistência conhecida e tratada: erro genérico → mensagem orientativa; ordem documentada.

**Métricas de sucesso**
- Regra de ordem de deploy documentada: não → sim

**Risco de não fazer**
> Erros transitórios e chamados pontuais a cada rota nova.

**Dependências**: Nenhuma

---

### [fault-tolerance-1] Documentar o export como leitura best-effort

**QA**: Fault Tolerance
**Tactic alvo**: Comparison
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-1

**Problema**
> As três leituras do export não compartilham snapshot; hoje isso não é registrado como decisão.

**Melhoria Proposta**
> Adicionar comentário/ADR curto no service: leitura best-effort aceita porque o export é read-only; se a coluna "Lote" virar base de decisão, usar uma transação `REPEATABLE READ`.

**Resultado Esperado**
> Decisão explícita registrada (0 → 1 nota); sem mudança de comportamento.

**Métricas de sucesso**
- Decisão documentada: 0 → 1

**Risco de não fazer**
> Alguém reutiliza o service para fluxo de escrita assumindo consistência que não existe.

**Dependências**: Nenhuma
