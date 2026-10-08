---
type: regis-review-kanban
run_id: 2026-10-08-2012-favorecido-autorizado
total: 25
counts: { p0: 0, p1: 3, p2: 15, p3: 7 }
closed: 2
---

# Kanban — financeiro — 2026-10-08-2012-favorecido-autorizado

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Dentro do mesmo esforço, ordem dos QAs (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability).
> Contagens ativas: 25 cards. Fora delas: 2 cards encerrados antes da consolidação (seção final). Texto dos cards copiado verbatim dos QA files; as únicas adições são as linhas "Status" e "Nota de consolidação".

---

## P0 — Crítico

Nenhum card P0 nesta rodada.

---

## P1 — Alto

### [deployability-1] Documentar e ensaiar a janela de migration destrutiva

**QA**: Deployability
**Tactic alvo**: Package Dependencies
**Esforço**: S
**Findings**: F-deployability-1, F-deployability-2

**Problema**
> A 0080 derruba 8 colunas e 5 tabelas no boot da nova instância enquanto a antiga ainda atende. Erros transitórios são possíveis no overlap.

**Melhoria Proposta**
> Acrescentar ao DEPLOY.md um pré-requisito de merge: re-contar as 5 tabelas e `destino_manual` imediatamente antes do merge e fazer o merge fora do horário de uso. Avaliar expand/contract (um release remove o uso, o seguinte faz o DROP) para migrations destrutivas futuras.

**Resultado Esperado**
> Overlap sem erro 500 observado; contagem pré-merge registrada no PR.

**Métricas de sucesso**
- Passo de re-medição documentado: 0 → 1
- Erros 5xx no deploy da 0080: não medido → 0

**Risco de não fazer**
> Cada migration destrutiva repete a janela e a corrida.

**Dependências**: nenhuma

---

### [testability-1] Injetar relógio e gerador de ID no módulo de favorecido autorizado

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> `AuthorizedPayeeService` lê `new Date()` em 6 pontos e os repositórios chamam `randomUUID()`. A suíte não congela o tempo, então as datas de autorização, reconferência e `janelaInicio` não são verificadas com valor exato.

**Melhoria Proposta**
> Criar `ClockProvider` e `IdProvider` `@singleton() @injectable()` e injetá-los em `AuthorizedPayeeService` e `AuthorizedPayeeRepository`. Tactic: Limit Non-Determinism. Reescrever as asserções que usam `expect.any(Date)` para valores fixos, e cobrir o fallback da linha 541.

**Resultado Esperado**
> Leituras de relógio sem seam no módulo 6 → 0; testes com tempo fixo 0 → ≥ 6 (um por escrita de data); `randomUUID` direto 3 → 0 nos repositórios do favorecido.

**Métricas de sucesso**
- Leituras de relógio sem seam: 6 → 0
- Testes com data exata: 0 → ≥ 6

**Risco de não fazer**
> regressão silenciosa nas datas de auditoria da autorização.

**Dependências**: nenhuma; reaproveitável por outros módulos do SISPAG.

---

### [modifiability-1] Extrair a verificação de favorecido do RemessaService

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: L (1–2sem)
**Findings**: F-modifiability-1, F-modifiability-2

**Problema**
> RemessaService tem 1701 LOC, 30 imports e funções de complexidade 94 e 38; o delta adicionou a integração do favorecido autorizado dentro dele.

**Melhoria Proposta**
> Split Module + Refactor: extrair para um `RemessaAutorizacaoGuard` (ou similar) a chamada a `AuthorizedPayeeService`/`DestinoPagamentoResolver` e o tratamento de erros associados; quebrar `RemessaService.ts:227` em passos nomeados. Fazer proporcionalmente no próximo `/feature-tweak` que tocar a remessa.

**Resultado Esperado**
> RemessaService ≤ 1000 LOC no primeiro passo, nenhuma função nova > 15.

