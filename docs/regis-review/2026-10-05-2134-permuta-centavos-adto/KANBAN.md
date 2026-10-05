---
type: regis-review-kanban
run_id: 2026-10-05-2134-permuta-centavos-adto
total: 17
counts: { p0: 0, p1: 0, p2: 6, p3: 11 }
---

# Kanban — financeiro — 2026-10-05-2134-permuta-centavos-adto

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> Escopo: delta do commit c099a55 (I-Write-10 / ADR-0062), `--quick`. IDs preservados dos arquivos de QA; nenhum card foi editado.

---

## P0 — Crítico

Nenhum card P0 nesta rodada.

---

## P1 — Alto

Nenhum card P1 nesta rodada.

---

## P2 — Médio

### [availability-1] Alarmar BUSINESS_WARN de teto do adto e contar LIMITADA vs FORA_TETO

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> O ramo "líquido acima do disponível e fora da tolerância" só escreve BUSINESS_WARN. A recusa do ERP é descoberta no Finalizar pela analista (1 de 196 execuções no ledger).

**Melhoria Proposta**
> Monitor: expor no painel de operação a contagem semanal de `LIMITADA` (INFO) e `fora da tolerância` (WARN) por tenant, com aviso à analista no borderô afetado. Tocar `LogService`/painel, sem mudar `limitarAoDisponivelDoAdto`.

**Resultado Esperado**
> Casos FORA_TETO visíveis antes do Finalizar: 0% visibilidade proativa → 100%.

**Métricas de sucesso**
- Borderôs FORA_TETO sinalizados antes do Finalizar: 0% → 100%

**Risco de não fazer**
> retrabalho manual recorrente da analista, sem dado para medir a taxa real.

**Dependências**: Nenhuma

---

### [deployability-1] Documentar o rollback do I-Write-10 e avaliar um kill-switch

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> A regra I-Write-10 entra no caminho de escrita das baixas sem flag e sem passo de rollback escrito no ADR-0062. O remédio é revert + redeploy do Render, o que funciona, mas não está documentado.

**Melhoria Proposta**
> Acrescentar ao ADR-0062 (ou ao `DEPLOY.md`) uma seção "Rollback": revert do commit `c099a55`, o redeploy do hook do Render e como confirmar via o validador. Avaliar uma variável lida via `EnvironmentProvider` para desligar a regra sem novo deploy. Só vale a pena se o custo for baixo. Tactic: Rollback.

**Resultado Esperado**
> Um operador consegue reverter em minutos sem investigação. Procedimento documentado: 0 → 1.

**Métricas de sucesso**
- Passos de rollback documentados: 0 → 1 seção
- Tempo estimado de rollback: não documentado → ≤ 15 min

**Risco de não fazer**
> Em um incidente de baixa errada, o rollback depende da memória de quem estiver de plantão.

**Dependências**: Nenhuma

---

### [integrability-1] Validar `bxaMnyValorPermuta` na fronteira do client e fixar fixture do passo 3

**QA**: Integrability
**Tactic alvo**: Manage Resource Coupling
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> O campo é usado como saldo vivo do adto, mas só tem tipo TS. Um valor não numérico gera `NaN` e o teto vira no-op sem aviso (`ReconciliacaoPermutaService.ts:1021-1023`).

**Melhoria Proposta**
> Parsear o campo com Zod no mapeamento do passo 3 (número finito ou ausente). No service, tratar `Number.isFinite` falso como WARN explícito. Adicionar fixture gravada da resposta real do passo 3 em `ConexosSubClients.test.ts`.

**Resultado Esperado**
> Campo malformado gera alerta em vez de passar calado. Fixtures do passo 3: 0 → 1.

**Métricas de sucesso**
- Fixtures gravadas do passo 3: 0 → 1
- Caminhos silenciosos para `NaN` no teto: 1 → 0

**Risco de não fazer**
> uma mudança no ERP desliga a proteção sem ninguém perceber, e a recusa em Finalizar volta a ocorrer.

**Dependências**: Nenhuma

---

### [modifiability-1] Extrair ajuste de variação cambial compartilhado entre âncora e teto

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> `ancorarVariacaoNoAdto` e `limitarAoDisponivelDoAdto` repetem a lógica de deslocar juros/desconto por um delta com guardas de sinal e teto. Mudar a regra obriga mexer em dois métodos e dois call-sites.

**Melhoria Proposta**
> Criar um colaborador (ex.: `AjusteVariacaoAdto` com `aplicarDelta({juros, desconto, isDesconto, delta})` retornando `undefined` se ficar negativo) em `domain/service/permutas/`, e fazer os dois métodos usá-lo. Tactic: Abstract Common Services / Refactor. Fazer junto da próxima mudança em I-Write-6 ou I-Write-10, não isolado.

