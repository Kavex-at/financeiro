---
qa: Security
qa_slug: security
run_id: 2026-10-19-sispag-ajuste-centavos
agent: qa-security
generated_at: 2026-10-19T12:00:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Security — Regis-Review (delta: ajuste de centavos, ADR-0074)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário com apenas `sispag:ver`, sessão roubada, ou cron/script | Chama `/sispag/ajustes-centavos/*` ou dispara o executor fora do servidor | Rotas novas em `routes/sispag.ts`, `AjusteCentavosTituloService`, sessão robô Conexos (fin070/fin103) | Produção, modo `off` por default | Escrita só com `sispag:executar`, no processo do servidor, com login sondado e 3 kill-switches; senão rebaixa a `shadow`; código de barras só mascarado 5+4 | 0 escritas no ERP fora do servidor; 0 códigos completos persistidos; 30 req/min por usuário |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas com guard de permissão | 3/3 (tabela do `routePermissions.test.ts`: 2 `SISPAG_EXECUTAR`, 1 `SISPAG_VER`) | 100% | ✅ | `routes/sispag.ts` |
| Rotas novas com Zod no body/query | 3/3 | 100% | ✅ | `routes/sispag.ts` (`AjusteCentavos*Schema`) |
| Rotas mutantes com rate limit | 2/2 (30/min por `sub`, balde `ajuste`) | 100% | ✅ | `http/rateLimit.ts` |
| Defaults do modo | `off`; `on` só com 5 condições; senão `shadow` | fail-closed | ✅ | `ModoAjusteCentavos.ts` |
| Sessão usada nas escritas | `registry.robot()` explícita | 100% | ✅ | `AjusteCentavosTituloService.ts:326` |
| Código de barras completo persistido | 0 (CHECK `codigo_mascarado` na 0088; `inserirEventoAjuste` recusa `\d{10,}`) | 0 | ✅ | migration 0088, `SugestaoBoletoRepository.ts` |
| SQL não parametrizado no delta | 0 | 0 | ✅ | `SugestaoBoletoRepository.transferirDecisao` |
| Segredos hardcoded / `.env` no delta | 0 | 0 | ✅ | inspeção do diff |
| Rate limit no `GET /ajustes-centavos` | ausente (leitura; só global 100/min por IP) | opcional | ⚠️ | `routes/sispag.ts` |
| Escopo por filial do usuário nas rotas | sem verificação de `filCod` contra filiais do usuário (rotas irmãs idem) | n/a | ⚠️ | `routes/sispag.ts` |
| `npm audit` | ⚠️ Não medível no delta (sem mudança de dependências) | crit=0, high=0 | ⚠️ | `package.json` fora do diff |
| CloudTrail/GuardDuty, IAM por Lambda | ⚠️ Não medível: não existe `infra/` neste repo | — | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | `warn` quando `on` rebaixa a `shadow`; logs por transição | ⚠️ parcial | `AjusteCentavosTituloService.ts:168` |
| Detect Service Denial | Rate limit 30/min nas rotas de escrita | ⚠️ parcial | `rateLimit.ts` |
| Verify Message Integrity | Escrita só vale pelo que a releitura observa; marcador na obs | ✅ presente | `reconhecerPeloMarcador`, `FINALIZAR_NAO_OBSERVADO` |
| Detect Message Delay | N/A: sem mensageria no delta | N/A | — |
| Identify Actors | `req.user.sub`; ator `sistema` só na transferência | ✅ presente | `transferirDecisao` |
| Authenticate Actors | Middleware de sessão existente cobre `/sispag` | ✅ presente | `routePermissions.test.ts` |
| Authorize Actors | `exigirPermissao` antes do limiter; EXECUTAR para escrever | ✅ presente | `routes/sispag.ts` |
| Limit Access | Credencial robô única; modo por filial; `ServerProcessMarker` ligado só no `index.ts` | ✅ presente | `ServerProcessMarker.ts`, `index.ts` |
| Limit Exposure | Máscara 5+4 em ledger, eventos, obs fin070, UI | ✅ presente | migration 0088 |
| Encrypt Data | Sem mudança (fora do delta) | N/A | — |
| Separate Entities | Shadow (leitura) separado de on (escrita); jobs separados do servidor | ✅ presente | `ModoAjusteCentavos.ts` |
| Change Default Settings | Default `off`; `CONEXOS_DRY_RUN` ligado rebaixa a shadow | ✅ presente | `EnvironmentProvider.ts` |
| Validate Input | Zod nas 3 rotas; `.max()` em docCod/titCod | ✅ presente | `routes/sispag.ts` |
| Revoke Access | Kill-switches `SISPAG_AJUSTE_CENTAVOS_FILIAIS`, `LIVE_WRITE`, `CONEXOS_WRITE`, `DRY_RUN`; mudança exige reinício | ⚠️ parcial | `ModoAjusteCentavos.ts` |
| Lock Computer | N/A: sem lockout; compensação e ledger não terminal fazem papel parcial | N/A | — |
| Inform Actors | Selo na UI e `avisos` no GET | ✅ presente | `AjusteCentavosSelo.tsx` |
| Restore | Compensação (`cancelarRenegociacao`) e retomada pelo marcador | ✅ presente | `compensar`, `reconhecerPeloMarcador` |
| Audit Trail | Eventos `TITULO_RENEGOCIADO`/`DECISAO_TRANSFERIDA`, ledger com tentativas, `decidido_por` herdado | ✅ presente | `SugestaoBoletoRepository.ts`, 0088 |