**Métricas de sucesso**
- LOC RemessaService: 1701 → ≤ 1000
- Complexidade da função mais crítica: 94 → ≤ 30 (etapa 1)

**Risco de não fazer**
> cada regra nova de remessa aumenta o risco de regressão em geração de CNAB.

**Dependências**: testes de remessa existentes como rede de segurança.

---

## P2 — Médio

### [availability-1] Distinguir indisponibilidade do Conexos de "não autorizado" e retentar a leitura

**QA**: Availability
**Tactic alvo**: Retry
**Esforço**: S (≤1d)
**Findings**: F-availability-1

**Problema**
> A guarda converte qualquer erro de `getTituloAPagar` em `FALHA_LEITURA` e recusa o lote inteiro, descartando a causa. Em instabilidade curta do Conexos o analista é barrado e não sabe se deve agir no cadastro ou apenas tentar de novo.

**Melhoria Proposta**
> Envolver a leitura do título num `RetryExecutor` com backoff, preservar o status HTTP no log (sem dados do destino) e expor no erro um motivo `CONEXOS_INDISPONIVEL` separado de `FAVORECIDO_NAO_AUTORIZADO`. Manter a falha fechada.

**Resultado Esperado**
> Lotes barrados por falha transitória caem sem intervenção; a tela mostra a causa certa. Retentativas da guarda: 0 → 2 com backoff.

**Métricas de sucesso**
- Retentativas na guarda: 0 → 2
- Motivos distinguíveis na barragem: 1 (`FALHA_LEITURA`) → 2

**Risco de não fazer**
> remessas atrasadas em dias de instabilidade do Conexos e triagem errada pelo analista.

**Dependências**: nenhuma

---

### [availability-2] Limitar e paralelizar com concorrência controlada as leituras da guarda

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: S (≤1d)
**Findings**: F-availability-2

**Problema**
> O loop sequencial de `getTituloAPagar` soma a latência de todos os itens TED/PIX no caminho síncrono da remessa.

**Melhoria Proposta**
> Usar `BoundedConcurrency` (já no repo) com limite pequeno e respeitar o teto do cache de cadastro; medir a duração da guarda no log.

**Resultado Esperado**
> Tempo da guarda deixa de crescer linearmente com o tamanho do lote. Concorrência: 1 → limite configurável (ex.: 4).

**Métricas de sucesso**
- Concorrência das leituras: 1 → configurável
- Duração da guarda por lote: não medida → logada

**Risco de não fazer**
> timeouts em lotes grandes e reexecução manual.

**Dependências**: nenhuma; respeitar o limite de sessão do Conexos (ver memória sobre cap de sessões)

---

### [deployability-2] Criar runbook de rollback da 0080 com export automatizado

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-deployability-3

**Problema**
> O reverse perde as autorizações e não há runbook nem script de export.

**Melhoria Proposta**
> Criar `docs/runbooks/rollback-adr-0065.md` (modelo `rollback-adr-0043.md`) com export `\copy` em passos, ordem (código primeiro, SQL depois) e verificação. Adicionar teste de integração apply, reverse e reapply.

**Resultado Esperado**
> Rollback executável por qualquer operador em < 15 min, sem perda silenciosa.

**Métricas de sucesso**
- Runbooks dedicados: 0 → 1
- Ciclo apply/reverse/reapply testado: não → sim

**Risco de não fazer**
> Rollback com uso real perde a trilha de dupla aprovação.

**Dependências**: nenhuma

---

### [deployability-4] Registrar o resultado da guarda no log do deploy

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> Aborto da guarda só aparece como exceção de boot, sem sinalização de que é uma recusa deliberada.

**Melhoria Proposta**
> Citar a mensagem `0080: abortada` e a conduta (decidir com o Yuri) no runbook de deploy, para o plantonista distinguir de falha de infra.

**Resultado Esperado**
> Triagem de deploy preso em minutos.

**Métricas de sucesso**
- Tempo de triagem do aborto: não medido → < 5 min

