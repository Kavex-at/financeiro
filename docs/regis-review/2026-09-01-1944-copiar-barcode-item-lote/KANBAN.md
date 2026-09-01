---
type: regis-review-kanban
run_id: 2026-09-01-1944-copiar-barcode-item-lote
total: 31
counts: { p0: 0, p1: 7, p2: 15, p3: 9 }
---

# Kanban — financeiro — 2026-09-01-1944-copiar-barcode-item-lote

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S -> XL), depois P1, P2, P3. Cards internamente ordenados por esforço S -> M -> L -> XL.
> Gate `--quick` verde: **0 P0**. Todos os cards abaixo saem para `ontology/_inbox/copiar-barcode-item-lote-followups.md`.

---

## P0 — Crítico

_Nenhum card nesta categoria._ Gate passa.

---

## P1 — Alto

### [integrability-1] Registrar `itsNumCodbar` no `contrato.test.ts` como campo consumido

**QA**: Integrability
**Tactic alvo**: Contract testing (facet moderna); Adhere to Standards
**Esforço**: S (≤15 min)
**Findings**: F-integrability-1, F-integrability-2

**Problema**
> O novo `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` (`ConexosSispagWriteClient.ts:402`) depende do campo `itsNumCodbar` do grid `fin015/finItemSispag/list`, mas a entrada `fin015-item-lote` em `contrato.test.ts:97-103` continua listando só a chave composta. Um rename do campo no ERP não faz nenhum teste ficar vermelho — o método devolve `[]` em silêncio e a UI simplesmente esconde o botão. O próprio comentário do arquivo diz: *"Cada entrada aqui é uma dependência real, não documentação"*.

**Melhoria Proposta**
> Editar `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:97-103`: adicionar `'itsNumCodbar'` ao array `campos` e atualizar `consumidor` para citar os dois métodos (`listarChavesDoLote + listarLinhasDigitaveisDoLote`). Tactic Bass: Contract testing. Um único diff de linha; sem código de produção tocado.

**Resultado Esperado**
> O CI fica vermelho quando o próximo `jobs/capture-fixtures-sispag.ts` mostrar que o Conexos removeu ou renomeou o campo, dando o gatilho para investigar antes de a analista reclamar do botão sumido.

**Métricas de sucesso**
- Cobertura do fixture `fin015-item-lote` sobre campos lidos: 5/6 -> 6/6
- Nº de consumidores documentados na entrada `fin015-item-lote`: 1 -> 2

**Risco de não fazer**
> Se o Conexos renomear `itsNumCodbar` em uma release intermediária, o silêncio pode durar semanas — descoberto só por reclamação humana. E como o mesmo grid é lido por `listarChavesDoLote` (que faz retomada de import parcial), qualquer mudança nesse contrato indica que OUTRAS leituras podem ter degradado juntas.

**Dependências**: Nenhuma

---

### [testability-2] Adicionar `itsNumCodbar` ao contract test do `fin015-item-lote`

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S (≤1h)
**Findings**: F-testability-2

**Problema**
> `contrato.test.ts` foi criado exatamente para pegar breaking change do grid do Conexos. O `CONTRATOS.fixture: 'fin015-item-lote'.campos` lista 5 campos (`filCod`, `docCod`, `titCod`, `itsCodSeq`, `flpCod`) mas a feature nova lê um SEXTO — `itsNumCodbar` — que a fixture `2026-08-25-fin015-item-lote.json` já traz (com valor `null`). Se o Conexos renomear o campo, o `LINHA_DIGITAVEL_SCHEMA.safeParse` rejeita silenciosamente, `listarLinhasDigitaveisDoLote` devolve `[]`, o serviço absorve em `[]`+warn, a UI para de mostrar o botão. Zero teste falha.

**Melhoria Proposta**
> Editar `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:99-110`: adicionar `'itsNumCodbar'` à lista `campos` e atualizar `consumidor` para incluir `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote`. Nada mais precisa mudar — a fixture já contém o campo. Tactic Bass: **Recordable Test Cases** (é o mecanismo já em uso no repo, só ampliar).

**Resultado Esperado**
> `# campos declarados no contrato do fin015-item-lote / campos lidos pelo cliente = 5/6 -> 6/6`; se o Conexos remover ou renomear `itsNumCodbar`, o `ainda devolve os campos lidos por ...` falha no CI antes do PR merge.

**Métricas de sucesso**
- Campos declarados no contrato: 5 -> 6
- MTTR percebido de breaking change do fin015 no campo `itsNumCodbar`: "descoberto pela analista em produção" -> "PR falha no CI"

**Risco de não fazer**
> Bug de silêncio operacional — a UI simplesmente para de oferecer o botão, sem alerta.

**Dependências**: Nenhuma

> **Nota do consolidador**: `integrability-1` e `testability-2` são o MESMO card. Dois agentes independentes converegiram (mesmo arquivo, mesma linha, mesma correção). Executar 1 vez, atribuir crédito a ambos os QAs.

---

### [security-1] Redigir `itsNumCodbar` no interceptor axios do Conexos (e adotar a redação também no ramo de resposta)

**QA**: Security
**Tactic alvo**: Limit Access (Bass)
**Esforço**: S (≤1d)
**Findings**: F-security-1

**Problema**
> O interceptor de resposta em `services/conexos.ts:145-152` faz `console.error('[CONEXOS ✗] body=${JSON.stringify(body)}')` sem redação. Sob `DEBUG_VERBOSE=1`, também loga o corpo de sucesso raw. A lista `SENSITIVE_KEYS` (L20-30) só cobre chaves de credencial — `itsNumCodbar` não está lá. Basta uma falha do ERP na chamada `fin015/finItemSispag/list` para semear a linha digitável (47 dígitos) no stdout do Render, canal legível por qualquer engenheiro com acesso à aplicação.

**Melhoria Proposta**
> (i) Adicionar `itsNumCodbar`, `numcodbar`, `linhadigitavel`, `codigo_barras`, `ditespcodbar` à `SENSITIVE_KEYS` em `services/conexos.ts:20`. (ii) Estender `redactSensitive` para valer também no ramo de resposta (sucesso e erro) do interceptor — hoje ele só é chamado no ramo de request. (iii) Cobrir com teste unitário do próprio interceptor: injetar um erro sintético cujo `err.response.data` contém `itsNumCodbar` de 47 dígitos e assertar que a string não aparece em nenhum `console.error` capturado. Tactic Bass: Limit Access (defesa em profundidade sobre logs).

**Resultado Esperado**
> Nenhuma linha digitável, ou qualquer dado bancário do fin015, aparece em stdout mesmo quando o ERP retorna 5xx com envelope preenchido. `itsNumCodbar` presente em `SENSITIVE_KEYS`: false -> true. Sites de log de corpo de resposta sem redação: 2 -> 0.

**Métricas de sucesso**
- `itsNumCodbar in SENSITIVE_KEYS`: false -> true
- `console.error/log` sem redação no interceptor de resposta: 2 sites -> 0
- Teste unitário do interceptor que injeta `itsNumCodbar` no `err.response.data`: 0 -> 1 (com assertion `expect(logs).not.toMatch(/\d{47}/)`)

**Risco de não fazer**
> O guard `requireRole('admin')` fecha a porta da frente; sem esta redação, cada oscilação do Conexos escreve, no log de erro, a linha digitável do lote em execução. Um insider com acesso ao Render extrai a carteira sem tocar na API.

**Dependências**: Nenhuma

---

### [fault-tolerance-2] Logar contagem de linhas digitáveis descartadas pelo Zod

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Condition Monitoring / Recover State — Quarantine (com trilha)
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-2

