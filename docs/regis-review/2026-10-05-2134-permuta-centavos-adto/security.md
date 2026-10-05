---
qa: Security
qa_slug: security
run_id: 2026-10-05-2134-permuta-centavos-adto
agent: qa-security
generated_at: 2026-10-05T21:40:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider ou atacante com acesso ao banco/job; ou entrada manipulada que altera juros/desconto de uma baixa | Valor de baixa de permuta acima do disponível do adto, ou script de validação rodado contra o banco de produção | `limitarAoDisponivelDoAdto` (escrita financeira no fin010) e `validate-permuta-centavos-adto-v1.ts` (leitura do ledger de prod) | Produção (Render + Supabase), analista no controle, `--quick` e delta-scoped | A função só corta o líquido para baixo, no máximo R$1,00. Acima disso ou com juros negativo, ela não mexe e emite BUSINESS_WARN. O job lê em transação READ ONLY verificada | 0 caminhos que aumentem o valor pago. 0 escritas no banco pelo job. 0 segredos no código ou nos logs |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `grep` do delta (job lê `process.env.databaseConnectionString`) |
| Arquivos `.env` ou tfstate adicionados | 0 | 0 | ✅ | `git show --stat c099a55` |
| SQL não parametrizado no delta | 0 (única query é literal estática, sem interpolação) | 0 | ✅ | `validate-permuta-centavos-adto-v1.ts:66-71` |
| Escrita no banco pelo job de validação | 0 (BEGIN READ ONLY, `SHOW transaction_read_only` checado, ROLLBACK) | 0 | ✅ | `validate-permuta-centavos-adto-v1.ts:62-72` |
| Chamadas ao Conexos pelo job | 0 | 0 | ✅ | leitura do arquivo |
| Direção do ajuste da função | só reduz o líquido (juros ↓ ou desconto ↑), teto R$1,00, juros nunca negativo | nunca aumenta o valor pago | ✅ | `ReconciliacaoPermutaService.ts` `limitarAoDisponivelDoAdto` |
| Ground truth em prod | 196 execuções: 0 DIVERGENTE | 0 | ✅ | `_shared-metrics.md` |
| Uso de `rejectUnauthorized: false` no job | 1 (padrão já existente em outros jobs) | 0 | ⚠️ | `validate-permuta-centavos-adto-v1.ts:59` |
| Dados sensíveis no stdout do job | borderô, docCod, titCod, valores (sem CNPJ, sem credencial) | sem PII/segredo | ✅ | `validate-permuta-centavos-adto-v1.ts:110-114` |
| `npm audit` | ⚠️ Não medível neste run: `--quick` | n/a | ⚠️ | n/a |
| Authn/authz, IAM, CORS, CloudTrail | ⚠️ Não medível: fora do delta, sem `infra/` | n/a | ⚠️ | `_shared-metrics.md` |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta | N/A | O delta não toca detecção |
| Detect Service Denial | Fora do delta | N/A | idem |
| Verify Message Integrity | O teto compara o líquido com o `bxaMnyValorPermuta` devolvido pelo ERP, não com valor do cliente. O ERP ainda revalida no gravar e no Finalizar | ✅ presente | `limitarAoDisponivelDoAdto` |
| Detect Message Delay | Fora do delta | N/A | idem |
| Identify Actors | Fora do delta | N/A | idem |
| Authenticate Actors | O job usa credencial do banco via env, não do código | ✅ presente | `validate-permuta-centavos-adto-v1.ts:58` |
| Authorize Actors | Fora do delta. Nenhum endpoint novo | N/A | `git show --stat c099a55` |
| Limit Access | O job abre transação READ ONLY e confirma antes de ler. O ajuste é limitado a R$1,00 | ✅ presente | job `:62-64` |
| Limit Exposure | Blast radius do ajuste: no máximo R$1,00 por baixa, só para baixo | ✅ presente | `ToleranciaResiduo.LIMITE_BRL` |
| Encrypt Data | O job usa TLS, mas sem verificar o certificado | ⚠️ parcial | job `:59` |
| Separate Entities | Fora do delta | N/A | sem infra multi-tenant no repo |
| Change Default Settings | Fora do delta | N/A | idem |
| Validate Input | `bxaMnyValorPermuta` opcional: se ausente, não limita e segue. Excesso e juros negativo tratados. O job faz `Number()` e ignora payload sem o campo | ✅ presente | `limitarAoDisponivelDoAdto` / job `:84-88` |
| Revoke Access | Fora do delta | N/A | idem |
| Lock Computer | Fora do delta | N/A | idem |
| Inform Actors | BUSINESS_WARN quando o excesso fica fora da tolerância | ✅ presente | `limitarAoDisponivelDoAdto` |
| Restore | Fora do delta | N/A | cross-QA com Availability e Deployability |
| Audit Trail | Todo ajuste gera BUSINESS_INFO com excesso, disponível e docCods. O `request_payload` enviado ao ERP continua gravado em `permuta_alocacao_execucao`. Os valores originais (antes do corte) só existem no log, não no ledger | ⚠️ parcial | `limitarAoDisponivelDoAdto`, `logService.info` |