**Risco de não fazer**
> Deploy preso confundido com incidente de infra.

**Dependências**: deployability-1

---

### [integrability-1] Isolar o acesso ao cadastro do Conexos no resolver

**QA**: Integrability
**Tactic alvo**: Restrict Communication Paths
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> `VerificacaoTedPixService` injeta `ConexosSispagClient` ao lado do `DestinoPagamentoResolver`, que já é a única regra de destino. Há dois caminhos até o Conexos.

**Melhoria Proposta**
> Mover as leituras restantes do client para métodos do resolver ou de um port de cadastro. O serviço passa a depender só do resolver.

**Resultado Esperado**
> Clients Conexos diretos em `VerificacaoTedPixService`: 1 -> 0.

**Métricas de sucesso**
- Clients diretos no serviço: 1 -> 0

**Risco de não fazer**
> Cada mudança no cadastro continua tocando dois serviços.

**Dependências**: nenhuma

---

### [integrability-2] Gravar fixtures do cadastro de favorecido no teste do client

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> O fingerprint do destino depende do shape de contas, chaves e documento do Conexos, e não há fixture real para travar esse shape.

**Melhoria Proposta**
> Adicionar fixtures redigidas (como `redigir-fixture-rem.ts`) e testes de parsing em `ConexosSispagClient.test.ts`. Validar o schema completo com Zod.

**Resultado Esperado**
> Fixtures de cadastro de favorecido: 0 -> 3 (contas, chaves PIX, documento).

**Métricas de sucesso**
- Fixtures de cadastro: 0 -> 3

**Risco de não fazer**
> Falsos `DESTINO_ALTERADO` por mudança de shape sem aviso.

**Dependências**: nenhuma

---

### [fault-tolerance-3] Tornar o finalizar robusto ao bump de versão e testar a falha parcial

**QA**: Fault Tolerance
**Tactic alvo**: Repair State
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3

**Problema**
> `versao + retirados.length` assume bumps exclusivos das retiradas e o caminho "retirou e falhou depois" não tem teste dedicado.

**Melhoria Proposta**
> Reler a versão do lote após as retiradas em vez de calcular, e cobrir com teste de duplicidade aberta e de conflito pós-retirada. Tocar `LotePagamentoService.finalizarLote`.

**Resultado Esperado**
> Zero conflitos espúrios; cenário parcial coberto: 0 -> 2 testes.

**Métricas de sucesso**
- Testes do caminho parcial: 0 -> 2

**Risco de não fazer**
> falsos conflitos de versão confundem o analista.

**Dependências**: nenhuma

---

### [testability-2] Adicionar testes de propriedade ao fingerprint, à regra e à máscara

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> As funções puras que decidem se um destino está autorizado só têm exemplos fixos, e `fast-check` não é usado no delta.

**Melhoria Proposta**
> Escrever propriedades com `fast-check` para `PayeeFingerprint` (determinismo, sensibilidade a cada campo, invariância a formatação, separação por `keyId`), `AuthorizedPayeeRule` (transições inválidas sempre rejeitadas) e `MaskDestino` (nunca expõe o valor completo).

**Resultado Esperado**
> Propriedades no delta 0 → ≥ 6; cada uma com ≥ 100 execuções geradas.

**Métricas de sucesso**
- Arquivos com `fast-check` no módulo: 0 → 3

**Risco de não fazer**
> colisão ou variação de fingerprint só aparece em produção.

**Dependências**: nenhuma.

---

### [availability-3] Painel e alarme para barramentos da guarda e reaprovações abertas

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: M (2–5d)
**Findings**: F-availability-3

**Problema**
> Barramentos por `FALHA_LEITURA` e reaprovações pendentes só aparecem em log; não há agregação nem alerta de taxa.

**Melhoria Proposta**
> Agregar `sispag_verificacao_evento` por motivo/dia em um painel (painel-operacao) e emitir alerta quando a taxa de `FALHA_LEITURA` passar de um limiar. Tactic: Monitor.