**Problema**
> O laço do `listarLinhasDigitaveisDoLote` faz `continue` silencioso quando o `safeParse` falha (linha não é 47 dígitos, `docCod` faltando, etc.). Se o Conexos passar a devolver rows com layout novo, os itens somem sem trilha. É a classe de defeito da ADR-0040 reintroduzida num lugar novo — com cara de `continue` em vez de `?? ''`.

**Melhoria Proposta**
> No próprio client, contar o número de descartes por chamada e, quando `dropped > 0`, emitir um `CONEXOS_DEBUG` (ou `BUSINESS_WARN` se `dropped / total > 0.5`) com `{ path, total, dropped }`. **Não logar as rows descartadas** (podem conter dado sensível). Alternativa: retornar `{ itens, dropped }` do client e deixar o service decidir o log — mantém a camada baixa sem `logService`. Tactic alvo: Detect Faults — Condition Monitoring.

**Resultado Esperado**
> Qualquer degradação de schema no `fin015` deixa rastro operator-side; hoje o rastro é zero. Ao rodar sobre o histórico, esperar `dropped == 0` para 100% das chamadas em cenário saudável.

**Métricas de sucesso**
- Chamadas com `dropped > 0` que emitem log: 0% -> 100%
- Teste novo no client: 5 rows, 2 malformadas -> 3 itens + 1 chamada de log com `dropped: 2`.

**Risco de não fazer**
> Repetir a ADR-0040 num flanco novo — degradação silenciosa que só aparece quando a analista reclama.

**Dependências**: Nenhuma

---

### [fault-tolerance-3] Validar o DV da linha digitável (47 díg.) antes de devolver ao frontend

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Sanity Checking
**Esforço**: S (≤1d) — algoritmo bem definido, testes com vetores conhecidos
**Findings**: F-fault-tolerance-3

**Problema**
> A linha digitável tem 4 DVs próprios (três módulo-10 nos blocos + módulo-11 geral). O schema atual valida apenas o formato (`/^\d{47}$/`). Se o `fin015` retornar uma string truncada/corrompida, ela passa, vai ao clipboard, e a analista paga o boleto errado. O simétrico da geração (`RemessaCnabValidator.dvBarrasValido`) valida os 44 dígitos do código de barras justamente porque "o ERP não deveria errar, mas erra" — a assimetria entre escrita (validada) e leitura (não validada) é o gap.

**Melhoria Proposta**
> Adicionar em `src/backend/domain/libs/cnab/` (ou junto do `RemessaCnabValidator`) uma função `linhaDigitavelDvValida(linha: string): boolean` que verifica os 3 DVs módulo-10 (posições 5, 11, 17 relativas a cada bloco) e o DV módulo-11 geral (posição 33). No `LINHA_DIGITAVEL_SCHEMA`, encadear `.refine(linhaDigitavelDvValida, 'DV inválido')`. Item que falha o DV é **omitido** — mesma disciplina do regex falhado — e alimenta o contador do card fault-tolerance-2. Tactic alvo: Detect Faults — Sanity Checking (com paridade escrita/leitura).

**Resultado Esperado**
> Cobertura de DV da linha digitável: 0% -> 100%. Simetria com o fluxo de escrita (que valida 100% dos 44 díg. do barcode CNAB). Uma linha digitável entregue ao clipboard é matematicamente consistente ou não é entregue.

**Métricas de sucesso**
- Dígitos verificados por checksum: 0/47 -> 47/47
- Novo teste: linha digitável real (das 61 de produção do ADR-0040) -> aceita; mesma linha com 1 dígito trocado -> rejeitada; linha com todos zeros -> rejeitada.
- Contador de descartes por DV inválido no log (via card fault-tolerance-2).

**Risco de não fazer**
> Pagamento no boleto errado se o `fin015` degradar um `itsNumCodbar` — a defesa "o banco recusa" transfere responsabilidade, não a elimina, e o custo do incidente (dinheiro público na conta errada, reversão manual, quebra de confiança da analista no botão) desloca qualquer economia de esforço.

**Dependências**: Idealmente vai junto do card fault-tolerance-2 (mesmo arquivo, mesma disciplina).

---

### [performance-1] Paginar de verdade em `listarLinhasDigitaveisDoLote` (matar o `pageNumber:1` fixo)

**QA**: Performance
**Tactic alvo**: Bound Execution Times + Reduce Overhead
**Esforço**: S
**Findings**: F-performance-1, F-performance-3

**Problema**
> Novo método fixa `pageNumber:1, pageSize:500` sem loop nem `chavesDesejadas`. É o MESMO anti-padrão que o `listarTitulosPendentes` (60 linhas abaixo no mesmo arquivo) documenta ter causado bug real: filial 2 com ~2020 pendentes viu 24,7% do grid. Aqui a falha é silenciosa por design — a UI oculta o botão quando não há linha, então o modo de falha é indistinguível de "não tem código de barras".
>
> **Medição de produção (2026-09-01)**: varredura de 31 lotes nativos nas 5 filiais mostra maior lote = 41 itens; o cap de 500 tem folga confortável hoje. O card permanece P1 (não P0) porque o risco é de crescimento futuro, não atual.

**Melhoria Proposta**
> Reusar o esqueleto do `listarTitulosPendentes` (loop `while (pagina < maxPaginas)`, leitura de `resposta.count`, `maxPaginas` como guarda anti-loop, WARN se cortou antes do total). Adicionalmente aceitar `chavesDesejadas?: ReadonlySet<string>` para parar cedo: o chamador (`SispagPainelService.linhasDigitaveisDoLote`) tem o `lote.itens` inteiro e sabe exatamente quais `docCod:titCod` procurar. Tactic Bass: **Bound Execution Times** (correta, via `maxPaginas`) sem sacrificar **Reduce Overhead** (para cedo no caso comum).
>
> Arquivos: `src/backend/domain/client/ConexosSispagWriteClient.ts` (método), `src/backend/domain/service/sispag/SispagPainelService.ts` (repassa `chavesDesejadas = new Set(lote.itens.map(chave))`).

**Resultado Esperado**
> Lote de até `maxPaginas × pageSize` itens é lido completo; lote maior emite WARN estruturado em vez de silenciar. Caso comum (lote pequeno, boletos vencendo primeiro que o ERP ordena) resolve em 1 página por `chavesDesejadas`. Métrica: p_perda 100% para lote > 500 -> 0% até `maxPaginas × pageSize`; WARN por truncamento: 0 -> 1 por ocorrência (observável).

**Métricas de sucesso**
- Itens truncados silenciosamente: incalculável hoje -> 0 (com WARN mensurável)
- Chamadas ao Conexos no caso comum: 1 página cheia (500 linhas) -> 1 página com early-exit por `chavesDesejadas` (payload proporcional ao lote real)

**Risco de não fazer**
> Em 6 meses, a primeira analista a cair no caso `N > 500` reporta "boleto sem código de barras" para um título que TEM código; investigação repete o mesmo trabalho da sondagem que produziu o ADR-0040.

**Dependências**: Nenhuma

---

### [testability-1] Escrever teste de `LoteCard` cobrindo o handler `copiarLinha`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> O delta adicionou 62 LOC no `LoteCard.tsx` com estado (`contas`, `disponiveis`, `linhas`), três `useEffect` de fetch e o handler `copiarLinha` que chama `navigator.clipboard.writeText` e emite `toast.success`. Nenhum teste toca `src/frontend/app/sispag/` — o ratio é 0/4. A promessa central da feature (copiar sem repetir os 47 dígitos no toast) é verificada só por olho.

