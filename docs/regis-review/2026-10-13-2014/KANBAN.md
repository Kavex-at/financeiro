---
type: regis-review-kanban
run_id: 2026-10-13-2014
total: 30
counts: { p0: 0, p1: 0, p2: 22, p3: 8 }
---

# Kanban — financeiro — 2026-10-13-2014

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Dentro da mesma prioridade e esforço, desempate pelo peso do QA (Security > Fault Tolerance > Availability > Modifiability > Testability > Performance > Integrability > Deployability).
> Escopo: delta da branch `worktree-sispag-dda-na-ingestao` (`5a17d3e..HEAD`), não o repositório inteiro.
> Cards copiados verbatim das 8 seções QA; IDs inalterados. Cards sobrepostos entre QAs estão sinalizados na linha "Sobreposição" (único acréscimo do consolidador).

## P0 — Crítico

Nenhum card nesta prioridade (nenhum QA levantou P0 neste ciclo).

---

## P1 — Alto

Nenhum card nesta prioridade (nenhum QA levantou P1 neste ciclo).

---

## P2 — Médio

### [security-1] Redigir o erro da sincronização DDA antes de persistir, logar e anotar

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-1, F-security-2

**Problema**
> A sync DDA embutida na ingestão grava `error.message` (limitado por `slice`, não por redação) em `error_message` da run, no WARN, no resultado da rota e no `::warning::` do Actions. Erros de Postgres/rede podem trazer usuário, host ou connection string; o `redactErrorMessage` do repo existe e não foi usado.

**Melhoria Proposta**
> Em `sincronizarDda`, calcular `const erro = redactErrorMessage(error instanceof Error ? error.message : String(error))` e usar esse valor no `avisar`, em `dda.erro` e (por consequência) em `avisoDaRun` e no `::warning::`. Aplicar o mesmo em `BoletoDdaService.ts:155-160` (WARN por arquivo). Teste: erro com `password authentication failed for user "x"` não aparece em `error_message`.

**Resultado Esperado**
> Pontos de saída de erro livre sem redação no delta: 4 → 0. Nenhum texto de driver chega ao banco, ao JSON de rota ou ao log do Actions sem passar pelo redactor.

**Métricas de sucesso**
- Pontos sem redação no delta: 4 → 0
- Teste unitário cobrindo mensagem com credencial: 0 → 1

**Risco de não fazer**
> uma falha de banco no horário da sync grava credencial/topologia em tabela legível por perfil `sispag:ver` e no log do workflow.

**Dependências**: nenhuma.

---

### [fault-tolerance-1] Impor timeout duro à fase DDA dentro da ingestão

**QA**: Fault Tolerance
**Tactic alvo**: Timeout
**Esforço**: S
**Findings**: F-fault-tolerance-1
**Sobreposição**: mesma correção de availability-1 e performance-3 (teto rígido da fase DDA); implementar uma vez.

**Problema**
> O prazo de 60 s só é checado antes de iniciar cada arquivo; chamadas `fin124` em voo não têm timeout e a fase mantém o lock da ingestão. A carteira passou a depender de um acessório sem teto real.

**Melhoria Proposta**
> Envolver `sincronizarDda` em `Promise.race` com teto absoluto (ex.: 90 s) e `AbortSignal`/timeout por página em `ConexosDdaClient.listarTudo`, convertendo estouro em `parcial`/`falhou` (Timeout). Tocar `IngestaoPagamentosService.sincronizarDda`, `ConexosDdaClient`.

**Resultado Esperado**
> Pior caso da fase DDA limitado e testado: hoje sem limite -> <= 90 s; carteira nunca fica presa por `fin124`.

**Métricas de sucesso**
- Timeouts duros na fase DDA: 0 -> 1 por chamada e 1 global
- Duração máxima da fase DDA: ilimitada -> <= 90 s

**Risco de não fazer**
> uma lentidão do `fin124` trava a atualização da carteira em horário de pagamento.

**Dependências**: nenhuma.

---

### [fault-tolerance-2] Recuperar folga do pool durante a fase DDA

**QA**: Fault Tolerance
**Tactic alvo**: Redundancy (capacidade) / Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-2
**Sobreposição**: mesma correção de performance-4 e integrability-3 (folga do pool PG); implementar uma vez.

**Problema**
> Lock da ingestão + lock DDA + 3 `salvarArquivo` concorrentes consomem 5/5 conexões do pool, sem folga para requisições da tela que dispara a ingestão.

**Melhoria Proposta**
> Reduzir `FANOUT_LIMIT` para 2 quando `prazoMs` estiver presente (modo ingestão), ou subir `poolMaxConnections` para 8 se o pooler permitir. Documentar a conta do pool ao lado da constante.

**Resultado Esperado**
> Folga de pool 0/5 -> >= 1 conexão durante a fase DDA.

**Métricas de sucesso**
- Conexões livres no pior instante: 0 -> >= 1

**Risco de não fazer**
> erros 5xx intermitentes na abertura da tela, difíceis de reproduzir.

