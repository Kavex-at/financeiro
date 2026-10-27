---
qa: Security
qa_slug: security
run_id: 2026-10-27-1803
agent: qa-security
generated_at: 2026-10-27T18:40:00-03:00
scope: backend
score: 8.5
findings_count: 3
cards_count: 3
---

# Security — Regis-Review (delta-only)

## 1. Cenário Geral (Bass General Scenario aplicado ao delta ADR-0078)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticada SISPAG (ou cliente HTTP forjado por insider com cookie válido) | `POST /sispag/sugestoes-boleto/confirmar` com `reconhecimento` tipado para destravar vínculo de boleto com data divergente (Δ ∈ [-10,-1]∪[6,10]) e eventualmente mover dinheiro na remessa SISPAG | `routes/sispag.ts` → `BoletoSuggestionService.confirmar` → `SugestaoBoletoRepository.inserirDecisao` → migration 0091; UI `ReconhecerDivergenciaDialog.tsx` | Produção multi-filial com `SISPAG_LIVE_WRITE_ENABLED=on` para filiais autorizadas | Zod `.strict()` rejeita campos extras; `exigirPermissao(sispag:executar)` + rate-limit; autor vem do JWT (`ator(req)`), nunca do corpo; reconhecimento conferido ao vivo (anti-TOCTOU) contra Δdias/valor atuais; CHECK no banco veta `reconhecido_por ∈ {sistema, unknown, ""}`; barcode só mascarado é persistido/logado | 0 bypasses de autorização; 0 reconhecimentos aceitos sem motivo 10–500 chars; 0 reconhecimentos aceitos quando Δ ou valor divergem do agora; 0 vazamentos de barcode cru |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `git diff origin/main...HEAD` (varredura manual + `grep -E "(password|secret|token|AKIA)"` sobre o patch) |
| `.env`/tfstate adicionados | 0 | 0 | ✅ | `git diff --stat origin/main...HEAD` |
| Endpoints novos sem `exigirPermissao` | 0/1 (`/sugestoes-boleto/confirmar` mantém `SISPAG_EXECUTAR`) | 0 | ✅ | `src/backend/routes/sispag.ts:977` |
| Endpoints novos sem Zod `.strict()` | 0/1 | 0 | ✅ | `SugestaoBoletoSchemas.ts:34-62` (`ReconhecimentoDivergenciaSchema.strict()`, `ConfirmarSugestaoBodySchema.strict()`) |
| Endpoints novos sem rate-limit | 0/1 | 0 | ✅ | `routes/sispag.ts:978` reusa `limiteDecisaoBoleto` |
| SQL com interpolação (template-literal com `${}` dentro de ``) no delta | 0 | 0 | ✅ | `SugestaoBoletoRepository.ts:272-328`, `:490-512`; `LotePagamentoRepository.ts:498-507`, `:1475-1497` — todos usam `$nomedoparam` |
| Campos sensíveis aceitos no body (`reconhecidoPor`, `reconhecidoEm`) | 0 | 0 | ✅ | `.strict()` em `ReconhecimentoDivergenciaSchema`; `ator` injetado só em `routes/sispag.ts:982` via `ator(req)` |
| CHECKs no banco contra autor forjado | 1 (`sispag_decisao_sugestao_boleto_reconhecedor_check`) | ≥1 | ✅ | `migrations/0091_sispag_reconhecimento_divergencia.sql` (bloco `reconhecedor_check`: rejeita `sistema`, `unknown`, string vazia) |
| HML probes com guarda anti-PRD | 3/3 | 100% | ✅ | `probe-hml-vinculo-data-divergente.ts:39`, `-rem.ts:47`, `-remessa.ts:25` (`if (!BASE.includes('-hml')) exit(1)`) |
| Barcode cru logado/persistido no delta | 0 (apenas `codbarMascarado` chega ao repo/log) | 0 | ✅ | `BoletoSuggestionService.ts:322-325, 386` e `DivergenceAcknowledgement*Error.ts` só carregam `codigoMascarado` |
| Audit trail do ato humano (quem/quando/motivo/Δvisto/valorVisto) | 6 colunas no `sispag_decisao_sugestao_boleto` + replica no evento `DECISAO_CONFIRMADA.detalhe` | presente | ✅ | `migrations/0091_*.sql` (bloco 1); `SugestaoBoletoRepository.ts:283-328` |
| `npm audit` novo | ⚠️ Não medível no modo `--quick` | — | ⚠️ | `--quick` scope do run |

