---
qa: Testability
qa_slug: testability
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-testability
generated_at: 2026-10-30T22:43:00Z
scope: backend+frontend (diff dda-pool-limpo)
score: 7
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev que mexe no pool da aba "Boletos DDA" (novas situações `FORA_JANELA` / `TITULO_SAIU_CARTEIRA`, colapso de cópias por `codbar`, janela compartilhada hoje−15/+45) | PR encosta em `ConsolidacaoBoletoDda`, `PaginacaoBoletoDda`, `BoletoDdaService`, `TituloAPagarRepository.listInativosRecentes` e no bump da janela | Serviços SISPAG + repositório de títulos + aba React | CI local + Jest (`src/backend` e `src/frontend`); sem CI/coverage gate explícito no repo | Testes do diff defendem: (a) 1 linha por `codbar`, (b) desempate `ddcCod→ditCod`, (c) grupo CONFIRMADO numa cópia vence SUGERIDO na outra, (d) bordas da janela, (e) regra ±R$ 0,05 / ±10 dias do "saiu da carteira", (f) precedência CAND > FORA > SAIU > SEM_TITULO, (g) `arquivos`/`copias` no frontend | 95/95 testes passam em 12,5 s; cobertura de ramos de `situacaoDoLivre` ≥ 100% (medido pelos branches do switch de situação); 0 teste no repositório para a nova query SQL `listInativosRecentes`; 0 teste de integração em Postgres para a comparação civil `(vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes passando no diff | 95/95 em 12,5 s | 100% | ✅ | `npx jest ConsolidacaoBoletoDda.test PaginacaoBoletoDda.test BoletoDdaService.test` |
| `it`s novos em `ConsolidacaoBoletoDda.test.ts` | 12 (`colapsarCopias` 5, janela 4, saiuDaCarteira 3) | ≥ 1 por ramo lógico novo | ✅ | diff — `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.test.ts` |
| `it`s novos em `PaginacaoBoletoDda.test.ts` | 4 (facetas escondidas, filtro próprio, totais, `situacoes[]`) | ≥ 1 por nova faceta | ✅ | diff |
| `it`s novos em `BoletoDdaService.test.ts` | 2 (grupo em cópia antiga; CONFIRMADO vence SUGERIDO) | ≥ 2 | ✅ | diff |
| `it`s novos em `BoletosDdaTab.test.tsx` | 3 (contador "em N arquivos", segmento "Saiu da carteira", card/segmento "Fora da janela") | ≥ 3 | ✅ | diff |
| Testes unitários do novo método `TituloAPagarRepository.listInativosRecentes` | **0** | ≥ 1 (espelho de `listAtivos`, LN 136 do mesmo arquivo) | ❌ | `grep listInativosRecentes src/backend/domain/repository/sispag/TituloAPagarRepository.test.ts` → vazio |
| Integração Postgres para a comparação civil de `listInativosRecentes` | **0** | ≥ 1 (comparar dia 00:00Z e 15:00Z nas bordas) | ❌ | `TituloAPagarRepository.integration.test.ts` não cita `listInativosRecentes`; precedente histórico: incidente 2026-10-14 ("Vencimento é dia civil, não instante") |
| Teste de rota para a enum nova de situações (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA` como `?situacao=` ou `?situacoes[]=`) | **0** (mas enum é derivada automaticamente de `BOLETO_DDA_SITUACAO` em `SITUACOES_FILTRAVEIS`, logo não há risco de drift) | ≥ 1 round-trip | ⚠️ | `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:410` e `src/backend/routes/sispag.ts:1547,1567` |
| Relógio injetado na consolidação | Sim — `BankingCalendar` injetado (`this.calendar.todayBrt()`, `addDays`, `fromErpEpoch`) | Injetado | ✅ | `ConsolidacaoBoletoDda.consolidar` LN 83–87 |
| Clock asymmetry: `IngestaoPagamentosService` usa `Date.now()` cru para a mesma janela | **1 ocorrência** (LN 367), mesmo arquivo que agora importa `JANELA_CARTEIRA_*` — a constante virou fonte única mas o relógio não | 0 | ⚠️ | `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:367-368` |
| LOC do maior test touched | `BoletoDdaService.test.ts` 647 LOC | ≤ 500 LOC | ⚠️ | `wc -l` |
| Bordas da janela cobertas no teste | 4 bordas (hoje-15, hoje-16, hoje+45, hoje+46) com `2026-09-07/08` e `2026-11-07/08` | 4 | ✅ | `ConsolidacaoBoletoDda.test.ts` LN 300–309 (bloco "janela da carteira") |
| Limites `|Δvalor| ≤ 0,05` / `|Δdias| ≤ 10` cobertos | 6 pontos (0,05 dentro, 0,06 fora, −10 d dentro, −11 d fora, +10 d dentro, +11 d fora) | 6 | ✅ | `ConsolidacaoBoletoDda.test.ts` bloco "fora dos limites" |
| Coverage report global | **Não medido** (apenas o alvo foi executado; o escopo é diff-only e rodar `--coverage` em `src/backend` levaria muito além do diff) | — | ⚠️ Não medível com escopo diff | — |

