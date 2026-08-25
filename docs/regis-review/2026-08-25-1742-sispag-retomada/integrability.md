---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-integrability
generated_at: 2026-08-25T14:49:00-03:00
scope: backend
score: 5
findings_count: 10
cards_count: 8
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta SISPAG retomada)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP (fornecedor externo, sem contrato versionado; superfície = `fin015`, `fin052`, `fin050`, `fin005`, `cmn025`, `ger015`, `fin010`, `fin064`) | Comportamento do endpoint diverge de uma suposição codificada (ex.: `titulosPendentes/importar` só aceita 1 item; `fin015/list` ignora filCod do header; `titulosCount` é booleano; ERP responde `QUESTION` em vez de erro) | Clientes SISPAG (`ConexosSispagClient`, `ConexosSispagWriteClient`, `ConexosSispagRetornoClient`) + serviços que dependem deles (`RemessaService`, `ConciliacaoRetornoService`) | Escrita ao vivo em HML/PRD com dados reais da tesouraria | O código deve (i) validar a suposição no boundary via contrato reproduzível, (ii) tratar o `QUESTION` como fluxo de negócio (não erro genérico), (iii) surfacar a divergência antes do lote sair. Adicionar novo endpoint ou trocar um existente deve custar apenas o cliente + fixture + contrato — sem cascatear em serviço | ≥ 80% dos endpoints em uso com fixture-contrato; 0 endpoints com `filCod` só em `opts` sem prova de filtro server-side; 0 escritas ignorando `QUESTION`; onboarding de novo endpoint ≤ 1 dia (fixture + 1 método + 1 teste de contrato) |

> Contexto: o próprio delta em auditoria descobriu AO VIVO cinco suposições falsas sobre o
> Conexos. A pergunta desta lente é onde mais o código ainda supõe sem evidência — nas
> chamadas que a retomada não exercitou.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC dos clientes SISPAG (Write + Retorno + read-only) | 1.449 | ≤ 1.200 (indicativo) | ⚠️ | `wc -l src/backend/domain/client/ConexosSispag{Client,WriteClient,RetornoClient}.ts` |
| Métodos públicos por cliente (Write / Retorno / Sispag) | 12 / 9 / 8 | ≤ 10 | ⚠️ | `grep -c "public "` |
| Endpoints do Conexos exercitados no delta | 17 (fin015, fin015/list, fin015/{fil}/{bnc}/{flp}, fin015/finItemSispag/list, fin015/finItemSispag/titulosPendentes/list, fin015/finItemSispag/titulosPendentes/importar, fin015/finalizarLote, fin015/gerArquivosBancos/initialValues, fin015/gerArquivosBancos/gerarRemessa, fin015/gerArquivosBancos/list, fin015/gerArquivosBancos/download, fin064/list, fin005/list, fin050/list, ger015/list, fin052/arquivosRetorno/list, fin052/arquivosRetornoDetalhe/list, fin052/arquivosRetorno/erro/list, fin052/arquivosRetorno/processar, fin052/arquivosRetorno/carregar, cmn025/ctcorr/list, com298/list, fin010/list) | — | — | grep manual em `src/backend/domain/client/ConexosSispag*.ts` |
| Endpoints com fixture-contrato assinado | 6 / 17 = 35% | ≥ 80% | ❌ | `ls src/backend/domain/interface/sispag/__fixtures__/*.json` + `contrato.test.ts` |
| Endpoints de LEITURA cuja filial é passada SÓ via `opts` (header `cnx-filcod`) e NÃO via `filCod#EQ` no `filterList` | 10 (fin064/list, fin005/list, cmn025/ctcorr/list, com298/list, fin010/list, fin052/arquivosRetorno/list, fin052/arquivosRetornoDetalhe/list, fin052/arquivosRetorno/erro/list, fin050/list, ger015/list) | 0 ou "provado por probe read-only que o header filtra" | ❌ | `grep -n "filterList" src/backend/domain/client/ConexosSispag*.ts` + `src/backend/services/conexos.ts:510` (defaultHeaders) |
| Endpoints de ESCRITA que aceitam o protocolo `QUESTION` do Conexos (`{type:'QUESTION',...}`) e o traduzem para `ErpPerguntaError` | 1 / 5 (`sugerirRemessa` — read; escrita real que documenta a possibilidade, `importarTitulos`, NÃO trata) | 5 / 5 (todas as escritas do fin015 + fin052) | ❌ | `grep -n "perguntaDoErp\|QUESTION" src/backend/domain/client/ConexosSispag{Write,Retorno}Client.ts` |
| Payload `items[N]` com N > 1 comprovado ao vivo em algum endpoint | 0 (`titulosPendentes/importar` foi provado aceitar N=1; `arquivosRetorno/processar` nunca foi testado com N>1) | 100% dos endpoints com `items[]` no shape ou documentação explícita da restrição | ❌ | `ConexosSispagWriteClient.ts:442-448` (defesa 1-a-1); `ConexosSispagRetornoClient.ts:153-165` (`items: [{...}]` sem defesa) |
| Duplicação de `describeConexosValidation` entre clientes SISPAG | 100% (25 linhas idênticas em Write + Retorno; `ConexosFin014Client`, `ConexosBaixaClient` e outros repetem versões similares) | 0 (helper compartilhado — `ErpResponseReader` já existe em `src/backend/domain/errors/`) | ❌ | `ConexosSispagWriteClient.ts:70-94` vs `ConexosSispagRetornoClient.ts:53-76`; `ls src/backend/domain/errors/ErpResponseReader.ts` |
| Uso de `#EQ` explícito nos filtros do Conexos (defesa contra drift do protocolo Conexos) | 12 / 13 chaves em filterList — 1 divergência: `listarArquivosRemessa` usa `{ bncCod, flpCod }` sem sufixo | 13 / 13 (`#EQ` sempre) | ⚠️ | `ConexosSispagWriteClient.ts:589` |
| Contract test do QUESTION protocol (`{type:'QUESTION'}`) | 0 fixtures capturadas | ≥ 1 fixture recodada de resposta QUESTION real do ERP | ❌ | inexistente em `src/backend/domain/interface/sispag/__fixtures__/` |
| Versionamento explícito da API Conexos | ausente (URLs sem `/v1/`; o único ancorador é o SHA do behaviour recodado em `__fixtures__/2026-08-24-*.json`) | headers `cnx-*` ou fixture datada + release-notes de cada mudança do ERP | ⚠️ | `grep -n "/v[0-9]" src/backend/domain/client/ConexosSispag*.ts` (nenhum match) |

