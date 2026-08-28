---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-28-1607
agent: qa-modifiability
generated_at: 2026-08-28T16:07:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time (Kavex) resolvendo uma nova frente financeira que também escreve no ERP e precisa auditar identidade | Nasce uma sexta *execution ledger* (`*_execucao`) — p.ex. estorno de baixa fin010, cancelamento de lote SISPAG, ou re-ativação da Frente I (`solicitacao_numerario`) | Trilha write-ahead que precisa persistir `conexos_username` + `conexos_usn_cod` para a auditoria I-2 continuar completa | Desenvolvimento em novo worktree, gates verdes obrigatórios (typecheck/lint/test/PatternGuardian) | Adicionar as duas colunas + `ConexosIdentityProvider` sem regressão, sem esquecer nenhum ponto | ≤ 1 dia de desenvolvimento, tripwire automático detecta ledger que ficou sem as colunas antes do merge |

Concreto neste delta: o mesmo bloco de ~20 linhas foi replicado em 5 repositórios (permuta, SN-recebimento, recebimento, remessa, conciliação) + migration `0051` com 5 blocos `ALTER TABLE` idênticos. Um 6º ledger existe no schema (`solicitacao_numerario`, ADR-0029 "desligado da UI") e **não** foi atualizado — hoje é inócuo (só dry-run), mas o fato de nada ter avisado sobre o *miss* é o sinal de modificabilidade que este relatório precisa quantificar.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ledgers `*Execucao` tocados pelo delta | 5 de 6 existentes no schema | 6/6 (ou justificativa registrada por ledger não coberto) | ⚠️ | `grep -rln "beginExecution" src/backend/domain/repository` + `grep -l "_execucao" src/backend/migrations/*.sql` |
| Δ LOC por ledger (linhas alteradas: +/-) | 22 / 22 / 22 / 20 / 27 | ≤ 15 se dedup, N/A caso permaneça inline | ⚠️ | `git diff main..HEAD -- <path> \| grep -E '^[+-]' \| grep -vE '^[+-]{3}' \| wc -l` |
| Ocorrências de `conexos_username` por ledger | 5 em cada (INSERT / VALUES / CASE WHEN CONFLICT / UPDATE settle / UPDATE fail) | ≤ 1 (uma spread de fragment) se dedup | ⚠️ | `grep -c 'conexos_username' <repo>.ts` |
| Ocorrências de `identityProvider.currentParams()` por ledger | 3 em cada (beginExecution, markSettled/settle, markError/fail) | 1 ou 0 (embutido no fragment) | ⚠️ | `grep -c 'identityProvider.currentParams' <repo>.ts` |
| Fan-in de `ConexosIdentityProvider` (arquivos de produção) | 5 (as 5 ledgers alteradas) | escala 1:1 com nº de ledgers — cada nova frente vira +1 | ⚠️ (esperado, mas sem tripwire) | `grep -rln "ConexosIdentityProvider" src/backend --include='*.ts' \| grep -v test` |
| Métodos em `ConexosSessionResolver.ts` (antes / depois) | 3 → 5 (+2 privados: `degradarParaRobo`, `avisarDegradacao`) | ≤ 7 antes de considerar Split Module | ✅ | `grep -cE "(public\|private) [a-zA-Z_]+ = " src/backend/domain/client/ConexosSessionResolver.ts` |
| LOC `ConexosSessionResolver.ts` (antes / depois) | 81 → 152 (+87%) | ≤ 400 (P95 saudável) | ✅ | `wc -l` + `git show main:...` |
| LOC do repositório mais denso do delta (`PermutaExecucaoRepository.ts`) | 479 | ≤ 400 (P95); >600 = Split Module | ⚠️ (pré-existente, delta soma 22) | `wc -l src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` |
| Warnings `noExcessiveCognitiveComplexity` no delta (limiar Biome = 15) | 0 | 0 | ✅ | `cd src/backend && npx biome check <7 arquivos do delta>` (Checked 7 files, 0 findings) |
| Warnings `noExcessiveCognitiveComplexity` no repo (baseline vs. delta) | 57 → 57 (0 novos) | 0 novos por delta | ✅ | `_shared-metrics.md` (idêntico ao baseline da `main`) |
| Fan-out de imports (arquivos do delta) | máx = 9 (`ConexosSessionResolver.ts`), média = 4.4 | ≤ 15 | ✅ | `grep -c '^import ' <arquivo>` |
| Tabelas `*_execucao` no schema (migrations) | 5 tocadas em `0051` + `solicitacao_numerario` (0032, Frente I SN, ADR-0029 "DESLIGADO DA UI") | 6/6 alinhadas, ou registro explícito do por-quê da 6ª ficar de fora | ⚠️ (comentário do serviço explica; migration 0051 não menciona) | `grep -l "_execucao\|solicitacao_numerario" src/backend/migrations/*.sql` |
| Testes por ledger cobrindo persistência da identidade | 5/5 nos ledgers tocados (arquivos `.test.ts` alterados no diff) | 5/5 | ✅ | `git diff main..HEAD --stat \| grep test` |
| Ciclos de dependência entre `ConexosIdentityProvider`, `SessionResolver`, `RequestContext` | 0 (grafo linear: repository → provider → context ← resolver) | 0 | ✅ | leitura manual dos 3 arquivos |
| Layer violations introduzidas pelo delta (`lambda→domain`, `handler→repo`) | N/A — runtime é Express, sem camada `lambda/`; delta é DDD-ready | 0 | ✅ | `CLAUDE.md §Estado Atual vs. Alvo` + inspeção dos paths tocados |

