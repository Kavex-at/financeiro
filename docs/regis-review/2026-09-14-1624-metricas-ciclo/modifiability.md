---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-modifiability
generated_at: 2026-09-14T17:05:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 6
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Yuri responde G1/G2/G3, ou o negócio pede uma métrica nova, uma 3ª frente (SISPAG), muda a semântica de "borderô desfeito" na tela, ou muda o fuso da operação | Requisição de alteração no read-model `metricas.vw_metricas_ciclo` ou nos ledgers de origem | `src/backend/migrations/0058_vw_metricas_ciclo.sql` + testes estáticos/integração + o comentário-espelho `BorderoGestaoService.situacaoDoItem` | Desenvolvimento (código em worktree) — sem impacto de runtime; a migration nova é aplicada em produção via `BootMigrator` no boot seguinte | Nova migration `0059_*` que altera função/view via `CREATE OR REPLACE`; testes estáticos e de integração continuam verdes; o contrato de 9 colunas do `metrics.py` permanece; a chave `metrica` nunca é renomeada (I-M6) | Adicionar 1 métrica ≤ 30 LOC editadas em 1 migration + 1 caso de teste; adicionar 1 frente ≤ 80 LOC + 4 casos de teste; alterar semântica de "desfeito" requer edição sincronizada em 2 sítios (SQL + TS) — hoje sem cinta |

Este delta é read-model puro — sem entidade, sem ação, sem estado novo (`entity_changed = false` na ADR-0045). O que ele deixa fácil é somar métrica nova por UNION ALL; o que ele deixa arriscado é qualquer mudança que atravesse a fronteira SQL↔TS (definição de "borderô desfeito") ou SQL↔Python (contrato das 9 colunas com o `kavex-report-ciclo`).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC do arquivo de migration | 271 | ≤ 600 | ✅ | `wc -l src/backend/migrations/0058_vw_metricas_ciclo.sql` |
| LOC do corpo da função `metricas_ciclo` | 138 (linhas 76–213) | ≤ 200 | ✅ | leitura direta |
| LOC do teste estático | 109 | ≤ 200 | ✅ | `wc -l vwMetricasCiclo.test.ts` |
| LOC do teste de integração | 277 | ≤ 400 | ✅ | `wc -l vwMetricasCiclo.integration.test.ts` |
| Arquivos tocados pela feature (produção) | 1 (0058_vw_metricas_ciclo.sql) | ≤ 3 por feature localizada | ✅ | `git diff --stat 14ca71a..HEAD` |
| Sítios com a regra "borderô desfeito" (cancelado ou estornado) | 2 (SQL linha 122 + `BorderoGestaoService.situacaoDoItem:596-604`) | 1 (ou 2 com linkage automático) | ❌ | `grep -n bor_vld_finalizado \| bor_cod_estornado` |
| Occurrences de `'America/Sao_Paulo'` na migration | 4 (linhas 116, 141, 142, 238) | ≤ 1 (constante) ou parametrizado | ⚠️ | `grep -c America/Sao_Paulo 0058_*.sql` |
| Occurrences de `INTERVAL '7 days'` | 3 (linhas 93, 96, 97) | ≤ 1 | ⚠️ | `grep -n "INTERVAL '7 days'"` |
| Fronte hardcoded no corpo da função | 2 CTEs (`permutas`, `recebimentos`) + 4 UNION ALL | plugin/registro por frente | ⚠️ | leitura direta linhas 100–201 |
| Séries hardcoded (`serie_inicio`) | 1 literal em `metricas_ciclo_vigente()` (linha 237) | tabela `metricas.serie_config` ou similar | ⚠️ | linha 237 |
| Fan-in interno da view (código do backend consultando-a) | 0 | 0 (a view é para consumidor externo `metrics.py`) | ✅ | `grep -rn "vw_metricas_ciclo\|metricas\\." src/backend --include='*.ts'` |
| Cross-layer violations (domain importando de lambda ou lambda pulando service) introduzidas pela feature | 0 | 0 | ✅ | delta não toca `src/backend/domain/**` nem `routes/**` |
| Contract-test cross-repo (o `metrics.py` valida forma do SELECT contra este repo) | 0 | ≥ 1 | ⚠️ | inspeção — `kavex-report-ciclo` vive fora deste repo |
| Cobertura de mutação nos testes estáticos | não medida | — | ⚠️ | Não medível: sem `stryker` configurado; a integração já derrubou `< janela_fim → <=` (2 testes) |
| Complexidade cognitiva das funções TS da feature | 0 novas funções TS na produção | ≤ 15 | ✅ | delta não introduz TS de produção |

