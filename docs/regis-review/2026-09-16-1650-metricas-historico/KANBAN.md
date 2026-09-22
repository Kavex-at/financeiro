---
type: regis-review-kanban
run_id: 2026-09-16-1650-metricas-historico
total: 20
counts: { p0: 0, p1: 3, p2: 11, p3: 6 }
---

# Kanban — financeiro — 2026-09-16-1650-metricas-historico

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.

---

## P0 — Crítico

Nenhum finding P0 nesta run. Gate passa sem bloqueio.

---

## P1 — Alto

### [testability-1] Exigir os checks de CI (`backend`, `backend-sql`, `frontend`) como obrigatórios em `main`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> `gh api repos/:owner/:repo/branches/main/protection` devolve `404 Branch not protected`: nenhum status check é obrigatório para merge. O job `backend-sql` (Postgres 17 real) prova o invariante central da ADR-0048 — que recuar o piso não altera nenhuma janela já publicada pelo report — mas nada impede um merge com esse job vermelho.

**Melhoria Proposta**
> Configurar branch protection em `main` (via `gh api` ou GitHub UI) exigindo os 3 status checks (`Backend`, `Backend SQL (Postgres 17)`, `Frontend`) antes de permitir merge. Tactic alvo: Executable Assertions — uma assertiva só protege o sistema se sua falha bloquear a mudança que a violou.

**Resultado Esperado**
> Required status checks em `main`: 0 → 3 (`backend`, `backend-sql`, `frontend`). PR com `test:sql` vermelho deixa de poder ser mergeado via UI.

**Métricas de sucesso**
- Required status checks em `main`: 0 → 3
- `gh api .../branches/main/protection`: `404` → `200` com os 3 jobs listados

**Risco de não fazer**
> Em 6 meses, um PR que quebra o invariante de janelas do report pode ser mergeado por engano (CI vermelho ignorado sob pressão de prazo), e o `kavex-report-ciclo` publica um número que já não bate com o que a tela mostrou — sem que o gate que existe para isso tenha, de fato, travado nada.

**Dependências**: nenhuma; é configuração de repositório, não código.

---

### [integrability-1] Adicionar smoke test cross-repo do `metrics.py` contra o contrato do financeiro

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: M
**Findings**: F-integrability-1

**Problema**
> A garantia da ADR-0048 D3 ("o report não muda") depende de uma propriedade do script `metrics.py`, que vive em `~/.claude/skills/kavex-report-ciclo`, fora deste repositório e sem pin de versão. Hoje a verificação é só leitura manual de código nos dois lados (F-integrability-1).

**Melhoria Proposta**
> Tactic: Contract testing. Criar um teste (pode ser um job de CI leve, não bloqueante para o merge diário, mas rodado ao menos semanalmente) que baixa/executa `metrics.py --config columbia.json --inicio <fixo> --fim <fixo>` contra uma instância de teste do financeiro e valida: (a) a query nunca contém `historico`; (b) as 9 colunas do contrato + `parcial`/`apurado_ate` batem com `contrato-metricas.md`. Alternativa mais barata: versionar `metrics.py`/`contrato-metricas.md` como submodule ou pacote referenciado por commit SHA, para que qualquer PR que altere a forma do contrato seja obrigado a atualizar a referência.

**Resultado Esperado**
> Mudança futura no `metrics.py` ou no contrato da API que quebre a suposição da ADR-0048 é pega em CI, não em produção. Métrica: testes cross-repo relacionados a `metrics.py` — 0 → ≥1.

**Métricas de sucesso**
- Testes cross-repo executando `metrics.py`: 0 → ≥1
- Workflows referenciando `kavex-report-ciclo`/`metrics.py`: 0 → ≥1

**Risco de não fazer**
> Uma mudança inocente no script da skill (ex.: tornar `--inicio` opcional para "facilitar o uso") reativa silenciosamente a ambiguidade que a ADR-0048 D3 fechou deliberadamente, e só aparece quando o número do report já saiu errado para o cliente.

**Dependências**: acesso de CI ao repositório/skill `kavex-report-ciclo` (hoje só existe localmente em `~/.claude/skills/`).

---

### [performance-1] Eliminar a re-varredura do ledger por janela em `metricas_ciclo()`

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: M
**Findings**: F-performance-1