**Resultado Esperado**
> Regra de sinal e arredondamento em um único lugar; ~30 LOC removidos do serviço.

**Métricas de sucesso**
- Pontos de edição por mudança de regra de variação: 2 → 1
- LOC duplicadas na lógica de ajuste: ~25 → 0

**Risco de não fazer**
> uma terceira guarda no mesmo ponto triplica a duplicação; divergência de sinal entre guardas gera baixa recusada no Finalizar.

**Dependências**: Nenhuma

---

### [testability-1] Cobrir fronteira e ramos restantes do teto I-Write-10

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> `limitarAoDisponivelDoAdto` tem 6 ramos de decisão e 4 testes. Faltam: `bxaMnyValorPermuta` ausente, excesso exato R$1,00 (ajusta) vs R$1,01 (não ajusta), DESCONTO com excesso > R$1,00 e excesso 0.

**Melhoria Proposta**
> Acrescentar 4 casos no describe I-Write-10 de `ReconciliacaoPermutaService.test.ts` (ou, com testability-3, direto na função extraída), com `it.each` para a fronteira. Tactic: Executable Assertions.

**Resultado Esperado**
> Ramos de decisão do teto com teste 4/6 → 6/6; testes de fronteira 0 → 2.

**Métricas de sucesso**
- Ramos cobertos: 4/6 → 6/6
- Casos do describe I-Write-10: 4 → 8

**Risco de não fazer**
> Mudança de `>` para `>=` no teto passa o CI e reabre a recusa do ERP no Finalizar.

**Dependências**: Nenhuma

---

### [modifiability-3] Planejar split de ReconciliacaoPermutaService por responsabilidade

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-3

**Problema**
> O serviço tem 1231 LOC e 20 imports, e cresceu +71 neste fix. Regras de baixa (passos 3-5, âncora, teto) coexistem com orquestração e elegibilidade.

**Melhoria Proposta**
> Extrair o conjunto "cálculo do líquido da baixa" (âncora, teto, buildComentario, buildFinalPayload) para um serviço dedicado, mantendo `ReconciliacaoPermutaService` como orquestrador. Tactic: Split Module. Fazer proporcionalmente no próximo `/feature-tweak` que tocar essas regras (política do CLAUDE.md), nunca como refactor isolado.

**Resultado Esperado**
> Arquivo-host de 1231 → ≤ 800 LOC no primeiro corte; imports 20 → ≤ 15.

**Métricas de sucesso**
- LOC do arquivo: 1231 → ≤ 800
- Imports: 20 → ≤ 15

**Risco de não fazer**
> em 6 meses, com mais I-Write-N, o arquivo passa de 1400 LOC e as sessões paralelas conflitam com frequência.

**Dependências**: modifiability-1

---

## P3 — Baixo

### [availability-2] Teste de retentativa após perna já gravada (disponível reduzido)

**QA**: Availability
**Tactic alvo**: Retry
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> Não há teste que prove que, com disponível já reduzido pela perna gravada, o teto não ajusta nada (excesso > R$1 → só WARN). O comportamento hoje é correto por inspeção.

**Melhoria Proposta**
> Exception Handling/Retry: acrescentar um teste em `ReconciliacaoPermutaService.test.ts` em que `bxaMnyValorPermuta` seja menor que o líquido por mais de R$1 e `juros/desconto` voltem intactos, junto da confirmação do gate de idempotência.

**Resultado Esperado**
> Cobertura do cenário de retentativa: 0 → 1 teste, protegendo contra ajuste silencioso futuro.

**Métricas de sucesso**
- Testes do cenário de retentativa: 0 → 1

**Risco de não fazer**
> uma mudança futura no teto poderia gravar valor errado numa retentativa sem ser pega.

**Dependências**: Nenhuma

---

### [deployability-2] Registrar o validador como script npm

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> O validador `validate-permuta-centavos-adto-v1.ts` só roda se alguém souber o caminho e as variáveis de ambiente. Não há entrada em `package.json`.

**Melhoria Proposta**
> Adicionar `"job:validate-permuta-centavos-adto": "tsx jobs/validate-permuta-centavos-adto-v1.ts"` em `src/backend/package.json` e mencionar o comando no ADR-0062. Tactic: Script Deployment Commands.

**Resultado Esperado**
> A verificação pós-deploy vira um comando único e repetível. Scripts registrados: 0 → 1.

