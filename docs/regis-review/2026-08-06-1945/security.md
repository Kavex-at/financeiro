---
qa: Security
qa_slug: security
run_id: 2026-08-06-1945
agent: qa-security
generated_at: 2026-08-06T19:45:00Z
scope: backend
score: 9
findings_count: 3
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

Escopo restrito ao delta `bordero-vazio-orfao` (I-Write-7): duas novas superfícies de risco —
(a) uma **escrita destrutiva** interna no ERP (`ReconciliacaoPermutaService.removerBorderoOrfao` →
`excluirBordero`); e (b) um **short-circuit de aprovação** exposto via HTTP
(`POST /permutas/borderos/:borCod/finalizar` → `assertBorderoTemItens`). Ambos tocam o `fin010`,
que é escrita financeira real no ERP-Conexos.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/admin autenticado (`requireRole('admin')`) | POST `/borderos/:borCod/finalizar` com `borCod` arbitrário — inclusive de outra filial ou de borderô não-criado-pelo-sistema | `BorderoGestaoService.finalizarBordero` → `assertBorderoTemItens` | Operação normal (`CONEXOS_WRITE_ENABLED=true`) | Guard `requireOwnBorderoFilCod` recusa 403 ANTES do `listBaixas`; `assertBorderoTemItens` só roda com `filCod` da trilha (não do request); `finalizarBordero` no ERP só se houver item real | 0 finalizações de borderô alheio; 0 vazamentos de existência de borderô de terceiro; mensagem PT sem PII do ERP |
| Cadeia de reconciliação (código interno, sem input direto do usuário no `borCod`/`filCod`) | Todas as baixas de `reconciliar` falham → borderô nasce vazio no ERP | `ReconciliacaoPermutaService.removerBorderoOrfao` → `ConexosBaixaClient.excluirBordero` | `writeEnabled && !dryRun` | Só apaga o borderô CRIADO NESTA CHAMADA (`borderoCriadoAqui`), com `filCod` derivado do `adto` (DB), e SÓ se `listBaixas`=[] no ERP; falha ⇒ `BUSINESS_WARN` sem `err.cause` (padrão anti-Cookie/sid) | 0 exclusões de borderô alheio; 0 Cookies/sids do Conexos em log |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas destrutivas com `filCod`/`borCod` vindos DIRETO do request no delta | 0 | 0 | ✅ | `BorderoGestaoService.ts:200-217, 288-297` (guardAcaoBordero); `ReconciliacaoPermutaService.ts:245-293` (produtor interno) |
| `filCod` de `assertBorderoTemItens` derivado da TRILHA (não do request) | 1/1 | 1/1 | ✅ | `BorderoGestaoService.ts:204-205` (`filCod = guardAcaoBordero(...)`; `assertBorderoTemItens(filCod, borCod)`) |
| Guards de autorização executando ANTES do side-effect | 3/3 (writeEnabled → ownership → item-count → ERP-POST) | 3/3 | ✅ | `BorderoGestaoService.ts:200-206` |
| Novos catches expondo Error cru (com AxiosError.cause) em log | 0 | 0 | ✅ | `ReconciliacaoPermutaService.ts:333-343` usa `err instanceof Error ? err.message : String(err)`; mesmo padrão de `permutas.ts:98` e `BorderoGestaoService.ts:130-136` |
| Mensagens do delta contendo PII (Cookie, sid, JWT, CNPJ, valores) | 0 | 0 | ✅ | Revisão manual de `ReconciliacaoPermutaService.ts:319-343`, `BorderoGestaoService.ts:267-271` |
| Endpoints novos adicionados pelo delta (sem Zod) | 0 | 0 | ✅ | `git diff --stat` — só serviços/UI, sem `routes/*` |
| Superfícies SQL novas / interpolação de string | 0 | 0 | ✅ | Delta não toca `Repository`; `deleteBorderoCache(filCod, borCod)` já usa params `$1`/`$2` (pré-existente) |
| `npm audit` (backend/frontend) | ⚠️ Não coletado | 0 crit / 0 high | ⚠️ | Modo `--quick` (`_shared-metrics.md`) — inspecionar em corridas non-quick |
| CloudTrail/GuardDuty/IAM policies | N/A (sem `infra/`) | — | N/A | `_shared-metrics.md` — estado atual = Express/Render, não há Terraform |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | `executadoPor` capturado (`req.user?.sub ?? req.user?.email`) e propagado no log da finalização | ✅ presente | `routes/permutas.ts:624`; `BorderoGestaoService.ts:214` |
| Authenticate Actors | Rota protegida por `requireRole('admin')` (JWT/Supabase) | ✅ presente (pré-existente, delta preserva) | `routes/permutas.ts:615-616` |
| Authorize Actors | `requireOwnBorderoFilCod` (confused-deputy guard) — só age em borderô da trilha; `filCod` vem da trilha, nunca do request. Lança `FORBIDDEN:` → 403 | ✅ presente | `BorderoGestaoService.ts:288-297, 304-305`; `routes/permutas.ts:82-88` |
| Limit Access | `assertBorderoTemItens` é chamado DEPOIS do guard e com `filCod` da trilha — não expõe `listBaixas` a borderô de terceiro | ✅ presente | `BorderoGestaoService.ts:200-206, 264-272` |
| Limit Exposure | `removerBorderoOrfao` só age em borderô criado NESTA chamada (`borderoCriadoAqui`), com `filCod` derivado do `adto` (DB); fail-safe checa `listBaixas>0` antes de deletar | ✅ presente | `ReconciliacaoPermutaService.ts:146, 254, 286-293, 316-325` |
| Encrypt Data | N/A neste delta | N/A | Delta não toca TLS/at-rest |
| Separate Entities | N/A neste delta | N/A | Delta não introduz cross-tenant |
| Change Default Settings | Escrita gated por `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN` (default = dry-run) — preservado; `removerBorderoOrfao` só roda no caminho `!dryRun` | ✅ presente | `ReconciliacaoPermutaService.ts:137-140`; `BorderoGestaoService.ts:274-280` |
| Validate Input | Rota já valida (`Number.isFinite(borCod)`, `requireRole`); `borCod` é `number` no serviço; delta não abre nova entrada externa | ✅ presente | `routes/permutas.ts:619-623` |
| Detect Intrusion | Log estruturado `BUSINESS_INFO`/`BUSINESS_WARN` com `borCod`+`executadoPor`+`adiantamentoDocCod`; `respondActionError` loga `CONEXOS_ERROR` com `erpStatus`/`erpKey` | ✅ presente | `ReconciliacaoPermutaService.ts:319-343`; `BorderoGestaoService.ts:211-215`; `routes/permutas.ts:91-112` |
| Detect Service Denial | N/A neste delta | N/A | `heavyRouteLimiter` na rota já existe (pré-delta) |
| Verify Message Integrity | N/A neste delta | N/A | — |
| Detect Message Delay | N/A neste delta | N/A | — |
| Revoke Access | N/A neste delta | N/A | — |
| Lock Computer | N/A neste delta | N/A | — |
| Inform Actors | Erro `assertBorderoTemItens` → 400 com mensagem PT clara ("use Excluir para removê-lo"); UI desabilita "Aprovar" quando vazio, com `title` explicativo | ✅ presente | `BorderoGestaoService.ts:267-271`; `BorderosPanel.tsx:471-490` |
| Audit Trail | `BUSINESS_INFO` na remoção do órfão (adiantamentoDocCod + borCod), `BUSINESS_WARN` na recusa (item no ERP) e no fail-safe; finalização gera `BUSINESS_INFO` | ✅ presente | `ReconciliacaoPermutaService.ts:319-343`; `BorderoGestaoService.ts:211-215` |
| Restore | Fail-safe — só apaga se `listBaixas`=[]; qualquer falha vira WARN sem mascarar o erro real da baixa | ✅ presente | `ReconciliacaoPermutaService.ts:317-325, 333-343` |