⚠️ **Não medível localmente**: (a) taxa real de resposta `QUESTION` do ERP em PRD;
(b) drift semântico entre HML e PRD (sonda `probe-fin064-destino.ts` já mediu 561 títulos
com 0% de destino em HML e nunca rodou em PRD). Recomendação: cron read-only mensal em
PRD comparando com o snapshot de fixture; alerta se algum campo do CONTRATO desaparecer.

## 3. Tactics — Cobertura no delta SISPAG retomada

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Cada família de endpoints do Conexos tem um cliente dedicado (`ConexosSispagClient`, `ConexosSispagWriteClient`, `ConexosSispagRetornoClient`), com métodos de negócio (`gerarRemessa`, `listarChavesDoLote`), sem vazar `axios`/`fetch` para o serviço. | ✅ presente | `src/backend/domain/client/ConexosSispag*.ts` — nenhum `axios.get`/`fetch(` exposto ao service |
| Use an Intermediary | `ConexosBaseClient` intermedia auth+retry+header multi-filial; `LegacyConexosAdapter` intermedia a superfície HTTP crua. | ✅ presente | `src/backend/domain/client/ConexosBaseClient.ts`; `legacyConexosAdapter.ts` |
| Restrict Communication Paths | Serviço → Client → Base → HTTP; caminho único. Nenhum serviço fala HTTP direto. | ✅ presente | `src/backend/domain/service/sispag/*.ts` — `container.resolve(ConexosSispag*Client)` |
| Adhere to Standards | Protocolo Conexos (`fieldList`/`filterList`/`serviceName`/`#EQ`) é seguido consistentemente — exceto `listarArquivosRemessa` (F-integrability-9) que usa filtros sem `#EQ`. | ⚠️ parcial | `ConexosSispagWriteClient.ts:589` |
| Abstract Common Services | `describeConexosValidation` está DUPLICADO integralmente entre Write e Retorno (mesmo nomes de campo, mesmo shape). `ErpResponseReader` já existe em `src/backend/domain/errors/` e não é usado. | ❌ ausente | `ConexosSispagWriteClient.ts:70-94` ↔ `ConexosSispagRetornoClient.ts:53-76`; `src/backend/domain/errors/ErpResponseReader.ts` |
| Discover Service | Endpoints, códigos internos (bncCod, ccoCod) e configurações (gtbCodSeq de `ger015`) são descobertos via chamadas ao próprio ERP em runtime (`listConfigsRetorno`, `listContasCorrentes`). Não há hard-code de códigos internos de banco além do mapa FEBRABAN. | ✅ presente | `RemessaService.ts:249-256` (contas via runtime); `ConexosSispagRetornoClient.listConfigsRetorno` |
| Tailor Interface | O ERP tem 2 formatos de erro (`VALIDATION_LIST` vs `VALIDATION`) e 1 formato de "pergunta" (`QUESTION`). O código tem 2 dos 3: adaptação de erro OK, tratamento de QUESTION só em `sugerirRemessa`. | ⚠️ parcial | `ConexosSispagWriteClient.ts:465` (`perguntaDoErp`) chamado só em `sugerirRemessa` — não em `importarTitulos` onde a docstring explicitamente prevê QUESTION |
| Configure Behavior | Kill-switches por frente: `sispagLiveWriteEnabled` isola SISPAG do `conexosDryRun` global. Retomada tem `dryRunOverride` e `confirmarNovoLote`. | ✅ presente | `RemessaService.ts:114-118`; `ConciliacaoRetornoService.ts:104-110` |
| Manage Resources | `BoundedConcurrency` limita fan-out a 4 (`CONEXOS_FANOUT_LIMIT`) — protege pool de sessões do ERP (`LOGIN_ERROR_MAX_SESSIONS`). | ✅ presente | `ConciliacaoRetornoService.ts:44-45,244-253` |
| Orchestrate | `RemessaService.gerarRemessa` orquestra 6 chamadas ao ERP (marca d'água → criarLote → importar (loop) → finalizar → sugerirRemessa → gerarRemessa → listarArquivosRemessa) com write-ahead ledger. `ConciliacaoRetornoService.conciliar` orquestra processar → varredura por evento → transição de lote. | ✅ presente (mas hotspot: cascata longa — ver F-integrability-8) | `RemessaService.ts:294-491` (870 LOC no service, 8 dependências injetadas) |
| Manage Resource Coupling | `RemessaService` depende de 6 classes injetadas; `ConciliacaoRetornoService` depende de 6. Alto — replicar/trocar um cliente cascateia. | ⚠️ parcial | `RemessaService.ts:87-95` e `ConciliacaoRetornoService.ts:89-96` |
| Contract testing | Fixture-based contract test existe (`contrato.test.ts`) e cobre 6 endpoints em uso — mas 10+ endpoints do delta ficaram sem contrato. A técnica é boa; a cobertura é insuficiente. | ⚠️ parcial | `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts` |
| Versioning strategy | Nenhum versionamento (URL sem `/v1/`, sem `api-version` header). O único registro-histórico de mudança do ERP é o timestamp no nome do fixture (`2026-08-24-*.json`). | ❌ ausente | `grep "/v[0-9]" src/backend/domain/client/ConexosSispag*.ts` → 0 matches |
| Backward-compatibility shims | Zod usa `.catch()`/`.optional()` para tolerar campos ausentes; `preprocess` desembrulha `.data` embrulhado. É defesa parcial. | ⚠️ parcial | `ConexosSispagWriteClient.ts:21-32` (LOTE_CRIADO_SCHEMA) |
| Observability of integration failures | `LogService` registra `CONEXOS_ERROR` por chamada falha; `varreduraIncompleta` propaga para o painel. Não há métrica agregada por endpoint (contador de 400/500/QUESTION). | ⚠️ parcial | `ConciliacaoRetornoService.ts:271-278`; sem Prometheus/CloudWatch metric namespace `conexos.endpoint.errors` |

## 4. Findings

### F-integrability-1: `importarTitulos` documenta o protocolo `QUESTION` mas engole a pergunta em `ConexosError` genérico

- **Severidade**: P0 (crítico — o cenário exato citado na docstring, "favorecido sem conta ativa no banco do lote", vai chegar em produção assim que a Columbia rodar um lote real com um credor novo; hoje o usuário vê "Not Found" ou uma mensagem de validação genérica em vez do YES/ABORT que o ERP quer negociar)
- **Tactic violada**: Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:417-459` (docstring de `importarTitulos` prevê QUESTION; o catch no L455-457 apenas embrulha em `ConexosError`); `perguntaDoErp` em L465-479 usada somente em `sugerirRemessa` L508-511.
- **Evidência (objetiva)**:
  ```
  L417-421 (docstring de importarTitulos):
    ⚠️ O ERP pode responder `{ type: 'QUESTION', answerList: [YES, ABORT] }` (ex.:
    favorecido sem conta ativa no banco do lote,
    FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO)

  L455-457 (catch real):
    } catch (cause) {
        throw this.toConexosError(path, cause);
    }
  ```
- **Impacto técnico**: `RemessaService.gerarRemessa` transforma o QUESTION em `ConexosError`, o lote fica em `error` no ledger, retomada bate no fluxo normal e falha de novo pelo mesmo motivo — loop até intervenção humana. `criarLote`, `finalizarLote`, `gerarRemessa`, `processarArquivoRetorno` e `carregarArquivoRetorno` têm o mesmo defeito.
- **Impacto de negócio**: primeira falha de negócio interativa do ERP em produção vira "sistema quebrou" em vez de "o ERP está pedindo confirmação". Cria retrabalho manual na tesouraria e mina a confiança na retomada automática recém-entregue.
- **Métrica de baseline**: 1 de 5 escritas ativas trata QUESTION (20%); alvo 100%.

### F-integrability-2: 10 endpoints de leitura ainda dependem de `cnx-filcod` para filtrar dados sem prova ao vivo — mesmo padrão que quebrou o `fin015/list`

- **Severidade**: P1 (o mecanismo de bug JÁ FOI OBSERVADO ao vivo neste delta em `fin015/list`; o mesmo shape aparece em 10 outros endpoints, sem contra-prova. A gravidade em cada endpoint depende do que a leitura alimenta — a maioria hoje é apresentação, mas `fin005/list` alimenta a escolha da conta pagadora do `.REM` e é P0 se contaminado — ver F-integrability-3.)
- **Tactic violada**: Adhere to Standards; Discover Service
- **Localização**: `ConexosSispagClient.ts:191-208` (fin064), `260-282` (fin005), `285-306` (cmn025/ctcorr), `328-344` (com298), `384-406` (fin010); `ConexosSispagRetornoClient.ts:95-115` (fin052 lista), `260-291` (fin052 detalhe), `318-338` (fin052 erros), `341-368` (fin050), `354-380` (ger015).
- **Evidência (objetiva)**:
  ```
  src/backend/services/conexos.ts:510-533 — defaultHeaders(filCod) apenas seta o header
    'cnx-filcod': String(resolved)
  — NÃO é filtro server-side.

  ConexosSispagClient.ts:355 (fin015 comment, retratado no delta):
    * `filCod#EQ` é OBRIGATÓRIO: o `filCod` de `opts` é o contexto da sessão, não um filtro.
    * Sem ele o ERP devolve lotes de TODAS as filiais (medido: 74 linhas das filiais 1, 2 e 7).

  Os 10 endpoints acima seguem esse mesmo padrão SEM a mesma prova.
  ```
- **Impacto técnico**: cross-filial silencioso — cada endpoint carrega ambiguidade que só aparece quando 2 filiais têm registros com o mesmo `docCod` (comprovado em HML: docCod 285 na fil 2 E na fil 4). Em `listContasFavorecido` (cmn025) e `listExteriorDocCods` (com298) o efeito é imprevisível; em `listContasCorrentes` (fin005) é dinheiro saindo da conta errada (F-integrability-3).
- **Impacto de negócio**: cada endpoint auditado no delta que ainda vive de suposição é uma bomba-relógio integrabilidade: adicionar uma segunda filial-cliente (multi-tenant produtizado) transforma cada um em incidente.
- **Métrica de baseline**: 10 / 10 endpoints de leitura no delta sem `filCod#EQ` em `filterList`; alvo 0 ou "provado read-only que o header filtra".