## 4. Findings

### F-security-1: Job de validação conecta ao banco de produção com `rejectUnauthorized: false`

- **Severidade**: P3
- **Tactic violada**: Encrypt Data
- **Localização**: `src/backend/jobs/validate-permuta-centavos-adto-v1.ts:59`
- **Evidência (objetiva)**:
  ```
  ssl: { rejectUnauthorized: false },
  ```
  O mesmo padrão aparece em `probe-impacto-narrativa.ts:119` e `probe-impacto-verificacao.ts:126`.
- **Impacto técnico**: Um MITM na rede do operador pode interceptar a connection string e as leituras do ledger. A conexão é cifrada, mas sem verificar o certificado.
- **Impacto de negócio**: Baixo. O job é manual, roda na máquina do analista e é read-only. Mas a connection string de produção dá escrita se interceptada.
- **Métrica de baseline**: 3 jobs com `rejectUnauthorized: false` (grep no escopo de jobs). O delta acrescentou 1.

### F-security-2: Valor original da variação não fica no ledger quando o teto corta o líquido

- **Severidade**: P3
- **Tactic violada**: Audit Trail
- **Localização**: `ReconciliacaoPermutaService.ts` `limitarAoDisponivelDoAdto` (saída de `logService.info`)
- **Evidência (objetiva)**:
  ```
  return { juros: jurosTeto, desconto: descontoTeto };
  ```
  O `request_payload` gravado já carrega o juros/desconto pós-corte. O valor pré-corte só existe no log BUSINESS_INFO (campo `excesso`).
- **Impacto técnico**: Reconstituir o valor pré-corte exige o log, que tem retenção menor que a tabela.
- **Impacto de negócio**: Em auditoria de uma baixa ajustada em centavos, a analista não vê direto no ledger que houve ajuste. O impacto financeiro é no máximo R$1,00 por baixa.
- **Métrica de baseline**: 3 de 196 execuções históricas teriam sido ajustadas (1,5%).

## 5. Cards Kanban

### [security-1] Verificar o certificado TLS nos jobs que leem o banco de produção

- **Problema**
  > O job novo e dois probes existentes conectam ao Postgres de produção com `rejectUnauthorized: false`. A conexão é cifrada, mas o certificado não é verificado.

- **Melhoria Proposta**
  > Extrair uma factory de `pg.Client` para jobs, com CA do provedor via env. Aplicar em `validate-permuta-centavos-adto-v1.ts` e nos probes. Pode ser feito junto da próxima migração de jobs.

- **Resultado Esperado**
  > Jobs de produção com verificação de certificado: 0 de 3 → 3 de 3.

- **Tactic alvo**: Encrypt Data
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Jobs com `rejectUnauthorized: false`: 3 → 0
- **Risco de não fazer**: Um MITM em rede de operador captura a connection string de produção, e o padrão se replica em jobs novos.
- **Dependências**: Obter o CA do provedor do banco.

### [security-2] Registrar o ajuste do teto no ledger de execução

- **Problema**
  > Quando `limitarAoDisponivelDoAdto` corta a variação, o juros/desconto original só aparece no log. O ledger guarda apenas o valor final enviado.

- **Melhoria Proposta**
  > Gravar o excesso absorvido junto da linha de `permuta_alocacao_execucao` (coluna ou campo no payload auxiliar), via `ReconciliacaoPermutaService`. Fecha o Audit Trail para I-Write-10.

- **Resultado Esperado**
  > Ajustes de centavos rastreáveis só pelo ledger: 0% → 100% das baixas ajustadas.

- **Tactic alvo**: Audit Trail
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Baixas ajustadas com excesso persistido no ledger: 0% → 100%
- **Risco de não fazer**: Em auditoria, o ajuste só pode ser reconstituído enquanto o log existir.
- **Dependências**: Migration SQL.

## 6. Notas do agente

- Escopo: só o delta de `c099a55`. Nenhum P0 encontrado: a função só reduz o líquido, o job é read-only verificado e não há segredo nem SQL interpolado.
- Não medidos por `--quick` ou fora do delta: `npm audit`, authn/authz, IAM, CORS, CloudTrail (não há `infra/`).
- Cross-QA: Audit Trail com Fault Tolerance. Validate Input com Integrability.
