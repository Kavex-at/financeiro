---
qa: Security
qa_slug: security
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-security
generated_at: 2026-09-22T20:19:18Z
scope: backend + frontend (delta da feature, `--quick`)
score: 8
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticada (ou um ator que forjou/roubou o bearer token dela) | Envia `POST /sispag/lotes/:id/remessa` com `dataDebito` fora da janela `[hoje BRT, menor vencimento] ∩ dias úteis`, ou reenvia a mesma requisição depois que o lote nativo já nasceu no fin015 com outra data | `RemessaService.gerarRemessa` → `DebitDateService` → `ConexosSispagWriteClient.criarLote` (escreve `flpDtaCredito` no ERP, dispara dinheiro) | Produção, lote `FINALIZADO`, `conexosWriteEnabled=true` | O backend recusa a data **antes** de qualquer chamada ao ERP (I8a) e recusa reescrever a data de um lote nativo já criado (I8b) — o ledger fica intocado nos dois casos | 0 escritas no fin015 com uma `dataDebito` fora da janela ou divergente da congelada; erro 422/409 com `code` estável para a tela |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `grep -nE "(password\|secret\|token\|api[_-]?key\|credential)\s*[:=]\s*['\"][^'\"]{8,}"` e `grep -nE "AKIA[0-9A-Z]{16}"` sobre os 33 arquivos do delta — 0 ocorrências |
| Sítios de SQL não-parametrizado no delta | 0 | 0 | ✅ | `LotePagamentoRepository.setDataDebito` (linha 498) usa `$dataDebito::date`/`$loteId` nomeados; `getLoteComItens`/`listLotes` idem com `to_char(...)` |
| Endpoints novos com validação Zod no boundary | 1/1 (`dataDebito` em `POST /lotes/:id/remessa`) | 100% | ✅ | `src/backend/routes/sispag.ts:426-438` (`civilDateSchema`, `gerarRemessaSchema`) |
| Validação de domínio (janela/congelamento) antes de qualquer escrita | Presente | Presente | ✅ | `DebitDateService.validate` (linha 112) chamado em `RemessaService.resolverDataDebito` (linha 1047) **antes** do bloco de escrita (`criarLote`, linha ~455 do serviço) |
| `dangerouslySetInnerHTML`/`innerHTML` no delta frontend | 0 | 0 | ✅ | `grep -n "dangerouslySetInnerHTML\|innerHTML"` sobre `GerarRemessaDialog.tsx`, `LoteCard.tsx`, `sispag.ts`, `page.tsx` — 0 ocorrências |
| Token em `localStorage`/`sessionStorage` no delta frontend | 0 | 0 | ✅ | mesma varredura; `sispagRequest` usa `withAuthHeaders` (bearer via helper existente, não tocado neste delta) |
| Rota nova exige autenticação (JWT) | 2/2 (`GET .../janela` e `POST .../remessa`, este último já existia) | 100% | ✅ | `routes/sispag.test.ts` — teste novo "exige autenticação, como as outras leituras de lote" (401 sem token) |
| Rota nova exige `requireRole('admin')` | 1/2 (só a de escrita `POST .../remessa`; a leitura `GET .../janela` segue o padrão de leitura sem role) | — | ⚠️ ver F-security-2 | `routes/sispag.ts:440-457` |
| Papéis efetivos em produção (RBAC) | 1 (`app_user.role DEFAULT 'admin'` — todo usuário nasce admin) | ≥2 (analista vs. admin) | ⚠️ pré-existente, herdado por este delta | `routes/sispag.test.ts:42-44` (comentário do próprio time: "hoje todo usuário nasce `admin`... na prática o `requireRole('admin')` não separa ninguém em produção") |
| Audit trail persistido da escrita financeira desta feature | `remessa_execucao.executado_por` (quem) + `remessa_execucao.request_payload.dataDebito` (o quê, no encoding ERP) + `lote_pagamento.data_debito` (o quê, data civil) + `atualizado_em`/`criado_em` (quando) | Presente, campos who/what/when | ✅ | `RemessaExecucaoRepository.ts:80-92,161`; `LotePagamentoRepository.setDataDebito` (linha 498); `RemessaService.ts:429-441` |
| Idempotência da escrita (`Idempotency-Key`) | Honrado; sem header, chave derivada do lote | Presente | ✅ | `routes/sispag.ts` (comentário "duas tentativas colidem de propósito") — comportamento não alterado por este delta, mas o novo `dataDebito` entra na assinatura da marca d'água (`ledger.setRequestPayload`) antes do `criarLote` |
| CSRF em rota mutante nova | N/A | — | ✅ N/A | Auth é bearer JWT (`Authorization: Bearer`), não cookie — CSRF clássico não se aplica; nenhuma mudança de modelo de auth neste delta |
| `npm audit` (dependências novas) | Nenhuma dependência nova (`BankingCalendar` é cálculo puro, sem lib) | — | ✅ N/A | `git diff --stat` não toca `package.json`/`package-lock.json` em nenhum lado |
| Infra (IAM, CloudTrail, GuardDuty, SSM, cross-account) | Não medível | — | ⚠️ Não medível localmente | `infra/` não existe neste repositório (CLAUDE.md: "Atual: Render/Supabase, sem infra/"); Terraform multi-tenant é estado-alvo, não tocado por este delta |

