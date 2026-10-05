---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-05-2134-permuta-centavos-adto
agent: qa-integrability
generated_at: 2026-10-05T21:45:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Integrability — Regis-Review

> Escopo: delta do commit `c099a55` (--quick). Não é auditoria do repo inteiro.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos fin010 (ERP) | O ERP muda a semântica ou o nome de `bxaMnyValorPermuta` (passo 3), ou o disponível vivo do adto passa a vir de outro campo | `ReconciliacaoPermutaService.limitarAoDisponivelDoAdto` + `Fin010Baixa.bxaMnyValorPermuta` | Operação normal, baixa de permuta em borderô aberto | Regra continua isolada em 1 método; campo ausente degrada para "sem teto" sem quebrar | ≤ 2 arquivos tocados; 0 chamadas ERP novas; contrato verificável por fixture |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas novas ao ERP introduzidas pelo delta | 0 (reusa o payload do passo 3) | 0 | ✅ | `_shared-metrics.md`; `ReconciliacaoPermutaService.ts:1010-1052` |
| Clients com HTTP genérico vazado pelo delta | 0 (delta não toca `client/`) | 0 | ✅ | `git show c099a55 --stat` |
| Arquivos a tocar se o campo mudar | 3 (`Fin010Baixa.ts:61`, service, job de validação) | ≤ 3 | ✅ | `grep bxaMnyValorPermuta src/backend` |
| Campo lido com tipo opcional e fallback | sim (`=== undefined` → no-op) | sim | ✅ | `ReconciliacaoPermutaService.ts:1021` |
| Validação Zod do campo na fronteira (client) | não evidenciada; só tipo TS `bxaMnyValorPermuta?: number` | Zod no boundary | ⚠️ | `Fin010Baixa.ts:61` |
| Teste de contrato com fixture do passo 3 | 1 fixture parcial (`ConexosSubClients.test.ts:1473`), sem asserção do campo como saldo vivo | fixture gravada real | ⚠️ | `ConexosSubClients.test.ts:1473` |
| Ground truth contra ledger de produção | 196 execuções, 0 DIVERGENTE | 0 | ✅ | `_shared-metrics.md` |
| Observabilidade de falha por dependência | BUSINESS_WARN com `excesso`, `bxaMnyValorPermuta`, `limiteResiduo` | log estruturado | ✅ | `ReconciliacaoPermutaService.ts:1037-1042` |
| Infra/Terraform | ⚠️ Não medível: sem `infra/` neste repo | n/a | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura (delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Regra de teto em método privado único, chamado só em `baixarTitulo` | ✅ presente | `ReconciliacaoPermutaService.ts:875,1010` |
| Use an Intermediary | Service lê o campo já mapeado em `Fin010Baixa`, sem tocar HTTP | ✅ presente | `Fin010Baixa.ts:61` |
| Restrict Communication Paths | Nenhum caminho novo ao ERP; job de validação só lê DB | ✅ presente | `validate-permuta-centavos-adto-v1.ts` |
| Adhere to Standards | N/A: ERP proprietário, sem padrão aplicável | N/A | — |
| Abstract Common Services | Reusa `ToleranciaResiduo.LIMITE_BRL` compartilhado com a âncora | ✅ presente | `ReconciliacaoPermutaService.ts:1025` |
| Discover Service | N/A: delta não adiciona config/endpoint | N/A | — |
| Tailor Interface | Teto aplicado no domínio, ajuste só na variação (juros/desconto) | ✅ presente | `ReconciliacaoPermutaService.ts:1034-1035` |
| Configure Behavior | Tolerância é constante (R$ 1,00), sem flag para desligar a regra | ⚠️ parcial | `ToleranciaResiduo.ts` |
| Manage Resources | N/A: sem chamada nova | N/A | — |
| Orchestrate | Encadeia `ancorarVariacaoNoAdto` → `limitarAoDisponivelDoAdto` em série dentro de `baixarTitulo`; ordem é invariante implícita | ⚠️ parcial | `ReconciliacaoPermutaService.ts:854-880` |
| Manage Resource Coupling | Acoplamento à semântica de campo do ERP documentada em I-Write-10 e ADR-0062 | ✅ presente | `ontology/business-rules/fin010-write-contract.md` |
| Contract testing | 4 testes unitários com mock; sem fixture gravada do passo 3 | ⚠️ parcial | `ReconciliacaoPermutaService.test.ts:1439` |
| Versioning strategy | Sem versão do ERP; job `-v1` valida contra o ledger | ⚠️ parcial | `validate-permuta-centavos-adto-v1.ts` |
| Backward-compatibility shims | Campo ausente → no-op (compatível com respostas antigas) | ✅ presente | `ReconciliacaoPermutaService.ts:1021` |
| Observability of integration failures | WARN e INFO estruturados com contexto | ✅ presente | `ReconciliacaoPermutaService.ts:1037,1046` |

## 4. Findings

### F-integrability-1: Semântica de `bxaMnyValorPermuta` como "saldo vivo" sem validação de fronteira nem fixture gravada

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling (contract testing)
- **Localização**: `src/backend/domain/interface/permutas/Fin010Baixa.ts:61`; `ReconciliacaoPermutaService.ts:1021-1022`; `ConexosSubClients.test.ts:1473`
- **Evidência (objetiva)**:
  ```
  bxaMnyValorPermuta?: number;                 // tipo TS apenas
  if (p.bxaMnyValorPermuta === undefined) return { juros, desconto };
  ```
- **Impacto técnico**: se o ERP devolver string, `null` ou o campo com outro significado, `round2(... - p.bxaMnyValorPermuta)` vira `NaN`. `!(excesso > 0)` é verdadeiro para `NaN`, então cai em no-op silencioso e o teto deixa de funcionar sem alerta.
- **Impacto de negócio**: o retrabalho de centavos (borderô 23184 recusado em Finalizar) voltaria sem sinal de que a proteção parou.
- **Métrica de baseline**: 0 fixtures gravadas do passo 3 que fixem o campo. 3 de 196 execuções reais (1,5%) já excederam o disponível em R$ 0,01.

### F-integrability-2: Ordem âncora → teto é invariante implícita entre dois métodos

- **Severidade**: P3
- **Tactic violada**: Orchestrate
- **Localização**: `ReconciliacaoPermutaService.ts:854-880`
- **Evidência (objetiva)**:
  ```
  ancorarVariacaoNoAdto(...)  ->  limitarAoDisponivelDoAdto({...})
  ```
- **Impacto técnico**: trocar a ordem ou mover um deles faz a âncora (que fecha para cima) desfazer o teto. Hoje só o teste cobre isso (`ReconciliacaoPermutaService.test.ts:1485`).
- **Impacto de negócio**: baixo; é regressão silenciosa só se alguém refatorar.
- **Métrica de baseline**: 1 teste cobre a composição (`expect(p2.bxaMnyLiquido).toBe(p2.bxaMnyValorPermuta)`).

## 5. Cards Kanban

### [integrability-1] Validar `bxaMnyValorPermuta` na fronteira do client e fixar fixture do passo 3

- **Problema**
  > O campo é usado como saldo vivo do adto, mas só tem tipo TS. Um valor não numérico gera `NaN` e o teto vira no-op sem aviso (`ReconciliacaoPermutaService.ts:1021-1023`).

- **Melhoria Proposta**
  > Parsear o campo com Zod no mapeamento do passo 3 (número finito ou ausente). No service, tratar `Number.isFinite` falso como WARN explícito. Adicionar fixture gravada da resposta real do passo 3 em `ConexosSubClients.test.ts`.

- **Resultado Esperado**
  > Campo malformado gera alerta em vez de passar calado. Fixtures do passo 3: 0 → 1.

- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Fixtures gravadas do passo 3: 0 → 1
  - Caminhos silenciosos para `NaN` no teto: 1 → 0
- **Risco de não fazer**: uma mudança no ERP desliga a proteção sem ninguém perceber, e a recusa em Finalizar volta a ocorrer.
- **Dependências**: nenhuma.

### [integrability-2] Travar a ordem âncora → teto em um único ponto de composição

- **Problema**
  > A composição depende da ordem de duas chamadas em `baixarTitulo`, coberta por um único teste.

- **Melhoria Proposta**
  > Agrupar as duas em um método `ajustarVariacaoDaBaixa` que documente e teste a ordem. Também pode ser só um teste de propriedade: líquido ≤ disponível após a composição.

- **Resultado Esperado**
  > Refatoração futura não desfaz o teto sem quebrar teste.

- **Tactic alvo**: Orchestrate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Pontos de composição da ordem: 2 chamadas soltas → 1 método testado
- **Risco de não fazer**: regressão de centavos em refatoração futura.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Delta sem P0: não toca client, não adiciona integração, não amplia superfície ao ERP.
- Overlap cross-QA: validação de fronteira do campo (F-integrability-1) com Security e Fault Tolerance (Validate Input).
- Infra não medível (sem `infra/`).
