---
name: conexos-nde-fiscal
type: integration
direction: write (REAL — gated CONEXOS_WRITE_ENABLED + CONEXOS_DRY_RUN, default dry-run)
ontology_version: "0.12"
implementation_status: implemented
status: stable
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosNdeFiscalClient.ts
  - src/backend/domain/client/ConexosNdeClient.ts
  - src/backend/domain/interface/recebimentos/NdeFiscal.ts
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/service/recebimentos/ContingenciaDecider.ts
  - src/backend/domain/interface/recebimentos/constants.ts
endpoints_write:
  - "com300 (PUT /api/com300 — fiscal read-modify-write, fisVldTipoNfDebito=6)"
  - "com131 (POST /api/com131/geraObs — gerar observações SINIEF)"
  - "com297 (POST /api/com297/homologaNfe/{docCod} | homologaNfeContingencia/{docCod} — homologar)"
endpoints_read:
  - "com300 (GET /api/com300/{docTip}/{docCod}/{fisCod} — finDocFiscal inteiro, RMW)"
  - "com131 (GET /api/com131/{docTip}/{docCod} — fisEspObs, guard idempotência)"
  - "com194 (GET initialValues + POST documento/list — validações fdvVldTperr:1, quando homologa=2)"
  - "com297 (GET /api/com297/{docCod} — poll vldAutorizado; docVldNfehom/vldStatus/docMnyValor)"
last_review: 2026-08-01
source:
  - "HAR REAL de produção (Columbia, doc 18337, filCod=2, 2026-08-01) — integrations/recebimentos-numerario-real-fiscal-spec.md"
---

# Integração: Conexos — cauda fiscal da NDe (com300 / com131 / com194 / com297-homologar)

> Superfície de **ESCRITA REAL** (gated) que conclui a **nota de débito eletrônica** de um
> `Recebimento` executado, após a geração da NDe (com297 `gerDocProcesso`) e o produto 41978.
> Disparada por `RecebimentoNumerarioService.processarAlocacao` (Frente IV). Fecha o GAP
> `nota-debito-fiscal` que a trilha de permutas deixou aberto. Fonte: HAR real de produção
> (`integrations/recebimentos-numerario-real-fiscal-spec.md`).

## Ordem OBRIGATÓRIA: (a) fiscal → (b) observações → (c) homologar

Homologar antes de gerar as observações produz o documento **sem** a observação SINIEF. As
observações são geradas a partir do tipo de nota de débito setado na etapa fiscal.

## Etapas + discriminadores (NÃO reusar um helper — cada etapa tem sucesso próprio)

| Etapa | Rota | Sucesso ⟺ | Client |
|-------|------|-----------|--------|
| geração NDe | `POST /api/com297/gerDocProcesso` | `messages[0].valid==='SUCESSO'`, docCod em `vars.docCod` | `ConexosNdeClient` |
| **(a) fiscal** | `PUT /api/com300` (RMW: GET inteiro → PUT `fisVldTipoNfDebito=6`) | `resp.fisVldTipoNfDebito===6` | `ConexosNdeFiscalClient` |
| **(b) observações** | `POST /api/com131/geraObs` `{docTip,docCod}` | `resp.fisEspObs` preenchido | `ConexosNdeFiscalClient` |
| **(c) homologar** | `POST /api/com297/homologaNfe/{docCod}` (ou `homologaNfeContingencia`) | `resp.docVldComvalidacoes===1` | `ConexosNdeClient` + `ContingenciaDecider` |
| poll SEFAZ | `GET /api/com297/{docCod}` | `vldAutorizado` muda (assíncrono; timeout ≠ erro) | `ConexosNdeFiscalClient` |

**HTTP 200 ≠ sucesso** em nenhuma das etapas — o sucesso é o discriminador in-band da coluna.

## Detalhes por etapa

- **(a) com300 — read-modify-write OBRIGATÓRIO.** `GET` devolve o `finDocFiscal` inteiro (73 campos);
  o `PUT /api/com300` (sem id na URL) reenvia o objeto INTEIRO com `fisVldTipoNfDebito=6` (Pagamento
  antecipado, inteiro). Campo omitido vira `null` → nunca montar parcial. `filCod` no corpo E no
  header. NÃO tocar `fisVldTipoNfCredito`. Constante `NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO=6`.
- **(b) com131 — guard idempotente.** GET antes; se `fisEspObs` já contém o marcador
  `AJUSTE SINIEF` (`NDE_OBS_SINIEF_MARKER`), NÃO chamar `geraObs` (o texto termina em ` /` → repetir
  pode APENDAR). Torna a etapa retomável.
- **(c) com297 — roteamento contingência.** `ContingenciaDecider` roteia por `vldTpNf` (string):
  conhecido normal (`NDE_NORMAL_TP_NF_CONHECIDOS=['10']`, HAR) → `homologaNfe`; `['11','12']` →
  `homologaNfeContingencia`; **desconhecido → aborta+alerta** (NÃO fail-open para normal).
  `docVldComvalidacoes` 1=ok / 2=aviso (busca erros via com194 `fdvVldTperr:1`, marca `revisao_humana`) /
  else=falha.
- **poll SEFAZ.** `vldAutorizado` continua `0` logo após homologar (SEFAZ é assíncrono); `docVldNfehom:1`
  ≠ autorizado. Poll `GET com297/{docCod}` até `vldAutorizado` mudar, com timeout+alerta (timeout não é
  erro — o orquestrador retoma no poll). Re-`ensureSid` a cada iteração (expiração de cookie).

## Datas

Epoch **ms**, data de calendário à **meia-noite UTC** (`Date.UTC(y,m,d)`); o servidor não converte
fuso — converter BRT→UTC erra 1 dia.

## Gating + posture

- **Gated:** `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN` (default dry-run) — em dry-run os payloads são
  montados/logados sem POST. 401/403 ou erro de etapa → fail-closed (`markError` + etapa na trilha).
- **ACL da conta de serviço** (checar `GET /api/permissoes/new/com297` no pré-flight): com300 UPDATE ·
  com131 GERAR OBS · com297 HOMOLOGAR / HOMOLOGAR CONTINGENCIA · com194 SELECT. Credenciais da conta
  de serviço, não humanas.

## Por que está na ontologia (universalidade)

A homologação fiscal de uma nota de débito eletrônica (tipo de nota → observação SINIEF → homologação
→ autorização SEFAZ) é um encadeamento **regulatório** (SINIEF/SEFAZ), estável no tempo e recorrente
em qualquer trading que emita NDe. A estrutura (RMW fiscal → observações → homologar na ordem correta
→ poll assíncrono, com 4 discriminadores distintos e fail-closed) é do domínio; o produto `41978`, o
`gcdCod` e o `fisCod` concreto são instância/config do tenant.

## Gaps / pendências (não modelados como verdade de domínio)

Ver PENDÊNCIAS do spec (`integrations/recebimentos-numerario-real-fiscal-spec.md`): `docMnyValor→0`
pós-homologação (log, não bloqueia — decisão do stakeholder); divergência `prdCod` (item `2` × com194
reclama `41978`) tratada via com194 + `revisao_humana`; latência SEFAZ (dimensionar timeout);
autenticação programática (expiração de cookie mitigada por re-`ensureSid`).

## Relação com com299-gerdoc

Esta integração é a **cauda** que segue a geração da SN (`integrations/conexos-com299-gerdoc.md`) e a
baixa `fin014` na trilha de recebimentos. Sequência completa: com299 (SN) → fin014 (baixa) → com297
(NDe + produto 41978) → **esta cauda fiscal** (com300 → com131 → com297-homologar → poll SEFAZ).
