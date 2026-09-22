---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-16-1650-metricas-historico
agent: qa-modifiability
generated_at: 2026-09-18T00:00:00Z
scope: backend+frontend (delta only, --quick)
score: 7
findings_count: 3
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Yuri / dev do time | Pedido de negócio para a janela do histórico mudar (ex.: trocar `2026-08-07` fixo por janela deslizante, ou mudar de 6 para 8 semanas) | `metricas.historico_inicio()` (SQL) + `PISO` (`MetricasCicloRepository.ts`) + `historico?: boolean` propagado em 4 camadas | Pós-deploy, ADR-0048 já em produção, `kavex-report-ciclo` consumindo a mesma rota sem o parâmetro | Mudança fica contida no piso do histórico; `serie_inicio()`/report não são tocados; grade semanal (sexta 18:00) não desalinha | Nº de arquivos de produção tocados; guarda estática (`vwMetricasCiclo.test.ts`) continua verde sem edição |

> Cenário derivado diretamente da ressalva que a própria ADR-0048 nomeia ("dois pisos coexistem e podem divergir") — é o risco de modificação mais concreto que o delta introduz.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC dos arquivos de produção tocados | 57 (migration 0060) / 56 (`MetricaCiclo.ts`) / 93 (`MetricasCicloRepository.ts`) / 53 (`MetricasCicloService.ts`) / 68 (`routes/metricas.ts`) / 127 (`src/frontend/lib/metricas.ts`) | p95 ≤ 400, max ≤ 600 | ✅ | `wc -l` nos 6 arquivos de produção do delta |
| Proporção produção : teste no delta | ~60 : ~350 (~1:6) | ≥1:1 defensável para read-model | ✅ | `_shared-metrics.md` |
| Camadas que carregam o booleano `historico` | 5 (`MetricaCiclo.ts` interface → `MetricasCicloRepository.ts` → `MetricasCicloService.ts` → `routes/metricas.ts` → `src/frontend/lib/metricas.ts`) | Sem alvo formal — reportado para julgamento adversarial (ver F-modifiability-1) | ⚠️ | `git diff origin/main` dos 6 arquivos |
| Arquivos de produção a tocar para trocar data fixa → janela deslizante | 1 (`historico_inicio()` na migration; nova migration aditiva) — mas exige reabrir a invariante "cai numa sexta" hoje travada por teste estático | 1 arquivo é o ideal; risco é o invariante, não o LOC | ⚠️ | Inspeção de `0060_metricas_historico_inicio.sql` + `vwMetricasCiclo.test.ts` (bloco "os dois pisos caem na mesma grade") |
| Cognitive-complexity / control-flow keywords nos 6 arquivos tocados | máx. 8 (`src/frontend/lib/metricas.ts`, arquivo inteiro, não função) | ≤15 (Biome `noExcessiveCognitiveComplexity`) | ✅ | `grep -cE "if |else |switch |case |for |while |&&|\|\|"` por arquivo |
| Biome nos 7 arquivos do delta | 0 problemas | 0 | ✅ | `_shared-metrics.md` + `npx biome check` re-executado nos 4 arquivos backend |
| Violação de camada DDD (route → repository direto) | 0 — `routes/metricas.ts` só chama `container.resolve(MetricasCicloService)` | 0 | ✅ | `grep -n "injectable\|container.resolve"` nos 3 arquivos |
| Ocorrências do literal `2026-08-07` como valor de negócio (fora de comentário/doc) | 1 (`0060_metricas_historico_inicio.sql:54`, dentro do `CREATE FUNCTION`) | 1 (fonte única) | ✅ | `grep -rn "2026-08-07"` |
| Pisos de série coexistindo (`serie_inicio()` + `historico_inicio()`) | 2 | 1 seria o ideal de coesão, mas a ADR justifica os 2 (ver Tactics) | ⚠️ | `MetricasCicloRepository.ts:29-35` |