> ⚠️ **Não medível localmente**: cobertura de mutação sistemática — requer `stryker-mutator` ou equivalente configurado. Recomendação: rodar mutação em `vwMetricasCiclo.test.ts` como spike; hoje o teste estático depende de regex e pode ser burlado por reformatação (F-modifiability-5).

> ⚠️ **Não medível localmente**: contrato entre SQL e `kavex-report-ciclo/scripts/metrics.py`. O consumidor está em outro repositório e não roda em CI daqui. Recomendação: expor `metricas.contrato_versao()` que devolve o SHA das 9 colunas e ter um smoke-test do lado Python (F-modifiability-4).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Migration única de 271 LOC concentra schema + 2 funções + view + role + grants. Cabe num arquivo, mas mistura provisionamento (role, grants) com lógica de agregação. | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:73-271` |
| Increase Semantic Coherence | O arquivo é coeso em torno de "surface `metricas`" e o comentário-cabeçalho declara o contrato. A função `metricas_ciclo` mistura duas frentes (I e IV) num único corpo em vez de compor a partir de sub-funções por frente. | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:100-130` (Permutas) `:131-143` (Recebimentos) |
| Encapsulate | Consumidor externo só vê a view; a função DEFINER esconde os ledgers do leitor. Contrato de 9 colunas encapsulado por `RETURNS TABLE`. Bom encapsulamento externo. | ✅ presente | `0058_vw_metricas_ciclo.sql:76-88, 244-255` |
| Use an Intermediary | `metricas_ciclo_vigente()` é intermediária entre a view e a função parametrizada — exatamente para resolver o issue de `EXECUTE` do Postgres. Excelente uso de intermediário; documentado no cabeçalho. | ✅ presente | `0058_vw_metricas_ciclo.sql:217-240` |
| Restrict Dependencies | Schema próprio `metricas` fora do PostgREST; role `metricas_ciclo_leitor` só recebe USAGE + EXECUTE na vigente + SELECT na view — nada nas tabelas. `search_path = ''` no DEFINER. | ✅ presente | `0058_vw_metricas_ciclo.sql:259-271` + teste `leitor.query('SELECT 1 FROM public.permuta_alocacao_execucao')).rejects.toThrow(/permission denied/)` |
| Refactor | Regra "borderô desfeito" está duplicada entre SQL e `BorderoGestaoService.situacaoDoItem` sem linkage. O comentário aponta ("a mesma derivação da tela") mas não há mecanismo. | ❌ ausente | SQL linha 122 vs `BorderoGestaoService.ts:596-604` |
| Abstract Common Services | Não existe função SQL `metricas.bordero_desfeito(bor_cod, fil_cod)` reutilizável; o EXISTS está inline. Cada frente também está inline em vez de ser uma função `metricas.linhas_permutas(janelas)` composável. | ❌ ausente | `0058_vw_metricas_ciclo.sql:117-123, 100-143` |
| Defer Binding — configuration | Série (`2026-09-11 20:00`), fuso (`America/Sao_Paulo`), janela (`INTERVAL '7 days'`) e conjunto de frentes: todos hardcoded no SQL. Alterações exigem nova migration. Documentado no ADR-0045 D4 como escolha consciente ("regra 2 do brief"), mas o custo de mudar não some. | ⚠️ parcial | linhas 93/96/97 (janela), 116/141/142/238 (TZ), 237 (série) |
| Defer Binding — polymorphism | N/A — SQL não é a superfície certa para polimorfismo em runtime. Frentes poderiam ser plugins via UNION de sub-funções (`metricas.linhas_frente_I`, `metricas.linhas_frente_IV`), o que é o mesmo pattern com sabor SQL. | ⚠️ parcial | linhas 145–201 (UNION ALL inline) |
| Defer Binding — runtime registration | Consumidor descobre linhas lendo a view; formato é fixo pelo `RETURNS TABLE`. Adicionar métrica = migration nova; consumidor absorve sem código novo (rótulo carrega o significado). Excelente para o consumidor, custa uma migration por mudança. | ✅ presente | contrato de 9 colunas + `metrica` como chave |

