---
qa: Security
qa_slug: security
run_id: 2026-08-03-0904
agent: qa-security
generated_at: 2026-08-03T09:04:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Security — Regis-Review

> **Escopo REAL desta seção:** delta `fix/sn-cond-pgto-finalizacao..HEAD` (worktree
> `C:/tmp/sn-titulo-wt`). Dois commits (`6d9c8c2` fix + `8598ef6` ADR-0025). Onze arquivos, +513/-47.
> Núcleo funcional: `RecebimentoNumerarioService.applyPaymentConditionIfRequired` +
> `requiresRegisteredPaymentCondition` — um NOVO caminho de escrita financeira condicional
> (PUT `com299` trocando `pgtCod`) num documento REAL da SN, executada quando a com194 acusa validação
> bloqueante. Não há `infra/`/Terraform/IAM/SSM neste repositório (Express + Render + Supabase — ver
> CLAUDE.md); métricas dessas camadas são NÃO-APLICÁVEIS por ausência do alvo, não por falha de coleta.
> Flag `--quick`: sem `npm audit` profundo, sem coverage.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (operação legítima) OU insider com acesso ao `.env` do backend | POST `/recebimentos/transacoes/{txnId}/solicitacao-numerario` que dispara o PUT `com299` (troca `pgtCod`) num documento financeiro REAL sob credencial de serviço do Conexos | `RecebimentoNumerarioService.applyPaymentConditionIfRequired` + `atualizarDocumento` + os 7 testes `.integration.test.ts` que executam contra o Conexos HML lendo credencial de `src/backend/.env` | Escrita LIGADA (`CONEXOS_WRITE_ENABLED=true` + `CONEXOS_DRY_RUN=false`) em HML/prod | (a) só grava a condição do PRÓPRIO cliente do doc (fail-closed contra swap de terceiro); (b) só grava quando a com194 exige (fail-closed contra destruir o título por engano); (c) VERIFICA `mnyTitValor===docMnyValor` pós-PUT e falha nomeada se o ERP destruiu as parcelas; (d) `ator`/`txnId` registrados no ledger (`beginExecution` + `ndeRepository.save`) | 0 documento com condição de terceiro gravado; 0 finalização de doc com título zerado; trilha `who/when/what` do PUT reconstruível SÓ pelo par (`sn_execucao.executado_por`, `sn_execucao.request_payload`) — não há registro dedicado da mutação `pgtCod`. |