### 2.a Duplicação — anatomia dos 5 blocos ON CONFLICT (Δ do delta)

Padrão idêntico em `permuta_alocacao_execucao`, `solicitacao_numerario_execucao`, `recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao` (só o **nome da tabela** muda):

```sql
conexos_username = CASE WHEN <tabela>.status = 'settled'
               THEN <tabela>.conexos_username ELSE EXCLUDED.conexos_username END,
conexos_usn_cod = CASE WHEN <tabela>.status = 'settled'
               THEN <tabela>.conexos_usn_cod ELSE EXCLUDED.conexos_usn_cod END,
```

Cada uma das 5 ledgers contém **2 fragmentos SQL quase-idênticos** (o `CASE WHEN` acima em `beginExecution`, e o `COALESCE(<col>, $conexosUsername)` em `markSettled`/`markError`), **3 chamadas `...this.identityProvider.currentParams()`** e **2 colunas novas** no `INSERT`. Total: **~12 linhas × 5 arquivos = ~60 linhas de assinatura textual quase-idêntica** entrando na base ao mesmo tempo.

### 2.b Contraste com o padrão `executado_por` (pré-existente)

`executado_por` foi introduzido antes deste delta seguindo exatamente a mesma forma: coluna própria por ledger, `CASE WHEN status='settled'` para preservar, passado no spread do parâmetro. Ocorrências na `main` (antes do delta):

| Ledger | `executado_por` (main) | `conexos_username` (delta) |
|---|---|---|
| `PermutaExecucaoRepository.ts` | 9 | 5 |
| `SolicitacaoNumerarioExecucaoRepository.ts` | 9 | 5 |
| `RecebimentoExecucaoRepository.ts` | 5 | 5 |
| `RemessaExecucaoRepository.ts` | 6 | 5 |
| `ConciliacaoExecucaoRepository.ts` | 6 | 5 |

Leitura: o delta é **consistente** com o padrão vigente (não introduz uma forma nova), **e por isso mesmo compõe** um débito de duplicação que já existia. Cada nova coluna de auditoria com semântica de preservação em `settled` custará outras ~60 linhas de textualmente igual — projeção linear com o nº de ledgers.

