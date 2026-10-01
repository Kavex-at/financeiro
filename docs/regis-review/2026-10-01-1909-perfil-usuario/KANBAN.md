---
type: regis-review-kanban
run_id: 2026-10-01-1909-perfil-usuario
total: 22
counts: { p0: 0, p1: 0, p2: 13, p3: 9 }
---

# Kanban — financeiro — 2026-10-01-1909-perfil-usuario

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> Escopo: delta da feature `perfil-usuario` (--quick). 25 cards de origem, 22 após deduplicação cross-QA (3 fusões; ver "Consolidado de" nos cards afetados e REPORT.md seção 7). Demais cards copiados verbatim das seções QA.

---

## P0 — Crítico

Nenhum card. Nenhum QA registrou finding P0 (delta 100% leitura, sem escrita financeira, sem chamada externa).

---

## P1 — Alto

Nenhum card. Nenhum QA registrou finding P1 com baseline defensável.

---

## P2 — Médio

### [availability-1] Impor statement_timeout nas leituras do perfil

**QA**: Availability (consolidado com Fault Tolerance)
**Tactic alvo**: Exception Prevention (Fault Tolerance: Timeout)
**Esforço**: S
**Findings**: F-availability-1, F-fault-tolerance-1
**Consolidado de**: availability-1 + fault-tolerance-1 (mesma correção; o escopo do job validador vem de fault-tolerance-1)

**Problema**
> `/me/atividade` e `/me/historico` consultam até 366 dias (11 UNIONs, 2 conexões paralelas) sem `statement_timeout`; só o `connectionTimeoutMillis` (`PostgreeDatabaseClient.ts:105`) existe.
> (fault-tolerance-1) Hoje o volume é pequeno, mas ao crescer uma query lenta ocupa o pool compartilhado com os fluxos financeiros.

**Melhoria Proposta**
> Executar as queries do perfil com `SET LOCAL statement_timeout` (ex.: 5s) em transação curta no `AtividadeUsuarioRepository`, mapeando o cancelamento para 503 amigável.
> (fault-tolerance-1) Aplicar também em `PerfilRepository`; no job validador, `statement_timeout` na conexão (`validate-perfil-usuario-v1.ts:283`).

**Resultado Esperado**
> Teto de retenção de conexão por request: ilimitado → ≤5s.
> (fault-tolerance-1) Leituras do perfil limitadas a um teto: 0 timeouts definidos → 3 pontos com teto (2 repositórios + job).

**Métricas de sucesso**
- Queries do delta com timeout explícito: 0 → todas
- Teste que simula estouro e verifica seção com erro/503: 0 → 1

**Risco de não fazer**
> Lentidão do banco faz a tela de perfil competir com os fluxos de escrita pelo pool. Em 6 meses, com tabelas maiores, o perfil pode segurar conexões e degradar operações.

**Dependências**: Nenhuma

---

### [availability-2] Instrumentar latência e erros de /me*

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> Nenhuma métrica/alarme cobre as três rotas novas; infra ainda não existe.

**Melhoria Proposta**
> Registrar duração e status por rota via LogService e, quando houver Terraform, criar alarme de p95 e 5xx.

**Resultado Esperado**
> Alarmes para /me*: 0 → 2 (p95, 5xx).

**Métricas de sucesso**
- Rotas com métrica: 0/3 → 3/3

**Risco de não fazer**
> Regressões de latência só surgem por reclamação de usuário.

**Dependências**: scaffold de infra para o alarme (a parte de LogService não depende)

---

### [deployability-1] Registrar a migration 0072 no DEPLOY.md e no rollbacks/README.md

**QA**: Deployability (consolidado com Fault Tolerance)
**Tactic alvo**: Script Deployment Commands (Fault Tolerance: Rollback)
**Esforço**: S (≤1d)
**Findings**: F-deployability-1, F-fault-tolerance-3
**Consolidado de**: deployability-1 + fault-tolerance-3 (ambos pedem o runbook da 0072 no DEPLOY.md)

**Problema**
> A 0072 (11 índices) tem reverse escrito e testado, mas DEPLOY.md e rollbacks/README.md não a citam (0 menções).
> (fault-tolerance-3) O rollback é manual, fora do runner, e só documentado no cabeçalho do arquivo.

**Melhoria Proposta**
> Adicionar a 0072 à seção de migrations do DEPLOY.md (aditiva, idempotente, rollback manual via psql) e ao README de rollbacks.
> (fault-tolerance-3) No passo do DEPLOY.md: quando dropar, comando psql, confirmação de que só há perda de desempenho.