### F-integrability-3: `RemessaService` escolhe `contas[0]` de `fin005/list` como fallback — pode ser conta de outra filial

- **Severidade**: P0 (o `.REM` gerado sairia com `bncCod`/`ccoCod`/`agencia`/`numeroConta` de uma conta pagadora de outra filial. O CNAB é enviado ao banco tal e qual. É dinheiro debitado da conta errada, com trilha contábil pertencente ao lote errado.)
- **Tactic violada**: Adhere to Standards; Restrict Communication Paths (o serviço confia numa invariante que o cliente não garante)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:249-267`; `ConexosSispagClient.ts:262-282`.
- **Evidência (objetiva)**:
  ```
  ConexosSispagClient.listContasCorrentes (L262):
    listGenericPaginated('fin005/list', this.listBody('fin005', {}, 100), { filCod })
    → filterList VAZIO; filCod apenas em opts (=header cnx-filcod).

  RemessaService.gerarRemessa (L249-254):
    const contas = await this.sispag.listContasCorrentes(lote.filCod);
    const cc = lote.conta
      ? contas.find((c) => `${c.numeroConta}-${c.dvConta ?? ''}` === lote.conta)
      : undefined;
    const escolhida = cc ?? contas[0];    // ← sem lote.conta, aceita a primeira
  ```
- **Impacto técnico**: se `fin005/list` se comportar como `fin015/list` (o único que sabemos, medido, que ignora o header como filtro), `contas[0]` pode ser da filial 1 quando o lote é da filial 2 — a conta acaba populada em `escolhida` e vai VERBATIM para o `.REM` no `criarLote`, `sugerirRemessa` e `gerarRemessa`.
- **Impacto de negócio**: dinheiro debitado da conta errada. Só descobre-se via extrato bancário; o `.RET` não reclama porque o segmento A carrega `filCod+bncCod+flpCod+itsCodSeq` embutido no "uso da empresa" e concilia. Reversão bancária lenta e cara.
- **Métrica de baseline**: 1 caminho crítico do serviço confia em ordem de retorno de um endpoint com filtro não-provado. Alvo: 0.

### F-integrability-4: `processarArquivoRetorno` e `carregarArquivoRetorno` também não tratam `QUESTION` (e um deles nunca rodou ao vivo)

- **Severidade**: P1 (menor probabilidade de trigger que F-integrability-1 porque os body-shapes ainda não desafiam validações interativas — mas `carregarArquivoRetorno` a própria docstring admite: "ainda NÃO validada em HML")
- **Tactic violada**: Tailor Interface; Discover Service (não sabemos porque nunca perguntamos ao vivo)
- **Localização**: `ConexosSispagRetornoClient.ts:143-166` (processar); `ConexosSispagRetornoClient.ts:388-408` (carregar).
- **Evidência (objetiva)**:
  ```
  L166: throw this.toConexosError(path, cause);            // processar — não checa QUESTION
  L403-406: try { … } catch (cause) {
              throw this.toConexosError(path, cause);      // carregar — idem
            }
  L379: ⚠️ ainda NÃO validada em HML (precisa de um `.RET` real)
  ```
- **Impacto técnico**: mesmo modo de falha do F-integrability-1 na perna de retorno, agravado por `carregarArquivoRetorno` não ter fixture nem ground-truth ao vivo. Se o ERP recusar por checksum, duplicidade de arquivo ou pergunta interativa, a mensagem de negócio é perdida.
- **Impacto de negócio**: conciliação da 1ª remessa real depende do `.RET` — e ela ainda não passou por um "caminho não-feliz" com dados reais.
- **Métrica de baseline**: 2 escritas da perna de retorno sem tratamento de QUESTION; 1 escrita nunca exercitada ao vivo. Alvo: 0 / 0.

### F-integrability-5: `arquivosRetorno/processar` envia `items: [{...}]` sem prova de que N > 1 seja aceito — mesmo padrão que quebrou `titulosPendentes/importar`

- **Severidade**: P1 (hoje só é chamado com 1 item; um refactor futuro que assumir "plural aceita lote" reproduz o bug que este delta acabou de corrigir na frente da escrita)
- **Tactic violada**: Contract testing; Discover Service
- **Localização**: `ConexosSispagRetornoClient.ts:153-165`
- **Evidência (objetiva)**:
  ```
  await this.base.putGenericOnce<unknown>(
    path,
    { items: [{ filCod, bncCod, gtbCodSeq, garCodSeq, tipo }] },   // sempre N=1
    { filCod },
  );
  ```
  Nenhum comentário, teste ou fixture prova que N>1 funciona. O nome `items` (plural) sugere lote, exatamente como `titulosPendentes/importar` sugeria antes de HML provar N=1.
- **Impacto técnico**: refactor de "conciliar todos os retornos do dia" que empacote N arquivos num `items[]` pode processar só o primeiro e reportar sucesso.
- **Impacto de negócio**: cada arquivo `.RET` não-processado é um dia de baixa perdida — reconciliação contábil quebrada até intervenção manual.
- **Métrica de baseline**: 0 / 2 endpoints com `items[]` no delta têm evidência ao vivo de aceitar N > 1. Alvo: prova documentada (fixture ou probe) para cada.

### F-integrability-6: fixtures cobrem 6 de ~17 endpoints do delta — 3 endpoints da perna de retorno (críticos) ficaram sem contrato

- **Severidade**: P1 (quando o Conexos renomear um campo do `arquivosRetornoDetalhe` — ex.: `fbeVldTpret`, que decide pagamento vs. rejeição — descobrimos pelo botão da analista, não pelo `npm test`)
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/` — presentes: fin005-conta-pagadora, fin015-lote, fin015-titulo-pendente, fin050-evento-bancario, fin064-titulo-a-pagar, ger015-config-retorno. Ausentes: fin052/arquivosRetorno/list, fin052/arquivosRetornoDetalhe/list, fin052/arquivosRetorno/erro/list, fin015/finItemSispag/list, fin015/finItemSispag/titulosPendentes/list, fin015/gerArquivosBancos/list, fin015/gerArquivosBancos/initialValues, `POST /fin015` (resposta de criarLote), cmn025/ctcorr/list, com298/list, fin010/list.
- **Evidência (objetiva)**:
  ```
  ls src/backend/domain/interface/sispag/__fixtures__/*.json
  → 6 arquivos.

  contrato.test.ts (L28-92): 6 CONTRATOS declarados;
  o teste "todo fixture no diretório está coberto por um contrato" (L120-129)
  só protege o inverso — fixture órfão. Endpoint órfão (usado no código, sem fixture)
  não é detectado.
  ```