## 4. Findings

### F-security-1: Scrub de erro só remove sequências contíguas de 20+ dígitos

- **Severidade**: P2
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts:1187-1188`
- **Evidência (objetiva)**:
  ```
  (err instanceof Error ? err.message : String(err)).replace(/\d{20,}/g, '…')
  ```
- **Impacto técnico**: mensagem de erro do ERP/axios com linha digitável formatada (`23793.38128 60000...`) passa ao log inteira. O repositório de eventos (`\d{10,}`) é mais estrito que este scrub.
- **Impacto de negócio**: linha digitável de boleto no log do Render fica acessível a quem lê log; permite fraude por reuso do boleto.
- **Métrica de baseline**: 1 sítio de scrub, só `\d{20,}`; 0 testes com linha formatada.

### F-security-2: Varredura `retomar` sem guarda de concorrência e sem escopo por filial

- **Severidade**: P2
- **Tactic violada**: Detect Service Denial / Limit Access
- **Localização**: `src/backend/routes/sispag.ts` (`/retomar`), `AjusteCentavosTituloService.ts:299`
- **Evidência (objetiva)**:
  ```
  ajustesCentavos().agendarVarredura(body.data.filCod !== undefined ? {...} : {})  // fire-and-forget
  ```
- **Impacto técnico**: 30 chamadas/min, cada uma com varredura em segundo plano de todas as filiais (`filCod` opcional). O advisory lock é por título, então varreduras se empilham e consomem a sessão robô (cap de sessões Conexos já sensível).
- **Impacto de negócio**: usuário com `sispag:executar` (ou sessão roubada) degrada a sessão robô usada também pelas leituras do SISPAG.
- **Métrica de baseline**: 30 varreduras/min/usuário possíveis; 0 guarda de "varredura já em curso".

### F-security-3: `filCod` do body não é conferido contra as filiais do usuário

- **Severidade**: P3
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/routes/sispag.ts` (3 rotas)
- **Evidência (objetiva)**: schemas aceitam qualquer `filCod` inteiro positivo; o guard é só por permissão global. Igual às rotas irmãs; `tentarDeNovo` exige decisão CONFIRMADA e modo da filial, o que limita o dano.
- **Impacto técnico**: quem tem `sispag:executar` aciona retentativa em filial fora do seu escopo, se o RBAC vier a ter escopo por filial.
- **Impacto de negócio**: baixo hoje (permissão não é por filial).
- **Métrica de baseline**: 0 de 3 rotas com checagem de filial.

### F-security-4: Kill-switch exige reinício e não há alarme de escrita