**Resultado Esperado**
> Documentos que citam a 0072: 0 → 2. Rollback executável por qualquer operador: 0 → 1 seção de runbook.

**Métricas de sucesso**
- Documentos que citam a 0072: 0 → 2
- Runbook de reverse da 0072: 0 → 1

**Risco de não fazer**
> Rollback lento e dependente de quem escreveu a migration.

**Dependências**: Nenhuma

---

### [integrability-2] Fixar o contrato de POST /me/senha antes de ligar a flag

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> O mapeamento de respostas em `senha.ts:46-59` assume um backend que não existe; desvio cai em `indisponivel`.

**Melhoria Proposta**
> No tweak `feat/auth-senha-propria`, definir o schema Zod compartilhado da resposta e um teste de contrato por desfecho (204, 400 POLITICA, 422, 429, 5xx); só então trocar `SENHA_PROPRIA_HABILITADA`.

**Resultado Esperado**
> Desfechos verificados: 0/5 → 5/5 antes do go-live.

**Métricas de sucesso**
- Desfechos cobertos por contrato: 0/5 → 5/5

**Risco de não fazer**
> Erro de integração mascarado como "indisponível".

**Dependências**: backend `feat/auth-senha-propria`

---

### [performance-2] Reduzir a rajada de conexões e consultas redundantes no mount de /perfil

**QA**: Performance
**Tactic alvo**: Limit Event Response
**Esforço**: S
**Findings**: F-performance-2, F-performance-3

**Problema**
> O mount dispara até 5 consultas simultâneas contra um pool de 5, e quem tem período salvo gera uma busca de atividade descartada (2 agregados inúteis).

**Melhoria Proposta**
> Adiar o fetch de atividade até a preferência do localStorage ser lida (sem fetch com o período padrão antes disso) e usar `AbortController` nos `useEffect` de busca. Opcionalmente, unir `agregados(atual)` e `agregados(anterior)` num único SQL (duas janelas, uma ida ao banco) para usar 1 conexão. Tactic: Limit Event Response / Reduce Overhead.

**Resultado Esperado**
> Requisições `/me/atividade` por carga com período salvo: 2 → 1; conexões simultâneas de pico por carga: 5 → ≤ 4.

**Métricas de sucesso**
- `/me/atividade` por carga com período salvo: 2 → 1
- Conexões de pool no pico por carga: 5 → ≤ 4

**Risco de não fazer**
> Contenção do pool compartilhado se a latência do Supabase subir; custo pequeno, mas cresce com o número de analistas.

**Dependências**: Nenhuma

---

### [security-1] Atualizar `next` e dependências high do frontend

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-1

**Problema**
> `npm audit` do frontend marca 1 critical (`next`) e 7 high. A branch não os introduz, mas `/perfil` aumenta a exposição de dados do usuário no mesmo runtime.

**Melhoria Proposta**
> Subir `next` para a versão corrigida e rodar `npm audit fix` nas transitivas (postcss, ws, sharp etc.). Adicionar `npm audit --audit-level=high` ao CI do frontend. Tactic: Limit Exposure.

**Resultado Esperado**
> `npm audit`: critical 1 → 0, high 7 → 0.

**Métricas de sucesso**
- critical: 1 → 0
- high: 7 → 0

**Risco de não fazer**
> CVE crítico do framework segue exposto em produção por meses.

**Dependências**: Nenhuma (verificar changelog do Next para breaking changes)

---

### [testability-2] Congelar o relógio em page.test.tsx

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> `page.test.tsx:105` usa `Date.now()` real.

**Melhoria Proposta**
> `jest.useFakeTimers().setSystemTime(...)` no `beforeEach` e constante `AGORA` para derivar `em`.

**Resultado Esperado**
> Leituras de tempo reais em testes do delta 1 → 0.

**Métricas de sucesso**
- `Date.now()` sem fake timers: 1 → 0

**Risco de não fazer**
> Flake em borda de horário.

**Dependências**: Nenhuma (relacionado a Modifiability: clock injetável)

---

### [testability-3] Testes diretos de lib/api/perfil e lib/perfil/senha + piso por pasta

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> 241 LOC de lib sem teste direto e o frontend só tem piso por pasta em `lib/auth/`.