> ⚠️ **Não medível localmente**: enforcement de filial allow-list para `confirmar` — o endpoint não gatilha o vínculo PRD (fase 2, flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, fora do delta). Hoje, só persiste a decisão + reconhecimento; o `PUT` no ERP (que de fato prende filial) vive na fase 2 ainda não em `src`.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | `ator(req)` extrai identidade do JWT; nunca do corpo (schema `.strict()` recusa `reconhecidoPor`) | ✅ | `routes/sispag.ts:982`; `ConferenciaReconhecimento.ts:33` |
| Authenticate Actors | Herdado da pilha SISPAG (middleware de sessão); endpoint protegido por `exigirPermissao` | ✅ | `routes/sispag.ts:977` |
| Authorize Actors | `exigirPermissao(PERMISSION.SISPAG_EXECUTAR)` no endpoint que grava a decisão/reconhecimento | ✅ | `routes/sispag.ts:977` |
| Limit Access | Rate-limit `limiteDecisaoBoleto` por ator/janela; `.strict()` reduz superfície de parâmetros | ✅ | `routes/sispag.ts:913, 978` |
| Limit Exposure | Barcode cru nunca sai de `CodigoBarrasBoleto.mascarar`; erros `DivergenceAcknowledgement*` só carregam `codigoMascarado`; HML probes exigem base `-hml` | ✅ | `BoletoSuggestionService.ts:322`; `probe-hml-*:39/47/25` |
| Encrypt Data | Credenciais Conexos HML lidas de `HML_ENV_FILE` fora do repo; nenhuma credencial introduzida no delta | ✅ | `probe-hml-vinculo-data-divergente.ts:27-39` |
| Separate Entities | Reconhecimento é **propriedade** da decisão (uma linha, mesma transação), não entidade solta — reduz superfície de forjar fora-de-banda | ✅ | `migrations/0091_*.sql` bloco 1 + CHECK `tudo_ou_nada` |
| Change Default Settings | Phase 2 (`SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`) default-off; CHECK em banco rejeita `sistema`/`unknown` como autor | ✅ | migration 0091 `reconhecedor_check` |
| Validate Input | `.strict()`, `min(10).max(500)`, `z.coerce.number().int()`, `literal(true)` em `aceito`, `literal('DATA_DIVERGENTE')` no tipo; conferência anti-TOCTOU server-side contra avaliação RECALCULADA | ✅ | `SugestaoBoletoSchemas.ts:34-48`; `ConferenciaReconhecimento.ts:50-74` |
| Verify Message Integrity | `deltaDiasVisto` e `valorBoletoVisto` do cliente são comparados com o Δ/valor recalculados ao vivo; divergência → 422 `RECONHECIMENTO_DE_DIVERGENCIA_DESATUALIZADO` | ✅ | `ReconhecimentoDivergencia.ts`; `ConferenciaReconhecimento.ts:65-73` |
| Detect Intrusion | Logs `info/warn` do service via `LogService`; evento `DECISAO_CONFIRMADA` com `detalhe` do reconhecimento no `sispag_evento_sugestao_boleto` (trilha only-insert, 0084) | ✅ | `BoletoSuggestionService.ts` (`emitirEvento`); migration 0091 preâmbulo |
| Detect Service Denial | Rate-limit por ator cobre o endpoint novo | ⚠️ parcial | `routes/sispag.ts:913` — métrica agregada/alarma ainda não medível (observability skill) |
| Detect Message Delay | N/A — endpoint síncrono, sem fila | N/A | — |
| Revoke Access | Herdado (middleware de sessão); nada no delta mexe no gerenciamento de sessão | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | 422 com código tipado (`RECONHECIMENTO_DE_DIVERGENCIA_OBRIGATORIO`/`_DESATUALIZADO`) e payload com `deltaDiasAtual`/`valorBoletoAtual` para a UI reconstruir o diálogo | ✅ | `DivergenceAcknowledgementStaleError.ts`; `DivergenceAcknowledgementRequiredError.ts` |
| Audit Trail | Reconhecimento imutável na mesma linha da decisão + evento `DECISAO_CONFIRMADA` com Δvisto/valorVisto/motivo/ator no `detalhe`; invalidação futura entra como `VINCULO_FALHOU` `RECONHECIMENTO_INVALIDADO` | ✅ | migration 0091 (preâmbulo e CHECKs); `SugestaoBoletoRepository.ts:283-328` |
| Restore | Rollback `rollbacks/0091_*.rollback.sql` presente | ✅ | `migrations/rollbacks/0091_sispag_reconhecimento_divergencia.rollback.sql` |