### 2.c Top-10 arquivos por LOC no escopo do delta

O escopo é o delta, não o repo. Ordenação por LOC atual:

| # | Arquivo | LOC | Δ LOC (delta) |
|---|---|---|---|
| 1 | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` | 479 | +22 |
| 2 | `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts` | 384 | +22 |
| 3 | `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts` | 232 | +20 |
| 4 | `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts` | 180 | +27 |
| 5 | `src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.ts` | 163 | +22 |
| 6 | `src/backend/domain/client/ConexosSessionResolver.ts` | 152 | +71 (81 → 152) |
| 7 | `src/backend/domain/client/ConexosIdentityProvider.ts` | 56 | +56 (novo) |
| 8 | `src/backend/migrations/0051_execucao_identidade_conexos.sql` | 36 | +36 (novo) |
| 9 | `src/backend/domain/libs/requestContext/ConexosRequestContext.ts` | 32 | +13 |
| 10 | `src/backend/services/conexos.ts` (só o novo getter mostrado no diff) | +10 | +10 |

### 2.d Top fan-in de novos módulos (produção, testes excluídos)

| Módulo | Fan-in | Consumidores |
|---|---|---|
| `ConexosIdentityProvider` | 5 | 5 repositórios `*Execucao` alterados |
| `ConexosResolvedIdentity` (interface exportada em `ConexosRequestContext.ts`) | 2 | `ConexosSessionResolver`, `ConexosIdentityProvider` |
| `ConexosSessionResolver.avisarDegradacao` (privado, novo) | 2 chamadores intra-classe (`resolveForUser`) | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Nenhum split executado no delta. `ConexosSessionResolver` cresceu (+87% LOC, +2 métodos privados) mas ainda é coeso: todos os métodos giram em torno da mesma decisão (qual sessão Conexos usar). `PermutaExecucaoRepository.ts` chegou a 479 LOC — >P95 saudável de 400, mas o inflacionador é o *cache de borderôs* pré-existente, não o delta. | ⚠️ parcial | `ConexosSessionResolver.ts` L47-158; `PermutaExecucaoRepository.ts` L279-471 (cache borderôs) |
| **Increase Semantic Coherence** | `ConexosIdentityProvider` isola a leitura da identidade, deixando o `SessionResolver` só com a decisão de sessão e a publicação. `avisarDegradacao`/`degradarParaRobo` (privados novos) têm nomes que descrevem *o quê* + *por quê*, e cada um faz uma coisa só. | ✅ presente | `ConexosSessionResolver.ts:123-158`; `ConexosIdentityProvider.ts:33-56` |
| **Encapsulate** | Encapsulamento *bem-sucedido no ponto certo*: o SQL dos ledgers não toca `conexosRequestContext.getStore()` — chega até eles pronto via `identityProvider.currentParams()`. **Falha** onde o SQL em si se repete: cada ledger ainda escreve seus próprios fragmentos `CASE WHEN status='settled'` e `COALESCE(...)`. | ⚠️ parcial | `ConexosIdentityProvider.currentParams` (encapsulado); `PermutaExecucaoRepository.ts:217-224`, `RecebimentoExecucaoRepository.ts:57-64`, `ConciliacaoExecucaoRepository.ts:93-97` (SQL replicado) |
| **Use an Intermediary** | O `ConexosIdentityProvider` **é** o intermediário entre o `AsyncLocalStorage` (`conexosRequestContext`) e os repositórios: nenhum repositório importa o context store direto. Trocar o backing (p.ex. de `AsyncLocalStorage` para request-scoped DI) exige mexer só no provider. | ✅ presente | `ConexosIdentityProvider.ts:38-55`; `grep -rln "conexosRequestContext" src/backend/domain/repository` = 0 hits |
| **Restrict Dependencies** | Cadeia limpa: `Repository → IdentityProvider → conexosRequestContext ← SessionResolver`. Sem ciclo, sem *layer skipping* (repositórios continuam sem importar da camada de rotas/HTTP). Fan-out dos repositórios cresceu apenas +1 import cada (o provider). | ✅ presente | `grep -c '^import ' <cada repo>` = 3-5 imports |
| **Refactor** | Delta NÃO refatora a duplicação existente entre os 5 ledgers — só adiciona novo tecido no mesmo molde. O momento seria oportuno (mesma feature toca as 5 ao mesmo tempo), mas a decisão foi ganho de velocidade / baixo risco de regressão vs. extração. Válida, mas custa dívida futura. Ver F-modifiability-1. | ⚠️ parcial | Diffs dos 5 repositórios (padrão `CASE WHEN` copiado literalmente) |
| **Abstract Common Services** | *Não aplicada*. Uma `ExecucaoIdentityColumns` (fragmentos SQL parametrizados) ou uma helper `mergeIdentityParams` centralizando `{conexos_username, conexos_usn_cod}` + spread seria a extração natural — e reduziria as ocorrências de `identityProvider.currentParams()` de 15 (3×5) para 5. Não feito. Ver Card `modifiability-1`. | ❌ ausente | ausência de arquivo `Execucao*Helper*` em `src/backend/domain/repository` |
| **Defer Binding — DI / polymorphism** | `@singleton() @injectable()` no `ConexosIdentityProvider` + injeção construtor nos 5 ledgers. Mockável nos testes sem tocar `AsyncLocalStorage`. Consistente com a rule #7 do CLAUDE. | ✅ presente | `ConexosIdentityProvider.ts:29-32`; cada ledger `constructor(@inject(ConexosIdentityProvider) …)` |
| **Defer Binding — configuration / runtime** | Ausência de *magic numbers* introduzidos pelo delta. O único constante-de-domínio novo é o *label* `MotivoDegradacao = 'decrypt' \| 'login'` (union type discreto — correto, não é *magic string* solta). | ✅ presente | `ConexosSessionResolver.ts:24` |

## 4. Findings (achados)

### F-modifiability-1: Duplicação estrutural do bloco de identidade em 5 ledgers

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services / Encapsulate (parcial)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` L215-260, L279-306, L317-336; `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts` L100-152, L280-306, L317-338; `src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.ts` L51-83, L113-136, L143-166; `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts` L83-118, L177-200, L207-225; `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts` L80-114, L127-149, L155-166
- **Evidência (objetiva)**:
  ```
  Ocorrências por ledger:
    conexos_username     : 5 (INSERT + VALUES + 2 x CASE WHEN + UPDATE ... + UPDATE ... — mesmo formato em todos)
    conexos_usn_cod      : 5
    identityProvider.currentParams(): 3
  Total no delta            : 25 + 25 + 15 = 65 sítios textualmente equivalentes distribuídos por 5 arquivos.
  ```