**Dependências**: nenhuma.

---

### [fault-tolerance-3] Barrar substituição de arquivo DDA por lista vazia ou parse parcial

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking
**Esforço**: S
**Findings**: F-fault-tolerance-3
**Sobreposição**: único card do wipe por parse vazio em `salvarArquivo`; teste de regressão incluso.

**Problema**
> `listarItens` descarta linhas inválidas em silêncio e `salvarArquivo` com lista vazia apaga todos os boletos do arquivo; agora a releitura é automática 3x/dia.

**Melhoria Proposta**
> Em `listarItens`, contar linhas rejeitadas e lançar erro se rejeitadas > 0 (ou razão alta); em `executarSincronizacao`, se `itens.length === 0` e o arquivo já tinha `total_itens > 0`, tratar como falha (arquivo preservado, conta em `falhas`). Sanity Checking + Repair State.

**Resultado Esperado**
> Drift de schema não apaga o pool: arquivos apagados por resposta vazia/ilegível 0 por incidente (hoje sem guarda).

**Métricas de sucesso**
- Guardas contra substituição vazia: 0 -> 2 (parse e vazio-sobre-cheio)
- Teste de regressão: 0 -> 1 por guarda

**Risco de não fazer**
> uma mudança de layout do Conexos esvazia o pool em silêncio e a aba mostra "boleto sem DDA" até alguém notar.

**Dependências**: nenhuma.

---

### [availability-1] Limitar rigidamente a fase DDA ao prazo da ingestão

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: S
**Findings**: F-availability-1
**Sobreposição**: mesma correção de performance-3 e fault-tolerance-1 (teto rígido da fase DDA); implementar uma vez.

**Problema**
> O prazo de 60 s só é verificado no início de cada arquivo; `listarArquivos` e até 3 arquivos em voo (timeout 40 s por chamada, com retry) podem estourar o orçamento enquanto a ingestão segura o lock e a conexão. Pior caso não medido em produção.

**Melhoria Proposta**
> Aplicar `Promise.race` com o orçamento restante (ou `AbortSignal.timeout`) em torno de `listarArquivos` e `listarItens` em `BoletoDdaService.executarSincronizacao`, contando o arquivo interrompido como `arquivosAdiados`. Tactic: Exception Prevention. Mover `DDA_PRAZO_NA_INGESTAO_MS` para `EnvironmentProvider` com default 60 000.

**Resultado Esperado**
> Fase DDA nunca excede prazo + margem fixa (ex.: 65 s). Hoje: teto implícito não medido → alvo: ≤ 65 s verificado por teste com client que nunca resolve.

**Métricas de sucesso**
- Duração máxima da fase DDA em teste com dependência pendurada: não limitada → ≤ prazo + 5 s

**Risco de não fazer**
> Um `fin124` lento transforma cada abertura de tela em espera longa e segura a conexão do pool e o lock da ingestão.

**Dependências**: nenhuma

---

### [modifiability-1] Reduzir `runIngestion` para complexidade ≤ 15

**QA**: Modifiability
**Tactic alvo**: Refactor / Split Module
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> `runIngestion` mede complexidade cognitiva 20 (limite 15) e ~133 LOC; a sync DDA entrou como mais uma etapa do mesmo método.

**Melhoria Proposta**
> Split Module / Refactor: extrair a fase "persistir + encerrar run + desbloquear duplicidade" (de `upsertMany` até o `finishRun`) para um método privado `finalizarRun`, e a fase de leitura por filial para `lerTitulosDasFiliais`. Opcional: mover `sincronizarDda`+`avisoDaRun` para um colaborador `DdaNaIngestaoPolicy` e baixar as deps de 10 para 9.

**Resultado Esperado**
> `runIngestion` ≤ 15 sem warning; método ≤ 80 LOC.

**Métricas de sucesso**
- Complexidade cognitiva: 20 → ≤ 15
- LOC de `runIngestion`: ~133 → ≤ 80

**Risco de não fazer**
> próxima feature na ingestão (ex.: nova fonte de enriquecimento) leva o método a ≥ 25 e a pior cobertura de teste.

**Dependências**: nenhuma

---

### [modifiability-3] Amarrar o limiar de 8 h à cadência dos crons

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-3
**Sobreposição**: mesma correção de integrability-2; decisão de negócio compartilhada com testability-6.

**Problema**
> 8 h é menor que o vão noturno de 15 h (16:00→07:00); aviso aparece ≈ 7 h por dia útil com a pipeline saudável, e a constante não referencia o workflow.

**Melhoria Proposta**
> Defer Binding: em vez de horas corridas, comparar contra "última janela de cron esperada" (ex.: considerar defasado só se `agora` > próximo horário de sync esperado + folga), ou subir para 17 h com comentário apontando `ingest-sispag.yml`; alternativamente o backend devolve `defasado: boolean` junto de `sincronizadoEm` e a regra fica num único lugar, ao lado do cron. Adicionar teste que falha se o vão do workflow exceder o limiar.

