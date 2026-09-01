---
type: regis-review-report
run_id: 2026-09-01-1944-copiar-barcode-item-lote
generated_at: 2026-09-01T19:52:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: delta da feature `copiar-barcode-item-lote` (--quick); 9 arquivos, +396/-6
total_cards: 31
total_p0: 0
total_p1: 7
total_p2: 15
total_p3: 9
overall_score: 7.0
---

# Regis-Review — financeiro — 2026-09-01-1944-copiar-barcode-item-lote

## 1. Executive scorecard

**Pesos aplicados** (multi-tenant SaaSo que executa escritas que movem dinheiro — permuta/baixa no Conexos, remessa SISPAG via Nexxera, upload no GED; a feature em revisão é 100% leitura, mas o dado exposto é *destino de pagamento*):
Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 · Performance 1.0 · Integrability 0.9 · Deployability 0.9. Total weight = 9.0.

**Gate**: `--quick` verde — **0 P0 em todos os 8 QAs**. A feature entra em `main`; os P1/P2/P3 abaixo vão para `ontology/_inbox/copiar-barcode-item-lote-followups.md` (onde já estão registrados 2 P1 remediados nesta branch: guard `requireRole('admin')` do PatternGuardian e tooltip 187 → 68 chars do DesignSystemReviewer).

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7 | 0 | 0 | 3 | 2 | F-availability-1: fallback silencioso apaga a diferença "sem boleto" vs "Conexos fora" |
| Deployability | 8 | 0 | 0 | 1 | 1 | F-deployability-2: rota que expõe destino de pagamento sem kill-switch por env (MTTR de isolamento ~5min vs ≤30s dos outros 7 kill-switches do SISPAG) |
| Integrability | 8 | 0 | 1 | 2 | 1 | F-integrability-1: `itsNumCodbar` fora do `contrato.test.ts` — rename do ERP passa verde no CI |
| Modifiability | 7 | 0 | 0 | 2 | 3 | F-modifiability-1: DTO `{docCod;titCod;linhaDigitavel}` inline em 5 pontos de 3 arquivos |
| Performance | 6 | 0 | 1 | 2 | 1 | F-performance-1: `pageSize:500,pageNumber:1` sem loop — mesmo antipadrão do ADR-0040 (cap medido em prod: 41 itens; sobe para P0 só se crescer >500) |
| Fault Tolerance | 7 | 0 | 2 | 2 | 0 | F-fault-tolerance-3: regex `/^\d{47}$/` valida FORMATO, não DV — leitura assimétrica à escrita (`RemessaCnabValidator` valida 44/44 e já pegou defeito real em `PG121101.REM`) |
| Security | 7 | 0 | 1 | 2 | 0 | F-security-1: interceptor axios (`services/conexos.ts:145-152`) loga body de erro cru, sem `itsNumCodbar` em `SENSITIVE_KEYS` — vaza 47 dígitos no stdout do Render |
| Testability | 6 | 0 | 2 | 1 | 1 | F-testability-1: `LoteCard.tsx` +62 LOC (state + 3 `useEffect` + handler `copiarLinha`) sem NENHUM teste |
| **Overall** | **7.0** | **0** | **7** | **15** | **9** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais **← estado atual**
- 9–10: estado-da-arte para o estágio atual

**Leitura do placar**: o delta é competente. As camadas DDD estão respeitadas, o guard de RBAC entrou por default, o Zod bate no boundary sem coerção (honra ADR-0040), o serviço documenta "nunca lança" e o comportamento está coberto por teste. As notas mais baixas (Performance 6, Testability 6) refletem antipadrões específicos (paginação fixa; frontend sem teste), não erosão de arquitetura.

## 2. Top 10 risks (cross-QA)

Ranking por composto severidade × impacto de negócio × leverage (quanto uma correção pequena mata múltiplos QAs).

### R-1: Regex de linha digitável valida formato, não DV — pagamento errado é fisicamente possível