**Melhoria Proposta**
> Criar `perfil.test.ts` (parsing, erros HTTP) e `senha.test.ts` (regras); medir cobertura e adicionar `./lib/perfil/` e `./lib/api/` em `coverageThreshold` com o valor medido arredondado para baixo.

**Resultado Esperado**
> Testes diretos lib/perfil 0 → 2 arquivos; pisos por pasta FE 1 → 3.

**Métricas de sucesso**
- arquivos de teste: 0 → 2
- pisos por pasta: 1 → 3

**Risco de não fazer**
> Regressão em regra de senha passa pelo gate.

**Dependências**: rodar coverage (fora do `--quick`) para obter o piso

---

### [integrability-1] Ancorar o contrato do perfil em schema único e teste de contrato

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: M
**Findings**: F-integrability-1, F-integrability-2

**Problema**
> O FE redeclara ~15 tipos e faz `res.json() as T` (`perfil.ts:152`); BE e FE são testados com mocks mútuos.

**Melhoria Proposta**
> Exportar schemas Zod de resposta (BE) e importá-los no FE para `parse` em `lerJson`, ou teste de contrato que valide a resposta real das 3 rotas contra os tipos do FE. Incluir o filtro `tipo` (ou removê-lo do BE).

**Resultado Esperado**
> Drift quebra o CI. Respostas validadas: 0/3 → 3/3.

**Métricas de sucesso**
- Rotas com contract test: 0 → 3
- Parâmetros sem consumidor: 1 → 0

**Risco de não fazer**
> Renomeação de campo quebra a tela só em produção.

**Dependências**: Nenhuma

---

### [modifiability-1] Criar guarda de paridade KPI perfil x metricas_ciclo em CI

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: M
**Findings**: F-modifiability-1

**Problema**
> A regra de KPI vive em AGREGADOS_SQL e em `metricas.metricas_ciclo()`, e a âncora da semana em BE, FE e SQL. Só há verificação manual (350 comparações, 0 divergências).

**Melhoria Proposta**
> Teste de integração SQL (harness local PG já existe, 36/36) comparando as duas fontes em dataset fixo; ou fazer AGREGADOS_SQL consumir a função. Tactic: Abstract Common Services.

**Resultado Esperado**
> Divergência quebra o CI; guardas automáticas 0 -> 1.

**Métricas de sucesso**
- Guardas de paridade em CI: 0 -> 1
- Sítios de regra por KPI: 2 -> 1 (ou 2 com guarda)

**Risco de não fazer**
> As telas /metricas e /perfil divergem após a próxima alteração de regra.

**Dependências**: Nenhuma

---

### [modifiability-2] Quebrar o histórico em fontes por frente

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-2

**Problema**
> Um repositório de 442 LOC concentra 11 ramos UNION ALL.

**Melhoria Proposta**
> Extrair fragmentos SQL por frente (módulos de constantes) compostos no repositório. Tactic: Split Module.

**Resultado Esperado**
> Arquivo principal < 250 LOC; nova fonte = 1 fragmento + 1 linha de composição.

**Métricas de sucesso**
- LOC do repositório: 442 -> < 250
- Ramos por arquivo: 11 -> ≤ 4

**Risco de não fazer**
> O arquivo passa de 600 LOC quando entrar a próxima frente.

**Dependências**: modifiability-1 (rede de segurança)

---

### [modifiability-3] Decompor seções e job com complexidade > 15

**QA**: Modifiability
**Tactic alvo**: Refactor
**Esforço**: M
**Findings**: F-modifiability-3, F-modifiability-4

**Problema**
> AtividadeSection (35), HistoricoSection (22) e o main do job de validação (35) excedem o limite 15.

**Melhoria Proposta**
> Extrair subcomponentes/hooks e funções puras (formatação por tipo de evento, passos do job). Tactic: Refactor. Aproveitar para agrupar as constantes P3 (F-modifiability-4) num módulo de configuração, se conveniente.

**Resultado Esperado**
> Funções acima do limite 3 -> 0; testes existentes (319/319) seguem verdes.

**Métricas de sucesso**
- Funções com complexidade > 15: 3 -> 0

**Risco de não fazer**
> A tela de perfil vira ponto de atrito a cada ajuste de UX.

**Dependências**: Nenhuma (recomendado após testability-1, que dá a rede de segurança na UI)

---

### [testability-1] Testar AtividadeSection e HistoricoSection isoladamente

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M
**Findings**: F-testability-1

**Problema**
> 771 LOC de UI de atividade/histórico só passam por `page.test.tsx` (374 LOC); falhas não se isolam.

