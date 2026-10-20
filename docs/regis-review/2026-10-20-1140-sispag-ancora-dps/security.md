---
qa: Security
qa_slug: security
run_id: 2026-10-20-1140
agent: qa-security
generated_at: 2026-10-20T12:00:00-03:00
scope: backend
score: 8.0
findings_count: 3
cards_count: 3
---

# Security — Regis-Review (delta sispag-ancora-dps, ADR-0073)

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Terceiro que controla um PDF anexado no GED do Conexos (fornecedor, ou erro de anexo) | O cron `ingest-sispag` baixa o PDF e o processa com `pdfjs-dist` no mesmo processo que tem `CONEXOS_PASSWORD` e `databaseConnectionString` | `ConexosGedClient.baixarArquivo`, `ExtratorTextoPdf`, `LeituraDanfse`, `LeitorDpsService`, `titulo_dps` | Produção, GitHub Actions 3x/dia, robô CLONEX, limite 40 títulos/execução | Leitor só lê o Conexos, limita a 5 páginas, desliga eval, valida o DPS como número puro e grava só o resultado; a analista continua confirmando | 0 escritas no Conexos; 0 conteúdo de PDF persistido ou logado; DPS fora de `^[0-9]{1,15}$` rejeitado pelo banco; PDF malicioso não derruba o job nem decide pagamento |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas de escrita ao Conexos no delta | 0 (`getGeneric`, `postGeneric` só de `list`/`psq014`, `getBinary`) | 0 | OK | `ConexosGedClient.ts:63,82,103,146`; `services/conexos.ts:494` (GET) |
| SQL novo parametrizado | 3/3 (`$nome`; sem interpolação) | 100% | OK | `TituloDpsRepository.ts:26,41,56` |
| Constraints no banco para dado vindo do PDF | `dps` ~ `^[0-9]{1,15}$`, status/fonte enum | presente | OK | `0087_sispag_titulo_dps.sql:33-39` |
| Conteúdo do PDF persistido/logado | 0 (só `arquivo` = nome, `motivo` ≤300 chars) | 0 | OK | `LeitorDpsService.ts:22,117`; migration:26-27 |
| `nfse` lida do PDF antes de persistir | `\d{1,15}` (regex ancorada) | validada | OK | `LeituraDanfse.ts:14,16` |
| Secrets no delta | 0 hardcoded; workflow usa `secrets.*` | 0 | OK | `ingest-sispag.yml:44-47` |
| `pdfjs-dist` | 4.10.38 fixada (sem `^`); `isEvalSupported:false`; CVE-2024-4367 (eval em fonte) corrigido a partir de 4.2.67 | >= fix | OK | `package.json:52`, `ExtratorTextoPdf.ts:27` |
| Teto de tamanho do download (bytes) | ausente (axios sem `maxContentLength`; `binNumSize` lido e ignorado) | presente | ⚠️ | `services/conexos.ts:497-501`, `ConexosGedClient.ts:130,150-153` |
| Teto de itens/tempo no parse do PDF | só 5 páginas; sem teto de itens por página nem timeout por título | presente | ⚠️ | `ExtratorTextoPdf.ts:34`, `LeituraDanfse.ts:55-77` |
| Cruzamento NFS-e do PDF x título obrigatório | não (só se o PDF traz NFS-e) | obrigatório para LIDO | ⚠️ | `LeitorDpsService.ts:155` |
| `npm audit` | não medido neste escopo | — | ⚠️ | fora do escopo reduzido |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta | N/A | — |
| Detect Service Denial | Falha de um título isolada; exit 1 só se tudo falhou; sem teto de bytes/tempo no parse | ⚠️ parcial | `ler-dps-nfse.ts:31`, F-security-1 |
| Verify Message Integrity | PDF terceiro; NFS-e conferida só quando presente; DPS só vira sinal, nunca sobe tier | ⚠️ parcial | F-security-2 |
| Detect Message Delay | N/A | N/A | — |
| Identify Actors | Robô CLONEX (existente); job sem ator humano | OK | `ingest-sispag.yml` |
| Authenticate Actors | Sessão Conexos existente, 401-retry só em GET | OK | `services/conexos.ts:494-509` |
| Authorize Actors | Leitura só; permissão do robô negada vira ERRO registrado, não abre nada | OK | `LeitorDpsService.ts:107-119` |
| Limit Access | Somente GET/list no `arq020`; upload/exclusão documentados como não tocados | OK | `ConexosGedClient.ts:38-44` |
| Limit Exposure | `isEvalSupported:false`, 5 páginas, sem worker, sem render; PDF só em memória | OK | `ExtratorTextoPdf.ts:23-31` |
| Encrypt Data | Inalterado | N/A | — |
| Separate Entities | Parse de PDF terceiro no mesmo processo com segredos do job | ⚠️ | F-security-3 |
| Change Default Settings | `isEvalSupported` default true trocado para false | OK | `ExtratorTextoPdf.ts:27` |
| Validate Input | Zod nas respostas do `arq020`; base64 validado como `%PDF-` só indiretamente (pdfjs rejeita lixo); CHECK no banco | OK com ressalva | `ConexosGedClient.ts:15-36,150-158` |
| Revoke Access | N/A | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | Falha gravada com motivo; passo de alerta do workflow cobre exit 1 | OK | `ingest-sispag.yml:84-94` |
| Restore | Tabela aditiva, DPS errado é sobrescrito na releitura | OK | `TituloDpsRepository.ts:61-70` |
| Audit Trail | `titulo_dps` guarda status, arquivo, motivo, tentativas, lido_em; sem trilha de que a âncora DPS influenciou a decisão (a decisão grava sinais) | OK parcial | migration:17-31 |

