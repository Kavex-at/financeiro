---
qa: Security
qa_slug: security
run_id: 2026-10-29-1628-sispag-confirmar-em-conjunto
agent: qa-security
generated_at: 2026-10-29T16:28:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticada (ou sessão sequestrada) na gaveta de boletos do SISPAG | `POST /sispag/sugestoes-boleto/confirmar-em-conjunto` com até 200 linhas, tentando forjar `ator`, injetar títulos de outra filial/credor, ou abusar do batch como amplificador | Rota `src/backend/routes/sispag.ts:1004-1041`, `ConfirmacaoEmConjuntoService`, `BoletoSuggestionService.confirmar` reusado | Produção single-tenant (Columbia) sob Supabase JWT + `routePermissions`; rate-limit por usuário | Permissão `sispag:executar` exigida; schema `.strict()` barra campos espúrios; `ator` sempre do JWT; `pesCod` da origem relido do banco; recusa por linha quando filial/lote divergem; 422 nomeado se >30 linhas | 0 confirmações sem permissão, 0 confirmações com `ator` do cliente, 0 confirmações cruzando filial/credor, 100% das linhas confirmadas carregam `conjuntoId` no log de auditoria |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas com `exigirPermissao` explícita | 2 / 2 | 2 / 2 | ✅ | `src/backend/routes/sispag.ts:1000,1021` |
| Rotas novas com Zod `.safeParse` no boundary | 2 / 2 | 2 / 2 | ✅ | `src/backend/routes/sispag.ts:1007,1026` |
| Schemas novos com `.strict()` nos dois níveis | 1 / 1 | 1 / 1 | ✅ | `SugestaoBoletoSchemas.ts:80-87` |
| Rotas novas usando `ator(req)` do JWT (nunca do body) | 2 / 2 | 2 / 2 | ✅ | `sispag.ts:169,1033` |
| Rotas novas atrás do `limiteDecisaoBoleto` (sessão) | 1 / 1 (POST) | 1 / 1 | ✅ | `sispag.ts:1024` |
| Teto HTTP (Zod) vs. teto de domínio (422) | 200 / 30 | 200 / 30 | ✅ | `SugestaoBoletoSchemas.ts:74,87`, `ConfirmacaoEmConjunto.ts:15`, `BatchConfirmationTooLargeError.ts` |
| Credor (`pesCod`) lido do banco, não do cliente | sim | sim | ✅ | `ConfirmacaoEmConjuntoService.ts:103-108` |
| Resposta/log vazam código de barras ou linha digitável | 0 ocorrências | 0 | ✅ | grep `codbar\|linhaDigitavel` em arquivos novos |
| Secrets hardcoded nos arquivos novos | 0 | 0 | ✅ | grep `password/secret/token/credential` |
| SQL interpolado em arquivos novos | 0 | 0 | ✅ | serviço usa `tituloRepo`/`loteRepo`/`boletoRepo` parametrizados |
| Tabela de permissões cobre as 2 rotas novas | 2 / 2 (contagem SISPAG 68 → 70) | 100% | ✅ | `routePermissions.test.ts:152-153,273-278` |
| Fator de amplificação do rate-limit (confirmar single vs. batch) | 30× (1 request = até 30 confirmações) | ≤1× ou balde reduzido | ⚠️ | `rateLimit.ts:145-156` + `sispag.ts:914,1024` |
| Linhas RECUSADAs persistidas em trilha de auditoria | 0 por linha (só no log de aplicação) | ≥1 registro durável/linha RECUSADA | ⚠️ | `ConfirmacaoEmConjuntoService.ts:162-200`; recusa só volta no response e via `logService.info` do batch |
| Mensagem de erro inesperada vazando stack ao operador | 0 | 0 | ✅ | `MOTIVO_INESPERADO` + log server-side `ConfirmacaoEmConjuntoService.ts:33,190-199` |