**Problema**
> Medido com `EXPLAIN ANALYZE` em Postgres 17 real: a query de `metricas.metricas_ciclo()` custa O(linhas_ledger × nº_janelas), não O(linhas_ledger). Com ledger fixo em 5.000 linhas/tabela, passar de 6 para 111 janelas multiplicou o tempo de execução por 17× (19,6 ms → 333,9 ms), confirmado pelo plano (`Nested Loop Left Join` com `Materialize ... loops=111`, `Rows Removed by Join Filter = 555.000`). O piso fixo (`historico_inicio()`, migration 0060) cresce +1 janela/semana para sempre, e o ledger cresce independentemente — as duas dimensões multiplicam sem teto.

**Melhoria Proposta**
> Reescrever a atribuição linha→janela em `metricas.metricas_ciclo()` (migration nova, aditiva, ex. `0060`) para uma varredura ÚNICA do ledger, em vez de um range-join repetido por janela. Duas alternativas concretas: (1) Bucketing por linha: computar a janela de cada linha do ledger diretamente por aritmética (`p_serie_inicio + floor(extract(epoch from criado_local - p_serie_inicio) / 604800) * interval '7 days'`, ou `date_bin('7 days', criado_local, p_serie_inicio)` no Postgres 14+) e agrupar por esse valor — troca o `LEFT JOIN` por range por um `GROUP BY` direto sobre uma expressão calculada uma vez por linha (O(N) total). (2) Se o bucketing por expressão não bater exatamente com a regra "sexta 18:00 → sexta 18:00" em todos os casos de borda, criar um índice de expressão em `(criado_em AT TIME ZONE 'America/Sao_Paulo')` (`WHERE dry_run = false`) nas duas tabelas e reescrever o `JOIN` para permitir um `Index Range Scan` por janela em vez do atual `Seq Scan` + `Materialize` relido. Tactic alvo: Increase Resource Efficiency. Tocar: `src/backend/migrations/0058_vw_metricas_ciclo.sql` (ou nova migration que redefine só a função, respeitando o contrato de saída), `vwMetricasCiclo.test.ts`/`.integration.test.ts` (já cobrem o comportamento — servem de regressão).

**Resultado Esperado**
> Tempo de execução da query deixa de crescer com o nº de janelas. Medido: 333,9 ms (N=5.000, W=111) → esperado ~20 ms (mesma ordem do caso W=6, já que N passa a ser escaneado uma única vez). Meta: p95 da rota permanece < 50 ms independentemente de quantas semanas o piso `historico_inicio()` acumular no futuro.

**Métricas de sucesso**
- Tempo de execução (N=5.000, W=111): 333,9 ms → <50 ms
- `Rows Removed by Join Filter` (evidência de re-scan): 555.000 → 0

**Risco de não fazer**
> Em ~2 anos (W≈110, ledger também maior que os 5.000 linhas simuladas aqui), cada abertura da tela paga bem mais que os 334 ms medidos com N artificialmente fixo — o pior caso real cresce em AMBAS as dimensões ao mesmo tempo. A tela fica perceptivelmente lenta sem nenhum código ter mudado, e a correção vira uma otimização de última hora sob pressão, em vez de uma migration planejada.

**Dependências**: nenhuma bloqueante — migration aditiva, não quebra 0058/0060 existentes nem o contrato consumido pelo `kavex-report-ciclo`.

---

## P2 — Médio

### [availability-1] Definir `statement_timeout` de query no client de Postgres da aplicação

**QA**: Availability
**Tactic alvo**: Exception Handling (Timeout)
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> `PostgreeDatabaseClient` configura `connectionTimeoutMillis` (obtenção de conexão) e `idleTimeoutMillis`, mas nenhum `statement_timeout` para a query em si. A leitura de `/metricas/ciclo?historico=true` agora varre ~6 semanas em vez de 1, e é a primeira consulta de leitura do repositório a crescer de escopo por parâmetro do cliente — sem teto de tempo, uma consulta presa pode segurar uma das 5 conexões do pool compartilhado por toda a API.

**Melhoria Proposta**
> Acrescentar `statement_timeout` (tactic Timeout, dentro de Exception Handling) ao `Pool` do `PostgreeDatabaseClient` — por exemplo via `options: '-c statement_timeout=Xs'` na connection string ou `SET statement_timeout` por conexão adquirida. Escolher um valor generoso o bastante para o pior caso atual (poucas centenas de linhas) mas finito, e documentar por que o valor escolhido é seguro para o volume de hoje.

**Resultado Esperado**
> `statement_timeout` explícito no client de app: 0 → 1 (grep `statement_timeout` em `PostgreeDatabaseClient.ts`). Uma consulta patológica falha rápido e libera a conexão, em vez de prender o pool indefinidamente.

