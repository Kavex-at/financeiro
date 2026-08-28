---
qa: Security
qa_slug: security
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-security
generated_at: 2026-08-28T16:08:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider com acesso ao repo, ao dashboard do Render ou ao shell do dyno do cron | Aciona um caminho não-sancionado (edita `.env` de um dev, sobe env `PROBE_ALLOW_PRD=1` no cron, ou usa uma env de escrita "por precaução" num job supostamente read-only) | `render.yaml` (bloco `envVars` do novo cron `financeiro-ingest-permutas`), sondas `probe-invoice-pago.ts` / `validate-invoice-pago-detalhe-v1.ts` bundleadas em `dist/jobs/`, credenciais `CONEXOS_USERNAME/PASSWORD` e `databaseConnectionString` propagadas para o processo do cron | Produção da Columbia (Render + Supabase + Conexos PRD), sem HML disponível — os probes correm contra `columbiatrading.conexos.cloud` | O sistema (a) mantém segredos fora do VCS (sync:false), (b) NÃO concede capacidade de escrita a processos read-only, (c) NÃO deixa artefatos com PII financeira em disco local do container sem TTL, (d) valida no boundary o payload do ERP antes de derivar `pago` | 0 segredos commitados; 0 processos com privilégio de escrita não usado; 0 achados com dados de cliente em `/tmp` sem expiração; 100% dos campos financeiros externos validados por Zod antes do mapper |

