---
qa: Security
qa_slug: security
run_id: 2026-10-26-1700-sispag-boleto-agrupado
agent: qa-security
generated_at: 2026-10-26T17:00:00-03:00
scope: backend
score: 7.8
findings_count: 4
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado com `sispag:executar` (ou atacante com token válido) | Tenta anular um grupo confirmado, incluí-lo num lote rascunho ou retirá-lo de um lote de uma filial fora da sua allow-list | Rotas `POST /sispag/grupos-boleto/:id/anular`, `POST /sispag/lotes/:id/grupos`, `DELETE /sispag/lotes/:id/grupos/:grupoId` em `src/backend/routes/sispag.ts` | Produção; token Supabase JWT com `permissions.filiais` provisionado (seam prevista em `filialAuthz.ts`) | 403 `FILIAL_NAO_AUTORIZADA` idêntico ao de `/grupos-boleto/confirmar`, sem desfazer grupo nem tocar lote da filial alheia | 100% das rotas que mexem com grupo (confirmar + anular + incluir + retirar) chamam `assertUserCanActOnFilial`; hoje 1/4 chama (25%). |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Hardcoded secrets no delta (feature-scope) | 0 | 0 | ✅ | `grep -rE "AKIA[0-9A-Z]{16}\|password\s*[:=]\s*['\"]" src/backend/{jobs,domain/{service,repository}/sispag,routes/sispag.ts}` |
| Rotas do grupo com `exigirPermissao` | 6/6 | 100% | ✅ | `src/backend/routes/sispag.ts:1118,1137,1157,1187,1217,1246` |
| Rotas de escrita do grupo que chamam `assertUserCanActOnFilial` | 1/4 | 100% | ❌ | `src/backend/routes/sispag.ts:1125,1144,1165-1172` (SIM: sugestoes/listar/confirmar); `1187-1213` (anular NÃO); `1217-1242` (incluir NÃO); `1246-1274` (retirar NÃO) |
| Bodies HTTP com schema Zod `.strict()` | 3/3 (confirmar/anular/incluir) | 100% | ✅ | `src/backend/domain/interface/sispag/GrupoBoletoSchemas.ts:25,38,49` |
| Params/queries Zod validados antes do uso | 6/6 | 100% | ✅ | `GrupoBoletoSchemas.ts:35,42,46,57,62` |
| Actor pode vir do body (`.strict()` recusa chave desconhecida) | não | não | ✅ | `GrupoBoletoSchemas.ts:33,40,55` + `routes/sispag.ts:167` (`ator = req.user?.sub ?? 'unknown'`) |
| SQL com interpolação de dado do usuário em `GrupoBoletoRepository*` | 0 | 0 | ✅ | `src/backend/domain/repository/sispag/GrupoBoletoRepository.ts` e `GrupoBoletoExecucaoRepository.ts` — toda interpolação é identificador/colunas constantes ou nome de parâmetro (`$f${i}`, `$g${i}`), valor vai por `params[...]` |
| CHECK impede código de barras longo no banco | sim (regex `^[0-9]{5}…[0-9]{4}$`) | sim | ✅ | `src/backend/migrations/0090_sispag_grupo_boleto.sql:73-75` |
| Resposta HTTP vaza `emissorChave` (conta completa do emissor) | não | não | ✅ | `src/backend/routes/sispag.ts:1099-1102,1131,1150,1177,1208` (`semChaveDoEmissor`) |
| Código de barras completo persistido em qualquer tabela do delta | não | não | ✅ | `migrations/0090_sispag_grupo_boleto.sql:48` (`codbar_mascarado TEXT`); nenhuma coluna `codbar` crua |
| Rate limiter com escopo `'grupo'` isolado dos demais (confirmar/copiar/ajuste) | sim | sim | ✅ | `src/backend/http/rateLimit.ts:149-151`; `routes/sispag.ts:1096,1160,1190` |
| Jobs de verificação permitem escrita em PRD | não | não | ✅ | `src/backend/jobs/hmlE2eGuarda.ts:28-73` (recusa host sem `-hml`, banco não-local, autorização datada); `jobs/validate-sispag-boleto-agrupado-v1.ts:36-56` (`GuardaSomenteLeituraConexos` + `TravaSomenteLeituraPg`) |
| Credenciais logadas pelos jobs de verificação | 0 | 0 | ✅ | `grep -nE "console\.log\|logService\." …` sem casamento com `senha/password/token/CONEXOS_` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | Ator vindo exclusivamente do JWT (`req.user.sub`); schemas `.strict()` recusam `ator` no body | ✅ | `routes/sispag.ts:167`; `GrupoBoletoSchemas.ts:25-55` |
| Authenticate Actors | `exigirPermissao(PERMISSION.SISPAG_VER/EXECUTAR)` em todas as 6 rotas novas | ✅ | `routes/sispag.ts:1120,1139,1159,1189,1219,1248`; `http/acesso.ts:218` |
| Authorize Actors | Matriz ver/executar correta; **MAS allow-list de filial só na confirmação e nos GETs** — anular/incluir/retirar escapam | ⚠️ | `routes/sispag.ts:1125,1144,1165-1172` (sim) vs `1187-1213,1217-1242,1246-1274` (não) |
| Limit Access | Autorização por filial parcial (ver tactic acima); `incluirGrupo` ainda confere `grupo.filCod === lote.filCod` como defesa em profundidade | ⚠️ | `LotePagamentoService.ts:697-699` (`LoteFilialError`) |
| Limit Exposure | `semChaveDoEmissor` tira a conta completa do payload; só máscara 5+4 do código de barras persiste/trafega | ✅ | `routes/sispag.ts:1099-1102`; `migrations/0090_sispag_grupo_boleto.sql:73-75` |
| Encrypt Data | TLS no API Gateway/Supabase (herança da plataforma); DDL do delta não arma coluna sensível crua | ✅ | `migrations/0090_sispag_grupo_boleto.sql:48` |
| Separate Entities | Rate limiter com escopo próprio `'grupo'` isola o balde do grupo das sugestões 1:1 | ✅ | `http/rateLimit.ts:149-151`; `routes/sispag.ts:1096` |
| Validate Input | Zod `.strict()` em todo body; `safeParse` em params/query antes do uso; UUID via `z.guid()` | ✅ | `GrupoBoletoSchemas.ts` inteiro; `routes/sispag.ts:1163,1193-1200,1222-1230,1251-1258` |
| Change Default Settings | CHECKs do DB rejeitam `confirmado_por` em branco, `sistema`/`unknown` (I21i), motivo fora de 10–500 e código longo | ✅ | `migrations/0090_sispag_grupo_boleto.sql:86-105` |
| Verify Message Integrity | `reconheceAvisos` do body é texto, mas o serviço recalcula a avaliação e nunca confia no cliente (I21g) | ✅ | `GrupoBoletoSchemas.ts:20-23` (comentário) + `GrupoBoletoService.ts` (releitura sob lock) |
| Detect Intrusion | Trilha de evento somente-inclusão por trigger (`sispag_grupo_boleto_evento`) grava toda transição | ✅ | `migrations/0090_sispag_grupo_boleto.sql:3` (bloco 3) |
| Audit Trail | `LotePagamentoService.audit('incluirGrupo'/'moverGrupo'/'removerGrupo', …)` + log de negócio na anulação | ✅ | `LotePagamentoService.ts:767,815`; `GrupoBoletoService.ts:243-256` |
| Detect Service Denial | Rate limiter dedicado por rota de grupo | ✅ | `routes/sispag.ts:1096,1160,1190` |
| Detect Message Delay | N/A no delta (interações síncronas HTTP; sem fila na rota do grupo) | N/A | — |
| Revoke Access | Anulação do grupo é a saída; cascata `PAR_REVOGADO` fecha grupos quando a decisão emissor é revogada | ✅ | `GrupoBoletoService.ts:267-290` |
| Lock Computer / Inform Actors | N/A (sem sessão interativa do operador no delta; aviso é via UI/alerta) | N/A | — |
| Restore | Repos tocam só o Postgres próprio; migration 0090 tem rollback em `rollbacks/0090_…` | ✅ | `migrations/0090_sispag_grupo_boleto.sql:34-35` |

