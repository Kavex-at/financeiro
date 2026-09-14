---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-integrability
generated_at: 2026-09-14T16:24:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 5
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Skill externa `kavex-report-ciclo` (fora deste repo) | Novo consumidor conecta com DSN (`DSN_FINANCEIRO`) e executa `SELECT … FROM vw_metricas_ciclo WHERE janela_inicio >= %(inicio)s AND janela_fim <= %(fim)s` toda sexta | View `metricas.vw_metricas_ciclo` (+ função vigente DEFINER + role `metricas_ciclo_leitor`) sobre `permuta_alocacao_execucao`, `permuta_bordero`, `solicitacao_numerario_execucao` | Postgres Supabase 17.6 (session UTC), migrations 0001..0058 aplicadas no boot pelo `BootMigrator`, RLS ligado nas tabelas de origem | Contrato de 9 colunas estável (`frente, metrica, rotulo, valor, unidade, janela_inicio, janela_fim, baseline, baseline_desc`); leitor não enxerga tabelas de origem, não escreve, não recua série; janela sexta 20:00→20:00 São Paulo em `timestamp` sem fuso | Custo marginal de integrar `metrics.py`: 0 mudanças no backend após migration; 1 variável de env; 1 SQL de 4 linhas; 0 dependências novas no `src/backend/package.json`; time-to-first-call = tempo de aplicar 0058 no boot |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC do delta que expõe o contrato | 271 (SQL) + 109 (test estático) + 277 (test integração) | ≤ 800 total | ✅ | `_shared-metrics.md` |
| Dependências novas em `src/backend/package.json` | 0 | 0 | ✅ | `_shared-metrics.md` — "delta da feature: 0 dependências novas" |
| Consumidores externos acoplados ao contrato | 1 (`kavex-report-ciclo/scripts/metrics.py`) | ≥ 1, sem duplicar caminho | ✅ | `metrics.py:16-25` |
| Colunas do contrato enforcadas por teste estático | 9/9 (nome + ordem) | 9/9 | ✅ | `vwMetricasCiclo.test.ts:36-48` |
| Fugas do contrato para tabelas de origem via role leitor | 0 (permission denied) | 0 | ✅ | `vwMetricasCiclo.integration.test.ts:256-263` |
| Grants ao leitor (superfície de ataque) | 3: USAGE + EXECUTE(vigente) + SELECT(view) | ≤ 3, sem SELECT em `public.*` | ✅ | `vwMetricasCiclo.test.ts:83-91` |
| Tempo-limite de query do leitor | 30s | ≤ 60s | ✅ | `0058_vw_metricas_ciclo.sql:267` |
| Teste de contrato cross-repo (pact skill ↔ view) | 0 | ≥ 1 | ⚠️ | inspeção de `/home/inteli/.claude-kavex/skills/kavex-report-ciclo/` |
| Versionamento explícito da view (v1/v2 ou coluna `contrato_versao`) | 0 (convenção documentada em `references/contrato-metricas.md`) | 1 mecanismo | ⚠️ | `references/contrato-metricas.md:11-38` |
| Sinal de erro semântico view→consumidor (distinguir "sem dados" de "quebrou") | 0 | 1 | ⚠️ | `metrics.py:52-54, 61-67` (só captura exceção Python) |
| DML no contrato exposto | 0 | 0 | ✅ | `vwMetricasCiclo.test.ts:30-34` |
| Timezone acoplado ao consumidor (São Paulo, sem fuso) | 1 gotcha documentado (K1) | 0 gotchas silenciosos | ⚠️ | `metricas-ciclo-gap.md:51-53` |
| Integração testada com Postgres real | ✅ 13 testes verdes; mutação `< janela_fim`→`<=` derruba 2 | ≥ 10 | ✅ | `_shared-metrics.md` (linha 40) |
| Consumidores no delta importando `axios`/`fetch` ou tocando ORM | 0 | 0 | ✅ | `git diff 14ca71a..HEAD` — só SQL + testes |
| Vazamento de PII/segredo via view (`erp_response`, e-mail, `request_payload`) | 0 (nenhum SELECT dessas colunas na função) | 0 | ✅ | `0058_vw_metricas_ciclo.sql:100-143` |