## 4. Findings

Nenhum P0. Verificado: sem escrita ao Conexos, SQL parametrizado, sem credencial logada (o interceptor de log do axios imprime `JSON.stringify(ArrayBuffer)` = `{}`, sem vazar bytes), `motivo` limitado a 300 chars e sem corpo de resposta, `nfse`/`dps` do PDF restritos a dígitos antes de chegar ao banco.

### F-security-1: Download e parse do PDF sem teto de bytes, itens ou tempo

- **Severidade**: P2
- **Tactic violada**: Detect Service Denial / Limit Exposure
- **Localização**: `services/conexos.ts:497-503`, `ConexosGedClient.ts:146-153`, `ExtratorTextoPdf.ts:25-35`, `LeituraDanfse.ts:55-77`
- **Evidência (objetiva)**:
  ```
  this.client.get<ArrayBuffer>(url, { headers, responseType: 'arraybuffer' })   // sem maxContentLength
  const base64 = JSON.parse(resposta.toString('utf8'));  Buffer.from(base64, 'base64')  // 3 cópias em memória
  pdfjs.getDocument({ data, isEvalSupported:false, ... }).promise  // 5 páginas só depois do parse do xref
  .filter(i => ... ).sort(...)   // por rótulo sem número: varre todos os itens (O(rótulos x itens))
  ```
- **Impacto técnico**: o GED aceita qualquer PDF anexado ao processo. Um arquivo de centenas de MB, uma bomba de descompressão (flate) ou uma página com milhões de trechos de texto consome memória e CPU do runner (7 GB) e trava o laço sequencial; o timeout do axios (40 s) cobre a rede, não o parse. O teto de 5 páginas só vale depois de abrir o documento. `binNumSize` (tamanho que o próprio Conexos informa na listagem) é lido em `arquivosDaPasta` e nunca usado.
- **Impacto de negócio**: no pior caso o job `ler-dps-nfse` estoura o `timeout-minutes: 20` e o passo de alerta dispara; ele roda por último, então carteira e formação de lotes não são afetadas. Sem perda de dado; só o desempate de boletos para de andar.
- **Métrica de baseline**: 0 tetos de bytes; 0 timeouts por título; 1 teto de páginas.