## 3. Tactics — Cobertura no delta desta feature

| Tactic (Bass) | Implementação atual (neste delta) | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Não tocado por este delta; CloudTrail/GuardDuty são estado-alvo (`infra/` inexistente) | N/A | CLAUDE.md — infra atual é Render/Supabase |
| Detect Service Denial | Não tocado; `heavyRouteLimiter` aplicado à rota de escrita existente (`POST .../remessa`) não mudou; a rota nova de leitura (`GET .../janela`) é barata (um `SELECT` + aritmética de calendário, sem loop dependente de input do atacante) | ✅ (herdado) | `routes/sispag.ts:459` (`heavyRouteLimiter` já presente); `DebitDateService.computeWindow` itera só sobre `[min,max]` calculado a partir do vencimento real do título, não de input do request |
| Verify Message Integrity | I8b: a `dataDebito` compõe a marca d'água (`ledger.setRequestPayload`) gravada antes do `criarLote`; um retry com data diferente da persistida é **recusado**, não ignorado | ✅ presente | `RemessaService.resolverDataDebito` (linha 1047), `DebitDateFrozenError` |
| Detect Message Delay | Idempotency-Key + janela `dataDebito ≥ hoje` — uma tentativa "atrasada" (retomada no dia seguinte) com data congelada no passado é detectada e bloqueada (fail-closed) em vez de silenciosamente enviar uma data vencida ao ERP | ✅ presente | `resolverDataDebito`, motivo `MOTIVO_CONGELADA.NO_PASSADO` |
| Identify Actors | `ator(req)` deriva de `req.user.sub`/`email` do JWT verificado (não tocado por este delta, mas todo novo ponto de escrita o usa) | ✅ presente (herdado) | `routes/sispag.ts` — `const ator = (req) => req.user?.sub ?? req.user?.email ?? 'unknown'` |
| Authenticate Actors | `buildAuthMiddleware` (JWT Supabase) — não tocado; a rota nova `GET .../janela` passa pelo mesmo middleware global | ✅ presente (herdado) | `routes/sispag.test.ts` — teste novo confirma 401 sem token |
| Authorize Actors | `requireRole('admin')` na rota de escrita (retido); a rota de leitura nova não exige role, seguindo o padrão das demais leituras de lote — mas RBAC é hoje um no-op em produção (todo usuário é `admin`) | ⚠️ parcial | `routes/sispag.test.ts:42-44`; ver F-security-1 |
| Limit Access | Escrita financeira (criar lote nativo, mover a data de débito) restrita a `admin`; leitura da janela (nome do credor + documento do título limitante) aberta a qualquer autenticado — mesmo padrão de `GET /lotes/:id`, mas diverge do padrão mais estrito aplicado a `/linhas-digitaveis` e `/remessa/arquivo` (dados bancários do fornecedor) | ⚠️ parcial | Ver F-security-2 |
| Limit Exposure | Nenhum dado novo de CNPJ/conta bancária é exposto por este delta — só data civil, nome do credor (já exposto em outras rotas) e código do documento | ✅ presente | `SispagInterface.ts` (`TituloLimitante`) |
| Encrypt Data | Não tocado por este delta (Postgres/Supabase gerenciado); coluna nova (`data_debito DATE`) não é dado sensível de per se | N/A | `migrations/0061_lote_data_debito.sql` |
| Separate Entities | Cálculo de calendário isolado em `BankingCalendar` (`@singleton @injectable`), sem acoplar `RemessaService` a I/O externo novo | ✅ presente | `BankingCalendar.ts` |
| Change Default Settings | `dataDebito` ausente = primeiro dia útil da janela (nunca "hoje" cego); erro explícito em vez de fallback silencioso quando a janela está vazia | ✅ presente | `DebitDateService.resolve` (linha 152) |
| Validate Input | `civilDateSchema` (forma) + `DebitDateService.validate` (regra de negócio, servidor, antes de qualquer escrita) — validação em duas camadas | ✅ presente | `routes/sispag.ts:426-438`; `DebitDateService.ts:112-140` |
| Revoke Access | Não tocado por este delta (fora de escopo — sessão/token não muda aqui) | N/A | — |
| Lock Computer | Não aplicável a este domínio (API server-to-server/SPA, sem sessão de terminal) | N/A | — |
| Inform Actors | Erros de domínio (`DebitDateOutsideWindowError`, `DebitDateFrozenError`) carregam `code` HTTP estável e mensagem operacional em português, consumidos pelo frontend (`sispag.ts`) para toasts específicos | ✅ presente | `DebitDateOutsideWindowError.ts`, `DebitDateFrozenError.ts`, `frontend/lib/sispag.ts` (`if (body.code === 'DATA_DEBITO_...')`) |
| Restore | Fora do escopo direto; a falha "data congelada no passado" tem saída documentada (cancelar o lote nativo no fin015) — não é auto-restore, é caminho humano conhecido | ✅ parcial (ver Fault Tolerance) | `data-debito-remessa-sispag.md`, seção "Caso que a regra não resolve sozinha" |
| Audit Trail | `dataDebito` escolhida persiste em `lote_pagamento.data_debito` **antes** do `criarLote`; `remessa_execucao.executado_por` + `request_payload` registram quem/quando/o quê da tentativa de escrita | ✅ presente | `LotePagamentoRepository.setDataDebito`; `RemessaExecucaoRepository.ts:80-92` |