**Resultado Esperado**
> Aviso só aparece quando o pool realmente perdeu uma rodada.

**Métricas de sucesso**
- Horas/dia útil com falso positivo: ≈ 7 → 0

**Risco de não fazer**
> o aviso vira ruído e é ignorado — o cenário que o motivou (pool 5 dias parado) se repete sem ser visto.

**Dependências**: confirmar com Operações a cadência desejada dos crons

---

### [testability-2] Tornar o relógio do prazo DDA injetável e testar o prazo no meio da passada

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S (≤1d)
**Findings**: F-testability-2
**Sobreposição**: cobre o comportamento do teto da fase DDA (availability-1/performance-3/fault-tolerance-1).

**Problema**
> `BoletoDdaService` lê `Date.now()` direto (2 sítios) e o único teste de prazo usa `prazoMs: -1`, exercendo só "tudo adiado". O caso real (prazo vence com N arquivos lidos) não existe.

**Melhoria Proposta**
> Injetar o relógio (reutilizar `calendar`/provider existente, ou `jest.spyOn(Date,'now')` mínimo) e adicionar casos: 2 de 5 arquivos lidos antes do prazo ⇒ `boletos` dos 2, `arquivosAdiados: 3`, `falhas: 0`; arquivo em voo no instante do prazo termina.

**Resultado Esperado**
> Casos de prazo 1 → 3; `Date.now()` não injetável na lógica de prazo 2 → 0; branches de `BoletoDdaService` 80% → ≥90%.

**Métricas de sucesso**
- casos de prazo: 1 → 3
- sítios `Date.now()` diretos: 2 → 0

**Risco de não fazer**
> adiamento contado errado deixa o pool desatualizado sem alerta, como nos 5 dias de 08–13/10.

**Dependências**: nenhuma.

---

### [testability-3] Extrair e testar a saída de `ingest-pagamentos.ts`

**QA**: Testability
**Tactic alvo**: Specialized Interfaces
**Esforço**: S (≤1d)
**Findings**: F-testability-3

**Problema**
> As 17 linhas novas do job (resumo do pool e `::warning::`) têm 0% de cobertura e `main()` roda no import, sem seam. O `::warning::` é o canal do cron para o pool defasado.

**Melhoria Proposta**
> Extrair `formatarSaidaDda(dda)` para função/classe exportada (um módulo de apoio, não o job) devolvendo `{ log, warning? }`, e testar os 4 ramos: ausente, sincronizado, parcial/falhou com `::warning::`, ocupada sem warning.

**Resultado Esperado**
> Cobertura da saída do job 0% → 100%; ramos testados 0 → 4.

**Métricas de sucesso**
- cobertura da saída do job: 0% → 100%
- ramos testados: 0 → 4

**Risco de não fazer**
> alarme de CI quebra por typo sem ninguém notar.

**Dependências**: nenhuma.

---

### [testability-4] Completar a matriz de estados DDA em `IngestaoPagamentosService`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-4

**Problema**
> Faltam asserções para parcial por `falhas>0`, aviso composto (DDA + filial não lida), truncamentos de erro (300/120) e rejeição não-`Error`.

**Melhoria Proposta**
> Quatro casos em `describe('pool DDA dentro da ingestão')`: `falhas: 2` ⇒ `parcial`; DDA `falhou` + `filiaisComFalha` ⇒ `error_message` contém ambas as partes separadas por `; `; erro de 500 chars ⇒ `dda.erro.length === 300` e trecho ≤120 na run; `mockRejectedValue('texto')` ⇒ `falhou` com `erro: 'texto'`.

**Resultado Esperado**
> Ramos sem asserção 4 → 0; branches de `IngestaoPagamentosService` 89,39% → ≥95%.

**Métricas de sucesso**
- ramos de `sincronizarDda`/`avisoDaRun` sem asserção: 4 → 0
- branches do arquivo: 89,39% → ≥95%

**Risco de não fazer**
> o texto de `error_message` regride sem aviso.

**Dependências**: nenhuma.

---

### [performance-1] Medir duração da fase DDA e por arquivo antes de afinar o prazo

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S
**Findings**: F-performance-5
**Sobreposição**: mesma instrumentação de availability-2 (duração e estado da fase DDA); base de performance-2 e performance-3.

**Problema**
> A ADR-0067 manda "medir em produção" a fase DDA, mas `SincronizacaoDdaResultado`/`DdaNaIngestao` não carregam duração. Sem ela, F-2/F-3 e o prazo de 60 s são decididos por estimativa.

**Melhoria Proposta**
> Acrescentar `duracaoMs` ao resultado da sync e ao `dda` da ingestão, mais `maxArquivoMs`, medidos com `Date.now()` ao redor de `listarItens`+`salvarArquivo`; logar no `info` final. Tactic: Manage Sampling Rate (instrumentar para dimensionar). Tocar `BoletoDdaService.ts`, `BoletoDda.ts`, `SispagInterface.ts`.