- **Impacto técnico**: mudança futura de forma (p.ex. novo campo `conexos_sid`, nova regra de preservação, migração para `jsonb` `conexos_identity`) exige tocar 5 arquivos + 5 blocos SQL no mesmo commit — sem tripwire automático que garanta consistência entre eles. Regressão comum: um dos ledgers fica com forma antiga; a leitura mostra `NULL` só naquela frente e o defeito aparece no relatório de auditoria, semanas depois.
- **Impacto de negócio**: audibilidade "quem, no ERP, assinou esta escrita" é o remédio para o incidente 2026-08-25 (35 execuções assinadas pelo robô sem que ninguém soubesse). Se em 3 meses um ledger sair de forma com os outros por manutenção descuidada, o remédio deixa de funcionar naquela frente **silenciosamente** — repete a natureza do incidente que motivou o delta.
- **Métrica de baseline**: **60 linhas de SQL quase-idênticas** (~12 × 5), **15 chamadas** de `identityProvider.currentParams()` em 5 arquivos, **10 colunas** repetidas nos ALTER TABLE do `0051`.

### F-modifiability-2: Sexto ledger no schema (`solicitacao_numerario`) ficou fora da migration `0051`, sem tripwire

- **Severidade**: P2 (dormente hoje, ativa se o ADR-0029 for revertido)
- **Tactic violada**: Restrict Dependencies + Encapsulate (o schema não sabe que "toda `*_execucao` deve ter identidade")
- **Localização**: `src/backend/migrations/0051_execucao_identidade_conexos.sql` (cobre 5 tabelas); `src/backend/migrations/0032_solicitacao_numerario.sql` (tabela órfã); `src/backend/domain/repository/permutas/NumerarioExecucaoRepository.ts` (repositório sem `ConexosIdentityProvider`); `src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts` L38-56 (comentário ADR-0029 "DESLIGADO DA UI")
- **Evidência (objetiva)**:
  ```
  Tabelas *_execucao no schema: 6
    permuta_alocacao_execucao      (migration 0015) — coberta em 0051
    solicitacao_numerario          (migration 0032) — NÃO coberta em 0051
    recebimento_execucao           (migration 0035) — coberta em 0051
    solicitacao_numerario_execucao (migration 0041) — coberta em 0051
    remessa_execucao               (migration 0049) — coberta em 0051
    conciliacao_execucao           (migration 0050) — coberta em 0051

  NumerarioExecucaoRepository.ts:  0 imports de ConexosIdentityProvider
                                   0 ocorrências de conexos_username
  ```
