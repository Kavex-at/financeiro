---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-03-2015-session-store-pool
agent: qa-integrability
generated_at: 2026-09-03T20:15:00-03:00
scope: backend
score: 8.4
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de desenvolvimento | Chega uma integração nova que segura recurso do processo (Nexxera, GED, SharePoint) e precisa entrar no shutdown gracioso | Composition root `http/processResources.ts` + contrato `Closeable` (`http/lifecycle.ts`) + adaptador anônimo do `conexosSessionStore` | Backend Express em Render, jobs em GitHub Actions, delta de remediação de ~50 linhas | Somar o novo recurso à coleção de `Closeable` sem tocar `lifecycle.ts` nem `index.ts`, e sem regredir a semântica de "shutdown nunca rejeita" | LOC para acrescentar 1 recurso ≤ 3; arquivos tocados = 1 (`processResources.ts`); testes de shutdown que passam a cobrir o recurso novo ≥ 1 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Recursos registrados em `processResources.resources()` | 2 (`PostgreeDatabaseClient`, `closeConexosSessionStorePool`) | 2 hoje; deve crescer 1-a-1 conforme Nexxera/GED/SharePoint chegam | ✅ | `src/backend/http/processResources.ts:18-23` |
| LOC para acrescentar 1 recurso `Closeable` novo | 2 (1 `import` + 1 linha no array) | ≤ 3 | ✅ | `src/backend/http/processResources.ts:18-23` |
| Arquivos tocados para acrescentar 1 recurso novo | 1 | 1 | ✅ | idem |
| Testes cobrindo a composição de `resources()` | 0 | ≥ 1 (asserção de que o registry inclui todo pool aberto pelo processo) | ❌ | `grep -rn "processResources" src/backend --include="*.test.ts"` |
| Testes cobrindo `closeAll` (contrato genérico) | 4 casos (`lifecycle.test.ts`) | ≥ 3 (paralelo, erro isolado, sem `close`) | ✅ | `src/backend/http/lifecycle.test.ts:3-46` |
| Adesão do adaptador anônimo ao contrato `Closeable` | 100% — `{ close: closeConexosSessionStorePool }` casa com `Closeable = { close?: () => Promise<void> }` | 100% | ✅ | `src/backend/http/processResources.ts:22` × `src/backend/http/lifecycle.ts:13-15` |
| Módulos fora de `http/` que importam de `http/redact.js` | 3 (`services/conexosSessionStore.ts:2`, `domain/service/operacao/StalenessDetector.ts:13`, `domain/repository/operacao/JobExecucaoRepository.ts:4`) | 0 — utilitário de redação deveria viver em `utils/` ou `domain/libs/` | ⚠️ | `grep -rn "from.*http/redact" src/backend --include="*.ts"` |
| Identidade do closeable preservada na coleta de erros | Não — `closeAll` devolve `unknown[]` sem tag; log em `processResources.ts:32` imprime só a razão | Tag por closeable (`{ name, error }`) para diagnóstico multi-integração | ⚠️ | `src/backend/http/lifecycle.ts:30-44` + `src/backend/http/processResources.ts:31-33` |
| `IClient` com `close?()` implementado | 1 (`PostgreeDatabaseClient`) | tantos quantos segurem recurso; opcional é o certo (docstring de `IClient.ts:2-12` justifica) | ✅ | `grep -rn "implements IClient" src/backend/domain/client` |