> ⚠️ **Não medível localmente**: integração com CloudTrail/GuardDuty — não há `infra/` neste repo (deploy via Render). Observação herdada de reviews anteriores.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | `req.user?.sub` do JWT Supabase; `ator(req)` | ✅ | `sispag.ts:169,1033` |
| Authenticate Actors | Supabase JWT middleware + `requestIdMiddleware`; mesmo pipeline das demais rotas SISPAG | ✅ | `sispag.sugestaoBoleto.test.ts` (comApp fixtures) |
| Authorize Actors | `exigirPermissao(SISPAG_VER)` no GET, `exigirPermissao(SISPAG_EXECUTAR)` no POST; teste de tabela cobre as 2 rotas | ✅ | `sispag.ts:1000,1021`; `routePermissions.test.ts:152-153` |
| Limit Access | Rate-limit por usuário `sugestao-boleto-confirmar:<sub>` 30/min reusado | ⚠️ parcial | `rateLimit.ts:145-156`; 1 batch = até 30 writes (ver F-security-1) |
| Limit Exposure | GET devolve só `numeroBoleto` + chaves; nenhum `codbar`/`linhaDigitavel`/dado bancário sensível | ✅ | `ConfirmacaoEmConjunto.ts:38-57` |
| Encrypt Data | Herdada do stack (HTTPS no edge, Postgres TLS) — intocada pela feature | ✅ (herdada) | — |
| Separate Entities | `pesCod` da origem relido do banco; recusa por linha quando filial diverge; cada linha em transação própria no `confirmar` reusado | ✅ | `ConfirmacaoEmConjuntoService.ts:103-108,165-168` |
| Change Default Settings | Zod `.strict()` nos dois níveis; `Cache-Control: no-store` no GET | ✅ | `SugestaoBoletoSchemas.ts:80-87`; `sispag.ts:1013` |
| Validate Input | `TituloSugestaoQuerySchema.safeParse` no GET, `ConfirmarEmConjuntoBodySchema.safeParse` no POST; `ator`/`reconheceAvisos` recusados; corpo vazio ⇒ 400 | ✅ | `sispag.ts:1007,1026`; `sispag.sugestaoBoleto.test.ts` casos de 400 |
| Detect Intrusion | — (não é objetivo deste diff) | N/A | sem instrumentação por rota; cross-cutting fica fora do escopo |
| Detect Service Denial | Rate-limit por usuário aciona 429 `MUITAS_DECISOES` (herdado) | ⚠️ parcial | ver F-security-1 |
| Verify Message Integrity | Releitura ao vivo (lote, título, decisões) dentro do `confirmar` reusado — anti-TOCTOU por linha | ✅ | `ConfirmacaoEmConjuntoService.ts:171-181` |
| Detect Message Delay | N/A — operação síncrona, sem contrato de SLA de mensageria | N/A | — |
| Revoke Access | Herdada do sistema de permissões Supabase | ✅ (herdada) | — |
| Lock Computer | N/A — fora do escopo da feature | N/A | — |
| Inform Actors | Resposta por linha com `status` e `motivo` pt-BR; UI mostra; `MOTIVO_INESPERADO` genérico para 5xx | ✅ | `ConfirmacaoEmConjuntoService.ts:162-199`; `ConfirmacaoEmConjuntoSecao.tsx` |
| Audit Trail | Log de aplicação com `conjuntoId`, `origem`, `pesCod`, `pedidas`, `confirmadas`, `recusadas`, `ator`; decisões CONFIRMADAs persistidas pelo `confirmar` com `conjunto` no contexto. **Linhas RECUSADAs** só saem no log de aplicação, sem persistência | ⚠️ parcial | `ConfirmacaoEmConjuntoService.ts:139-152`; ver F-security-2 |
| Restore | Herdada do rollback de SISPAG; nenhuma mudança destrutiva adicional | ✅ (herdada) | — |

## 4. Findings (achados)

### F-security-1: batch amplifica em 30× o balde de rate-limit do `confirmar`

