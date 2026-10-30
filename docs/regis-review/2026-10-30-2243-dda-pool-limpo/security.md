---
qa: Security
qa_slug: security
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-security
generated_at: 2026-10-30T22:43:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 2
---

# Security — Regis-Review

Escopo: só o diff não commitado da feature `dda-pool-limpo` (consolidação de cópias de boletos DDA +
situações `FORA_JANELA` / `TITULO_SAIU_CARTEIRA`). Infra (SSM, IAM, API Gateway, CloudTrail) não existe
no repo (Render + Supabase hoje) — não é avaliável neste diff e segue para `_shared-metrics`.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado (analista) ou atacante com sessão válida | GET `/sispag/boletos-dda` com query crafted (SQL injection, enum injection, enumeração de títulos inativos) | `routes/sispag.ts` → `BoletoDdaService.listar` → `TituloAPagarRepository.listInativosRecentes` + payload `copias[]` / `titulosSaidos[]` | Produção multi-filial, dados do Conexos; permissão `sispag:ver` concedida a analistas | Zod rejeita query inválida (400); SQL `WHERE ativo = FALSE AND vencimento BETWEEN $de AND $ate` roda só com parâmetros ligados; payload só expõe credor/valor de títulos já visíveis para `sispag:ver` noutras abas | 0 SQL interpolado, 0 campo novo não validado, 0 novo dado sensível exposto além do já disponível à mesma role |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded introduzidos | 0 | 0 | ✅ | `git diff` do escopo — nenhuma string de credencial |
| Arquivos `.env`/`.tfstate` adicionados | 0 | 0 | ✅ | `_shared-metrics.md` (arquivos tocados) |
| SQL novo com string-interpolation | 0 | 0 | ✅ | `TituloAPagarRepository.ts:249-266` — usa `$de`/`$ate` via `selectMany(query, params)` |
| Rotas novas sem autorizador | 0 | 0 | ✅ | Rota reusada `/sispag/boletos-dda` já tem `exigirPermissao(PERMISSION.SISPAG_VER)` (`routes/sispag.ts:1593`) |
| Endpoints novos com validação Zod em boundary | 1/1 | 100% | ✅ | `boletosDdaSchema` em `routes/sispag.ts:1545-1587` (schema reusado; novo enum coberto via `SITUACOES_FILTRAVEIS`) |
| Enum `BoletoDdaSituacao` novo coberto no Zod da rota | 2/2 (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`) | 100% | ✅ | `SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO)` em `PaginacaoBoletoDda.ts:410` |
| `dangerouslySetInnerHTML` introduzidos no diff | 0 | 0 | ✅ | `git diff src/frontend` — nenhum match |
| Logs novos de valor de segredo | 0 | 0 | ✅ | Diff não toca `LogService`/`console.log` com credencial |
| IAM policy wildcard introduzida | N/A | — | ✅ | Não há `infra/` neste repo (bootstrap pré-Terraform) |
| CORS alterado | 0 | — | ✅ | Diff não toca middleware CORS |
| `# critical/high npm audit` novos | ⚠️ Não medível localmente | 0/0 | ⚠️ | O diff não altera `package.json`; auditoria completa fora do escopo deste review |

Métricas não medíveis declaradas:
> ⚠️ **Não medível localmente**: CloudTrail/GuardDuty/API Gateway authorizers/least-privilege IAM. Requer `infra/` Terraform (ausente). Recomendação: tratar quando a frente SaaSo materializar `infra/tenants/`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do escopo do diff | N/A | diff não adiciona superfície pública |
| Detect Service Denial | Paginação enforce (`BOLETO_DDA_TAMANHO_MAX`); `listInativosRecentes` restringe por intervalo fechado `[de, ate]` (10+15 .. 10+45 dias) → limita cardinalidade | ✅ presente | `TituloAPagarRepository.ts:249-266`, `BoletoDdaService.ts:139-144` |
| Verify Message Integrity | N/A — read-only, sem canal novo | N/A | — |
| Detect Message Delay | N/A | N/A | — |
| Identify Actors | Herdado da rota: `exigirPermissao` lê sessão autenticada | ✅ presente | `routes/sispag.ts:1593` |
| Authenticate Actors | Herdado — autenticação já exigida antes do `exigirPermissao` | ✅ presente | middleware da rota (fora do diff) |
| Authorize Actors | `PERMISSION.SISPAG_VER` cobre todo o novo payload (`copias`, `titulosSaidos`). Decisão deliberada (ADR-0053) de manter `ver` como gate dos boletos DDA | ✅ presente | `routes/sispag.ts:1593` |
| Limit Access | Rota continua paginada; novas situações não abrem novo path | ✅ presente | `PaginacaoBoletoDda.ts:235-260` |
| Limit Exposure | `titulosSaidos` fica escondida da lista padrão e NÃO entra em `contagem.todas`/`totais.todas` — reduz enumeração acidental de títulos inativos | ✅ presente | `PaginacaoBoletoDda.ts:70-74, 236-242, 354-365` |
| Encrypt Data | Transporte/at-rest fora do diff | N/A | — |
| Separate Entities | N/A — não há cross-tenant neste caminho | N/A | — |
| Change Default Settings | N/A | N/A | — |
| Validate Input | `boletosDdaSchema` Zod cobre toda query; `situacao`/`situacoes` validadas contra `z.enum(SITUACOES_FILTRAVEIS)` que já inclui os novos valores (gerados por `Object.values`); `vencimentoDe/Ate` com regex estrito | ✅ presente | `routes/sispag.ts:1545-1587`, `PaginacaoBoletoDda.ts:410` |
| Revoke Access | N/A — não altera sessão | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | N/A | N/A | — |
| Restore | N/A — read path | N/A | — |
| Audit Trail | Rota read-only; não há ação mutadora nova para auditar | N/A | leitura — não há mutação financeira introduzida |