**Melhoria Proposta**
> Criar `src/frontend/app/sispag/components/LoteCard.test.tsx` com Testing Library + jsdom, patchando `navigator.clipboard.writeText` via `Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn() } })` e mockando `@/lib/sispag` por `jest.mock`. Casos mínimos: (1) happy path — botão de copiar aparece quando `i.modalidade === 'BOLETO'` E `linhas.get(chave)` está setado; click chama `writeText('1'*47)` uma vez e emite `toast.success` cuja descrição **não contém** `'1'*47`; (2) `writeText` rejeita -> `toast.error` sem crash; (3) `fetchLinhasDigitaveis` rejeita -> botão nunca renderiza. Tactic Bass: **Executable Assertions** + **Specialized Interfaces** (o próprio `LoteCard` já expõe seams via props — o teste consuma-os).

**Resultado Esperado**
> `# testes cobrindo LoteCard = 0 -> ≥ 3`; `ratio de tests do app/sispag = 0/4 -> 1/4`; regra "toast não repete os 47 dígitos" passa a ter gêmea no frontend, simétrica ao caso existente no `SispagPainelService.test.ts:449-457`.

**Métricas de sucesso**
- Testes cobrindo `LoteCard.tsx`: 0 -> 3
- Ratio de arquivos-teste em `src/frontend/app/sispag/`: 0.00 -> 0.25
- Invariante "descrição do toast não contém a linha completa" verificada por 1 assertion tipada

**Risco de não fazer**
> Qualquer refactor do handler passa verde e a analista descobre no click; falha silenciosa do fetch fica indistinguível de "lote sem boleto".

**Dependências**: Nenhuma

---

## P2 — Médio

### [availability-2] Preservar campos do `ConexosError` no `BUSINESS_WARN`

**QA**: Availability
**Tactic alvo**: Monitor (Bass — Detect)
**Esforço**: S (≤0.5d)
**Findings**: F-availability-2

**Problema**
> O `catch (err)` do serviço só extrai `.message`. `ConexosError` classifica upstream entre `CONEXOS_UPSTREAM_TIMEOUT`, `..._ERROR` e `..._REJECTED`, com `statusCode`, `endpoint`, `retryable` — tudo jogado fora quando o log é escrito.

**Melhoria Proposta**
> No branch de catch, testar `err instanceof ConexosError` e serializar `code`, `statusCode`, `endpoint` e `retryable` como campos separados do `data`. Manter `motivo` para causas não-tipadas (fallback). Tactic Bass: Monitor com granularidade adequada.

**Resultado Esperado**
> Log passa a permitir agrupar por classe de falha sem precisar parsear `motivo`. Métrica: 0 campos tipados hoje -> 4 campos preservados (`code`, `statusCode`, `endpoint`, `retryable`).

**Métricas de sucesso**
- Campos do `ConexosError` preservados no log: 1 (`.message`) -> 5
- Tempo p/ triagem de incidente (autodeclarado por SRE): "abrir chamado + reproduzir" -> "grep + agrupar"

**Risco de não fazer**
> Cada incidente reincidente consome triagem manual do zero.

**Dependências**: Nenhuma

---

### [availability-1] Diferenciar "sem boleto" de "falha ao ler" no contrato do endpoint

**QA**: Availability
**Tactic alvo**: Degradation + Exception Detection (Bass — Recover / Detect)
**Esforço**: S (≤1d)
**Findings**: F-availability-1

**Problema**
> Hoje `GET /sispag/lotes/:id/linhas-digitaveis` devolve `{itens: []}` tanto quando o lote está em rascunho e não tem boleto associado quanto quando o Conexos fin015 caiu no meio do request. A analista vê o mesmo estado nos dois cenários (o botão de copiar simplesmente não aparece) e, sob falha do ERP, pode buscar a linha em outra fonte não verificada — um caminho de erro que a feature devia estar prevenindo.

**Melhoria Proposta**
> Enriquecer o payload com um marcador de origem, ex.: `{itens: [...], degraded: boolean, reason?: 'draft' | 'no_boleto' | 'conexos_unavailable'}`. Preservar o comportamento atual de nunca lançar (a degradação em si é correta), mas separar o sinal na resposta. No frontend, quando `degraded === true`, pintar um discreto ícone de alerta em vez do botão de copiar, com tooltip "Não foi possível carregar as linhas — tente novamente em instantes". Tactic Bass: Degradation acompanhada de Exception Detection observável pelo consumidor.

**Resultado Esperado**
> Analista distingue visualmente ausência legítima de falha transitória; SRE consegue medir "quantas vezes o endpoint degradou" via `count(degraded=true)` no log de request. Métrica observável: hoje 0% dos cenários de falha são discerníveis pelo cliente -> alvo 100%.

**Métricas de sucesso**
- % de respostas do endpoint que distinguem "vazio legítimo" de "erro degradado": 0% -> 100%
- Falhas do fin015 visíveis à analista na UI: 0 -> todas

**Risco de não fazer**
> Em uma janela de instabilidade do Conexos, analista paga boleto vindo de fonte não conferida. Nenhum guard-rail do sistema pega isso hoje.

**Dependências**: Nenhuma

---

### [availability-3] Instrumentar métrica agregada + alarme de taxa de falha no endpoint

**QA**: Availability
**Tactic alvo**: Monitor (Bass — Detect)
**Esforço**: S (≤1d — depende do que existe hoje para alarme sobre log)
**Findings**: F-availability-3

**Problema**
> A queda silenciosa (F-availability-1) só é detectável por `grep BUSINESS_WARN`. Não há painel, não há alarme. Em janela típica de indisponibilidade parcial do Conexos (30 min), ninguém é acionado até analista abrir chamado.

**Melhoria Proposta**
> Adicionar um contador dedicado — nome estável, ex.: `sispag.linhas_digitaveis.fallback` — incrementado no catch do serviço. Enquanto o repo não migra para AWS, materializar como uma chave `metric` estruturada no log que a query padrão do Render/Supabase consegue agrupar. Definir alarme "≥N eventos em 15 min" ligado ao canal SRE. Tactic Bass: Monitor + Predictive Model (thresholded).

**Resultado Esperado**
> SRE recebe alerta antes do primeiro chamado de analista. Métrica: MTTD passa de "reclamação humana" para "≤15 min após início da falha".

**Métricas de sucesso**
- Alarmes cobrindo este caminho: 0 -> 1
- MTTD estimado: "só via chamado" -> ≤15 min

**Risco de não fazer**
> Uma janela de degradação passa em branco na operação até alguém somar 2+2 lendo log manualmente — o que raramente acontece.

**Dependências**: Idealmente feito depois de availability-2 (para poder agrupar pela classe de erro), mas independente na prática.

---

### [deployability-2] Kill-switch por env para `GET /sispag/lotes/:id/linhas-digitaveis` — alinhar ao padrão do SISPAG

**QA**: Deployability
**Tactic alvo**: Rollback (granular — feature toggle sem redeploy)
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> A rota expõe linhas digitáveis de boletos (instrumento de pagamento, LGPD Art. 6º / LC 105 — conforme comentário do próprio código). O único gate hoje é `requireRole('admin')`. Se surgir incidente (log acidental do valor, credencial admin comprometida, DoS via 500 itens por chamada) o único recurso é revert + redeploy (~5min no plano starter). Todo o resto do SISPAG sensível já tem kill-switch via `sync: false` no `render.yaml` (`SISPAG_LIVE_WRITE_ENABLED`, `SISPAG_DDA_ASSOC_ENABLED`, `RECEBIMENTOS_ENABLED`) — pattern estabelecido, esta rota não adotou.

**Melhoria Proposta**
> 1) Adicionar `SISPAG_COPIAR_LINHA_DIGITAVEL_ENABLED` (default `true`, `sync: false` no `render.yaml`) validado por Zod em `EnvironmentVars.ts` (mesmo shape de `sispagDdaAssocEnabled`). 2) `routes/sispag.ts` middleware antes do handler: `if (!env.sispagCopiarLinhaDigitavelEnabled) return res.status(403).json({ error: 'temporarily disabled' })`. 3) FE já cai no `catch` — botão desaparece automaticamente sem release. 4) Registrar em `DEPLOY.md` na tabela de kill-switches do SISPAG.