- **Impacto técnico**: 11 endpoints usados em produção com identidade de campo sustentada por convenção. Um rename silencioso do ERP não quebra teste — quebra a analista.
- **Impacto de negócio**: `fbeVldTpret` desaparecer sem quebrar o `contrato.test.ts` transforma rejeição em pagamento na conciliação (o `ConciliacaoRetornoService` diz textualmente: "Perder este campo faria toda rejeição virar pagamento").
- **Métrica de baseline**: 6 / 17 = 35% de cobertura de contrato; alvo ≥ 80% (13 / 17).

### F-integrability-7: `describeConexosValidation` está duplicado 100% entre `ConexosSispagWriteClient` e `ConexosSispagRetornoClient` (e `ErpResponseReader` já existe, mas ninguém usa)

- **Severidade**: P2 (débito técnico bem defendido — a próxima família de escrita do Conexos vai duplicar de novo)
- **Tactic violada**: Abstract Common Services
- **Localização**: `ConexosSispagWriteClient.ts:70-94` ↔ `ConexosSispagRetornoClient.ts:53-76`; `src/backend/domain/errors/ErpResponseReader.ts` existe e não é importado por nenhum cliente SISPAG.
- **Evidência (objetiva)**:
  ```
  diff -u src/backend/domain/client/ConexosSispagWriteClient.ts \
          src/backend/domain/client/ConexosSispagRetornoClient.ts \
    | grep -E "^[+-]" | grep -c "describeConexosValidation\|itemMessages\|vars"
  → método idêntico, ~25 linhas.

  grep -rn "ErpResponseReader" src/backend/domain/client/
  → 0 matches.
  ```