## 4. Findings (achados)

### F-security-1: `titulosSaidos` revela credor + valor de títulos inativos (quitados/cancelados/renegociados) para toda role `sispag:ver`

- **Severidade**: P3 (baixo — melhoria defensiva; não é regressão)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:230-266` (saiuDaCarteira), `src/backend/domain/interface/sispag/BoletoDda.ts:131-133` (payload)
- **Evidência (objetiva)**:
  ```
  // ConsolidacaoBoletoDda.ts:239-250
  .map((s) => ({
      filCod: s.titulo.filCod, docCod: s.titulo.docCod, titCod: s.titulo.titCod,
      ...(s.titulo.credor ? { credor: s.titulo.credor } : {}),
      valor: s.titulo.valor, vencimento: s.vencimento,
      diferencaDias: this.diasEntre(s.vencimento, vencimento),
      deltaValor: (valor - s.centavos) / 100,
  }))
  ```
- **Impacto técnico**: credor/valor/vencimento de títulos já saídos do fin064 (cancelados, previsão, renegociados) são retornados por boleto DDA para quem tem `sispag:ver`. A categoria "inativo" é mais ampla que "quitado": inclui cancelado e previsão.
- **Impacto de negócio**: baixa — a mesma role já vê esses títulos em outras abas (`sispag:ver` cobre todo o painel). O achado só vale como lembrete: se a Columbia introduzir uma role somente-DDA no futuro, este payload passa a vazar.
- **Métrica de baseline**: 1 campo novo (`titulosSaidos.credor`) exposto; 0 roles afetadas hoje. Baseline qualitativo: não há regressão de granularidade de autorização neste release.

### F-security-2: `copias[].arquivo` expõe o nome do arquivo fin124 original (metadado de ingestão) no payload de leitura

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/interface/sispag/BoletoDda.ts:95-101`, `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:342-350`
- **Evidência (objetiva)**:
  ```
  copias: outras.map((c) => ({
      ddcCod: c.ddcCod, ditCod: c.ditCod,
      ...(c.arquivo ? { arquivo: c.arquivo } : {}),
      ...(c.importadoEm != null ? { importadoEm: c.importadoEm } : {}),
  })),
  ```
- **Impacto técnico**: nome do arquivo original do fin124 é retornado ao cliente para N cópias. Já era exposto na linha representante antes do diff (campo `arquivo` em `BoletoDdaConsolidado`); o diff só o duplica para as outras cópias — não é nova classe de dado.
- **Impacto de negócio**: ínfimo. O nome do arquivo é operacional (rastreabilidade de ingestão), não contém segredo. Mantido apenas como alerta: qualquer PII eventualmente embutida em nome de arquivo entregue pelo banco (CNPJ, nome do cliente) iria pelo mesmo canal.
- **Métrica de baseline**: 0 campos de nova sensibilidade; 100% de reaproveitamento de pattern pré-existente.

### F-security-3: SQL em `listInativosRecentes` usa cast `AT TIME ZONE 'UTC'::date` sobre `vencimento` — tecnicamente seguro, mas é precedente de SQL com lógica de tempo não parametrizada