**Resultado Esperado**
> MTTR de isolamento de incidente na rota: ~5min (redeploy) -> ≤ 30s (dashboard toggle). Sem afetar `SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED` ou o painel como um todo — corta cirurgicamente esta rota.

**Métricas de sucesso**
- Kill-switches SISPAG cobrindo rotas sensíveis: 2 -> 3
- MTTR de "desligar `GET linhas-digitaveis` em produção": ~5min -> ≤ 30s
- Cobertura do padrão `sync: false` em rotas admin-only que expõem dado de pagamento: parcial -> completa

**Risco de não fazer**
> Em 6 meses, um incidente qualquer (analista compartilha cURL no Slack; log estrutural começa a serializar `res.json` sem redação; Conexos passa a devolver dados extras no `itsNumCodbar`) obriga hotfix + release + deploy. Todo o SISPAG restante já tem essa alavanca; a única rota sem ela é justamente a que o próprio comentário classifica como sensível.

**Dependências**: Nenhuma (padrão já implementado em outras vars)

---

### [security-2] Aplicar `heavyRouteLimiter` (10/min) na rota `/lotes/:id/linhas-digitaveis` — e no precedente `/lotes/:id/remessa/arquivo`

**QA**: Security
**Tactic alvo**: Limit Exposure (Bass)
**Esforço**: S (≤1d)
**Findings**: F-security-2

**Problema**
> `GET /sispag/lotes/:id/linhas-digitaveis` está apenas sob `globalLimiter` (100 req/min por IP). O `.REM` (mesma classe de dado — banco/agência/conta do cedente) está no mesmo teto. Um admin comprometido pode enumerar a carteira inteira em uma janela de 60s. As outras rotas SISPAG com fan-out ao Conexos já usam `heavyRouteLimiter` (10/min).

**Melhoria Proposta**
> Aplicar `heavyRouteLimiter` **antes** do handler nas duas rotas: `routes/sispag.ts:63` (novo) e `routes/sispag.ts:454` (`/remessa/arquivo`). Manter o `requireRole('admin')`. Tactic Bass: Limit Exposure.

**Resultado Esperado**
> Teto de exfiltração cai de 100 lotes/min para 10 lotes/min por IP em ambas as rotas de dado bancário. Rate-limiter passa a compor com o guard, reduzindo blast radius de um token de admin comprometido.

**Métricas de sucesso**
- Rotas de dado bancário cobertas por `heavyRouteLimiter`: 0/2 -> 2/2
- Teto teórico de extração por minuto: 100 -> 10

**Risco de não fazer**
> Token de admin roubado ou script malicioso de operador legítimo consome a carteira inteira sem trigger. Se o card `security-3` ainda não estiver de pé, o forense não tem nem log estruturado para reconstituir o incidente.

**Dependências**: Convém alinhar com o card de audit trail (`security-3`) para dar ao alarme algo para se apoiar.

---

### [performance-3] Ler e agir sobre o `count` do `listGenericPaginated`

**QA**: Performance
**Tactic alvo**: Reduce Overhead (instrumentação)
**Esforço**: S
**Findings**: F-performance-3, F-performance-1

**Problema**
> O `page.count` devolvido pelo ERP no `listarLinhasDigitaveisDoLote` é descartado. Sem ele, não há como saber em runtime se o `pageSize:500` está sendo suficiente — o defeito F-performance-1 é permanentemente invisível.

**Melhoria Proposta**
> Mesmo tratamento do `listarTitulosPendentes` (linhas 502-523): capturar `resposta.count`, comparar com `linhas.length`, emitir `console.warn` estruturado se cortou. Sobrepõe-se com [performance-1] mas vale mesmo se aquele card demorar: um WARN barato hoje é o alarme que evita a investigação de 3 dias em 6 meses. Bass: **Reduce Overhead** (instrumentação leve com sinal alto).
>
> Arquivo: `src/backend/domain/client/ConexosSispagWriteClient.ts` (mesmo método).

**Resultado Esperado**
> Truncamento passa a ser observável em CloudWatch/Render logs. Métrica: MTTD do defeito de paginação: ∞ -> segundos após ocorrência.

**Métricas de sucesso**
- Cobertura de observabilidade do truncamento: 0% -> 100%

**Risco de não fazer**
> F-performance-1 permanece invisível independente do valor efetivo dos lotes.

**Dependências**: Pode/deve ir junto com [performance-1]

---

### [performance-2] Cachear a resposta de `fetchLinhasDigitaveis` no ciclo de vida do card (ou por sessão)

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: S (option 1) / M (option 2)
**Findings**: F-performance-2

**Problema**
> `useEffect` com `aberto` nas dependências dispara `fetchLinhasDigitaveis(l.id)` toda vez que a analista fecha e reabre o card. A linha digitável é imutável após a remessa gerada (documentado no próprio service e no ADR-0040), então re-buscar é puro desperdício de sessão Conexos.

**Melhoria Proposta**
> Duas opções, do mais barato ao mais estruturado:
> 1. Guardar o `Map<string,string>` num `useRef` chaveado por `l.id` dentro do `LoteCard`, e só refetchar se `l.status` mudou (i.e., analista voltou a mexer no lote). Bass: **Maintain Multiple Copies of Computations** (cache local).
> 2. Subir o cache para o `SispagContext`/hook compartilhado (junto com o padrão que `fetchModalidadesDisponiveis` já quer eventualmente): TTL de 60s, invalidado ao gerar/regerar remessa.
>
> Arquivos: `src/frontend/app/sispag/components/LoteCard.tsx` (option 1); ou `src/frontend/lib/sispag.ts` + hook novo em `src/frontend/app/sispag/hooks/` (option 2).

**Resultado Esperado**
> Reabrir o mesmo card N vezes -> 1 request ao ERP (não N). Métrica: chamadas/expansão 1 -> 1/N (com N = número de expansões do MESMO card na sessão).

**Métricas de sucesso**
- Chamadas ao Conexos por sessão de análise: N_expansões -> N_lotes_distintos
- Pressão sobre `LOGIN_ERROR_MAX_SESSIONS` durante fechamento de mês: reduz linearmente

**Risco de não fazer**
> Multiplicador constante sobre o pool que a remessa/importação REAL divide; em pico volta a disparar `LOGIN_ERROR_MAX_SESSIONS` em rota que move dinheiro.

**Dependências**: Nenhuma

---

### [fault-tolerance-1] Sinalizar falha de leitura da linha digitável para a analista

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-1

**Problema**
> O client preserva com cuidado a distinção "falhou vs vazio" (throw `ConexosError` vs `[]`), mas essa informação é apagada no service (`try/catch -> []`) e novamente no frontend (`.catch -> Map()`). A analista que abre um lote DDA sem botões de copiar não sabe se (a) nenhum item é DDA, (b) o ERP oscilou, ou (c) a resposta veio malformada. O log operator-side existe (`BUSINESS_WARN`), mas a UI é cega.

**Melhoria Proposta**
> No `LoteCard.tsx`, dentro do `.catch` do `fetchLinhasDigitaveis`, distinguir "sem dados" de "erro" com um estado `'idle' | 'ok' | 'fail'` (setar `'fail'`). Renderizar um badge/ícone discreto ao lado do rótulo `boleto` quando `status === 'fail'`, com `title="Não foi possível ler as linhas digitáveis — tente reabrir o lote"`. Nenhum toast intrusivo (é uma conveniência, não uma ação). Tactic alvo: Detect Faults — Condition Monitoring na camada de apresentação.