⚠️ **Não medível localmente**: impacto em produção do drift entre os dois pisos ao longo de meses (ex.: alguém adicionar um terceiro piso, ou mudar `serie_inicio()` sem lembrar de `historico_inicio()`) — requer observação de PRs futuros, não medível estaticamente nesta run `--quick`.

### Apêndice — Top arquivos do delta (não há 10 arquivos de produção; a run é restrita ao delta)

| Arquivo | LOC | Papel na camada |
|---|---|---|
| `src/frontend/lib/metricas.ts` | 127 | Client HTTP (frontend) |
| `src/backend/domain/repository/metricas/MetricasCicloRepository.ts` | 93 | Repository |
| `src/backend/routes/metricas.ts` | 68 | Route handler (Express, equivalente a Lambda handler) |
| `src/backend/migrations/0060_metricas_historico_inicio.sql` | 57 | Migration SQL |
| `src/backend/domain/interface/metricas/MetricaCiclo.ts` | 56 | Interface/contrato |
| `src/backend/domain/service/metricas/MetricasCicloService.ts` | 53 | Service |

Fan-in de `MetricasCicloRepository`/`MetricasCicloService` não recalculado nesta run — escopo é o delta, não o repositório inteiro (ver `_shared-metrics.md`, "Escopo desta run"). Achado prévio de runs completas de modifiability, se existir, deve ser referenciado pelo consolidator.

## 3. Tactics — Cobertura no nf-projects (aplicadas ao delta)

| Tactic (Bass) | Implementação atual no delta | Status | Evidência |
|---|---|---|---|
| Split Module | Não aplicável — nenhum arquivo tocado se aproxima de limite de tamanho | N/A — arquivos pequenos (máx. 127 LOC) | Tabela de métricas acima |
| Increase Semantic Coherence | `MetricasCicloRepository` ganha uma segunda responsabilidade related (escolher entre 2 pisos), mas ambas são "ler o piso da série" — mesma entidade conceitual | ✅ presente | `MetricasCicloRepository.ts:29-35,92` (`PISO` + `piso()` privado) |
| Encapsulate | O nome das duas funções SQL (`metricas.serie_inicio()` / `metricas.historico_inicio()`) fica só no repository, atrás de `private piso()`. Service e route não conhecem os nomes SQL — só o booleano | ✅ presente | `MetricasCicloRepository.ts:92`; `MetricasCicloService.ts:42` só chama `serieInicio(normalizado.historico)` |
| Use an Intermediary | O booleano `historico` funciona como um seletor de estratégia passado por parâmetro — não há polimorfismo/interface dedicada, mas o volume (2 opções, 1 booleano) não justifica uma abstração maior | ⚠️ parcial — aceitável na escala atual, mas não escala para um 3º piso sem refactor (ver F-modifiability-1) | `MetricasCicloRepository.ts:69,87` |
| Restrict Dependencies | Zod no boundary da rota filtra `historico` antes de chegar ao service; nenhuma camada abaixo da rota aceita string arbitrária | ✅ presente | `routes/metricas.ts:15-23` (`z.enum(['true','false'])`, com nota explícita sobre por que não `z.coerce.boolean()`) |
| Refactor | N/A para este delta — é aditivo, não há refactor de código legado envolvido | N/A | — |
| Abstract Common Services | N/A — não há serviço comum candidato aqui | N/A | — |
| Defer Binding (config files) | A data `2026-08-07 18:00` é uma constante SQL hardcoded na migration, não uma config externalizada (SSM/env) | ⚠️ parcial — decisão deliberada do Yuri (ADR-0048), documentada, mas é um miss de defer-binding textbook | `0060_metricas_historico_inicio.sql:54` |
| Defer Binding (runtime registration / polymorphism) | O booleano `historico` é resolvido em runtime por request (não por deploy/env) — correto para este caso, já que report e tela precisam de respostas diferentes da MESMA rota no MESMO deploy | ✅ presente | `routes/metricas.ts:55-63`; ver F-modifiability-2 para o porquê disso ser a escolha certa e não um miss |

## 4. Findings (achados)

### F-modifiability-1: Segundo piso de série é coesão aceitável hoje, mas não escala além de 2 opções sem refactor

