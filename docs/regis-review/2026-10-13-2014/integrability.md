---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-13-2014
agent: qa-integrability
generated_at: 2026-10-13T20:30:00-03:00
scope: backend
score: 7.5
findings_count: 6
cards_count: 5
---

# Integrability — Regis-Review

> Escopo: delta `git diff 5a17d3e HEAD` (DDA dentro da ingestão de pagamentos). Só o que o delta toca:
> acoplamento `IngestaoPagamentosService -> BoletoDdaService`, fronteiras Conexos `fin064`/`fin124`,
> teto de sessão do robô, mudança de contrato de resultado e consumidores.

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex / evolução do Conexos | Conexos muda `fin064`/`fin124` (campo renomeado, latência maior) ou entra outro consumidor do pool DDA | `ConexosSispagClient`, `ConexosDdaClient`, `BoletoDdaService`, `IngestaoPagamentosService`, contrato de resultado + frontend | Operação normal; crons 07h/12h/16h BRT + abertura de tela (TTL 30 min) | Ingestão continua entregando a carteira; a degradação do DDA é visível, tipada e confinada ao `dda.estado` | 0 arquivos fora de `client/` + `service/sispag/` + 1 interface por mudança de campo; ingestão nunca derrubada pelo DDA; custo de latência limitado e conhecido |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients com método HTTP genérico vazado (delta) | 0 (`ConexosDdaClient` expõe só `listarArquivos`/`listarItens`) | 0 | ✅ | `ConexosDdaClient.ts:50-52` |
| Boundary com Zod no delta (`docEspNumero`) | 1/1 campo novo (`strOpt` tolerante) | 100% | ✅ | `ConexosSispagClient.ts:83` |
| Arquivos de produção que mudam por campo novo do fin064 | 6 (client, interface, repo, migration, tests) | ≤ 6 | ✅ | `git diff --stat` |
| Colaboradores injetados em `IngestaoPagamentosService` | 10 (era 9) | ≤ 8 | ⚠️ | `IngestaoPagamentosService.ts:44-56` |
| Dependência Service→Service concreta nova | 1 (`BoletoDdaService`, ele próprio com ≥ 10 deps) | 0 (via porta estreita) | ⚠️ | `IngestaoPagamentosService.ts:56` |
| Concorrência Conexos no pior instante | 3 (DDA, `FANOUT_LIMIT`) depois 3 (títulos); nunca somadas | ≤ cap de sessões | ✅ | `BoletoDdaService.ts:28`, `IngestaoPagamentosService.ts:187-208` |
| Conexões do pool PG demandadas no pico da sync | 2 locks advisory + 3 `salvarArquivo` = 5 de `max: 5` (100%) | < 100% | ⚠️ | `PostgreeDatabaseClient.ts:37,218`; `BoletoDdaService.ts:135-145` |
| Orçamento de latência DDA vs ingestão | 60 s vs ~10 s medidos (6×) | medido em PRD | ⚠️ | `IngestaoPagamentosService.ts:24-29` |
| Campos novos do resultado refletidos em `frontend/lib/sispag.ts` | 0 de 3 (`dda`, `arquivosAdiados`, `filiaisSemFlagBoleto`/`filiaisComFalha` já ausentes) | 100% | ❌ | `frontend/lib/sispag.ts:130-135, 1315-1320` |
| Janela diária de falso alerta "DDA parado" (dia útil) | ~7 h (00:00–07:00 BRT; gap 16h→07h = 15 h > 8 h) | 0 h | ⚠️ | `ddaDefasado.ts:8`; `.github/workflows/ingest-sispag.yml:25-27` |
| Contador/coluna estruturada de falha por dependência (fin124) | 0 (só texto em `error_message`) | ≥ 1 | ❌ | `IngestaoPagamentosService.ts:283-292` |
| Caminho SSM / infra | Não medível localmente: `infra/` não existe | — | ⚠️ | CLAUDE.md |
| Testes de contrato fixture-based do delta | 1 caso novo em `ConexosSispagClient.test.ts`; `ConexosDdaClient.test.ts` com fixture PRD 2026-09-23 | 100% | ✅ | testes citados |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Nenhuma chamada HTTP nova fora de client; `docEspNumero` entra como `numeroDocumento` (nome de domínio) | ✅ presente | `ConexosSispagClient.ts:381` |
| Use an Intermediary | Ingestão chama `BoletoDdaService` concreto (que carrega lista/consolidação da aba), sem porta estreita | ⚠️ parcial | `IngestaoPagamentosService.ts:56,194` |
| Restrict Communication Paths | Ingestão só usa `sincronizar`; mas o tipo exposto é o do serviço inteiro | ⚠️ parcial | `BoletoDdaService.ts:90-101` |
| Adhere to Standards | Zod `.passthrough()`/`safeParse` nos boundaries; migration aditiva nullable + COALESCE | ✅ presente | `0083_titulo_doc_esp_numero.sql`; `TituloAPagarRepository.ts` |
| Abstract Common Services | Mesmo advisory lock + `IngestLockBusyError` reaproveitados; `ConexosBaseClient` único dono da sessão | ✅ presente | `BoletoDdaService.ts:100-108` |
| Discover Service | Sem mudança; SSM/tenants não existem (alvo) | N/A | CLAUDE.md "Estado Atual vs. Alvo" |
| Tailor Interface | `prazoMs`/`releituraDias` opcionais, default = comportamento antigo; `releituraDias` sem chamador | ⚠️ parcial | `BoletoDdaService.ts:96-98`; grep: 0 chamadores |
| Configure Behavior | Prazo é constante exportada, não config | ⚠️ parcial | `IngestaoPagamentosService.ts:29` |
| Manage Resources | Sequencial DDA → títulos mantém ≤ 3 leituras Conexos; mas pool PG chega a 5/5 | ⚠️ parcial | ver F-integrability-3 |
| Orchestrate | Orquestração linear e síncrona (DDA → filiais → upsert); DDA tipado como enriquecimento, nunca aborta | ✅ presente | `IngestaoPagamentosService.ts:297-300` |
| Manage Resource Coupling | Lock próprio (`726354820`) ≠ lock da ingestão (`726354819`); `ocupada` não vira erro | ✅ presente | `BoletoDdaService.ts:26`; `IngestaoPagamentosService.ts:213` |
| Contract testing | Fixture real para `fin124`; 1 caso para `docEspNumero`; nenhum teste de forma do JSON ingestão→frontend | ⚠️ parcial | `ConexosDdaClient.test.ts:14` |
| Versioning strategy | Contrato interno aditivo (campo opcional `dda?`); frontend não versionado | ⚠️ parcial | `SispagInterface.ts:208-216` |
| Backward-compat shims | Resultado novo é aditivo: consumidores antigos ignoram `dda` sem quebrar | ✅ presente | `SispagInterface.ts:208-216` |
| Observability of integration failures | WARN + `dda.estado` + `error_message`; sem contador por dependência | ⚠️ parcial | F-integrability-5 |

