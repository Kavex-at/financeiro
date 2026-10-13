---
qa: Security
qa_slug: security
run_id: 2026-10-13-2014
agent: qa-security
generated_at: 2026-10-13T20:30:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Falha de infra/Conexos durante a sincronização DDA embutida na ingestão (ou insider lendo run/log) | Erro de driver/rede cuja `message` carrega trecho sensível (host, usuário, connection string) | `error_message` da run (persistido), `dda.erro` no JSON de `/sispag/ingestao`, WARN no LogService, `::warning::` no log do GitHub Actions | Produção, cron 3x/dia + abertura de tela + botão manual | Mensagem redigida por padrão antes de persistir/logar/expor; superfície só para papéis autenticados com permissão SISPAG; nenhuma escrita nova no ERP | 0 segredos em `error_message`/log; 100% das rotas novas atrás de `exigirPermissao`; 0 chamadas de escrita ao Conexos no delta |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `git diff 5a17d3e HEAD` (leitura dos 8 arquivos de produção) |
| SQL parametrizado para `doc_esp_numero` | 100% (placeholder nomeado `$dn{i}`, sem interpolação de valor) | 100% | ✅ | `TituloAPagarRepository.ts` upsertMany |
| Escritas novas no ERP | 0 (só `listarItens`/fin124 leitura + fin064 leitura) | 0 | ✅ | diff de `BoletoDdaService.ts`, `ConexosSispagClient.ts` |
| Rotas novas | 0 (`dda` viaja nas respostas das rotas existentes) | — | ✅ | `routes/sispag.ts:810-850` |
| Rotas que devolvem `dda`/`error_message` sem permissão | 0; `POST /sispag/ingestao` exige `SISPAG_EXECUTAR`, `POST /sispag/carteira/atualizar` e `GET /sispag/ingestao/runs` exigem `SISPAG_VER` | 0 | ✅ | `routes/sispag.ts:812,848,930` |
| Pontos do delta que persistem/logam erro sem `redactErrorMessage` | 4 (`error_message` da run, `dda.erro`, WARN `avisar`, `::warning::`) | 0 | ⚠️ | `IngestaoPagamentosService.ts:218-221,285-292`; `ingest-pagamentos.ts:40-44`; `BoletoDdaService.ts:155-160` |
| `npm audit` | ⚠️ Não medível localmente no escopo delta (nenhuma dependência adicionada; só bump de versão em package.json) | critical/high = 0 | ⚠️ | diff de `package.json` (2 linhas, versão) |
| CloudTrail/GuardDuty/IAM/SSM | ⚠️ Não medível: `infra/` não existe | — | ⚠️ | CLAUDE.md "Estado Atual vs. Alvo" |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do escopo do delta; sem alarme novo | N/A | delta não toca autenticação |
| Detect Service Denial | `heavyRouteLimiter` já cobre as rotas que disparam ingestão (e agora a sync DDA); prazo de 60 s limita a amplificação | ✅ presente | `routes/sispag.ts:813,849`; `DDA_PRAZO_NA_INGESTAO_MS` |
| Verify Message Integrity | `docEspNumero` passa por Zod (`strOpt`) e `.trim()` | ✅ presente | `ConexosSispagClient.ts:83,381` |
| Detect Message Delay | Aviso de pool DDA parado > 8 h em dia útil (UI) | ✅ presente | `ddaDefasado.ts` |
| Identify Actors | `triggeredBy: ingestao:{ator}` registrado na sync DDA e na run | ✅ presente | `IngestaoPagamentosService.ts:203-206` |
| Authenticate Actors | Inalterado; rotas existentes atrás do middleware de auth | ✅ presente | `routes/sispag.ts` |
| Authorize Actors | `exigirPermissao(SISPAG_EXECUTAR/SISPAG_VER)` nas rotas que expõem `dda`; sem endpoint novo | ✅ presente | `routes/sispag.ts:812,848,930` |
| Limit Access | Coluna nova lida só pela carteira; ingestão é a única que grava | ✅ presente | migração `0083` |
| Limit Exposure | `dda.erro` truncado a 300, `error_message` a 120 chars do erro; porém sem redação | ⚠️ parcial | `IngestaoPagamentosService.ts:221,285` |
| Encrypt Data | `doc_esp_numero` é nº de NF de fornecedor (dado comercial, não credencial); mesmo tratamento das demais colunas da tabela | ✅ presente | migração `0083` |
| Separate Entities | Sync DDA dentro da ingestão mas sob lock próprio e sessão sequencial (cap de sessões do robô) | ✅ presente | ADR-0066 §3 |
| Change Default Settings | N/A — sem configuração nova | N/A | — |
| Validate Input | Parametrizado + Zod; sem input HTTP novo | ✅ presente | `TituloAPagarRepository.ts:114` |
| Revoke Access / Lock Computer | N/A — delta não toca sessão/credencial | N/A | — |
| Inform Actors | Frontend avisa pool defasado; `::warning::` no Actions | ✅ presente | `BoletosDdaTab.tsx:282-288` |
| Audit Trail | Run persiste aviso DDA; WARN logado; sem ação financeira nova | ✅ presente | `avisoDaRun` |