- **Severidade**: P1
- **Tactic violada**: Limit Access / Detect Service Denial
- **Localização**: `src/backend/routes/sispag.ts:914,978,1024`; `src/backend/http/rateLimit.ts:145-163`
- **Evidência (objetiva)**:
  ```
  rateLimit.ts:145  SUGESTAO_BOLETO_LIMIT_PER_MINUTE = 30
  rateLimit.ts:156  keyGenerator: sugestao-boleto-confirmar:<sub>
  sispag.ts:978     POST /sugestoes-boleto/confirmar      → limiteDecisaoBoleto (1 slot = 1 confirmação)
  sispag.ts:1024    POST /sugestoes-boleto/confirmar-em-conjunto → limiteDecisaoBoleto (1 slot = até 30 confirmações)
  ```
  Teto HTTP do Zod aceita 200 linhas por request (`SugestaoBoletoSchemas.ts:74`); o serviço só rejeita acima de 30 com 422. Em prática, uma sessão sequestrada pode disparar 30 req/min × 30 confirmações = **900 confirmações/min**, contra 30/min do fluxo single original.
- **Impacto técnico**: rate-limit perde sua função como barreira contra script/sessão roubada no ponto exato em que o sistema **move dinheiro** (confirmação de boleto DDA alimenta a remessa SISPAG).
- **Impacto de negócio**: um atacante com um JWT válido pode confirmar quase um lote inteiro em 1 minuto antes de qualquer alarme de abuso disparar — e o fluxo SISPAG converte confirmação em pagamento ao banco (via remessa Nexxera).
- **Métrica de baseline**: amplificação **30×** (30 → 900 confirmações/min); teto do Zod **200** linhas por request vs. teto de domínio **30** (170 linhas aceitas no HTTP só para serem rejeitadas pelo serviço).

### F-security-2: linhas RECUSADAs do conjunto não entram em trilha de auditoria durável

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:139-152,162-200`
- **Evidência (objetiva)**:
  ```
  122  const r = await this.confirmarLinha(item, ...)
  123  resultados.push(r.resultado)
  ...
  139  await this.logService.info({ ... conjuntoId, pedidas, confirmadas, recusadas, ator })
  ```
  O `confirmar` reusado persiste a **decisão CONFIRMADA** com o contexto do conjunto; as linhas que caem em `recusa(...)` (filial divergente, lote finalizado, erro inesperado) só aparecem no corpo da resposta e no log de aplicação agregado — sem registro durável por linha RECUSADA.
- **Impacto técnico**: após um incidente (ex.: analista reclama que "metade das linhas foi recusada e eu não sei por quê"), reconstruir o que foi recusado depende de o log de aplicação ainda existir, com a severidade/retenção certas.
- **Impacto de negócio**: a proposta exige trilha persistida ("quem, quando, o quê") para toda ação sobre documento financeiro — recusa também é uma ação sobre um título. Em disputa com a Columbia sobre um lote fechado, falta prova durável do que o sistema rejeitou.
- **Métrica de baseline**: **0 linhas RECUSADAs** persistidas em tabela de auditoria; 100% dependentes do log de aplicação (retido fora do Postgres).

### F-security-3: teto HTTP (200) muito acima do teto de domínio (30)

- **Severidade**: P3
- **Tactic violada**: Limit Exposure / Validate Input
- **Localização**: `src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts:74,80-87`; `ConfirmacaoEmConjunto.ts:15`
- **Evidência (objetiva)**:
  ```
  CONFIRMACAO_CONJUNTO_TETO_HTTP = 200
  itens: z.array(ChaveSugestaoBodySchema).min(1).max(CONFIRMACAO_CONJUNTO_TETO_HTTP)
  CONFIRMACAO_CONJUNTO_MAXIMO = 30 (serviço, 422 nomeado)
  ```
  Até 170 linhas por request são aceitas no HTTP só para serem rejeitadas pelo serviço com 422. O comentário admite o design ("Zod só barra o abuso (400)"), mas o custo CPU/alocação da análise Zod em 200 chaves é pago antes de qualquer defesa.
- **Impacto técnico**: superfície de DoS leve — 30 req/min × 200 chaves Zod é trabalho útil-zero.
- **Impacto de negócio**: baixo isoladamente; agrava F-security-1.
- **Métrica de baseline**: razão **200 / 30 = 6,67×** entre o teto HTTP e o teto de domínio.

### F-security-4: `TitleSuggestionNotFoundError` ecoa a chave recebida sem canonicalização

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:63,104`
- **Evidência (objetiva)**:
  ```
  if (!origem) throw new TitleSuggestionNotFoundError(chave)
  if (!tituloOrigem?.pesCod) throw new TitleSuggestionNotFoundError(input.origem)
  ```
  A chave vem direto do client (já validada por Zod, portanto limitada a 64 chars e tipos corretos). Risco baixo, mas em geral `errors` que ecoam entrada do usuário merecem ser inspecionados.