Cenário adversário paralelo: **credencial Conexos HML vazada via arquivo de teste ou log de CI.**
Contra-medida presente no delta: `.env` gitignored + guard `/-hml\./` em TODOS os 7 integration tests
(bloqueia apontar para produção por acidente); nenhum segredo commitado no delta em revisão.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded introduzidos pelo delta | 0 | 0 | ✅ | `git log -p fix/sn-cond-pgto-finalizacao..HEAD \| grep -iE "(password\|secret\|token\|api[_-]?key\|credential)"` (só bate na string fake `e2e-secret` que já existia no `recebimentos.e2e.falhas.test.ts`) |
| `.env` / `terraform.tfstate` / chaves adicionados ao repo pelo delta | 0 | 0 | ✅ | `git diff --name-status fix/sn-cond-pgto-finalizacao..HEAD` |
| `.env` do backend git-ignorado | sim | sim | ✅ | `git check-ignore -v src/backend/.env` → `src/backend/.gitignore:3:.env` |
| Integration tests que leem credencial de `src/backend/.env` | 7 | — (aceito, opt-in) | ✅ | `Grep carregarDotEnv src/backend/routes/*.integration.test.ts` |
| Integration tests com guard anti-produção (`/-hml\./`) | 7/7 | 7/7 | ✅ | `Grep "/-hml\\." src/backend/routes` |
| Robustez do guard anti-produção | regex substring — casa `-hml.` em qualquer posição da URL, inclusive query string | hostname-strict (`.hostname.endsWith('-hml.conexos.cloud')` ou allowlist) | ⚠️ | `src/backend/routes/recebimentos.e2e.hmlTituloCondicao.integration.test.ts:123` (e as outras 6) |
| Escrita financeira NOVA no delta (PUT `com299` swap `pgtCod`) com log de auditoria dedicado | 0 (apenas o log genérico de falha via `registrarFalha`) | 1 registro `who/when/what/before/after` por mutação | ⚠️ | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:462-519` |
| Ator (`ator`) propagado do request até a persistência da execução | sim (`beginExecution.executadoPor`, `ndeRepository.save.emitidaPor`) | sim | ✅ | `RecebimentoNumerarioService.ts:325,1229` |
| Mensagens de erro NOVAS que embarcam dado sensível de cliente (nome, valor, condição de pagamento com nome do cliente) | 2 `throw` (linhas 476-482 e 510-518) | 0 dado sensível em texto de exceção OU log com política de redaction | ⚠️ | `RecebimentoNumerarioService.ts:476-482,510-518` — as strings entram no `logService.error` via `registrarFalha` (`ts:1326-1332`) |
| Artefatos de teste com dado sensível gravados em disco (`C:/tmp/*.json`) | 6 arquivos (`exp-titulo-*-hml.json`, `probe-titulos-hml.json`, `exp-titulos-hml.json`) | fora do repo (✅), com lifecycle/cleanup definido (⚠️) | ⚠️ | `Grep writeFileSync src/backend/routes/*.integration.test.ts` |
| CVEs `critical`/`high` introduzidos pelo delta | não medido | 0 | ⚠️ N/A | `--quick`: sem `npm audit`. `package-lock.json` no delta = 0 hunks funcionais. |
| Cobertura de testes das novas branches condicionais | 6 casos novos no `RecebimentoNumerarioService.test.ts` (aplica quando exige; não aplica se aviso/outro assunto/com194 down; fail-closed se PUT destrói; ordem item→PUT) | ≥ 4 | ✅ | `RecebimentoNumerarioService.test.ts` diff (linhas 357-464 novas) |

> ⚠️ **Não medível localmente:** taxa de vazamento de credencial HML por logs de CI/erro produzidos pelos
> integration tests. Requer captura da saída do runner (`console.log` no ledger fake em `recebimentos.e2e.hmlWrite.integration.test.ts:321` imprime a resposta INTEIRA da rota, que inclui `pdcDocFederal`).
> Recomendação: gate de "sanitized JSON" nos `console.log` dos harnesses HML antes de rodar em CI.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do escopo do delta (nível-plataforma). Não há WAF/IDS aqui. | N/A | escopo delta |
| Detect Service Denial | N/A no delta | N/A | escopo delta |
| Verify Message Integrity | Pós-condição fail-closed do PUT: relê o doc e exige `mnyTitValor===docMnyValor` — se o ERP devolveu HTTP 200 mas destruiu as parcelas, a etapa falha nomeada em vez de finalizar. | ✅ presente | `RecebimentoNumerarioService.ts:503-519` |
| Detect Message Delay | N/A no delta (não altera timeouts do fluxo) | N/A | escopo delta |
| Identify Actors | `ator` chega no service (`processarAlocacao` input), atravessa até `beginExecution.executadoPor` e `ndeRepository.save.emitidaPor`. A rota upstream injeta `req.user.sub`. | ✅ presente | `RecebimentoNumerarioService.ts:207,281,325,1229` |
| Authenticate Actors | Não alterado no delta; camada de auth (JWT/Supabase) vive na rota Express, upstream. | N/A no delta | — |
| Authorize Actors | Não alterado no delta. O gate `NDE_ACL_INSUFICIENTE` (ACL Conexos com194) continua exercitado pelo cenário 4 de `recebimentos.e2e.falhas.test.ts` — não é o delta. | N/A no delta | `recebimentos.e2e.falhas.test.ts:911-937` |
| Limit Access | Guard `/-hml\./` em **todos** os 7 `*.integration.test.ts`: se `CONEXOS_BASE_URL` não contiver `-hml.`, o `beforeAll` aborta com `throw new Error('ABORTADO: CONEXOS_BASE_URL não é homologação (...)')`. Suficiente para evitar acidente humano; regex é substring-permissiva (ver F-security-2). | ⚠️ parcial | `src/backend/routes/recebimentos.e2e.hmlTituloCondicao.integration.test.ts:123` e homólogos |
| Limit Exposure | O PUT que troca `pgtCod` só é executado sob pendência bloqueante REAL da com194 — o caminho feliz do HML (SKYJACK, `count:0`) NÃO toca no documento. Reduz a superfície de escrita irreversível. | ✅ presente | `RecebimentoNumerarioService.ts:462-469`, ADR-0025 |
| Encrypt Data | Camada de plataforma (TLS na URL Conexos, Postgres/SB). Não alterado pelo delta. | N/A no delta | — |
| Separate Entities | A condição a gravar é DO PRÓPRIO cliente do doc (`escolherCondicaoPagamento` casa por `dpeNomPessoa`); sem match ⇒ `undefined` ⇒ throw. Impede swap de condição financeira de outra pessoa. | ✅ presente | `RecebimentoNumerarioService.ts:475-483,654-675` |
| Change Default Settings | Escrita real permanece OFF por default (`conexosWriteEnabled=false`/`conexosDryRun=true`); o delta não altera. | ✅ presente | `RecebimentoNumerarioService.ts:211-214` (inalterado) |
| Validate Input | (a) `escolherCondicaoPagamento` usa `prefixoDeTokens` + `prefixoTruncado` (fronteira de token, mínimo 3 chars no truncado, empate na mais específica) — evita casar "SKY" em "SKYJACK" por acidente; (b) `requiresRegisteredPaymentCondition` compara sem acentos via `stripAccents` para tolerar variação do ERP; (c) `assertNoErpError` valida cada resposta ERP em cima de `messages[].valid==='ERRO'`. | ✅ presente | `RecebimentoNumerarioService.ts:526-557,559-564,699-722,1369-1375` |
| Revoke Access | N/A no delta | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | Mensagens de erro operáveis (nomeiam o `snDocCod`, apontam a ação corretiva — "Gere as parcelas na tela Financeiro (com032) do documento e reprocesse a alocação"). Cross-cutting: vira o `body.erro` que a UI exibe ao analista. | ✅ presente | `RecebimentoNumerarioService.ts:511-518,477-482` |
| Restore | Retomada por etapa (o `existente.etapa` do ledger permite reprocessar sem reexecutar o que já concluiu). Escrita NOVA (PUT `pgtCod`) é idempotente pelo próprio ERP (o campo é sobrescrito), e a etapa `sn` é a única que pode disparar o PUT — retomada a partir de `sn-finalizar` não repete. | ✅ presente | `RecebimentoNumerarioService.ts:337-345,422-430` |
| Audit Trail | **Parcial no delta.** `ator` fica no ledger (`beginExecution.executadoPor`) e na NDe emitida (`ndeRepository.save.emitidaPor`), e o `requestPayload` da geração é gravado em `setRequestPayload`. Mas o PUT NOVO (`atualizarDocumento` trocando `pgtCod`) NÃO tem entrada dedicada de auditoria no caminho feliz — reconstrói-se pela combinação `executado_por + request_payload + erp_response`, sem `before/after` da mutação. Falha registra via `registrarFalha` (`logService.error` + `markError`). | ⚠️ parcial | `RecebimentoNumerarioService.ts:462-519` (sem `logService.info` na aplicação da condição); `RecebimentoNumerarioService.ts:1307-1342` (falha) |

## 4. Findings

### F-security-1: PUT `com299` trocando `pgtCod` num documento financeiro real não emite entrada de auditoria dedicada (caminho feliz)

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:462-519`
- **Evidência (objetiva)**:
  ```
  // applyPaymentConditionIfRequired: chama listCondPgtoPessoa → getDocumento → atualizarDocumento
  // (grava pgtCod novo) → getDocumento pós → valida invariante.
  // Após a mutação bem-sucedida NÃO há chamada a this.logService.info nem a
  // this.execucaoRepository.set*() registrando o par (pgtCod_anterior, pgtCod_novo, ator, timestamp).
  await this.gerDocClient.atualizarDocumento({
      tela: 'com299', filCod,
      payload: { ...doc, pgtCod: cond.pgtCod, pgtDesNome: cond.pgtDesNome, vldRwCondpgt: 1 },
  });
  // ↑ sem log de auditoria explícito nem gravação em coluna dedicada do ledger
  ```
  O único caminho de auditoria da execução hoje é `sn_execucao.executado_por` + `sn_execucao.request_payload` (gravado ANTES, em `etapaSn` linha 403), sem o antes/depois desta mutação específica. A falha, por outro lado, é registrada (throw → `registrarFalha` → `logService.error` + `markError`).
- **Impacto técnico**: reconstruir "quem trocou a condição de pagamento do doc X para Y" em auditoria de terceiros exige cruzar `sn_execucao` com o log do próprio ERP Conexos (que é fora do nosso perímetro). Se o ERP não retiver o histórico da mudança, a trilha se perde.
- **Impacto de negócio**: condição de pagamento é dado financeiro do documento (a proposta trata trilha de auditoria como não-negociável para toda ação que move dinheiro/desbloqueia documento). Auditor externo pergunta "por que este doc trocou de pgtCod?" e a resposta hoje é "consultar o Conexos"; não é o compromisso da automação.
- **Métrica de baseline**: 0/1 mutações financeiras do delta com entrada dedicada de auditoria; `grep -n "logService.info" src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` mostra 1 `info` em todo o service (o do dry-run, linha 251), nenhum no caminho de escrita.

### F-security-2: Guard anti-produção dos integration tests é regex-permissiva (`/-hml\./`)

- **Severidade**: P3
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/routes/recebimentos.e2e.hml.integration.test.ts:255`, `recebimentos.e2e.hmlTituloCondicao.integration.test.ts:123`, `recebimentos.e2e.hmlTituloOrdem.integration.test.ts:122`, `recebimentos.e2e.hmlTituloZero.integration.test.ts:116`, `recebimentos.e2e.hmlTitulos.integration.test.ts:146`, `recebimentos.e2e.hmlTitulosExp.integration.test.ts:135`, `recebimentos.e2e.hmlWrite.integration.test.ts:211`
- **Evidência (objetiva)**:
  ```
  const url = dotenv.CONEXOS_BASE_URL ?? '';
  if (!/-hml\./.test(url)) {
      throw new Error(`ABORTADO: CONEXOS_BASE_URL não é homologação (${url}).`);
  }
  ```
  A regex é `substring`, não âncora de hostname. `https://columbiatrading.conexos.cloud/api?dummy=-hml.` passa o guard e aponta para produção. `https://malicious-hml.example.com/api` também passa. Sob operação real (Yuri edita o `.env`) o risco concreto é baixo, mas o guard não é defensa-em-profundidade contra typo ou proxy MITM.
- **Impacto técnico**: uma edição descuidada do `.env` (ou uma variável de ambiente vencedora em outro processo/CI) que produz uma string contendo `-hml.` em qualquer posição executa escrita irreversível em produção.
- **Impacto de negócio**: qualquer bug do fluxo (fail-closed do PUT, escolha de condição errada, cauda fiscal) rodando em produção contamina docs reais dos clientes finais da Columbia Trading.
- **Métrica de baseline**: 7/7 tests com guard, 0/7 com verificação estrita de hostname (`URL(url).hostname.endsWith('-hml.conexos.cloud')` ou allowlist explícita).

### F-security-3: `throw new Error(...)` do novo passo embarca nome do cliente, valor e nome da condição em texto que vai parar em `logService.error`

- **Severidade**: P2
- **Tactic violada**: Limit Exposure (data-in-logs)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:476-482` e `:510-518`; sink em `:1320-1332` (`registrarFalha` → `logService.error`)
- **Evidência (objetiva)**:
  ```
  throw new Error(
      `A condição de pagamento "${cond.pgtDesNome}" (pgtCod ${cond.pgtCod}) foi gravada na SN ` +
          `${snDocCod}, mas o ERP DESTRUIU os títulos do documento: mnyTitValor=${titulo} ` +
          `contra docMnyValor=${valorDoc}. Sem título a finalização é recusada e o fin014 não ` +
          'acha o que baixar. Gere as parcelas na tela Financeiro (com032) do documento e ' +
          'reprocesse a alocação.',
  );
  // ...
  throw new Error(
      `Condição de pagamento do cliente "${processo.dpeNomPessoa}" (pesCod ${processo.pesCod}) não ` +
          `encontrada no cadastro (...)`,
  );
  ```
  Ambas as strings viram `mensagem` em `registrarFalha` (`ts:1320`) e alimentam `logService.error({ ..., data: { txnId, priCod, valor, etapa, mensagem } })` (`ts:1326-1332`). O tenant do log pode ser LGPD-sensível (nome de razão social do cliente + valor exato do título).
- **Impacto técnico**: qualquer coletor de log (LogService, Render logs, agregador que venha) armazena razão social + valor + condição financeira do cliente em texto plano, sem política de redaction.
- **Impacto de negócio**: LGPD/segredo comercial — vazamento de log de produção expõe pares (cliente, quanto pagou, condição de pagamento) que um insider (ou breach do agregador) usa em concorrência ou fraude.
- **Métrica de baseline**: 2 `throw` novos no delta com dado sensível; 0 política de redaction em `LogService` (não verificado neste run, mas o `data` é serializado tal-qual em outros callers).

### F-security-4: Artefatos de diagnóstico dos integration tests dumpam estado do documento (`pdcDocFederal`, `dpeNomPessoa`, `pgtCod`, valores) em `C:/tmp/*.json` sem lifecycle

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/routes/recebimentos.e2e.hmlTituloCondicao.integration.test.ts:48,202`; `.../hmlTituloOrdem.integration.test.ts:48,201`; `.../hmlTituloZero.integration.test.ts:42,195`; `.../hmlTitulos.integration.test.ts:38,184`; `.../hmlTitulosExp.integration.test.ts:47,171`
- **Evidência (objetiva)**:
  ```
  const RELATORIO = 'C:/tmp/exp-titulo-condicao-hml.json';
  ...
  writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
  ```
  Conteúdo inclui `pgtCod`, `pgtDesNome` (contém razão social do cliente HML), `mnyTitValor`, `docMnyValor`, `docCod`, `qtdItens` etc. Nenhum caminho de limpeza (`afterAll` não deleta). Adicionalmente, o harness `recebimentos.e2e.hmlWrite.integration.test.ts:321-323` faz `console.log('[FASE-B] resposta da rota:', JSON.stringify(body, null, 2))` que inclui a resposta INTEIRA (com `pdcDocFederal` — CNPJ real do cliente HML).
- **Impacto técnico**: máquinas de dev com esses arquivos residuais têm dado real de cliente HML persistido; se essas máquinas forem sincronizadas para OneDrive/Google Drive/etc., o dump viaja.
- **Impacto de negócio**: baixo (HML), mas o mesmo padrão sem controle escalaria mal para produção.
- **Métrica de baseline**: 6 arquivos `C:/tmp/*.json` sem `afterAll` de cleanup; `console.log` do request body inclui CNPJ.

### F-security-5: Nenhum segredo, `.env` ou state-file no delta

- **Severidade**: P3 (não-finding — evidência positiva)
- **Tactic violada**: — (esta linha existe para o consolidator confirmar que a checklist foi rodada)
- **Localização**: `git diff --name-status fix/sn-cond-pgto-finalizacao..HEAD` — 11 arquivos, nenhum é `.env`, `.tfstate`, `.pem`, `.key`.
- **Evidência (objetiva)**:
  ```
  # git log -p fix/sn-cond-pgto-finalizacao..HEAD | grep -iE '(password|secret|token|credential)'
  # (única ocorrência: string fake 'e2e-secret' já pré-existente em recebimentos.e2e.falhas.test.ts)
  # git check-ignore -v src/backend/.env → src/backend/.gitignore:3:.env
  ```
- **Impacto técnico**: nenhum.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 0 segredos commitados no delta; `.env` gitignored corretamente.

## 5. Cards Kanban

### [security-1] Registrar entrada dedicada de auditoria quando `applyPaymentConditionIfRequired` grava o novo `pgtCod` no documento real

- **Problema**
  > Um insider com acesso legítimo (analista logado) OU o próprio serviço rodando sob a credencial Conexos podem trocar a condição de pagamento de um documento financeiro real (PUT `com299`) sem que sobre uma entrada `who/when/what` na nossa base — a trilha atual só grava o executor da execução INTEIRA (`sn_execucao.executado_por`) e o `request_payload` da geração; o par (`pgtCod_anterior`, `pgtCod_novo`, `ator`, `snDocCod`, `timestamp`) da mutação específica só existe no log do ERP. Auditoria financeira externa pergunta e a resposta é "consultar o Conexos". Isso contradiz o compromisso da proposta (trilha persistida em toda ação que move dinheiro / desbloqueia documento financeiro).
- **Melhoria Proposta**
  > Emitir `logService.info({ type: LOG_TYPE.BUSINESS_INFO, message: 'SN payment condition applied', data: { txnId, snDocCod, ator, pgtCodAnterior: doc.pgtCod, pgtCodNovo: cond.pgtCod, pgtDesNomeNovo: cond.pgtDesNome, motivoCom194: <fdvEspErr casado> } })` imediatamente antes de `this.gerDocClient.atualizarDocumento` e outro `info` pós-verificação com o resultado (`titulo`, `valorDoc`, `verificado:true`). Opcional (P2 extra): coluna dedicada no `sn_execucao_ledger` (`condicao_pagamento_aplicada boolean`, `condicao_pagamento_pgt_cod int`) — bump da entidade `SolicitacaoNumerarioExecucao` no `ontology/entities/`. Tactic Bass alvo: **Audit Trail**.
- **Resultado Esperado**
  > Toda mutação de `pgtCod` num doc financeiro real fica auditável a partir de artefato próprio da automação, sem depender de log do ERP. Métrica: mutações do delta com log dedicado = 0 → 1; consulta "quem trocou `pgtCod` do doc X, quando, para qual valor e por que" resolvível sem sair do nosso ambiente.
- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - `# escritas financeiras do delta com log/coluna de auditoria dedicada`: 0 → 1
  - `# gates automatizados que reprovam nova escrita sem audit log dedicado`: 0 → 1 (regra do PatternGuardian para `atualizarDocumento`/`gerDocProcesso`)
- **Risco de não fazer**: em uma auditoria financeira externa (SPED/fisco/cliente institucional) o time só consegue provar autoria da mutação via cruzamento manual com log do ERP; se o Conexos rotacionar/limpar log, a trilha se perde. Cross-QA: overlap explícito com Fault Tolerance (todo audit trail é insumo para post-mortem).
- **Dependências**: nenhuma — puramente aditivo.

### [security-2] Endurecer o guard `/-hml\./` dos integration tests para checagem estrita de hostname

- **Problema**
  > A totalidade dos 7 `*.integration.test.ts` da Frente IV aborta a suíte se a URL não bater com `/-hml\./`. É guard-rail contra "rodar o teste de escrita real apontando para produção", mas é substring: `https://columbiatrading.conexos.cloud/api?dummy=-hml.` passa; `https://qualquer-hml.example.com/api` também. Sob operação disciplinada (Yuri edita o `.env` à mão) o risco é baixo — mas o custo de errar é escrita irreversível em documento financeiro real de cliente.
- **Melhoria Proposta**
  > Extrair a checagem para um helper `assertHmlUrl(url)` em `src/backend/routes/_testHelpers/` que valide `new URL(url).hostname === 'columbiatrading-hml.conexos.cloud'` (ou allowlist explícita via constante). Substituir os 7 sites que hoje têm o regex inline. Tactic Bass alvo: **Limit Access**.
- **Resultado Esperado**
  > Uma URL de produção com "-hml." em query string, path, ou hostname parecido (`fake-hml.evil.com`) é rejeitada. Métrica: 7/7 tests com verificação estrita de hostname; 0 casos onde a regex passa em URL fora do allowlist.
- **Tactic alvo**: Limit Access
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - `# tests com verificação estrita`: 0 → 7
  - `# hostnames permitidos codificados`: implícito (regex) → 1..N (constante allowlist)
- **Risco de não fazer**: um `.env` mal-editado que produza string contendo `-hml.` em posição estranha executa PUT `com299` real em prod. Não é hipótese comum, mas é a defesa-em-profundidade que separa "erro de digitação" de "documento fiscal contaminado".
- **Dependências**: nenhuma.

### [security-3] Redigir dado sensível de cliente das strings de erro que caem no `LogService.error`

- **Problema**
  > Os dois `throw new Error(...)` novos do delta (`RecebimentoNumerarioService.ts:476-482` e `:510-518`) concatenam nome do cliente (`dpeNomPessoa`), `pesCod`, nome da condição de pagamento (que também contém razão social — "SKYJACK - DUPLICATA") e valores monetários (`mnyTitValor`, `docMnyValor`) no `message` da exceção. Essa string vira `mensagem` em `registrarFalha` (`ts:1320`) e é logada por `logService.error`. Sem política de redaction no `LogService`, o coletor (Render, agregador) persiste (cliente, valor, condição financeira) em texto plano — vazamento de log expõe LGPD + segredo comercial.
- **Melhoria Proposta**
  > (a) Separar mensagem operacional (o que fazer, sem PII) do payload estruturado (com PII, marcado): `throw new NumerarioGapError({ etapa: 'sn', code: 'PGT_COND_DESTROYED_TITULO', message: 'ERP destroyed títulos after pgtCod PUT — regenerar via com032', context: { snDocCod, pgtDesNome: cond.pgtDesNome, mnyTitValor, docMnyValor } })` e (b) fazer `registrarFalha` redigir o `context` sensível antes de passar para `logService.error` (whitelist de campos-safe: `snDocCod`, `pesCod`, `pgtCod` numéricos OK; `pgtDesNome`, `dpeNomPessoa` maskados quando o log for para agregador externo). Alternativamente, marcar campos com sufixo `_pii` e ter o `LogService` sanitizar antes de emitir. Tactic Bass alvo: **Limit Exposure**.
- **Resultado Esperado**
  > Mensagens operacionais continuam legíveis para o analista (via body da resposta HTTP), mas o log agregado não persiste nome de cliente + valor. Métrica: 0 razões sociais + valores em strings de exceção que atingem o `LogService`.
- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — exige tocar o `LogService` (política de redaction) + refatorar callers.
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - `# throw com PII embutida no delta`: 2 → 0
  - `# logs em ERROR que serializam nome de cliente em texto plano`: (não medido) → 0 sob política
- **Risco de não fazer**: um vazamento do agregador de logs entrega dossiê "clientes × valores × condições" pronto. Custo LGPD + reputacional.
- **Dependências**: coordena com `qa-fault-tolerance` (mesmo `registrarFalha` é o ponto de captura de exceções; a política de redaction impacta observabilidade).

### [security-4] Adicionar cleanup e sanitização dos artefatos JSON produzidos pelos integration tests HML

- **Problema**
  > Os experimentos do worktree (`recebimentos.e2e.hmlTitulo*.integration.test.ts` + `probe-titulos-hml`) escrevem 6 arquivos em `C:/tmp/*.json` contendo estado real do documento HML: `pgtCod`, `pgtDesNome` (razão social), `mnyTitValor`, `docMnyValor`, `docCod`, `qtdItens`. Nenhum tem `afterAll` de cleanup. Adicionalmente, `hmlWrite.integration.test.ts:321-323` imprime a resposta INTEIRA da rota (que inclui `pdcDocFederal`, o CNPJ real do cliente HML) via `console.log`. Máquinas de dev sincronizadas com OneDrive/Google Drive vazam esses dumps.
- **Melhoria Proposta**
  > (a) Mover o diretório de dumps para uma env `E2E_REPORT_DIR` (default `path.join(os.tmpdir(), 'nf-e2e-reports')`) e limpá-lo no `afterAll` (opt-out via `KEEP_E2E_REPORTS=1` para debug); (b) sanitizar o `relatorio` antes do `writeFileSync` — máscara para `pdcDocFederal` (só últimos 4 dígitos), redação por nome (`dpeNomPessoa` como `dpe_<hash8>`), valores mantidos (necessários para diagnóstico); (c) substituir `console.log(body)` por `console.log(summarize(body))`. Tactic Bass alvo: **Limit Exposure**.
- **Resultado Esperado**
  > Artefatos residuais deixam de existir por default; quando existem (debug), não carregam CNPJ nem razão social em texto plano. Métrica: 6 → 0 arquivos persistidos por default; 1 → 0 CNPJs em texto plano em `console.log`.
- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - `# artefatos residuais em C:/tmp após npm test`: 6 → 0 (default)
  - `# CNPJs em texto plano em stdout do teste`: 1 → 0
- **Risco de não fazer**: dado real de cliente HML vaza por canal lateral (backup do drive pessoal). Cross-QA: overlap com Testability (o cleanup faz parte da higiene de teste).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo declarado no prompt (delta focado) foi respeitado — 11 arquivos, 2 commits. Findings 2 e 4 incluem os 7 `.integration.test.ts` porque o prompt pede explicitamente para avaliar o guard e o vazamento de segredo desses tests, mesmo não estando no diff do delta.
- `--quick` bloqueou `npm audit`; o único delta em `package-lock.json` (na status inicial) não parece funcional (não olhei em profundidade). Se a próxima rodada for full, dropar `--quick` e revisar F-security-5.
- Cross-QA para o consolidator: **F-security-1 e card `security-1`** overlap com `qa-fault-tolerance` (Audit Trail é insumo de post-mortem; ambas as QAs pedem `who/when/what/before/after`). **F-security-3 e card `security-3`** overlap com `qa-integrability` (política de redaction do `LogService` afeta o contrato de observabilidade) e `qa-fault-tolerance` (mesmo sink `registrarFalha`). **F-security-2** overlap com `qa-testability` (o guard é uma affordance de teste seguro). **F-security-4** overlap com `qa-testability` (lifecycle de artefato de teste).
- Nada medido sobre auth/RBAC porque o delta NÃO toca essa camada — a rota upstream `POST /recebimentos/transacoes/{txnId}/solicitacao-numerario` é pre-existente. Revisão de autz da rota fica para outro run/QA quando ela mudar.