**Métricas de sucesso**
- `statement_timeout` configurado no client de app: 0 → 1
- Teste cobrindo timeout de query (mock ou integração): 0 → ≥1

**Risco de não fazer**
> Conforme o ledger de Permutas/Recebimentos crescer, uma consulta lenta em `/metricas` pode esgotar o pool de 5 conexões e degradar rotas não relacionadas (ex.: painel de operação).

**Dependências**: nenhuma.

---

### [availability-2] Kill-switch por env var para `?historico=true`

**QA**: Availability
**Tactic alvo**: Reconfiguration
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> A leitura de 6 semanas não tem um toggle operacional equivalente aos já existentes para SISPAG, Recebimentos e Conexos (`SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`). Se a leitura ampliada se mostrar problemática em produção, a única saída é reverter e reimplantar o frontend.

**Melhoria Proposta**
> Introduzir uma env var (ex.: `METRICAS_HISTORICO_ENABLED`, `sync:false` no `render.yaml`, seguindo o padrão dos flags existentes) lida por `fetchMetricasCiclo` — ou, mais simples, por uma rota de configuração que a tela consulta — que permite desligar `?historico=true` sem redeploy, voltando ao comportamento anterior à ADR-0048 (tactic Reconfiguration/Removal from Service).

**Resultado Esperado**
> Kill-switch operacional para a leitura ampliada: 0 → 1, no mesmo padrão dos 3 flags existentes em `render.yaml`. MTTR de um incidente restrito a esta tela cai de "tempo de um deploy" para "tempo de trocar uma env var no dashboard".

**Métricas de sucesso**
- Env vars de kill-switch cobrindo `historico`: 0 → 1

**Risco de não fazer**
> Um incidente isolado nesta tela consome o mesmo MTTR de um deploy completo, em vez do MTTR de um toggle — inconsistente com o padrão já adotado pelo time para outras integrações sensíveis.

**Dependências**: nenhuma.

---

### [deployability-1] Testar o contrato de forward-compatibility que sustenta a ordem de deploy FE/BE

**QA**: Deployability
**Tactic alvo**: Deployment observability
**Esforço**: S
**Findings**: F-deployability-1

**Problema**
> A segurança de "Vercel pode subir antes do Render sem quebrar `/metricas`" depende de `cicloQuerySchema` não usar `.strict()`/`.passthrough()`, uma propriedade verificada manualmente nesta review (`z.object(...).safeParse({historico:'true'}) → data:{}`), não travada por teste. Qualquer PR futuro que endureça a validação de query em rotas compartilhadas pode quebrar essa garantia sem se dar conta de que ela existe.

**Melhoria Proposta**
> Adicionar um teste em `src/backend/routes/metricas.test.ts` (ou um teste de contrato mais genérico em `http/`) que simula explicitamente uma requisição "do frontend futuro contra o schema atual" — chave de query desconhecida deve retornar 200, nunca 400/500. Documentar a intenção no comentário do schema (`cicloQuerySchema`): "não usar `.strict()` aqui — a ordem de deploy Vercel/Render depende de chaves desconhecidas serem ignoradas, ver ADR-0048". Tactic Bass: **Deployment observability** (tornar visível uma garantia que hoje só existe na cabeça de quem fez esta review).

**Resultado Esperado**
> Teste de contrato presente: 0 → 1+ (`metricas.test.ts` ou `http/contractCompat.test.ts`); qualquer regressão futura no schema falha o CI antes de chegar em produção, em vez de aparecer como 400 intermitente pós-deploy.

**Métricas de sucesso**
- Testes de contrato de compatibilidade de schema de query: 0 → ≥1
- Comentário explícito no código ligando a decisão de schema à ordem de deploy: ausente → presente

**Risco de não fazer**
> Próxima "limpeza" de validação que adicione `.strict()` a uma rota compartilhada reintroduz exatamente o incidente que a ADR-0048 evitou (tela em branco / erro), só que desta vez por 400 em vez de dado vazio — mais difícil de diagnosticar porque parece um bug de contrato de API, não um problema de dado.

**Dependências**: nenhuma

---

### [integrability-2] Documentar (e aplicar) uma convenção de versionamento para `/metricas/ciclo` e futuras rotas de contrato externo

**QA**: Integrability
**Tactic alvo**: Versioning strategy
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> O delta resolveu bem uma mudança pontual com flag opt-in testada, mas não existe padrão documentado para a próxima mudança de forma do contrato — cada caso futuro repete a decisão do zero (F-integrability-2). O roadmap já prevê mais consumidores externos (Nexxera, GED, SharePoint) e mais leitores da mesma família de contrato.