- **Impacto técnico**: nenhum conhecido — a chave é string curta e já validada; o erro é oriundo do domínio e é código operacional ("TITULO_SEM_SUGESTAO").
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 2 call-sites ecoando chave do cliente; 0 vazamentos observados em revisão manual.

### F-security-5: `limiteDecisaoBoleto` compartilha balde entre single e batch

- **Severidade**: P2
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/routes/sispag.ts:914,978,1024`
- **Evidência (objetiva)**: ambos endpoints usam o mesmo `escopo='confirmar'`, mesma key `sugestao-boleto-confirmar:<sub>`. Um atacante que já consumiu o balde no `confirmar` single consegue continuar via batch (até o mesmo teto numérico de requests, mas com 30× o impacto por request).
- **Impacto técnico**: a métrica "decisões/min" vira dependente da **mistura** de rotas, não observável no balde.
- **Impacto de negócio**: o balde de 30/min foi defendido na ADR-0068 por ser "o teto de um humano decidindo"; a semântica muda com batch.
- **Métrica de baseline**: 1 balde para 2 rotas com custos de 1 e até 30 confirmações respectivamente.

## 5. Cards Kanban

### [security-1] Rebaixar teto do batch no rate-limiter ou cobrar `N` slots por N linhas

- **Problema**
  > O `POST /sugestoes-boleto/confirmar-em-conjunto` consome 1 slot do balde `sugestao-boleto-confirmar:<sub>` (30/min) mas executa até 30 confirmações, amplificando em 30× o teto de decisões que a ADR-0068 defendia como "o teto de um humano". Uma sessão sequestrada confirma até ~900 títulos/min antes de ver 429 — ponto exato em que o sistema move dinheiro via remessa SISPAG.

- **Melhoria Proposta**
  > Alterar `limiteDecisaoBoleto` aplicado ao batch (`src/backend/routes/sispag.ts:1024`) para (a) um balde dedicado `sugestao-boleto-conjunto` com `limit=1/min` por usuário, ou (b) um `cost` dinâmico igual a `itens.length` quando o `express-rate-limit` suportar (ou middleware caseiro em `src/backend/http/rateLimit.ts`). Tactic alvo: **Limit Access** / **Detect Service Denial**.

- **Resultado Esperado**
  > Taxa máxima de confirmações/min por usuário cai de **900** para o teto humano (**≤30/min**), restaurando a defesa prometida pela ADR-0068 inclusive sob batch.

- **Tactic alvo**: Limit Access
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1, F-security-5
- **Métricas de sucesso**:
  - Pico de confirmações/min por usuário: 900 → ≤30
  - Teste de rate-limit cobrindo batch (`rateLimit.test.ts`): ausente → presente
- **Risco de não fazer**: um JWT comprometido confirma um lote SISPAG inteiro em minutos antes de qualquer alarme — e a confirmação alimenta a remessa Nexxera.
- **Dependências**: nenhuma.

### [security-2] Persistir trilha durável por linha RECUSADA do conjunto

- **Problema**
  > Linhas que o `confirmarLinha` recusa (filial divergente, lote finalizado, erro inesperado) só retornam no response e num `logService.info` agregado. Confirmações CONFIRMADAs são persistidas pelo `confirmar` reusado, mas recusas não têm registro durável — a proposta exige trilha "quem, quando, o quê" para toda ação sobre documento financeiro, e recusa também é ação.

- **Melhoria Proposta**
  > No `ConfirmacaoEmConjuntoService.confirmarLinha`, gravar cada linha RECUSADA numa tabela de audit (reusar a mesma `DecisaoSugestaoBoleto` com status "RECUSADA_EM_CONJUNTO" ou criar `AuditoriaConjuntoRecusa`) com `conjuntoId`, chave do título, motivo pt-BR, ator e timestamp. Tactic alvo: **Audit Trail**.

- **Resultado Esperado**
  > 100% das linhas RECUSADAs com registro durável; reconstrução pós-incidente deixa de depender de retenção do log de aplicação.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Linhas RECUSADAs persistidas: 0% → 100%
  - Query de auditoria por `conjuntoId` retorna confirmadas + recusadas: parcial → completa
- **Risco de não fazer**: em disputa com a Columbia sobre um lote fechado, falta prova durável do que foi rejeitado e por quê.
- **Dependências**: cross-ref Fault Tolerance (audit trail por ação).

### [security-3] Aproximar teto HTTP do teto de domínio (200 → 30)

- **Problema**
  > `ConfirmarEmConjuntoBodySchema` aceita até 200 chaves; o serviço rejeita acima de 30 com 422. Até 170 chaves são parseadas e descartadas por request — custo CPU útil-zero que agrava a amplificação em F-security-1.

- **Melhoria Proposta**
  > Deixar `.max(CONFIRMACAO_CONJUNTO_MAXIMO)` no Zod (`src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts`), e manter a mensagem 422 só para o caso em que, por algum motivo (ex.: duplicatas no corpo que viram 31 após dedup), o serviço queira resposta nomeada. Tactic alvo: **Limit Exposure** / **Validate Input**.

- **Resultado Esperado**
  > Teto HTTP alinhado ao teto de domínio; carga de parsing cai de até 200 para até 30 chaves/request.

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Razão teto HTTP / teto de domínio: 6,67× → 1×
  - Overhead de parsing Zod em request abusivo: até 200 chaves → até 30
- **Risco de não fazer**: DoS leve persistente; piora proporcional se o teto de domínio subir.
- **Dependências**: nenhuma.

### [security-4] Baldes separados por rota de decisão (single vs. batch vs. copiar)

- **Problema**
  > `confirmar` single e `confirmar-em-conjunto` dividem a mesma chave `sugestao-boleto-confirmar:<sub>`. A métrica "decisões/min" vira dependente da mistura de rotas usada pelo cliente, e é impossível alarmar sobre "comportamento anormal no batch" isoladamente.

- **Melhoria Proposta**
  > No `buildSugestaoBoletoLimiter` incluir `'conjunto'` entre os escopos (`rateLimit.ts:151`) e usá-lo para o POST de conjunto. Ou, mais barato, deixar o escopo diferente e definir teto específico (ver security-1). Tactic alvo: **Limit Access**.

- **Resultado Esperado**
  > Observabilidade por rota de decisão; alarme específico para abuso de batch.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-5, F-security-1
- **Métricas de sucesso**:
  - Baldes distintos para 'confirmar' e 'conjunto': 1 → 2
  - Teste de independência dos baldes: ausente → presente
- **Risco de não fazer**: alarme sobre abuso de batch impossível sem dividir o balde.
- **Dependências**: idealmente feito junto com security-1.

## 6. Notas do agente

- Escopo restrito ao diff da feature (ADR-0080). Varreduras amplas (secrets em todo o repo, `npm audit`, CORS/IAM/CloudTrail) foram pulados por `--quick` e porque não há `infra/` neste repo.
- Nenhuma métrica de infra Terraform/CloudTrail/GuardDuty é medível localmente — herdança de reviews anteriores.
- **Cross-QA**: F-security-2 (Audit Trail) e card security-2 → sinalizar ao `qa-fault-tolerance` (overlap de audit trail por ação); F-security-1 e card security-1 (Limit Access/DoS) → sinalizar ao `qa-availability` (blast radius de rate-limit em write financeiro); F-security-3 (Validate Input, teto Zod) → sinalizar ao `qa-integrability`.
- Confirmação positiva: `ator` sempre do JWT, `pesCod` da origem relido do banco, Zod `.strict()` nos dois níveis, sem leakage de código de barras/linha digitável no response GET, sem secrets em arquivos novos, sem SQL interpolado — a feature preserva as invariantes de segurança do fluxo single.