> ⚠️ **Não medível localmente**: latência real de `metrics.py` contra Supabase (requer credencial de produção e o ciclo semanal). Recomendação: instrumentar `pg_stat_statements` no schema `metricas` no primeiro ciclo de uso.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | View `metricas.vw_metricas_ciclo` é a única superfície pública; nenhum consumidor toca `permuta_alocacao_execucao`, `permuta_bordero` ou `solicitacao_numerario_execucao` diretamente. Toda a lógica de janela/borderô desfeito/dry-run vive dentro da função `metricas.metricas_ciclo(serie, agora)` | ✅ presente | `0058_vw_metricas_ciclo.sql:76-213`; `vwMetricasCiclo.integration.test.ts:256-263` |
| Use an Intermediary | A função vigente `metricas.metricas_ciclo_vigente()` (SECURITY DEFINER) é o intermediário entre o leitor e a lógica parametrizada. Existe por um detalhe do Postgres que o teste de integração pegou: função dentro de view checa `EXECUTE` como quem consulta | ✅ presente | `0058_vw_metricas_ciclo.sql:217-240`; ADR-0045 D5 |
| Restrict Communication Paths | Schema `metricas` fora do PostgREST (não exposto a `anon`/`authenticated`); role `metricas_ciclo_leitor` com `USAGE` só no schema, `EXECUTE` só na vigente, `SELECT` só na view; `default_transaction_read_only = on`; `statement_timeout = 30s`; `search_path = metricas` | ✅ presente | `0058_vw_metricas_ciclo.sql:257-271`; `vwMetricasCiclo.integration.test.ts:256-275` |
| Adhere to Standards | SELECT SQL padrão + placeholders posicionais nomeados (psycopg 3); nada de RPC proprietário nem sabor Supabase | ✅ presente | `metrics.py:19-32` |
| Abstract Common Services | N/A — único consumidor externo, contrato dedicado à skill do ciclo. Documentado em `references/contrato-metricas.md` como padrão a ser replicado por outras soluções | N/A | — |
| Discover Service | DSN via env var (`DSN_FINANCEIRO`), lida pelo consumidor a partir do `config/columbia.json`. Não há service registry — inaceitável desmedidamente ampliar para 1 integração | ⚠️ parcial | `metrics.py:46-48`; `config/columbia.json` ainda não existe (K2 do gap) |
| Tailor Interface | 9 colunas com nomes/ordem fixos, unidade explícita (`%`/`R$`), rótulo em pt-BR de operação, chave `metrica` estável. Contrato documentado fora do repo (`references/contrato-metricas.md`) | ✅ presente | `references/contrato-metricas.md:29-38`; `vwMetricasCiclo.test.ts:17-27` |
| Configure Behavior | Série (`serie_inicio`) e `now()` fixos na vigente por decisão (D5). Consumidor não pode recuar série — proteção deliberada | ✅ presente (por decisão) | `0058_vw_metricas_ciclo.sql:236-238`; ADR-0045 D5 |
| Manage Resources | `default_transaction_read_only`, `statement_timeout = 30s`, `SET search_path = ''` na função SECURITY DEFINER (mitiga path-hijack). O role nasce `NOLOGIN` (senha não entra em migration) | ✅ presente | `0058_vw_metricas_ciclo.sql:232, 265-267` |
| Orchestrate | N/A — read-model síncrono, sem coordenação de múltiplos passos | N/A | — |
| Manage Resource Coupling | Fuso e formato de timestamp são acoplamento assumido (São Paulo, `timestamp` sem fuso). Documentado no cabeçalho e comprovado no teste que simula o SELECT do `metrics.py` | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:35-38`; `vwMetricasCiclo.integration.test.ts:192-206`; gap K1 |
| Contract testing | Guarda estática por regex (colunas/ordem, sem DML, revoke, grants) + teste de integração que sobe Postgres 17-alpine, aplica 0001..0058, semeia ledgers e roda o SELECT exato do `metrics.py`. Mutação `< janela_fim`→`<=` derruba 2 casos (fronteira semanal) — o teste é discriminante | ✅ presente | `vwMetricasCiclo.test.ts:29-108`; `vwMetricasCiclo.integration.test.ts:192-216` |
| Versioning strategy | Regra de convenção: `metrica` é chave estável; mudou definição, cria chave nova. Sem versionamento da view em si (nem coluna `contrato_versao`, nem sufixo `_v1`) | ⚠️ parcial | `references/contrato-metricas.md:76-78`; comentário `0058_vw_metricas_ciclo.sql:4-8` |
| Backward-compatibility shims | N/A — view nova, sem versão anterior | N/A | — |
| Observability of integration failures | Consumidor: `metrics.py` captura exceção Python e reporta em `frentes_sem_instrumentacao`. Backend: nenhum sinal — a view não emite log, não conta chamadas, não distingue "janela vazia por construção" de "filtro errado do cliente" | ⚠️ parcial | `metrics.py:52-54, 61-67` |

## 4. Findings (achados)

### F-integrability-1: Sem teste de pacto cross-repo entre skill e view

- **Severidade**: P2
- **Tactic violada**: Contract testing (cross-repo)
- **Localização**: `/home/inteli/.claude-kavex/skills/kavex-report-ciclo/scripts/metrics.py:16-25` ↔ `src/backend/migrations/0058_vw_metricas_ciclo.sql:76-213`
- **Evidência (objetiva)**:
  ```
  # metrics.py:16
  COLUNAS = ["frente", "metrica", "rotulo", "valor", "unidade",
             "janela_inicio", "janela_fim", "baseline", "baseline_desc"]
  # vwMetricasCiclo.test.ts:17 (mesma lista, num repo diferente)
  const COLUNAS_DO_CONTRATO = [ 'frente', 'metrica', ... 'baseline_desc' ];
  ```
  Duas cópias literais da mesma lista de colunas, em repositórios distintos, sem lint/CI que garanta que evoluem juntas.
- **Impacto técnico**: se alguém renomear uma coluna na migration 0059, o teste estático deste repo passa (a nova ordem vira o novo contrato); a skill continua com a lista antiga e o `dict(zip(COLUNAS, r))` desalinha silenciosamente. Como o SELECT do `metrics.py` lista as colunas por nome, um DROP explícito falha ruidosamente — mas um SWAP (`rotulo` ↔ `baseline_desc` no `RETURNS TABLE`) passaria por baixo.
- **Impacto de negócio**: Seção 3 do report semanal sai com rótulo trocado por número (o Diretor de TI lê "38 · baixas concluídas" em vez de "sem medição do processo manual"). O erro é invisível até alguém conferir o rendered HTML.
- **Métrica de baseline**: 0 pact tests cross-repo / 1 consumidor externo real.

### F-integrability-2: Filtro `janela_fim <= fim` sem hora zera o resultado em silêncio

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling (timezone + tipo)
- **Localização**: `/home/inteli/.claude-kavex/skills/kavex-report-ciclo/scripts/metrics.py:22-24`; migration `src/backend/migrations/0058_vw_metricas_ciclo.sql:33-38`
- **Evidência (objetiva)**:
  ```
  # metrics.py:22-24
  where janela_inicio >= %(inicio)s and janela_fim <= %(fim)s
  # vwMetricasCiclo.integration.test.ts:202-205
  const soData = await admin.query(filtro, [SERIE, AGORA, '2026-09-11', '2026-09-18']);
  expect(soData.rows).toHaveLength(0);
  ```
  O próprio teste de integração comprova que `--fim 2026-09-18` (data sem hora) devolve zero linhas. Documentado como K1 em `metricas-ciclo-gap.md:51-53`.
- **Impacto técnico**: usuário roda `metrics.py --inicio 2026-09-11 --fim 2026-09-18`, recebe `0 métrica(s)` no stderr, e `metrics.json` sai com `metricas: []` — indistinguível de "não há dado". A skill vive fora deste repo; o financeiro só pode mitigar mudando o filtro da view (não fez).
- **Impacto de negócio**: qualquer consumidor futuro (o próximo `frente` a se instrumentar via este contrato) vai tropeçar na mesma armadilha. Custo de onboarding: ler comentário 42 linhas dentro da migration.
- **Métrica de baseline**: 1 gotcha silencioso / 1 filtro, 100% do consumidor exposto.

### F-integrability-3: Nenhum sinal de erro semântico entre view e consumidor

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql` (não há canal de erro); `metrics.py:52-54, 61-67`
- **Evidência (objetiva)**:
  ```python
  # metrics.py:52-54
  try:
      linhas.extend(ler(dsn, a.inicio, a.fim))
  except Exception as ex:  # frente sem instrumentação ainda não bloqueia o report
      ausentes.append(f'{fonte["frente"]}: {type(ex).__name__} — {ex}')
  ```
  `frentes_sem_instrumentacao` só é populado por exceção Python. Zero linhas retornadas (por filtro errado, série futura, janela em curso, ou tabela vazia) → `metricas: []` no JSON, sem distinção.