**Métricas de sucesso**
- Comando registrado para o validador: 0 → 1

**Risco de não fazer**
> A checagem pós-deploy cai em desuso e a regressão passa sem ser vista.

**Dependências**: Nenhuma

---

### [fault-tolerance-1] Registrar de forma durável baixas acima do disponível fora da tolerância

**QA**: Fault Tolerance
**Tactic alvo**: Quarantine
**Esforço**: S
**Findings**: F-fault-tolerance-1

**Problema**
> Quando o líquido excede o disponível do adto em mais de R$1,00 (ou o juros ficaria negativo), o cap só emite BUSINESS_WARN e segue para o ERP, que deve recusar. Observado em 1 de 196 execuções (borderô 2646).

**Melhoria Proposta**
> Alternativa: abortar a baixa antes do passo 5 com erro tipado (forward recovery) e encaminhar à fila de exceção da analista, em vez de depender da recusa do ERP. Tactic: Quarantine. Tocar `limitarAoDisponivelDoAdto` e o tratamento do erro em `ReconciliacaoPermutaService`.

**Resultado Esperado**
> Item fora de tolerância fica visível na fila de exceção sem depender de ler log: sinalizações duráveis 0 → 100% dos casos.

**Métricas de sucesso**
- Casos fora de tolerância com registro durável: 0% → 100%

**Risco de não fazer**
> casos raros continuam dependendo de leitura de log ou do erro do ERP.

**Dependências**: decisão do produto sobre abortar vs. seguir (ADR-0062).

---

### [fault-tolerance-2] Logar quando `bxaMnyValorPermuta` vier ausente no passo 3

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> O cap retorna sem aviso se o ERP omitir `bxaMnyValorPermuta`; uma mudança de contrato desligaria a proteção sem rastro.

**Melhoria Proposta**
> Emitir BUSINESS_WARN (uma linha) no retorno antecipado e adicionar teste. Tactic: Condition Monitoring.

**Resultado Esperado**
> Desativação do cap observável em log: 0 → 1 evento por ocorrência.

**Métricas de sucesso**
- Logs no ramo sem disponível: 0 → 1 por ocorrência

**Risco de não fazer**
> regressão silenciosa do defeito de centavos em 6 meses.

**Dependências**: Nenhuma

---

### [integrability-2] Travar a ordem âncora → teto em um único ponto de composição

**QA**: Integrability
**Tactic alvo**: Orchestrate
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> A composição depende da ordem de duas chamadas em `baixarTitulo`, coberta por um único teste.

**Melhoria Proposta**
> Agrupar as duas em um método `ajustarVariacaoDaBaixa` que documente e teste a ordem. Também pode ser só um teste de propriedade: líquido ≤ disponível após a composição.

**Resultado Esperado**
> Refatoração futura não desfaz o teto sem quebrar teste.

**Métricas de sucesso**
- Pontos de composição da ordem: 2 chamadas soltas → 1 método testado

**Risco de não fazer**
> regressão de centavos em refatoração futura.

**Dependências**: Nenhuma

---

### [modifiability-2] Expor o teto como função pura testável e remover o cast do job

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> O job de validação acessa o método privado via `as unknown as`, escapando do typecheck.

**Melhoria Proposta**
> Mover a parte pura (cálculo de excesso e novo juros/desconto, sem log) para uma função/classe exportada junto de `ToleranciaResiduo`; o serviço mantém só o logging. O job importa a parte pura. Tactic: Encapsulate. Pode ser feito junto com modifiability-1.

**Resultado Esperado**
> Job tipado; 0 casts para métodos privados; cálculo testável sem mock de `LogService`.

**Métricas de sucesso**
- Casts a membros privados: 1 → 0

**Risco de não fazer**
> renomear o método quebra o job em runtime, não em compilação; impacto baixo por ser one-off.

**Dependências**: modifiability-1 (opcional, mesmo refactor)

---

### [performance-1] Registrar duração de `baixarTitulo` para medir latência por baixa

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S (≤1d)
**Findings**: F-performance-1, F-performance-2

**Problema**
> O delta não adiciona I/O, mas não há medição de latência por baixa (fin010 com 5 passos contra um ERP de p99 2–10s). Sem `durationMs` não dá para provar que mudanças futuras não regridem a execução N:M.

**Melhoria Proposta**
> Adicionar `durationMs` no log final de `baixarTitulo` (Reduce Overhead / observabilidade) e, opcionalmente, métrica por passo. Tocar `ReconciliacaoPermutaService.ts`. Nenhuma ação no delta atual é bloqueante.