**Resultado Esperado**
> Detecção de indisponibilidade do Conexos pela taxa de barramento, sem depender do analista. Alarmes: 0 → 1 e painel por motivo.

**Métricas de sucesso**
- Alarmes sobre a guarda: 0 → 1
- Tempo para detectar Conexos instável: depende do usuário → < 15 min

**Risco de não fazer**
> dia de pagamento perdido sem sinal prévio.

**Dependências**: availability-1 (motivo distinguível)

---

### [modifiability-2] Dividir AuthorizedPayeeService em ciclo de vida e verificação

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: M (2–5d)
**Findings**: F-modifiability-3

**Problema**
> O serviço novo já tem 655 LOC e mistura transições de estado, verificação em remessa e revelação de destino.

**Melhoria Proposta**
> Increase Semantic Coherence: separar `AuthorizedPayeeLifecycleService` (solicitar/aprovar/rejeitar/revogar), `AuthorizedPayeeVerifier` (verificar/reconferir) e manter `revelar` isolado por ser sensível.

**Resultado Esperado**
> Nenhum arquivo > 400 LOC; imports ≤ 15.

**Métricas de sucesso**
- LOC máx.: 655 → ≤ 400
- Imports: 16 → ≤ 12

**Risco de não fazer**
> o arquivo cresce com alçadas e auditoria até ficar como o RemessaService.

**Dependências**: nenhuma.

---

### [modifiability-3] Mover acesso a repositórios/clients de routes/sispag.ts para serviços

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies
**Esforço**: M (2–5d)
**Findings**: F-modifiability-4

**Problema**
> A rota importa 4 repositórios/clients direto e tem 1147 LOC, 36 imports.

**Melhoria Proposta**
> Restrict Dependencies: criar serviços de fachada para execução/ingestão e dividir o router em `sispag.favorecidos.ts`, `sispag.remessa.ts`, `sispag.lotes.ts`.

**Resultado Esperado**
> 0 violações de camada, cada router ≤ 400 LOC.

**Métricas de sucesso**
- Violações de camada: 4 → 0
- LOC routes/sispag.ts: 1147 → ≤ 400 por arquivo

**Risco de não fazer**
> migração Lambda mais cara.

**Dependências**: `ontology/_inbox/migration-debt.md`.

---

### [performance-2] Deduplicar e cachear leitura de título na guarda de remessa

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: M
**Findings**: F-performance-2

**Problema**
> A guarda L8 chama `getTituloAPagar` por item, em série e sem cache.

**Melhoria Proposta**
> Reduce Overhead: reaproveitar o `pesCod`/favorecido já obtido na verificação do lote (fin064 por filial, uma leitura por filial, como em `VerificacaoTedPixService.lerFilial`) em vez de uma leitura por título.

**Resultado Esperado**
> Leituras de título na remessa de N itens: N → nº de filiais (tipicamente 1-3).

**Métricas de sucesso**
- Chamadas Conexos na guarda: N → ≤ 3 por lote
- Tempo da guarda para lote de 40 TED/PIX: 40 x ~1-3s → < 5s

**Risco de não fazer**
> Remessa lenta e consumo de sessão Conexos durante a janela de envio.

**Dependências**: nenhuma

---

### [fault-tolerance-2] Reverificar o favorecido na retomada e alertar sobre revogação

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring / Forward Recovery
**Esforço**: M (2–5d)
**Findings**: F-fault-tolerance-2, F-fault-tolerance-1

**Problema**
> Na retomada com lote nativo existente a L8 não roda; revogação posterior ao congelamento não é detectada.

**Melhoria Proposta**
> Na retomada, consultar só o estado da autorização (banco local, sem ERP): se revogada/rejeitada, não enviar o arquivo e emitir alerta ao analista (forward recovery explícito, sem desfazer o lote nativo). Documentar em runbook.

**Resultado Esperado**
> Retomadas com favorecido revogado: não detectadas -> 100% sinalizadas.