> ⚠️ **Não medível localmente**: `coverageThreshold` em `jest.config` do backend (não há gate numérico configurado, só convenção). Instrumentar com `coverageThreshold` por diretório (`domain/service` ≥ 80% linhas, 70% ramos) é card recorrente de outro QA (deployability/CI gate).

## 3. Tactics — Cobertura no diff

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Serviço aceita `ConsolidacaoEntrada` com `titulosSaidos?` opcional, isolando o seam novo para o teste injetar listas pequenas | ✅ | `ConsolidacaoBoletoDda.ts:30-45` |
| Recordable Test Cases | Códigos de barras reais do fin124 (ex.: `34193158000004815331090113433700004286589000`) e vencimentos civis absolutos (`2026-09-07`) usados como fixtures literais nos testes | ✅ parcial | `ConsolidacaoBoletoDda.test.ts` descrição `(hoje 2026-09-23 → 2026-09-08 a 2026-11-07)` |
| Sandbox | `BankingCalendar` injetado permite fixar "hoje" sem `jest.useFakeTimers`; frontend usa `mockFetch` + `MSW-ish` wrapper (`pagina()`) | ✅ | `ConsolidacaoBoletoDda.test.ts` (calendar fixo); `BoletosDdaTab.test.tsx` (mockFetch) |
| Executable Assertions | `expect(linha).toMatchObject({ situacao: 'TITULO_SAIU_CARTEIRA', candidatos: [], titulosSaidos: [...] })` casa a forma inteira do retorno — contrato explícito | ✅ | `ConsolidacaoBoletoDda.test.ts` LN 376+ |
| Abstract Data Sources | `listAtivos` + `listInativosRecentes` mockados por `jest.fn().mockResolvedValue([])` no service test; serviço não toca Postgres | ✅ | `BoletoDdaService.test.ts:64-67` |
| Limit Structural Complexity | Service `comGrupo` ganhou lógica não-trivial de busca por cópia e desempate; cobertura via 2 cenários próprios (`grupo numa cópia antiga`, `CONFIRMADO vence SUGERIDO`) | ✅ | `BoletoDdaService.ts:178-207`; `BoletoDdaService.test.ts:284-337` |
| Limit Non-Determinism | Consolidação usa relógio injetado; ingestão (`IngestaoPagamentosService`) ainda lê `Date.now()` diretamente, no MESMO arquivo que agora importa `JANELA_CARTEIRA_*` — fonte única da constante, mas não do relógio | ⚠️ | `IngestaoPagamentosService.ts:367-368` |

## 4. Findings

### F-testability-1: `TituloAPagarRepository.listInativosRecentes` não tem teste unitário