**Resultado Esperado**
> A analista tem sinal visual de "isto não é o estágio, é um erro" sem precisar do log do backend. Cobertura de ramos observáveis: 0/3 -> 2/3 (o terceiro — "malformado no client" — não sobe para o front por design, e assim está bom).

**Métricas de sucesso**
- Ramos de falha do fetch com feedback ao usuário: 0/3 -> 2/3
- Novo teste em `LoteCard`: com `fetchLinhasDigitaveis` rejeitando, o badge de "falha" aparece.

**Risco de não fazer**
> Retrabalho silencioso (analista recorre ao caminho manual quando o DDA está pronto mas o fetch falhou); indistinguível de "não é DDA".

**Dependências**: Nenhuma

---

### [fault-tolerance-4] Distinguir "rascunho legítimo" de "invariante quebrada" no `linhasDigitaveisDoLote`

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Sanity Checking
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-4

**Problema**
> O `if (nativeFilCod == null || nativeBncCod == null || nativeFlpCod == null) return [];` é correto para RASCUNHO (curto-circuito). Mas se um lote em `REMESSA_GERADA/ENVIADO/RETORNO/CONCILIADO` chegar com algum dos três nulos (bug de escrita, migration incompleta), a mesma linha devolve `[]` como se fosse estágio — mascarando quebra de invariante da state machine.

**Melhoria Proposta**
> Antes do return, checar o `status` do lote. Se `status === 'RASCUNHO'`, `[]` sem log (comportamento atual). Caso contrário, emitir `BUSINESS_WARN` com `{ loteId, status, missing: ['nativeFilCod'?, 'nativeBncCod'?, 'nativeFlpCod'?] }` e continuar retornando `[]` (o botão não aparece, o card não quebra) — mas o rastro fica. Tactic alvo: Detect Faults — Sanity Checking de invariantes de state machine.

**Resultado Esperado**
> Qualquer erosão silenciosa da relação `status ≥ REMESSA_GERADA => native* != null` é detectada operator-side. Cobertura: 0 -> 1 invariante monitorada.

**Métricas de sucesso**
- Invariantes de state machine monitoradas em `linhasDigitaveisDoLote`: 0 -> 1
- Novo teste: lote em `REMESSA_GERADA` com `nativeFlpCod == null` -> `[]` + `log.warn` chamado com `missing: ['nativeFlpCod']`.

**Risco de não fazer**
> Baixo agora, mas a state machine do lote é o cerne do SISPAG; erosão silenciosa vira dívida difícil de encontrar depois.

**Dependências**: Nenhuma

---

### [integrability-3] Emitir warn quando `safeParse` derruba TODAS as linhas do fin015

**QA**: Integrability
**Tactic alvo**: Observability of integration failures (facet moderna)
**Esforço**: S (≤1d)
**Findings**: F-integrability-4

**Problema**
> Em `ConexosSispagWriteClient.ts:426-429`, cada linha reprovada pelo `LINHA_DIGITAVEL_SCHEMA` é descartada em silêncio (`continue`). Se o Conexos renomear o campo, o loop descarta tudo, o método devolve `[]`, o serviço não entra no `catch` (porque não houve erro), e o `BUSINESS_WARN` não é emitido. Um lote com todos os boletos escondidos por schema-fail é indistinguível de um lote legitimamente sem boletos.

**Melhoria Proposta**
> Contar `descartadas` no loop e, quando `descartadas > 0`, emitir `logService.warn({type: BUSINESS_WARN, message: 'fin015-linhasDigitaveis: linhas descartadas pelo schema', data: {loteId, path, descartadas, total: page.rows.length}})`. Não passar a linha real — só a contagem. Tactic Bass: Observability of integration failures. Alternativa mais defensiva: quando `descartadas === total && total > 0`, subir `ConexosError` — mas isso mudaria o contrato do serviço e vale casar com [integrability-1] antes.

**Resultado Esperado**
> Um rename do ERP produz warn no log agregado no primeiro request, em vez de silêncio indefinido. Combinado com [integrability-1], o gatilho fica em CI (fixture) OU em runtime (warn) — o que vier primeiro.

**Métricas de sucesso**
- Nº de eventos de log emitidos quando `safeParse` falha em ≥1 linha: 0 -> 1
- Distinção observável entre "lote sem boleto" e "linhas descartadas pelo schema": impossível -> clara nos logs

**Risco de não fazer**
> Regressão silenciosa fica invisível até uma pessoa reportar. Baixa criticidade nesta feature (conveniência), mas o padrão de "descartar linha em silêncio" está no código — melhor documentar/instrumentar antes que apareça em contexto crítico.

**Dependências**: Nenhuma (roda em paralelo com [integrability-1]).

---

### [modifiability-1] Extrair `LinhaDigitavelItem` como DTO nomeado compartilhado

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S (≤1d)
**Findings**: F-modifiability-1

**Problema**
> O tipo `{ docCod: string; titCod: string; linhaDigitavel: string }` está inline em 5 pontos de 3 arquivos (client, service, frontend/lib). Qualquer campo novo (ex.: `bncCod` do banco emissor do boleto, cenário `itsVldModalidade=7`) exige 5 edições coordenadas sem que o TypeScript force o alinhamento. É débito P2 já reconhecido pelo PatternGuardian — este card só torna acionável.

**Melhoria Proposta**
> Criar `src/backend/domain/interface/sispag/LinhaDigitavelItem.ts` com `interface LinhaDigitavelItem { docCod: string; titCod: string; linhaDigitavel: string }`. Reutilizar em `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` (retorno + array local), em `SispagPainelService.linhasDigitaveisDoLote` (retorno) e em `frontend/lib/sispag.ts::fetchLinhasDigitaveis` (retorno + shape do JSON). Front pode duplicar o `interface` (fronteira HTTP não compartilha módulos com o backend) — mas em UM ponto, não dois. Aproveitar para adicionar helper `chaveTitulo({ docCod, titCod })` que substitui a template string `${docCod}:${titCod}` (hoje em 3 lugares do `LoteCard.tsx` e do backend). Tactic: **Encapsulate + Abstract Common Services**.

**Resultado Esperado**
> 1 tipo nomeado por lado (backend + frontend), 0 formas inline. Renomear/estender custa 2 edições em vez de 5. Métrica de duplicação inline: 5 -> 0.

**Métricas de sucesso**
- Ocorrências inline do shape: 5 -> 0
- Arquivos que precisam mudar para adicionar `bncCod` ao DTO: 5 -> 2

**Risco de não fazer**
> Em 6 meses, quando a analista pedir "quero ver o banco emissor do boleto ao lado da linha digitável" (previsível — a Nexxera devolve isso no retorno), o custo do delta será 5 edições coordenadas, um dos 5 pontos ficará para trás, e o front vai renderizar `undefined`.

**Dependências**: Nenhuma

---

### [modifiability-2] Renomear `ConexosSispagWriteClient` para `ConexosFin015Client` (ou dividir por CQRS)

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S (≤1d — rename + import mass edit)
**Findings**: F-modifiability-2

**Problema**
> `ConexosSispagWriteClient` já era um nome errado (8 métodos de leitura / 5 de escrita). O delta adiciona a 8ª leitura e acopla `SispagPainelService` (read-only por definição) a um símbolo chamado "Write". A cada `/feature-tweak` do painel, o leitor precisa validar se há efeito colateral onde não há.

**Melhoria Proposta**
> Opção A (barata): renomear a classe/arquivo para `ConexosFin015Client` — reflete o endpoint real, sem prometer nem esconder efeito colateral. Ajustar imports (`grep -l ConexosSispagWriteClient` = 11 arquivos, majoritariamente `jobs/`). Opção B (mais profunda, deixar para próximo tweak): dividir em `Fin015ReadClient` e `Fin015WriteClient` seguindo CQRS, e fazer `SispagPainelService` depender só do Read. Recomendo A agora para não inflar o delta atual; abrir card separado para B se a próxima feature de painel piorar o coupling. Tactic: **Increase Semantic Coherence**.