- **Impacto técnico**: hoje o ledger está inerte (rota de dry-run experimental, sem POST real no ERP — comentário do próprio serviço admite: "NÃO VALIDADO EM PRODUÇÃO"). Amanhã, se o time reativar a Frente I SN sem lembrar de propagar `0051` a `solicitacao_numerario`, entra em produção uma frente que grava no ERP **sem** publicar identidade — repetindo exatamente o defeito de 2026-08-25.
- **Impacto de negócio**: baixo enquanto o ADR-0029 vigora, alto no instante em que for revertido. O risco não é *este* commit; é a **ausência de sinal** — nada no repo (nem lint, nem teste, nem doc de migration) chama atenção para essa tabela órfã. Um `/feature-tweak` futuro em SN Frente I pode passar por todos os gates verdes e ainda assim herdar o buraco.
- **Métrica de baseline**: **1 tabela em 6 (16.7%)** sem identidade capturada; **0 tripwires** (teste, lint, script de checagem) que detectariam a divergência.

### F-modifiability-3: Ausência de teste/checagem que valide "toda ledger de execução tem identidade Conexos"

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services (o invariante entre ledgers não é reificado em nenhum lugar do código)
- **Localização**: `src/backend/domain/repository/**` (nenhuma interface `ExecucaoLedgerRepositoryInterface` compartilhada); `src/backend/migrations/0051_execucao_identidade_conexos.sql` (sem seção "checklist de tabelas cobertas" nem teste que faça `SELECT column_name FROM information_schema.columns` cruzando `_execucao`)
- **Evidência (objetiva)**:
  ```
  find src/backend -name "*ExecucaoLedgerInterface*" -o -name "*Execucao*Base*"  → 0 arquivos
  grep -rln "information_schema.columns" src/backend                              → 0 hits
  ```
- **Impacto técnico**: F-modifiability-1 e F-modifiability-2 não são detectáveis por gate automatizado. A revisão humana (`Regis-Review` na `/feature-new`) é o único filtro — e se um `/feature-tweak` menor "esquecer" de rodar o gate ou passar em `--urgent`, o miss vai a produção.
- **Impacto de negócio**: o custo desta ausência escala com o número futuro de ledgers × probabilidade de um `/feature-tweak` que os toque sem passar por `Regis-Review`. Hoje 5 ledgers ativos + 1 dormente; roadmap tem "Frente III (Popula GED)" e "Conciliação de Recebimentos" ainda maturando — cada uma pode adicionar novas ledgers.
- **Métrica de baseline**: **0 testes** que enumerem tabelas `*_execucao` e verifiquem presença de `conexos_username`/`conexos_usn_cod`; **0 helpers/interfaces** compartilhadas para o padrão.