- **QA(s) afetados**: Fault Tolerance, Integrability, Security (indireto — integridade do dado exibido)
- **Findings de origem**: F-fault-tolerance-3 (`ConexosSispagWriteClient.ts:83`)
- **Evidência sintetizada**: linha digitável tem 4 DVs próprios (três módulo-10 + um módulo-11) e nenhum é verificado. O simétrico da escrita (`RemessaCnabValidator.dvBarrasValido`, `src/backend/domain/libs/cnab/RemessaCnabValidator.ts:74-88`) valida 100% dos 44 dígitos do código de barras — e essa checagem **já pegou DV inválido num arquivo real enviado ao banco** (`PG121101.REM`, filial 2, R$ 37.567,14). A hipótese "o ERP não erra `itsNumCodbar`" é a mesma que já foi refutada uma vez, no fluxo espelho, no mesmo repo.
- **Impacto técnico**: um `itsNumCodbar` degradado passa o `/^\d{47}$/`, cruza o service (que não valida), chega ao clipboard e é colado no app do banco pela analista.
- **Impacto de negócio**: dinheiro na conta errada. A defesa "o banco recusa DV errado" transfere responsabilidade — o banco recusa depois de ter recebido, e a analista já sinalizou "pago" mentalmente. Cadeia humana-no-loop atenua, não elimina.
- **Card(s) Kanban relacionados**: fault-tolerance-3
- **Custo de inação em 6 meses**: 1 incidente esperado ao ano ao ritmo empírico do repo (o defeito de DV do `PG121101.REM` foi 1 em ~61 remessas históricas). Cada incidente = reversão manual + relacionamento com o cedente errado + análise forense. Premissa: incidência de degradação no `itsNumCodbar` é da mesma ordem que no `ditEspCodbar`.

### R-2: Interceptor axios loga body de erro sem redação — `itsNumCodbar` vai ao stdout do Render toda vez que o Conexos oscila

- **QA(s) afetados**: Security, Availability (o mesmo canal de log é o único sinal de degradação)
- **Findings de origem**: F-security-1 (`src/backend/services/conexos.ts:145-152`, `SENSITIVE_KEYS` em `:20-30`)
- **Evidência sintetizada**: o teste de anti-vazamento existe no SERVICE (`SispagPainelService.test.ts:449-457`) mas é derrotado uma camada abaixo: `redactSensitive` só cobre credenciais (`password/token/sid/…`), `itsNumCodbar` não está na lista, e o interceptor faz `console.error('[CONEXOS ✗] body=${JSON.stringify(body)}')` cru no ramo de erro. Basta uma resposta 5xx do `fin015/finItemSispag/list` com `rows` no envelope (comportamento observado do ERP) para vazar toda a página.
- **Impacto técnico**: o guard `requireRole('admin')` fecha a porta da frente; o log abre a porta lateral. Qualquer engenheiro com acesso à aplicação Render lê a carteira.
- **Impacto de negócio**: LGPD Art. 6º + sigilo bancário (LC 105). O stream de log é canal de terceiros (Render) — trust boundary distinto do ERP e do banco.
- **Card(s) Kanban relacionados**: security-1
- **Custo de inação em 6 meses**: 1 janela de oscilação do Conexos por trimestre (base: `BUSINESS_WARN` estimado por probes históricos) × N logs vazados por janela. Materializa o vazamento sem esforço do atacante.

### R-3: Contract test do `fin015-item-lote` não guarda `itsNumCodbar` — rename do ERP passa verde no CI

- **QA(s) afetados**: Integrability, Testability, Availability (o único gate contra silêncio prolongado)
- **Findings de origem**: F-integrability-1, F-testability-2 (`contrato.test.ts:97-103`)
- **Evidência sintetizada**: dois agentes convergiram independentemente. A fixture `2026-08-25-fin015-item-lote.json:18` **já contém** `itsNumCodbar`; o campo só não está no array `campos` de `CONTRATOS`. Se o Conexos renomear, o `LINHA_DIGITAVEL_SCHEMA.safeParse` reprova cada linha, o cliente devolve `[]` **sem passar pelo catch** (não há erro, só schema-fail), o service devolve `[]` sem emitir `BUSINESS_WARN`, e a UI apenas para de mostrar o botão. Zero teste falha. Correção: uma linha.
- **Impacto técnico**: silêncio operacional indefinido — descoberto por reclamação humana.
- **Impacto de negócio**: baixa criticidade nesta feature (conveniência), mas o mesmo grid alimenta `listarChavesDoLote` (retomada de import parcial), que interfere na geração de remessa. Cada dia de silêncio é um dia sem gatilho para investigar o que mais mudou.
- **Card(s) Kanban relacionados**: integrability-1, testability-2
- **Custo de inação em 6 meses**: probabilidade histórica de rename no `fin*` do Conexos ≈ 1/ano (a família `its*` já mudou de nome 2× segundo `contrato.test.ts:65-70`). Um evento = semanas de "botão sumiu" até virar chamado.

### R-4: `pageSize: 500` sem paginar — reintrodução do antipadrão do ADR-0040