- **Severidade**: P2
- **Tactic violada**: Use an Intermediary (parcialmente — presente mas frágil a crescimento)
- **Localização**: `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:29-35,92`
- **Evidência (objetiva)**:
  ```ts
  const PISO = {
      serie: 'metricas.serie_inicio()',
      historico: 'metricas.historico_inicio()',
  } as const;
  ...
  private piso = (historico?: boolean): string => (historico ? PISO.historico : PISO.serie);
  ```
  O booleano `historico?: boolean` é o único seletor. Um 3º piso (ex.: "últimas 12 semanas" para
  auditoria) não cabe num booleano — exigiria um enum novo em 5 arquivos (interface, repository,
  service, route, frontend lib) ao mesmo tempo em que muda a assinatura de `piso()`.
- **Impacto técnico**: hoje (2 pisos) o desenho é limpo e o `Encapsulate` funciona bem — a decisão de
  colocar o mapeamento nome-de-função no repository (não no service/route) está correta e é a tactic
  certa aplicada no lugar certo. O risco é de médio prazo: a ADR-0048 já registra "dois pisos coexistem
  e podem divergir" como consequência aceita; um 3º piso multiplicaria essa superfície sem que o
  desenho atual ofereça um ponto de extensão (não há interface `PisoSerieStrategy`, é só um `if`
  implícito no ternário).
- **Impacto de negócio**: se a Columbia pedir uma terceira janela (ex.: "mostrar o ano inteiro" para
  auditoria fiscal), o próximo dev reabre exatamente estes 5 arquivos + nova migration — não é caro,
  mas é o sinal de que o padrão booleano não é o vocabulário certo para "qual piso".
- **Métrica de baseline**: 5 arquivos de produção carregam o campo `historico` hoje (contagem em
  Métricas §2); cada piso adicional multiplicaria essa contagem por decisão local, não por tactic.

### F-modifiability-2: Data do piso do histórico (`2026-08-07`) é constante hardcoded em SQL, não configuração