**Resultado Esperado**
> Cada run da ingestão registra a duração da fase DDA. Duração da fase DDA: não medida → medida em 100% das runs; p95 e % de runs `parcial` consultáveis após 1 semana.

**Métricas de sucesso**
- Runs com duração da fase DDA registrada: 0% → 100%
- Decisão sobre `releituraDias` baseada em p95 real (≥ 1 semana de dados)

**Risco de não fazer**
> o prazo e a janela continuam calibrados por palpite; uma degradação do `fin124` só aparece como aviso genérico "parcial".

**Dependências**: nenhuma

---

### [performance-4] Reservar folga no pool pg durante a sync DDA

**QA**: Performance
**Tactic alvo**: Schedule Resources
**Esforço**: S
**Findings**: F-performance-4
**Sobreposição**: mesma correção de fault-tolerance-2 e integrability-3 (folga do pool PG); implementar uma vez.

**Problema**
> No processo web, 2 locks (ingestão + DDA) + até 3 transações de worker somam 5/5 do pool; outra rota SISPAG concorrente pode estourar o `connectionTimeoutMillis` de 5 s.

**Melhoria Proposta**
> Opções, em ordem de custo: (a) limitar a 2 as gravações simultâneas (`salvarArquivo` serializado por semáforo, a leitura do ERP continua em 3); (b) reutilizar a conexão do lock DDA para a transação; (c) subir o pool para 6–8 se o Supabase pooler permitir (checar limite por usuário). Tactic: Schedule Resources.

**Resultado Esperado**
> Conexões pg tomadas pela fase DDA no pico: 5/5 → ≤ 3/5; timeouts de conexão em rotas web durante sync: indeterminado → 0 (verificar nos logs após 2 semanas).

**Métricas de sucesso**
- Pico de conexões pg da fase DDA: 5 → ≤ 3
- Erros "timeout exceeded when trying to connect" coincidentes com sync DDA: 0

**Risco de não fazer**
> 500 esporádico em rotas SISPAG ao abrir tela; difícil de reproduzir e de atribuir.

**Dependências**: nenhuma

---

### [integrability-1] Espelhar o contrato novo da ingestão no frontend e mostrar `dda.estado`

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> `IngestaoPagamentosResult` e `SincronizacaoDdaResultado` ganharam `dda`/`arquivosAdiados` no backend e não no `frontend/lib/sispag.ts`; o botão manual da ingestão não mostra DDA `falhou`/`parcial` e o toast do DDA ignora adiados.

**Melhoria Proposta**
> Adicionar os campos opcionais às duas interfaces do frontend, exibir toast de aviso quando `dda.estado` ∈ {falhou, parcial} no fluxo do botão e considerar `arquivosAdiados` no toast do DDA. Teste de forma (fixture JSON do resultado) compartilhado ou duplicado dos dois lados. Tactic: Tailor Interface / Contract testing.

**Resultado Esperado**
> Todo campo do resultado público tem tipo no frontend; analista vê pool `falhou` na hora.

**Métricas de sucesso**
- Campos novos tipados no frontend: 0/3 → 3/3
- Toasts que tratam `dda.estado`: 0 → 1

**Risco de não fazer**
> o próximo campo de resultado repete a deriva; falha do DDA continua descoberta só pelo aviso de 8 h.

**Dependências**: nenhuma

---

### [integrability-2] Derivar o limiar de "DDA parado" do calendário real dos crons

**QA**: Integrability
**Tactic alvo**: Configure Behavior
**Esforço**: S
**Findings**: F-integrability-2
**Sobreposição**: mesma correção de modifiability-3; decisão de negócio compartilhada com testability-6.

**Problema**
> `DDA_DEFASADO_HORAS = 8` no frontend contra um intervalo noturno legítimo de 15 h (16h→07h BRT): ~7 h/dia útil de falso alerta.

**Melhoria Proposta**
> Substituir o limiar fixo por regra com horário comercial (ex.: avisar só entre 08h e 20h BRT em dia útil, ou usar > 16 h) e referenciar o horário dos crons em um único arquivo/ADR; teste que cobre 00:00–07:00 e segunda-feira de manhã. Tactic: Configure Behavior.

**Resultado Esperado**
> Aviso só quando houve de fato rodada perdida.

**Métricas de sucesso**
- Horas/dia útil de falso positivo: ~7 → 0
- Casos de teste de `ddaDefasado` com os horários dos crons: 5 → ≥ 8

**Risco de não fazer**
> o aviso é ignorado por hábito e o próximo pool parado por 5 dias passa em branco.

**Dependências**: nenhuma

---

### [integrability-3] Limitar o consumo do pool PG durante a sincronização DDA aninhada

**QA**: Integrability
**Tactic alvo**: Manage Resources
**Esforço**: S
**Findings**: F-integrability-3
**Sobreposição**: mesma correção de performance-4 e fault-tolerance-2 (folga do pool PG); implementar uma vez.