### F-security-2: O número lido do PDF de terceiro é aceito como LIDO sem confirmar que o PDF é daquele título

- **Severidade**: P2
- **Tactic violada**: Verify Message Integrity
- **Localização**: `LeitorDpsService.ts:155,172-189`
- **Evidência (objetiva)**:
  ```
  if (lido.nfse && nfseTitulo && digitos(lido.nfse) !== nfseTitulo) -> ERRO   // PDF sem "número da NFS-e" pula a checagem
  const [unico] = pdfs; if (pdfs.length === 1 && unico) return { arquivo: unico };  // PDF único da pasta, sem checar o nome
  ```
- **Impacto técnico**: um PDF sem rótulo "Número da NFS-e" (ou com o rótulo em layout que o leitor não acha) é gravado como `LIDO` com o DPS que trouxer, mesmo sendo de outra nota; o fallback de "único PDF da pasta" pode pegar o PDF errado. Quem controla o PDF (fornecedor ou erro de anexo) escolhe o `<DPS>000` e, portanto, qual boleto a âncora `DPS_IGUAL` reserva. Mitigações reais: não sobe tier, não alarga limite, a analista confirma (I15g) e o escopo (credor, emissor) tem de estar provado.
- **Impacto de negócio**: sugestão enganosamente "forte" aponta o boleto de outro título; a analista confirma achando que o sistema provou. Não há pagamento automático, mas a trilha atribui à âncora uma prova que não existiu.
- **Métrica de baseline**: 1 caminho para `LIDO` sem NFS-e do PDF; 1 fallback "único PDF".

### F-security-3: Parse de PDF de terceiro no processo que carrega as credenciais de produção

- **Severidade**: P3
- **Tactic violada**: Separate Entities / Limit Exposure
- **Localização**: `ingest-sispag.yml:42-47,70-71`, `package.json:52`
- **Evidência (objetiva)**:
  ```
  env (job inteiro): databaseConnectionString, CONEXOS_USERNAME, CONEXOS_PASSWORD
  - name: Leitura do DPS no GED ... run: npm run job:ler-dps-nfse   # pdfjs no mesmo processo
  ```
- **Impacto técnico**: uma futura vulnerabilidade de execução em `pdfjs-dist` (a última, CVE-2024-4367, foi eval em fonte) rodaria com a connection string do Postgres de produção e a senha do robô Conexos no `process.env`. Hoje o risco é baixo: versão fixada acima do fix, `isEvalSupported:false`, sem worker e sem render. Não há Dependabot/`npm audit` como gate para esta dependência nova (não medido aqui).
- **Impacto de negócio**: um PDF malicioso anexado por fornecedor viraria acesso ao banco e ao Conexos de produção; a probabilidade é baixa, o raio de dano é alto.
- **Métrica de baseline**: 1 dependência de parse de binário de terceiro; 0 gates de CVE específicos.

## 5. Cards Kanban

### [security-1] Limitar bytes, itens e tempo na leitura do PDF do GED

- **Problema**
  > O download do GED e o parse do `pdfjs` não têm teto de tamanho nem de tempo. Um anexo gigante ou malformado no processo trava o job e consome a memória do runner. O `binNumSize` da listagem já informa o tamanho e é ignorado.
- **Melhoria Proposta**
  > (1) Recusar antes de baixar quando `tamanho` > 5 MB (valor sugerido) com `SEM_PDF`/motivo "arquivo grande demais"; (2) `maxContentLength`/`maxBodyLength` no `authenticatedGetBinary`; (3) teto de itens (ex.: 5 mil) em `ExtratorTextoPdf` e `Promise.race` com timeout de 20 s por título em `lerComSeguranca`, que vira `ERRO` com motivo; (4) teste unitário de cada teto.