- **Severidade**: P1
- **Tactic violada**: Abstract Data Sources
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:254-269`
- **Evidência (objetiva)**:
  ```
  grep listInativosRecentes src/backend/domain/repository/sispag/TituloAPagarRepository.test.ts  → 0 matches
  grep listInativosRecentes src/backend/domain/repository/sispag/TituloAPagarRepository.integration.test.ts → 0 matches
  (listAtivos tem teste espelho em LN 136-173 do unit test; listInativosRecentes não)
  ```
- **Impacto técnico**: o SQL novo filtra por `ativo = FALSE AND vencimento IS NOT NULL AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date`. Qualquer alteração silenciosa (p. ex. tirar o `AT TIME ZONE 'UTC'` para "simplificar") passa pelo gate verde sem alarme — e desloca a borda em 3 h (horário de Brasília), movendo até 24 h de títulos saídos para dentro/fora do intervalo.
- **Impacto de negócio**: a aba Boletos DDA deixa de apontar `TITULO_SAIU_CARTEIRA` para boletos cujo título saiu num dia de borda, obrigando o analista a procurar manualmente o título morto para entender o boleto. Precedente: Incidente 2026-10-14 ("Vencimento é dia civil, não instante") custou 15 lotes / 79 itens desfeitos.
- **Métrica de baseline**: 0 testes para `listInativosRecentes` (unit + integração); `listAtivos` tem 1 unit e 2 integração.

### F-testability-2: `IngestaoPagamentosService` continua lendo `Date.now()` cru para a mesma janela

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:367-368`
- **Evidência (objetiva)**:
  ```typescript
  const now = Date.now();
  const minVencimento = now - JANELA_CARTEIRA_DIAS_ATRAS * DAY_MS;
  const maxVencimento = now + JANELA_CARTEIRA_DIAS_ADIANTE * DAY_MS;
  ```
  Mesmo arquivo que acabou de importar `JANELA_CARTEIRA_*` para unificar as pontas da janela. `ConsolidacaoBoletoDda`, no mesmo diff, usa `this.calendar.todayBrt()` + `addDays`.
- **Impacto técnico**: a janela ingerida e a janela consolidada divergem até 3 h em corridas rodando por volta da virada do dia (00:00 BRT ≈ 03:00 UTC). O teste da consolidação consegue reproduzir qualquer borda; o teste da ingestão não — qualquer bug de borda só aparece em prod.
- **Impacto de negócio**: discrepância rara, mas sintomática: um boleto cujo título vence 2026-09-08 pode entrar na ingestão às 02:00 BRT (minVencimento = 2026-09-07) e sair da consolidação (hoje BRT ainda é 09-07; janela só vai até 09-07 + 45 = 10-22, não 09-08 + 45). Baixa frequência, difícil de depurar.
- **Métrica de baseline**: 1 fonte de não-determinismo (Date.now) remanescente no caminho SISPAG tocado pelo diff; `ConsolidacaoBoletoDda` tem 0.

### F-testability-3: Nenhum round-trip de rota exercita `FORA_JANELA` / `TITULO_SAIU_CARTEIRA`

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (contrato de borda HTTP)
- **Localização**: `src/backend/routes/sispag.ts:1547,1567` + `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:410`
- **Evidência (objetiva)**:
  ```
  SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO)   // auto-deriva da enum
  z.enum(SITUACOES_FILTRAVEIS)                                // Zod aceita o que a enum lista
  grep "FORA_JANELA\|TITULO_SAIU_CARTEIRA" src/backend/routes → 0 matches
  ```
- **Impacto técnico**: baixo — a enum é derivada em compile-time, não há drift possível entre a situação do domínio e o Zod. Mas também não há teste que grave o contrato: um dia que alguém mudar `SITUACOES_FILTRAVEIS` para uma whitelist explícita (defensível por querer esconder situações internas), a quebra não aparece.
- **Impacto de negócio**: potencial de regressão silenciosa na API pública. Risco mitigado pela geração automática.
- **Métrica de baseline**: 0 testes em `src/backend/routes/sispag*.test.ts` que mandem `?situacao=FORA_JANELA` ou `?situacoes=TITULO_SAIU_CARTEIRA`.

### F-testability-4: `BoletoDdaService.test.ts` cresceu a 647 LOC

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.test.ts`
- **Evidência (objetiva)**:
  ```
  wc -l BoletoDdaService.test.ts  → 647
  wc -l ConsolidacaoBoletoDda.test.ts → 417
  wc -l PaginacaoBoletoDda.test.ts → 454
  ```
- **Impacto técnico**: file is becoming the catch-all for todo o service — risco de que o próximo `it` seja agregado em vez de refatorado em sub-arquivos (`BoletoDdaService.comGrupo.test.ts`, `BoletoDdaService.listar.test.ts`).
- **Impacto de negócio**: nenhum hoje; dor futura ao navegar/debuggar.
- **Métrica de baseline**: 647 LOC vs limiar 500 LOC.

### F-testability-5: Teste do colapso de cópias não cobre o caso "sem credor em nenhuma cópia"

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (completude de cenários)
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:155-192` (ramo `saiuDaCarteira` sem credor); testes correspondentes em `ConsolidacaoBoletoDda.test.ts` bloco "saiu da carteira"
- **Evidência (objetiva)**: todos os `saido()` do teste usam `credor: 'FORNECEDOR X'`; o spread `...(s.titulo.credor ? { credor: s.titulo.credor } : {})` em `saiuDaCarteira` não é exercitado no caminho "sem credor".
- **Impacto técnico**: ramo não coberto; se o backend passar a devolver `credor: ''` em algum ponto, a propriedade pode ir como `credor: ''` para o frontend (que faz `screen.findByText('FORNECEDOR X')` no diff de `BoletosDdaTab.test.tsx` — regressão silenciosa).
- **Impacto de negócio**: nenhum concreto hoje.
- **Métrica de baseline**: 0 casos de `titulosSaidos` sem credor nos testes do diff.