## 4. Findings

### F-integrability-1: contrato do resultado mudou no backend e o espelho do frontend não

- **Severidade**: P2
- **Tactic violada**: Contract testing / Versioning strategy
- **Localização**: `src/frontend/lib/sispag.ts:130-135` (`IngestaoPagamentosResult`), `:1315-1320` (`SincronizacaoDdaResultado`); `src/frontend/app/sispag/components/BoletosDdaTab.tsx:226-238`
- **Evidência (objetiva)**:
  ```
  backend  IngestaoPagamentosResult: runId,status,totalTitulos,totalInativados, dda?, filiaisComFalha?, filiaisSemFlagBoleto?
  frontend IngestaoPagamentosResult: runId,status,totalTitulos,totalInativados            (3 campos a menos)
  backend  SincronizacaoDdaResultado: ...,falhas, arquivosAdiados
  frontend SincronizacaoDdaResultado: ...,falhas                                          (sem arquivosAdiados)
  ```
- **Impacto técnico**: tipos copiados à mão, sem schema compartilhado nem teste de forma. A mudança é aditiva, então nada quebra hoje; mas o botão manual de ingestão não consegue exibir `dda.estado` (falhou/parcial) e o toast do botão "Atualizar DDA" ignora `arquivosAdiados` (hoje sempre 0, pois botão não tem prazo — vira bug no dia em que se passar `prazoMs`).
- **Impacto de negócio**: analista que dispara a ingestão na tela recebe "success" mesmo com pool DDA `falhou`; só descobre pelo aviso de 8 h.
- **Métrica de baseline**: 0 de 3 campos novos do resultado tipados no frontend; 2 interfaces espelhadas manualmente.