Cenário DELTA-específico: a correção do bug `invoice-pago-detalhe` ampliou a superfície de segredos (novo cron com bloco `envVars` próprio) e introduziu duas sondas READ-ONLY em PRD que persistem rows crus do ERP em disco. O trade-off — derivar `pago` do título em vez da lista — está tecnicamente correto e alinhado com a decisão do Yuri de 2026-06-18, mas o *envelope* de deploy que ele trouxe (envs de escrita no cron, probes no bundle) merece hardening.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded introduzidos no delta | 0 | 0 | ✅ | `git diff 617ca3b..48abd7b` + grep de padrões `password/secret/token/api_key/credential` em `src/backend/**/*.ts` (0 matches fora de `.test.ts`) |
| Chaves sensíveis do novo bloco `envVars` com `sync: false` | 6/6 (`CONEXOS_BASE_URL`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`, `databaseConnectionString`, `CONEXOS_USERNAME`, `CONEXOS_PASSWORD`, `CONEXOS_FIL_COD`) | 100% | ✅ | `awk '/type: cron/,0' render.yaml` — só `environment=production`, `client_name=local` e `CONEXOS_EXTRATO_SYNC_START_DATE=2026-08-03` têm `value:` (não sensíveis) |
| Envs de ESCRITA declaradas num job READ-ONLY | 2 (`CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`) | 0 | ❌ | `render.yaml:104-107` — o próprio comentário do YAML admite "as flags acompanham o web só para não haver dois comportamentos diferentes" |
| Sondas em `src/backend/jobs/` que persistem rows do ERP em disco | 2 (`probe-invoice-pago.ts:242-243`, `validate-invoice-pago-detalhe-v1.ts` só loga) | 0 sem TTL/limpeza documentada | ⚠️ | `writeFileSync(${OUT_DIR}/achados.json, JSON.stringify(achados, null, 2))` — default `OUT_DIR=/tmp/probe-invoice-pago` |
| Sondas com `console.log` de rows brutas do ERP (nome de cliente/exportador, valores) | 1 (`probe-invoice-pago.ts:86-88`, truncado em 4000 chars) | 0 rows brutas em log | ⚠️ | `registrar()` faz `console.log(JSON.stringify(resultado, null, 2).slice(0, 4000))` com `rowDaLista: alvo` inteiro |
| Sondas bundleadas em `dist/jobs/` do imagem de produção | Sim — `tsconfig.json:include=**/*.ts` (sem exclusão de `jobs/probe-*`) | Excluir do build de PRD OU allowlist explícita | ⚠️ | `src/backend/tsconfig.json:24` |
| Gate `PROBE_ALLOW_PRD=1` é boolean simples (sem allowlist, sem multi-fator, sem log) | Sim | Reforçar (allowlist + registro) | ⚠️ | `probe-invoice-pago.ts:60`, `validate-invoice-pago-detalhe-v1.ts:29` |
| Schema Zod `com308RowSchema` chamado no mapper de `listTitulosAPagar` | Não — 0 chamadas em prod (só usado em `com298RowSchema.parse` no `ConexosFinanceiroClient.ts:286,343`); `com308RowSchema` é **decorativo** | 100% dos rows do ERP validados no boundary | ❌ | `grep -rn "com308RowSchema" src/backend --include=*.ts` — só teste `conexosPermutasSchemas.test.ts` |
| SQL novo introduzido no delta | 0 statements | 0 concatenados | ✅ | `git diff 617ca3b..48abd7b -- src/backend/**/*.ts \| grep -iE "select\|insert\|update\|delete\|query\|sql"` → 0 matches |
| `.env` / state files no VCS após o delta | 0 (só `.env.example` versionado, como já era antes) | 0 | ✅ | `git ls-files \| grep -E "\.env$\|\.env\.\|\.tfstate"` → só `.env.example` |
| Infra IAM / SSM / CloudTrail / GuardDuty | ⚠️ **Não medível** — este repo não tem `infra/`; a operação usa Render + Supabase. Recomendação: registrar controles equivalentes (retenção de logs Render, MFA Supabase, rotação de credenciais Conexos) num runbook de segurança fora deste repo. | — | — | — |
| `npm audit` (backend) | ⚠️ **Não medível neste run** — escopo `--quick`. O commit `617ca3b` (base) já bumpou axios para destravar o CI; assumido verde por herança. Recomendação: reexecutar antes do próximo `chore(release)`. | — | — | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | ⚠️ Não medível — CloudTrail/GuardDuty inexistem (sem AWS); Render dashboard tem log de acesso, mas não instrumentado neste repo | ⚠️ parcial | — |
| Detect Service Denial | Ausente para o delta; a proteção existente é `express-rate-limit` (produção) — não atinge cron | ⚠️ parcial | `package.json:38` `express-rate-limit` |
| Verify Message Integrity | HTTPS end-to-end para Conexos (via `ConexosBaseClient`); nenhuma assinatura de payload no delta | ✅ presente (transporte) | — |
| Detect Message Delay | N/A para o delta (não há stream/queue tocada) — justificativa: sondas rodam sob demanda, sem SLA de latência | N/A | — |
| Identify Actors | `triggeredBy` propagado no `EleicaoParams:47-48` para auditoria da run (linha existente antes do delta) | ✅ presente | `EleicaoPermutasService.ts:47,381` |
| Authenticate Actors | Fora do delta (NextAuth / JWT `AUTH_JWT_SECRET`); o cron não tem endpoint HTTP a autenticar | ✅ presente | `render.yaml:52` `AUTH_JWT_SECRET sync:false` |
| Authorize Actors | Fora do delta; probes não têm RBAC — quem tem shell do dyno + `PROBE_ALLOW_PRD=1` dispara | ⚠️ parcial | `probe-invoice-pago.ts:60` |
| **Limit Access** | Cron carrega `CONEXOS_WRITE_ENABLED` e `CONEXOS_DRY_RUN` apesar de o job ser READ-ONLY por design — envelope maior que a necessidade | ❌ ausente (para o delta) | `render.yaml:104-107` + comentário admitindo "só para não haver dois comportamentos diferentes" |
| **Limit Exposure** | Sondas escrevem `/tmp/probe-invoice-pago/achados.json` com rows crus do ERP e `console.log` das mesmas rows (truncado a 4000 chars) | ❌ ausente (para o delta) | `probe-invoice-pago.ts:86-88,242-243` |
| Encrypt Data | Sem criptografia em repouso para `/tmp/probe-invoice-pago/achados.json` (disco efêmero do container, mas com PII do cliente Columbia) | ⚠️ parcial | `probe-invoice-pago.ts:243` |
| Separate Entities | Cron e web compartilham o mesmo `rootDir: src/backend` — mesmo processo Node teria a mesma foto do bundle | ⚠️ parcial | `render.yaml` (cron e web ambos rodam `src/backend`) |
| Change Default Settings | `EnvironmentProvider.resolveConexosWriteEnabled` (linhas 52-72) rejeita `WRITE_ENABLED=true` em `environment=local` apontando para PRD — piso defensivo existente | ✅ presente | `EnvironmentProvider.ts:52-72` |
| **Validate Input** | `com308RowSchema` atualizado com `titMnyTotPago` (`conexosPermutasSchemas.ts:47`) mas **não chamado** no mapper de `listTitulosAPagar` — validação decorativa. `com298RowSchema` sim é aplicado em `ConexosFinanceiroClient.ts:286,343` | ❌ ausente (para o novo campo) | `grep "com308RowSchema" src/backend/**/*.ts` (só teste) |
| Revoke Access | Rotação/revogação de `CONEXOS_PASSWORD` só via dashboard Render — sem playbook no repo | ⚠️ parcial | — |
| Lock Computer | N/A (sem sessões interativas) | N/A | — |
| Inform Actors | Sem alerta ao operador quando uma sonda escreve em `/tmp` (log de INFO/console) | ❌ ausente | — |
| Restore | `/health` do serviço web + `preDeployCommand: npm run migrate` — não afetado pelo delta | ✅ presente | `render.yaml:23` |
| Audit Trail | `LogService.info` com `LOG_TYPE.FLOW_START/COMPLETE/ERROR` (`EleicaoPermutasService.ts:262,389,429`) mantido no delta — auditável | ✅ presente | `EleicaoPermutasService.ts:262-266,389-398,429-434` |

## 4. Findings (achados)

### F-security-1: Cron READ-ONLY recebe envs de ESCRITA no ERP

- **Severidade**: P1
- **Tactic violada**: Limit Access (least privilege)
- **Localização**: `render.yaml:104-107` (bloco `envVars` do serviço `financeiro-ingest-permutas`)
- **Evidência (objetiva)**:
  ```yaml
  # O job não escreve no ERP; as flags acompanham o web só para não haver
  # dois comportamentos diferentes se algum caminho novo passar por aqui.
  - key: CONEXOS_WRITE_ENABLED
    sync: false
  - key: CONEXOS_DRY_RUN
    sync: false
  ```
  `jobs/ingest-permutas.ts` (invocado pelo `startCommand: npm run job:ingest-permutas`) chama `EleicaoPermutasService.computeCandidatas`, que só lê Conexos (`listAdiantamentosProforma`, `listInvoicesFinalizadas`, `getDetalheTitulos`, `listTitulosAPagar`) e escreve apenas no Postgres da própria aplicação. Não há caminho de escrita no ERP acionado pelo cron. Mesmo assim, se um operador configurar `CONEXOS_WRITE_ENABLED=true` no dashboard (o padrão do web é `true` desde a v0.17.4), o cron passará a habilitar a capacidade de escrita silenciosamente — bastando que alguma `/feature-tweak` futura importe um serviço que faz escrita para o job.
- **Impacto técnico**: envelope de privilégio maior que a superfície de uso. Quando o serviço/repositório crescer, um `if (env.conexosWriteEnabled) …` novo dentro de qualquer service alcançado pelo import do cron começará a escrever sem revisão dedicada — o mesmo padrão de defeito que o `resolveConexosWriteEnabled` (`EnvironmentProvider.ts:52-72`) previne para máquinas locais.
- **Impacto de negócio**: risco de emissão indevida de baixa/lote no ERP da Columbia por caminho não sancionado, sem trilha específica de auditoria de "eu, operador, aceitei ligar escrita no cron". A separação atual entre cron (ingest) e web (UI + escrita) fica corrompida no config.
- **Métrica de baseline**: 2 envs de escrita declaradas num processo com 0 caminhos de escrita atuais → **excesso de privilégio de 2/2**.

### F-security-2: Sonda de PRD persiste rows crus do ERP em `/tmp` sem TTL

- **Severidade**: P2
- **Tactic violada**: Limit Exposure (+ Encrypt Data parcial)
- **Localização**: `src/backend/jobs/probe-invoice-pago.ts:68,111,242-243`
- **Evidência (objetiva)**:
  ```ts
  const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-invoice-pago';
  // …
  mkdirSync(OUT_DIR, { recursive: true });
  // …
  const out = `${OUT_DIR}/achados.json`;
  writeFileSync(out, JSON.stringify(achados, null, 2));
  ```
  O array `achados` contém, entre outras coisas, `rowDaLista: alvo` (row crua de `com298/list`) e `divergencias` com `priCod`, `mnyTitAbertoNaLista`, `valorAbertoNoDetalhe` — dados financeiros vinculados a documentos reais da Columbia. Não há `unlinkSync`, cron de limpeza, expiração, nem `chmod 600`.
- **Impacto técnico**: se o probe for executado no dyno de produção do Render (via `render shell`) o arquivo persiste na fatia local do container até o próximo redeploy — enquanto isso é legível por qualquer processo com permissão para `/tmp` daquele container. Um redeploy limpa, mas o artefato pode ser copiado para fora do host (upload de log, snapshot de suporte) antes disso.
- **Impacto de negócio**: exposição inadvertida de dados de clientes/exportadores da Columbia (nomes, valores, saldos) em superfície que não foi contemplada pelo contrato Columbia↔Kavex. Vazamento fora do escopo do "necessário para operar o produto".
- **Métrica de baseline**: 1 arquivo `achados.json` gerado por execução, sem TTL; N execuções recentes desde `2026-08-28` acumulam N arquivos. Sem retenção documentada.

### F-security-3: `console.log` de rows brutas do ERP na saída padrão do probe

- **Severidade**: P2
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/jobs/probe-invoice-pago.ts:86-88,151-155,231-239`
- **Evidência (objetiva)**:
  ```ts
  const registrar = (pergunta: string, resultado: unknown): void => {
      achados.push({ pergunta, resultado });
      console.log(`\n### ${pergunta}`);
      console.log(JSON.stringify(resultado, null, 2).slice(0, 4000));
  };
  // …
  registrar(`[fil ${filCod}] 2. doc ${String(alvo.docCod)} — lista vs detalhe`, {
      rowDaLista: alvo,     // row inteira do ERP
      isPagoAtual: isPagoAtual(alvo),
      detalhe: det,
  });
  ```
  O truncamento em 4000 chars limita a linha, mas cada chamada `registrar` gera sua própria linha — várias por filial (tally, alvos, filtro, blast radius). Rows do `com298/list` costumam trazer `priCod`, `pesCod` do importador, valor de face, `mnyTitPermutar` etc.
- **Impacto técnico**: o stdout do `job:ingest-permutas` (ou do probe rodado à mão via shell do Render) é capturado no log do Render, que tem retenção de dias em plano `starter` e é acessível por quem tem login no dashboard.
- **Impacto de negócio**: mesmo classe do F-security-2, com superfície diferente (log de plataforma vs disco local). Reduz o controle sobre onde o dado financeiro do cliente vive.
- **Métrica de baseline**: no run de amostra=40, filial=2, o probe emite ~4 blocos por filial × N filiais → ordem de 12–20 linhas com rows brutas. **0 sanitização** (redact de `pesCod`, hash de `priCod`, etc.).

### F-security-4: Sondas de PRD são bundleadas na imagem de produção; gate `PROBE_ALLOW_PRD` é boolean simples

- **Severidade**: P2
- **Tactic violada**: Limit Access (+ Separate Entities)
- **Localização**: `src/backend/tsconfig.json:24` (`"include": ["**/*.ts"]`, sem exclusão de `jobs/probe-*.ts`); gate em `probe-invoice-pago.ts:60` e `validate-invoice-pago-detalhe-v1.ts:29`
- **Evidência (objetiva)**:
  ```ts
  // probe-invoice-pago.ts:60-66
  if (!IS_HML && process.env.PROBE_ALLOW_PRD !== '1') {
      console.error(
          `RECUSADO: base é PRODUÇÃO (${BASE}) e PROBE_ALLOW_PRD não está setado.\n` +
              'Rode com PROBE_ALLOW_PRD=1 para confirmar que a leitura em PRD é intencional.',
      );
      process.exit(1);
  }
  ```
  ```json
  // tsconfig.json — não há "exclude" para jobs/probe-*.ts nem jobs/validate-*.ts
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"],
  ```
  Isso significa que `npm run build` (o `buildCommand` do `render.yaml`) copia `probe-invoice-pago.ts` para `dist/jobs/probe-invoice-pago.js` no container do Render. O gate `PROBE_ALLOW_PRD=1` é a única barreira; não há allowlist de host, marca de build (`NODE_ENV`), nem registro de "quem ligou".
- **Impacto técnico**: qualquer ator com acesso ao shell do dyno de produção (Render dashboard → Shell) pode `PROBE_ALLOW_PRD=1 node dist/jobs/probe-invoice-pago.js` e disparar leitura em massa do ERP + gravar `/tmp/probe-invoice-pago/achados.json`. O caminho não passa por PR, code review ou aprovação.
- **Impacto de negócio**: canal paralelo, não auditado, para exfiltração/varredura do ERP da Columbia a partir da infra do produto — sem que o incidente apareça no log da aplicação (é `console.log`, não `LogService`).
- **Métrica de baseline**: 2 sondas bundleadas em `dist/jobs/` sob 1 gate boolean simples; 0 allowlist; 0 emissão de evento estruturado para o `LogService` quando o gate é ultrapassado.

### F-security-5: `com308RowSchema.titMnyTotPago` é validação decorativa — o mapper de produção usa `parseOptionalNumber` cru

- **Severidade**: P1
- **Tactic violada**: Validate Input
- **Localização**: `src/backend/domain/client/permutas/conexosPermutasSchemas.ts:47` (schema atualizado) vs `src/backend/domain/client/ConexosTitulosClient.ts:269-286` (mapper que ignora o schema)
- **Evidência (objetiva)**:
  ```ts
  // conexosPermutasSchemas.ts:41-52 — schema DEFINIDO
  export const com308RowSchema = z
      .object({
          titCod: wireId,
          titFltTaxaMneg: wireNumber.optional(),
          titMnyValorMneg: wireNumber.optional(),
          titMnyValor: wireNumber.optional(),
          titMnyTotPago: wireNumber.optional(),  // ← campo NOVO do delta
          moeCodMneg: wireNumber.optional(),
          moeEspNome: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough();
  ```
  ```
  grep -rn "com308RowSchema" src/backend --include="*.ts"
  → src/backend/domain/client/permutas/conexosPermutasSchemas.ts:41  (export)
  → src/backend/domain/client/permutas/conexosPermutasSchemas.test.ts:1,44,46,59  (teste)
  ```
  Zero chamadas em código de produção. `ConexosTitulosClient.listTitulosAPagar` mapeia direto:
  ```ts
  const valorBrl = this.base.parseOptionalNumber(r.titMnyValor);
  const valorPago = this.base.parseOptionalNumber(r.titMnyTotPago);
  ```
  onde `parseOptionalNumber` (ConexosBaseClient.ts:356-364) aceita qualquer number finito, inclusive **negativos**, e devolve `undefined` só para `null/undefined/''` e não-finitos. O CLAUDE.md exige "Validate external inputs (API events, DB nullables, SSM) with Zod at boundaries" — este boundary não valida.
- **Impacto técnico**: um `titMnyTotPago` retornado pelo ERP como número negativo, string vazia mascarada, ou `pago > face` passa direto. `derivarPagoDosTitulos` (`EleicaoPermutasService.ts:103-113`) computa `face - pago === 0` estrito; um `titMnyTotPago: -100` numa fatura de face 100 produz `face - pago = 200 !== 0` → `pago = false`. Direção segura no caso trivial, mas o caminho não tem *nenhuma* garantia formal de bounds: um dado de wire anômalo influencia decisão financeira sem sinalizar erro.
- **Impacto de negócio**: reforçar a distinção "não sei" (undefined → invoice segue visível) vs "sei zero" (pago = true → some do radar). Sem Zod, valores absurdos entram silenciosamente na função que decide se a analista enxerga o título — o cerne do bug corrigido neste delta. Validar aqui é a defesa em profundidade que garante que a próxima regressão de wire seja detectada, não silenciada.
- **Métrica de baseline**: `com308RowSchema` = 0 chamadas em produção; `com298RowSchema` = 2 chamadas (`ConexosFinanceiroClient.ts:286,343`) — assimetria óbvia. Adoção do schema no boundary do `com308`: **0%**.

## 5. Cards Kanban

### [security-1] Remover envs de escrita no ERP do cron READ-ONLY de permutas

- **Problema**
  > O novo bloco `envVars` do `financeiro-ingest-permutas` (`render.yaml:104-107`) declara `CONEXOS_WRITE_ENABLED` e `CONEXOS_DRY_RUN` "para não haver dois comportamentos diferentes se algum caminho novo passar por aqui". `jobs/ingest-permutas.ts` é READ-ONLY no ERP por design; carregar as flags dá capacidade de escrita a um processo que não escreve — envelope maior que o uso. Se uma feature futura importar um service com escrita, o cron passa a escrever sem revisão dedicada.
- **Melhoria Proposta**
  > Remover as duas chaves do bloco do cron. Consumo pelo código continua funcionando: sem a env, `EnvironmentProvider.resolveConexosWriteEnabled` cai no `false` implícito (linha 54). Se um caminho de escrita for legítimo no futuro, o requisito volta explícito e o cron ganha uma manutenção deliberada — que é justamente o gate que queremos. Tactic: Limit Access.
- **Resultado Esperado**
  > 0 envs de escrita em processos read-only. Auditoria do YAML deixa de precisar de comentário defensivo. Diff futuro que reintroduza a env vira sinal claro em code review.
- **Tactic alvo**: Limit Access
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Envs de escrita no bloco `envVars` do cron: 2 → 0
  - Grep `CONEXOS_WRITE_ENABLED` sob o bloco `- type: cron`: 1 → 0
- **Risco de não fazer**: em 6 meses, `/feature-tweak` que compartilhe imports entre cron e serviço web habilita escrita silenciosa no ERP a partir do job — reproduz classe de defeito que o `resolveConexosWriteEnabled` foi criado para prevenir.
- **Dependências**: nenhuma.

### [security-2] Aplicar `com308RowSchema` no boundary do `listTitulosAPagar`

- **Problema**
  > O delta adicionou `titMnyTotPago: wireNumber.optional()` ao `com308RowSchema` (`conexosPermutasSchemas.ts:47`) e cobriu com teste, mas o mapper de produção (`ConexosTitulosClient.listTitulosAPagar:269-286`) mapeia direto via `parseOptionalNumber` — o schema nunca é chamado (grep confirma 0 usos fora do teste). Valores anômalos do ERP (negativo, `pago > face`, string sem coerção) entram sem verificação na função `derivarPagoDosTitulos`, que decide se a invoice some da aba "em aberto" da analista.
- **Melhoria Proposta**
  > No `ConexosTitulosClient.listTitulosAPagar`, chamar `com308RowSchema.safeParse(r)` antes do map; row inválida é descartada com log (`LOG_TYPE.BUSINESS_WARN`) apontando o `titCod` — o comportamento defensivo já existe simétrico no `ConexosFinanceiroClient.ts:343` (`if (!com298RowSchema.safeParse(row).success) return [];`). Complementar `wireNumber` com `.refine(n => n >= 0, 'valor financeiro negativo')` para negar valores absurdos. Tactic: Validate Input.
- **Resultado Esperado**
  > 100% dos rows `com308` passam por Zod antes do mapper. Um `titMnyTotPago` negativo ou `pago > face` retornado pelo ERP vira BUSINESS_WARN com trilha de auditoria em vez de sombra numérica em decisão financeira.
- **Tactic alvo**: Validate Input
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - Adoção de `com308RowSchema` em produção: 0% → 100% (mesmo padrão do `com298RowSchema`)
  - Valores negativos em campos monetários silenciosamente aceitos: hoje ilimitado → 0 (rejeitados com log)
- **Risco de não fazer**: próxima regressão silenciosa do wire (ERP muda tipo de `titMnyTotPago`, empurra sentinel `-1`, etc.) reproduz a classe do bug atual — invoice liquidada some ou invoice em aberto desaparece — mas desta vez sem probe para diagnosticar.
- **Dependências**: nenhuma (schema já existe).

### [security-3] Sondas de PRD fora do bundle de produção + gate estruturado

- **Problema**
  > `jobs/probe-invoice-pago.ts` e `jobs/validate-invoice-pago-detalhe-v1.ts` são compiladas em `dist/jobs/` pelo `buildCommand` do Render (`tsconfig.json:24` include `**/*.ts`, sem exclude). Ficam no disco do container de produção sob um gate boolean simples (`PROBE_ALLOW_PRD=1`). Qualquer ator com Render shell + a env acionável dispara varredura em massa do ERP; o incidente não sobe pelo `LogService` porque as sondas usam `console.log`/`console.error` puros.
- **Melhoria Proposta**
  > (a) Excluir explicitamente `jobs/probe-*.ts` e `jobs/validate-*.ts` do build de produção via `tsconfig.build.json` (extends do `tsconfig.json` com `exclude`) OU mover as sondas para `scripts/probes/` fora do `include`. (b) Reforçar o gate: além de `PROBE_ALLOW_PRD=1`, exigir `PROBE_OPERATOR=<nome>` e emitir uma linha `LogService.warn({ type: BUSINESS_WARN, message: 'probe PRD acionada', data: { probe, operator, cwd, hostname } })` antes de qualquer chamada ao ERP. Tactic: Limit Access + Inform Actors.
- **Resultado Esperado**
  > Sondas ausentes do `dist/` de produção (verificável com `ls dist/jobs/ | grep -E "probe|validate-invoice"`). Uso legítimo continua via checkout local (`npx tsx jobs/probe-invoice-pago.ts`); uso ilegítimo no dyno de produção não tem mais binário para invocar. Toda execução de probe fica registrada no log estruturado.
- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Arquivos `dist/jobs/probe-*.js` e `dist/jobs/validate-invoice-*.js` no build de PRD: 2 → 0
  - Execuções de probe registradas no `LogService`: 0 → 100%
- **Risco de não fazer**: canal paralelo não-auditado para leitura em massa do ERP da Columbia continua disponível a quem tiver login no Render — o padrão é exatamente o "insider com acesso ao repo/infra" do cenário Bass.
- **Dependências**: nenhuma.

### [security-4] Sondas escrevem em `/tmp` sem TTL/rotação — endurecer artefato

- **Problema**
  > `probe-invoice-pago.ts:243` faz `writeFileSync` de `achados.json` com rows crus do ERP (nomes de exportador/importador, valores, `priCod`) em `/tmp/probe-invoice-pago/` por default, sem `chmod`, sem `unlinkSync` ao fim, sem TTL documentado. No dyno do Render o arquivo persiste até o próximo redeploy e é acessível ao usuário do container.
- **Melhoria Proposta**
  > (i) Mudar o default de `OUT_DIR` para um path efêmero que é `unlink`ado no `finally` do `main()`. (ii) `chmod 600` no arquivo. (iii) Não escrever rows brutas — sanitizar: `pesCod` → `hashSha256(pesCod).slice(0,8)`, esconder `nome do exportador`, manter apenas `docCod/priCod/valorAbertoNoDetalhe`. (iv) Documentar no header: "artefato local do desenvolvedor; NÃO deixar em máquinas compartilhadas". Tactic: Limit Exposure + Encrypt Data (parcial).
- **Resultado Esperado**
  > O arquivo persiste apenas o mínimo necessário para o diagnóstico e é apagado na saída bem-sucedida (mantido em `catch` para forense de falha). Rows brutas com nome de cliente saem do artefato e do log.
- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2, F-security-3
- **Métricas de sucesso**:
  - Nomes de cliente/exportador em `achados.json`: N → 0
  - Arquivo `/tmp/probe-invoice-pago/achados.json` remanescente após saída bem-sucedida: 1 → 0
- **Risco de não fazer**: cada execução de probe deixa um snapshot financeiro do cliente Columbia num disco não contratado para isso — pequeno individualmente, cumulativo em auditoria.
- **Dependências**: idealmente após [security-3] (sondas fora do bundle) para reduzir a superfície onde a mitigação precisa valer.

### [security-5] Runbook de rotação de credenciais Conexos (Web + Cron)

- **Problema**
  > O delta amplia a superfície de segredos: `CONEXOS_USERNAME`/`CONEXOS_PASSWORD`/`databaseConnectionString` agora existem em DUAS instâncias no dashboard do Render (web + cron). Divergência entre elas (rotação incompleta, typo na cópia) produz autenticação parcial e comportamento diferente entre a tela e o job — pior que "sem cron", como o próprio comentário do YAML reconhece. Não há runbook no repo para "rodar rotação e garantir paridade".
- **Melhoria Proposta**
  > Criar `docs/runbooks/rotacao-credenciais-conexos.md` com: (a) passos ordenados (rotacionar no ERP → atualizar web → atualizar cron → verificar `/health` → forçar 1 run do cron manualmente); (b) checklist "envs idênticas entre os dois blocos"; (c) grep alvo para o próximo delta: qualquer PR que toque `render.yaml` sob `- type: cron` deve linkar este runbook. Tactic: Revoke Access.
- **Resultado Esperado**
  > Toda rotação de credencial Conexos passa pelo mesmo procedimento; divergência web/cron detectada antes de ir a produção.
- **Tactic alvo**: Revoke Access
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1 (mesma raiz de "dois blocos, uma verdade")
- **Métricas de sucesso**:
  - Runbook de rotação no repo: ausente → presente
  - Referência do runbook no comentário do YAML dos dois blocos: 0 → 2
- **Risco de não fazer**: próxima rotação de credencial (obrigatória p/ incidentes) esquece um dos blocos; a divergência só aparece na tela quando o cron falhar silenciosamente ao ingerir permutas — mesmo padrão do bug corrigido neste delta.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo `--quick` respeitado: `npm audit` não reexecutado (assumido verde por herança do commit base `617ca3b`, que bumpou axios exatamente para destravar o CI).
- Não foi detectado nenhum SQL novo no delta (`git diff` sob `src/backend/**/*.ts` grep de `select/insert/update/delete/query/sql`: 0 matches) — parametrização não regrediu.
- Nenhum segredo commitado no delta: `git ls-files | grep -E "\.env$"` só devolve `.env.example`, e o novo bloco `envVars` do cron tem 6/6 chaves sensíveis com `sync: false`. O achado P1 é *arquitetural* (envelope de privilégio + validação decorativa), não hygiene.
- Cross-QA para o consolidator: (a) F-security-5 (Validate Input) tem overlap com Fault Tolerance — mesma classe de defeito ("wire anômalo silenciado"); (b) F-security-2/3 (Limit Exposure via artefatos de probe em `/tmp`) tem overlap com Deployability — o `tsconfig` include universal é decisão de build que gera efeito em security; (c) F-security-1 (Limit Access no cron) tem overlap com Deployability — o comentário do próprio YAML reconhece o trade-off e escolhe o lado errado.