- **Impacto técnico**: a view não expõe metadata (última janela emitida, série disponível, hash do contrato). O consumidor não consegue detectar "estou pedindo uma janela antes da série" ou "a série mudou de origem" sem inspeção externa.
- **Impacto de negócio**: o report do ciclo 6 vai sair com R$ 0 na Frente IV (documentado no ADR-0045 D5, é verdade) — mas o consumidor não sabe se é 0 real, 0 por filtro ou 0 por bug. No ciclo 7, sem esse sinal, uma quebra silenciosa pode virar "sem instrumentação" implícita.
- **Métrica de baseline**: 0 canais de sinal semântico (nem coluna `serie_inicio_efetiva`, nem função `metricas.diagnostico()`, nem log de leitor).

### F-integrability-4: Contrato sem versão explícita — 1 consumidor é OK, 2+ não

- **Severidade**: P3
- **Tactic violada**: Versioning strategy
- **Localização**: `references/contrato-metricas.md:11-38`; `src/backend/migrations/0058_vw_metricas_ciclo.sql:244-255`
- **Evidência (objetiva)**:
  ```sql
  CREATE OR REPLACE VIEW metricas.vw_metricas_ciclo AS ...  -- sem sufixo _v1 nem coluna contrato_versao
  ```
  A convenção "chave `metrica` nunca renomeia" é documentada no template do contrato, mas não há mecanismo técnico. Se um segundo consumidor pedir contrato v2 (com uma coluna a mais), a única saída hoje é criar nova view (`vw_metricas_ciclo_v2`) — sem migração planejada.