> ⚠️ **Não medível localmente**: tempo real do drain em produção sob SIGTERM concorrente (Render manda `SIGTERM` e mata em 30s). Requer log estruturado do `[shutdown]` no drain do Render. Recomendação: emitir `{ recurso, ms, ok }` para cada closeable e monitorar p95.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Módulo legado exposto por **uma** função (`closeConexosSessionStorePool`) — os detalhes de `Pool`/`PoolHolder`/`storeClosed` ficam privados ao módulo | ✅ presente | `src/backend/services/conexosSessionStore.ts:229-255` |
| Use an Intermediary | `Closeable` é o intermediário entre o composition root e cada recurso; o adaptador anônimo `{ close: … }` prova que o intermediário é fino o bastante para casar com módulo funcional (não-classe) | ✅ presente | `src/backend/http/lifecycle.ts:12-15` + `src/backend/http/processResources.ts:22` |
| Restrict Communication Paths | Toda saída passa por `closeProcessResources` — o `index.ts` só conhece essa função (linha 199), não `Pool`, não `ConexosSessionStore` | ✅ presente | `src/backend/index.ts:11,199` |
| Adhere to Standards | O adaptador segue o **contrato `Closeable`**, que é deliberadamente **mais fino que `IClient`** (comentário em `lifecycle.ts:12` — "O mínimo que closeAll precisa"). Não é um desvio; é o padrão dessa borda. | ✅ presente | `src/backend/http/lifecycle.ts:12-15` × `src/backend/domain/core/client/IClient.ts:2-12` |
| Abstract Common Services | `closeAll` centraliza o `Promise.allSettled` + filtro de erros para todos os recursos do processo — evita cada callsite reimplementar drain-que-não-rejeita | ✅ presente | `src/backend/http/lifecycle.ts:30-44` |
| Discover Service | Registry é **explícito** (array literal em `resources()`). Não há auto-discovery via container tag ou decorator. Aceitável num composition root; a superfície risco é o esquecimento — que foi exatamente o bug que motivou este arquivo. | ⚠️ parcial | `src/backend/http/processResources.ts:18-23` |
| Tailor Interface | O `SessionStoreDb` (`conexosSessionStore.ts:62-67`) já entrega uma interface **mais estreita** que `pg.Pool` para o `ConexosSessionStore`. O adaptador de shutdown faz o mesmo por baixo: recorta só `.close()`. | ✅ presente | `src/backend/services/conexosSessionStore.ts:62-67` + `src/backend/http/processResources.ts:22` |
| Configure Behavior | Reconstrução preguiçosa via `holder.pool ?? openPool()` e trava via `storeClosed` — o comportamento pós-shutdown é configurado por estado, não por reboot do módulo | ✅ presente | `src/backend/services/conexosSessionStore.ts:319-327,247-255` |
| Manage Resources | `openPools` + `poolHolders` + `Promise.all(pool.end())` no shutdown, com `.catch(() => undefined)` para não travar drain | ✅ presente | `src/backend/services/conexosSessionStore.ts:234-255` |
| Orchestrate | O composition root `processResources` orquestra a coleção sem conhecer sequência (paralelo intencional) | ✅ presente | `src/backend/http/processResources.ts:18-23` + `src/backend/http/lifecycle.ts:31` |
| Manage Resource Coupling | O adaptador anônimo desacopla o composition root **do fato de que o session store é um módulo, não uma classe injetável** — troca-lo por um `IClient` amanhã (BE-11) não muda o registry | ✅ presente | `src/backend/http/processResources.ts:22` |
| Contract testing / schema pinning | `SessionStoreDb` é o contrato entre store e Pool; `Closeable` é o contrato entre resource e drain. Ambos são estruturais TS, sem teste de contrato dedicado. `lifecycle.test.ts` cobre o consumidor. | ⚠️ parcial | `src/backend/http/lifecycle.test.ts:3-46` |
| Versioning strategy | N/A — `Closeable` é interno ao processo, sem versionamento externo. `pg` é dependência npm com semver. | N/A | — |
| Backward-compatibility shims | O próprio adaptador anônimo `{ close: closeConexosSessionStorePool }` **é** um shim de compatibilidade entre o módulo legado e a fronteira `Closeable` — cabe em uma linha, custo próximo de zero. | ✅ presente | `src/backend/http/processResources.ts:22` |
| Observability of integration failures | Erros do pool do session store: `console.warn` redigido (`conexosSessionStore.ts:306-308`). Erros de drain: `console.error` em `processResources.ts:32` mas **sem identidade do recurso**. | ⚠️ parcial | `src/backend/http/processResources.ts:31-33` |