**Melhoria Proposta**
> Tactic: Versioning strategy / Adhere to Standards. Adicionar uma seção em `references/contrato-metricas.md` (ou em CLAUDE.md) definindo: quando usar flag opt-in (mudança aditiva, como este delta) vs. quando exigir novo endpoint/versão (mudança de forma nos 9 campos). Não precisa de prefixo `/v1` imediato — o ganho é ter a regra escrita antes da segunda mudança.

**Resultado Esperado**
> Próxima mudança de contrato segue uma decisão já tomada, não uma nova negociação ad hoc. Métrica: convenção de versionamento documentada — ausente → presente em `references/contrato-metricas.md`.

**Risco de não fazer**
> Acúmulo de flags ad hoc (`?historico=`, e as próximas) sem regra unificadora, até que uma delas precise ser removida e ninguém souber quem ainda depende dela.

**Dependências**: nenhuma.

---

### [integrability-3] Logar/instrumentar chamadas a `/metricas/ciclo` por origem (`historico` presente vs. ausente)

**QA**: Integrability
**Tactic alvo**: Observability of integration failures
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> O endpoint que alimenta o report do Diretor de TI não emite nenhum sinal distinguindo a chamada da tela da chamada do `kavex-report-ciclo`, nem taxa de erro por consumidor (F-integrability-3).

**Melhoria Proposta**
> Tactic: Observability of integration failures. Adicionar `LogService.info` de baixo custo no handler de `/metricas/ciclo` registrando `historico` (booleano) e o resultado (linhas devolvidas, erro), seguindo o padrão de log em português já usado no restante do domínio.

**Resultado Esperado**
> Uma falha do report (ex.: autenticação da skill quebrada, resposta vazia) aparece nos logs do financeiro antes de o cliente notar a ausência do report. Métrica: chamadas logadas com origem — 0% → 100%.

**Risco de não fazer**
> MTTR alto para qualquer degradação silenciosa do consumo da skill — descoberta reativa, pelo cliente, em vez de proativa.

**Dependências**: nenhuma.

---

### [modifiability-1] Extrair seletor de piso de série para um vocabulário que sobrevive a um 3º piso

**QA**: Modifiability
**Tactic alvo**: Use an Intermediary
**Esforço**: S (≤1d) — só quando o gatilho ocorrer
**Findings**: F-modifiability-1

**Problema**
> `MetricasCicloRepository.piso(historico?: boolean)` resolve bem para 2 pisos, mas o vocabulário é um booleano amarrado ao nome "histórico" — um 3º piso (ex.: janela anual para auditoria) não cabe sem reabrir `MetricaCiclo.ts`, `MetricasCicloRepository.ts`, `MetricasCicloService.ts`, `routes/metricas.ts` e `src/frontend/lib/metricas.ts` ao mesmo tempo.

**Melhoria Proposta**
> Se e quando um 3º piso for pedido, trocar `historico?: boolean` por `piso?: 'serie' | 'historico'` (ou string enum equivalente) no boundary, mantendo o mapa nome→função SQL centralizado em `PISO` no repository (tactic **Encapsulate**, já correta — não mexer). Não fazer preventivamente: o YAGNI aqui é defensável enquanto só existem 2 pisos e a ADR já limita o escopo. Registrar como gatilho para a próxima vez que `PISO` ganhar uma 3ª chave.

**Resultado Esperado**
> Nenhuma ação imediata requerida. Quando o 3º piso chegar: troca de tipo em 1 lugar (a interface), propagação inalterada nas demais camadas (já usam `filtro.historico` genericamente).

**Métricas de sucesso**
- Arquivos a tocar para adicionar um novo piso: 5 (hoje, implícito) → declarar explicitamente em ADR futura o custo esperado (não reduzir agora)

**Risco de não fazer**
> Nenhum risco em 6 meses se não houver 3º piso pedido; se houver, custo de retrofit é o mesmo hoje ou depois — não é dívida que cresce sozinha.

**Dependências**: nenhuma — card é "esperar o gatilho", não "fazer agora".

---

### [modifiability-2] Externalizar (ou pelo menos versionar com data de revisão) o piso fixo `2026-08-07`