## 5. Cards Kanban

### [testability-1] Fechar o seam do `listInativosRecentes` com teste unitário + integração civil

- **Problema**
  > O novo método `TituloAPagarRepository.listInativosRecentes` entrega a lista que alimenta `TITULO_SAIU_CARTEIRA` sem nenhum teste no repositório. O SQL compara dia civil com `(vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date` — exatamente o padrão que o incidente 2026-10-14 (desfazimento de 15 lotes / 79 itens) nos ensinou a defender com teste de borda em Postgres real.

- **Melhoria Proposta**
  > Adicionar (a) um unit test espelho do `listAtivos` em `TituloAPagarRepository.test.ts` assertando `ativo = FALSE` no SQL e `{ de, ate }` nos parâmetros; (b) um caso em `TituloAPagarRepository.integration.test.ts` inserindo três títulos com `vencimento` em 00:00Z, 15:00Z e 23:00Z do dia da borda `ate`, verificando quais entram. Tactic Bass alvo: **Abstract Data Sources** + **Executable Assertions**. Arquivos: `src/backend/domain/repository/sispag/TituloAPagarRepository.test.ts`, `TituloAPagarRepository.integration.test.ts`.

- **Resultado Esperado**
  > Nova query ganha o mesmo nível de guarda que `listAtivos`. Métricas: `# testes unit para listInativosRecentes`: 0 → 1; `# testes integração para listInativosRecentes`: 0 → 1 (3 asserções de borda civil).

- **Tactic alvo**: Abstract Data Sources
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes unit do método: 0 → 1
  - Testes integração do método: 0 → 1 (cobrindo bordas 00:00Z e 15:00Z)
- **Risco de não fazer**: edição silenciosa do `AT TIME ZONE 'UTC'` desloca a borda em 3 h; a aba Boletos DDA deixa de mostrar `TITULO_SAIU_CARTEIRA` em dias de borda, voltando o analista ao search manual (regressão idêntica à ADR-0070, Incidente 2026-10-14).
- **Dependências**: nenhuma.

### [testability-2] Trocar `Date.now()` da `IngestaoPagamentosService` pelo relógio injetado

- **Problema**
  > O mesmo arquivo que importa `JANELA_CARTEIRA_*` para unificar as pontas da janela ainda calcula `const now = Date.now()` cru para derivar `minVencimento`/`maxVencimento`. `ConsolidacaoBoletoDda` já usa `calendar.todayBrt()` + `addDays`. A janela virou constante única, mas o relógio não — teste de borda do ingestor é impossível sem `jest.useFakeTimers`.

- **Melhoria Proposta**
  > Injetar `BankingCalendar` (que já é `@injectable()`) no `IngestaoPagamentosService` e substituir `Date.now()` por `calendar.todayBrt()` + `calendar.addDays(hoje, ±N)`. Converter para epoch via `toErpEpoch` se o consumidor do intervalo exigir número. Tactic Bass alvo: **Limit Non-Determinism**. Arquivo: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:367-368`.

- **Resultado Esperado**
  > A ingestão passa a ser testável no mesmo nível da consolidação; borda do dia virando no meio da corrida vira caso de teste. Métrica: `# ocorrências de Date.now() em IngestaoPagamentosService`: 1 → 0.

- **Tactic alvo**: Limit Non-Determinism (cross-QA: Modifiability — clock como seam injetável)
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - `Date.now()` em `IngestaoPagamentosService.ts`: 1 → 0
  - Teste novo cobrindo a borda com relógio fixo: 0 → 1
- **Risco de não fazer**: discrepância rara entre janela ingerida e janela consolidada em corridas por volta da virada do dia; incidente de baixa frequência e alto custo de diagnóstico.
- **Dependências**: nenhuma; `BankingCalendar` já é injetável.

### [testability-3] Gravar o contrato das novas situações num teste de rota

