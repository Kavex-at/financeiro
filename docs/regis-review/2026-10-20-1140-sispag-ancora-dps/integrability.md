---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-20-1140
agent: qa-integrability
generated_at: 2026-10-20T12:00:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Integrability — Regis-Review (delta sispag-ancora-dps, ADR-0073)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos (arq020/psq014, sem contrato publicado) e municípios emissores de DANFSe | O Conexos muda o envelope de `TelaDocumento/list`, `arqDocFiles/list` ou `download`; um município novo usa outro layout de DANFSe | `ConexosGedClient`, `LeituraDanfse`, `LeitorDpsService`, job `ler-dps-nfse` | Cron SISPAG 3×/dia, robô CLONEX, PRD | Quebra de contrato é detectada e visível ao operador; novo layout entra sem tocar o leitor nem o motor | Tempo até detectar quebra < 1 ciclo de cron (8 h); novo layout = 1 arquivo + 1 fixture; 0 quebras silenciosas classificadas como "sem PDF" |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients com método HTTP genérico vazado (delta) | 0 novos (`ConexosGedClient` expõe 4 métodos de domínio; usa `getGeneric/postGeneric/getBinary` do `ConexosBaseClient` existente) | 0 | ✅ | `ConexosGedClient.ts:56-158` |
| Boundaries do GED com Zod | 3 de 4 (cabeçalho, pasta, arquivo); `download` por inspeção manual de bytes | 100% | ⚠️ | `ConexosGedClient.ts:15,23,29,150-154` |
| Falhas de schema/envelope contadas ou logadas | 0 (todas descartam em silêncio) | 100% | ❌ | `ConexosGedClient.ts:77,95,120,166` |
| Versão do endpoint pinada | N/A, Conexos não versiona `arq020` | — | N/A | paths literais |
| Layouts de DANFSe cobertos por fixture | 2 reais (nacional + municipal) + CT-e negativo (ao vivo) | ≥ 1 por emissor ativo | ✅ | `LeituraDanfse.test.ts` (conforme métricas compartilhadas) |
| Retry no download | ausente (nenhum `runWithRetry` em `getGeneric/getBinary` do GED) | retry em leitura | ⚠️ | `ConexosGedClient.ts:146`, `ConexosBaseClient.ts:179` |
| Contract test do `download` (base64 JSON vs binário vs lixo) | Medido ao vivo; ver `ConexosGedClient.test.ts` para os 3 ramos | 3 ramos testados | ⚠️ não verificado linha a linha | `ConexosGedClient.test.ts` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosGedClient` esconde os 4 endpoints; leitor só vê `DocumentoGed/ArquivoGed`; `ExtratorTextoPdf` isola `pdfjs`; `LeituraDanfse` é pura | ✅ presente | `ConexosGedClient.ts:45`, `ExtratorTextoPdf.ts:22` |
| Use an Intermediary | Reader grava `titulo_dps`; o motor lê a tabela, não o GED (acoplamento por dado, não por chamada) | ✅ presente | `LeitorDpsService.ts:81-87` |
| Restrict Communication Paths | Só `ConexosGedClient` toca `arq020`; somente leitura | ✅ presente | `ConexosGedClient.ts:38-44` |
| Adhere to Standards | Conexos sem OpenAPI; DANFSe nacional tem padrão, os municipais não | ⚠️ parcial | `LeituraDanfse.ts:12-16` |
| Abstract Common Services | `authenticatedGetBinary` entra no mesmo caminho de sessão/401 dos demais | ✅ presente | `legacyConexosAdapter.ts:63-66` |
| Discover Service | Sessão Conexos resolvida por chamada (usuário/robô) | ✅ presente | `legacyConexosAdapter.ts:4-5` |
| Tailor Interface | `ArquivoGed` normaliza `binEspName`/`adfEspDescricao` | ✅ presente | `ConexosGedClient.ts:122` |
| Configure Behavior | Limite do job por argv; `MAX_PAGINAS`, tolerâncias de layout em constantes de módulo; sem env/feature flag | ⚠️ parcial | `ler-dps-nfse.ts:9`, `LeituraDanfse.ts:4-10` |
| Manage Resources | Máx. 5 páginas; limite 40 títulos/run; relê falha após 12 h, máx. 3 | ✅ presente | `ExtratorTextoPdf.ts:4` |
| Orchestrate | Orquestração linear no `LeitorDpsService.ler` (6 passos em série), com isolamento por título | ✅ presente | `LeitorDpsService.ts:122-170` |
| Manage Resource Coupling | Reader depende de `BoletoSuggestionService.desfechosAgora` (1 chamada, só para selecionar alvos) | ⚠️ parcial | `LeitorDpsService.ts:60-63` |
| Contract testing | Zod + testes unitários; sem fixture gravada das respostas do Conexos | ⚠️ parcial | `ConexosGedClient.test.ts` |
| Versioning strategy | Sem versão no path; mitigação = Zod `safeParse` | ⚠️ parcial | `ConexosGedClient.ts:23-36` |
| Backward-compat shims | Fallback `psq014 → com298` e `download` aceita PDF cru | ✅ presente (barato) | `ConexosGedClient.ts:63-72,150` |
| Observability of integration failures | Log `warn` por título + contagem final; sem contagem por tipo de quebra | ⚠️ parcial | `LeitorDpsService.ts:110-114` |

## 4. Findings

### F-integrability-1: Quebra de envelope do GED vira "SEM_PDF" em vez de erro

- **Severidade**: P1
- **Tactic violada**: Tailor Interface / Observability of integration failures
- **Localização**: `ConexosGedClient.ts:95`, `:120`, `:166`; `LeitorDpsService.ts:186`
- **Evidência (objetiva)**:
  ```
  return Array.isArray(arvore) ? this.achatar(...) : [];          // :95
  if (!parsed.success) return [];                                // :120 (linha de arquivo)
  if (!pasta.success) return filhos;                             // :166
  motivo: pdfs.length === 0 ? 'nenhum PDF no GED do processo' ...
  ```
- **Impacto técnico**: se o Conexos renomear `dcmCod`/`adfCodSeq` ou trocar o envelope, todos os títulos caem em `SEM_PDF` ("nenhum PDF"), status de sucesso. O job sai com exit 0 e o alerta do workflow (`erros === alvos`) nunca dispara.
- **Impacto de negócio**: o ganho da âncora DPS some sem ninguém ver; a analista volta a desempatar boleto à mão e a causa só aparece em auditoria.
- **Métrica de baseline**: 3 pontos de descarte silencioso, 0 contadores; cobertura do alerta de job = só o caso 100% `ERRO`.

### F-integrability-2: `download` sem validação pós-decodificação

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards / Validate Input (cross Security, Fault Tolerance)
- **Localização**: `ConexosGedClient.ts:150-158`
- **Evidência (objetiva)**:
  ```
  if (typeof base64 === 'string') return Buffer.from(base64, 'base64');
  ```
  `Buffer.from(..., 'base64')` é leniente (ignora caracteres inválidos) e o resultado não é conferido contra `%PDF-` nem contra `binNumSize`, que o schema já lê (`:35`) e ninguém usa.
- **Impacto técnico**: string de erro/HTML embutida em JSON vira "PDF" corrompido; o erro aparece só dentro do `pdfjs` (`InvalidPDFException`), longe da causa, gravado como `ERRO` genérico.
- **Impacto de negócio**: diagnóstico lento quando o Conexos mudar o formato (já mudou uma vez: binário → base64, achado só ao vivo).
- **Métrica de baseline**: 3 formatos tratados (PDF cru, JSON-base64, outro = erro); 0 checagens de integridade após a decodificação.

### F-integrability-3: Falha no `psq014` engolida sem log, incluindo 403

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `ConexosGedClient.ts:69-72`
- **Evidência (objetiva)**:
  ```
  } catch { // segue para o com298 }
  return this.priCodDe(await this.base.getGeneric(`com298/${docCod}`, opts));
  ```
- **Impacto técnico**: uma permissão revogada ou mudança de contrato no `psq014` cai para o `com298`, que já se mostrou incapaz (RECORDNOTFOUND em documento só financeiro, 5/5 em PRD). O erro exibido ao operador é o do fallback e esconde a causa real.
- **Impacto de negócio**: o robô CLONEX já perdeu permissões no Conexos sem aviso (histórico em fin015/itens); aqui o mesmo padrão seria diagnosticado pela fonte errada.
- **Métrica de baseline**: 1 `catch` vazio; 0 logs da falha primária.

### F-integrability-4: Layout novo e CT-e são indistinguíveis; inclusão de emissor sem ponto de extensão

- **Severidade**: P2
- **Tactic violada**: Configure Behavior / Tailor Interface
- **Localização**: `LeituraDanfse.ts:12-16`, `LeitorDpsService.ts:151-153`
- **Evidência (objetiva)**:
  ```
  const ROTULO_DPS = /^numero (da )?dps\b/;
  if (!lido.dps) return {... status: SEM_DPS_NO_PDF, arquivo: pdf.nome};
  ```
- **Impacto técnico**: o leitor é um único conjunto de regex e tolerâncias globais; o ajuste para o layout municipal de 41087 (`"Número DPS"`, commit 2d0f928) exigiu mexer na regex compartilhada, com risco de regressão nos layouts já cobertos. DACTE (CT-e, sem DPS, correto) e "layout municipal desconhecido" terminam no mesmo status `SEM_DPS_NO_PDF`.
- **Impacto de negócio**: cada município novo é um ciclo de descoberta ao vivo; sem distinguir "não é NFS-e" de "não sei ler", a analista não sabe se o título é inelegível ou se falta suporte.
- **Métrica de baseline**: 2 layouts + 1 negativo conhecidos, 1 conjunto de regex compartilhado, 0 classificação do tipo de documento.

### F-integrability-5: Sem retry no download nem separação entre falha de contrato e falha transitória

- **Severidade**: P3
- **Tactic violada**: Manage Resources / Orchestrate
- **Localização**: `ConexosGedClient.ts:146`, `ConexosBaseClient.ts:179`, `LeitorDpsService.ts:104-119`
- **Evidência (objetiva)**: `getBinary` e `getGeneric` do GED não passam por `runWithRetry`; `lerComSeguranca` grava toda exceção como `ERRO` (timeout e quebra de contrato iguais). A mitigação existe: relê após 12 h, máx. 3.
- **Impacto técnico**: uma falha transitória custa uma das 3 tentativas e 12 h. Baixo, porque o ciclo de 3×/dia absorve.
- **Impacto de negócio**: atraso de até 12 h na âncora para o título afetado.
- **Métrica de baseline**: 0 retries na cadeia do GED (4 chamadas por título); 3 tentativas máximas por título.

## 5. Cards Kanban

### [integrability-1] Tornar visível a quebra de contrato do GED

- **Problema**
  > Os descartes silenciosos do `ConexosGedClient` (`:95`, `:120`, `:166`) e o `catch` vazio do `psq014` (`:69`) convertem mudança de contrato em `SEM_PDF`, status de sucesso. O exit 1 do job só ocorre se 100% for `ERRO`.
- **Melhoria Proposta**
  > Contar no client as linhas e nós rejeitados pelo Zod e logar a falha primária do `psq014` (`warn`, com status HTTP). Lançar `ConexosError` quando o envelope vier em formato inesperado (não-array) ou quando todas as linhas de uma lista não vazia forem rejeitadas. Incluir `rejeitadas` e `fallbackCom298` no log final de `executar` e no `console.log` do job. Tactic: Tailor Interface + observabilidade por dependência.
- **Resultado Esperado**
  > Mudança de contrato gera `ERRO` com motivo "contrato" e contador visível. Quebras silenciosas: 3 pontos → 0.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1, F-integrability-3
- **Métricas de sucesso**:
  - Pontos de descarte sem contador: 3 → 0
  - `catch` vazios no GED client: 1 → 0
- **Risco de não fazer**: na próxima alteração do `arq020`, a leitura de DPS para de funcionar durante semanas, sem alerta.
- **Dependências**: nenhuma

### [integrability-2] Validar a integridade do arquivo baixado do GED

- **Problema**
  > O `download` decodifica base64 de forma leniente e devolve os bytes sem checar nada, embora `binNumSize` esteja no schema.
- **Melhoria Proposta**
  > Após decodificar, exigir o prefixo `%PDF-` e, quando `binNumSize` existir, tolerância de tamanho (aviso, não erro). Erro tipado "contrato do download" (distinto de falha do `pdfjs`). Adicionar fixtures de contrato: PDF cru, JSON-base64, JSON de erro, string não-base64. Tactic: Adhere to Standards.
- **Resultado Esperado**
  > Conteúdo inválido falha na fronteira, com mensagem que diz qual formato chegou. Checagens pós-decodificação: 0 → 2.
- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Formatos de `download` com teste de contrato: 3 → 5
- **Risco de não fazer**: a próxima troca de formato do download volta a ser descoberta só ao vivo.
- **Dependências**: nenhuma

### [integrability-3] Registrar layouts de DANFSe e tipar o documento lido

- **Problema**
  > Um conjunto único de regex atende todos os municípios; CT-e e layout desconhecido caem no mesmo `SEM_DPS_NO_PDF`.
- **Melhoria Proposta**
  > Extrair estratégias de rótulo/posição por layout (nacional, municipal, ...) atrás de uma interface pequena; `LeituraDanfse` tenta em ordem. Detectar tipo (DANFSe vs DACTE) por rótulo-âncora e gravar um motivo distinto (`NAO_E_NFSE`). Fixture mínima obrigatória por layout (texto posicionado, não o PDF). Tactic: Configure Behavior.
- **Resultado Esperado**
  > Novo município = 1 estratégia + 1 fixture, sem editar as existentes. Mapa de layouts: 0 → 1 registro explícito.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Arquivos tocados para adicionar um layout: 1 regex alterada → 1 arquivo novo
  - Motivos distintos para "sem DPS": 1 → 2
- **Risco de não fazer**: a cada emissor novo, regressão possível nos layouts que já funcionam.
- **Dependências**: aceitar um segundo emissor (fora do escopo desta entrega)

### [integrability-4] Retry no download do GED e distinção de erro transitório

- **Problema**
  > A cadeia do GED (4 chamadas por título) não usa `runWithRetry`, e o erro transitório consome uma das 3 tentativas com espera de 12 h.
- **Melhoria Proposta**
  > Envolver `baixarArquivo` e as listagens em `base.runWithRetry` (o gate `isDeterministicRefusal` já evita retry em 4xx). Opcional: marcar erro transitório (5xx/timeout) como não contabilizado nas 3 tentativas. Tactic: Manage Resources.
- **Resultado Esperado**
  > Falha transitória deixa de custar uma tentativa de 12 h. Retries na cadeia: 0 → 2 por chamada.
- **Tactic alvo**: Manage Resources
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Chamadas do GED com retry: 0 de 4 → 4 de 4
- **Risco de não fazer**: atraso ocasional de 12 h em títulos pontuais; baixo.
- **Dependências**: integrability-1 (para não mascarar quebra de contrato no retry)

## 6. Notas do agente

- Escopo só no delta. Não rodei testes nem Bash (restrição). Li `ConexosGedClient`, `LeituraDanfse`, `LeitorDpsService`, `ExtratorTextoPdf`, o job, o adapter e o `ConexosBaseClient`; não li `services/conexos.ts` (`authenticatedGetBinary`) nem os `.test.ts`, então a cobertura de contrato do `download` está marcada como não verificada.
- Pontos positivos: client só leitura, Zod em 3 de 4 boundaries, isolamento por título, acoplamento reader→motor por tabela, fallbacks baratos.
- Cross-QA: F-2 e F-1 tocam Security e Fault Tolerance (Validate Input); F-4 toca Modifiability (Encapsulate).