**QA**: Modifiability
**Tactic alvo**: Defer Binding (configuration files)
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> `metricas.historico_inicio()` retorna uma constante SQL fixa que a própria ADR-0048 admite que "envelhece" (18 semanas em dezembro, não 6). Não há teste ou alerta que detecte quando a janela exibida se afasta demais de "6 semanas" — o desvio é silencioso.

**Melhoria Proposta**
> Não mudar a decisão de negócio (data fixa foi escolha deliberada do Yuri, ADR-0048 D2). Duas ações baratas e não-conflitantes com a ADR: (1) anotar na ontologia (`ontology/_inbox/`) um lembrete datado — ex. "revisar piso do histórico em 2026-12" — para virar um `/feature-tweak` futuro planejado, não uma surpresa; (2) considerar um teste (`vwMetricasCiclo.test.ts` ou equivalente em CI agendado) que falhe/alerte quando `NOW() - historico_inicio() > 10 semanas`, sinalizando que a tela já não mostra "últimas 6 semanas" de fato.

**Resultado Esperado**
> Se a janela um dia atingir 10+ semanas sem ninguém ter revisitado a constante, o time recebe um sinal (teste falho ou item de backlog) em vez de o cliente notar primeiro.

**Métricas de sucesso**
- Alerta/lembrete de revisão da constante: 0 → 1 mecanismo (ontologia ou teste agendado)
- Tempo entre a janela ultrapassar 6 semanas reais e alguém notar: hoje indeterminado (depende de alguém abrir a tela e contar linhas) → determinístico via teste/alerta

**Risco de não fazer**
> Em dezembro/2026 a tela mostra ~18 semanas rotuladas como recorte de "últimas semanas" sem nenhum aviso — mesmo tipo de surpresa silenciosa que a própria ADR-0048 foi escrita para evitar (a tela nascendo vazia).

**Dependências**: nenhuma.

---

### [performance-2] Cachear/tetar `GET /metricas/ciclo`

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: S–M
**Findings**: F-performance-2

**Problema**
> `GET /metricas/ciclo` não tem cache (HTTP ou servidor) nem `LIMIT` no nº de janelas devolvidas. Cada request recalcula a leitura completa do zero, mesmo que o dado só mude por execução em lote (não por leitura) e mesmo que dois analistas abram a tela no mesmo minuto. Isso amplifica F-performance-1 sob concorrência.

**Melhoria Proposta**
> Aplicar cache com TTL curto (60-300s) na resposta de `GET /metricas/ciclo` — dado que os valores só mudam quando um borderô fecha ou uma SN é finalizada, não a cada leitura da tela. Complementar com um teto explícito no nº de janelas retornadas pela tela (ex. últimas 26 semanas), com paginação para além disso, já que hoje a resposta cresce sem parar junto com `historico_inicio()`. Tactic alvo: Maintain Multiple Copies of Computations / Bound Execution Times. Tocar: `src/backend/routes/metricas.ts`, `MetricasCicloRepository.listar`.

**Resultado Esperado**
> Nº de janelas por resposta deixa de ser ilimitado (hoje cresce +1/semana para sempre) e passa a ter um teto (ex. 26). Cache hit ratio de 0% hoje para ≥80% das leituras servidas dentro do TTL, reduzindo a pressão sobre o pool de conexões (`max=5`) sob uso concorrente.

**Métricas de sucesso**
- Janelas retornadas por chamada: ilimitado → tetado (ex. 26)
- Cache hit ratio: 0% → ≥80%

**Risco de não fazer**
> Combinado ao card performance-1 não feito, N usuários concorrentes multiplicam o pior caso O(linhas×janelas) por N execuções simultâneas, e o pool de conexões (`max=5`) forma fila sob uso normal de segunda de manhã, antes mesmo do índice virar o gargalo dominante.

**Dependências**: nenhuma.

---

### [fault-tolerance-2] Sinalizar na tela que semanas fechadas também podem mudar (mesma lógica do aviso de `parcial`)

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> `page.tsx` avisa explicitamente quando uma semana é `parcial` ("os números mudam até fechar"), mas não avisa que semanas "fechadas" também podem mudar por exclusão de borderô no ledger de origem — um risco que a própria ADR-0048 declara e a 0058 documenta ("o report congela o número no ciclo em que o leu").

**Melhoria Proposta**
> Estender o aviso de rodapé já existente (`"Série iniciada em..."`) com uma nota curta e permanente — não por semana, para não parecer marca de reconstrução (respeitando D4) — do tipo "Números refletem o estado atual do ledger; podem diferir de um report já emitido para a mesma semana." Tactic Bass: **Sanity Checking** (comunicação de confiabilidade). Arquivo: `src/frontend/app/metricas/page.tsx` (fora do delta desta review, mas item de acompanhamento direto).