## 4. Findings

### F-security-1: `ReconhecimentoDivergenciaSchema.motivo` aceita qualquer texto; sem redação PII

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts:42-47`
- **Evidência**:
  ```ts
  motivo: z.string().trim().min(10).max(500),
  ```
- **Impacto técnico**: analista pode colar número de cartão, CPF alheio, nota fiscal interna etc. em `motivo`; o campo entra no banco e no `detalhe` do evento (`sispag_evento_sugestao_boleto`) e viaja em logs/relatórios. Sem allow-list ou censura básica, o campo vira depósito acidental de PII.
- **Impacto de negócio**: ampliação não controlada do escopo LGPD do schema SISPAG — todo backup/export do `sispag_decisao_sugestao_boleto` herda a PII colada.
- **Métrica de baseline**: 0 regras de redação sobre `reconhecimento_motivo` na migration 0091.

### F-security-2: `exigirPermissao(SISPAG_EXECUTAR)` é a única barreira por filial; sem allow-list explícita no endpoint `confirmar`

- **Severidade**: P2
- **Tactic violada**: Limit Access / Authorize Actors
- **Localização**: `src/backend/routes/sispag.ts:975-991`
- **Evidência**: `filCod` chega via body (`ChaveSugestaoBodySchema`); o endpoint não cruza esse `filCod` contra uma lista de filiais que o ator tem permissão. A permissão `SISPAG_EXECUTAR` é booleana por usuário, não por filial.
- **Impacto técnico**: um ator com `SISPAG_EXECUTAR` consegue registrar reconhecimento (I15r) em qualquer `filCod`, mesmo filial em que não opera. Hoje a decisão é só gravação local — não executa `PUT` no ERP; mas quando a fase 2 ligar a flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, essa decisão pré-existente é insumo para o vínculo de verdade.
- **Impacto de negócio**: cross-filial write-up — insider com acesso ao SISPAG de uma filial pode plantar o reconhecimento que destravará o vínculo em outra, assim que a fase 2 abrir.
- **Métrica de baseline**: 0 verificações `ator.filiaisAutorizadas.has(filCod)` no caminho de `confirmar`.

### F-security-3: HML probes gravam saídas em `/tmp/hml-vinculo-data-divergente` world-readable

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/jobs/probe-hml-vinculo-data-divergente.ts:56`, `-rem.ts:64`, `-remessa.ts:38`
- **Evidência**:
  ```ts
  const OUT = process.env.PROBE_OUT ?? '/tmp/hml-vinculo-data-divergente';
  ```
- **Impacto técnico**: dumps JSON das respostas Conexos HML (payloads de item/boleto, códigos de barras HML em claro) vão para `/tmp` com umask padrão (`-rw-r--r--`), legíveis por qualquer processo local do host de execução. Em HML não é dinheiro de verdade, mas é dado estrutural do ERP de produção clonado.
- **Impacto de negócio**: baixo — HML. Mas o padrão vira hábito para quando o probe for executado em uma máquina compartilhada.
- **Métrica de baseline**: 0 `chmod 0600` ou diretório dedicado com `mkdir({ mode: 0o700 })` nos três probes.

## 5. Cards Kanban