- **Impacto técnico**: quando a skill evoluir (por exemplo, um `metricas-ciclo` v2 no template com mais campos), o financeiro terá que decidir entre CREATE OR REPLACE (quebra o consumidor atual sem aviso) e nova view (fork sem convenção). Nada trava a decisão errada.
- **Impacto de negócio**: hoje 1 consumidor real (`metrics.py`), P3 defensável. Vira P2 quando outra frente/solução adotar a mesma convenção (Fechamento de Processos é candidato natural — `references/contrato-metricas.md:47-53`).
- **Métrica de baseline**: 0 mecanismos de versão / 1 contrato exposto; N consumidores previstos ≥ 2 pelo próprio template.

### F-integrability-5: Guarda estática por regex é frágil a reformatação do SQL

- **Severidade**: P3
- **Tactic violada**: Contract testing (robustez do teste)
- **Localização**: `src/backend/migrations/vwMetricasCiclo.test.ts:37-46, 51-60`
- **Evidência (objetiva)**:
  ```
  const retornos = [...SQL.matchAll(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/g)];
  ```
  Se um autor futuro escrever a assinatura em uma linha só (`RETURNS TABLE (frente text, metrica text, …) LANGUAGE sql`) ou intercalar comentários dentro do parêntese, o `split(',')` no `matchAll` pega comentários e vírgulas de tipo (não há hoje, mas há amanhã com `numeric(12,2)` — quebraria a regex atual).