## 4. Findings

### F-security-1: Texto de erro da sincronização DDA persistido, logado e exposto sem `redactErrorMessage`

- **Severidade**: P2
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:218-221` e `:285-292`; `src/backend/jobs/ingest-pagamentos.ts:40-44`
- **Evidência (objetiva)**:
  ```
  const erro = error instanceof Error ? error.message : String(error);
  await this.avisar('sincronização DDA falhou — pool anterior mantido', { erro });
  return { estado: DDA_NA_INGESTAO.FALHOU, erro: erro.slice(0, 300) };
  ...
  `pool DDA ${dda.estado}${dda.erro ? ` (${dda.erro.slice(0, 120)})` : ''}`   // -> error_message
  console.warn(`::warning::... ${d.erro ? ` — ${d.erro}` : ''}...`)
  ```
  O repo já tem `domain/libs/redact/redactErrorMessage.ts` (ADR-0042), usado em `SincronizacaoPassadaService`, `JobExecucaoRepository`, `conexosSessionStore`. O delta não o aplica.
- **Impacto técnico**: o caminho Conexos é limpo — `ConexosError.message` é `Conexos call to {endpoint} failed` e a razão crua do ERP fica em `userMessage`, que não é usada aqui. O vazamento possível vem dos erros NÃO-Conexos que `sincronizar` propaga (Postgres em `salvarArquivo`/`withAdvisoryLock`, ex.: `password authentication failed for user "…"`, host do pooler, `ECONNREFUSED ip:porta`). Esse texto vai para `pagamento_ingestao_run.error_message` (persistido, lido por `GET /sispag/ingestao/runs` com `sispag:ver` e por `motivo` em `/carteira/atualizar`), para o JSON de `POST /sispag/ingestao` e para o log público do GitHub Actions via `::warning::`. Persistir é pior que logar (ver cabeçalho do redactor).
- **Impacto de negócio**: segredo/topologia de infra legível por qualquer perfil com `sispag:ver` e por quem vê o log do workflow; contradiz a regra já adotada pelo time (Regis-Review 2026-09-29, `security-1`). Probabilidade baixa (exige falha de banco no instante da sync), severidade do dado moderada.
- **Métrica de baseline**: 4 pontos de saída de erro livre no delta, 0 com redação; 3+ consumidores existentes do redactor. Sem evidência de vazamento real nesta run, portanto P2 (não há número de incidente que sustente P1).

### F-security-2: `dda.erro` é devolvido ao frontend em rotas de permissão baixa (`sispag:ver`)

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:98-104` (devolve `run` inteiro, que agora inclui `dda`); `routes/sispag.ts:848-850`
- **Evidência (objetiva)**: `return { estado: ATUALIZADA, ..., run }` — `run` é o `IngestaoPagamentosResult` com `dda.erro`. A rota exige só `SISPAG_VER`, perfil de leitura. A UI não renderiza `dda.erro` hoje.
- **Impacto técnico**: um papel somente-leitura passa a receber texto técnico de erro que antes só aparecia para quem executa a ingestão.
- **Impacto de negócio**: baixo; o mesmo texto já era acessível em `/ingestao/runs` (`sispag:ver`) via `error_message`, então não amplia a superfície de forma nova — só repete.
- **Métrica de baseline**: 1 campo textual livre novo em resposta de rota `sispag:ver`; 0 campos de credencial.