### [security-1] Redigir/validar `reconhecimento_motivo` antes de persistir

- **Problema**
  > O campo `motivo` do reconhecimento (I15r) vira coluna persistente e também viaja no `detalhe` do evento. Sem redação ou allow-list, uma analista cola CPF, cartão ou segredo e esses dados herdam a janela de retenção da trilha SISPAG, que é longa por design (audit trail).
- **Melhoria Proposta**
  > Em `SugestaoBoletoSchemas.ts`, refinar `motivo` com `.regex()` que recuse sequências que casem com CPF/CNPJ/cartão (ou passar por `ReconhecimentoDivergencia.sanitizarMotivo`) antes de montar `ReconhecimentoConferido`. Tactic: Limit Exposure.
- **Resultado Esperado**
  > 0 campos `reconhecimento_motivo` contendo match de regex PII em uma amostra de 1k linhas (hoje: não há regra).
- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - % motivos com PII detectada: desconhecido → 0% (regex server-side)
- **Risco de não fazer**: um audit LGPD futuro paga o custo de limpar `sispag_decisao_sugestao_boleto` + `sispag_evento_sugestao_boleto`.
- **Dependências**: nenhuma.

### [security-2] Cruzar `filCod` do body do `confirmar` com a allow-list de filiais do ator antes da fase 2

- **Problema**
  > Hoje `POST /sugestoes-boleto/confirmar` só exige a permissão booleana `SISPAG_EXECUTAR`. O `filCod` chega livre pelo corpo. Quando a flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` subir em PRD (fase 2 do ADR-0078), um reconhecimento plantado em filial errada vai alimentar o vínculo real.
- **Melhoria Proposta**
  > Em `routes/sispag.ts`, aplicar o mesmo guarda de filial já usado em `finalizar`/`gerar remessa` (via `exigirFilialAutorizada(req, body.filCod)`). Tactic: Limit Access.
- **Resultado Esperado**
  > 100% dos `confirmar` com `filCod` fora da allow-list do ator → 403. Hoje: 0% barrado.
- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - endpoints SISPAG mutantes com cheque de filial: parcial → 100%
- **Risco de não fazer**: quando V-PRD2 ligar `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, um ator de uma filial consegue destravar vínculo de boleto com data divergente em outra.
- **Dependências**: precede a liberação de V-PRD2 da fase 2.

### [security-3] Diretório dedicado e modo 0700 para dumps dos HML probes

- **Problema**
  > `probe-hml-vinculo-data-divergente*.ts` escreve em `/tmp/hml-vinculo-data-divergente` sem criar o diretório restrito; arquivos saem com umask padrão. Dumps carregam payloads inteiros do ERP HML.
- **Melhoria Proposta**
  > Trocar o default por `path.join(os.tmpdir(), 'hml-vinculo-data-divergente')` e criar com `fs.mkdir(OUT, { recursive: true, mode: 0o700 })` antes de qualquer `writeFile`. Tactic: Limit Exposure.
- **Resultado Esperado**
  > Diretório `/tmp/hml-vinculo-data-divergente` com modo 0700 (hoje 0755) e arquivos sem leitura para `other`.
- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - permissão do diretório de dump: 0755 → 0700
- **Risco de não fazer**: baixo em HML; cria hábito ruim para probes PRD.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo delta apenas (ADR-0078 fase 1). Fase 2 (`SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, `PUT` no ERP) não está em `src/`; achados sobre vínculo real foram antecipados em F-security-2.
- `npm audit` suprimido pelo modo `--quick`.
- Cross-QA: **Audit Trail** (reconhecimento + evento `DECISAO_CONFIRMADA.detalhe`) sobrepõe-se a Fault Tolerance; **Validate Input** (anti-TOCTOU via Δ/valor server-side) sobrepõe-se a Integrability; **Restore** coberto pelo rollback 0091. Alertar o consolidator.
- 0 achados P0. Zod `.strict()`, SQL parametrizado, autor do JWT, barcode mascarado, CHECK no banco contra `sistema/unknown` como autor, HML probes recusam PRD — todos verificados por file:line.