**Melhoria Proposta**
> Criar `AtividadeSection.test.tsx` e `HistoricoSection.test.tsx` com props/fetch mockados cobrindo vazio, erro, paginação por cursor e troca de período.

**Resultado Esperado**
> Testes dedicados 0 → 2 arquivos (≥10 casos); `page.test.tsx` fica só com integração de página.

**Métricas de sucesso**
- arquivos de teste dedicados: 0 → 2
- razão test/source delta FE: 0,44 → ≥0,56

**Risco de não fazer**
> Toda mudança no histórico exige depurar a página inteira.

**Dependências**: Nenhuma

---

## P3 — Baixo

### [availability-3] Degradar o comparativo de atividade sem derrubar o período atual

**QA**: Availability (consolidado com Fault Tolerance)
**Tactic alvo**: Degradation (Fault Tolerance: Increase Competence Set)
**Esforço**: S
**Findings**: F-availability-3, F-fault-tolerance-2
**Consolidado de**: availability-3 + fault-tolerance-2 (mesmo `Promise.all` em `PerfilService.ts:92,124`)

**Problema**
> `Promise.all` em `PerfilService.ts:124` falha por inteiro se o período anterior falhar.

**Melhoria Proposta**
> Usar `Promise.allSettled` para o período anterior e devolver `anterior: null` com aviso na UI.

**Resultado Esperado**
> Falha parcial: resposta 100% perdida → só o comparativo ausente.

**Métricas de sucesso**
- Respostas sem dados mesmo com período atual ok: 1 → 0
- Cenários de falha parcial com resposta degradada testados: 0 → 1

**Risco de não fazer**
> Marginal; o retry por seção cobre.

**Dependências**: ajuste de contrato na UI (`/me/atividade`)

---

### [deployability-2] Documentar regra para CREATE INDEX CONCURRENTLY em tabelas grandes

**QA**: Deployability
**Tactic alvo**: Surge Protection
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> A 0072 omite CONCURRENTLY por causa do runner transacional; correto a ~200 linhas, mas o padrão pode ser copiado para tabelas maiores.

**Melhoria Proposta**
> Registrar em DEPLOY.md um limiar (ex.: >100k linhas exige migration fora de transação) e o procedimento.

**Resultado Esperado**
> Limiar documentado: 0 → 1 regra.

**Métricas de sucesso**
- Regra documentada: 0 → 1

**Risco de não fazer**
> Lock de escrita numa migration futura em tabela grande.

**Dependências**: deployability-1

---

### [deployability-3] Avaliar flag de rollout para novas páginas de UI

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤1d)
**Findings**: F-deployability-3

**Problema**
> /perfil é publicada a 100% dos usuários no merge, sem flag.

**Melhoria Proposta**
> Opcional: flag simples (env `NEXT_PUBLIC_*`) para ocultar o item do UserMenu; só vale se o time quiser rollout gradual de UI.

**Resultado Esperado**
> Flags de rollout de UI: 0 → 1 (opcional).

**Métricas de sucesso**
- Páginas novas com flag: 0 → 1

**Risco de não fazer**
> Baixo; rollback Vercel cobre.

**Dependências**: Nenhuma

---

### [integrability-3] Centralizar a base URL da API no frontend

**QA**: Integrability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-integrability-4

**Problema**
> `API` é declarada em 11 arquivos do FE (2 no delta).

**Melhoria Proposta**
> Extrair para `lib/http` (junto de `apiFetch`) e migrar `perfil.ts` e `senha.ts` no ato; o restante proporcionalmente em tweaks.

**Resultado Esperado**
> Declarações: 11 → 1.

**Métricas de sucesso**
- Arquivos declarando a base: 11 → 1

**Risco de não fazer**
> Trocar origem/versão da API custa 11 edições.

**Dependências**: Nenhuma

---

### [performance-1] Medir /perfil sob volume sintético e com a 0072 aplicada em prod

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S
**Findings**: F-performance-4

**Problema**
> O EXPLAIN de prod foi tirado sem a 0072 e o plano com índices só foi provado em banco local com `enable_seqscan=off`. Não sabemos em que volume o `Sort` global sobre o `Append` de 11 ramos passa a pesar.

**Melhoria Proposta**
> Após a 0072 em prod, repetir `validate-perfil-usuario-v1.ts --historico --explain`; em staging, popular os ledgers com 100 mil linhas por tabela (usuário com 5 mil eventos em 30 dias) e registrar plano e p95 de `/me/historico` e `/me/atividade`. Se o p95 estourar, empurrar `ORDER BY ... LIMIT` para dentro de cada ramo. Tactic: Increase Resource Efficiency.