- **Severidade**: P3
- **Tactic violada**: Revoke Access / Detect Intrusion
- **Localização**: `EnvironmentProvider.ts`, `ModoAjusteCentavos.ts`
- **Evidência (objetiva)**: flags lidas do env; sem alerta para volume de renegociações ou de compensações.
- **Impacto técnico**: desligar o `on` em incidente depende de restart no Render; sem sinal ativo de renegociações anômalas.
- **Impacto de negócio**: janela de minutos de escrita indevida em título após detectar o problema.
- **Métrica de baseline**: 0 alarmes sobre o ledger.

Sem P0: autorização, identidade, mascaramento, SQL parametrizado e transferência de decisão (`anulada_por='sistema'` só com `TITULO_RENEGOCIADO`, `decidido_por` herdado, CHECKs com `IS NOT DISTINCT FROM`) foram verificados e estão corretos. O texto de `motivo` na UI é renderizado como nó de texto React (sem `dangerouslySetInnerHTML`).

## 5. Cards Kanban

### [security-1] Endurecer o scrub de código de barras em mensagens de erro

- **Problema**
  > `descrever` remove só 20+ dígitos contíguos; linha digitável formatada vaza ao log (F-security-1).
- **Melhoria Proposta**
  > Scrubber único (`\d[\d .-]{18,}\d` e blocos de 10+ dígitos) compartilhado com `inserirEventoAjuste`, com teste de linha digitável formatada. Tactic: Limit Exposure.
- **Resultado Esperado**
  > 0 códigos formatados em logs; teste cobrindo 3 formatos.
- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Formatos de codbar scrubados: 1 → 3
- **Risco de não fazer**: linha digitável em log de produção, reaproveitável em fraude.
- **Dependências**: nenhuma

### [security-2] Impedir varreduras concorrentes do ajuste

- **Problema**
  > `/retomar` agenda varredura sem guarda; 30/min empilham varreduras sobre a sessão robô (F-security-2).
- **Melhoria Proposta**
  > Guarda de varredura em curso por filial (advisory `tryLock` que descarta novo pedido); tornar `filCod` obrigatório.
- **Resultado Esperado**
  > No máximo 1 varredura simultânea por filial.
- **Tactic alvo**: Detect Service Denial
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Varreduras simultâneas por filial: ilimitado → 1
- **Risco de não fazer**: esgotar a sessão robô por engano ou abuso.
- **Dependências**: nenhuma

### [security-3] Escopo por filial nas rotas de ajuste

- **Problema**
  > Permissão global, `filCod` livre (F-security-3).
- **Melhoria Proposta**
  > Registrar como dívida junto ao plano de RBAC; checar filiais do usuário nas 3 rotas quando existir.
- **Resultado Esperado**
  > 3/3 rotas com checagem de filial.
- **Tactic alvo**: Authorize Actors
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Rotas com escopo de filial: 0/3 → 3/3
- **Risco de não fazer**: lacuna quando houver perfis por filial.
- **Dependências**: modelo de permissões por filial

### [security-4] Runbook de kill-switch e alerta de renegociação anômala

- **Problema**
  > Desligar o `on` exige restart; sem alerta de volume de renegociações/compensações (F-security-4).
- **Melhoria Proposta**
  > Documentar no `DEPLOY.md` o procedimento (zerar `SISPAG_AJUSTE_CENTAVOS_FILIAIS`); alerta no job de saúde sobre o ledger (compensações > N/dia).
- **Resultado Esperado**
  > Tempo para desligar documentado; 1 alarme ativo.
- **Tactic alvo**: Revoke Access
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Alarmes sobre o ledger: 0 → 1
- **Risco de não fazer**: resposta lenta em incidente de escrita no ERP.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o diff `origin/main...HEAD`; `jobs/probe-*.ts` ignorados. Não li o `ConexosSessionRegistry` nem o cliente fin070 integralmente; que `robot()` usa `conexosLogin` é inferência pelo uso.
- Cross-QA: Audit Trail e Restore (compensação/retomada) com Fault Tolerance; Validate Input com Integrability; kill-switch por env com Deployability.