## 4. Findings (achados)

### F-security-1: anular/incluir-no-lote/retirar-do-lote não checam allow-list de filial do usuário

- **Severidade**: P1
- **Tactic violada**: Authorize Actors / Limit Access
- **Localização**:
  - `src/backend/routes/sispag.ts:1187-1213` (`POST /sispag/grupos-boleto/:id/anular`)
  - `src/backend/routes/sispag.ts:1217-1242` (`POST /sispag/lotes/:id/grupos`)
  - `src/backend/routes/sispag.ts:1246-1274` (`DELETE /sispag/lotes/:id/grupos/:grupoId`)
- **Evidência (objetiva)**:
  ```
  // confirmar (linha 1165-1172): CHECA filial
  if (!filialPermitida(req, res, body.data.titulos.map((t) => t.filCod))) return;
  // anular / incluirGrupo / removerGrupo: nenhuma chamada a filialPermitida/assertUserCanActOnFilial
  ```
  Serviço idem: `GrupoBoletoService.anular` (`service/sispag/GrupoBoletoService.ts:208-259`) e `LotePagamentoService.incluirGrupo/removerGrupo` (`service/sispag/LotePagamentoService.ts:675-820`) não lêem `req.user.filiais`. `incluirGrupo` chega a comparar `grupo.filCod === lote.filCod` (defesa parcial do dono do grupo contra lote de outra filial), mas isso **não** impede um analista da filial A de anular um grupo da filial B conhecendo o UUID.