**Resultado Esperado**
> Evidência de plano por índice em 11/11 ramos e p95 documentado: hoje ~0,55 ms (centenas de linhas) → ≤ 50 ms com 100 mil linhas por tabela.

**Métricas de sucesso**
- Ramos com índice no plano de prod: 0/11 (0072 não aplicada) → 11/11 (ou Seq Scan justificado pelo volume)
- Execution Time do histórico com 100 mil linhas por tabela: não medido → ≤ 50 ms

**Risco de não fazer**
> A degradação aparece primeiro como lentidão no `/perfil` de quem mais usa a plataforma, sem alerta.

**Dependências**: 0072 aplicada em prod

---

### [performance-3] Memoizar agregados de períodos fechados (período anterior)

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> O período anterior é imutável quando fechado, mas é recalculado em toda visita, dobrando as consultas de agregados.

**Melhoria Proposta**
> Cache em memória por `(username, inicio, fim)` com TTL (ex.: 10 min) apenas para períodos cujo `fim` já passou; o período atual segue sem cache. Só implementar se o p95 de `/me/atividade` passar de 100 ms após o card performance-1. Tactic: Maintain Multiple Copies of Computations.

**Resultado Esperado**
> Consultas de agregados por requisição: 2 → 1 em visitas repetidas (taxa de acerto ≥ 50%); p95 de `/me/atividade` mantido ≤ 100 ms sob volume sintético.

**Métricas de sucesso**
- Agregados executados por requisição com cache quente: 2 → 1

**Risco de não fazer**
> Baixo; custo desprezível nos volumes atuais.

**Dependências**: performance-1 (decidir com número)

---

### [security-2] Redigir usernames na saída do job de validação

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-2

**Problema**
> `validate-perfil-usuario-v1.ts` imprime planos EXPLAIN com usernames reais; a troca por `<ator>` no doc commitado é manual.

**Melhoria Proposta**
> Substituir programaticamente `atores[]` por `<ator>` antes do `console.log` dos planos (`:431-434`) e fixar um teste em `validatePerfilUsuarioIsolation.test.ts`. Tactic: Limit Exposure.

**Resultado Esperado**
> Pontos de impressão sem redação: 1 → 0.

**Métricas de sucesso**
- impressões de username real: 1 → 0

**Risco de não fazer**
> Um commit futuro de `explain.md` pode levar identificadores reais.

**Dependências**: Nenhuma

---

### [security-3] Rate limit leve e métrica de 400 em `/me/*`

**QA**: Security
**Tactic alvo**: Detect Service Denial
**Esforço**: S
**Findings**: F-security-3, F-security-4

**Problema**
> As rotas `/me/*` não têm limiter e os 400 por parâmetro/cursor inválido não geram métrica; sondagem repetida passa despercebida.

**Melhoria Proposta**
> Limiter por `userId` (ex.: 60 req/min) em `/me/historico` e contador de `PerfilQueryInvalidError`/400 para detecção. Opcional: HMAC no cursor. Tactics: Detect Service Denial, Detect Intrusion.

**Resultado Esperado**
> Rotas com limiter: 0/3 → 3/3; 400 repetidos visíveis em métrica.

**Métricas de sucesso**
- rotas com limiter: 0/3 → 3/3

**Risco de não fazer**
> Baixo; perde-se visibilidade de sondagem.

**Dependências**: política de rate limit do backend (cross-QA Availability); compartilha o contador de métricas com availability-2

---

### [testability-4] Casos de erro de transporte e teste de propriedade (baixa prioridade)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-4, F-testability-5

**Problema**
> SegurancaSection sem caso de fetch rejeitado/401; `fast-check` sem uso.

**Melhoria Proposta**
> Adicionar 2 casos (rejeição, 401) em `SegurancaSection.test.tsx`; propriedade de round-trip para `HistoricoCursor` e `periodo.ts`.

**Resultado Esperado**
> Casos de erro SegurancaSection 0 → 2; testes de propriedade 0 → 2.

**Métricas de sucesso**
- casos SegurancaSection: 7 → 9
- propriedades fast-check: 0 → 2

**Risco de não fazer**
> Baixo; bordas continuam só manuais.

**Dependências**: Nenhuma (confirmar antes se os casos já existem: o QA não leu o arquivo integralmente)

---
