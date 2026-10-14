---
qa: Security
qa_slug: security
run_id: 2026-10-14-2030
agent: qa-security
generated_at: 2026-10-14T20:45:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Security — Regis-Review (delta: sispag-remocao-codbar-repetido)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticada sem permissão, insider com leitura de log/banco, ou dado malformado vindo do ERP | Leitura das 2 rotas novas, inspeção de log/trilha/colunas de bloqueio, ou `itsCodSeq`/`filCod` adulterado na resposta do Conexos | `RetiradaCodigoBarrasService`, `titulo_bloqueio_duplicidade` (0085), rotas `GET /sispag/titulos/retidos-por-codigo-barras` e `/lotes/:id/retirados-por-codigo-barras`, `ConexosSispagWriteClient.removerItemDoRascunho` | Produção, lote com boleto repetido/ilegível | Código de barras completo nunca persiste nem sai; rotas exigem `SISPAG_VER`; retirada e desfazer ficam na trilha; DELETE só com inteiros validados | 0 ocorrências de 44 dígitos em log/coluna/resposta; 2/2 rotas com guard; 100% das retiradas com evento `ITEM_REMOVIDO_SISTEMA` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Colunas novas que podem guardar código completo | 0 (CHECK `^[0-9]{5}…[0-9]{4}$` recusa >9 dígitos) | 0 | ✅ | `migrations/0085_...sql` |
| Rotas novas com `exigirPermissao` | 2/2 (`SISPAG_VER`, só leitura) | 100% | ✅ | `routes/sispag.ts`, `routePermissions.test.ts` (contagem 54→56) |
| Rotas novas com `Cache-Control: no-store` | 2/2 | 100% | ✅ | `routes/sispag.ts` |
| SQL novo não parametrizado | 0 sítios (`$loteId`, `$filCod`...) | 0 | ✅ | `LotePagamentoRepository.ts` ~906 |
| Segredos hardcoded no delta | 0 | 0 | ✅ | inspeção do diff |
| Componentes do path do DELETE validados como inteiro | 5/5 por tipo; `itsCodSeq` via Zod `int().positive()`; `bncCod/flpCod/filCod` tipados `number` | 5/5 com `Number.isInteger` | ⚠️ | `ConexosSispagWriteClient.ts:153,709` |
| Mensagem de erro do DELETE sanitiza dígitos longos | `replace(/\d{10,}/g,'…')` | sim | ✅ | `RetiradaCodigoBarrasService.ts:~480` |
| `npm audit` / CloudTrail / API Gateway authorizers | não aplicável (sem `infra/`; delta sem dependência nova) | — | ⚠️ **Não medível localmente** | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | fora do delta; sem alerta de remoção anômala em massa | ⚠️ parcial | log `BUSINESS_WARN` por lote, sem alarme |
| Detect Service Denial | N/A (sem mudança de borda) | N/A | delta é lógica de domínio |
| Verify Message Integrity | releitura do rascunho confirma ausência em vez de confiar no status do DELETE | ✅ | `RetiradaCodigoBarrasService.ts` I16d.3 |
| Detect Message Delay | N/A | N/A | — |
| Identify Actors | retirada pelo sistema com evento `ITEM_REMOVIDO_SISTEMA`; undo atribuído à analista (rota existente) | ✅ | `VerificacaoEventoRepository.ts`, `DuplicateResolutionService.desfazerBloqueio` |
| Authenticate Actors | middleware existente | ✅ | herdado |
| Authorize Actors | leituras `SISPAG_VER`; undo `SISPAG_EXECUTAR` | ✅ | `routePermissions.test.ts:108-112` |
| Limit Access | resposta só com campos mascarados; sem `codbar` | ✅ | `routes/sispag.ts` mapeamento explícito |
| Limit Exposure | blast radius do DELETE: um item por vez, rascunho nativo, lote FINALIZADO recusado (400 em HML) | ✅ | `RetiradaCodigoBarrasService` |
| Encrypt Data | N/A no delta (TLS/DB herdados) | N/A | — |
| Separate Entities | marca por origem; colunas separadas | ✅ | 0085 |
| Change Default Settings | N/A | N/A | — |
| Validate Input | Zod no `itsCodSeq`; CHECKs de coerência de campos; `:id` da rota é `String(req.params.id)` sem validar UUID | ⚠️ parcial | `routes/sispag.ts` |
| Revoke Access | N/A | N/A | — |
| Lock Computer | falha parcial fecha o ledger e bloqueia finalização (fail-closed) | ✅ | shared-metrics |
| Inform Actors | aviso persistente no LoteCard + mensagem pt-BR com ids curtos | ✅ | `RetiradosPorCodigoBarrasAviso.tsx` |
| Restore | undo da retenção; reinclusão no rascunho é manual | ⚠️ parcial | `TitulosRetidosBadge.tsx` |
| Audit Trail | `ITEM_REMOVIDO_SISTEMA` + `BLOQUEIO_CRIADO` na mesma transação da remoção local | ✅ | `retirarItemPorCodigoDeBarras` |

## 4. Findings