## 4. Findings (achados)

### F-modifiability-1: Regra "borderô desfeito" duplicada entre SQL e TypeScript sem linkage

- **Severidade**: P1
- **Tactic violada**: Abstract Common Services / Refactor
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:117-123` e `src/backend/domain/service/permutas/BorderoGestaoService.ts:596-604`
- **Evidência (objetiva)**:
  ```sql
  -- 0058_vw_metricas_ciclo.sql:117-123
  EXISTS (
      SELECT 1
      FROM public.permuta_bordero b
      WHERE b.fil_cod = x.fil_cod
        AND b.bor_cod = x.bor_cod
        AND (b.bor_vld_finalizado = 2 OR b.bor_cod_estornado IS NOT NULL)
  ) AS desfeita
  ```
  ```ts
  // BorderoGestaoService.ts:596-604
  private situacaoDoItem = (item: {...}): BorderoSituacao => {
      if (item.borCodEstornado != null) return 'ESTORNADO';
      if (item.borVldFinalizado === 1) return 'FINALIZADO';
      if (item.borVldFinalizado === 2) return 'CANCELADO';
      return 'EM_CADASTRO';
  };
  ```
- **Impacto técnico**: Uma nova situação de borderô (ex.: um `bor_vld_finalizado = 3` que também "desfaz" a baixa) precisa ser refletida em dois arquivos, com linguagens diferentes. A ADR-0045 explicita "a mesma derivação de `BorderoGestaoService.situacaoDoItem`" no D3, mas nem o `typecheck`, nem o `lint`, nem o PatternGuardian pegam se a SQL ficar para trás.
- **Impacto de negócio**: A taxa de "concluídas" da Frente I pode passar a divergir da tela de borderôs sem alarme — a semana de 2026-06-19 já mostrou que a regra é sensível a ~11% do volume. Report semanal e tela dando números diferentes sobre o mesmo evento é falha de credibilidade do produto.
- **Métrica de baseline**: 2 sítios (SQL:122 + TS:596-604); 0 mecanismos de linkage. `git grep 'bor_vld_finalizado\|bor_cod_estornado' src/backend | wc -l` = 15 sítios totais no repo (produção + testes); as duas cópias que definem "desfeito" não têm cinta.

### F-modifiability-2: Adicionar frente exige editar o corpo monolítico da função `metricas_ciclo`

- **Severidade**: P2
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:100-201`
- **Evidência (objetiva)**:
  ```
  WITH janelas AS (...),
       permutas AS (...),          -- Frente I inline, 30 LOC (100-130)
       recebimentos AS (...),      -- Frente IV inline, 13 LOC (131-143)
       linhas AS (
           SELECT ... FROM permutas WHERE tentativas > 0     -- % Frente I
           UNION ALL SELECT ... FROM permutas                -- R$ Frente I
           UNION ALL SELECT ... FROM recebimentos WHERE ...  -- % Frente IV
           UNION ALL SELECT ... FROM recebimentos            -- R$ Frente IV
       )
  ```
- **Impacto técnico**: Adicionar SISPAG (Frente II) exige uma migration `0059_*` com `CREATE OR REPLACE FUNCTION metricas.metricas_ciclo` reescrevendo o corpo inteiro — não dá para "estender" uma função SQL em Postgres. Também obriga tocar `vwMetricasCiclo.test.ts` (guarda estática das 9 colunas ok, mas asserts de "duas frentes" mudam) e o teste de integração (nova seed, novos casos).
- **Impacto de negócio**: A 3ª frente prevista (SISPAG) ainda não emite operação real (interview.md, "Fora de escopo"). Quando emitir, o custo de plugá-la ao report é uma migration ~40 LOC + ~4 casos de teste, que já é aceitável para o volume atual — mas cresce como O(frentes × métricas) porque o corpo é monolítico.
- **Métrica de baseline**: 2 CTEs de frente + 4 UNION ALL = 138 LOC de corpo hoje; adicionar uma 3ª frente projeta ~+40 LOC e reescrita completa do `CREATE OR REPLACE`.