**Métricas de sucesso**
- Retomadas com checagem de revogação: 0% -> 100%

**Risco de não fazer**
> pagamento a favorecido revogado em retomada.

**Dependências**: decisão de produto sobre bloquear ou apenas alertar

---

### [security-1] Mover o segredo do HMAC para SSM e documentar a rotação de chave

**QA**: Security
**Tactic alvo**: Revoke Access
**Esforço**: M
**Findings**: F-security-1

**Problema**
> O segredo `SISPAG_FAVORECIDO_FINGERPRINT_KEY` é env var do Render e não há procedimento para trocá-lo; uma troca invalida todas as impressões sem caminho de migração (F-security-1).

**Melhoria Proposta**
> Ler o segredo de SSM SecureString `/tenants/{env}/{client}/favorecido-fingerprint-key` quando houver infra; até lá, registrar runbook de rotação: duas chaves ativas por `keyId` (`PayeeFingerprint` calcula com a chave do keyId gravado) e job que reabre reaprovação em lote controlado. Tactic: Revoke Access.

**Resultado Esperado**
> Rotação executável sem parada de TED/PIX; segredo fora do painel de env.

**Métricas de sucesso**
- Runbook de rotação: 0 → 1
- Chaves aceitas por keyId: 1 → 2 durante a janela

**Risco de não fazer**
> vazamento da chave obriga a parar pagamentos TED/PIX ou a seguir com chave comprometida.

**Dependências**: scaffold de `infra/` (para SSM); runbook independe.

---

### [testability-3] Dividir os testes grandes do SISPAG e cobrir os componentes sem teste

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M
**Findings**: F-testability-3, F-testability-4

**Problema**
> `RemessaService.test.ts` tem 2256 LOC e outros 4 arquivos passam de 500. Oito componentes da tela de favorecidos não têm teste próprio, e `listar`/`eventos` não têm `describe`.

**Melhoria Proposta**
> Extrair do `RemessaService.test.ts` um arquivo só para o gate de favorecido autorizado, com builders de fixture compartilhados. Adicionar testes de `DecidirAutorizacaoDialog`, `MotivoAutorizacaoDialog`, `RevelarDestinoButton` e `SolicitarAutorizacaoDialog`, e `describe` para `listar` e `eventos`.

**Resultado Esperado**
> Arquivos de teste acima de 500 LOC no SISPAG 5 → ≤ 3; componentes com teste próprio 0 de 8 → 4 de 8; métodos públicos com `describe` 7 de 9 → 9 de 9.

**Métricas de sucesso**
- Maior arquivo de teste: 2256 → ≤ 1200 LOC

**Risco de não fazer**
> o custo de testar o SISPAG continua crescendo a cada feature.

**Dependências**: nenhuma.

---

## P3 — Baixo

### [deployability-3] Avisar sobre env vars órfãs após o corte

**QA**: Deployability
**Tactic alvo**: Package Dependencies
**Esforço**: S
**Findings**: F-deployability-4

**Problema**
> Flags antigas saíram do blueprint sem aviso no boot.

**Melhoria Proposta**
> Nota no DEPLOY.md para apagar `SISPAG_DESTINO_MANUAL_ENABLED` e `SISPAG_EXCECAO_DESTINO_ENABLED` do dashboard, ou log de aviso no boot se definidas.

**Resultado Esperado**
> 0 vars órfãs no Render.

**Métricas de sucesso**
- Vars órfãs: 2 → 0

**Risco de não fazer**
> Ambiguidade futura sobre qual flag vale.

**Dependências**: nenhuma

---

### [modifiability-4] Registrar ponto de extensão para modalidades de pagamento

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S (≤1d)
**Findings**: F-modifiability-5

**Problema**
> TED/PIX é união fixa na regra do favorecido; nova modalidade exige tocar vários arquivos.