- **Impacto técnico**: teste passa em SQL malformado, ou falha em SQL formatado de outro jeito. A integração pega, mas exige `METRICAS_CICLO_TEST_DSN` (não roda no `npm test` padrão — o próprio arquivo é `.integration.test.ts`, excluído do `jest.config`).
- **Impacto de negócio**: baixo hoje (uma migration, um contrato). Vira problema quando um segundo autor tocar o arquivo e o teste estático virar "fica verde por acidente".
- **Métrica de baseline**: 4 regex de guarda estática dependentes do formato exato; 0 execuções do teste de integração no CI padrão (`npm test` exclui `*.integration.test.ts` — `_shared-metrics.md` linha 35).

## 5. Cards Kanban

### [integrability-1] Publicar teste de pacto cross-repo skill ↔ view

- **Problema**
  > A skill `kavex-report-ciclo` (fora deste repo) mantém `COLUNAS = [...]` como cópia literal do contrato definido em `vw_metricas_ciclo`. Um SWAP de duas colunas no `RETURNS TABLE` passaria pelo teste estático deste repo e desalinharia o `dict(zip(...))` do `metrics.py`, com o report saindo com rótulo trocado por número.

- **Melhoria Proposta**
  > Fixar um fixture de "linha canônica" (uma linha de exemplo com todos os 9 campos e uma unidade de cada tipo) em `references/contrato-metricas.md` como JSON, e adicionar um teste em cada lado que valida contra ele: no financeiro, um `contratoLinhaCanonica.test.ts` que executa a função contra Postgres e compara a shape (nomes + tipos + ordem quando via `SELECT *`); na skill, um teste que carrega o fixture e verifica que `dict(zip(COLUNAS, r))` produz os mesmos campos. Tactic: **Contract testing**.

- **Resultado Esperado**
  > Renomear ou reordenar coluna do contrato falha em CI dos dois repos antes de ir para produção. Cópias literais deixam de existir — uma delas vira import do fixture. **Baseline**: 0 pact tests → 2 (um em cada repo apontando o mesmo fixture).

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — precisa alinhar com o dono da skill, materializar o fixture e ajustar CI dos dois lados
- **Findings relacionados**: F-integrability-1, F-integrability-5
- **Métricas de sucesso**:
  - Pact tests cross-repo: 0 → 2
  - Duplicações literais de `COLUNAS`: 2 → 1 (fixture único)
- **Risco de não fazer**: SWAP de colunas passa a produção; report sai com "0.85" onde deveria ler "sem medição do processo manual", ninguém repara até um cliente perguntar.
- **Dependências**: coordenação com dono da skill `kavex-report-ciclo` (fora do escopo deste worktree)

### [integrability-2] Alargar o filtro para tolerar data sem hora, ou emitir alerta

- **Problema**
  > `metrics.py --fim 2026-09-18` volta 0 linhas em silêncio (janelas fecham às 20:00, `janela_fim <= '2026-09-18 00:00'` não pega nenhuma). Documentado como K1 no gap; o teste de integração comprova; nenhum sinal para o operador. Qualquer consumidor novo cai na mesma armadilha.

- **Melhoria Proposta**
  > Duas opções, escolher uma: (a) publicar `metricas.diagnostico()` que devolve `serie_inicio`, `ultima_janela_fechada`, `agora` e um `WARNING` quando o intervalo pedido não intersecta a série; (b) na skill, ampliar o filtro para `janela_fim::date <= %(fim)s::date OR janela_fim <= %(fim)s::timestamp` e detectar `--fim` só com data para logar aviso claro. Tactic: **Manage Resource Coupling** + **Observability of integration failures**.

