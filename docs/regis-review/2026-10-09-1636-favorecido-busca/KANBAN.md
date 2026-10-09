---
type: regis-review-kanban
run_id: 2026-10-09-1636-favorecido-busca
total: 13
counts: { p0: 0, p1: 0, p2: 10, p3: 3 }
---

# Kanban — financeiro — 2026-10-09-1636-favorecido-busca

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> Os 19 cards originais dos 8 QAs foram deduplicados em 13. O ID do card mantém o da fonte principal; o campo **Absorve** lista os cards originais fundidos nele. Nenhum card foi renomeado além dessa fusão.

---

## P0 — Crítico

Nenhum card. Nenhuma das 8 seções registrou finding P0.

---

## P1 — Alto

Nenhum card. Nenhuma das 8 seções registrou finding P1 (delta read-only, 0 escritas no Conexos ou no banco).

---

## P2 — Médio

### [security-1] Limitar a taxa da busca de favorecido por usuário

**QA**: Security (também Availability, Performance, Integrability, Fault Tolerance)
**Tactic alvo**: Detect Service Denial / Limit Event Response / Manage Resources
**Esforço**: S (≤1d)
**Findings**: F-security-1, F-availability-1, F-performance-2, F-integrability-4, F-fault-tolerance-2
**Absorve**: availability-1 (parte de rate limit; o deadline vai para [performance-3]), performance-2, integrability-3, fault-tolerance-1 (parte opcional de rate limit)

**Problema**
> A busca herda só o `globalLimiter` (100/min/IP) e cada requisição faz de 1 a 3 leituras no `cmn025` (variam por seção: 2 em texto, 1–2 em documento). O debounce de 350 ms no frontend é a única contenção; o servidor aceita qualquer taxa de POST e o abort do navegador não cancela a leitura já enviada ao ERP. Uma varredura enumera o cadastro (nome, fantasia, documento mascarado, situação, autorização) e disputa o teto de sessões do Conexos com os crons da carteira SISPAG. Pico teórico por usuário: ~5,7 leituras/s.

**Melhoria Proposta**
> Aplicar um limiter dedicado em `POST /favorecidos-autorizados/busca` e em `GET .../destino-atual`, por usuário autenticado (ex.: 30/min), reaproveitando `rateLimit.ts` (429 com `Retry-After`). Opcional: deduplicar buscas idênticas em voo (mesmo termo + usuário) reaproveitando a Promise. Teste de rota cobrindo o 429 acima do limite.

**Resultado Esperado**
> Rajada acima do limite por usuário recebe 429; leituras Conexos da busca ≤ ~90/min por usuário (hoje até ~300/min por IP, ~5,7/s teórico por usuário).

**Métricas de sucesso**
- Limitador específico na busca: 0 → 1
- Teto de leituras da busca por usuário/min: ~300 → ≤ 90

**Risco de não fazer**
> Uma conta comprometida (ou cliente sem debounce) enumera os fornecedores e, no pior caso, estoura o teto de sessões e congela a carteira SISPAG, como no incidente de 23/09.

**Dependências**: Nenhuma

---

### [integrability-1] Medir ao vivo o `#LIKE` e o `pdcDocFederal` do `cmn025`, gravar fixtures e validar os 4 modos de busca

**QA**: Integrability (também Testability, Deployability, Modifiability, Performance, Fault Tolerance)
**Tactic alvo**: Contract testing / Recordable Test Cases / Script Deployment Commands
**Esforço**: S
**Findings**: F-integrability-1, F-integrability-3, F-testability-1, F-deployability-1, F-modifiability-4, F-performance-4
**Absorve**: testability-1, deployability-1, parte da sonda em availability-2

**Problema**
> A busca assume "contém" para o `#LIKE` e dois formatos para o documento (dígitos, depois formatado), sem medição: o HML recusou a credencial (Bad Credentials) e a sonda em produção derrubaria sessão viva. Os 7 casos de `buscarPessoas` usam linhas inline, ou seja, defendem uma suposição, não o contrato. Se a premissa estiver errada, a busca devolve vazio sem erro e é indistinguível de "não cadastrado". O primeiro uso real em produção vira o teste.

