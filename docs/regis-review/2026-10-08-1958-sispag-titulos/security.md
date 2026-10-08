---
qa: Security
qa_slug: security
run_id: 2026-10-08-1958-sispag-titulos
agent: qa-security
generated_at: 2026-10-08T20:30:00Z
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado sem `SISPAG_VER`, ou usuário legítimo abusando do export | POST `/sispag/titulos/exportar` com chaves forjadas, 5000+ chaves ou chamadas em rajada | Rota `POST /sispag/titulos/exportar`, `TitulosAPagarExportService`, `PlanilhaXlsxWriter` | Produção, Express/Render, single-tenant Columbia | Rejeitar sem permissão (403), rejeitar payload inválido (400), limitar taxa, exportar só dados da carteira persistida, registrar o uso | 0 export sem permissão; 100% do payload validado por Zod; teto 5000 chaves; 1 log de negócio por export |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas no delta com permissão explícita | 1/1 (`exigirPermissao(SISPAG_VER)`) | 100% | ✅ | `routes/sispag.ts` (diff e832057) |
| Rotas novas com validação Zod no body | 1/1 (regex + `.min(1).max(5000)`) | 100% | ✅ | `routes/sispag.ts` schema `exportarTitulosAPagarSchema` |
| Rate limit na rota nova | `heavyRouteLimiter` | presente | ✅ | `routes/sispag.ts` |
| SQL novo com interpolação | 0 (reusa repositórios existentes; nenhuma query nova) | 0 | ✅ | diff do commit |
| Segredos hardcoded no delta | 0 | 0 | ✅ | diff do commit |
| `dangerouslySetInnerHTML` / `localStorage` novos | 0 | 0 | ✅ | diff do commit (frontend só envia chaves e baixa blob) |
| Export registra identidade do usuário | 0 de 1 (log tem só `requestId`) | 1 de 1 | ⚠️ | `TitulosAPagarExportService.ts` `exportar` |
| Teste que prova 403 sem `SISPAG_VER` | coberto em `routePermissions.test.ts` (+3 linhas) | presente | ✅ | `http/routePermissions.test.ts` |

> ⚠️ **Não medível localmente**: `infra/` (authorizers, IAM, CloudTrail) não existe neste repo; `npm audit` pulado (`--quick`).

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta | N/A | Sem mudança de superfície de detecção |
| Detect Service Denial | `heavyRouteLimiter` na rota | ✅ presente | `routes/sispag.ts` |
| Verify Message Integrity | Payload só de chaves; valores vêm do banco, não do cliente | ✅ presente | `TitulosAPagarExportService.montar` |
| Detect Message Delay | N/A: export síncrono, sem mensageria | N/A | — |
| Identify Actors | Middleware de auth existente | ✅ presente | herdado |
| Authenticate Actors | Middleware existente (Supabase JWT) | ✅ presente | herdado |
| Authorize Actors | `exigirPermissao(SISPAG_VER)` | ✅ presente | `routes/sispag.ts` |
| Limit Access | Chave desconhecida é ignorada; só carteira ativa e não paga é projetada | ✅ presente | `montar` |
| Limit Exposure | Export read-only, sem Conexos, sem escrita; teto 5000 | ✅ presente | service |
| Encrypt Data | TLS na borda (Render/Vercel); arquivo não persistido | ✅ presente | `res.send(buffer)` |
| Separate Entities | Sem escrita financeira; permissão de leitura separada | ✅ presente | rota |
| Change Default Settings | Limite de body 100 KB mantido e testado | ✅ presente | `buildApp.ts:56` |
| Validate Input | Zod com regex por chave, limites 1..5000, `Number(filCod)` limitado a 6 dígitos | ✅ presente | schema da rota |
| Revoke Access | Fora do delta | N/A | — |
| Lock Computer | Fora do delta | N/A | — |
| Inform Actors | Erro 400 sem vazar detalhe interno (só `flatten()` do Zod) | ✅ presente | rota |
| Restore | N/A: read-only | N/A | — |
| Audit Trail | Log `BUSINESS_INFO` com contagens e `requestId`, sem usuário | ⚠️ parcial | `exportar` |

