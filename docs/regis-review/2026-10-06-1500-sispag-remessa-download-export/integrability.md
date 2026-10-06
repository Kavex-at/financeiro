---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-06-1500
agent: qa-integrability
generated_at: 2026-10-06T15:00:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review (delta sispag-remessa-download-export)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Conexos muda o contrato de `fin015/gerArquivosBancos/download/{gabCod}` (ou a grade deixa de trazer `gabLngDados`) | `ConexosSispagWriteClient.baixarRemessa` + `RemessaService.baixarArquivo` | Produção, lote com remessa gerada | Mudança absorvida no client; service mantém fallback e erro tipado | Arquivos tocados fora do client = 0; tempo até 1ª chamada validada < 1d |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos HTTP genéricos expostos por client novo no delta | 0 (usa `baixarRemessa` já existente) | 0 | ✅ | diff do delta em `domain/client/` (vazio) |
| Services do delta que importam axios/fetch | 0 | 0 | ✅ | grep |
| Colaboradores do `RemessaTitulosExportService` com I/O externo | 0 (só repo local) | ≤2 | ✅ | RemessaTitulosExportService.ts |
| Constantes de contrato duplicadas BE/FE | 2 (`MAX_LOTES_EXPORT`, `STATUS_COM_REMESSA`) | 0 ou verificadas | ⚠️ | RemessaTitulosExport.ts:12; frontend/lib/sispag.ts:834,853 |
| Validação da resposta de `baixarRemessa` | 0 (coerção `String(raw ?? '')`) | validar | ⚠️ | ConexosSispagWriteClient.ts:1085 |
| Fixture de contrato do download por gabCod | 0 no delta (testes com mocks) | 1 | ⚠️ | RemessaService.test.ts |
| Versionamento explícito da API Conexos | ⚠️ Não medível localmente (sem versão na URL) | — | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Fallback usa método de domínio `baixarRemessa`; service não conhece a URL | ✅ presente | RemessaService.ts:1647 |
| Use an Intermediary | `RemittanceFileUnavailableError` traduz a falha do ERP para a rota (`respondLoteError`) | ✅ presente | routes/sispag.ts:1062-1068 |
| Restrict Communication Paths | Export é local, sem Conexos | ✅ presente | RemessaTitulosExportService.ts |
| Adhere to Standards | XLSX/CNAB padrão; Zod na entrada da rota | ✅ presente | routes/sispag.ts:1090 |
| Abstract Common Services | `runWithRetry`/`ensureSid` na base compartilhada | ✅ presente | ConexosSispagWriteClient.ts:1080 |
| Discover Service | N/A — sem config nova no delta | N/A | — |
| Tailor Interface | Mensagem do backend repassada ao FE (`mensagemDeErro`) | ✅ presente | frontend/lib/sispag.ts:824 |
| Configure Behavior | Teto 50 fixo em constante | ⚠️ parcial | RemessaTitulosExport.ts:12 |
| Manage Resources | `heavyRouteLimiter` + teto de lotes | ✅ presente | routes/sispag.ts:1093 |
| Orchestrate | Fallback linear grade → gabCod → erro; 2 round-trips em série no pior caso | ⚠️ parcial | RemessaService.ts:1636-1655 |
| Manage Resource Coupling | Acoplamento FE↔BE por constantes copiadas | ⚠️ parcial | F-integrability-1 |
| Contract testing | Sem fixture do payload de `download/{gabCod}` | ⚠️ parcial | F-integrability-2 |
| Versioning strategy | Ausente (herdado) | ❌ ausente | — |
| Backward-compat shims | Fallback por gabCod é shim barato (~15 LOC) | ✅ presente | RemessaService.ts:1645 |
| Observabilidade de falhas de integração | Log `BUSINESS_INFO` quando o fallback é usado; falha final vira erro tipado | ✅ presente | RemessaService.ts:1648 |

## 4. Findings

