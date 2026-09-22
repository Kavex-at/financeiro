---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-22-1556
agent: qa-fault-tolerance
generated_at: 2026-09-22T15:56:00-03:00
scope: frontend
score: 8.5
findings_count: 1
cards_count: 1
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "baixar remessa" em um lote SISPAG com `remessaArquivo` gerado | `GET /sispag/lotes/:id/remessa/arquivo` — backend responde `Buffer` latin1 do `.REM` (CNAB 240, colunas fixas) | `baixarRemessa` (`src/frontend/lib/sispag.ts`) + `LoteCard` (download handler) | Operação normal, lote já finalizado/remessa já gerada no Conexos | Bytes chegam ao navegador **idênticos** ao Buffer do backend, sem decodificação/reencodificação intermediária | 0 bytes divergentes entre o `.REM` gerado pelo ERP e o arquivo baixado; nomes com acento (Ã, Ç, É) preservam offset de coluna no CNAB 240 |

Este delta é um fix pontual: antes dele, `res.text()` decodificava a resposta sempre como UTF-8 e o
`new Blob([string])` subsequente reencodava a string em UTF-8 — dois passos de reencoding sobre um
payload que o próprio backend já declara e envia como latin1 (`routes/sispag.ts:468-474`,
`Buffer.from(arquivo.conteudo, 'latin1')`). O efeito era corrupção silenciosa: nenhum erro, nenhum log,
o download "funcionava" e entregava um arquivo com colunas deslocadas sempre que o nome do favorecido
tivesse acento — exatamente a classe de falha que este QA cobre (dado divergindo do sistema de origem
sem detecção). O ponto de origem funcional (backend) já enviava os bytes corretos desde antes deste
delta; o gap estava só no cliente, que este PR fecha.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos de reencoding entre backend e Blob final | 0 (era 2: `res.text()` decode UTF-8 + `Blob([string])` encode UTF-8) | 0 | ✅ | `src/frontend/lib/sispag.ts:450-458`, `LoteCard.tsx:308-317` |
| Teste de regressão byte-a-byte (bytes latin1 ≥0x80 saem intactos) | presente, 1 teste (`sispag.test.ts:19-36`) | presente | ✅ | `npm test` — 46 suites / 379 testes passando (`_shared-metrics.md`) |
| Teste de caminho de erro (`res.ok === false`) | presente, 1 teste (`sispag.test.ts:38-43`) | presente | ✅ | `sispag.test.ts:38-43` |
| Sanity check do payload baixado (tamanho/Content-Length vs. blob recebido) | ausente | presente | ⚠️ | `sispag.ts:450-458` — nenhuma comparação de tamanho antes de disparar o download |
| Callers de `baixarRemessa`/campo `conteudo` deixados incoerentes pelo rename de tipo | 0 (`grep` só encontra o 1 call site, já migrado) | 0 | ✅ | `grep -rn "baixarRemessa\|\.conteudo\b" src/frontend` |
| `npm run typecheck` / `npm run lint` | exit 0 / exit 0 | exit 0 | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível neste delta**: timeout do `apiFetch` para este endpoint e idempotência de
> `baixarRemessa` como financial-write — não se aplica, é leitura (`GET`), não muta estado nem dispara
> ação em sistema externo. Ver seção 6 para os cross-links.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | `baixarRemessa` valida `res.ok` e lança erro tipado com o status; não valida tamanho/forma do blob recebido | ⚠️ parcial | `sispag.ts:454-458` |
| Comparison (bytes de origem vs. bytes entregues) | Fechada por este delta: bytes do backend (`Buffer` latin1) chegam ao `Blob` sem reencoding intermediário; coberto por teste de round-trip | ✅ presente | `sispag.ts:456-458`, `sispag.test.ts:19-36` |
| Timeout | N/A neste delta — endpoint de leitura, timeout do `apiFetch` é transversal a todos os clients (cross-ref qa-availability/qa-performance) | N/A | fora do escopo do delta |
| Idempotent Replay / dedupe | N/A — download é `GET`, sem mutação de estado nem escrita financeira; reexecutar não tem efeito colateral | N/A | `sispag.ts:450-458` |
| Reintroduction / Rollback | N/A — não há estado local otimista a desfazer; falha apenas impede o `<a download>` de disparar | N/A | `LoteCard.tsx:308-320` |
| Notification on failed action | Erro de `baixarRemessa` propaga para o wrapper `acao` do `page.tsx` (fora do delta), que já trata erros com `toast` | ✅ presente (herdado, fora do diff) | `src/frontend/app/sispag/page.tsx:327-346` |

## 4. Findings (achados)

### F-fault-tolerance-1: Download da remessa não valida tamanho/forma do blob antes de disparar o `<a download>`