## 4. Findings (achados)

### F-integrability-1: `closeAll` perde identidade do closeable no relatório de erro

- **Severidade**: P2 (débito técnico defensável — não bloqueia hoje; degrada diagnóstico quando 2º/3º recurso entrar)
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/http/lifecycle.ts:30-44` + `src/backend/http/processResources.ts:29-34`
- **Evidência (objetiva)**:
  ```ts
  // lifecycle.ts:39-43
  errors: settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason),

  // processResources.ts:31-33
  for (const error of errors) {
      console.error('[shutdown] recurso falhou ao fechar:', error);
  }
  ```
- **Impacto técnico**: com 2 recursos hoje ainda dá para inferir de qual veio (a stack costuma denunciar). Com Nexxera + GED + SharePoint no array (3-4 pools/handles), o operador vai ler `[shutdown] recurso falhou ao fechar: Error: connection terminated` e precisar adivinhar. É o mesmo modo de falha silenciosa que motivou este delta.
- **Impacto de negócio**: MTTR de incidente de deploy sobe — postmortem passa a começar por "qual pool?" antes de "por quê".
- **Métrica de baseline**: 0 dos 2 closeables atuais preservam identidade no log de erro; alvo = 100%.

### F-integrability-2: `resources()` não tem teste — o modo de falha que motivou o arquivo pode voltar

- **Severidade**: P2 (débito técnico defensável — o registry existe justamente porque foi esquecido uma vez, e nada impede a segunda)
- **Tactic violada**: Discover Service (fallback: contract testing do registry)
- **Localização**: `src/backend/http/processResources.ts:18-23` (sem `.test.ts` par)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "processResources" src/backend --include="*.test.ts"
  # (vazio)
  ```
  O comentário do arquivo (linhas 11-14) reconhece explicitamente: *"o segundo pool Postgres (o do `conexosSessionStore`) ficou de fora do SIGTERM até o Regis-Review achá-lo"*.
- **Impacto técnico**: adicionar Nexxera/GED/SharePoint client com um `Pool` interno e esquecer de registrar em `resources()` reproduz exatamente o incidente que este delta remediou. O composition root é o único ponto que conhece a lista — se ninguém testa a lista, a lista pode empobrecer em silêncio.
- **Impacto de negócio**: recorrência do vazamento de conexões por deploy (histórico: até 2 sessões penduradas no pooler por deploy — ver `_shared-metrics.md` linhas 32-34).
- **Métrica de baseline**: 0 testes cobrem `resources()`; alvo ≥ 1 (asserção de que cada `PoolHolder` aberto pelo processo aparece no array — via inspeção do `Set` de pools ou tag no container tsyringe).

### F-integrability-3: `redactErrorMessage` mora em `http/` mas é consumido por `services/`, `domain/service/` e `domain/repository/`