## 4. Findings (achados)

### F-security-1: RBAC não separa ninguém em produção — o novo parâmetro de escrita financeira (`dataDebito`) herda esse gap

- **Severidade**: P2 (débito técnico defensável — condição pré-existente, não introduzida por este delta, mas diretamente relevante para o blast radius da nova capacidade de escrita)
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/routes/sispag.test.ts:42-44` (evidência documentada pelo próprio time); `src/backend/routes/sispag.ts:459` (`requireRole('admin')` na rota que este delta estende com `dataDebito`)
- **Evidência (objetiva)**:
  ```
  * Auth falsa. NOTA: hoje todo usuário nasce `admin` (`app_user.role DEFAULT 'admin'`,
  * decisão explícita do produto), então na prática o `requireRole('admin')` não separa
  * ninguém em produção. Estes testes exercitam o gate mesmo assim...
  ```
- **Impacto técnico**: `requireRole('admin')` continua correto como mecanismo, mas com um único papel possível em produção ele não reduz o conjunto de atores que podem chamar `POST /sispag/lotes/:id/remessa` com uma `dataDebito` arbitrária (dentro da janela) — qualquer usuário autenticado da Columbia é, de fato, admin.
- **Impacto de negócio**: o próprio propósito do RBAC descrito como requisito cross-cutting da proposta (SSO corporativo + RBAC) não está em vigor; um usuário autenticado sem responsabilidade financeira pode escolher a data de débito e disparar a remessa.
- **Métrica de baseline**: 1 papel efetivo em produção (`admin`) para N usuários; alvo ≥2 papéis (ex.: `viewer`/`analista` vs. `admin`).

### F-security-2: `GET /sispag/lotes/:id/remessa/janela` (rota nova) expõe credor e documento do título limitante sem `requireRole`, inconsistente com o padrão de proteção já aplicado a dados de fornecedor nesta mesma área

- **Severidade**: P3 (hardening — mesma exposição já existe em `GET /lotes/:id`, então não é uma regressão de superfície nova, mas é uma oportunidade de alinhar com o padrão mais estrito das rotas irmãs)
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/routes/sispag.ts:440-457` (rota nova, sem `requireRole`) vs. `src/backend/routes/sispag.ts` — `/lotes/:id/linhas-digitaveis` e `/lotes/:id/remessa/arquivo` (ambas com `requireRole('admin')` e comentário explícito citando LGPD Art. 6º / LC 105)
- **Evidência (objetiva)**:
  ```ts
  router.get(
      '/lotes/:id/remessa/janela',
      asyncHandler(async (req, res) => {
          await bootstrapAppContainer();
          const service = container.resolve(DebitDateService);
          ...
  ```
  (nenhum `requireRole` na linha 443, contra `requireRole('admin')` nas rotas irmãs de dados de fornecedor)
