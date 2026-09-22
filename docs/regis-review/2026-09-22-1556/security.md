---
qa: Security
qa_slug: security
run_id: 2026-09-22-1556
agent: qa-security
generated_at: 2026-09-22T15:58:53Z
scope: frontend
score: 8.0
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

> **Escopo desta rodada**: `--quick`, delta-only, `git diff origin/main..HEAD` restrito a
> `src/frontend/lib/sispag.ts`, `src/frontend/app/sispag/components/LoteCard.tsx`,
> `src/frontend/lib/sispag.test.ts` (commit `ca094fb`). Backend (`src/backend/routes/sispag.ts`,
> rota `GET /sispag/lotes/:id/remessa/arquivo`) foi lido apenas como **contexto não-modificado**
> para avaliar o efeito do delta — não gerou findings próprios porque não está no diff.

## 1. Cenário Geral (Bass General Scenario aplicado ao Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Clica "Baixar .REM" para um lote com remessa já gerada, cujo favorecido tem nome acentuado (Ç/Ã) | `baixarRemessa()` em `src/frontend/lib/sispag.ts` + link de download em `LoteCard.tsx` | Produção, arquivo CNAB 240 latin1 vindo do backend (`requireRole('admin')`) | Bytes latin1 chegam ao navegador **intactos** (sem passar por decode/encode UTF-8), preservando as colunas fixas do registro bancário | 0 bytes divergentes entre resposta HTTP e arquivo salvo; teste `sispag.test.ts` prova round-trip byte-a-byte |

Este delta é uma correção de **integridade de dado** (Verify Message Integrity), não uma feature de
autenticação/autorização nova — mas o artefato afetado é um arquivo de remessa bancária (CNAB 240,
que carrega CNPJ, banco, agência e conta de cada fornecedor pago), então um bug de corrupção de
bytes aqui tem efeito direto em dinheiro em trânsito: colunas deslocadas podem fazer o banco recusar
o lote ou, pior, aplicar o pagamento em conta errada.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Hardcoded secrets no delta | 0 | 0 | ✅ | `git diff origin/main..HEAD` (3 arquivos, sem strings de credencial) |
| `dangerouslySetInnerHTML`/`innerHTML` introduzidos | 0 | 0 | ✅ | leitura completa do diff de `LoteCard.tsx` |
| Guard de autorização na rota consumida (`requireRole('admin')`) | presente, inalterado pelo delta | presente | ✅ | `src/backend/routes/sispag.ts:458` (fora do diff, lido como contexto) |
| Teste de integridade byte-a-byte para o path de download | 1 (novo) | ≥1 | ✅ | `src/frontend/lib/sispag.test.ts:12-31` |
| Verificação de integridade em runtime (`Content-Length` vs `blob.size`) no path de download | 0 | ≥1 para artefato financeiro | ⚠️ | `Grep -n "content-length" src/frontend/lib/sispag.ts` → 0 hits |
| Validação/whitelist do MIME herdado do backend antes de criar o Blob | 0 (o tipo do Blob agora vem 100% do header do backend) | fallback explícito | ⚠️ | `src/frontend/lib/sispag.ts:452-461` |
| `npm test` (frontend) | 46 suites / 379 testes passando | verde | ✅ | `_shared-metrics.md` |
| `npm run typecheck` / `npm run lint` | exit 0 / exit 0 | exit 0 | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: se o header `Content-Type` do backend chega intacto até o
> browser em produção (proxy/CDN podem reescrever). Requer inspeção de rede em produção ou logs do
> Render. Recomendação: cobrir com teste de integração ponta-a-ponta quando o ambiente permitir.

## 3. Tactics — Cobertura no delta

Mapa restrito às tactics tocadas ou relevantes ao artefato deste delta (download de arquivo bancário
no frontend). As demais tactics da taxonomia completa (authz de rota, IAM, CloudTrail, SSM, etc.) não
mudam neste diff — ver rodadas anteriores de Security para o estado geral do repositório.