## 4. Findings

### F-security-1: Export de carteira financeira sem identidade do usuário no log

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/sispag/TitulosAPagarExportService.ts` (`exportar`), `src/backend/routes/sispag.ts` (passa só `req.requestId`)
- **Evidência (objetiva)**:
  ```
  data: { requestId, pedidos: chaves.length, titulos: planilha.linhas.length, ignorados }
  ```
- **Impacto técnico**: o log não diz quem extraiu a lista de credores, valores e bancos. Só dá para correlacionar via `requestId` com o log de acesso.
- **Impacto de negócio**: exfiltração de dados de fornecedores e pagamentos por um usuário com `SISPAG_VER` não é atribuível sem correlação manual (LGPD, sigilo comercial). Não move dinheiro.
- **Métrica de baseline**: 0 de 1 campos de identidade (userId/email) no log do export.

### F-security-2: Relê a carteira inteira a cada export, em rota autenticada

- **Severidade**: P3
- **Tactic violada**: Detect Service Denial (hardening)
- **Localização**: `TitulosAPagarExportService.montar` (`listAtivos` + dois `Promise.all` de lotes)
- **Evidência (objetiva)**:
  ```
  const [ativos, emRascunho, comprometidos] = await Promise.all([listAtivos(), ...])
  ```
- **Impacto técnico**: cada export custa ~1.5 mil linhas lidas, mais a serialização de até 5000 linhas. Fica contido pelo `heavyRouteLimiter` e pela permissão.
- **Impacto de negócio**: baixo; um usuário autenticado pode degradar a API só no limite do rate limiter.
- **Métrica de baseline**: ~1.5 mil linhas lidas por chamada; teto de 5000 chaves por request.

Verificado sem achado: ExcelJS grava strings como string de célula (não como fórmula). `credor`, vindo do ERP, não vira injeção de fórmula ao abrir no Excel. SQL novo: nenhum. P0: nenhum.

## 5. Cards Kanban

### [security-1] Registrar o usuário autor no log de export de títulos a pagar

- **Problema**
  > O export de `/sispag/titulos/exportar` entrega credores, valores e bancos da carteira, mas o log de negócio guarda só `requestId` e contagens. Não dá para dizer quem extraiu a planilha sem cruzar logs de acesso.

- **Melhoria Proposta**
  > Passar o identificador do ator (`req.user`) da rota para `exportar` e incluí-lo em `data` do `logService.info`. Aplicar o mesmo padrão ao `RemessaTitulosExportService`. Tactic: Audit Trail.

- **Resultado Esperado**
  > Todo export fica atribuível a um usuário no log: 0 de 2 exports com identidade hoje, 2 de 2 depois.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Exports SISPAG com userId no log: 0 de 2 → 2 de 2
- **Risco de não fazer**: um vazamento de lista de fornecedores por usuário interno não é atribuível sem investigação manual.
- **Dependências**: nenhuma

### [security-2] Avaliar cache curto da carteira para o export (hardening)

- **Problema**
  > Cada export relê a carteira ativa e os lotes. Sob rajada de um usuário autenticado, o custo fica limitado só pelo `heavyRouteLimiter`.

- **Melhoria Proposta**
  > Se o uso crescer, reaproveitar a leitura do painel (cache de segundos) ou reduzir o limite do `heavyRouteLimiter` para esta rota. Tactic: Detect Service Denial.

- **Resultado Esperado**
  > Leituras de carteira por minuto limitadas a um teto conhecido por usuário. Hoje: sem cache, limitado só pelo rate limiter.

- **Tactic alvo**: Detect Service Denial
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Leituras completas da carteira por export: 1 → 0 em cache hit
- **Risco de não fazer**: mínimo hoje (~1.5 mil linhas); cresce com a carteira.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta de e832057. `--quick`: sem `npm audit`, sem varredura de segredos no repo inteiro; o delta foi lido diretamente.
- Não existe `infra/`, então authorizer, IAM e CloudTrail não são medíveis aqui.
- Cross-QA: F-security-1 sobrepõe Fault Tolerance (Audit Trail); F-security-2 sobrepõe Performance e Availability.