**Resultado Esperado**
> Nome do módulo reflete o que ele faz (proxy do endpoint fin015 do ERP), não uma metade das operações. `grep 'Write' src/backend/domain/service/sispag/*.ts` deixa de retornar chamadas de leitura como falso positivo em revisões futuras.

**Métricas de sucesso**
- Clientes Conexos no construtor do `SispagPainelService` cujo nome contradiz o uso: 1 -> 0
- Instâncias de "Write" no path de leitura do painel: 1 -> 0

**Risco de não fazer**
> O débito escala com cada nova leitura adicionada ao mesmo arquivo. Em 3 features é o próximo caso de PatternGuardian a bloquear a review "espere, esse client é de escrita, por que o service de leitura chama?".

**Dependências**: Nenhuma. Não conflita com [modifiability-1].

---

### [testability-3] Adicionar 1 caso de `listarLinhasDigitaveisDoLote` que carregue a fixture real (Sandbox -> boundary)

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: S (≤2h)
**Findings**: F-testability-3, F-testability-2

**Problema**
> Os 5 casos novos de `ConexosSispagWriteClient.test.ts:499-568` são mocks sintéticos: `{ rows: [{ docCod, titCod, itsNumCodbar }] }` com só os 3 campos que interessam. O grid real do fin015 tem 50+ colunas (visíveis em `2026-08-25-fin015-item-lote.json`). Se o envelope real vier com `{ data: { rows: [...] } }` (padrão que o próprio `LOTE_CRIADO_SCHEMA` do arquivo já corrige em outro endpoint da mesma família), o mock aceita e o real falha em HML.

**Melhoria Proposta**
> Adicionar 1 caso na suíte `listarLinhasDigitaveisDoLote`: carregar `2026-08-25-fin015-item-lote.json` via `readFileSync`, mockar `base.listGenericPaginated` para devolver `{ rows: [fixture.linha, {...fixture.linha, itsNumCodbar: '1'.repeat(47)}] }`, e assertar que a chamada devolve 1 item (o primeiro tem `itsNumCodbar: null`, o segundo tem uma linha válida). Isso amarra o parser ao SHAPE real do grid — mudança no ERP quebra o teste. Tactic Bass: **Sandbox** (fixture redigida como referência controlada).

**Resultado Esperado**
> `# casos de listarLinhasDigitaveisDoLote que consomem fixture real = 0 -> 1`; regressão de envelope (`{data:{rows}}` vs `{rows}`) é pega no CI, não em HML.

**Métricas de sucesso**
- Casos consumindo `2026-08-25-fin015-item-lote.json`: 0 -> 1
- Cobertura do envelope `{ rows: [...] }` vs `{ data: { rows: [...] } }`: implícita -> explícita

**Risco de não fazer**
> Mocks divergem do real — a família de bugs que o `LOTE_CRIADO_SCHEMA` já teve que corrigir uma vez, mas para leitura.

**Dependências**: Idealmente após `testability-2` (contrato atualizado dá segurança à fixture)

---

### [integrability-2] Marcar tipo do valor redigido para campos com shape (barcode, linha digitável)

**QA**: Integrability
**Tactic alvo**: Contract testing (facet moderna)
**Esforço**: M (2–5d) — mudanças em capture job + convenção nos fixtures + assertions extras
**Findings**: F-integrability-2, F-integrability-4

**Problema**
> O fixture `2026-08-25-fin015-item-lote.json:21` tem `"itsNumCodbar": null` — a chave está, mas o valor não exercita o formato (47 dígitos numéricos). O `contrato.test.ts` só confirma "chave presente" e "string não vazada", não confirma "shape". O honesto-limit do próprio arquivo já reconhece isso (`contrato.test.ts:20-21`).

**Melhoria Proposta**
> Estender a redação em `jobs/capture-fixtures-sispag.ts` para gerar marcadores tipados (ex.: `"<barcode47>"`, `"<pesCod>"`) em vez de `null`/`"<string>"`; no `contrato.test.ts`, adicionar um `casosDeShape` opcional por entrada de `CONTRATOS` que afirma `regex.test(fixture[campo])` quando o marcador equivalente estiver presente. Tactic Bass: Contract testing (facet moderna). Manter a política de zero valor real vazado — os marcadores são sentinelas.

**Resultado Esperado**
> CI detecta mudança de shape (44 dígitos, com máscara, com sufixo dígito verificador) do lado do ERP antes que o `LINHA_DIGITAVEL_SCHEMA.regex(/^\d{47}$/)` comece a rejeitar tudo em silêncio.

**Métricas de sucesso**
- Fixtures com marcador de tipo aplicável a `itsNumCodbar` / `pctEspNumContaBanc` / `titEspNumero`: 0 -> ≥3
- Assertions de shape (regex) em `contrato.test.ts`: 0 -> 1 por campo com formato fixo

**Risco de não fazer**
> Regressões de tipo escapam pelo `safeParse` sem ninguém saber — vira dependência puramente humana. Para pagamento (não é o caso desta feature), o mesmo padrão é apostado com efeito monetário direto no ADR-0040.

**Dependências**: [integrability-1] (o campo precisa estar em `campos` antes de ganhar shape check).

---

### [security-3] Trilha de auditoria persistida para as rotas que expõem dado bancário do lote (`linhas-digitaveis`, `.REM`)

**QA**: Security
**Tactic alvo**: Audit Trail (Bass)
**Esforço**: M (2–5d) — inclui a tabela + migration + repo + integração nos handlers + testes
**Findings**: F-security-3

**Problema**
> Nenhuma das duas rotas registra "quem baixou a linha digitável / o `.REM` de qual lote e quando" numa tabela local. O único vestígio é o `console.log` do interceptor Conexos — efêmero, agregável por linha mas não por sessão de usuário. Uma auditoria LGPD (Art. 37) não consegue diferenciar "1 consulta legítima" de "42 consultas em 5 minutos".

**Melhoria Proposta**
> Persistir uma linha em `audit_events` (a criar, ou reaproveitar tabela análoga se já vier de outra frente) na entrada dos dois handlers: `{ user_sub, user_role, action: 'sispag.linhas-digitaveis.read' | 'sispag.remessa.download', lote_id, filCod, timestamp, request_id, ip }`. **Nunca** persistir a linha digitável em si — só o metadata do acesso. Alarmar em `count > N por (user_sub, hora)`. Tactic Bass: Audit Trail. Cross-QA com Fault Tolerance (mesma dívida) e Availability (blast radius de admin comprometido).

**Resultado Esperado**
> Toda leitura de dado bancário do lote fica gravada com autor + alvo + hora, permitindo forense em minutos ao invés de horas. Cobertura de audit em rotas sensíveis: 0/2 -> 2/2. Base para o alarme de enumeração (card futuro).

**Métricas de sucesso**
- Rotas de dado bancário com audit persistido: 0/2 -> 2/2
- Colunas obrigatórias em `audit_events`: `user_sub, action, target_id, ts` — todas NOT NULL, sem `linhaDigitavel` gravada

**Risco de não fazer**
> Acúmulo de dívida atravessa a implantação; um vazamento reportado 30 dias depois não é rastreável.

**Dependências**: Alinhamento com o consolidador — Fault Tolerance provavelmente já tem card análogo; consolidar em UM único card se for o caso.

---

## P3 — Baixo

### [availability-4] `AbortController` no `useEffect` do LoteCard