**Melhoria Proposta**
> Com credencial HML válida, rodar `probe-cmn025-busca-hml.ts` (nunca em produção), registrar a semântica (contém ou começa com, acento, caixa) no JSDoc e em `ontology/actions/sispag/buscar-favorecido-conexos.md`, e gravar 2 a 3 respostas anonimizadas em `src/backend/domain/client/__fixtures__/cmn025-list.json`, consumidas pelos testes de `buscarPessoas` (incluindo um caso que documenta "contém" ou "começa com"). Se o HML não for liberado: após o deploy, com usuário de sessão própria e fora do pico, executar uma busca por cada modo (CPF/CNPJ, razão social, fantasia, código) e registrar o resultado em `DEPLOY.md` ou na ontologia.

**Resultado Esperado**
> Premissas do ERP medidas 0/2 → 2/2; modos de busca validados ao vivo 0/4 → 4/4; fixtures gravadas de `cmn025/list` 0 → ≥ 2; testes de `buscarPessoas` rodando sobre resposta gravada.

**Métricas de sucesso**
- Premissas do ERP medidas: 0/2 → 2/2
- Modos de busca validados ao vivo: 0/4 → 4/4
- Fixtures gravadas de `cmn025/list`: 0 → ≥ 2

**Risco de não fazer**
> Busca que "não acha" favorecidos existentes, gera cadastro duplicado no Conexos e leva os analistas de volta ao Conexos, sem alarme e com confiança indevida em 7 testes verdes.

**Dependências**: Credencial HML válida (ou janela de produção com usuário de sessão própria)

---

### [integrability-2] Logar contagem de linhas descartadas em `buscarPessoas`

**QA**: Integrability
**Tactic alvo**: Observability of integration failures
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> `mapPessoa` descarta linhas fora do schema em silêncio (`safeParse` → `undefined`); uma mudança de campo no `cmn025/list` (ex.: `dpeNomPessoa` renomeado) zera a busca sem alerta. O método irmão `cmnPessoasPix` já loga a contagem de descartes (`ConexosSispagClient.ts:727`).

**Melhoria Proposta**
> Contar as descartadas em `ler()` e emitir `console.warn`/`LogService` em português, no mesmo formato de `cmnPessoasPix` (`ConexosSispagClient.ts:727`). Nunca logar o termo nem o documento (I10h).

**Resultado Esperado**
> Descarte visível no log; leituras de `cmn025` com log de descarte 1/2 → 2/2.

**Métricas de sucesso**
- Leituras de `cmn025` com log de descarte: 1/2 → 2/2

**Risco de não fazer**
> Drift do contrato do Conexos descoberto só por reclamação do analista.

**Dependências**: Nenhuma

---

### [security-2] Registrar auditoria mínima da consulta de destino e contagem de buscas

**QA**: Security
**Tactic alvo**: Audit Trail / Detect Intrusion
**Esforço**: S (≤1d)
**Findings**: F-security-2

**Problema**
> Nem a busca nem a prévia deixam rastro de quem consultou o quê (0 eventos de auditoria nas 2 rotas novas); sem isso não há detecção de varredura nem reconstrução em caso de fraude de conta de favorecido.

**Melhoria Proposta**
> Gravar na trilha existente um evento `destino_consultado` (usuário, `pesCod`, modalidade, resultado; nunca o termo nem o destino) e um log de contagem de buscas por usuário (só número de resultados). Alinhado ao I10h.

**Resultado Esperado**
> Eventos de auditoria nas rotas novas: 0 → 100% das prévias; consulta "quem olhou o pesCod X" respondível.

**Métricas de sucesso**
- Prévias com registro: 0% → 100%
- Ocorrências do termo/documento nos logs: 0 → 0 (manter)

**Risco de não fazer**
> Investigação de troca de conta de favorecido fica sem a ponta da consulta.

**Dependências**: Pode seguir junto de [security-1]