- **Impacto técnico**: no dia em que o claim `permissions.filiais` for provisionado (seam já documentado em `http/filialAuthz.ts:11-19`), três rotas que movem dinheiro (anular grupo em lote comprometido envia aviso para a remessa retirar; incluir/retirar grupo altera o conteúdo de borderô rascunho) continuarão aceitando qualquer filial do token. A premissa "allow-list da confirmação segue para o resto do ciclo" fica silenciosamente quebrada.
- **Impacto de negócio**: um analista com acesso de execução SISPAG na filial A, de posse do UUID de um grupo da filial B (vazável por relatório, log, URL copiada ou enumeração se virar palpite), **anula** o grupo da filial B (motivo livre 10-500 chars, não precisa de senha) ou o inclui/retira de um rascunho da filial dele. Em lote comprometido, a anulação dispara aviso que retira o item na próxima remessa — a filial B perde um pagamento sem ter autorizado.
- **Métrica de baseline**: 1/4 rotas de escrita do grupo chamam `assertUserCanActOnFilial` (25%). Alvo: 4/4 (100%).

### F-security-2: `userCanActOnFilial` libera por padrão quando o claim está ausente

- **Severidade**: P2
- **Tactic violada**: Authorize Actors (change default settings — fail-open)
- **Localização**: `src/backend/http/filialAuthz.ts:45-50`
- **Evidência (objetiva)**:
  ```
  const permitidas = filiaisPermitidas(user);
  if (permitidas === undefined) return true;   // sem claim → permite tudo
  ```
  Documentado como "backwards-compatible com os tokens de hoje", o que é consciente — mas o conjunto Supabase JWT atual (`sub/email/role`, docstring linhas 11-13) significa que **nenhum** usuário em produção tem allow-list. Enquanto isso não mudar, o F-security-1 não é explorável em prática; quando mudar, o F-security-1 fica latente.