### F-modifiability-4: Complexidade de `ConexosSessionResolver` cresceu +87% em LOC, mas continua abaixo do limiar de Refactor

- **Severidade**: P3 (nota informativa — observação, não achado bloqueante)
- **Tactic violada**: nenhuma no momento; risco preventivo para Split Module se um 3º motivo de degradação surgir
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts` (152 LOC, antes 81; 5 métodos, antes 3)
- **Evidência (objetiva)**:
  ```
  Métodos:
    public resolve            (L47)   — decide sessão + cacheia
    public testarVinculo      (L67)   — teste explícito p/ login
    private resolveForUser    (L81)   — try decrypt / try login / degrada
    private degradarParaRobo  (L114)  — novo — publica identidade do robô
    private avisarDegradacao  (L124)  — novo — warn estruturado

  Biome: `noExcessiveCognitiveComplexity` (limiar 15) → 0 warnings nos 7 arquivos do delta
  ```
- **Impacto técnico**: sob controle *agora* — o resolver mantém uma única responsabilidade (decidir a sessão) e as duas privadas novas (`degradarParaRobo`, `avisarDegradacao`) reduzem o tamanho aparente de `resolveForUser`. Se surgir uma 3ª razão de fallback (p.ex. sessão do usuário revogada durante a request, ou timeout), a lógica atual em `resolveForUser` — 2 `try/catch` distintos, um por motivo — vira uma escadinha; será hora de considerar Split Module (extrair `ConexosSessionFallbackDecider`).
- **Impacto de negócio**: nenhum imediato; risco *preventivo*.
- **Métrica de baseline**: LOC 81 → 152 (+87.6%); métodos 3 → 5 (+66.6%); cognitive complexity Biome = 0 warnings (todas as funções ≤ 15).

## 5. Cards Kanban

### [modifiability-1] Extrair fragmento SQL de identidade Conexos em helper compartilhado dos ledgers

- **Problema**
  > O delta replicou textualmente ~60 linhas de SQL de identidade Conexos (`CASE WHEN status='settled' … END` e `COALESCE(conexos_username, $conexosUsername)`) em 5 repositórios `*Execucao`, mais 15 chamadas de `identityProvider.currentParams()`. Uma mudança futura de forma (novo campo, nova regra de preservação, migração para `jsonb`) exige tocar todos os 5 no mesmo commit — sem nada que garanta consistência entre eles. Repete estruturalmente o padrão pré-existente de `executado_por` (que já sofre da mesma duplicação), compondo o débito em vez de introduzí-lo.

- **Melhoria Proposta**
  > Aplicar **Abstract Common Services**: extrair um `ExecucaoIdentitySql` (ou similar) em `src/backend/domain/repository/_shared/` que exporte 3 fragmentos parametrizados — `insertColumns()`, `insertValues()`, `onConflictPreserve(tableName)`, `updateCoalesce()` — e um método `mergeParams(base, identity)`. Cada `beginExecution`/`markSettled`/`markError` compõe seus INSERTs/UPDATEs consumindo o helper. Alternativa mais radical (rejeitar por ora): interface `IExecucaoLedger` + template method — leaky abstraction, pois cada ledger tem colunas materialmente diferentes.

- **Resultado Esperado**
  > 5 sítios de `CASE WHEN status='settled'` → 1 função pura testada isoladamente. Nova coluna de auditoria custa 1 edição em vez de 5. Ocorrências de `identityProvider.currentParams()` caem de 15 → ≤ 5. `PermutaExecucaoRepository.ts` sai de 479 LOC para <460 (o efeito é modesto, mas centraliza o *ponto de mudança*).

- **Tactic alvo**: Abstract Common Services / Encapsulate
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — inclui refatorar `executado_por` no mesmo helper para não introduzir duas convenções)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Linhas SQL duplicadas de identidade (`grep -c 'conexos_username' src/backend/domain/repository/**/*Execucao*.ts` somado): 25 → ≤ 5
  - Chamadas de `identityProvider.currentParams()`: 15 → ≤ 5
  - Nova ledger custa (LOC no repo novo referente a identidade): ~22 hoje → ≤ 5
- **Risco de não fazer**: cada nova frente financeira soma mais ~22 LOC de duplicado por ledger e amplia a superfície de "esquecer um deles". O incidente que motivou o delta foi exatamente uma execução silenciosamente assinada errado — se em 6 meses um ledger sair de forma, o remédio deixa de funcionar naquela frente sem alarme.
- **Dependências**: nenhuma; pode entrar como próximo `/feature-tweak` sobre a mesma família de arquivos.

### [modifiability-2] Adicionar tripwire de schema — teste que exige `conexos_username`/`conexos_usn_cod` em toda tabela `*_execucao`

- **Problema**
  > O schema tem 6 tabelas `*_execucao` (5 cobertas pelo `0051` + `solicitacao_numerario` da Frente I SN, ADR-0029 "desligada da UI"). Nada no repo — nem teste, nem lint, nem checagem de migration — chama atenção para a divergência. Se o ADR-0029 for revertido, ou se um `/feature-tweak` futuro adicionar uma 7ª ledger, a probabilidade de reintroduzir o defeito de 2026-08-25 (execução no ERP sem identidade capturada) é alta e **silenciosa**.

- **Melhoria Proposta**
  > Novo teste em `src/backend/domain/repository/_shared/execucaoIdentitySchema.test.ts` que:
  >   1. faz `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%\_execucao' OR table_name = 'solicitacao_numerario'`;
  >   2. para cada uma, exige `conexos_username TEXT` + `conexos_usn_cod TEXT` (ou registra a tabela em uma allowlist com justificativa por ADR).
  > O teste roda contra o Postgres local (docker) do CI, não contra produção. Se falhar, mensagem explícita: "Tabela X não tem identidade Conexos — cobrir em nova migration ou justificar em `_shared/execucaoIdentitySchema.allowlist.ts`".