**Problema**
> Dois advisory locks seguram 2 conexões enquanto 3 `salvarArquivo` abrem transações: 5/5 do pool.

**Melhoria Proposta**
> Opção A: reduzir `FANOUT_LIMIT` do DDA para 2 quando chamado dentro da ingestão (parâmetro opcional). Opção B: obter o lock DDA sem reter conexão extra (liberar o client do lock antes do trabalho, ou lock de sessão numa única conexão compartilhada). Medir tempo de espera de `connect()` durante a rodada. Tactic: Manage Resources.

**Resultado Esperado**
> Rotas Express nunca competem com o robô por conexão.

**Métricas de sucesso**
- Conexões do pool no pico: 5/5 → ≤ 4/5

**Risco de não fazer**
> lentidão intermitente na tela SISPAG, difícil de reproduzir.

**Dependências**: nenhuma

---

### [integrability-4] Pôr uma porta estreita entre a ingestão e o pool DDA e medir a latência do fin124

**QA**: Integrability
**Tactic alvo**: Use an Intermediary
**Esforço**: S
**Findings**: F-integrability-4

**Problema**
> A ingestão depende do `BoletoDdaService` completo e herda latência de `fin124` com teto de 60 s sem medição em PRD.

**Melhoria Proposta**
> Extrair interface `SincronizadorPoolDda { sincronizar({triggeredBy, prazoMs}) }` implementada por `BoletoDdaService`, injetar a porta; logar duração e `arquivosAdiados` por rodada para calibrar `DDA_PRAZO_NA_INGESTAO_MS`; avaliar passar `releituraDias` reduzido na ingestão (parâmetro hoje sem chamador). Tactic: Use an Intermediary.

**Resultado Esperado**
> Trocar a fonte DDA sem tocar a ingestão; prazo calibrado por dado.

**Métricas de sucesso**
- Dependências Service→Service concretas na ingestão: 1 → 0
- Rodadas PRD com duração DDA medida: 0 → 100%

**Risco de não fazer**
> o prazo permanece chute e a abertura de tela herda lentidão do ERP sem alarme.

**Dependências**: nenhuma

---

### [deployability-1] Tornar o prazo/ativação da sincronização DDA configurável por env

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S
**Findings**: F-deployability-1
**Sobreposição**: sobrepõe modifiability-4 e a parte "prazo por env" de availability-1; um único ponto de configuração.

**Problema**
> A sincronização DDA dentro da ingestão é incondicional e o prazo (60 s) é constante no código. Desligá-la ou encurtá-la em incidente do fin124 exige commit, merge e deploy.

**Melhoria Proposta**
> Ler `DDA_NA_INGESTAO_ENABLED` e `DDA_PRAZO_NA_INGESTAO_MS` via `EnvironmentProvider` (default = comportamento atual). Quando desligado, `dda` fica `undefined` e o resultado continua válido. Tactic: Scale Rollouts (feature toggle). Tocar `IngestaoPagamentosService.ts` e `EnvironmentProvider`.

**Resultado Esperado**
> Desativação em minutos via env do Render/secret do Actions. Tempo de desligamento: ~1 ciclo de deploy -> alteração de variável.

**Métricas de sucesso**
- Passos para desligar o DDA na ingestão: commit+merge+deploy -> 1 variável de ambiente
- Pior caso de latência adicional controlável: 60 s fixo -> configurável

**Risco de não fazer**
> em uma degradação prolongada do fin124, cada ingestão (3/dia útil + aberturas de tela) paga o prazo cheio até o hotfix.

**Dependências**: nenhuma

---

### [availability-3] Pular a fase DDA após falhas consecutivas (circuit breaker leve)

**QA**: Availability
**Tactic alvo**: Removal from Service
**Esforço**: M
**Findings**: F-availability-2

**Problema**
> Cada ingestão retenta o DDA do zero mesmo com `fin124` fora do ar, gastando até 60 s e sessões do robô que a leitura de títulos precisa a seguir.

**Melhoria Proposta**
> Ler as últimas K runs (`dda_estado`) e, se todas `falhou`, usar prazo curto (ex.: 10 s) ou pular a fase por um cooldown, mantendo o aviso. Tactic: Removal from Service.

**Resultado Esperado**
> Durante indisponibilidade do DDA a ingestão volta ao tempo base (~10 s). Hoje: até 60 s por run → alvo: ≤ 15 s quando houver K falhas consecutivas.

**Métricas de sucesso**
- Duração da ingestão com DDA fora do ar: ≤ 70 s (teórico) → ≤ 15 s

**Risco de não fazer**
> Incidente prolongado do DDA degrada toda abertura de tela da carteira SISPAG.

**Dependências**: availability-2 (persistir estado por run)

---

### [testability-1] Cobrir UPSERT/SELECT de `titulo_a_pagar` contra Postgres real

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M (2–5d)
**Findings**: F-testability-1