**Resultado Esperado**
> Usuário que compara tela com report antigo tem uma explicação na própria tela, não só no ADR. Aviso de instabilidade: 1 de 2 estados cobertos → 2 de 2 (mantendo D4: sem marcar semana individual).

**Métricas de sucesso**
- Estados de semana com aviso de instabilidade: 1/2 → 2/2

**Risco de não fazer**
> Divergência tela-vs-report percebida como bug de produto em vez de comportamento conhecido.

**Dependências**: nenhuma; não conflita com ADR-0048 D4 (o aviso é genérico, não uma marca por semana).

---

### [security-1] Adicionar `requireRole` (ou decisão explícita documentada) em `/metricas/ciclo`

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: S
**Findings**: F-security-1

**Problema**
> `GET /metricas/ciclo` não tem `requireRole`, ao contrário de toda outra rota de negócio do backend (`permutas`, `sispag`, `recebimentos`, `usuarios`). É achado pré-existente, não introduzido por este PR — mas o delta amplia de 1 para 6 semanas o volume de métricas de negócio (valor baixado em permutas, valor de créditos alocados, taxas de conclusão) que um usuário autenticado de qualquer papel pode ler sob esse mesmo controle.

**Melhoria Proposta**
> Decidir explicitamente (ADR curto) se `/metricas/ciclo` deve permanecer aberta a qualquer autenticado — caso em que o comentário atual em `routes/metricas.ts:25-30` deveria virar uma decisão registrada em ontologia, não só um comentário de código — ou ganhar `requireRole('admin')` como as demais rotas de leitura sensível. Tactic alvo: **Authorize Actors**. Arquivo a tocar: `src/backend/routes/metricas.ts` (+ `src/backend/routes/metricas.test.ts` para o 403/200 por papel).

**Resultado Esperado**
> Ou 1/1 rotas de `/metricas` com `requireRole` explícito (igualando a cobertura das demais 30+ ocorrências no repo), ou uma decisão documentada em `ontology/decisions/` justificando a leitura aberta — métrica: 0/1 → 1/1 rotas com controle de papel decidido conscientemente (implementado ou formalmente dispensado).

**Métricas de sucesso**
- Rotas de `/metricas` com `requireRole` explícito OU decisão documentada: 0/1 → 1/1

**Risco de não fazer**
> Conforme a tela Métricas ganha mais frentes e janelas (a ADR-0048 já registra que a data fixa "envelhece" — em dezembro serão ~18 semanas), o volume de dado de negócio exposto sob autenticação genérica cresce sem novo checkpoint de decisão.

**Dependências**: nenhuma.

---

### [fault-tolerance-1] Implementar `metricas_ciclo_leituras` (append-only) antes que a janela de agosto envelheça mais

**QA**: Fault Tolerance
**Tactic alvo**: Rollback + Reconcile
**Esforço**: M
**Findings**: F-fault-tolerance-1

**Problema**
> A ADR-0048 expõe 5 semanas fechadas adicionais na tela, todas lidas ao vivo de um ledger (`permuta_alocacao_execucao`) que perde linhas quando um borderô é excluído (190 linhas elegíveis, medição de 09-14). O card equivalente do run anterior (`2026-09-14-1624-metricas-ciclo`, fault-tolerance-1) não foi implementado, e a exposição temporal ao risco que ele mitigaria acabou de crescer de 0 para ~42 dias.

**Melhoria Proposta**
> Retomar o card `fault-tolerance-1` do run `2026-09-14-1624-metricas-ciclo`: tabela append-only `metricas.metricas_ciclo_leituras` + função `metricas.registrar_leitura(agora)`, chamada pelo `kavex-report-ciclo/scripts/metrics.py` a cada ciclo. Tactic Bass: **Rollback** (snapshot append-only) + **Reconcile**. Como consequência direta deste run, também vale registrar a leitura feita pela **tela** (não só pelo report), para permitir comparar "o que a tela mostrou hoje" com "o que ela mostrou na semana em que a janela fechou".

**Resultado Esperado**
> Uma divergência entre a leitura atual de uma semana fechada e a leitura registrada no momento em que ela fechou vira detectável por diff, em vez de invisível. Exposição de 5 semanas sem instrumentação → 0.

**Métricas de sucesso**
- Semanas fechadas com leitura registrada: 0 → 5 (as expostas hoje pela ADR-0048)
- Divergência detectável entre leitura registrada e leitura atual: hoje impossível → mensurável por diff