### F-integrability-1: Constantes de contrato duplicadas entre backend e frontend
- **Severidade**: P3
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/backend/domain/interface/sispag/RemessaTitulosExport.ts:12`; `src/frontend/lib/sispag.ts:833-860`
- **Evidência (objetiva)**:
  ```
  export const MAX_LOTES_EXPORT = 50;   // BE
  export const MAX_LOTES_EXPORT = 50    // FE ("espelha")
  STATUS_COM_REMESSA = REMESSA_GERADA, RETORNADO, BAIXADO (FE e BE)
  ```
- **Impacto técnico**: mudar o teto num lado gera 400 na UI ou limite morto.
- **Impacto de negócio**: analista vê erro ao exportar; baixo.
- **Métrica de baseline**: 2 constantes duplicadas, 0 testes de paridade.

### F-integrability-2: Download por gabCod sem validação de forma nem teste de contrato
- **Severidade**: P2
- **Tactic violada**: Adhere to Standards / Contract testing
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:1077-1090`; `RemessaService.ts:1646-1648`
- **Evidência (objetiva)**:
  ```
  return typeof raw === 'string' ? raw : String(raw ?? '');
  ```
  Um objeto JSON de erro viraria `"[object Object]"` (truthy) e seria devolvido como `.REM`.
- **Impacto técnico**: o fallback trata qualquer resposta não vazia como sucesso; o CNAB só é validado na geração, não no download.
- **Impacto de negócio**: arquivo inválido pode ser enviado ao banco se o analista não notar.
- **Métrica de baseline**: 0 checagens de forma (ex.: linhas de 240 colunas) no caminho do fallback; 0 fixtures de resposta.

### F-integrability-3: Grade de uma só página segue como caminho primário
- **Severidade**: P3
- **Tactic violada**: Orchestrate
- **Localização**: `RemessaService.ts:1636-1645`
- **Evidência (objetiva)**: `listarArquivosRemessa` lê 20 linhas; o fallback mascara a limitação, mas cada download de lote com `flpCod` reciclado paga 2 chamadas ao ERP.
- **Impacto técnico**: latência e carga extra numa sessão Conexos frágil.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 2 chamadas em série no pior caso.

## 5. Cards Kanban

### [integrability-1] Validar a forma do CNAB no download por gabCod
- **Problema**
  > `baixarRemessa` coage qualquer resposta para string; um corpo JSON de erro viraria "remessa" válida no fallback.
- **Melhoria Proposta**
  > No fallback de `RemessaService.baixarArquivo`, reaproveitar `RemessaCnabValidator` (ou checar linhas de 240 colunas) e lançar `RemittanceFileUnavailableError` se inválido; no client, rejeitar `raw` não-string. Adicionar teste com fixture sanitizada (já existem em `__fixtures__/`).
- **Resultado Esperado**
  > Respostas não-CNAB aceitas: possível → 0; fixtures de contrato 0 → 1.
- **Tactic alvo**: Adhere to Standards / Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Respostas não-CNAB aceitas: possível → 0
- **Risco de não fazer**: remessa corrompida entregue silenciosamente se o Conexos mudar o formato.
- **Dependências**: nenhuma

### [integrability-2] Garantir paridade de MAX_LOTES_EXPORT/STATUS_COM_REMESSA entre BE e FE
- **Problema**
  > Constantes copiadas à mão com comentário "espelha".
- **Melhoria Proposta**
  > Teste de paridade que leia ambos os arquivos, ou expor o teto num endpoint existente.
- **Resultado Esperado**
  > Divergência detectada em CI; testes de paridade 0 → 1.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Testes de paridade: 0 → 1
- **Risco de não fazer**: UI e BE divergem após mudança de teto.
- **Dependências**: nenhuma

### [integrability-3] Preferir gabCod registrado como caminho primário do download
- **Problema**
  > O primário depende de página única de 20 linhas; o fallback paga 2 chamadas.
- **Melhoria Proposta**
  > Quando `nativeGabCod` existe, baixar direto por ele e usar a grade como fallback, mantendo a checagem de nome.
- **Resultado Esperado**
  > Chamadas ao Conexos por download: 2 → 1.
- **Tactic alvo**: Orchestrate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Chamadas ao Conexos por download: 2 → 1
- **Risco de não fazer**: carga desnecessária em sessão Conexos limitada.
- **Dependências**: validar em dev que o download por gabCod devolve o arquivo certo.

## 6. Notas do agente

- Escopo: só o delta, sem chamadas de rede. Nenhum P0/P1: nenhum client novo vaza HTTP genérico, sem fetch/axios em service.
- Cross-QA: F-integrability-2 toca Security/Fault Tolerance (validação de entrada vinda do ERP).
- Não medíveis: versionamento da API Conexos e taxa de erro por dependência (requer produção).