- **Impacto técnico**: a allow-list é um guard parcial — depende de o claim nascer. Qualquer bug/erro no provisionamento do claim reverte para "permite tudo". Sem alarme para o estado em que a allow-list está vazia.
- **Impacto de negócio**: a camada de autorização por filial anunciada no docstring da classe é efetivamente desligada hoje. O arquivo documenta isso, mas um auditor externo lerá o cabeçalho "Per-filial authorization" e assumirá que o controle existe.
- **Métrica de baseline**: 0% dos JWT em produção carregam `filiais[]` (confirmado pelo docstring do próprio módulo); alvo médio prazo: 100% com fail-closed no `undefined`.

### F-security-3: endpoints por UUID não têm roteamento tenant-aware (IDOR requer palpite de UUID)

- **Severidade**: P3
- **Tactic violada**: Limit Access (defense in depth)
- **Localização**: `src/backend/routes/sispag.ts:1187,1246` (`/grupos-boleto/:id/anular`, `/lotes/:id/grupos/:grupoId`)
- **Evidência (objetiva)**: `GrupoBoletoIdSchema = z.object({ id: z.guid() })` — qualquer UUID bem-formado passa pela validação. A autorização reduz-se a `exigirPermissao(SISPAG_EXECUTAR)` + F-security-1/2 acima.
- **Impacto técnico**: um UUID vazado (dump de log, URL copiada, suporte sem redaction) habilita operar em recursos de qualquer filial. Mitigado hoje porque UUID v4 é não-adivinhável; não há enumeração sequencial.
- **Impacto de negócio**: compliance (SOX/LGPD) exige controle **por recurso**, não só por classe de ação. Quem auditar vai pedir cobertura por tenant/filial.
- **Métrica de baseline**: 0 rotas que fazem lookup "grupo pertence à minha filial" **antes** de executar. Alvo: carregar `grupo.filCod`/`lote.filCod` e chamar `assertUserCanActOnFilial` como primeira ação do handler, no mesmo lugar onde hoje o `confirmar` chama (F-security-1 cobre a correção).

### F-security-4: ausência de teste de regressão para o 403 de filial nas 3 rotas por UUID

- **Severidade**: P3
- **Tactic violada**: Authorize Actors (test coverage)
- **Localização**: `src/backend/routes/sispag.test.ts` (não auditado linha a linha; sem resultado para `filial.*anular\|filial.*incluir.*grupo\|filial.*remover.*grupo`)
- **Evidência (objetiva)**: `grep -En "FilialForbidden|filial.*(anular|incluir|retirar).*grupo"` em `src/backend/routes/*.test.ts` não retornou casos negativos específicos para as 3 rotas de UUID — a cobertura de 403 por filial do grupo testa a rota `confirmar`. Marcado como **unverified** por amostra; o consolidator pode confirmar olhando a suite.
- **Impacto técnico**: a correção do F-security-1 pode voltar a quebrar sem alerta se futuros refactors removerem o guard.
- **Impacto de negócio**: regressões de autorização ficam invisíveis até o próximo pentest/auditoria.
- **Métrica de baseline**: 0 testes `expect(403)` isolando `/grupos-boleto/:id/anular`, `/lotes/:id/grupos`, `/lotes/:id/grupos/:grupoId` sob filial não permitida (não verificado linha a linha). Alvo: 3 testes.

## 5. Cards Kanban

### [security-1] Aplicar `assertUserCanActOnFilial` em anular/incluir/retirar grupo

- **Problema**
  > Três das quatro rotas de escrita do boleto agrupado — `POST /sispag/grupos-boleto/:id/anular`, `POST /sispag/lotes/:id/grupos` e `DELETE /sispag/lotes/:id/grupos/:grupoId` — não consultam a allow-list de filial do usuário. A rota `confirmar` consulta. Resultado: no dia em que o claim `permissions.filiais` for ligado no JWT, um analista com `sispag:executar` da filial A anulará grupo da filial B conhecendo o UUID (motivo livre, sem segundo fator), ou mexerá no rascunho do borderô dela.