### F-security-3: Verificações sem achado (registro de negativos)

- **Severidade**: P3 (informativo)
- **Tactic violada**: —
- **Localização**: delta inteiro
- **Evidência (objetiva)**: (a) `doc_esp_numero` entra como parâmetro nomeado `$dn{i}` e `COALESCE(EXCLUDED…)`; 0 interpolação de valor em SQL. (b) Nenhuma rota nova, nenhuma permissão nova. (c) Zero escrita ao ERP: `listarItens` (fin124) e o mapper do fin064 são leitura; `sincronizar` só chama `salvarArquivo` (Postgres). (d) Texto do frontend (`DDA parado há N h…`) interpola apenas um inteiro calculado, sem `dangerouslySetInnerHTML`; o JSX escapa. (e) `::warning::` não contém credencial, só `estado`, contadores e `erro` (ver F-security-1). (f) `doc_esp_numero` é nº de NF do fornecedor, sem CNPJ nem valor.
- **Impacto técnico**: nenhum.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 0 achados P0, 0 achados P1.

## 5. Cards Kanban

### [security-1] Redigir o erro da sincronização DDA antes de persistir, logar e anotar

- **Problema**
  > A sync DDA embutida na ingestão grava `error.message` (limitado por `slice`, não por redação) em `error_message` da run, no WARN, no resultado da rota e no `::warning::` do Actions. Erros de Postgres/rede podem trazer usuário, host ou connection string; o `redactErrorMessage` do repo existe e não foi usado.

- **Melhoria Proposta**
  > Em `sincronizarDda`, calcular `const erro = redactErrorMessage(error instanceof Error ? error.message : String(error))` e usar esse valor no `avisar`, em `dda.erro` e (por consequência) em `avisoDaRun` e no `::warning::`. Aplicar o mesmo em `BoletoDdaService.ts:155-160` (WARN por arquivo). Teste: erro com `password authentication failed for user "x"` não aparece em `error_message`.

- **Resultado Esperado**
  > Pontos de saída de erro livre sem redação no delta: 4 → 0. Nenhum texto de driver chega ao banco, ao JSON de rota ou ao log do Actions sem passar pelo redactor.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Pontos sem redação no delta: 4 → 0
  - Teste unitário cobrindo mensagem com credencial: 0 → 1
- **Risco de não fazer**: uma falha de banco no horário da sync grava credencial/topologia em tabela legível por perfil `sispag:ver` e no log do workflow.
- **Dependências**: nenhuma.

### [security-2] Não devolver `dda.erro` nas rotas de perfil de leitura

- **Problema**
  > `POST /sispag/carteira/atualizar` (`sispag:ver`) devolve o `run` inteiro, incluindo `dda.erro`, texto livre que a UI não usa.

- **Melhoria Proposta**
  > Projetar `dda` na resposta de `/carteira/atualizar` sem o campo `erro` (manter `estado` e contadores), mantendo o texto completo só em `POST /sispag/ingestao` (`sispag:executar`) e na run persistida.

- **Resultado Esperado**
  > Campos textuais livres novos em rotas `sispag:ver`: 1 → 0, sem perder o aviso (que a UI deriva de `sincronizadoEm`).

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Campo `erro` em resposta `sispag:ver`: 1 → 0
- **Risco de não fazer**: baixo; exposição redundante de texto técnico a perfil de leitura.
- **Dependências**: security-1 reduz o risco do mesmo campo e pode tornar este card dispensável.

## 6. Notas do agente

- Escopo: só o delta (`git diff 5a17d3e HEAD`); `npm audit`, IAM, CloudTrail e SSM não medidos (sem `infra/`; nenhuma dependência nova).
- Confirmado sem achado: sem escrita nova no ERP, SQL parametrizado, sem rota nova, texto do frontend sem HTML injetável.
- Cross-QA: F-security-1 liga a Fault Tolerance (Audit Trail da run `error_message`) e a Integrability (redactor compartilhado, card `integrability-3` anterior).
