---
qa: Security
qa_slug: security
run_id: 2026-10-14-2230
agent: qa-security
generated_at: 2026-10-14T23:00:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 4
---

# Security — Regis-Review

> Escopo reduzido: delta `origin/main..HEAD` (tweak `sispag-passo2-vinculo-codbar`, ADR-0071). Repositório sem `infra/`/Terraform: métricas de IAM, CloudTrail, API Gateway e rede são não medíveis aqui. Nenhum finding P0.

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider com acesso a log/banco/trilha, ou usuário com `sispag:ver` | Tenta obter o código de barras (44/47 dígitos) de um boleto, ou causar um vínculo de boleto no rascunho do ERP sem decisão humana | `VinculoCodigoBarrasService`, migration 0086, `sispag_sugestao_boleto_evento`, rota `vinculos-previstos`, jobs de sonda | Produção, flag `SISPAG_BIND_CODBAR_FILIAIS` off por default; `on` escreve no ERP | Código completo nunca persistido/logado/devolvido; escrita só com decisão `CONFIRMADA` e flag `on` por filial; trilha atribuível | 0 ocorrências de 20+ dígitos em colunas/logs/payloads; 100% dos `VINCULO_APLICADO` ligados a um `decisao_id` humano |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Colunas novas que podem guardar código completo | 0 (`vinculo_codigo_mascarado` com CHECK `^[0-9]{5}…[0-9]{4}$`) | 0 | ✅ | `migrations/0086_...sql` |
| Guard na aplicação antes do CHECK | sim (`isCodigoMascarado`, e `\d{10,}` em `detalhe` do evento) | sim | ✅ | `LotePagamentoRepository.gravarVinculoCodigoBarras`, `SugestaoBoletoRepository.registrarEventoVinculo` |
| SQL novo parametrizado | 100% (`$nome` / named params; sem interpolação) | 100% | ✅ | diff dos repositórios |
| Flag lida só via `EnvironmentProvider` | sim (service/rota); `process.env` cru só em jobs de sonda | sim | ✅ (⚠️ jobs) | `EnvironmentProvider.ts`, `RemessaService.ts` |
| Parse da flag fail-closed | sim: qualquer token inválido ⇒ mapa vazio ⇒ `off`; kill-switch `sispagLiveWriteEnabled` derruba | sim | ✅ | `ModoVinculoCodigoBarras.ts` |
| Rotas novas com permissão | 1/1 (`GET .../vinculos-previstos` = `sispag:ver`, coberta pela introspecção 57 rotas) | 100% | ✅ | `routes/sispag.ts`, `routePermissions.test.ts` |
| Rota nova escreve? | não (local, `Cache-Control: no-store`, só máscara) | n/a | ✅ | `routes/sispag.ts` |
| Eventos `VINCULO_*` com ator humano | 0/3 (`ator: 'sistema'`; humano só via `decisao_id`) | rastreável | ⚠️ | `VinculoCodigoBarrasService.ts:853,915,934` |
| Hardcoded secrets / `.env` no delta | 0 | 0 | ✅ | grep no delta |
| Sonda PRD sem escrita | teste estático lê o fonte e falha com método de escrita | sim | ✅ | `probe-prd-readonly-permissao-fin015(.test).ts` |
| Job HML recusa base não-HML | `includes('-hml')` (substring) | allowlist de host | ⚠️ | `probe-hml-vinculo-codbar-v1.ts:59`, `hmlEnvFile.ts` |
| Dependências (`npm audit`) | não executado (escopo delta, sem nova dependência) | crit/high=0 | ⚠️ Não medível | — |
| IAM/CloudTrail/GuardDuty/authorizer | N/A | — | ⚠️ Não medível: sem `infra/` | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta; sem alarme para tentativa de vínculo fora de decisão | ⚠️ parcial | — |
| Detect Service Denial | N/A ao delta | N/A | — |
| Verify Message Integrity | Releitura do rascunho decide o sucesso (observa código/banco/valor/data); nunca confia no retorno do PUT | ✅ | `VinculoCodigoBarrasService.ts:570-592` |
| Detect Message Delay | N/A | N/A | — |
| Identify Actors | Decisão humana identificada na trilha da sugestão; evento de vínculo é `sistema` | ⚠️ parcial | `:853,915` |
| Authenticate Actors | Herdado do middleware existente | ✅ | `routes/sispag.ts` |
| Authorize Actors | `exigirPermissao(SISPAG_VER)`; escrita só dentro da geração de remessa (`sispag:executar` herdado) e com decisão `CONFIRMADA` recalculada do banco | ✅ | `routes/sispag.ts`; `avaliar` |
| Limit Access | Flag por filial + kill-switch global + nunca em lote FINALIZADO + edição de terceiro nunca sobrescrita (`ItemEditadoPorTerceiroError`) | ✅ | `ModoVinculoCodigoBarras.ts`, service |
| Limit Exposure | Só máscara 5+4 em coluna, trilha, resposta HTTP, avisos e logs | ✅ | 0086, rota, `RemessaService` |
| Encrypt Data | N/A ao delta (transporte/repouso herdados) | N/A | — |
| Separate Entities | Etapa em memória, fora do ledger; sonda PRD separada do job HML | ✅ | `RemessaService.ts` |
| Change Default Settings | Default `off`; sonda PRD exige flag explícita e `databaseConnectionString=""` | ✅ | `EnvironmentProvider.ts:351` |
| Validate Input | Zod existente no boundary do client; CHECKs da 0086 (tudo-ou-nada, origem, máscara) | ✅ | 0086 |
| Revoke Access | Kill-switch `sispagLiveWriteEnabled` e flag por filial sem deploy; reversão do vínculo no ERP = retirada I16d | ⚠️ parcial | `resolverModo` |
| Lock Computer | N/A | N/A | — |
| Inform Actors | Aviso "confira no extrato" + selo no LoteCard; `VINCULO_FALHOU` registrado | ✅ | `RemessaService.ts` avisos |
| Restore | Rollback SQL só de estrutura; item vinculado no ERP é desfeito por retirada/novo rascunho | ⚠️ parcial | `rollbacks/0086_...rollback.sql` |
| Audit Trail | Coluna do item + `VINCULO_APLICADO` na MESMA transação; índice único de idempotência; trilha só-inclusão (trigger 0084) | ✅ | `persistir`, 0086 |