- **QA(s) afetados**: Performance, Modifiability, Availability (mesmo desenho de silêncio que R-3)
- **Findings de origem**: F-performance-1, F-modifiability-3 (`ConexosSispagWriteClient.ts:373-374`)
- **Evidência sintetizada**: o método vizinho `listarTitulosPendentes` (60 linhas abaixo, mesmo arquivo) **documenta esse valor específico como defeito corrigido** — a versão anterior fixava `pageNumber:1` e mostrava 24,7% do grid na filial 2 (~2020 pendentes). O delta reintroduz o padrão. **Medição nova em 2026-09-01**: varredura de produção mostrou **31 lotes nativos nas 5 filiais, maior lote = 41 itens** — o cap de 500 tem folga confortável **hoje**. O risco é de crescimento futuro, não atual; por isso permanece P1, não sobe para P0. Registrado aqui para que ninguém precise re-medir.
- **Impacto técnico**: se algum tenant crescer >500 itens/lote, os itens do 501º em diante somem em silêncio (o `count` devolvido pelo grid é descartado — F-performance-3), e o modo de falha é indistinguível de "não é DDA".
- **Impacto de negócio**: nulo hoje; volta a valer se a operação escalar (novos clientes, fusão de filiais, mudança de política de agrupamento).
- **Card(s) Kanban relacionados**: performance-1, performance-3, modifiability-3
- **Custo de inação em 6 meses**: baixo, condicionado a não haver crescimento. Se houver, repete o trabalho da sondagem que produziu o ADR-0040 (dias de investigação).

### R-5: Frontend sem teste — a promessa central da feature é verificada só por olho

- **QA(s) afetados**: Testability, Fault Tolerance (regra "toast não repete 47 dígitos" existe no BE, sem gêmea no FE)
- **Findings de origem**: F-testability-1 (`src/frontend/app/sispag/components/LoteCard.tsx` +62 LOC, 0 test)
- **Evidência sintetizada**: `find src/frontend/app/sispag -name '*.test.*'` = vazio. O `LoteCard` cresceu 62 LOC (3 blocos `useState` + 3 `useEffect` de fetch + handler `copiarLinha` que usa `navigator.clipboard`). Bug clássico: `writeText` falha silenciosamente, `toast` diz "copiado", analista cola o conteúdo do clipboard anterior. Pior que erro visível.
- **Impacto técnico**: qualquer refactor do handler (`try/await` → `.then`, ou mover fetch para o click) passa verde no `npm test`.
- **Impacto de negócio**: sob falha do clipboard, analista paga o boleto do lote anterior sem perceber.
- **Card(s) Kanban relacionados**: testability-1
- **Custo de inação em 6 meses**: 1 refactor do `LoteCard` por trimestre é a taxa observada nos últimos 10 commits. Sem teste, cada refactor é aposta cega.

### R-6: `safeParse` falho descarta linhas em silêncio — `[]` do parse é igual a `[]` legítimo

- **QA(s) afetados**: Fault Tolerance, Integrability, Availability
- **Findings de origem**: F-fault-tolerance-2, F-integrability-4 (`ConexosSispagWriteClient.ts:426-429`)
- **Evidência sintetizada**: o loop faz `continue` silencioso quando o `safeParse` falha. Como o cliente não lança, o service não entra no `catch`, o `BUSINESS_WARN` não é emitido. Lote com 5 boletos degradados = mesmo símbolo que lote sem boleto. É a classe de defeito da ADR-0040 (silêncio) reintroduzida num flanco novo, com uma cara diferente (`continue` em vez de `?? ''`). Já mitigado parcialmente por R-3 (contract test), mas entre uma captura e outra o silêncio persiste.
- **Impacto técnico**: F-integrability-1 + F-fault-tolerance-2 têm a mesma raiz — falta contador de descartados.
- **Impacto de negócio**: baixo enquanto for essa feature; alto se o padrão for propagado a leituras com efeito monetário direto.
- **Card(s) Kanban relacionados**: fault-tolerance-2, integrability-3
- **Custo de inação em 6 meses**: cada nova leitura que copiar o padrão herda a mesma cegueira. 3–4 leituras esperadas nos próximos 6 meses (frente Recebimentos).

### R-7: Rota expõe destino de pagamento sem kill-switch por env — MTTR de isolamento ~5min vs ≤30s dos outros 7 kill-switches do SISPAG

