---
qa: Testability
qa_slug: testability
run_id: 2026-10-20-1140
agent: qa-testability
generated_at: 2026-10-20T12:00:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 4
---

# Testability — Regis-Review (reduzido ao delta ADR-0073, sispag-ancora-dps)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / cron `ingest-sispag` | Conexos muda o layout do GED ou do DANFSe, ou `pdfjs-dist` é atualizado | `ConexosGedClient`, `ExtratorTextoPdf`, `LeituraDanfse`, `LeitorDpsService`, job `ler-dps-nfse` | CI (jest, ts-jest CJS, sem Conexos) e cron de produção | Um teste falha apontando a camada quebrada (download, extração, leitura, serviço) antes do cron gravar `titulo_dps` errado ou só `ERRO` | 100% das camadas do caminho PDF→DPS com teste automático em CI; 0 regressões que só apareçam no cron |

## 2. Métricas observadas

Escopo: delta. Baselines do orquestrador (backend 264 suites / 4878+ testes; frontend 101 / 1069) não foram rodados de novo. Cobertura por diretório não medida neste run (revisão reduzida).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| #1 Razão teste/fonte por camada do delta | service/sispag: 5 fontes (`AncoraOrdemDps`, `RegraSugestaoBoleto`, `LeituraDanfse`, `SelecaoLeituraDps`, `LeitorDpsService`) / 5 testes (+ `MotorSugestaoBoleto.dps.test.ts`, `BoletoSuggestionService.test.ts`); client: 1 / 1; repository: 1 / 1; libs/pdf: 1 / **0**; jobs: 1 novo / **0** (+2 scripts de validação one-off); frontend: 1 / 1 | ≥ 0,5 por camada, ≥ 1 em lógica | ⚠️ | leitura dos arquivos do delta; `_shared-metrics.md` |
| Cobertura line/branch por diretório | Não medível neste run (`--coverage` não executado) | 80% / 70% em `domain/service` | ⚠️ | requer `npm test -- --coverage` |
| Achados só ao vivo fixados por teste | `com298` RECORDNOTFOUND → `psq014` primeiro + fallback `com298` (3 testes); download base64 → bytes (1 teste) + formato inesperado vira erro (1 teste) | 2/2 | ✅ | `ConexosGedClient.test.ts:47-74,166-184` |
| Camada PDF → texto em CI | `ExtratorTextoPdf` 0 testes (ESM `pdfjs` fora do ts-jest); só smoke manual | ≥ 1 teste automatizado | ❌ | `ExtratorTextoPdf.ts:23-50` |
| Job `ler-dps-nfse` | 0 testes; regra de exit code `alvos>0 && lidos===0 && erros===alvos` não verificada | regra pinada | ⚠️ | `jobs/ler-dps-nfse.ts:31` |
| Fixtures de PDF real | Coordenadas copiadas à mão nos testes (`DANFSE`, `item(...)`), nenhum PDF/captura gravada; 4 layouts vistos ao vivo, 1 pinado como "print do 41155" | 1 fixture por layout | ⚠️ | `LeituraDanfse.test.ts:24`, `LeitorDpsService.test.ts:36-41` |
| Determinismo | `LeitorDpsService` usa `Clock` injetado (teste fixa `2026-10-19T18:00:00Z`); sem `Date.now`/`Math.random` no delta lido | 0 leituras de tempo não injetadas | ✅ | `LeitorDpsService.ts:67`, `LeitorDpsService.test.ts:77` |
| Pureza vs I/O | Parte pura (`AncoraOrdemDps`, `RegraSugestaoBoleto`, `LeituraDanfse`, `SelecaoLeituraDps`) instanciada sem mock; I/O atrás de `ConexosGedClient`/`ExtratorTextoPdf`/repos injetados por construtor | construtor + mocks | ✅ | `LeitorDpsService.test.ts:78-88` |
| Observabilidade do serviço | Log de resumo assertado; `warn` de falha assertado só indiretamente (ERRO com motivo `403`), sem `expect(log.warn)` | asserção no caminho de erro | ⚠️ | `LeitorDpsService.test.ts:198-207,176-189` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `LeitorDpsService.lerTitulo` lê um título sem gravar; scripts `validate-sispag-*-v1.ts` rodam o caminho ao vivo somente leitura | ✅ presente | `LeitorDpsService.ts:102` |
| Recordable Test Cases | Respostas do `arq020` reduzidas e coladas no teste ("captura de rede do título 41155"); PDFs reais não gravados, só coordenadas | ⚠️ parcial | `ConexosGedClient.test.ts:15-42` |
| Sandbox | Client e service com mocks; SQL do repo com teste próprio; `pdfjs` sem sandbox em CI | ⚠️ parcial | `TituloDpsRepository.test.ts` |
| Executable Assertions | Guardas em runtime: NFS-e do PDF ≠ título → ERRO; download inesperado → erro; Zod nas bordas | ✅ presente | `LeitorDpsService.ts:155-162`, `ConexosGedClient.ts:155` |
| Abstract Data Sources | `ExtratorTextoPdf` separa bytes de `ItemPdf[]`, o que permite testar `LeituraDanfse` por coordenadas | ✅ presente | `ExtratorTextoPdf.ts:7-12` |
| Limit Structural Complexity | Serviço dividido em seleção/leitura/escolha de PDF, cada parte com teste | ✅ presente | `LeitorDpsService.ts:122-190` |
| Limit Non-Determinism | `Clock` injetado; desempate por chave; `AncoraOrdemDps` sem relógio nem aleatório (leitura dos testes, não do fonte) | ✅ presente | `LeitorDpsService.test.ts:77` |