- **Resultado Esperado**
  > Divergência de schema entre ledgers vira erro no `npm test` — mesma família de gate que `PatternGuardian` para DDD. Uma tabela nova sem identidade **não passa em verde**. F-modifiability-2 fica coberto por default para qualquer *feature-tweak* futuro.

- **Tactic alvo**: Encapsulate (reifica o invariante) + Restrict Dependencies (o gate vive junto do helper)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-2, F-modifiability-3
- **Métricas de sucesso**:
  - Tabelas `*_execucao` cobertas por identidade Conexos: 5/6 (83%) → 6/6 (100%) OU allowlist explícita com ADR
  - Tripwires automatizados: 0 → 1 teste rodando em CI
  - Tempo médio para detectar uma nova ledger sem identidade: hoje = "quando estourar em produção"; alvo = "no `npm test` do PR"
- **Risco de não fazer**: reincidência do incidente de 2026-08-25 no instante em que a Frente I SN for religada ou uma nova frente entrar. O time paga o custo humano da revisão manual em toda `/feature-new` — a `Regis-Review` funciona, mas depende do agent ser acionado; um `--urgent` fura o gate.
- **Dependências**: `modifiability-1` (o helper compartilhado é o lugar natural do teste)

### [modifiability-3] Decidir o destino do `NumerarioExecucaoRepository` (Frente I SN) — retirar ou alinhar