- **QA(s) afetados**: Deployability, Security
- **Findings de origem**: F-deployability-2 (`src/backend/routes/sispag.ts:60-73`)
- **Evidência sintetizada**: `SISPAG_LIVE_WRITE_ENABLED`, `SISPAG_DDA_ASSOC_ENABLED`, `RECEBIMENTOS_ENABLED` — o padrão está vivo no repo (7 kill-switches ativos). A rota nova não adotou. Se um incidente for detectado (log acidental do valor, credencial admin comprometida, DoS via 500 itens/chamada), única forma de derrubar é revert + redeploy no Render (~5min no plano starter). Um `sync:false` no dashboard cortaria em ≤30s.
- **Impacto técnico**: MTTR de isolamento 10x pior que o padrão adotado no resto do SISPAG.
- **Impacto de negócio**: janela de vazamento LGPD/LC 105 medida em minutos em vez de segundos, para uma rota que o próprio código-fonte classifica como sensível.
- **Card(s) Kanban relacionados**: deployability-2
- **Custo de inação em 6 meses**: 1 incidente qualquer (log estrutural mudou; analista compartilhou cURL no Slack) obriga hotfix + release + deploy.

### R-8: Sem trilha de auditoria persistida — forense de vazamento LGPD depende de log efêmero do Render

- **QA(s) afetados**: Security, Fault Tolerance (audit trail)
- **Findings de origem**: F-security-3 (aplica-se também à rota `.REM` — mesma dívida)
- **Evidência sintetizada**: `grep -rn "auditLog\|AuditRepository\|audit_events" src/backend/` = vazio para SISPAG. Uma auditoria LGPD Art. 37 não distingue "1 consulta legítima" de "42 consultas em 5 minutos" pelo mesmo admin.
- **Impacto técnico**: forense parte de `console.log` efêmero do Render.
- **Impacto de negócio**: incidente reportado 30 dias depois não é rastreável.
- **Card(s) Kanban relacionados**: security-3
- **Custo de inação em 6 meses**: sem trilha, um único incidente exige investigação manual longa e explicação regulatória frágil.

### R-9: Rate-limit da rota é `globalLimiter` (100/min) em vez de `heavyRouteLimiter` (10/min) — enumeração da carteira em minutos

- **QA(s) afetados**: Security, Performance (o mesmo teto pressiona o pool `LOGIN_ERROR_MAX_SESSIONS` do Conexos)
- **Findings de origem**: F-security-2 (contraste com `sispag.ts:341,361,427,484`)
- **Evidência sintetizada**: as demais rotas SISPAG com fan-out ao Conexos já usam `heavyRouteLimiter`. Sob 100/min por IP, um admin (ou token roubado) enumera 100 lotes em 60s — a carteira inteira em uma janela.
- **Impacto técnico**: componente lento sem defesa; conjuga-se com R-8 (sem audit = sem base para alarme).
- **Impacto de negócio**: perfila-se com R-2 (vazamento por log) — quando um deles dispara, a taxa acelera o dano.
- **Card(s) Kanban relacionados**: security-2
- **Custo de inação em 6 meses**: baixo probabilisticamente, alto por evento — o mesmo defeito já foi corrigido em 4 outras rotas do SISPAG, esta ficou de fora.

### R-10: `SispagPainelService` chegou a 12 dependências injetadas — sinal de "God Service"

- **QA(s) afetados**: Modifiability, Testability
- **Findings de origem**: F-modifiability-5, F-modifiability-2 (`ConexosSispagWriteClient` também mal-nomeado)
- **Evidência sintetizada**: 4 clientes Conexos + 5 repositórios + 3 libs = 12 `@inject`; 5 métodos públicos, cada um tocando subconjunto disjunto. O delta adiciona +1 dep e +1 método. Regra de bolso ≤10; passamos. Cross-cutting: `SispagPainelService` (read-only) agora depende de um symbol chamado `ConexosSispagWriteClient` (do qual 8/13 métodos são leitura). Mentira do nome amplifica o custo cognitivo.
- **Impacto técnico**: teste em isolamento fica caro (12 mocks); próxima `/feature-tweak` no painel paga.
- **Impacto de negócio**: nenhum imediato. Sinal amarelo para `/retro-ontology`.
- **Card(s) Kanban relacionados**: modifiability-2, modifiability-5
- **Custo de inação em 6 meses**: sem split, o serviço vira 15+ deps nos próximos 2–3 tweaks previsíveis do painel.

## 3. Cross-cutting findings

Pontos onde a mesma causa-raiz aparece em múltiplos QAs.

### CC-1: Silêncio no lugar de sinal — a cadeia protege contra dado errado, mas mal contra dado ausente