**Melhoria Proposta**
> Defer Binding: tabela de estratégia por modalidade (fingerprint + validator) resolvida por mapa tipado; só quando surgir a 3ª modalidade.

**Resultado Esperado**
> Nova modalidade = 1 arquivo + 1 registro.

**Métricas de sucesso**
- Arquivos tocados por nova modalidade: ~5 → 2

**Risco de não fazer**
> baixo; custo concentrado numa mudança futura.

**Dependências**: demanda de nova modalidade.

---

### [performance-3] Paginar a listagem de autorizações e não memoizar falha

**QA**: Performance
**Tactic alvo**: Limit Event Response
**Esforço**: S
**Findings**: F-performance-3, F-performance-4

**Problema**
> `listar` devolve até 1000 linhas; o cache do resolver memoiza rejeição sem retry.

**Melhoria Proposta**
> Limit Event Response: `LIMIT/OFFSET` com total via query-string do schema; no `memo`, remover a entrada do cache ao rejeitar (ou usar RetryExecutor para 5xx).

**Resultado Esperado**
> Resposta com ≤ 50 linhas por página; 5xx transitório não contamina o restante da rodada.

**Métricas de sucesso**
- Linhas por resposta: ≤ 1000 → ≤ 50
- Itens pendentes por falha transitória única: todos do favorecido → 1 retentativa antes

**Risco de não fazer**
> Degradação lenta da tela com histórico acumulado.

**Dependências**: nenhuma

---

### [fault-tolerance-1] Registrar a causa da falha de leitura na guarda L8 e ler títulos em paralelo limitado

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-4, F-fault-tolerance-1

**Problema**
> O `.catch(() => null)` na guarda L8 descarta o erro do Conexos; o analista só vê `FALHA_LEITURA`. As leituras são seriais.

**Melhoria Proposta**
> Logar `logService.warn` com a causa por item no catch (mantendo fail-closed) e usar leitura com concorrência limitada. Tocar `RemessaService.exigirFavorecidosAutorizados`.

**Resultado Esperado**
> Causa visível no log; tempo da guarda cai com N itens. Logs de causa: 0 -> 1 por falha.

**Métricas de sucesso**
- Falhas de leitura com causa no log: 0% -> 100%

**Risco de não fazer**
> diagnóstico lento em incidente do Conexos.

**Dependências**: nenhuma

---

### [security-2] Limitar e alarmar o `revelar`, e remover o fallback `'unknown'`

**QA**: Security
**Tactic alvo**: Detect Intrusion
**Esforço**: S
**Findings**: F-security-2

**Problema**
> `revelar` entrega destino completo sem limite de taxa nem alerta, e `ator()` cai em `'unknown'` (F-security-2).

**Melhoria Proposta**
> Limite por usuário (ex.: 30/h) com 429, alerta em `NotificacaoService` quando passar de um limiar, e `ator` lançando 401 se `req.user.sub` faltar. Tactics: Detect Intrusion, Inform Actors.

**Resultado Esperado**
> Uso anômalo de `revelar` gera alerta; autor nunca é `'unknown'`.

**Métricas de sucesso**
- Alertas de revelação em massa: 0 → 1 regra
- Eventos com ator `unknown`: possível → impossível

**Risco de não fazer**
> exfiltração de dados bancários por conta de aprovador comprometida passa despercebida.

**Dependências**: nenhuma.

---

### [security-3] Restringir `reconferir` e tirar a impressão da listagem geral

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: S
**Findings**: F-security-3, F-security-4

**Problema**
> `reconferir` muta estado sob `sispag:ver` (F-security-3) e a listagem devolve impressões desnecessariamente (F-security-4).

**Melhoria Proposta**
> Exigir `sispag:executar` em `reconferir` (ou separar leitura de abertura de reaprovação) e devolver a impressão só no `reconferir`/detalhe do aprovador. Tactic: Authorize Actors / Limit Exposure.

**Resultado Esperado**
> Mutações só por quem executa; impressão só na tela de decisão.