- **Problema**
  > `NumerarioExecucaoRepository` + `GerarSolicitacaoNumerarioService` da Frente I estão marcados `⚠️ DESLIGADO DA UI — NÃO VALIDADO EM PRODUÇÃO` (ADR-0029, 2026-08-05), mas continuam no repositório, cobertos por testes, resolvidos pelo DI container (`recebimentosContainer.ts`) e servidos por uma rota (`POST /permutas/adiantamentos/:docCod/gerar-numerario`). Este delta **não** os atualizou — corretamente, dado o ADR — mas o resultado é que dois padrões coexistem: 5 ledgers com identidade Conexos + 1 sem. Nada nomeia esta assimetria de forma acionável.

- **Melhoria Proposta**
  > Decisão binária:
  > **(a) Retirar** — se a Frente I SN não voltará antes de 6 meses: remover o serviço, o repositório, a rota, o container e a tabela `solicitacao_numerario` num `/feature-tweak` de *cleanup*. ADR-0029 vira "SN Frente I removida; se retornar, nasce nova do zero".
  > **(b) Alinhar** — se a Frente I SN pode voltar: emitir migration `0052` propagando identidade a `solicitacao_numerario`, injetar `ConexosIdentityProvider` no repositório, e atualizar o comentário do serviço para "desligada da UI, mas alinhada ao padrão I-2".
  > Não fazer nada é o pior dos três: o débito cresce silenciosamente porque o schema fica órfão.

- **Resultado Esperado**
  > Tabelas `*_execucao` no schema convergem para "todas com identidade Conexos" ou "todas justificadas". F-modifiability-2 fica resolvido factualmente (não só por tripwire). Custo de reativar Frente I passa a ser 0 no eixo *modifiability*.

- **Tactic alvo**: Refactor / Split Module (opção a — remover) OU Increase Semantic Coherence (opção b — alinhar)
- **Severidade**: P3
- **Esforço estimado**: S (opção a: ≤1d) / M (opção b: 2-3d — inclui migração + testes)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Tabelas `*_execucao` sem identidade Conexos: 1 → 0
  - Repositórios que gravam em ledger sem `ConexosIdentityProvider`: 1 → 0
- **Risco de não fazer**: se o ADR-0029 for revertido em um `/feature-tweak` que não passe por Regis-Review completo, entra em produção uma frente escrevendo no ERP sem identidade — repetindo o defeito de 2026-08-25 com o agravante "sabíamos que estava assim".
- **Dependências**: precisa de decisão de produto (Frente I SN vai voltar?). Recomendo levantar na próxima sprint planning.

## 6. Notas do agente

- **Cross-QA — Testability**: F-modifiability-3 (tripwire de schema) é 100% da família **Testability** (reificar invariante em teste executável). Alertar o consolidator para não abrir card duplicado sob Testability; a linkagem já está aqui.
- **Cross-QA — Integrability**: F-modifiability-1 (fragmento SQL compartilhado) coincide com **Encapsulate**, tactic que a Integrability também usa para reduzir *coupling* — mas aqui a preocupação é *change ripple*, não interoperabilidade. Deixar como Modifiability.
- **Cross-QA — Deployability**: F-modifiability-2 (tabela órfã no schema) tangencia Deployability porque a migration `0051` fica "quase" cobrindo o schema. Se Deployability quiser abrir card sobre *migration linter*, meu Card `modifiability-2` cobre o mesmo problema por outro ângulo (teste vs. lint) — sinalizar consolidação.
- **Escopo respeitado**: análise restrita ao delta (2 commits sobre `617ca3b`), não ao repo inteiro. LOC/complexidade globais reportados só quando o arquivo tocado é o próprio "container" do débito.
- **Nota do enunciado**: o prompt disse "resolver went from 3 methods to 6". Contagem real na branch = 3 → 5 (`grep -cE "(public\|private) [a-zA-Z_]+ = " ConexosSessionResolver.ts`; ver `git show main:...` vs. HEAD). Reportei o número medido; não muda a conclusão (cresceu de forma cohesiva, sem estourar Biome).