- **Severidade**: P3
- **Tactic violada**: Validate Input (defense-in-depth)
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:254-262`
- **Evidência (objetiva)**:
  ```
  WHERE ativo = FALSE
    AND vencimento IS NOT NULL
    AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date
  ```
- **Impacto técnico**: `$de` e `$ate` são placeholders ligados via `selectMany(query, { de, ate })` — não há interpolação. Entradas vêm de `BankingCalendar.addDays(hoje, …)`, não do cliente HTTP. Rule #5 (SQL parametrizado) está cumprida. Comentário aqui apenas para registro: o cast `::date` sobre o parâmetro assume que a origem é um `YYYY-MM-DD`; se um dia o `calendar.addDays` passar a devolver outro formato, o Postgres rejeita (erro de parse), não executa SQL arbitrário.
- **Impacto de negócio**: nenhum atualmente.
- **Métrica de baseline**: 0 sítios de SQL interpolado introduzidos; 1 query nova 100% parametrizada.

## 5. Cards Kanban

### [security-1] Blindar o payload DDA caso a Columbia venha a criar role somente-DDA no futuro

- **Problema**
  > `titulosSaidos[]` devolve credor/valor/vencimento de títulos INATIVOS a toda role `sispag:ver`. Hoje é equivalente ao que a role já enxerga em outras abas (não é regressão), mas se amanhã existir uma role de visualização reduzida (só a aba DDA, por exemplo), esse payload passará a vazar títulos que o usuário não deveria ler.
- **Melhoria Proposta**
  > Documentar em `ontology/entities/boleto-dda.md` que `titulosSaidos` e `copias[]` herdam a sensibilidade de "títulos ativos" e que a introdução de qualquer role sub-conjunto de `sispag:ver` precisa reavaliar o DTO. Opcional: parametrizar o campo `credor` para omissão quando a role for restrita (ainda não existe). Tactic alvo: **Limit Exposure**.
- **Resultado Esperado**
  > Ontologia explicita o acoplamento DTO ↔ role e exige revisão em qualquer PR que fatie `sispag:ver`. Métrica: comentário/ADR presente (ausente → presente).
- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Nota de sensibilidade em `ontology/entities/boleto-dda.md`: ausente → presente
  - Checklist de revisão de role em PR template SISPAG: ausente → presente (opcional)
- **Risco de não fazer**: baixo — potencial vazamento quando/se uma role restrita for criada; detectável em code review futuro.
- **Dependências**: nenhuma.

### [security-2] Fixar invariante de parametrização em `listInativosRecentes` com teste e comentário

- **Problema**
  > A nova query `listInativosRecentes` é parametrizada corretamente (`$de`/`$ate` + cast `::date`), mas o cast `AT TIME ZONE 'UTC'::date` é a primeira vez que esse padrão aparece neste repositório. Sem um teste que exercite valores adversariais (ex.: `' OR 1=1 --`) para confirmar que o cast é efetuado sobre o VALOR ligado, não há garantia de que uma mudança futura em `BankingCalendar.addDays` ou numa refatoração do SqlBuilder não degrade a invariante.
- **Melhoria Proposta**
  > Em `TituloAPagarRepository.*.test.ts`, acrescentar um teste focado em parametrização: injetar um `de` string `"2026-01-01' OR '1'='1"` (via unit do repositório mockando o `selectMany` para checar `params.de` recebido) e verificar que o SQL enviado nunca contém a string. Alternativamente, assertar que `selectMany` foi chamado com `{ de, ate }` e nunca com string concatenada. Tactic: **Validate Input** (defense-in-depth) + Rule #5.
- **Resultado Esperado**
  > Teste de parametrização presente; qualquer refactor que quebre o binding falha em CI. Métrica: 0 → 1 teste de injeção para `listInativosRecentes`.
- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Tests para `listInativosRecentes` com payload adversarial: 0 → ≥1
  - Comentário no método referenciando Rule #5: ausente → presente
- **Risco de não fazer**: baixo — a invariante hoje é cumprida; sem o teste, uma regressão silenciosa é possível a longo prazo.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo limitado estritamente ao diff informado — não revisei infra, SSM, API Gateway (ausentes do repo) nem rotas não tocadas.
- Nenhum P0/P1/P2 encontrado: o diff é majoritariamente leitura, reaproveita a rota já guardada por `sispag:ver`, usa Zod em todos os campos novos (os enums novos entram via `Object.values(BOLETO_DDA_SITUACAO)`), e a única nova SQL é 100% parametrizada com entradas server-side.
- Cross-QA: `Limit Exposure` do payload `titulosSaidos` toca também **Modifiability** (acoplamento DTO ↔ role) — sinalizar ao consolidator. `Validate Input` em `listInativosRecentes` sobrepõe com **Fault Tolerance** (robustez contra entrada inesperada do calendar).
- Score 8/10: diff limpo em segurança; os 2 pontos retidos refletem a ausência de teste de parametrização adversarial e a falta de nota de sensibilidade no DTO.
