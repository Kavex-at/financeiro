---
qa: Security
qa_slug: security
run_id: 2026-10-06-1500-sispag-remessa-download-export
agent: qa-security
generated_at: 2026-10-06T15:00:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado com SISPAG_VER (sem SISPAG_EXECUTAR) | Tenta obter dados bancários de fornecedores via download de remessa ou export de títulos | `GET /sispag/lotes/:id/remessa/arquivo`, `POST /sispag/remessas/titulos/exportar`, `GET /sispag/lotes` | Produção Express/Render, multi-usuário | CNAB (CNPJ/banco/conta de fornecedor) só com SISPAG_EXECUTAR; export só projeta dados já visíveis em SISPAG_VER; entrada validada por Zod; abuso limitado | 0 campos de destino do favorecido na planilha; 100% das rotas novas com guard de permissão e Zod; ids limitados a 50 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas com `exigirPermissao` | 1/1 (export: SISPAG_VER); download mantém SISPAG_EXECUTAR | 100% | ✅ | `routes/sispag.ts` (diff) |
| Rotas novas com Zod no boundary | 1/1 (`uuid[]` 1..50) | 100% | ✅ | `exportarTitulosSchema` |
| Rate limit na rota nova | `heavyRouteLimiter` | presente | ✅ | `routes/sispag.ts` |
| SQL não parametrizado no delta | 0 (`$ids` / `ANY`; só `LOTE_HEADER_COLUMNS` constante interpolada) | 0 | ✅ | `LotePagamentoRepository.ts` |
| Dados de destino do favorecido na planilha | 0 colunas (só conta pagadora da Columbia) | 0 | ✅ | `RemessaTitulosExportService.ts` COLUNAS |
| Segredos hardcoded / .env no delta | 0 | 0 | ✅ | leitura do diff |
| Export registra ator (quem exportou) em trilha persistida | 0 (só `logService.info` sem usuário) | 1 | ⚠️ | `exportar()` |
| Nome de arquivo no Content-Disposition do download sanitizado | não (nome vem do Conexos) | sim | ⚠️ | `routes/sispag.ts` download |
| `npm audit` | ⚠️ **Não medível localmente**: sem rede nesta revisão. Recomendação: rodar `npm audit` no CI | crit/high=0 | ⚠️ | n/a |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta | N/A (sem infra/ nem GuardDuty neste repo) | — |
| Detect Service Denial | `heavyRouteLimiter` na exportação | ⚠️ parcial | rota export |
| Verify Message Integrity | Leitura apenas | N/A | — |
| Detect Message Delay | Sem mensagens no delta | N/A | — |
| Identify Actors | JWT Supabase no middleware existente | ✅ | herdado |
| Authenticate Actors | Herdado | ✅ | herdado |
| Authorize Actors | CNAB mantido em SISPAG_EXECUTAR; export em SISPAG_VER (projeção sem dado de favorecido); matriz de permissões atualizada | ✅ | `routePermissions.test.ts` |
| Limit Access | Planilha sem conta/chave do favorecido; `listLotes` expõe só nome do arquivo e chaves nativas (identificadores, não conteúdo) | ✅ | `RemessaTitulosExport.ts` |
| Limit Exposure | Teto de 50 lotes; recusa o pedido inteiro se algum lote sem remessa | ✅ | `MAX_LOTES_EXPORT` |
| Encrypt Data | TLS na borda; sem novo armazenamento | N/A | — |
| Separate Entities | Tenant único hoje | N/A | — |
| Change Default Settings | Sem novos defaults | N/A | — |
| Validate Input | Zod `uuid[]`; SQL parametrizado; filename do export sanitizado, do download não | ⚠️ parcial | schema; F-security-2 |
| Revoke Access | Fora do delta | N/A | — |
| Lock Computer | Fora do delta | N/A | — |
| Inform Actors | Fora do delta | N/A | — |
| Restore | Leitura apenas | N/A | — |
| Audit Trail | Só log de aplicação, sem usuário | ⚠️ parcial | `exportar()` |

## 4. Findings