- **Impacto técnico**: quando o ERP mudar o shape do erro (ex.: adicionar `errorId`), a alteração precisa ser feita em N clientes; algum vai esquecer e vai ter erro pior que o original.
- **Impacto de negócio**: cada nova frente de escrita ao Conexos (o roadmap tem baixa manual, conciliação por extrato, permutas) paga o mesmo custo.
- **Métrica de baseline**: 2 cópias no delta, 25 LOC cada; alvo 1 helper em `ErpResponseReader` (ou substituto).

### F-integrability-8: `RemessaService` orquestra ≥ 8 chamadas ao ERP em série numa sessão HTTP — trocar 1 cliente cascateia

- **Severidade**: P2 (o hotspot está isolado num único serviço — não é infra transversal — mas 870 LOC concentrados em `RemessaService.ts`, com 6 dependências injetadas e sequência de write-ahead → criarLote → import (loop 1-por-item) → finalizar → sugerirRemessa → gerarRemessa → listarArquivosRemessa + retomada, é o exato "orquestrador sincrono com > 3 colaboradores" da metodologia)
- **Tactic violada**: Manage Resource Coupling; Orchestrate (choreography via evento seria alternativa, mas custosa)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` (870 LOC, 6 injects, 8+ chamadas encadeadas por transação HTTP)
- **Evidência (objetiva)**:
  ```
  wc -l src/backend/domain/service/sispag/RemessaService.ts
  → 870

  grep -c "await this.write\.\|await this.sispag\.\|await this.ledger\.\|await this.loteRepo\." \
       src/backend/domain/service/sispag/RemessaService.ts
  → 30+ chamadas
  ```
- **Impacto técnico**: trocar `ConexosSispagWriteClient` (upgrade do fin015, migração para nova superfície do ERP) exige reeditar caminhos em `RemessaService` — a interface do Write não abstrai o suficiente para o serviço não conhecer a ordem exata dos passos.
- **Impacto de negócio**: quando o Conexos publicar uma tela nova (fin016?), o custo de migração é proporcional ao número de callers da sequência velha — não ao tamanho da mudança.
- **Métrica de baseline**: 1 orquestrador com 8+ passos síncronos e 6 dependências injetadas; alvo ≤ 5 passos por método público.

### F-integrability-9: `listarArquivosRemessa` usa `filterList: { bncCod, flpCod }` sem `#EQ` — única divergência do padrão do delta