---

### [deployability-2] Documentar a ordem de deploy (backend antes do frontend) e conferir o bump de versão

**QA**: Deployability
**Tactic alvo**: Physical Grouping / Script Deployment Commands
**Esforço**: S (≤1d)
**Findings**: F-deployability-2, F-deployability-3

**Problema**
> O diálogo novo depende de 2 rotas novas (0 flags, 0 fallbacks) e removeu o fluxo antigo de digitar o código; deploy do FE (Vercel) antes do BE (Render) quebra a solicitação de autorização com 404. A seção de Deployability registrou a versão em 0.60.0 sem bump.

**Melhoria Proposta**
> Adicionar a `DEPLOY.md` a nota "Render (backend) primeiro, depois Vercel" para esta versão e fazer o bump FE+BE em lockstep à mão (`bump-version.ps1` não roda em Linux), conferindo versão, ADR e versão da ontologia na `main` antes. Rollback: reverter FE e BE para a versão anterior (sem reverse SQL, 0 migrations). Nota do consolidador: o `git log` do worktree já mostra `chore(release): v0.61.0`; confirmar a versão corrente antes de bumpar.

**Resultado Esperado**
> Ordem escrita, versão em lockstep nos 2 `package.json`, janela de 404 evitada.

**Métricas de sucesso**
- Rotas novas com ordem de deploy documentada: 0/2 → 2/2
- `package.json` bumpados: 0/2 → 2/2

**Risco de não fazer**
> Repetir janela de erro em cada feature com rota nova, sem tag de rollback.

**Dependências**: Nenhuma

---

### [performance-1] Paralelizar as duas leituras de texto da busca de favorecido

**QA**: Performance
**Tactic alvo**: Increase Concurrency
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> `buscarPessoas` lê razão social e nome fantasia em série (`for ... await ler(...)`); a latência soma duas leituras do Conexos (p99 estimado 2–10 s, sem medição ao vivo).

**Melhoria Proposta**
> Executar as `leituras` com `Promise.all` (cada uma já passa por `runWithRetry`), mantendo o merge por `pesCod` na ordem original (razão social primeiro) para resultado determinístico. Tocar `ConexosSispagClient.ts` e o teste de ordem. Antes, confirmar que 2 leituras simultâneas do mesmo usuário não estouram o teto de sessões (usam a mesma sessão). Fazer depois de [security-1] para não amplificar a taxa.

**Resultado Esperado**
> Latência da busca de texto de ~2x para ~1x a de uma leitura (ex.: 2 x 600 ms = 1,2 s → ~0,6 s, a validar na sonda).

**Métricas de sucesso**
- Tempo da busca de texto (p95): ~2 x T_leitura → ~1 x T_leitura
- Leituras por busca de texto: 2 → 2 (inalterado)

**Risco de não fazer**
> Busca lenta no horário em que o ERP está carregado; sem corrupção de dado.

**Dependências**: Nenhuma; medir após a sonda de [integrability-1]

---

### [modifiability-1] Centralizar a classificação do termo de busca em um único módulo

**QA**: Modifiability
**Tactic alvo**: Refactor (Increase Semantic Coherence)
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> A decisão "documento (11/14 dígitos), código ou texto" e o mínimo de 3 letras existem no `PayeeSearchService` e no `ConexosSispagClient.buscarPessoas` com regex diferentes (2 sítios no backend, 3 contando o frontend). Um novo formato de documento (ex.: CNPJ alfanumérico) exige mudar dois lugares em sincronia.

**Melhoria Proposta**
> Refactor: extrair `classificarTermoBusca(termo)` (retorna `{tipo: 'documento'|'codigo'|'texto', valor}`) para `domain/libs/sispag/` e usá-lo no serviço (guarda de mínimo) e no cliente (escolha do filtro). Cobrir com teste tabelado.

**Resultado Esperado**
> Uma única definição; adicionar formato de documento toca 1 arquivo + teste.

**Métricas de sucesso**
- Sítios com regex de classificação no backend: 2 → 1