**QA**: Availability
**Tactic alvo**: Exception Prevention (Bass — Prevent)
**Esforço**: S (≤0.5d)
**Findings**: F-availability-4

**Problema**
> O `useEffect` que busca linhas digitáveis usa flag `vivo` para evitar `setState` após unmount, mas não cancela a request em si. Sob Conexos lento e analista abrindo/fechando cards em sequência, empilham-se requests órfãs consumindo worker.

**Melhoria Proposta**
> Trocar a flag `vivo` por `AbortController` e propagar o `signal` até `apiFetch` (`fetchLinhasDigitaveis` aceitando `RequestInit` opcional). No cleanup, `controller.abort()`. Tactic Bass: Exception Prevention.

**Resultado Esperado**
> Requests em voo são canceladas ao colapsar/desmontar. Sob load, worker preservado.

**Métricas de sucesso**
- Requests órfãs sob toggle rápido: N -> 0

**Risco de não fazer**
> Irrelevante em uso normal; começa a pesar em momento de degradação — quando preservar recurso mais importa.

**Dependências**: Nenhuma

---

### [availability-5] Botão "recarregar linhas" quando o fetch falha

**QA**: Availability
**Tactic alvo**: State Resynchronization (Bass — Recover / Reintroduction)
**Esforço**: S (≤0.5d)
**Findings**: F-availability-5

**Problema**
> Se o primeiro fetch falha e a analista mantém o card aberto, não há caminho automático nem manual de re-tentativa até colapsar/re-expandir. O botão de copiar fica ausente mesmo depois do Conexos voltar.

**Melhoria Proposta**
> Guardar estado de erro no `useState` (não só `Map` vazio) e, quando presente, exibir um pequeno ícone de "recarregar" perto da coluna de modalidade que dispara novo fetch sob demanda. Depende do card availability-1 para saber quando pintar. Tactic Bass: State Resynchronization.

**Resultado Esperado**
> MTTR percebido pela analista alinhado ao MTTR real do Conexos. Métrica: interações manuais para recuperar (colapsar+expandir -> 1 clique) mantidas em 1, mas com feedback explícito de "houve falha".

**Métricas de sucesso**
- Caminhos manuais de recovery no cliente: 0 -> 1

**Risco de não fazer**
> Fricção residual em incidentes; não crítico.

**Dependências**: availability-1 (compartilha o marcador de degradação no payload).

---

### [testability-4] Cobrir o regex `\d{47}` com testes de fronteira (46, 48, letra, espaço, Unicode)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1h)
**Findings**: F-testability-5

**Problema**
> O boundary da linha digitável (`LINHA_DIGITAVEL_SCHEMA` em `ConexosSispagWriteClient.ts:80-90`) tem 1 caso ad-hoc de rejeição (3 dígitos). Faltam as fronteiras (46, 48), o caso "47 posições com uma letra no meio", "47 com espaço", e o caso Unicode (`\d` do JS regex aceita `٠` — 0 arábico). O comportamento é correto (rejeita + omite), mas a cobertura é rasa.

**Melhoria Proposta**
> Adicionar 5 casos parametrizados via `it.each` cobrindo cada fronteira. Não requer dep nova — `fast-check` não é dep direta neste repo (só transitiva), e `it.each` do Jest é suficiente. Tactic Bass: **Executable Assertions** (versão parametrizada).

**Resultado Esperado**
> `# classes de input relevantes cobertas / total = 1/5 -> 5/5`; regressão do regex é pega no CI.

**Métricas de sucesso**
- Casos parametrizados sobre `\d{47}`: 1 -> 5

**Risco de não fazer**
> Baixo — o próximo bug do regex passa por baixo, mas o modo de falha é "botão ausente", não "pagamento errado".

**Dependências**: Nenhuma

---

### [modifiability-3] Extrair `pageSize` para constante nomeada (ou parâmetro) em `listarLinhasDigitaveisDoLote`

**QA**: Modifiability
**Tactic alvo**: Defer Binding (configuration)
**Esforço**: S (≤1d)
**Findings**: F-modifiability-3

**Problema**
> `pageSize: 500` está hardcoded no método novo. O método vizinho no MESMO arquivo (`listarTitulosPendentes`) documenta esse valor específico como defeito corrigido pela paginação de verdade. O delta reintroduz o antipadrão em código novo.

**Melhoria Proposta**
> Extrair constante `FIN015_LINHAS_PAGE_SIZE = 500` no topo do arquivo (colocada com o cabeçalho, ao lado dos schemas Zod já nomeados), com comentário justificando: "cap defensivo — lote com >500 itens é anômalo; se ocorrer, log de aviso". Alternativa mais robusta: chamar `listGenericPaginated` em modo paginado real (como faz `listarTitulosPendentes`) — custo maior, benefício raro. Recomendo constante nomeada + log de aviso quando `page.rows.length === 500`. Tactic: **Defer Binding**.

**Resultado Esperado**
> 0 magic numbers no arquivo tocado. Log dispara se o cap for atingido (evento observável antes do bug de "faltou linha na tela").

**Métricas de sucesso**
- Magic numbers no arquivo tocado: 1 -> 0
- Observabilidade quando o cap saturar: 0 -> 1 log de warn

**Risco de não fazer**
> Baixo em produção hoje, mas a próxima leitura do arquivo vai ler "a versão anterior pedia pageSize: 500" 20 linhas antes de um `pageSize: 500` novo — a ergonomia de manutenção despenca.

**Dependências**: Nenhuma

---

### [modifiability-4] Extrair `useSispagAsyncMap` para consolidar o padrão "expand -> fetch -> set map" em `LoteCard.tsx`

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-modifiability-4

**Problema**
> O bloco novo `[linhas, setLinhas]` + `useEffect(fetch -> setState(new Map(items.map(...))))` reproduz literalmente o padrão do bloco `[contas, setContas]` 30 linhas acima. LoteCard passou de 503 -> 557 LOC. A próxima coluna que precisar de fetch condicional à expansão vai repetir a mesma forma.

**Melhoria Proposta**
> Criar `src/frontend/app/sispag/hooks/useSispagAsyncMap.ts` com assinatura `useSispagAsyncMap<V>({ loteId, enabled, fetcher, key }): Map<string, V>`. Refatorar os 2 blocos existentes (contas pagadoras + linhas digitáveis). O hook encapsula o `let vivo = true`, o `catch -> setState vazio`, e a construção do Map. Tactic: **Abstract Common Services + Refactor**.

**Resultado Esperado**
> `LoteCard.tsx` cai ~40 LOC. Próximo fetch condicional na expansão custa 3 linhas em vez de 20.

**Métricas de sucesso**
- LOC de `LoteCard.tsx`: 557 -> ~517
- Blocos duplicados `useEffect + Map` na expansão: 2 -> 0 (substituídos por 2 chamadas ao hook)

**Risco de não fazer**
> O card vai passar a barreira de 600 LOC na próxima adição de coluna (previsível: `bncCod` do boleto, ou "valor confirmado pelo banco no retorno" — ambos já no radar).

**Dependências**: [modifiability-1] pode acontecer antes ou depois. Independentes.

---

### [modifiability-5] Registrar débito de coesão do `SispagPainelService` para o próximo `/retro-ontology`

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: S (só o registro; o split em si é M-L, escopo do próximo retro)
**Findings**: F-modifiability-5

**Problema**
> `SispagPainelService` tem 12 `@inject` (4 clientes Conexos + 5 repositórios + 3 libs) e 5 métodos públicos, cada um tocando subconjunto disjunto das dependências. É o padrão "God Service" começando. O delta adiciona 1 dep e 1 método — sozinho não justifica split, mas alimenta a curva.