### F-integrability-2: aviso de "DDA parado" acoplado a constante de 8 h que contradiz o agendamento dos crons

- **Severidade**: P2
- **Tactic violada**: Configure Behavior (contrato implícito entre dois artefatos)
- **Localização**: `src/frontend/app/sispag/components/ddaDefasado.ts:8`; `.github/workflows/ingest-sispag.yml:25-27`
- **Evidência (objetiva)**:
  ```
  crons: 10:00 UTC (07h BRT, todos os dias), 15:00/19:00 UTC seg-sex (12h, 16h BRT)
  maior intervalo útil: 16h -> 07h = 15 h ; DDA_DEFASADO_HORAS = 8
  ```
- **Impacto técnico**: em todo dia útil, de 00:00 a 07:00 BRT (~7 h) o aviso dispara mesmo com tudo normal; na segunda 00:00–07:00 o pool tem ~41 h legitimamente. O limiar vive no frontend, o horário no workflow: dois lugares a manter em sincronia sem teste.
- **Impacto de negócio**: aviso que dispara sempre vira ruído e o sinal real (os 5 dias sem sincronizar que motivaram o ADR) passa batido.
- **Métrica de baseline**: ~7 h/dia útil de falso positivo (7/24 = 29% do dia).

### F-integrability-3: sincronização aninhada eleva a demanda do pool PG a 5 de 5