## 4. Findings

### F-testability-1: a camada PDF→texto não tem teste automático em CI

- **Severidade**: P1
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/libs/pdf/ExtratorTextoPdf.ts:23-50`
- **Evidência (objetiva)**:
  ```
  await import('pdfjs-dist/legacy/build/pdf.mjs');   // ts-jest CJS não carrega o ESM
  x: item.transform[4], y: item.transform[5]          // contrato de posição que LeituraDanfse consome
  Math.min(doc.numPages, MAX_PAGINAS)                 // teto de 5 páginas
  ```
  0 testes para o arquivo; os 2 testes de leitura usam `ItemPdf[]` escrito à mão.
- **Impacto técnico**: o par (`transform[4]`, `transform[5]`) e a regra "ignora `str` vazio" são o elo entre o PDF real e o leitor por posição. Um bump de `pdfjs-dist` (pinado em 4.10.38) que mude `transform`, o import ESM ou o `verbosity` passa o CI inteiro e só aparece no cron, como `ERRO`/`SEM_DPS_NO_PDF` em massa.
- **Impacto de negócio**: a âncora DPS silenciosamente para de produzir sinais. O motor volta ao comportamento anterior (SO_FRACA), e a analista confirma boleto na mão sem saber que a leitura quebrou.
- **Métrica de baseline**: 0 testes em CI para a extração; 1 smoke manual + 5/5 leituras ao vivo (uma vez, 19/10).

### F-testability-2: o job `ler-dps-nfse` e sua regra de exit code não têm teste

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces
- **Localização**: `src/backend/jobs/ler-dps-nfse.ts:22-32`
- **Evidência (objetiva)**:
  ```
  if (r.alvos > 0 && r.lidos === 0 && r.erros === r.alvos) process.exitCode = 1;
  const limite = Number(process.argv[2] ?? LIMITE_PADRAO);
  ```
- **Impacto técnico**: a regra que decide se o passo de alerta do `ingest-sispag.yml` dispara fica dentro de `main()` com `process.exit`, então não dá para exercitá-la. Uma mudança em `ResultadoLeituraDps` (ex.: novo contador) a quebra sem teste vermelho. O parse de `argv` também não está coberto (`NaN`, negativo, 0).
- **Impacto de negócio**: se o robô perder a permissão no `arq020` (risco já visto em fin015) e a regra falhar, o cron fica verde com 0 DPS lidos, e ninguém olha.
- **Métrica de baseline**: 0 testes; 1 regra de saída e 1 parse de argumento sem asserção.

### F-testability-3: layouts de DANFSe pinados só por coordenadas inventadas, sem fixture gravada

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/service/sispag/LeituraDanfse.test.ts:14-70`, `LeitorDpsService.test.ts:36-41`
- **Evidência (objetiva)**: os testes constroem `item('NÚMERO DA DPS', 400, 735)` à mão. Ao vivo apareceram 4 layouts (nacional, municipal "Número DPS" do 41087, DACTE de CT-e sem DPS, NF do 10463). O commit `2d0f928` ajustou o rótulo municipal depois do fato.
- **Impacto técnico**: coordenadas escritas pelo autor confirmam o algoritmo, não o PDF real. Um quinto layout só vai aparecer em produção.
- **Impacto de negócio**: cada layout novo vira `SEM_DPS_NO_PDF` sem aviso. Isso é seguro (sem âncora), mas esconde a perda de cobertura da âncora.
- **Métrica de baseline**: 0 fixtures de itens extraídos de PDF real versus 4 layouts conhecidos. O título de `titulo_dps` com `SEM_DPS_NO_PDF` não tem alerta de taxa.