**Problema**
> O COALESCE de `doc_esp_numero` e o SELECT da coluna são validados por regex sobre o texto do SQL e por linhas fabricadas. A coluna já foi esquecida no SELECT uma vez neste ciclo; a defesa atual é um `toContain` pontual.

**Melhoria Proposta**
> Criar `TituloAPagarRepository.integration.test.ts` no padrão de `AuthorizedPayeeRepository.integration.test.ts` (roda em `test:sql` com `METRICAS_CICLO_TEST_DSN`): insere título com `numeroDocumento`, reinsere sem, lê via `listAtivos` e afirma que o valor foi preservado; mais um caso que insere todas as colunas de `TituloRow` e compara a ida e a volta. Alternativa barata: teste que deriva as colunas do `SELECT` e do `INSERT` e as confronta com as chaves de `TituloRow`.

**Resultado Esperado**
> Regressão de coluna/SQL falha no CI. Testes de integração em `titulo_a_pagar` 0 → 3 casos; guarda de paridade SELECT↔`TituloRow` 0 → 1.

**Métricas de sucesso**
- integração em `titulo_a_pagar`: 0 → 3 casos
- guarda SELECT/INSERT ↔ `TituloRow`: 0 → 1

**Risco de não fazer**
> a próxima coluna esquecida só aparece como campo vazio em produção.

**Dependências**: DSN de Postgres de teste já usado em `test:sql`.

---

### [performance-2] Pular releitura de arquivo recém-sincronizado e ordenar relidos pelo mais antigo

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: M
**Findings**: F-performance-2, F-performance-3

**Problema**
> Cada sync relê ≈ 40 arquivos (estimativa) e regrava ≈ 5,8k linhas mesmo sem mudança, até ≈ 20x por dia útil; sob prazo estourado a mesma cauda é adiada sempre.

**Melhoria Proposta**
> Em `executarSincronizacao`, usar `sincronizado_em` de `boleto_dda_arquivo` (já gravado): na ingestão, só relê arquivo cujo `sincronizado_em` seja mais velho que N min (ex.: 120 min; aberturas de tela dentro do TTL pulam), e ordenar `relidos` por `sincronizado_em` ASC (round-robin, elimina inanição). Botão manual e job avulso continuam relendo tudo. Em `salvarArquivo`, `ON CONFLICT ... DO UPDATE ... WHERE` linha realmente diferente (`IS DISTINCT FROM`). Tactic: Increase Resource Efficiency + Prioritize Events. Tocar `BoletoDdaService.ts`, `BoletoDdaRepository.ts` (`listArquivosSincronizados` devolve o timestamp).

**Resultado Esperado**
> Arquivos relidos por sync em abertura de tela: ≈ 40 → ≤ 5 (estimativa); leituras `fin124/itens` por dia útil: ≈ 800 → ≈ 120–200 (estimativa); linhas regravadas por sync: ≈ 5,8k → só as alteradas; arquivos adiados repetidamente: 0 (todos rodam em ≤ 2 syncs).

**Métricas de sucesso**
- Arquivos relidos por sync de abertura: ≈ 40 → ≤ 5
- Idade máxima do último `sincronizado_em` dentro da janela de 60 d: ilimitada sob prazo → ≤ 2 intervalos de ingestão
- Tempo da fase DDA (L=5 s, estimativa): ≈ 60 s → ≤ 15 s

**Risco de não fazer**
> a cada aumento do volume de arquivos o prazo corta mais, o vínculo atrasa e o robô do Conexos gasta sessão relendo dado idêntico.

**Dependências**: performance-1 (para validar o N de minutos com dado real)

---

### [performance-3] Fazer o prazo da fase DDA valer também para pré-loop e cauda em voo

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: M
**Findings**: F-performance-1
**Sobreposição**: mesma correção de availability-1 e fault-tolerance-1 (teto rígido da fase DDA); implementar uma vez.

**Problema**
> O prazo de 60 s só é checado antes de iniciar cada arquivo; `listarArquivos` e a página em voo podem levar até ≈ 121 s (40 s × 3 tentativas), e a requisição de abertura de tela espera tudo. Estimado: 10 s → ≈ 70 s típico-ruim, ≈ 190 s teórico.

**Melhoria Proposta**
> Passar o orçamento restante ao `ConexosDdaClient` (sem retry quando o prazo restante < timeout) ou envolver a fase com `Promise.race` contra o prazo (`sincronizarDda` devolve `parcial` e deixa a cauda terminar sem bloquear a ingestão); reduzir tentativas na leitura DDA da ingestão. Considerar que `POST /carteira/atualizar` responda `em_andamento` e deixe a ingestão terminar em segundo plano quando passar de ~30 s. Tactic: Bound Execution Times. Tocar `BoletoDdaService.ts`, `ConexosDdaClient.ts`, `IngestaoPagamentosService.ts`.

**Resultado Esperado**
> Duração da fase DDA: pior caso ≈ 190 s → ≤ 65 s; latência da requisição de abertura de tela no caso L = 10 s: ≈ 70 s → ≤ 40 s.