## 4. Findings

### F-security-1: evento de vínculo registra `ator = 'sistema'`, sem o usuário que disparou a remessa

- **Severidade**: P2
- **Tactic violada**: Identify Actors / Audit Trail
- **Localização**: `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts:853,915,934`
- **Evidência (objetiva)**:
  ```
  tipo: EVENTO_SUGESTAO_BOLETO.VINCULO_APLICADO, ator: 'sistema', ... decisaoId
  ```
- **Impacto técnico**: quem autorizou o código está na decisão (`decisao_id` -> `DECISAO_CONFIRMADA`), mas quem acionou a geração da remessa que gravou o código no ERP não aparece no evento. Reconstituir "quem escreveu no ERP" exige cruzar com o ledger da remessa.
- **Impacto de negócio**: em auditoria de pagamento indevido, a cadeia decisor -> executor tem um elo implícito.
- **Métrica de baseline**: 3 de 3 tipos `VINCULO_*` com ator `sistema`; 0 com usuário executor.

### F-security-2: guarda do job HML por substring `-hml` e `process.env` cru nas sondas

- **Severidade**: P3
- **Tactic violada**: Change Default Settings / Limit Access
- **Localização**: `src/backend/jobs/probe-hml-vinculo-codbar-v1.ts:59-70`, `src/backend/jobs/hmlEnvFile.ts`
- **Evidência (objetiva)**:
  ```
  if (!BASE.includes('-hml')) { RECUSADO }   // aceita qualquer host contendo "-hml"
  ```
- **Impacto técnico**: um host como `evil-hml.exemplo` passaria e receberia `CONEXOS_USERNAME/PASSWORD` de HML. Credenciais são só de arquivo privado e nunca impressas (positivo), e HML é escrita real.
- **Impacto de negócio**: baixo (credencial de HML), mas o job escreve em ERP; a guarda deveria ser allowlist de host exato.
- **Métrica de baseline**: 1 guarda por substring; 0 por allowlist.