- **Impacto técnico**: `JanelaDataDebito.limitante` devolve `credor` (nome do favorecido) e `documento` (`docCod/titCod`) do título que define o teto da janela — dado de fornecedor, ainda que menos sensível que CNPJ/conta bancária.
- **Impacto de negócio**: pequeno hoje (a mesma informação já sai de `GET /lotes/:id`, que também não exige `admin`), mas se a rota `/lotes/:id` algum dia ganhar `requireRole` (fechando esse outro gap), a rota nova ficaria como o elo mais fraco sem que ninguém tenha decidido isso deliberadamente.
- **Métrica de baseline**: 1 rota nova de leitura de dado de fornecedor sem `requireRole`, contra 2 rotas irmãs (`/linhas-digitaveis`, `/remessa/arquivo`) que exigem.

## 5. Cards Kanban

### [security-1] Provisionar um segundo papel RBAC real (`viewer`/`analista`) antes do próximo cliente

- **Problema**
  > Todo usuário nasce com `role='admin'` no Postgres (`app_user.role DEFAULT 'admin'`), então o `requireRole('admin')` que já guarda `POST /sispag/lotes/:id/remessa` — inclusive o novo parâmetro `dataDebito` desta feature — não separa ninguém em produção hoje. O próprio time documentou isso no comentário de teste de `routes/sispag.test.ts:42-44`.

- **Melhoria Proposta**
  > Definir e provisionar pelo menos um segundo papel (`viewer`/`analista`) com escrita financeira restrita, alinhado ao requisito cross-cutting de RBAC da proposta (Authorize Actors, Bass). Não é escopo desta feature reescrever o modelo de auth — é um card de trilha própria que a `dataDebito` deixa mais urgente, porque aumenta o número de decisões de negócio (qual data) que um "admin" universal pode tomar sozinho.

- **Resultado Esperado**
  > `requireRole('admin')` volta a separar atores de fato: papéis efetivos em produção 1 → ≥2, com pelo menos uma rota de escrita SISPAG comprovadamente recusando um usuário `viewer`.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Papéis efetivos em produção: 1 → ≥2
  - Teste de integração que prova `role='viewer'` recebendo 403 em `POST /sispag/lotes/:id/remessa`: ausente → presente
- **Risco de não fazer**: em 6 meses, com mais clientes e mais analistas na mesma conta, qualquer credencial vazada ou reaproveitada dentro da empresa move dinheiro sem que o RBAC ofereça qualquer atrito — o controle existe só no papel.
- **Dependências**: nenhuma bloqueante; pode andar em paralelo a outras features SISPAG.

### [security-2] Alinhar `GET /lotes/:id/remessa/janela` ao padrão de proteção das rotas de dado de fornecedor

- **Problema**
  > A rota nova desta feature devolve `credor` e `documento` do título limitante sem `requireRole`, enquanto as rotas irmãs que tocam dado de fornecedor (`/linhas-digitaveis`, `/remessa/arquivo`) exigem `admin` explicitamente, citando LGPD Art. 6º / LC 105 no próprio código.

- **Melhoria Proposta**
  > Adicionar `requireRole('admin')` em `GET /lotes/:id/remessa/janela` (Limit Access, Bass), ou — se a decisão de produto for manter leituras de lote abertas a qualquer autenticado — documentar essa decisão no mesmo lugar onde as rotas irmãs documentam o oposto, para que a próxima pessoa não trate a assimetria como acidente.

- **Resultado Esperado**
  > As três rotas que tocam identidade de fornecedor dentro de `/sispag/lotes/:id/*` seguem a mesma política de acesso, documentada num único lugar.

- **Tactic alvo**: Limit Access
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Rotas de dado de fornecedor sob `/sispag/lotes/:id/*` com política de acesso documentada e consistente: 2/3 → 3/3
- **Risco de não fazer**: baixo agora (mesma exposição já existe em `GET /lotes/:id`); cresce se outras rotas de leitura endurecerem sem que esta acompanhe, virando um esquecimento acumulado.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estritamente o delta (`git diff origin/main...HEAD`) da feature `sispag-data-pagamento`; achados de segurança em código não tocado por este delta (ex.: `filialAuthz.ts` não é usado em `sispag.ts`, RBAC uniforme) são citados como **contexto necessário** para avaliar o blast radius da nova escrita, não como regressão desta feature.
- `--quick`: sem `npm audit` (nenhuma dependência nova de qualquer forma) e sem cobertura de teste.
- Infra multi-tenant (IAM, CloudTrail/GuardDuty, SSM, cross-account) é estado-alvo e não existe neste repositório — todas as tactics de infra estão marcadas N/A, não "ausentes".
- Cross-QA: F-security-1 (Authorize Actors) e F-security-2 (Limit Access) são os mesmos vetores que Availability chamaria de blast radius; Audit Trail (seção 3) sobrepõe achados de Fault Tolerance sobre a mesma `remessa_execucao`.