- **Severidade**: P2 (funciona hoje porque o Conexos deve default para `#EQ` na ausência do sufixo — mas essa suposição não está documentada em lugar nenhum; se o ERP passar a exigir explicit, o único caminho de download da remessa quebra em silêncio)
- **Tactic violada**: Adhere to Standards
- **Localização**: `ConexosSispagWriteClient.ts:585-598`
- **Evidência (objetiva)**:
  ```
  filterList: { bncCod, flpCod },   // sem #EQ, diferente de todos os outros 12 filtros do delta
  ```
- **Impacto técnico**: quebra silenciosa (grid vazio → erro "arquivo não encontrado entre 0 do lote") num upgrade de protocolo do Conexos.
- **Impacto de negócio**: analista clica "baixar .REM" e recebe erro genérico; a remessa existe no ERP mas não chega ao banco pelo nosso caminho.
- **Métrica de baseline**: 12 / 13 filtros do delta usam `#EQ` explícito; alvo 13 / 13.

### F-integrability-10: nenhuma estratégia de versionamento com o Conexos — o único âncora de "quando isso funcionava" é o timestamp no nome do fixture

- **Severidade**: P2
- **Tactic violada**: Versioning strategy (facet moderno de Bass)
- **Localização**: transversal — nenhum path de cliente contém `/v[0-9]`; nenhum header `x-api-version` é enviado.
- **Evidência (objetiva)**:
  ```
  grep -rn "/v[0-9]\|api-version\|apiVersion" src/backend/domain/client/ConexosSispag*.ts
  → 0 matches.

  ls src/backend/domain/interface/sispag/__fixtures__/2026-08-24-*.json
  → 6 (única evidência histórica).
  ```
- **Impacto técnico**: quando o Conexos publicar uma versão nova, não temos como manter a antiga e migrar por endpoint — a integração é all-or-nothing.
- **Impacto de negócio**: janela de upgrade do ERP paralisa a Columbia (sem shim de compat).
- **Métrica de baseline**: 0 endpoints versionados; alvo: fixture datada + release notes por mudança conhecida, cliente com shim configurável.

## 5. Cards Kanban

### [integrability-1] Tratar `QUESTION` em todas as escritas SISPAG (fin015 + fin052), não só em `sugerirRemessa`

- **Problema**
  > O ERP Conexos responde `{ type: 'QUESTION', questions: [{ key, answerList: [YES, ABORT] }] }` em vez de erro em cenários interativos (favorecido sem conta ativa no banco do lote é o mais provável em produção). Hoje só `sugerirRemessa` (uma LEITURA) trata o shape via `perguntaDoErp`; `importarTitulos`, `criarLote`, `finalizarLote`, `gerarRemessa`, `processarArquivoRetorno` e `carregarArquivoRetorno` catcham tudo em `ConexosError` genérico — apesar da docstring de `importarTitulos` mencionar explicitamente esse caso.

- **Melhoria Proposta**
  > (a) Extrair `perguntaDoErp` para `ErpResponseReader` (que já existe). (b) Aplicar em TODAS as 5 escritas SISPAG. (c) Tratar `ErpPerguntaError` em `RemessaService` e `ConciliacaoRetornoService` como estado de negócio ("aguardando confirmação") em vez de `error` no ledger. (d) Capturar 1 fixture de QUESTION reproduzido AO VIVO (o cenário FIN_041 é o mais fácil de gerar).

- **Resultado Esperado**
  > Uma pergunta interativa do ERP chega ao usuário como "confirmação necessária" (com o texto da pergunta), não como "sistema quebrou". Retomada sabe distinguir "falha técnica" de "aguardando decisão humana".

- **Tactic alvo**: Tailor Interface
- **Severidade**: P0
- **Esforço estimado**: M (2-5d — inclui capturar fixture ao vivo)
- **Findings relacionados**: F-integrability-1, F-integrability-4
- **Métricas de sucesso**:
  - Escritas SISPAG que tratam QUESTION: 1 / 5 → 5 / 5
  - Fixture de QUESTION assinada: 0 → 1
- **Risco de não fazer**: 1º cliente-piloto sem conta cadastrada no banco do lote transforma a retomada recém-entregue em "sistema não funciona" na percepção da tesouraria.
- **Dependências**: nenhuma

### [integrability-2] Auditar filial-filter em cada endpoint do delta com probe read-only de 30 min