### F-security-1: Export de títulos sem ator registrado em trilha de auditoria

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/sispag/RemessaTitulosExportService.ts` (`exportar`), `src/backend/routes/sispag.ts` (rota export)
- **Evidência (objetiva)**:
  ```
  logService.info({ message: 'títulos de remessas exportados', data: { requestId, lotes, titulos } })
  ```
  O serviço não recebe o usuário; o log não identifica quem exportou nem quais lotes.
- **Impacto técnico**: não dá para responder "quem baixou a planilha de pagamentos de X".
- **Impacto de negócio**: a planilha contém credor, valor e documento de pagamentos; um vazamento interno não é rastreável (LGPD/sigilo). É leitura, sem movimentação de dinheiro, por isso P2.
- **Métrica de baseline**: 0 de 1 exports com ator persistido.

### F-security-2: Nome de arquivo do download de remessa vai ao header sem sanitização

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `src/backend/routes/sispag.ts` (rota `GET /lotes/:id/remessa/arquivo`, `Content-Disposition`)
- **Evidência (objetiva)**:
  ```
  res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nomeArquivo}"`)
  ```
  `nomeArquivo` vem de `remessa_arquivo` (origem Conexos). O export sanitiza (`[^\w-]`), o download não. Node rejeita CR/LF em header (vira 500, não injeção); aspas ou `;` podem alterar o nome. Risco prático baixo: o valor vem do ERP.
- **Impacto técnico**: nome adulterado ou 500 se o ERP devolver nome inesperado.
- **Impacto de negócio**: desprezível hoje.
- **Métrica de baseline**: 1 sítio sem sanitização.

### F-security-3: Injeção de fórmula via credor em XLSX (risco avaliado, baixo)

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `RemessaTitulosExportService.ts` (`linha`, `serializar`)
- **Evidência (objetiva)**: `credor: item.credor ?? null` entra em `sheet.addRow(objeto)`. No exceljs, string vira célula string (shared string), não fórmula; fórmula exigiria objeto `{ formula }`. O Excel não avalia `=CMD|...` em célula string, então o risco clássico (CSV) não se aplica ao XLSX. Ressalva: numa troca futura para CSV, ou conversão da planilha em CSV, um credor como `=HYPERLINK(...)` passa a executar. Nenhum teste trava isso.
- **Impacto técnico**: nenhum hoje; regressão possível.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 0 células de fórmula geradas; 0 testes de regressão.

Avaliado e aceito, sem finding: a exposição de `remessa_arquivo` e das chaves nativas a SISPAG_VER em `listLotes` (identificadores, sem CNAB); o fallback por `gabCod` usa só o valor registrado no lote (sem IDOR por parâmetro) e segue atrás de SISPAG_EXECUTAR; o `details` do 422 devolve só UUIDs do próprio pedido. Sem P0/P1.

## 5. Cards Kanban

### [security-1] Registrar o ator no export de títulos de remessas

- **Problema**
  > O export só emite um log de aplicação sem usuário. Uma planilha com credores e valores pode sair sem rastro de quem a baixou.
- **Melhoria Proposta**
  > Passar o usuário autenticado a `exportar()` e registrar ator + loteIds + contagem na trilha de auditoria persistida das ações SISPAG (ou no `LogService` com campo `actor`).
- **Resultado Esperado**
  > 100% dos exports com ator e lotes registrados (hoje 0%).
- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Exports com ator persistido: 0% → 100%
- **Risco de não fazer**: vazamento interno da carteira de pagamentos sem investigação possível.
- **Dependências**: nenhuma.

### [security-2] Sanitizar o filename do download de remessa

- **Problema**
  > O download usa `nomeArquivo` do ERP direto no header; o export já sanitiza.
- **Melhoria Proposta**
  > Extrair um helper de nome de arquivo (remove `[^\w.-]`) e usar nas duas rotas. Tactic: Validate Input.
- **Resultado Esperado**
  > Sítios com filename não sanitizado: 1 → 0.
- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Sítios sem sanitização: 1 → 0
- **Risco de não fazer**: baixo; erro 500 em nome atípico.
- **Dependências**: nenhuma.

### [security-3] Teste de regressão contra formula injection no export

- **Problema**
  > O XLSX é seguro hoje por usar células string, mas nada trava uma mudança para CSV ou para células de fórmula.
- **Melhoria Proposta**
  > Teste que gere o xlsx com credor `=1+1` e `@SUM(A1)` e confirme que a célula lida é string (não fórmula); comentar no serviço que CSV exigiria prefixar `'`.
- **Resultado Esperado**
  > Testes de formula injection: 0 → 1.
- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Testes de formula injection: 0 → 1
- **Risco de não fazer**: regressão silenciosa em futura troca de formato.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: delta backend. O frontend foi avaliado só pela descrição do pedido, sem leitura linha a linha. Sem rede, sem `npm audit`.
- A decisão de manter o CNAB em SISPAG_EXECUTAR e o export em SISPAG_VER está correta, dado que a projeção não carrega dado de favorecido.
- Cross-QA: Audit Trail sobrepõe Fault Tolerance; `heavyRouteLimiter`, teto de 50 lotes e buffer do xlsx em memória sobrepõem Performance e Availability.