**Risco de não fazer**
> Quanto mais a data fixa `2026-08-07` envelhecer (ADR-0048 já assume isso em dezembro chegar a ~18 semanas), maior a superfície de semanas "fechadas" sujeitas a mudar sem rastro.

**Dependências**: nenhuma dentro do repo.

---

## P3 — Baixo

### [deployability-2] Registrar a ordem de deploy segura no runbook/DEPLOY.md

**QA**: Deployability
**Tactic alvo**: Deployment observability / Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> `docs/runbooks/rollback.md` documenta muito bem a direção *reversa* (o que fazer quando um deploy quebra), mas nenhum documento afirma, para a frente, que Render e Vercel podem chegar em qualquer ordem com segurança — essa conclusão só existe nesta revisão de arquitetura, não no repositório.

**Melhoria Proposta**
> Acrescentar uma seção curta em `DEPLOY.md` (ou um novo `docs/runbooks/deploy-ordering.md`) explicando: (1) BootMigrator garante que o backend nunca serve com migration pendente; (2) rotas usam Zod não-`.strict()` de propósito, então parâmetro novo do frontend contra backend antigo degrada sem erro; (3) portanto Vercel e Render podem deployar em qualquer ordem. Referenciar `BootMigrator.ts` e o teste do card `deployability-1` como prova viva da garantia.

**Resultado Esperado**
> Próximo desenvolvedor que adicionar um parâmetro de query fim-a-fim (rota nova + tela nova) encontra a regra documentada em vez de precisar re-derivá-la lendo `BootMigrator` e o Zod schema do zero.

**Métricas de sucesso**
- Seção "ordem de deploy FE/BE" em `DEPLOY.md`: ausente → presente

**Risco de não fazer**
> Conhecimento tribal — a garantia sobrevive só enquanto quem a descobriu (esta review) estiver disponível para explicá-la de novo.

**Dependências**: nenhuma (independente do card 1, mas reforça o mesmo achado)

---

### [modifiability-3] Registrar formalmente a divergência dos dois pisos como item de `/retro-ontology`

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> A ADR-0048 nomeia "dois pisos coexistem e podem divergir" como consequência aceita e mitigada só por convenção de nomenclatura + teste estático de grade (`vwMetricasCiclo.test.ts`). Não há entrada correspondente em `ontology/_coverage.json` ou `_inbox/` rastreando isso como débito monitorado — a mitigação vive inteiramente em um bloco de comentário e um `it()`.

**Melhoria Proposta**
> No próximo `/retro-ontology`, adicionar `metricas.historico_inicio()` / `metricas.serie_inicio()` como par vigiado explicitamente (mesmo sem entidade de domínio formal, já que `entity_changed = false` nesta ADR) — um `_inbox` note bastaria, sem exigir mudar o `_index.json`.

**Resultado Esperado**
> Rastreabilidade do "por que dois pisos existem" sobrevive a rotatividade de time, não depende só de quem leu a ADR-0048 na íntegra.

**Métricas de sucesso**
- Entrada em `ontology/_inbox/` referenciando os dois pisos: 0 → 1

**Risco de não fazer**
> Baixo — o teste estático já protege contra a maior parte da divergência (grade desalinhada). Risco residual é só de conhecimento tribal.

**Dependências**: nenhuma.

---

### [fault-tolerance-3] Padronizar `RetryExecutor` na leitura de métricas

**QA**: Fault Tolerance
**Tactic alvo**: Recovery (forward)
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> `MetricasCicloRepository`/`MetricasCicloService` não usam `RetryExecutor` para a leitura de banco, ao contrário da convenção do projeto para I/O externo.

**Melhoria Proposta**
> Envolver as duas chamadas do `Promise.all` (`serieInicio`, `listar`) com `RetryExecutor` (poucas tentativas, delay curto — é leitura, não escrita). Tactic Bass: **Recovery (forward)**.

**Resultado Esperado**
> Blip transitório de conexão não exige clique manual em "Recarregar". Usos de `RetryExecutor` no módulo: 0 → 2.

**Métricas de sucesso**
- Usos de `RetryExecutor` em `MetricasCicloRepository`/`Service`: 0 → 2

**Risco de não fazer**
> Baixo — UX levemente pior em blips raros; sem risco de dado incorreto.

**Dependências**: nenhuma.

---