- **Problema**
  > `fin015/list` foi provado no delta como NÃO filtrar por `cnx-filcod`. 10 outros endpoints (`fin064/list`, `fin005/list`, `cmn025/ctcorr/list`, `com298/list`, `fin010/list`, `fin052/arquivosRetorno/list`, `fin052/arquivosRetornoDetalhe/list`, `fin052/arquivosRetorno/erro/list`, `fin050/list`, `ger015/list`) seguem o mesmo padrão sem contra-prova.

- **Melhoria Proposta**
  > Um único job `probe-filcod-filter-hml.ts` chamando cada endpoint com `opts.filCod` = fil 2 e comparando o distinct `filCod` das linhas devolvidas. Para cada endpoint que NÃO filtrar server-side pelo header: adicionar `filCod#EQ` no `filterList` e teste de regressão. Documentar no comentário do método a evidência (data + linhas × filiais).

- **Resultado Esperado**
  > Cada leitura tem uma linha de comentário do tipo do `listLotes` atual ("filCod#EQ é OBRIGATÓRIO. Sem ele o ERP devolve N linhas de M filiais — medido YYYY-MM-DD") OU uma linha do tipo "provado read-only que o header filtra".

- **Tactic alvo**: Discover Service; Adhere to Standards
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d — read-only, sem risco)
- **Findings relacionados**: F-integrability-2, F-integrability-3 (dependência)
- **Métricas de sucesso**:
  - Endpoints com prova documentada: 1 / 11 → 11 / 11
  - Endpoints com `filCod#EQ` onde necessário: pendente descoberta
- **Risco de não fazer**: cada endpoint hoje é uma bomba-relógio para o multi-tenant produtizado.
- **Dependências**: nenhuma; deve preceder [integrability-3].

### [integrability-3] Fechar o fallback `contas[0]` em `RemessaService` — nunca escolher conta pagadora sem filtro explícito

- **Problema**
  > `RemessaService.gerarRemessa:254` faz `const escolhida = cc ?? contas[0]`. Se `fin005/list` não filtrar por filial via `cnx-filcod` (mesma classe de defeito do `fin015/list`), `contas[0]` pode ser conta de outra filial — e vai VERBATIM para o CNAB, causando débito da conta errada.

- **Melhoria Proposta**
  > (a) Adicionar `filCod#EQ` em `listContasCorrentes` (ou assertar via probe do card 2 que o header filtra). (b) Se `cc` não bater, FALHAR em vez de escolher `contas[0]`: `throw new LoteEstadoInvalidoError({ motivo: 'A conta configurada no lote não existe em fin005 para esta filial. Escolha outra ou re-cadastre.' })`. (c) Teste com dupla filial mockada garantindo que só a filial correta é aceita.

- **Resultado Esperado**
  > É impossível gerar `.REM` para uma conta de filial diferente do lote, mesmo em condições de corrida de cache ou drift de filtro.

- **Tactic alvo**: Adhere to Standards; Restrict Communication Paths
- **Severidade**: P0
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-integrability-3, F-integrability-2
- **Métricas de sucesso**:
  - Ramos que aceitam conta sem match explícito: 1 → 0
  - Testes cobrindo dupla filial em `fin005/list`: 0 → 1
- **Risco de não fazer**: dinheiro debitado da conta errada; reversão bancária lenta.
- **Dependências**: [integrability-2] (audit dos filtros).

### [integrability-4] Ampliar `contrato.test.ts` para cobrir ≥ 80% dos endpoints do delta (11 fixtures novas)

- **Problema**
  > O contract test é o gate mais barato contra rename silencioso do ERP, mas hoje cobre 6 / 17 endpoints. Faltam os 3 grids do `fin052` (list, detalhe, erros), os 3 do `fin015/*` (finItemSispag/list, titulosPendentes/list, gerArquivosBancos/list), o `POST /fin015` (resposta de criarLote), `cmn025/ctcorr/list`, `com298/list`, `fin010/list` e `fin015/gerArquivosBancos/initialValues`.

- **Melhoria Proposta**
  > Estender `capture-fixtures-sispag.ts` para os 11 endpoints faltantes (read-only, redigido). Adicionar entrada em `CONTRATOS` no `contrato.test.ts` com os campos que o código realmente lê (com foco em `fbeVldTpret` no fin052, cuja perda "transforma rejeição em pagamento"). Adicionar um teste extra "todo endpoint chamado por um Client tem fixture" (grep automatizado dos métodos vs. lista de fixtures).

- **Resultado Esperado**
  > Rename ou remoção de qualquer campo lido pelos clientes SISPAG faz `npm test` ficar vermelho antes do PR — não a analista no botão.

- **Tactic alvo**: Contract testing
- **Severidade**: P1
- **Esforço estimado**: M (2-5d — o capture ao vivo custa acesso a HML controlado)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Endpoints com fixture: 6 → 17 (100% do delta)
  - Cobertura de contrato: 35% → 100%
- **Risco de não fazer**: `fbeVldTpret` renomeado sem quebrar `npm test` = toda rejeição virando pagamento.
- **Dependências**: nenhuma

### [integrability-5] Documentar restrição de N=1 em `arquivosRetorno/processar` ou provar N>1 ao vivo

- **Problema**
  > `processarArquivoRetorno` envia `items: [{...}]` (plural). Nunca foi testado com N > 1. É o mesmo shape que "parecia lote" em `titulosPendentes/importar` e quebrou com N ≥ 2. Um refactor futuro que assumir batch vai reproduzir o bug corrigido neste delta.