### F-testability-4: o caminho de erro do serviço não assere o `warn` nem cobre falha do extrator

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/sispag/LeitorDpsService.test.ts:176-189`
- **Evidência (objetiva)**: o único teste de ERRO injeta falha em `priCodDoDocumento` (403); nenhum faz `extrator.extrair` ou `baixarArquivo` rejeitar (PDF corrompido, formato inesperado), e `log.warn` nunca é verificado. O motivo truncado em `MAX_MOTIVO = 300` também não tem asserção.
- **Impacto técnico**: o `try/catch` único em `lerComSeguranca` cobre os três casos, mas só um é provado. Mover o `await extrator` para fora do `try` passaria nos testes.
- **Impacto de negócio**: um PDF corrompido derrubaria o job inteiro em vez de gravar `ERRO` por título.
- **Métrica de baseline**: 1 de 4 pontos de falha de I/O (`priCod`, `download`, `extrair`, `registrar`) com teste.

## 5. Cards Kanban

### [testability-1] Testar a extração de texto do PDF no CI

- **Problema**
  > `ExtratorTextoPdf` fica fora do jest porque o ts-jest CJS não carrega o `pdfjs` ESM, e só um smoke manual o validou. Um bump de `pdfjs-dist` ou uma mudança em `transform` quebra a âncora DPS sem teste vermelho.
- **Melhoria Proposta**
  > Adicionar um teste que rode a extração de verdade (Sandbox): configurar o `transformIgnorePatterns`/`extensionsToTreatAsEsm` do jest, ou rodar este arquivo em `node --experimental-vm-modules`/script `test:pdf` ligado ao CI. Comitar um PDF sintético pequeno (gerado, sem dado de cliente) com dois rótulos e valores, e assertar `texto`, `pagina`, `x`, `y` e o teto de 5 páginas. Alvo: `domain/libs/pdf/ExtratorTextoPdf.test.ts`.
- **Resultado Esperado**
  > A camada PDF→`ItemPdf[]` passa a ser verificada em todo PR e o bump de `pdfjs` fica protegido.
- **Tactic alvo**: Sandbox
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - testes automáticos da extração em CI: 0 → 3 (posição, teto de páginas, texto vazio ignorado)
  - arquivos de `libs/pdf` sem teste: 1 → 0
- **Risco de não fazer**: em 6 meses o `pdfjs` sobe, a extração degrada, e a leitura de DPS cai a zero sem que o CI perceba.
- **Dependências**: nenhuma

### [testability-2] Extrair a decisão de saída do job `ler-dps-nfse` e testá-la

- **Problema**
  > A regra de exit code e o parse de `argv` vivem dentro de `main()`, sem teste. O alerta do cron depende dela.
- **Melhoria Proposta**
  > Mover a decisão para uma função pura exportada de uma classe (ex.: `DecisaoSaidaLeituraDps.codigo(r)` e `limiteDe(argv)`) com teste de tabela: `alvos=0`, todos `ERRO`, mistura, `lidos>0`; `argv` ausente, `0`, `-1`, `abc`, `10`.
- **Resultado Esperado**
  > Regra de alerta do cron pinada em teste.
- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - casos de teste da regra de saída do job: 0 → 8
  - lógica de decisão dentro de `main()`: 2 pontos → 0
- **Risco de não fazer**: o cron fica verde com 0 leituras quando o robô perde a permissão no GED.
- **Dependências**: nenhuma

### [testability-3] Gravar itens extraídos de PDFs reais como fixtures dos 4 layouts

- **Problema**
  > Os testes do leitor usam coordenadas escritas à mão. Os 4 layouts vistos ao vivo (incl. o municipal ajustado em `2d0f928` e o DACTE) não estão registrados como dado.
- **Melhoria Proposta**
  > Usar o script de validação (`validate-sispag-leitura-dps-v1.ts`) para despejar o `ItemPdf[]` anonimizado (só rótulos, números e posições; sem nome de pessoa/CNPJ) em `domain/service/sispag/__fixtures__/danfse-*.json` e um `it.each` em `LeituraDanfse.test.ts` com `{dps, nfse}` esperados (776132/86666, 25459, 775530, DACTE → sem DPS).
- **Resultado Esperado**
  > Cada layout novo observado ao vivo entra como caso de regressão antes do ajuste.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - layouts de DANFSe com fixture gravada: 0 → 4
  - casos `it.each` com layout real em `LeituraDanfse.test.ts`: 0 → 4
- **Risco de não fazer**: o próximo layout municipal só aparece como `SEM_DPS_NO_PDF` em produção.
- **Dependências**: testability-1 (opcional, para fixture em PDF em vez de JSON)

### [testability-4] Cobrir as falhas de download e extração e o `warn` no `LeitorDpsService`

- **Problema**
  > Só a falha de `priCodDoDocumento` está testada; `baixarArquivo`/`extrair` rejeitando e o log `warn` não têm asserção.
- **Melhoria Proposta**
  > Estender `montar()` com `downloadFalha`/`extratorFalha` e adicionar 3 casos: PDF corrompido (extrator rejeita), download em formato inesperado, `registrar` rejeitando. Assertar `expect(log.warn).toHaveBeenCalledWith(objectContaining({ message: 'falha ao ler o PDF da NFS-e no GED' }))` e o truncamento em 300 caracteres.
- **Resultado Esperado**
  > Os 4 pontos de I/O com resultado definido para erro, e a falha de um título nunca interrompe os outros.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - pontos de falha de I/O com teste: 1 de 4 → 4 de 4
  - asserções de `log.warn` em `LeitorDpsService.test.ts`: 0 → 1
- **Risco de não fazer**: um refator que tire o `await extrator` do `try` passa o CI e derruba o job por título.
- **Dependências**: nenhuma

## 6. Notas do agente

- Pontos fortes: motor, âncora, seleção e leitor são puros ou recebem tudo por construtor, com `Clock` injetado, e as duas descobertas só vistas ao vivo (`com298` RECORDNOTFOUND e download em base64) ficaram fixadas em teste no client.
- Sem Bash/Grep neste run: não consegui conferir `AncoraOrdemDps.ts` por `Date`/`Math.random` nem o `authenticatedGetBinary` em `services/conexos.ts` (adapter e `ConexosBaseClient.getBinary`); fica como não verificado.
- Cross-QA: testability-1 e testability-2 tocam Fault Tolerance (degradação silenciosa do cron) e Deployability (gate de CI para a extração).