### [testability-2] Separar "guarda sintática" de "guarda semântica" nos testes estáticos de migration

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> `vwMetricasCiclo.test.ts` roda 13 `it()` sob o rótulo comum "guardas estáticas" (0058 + 0060); 12 são regex sobre o texto do próprio arquivo SQL (provam forma, não comportamento) e 1 faz aritmética real sobre as datas extraídas (prova o alinhamento de grade da ADR-0048). O nome do bloco não distingue as duas classes, e o padrão predominante (regex) é o que um novo guard tende a copiar.

**Melhoria Proposta**
> Dividir os `describe` em dois: `'0060 — forma do arquivo (sintático)'` e `'0060 — invariantes de negócio (semântico, ADR-0048)'`, com um comentário no segundo bloco reforçando que só ele é evidência de comportamento sem banco — o resto é lint travestido de teste. Tactic alvo: Executable Assertions (nomeação honesta do que cada assertiva prova).

**Resultado Esperado**
> `describe` blocks nas guardas estáticas: 2 (misto) → 4 (2 arquivos × 2 categorias nomeadas). Nenhuma mudança de comportamento, só de rotulagem — custo de implementação mínimo.

**Métricas de sucesso**
- Guards com rótulo que declara sintático vs. semântico: 0 → 13

**Risco de não fazer**
> Nenhum imediato — a suíte de integração já cobre o comportamento real. Risco é de médio prazo, à medida que mais migrations acumulam guardas regex sem musculatura semântica e a suíte estática passa a parecer mais forte do que é.

**Dependências**: nenhuma.

---

### [availability-3] Fallback para a janela vigente quando o piso `historico` falhar

**QA**: Availability
**Tactic alvo**: Degradation
**Esforço**: M
**Findings**: F-availability-3

**Problema**
> `MetricasCicloService.ler` usa o mesmo piso (`historico` ou `serie`) nas duas chamadas em paralelo, sem fallback: uma falha isolada em `metricas.historico_inicio()` (com `metricas.serie_inicio()` saudável) derruba a tela inteira, mesmo que a leitura de 1 semana continuasse funcionando exatamente como antes da ADR-0048.

**Melhoria Proposta**
> Avaliar (não necessariamente implementar já — é P3) um fallback explícito no service: se a leitura com `historico=true` falhar, tentar novamente com o piso da série vigente e sinalizar na UI que o histórico está indisponível, em vez de vazio. Tactic Degradation — a mesma lógica usada para "% não sai com 0/0" aplicada ao nível da leitura inteira.

**Resultado Esperado**
> Uma falha isolada no piso do histórico degrada para a semana vigente em vez de falhar por completo. Métrica: cobertura de teste do caminho de fallback, 0 → ≥1.

**Métricas de sucesso**
- Teste de fallback do piso `historico` → `serie`: 0 → ≥1

**Risco de não fazer**
> Baixo — depende de uma falha parcial de schema que o `BootMigrator` já torna improvável; adiar é defensável.

**Dependências**: nenhuma; pode ser adiado para um `/feature-tweak` futuro se P1/P0 não aparecerem no consolidado.

---

### [security-2] Manter o padrão de rastreamento explícito de dado-do-cliente → SQL como guarda de regressão

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: M
**Findings**: F-security-2

**Problema**
> O padrão usado em `MetricasCicloRepository.piso()` (booleano validado → 1 de 2 literais fixos, nunca a string da requisição) é correto e foi verificado ponta a ponta neste review, mas não há um teste que trave especificamente "nenhuma string de `req.query` chega a um template SQL sem passar por bind parameter" — hoje isso é auditado manualmente a cada review.

**Melhoria Proposta**
> Formalizar como regra de `PatternGuardian` (gate do pipeline) um grep/lint que sinalize template literals com `${...}` dentro de uma string SQL cujo identificador não seja um literal de módulo (`const X = 'literal'`) — reduz a necessidade de auditoria manual ponta-a-ponta a cada PR que toca repository. Tactic alvo: **Validate Input** / **Verify Message Integrity**.

**Resultado Esperado**
> Regra automatizada substitui parte da verificação manual feita neste review; qualquer futuro `${variávelDerivadaDeRequest}` dentro de um template SQL falha o gate antes do merge.

**Métricas de sucesso**
- Regra de lint/gate para interpolação SQL fora de literais de módulo: ausente → presente

**Risco de não fazer**
> O padrão seguro depende de disciplina manual a cada novo repository; um futuro PR poderia reintroduzir interpolação de dado do cliente sem um gate automatizado que pegue isso antes do review humano.

**Dependências**: nenhuma.