| Tactic (Bass) | Implementação atual (pós-delta) | Status | Evidência |
|---|---|---|---|
| Verify Message Integrity | Fix elimina a corrupção introduzida pelo decode/encode UTF-8 (`res.text()` → `new Blob([string])`); bytes agora trafegam como `Blob` opaco ponta-a-ponta. Prova via teste unitário, não via checagem em runtime. | ⚠️ parcial | `src/frontend/lib/sispag.ts:452-461`, `src/frontend/lib/sispag.test.ts:12-31` |
| Validate Input | `res.ok` é checado antes de ler o corpo; nome do arquivo é extraído por regex de `Content-Disposition` com fallback (`lote-${loteId}.REM`). O `type` do `Blob` agora é herdado diretamente do `Content-Type` do backend, sem validação/whitelist no cliente. | ⚠️ parcial | `src/frontend/lib/sispag.ts:456-460` |
| Authenticate Actors / Authorize Actors | Inalterado pelo delta — `withAuthHeaders()` segue anexando o Bearer token; a rota consumida segue exigindo `requireRole('admin')` no backend (fora do diff). | ✅ presente (herdado) | `src/frontend/lib/sispag.ts:453`, `src/backend/routes/sispag.ts:458` |
| Limit Exposure | Rota já restringia a fornecedores/CNPJ a `admin` antes deste delta; o delta não altera quem pode chamar `baixarRemessa`, só como o conteúdo é manipulado no cliente. | N/A para este delta — sem mudança de superfície | — |
| Encrypt Data (in transit) | Download segue no mesmo `apiFetch` (HTTPS via API do backend); nenhuma mudança de transporte. | N/A para este delta | `src/frontend/lib/http.ts` |
| Audit Trail | Delta não adiciona nem remove log de "arquivo baixado"; ação de download do .REM não fica registrada em log estruturado do frontend (evento fica só no toast `'Arquivo baixado'` da UI). Pré-existente, não é regressão deste diff. | N/A para este delta (pré-existente) | `LoteCard.tsx:309` (string do toast, não telemetria) |

## 4. Findings (achados)

### F-security-1: Blob do CNAB 240 herda `Content-Type` do backend sem fallback defensivo no cliente

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `src/frontend/lib/sispag.ts:452-461`
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
  Antes do delta, o frontend fixava o `type` do `Blob` explicitamente (`'text/plain;charset=latin1'`),
  ignorando o header do servidor. Depois do delta, `res.blob()` usa o `Content-Type` que o backend
  mandar, sem validação no cliente. O risco prático é baixo hoje porque a rota consumida já responde
  com `Content-Disposition: attachment`, o que faz o navegador forçar o download em vez de renderizar
  o conteúdo inline — mas essa mitigação vive inteiramente no backend (fora deste diff) e o frontend
  perdeu a camada independente que tinha antes.
- **Impacto técnico**: se uma rota futura (ou uma resposta de erro não coberta por `res.ok`) devolver
  `Content-Type` diferente do esperado, o `Blob` herda esse tipo sem checagem no cliente.
- **Impacto de negócio**: baixo isoladamente (mitigado pelo `attachment` do backend), mas remove uma
  camada de defesa-em-profundidade num artefato que carrega CNPJ e dados bancários de fornecedores.
- **Métrica de baseline**: 0 validações/whitelist de MIME no cliente para este path (antes e depois do
  delta havia 0; a diferença é que antes o cliente ao menos *sobrescrevia* o tipo, agora apenas o herda).

### F-security-2: Nenhuma verificação de integridade em runtime no path que este delta corrige

- **Severidade**: P2
- **Tactic violada**: Verify Message Integrity
- **Localização**: `src/frontend/lib/sispag.ts:452-461`
- **Evidência (objetiva)**:
  ```
  grep -n "content-length\|Content-Length" src/frontend/lib/sispag.ts   # 0 hits
  ```
  O commit corrige exatamente uma classe de bug de corrupção de bytes (decode/encode UTF-8 deslocando
  colunas fixas do CNAB 240) e prova a correção com um teste unitário determinístico
  (`sispag.test.ts:12-31`, comparação byte-a-byte de um `Blob` mockado). Não há, porém, nenhuma
  checagem em runtime (ex.: `blob.size` vs. header `Content-Length`) que detectaria uma corrupção de
  origem diferente — proxy/CDN reescrevendo o corpo, gzip mal configurado, ou uma regressão futura que
  reintroduza `res.text()` em outro ponto de código sem que o teste unitário cubra.
- **Impacto técnico**: qualquer corrupção de bytes que não seja "decode UTF-8 de string" (a causa que
  este delta elimina) passa despercebida até o analista tentar submeter o arquivo ao banco.
- **Impacto de negócio**: o histórico do time já registra remessa SISPAG rejeitada pelo banco por
  problema no arquivo (ver `sispag-filial-7-primeira-remessa-nao-validada`), então corrupção
  silenciosa de um `.REM` é um cenário com precedente operacional, não hipotético.