- **Resultado Esperado**
  > Rodar `metrics.py` com data sem hora produz stderr explícito ("--fim precisa de hora ou será interpretado como 00:00; janela do ciclo fecha às 20:00"), não `0 métrica(s)` silencioso. **Baseline**: 1 gotcha silencioso → 0.

- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) na opção (a), este repo apenas; S+ na opção (b), skill apenas
- **Findings relacionados**: F-integrability-2, F-integrability-3
- **Métricas de sucesso**:
  - Chamada com `--fim` sem hora: `0 métrica(s)` silencioso → aviso explícito no stderr
  - Cobertura de fuso da view lida por diagnóstico: 0 → 1 função pública
- **Risco de não fazer**: consumidor externo em treinamento vai debugar 1h por semana durante o ciclo, atribui à "instabilidade da view", e a confiança no contrato começa a corroer.
- **Dependências**: nenhuma

### [integrability-3] Expor sinal semântico view→consumidor (função `metricas.diagnostico()`)

- **Problema**
  > A view não distingue "janela vazia por design" (série futura, filtro fora do intervalo) de "quebrou" (tabela renomeada, permissão perdida, migration falhou). O `metrics.py` só populariza `frentes_sem_instrumentacao` em exceção Python; 0 linhas vira `metricas: []` no JSON, indistinguível.

- **Melhoria Proposta**
  > Adicionar `metricas.diagnostico()` (SECURITY DEFINER, `EXECUTE` para `metricas_ciclo_leitor`) que retorna `serie_inicio`, `agora`, `ultima_janela_fechada`, `count_por_frente_ultima_janela`, `contrato_versao` ('1.0'). `metrics.py` chama antes de `SELECT` e emite lacuna declarada se `count = 0`. Tactic: **Observability of integration failures**. Toca `0059_diagnostico_metricas.sql` (nova migration, mesmo padrão de grant).

- **Resultado Esperado**
  > Consumidor consegue reportar em `metrics.json` uma linha por frente com `"status": "sem_dados_na_janela"` vs `"status": "quebrou: <erro>"`. **Baseline**: 0 canais → 1 função pública.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3, F-integrability-4
- **Métricas de sucesso**:
  - Sinais semânticos expostos: 0 → 1 função `diagnostico()`
  - Tempo médio para diagnosticar "por que a Frente IV está zerada?" no ciclo 7+: informal → 0 (basta ler o diagnóstico)
- **Risco de não fazer**: uma migração que quebre a view em silêncio (por exemplo, renomear coluna) só aparece quando alguém abre o HTML na sexta e nota "número faltando"; MTTR = duração do ciclo.
- **Dependências**: nenhuma

### [integrability-4] Publicar versão explícita do contrato (coluna `contrato_versao` ou sufixo `_v1`)

- **Problema**
  > Contrato é regra de convenção documentada em `references/contrato-metricas.md`; nada no schema declara versão. Quando a skill evoluir para v2 (o próprio template prevê pelo menos 3 frentes usando o mesmo formato — Adiantamentos/Recebimentos, Permutas, Fechamento), coexistir dois contratos exigirá improvisar.

- **Melhoria Proposta**
  > Adicionar coluna `contrato_versao text` no `RETURNS TABLE` de `metricas.metricas_ciclo(...)`, com valor literal `'1.0'`. Documentar em `references/contrato-metricas.md` regra de bump (mudança compatível = manter 1.0; incompatível = criar `vw_metricas_ciclo_v2` mantendo v1 até deprecação). Tactic: **Versioning strategy**.

- **Resultado Esperado**
  > Cada linha carrega sua versão de contrato. Consumidor pode implementar dispatch por versão. Migração para v2 tem checklist claro. **Baseline**: 0 mecanismos → 1 coluna versionada + regra de bump escrita.