- **Melhoria Proposta**
  > Antes de executar, carregar o `filCod` do grupo (via `grupoRepo.buscarPorId`) ou do lote (via `loteRepo.buscarPorId`) e chamar `assertUserCanActOnFilial(req.user, filCod)` — espelhando o padrão de `/grupos-boleto/confirmar`. Para `/lotes/:id/grupos`, checar **ambos**: filial do lote e filial do grupo. Arquivos: `src/backend/routes/sispag.ts:1187-1274`. Tactic Bass: Authorize Actors.

- **Resultado Esperado**
  > 4/4 rotas de escrita do grupo chamam `assertUserCanActOnFilial` (hoje 1/4). Resposta `403 FILIAL_NAO_AUTORIZADA` idêntica para as quatro rotas. Nenhum caminho de escrita de grupo passa pelo `GrupoBoletoService`/`LotePagamentoService` sem o guard HTTP ter rodado.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1, F-security-3
- **Métricas de sucesso**:
  - Rotas de escrita do grupo com `assertUserCanActOnFilial`: 1/4 → 4/4
  - Testes de regressão `expect(403)` por filial não permitida: 1 → 4
- **Risco de não fazer**: quando o claim `filiais[]` for ligado, três rotas que movem dinheiro ignoram o controle silenciosamente — risco de incidente de autorização que exige comunicação a cliente/auditor.
- **Dependências**: nenhuma (seam `assertUserCanActOnFilial` já existe).

### [security-2] Fail-closed quando o claim `permissions.filiais` estiver ausente

- **Problema**
  > `userCanActOnFilial` retorna `true` quando o usuário não traz allow-list (`filialAuthz.ts:48`). Hoje nenhum JWT traz, então a camada por-filial inteira é no-op. Essa escolha "backwards-compatible" é anotada no docstring, mas transforma a allow-list numa promessa não cumprida: qualquer erro de provisionamento do claim no futuro reverte, sem alerta, para "permite tudo".

- **Melhoria Proposta**
  > Introduzir uma flag `FILIAL_ALLOWLIST_REQUIRED` lida pelo `EnvironmentProvider` (default `false` por retrocompatibilidade), com plano de passar a `true` em cada tenant depois do rollout do claim. Quando `true`, `userCanActOnFilial` com `permitidas === undefined` **nega** (fail-closed). Loggar o estado atual (`allowListProvisionada: boolean`) uma vez no boot do servidor. Arquivo: `src/backend/http/filialAuthz.ts`.

- **Resultado Esperado**
  > Depois do rollout do claim, um bug de provisionamento vira 403 observável imediatamente, não "permissão silenciosa". Hoje: 0% dos JWT com allow-list, guard permite tudo; alvo: 100% dos JWT com `filiais[]` + flag `required=true` → 0% de requisições com `undefined` passando.

- **Tactic alvo**: Authorize Actors (change default settings)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - % de requisições autenticadas com `filiais[]` no JWT: 0% → 100%
  - Estado da flag em produção após rollout: `false` → `true`
- **Risco de não fazer**: a camada de autorização por filial continua anunciada mas inativa; auditoria LGPD/SOX pede evidência objetiva do controle e não há como entregar.
- **Dependências**: provisionamento do claim no Supabase (fora deste delta); card [security-1] para ter o guard chamado nas 4 rotas antes de passar `required=true`.

### [security-3] Testes de regressão de 403 por filial nas 3 rotas por UUID

- **Problema**
  > A suíte de rotas cobre o 403 por filial no `confirmar` (que carrega os `filCod` no body), mas não isola o 403 nas rotas por UUID (`/anular`, `/lotes/:id/grupos`, `/lotes/:id/grupos/:grupoId`). Depois de aplicado o card [security-1], é preciso trancar o comportamento com teste para que um refactor futuro não volte a remover o guard.