**Métricas de sucesso**
- Pior caso da fase DDA (constantes): ≈ 190 s → ≤ 65 s
- p95 da requisição `POST /sispag/carteira/atualizar` (após performance-1): medir → ≤ 40 s

**Risco de não fazer**
> uma degradação do Conexos transforma a abertura da tela em espera de minutos e mantém 2 conexões pg + o lock da ingestão presos, bloqueando a próxima rodada de cron (`ocupada`/`em_andamento`).

**Dependências**: performance-1

---

### [integrability-5] Registrar o estado DDA e a taxa de campos nulos por rodada da ingestão

**QA**: Integrability
**Tactic alvo**: Observability of integration failures
**Esforço**: M
**Findings**: F-integrability-5, F-integrability-6
**Sobreposição**: estende availability-2/performance-1 (persistência) e cobre deriva de `docEspNumero`.

**Problema**
> O estado do `fin124` só aparece em texto livre e o `strOpt` tolerante apaga qualquer deriva de `docEspNumero`.

**Melhoria Proposta**
> Gravar `dda_estado` e contadores (`dda_adiados`, `dda_falhas`) na run (migration aditiva) e logar, por rodada, a razão de títulos com `numeroDocumento` presente; WARN quando a razão cair abaixo de piso (ex.: < 50% do valor da rodada anterior). Normalização única de número de documento em helper compartilhado (F-integrability-6). Tactic: Observability of integration failures.

**Resultado Esperado**
> Deriva de contrato e falha de dependência viram consulta SQL, não leitura de texto.

**Métricas de sucesso**
- Colunas/contadores estruturados por dependência: 0 → 3
- Normalizações distintas de `docEspNumero`: 3 → 1

**Risco de não fazer**
> ao ligar o casamento por `doc_esp_numero`, dados defasados geram falso negativo sem aviso.

**Dependências**: nenhuma

---

## P3 — Baixo

### [security-2] Não devolver `dda.erro` nas rotas de perfil de leitura

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-2

**Problema**
> `POST /sispag/carteira/atualizar` (`sispag:ver`) devolve o `run` inteiro, incluindo `dda.erro`, texto livre que a UI não usa.

**Melhoria Proposta**
> Projetar `dda` na resposta de `/carteira/atualizar` sem o campo `erro` (manter `estado` e contadores), mantendo o texto completo só em `POST /sispag/ingestao` (`sispag:executar`) e na run persistida.

**Resultado Esperado**
> Campos textuais livres novos em rotas `sispag:ver`: 1 → 0, sem perder o aviso (que a UI deriva de `sincronizadoEm`).

**Métricas de sucesso**
- Campo `erro` em resposta `sispag:ver`: 1 → 0

**Risco de não fazer**
> baixo; exposição redundante de texto técnico a perfil de leitura.

**Dependências**: security-1 reduz o risco do mesmo campo e pode tornar este card dispensável.

---

### [availability-2] Registrar duração e estado da fase DDA e alertar tendência

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: S
**Findings**: F-availability-3, F-availability-4
**Sobreposição**: mesma migração/campos de performance-1; base de fault-tolerance-4, integrability-5 e availability-3.

**Problema**
> O estado `parcial/falhou/ocupada` vive só em `error_message` e no stdout do job; não há duração nem contagem agregada. Não é possível defender o orçamento de 60 s nem detectar degradação gradual.

**Melhoria Proposta**
> Incluir `duracaoMs` em `DdaNaIngestao` e no log `business_info`; logar `ocupada` em nível INFO; persistir `dda_estado` na run (coluna nullable). Tactic: Monitor. Avisar quando o estado for não-`sincronizado` em N runs consecutivas.

**Resultado Esperado**
> Percentual de runs por estado e p95 da fase DDA consultáveis. Hoje: 0 campos estruturados → alvo: 100% das runs com estado + duração.

**Métricas de sucesso**
- Runs com `dda_estado` e duração registrados: 0% → 100%

**Risco de não fazer**
> A defasagem do pool só aparece quando o analista vê "boleto sem DDA" falso.

**Dependências**: migration aditiva simples

---

### [modifiability-2] Centralizar o predicado "pool DDA com aviso"

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> O mesmo `FALHOU || PARCIAL` existe no serviço e no job; o job só é exercitado em produção.

**Melhoria Proposta**
> Abstract Common Services: exportar `ddaTemAviso(dda)` junto de `DDA_NA_INGESTAO` em `SispagInterface.ts` (ou um `Set` `ESTADOS_COM_AVISO`) e usá-lo em `avisoDaRun` e `ingest-pagamentos.ts`.

**Resultado Esperado**
> Um estado novo muda 1 lugar; job e `error_message` sempre concordam.

**Métricas de sucesso**
- Cópias do predicado: 2 → 1

**Risco de não fazer**
> divergência silenciosa entre o aviso do cron e o da run.

**Dependências**: nenhuma

---