- **Métrica de baseline**: 0 verificações de integridade em runtime (`Content-Length`/checksum) no
  path de download hoje, antes e depois do delta — o delta corrige a causa conhecida mas não adiciona
  uma rede de segurança para outras causas.

## 5. Cards Kanban

### [security-1] Comparar `Content-Length` com `blob.size` antes de oferecer o `.REM` para download

- **Problema**
  > `baixarRemessa()` confia cegamente que os bytes que chegaram do `fetch` são os bytes que o
  > backend mandou, sem nenhuma checagem de tamanho. O delta atual corrige a única causa de corrupção
  > conhecida (decode/encode UTF-8 no meio do caminho), mas não adiciona uma rede de segurança para
  > outras causas (proxy, gzip, regressão futura) num artefato que, se corrompido, pode mover dinheiro
  > para conta errada ou ser rejeitado pelo banco.

- **Melhoria Proposta**
  > Em `src/frontend/lib/sispag.ts`, ler `res.headers.get('content-length')` e comparar com
  > `arquivo.size` após `res.blob()`; se divergirem, lançar erro em vez de oferecer o download
  > (tactic **Verify Message Integrity**). Cobrir com teste que injeta um header divergente do
  > `blob.size` mockado.

- **Resultado Esperado**
  > Corrupção de bytes de qualquer origem (não só decode UTF-8) é detectada antes do download em vez
  > de chegar ao analista como arquivo silenciosamente errado. Verificações de integridade em runtime
  > no path: 0 → 1.

- **Tactic alvo**: Verify Message Integrity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Verificações de integridade em runtime no path de download: 0 → 1
  - Teste cobrindo divergência de tamanho: ausente → presente
- **Risco de não fazer**: em 6 meses, uma corrupção de origem diferente do bug já corrigido (ex.: um
  proxy/CDN novo na frente do Render) passa despercebida até o banco recusar ou aplicar mal um
  pagamento — mesma classe de incidente do histórico de "SISPAG filial 7", só que sem sintoma visível
  no frontend.
- **Dependências**: nenhuma.

### [security-2] Não herdar o `Content-Type` do backend sem whitelist explícita no `Blob` do cliente

- **Problema**
  > Antes do delta, o frontend fixava explicitamente o `type` do `Blob` (`text/plain;charset=latin1`)
  > independente do que o backend mandasse. Depois do delta, `res.blob()` herda o `Content-Type` do
  > servidor sem checagem — funciona hoje porque o backend responde com `Content-Disposition:
  > attachment`, mas essa é a única camada de defesa restante, e ela vive num arquivo fora deste diff.

- **Melhoria Proposta**
  > Em `baixarRemessa()`, envolver o resultado de `res.blob()` numa whitelist simples (aceitar só
  > `text/plain` para este endpoint; qualquer outro `Content-Type` vira erro explícito) — tactic
  > **Validate Input** aplicada ao dado que atravessa a fronteira HTTP, tratando o header do servidor
  > como entrada externa não confiável por padrão.

- **Resultado Esperado**
  > O frontend volta a ter uma camada independente de proteção de tipo de conteúdo para o path de
  > download financeiro, sem depender só do header do backend. Validação de MIME no cliente: ausente →
  > presente com teste cobrindo um `Content-Type` inesperado.

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Risco de não fazer**: baixo isoladamente (mitigado hoje pelo backend), mas acumula débito de
  defesa-em-profundidade num fluxo que lida com CNPJ e dados bancários de fornecedores.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta por instrução explícita; achados de authn/authz/IAM/secrets do repositório
  como um todo (ex.: JWT em `localStorage` em `src/frontend/lib/auth/token.ts`) não entram aqui por
  serem código pré-existente, fora do diff — reportar em rodada `scope=all`, se houver.
- Cross-QA: F-security-2 (Verify Message Integrity) tem sobreposição direta com **Fault Tolerance**
  (mesma classe de bug já causou rejeição de remessa em produção, ver memória
  `sispag-filial-7-primeira-remessa-nao-validada`) e com **Integrability** (contrato implícito de
  bytes entre backend/frontend para CNAB 240).
- Nenhum P0: a rota consumida mantém `requireRole('admin')` inalterada, nenhum secret/credencial
  aparece no diff, e o delta é estritamente uma correção de integridade de dado sem ampliar superfície
  de ataque.