- **Problema**
  > `FORA_JANELA` e `TITULO_SAIU_CARTEIRA` entraram no contrato HTTP (`?situacao=` e `?situacoes[]=`) via `SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO)`. Hoje a derivação automática protege contra drift, mas o contrato não está gravado — qualquer troca para whitelist explícita passa verde.

- **Melhoria Proposta**
  > Adicionar um `it` em `src/backend/routes/sispag.test.ts` que mande `GET /sispag/boletos-dda?situacao=FORA_JANELA` e outro com `?situacoes=TITULO_SAIU_CARTEIRA` e exija 200. Tactic Bass alvo: **Executable Assertions** (contratos HTTP). Arquivo: `src/backend/routes/sispag.test.ts`.

- **Resultado Esperado**
  > Contrato das duas situações novas vira teste explícito. Métrica: `# testes de rota exercitando FORA_JANELA/TITULO_SAIU_CARTEIRA`: 0 → 2.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Testes de rota com as duas situações: 0 → 2
- **Risco de não fazer**: alguém "defende" a API escondendo situações internas; rotas e aba divergem sem alarme.
- **Dependências**: nenhuma.

### [testability-4] Partir `BoletoDdaService.test.ts` por responsabilidade

- **Problema**
  > O test file passou de ~580 para 647 LOC com os 2 `it`s novos de cópia + grupo. Ainda estável, mas colando no limiar em que o próximo PR vai agregar em vez de refatorar.

- **Melhoria Proposta**
  > Separar em `BoletoDdaService.listar.test.ts` (acoplamento com consolidação + paginação) e `BoletoDdaService.comGrupo.test.ts` (lógica de cópias e desempate de grupo CONFIRMADO vs SUGERIDO). Tactic Bass alvo: **Limit Structural Complexity**.

- **Resultado Esperado**
  > Nenhum file > 500 LOC entre os testes do service SISPAG DDA. Métrica: `max LOC entre os test files tocados`: 647 → ≤ 400.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Maior test file do service: 647 → ≤ 400 LOC
- **Risco de não fazer**: o próximo diff que mexer em `comGrupo` empurra o file para 700+ LOC; navegação piora, probabilidade de teste duplicado sobe.
- **Dependências**: idealmente após [testability-1] e [testability-2] para evitar rebase.

### [testability-5] Caso "saiu da carteira sem credor" no teste de consolidação

- **Problema**
  > O ramo `...(s.titulo.credor ? { credor: s.titulo.credor } : {})` do `saiuDaCarteira` não tem teste; o frontend assume que `credor` existe (`screen.findByText('FORNECEDOR SAIDO LTDA')` no teste do `BoletosDdaTab`).

- **Melhoria Proposta**
  > Um `it` novo no bloco "título que saiu da carteira" com `saido({ valor: 100, vencimento: utc('2026-09-22'), credor: undefined })` e assertando que a linha devolve `titulosSaidos[0]` sem a chave `credor`. Tactic Bass alvo: **Executable Assertions**. Arquivo: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.test.ts`.

- **Resultado Esperado**
  > Ramo coberto. Métrica: `# cenários de titulosSaidos sem credor`: 0 → 1.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Cenários cobrindo `credor` ausente em `titulosSaidos`: 0 → 1
- **Risco de não fazer**: nenhum concreto; higienização de ramos.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo diff-only: não rodei `--coverage` global (fora do escopo e custoso); medi exclusivamente os três test files tocados + os 3 novos cenários no frontend. 95/95 passam em 12,5 s.
- Clock asymmetry em `IngestaoPagamentosService` **é pré-existente**, mas o diff tocou o arquivo (extraiu a constante da janela), o que torna o momento certo para fechar. Marquei P2 por isso — não é dívida nova, é dívida tocada.
- Cross-QA: [testability-1] encosta em **Fault Tolerance** (comparação civil de borda, mesma classe de bug da ADR-0070); [testability-2] encosta em **Modifiability** (clock como seam); [testability-3] encosta em **Integrability** (contrato HTTP).
- Enum de situações é derivada por `Object.values(BOLETO_DDA_SITUACAO)` em compile-time — por isso rebaixei o drift de Zod de P1 para P3.
- Determinismo da consolidação: `BankingCalendar` injetado, bordas da janela cobertas com datas absolutas (2026-09-07/08, 2026-11-07/08). Esta parte do diff está genuinamente blindada.