**Risco de não fazer**
> Divergência silenciosa quando o CNPJ alfanumérico entrar em produção.

**Dependências**: Nenhuma

---

### [testability-2] Testar o debounce com fake timers e afirmar coalescência

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> O debounce de 350 ms roda em tempo real nos testes (0 `useFakeTimers`; ~9 casos do diálogo pagam 350 ms reais, ≈ 3 s acumulados) e nenhum caso prova que digitação rápida gera uma única leitura no Conexos. O debounce é a única proteção de taxa hoje.

**Melhoria Proposta**
> Em `SolicitarAutorizacaoDialog.test.tsx`, `jest.useFakeTimers()` com `userEvent.setup({ advanceTimers })`; adicionar caso "3 teclas em < 350 ms → `buscarFavorecidos` 1 vez" e "pausa de 350 ms → dispara". Opcional: extrair `useDebouncedTerm`.

**Resultado Esperado**
> Casos de debounce com relógio controlado: 0 → 2; espera real acumulada na suíte do diálogo ≈ 3 s → ≈ 0 s.

**Métricas de sucesso**
- Casos de coalescência: 0 → 2
- `useFakeTimers` no teste do diálogo: 0 → 1

**Risco de não fazer**
> Regressão no debounce multiplica leituras 1–2 por tecla sob o teto de sessões do Conexos.

**Dependências**: Nenhuma. Liga a Performance (carga no ERP) e Modifiability (relógio injetável).

---

### [performance-3] Estabelecer teto de tempo total da busca e reduzir retries na rota interativa

**QA**: Performance (também Availability, Fault Tolerance)
**Tactic alvo**: Bound Execution Times / Timeout
**Esforço**: M
**Findings**: F-performance-3, F-availability-2, F-fault-tolerance-1
**Absorve**: availability-1 (parte do deadline), fault-tolerance-1

**Problema**
> Cada leitura do `cmn025` herda timeout de 40 s do axios (`services/conexos.ts:121`, verificado pela seção de Availability) e `runWithRetry` com 2 retries; não há teto de tempo total da requisição de busca. Com até 2 leituras seriais, o pior caso teórico é ≈ 240 s (3 tentativas × 40 s × 2 leituras), contra alvo interativo < 10 s. A requisição Express fica aberta e o backend não cancela a leitura quando o frontend aborta. Latência real não medida.

**Melhoria Proposta**
> Envolver a busca num deadline total (8–10 s) via executor de timeout existente ou `AbortSignal` repassado a `buscarPessoas`, sem retry após o deadline; reduzir para 1 retry nesta rota interativa; devolver erro tipado que a UI mostra como "Conexos lento, tente de novo". Registrar duração e nº de leituras no log (`LogService`) para obter p50/p95 reais.

**Resultado Esperado**
> Pior caso da requisição de busca: 240 s teórico → ≤ 8–10 s; p50/p95 passam a existir nos logs.

**Métricas de sucesso**
- Tempo máximo da requisição `/busca`: ≈ 240 s teórico → ≤ 8 s
- Duração da busca nos logs: ausente → p50/p95 disponíveis

**Risco de não fazer**
> Diálogo travado em dia de Conexos degradado, conexões ocupadas e nenhum número para decidir paralelização ou cache.

**Dependências**: Sonda em HML com credencial válida (gap em `_shared-metrics.md`); ver [integrability-1]

---

### [modifiability-2] Extrair as leituras de cadastro do `ConexosSispagClient` e as rotas de favorecidos do `routes/sispag.ts`

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-2

**Problema**
> O cliente tem 935 LOC (828 em main), a rota 1252 LOC/40 imports e `frontend/lib/sispag.ts` 1721 LOC (alvo ≤ 600); este delta somou 107, 33 e 48 linhas. Toda feature SISPAG reabre esses arquivos.

**Melhoria Proposta**
> Split Module: mover `buscarPessoas`/`mapPessoa`/`pessoaRowSchema` para `ConexosCadastroPessoaClient` (mesmo `ConexosBase`), e criar `routes/sispag.favorecidos.ts` montado no router principal. Aproveitar no próximo `/feature-tweak` que tocar o arquivo (migração proporcional).