- **Severidade**: P2
- **Tactic violada**: Defer Binding (configuration files)
- **Localização**: `src/backend/migrations/0060_metricas_historico_inicio.sql:54`
- **Evidência (objetiva)**:
  ```sql
  CREATE OR REPLACE FUNCTION metricas.historico_inicio()
  RETURNS timestamp
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
  AS $fn$
      SELECT TIMESTAMP '2026-08-07 18:00:00'
  $fn$;
  ```
  A própria ADR-0048 já admite o custo ("`2026-08-07` é fixo e envelhece. Em dezembro a tela mostrará
  ~18 semanas, não 6"). A opção de janela deslizante foi oferecida e recusada por decisão de negócio
  do Yuri — isto não é um bug, é uma dívida **anunciada e aceita**.
- **Impacto técnico**: o custo de correção **não é o LOC** (uma migration nova, aditiva, trocaria
  `TIMESTAMP '2026-08-07 18:00:00'` por uma expressão calculada) — é o invariante que
  `vwMetricasCiclo.test.ts` trava hoje: "os dois pisos caem na mesma grade: ambos sexta 18:00, múltiplo
  de 7 dias um do outro" (`vwMetricasCiclo.test.ts`, bloco após "O invariante que torna o recuo
  seguro"). Uma expressão dinâmica (`now() - interval '6 weeks'`) não garante cair numa sexta às
  18:00 sem lógica adicional de alinhamento — o teste estático atual não cobre esse caso porque ele
  testa literais, não expressões.
- **Impacto de negócio**: em dezembro/2026 (∼12 semanas depois), a tela "últimas 6 semanas" já estará
  mostrando ~18 — rótulo da UI ("últimas semanas") ficará incorreto silenciosamente até alguém notar
  ou até um `/feature-tweak` corrigir. Não há alarme, não há teste que falhe sozinho quando isso
  acontece (a data é `IMMUTABLE` e sempre "correta" do ponto de vista do SQL).
- **Métrica de baseline**: 1 ocorrência do literal de data como valor de negócio; 0 mecanismo de
  expiração/alerta associado a essa constante.

### F-modifiability-3: `historico?: boolean` propagado por 5 camadas é o binding time correto — risco é de nomenclatura, não de camada errada

- **Severidade**: P3
- **Tactic violada**: nenhuma — achado documental, não corretivo (contraponto explícito ao brief de investigação)
- **Localização**: `src/backend/domain/interface/metricas/MetricaCiclo.ts:43`, `MetricasCicloRepository.ts:69,85,92`, `MetricasCicloService.ts:35,42`, `routes/metricas.ts:22,55-63`, `src/frontend/lib/metricas.ts:53-56`
- **Evidência (objetiva)**: o mesmo endpoint `GET /metricas/ciclo` serve dois consumidores com
  contratos diferentes no MESMO deploy — `kavex-report-ciclo` (sem o parâmetro) e a tela `/metricas`
  (sempre com `?historico=true`, hardcoded em `fetchMetricasCiclo()`). Um flag de config (env/SSM)
  resolvido no boot do processo afetaria os DOIS consumidores igualmente, porque é o MESMO servidor
  Express atendendo ambos — quebraria exatamente a garantia que a ADR-0048 D3 nomeia ("a garantia da
  D1 passa a não depender de como o consumidor chama").
- **Impacto técnico**: nenhum — o parâmetro por requisição é a escolha correta de binding time aqui.
  Fica registrado porque o brief de investigação pediu avaliação adversarial deste ponto
  especificamente; a conclusão é que a implementação já está no lugar certo.
- **Impacto de negócio**: nenhum risco adicional; incluído para fechar o contraditório do brief.
- **Métrica de baseline**: 1 rota, 2 contratos de resposta, 0 acoplamento entre os dois consumidores.

## 5. Cards Kanban

### [modifiability-1] Extrair seletor de piso de série para um vocabulário que sobrevive a um 3º piso

- **Problema**
  > `MetricasCicloRepository.piso(historico?: boolean)` resolve bem para 2 pisos, mas o vocabulário é
  > um booleano amarrado ao nome "histórico" — um 3º piso (ex.: janela anual para auditoria) não cabe
  > sem reabrir `MetricaCiclo.ts`, `MetricasCicloRepository.ts`, `MetricasCicloService.ts`,
  > `routes/metricas.ts` e `src/frontend/lib/metricas.ts` ao mesmo tempo.

- **Melhoria Proposta**
  > Se e quando um 3º piso for pedido, trocar `historico?: boolean` por `piso?: 'serie' | 'historico'`
  > (ou string enum equivalente) no boundary, mantendo o mapa nome→função SQL centralizado em `PISO`
  > no repository (tactic **Encapsulate**, já correta — não mexer). Não fazer preventivamente: o YAGNI
  > aqui é defensável enquanto só existem 2 pisos e a ADR já limita o escopo. Registrar como gatilho
  > para a próxima vez que `PISO` ganhar uma 3ª chave.

- **Resultado Esperado**
  > Nenhuma ação imediata requerida. Quando o 3º piso chegar: troca de tipo em 1 lugar (a interface),
  > propagação inalterada nas demais camadas (já usam `filtro.historico` genericamente).

- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — só quando o gatilho ocorrer
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Arquivos a tocar para adicionar um novo piso: 5 (hoje, implícito) → declarar explicitamente em
    ADR futura o custo esperado (não reduzir agora)
- **Risco de não fazer**: nenhum risco em 6 meses se não houver 3º piso pedido; se houver, custo de
  retrofit é o mesmo hoje ou depois — não é dívida que cresce sozinha.
- **Dependências**: nenhuma — card é "esperar o gatilho", não "fazer agora".

### [modifiability-2] Externalizar (ou pelo menos versionar com data de revisão) o piso fixo `2026-08-07`

- **Problema**
  > `metricas.historico_inicio()` retorna uma constante SQL fixa que a própria ADR-0048 admite que
  > "envelhece" (18 semanas em dezembro, não 6). Não há teste ou alerta que detecte quando a janela
  > exibida se afasta demais de "6 semanas" — o desvio é silencioso.

- **Melhoria Proposta**
  > Não mudar a decisão de negócio (data fixa foi escolha deliberada do Yuri, ADR-0048 D2). Duas ações
  > baratas e não-conflitantes com a ADR: (1) anotar na ontologia (`ontology/_inbox/`) um lembrete
  > datado — ex. "revisar piso do histórico em 2026-12" — para virar um `/feature-tweak` futuro
  > planejado, não uma surpresa; (2) considerar um teste (`vwMetricasCiclo.test.ts` ou equivalente em
  > CI agendado) que falhe/alerte quando `NOW() - historico_inicio() > 10 semanas`, sinalizando que a
  > tela já não mostra "últimas 6 semanas" de fato.

- **Resultado Esperado**
  > Se a janela um dia atingir 10+ semanas sem ninguém ter revisitado a constante, o time recebe um
  > sinal (teste falho ou item de backlog) em vez de o cliente notar primeiro.

- **Tactic alvo**: Defer Binding (configuration files)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para o lembrete de ontologia; S–M para o teste de idade da janela
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Alerta/lembrete de revisão da constante: 0 → 1 mecanismo (ontologia ou teste agendado)
  - Tempo entre a janela ultrapassar 6 semanas reais e alguém notar: hoje indeterminado (depende de
    alguém abrir a tela e contar linhas) → determinístico via teste/alerta
- **Risco de não fazer**: em dezembro/2026 a tela mostra ~18 semanas rotuladas como recorte de "últimas
  semanas" sem nenhum aviso — mesmo tipo de surpresa silenciosa que a própria ADR-0048 foi escrita
  para evitar (a tela nascendo vazia).
- **Dependências**: nenhuma.

### [modifiability-3] Registrar formalmente a divergência dos dois pisos como item de `/retro-ontology`

- **Problema**
  > A ADR-0048 nomeia "dois pisos coexistem e podem divergir" como consequência aceita e mitigada só
  > por convenção de nomenclatura + teste estático de grade (`vwMetricasCiclo.test.ts`). Não há entrada
  > correspondente em `ontology/_coverage.json` ou `_inbox/` rastreando isso como débito monitorado —
  > a mitigação vive inteiramente em um bloco de comentário e um `it()`.

- **Melhoria Proposta**
  > No próximo `/retro-ontology`, adicionar `metricas.historico_inicio()` / `metricas.serie_inicio()`
  > como par vigiado explicitamente (mesmo sem entidade de domínio formal, já que `entity_changed =
  > false` nesta ADR) — um `_inbox` note bastaria, sem exigir mudar o `_index.json`.

- **Resultado Esperado**
  > Rastreabilidade do "por que dois pisos existem" sobrevive a rotatividade de time, não depende só de
  > quem leu a ADR-0048 na íntegra.

- **Tactic alvo**: Increase Semantic Coherence (documentação do porquê da duplicação controlada)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Entrada em `ontology/_inbox/` referenciando os dois pisos: 0 → 1
- **Risco de não fazer**: baixo — o teste estático já protege contra a maior parte da divergência
  (grade desalinhada). Risco residual é só de conhecimento tribal.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta (`--quick`), conforme `_shared-metrics.md`; fan-in/fan-out do repositório
  completo não recalculado — só os 6 arquivos de produção do diff.
- Cross-QA: **F-modifiability-2** (magic number/data fixa em SQL) overlaps com **Deployability** —
  cada correção futura da data é uma migration + redeploy, não config runtime.
- Cross-QA: **F-modifiability-1/3** (dois pisos convivendo) overlaps com **Testability** — a única
  proteção real contra divergência é `vwMetricasCiclo.test.ts`; se esse teste for removido/quebrado
  no futuro, a modifiability aqui descrita degrada silenciosamente.
- Não achei violação de camada DDD nem acoplamento indevido neste delta — o achado dominante é sobre
  custo de evolução futura (3º piso, janela deslizante), não sobre desenho atual, que está limpo.