- **Aparece em**: Availability, Integrability, Fault Tolerance
- **Findings**: F-availability-1 (fallback silencioso), F-integrability-4 (schema-fail sem log), F-fault-tolerance-1 (doutrina truncada no FE), F-fault-tolerance-2 (drop sem contador)
- **Diagnóstico unificado**: o desenho está correto no client (throw `ConexosError`) e no service (`try/catch → [] + BUSINESS_WARN`). O que falta é (a) o cliente contar linhas descartadas pelo `safeParse` — hoje `continue` silencioso significa que se o Conexos renomear `itsNumCodbar`, nenhuma exceção é lançada, nenhum `BUSINESS_WARN` é emitido; e (b) a UI distinguir "lote sem boleto" de "leitura degradou" para a analista. Três agentes independentes convergiram no mesmo sintoma — o padrão está bem definido, só falta instrumentar.
- **Recomendação consolidada**: **fault-tolerance-2** (contar `dropped` no client + logar quando >0) resolve o gap de observabilidade backend; **availability-1** (marcar `degraded:boolean` no payload) resolve o gap de UX. Juntos, com esforço S+S, endereçam 4 findings de 3 QAs. Prioridade máxima entre os cross-cutting.

### CC-2: Assimetria escrita vs leitura no tratamento do payload do ERP

- **Aparece em**: Fault Tolerance, Integrability, Security
- **Findings**: F-fault-tolerance-3 (DV não validado na leitura), F-integrability-2 (fixture não exercita shape do `itsNumCodbar`), F-security-1 (interceptor não redige `itsNumCodbar` porque nem sabe que existe)
- **Diagnóstico unificado**: o mesmo campo (`itsNumCodbar`) tem tratamento discrepante entre saída e entrada. Na saída (escrita da remessa), o `RemessaCnabValidator` valida DV de 44/44 dígitos e a fixture exercita shape. Na entrada (leitura para o botão), só validamos formato de 47 dígitos, não exercitamos shape do fixture, e o interceptor de logs nem reconhece o campo como sensível. É a mesma família de defeito que produziu o ADR-0040 no ano passado: "o ERP não deveria errar, mas erra".
- **Recomendação consolidada**: **fault-tolerance-3** (adicionar `linhaDigitavelDvValida` em `src/backend/domain/libs/cnab/`, ao lado do `RemessaCnabValidator`), + **security-1** (adicionar `itsNumCodbar` e família a `SENSITIVE_KEYS`), + **integrability-2** (marcar shape do fixture). Três cards S/M que fecham a assimetria em um único push arquitetural: "todo tratamento de campo bancário passa pelas mesmas 3 defesas — DV, redação, shape — independente da direção".

### CC-3: Uma única linha de código no `contrato.test.ts` é o gatilho mais barato do repo

- **Aparece em**: Integrability, Testability, Availability
- **Findings**: F-integrability-1, F-testability-2, referenciado em F-availability-3
- **Diagnóstico unificado**: o mecanismo de defesa contra rename do ERP já existe (`contrato.test.ts`), a fixture já contém o campo (`2026-08-25-fin015-item-lote.json:18`), o código lê o campo (`ConexosSispagWriteClient.ts:431`). O único elo faltante é uma string na lista `campos` de `CONTRATOS`. Dois agentes acharam isso independentemente porque é gritante.
- **Recomendação consolidada**: **integrability-1 / testability-2** (mesmo card, listar em ambos) — cabe em 15 min. Deveria estar entre os primeiros commits pós-review.

### CC-4: Duplicação de pattern no `LoteCard.tsx` e no `ConexosSispagWriteClient.ts`

- **Aparece em**: Modifiability, Integrability, Testability
- **Findings**: F-modifiability-1 (DTO inline 5×), F-modifiability-4 (padrão `useEffect + Map` 2×), F-modifiability-2 (client mal-nomeado), F-integrability-3 (leitura duplicada do mesmo grid)
- **Diagnóstico unificado**: a feature construiu o vertical com clareza, mas não colheu os pattern reutilizáveis que aparecem duas vezes lado a lado — `useSispagAsyncMap` no frontend (dois blocos idênticos: contas pagadoras + linhas digitáveis) e `listarItensDoLote(): Row[]` no client (dois métodos idênticos: `listarChavesDoLote` e `listarLinhasDigitaveisDoLote`). Nada é P1, mas soma custo cognitivo linear a cada nova feature de painel.
- **Recomendação consolidada**: **modifiability-1** (DTO nomeado) + **modifiability-4** (`useSispagAsyncMap`) + **integrability-4** (extrair `listarItensDoLote`). Três cards S. Combinados, cortam ~50 LOC por feature futura de painel e eliminam a próxima divergência entre paginação/retry.

### CC-5: Observabilidade só existe como log de texto sem métrica agregada