## 4. Findings

### F-security-1: Ordem `guard → assert → POST` correta em `finalizarBordero` — sem bypass nem oráculo

- **Severidade**: N/A (evidência positiva — registrada para o consolidator)
- **Tactic reforçada**: Authorize Actors + Limit Access
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:200-217, 264-272, 288-297`
- **Evidência (objetiva)**:
  ```typescript
  // BorderoGestaoService.ts:200-206
  public finalizarBordero = async (params: { borCod: number; executadoPor: string }) => {
      const filCod = await this.guardAcaoBordero(params.borCod);   // 1) writeEnabled → ownership (403)
      await this.assertBorderoTemItens(filCod, params.borCod);      // 2) só depois: listBaixas com filCod da trilha
      await this.conexosBaixaClient.finalizarBordero({ filCod, borCod: params.borCod });
  ```
  - `filCod` do `assertBorderoTemItens` NÃO é do request — vem de `requireOwnBorderoFilCod` (`baixas[0]?.filCod` da trilha). Um admin (ou JWT comprometido) que POSTe `borCod=99999` recebe 403 antes que qualquer `listBaixas` seja executado no ERP — não há oráculo de existência.
- **Impacto técnico**: nenhum — o vetor "confused-deputy via filCod arbitrário no request" está **fechado** para a rota `/finalizar`.
- **Impacto de negócio**: previne a finalização (baixa financeira efetiva) de borderô alheio via API.
- **Métrica de baseline**: 3/3 guards executam antes do side-effect no ERP; 0 caminhos observados que pulam ownership.

### F-security-2: `removerBorderoOrfao` — inputs de fonte confiável, não acionável por request

- **Severidade**: N/A (evidência positiva)
- **Tactic reforçada**: Limit Exposure
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:146, 245-293, 310-344`
- **Evidência (objetiva)**:
  - `filCod` vem do adiantamento (`adto.filCod`, DB — linha 107); `borCod` vem da resposta do ERP ao `criarBordero` (linhas 249-253).
  - Gate `borderoCriadoAqui === true` (linha 254, checado em 291): só apaga borderô cuja criação ocorreu nesta chamada — impossível ser induzido a apagar borderô pré-existente.
  - Fail-safe (linhas 317-325): consulta `listBaixas` NO ERP antes de deletar; se `>0`, vira WARN e não apaga.
  - Não há caminho HTTP que exponha `removerBorderoOrfao` diretamente — é privado e chamado apenas de `reconciliar`.
- **Impacto técnico**: nenhum — nenhum request-borne `filCod`/`borCod` chega ao `excluirBordero`.
- **Impacto de negócio**: previne borderô legítimo de terceiro ser apagado via manipulação de request.
- **Métrica de baseline**: 0 chamadas a `excluirBordero` no delta com `filCod`/`borCod` derivados de input externo.

### F-security-3: Catch de `removerBorderoOrfao` loga `err.message`, não o Error cru — pattern anti-Cookie/sid preservado

- **Severidade**: P3 (registro; hardening opcional para excluir a chance residual de mensagens verbosas de AxiosError)
- **Tactic reforçada**: Encrypt Data (segredos em trânsito) + Audit Trail
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:333-343`
- **Evidência (objetiva)**:
  ```typescript
  } catch (err) {
      await this.logService.warn({
          type: LOG_TYPE.BUSINESS_WARN,
          message: 'falha ao remover o borderô órfão (best-effort) — remover pelo painel',
          data: { adiantamentoDocCod, borCod,
                  erro: err instanceof Error ? err.message : String(err) },
      });
  }
  ```
  - Segue o pattern documentado em `routes/permutas.ts:98` ("NÃO passar o Error cru: seu `cause` é o AxiosError, cujo `config.headers` carrega o Cookie/sid do Conexos") — só `err.message`, sem `cause`/`response`/`config`.
  - Idêntico ao catch já auditado em `BorderoGestaoService.ts:130-136` (`excluirBaixa`).
- **Impacto técnico**: baixo. Para AxiosError padrão, `.message` é curto ("Request failed with status code 500"). Ainda assim, se um interceptor customizar `.message` para incluir a URL completa com querystring, pode haver leakage marginal.
- **Impacto de negócio**: negligível no delta; a mesma técnica está em uso há semanas sem incidente.
- **Métrica de baseline**: 1 catch novo no delta, 0 divergências do pattern estabelecido, 0 usos de `err.cause`/`err.response` no log.

## 5. Cards Kanban

### [security-1] Extrair helper `safeErpErrMessage(err)` para uniformizar a serialização de erros do ERP em log

- **Problema**
  > O delta adiciona mais um catch que faz `err instanceof Error ? err.message : String(err)`
  > (`ReconciliacaoPermutaService.ts:340`). É o padrão correto — evita que o `cause: AxiosError` com
  > `config.headers.Cookie` (sid do Conexos) escape para o log — mas é reproduzido à mão em pelo menos
  > três lugares (`routes/permutas.ts`, `BorderoGestaoService.excluirBaixa`, agora
  > `ReconciliacaoPermutaService.removerBorderoOrfao`). Cada nova cópia é uma chance de alguém trocar
  > por `String(err)`, `JSON.stringify(err)` ou `err.stack` sem perceber.

- **Melhoria Proposta**
  > Criar `src/backend/domain/libs/log/safeErpErrMessage.ts` com uma única função que devolve string
  > sanitizada (`.message` de Error, `String(err)` de non-Error, `undefined`-guard). Refatorar os três
  > sites atuais para usá-la. Adicionar regra do `PatternGuardian`/lint proibindo passar `err` cru
  > para `logService` fora dessa função. Tactic Bass: *Encrypt Data* + *Audit Trail*.

- **Resultado Esperado**
  > 1 único ponto de serialização de erro de ERP para log; a próxima cópy-paste do padrão vira
  > compile-error/lint-error em vez de exposição silenciosa.

- **Tactic alvo**: Encrypt Data
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Sites com serialização ad-hoc de `err` para log: 3 → 0 (todos delegam ao helper)
  - Ocorrências de `err.cause` / `err.response` / `err.stack` em `logService.*({ data })`: 0 → 0 (garantido por lint)
- **Risco de não fazer**: probabilidade pequena mas cumulativa — em 6 meses, mais uma feature adiciona catch e alguém troca por `JSON.stringify(err)`, expondo Cookie/sid do Conexos no CloudWatch/log storage.
- **Dependências**: nenhuma.

### [security-2] Rodar `npm audit` (backend + frontend) em pipeline non-`--quick` — cobrir dependências deste run

- **Problema**
  > O `_shared-metrics.md` explicita que `npm audit` não foi coletado neste run (modo `--quick`).
  > O delta não introduz dependências novas, mas o baseline de CVEs não foi verificado — se uma
  > `axios`/`zod`/`next` tiver crítico conhecido, o gate não pega.

- **Melhoria Proposta**
  > No próximo `/regis-review` non-quick, executar `npm audit --json` em `src/backend` e `src/frontend`;
  > registrar contagens crit/high/moderate no `_shared-metrics.md` e falhar o gate em `critical>0` ou
  > `high>0`. Tactic Bass: *Limit Exposure* (dependency surface).

- **Resultado Esperado**
  > Contagem de CVEs auditada por run: `⚠️ não coletado` → `crit=0, high=0, mod≤5`; gate falha em
  > quebra do alvo antes de merge.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: (não há finding específico — cobre a lacuna declarada em métricas)
- **Métricas de sucesso**:
  - `npm audit` executado por run non-quick: 0/N → N/N
  - CVEs critical/high: desconhecido → 0/0
- **Risco de não fazer**: CVE crítico em runtime (Node) ou lib de auth entra em produção sem sinal; MTTR alto quando a divulgação vira exploit ativo.
- **Dependências**: nenhuma — configuração de CI.

## 6. Notas do agente

- Delta é defensivo. Os dois pontos mais delicados — (a) chamada destrutiva `excluirBordero` e
  (b) short-circuit de `finalizarBordero` — usam fontes confiáveis para `filCod`/`borCod`
  (trilha/DB/resposta do próprio ERP) e passam pelo guard `requireOwnBorderoFilCod`. Não achei vetor
  novo para induzir exclusão/finalização cross-tenant ou vazamento de existência de borderô alheio.
- Métricas de infra (IAM, CloudTrail, GuardDuty, SSM SecureString) marcadas N/A: não há `infra/`
  neste repo (CLAUDE.md "Estado Atual vs. Alvo").
- Cross-QA: Audit Trail dos logs `BUSINESS_INFO`/`BUSINESS_WARN` novos (produtor e consumidor)
  também cobre **Fault Tolerance**; a ordem `guard → assertBorderoTemItens → POST` reduz
  **Availability** (menos POST fadado a `NÃO POSSUI ITENS` no ERP) — sinalizar ao consolidator.