- **Severidade**: P3
- **Tactic violada**: Sanity Checking
- **Localização**: `src/frontend/lib/sispag.ts:450-458`
- **Evidência (objetiva)**:
  ```ts
  export async function baixarRemessa(loteId: string): Promise<{ nome: string; arquivo: Blob }> {
    const res = await apiFetch(`${API}/sispag/lotes/${loteId}/remessa/arquivo`, {
      headers: { ...(await withAuthHeaders()) },
    })
    if (!res.ok) throw new Error(`Falha ao baixar a remessa (${res.status})`)
    const disp = res.headers.get('Content-Disposition') ?? ''
    const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? `lote-${loteId}.REM`
    return { nome, arquivo: await res.blob() }
  }
  ```
  Não há comparação entre o `Content-Length` (se presente) e `arquivo.size`, nem checagem de que o
  blob não está vazio, antes de o `LoteCard` chamar `URL.createObjectURL` e disparar o download.
- **Impacto técnico**: um corpo truncado por falha de rede a meio da resposta (com `res.ok === true`
  e status 200) resultaria em download "bem-sucedido" de um `.REM` incompleto, sem qualquer sinal de
  erro para o analista.
- **Impacto de negócio**: baixo, mas não nulo — este `.REM` é o mesmo artefato que pode ser
  submetido ao banco (ver `LoteCard.tsx:306`, botão liga o arquivo à remessa nº do lote); um arquivo
  truncado submetido ao banco tem o mesmo efeito prático da corrupção que este delta acabou de
  corrigir (colunas do CNAB 240 deslocadas), só que por causa diferente.
- **Métrica de baseline**: 0 verificações de integridade (tamanho/checksum) no caminho
  `sispag.ts:450-458`, sobre um arquivo de 1 requisição HTTP sem retry nem Executor.

## 5. Cards Kanban

### [fault-tolerance-1] Validar tamanho do blob baixado antes de disparar o download da remessa

- **Problema**
  > `baixarRemessa` (`src/frontend/lib/sispag.ts:450-458`) aceita qualquer corpo de resposta com
  > `res.ok === true` e o entrega direto para download, sem comparar `Content-Length` com o tamanho
  > do `Blob` recebido. Um corpo truncado por instabilidade de rede vira um `.REM` incompleto baixado
  > sem erro visível — o mesmo tipo de corrupção silenciosa que este delta corrigiu na camada de
  > encoding, agora possível na camada de transporte.

- **Melhoria Proposta**
  > Tactic Sanity Checking: no backend, expor `Content-Length` (Express já o define por padrão para
  > `res.send(Buffer)`); no frontend, comparar `res.headers.get('Content-Length')` com
  > `arquivo.size` após `res.blob()` e lançar erro tipado (`RemessaIncompletaError` ou similar) se
  > divergirem, para cair no mesmo caminho de `toast.error` que já existe em `page.tsx`.

- **Resultado Esperado**
  > Download truncado passa a ser detectável e reportado ao analista em vez de silencioso.
  > Verificações de integridade no caminho de download: 0 → 1 (comparação de tamanho).

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Comparação de tamanho no `baixarRemessa`: ausente → presente
  - Teste cobrindo blob truncado (`Content-Length` maior que `blob.size`): 0 → 1
- **Risco de não fazer**: baixo e sem urgência — cenário exige corte de conexão a meio da resposta,
  não observado nos incidentes registrados (a memória do repositório aponta corrupção por encoding,
  já fechada por este delta, não por truncamento).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estritamente delta-only: os 3 arquivos do diff (`sispag.ts`, `LoteCard.tsx`, `sispag.test.ts`)
  cobrem um fix de leitura (`GET`), não um financial-write; por isso a maioria das tactics de
  idempotência/transação/DLQ do playbook geral (SQS, `fin010`, SISPAG remessa/dispatch) não se aplica
  a este diff e foi marcada N/A — o front real de SISPAG (finalização de lote, geração/envio de
  remessa) já tem tratamento explícito de duplicidade fora deste diff (`RemessaEmAndamentoError`,
  `LoteAnteriorCanceladoError`, `RemessaEmDuvidaError` em `src/frontend/app/sispag/page.tsx:327-370`),
  não tocado por este PR.
- O bug corrigido por este delta (dupla reencodificação UTF-8 sobre um payload latin1) era, na prática,
  uma falha de corrupção silenciosa de dados — sem sinal de erro, o `.REM` baixado divergia
  byte-a-byte do que o Conexos gerou sempre que havia acento no favorecido. Tratá-lo como achado
  aberto seria incorreto já que o próprio diff o fecha; registrado aqui como contexto do Cenário Geral.
- Cross-QA: a validação de `Content-Length` proposta no card 1 também melhora Testability (cenário de
  rede truncada é facilmente mockável no mesmo `sispag.test.ts`). Timeout do `apiFetch` (não coberto
  por este delta) é cross-ref com qa-availability/qa-performance — mesmo client, fora do diff.