- **Aparece em**: Availability, Deployability, Security, Fault Tolerance
- **Findings**: F-availability-3 (sem alarme sobre `BUSINESS_WARN`), F-security-3 (sem audit trail), F-deployability-2 (sem kill-switch), F-fault-tolerance-2 (sem contador de dropped)
- **Diagnóstico unificado**: o repo vive em Render/Vercel sem CloudWatch/agregador. Cada agente encontrou um sintoma da mesma limitação estrutural: para saber que algo aconteceu, alguém precisa fazer `grep` manual. O delta em revisão herdou essa limitação — não a criou — mas amplifica o custo, porque a rota expõe destino de pagamento.
- **Recomendação consolidada**: cards deste run (availability-3, security-3, fault-tolerance-2) estabelecem os *primeiros pontos de dados estruturados* (contador de fallback, contador de dropped, audit table). São peças de um mosaico maior — deveriam ser tocados como bloco e não isoladamente, para produzir a primeira métrica agregada com sentido.

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S e severidade ≥ P2, alta razão impacto/esforço:

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| integrability-1 | Integrability | S (≤15 min) | P1 | 5/6 → 6/6 campos declarados no contrato; rename do ERP passa a quebrar CI |
| testability-2 | Testability | S (≤1h) | P1 | mesmo escopo do anterior — o mesmo card, listado em dois QAs por convergência dos agentes |
| security-1 | Security | S (≤1d) | P1 | `itsNumCodbar` entra em `SENSITIVE_KEYS`; interceptor redige também no ramo de resposta; teste unit que injeta 47 dígitos em `err.response.data` e assere que não aparece no log |
| fault-tolerance-2 | Fault Tolerance | S (≤1d) | P1 | contador `dropped` no client; log `BUSINESS_WARN` quando `dropped > 0`; teste com 5 rows / 2 malformadas |
| fault-tolerance-3 | Fault Tolerance | S (≤1d) | P1 | `linhaDigitavelDvValida` em `src/backend/domain/libs/cnab/`; encadeado no `LINHA_DIGITAVEL_SCHEMA.refine()`; testes com linhas reais e com 1 dígito trocado |
| performance-1 | Performance | S | P1 | `listGenericPaginated` com loop real + `chavesDesejadas` para parar cedo; WARN quando `count > rows.length`; risco de truncamento silencioso 100% → 0% |
| performance-3 | Performance | S | P2 | ler `page.count` e emitir warn estruturado quando corta; MTTD do truncamento ∞ → segundos |
| testability-1 | Testability | S | P1 | 3 testes no `LoteCard`: happy path (toast sem 47 dígitos), `writeText` reject (sem crash), `fetchLinhasDigitaveis` reject (botão não renderiza) |
| availability-2 | Availability | S (≤0.5d) | P2 | preservar 4 campos do `ConexosError` (`code`, `statusCode`, `endpoint`, `retryable`) no `BUSINESS_WARN` |
| deployability-2 | Deployability | S (≤1d) | P2 | `SISPAG_COPIAR_LINHA_DIGITAVEL_ENABLED` no `render.yaml` (`sync:false`); MTTR de isolamento ~5min → ≤30s |
| security-2 | Security | S (≤1d) | P2 | `heavyRouteLimiter` na rota nova E na `.REM`; teto de exfiltração 100/min → 10/min |
| modifiability-1 | Modifiability | S (≤1d) | P2 | `LinhaDigitavelItem` extraído; 5 ocorrências inline → 0 |
| modifiability-2 | Modifiability | S (≤1d) | P2 | rename `ConexosSispagWriteClient` → `ConexosFin015Client`; para de mentir sobre a natureza dos 8 métodos read |
| availability-1 | Availability | S (≤1d) | P2 | `{itens, degraded, reason}` no payload; UI distingue "sem boleto" de "erro"; 0% → 100% de discernibilidade |
| availability-3 | Availability | S (≤1d) | P2 | contador `sispag.linhas_digitaveis.fallback` + alarme por taxa; MTTD "chamado" → ≤15min |
| integrability-3 | Integrability | S (≤1d) | P2 | warn quando `safeParse` derruba TODAS as linhas; 0 → 1 evento estruturado por ocorrência |
| fault-tolerance-4 | Fault Tolerance | S (≤1d) | P2 | invariante `status ≥ REMESSA_GERADA ⇒ native* != null` monitorada; 0 → 1 sinal quando quebra |