### [modifiability-4] Registrar (ou externalizar) o prazo DDA como parâmetro de ambiente

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-4, F-modifiability-5
**Sobreposição**: sobrepõe deployability-1 (prazo por env).

**Problema**
> `DDA_PRAZO_NA_INGESTAO_MS` é fixo em 60 s; calibrar exige deploy.

**Melhoria Proposta**
> Defer Binding: ler via `EnvironmentProvider` (`ddaPrazoNaIngestaoMs`, default 60_000). Só vale se a primeira semana de produção mostrar `parcial` recorrente; senão manter e fechar.

**Resultado Esperado**
> Ajuste de prazo sem deploy, com default atual preservado.

**Métricas de sucesso**
- Deploys por ajuste de prazo: 1 → 0

**Risco de não fazer**
> baixo; custo é um deploy.

**Dependências**: dados de `arquivosAdiados` da primeira semana

---

### [testability-5] Remover (ou ligar a um chamador) o parâmetro `releituraDias`

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S (≤1d)
**Findings**: F-testability-5

**Problema**
> O parâmetro e seu teste existem, mas nenhuma superfície o passa; o teste defende um caminho inalcançável.

**Melhoria Proposta**
> Remover o parâmetro e o teste, ou expô-lo ao job avulso (`--releitura-dias`) com teste do job.

**Resultado Esperado**
> Parâmetros públicos sem chamador 1 → 0.

**Métricas de sucesso**
- parâmetros sem chamador: 1 → 0

**Risco de não fazer**
> baixa; acúmulo de API sem uso.

**Dependências**: nenhuma.

---

### [testability-6] Revisar o limiar de defasagem para horas úteis e juntar regra + componente em um teste

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-6
**Sobreposição**: depende da mesma decisão de modifiability-3/integrability-2.

**Problema**
> Um teste fixa que segunda 01:00 BRT com sync de 40 h alerta, e o limiar de 8 h não desconta o fim de semana decorrido; o componente nunca é testado com a regra real.

**Melhoria Proposta**
> Decidir com o analista se segunda cedo deve alertar; se não, medir horas úteis (ou desconsiderar até o 1º cron do dia, 07h BRT) e ajustar o caso fixado. Adicionar 1 teste do `BoletosDdaTab` sem mock do módulo, com `jest.useFakeTimers().setSystemTime`.

**Resultado Esperado**
> Casos que fixam comportamento ambíguo 1 → 0; testes componente+regra reais 0 → 1.

**Métricas de sucesso**
- testes componente+regra sem mock: 0 → 1

**Risco de não fazer**
> fadiga de alerta na segunda de manhã.

**Dependências**: confirmação de negócio sobre o horário esperado do 1º sync.

---

### [deployability-2] Registrar no runbook do SISPAG o comportamento esperado do primeiro dia pós-deploy

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-deployability-3, F-deployability-2

**Problema**
> O pool DDA estava parado desde 08/10; nas primeiras rodadas o estado `parcial` e o aviso em `error_message` são esperados até o pool convergir. Sem nota, parece regressão.

**Melhoria Proposta**
> Acrescentar ao ADR-0067 (ou `DEPLOY.md`) o roteiro: quais estados são normais no 1º dia, como conferir convergência (`arquivosAdiados` -> 0) e como reverter (redeploy 0.64.0; coluna `doc_esp_numero` fica). Tactic: Rollback (documentado).

**Resultado Esperado**
> Operador distingue "convergindo" de "quebrado" sem consultar o autor.

**Métricas de sucesso**
- Passos de rollback documentados para este ciclo: 0 -> 1 parágrafo

**Risco de não fazer**
> falso alarme no primeiro dia útil após o deploy.

**Dependências**: nenhuma

---

### [fault-tolerance-4] Persistir contagem de DDA adiado/falho e alertar em falha consecutiva

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: M
**Findings**: F-fault-tolerance-4, F-fault-tolerance-5
**Sobreposição**: estende availability-2/performance-1 (persistência) com alerta server-side.

**Problema**
> DDA falho ou parcial só aparece como texto em `error_message` de uma run `success`; a carteira fica "fresca" por 30 min e não há alarme server-side se o pool não avança.

**Melhoria Proposta**
> Gravar `dda_estado` e `dda_arquivos_adiados` na run (coluna ou JSON) e alertar quando N runs consecutivas não terminarem `sincronizado` ou `ultimaSincronizacao` passar de 8 h em dia útil (reutilizar o `StalenessDetector`). Condition Monitoring.

**Resultado Esperado**
> Pool parado detectado pelo servidor em <= 1 ciclo de cron (hoje depende de alguém abrir a aba após 8 h).

**Métricas de sucesso**
- Sinais server-side de pool defasado: 0 -> 1
- Tempo de detecção: 5 dias (incidente de 08-13/10) -> <= 1 ciclo de cron (~4-5 h)

**Risco de não fazer**
> repetição do incidente de 5 dias com sinal fraco.

**Dependências**: nenhuma.

---