**Resultado Esperado**
> Latência por baixa passa de não medida para p95 observável em log; baseline definido para detectar regressão > 20%.

**Métricas de sucesso**
- Cobertura de `durationMs` nos logs de baixa: 0% → 100%
- Chamadas ERP/DB adicionais por baixa: 0 → 0 (sem regressão)

**Risco de não fazer**
> Uma regressão de latência na execução N:M só seria percebida por reclamação da analista.

**Dependências**: Nenhuma

---

### [security-1] Verificar o certificado TLS nos jobs que leem o banco de produção

**QA**: Security
**Tactic alvo**: Encrypt Data
**Esforço**: S
**Findings**: F-security-1

**Problema**
> O job novo e dois probes existentes conectam ao Postgres de produção com `rejectUnauthorized: false`. A conexão é cifrada, mas o certificado não é verificado.

**Melhoria Proposta**
> Extrair uma factory de `pg.Client` para jobs, com CA do provedor via env. Aplicar em `validate-permuta-centavos-adto-v1.ts` e nos probes. Pode ser feito junto da próxima migração de jobs.

**Resultado Esperado**
> Jobs de produção com verificação de certificado: 0 de 3 → 3 de 3.

**Métricas de sucesso**
- Jobs com `rejectUnauthorized: false`: 3 → 0

**Risco de não fazer**
> Um MITM em rede de operador captura a connection string de produção, e o padrão se replica em jobs novos.

**Dependências**: Obter o CA do provedor do banco.

---

### [security-2] Registrar o ajuste do teto no ledger de execução

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S
**Findings**: F-security-2

**Problema**
> Quando `limitarAoDisponivelDoAdto` corta a variação, o juros/desconto original só aparece no log. O ledger guarda apenas o valor final enviado.

**Melhoria Proposta**
> Gravar o excesso absorvido junto da linha de `permuta_alocacao_execucao` (coluna ou campo no payload auxiliar), via `ReconciliacaoPermutaService`. Fecha o Audit Trail para I-Write-10.

**Resultado Esperado**
> Ajustes de centavos rastreáveis só pelo ledger: 0% → 100% das baixas ajustadas.

**Métricas de sucesso**
- Baixas ajustadas com excesso persistido no ledger: 0% → 100%

**Risco de não fazer**
> Em auditoria, o ajuste só pode ser reconstituído enquanto o log existir.

**Dependências**: Migration SQL.

---

### [testability-2] Afirmar o log LIMITADA e expor a função para o validador sem cast

**QA**: Testability
**Tactic alvo**: Specialized Interfaces
**Esforço**: S (≤1d)
**Findings**: F-testability-2

**Problema**
> O log `BUSINESS_INFO` 'LIMITADA' não é afirmado em nenhum teste e o job de validação acessa o método privado por cast.

**Melhoria Proposta**
> Adicionar `expect(logService.info)` nos dois testes de sucesso. Tornar o método `public` (ou parte do módulo extraído de testability-3) para o job deixar de usar `as unknown as`. Tactic: Specialized Interfaces.

**Resultado Esperado**
> Asserções do log LIMITADA 0 → 2; casts em job 1 → 0.

**Métricas de sucesso**
- Asserções do log LIMITADA: 0 → 2
- Acoplamentos por cast: 1 → 0

**Risco de não fazer**
> Renomear o método quebra o validador só em runtime; o log some sem alarme.

**Dependências**: Nenhuma

---

### [testability-3] Extrair a aritmética de teto/âncora do serviço de 1231 LOC

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M (2–5d)
**Findings**: F-testability-3

**Problema**
> A regra monetária (âncora I-Write-6 + teto I-Write-10) é aritmética pura presa a `ReconciliacaoPermutaService` (1231 LOC) e testada com 6 stubs de ERP por caso.

**Melhoria Proposta**
> Extrair para um `@injectable` ou módulo de domínio puro (ex.: `AjusteCentavosPermuta`), com testes unitários diretos; manter a orquestração no serviço. Tactic: Limit Structural Complexity.

**Resultado Esperado**
> LOC do serviço 1231 → ≤ 1100 no primeiro corte; casos de teste de aritmética sem stub de ERP 0 → 8; tamanho de cada caso ≈ 6 stubs → 1 objeto de entrada.

**Métricas de sucesso**
- LOC do serviço: 1231 → ≤ 1100
- Casos de aritmética sem stub de ERP: 0 → 8

**Risco de não fazer**
> Cada ajuste monetário futuro soma LOC e stubs ao monólito; aumenta o custo de teste por mudança.

**Dependências**: fazer testability-1 antes, para ter rede de segurança na extração

---