**Nota**: 17 cards S+P>=2 é muito para uma sprint. A leitura defensiva é: os 6 primeiros (todos P1) formam a fatia obrigatória — 6 cards S para eliminar 7 findings P1 de 5 QAs. O resto entra em ordem por CC (CC-1, CC-2, CC-4 pegam grupos coesos).

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| integrability-2 | Integrability | M (2–5d) | Contract testing (facet moderna) | O contract test hoje pega ausência de chave, não muda de shape. Se o Conexos passar a mandar 44 dígitos em vez de 47 no mesmo campo, o `LINHA_DIGITAVEL_SCHEMA.regex(/^\d{47}$/)` reprova tudo em silêncio e o fixture não avisa. O honesto-limit do próprio `contrato.test.ts:20-21` reconhece isso. Sem essa melhoria, ficamos permanentemente cegos à mudança de tipo — não só do `itsNumCodbar`, mas de `pctEspNumContaBanc`, `titEspNumero` e mais 4 campos com shape fixo. |
| security-3 | Security | M (2–5d) | Audit Trail (Bass) | Único caminho para responder a auditoria LGPD Art. 37. Sem tabela `audit_events` correlacionável com `req.user.sub`, o forense de vazamento parte de `console.log` do Render — efêmero. Vale para as 2 rotas de dado bancário (`linhas-digitaveis` + `.REM`). Preço: 1 migration + 1 repo + 2 handlers + testes. Habilita o card futuro de alarme por enumeração (`count > N por (user, hora)`), que fecha o R-9. |
| performance-4 | Performance | M | Maintain Multiple Copies of Data | Persistir `itsNumCodbar` na ingestão (padrão que `tem_boleto` já usa, documentado em `SispagPainelService.ts:334-340`). Elimina 100% das chamadas ao Conexos no caminho quente (leitura vira SQL local). O custo do padrão inverso — refazer o grid — é o mesmo que motivou a decisão do `tem_boleto`: *"custava +7 requisições Conexos por abertura de lote na filial 2"*. Latência p95 do endpoint: rede+ERP (~1-3s) → SQL local (~50ms). |
| performance-2 | Performance | S/M | Maintain Multiple Copies of Computations | Cachear a resposta no ciclo de vida do card (opção 1, S) ou no `SispagContext` (opção 2, M). N expansões do mesmo lote passam de N chamadas ao ERP para 1. Aliviar `LOGIN_ERROR_MAX_SESSIONS` durante fechamento de mês, quando remessa/importação (que MOVEM dinheiro) disputam o mesmo pool. |
| modifiability-5 | Modifiability | S (registro) + M-L (execução no próximo `/retro-ontology`) | Split Module | Registrar débito de coesão de `SispagPainelService` (12 deps, 5 métodos, subconjuntos disjuntos) no `_inbox/`. O split em si é escopo de `/retro-ontology` — provavelmente `SispagPainelReadService` + `SispagLoteDetalheService`. Valor: cada `/feature-tweak` de painel para de expandir o mesmo arquivo. |

## 6. O que está bem (e por quê)

Oito pontos onde o delta acerta e vale explicitar antes que a reunião degenere em "está tudo ruim":

1. **RBAC por default no route** — `requireRole('admin')` foi para a rota nova sem precisar de correção: o PatternGuardian pegou a ausência inicial na primeira volta e a resposta foi correta. Tactic Bass: *Authorize Actors*. Evidência: `routes/sispag.ts:66` + teste `sispag.test.ts:158-169` (403 para `viewer`).

2. **Zod estrito, sem coerção, honrando o ADR-0040** — o `LINHA_DIGITAVEL_SCHEMA` (`/^\d{47}$/`) omite linha inválida em vez de coagir para string vazia. Tactic Bass: *Adhere to Standards* (Integrability) + *Sanity Checking* (Fault Tolerance). O padrão que a ADR-0040 estabeleceu para escrita foi aplicado à leitura.

3. **Doutrina "falha != vazio" respeitada nas camadas baixas** — client faz `throw toConexosError(...)`; service faz `try/catch → [] + BUSINESS_WARN`. Camadas com contratos distintos, cada uma na altura certa da arquitetura. Tactic Bass: *Exception Handling* + *Degradation*.

4. **Anti-vazamento testado no service** — `SispagPainelService.test.ts:449-457` explicitamente prova que o `BUSINESS_WARN` não carrega os 47 dígitos. Executable Assertion no sentido Bass estrito. O gap é uma camada abaixo (interceptor) — mas o desenho da defesa está certo.

5. **DDD e injeção de dependência sem violação** — 0 violações de camada, 0 cyclic deps novas, 0 warnings Biome. Constructor injection em 100% dos testes novos (13/13 casos). Tactic Bass: *Restrict Dependencies*.

6. **Deploy tolerante a ordem FE↔BE** — o `.catch(() => setLinhas(new Map()))` no `LoteCard` permite que o FE deploye antes do BE sem crash na tela. O padrão está no código; falta apenas documentar (deployability-1).