- **Severidade**: P3 (melhoria opcional — não é problema deste delta, é sintoma de que o util está catalogado no diretório errado)
- **Tactic violada**: Restrict Communication Paths (utilitário puro não deveria forçar dependência de camada de delivery)
- **Localização**: `src/backend/http/redact.ts:79` (fornecedor) × 3 consumidores fora de `http/`:
  - `src/backend/services/conexosSessionStore.ts:2` (arquivo sob review)
  - `src/backend/domain/service/operacao/StalenessDetector.ts:13`
  - `src/backend/domain/repository/operacao/JobExecucaoRepository.ts:4`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "from.*http/redact" src/backend --include="*.ts" | grep -v ".test.ts"
  services/conexosSessionStore.ts:2:          import { redactErrorMessage } from '../http/redact.js';
  domain/service/operacao/StalenessDetector.ts:13: import { redactErrorMessage } from '../../../http/redact.js';
  domain/repository/operacao/JobExecucaoRepository.ts:4: import { redactErrorMessage } from '../../../http/redact.js';
  ```
- **Impacto técnico**: `redactErrorMessage` é função pura, sem qualquer coisa HTTP dentro — o nome do arquivo (`http/redact.ts`) sugere afinidade com o pipeline de request/response, e domain/repository importando de `http/` inverte a intenção da estrutura de pastas. Este delta **não introduziu** a inversão (StalenessDetector e JobExecucaoRepository já a faziam desde ADR-0042), apenas somou a terceira instância. É um smell de taxonomia, não runtime.
- **Impacto de negócio**: nenhum imediato. Custo latente: quando `services/` for migrado para `domain/service/` (BE-11, fora deste delta), o import precisa ser refeito de qualquer jeito — mover `redact.ts` para `utils/` ou `domain/libs/redact/` de uma vez resolve os 3 sítios.
- **Métrica de baseline**: 3 sítios fora de `http/` importando de `http/redact.js`; alvo = 0.

## 5. Cards Kanban

### [integrability-1] Rotular closeable no relatório de erro do drain

- **Problema**
  > Hoje `closeAll` devolve `unknown[]` e `processResources` imprime `[shutdown] recurso falhou ao fechar: <error>` sem dizer QUAL recurso. Com 2 closeables dá para inferir; com Nexxera+GED+SharePoint no array, o log vira adivinhação. É a mesma classe de invisibilidade que motivou este delta.

- **Melhoria Proposta**
  > Trocar `Closeable` por `NamedCloseable { name: string; close?: () => Promise<void> }` (ou passar `Record<string, Closeable>` para `closeAll`). O log em `processResources.ts:32` passa a incluir o nome. Adaptador anônimo do session store vira `{ name: 'conexos-session-store-pool', close: closeConexosSessionStorePool }` — permanece de uma linha.

- **Resultado Esperado**
  > `[shutdown] recurso 'conexos-session-store-pool' falhou ao fechar: <error>` — MTTR de incidente de shutdown cai porque o postmortem já começa pelo recurso certo.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Closeables com identidade preservada no log de erro: 0/2 → 2/2 (e 5/5 quando Nexxera+GED+SharePoint entrarem)
  - Linhas alteradas: ≤ 15 (lifecycle.ts + processResources.ts + 3 chamadas + testes)
- **Risco de não fazer**: primeiro incidente de shutdown com 3+ recursos vai gastar 20-30 min de postmortem em "qual pool?" antes de "por quê?".
- **Dependências**: nenhuma.

### [integrability-2] Cobrir o registry de `processResources` com teste

- **Problema**
  > `processResources.resources()` é o único lugar que conhece a lista de closeables do processo. Não tem teste. O bug que motivou este arquivo foi exatamente o esquecimento de registrar o pool do session store — nada impede a repetição quando o próximo client com `Pool` entrar (Nexxera).

- **Melhoria Proposta**
  > Escrever `processResources.test.ts` que: (a) verifica que `resources()` inclui `PostgreeDatabaseClient` e o adaptador do session store (por nome, quando o card `integrability-1` passar); (b) mockeia `closeAll` e confirma que `closeProcessResources` propaga o array. Opcionalmente, adicionar convenção "todo client com `Pool` privado precisa aparecer aqui" no PatternGuardian.

- **Resultado Esperado**
  > `grep -rn "processResources" src/backend --include="*.test.ts"` deixa de retornar vazio; regressão do modo de falha "recurso esquecido no SIGTERM" fica gate-blocked.

- **Tactic alvo**: Discover Service (via contract test do registry)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Testes cobrindo `resources()`: 0 → ≥ 2
  - Cobertura de `processResources.ts`: 0% → ≥ 90%
- **Risco de não fazer**: recorrência do vazamento — a nova integração (Nexxera) chega, dev esquece a linha em `resources()`, cada deploy deixa 2-4 sessões penduradas no pooler, e ninguém percebe até o próximo Regis-Review.
- **Dependências**: preferível fazer depois de `integrability-1` (assim o teste consegue asserir por nome).

### [integrability-3] Mover `redactErrorMessage` para fora de `http/`

- **Problema**
  > `redactErrorMessage` é função pura de redação. Vive em `src/backend/http/redact.ts` por acidente histórico (nasceu servindo o middleware de log). Hoje é importada por `services/conexosSessionStore.ts` (arquivo sob review), `domain/service/operacao/StalenessDetector.ts` e `domain/repository/operacao/JobExecucaoRepository.ts` — três sítios fora de `http/` que passaram a depender de uma pasta de camada de delivery. Este delta soma o terceiro caso; não é o culpado, mas é a hora de tampar.

- **Melhoria Proposta**
  > Mover `redactErrorMessage` (e `redactBody`, se conveniente) para `src/backend/utils/redact.ts` ou `src/backend/domain/libs/redact/`. Manter re-export em `http/redact.ts` durante a transição para não estourar imports do middleware. Atualizar os 3 consumidores. Alinhado com Bass **Restrict Communication Paths**: código de domínio para de depender de `http/`.

- **Resultado Esperado**
  > `grep -rn "from.*http/redact" src/backend/domain src/backend/services` retorna vazio. Migração futura de `services/` para `domain/service/` (BE-11) fica um passo mais barata.

- **Tactic alvo**: Restrict Communication Paths
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Sítios fora de `http/` importando de `http/redact.js`: 3 → 0
- **Risco de não fazer**: nenhum runtime. Custo cumulativo: cada nova função em `redact.ts` que domain/service precisar reforça a inversão de camada.
- **Dependências**: nenhuma. Pode ser feito junto com o card BE-11 (migração do `services/conexosSessionStore.ts` para DDD), fora deste delta.

## 6. Notas do agente

- **Restrição de escopo respeitada.** BE-11 (migrar `services/conexosSessionStore.ts` para `domain/service/`) está fora deste delta por decisão do coordenador; nenhum finding pede essa migração. F-integrability-3 é sobre `redact.ts`, não sobre o session store.
- **Julgamento sobre a pergunta 1 (adaptador anônimo).** É acoplamento **aceitável**, não débito. `Closeable` foi desenhado deliberadamente mais fino que `IClient` (`lifecycle.ts:12`), e `IClient.close?()` é opcional justamente para não forçar 17 implementações vazias (`IClient.ts:2-12`). Embrulhar o módulo numa classe-fantasma só para "parecer client" seria teatro. O único porém — perda de identidade do closeable no erro — virou `integrability-1`, não uma condenação do adaptador.
- **Julgamento sobre a pergunta 2 (composition root).** O arranjo torna **fácil**: LOC = 2, arquivos = 1, ponto único a inspecionar. O que falta é a rede de segurança contra esquecimento (`integrability-2`) — o mesmo bug que motivou o arquivo pode voltar, e o teste é a defesa.
- **Julgamento sobre a pergunta 3 (`services/` → `http/`).** É inversão real, mas **não é problema deste delta** — o padrão já existia (StalenessDetector, JobExecucaoRepository) desde ADR-0042. Aqui vira P3 porque a solução (mover `redact.ts` para `utils/`) é de baixo custo e resolve os 3 sítios de uma vez.
- **Cross-QA.** F-integrability-1 (identidade no log) casa com **Availability** (drain observável) e **Fault-Tolerance** (diagnóstico de shutdown parcial). F-integrability-2 (teste do registry) casa com **Testability** (contract test do composition root) e **Deployability** (regressão do vazamento por deploy). F-integrability-3 (redact fora de `http/`) casa com **Modifiability** (o mesmo import precisará ser refeito quando o BE-11 mover o arquivo).