- **Melhoria Proposta**
  > Uma sonda `probe-fin052-processar-batch.ts` que chame com N=2 arquivos em HML. Se 200: documentar no docstring + fixture. Se 4xx: forçar N=1 no cliente (loop igual ao de `importarTitulos`) + comentário explícito replicando o de L442-448.

- **Resultado Esperado**
  > O código refletirá o que o ERP realmente aceita — não a leitura otimista do nome do campo.

- **Tactic alvo**: Discover Service; Contract testing
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Endpoints com `items[]` de shape provado ao vivo: 1 / 2 → 2 / 2
- **Risco de não fazer**: bug idêntico ao já corrigido, reintroduzido no próximo refactor.
- **Dependências**: nenhuma

### [integrability-6] Extrair `describeConexosValidation` + `perguntaDoErp` para `ErpResponseReader` compartilhado

- **Problema**
  > `describeConexosValidation` está duplicado 100% (25 LOC) entre Write e Retorno; `perguntaDoErp` mora só no Write mas o Retorno precisa dele (F-integrability-4). `ErpResponseReader` já existe em `src/backend/domain/errors/` — e ninguém importa.

- **Melhoria Proposta**
  > Consolidar as duas funções em `ErpResponseReader` como métodos estáticos (`extractValidation`, `extractQuestion`). Substituir nos 2 clientes SISPAG e nos outros clientes Conexos que carregam versões similares (`ConexosBaixaClient`, `ConexosFin014Client`, `ConexosFinanceiroClient`). Um teste unitário do reader cobrindo os 3 shapes (`VALIDATION_LIST`, `VALIDATION`, `QUESTION`).

- **Resultado Esperado**
  > Mudança no shape de erro do Conexos é 1 mudança, não N. O card [integrability-1] passa a ser proibido de resolver duplicando.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-integrability-7
- **Métricas de sucesso**:
  - Cópias de `describeConexosValidation` no repo: 2+ → 1
- **Risco de não fazer**: rot progressivo — cada nova frente de escrita paga o mesmo custo.
- **Dependências**: pode ir em paralelo com [integrability-1], mas idealmente [integrability-1] usa a versão já extraída.

### [integrability-7] Corrigir `listarArquivosRemessa` para usar `#EQ` explícito

- **Problema**
  > `ConexosSispagWriteClient.listarArquivosRemessa` é a única chamada do delta que usa `filterList: { bncCod, flpCod }` sem sufixo `#EQ`. Funciona hoje por convenção default do Conexos — não há prova de que continuará.

- **Melhoria Proposta**
  > Alterar para `{ 'bncCod#EQ': bncCod, 'flpCod#EQ': flpCod }`. Adicionar teste de regressão.

- **Resultado Esperado**
  > Padrão do delta uniforme (13 / 13 filtros usam `#EQ`).

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-integrability-9
- **Métricas de sucesso**:
  - Filtros com `#EQ` explícito: 12 / 13 → 13 / 13
- **Risco de não fazer**: quebra silenciosa num futuro upgrade do protocolo Conexos.
- **Dependências**: nenhuma

### [integrability-8] Instrumentar observabilidade por endpoint Conexos (contador de sucesso / 4xx / 5xx / QUESTION)

- **Problema**
  > Falhas de integração aparecem em `LogService` como texto livre; não há métrica agregada por endpoint. Não sabemos taxa de 401 (auth refresh), 400 (validação), 429/5xx (throttling) — nem taxa de QUESTION. É impossível detectar drift de comportamento do ERP antes do primeiro incidente.

- **Melhoria Proposta**
  > Wrapper em `ConexosBaseClient` que expõe métrica `conexos_endpoint_call_total{endpoint, outcome=[ok|4xx|5xx|question|timeout]}`. Emit via LogService com type específico para o consolidator agregar. Dashboard no Render com alerta em drift ≥ 10%.

- **Resultado Esperado**
  > Uma mudança de comportamento do Conexos vira alerta em ≤ 24h, não em incidente da tesouraria.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: M (2-5d — inclui dashboard)
- **Findings relacionados**: F-integrability-10 (versionamento fraco); reforço para F-integrability-1/2/3/4/5
- **Métricas de sucesso**:
  - Endpoints com métrica por-outcome: 0 → 100% dos 17 do delta
  - Tempo médio para detectar drift do ERP: incidente → ≤ 24h
- **Risco de não fazer**: cada regressão do Conexos vira surpresa cara.
- **Dependências**: nenhuma

## 6. Notas do agente

- Findings sem card: nenhum (todos entraram).
- F-integrability-8 (orquestrador longo) foi rebaixado para "sem card próprio" porque a
  solução exige repensar chorographia (SQS/EventBridge) e é grande demais para este ciclo;
  segue registrado como métrica de acoplamento para o consolidator considerar em conjunto
  com Modifiability.
- Cross-QA: F-integrability-1 e F-integrability-4 (QUESTION protocol) tocam Fault Tolerance
  também — recomendo o consolidator agrupá-los. F-integrability-2 e F-integrability-3
  (filial-filter) tocam Security (multi-tenant isolation) — flag para a lente de Security.
  F-integrability-8 (orquestrador longo) espelha achados de Modifiability.
- Métrica que tentei coletar e falhei: taxa real de QUESTION em PRD (só medível com o novo
  observability card). O único ground-truth disponível hoje é HML.