- **Resultado Esperado**
  > PDF acima do teto vira tentativa registrada e o job termina no tempo previsto. Execuções do job estouradas por arquivo único: indeterminado -> 0.
- **Tactic alvo**: Detect Service Denial
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Tetos de bytes/itens/tempo no leitor: 0 -> 3
- **Risco de não fazer**: um anexo errado no GED derruba o desempate de DPS sem aviso claro, até o alerta de 20 min.
- **Dependências**: nenhuma

### [security-2] Exigir a NFS-e do PDF igual à do título para gravar LIDO

- **Problema**
  > O DPS é gravado como `LIDO` mesmo quando o PDF não traz o número da NFS-e para conferência, e o fallback "único PDF da pasta" não confere nada. O conteúdo do PDF de terceiro orienta a âncora de sugestão sem a prova de que o arquivo é daquele título.
- **Melhoria Proposta**
  > Em `LeitorDpsService.ler`: se `lido.nfse` ausente (ou `nfseTitulo` ausente) com `lido.dps` presente, gravar `SEM_DPS_NO_PDF`/`ERRO` com motivo "PDF sem NFS-e para conferir" em vez de `LIDO`; quando o PDF foi escolhido pelo fallback "único", exigir o casamento da NFS-e. Teste: PDF sem NFS-e e com DPS não vira LIDO.
- **Resultado Esperado**
  > Todo `LIDO` tem NFS-e do PDF == NFS-e do título. Caminhos para `LIDO` sem conferência: 1 -> 0.
- **Tactic alvo**: Verify Message Integrity
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - `LIDO` sem NFS-e conferida: possível -> 0 (consulta `titulo_dps WHERE status='LIDO'` com `nfse` nulo)
- **Risco de não fazer**: sugestão com âncora errada passa pela analista como se tivesse prova; efeito limitado à sugestão, não ao pagamento.
- **Dependências**: pode alterar o número de títulos `LIDO` de PRD (validar com a medição ao vivo)

### [security-3] Isolar o parse de PDF das credenciais e vigiar a dependência

- **Problema**
  > O `pdfjs` roda no mesmo processo e step do job que tem a senha do Conexos e a connection string de produção no ambiente. Não há gate de CVE para a dependência nova.
- **Melhoria Proposta**
  > Ativar Dependabot/`npm audit --omit=dev --audit-level=high` no CI cobrindo `pdfjs-dist`; manter a versão fixada e atualizar em PR; avaliar separar a extração em um subprocesso `child_process` sem `CONEXOS_*` nem `databaseConnectionString` (recebe bytes por stdin, devolve itens em JSON).
- **Resultado Esperado**
  > Vulnerabilidade de `pdfjs` não alcança segredos de produção; CVE novo aparece em PR em vez de passar despercebido.
- **Tactic alvo**: Separate Entities
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Segredos acessíveis ao código que parseia PDF: 2 -> 0
- **Risco de não fazer**: baixa probabilidade; se ocorrer, um PDF de fornecedor leva ao banco e ao Conexos de produção.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo reduzido ao delta; sem `npm audit`, sem IAM/SSM (não existe `infra/`). Não rodei testes nem comandos de shell.
- Garantia somente-leitura confirmada por inspeção: o delta usa `getGeneric`, `postGeneric` (apenas `arq020/TelaDocumento/list` e `list`, que são consultas) e `getBinary`. Atenção: `arq020/TelaDocumento/list` é POST de consulta; o `ConexosGedClient` não expõe nenhum método de upload/exclusão, mas nada impede que `base.postGeneric` seja usado assim no futuro (teste de contrato listando os paths seria útil, hoje não existe).
- Cross-QA: F-security-1 com Fault Tolerance (limite e timeout por título); F-security-2 com Integrability (contrato do PDF) e Testability (parte validada só ao vivo); F-security-3 com Deployability (gate de CVE no CI).