**Resultado Esperado**
> `ConexosSispagClient` ≤ 830 LOC no curto prazo; `routes/sispag.ts` perde o bloco de favorecidos.

**Métricas de sucesso**
- LOC `ConexosSispagClient.ts`: 935 → ≤ 830
- Imports `routes/sispag.ts`: 40 → ≤ 30

**Risco de não fazer**
> Os três arquivos passam de 1000/1400/1900 LOC em seis meses, com mais conflito entre sessões paralelas.

**Dependências**: Nenhuma

---

## P3 — Baixo

### [availability-2] Instrumentar duração/resultado da busca e prever kill switch

**QA**: Availability
**Tactic alvo**: Monitor / Removal from Service
**Esforço**: S (≤1d)
**Findings**: F-availability-3

**Problema**
> Não há métrica de duração/erro de `buscarPessoas` nem como desligar a busca sem deploy; a semântica e a latência do `#LIKE` nunca foram medidas ao vivo.

**Melhoria Proposta**
> Monitor: logar duração, nº de leituras e `truncado` via `LogService` em `PayeeSearchService`; flag de configuração (`EnvironmentProvider`) para desligar a busca e cair no pedido por código. A sonda em HML é tratada em [integrability-1]; o log de duração se sobrepõe ao de [performance-3] (fazer junto).

**Resultado Esperado**
> p95 e taxa de erro observáveis (hoje: não medidos) e desligamento da busca em minutos sem deploy.

**Métricas de sucesso**
- Métrica de duração da busca: ausente → p95 reportado
- Kill switch: 0 → 1

**Risco de não fazer**
> Decisão de SLO sem dado; incidente exige deploy para desligar.

**Dependências**: [performance-3] (log de duração)

---

### [modifiability-3] Compartilhar constantes da busca (limite, mínimo de letras) entre backend e frontend

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> Mínimo de 3 letras e limite de 20 linhas estão replicados em 3 camadas (backend, serviço, diálogo); o frontend não sabe o limite do backend e depende do campo `truncado`. Ajuste = 2 deploys (BE+FE).

**Melhoria Proposta**
> Defer Binding: expor `minimoTexto` e `limite` na resposta da busca (ou em `/sispag/config`), e o diálogo ler daí. Debounce permanece local (UX).

**Resultado Esperado**
> Ajuste pós-medição do `#LIKE` em 1 deploy (backend).

**Métricas de sucesso**
- Deploys para mudar o mínimo de letras: 2 → 1

**Risco de não fazer**
> Baixo; valores divergem se alguém mudar só um lado.

**Dependências**: Medição ao vivo do `#LIKE` ([integrability-1])

---

### [testability-3] Cobrir a guarda da sonda e dividir o diálogo em hook + apresentação

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity / Sandbox
**Esforço**: M
**Findings**: F-testability-3, F-testability-4

**Problema**
> A guarda que impede rodar a sonda em produção (2 `process.exit(1)`) não tem teste, e o diálogo de 444 LOC mistura busca, prévia, escolha e pedido, encarecendo cada caso. Piso de cobertura do frontend: 33% linhas.

**Melhoria Proposta**
> Extrair a checagem de base HML da sonda para função exportada num módulo e testar 2 casos (HML passa, não-HML recusa). Extrair o hook de busca do diálogo e testá-lo isolado. Subir o piso do frontend junto quando a cobertura subir.

**Resultado Esperado**
> Testes da guarda: 0 → 2. Diálogo: 444 LOC → ≤ 300 LOC com hook de busca testado isolado (0 → ≥ 4 casos).

**Métricas de sucesso**
- Casos da guarda da sonda: 0 → 2
- LOC do diálogo: 444 → ≤ 300

**Risco de não fazer**
> Custo de teste por mudança no pedido permanece alto; uma sonda em PRD derruba a sessão do robô.

**Dependências**: Nenhuma