- **Severidade**: P2 (rebaixado de P1: contenção não medida em produção, só aritmética de pico)
- **Tactic violada**: Manage Resources
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts:37,210-231`; `BoletoDdaService.ts:100-108,135-145`; `IngestaoPagamentosService.ts:70-79,194`
- **Evidência (objetiva)**:
  ```
  withAdvisoryLock: connectionPool.connect() e segura o client durante onAcquired()
  ingestão: lock PAGAMENTO (1 conexão) -> sincronizarDda -> lock DDA (2ª conexão)
  salvarArquivo em FANOUT_LIMIT=3 -> 3 transações; 2 + 3 = 5 ; poolMaxConnections = 5
  ```
- **Impacto técnico**: antes do delta a ingestão segurava 1 conexão; agora, durante a janela DDA (até ~60 s), qualquer rota Express ou `listar` concorrente espera conexão. Sem deadlock (locks são try-lock, ordem fixa), mas é a fronteira Conexos→Postgres consumindo todo o pool.
- **Impacto de negócio**: tela SISPAG pode travar enquanto o robô sincroniza o DDA, justamente no horário do cron/abertura de tela.
- **Métrica de baseline**: 5/5 conexões (100%) no pico; antes: ≤ 4/5.

### F-integrability-4: ingestão depende do serviço concreto da aba DDA e carrega ~6× de orçamento de latência de uma API externa

- **Severidade**: P2
- **Tactic violada**: Use an Intermediary / Restrict Communication Paths
- **Localização**: `IngestaoPagamentosService.ts:56,187-222`; `BoletoDdaService.ts:90-165`; `DDA_PRAZO_NA_INGESTAO_MS = 60_000`
- **Evidência (objetiva)**:
  ```
  @inject(BoletoDdaService) private readonly boletoDda  -> 10 colaboradores no construtor
  prazo é checado só ao INICIAR cada arquivo (Date.now() > limite); listarArquivos e itens em voo não têm teto
  ```
- **Impacto técnico**: trocar a fonte DDA (outro provedor, ou o `ConexosDdaClient` v2) obriga editar a ingestão e seus testes (mock de serviço com consolidação/paginação). O prazo é "melhor esforço": latência real = 60 s + arquivos em voo (3) + `listarArquivos` paginado (1000/página). Medição em PRD é declarada "a medir" no ADR 0067.
- **Impacto de negócio**: a abertura de tela (TTL 30 min) passa a poder esperar o `fin124`; hoje é ~10 s.
- **Métrica de baseline**: 60 s de teto declarado vs ~10 s da ingestão; 0 medições de latência do `fin124` em PRD.

### F-integrability-5: degradação do `fin124` sem sinal estruturado por dependência; tolerância do parser esconde deriva de contrato

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `IngestaoPagamentosService.ts:213-221,283-292`; `ConexosSispagClient.ts:58-62,83,381`; `ontology` ADR 0067 §2
- **Evidência (objetiva)**:
  ```
  strOpt = z.union([...]).transform(String).optional().catch(undefined)   // docEspNumero malformado/renomeado -> undefined, sem rastro
  dda.estado só vive em: resultado HTTP, console do job e texto de error_message
  ```
- **Impacto técnico**: se o Conexos renomear `docEspNumero`, 100% dos títulos ganham `numeroDocumento = undefined` e o COALESCE preserva o valor antigo — a deriva fica invisível. Falha do DDA exige parsear string de `error_message` para calcular taxa de erro. `error_message` de run `success` já carrega 3 tipos de aviso.
- **Impacto de negócio**: ADR planeja usar `doc_esp_numero` para confirmar casamentos; o campo pode estar silenciosamente desatualizado quando isso for ligado.
- **Métrica de baseline**: 0 colunas/contadores estruturados de estado DDA por run; 0 alarmes de % `numeroDocumento` nulo por rodada.

### F-integrability-6: duas normalizações distintas de `docEspNumero` no mesmo client; `"0"` não tratado

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `ConexosSispagClient.ts:381` (trim apenas) vs `:595` (só dígitos, sem zeros à esquerda); `ConexosNdeFiscalClient.ts:386-391` (descarta `0`)
- **Evidência (objetiva)**:
  ```
  numeroDocumento: r.docEspNumero?.trim() || undefined         // "03501" != "3501"
  numeroNota: (r.docEspNumero ?? '').replace(/\D/g,'').replace(/^0+/,'')
  ```
- **Impacto técnico**: o futuro matcher contra `ditEspNumero` (que o `ConexosDdaClient` só trima, `:34`) terá de reinventar normalização; `"0"` vira número de documento válido.
- **Impacto de negócio**: casamento DDA↔título com falso negativo por zeros à esquerda.
- **Métrica de baseline**: 3 normalizações diferentes do mesmo campo no repo (2 só em `ConexosSispagClient`).

## 5. Cards Kanban

### [integrability-1] Espelhar o contrato novo da ingestão no frontend e mostrar `dda.estado`

- **Problema**
  > `IngestaoPagamentosResult` e `SincronizacaoDdaResultado` ganharam `dda`/`arquivosAdiados` no backend e não no `frontend/lib/sispag.ts`; o botão manual da ingestão não mostra DDA `falhou`/`parcial` e o toast do DDA ignora adiados.

- **Melhoria Proposta**
  > Adicionar os campos opcionais às duas interfaces do frontend, exibir toast de aviso quando `dda.estado` ∈ {falhou, parcial} no fluxo do botão e considerar `arquivosAdiados` no toast do DDA. Teste de forma (fixture JSON do resultado) compartilhado ou duplicado dos dois lados. Tactic: Tailor Interface / Contract testing.

- **Resultado Esperado**
  > Todo campo do resultado público tem tipo no frontend; analista vê pool `falhou` na hora.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Campos novos tipados no frontend: 0/3 → 3/3
  - Toasts que tratam `dda.estado`: 0 → 1
- **Risco de não fazer**: o próximo campo de resultado repete a deriva; falha do DDA continua descoberta só pelo aviso de 8 h.
- **Dependências**: nenhuma

### [integrability-2] Derivar o limiar de "DDA parado" do calendário real dos crons

- **Problema**
  > `DDA_DEFASADO_HORAS = 8` no frontend contra um intervalo noturno legítimo de 15 h (16h→07h BRT): ~7 h/dia útil de falso alerta.

- **Melhoria Proposta**
  > Substituir o limiar fixo por regra com horário comercial (ex.: avisar só entre 08h e 20h BRT em dia útil, ou usar > 16 h) e referenciar o horário dos crons em um único arquivo/ADR; teste que cobre 00:00–07:00 e segunda-feira de manhã. Tactic: Configure Behavior.

- **Resultado Esperado**
  > Aviso só quando houve de fato rodada perdida.

- **Tactic alvo**: Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Horas/dia útil de falso positivo: ~7 → 0
  - Casos de teste de `ddaDefasado` com os horários dos crons: 5 → ≥ 8
- **Risco de não fazer**: o aviso é ignorado por hábito e o próximo pool parado por 5 dias passa em branco.
- **Dependências**: nenhuma

### [integrability-3] Limitar o consumo do pool PG durante a sincronização DDA aninhada

- **Problema**
  > Dois advisory locks seguram 2 conexões enquanto 3 `salvarArquivo` abrem transações: 5/5 do pool.

- **Melhoria Proposta**
  > Opção A: reduzir `FANOUT_LIMIT` do DDA para 2 quando chamado dentro da ingestão (parâmetro opcional). Opção B: obter o lock DDA sem reter conexão extra (liberar o client do lock antes do trabalho, ou lock de sessão numa única conexão compartilhada). Medir tempo de espera de `connect()` durante a rodada. Tactic: Manage Resources.

- **Resultado Esperado**
  > Rotas Express nunca competem com o robô por conexão.

- **Tactic alvo**: Manage Resources
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Conexões do pool no pico: 5/5 → ≤ 4/5
- **Risco de não fazer**: lentidão intermitente na tela SISPAG, difícil de reproduzir.
- **Dependências**: nenhuma

### [integrability-4] Pôr uma porta estreita entre a ingestão e o pool DDA e medir a latência do fin124

- **Problema**
  > A ingestão depende do `BoletoDdaService` completo e herda latência de `fin124` com teto de 60 s sem medição em PRD.

- **Melhoria Proposta**
  > Extrair interface `SincronizadorPoolDda { sincronizar({triggeredBy, prazoMs}) }` implementada por `BoletoDdaService`, injetar a porta; logar duração e `arquivosAdiados` por rodada para calibrar `DDA_PRAZO_NA_INGESTAO_MS`; avaliar passar `releituraDias` reduzido na ingestão (parâmetro hoje sem chamador). Tactic: Use an Intermediary.

- **Resultado Esperado**
  > Trocar a fonte DDA sem tocar a ingestão; prazo calibrado por dado.

- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Dependências Service→Service concretas na ingestão: 1 → 0
  - Rodadas PRD com duração DDA medida: 0 → 100%
- **Risco de não fazer**: o prazo permanece chute e a abertura de tela herda lentidão do ERP sem alarme.
- **Dependências**: nenhuma

### [integrability-5] Registrar o estado DDA e a taxa de campos nulos por rodada da ingestão

- **Problema**
  > O estado do `fin124` só aparece em texto livre e o `strOpt` tolerante apaga qualquer deriva de `docEspNumero`.

- **Melhoria Proposta**
  > Gravar `dda_estado` e contadores (`dda_adiados`, `dda_falhas`) na run (migration aditiva) e logar, por rodada, a razão de títulos com `numeroDocumento` presente; WARN quando a razão cair abaixo de piso (ex.: < 50% do valor da rodada anterior). Normalização única de número de documento em helper compartilhado (F-integrability-6). Tactic: Observability of integration failures.

- **Resultado Esperado**
  > Deriva de contrato e falha de dependência viram consulta SQL, não leitura de texto.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-5, F-integrability-6
- **Métricas de sucesso**:
  - Colunas/contadores estruturados por dependência: 0 → 3
  - Normalizações distintas de `docEspNumero`: 3 → 1
- **Risco de não fazer**: ao ligar o casamento por `doc_esp_numero`, dados defasados geram falso negativo sem aviso.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo só no delta. Pontos fortes: nada novo vaza HTTP; DDA tratado como enriquecimento (nunca aborta); Conexos sequencial respeita o cap de sessão do robô (ADR-0066 §3); mudança de resultado é aditiva.
- Nenhum P0/P1: não há baseline numérico de dano observado em produção (latência fin124 "a medir" no ADR).
- Cross-QA: F-integrability-3 (pool) e F-integrability-4 (latência) vão para Performance/Availability; F-integrability-5 para Fault Tolerance/Observability; F-integrability-4 também Modifiability (Encapsulate).
- Não medível: SSM/Terraform (não existe `infra/`); latência real do `fin124` em PRD.