### F-security-3: `sanea` do job HML mascara só 20+ dígitos contíguos; saída em `/tmp`

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/jobs/probe-hml-vinculo-codbar-v1.ts:90,508,1002`
- **Evidência (objetiva)**:
  ```
  JSON.stringify(v).replace(/\d{20,}/g, '…')   // linha digitável com pontos/espaços não casa
  log(`import ...: ${JSON.stringify(r).slice(0, 200)}`)   // sem sanea
  ```
- **Impacto técnico**: linha digitável formatada (47 dígitos com `.` e espaço) escapa da máscara; `resultados.json` fica em `/tmp`. Dados são sintéticos de HML, então o risco é baixo.
- **Impacto de negócio**: nenhum em PRD; padrão ruim se o job for copiado para PRD.
- **Métrica de baseline**: 1 regex de 20+ dígitos contíguos; 1 log sem sanitização.

### F-security-4: padrão de mascaramento duplicado (CHECK, guard de repositório, regex de `detalhe`, `sanea`)

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: 0086, `LotePagamentoRepository.ts`, `SugestaoBoletoRepository.ts:registrarEventoVinculo`
- **Evidência (objetiva)**: `\d{10,}` em `detalhe` mas coluna `motivo` e `emissor_chave` do evento sem a mesma guarda.
- **Impacto técnico**: hoje `motivo` só recebe constantes; um futuro chamador poderia gravar texto livre de ERP (que pode ecoar o código) sem guarda.
- **Impacto de negócio**: baixo; regressão potencial de privacidade.
- **Métrica de baseline**: 1 de 2 campos de texto livre do evento com guarda de dígitos.

### F-security-5: mensagem de erro do ERP pode ecoar o código e `cause` (axios) carrega o body

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `ConexosSispagWriteClient.ts:318-326` (`ConexosError{ cause, message: describeConexosValidation }`)
- **Evidência (objetiva)**: o service captura e converte para constantes (`ERP_RECUSOU_*`, `*_TRANSITORIA`) e loga só flags; `VinculoCodigoBarrasPrivacidade.test.ts` cobre. O risco é qualquer chamador futuro de `validarCodigoBarras/confirmarCodigoBarras` fora do service logar o erro cru.
- **Impacto técnico**: sem vazamento hoje; barreira depende de convenção.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 1 ponto de captura (service) para 2 métodos do client que enviam o código.

## 5. Cards Kanban

### [security-1] Registrar o usuário executor no evento de vínculo

- **Problema**
  > `VINCULO_APLICADO/FALHOU/SIMULADO` gravam `ator='sistema'`. Para provar quem fez o ERP receber o código, é preciso cruzar decisão e ledger de remessa manualmente.

- **Melhoria Proposta**
  > Propagar o ator da geração da remessa (usuário autenticado) até `VinculoCodigoBarrasService.executar` e gravá-lo em `detalhe.executadoPor` (ou coluna `ator` composto), mantendo `decisao_id` como autor da autorização.

- **Resultado Esperado**
  > Cada vínculo aplicado mostra decisor e executor; 0/3 -> 3/3 tipos com executor.

- **Tactic alvo**: Identify Actors / Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Eventos `VINCULO_APLICADO` com executor identificado: 0% -> 100%
- **Risco de não fazer**: em investigação de pagamento indevido a atribuição depende de correlação manual.
- **Dependências**: nenhuma

### [security-2] Endurecer a guarda dos jobs de sonda (allowlist de host)

- **Problema**
  > O job HML valida base com `includes('-hml')` e lê credencial de arquivo para `process.env`; basta um host contendo `-hml` para receber a credencial.

- **Melhoria Proposta**
  > Comparar o host com allowlist exata (`columbiatrading-hml.conexos.cloud`) em `probe-hml-vinculo-codbar-v1.ts` e `hmlEnvFile.ts`; manter recusa de PRD.

- **Resultado Esperado**
  > Guarda por host exato; teste estático cobrindo a recusa.

- **Tactic alvo**: Limit Access
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Hosts aceitos: qualquer com `-hml` -> 1 exato
- **Risco de não fazer**: baixo; ruído de segurança se o job for reaproveitado.
- **Dependências**: nenhuma

### [security-3] Centralizar sanitização de códigos de barras e cobrir linha digitável formatada

- **Problema**
  > Quatro mecanismos distintos de máscara/guarda; `sanea` do job HML não pega linha digitável com separadores e `motivo` do evento não tem guarda.

- **Melhoria Proposta**
  > Um helper único (`soDigitos(...).length >= 20` após remover separadores) usado em `registrarEventoVinculo` (em `detalhe` e `motivo`) e em `sanea`; teste de propriedade com 44/47 dígitos formatados.

- **Resultado Esperado**
  > Todos os campos de texto livre da trilha e logs de sonda rejeitam/mascaram código formatado ou não.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3, F-security-4
- **Métricas de sucesso**:
  - Campos de texto livre da trilha com guarda: 1/2 -> 2/2
- **Risco de não fazer**: regressão futura de privacidade sem teste que a pegue.
- **Dependências**: nenhuma

### [security-4] Impedir log cru de erros do client que enviam o código

- **Problema**
  > `ConexosError.cause` (axios) e a mensagem do ERP podem conter o código; hoje só o service os captura corretamente.

- **Melhoria Proposta**
  > No client, sanitizar `message` e descartar `config.data/response.data` do `cause` de `validarCodigoBarras`/`confirmarCodigoBarras`/`editarItemDoRascunho`; teste de que o erro serializado não contém 20+ dígitos.

- **Resultado Esperado**
  > Barreira estrutural em vez de convenção do service.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - Métodos do client que enviam o código com erro saneado: 0/3 -> 3/3
- **Risco de não fazer**: um novo chamador loga o erro cru com o código completo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Pontos que passaram sem finding: CHECKs da 0086 (mascara, tudo-ou-nada, origem), SQL parametrizado, flag fail-closed por filial com kill-switch, rota `sispag:ver` somente leitura local, trilha na mesma transação, sonda PRD com teste estático, job HML sem imprimir credenciais.
- Quem pode causar um bind: qualquer papel com permissão de gerar remessa (`sispag:executar`) com filial em `on` e decisão `CONFIRMADA`; `sispag:ver` não escreve.
- Cross-QA: Audit Trail <-> Fault Tolerance; Limit Exposure <-> Availability (blast radius da flag `on`); Restore <-> Deployability (rollback só estrutural).
- Não medíveis: IAM, CloudTrail, authorizers, `npm audit` (sem `infra/`; delta sem nova dependência).