**Métricas de sucesso**
- Rotas de mutação com `sispag:ver`: 1 → 0
- Campos de impressão na listagem: 2 → 0

**Risco de não fazer**
> leitor derruba autorizações vigentes; superfície maior se a chave vazar.

**Dependências**: ajustar `routePermissions.test.ts` e a tela `favorecidos-autorizados`.

**Nota de consolidação**: a parte F-security-4 (impressão HMAC na listagem) foi resolvida no commit 0f60938 (respostas removem fingerprint/fingerprintObservado). Permanece em aberto apenas F-security-3 (`reconferir` sob `sispag:ver`).

---

### [testability-4] Fixar pisos de cobertura por arquivo para o núcleo de autorização

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-5

**Problema**
> Só `./domain/service/` tem piso próprio. Regra, fingerprint e repositório do favorecido caem no piso global de 72% linhas.

**Melhoria Proposta**
> Medir a cobertura atual de `AuthorizedPayeeRule`, `PayeeFingerprint`, `AuthorizedPayeeRepository` e `AuthorizedPayeeService` com `--coverage` e registrar pisos por arquivo em `jest.config.cjs`, arredondados para baixo como já se faz para `bootstrap.ts`.

**Resultado Esperado**
> Pisos dedicados 0 → 4 arquivos; o CI passa a falhar se qualquer um cair abaixo do medido.

**Métricas de sucesso**
- Pisos por arquivo no módulo: 0 → 4

**Risco de não fazer**
> queda de cobertura no gate de autorização passa despercebida.

**Dependências**: rodar `--coverage` uma vez para obter os valores.

---

## Encerrados antes da consolidação (não contam nos totais)

### [integrability-3] Aposentar o caminho legado de exceção de destino

**QA**: Integrability
**Tactic alvo**: Backward-compatibility shims
**Esforço**: M
**Findings**: F-integrability-3
**Status**: DESCARTADO (falso positivo): o caminho legado de exceção de destino foi removido pelo próprio delta; não há dois caminhos coexistindo. Fora das contagens ativas.

**Problema**
> Depois que a flag for ligada em produção, o caminho legado vira código morto com custo de manutenção.

**Melhoria Proposta**
> Remover o legado e a flag depois de uma janela estável, usando `aposentar-excecoes-substituidas`.

**Resultado Esperado**
> Caminhos de autorização de destino: 2 -> 1.

**Métricas de sucesso**
- Caminhos de autorização: 2 -> 1

**Risco de não fazer**
> Divergência de regra entre os dois caminhos.

**Dependências**: flag ligada e estável em produção

---

### [performance-1] Limitar e orçar a leitura do cmn025 no relatório de candidatos

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S
**Findings**: F-performance-1
**Status**: RESOLVIDO no commit 0f60938 (página de candidatos: máximo 25, padrão 20; respostas sem fingerprint). Fora das contagens ativas.

**Problema**
> O relatório lê o cmn025 de cada favorecido da página em série, TED e PIX, com `limite` até 100. Com Conexos lento a requisição pode passar de 1 minuto.

**Melhoria Proposta**
> Bound Execution Times: reduzir default/máximo do `limite` (ex.: 25/50), adicionar orçamento de tempo na página (itens além do orçamento voltam como `FALHA_LEITURA`/"não lido" com botão de reconferir), reutilizar a leitura entre TED e PIX do mesmo favorecido. Manter leitura sequencial (teto de sessões). Tocar `AuthorizationCandidatesService.ts` e `schemas.ts`.

**Resultado Esperado**
> Relatório responde em tempo limitado mesmo com Conexos lento.

**Métricas de sucesso**
- Chamadas Conexos por página: ~200-300 (pior caso) → ≤ 75
- p95 da rota candidatos (pior caso): não medido (> 60s estimado) → < 5s

**Risco de não fazer**
> Timeout do Render na tela principal de autorização quando a base de fornecedores crescer.

**Dependências**: nenhuma

---