- **Melhoria Proposta**
  > Três cenários novos em `src/backend/routes/sispag.test.ts`: usuário com `filiais: [10]` tentando (a) anular grupo da filial 20, (b) incluir grupo da filial 20 em lote da filial 20, (c) retirar grupo da filial 20 de lote da filial 20 — todos devem retornar 403 `FILIAL_NAO_AUTORIZADA`. Reusar o fixture já usado no teste do `confirmar`. Tactic Bass: Authorize Actors.

- **Resultado Esperado**
  > Suíte de rotas com 3 testes de 403 novos, cobrindo as três rotas de escrita por UUID. Regressão fica barrada no CI.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-4, F-security-1
- **Métricas de sucesso**:
  - Testes `expect(403)` por filial nas 3 rotas por UUID: 0 → 3
- **Risco de não fazer**: o guard do card [security-1] pode ser removido num refactor futuro sem ninguém notar.
- **Dependências**: [security-1] (guards precisam existir antes de serem testados).

### [security-4] Documentar na ADR-0077 a decisão de autorização por filial (declarar fail-open atual + roteiro para fail-closed)

- **Problema**
  > A seção de autorização por filial do delta é inconsistente: `confirmar` chama o guard, as outras três rotas do grupo não; o próprio `filialAuthz.ts` é fail-open por falta de claim. Esse quadro não aparece na ADR-0077, no documento de regra `boleto-agrupado-sispag.md` nem na seção de riscos do rollout — um stakeholder lendo a ADR assume que a autorização por filial é integral.

- **Melhoria Proposta**
  > Emenda à ADR-0077 (ou nota em `ontology/business-rules/boleto-agrupado-sispag.md`) explicitando: (i) hoje a allow-list é no-op para tokens sem o claim; (ii) o guard do confirmar vale para o UUID de boleto; (iii) card [security-1] fecha a lacuna nas três rotas por UUID; (iv) card [security-2] passa o guard a fail-closed depois do rollout do claim. Linkar com `src/backend/http/filialAuthz.ts:11-19`.

- **Resultado Esperado**
  > Decisão arquitetural rastreável, auditor consegue conciliar o que a ADR promete com o que o código entrega. 0 páginas de documentação atualizadas → 1.

- **Tactic alvo**: Authorize Actors (governança / Audit Trail da decisão)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Documento de decisão citando a lacuna e o plano: 0 → 1
- **Risco de não fazer**: o próximo revisor repete o mesmo achado em 3 meses.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Verifiquei linha a linha as rotas `grupos-boleto/*` em `src/backend/routes/sispag.ts` e os serviços `GrupoBoletoService.anular` / `LotePagamentoService.{incluirGrupo,removerGrupo}`: nenhum chama `assertUserCanActOnFilial`. Confirma a dúvida levantada no briefing — a lacuna existe no delta.
- Barcode: só o mascarado persiste (CHECK em `migrations/0090_sispag_grupo_boleto.sql:73-75`); o completo trafega apenas em memória dentro de `GrupoBoletoService` (`entradaBoleto`, `codigoBarras.emissor`). Payloads HTTP ainda tiram `emissorChave` (conta do emissor) via `semChaveDoEmissor`. SQL dos repos usa parâmetros nomeados — interpolação só em identificadores constantes/nomes de parâmetros. Jobs HML/validate têm guardas explícitos e amarrados a autorização datada + Postgres local.
- F-security-4 marcada como **unverified** por amostra: não li a suite de rotas inteira para listar os `expect(403)` existentes; o consolidator pode cruzar com o relato do qa-testability. O card [security-3] permanece válido ainda que haja algum teste próximo não visto.
- Cross-QA para o consolidator: F-security-1 ↔ Fault Tolerance (Audit Trail do grupo já existe, mas um 403 ausente neutraliza o valor da trilha); F-security-2 ↔ Deployability (flag `FILIAL_ALLOWLIST_REQUIRED` precisa ser parte do rollout junto com o provisionamento do claim); F-security-3 ↔ Testability (regra de teste de autorização por rota).