### F-security-1: Trilha da retirada nativa (DELETE) é posterior e não transacional com a local

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `RetiradaCodigoBarrasService.ts:~238-270, 462-485`
- **Evidência (objetiva)**:
  ```
  retirarLocal (tx: remove+marca+evento) -> apagarNoRascunho (catch -> logService.warn, sem evento)
  ```
  O resultado do DELETE nativo (sucesso, falha, ausência confirmada) vive só em log e ledger; a trilha persistente registra a intenção, não o efeito no ERP.
- **Impacto técnico**: reconstruir "o que foi apagado no Conexos e quando" exige cruzar log efêmero com ledger.
- **Impacto de negócio**: em auditoria de um pagamento faltante, não há prova persistida na trilha de que o item saiu do rascunho nativo.
- **Métrica de baseline**: 0 eventos de trilha para o desfecho do DELETE (1 evento de intenção por retirada).

### F-security-2: Parâmetro `:id` da rota de retirados sem validação de formato

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `routes/sispag.ts` (`listarRetiradasDoLote(String(req.params.id))`)
- **Evidência (objetiva)**: sem `z.string().uuid()`; o valor segue parametrizado (`$`), sem injeção, mas erro de cast do Postgres vira 500.
- **Impacto técnico**: ruído 500 e possível enumeração por mensagem de erro.
- **Impacto de negócio**: baixo; leitura protegida por `SISPAG_VER`.
- **Métrica de baseline**: 1 rota nova sem schema de params.

### F-security-3: Path do DELETE interpolado sem asserção de inteiro nos números não-Zod

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `ConexosSispagWriteClient.ts:709`
- **Evidência (objetiva)**:
  ```
  `fin015/finItemSispag/${bncCod}/${flpCod}/${itsCodSeq}/${filCodItem}/${filCod}`
  ```
  `itsCodSeq` passa por Zod coerce int positivo; os demais dependem de tipo TS. Uma resposta do ERP com `filCod` não numérico em tempo de execução alteraria o path (traversal dentro do host Conexos, sem SSRF).
- **Impacto técnico**: DELETE em recurso inesperado do mesmo ERP.
- **Impacto de negócio**: remoção do item errado de um rascunho de pagamento; mitigado pela releitura e pelo ledger.
- **Métrica de baseline**: 4/5 componentes do path sem guarda de runtime.

Verificado e sem achado: o código completo não aparece em logs (só `mascarados`, `idCurto`, erro com `\d{10,}` mascarado), na resposta, na trilha nem nas colunas (CHECK no esquema); migração só adiciona, idempotente; CHECK `origem_campos` impede campos de retirada em `DUPLICIDADE_TITULO`.

## 5. Cards Kanban

### [security-1] Persistir o desfecho do DELETE nativo na trilha

- **Problema**
  > A trilha persistente registra a intenção local de retirada, mas o resultado do DELETE no Conexos fica só em log e ledger. Em auditoria de pagamento não há prova durável do efeito no ERP.

- **Melhoria Proposta**
  > Emitir evento `ITEM_REMOVIDO_NATIVO_CONFIRMADO`/`FALHOU` (ou `dados.nativo` em evento existente, sem alterar o CHECK de nomes) após a releitura em `RetiradaCodigoBarrasService`. Tactic: Audit Trail.

- **Resultado Esperado**
  > 100% das retiradas com desfecho nativo na trilha (hoje 0).

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - eventos de desfecho nativo por retirada: 0 → 1
- **Risco de não fazer**: disputa sobre pagamento omitido sem prova persistida.
- **Dependências**: nenhuma

### [security-2] Validar `:id` com Zod na rota de retirados

- **Problema**
  > A rota nova aceita qualquer string em `:id`; entrada inválida vira erro 500 do Postgres.

- **Melhoria Proposta**
  > Schema Zod de params (uuid) retornando 400. Tactic: Validate Input.

- **Resultado Esperado**
  > 100% das rotas novas com schema de entrada (hoje 1 sem).

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - rotas novas sem schema: 1 → 0
- **Risco de não fazer**: ruído operacional; baixo.
- **Dependências**: nenhuma

### [security-3] Guarda de runtime nos componentes do path do DELETE

- **Problema**
  > Só `itsCodSeq` é validado em runtime; `bncCod`, `flpCod`, `filCod`, `filCodItem` vêm de leitura do ERP e entram no path de uma escrita destrutiva.

- **Melhoria Proposta**
  > `Number.isSafeInteger` (ou Zod `int().positive()`) em `removerItemDoRascunho` antes de montar o path, lançando erro de domínio. Tactic: Validate Input.

- **Resultado Esperado**
  > 5/5 componentes validados (hoje 1/5).

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - componentes do path com guarda: 1/5 → 5/5
- **Risco de não fazer**: dado corrompido do ERP remove o item errado do rascunho.
- **Dependências**: nenhuma

## 6. Notas do agente

- Nenhum P0/P1: privacidade do código de barras é aplicada no esquema (CHECK) e na camada de serviço; as 2 rotas são só leitura com guard.
- `infra/`, API Gateway, IAM, CloudTrail e `npm audit` não medidos (fora do delta/inexistentes).
- Cross-QA: F-security-1 sobrepõe Fault Tolerance (Audit Trail); F-security-2/3 sobrepõem Integrability (Validate Input).