### F-modifiability-3: Fuso hardcoded 4×; janela hardcoded 3×; série hardcoded 1×

- **Severidade**: P2
- **Tactic violada**: Defer Binding (configuration)
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:93,96,97,116,141,142,237,238`
- **Evidência (objetiva)**:
  ```
  linha 93:  g.inicio + INTERVAL '7 days'
  linha 96:  p_agora - INTERVAL '7 days'
  linha 97:  INTERVAL '7 days'
  linha 116: x.criado_em AT TIME ZONE 'America/Sao_Paulo'
  linha 141: (s.criado_em AT TIME ZONE 'America/Sao_Paulo') >= j.janela_inicio
  linha 142: (s.criado_em AT TIME ZONE 'America/Sao_Paulo') < j.janela_fim
  linha 237: TIMESTAMP '2026-09-11 20:00:00'
  linha 238: (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')
  ```
- **Impacto técnico**: Trocar granularidade (ex.: rollup diário) ou fuso (outro cliente, outra operação) exige migration nova para cada mudança. G3 do gap (`início da série`) declara textualmente "a mudança é uma linha (`serie_inicio`) numa migration nova". Já é o custo aceito, mas 8 literais espalhados em vez de 1 constante local elevam a chance de esquecer um sítio numa edição futura.
- **Impacto de negócio**: Enquanto o cliente for só Columbia e o produto for só semanal em BRT, o custo é zero. No dia em que a mesma view atender outra conta AWS (o "SaaSo alvo" do CLAUDE.md), cada tenant vai carregar uma cópia do SQL com sua própria constante — copiar-e-colar migration é o vetor clássico de drift entre tenants.
- **Métrica de baseline**: 4 occurrences de `'America/Sao_Paulo'`, 3 de `INTERVAL '7 days'`, 1 de `TIMESTAMP '2026-09-11 20:00:00'` = 8 constantes literais, 0 factored para constante nomeada ou config table.

### F-modifiability-4: Contrato de 9 colunas com `metrics.py` sem contract-test cross-repo

- **Severidade**: P2
- **Tactic violada**: Encapsulate (o contrato existe, mas não é verificável dos dois lados)
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:76-88, 244-255` + `kavex-report-ciclo/scripts/metrics.py` (fora deste repo)
- **Evidência (objetiva)**: O teste `vwMetricasCiclo.test.ts` (linhas 17-27, 36-48) verifica as 9 colunas na ordem certa, do lado SQL. Do lado Python, o `metrics.py` (achados K1/K3/K4 em `metricas-ciclo-gap.md`) já mostra três desalinhamentos vivos hoje: `--fim` sem hora, `render.py` imprimindo `{valor}{unidade}` cru e "série iniciada" hardcoded. Nenhum é falha desta migration, mas os três provam que a fronteira entre os dois repos é descoberta em produção.
- **Impacto técnico**: Se um dia alguém renomear `janela_inicio` → `semana_inicio` numa migration `0059_*` sem alertar o consumidor, o `metrics.py` levanta `KeyError` só quando o report semanal for gerado. A guarda estática deste repo valida "a forma existe" mas não "a forma bate com quem lê".
- **Impacto de negócio**: Report semanal quebrando na sexta 20:00 é uma falha de baixa gravidade (o report é interno), mas exatamente o cenário que o gap.md classifica como P0 de merge — a chave da métrica é permanente e o cliente já vai ler.
- **Métrica de baseline**: 0 contract-tests cross-repo; 3 gaps K1/K3/K4 já capturados no ciclo atual antes de qualquer mudança de esquema, provando fragilidade da fronteira.

### F-modifiability-5: Testes estáticos dependem de regex sensível a reformatação

- **Severidade**: P3
- **Tactic violada**: Refactor (testabilidade da guarda como pré-requisito para mudar sem medo)
- **Localização**: `src/backend/migrations/vwMetricasCiclo.test.ts:37, 51-53, 70, 74`
- **Evidência (objetiva)**:
  ```ts
  const SQL = MIGRATION.replace(/--.*$/gm, '');   // não remove /* ... */
  const retornos = [...SQL.matchAll(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/g)];
  const view = SQL.match(/CREATE OR REPLACE VIEW metricas\.vw_metricas_ciclo AS\s+SELECT([\s\S]*?)FROM/);
  const definers = SQL.match(/SECURITY DEFINER\s+SET search_path = ''/g) ?? [];
  ```
- **Impacto técnico**: Adicionar um `/* comentário de bloco */` com a palavra `INSERT INTO` explicando algo (ex.: "esta view não faz INSERT INTO nenhuma tabela") derruba o teste 1 (linhas 30-34). Inserir um comentário entre `RETURNS TABLE` e `LANGUAGE sql` derruba o teste 2. As regex são estritas e casam com o layout atual — qualquer reformatação futura precisa de update sincronizado dos regex.
- **Impacto de negócio**: Fricção baixa (quem for reformatar percebe o teste vermelho e ajusta) mas é do tipo que faz o próximo autor evitar mexer no arquivo por medo de derrubar teste "que não é sobre o que ele está mudando". Erosão silenciosa da modificabilidade.
- **Métrica de baseline**: 4 regex acopladas a layout; 0 usam parser SQL. Alternativas viáveis: rodar `pg_get_functiondef` num Postgres descartável (mas isso já é o teste de integração) ou lint-parser em vez de regex. Baixa prioridade.

### F-modifiability-6: Provisionamento (role, grants, session settings) misturado com lógica na mesma migration

- **Severidade**: P3
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:257-271`
- **Evidência (objetiva)**:
  ```sql
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metricas_ciclo_leitor') THEN
      CREATE ROLE metricas_ciclo_leitor NOLOGIN;
  END IF; END $$;
  ALTER ROLE metricas_ciclo_leitor SET default_transaction_read_only = on;
  ALTER ROLE metricas_ciclo_leitor SET search_path = metricas;
  ALTER ROLE metricas_ciclo_leitor SET statement_timeout = '30s';
  GRANT USAGE ON SCHEMA metricas TO metricas_ciclo_leitor;
  GRANT EXECUTE ON FUNCTION metricas.metricas_ciclo_vigente() TO metricas_ciclo_leitor;
  GRANT SELECT ON metricas.vw_metricas_ciclo TO metricas_ciclo_leitor;
  ```
- **Impacto técnico**: Cada `CREATE OR REPLACE VIEW` em migrations futuras arrisca re-executar os ALTER ROLE / GRANT (que são idempotentes, ok) mas também mistura duas classes de mudança: "muda a definição da view/função" e "muda o perímetro do leitor". Alterar só o perímetro (ex.: subir `statement_timeout` para 60s) reescreve a migration inteira em vez de aplicar apenas o delta relevante.
- **Impacto de negócio**: Baixo hoje (uma migration, um leitor, um consumidor). Cresce se surgir 2° leitor (`metricas_ciclo_leitor_bi`, `metricas_ciclo_leitor_qa`) ou se outra frente precisar do próprio schema.
- **Métrica de baseline**: 1 arquivo mistura DDL de lógica (linhas 73-255) com provisionamento de identidade (linhas 257-271); 0 separação em migrations por responsabilidade.

## 5. Cards Kanban

### [modifiability-1] Extrair `metricas.bordero_desfeito(fil_cod, bor_cod)` como fonte única da regra

- **Problema**
  > A regra "borderô desfeito = CANCELADO ou ESTORNADO" está duplicada entre `0058_vw_metricas_ciclo.sql:117-123` e `BorderoGestaoService.situacaoDoItem:596-604`, sem cinta que garanta a sincronia. Uma mudança futura no que a tela considera "desfeito" (ex.: um novo `bor_vld_finalizado`) pode fazer a taxa da Frente I divergir do que o analista vê na UI, sem que typecheck, lint ou PatternGuardian percebam.

- **Melhoria Proposta**
  > Criar uma função SQL `metricas.bordero_desfeito(fil_cod, bor_cod) RETURNS boolean` (STABLE, `search_path=''`) que encapsula a regra e é consumida pela view via `WHERE metricas.bordero_desfeito(x.fil_cod, x.bor_cod)`. Do lado TS, manter `situacaoDoItem` como está, mas adicionar um comentário-âncora (`// SPEC-SYNC bordero-desfeito :: metricas.bordero_desfeito`) e um teste de integração no `vwMetricasCiclo.integration.test.ts` que confronta a saída da função SQL contra os quatro casos de `situacaoDoItem` num SEED comum. Tactic Bass: **Abstract Common Services**.

- **Resultado Esperado**
  > Uma única definição da regra em SQL; UI continua isolada mas coberta por teste espelhando os casos. Métrica: sítios da regra 2 → 2 (mesma quantidade), mas com 1 teste que quebra se qualquer um dos dois divergir. Custo de adicionar uma nova situação de borderô: 1 edição na função SQL + 1 na TS + o teste avisa se esqueceu.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Sítios materiais da regra: 2 → 2, com 1 teste de espelho
  - Mudanças futuras que exigem editar SQL e TS separadamente sem cinta: 100% → 0%
- **Risco de não fazer**: Numa semana em que o cliente notar divergência tela↔report, o time perde meia manhã reconciliando os dois valores e o produto perde credibilidade sobre "número auditável". A ADR-0045 D3 já sinalizou o acoplamento; formalizá-lo é barato agora, caro depois.
- **Dependências**: nenhuma

### [modifiability-2] Quebrar `metricas_ciclo` em sub-funções por frente

- **Problema**
  > Adicionar SISPAG (Frente II) ou uma métrica nova exige reescrever o corpo inteiro da função `metricas.metricas_ciclo` (linhas 76-213), porque Postgres não dá para "estender" uma função por partes. Hoje o corpo é 138 LOC com 2 CTEs de frente + 4 UNION ALL inline. Escala em O(frentes × métricas).

- **Melhoria Proposta**
  > Criar `metricas.linhas_permutas(p_janelas)` e `metricas.linhas_recebimentos(p_janelas)` (ambas STABLE, `RETURNS TABLE (mesmas 9 colunas)`), consumidas pela função-topo via `UNION ALL`. Quando SISPAG for medível, cria-se `metricas.linhas_sispag(p_janelas)` numa migration de ~15 LOC + 1 UNION ALL, sem tocar as outras frentes. Tactic Bass: **Split Module** + **Increase Semantic Coherence**.

- **Resultado Esperado**
  > Corpo da função-topo cai de 138 LOC para ~30. Adicionar uma frente = +1 arquivo lógico + 1 UNION ALL. Métricas: LOC-por-frente na função monolítica 138 / 2 = 69 → 15 (sub-função por frente); risco de regressão inter-frente ao mexer numa: alto → nulo.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC do corpo da função-topo: 138 → ≤ 40
  - LOC média por frente: 21 (não factored) → 15 (em sub-função)
  - Migrations necessárias para adicionar uma frente: 1 (reescreve tudo) → 1 (adiciona 1 função + 1 UNION)
- **Risco de não fazer**: Quando SISPAG virar operação real e Popula GED voltar (memória do usuário anota "descontinuada", ADR-0022 ainda menciona 4 frentes), a próxima migration reescreve os 138 LOC atuais. Cada reescrita `CREATE OR REPLACE` é uma janela de regressão silenciosa para as frentes que já funcionavam.
- **Dependências**: nenhuma; idealmente feito antes da 3ª frente entrar

### [modifiability-3] Extrair constantes de fuso, janela e série para o topo do arquivo

- **Problema**
  > O SQL tem 4 `'America/Sao_Paulo'`, 3 `INTERVAL '7 days'` e 1 `TIMESTAMP '2026-09-11 20:00:00'` espalhados. Trocar granularidade ou responder G3 (início da série) hoje exige nova migration — o que já é a política —, mas o autor da migration precisa achar as 8 constantes literais em vez de 1 sítio nomeado.

- **Melhoria Proposta**
  > Introduzir `CREATE OR REPLACE FUNCTION metricas.const_fuso() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'America/Sao_Paulo' $$;` e análogas `metricas.const_janela_dias()` e `metricas.const_serie_inicio()`. Uma migration futura que muda o parâmetro toca 1 função inline (idempotente por `CREATE OR REPLACE`). Alternativa mais leve: agrupar as 8 constantes num único bloco `-- CONSTANTES ---` no topo do arquivo com comentário sinalizando que são pontos de mudança. Tactic Bass: **Defer Binding**.

- **Resultado Esperado**
  > Alterar fuso: 4 sítios → 1 função IMMUTABLE (ou 1 constante nomeada). Métrica: `grep -c "'America/Sao_Paulo'" 0058_*.sql` de 4 para 0 (o único sítio literal fica na função `const_fuso`). Migrations futuras deixam evidente o que mudou.

- **Tactic alvo**: Defer Binding (configuration)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Occurrences de `'America/Sao_Paulo'`: 4 → 1
  - Occurrences de `INTERVAL '7 days'`: 3 → 1
  - Occurrences do literal de série: 1 → 1 (mas explicitamente nomeado)
- **Risco de não fazer**: Cross-cut com Deployability — quando outro cliente entrar (SaaSo alvo do CLAUDE.md), cada tenant carrega sua cópia dessas constantes; o vetor clássico de drift entre tenants é copy-paste de literal.
- **Dependências**: nenhuma

### [modifiability-4] Publicar `metricas.contrato_versao()` para amarrar o consumidor

- **Problema**
  > As 9 colunas do contrato são validadas por regex estática do lado SQL (`vwMetricasCiclo.test.ts`), mas o consumidor `kavex-report-ciclo/scripts/metrics.py` vive em outro repo e não roda CI daqui. Os achados K1/K3/K4 no `metricas-ciclo-gap.md` já mostraram 3 desalinhamentos vivos no ciclo atual (parsing de `--fim`, render sem separador, "série iniciada" hardcoded). Uma mudança futura no schema não tem cinta cross-repo.

- **Melhoria Proposta**
  > Publicar `metricas.contrato_versao() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'v1:frente,metrica,rotulo,valor,unidade,janela_inicio,janela_fim,baseline,baseline_desc' $$;` e conceder EXECUTE ao leitor. O `metrics.py` passa a fazer `SELECT metricas.contrato_versao()` antes de qualquer query e falha explicitamente com "contrato v1 esperado, achou v2" quando um dia migrar. Tactic Bass: **Encapsulate** (contrato formal versionado).

- **Resultado Esperado**
  > Fronteira SQL↔Python passa a falhar rápido, no primeiro `SELECT`, em vez de silenciosamente no `KeyError` do parser. Métrica: 0 → 1 contract-tests cross-repo (o próprio versionamento vira o teste). Custo de renomear uma coluna: bump da versão + gap explícito no PR.

- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (≤1d neste repo; ≤1d no `kavex-report-ciclo`)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Contract-tests cross-repo: 0 → 1
  - Detecção de renomeação de coluna: no primeiro report semanal → no primeiro `SELECT` do `metrics.py`
- **Risco de não fazer**: Uma renomeação inadvertida derruba o report da sexta-feira 20:00 com traceback do parser Python; ninguém liga a falha à migration `0059_*` que a causou até alguém fazer arqueologia de git.
- **Dependências**: coordena com o repositório `kavex-report-ciclo` (fora deste worktree)

### [modifiability-5] Trocar as 4 regex do teste estático por um dump parseado da função

- **Problema**
  > `vwMetricasCiclo.test.ts` usa 4 regex acopladas a layout (`RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE`, etc.). Adicionar um `/* comentário de bloco */` com a palavra `INSERT INTO` derruba o primeiro teste. Reformatar o arquivo derruba os outros três. É fricção que faz o próximo autor evitar mexer no arquivo.

- **Melhoria Proposta**
  > No `beforeAll` do teste de integração, extrair a definição das funções via `pg_get_functiondef` já num Postgres descartável (que o teste já provisiona) e usar o resultado como verdade. O teste estático fica só com "não escreve" (sem regex sofisticada) — a verificação do contrato de 9 colunas migra para o de integração, onde é imune a reformatação. Alternativa: usar `libpg_query` (node bindings) para AST-parse ao invés de regex. Tactic Bass: **Refactor**.

- **Resultado Esperado**
  > Estáticos ficam robustos a reformatação; contrato passa a ser validado contra o AST/dump. Métrica: sítios do teste sensíveis a whitespace da migration: 4 → 1 (só o "não escreve", que é regex de keyword, não de estrutura).

- **Tactic alvo**: Refactor
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Falhas causadas por reformatação SQL: potenciais 4 → 1
  - Cobertura semântica (nº de asserts que passam a olhar AST): 0 → 6
- **Risco de não fazer**: Débito de baixa monta; erosão da confiança nos testes estáticos.
- **Dependências**: nenhuma

### [modifiability-6] Separar migration de provisionamento (role/grants) da migration de lógica

- **Problema**
  > `0058_vw_metricas_ciclo.sql` carrega, no mesmo arquivo, DDL de lógica (schema, funções, view) e provisionamento de identidade (CREATE ROLE, ALTER ROLE SET, GRANTs). Alterar só o perímetro do leitor (ex.: subir `statement_timeout`) exige uma migration que também retoca o `CREATE OR REPLACE` das funções — dois deltas semânticos empacotados em um.

- **Melhoria Proposta**
  > A partir da próxima migration da surface `metricas`, separar: `NNNN_metricas_lookup_*.sql` para lógica e `NNNN_metricas_role_*.sql` para provisionamento. Não migrar o `0058` retroativamente (é um único arquivo e está verde) — a política vale para deltas futuros. Registrar em `ontology/decisions/0045-*.md` como consequência. Tactic Bass: **Split Module**.

- **Resultado Esperado**
  > Migrations futuras da surface `metricas` têm um único eixo de mudança. Métrica: 1 arquivo com 2 responsabilidades hoje → 2 arquivos, 1 responsabilidade cada, a partir da 2ª migration.

- **Tactic alvo**: Split Module
- **Severidade**: P3
- **Esforço estimado**: S (≤1d, principalmente convenção)
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - Arquivos de migration com 2 responsabilidades na surface `metricas`: 1 → 1 (o 0058, não migrado); nas próximas: sempre 1 responsabilidade por arquivo
- **Risco de não fazer**: Baixo enquanto houver só 1 leitor; cresce se o produto adicionar leitores (BI, QA) ou mais schemas de read-model.
- **Dependências**: coordenar com card `modifiability-2` (a próxima migration de lógica já sai com o formato novo)

## 6. Notas do agente

- Escopo restrito ao delta `14ca71a..HEAD`; não medi Bass tactics em código pré-existente do backend, salvo `BorderoGestaoService.situacaoDoItem` porque é o par exato da regra duplicada na SQL.
- Não instrumentei cobertura de mutação sistemática (sem `stryker`); a integração `< janela_fim → <=` derrubou 2 testes na sessão anterior, o que é sinal defensável, mas não substitui uma varredura de mutantes.
- Cross-QA links para o consolidator: **modifiability-1** (regra duplicada) toca Testability (falta cinta é falha de testabilidade dirigida) e Integrability (a regra atravessa fronteira SQL↔TS); **modifiability-3** (constantes hardcoded) toca Deployability (config não externalizada = cada mudança = nova migration em cada tenant); **modifiability-4** (contract-test cross-repo) toca Integrability e Testability. G1 do gap.md ("sem toque humano") não entra nesta seção porque é decisão de negócio pendente antes do merge, não débito arquitetural.
- Score 7/10: encapsulamento externo, uso de intermediário e Restrict Dependencies estão excelentes (o leitor não vê `erp_response`); Abstract Common Services e Defer Binding pesam para baixo por causa da regra duplicada e das 8 constantes literais.