7. **Retry composto corretamente** — `runWithRetry` (2 tentativas, 500ms + jitter 200ms) roda no client; o `catch` do service só degrada depois de esgotadas as tentativas. Composição correta que não é intuitiva de acertar de primeira.

8. **Precedente arquitetural claro para o próximo passo** — a família de decisões já feitas no repo (`tem_boleto` persistido, `RemessaCnabValidator` valida DV escrita, `heavyRouteLimiter` em rotas caras, kill-switch por env em rotas sensíveis) é o *manual do próximo push* — todos os cards estratégicos deste run são "aplicar o padrão que este repo já ratificou".

## 7. Limitações da análise

**Métricas declaradas como não medíveis localmente pelos agentes**:
- Taxa real de `BUSINESS_WARN linhasDigitaveisDoLote: leitura do fin015 falhou` em produção. Requer CloudWatch Logs Insights ou equivalente no Render — não existe no stack atual.
- MTTR real deste caminho (tempo entre falha do fin015 e alguém agir). Sem alarme, é "até virar chamado".
- Cobertura de linha/branch no delta. `--quick` proíbe rodar `npm test -- --coverage` (5–10min neste repo).
- Bundle size do frontend. `sonner` já era dep; o único delta real é 1 import de ícone tree-shaken.
- Taxa histórica de rename de campo no `fin015` do Conexos. Se fosse >1/ano, R-3 (integrability-1) subiria para P0.
- Métricas de Terraform/tenants — repositório não tem `infra/` (confirmado em `_shared-metrics.md`); a categoria inteira "IaC hygiene" é integralmente N/A.

**O que o pipe NÃO cobre e não foi avaliado**: chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade. Nenhum agente foi instruído a mapear esses pontos — a ausência aqui não é achado.

**Janela temporal**: snapshot do dia `2026-09-01`. Código é vivo — refazer trimestralmente ou quando houver mudança arquitetural relevante (ex.: migração para Lambda/Terraform, entrada de segundo tenant, mudança de auth). Uma medida realizada em produção durante este run é datada e não deve envelhecer sem verificação: **o maior lote nativo hoje tem 41 itens** (varredura de 31 lotes nas 5 filiais); se essa distribuição mudar, R-4 muda de severidade.

**Edições no material dos agentes**: nenhuma. Todos os cards e findings estão verbatim.

## 8. Ações recomendadas

Ordem de execução para os 30 dias seguintes:

1. **Fecha o CC-3 imediatamente** (uma sprint-dia): rodar `integrability-1`/`testability-2` (o mesmo card, listado em dois QAs). É uma linha de código, mas mata o único mecanismo que teríamos para pegar rename silencioso do `itsNumCodbar` no CI.

2. **Fecha o CC-2 no primeiro push do ciclo** (3 cards S, mesma família): `security-1` (redigir `itsNumCodbar` no interceptor) + `fault-tolerance-3` (DV) + `integrability-2` já enfileirado como M. Endereça R-1 (pagamento errado), R-2 (vazamento em log), CC-2 (assimetria escrita/leitura). Estabelece a regra "todo campo bancário tem 3 defesas: DV, redação, shape".

3. **Fecha o CC-1 no segundo push** (2 cards S): `fault-tolerance-2` (contador `dropped` no client) + `availability-1` (marcar `degraded` no payload). Elimina 4 findings de 3 QAs. Custo de esforço somado ≤ 2 dias.

4. **Endurecer a superfície da rota** (2 cards S): `deployability-2` (kill-switch por env) + `security-2` (`heavyRouteLimiter`). Alinha ao padrão já estabelecido para 7 outras rotas SISPAG sensíveis. Custo ≤ 2 dias.

5. **Colher o pattern reutilizável no delta** (3 cards S de higiene): `modifiability-1` (DTO nomeado) + `modifiability-4` (`useSispagAsyncMap`) + `integrability-4` (`listarItensDoLote`). Fecha CC-4. Feito preferencialmente numa mesma janela para consolidar o padrão antes do próximo tweak de painel.

6. **Registrar débito estratégico**: `security-3` (audit trail — M, escopo próprio pós-sprint) e `modifiability-5` (split do `SispagPainelService` — S para registrar, M-L para executar no próximo `/retro-ontology`). Materializar os pontos de dados estruturados que fecham o CC-5.

**Regra defendável em reunião**: "os 6 P1 saem antes de qualquer feature nova no SISPAG; os 15 P2 são orçados na mesma janela de planejamento; os 9 P3 acumulam no inbox e viram cardápio do próximo `/retro-ontology`". Nenhum P0 hoje = feature entra em `main`; o placar 7.0 é saudável para uma feature nova sobre uma superfície que move dinheiro.