**Melhoria Proposta**
> Não fazer nada no escopo desta feature. Registrar no `ontology/_inbox/copiar-barcode-item-lote-regis-followups.md` para que o próximo `/retro-ontology` decida se: (a) `SispagPainelService` vira `SispagPainelReadService` (`montarPainel`, `listRetornos`) + `SispagLoteDetalheService` (`linhasDigitaveisDoLote`, `modalidadesDisponiveisDoLote`), OU (b) as leituras de detalhe do lote migram para um `LoteSispagQueryService` novo. Tactic: **Split Module + Increase Semantic Coherence**.

**Resultado Esperado**
> Débito visível no inbox. Não vai apodrecer no dark side: o `/retro-ontology` semanal vai revisitar.

**Métricas de sucesso**
- Item no `_inbox/` referenciando o serviço: 0 -> 1
- Decisão registrada em `/retro-ontology` sobre split vs. status quo: 0 -> 1

**Risco de não fazer**
> Acumulação silenciosa. Os próximos 3 tweaks do painel vão empurrar `SispagPainelService` para 15+ deps sem gatilho de revisão.

**Dependências**: Nenhuma

---

### [integrability-4] Consolidar as duas leituras do grid `fin015/finItemSispag/list`

**QA**: Integrability
**Tactic alvo**: Abstract Common Services (Bass — Limit Dependencies)
**Esforço**: S (≤1d) — refactor com testes já existentes cobrindo as duas superfícies
**Findings**: F-integrability-3

**Problema**
> Dois métodos do `ConexosSispagWriteClient` (`:363` e `:408`) leem o mesmo endpoint com o mesmo paginado e projetam shapes distintos. ~25 linhas quase idênticas de `try/catch`+`runWithRetry`+`ensureSid` em cada um. Bass "Abstract Common Services" não realizado — a próxima leitura desse grid duplica ainda mais.

**Melhoria Proposta**
> Extrair um `private listarItensDoLote(params): Promise<Row[]>` (ou tornar público se o serviço precisar) que faz a chamada + `runWithRetry`. Reescrever `listarChavesDoLote` e `listarLinhasDigitaveisDoLote` como projeções sobre esse método — cada uma vira meia-dúzia de linhas. Tactic Bass: Abstract Common Services. Bônus: o Zod schema fica no shape de `Row`, e cada projeção vira uma leitura tipada dele (não uma re-validação do payload cru).

**Resultado Esperado**
> 1 função com `retry`/`ensureSid`/`try/catch` em vez de 2. Um terceiro consumidor do grid (ex.: futura conciliação com o retorno) adiciona só uma projeção. Reduz risco de as duas leituras divergirem em paginação ou tratamento de erro.

**Métricas de sucesso**
- Linhas duplicadas entre `listarChavesDoLote` e `listarLinhasDigitaveisDoLote`: ~25 -> 0
- Sites tocando `runWithRetry`+`ensureSid` do fin015 no cliente: 2 -> 1

**Risco de não fazer**
> Baixo enquanto forem só 2 consumidores. Sobe se aparecerem 3+; começa a ser real quando alguém precisar mudar paginação ou política de retry só de um lado e esquecer o outro.

**Dependências**: Nenhuma; pode ficar para próximo `/feature-tweak` que tocar `RemessaService` ou `SispagPainelService`.

---

### [deployability-1] Documentar (ou automatizar) a ordem FE->BE no deploy, ou aceitar formalmente a mitigação por catch silencioso

**QA**: Deployability
**Tactic alvo**: Scale Rollouts (contrato explícito) / Deployment observability (smoke pós-deploy)
**Esforço**: S (≤1d — 1 seção em `DEPLOY.md` + eventualmente 1 step no CI)
**Findings**: F-deployability-1

**Problema**
> `push main` dispara `autoDeploy` do Render e da Vercel em paralelo, sem contrato de ordem. Para este delta, se o FE terminar antes do BE, o botão "copiar linha digitável" aparece atrasado (fetch cai em `catch -> setLinhas(new Map())`, sem crash). É invisível ao usuário — mas o padrão de sofrimento se replica em toda feature aditiva do repo, e não está documentado como decisão consciente.

**Melhoria Proposta**
> Adicionar uma nota curta em `DEPLOY.md` seção "Ordem de deploy" descrevendo: (a) Render e Vercel deployam em paralelo do mesmo commit; (b) FE consumindo rota nova do BE deve tolerar 404/500 com fallback silencioso (padrão já usado em `LoteCard.tsx:163-174`); (c) rotas do BE que passam a exigir header/campo novo antes do FE enviarem precisam de dupla vida (aceitar ambos os formatos por 1 release). Alternativa mais forte (não obrigatória neste delta): adicionar um `smoke-test` step no CI pós-deploy que faz `curl` na rota nova antes de promover o FE.

**Resultado Esperado**
> Cada dev sabe, antes de abrir PR, que precisa desenhar o consumo FE tolerante ao BE anterior. Zero janelas visíveis de inconsistência FE->BE. Métrica: `#/PRs com rota nova` × `#/PRs com fallback FE documentado`.

**Métricas de sucesso**
- Janela FE->BE documentada em `DEPLOY.md`: ausente -> presente
- PRs futuros com rota nova mencionam fallback do consumidor no corpo: 0% -> 100%

**Risco de não fazer**
> A mitigação continuará implícita; próxima feature esquecerá do `.catch()` e a janela de deploy vira um bug intermitente ("tela em branco após deploy"). Sem documentação, é debug de horas.

**Dependências**: Nenhuma

---

### [performance-4] Persistir `itsNumCodbar` na ingestão (o mesmo padrão que `tem_boleto` já usa)

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Data
**Esforço**: M
**Findings**: F-performance-4

**Problema**
> `linhasDigitaveisDoLote` faz round-trip ao Conexos para um dado que o ERP JÁ escreveu no import da remessa e não muda depois. Cem linhas abaixo, `modalidadesDisponiveisDoLote` deliberadamente rejeita esse caminho para o flag `tem_boleto`: *"refazer o grid de pendentes aqui custava +7 requisições Conexos por abertura de lote na filial 2, para chegar à mesma resposta."* — este novo endpoint volta a pagar esse custo.

**Melhoria Proposta**
> Estender `IngestaoPagamentosService` (ou o passo do `RemessaService` que confirma a remessa) para gravar `itsNumCodbar` em coluna nova de `sispag_lote_item` (ou `titulo`, dependendo do modelo — checar com o Ontology Curator). Rota passa a ler do Postgres local; ERP só é consultado se a coluna estiver vazia (backfill lazy). Bass: **Maintain Multiple Copies of Data**.
>
> Arquivos: nova migration em `src/backend/migrations/`; `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (coluna nova + getter); `src/backend/domain/service/sispag/RemessaService.ts` (gravar no ledger da remessa); `SispagPainelService.linhasDigitaveisDoLote` (ler local antes do fallback ERP).

**Resultado Esperado**
> Botão de copiar linha digitável passa a ser 100% servido do Postgres local depois da 1ª remessa. Métrica: chamadas ao Conexos por expansão de card não-rascunho: 1 -> 0 (com fallback ao ERP só se coluna vazia).

**Métricas de sucesso**
- Chamadas ao Conexos no caminho quente: 1/expansão -> 0/expansão (steady state)
- Latência p95 do endpoint: rede+ERP (~1-3s) -> SQL local (~50ms)

**Risco de não fazer**
> Divergência arquitetural com `tem_boleto`; a mesma pressão que aquele padrão foi criado para aliviar volta pela porta ao lado. Não urgente, mas a decisão contrária foi tomada explicitamente 100 linhas acima do código novo — vale registrar coerência.

**Dependências**: Coordenar com Ontology Curator (nova coluna -> diff de ontologia); depende de aceitar que o backfill de lotes já finalizados fica lazy.

---