- **Tactic alvo**: Versioning strategy
- **Severidade**: P3 (vira P2 quando 2º consumidor entrar)
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-4, F-integrability-1
- **Métricas de sucesso**:
  - Colunas versionadas: 0 → 1
  - Consumidores com dispatch por versão: 0 → 1 (`metrics.py` passa a validar `contrato_versao == '1.0'`)
- **Risco de não fazer**: em 6 meses, quando `fechamento-processos` também publicar sua `vw_metricas_ciclo`, a skill terá que descobrir versão por introspeção do schema; qualquer bump vai virar coordenação ad-hoc.
- **Dependências**: [integrability-1] (fixture de pacto já inclui `contrato_versao`)

### [integrability-5] Trocar guardas estáticas por regex por AST parser ou SELECT contra a função

- **Problema**
  > `vwMetricasCiclo.test.ts` extrai a assinatura do `RETURNS TABLE` com regex; o parser assume formato exato ("nome tipo,"). Um autor futuro que use `numeric(12,2)` quebra o `split(',')`; comentários dentro do parêntese passam despercebidos. O teste de integração cobre o comportamento real, mas é `*.integration.test.ts` — excluído do `npm test` padrão.

- **Melhoria Proposta**
  > Substituir a extração por regex por uma execução mínima contra Postgres — `pg-mem` (in-memory Postgres em JS, usado no ecossistema Node) ou docker up dedicado no `npm test`. O teste vira `CREATE FUNCTION ...; SELECT column_name FROM information_schema.columns WHERE table_schema='metricas' AND table_name='vw_metricas_ciclo' ORDER BY ordinal_position;`. Tactic: **Contract testing** robusto.

- **Resultado Esperado**
  > Guarda de forma passa a inspecionar o Postgres real, não texto do arquivo. Reformatação do SQL não engana. **Baseline**: 4 regex frágeis / 0 execuções no `npm test` padrão → 1 execução real por PR.

- **Tactic alvo**: Contract testing
- **Severidade**: P3
- **Esforço estimado**: M (2–5d) — decidir entre `pg-mem` (subset de Postgres, pode não cobrir `SECURITY DEFINER` corretamente) e docker up no CI
- **Findings relacionados**: F-integrability-5, F-integrability-1
- **Métricas de sucesso**:
  - Regex de guarda estática: 4 → 0
  - Teste de shape rodando em `npm test`: não → sim
- **Risco de não fazer**: quando um segundo autor tocar o arquivo (previsível — a migration 0059 pode adicionar `metricas.diagnostico()`), o teste estático vai virar "verde por acidente" e a garantia real fica só na `*.integration.test.ts` que não roda por padrão.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo respeitado: findings dizem respeito **apenas ao delta** `git diff 14ca71a..HEAD` (migration 0058, seus dois testes) e à fronteira com `metrics.py` (skill lida read-only). Não avaliei clients HTTP do resto do backend (Conexos, Nexxera etc.) — fora do delta, seriam pre-existing debt.
- A qualidade da integração aqui é notavelmente alta para 1 migration: encapsulamento (view + função DEFINER + role least-privilege), teste de integração com mutação verificada, timezone documentado no cabeçalho, DML zero. O score 8/10 reflete isso — os P2 são melhorias em vetores clássicos de integrabilidade (pact cross-repo, observabilidade de falha, versionamento explícito), não vícios do que foi entregue.
- **Cross-QA overlap para o consolidator**: `Restrict Communication Paths` + `Manage Resources` (revoke de PUBLIC, role least-privilege, `search_path=''` no DEFINER) tocam **Security** (analisar jointly); `Contract testing` toca **Testability** (o `*.integration.test.ts` fora do `npm test` é achado de testabilidade também); `Observability of integration failures` toca **Availability** e **Fault Tolerance** (F-integrability-3 é insumo dos dois).
- Métrica que tentei coletar e não deu: latência real do SELECT em Supabase (precisa credencial de produção e ciclo semanal ao vivo). Marcada como não-medível localmente.
