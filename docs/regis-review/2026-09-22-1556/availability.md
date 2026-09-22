---
qa: Availability
qa_slug: availability
run_id: 2026-09-22-1556
agent: qa-availability
generated_at: 2026-09-22T15:56:00-03:00
scope: frontend
score: 7.5
findings_count: 2
cards_count: 2
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG clica "Baixar remessa" em um lote `REMESSA_GERADA` com favorecido cujo nome tem caractere acentuado (byte ≥ 0x80 em latin1) | Download do `.REM` já gerado no ERP | `baixarRemessa` (`src/frontend/lib/sispag.ts`) + handler de download em `LoteCard.tsx` | Operação normal, pré-envio ao Nexxera | Os bytes chegam ao navegador idênticos aos que o backend enviou (latin1 preservado), sem reencode intermediário | 0 bytes divergentes entre o payload do backend e o arquivo salvo; nenhuma coluna fixa do CNAB 240 desloca |

Esta é a leitura correta do delta sob a lente de Availability: o "fault" aqui não é uma exceção não
tratada, é **corrupção silenciosa de dados num write path financeiro**. Antes do fix, `res.text()`
decodificava os bytes latin1 do ERP como UTF-8 (cada byte ≥ 0x80 virava `U+FFFD`), e o `new
Blob([string])` subsequente reencodava esse `U+FFFD` em 3 bytes UTF-8 — alongando o registro e
deslocando as colunas fixas do CNAB 240 a partir do primeiro caractere acentuado no nome do
favorecido. Isso é "Ignore Faulty Behavior" na pior acepção: o sistema mascarava a corrupção e
entregava um arquivo estruturalmente errado como se fosse sucesso — sem qualquer sinal para o
analista até o banco rejeitar (ou, pior, processar campos deslocados). O delta fecha essa lacuna
trocando `res.text()` por `res.blob()` e entregando o `Blob` direto ao `URL.createObjectURL`, sem
string intermediária.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura de teste de regressão para a classe de bug corrigida | 1/1 arquivo tocado (`sispag.ts`) tem teste dedicado de fidelidade de bytes | 100% dos writes/downloads binários com teste de fidelidade | ✅ | `src/frontend/lib/sispag.test.ts:9-31` |
| Exception Detection no path de download | `res.ok` checado, lança erro tipado com status | Toda chamada externa deve checar status | ✅ | `src/frontend/lib/sispag.ts:452` |
| `npm run typecheck` / `npm run lint` / `npm test` (frontend) | exit 0 / exit 0 / 46 suites, 379 testes passando | verde | ✅ | `docs/regis-review/2026-09-22-1556/_shared-metrics.md` |
| Sanity check em runtime do tamanho do blob baixado vs. `Content-Length` | ausente | presente para downloads binários financeiros | ❌ | `src/frontend/lib/sispag.ts:447-457` (nenhuma comparação com header) |
| Telemetria/log de sucesso-falha do download de remessa | ausente | presente (mínimo: log de falha) | ❌ | `src/frontend/app/sispag/components/LoteCard.tsx:306-320` (nenhuma chamada de log) |

⚠️ **Não medível localmente**: taxa de rejeição de remessa pelo Nexxera atribuível a corrupção de
encoding antes deste fix, e MTTR do incidente (detecção → correção). Requer CloudWatch/logs de
produção do backend e/ou confirmação do time de operação sobre quantas remessas com favorecido
acentuado foram geradas entre a introdução do bug original e este fix. Recomendação: instrumentar
log estruturado (`LogService`, quando este fluxo migrar para o backend Lambda) com o tamanho em
bytes do `.REM` gerado e do `.REM` efetivamente aceito pelo Nexxera, para permitir essa correlação
no futuro.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — download client-triggered via HTTP, sem canal de health-check dedicado | N/A | — |
| Heartbeat | N/A — ação pontual do usuário, não processo de longa duração | N/A | — |
| Monitor | Nenhum log/telemetria específico para sucesso/falha do download de remessa | ⚠️ parcial | `src/frontend/app/sispag/components/LoteCard.tsx:306-320` |
| Timestamp | N/A — download single-shot, sem ordenação/staleness a verificar | N/A | — |
| Sanity Checking | O fix é uma correção de integridade de bytes (o cerne do delta), mas não há checagem em runtime contra `Content-Length` para detectar truncamento de rede | ⚠️ parcial | `src/frontend/lib/sispag.ts:447-457` |
| Condition Monitoring | N/A — não é processo contínuo | N/A | — |
| Voting | N/A — fonte única (ERP via backend), sem redundância a arbitrar | N/A | — |
| Exception Detection | `res.ok` checado; erro tipado com status HTTP, testado | ✅ presente | `src/frontend/lib/sispag.ts:452`; `src/frontend/lib/sispag.test.ts:39-43` |
| Self-Test | Teste de regressão novo garante fidelidade byte-a-byte de conteúdo latin1 | ✅ presente | `src/frontend/lib/sispag.test.ts:9-31` |
| Active Redundancy | N/A — não há caminho alternativo para obter o `.REM` | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | `acaoLote` (pré-existente, exercitado por este handler) converte exceção em toast, com casos de erro de domínio distintos (`RemessaEmAndamentoError` etc.) | ✅ presente | `src/frontend/app/sispag/page.tsx:327-383` |
| Rollback | N/A — GET sem mutação de estado; `URL.revokeObjectURL` é limpeza de recurso do navegador, não rollback | N/A | `src/frontend/app/sispag/components/LoteCard.tsx:308-320` |
| Software Upgrade | N/A | N/A | — |
| Retry | Nenhum retry automático — ação manual do analista (clicar de novo); design aceitável para um download disparado por clique, não um job de fundo | N/A | `src/frontend/app/sispag/components/LoteCard.tsx:306-320` |
| Ignore Faulty Behavior | Pré-fix, o bug **era** um caso de "ignore faulty behavior" indevido (corrupção mascarada como sucesso); o delta remove essa máscara ao preservar os bytes originais | ✅ presente (resolvido pelo delta) | `src/frontend/lib/sispag.ts:441-457` |
| Degradation | Fallback de nome de arquivo quando `Content-Disposition` não traz `filename` (`lote-${loteId}.REM`), código pré-existente exercitado pela função tocada | ✅ presente | `src/frontend/lib/sispag.ts:454` |
| Reconfiguration | N/A | N/A | — |
| Shadow | N/A — ação síncrona de usuário, sem via de reintrodução | N/A | — |
| State Resynchronization | N/A | N/A | — |
| Escalating Restart | N/A | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| Removal from Service | N/A | N/A | — |
| Transactions | N/A — download é leitura pura, sem mutação de estado do lote | N/A | — |
| Predictive Model | N/A | N/A | — |
| Exception Prevention | Teste de regressão novo previne reincidência exata desta classe de bug (encoding latin1→UTF-8 em write path financeiro) | ✅ presente | `src/frontend/lib/sispag.test.ts:9-31` |
| Increase Competence Set | Comentário no código documenta a causa raiz ("nunca `res.text()`... o backend manda latin1 de propósito") para quem tocar o arquivo depois | ✅ presente | `src/frontend/lib/sispag.ts:442-446` |

## 4. Findings (achados)

### F-availability-1: Sem sanity check em runtime contra `Content-Length` no download do `.REM`

- **Severidade**: P2
- **Tactic violada**: Sanity Checking
- **Localização**: `src/frontend/lib/sispag.ts:447-457`
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
  Não há comparação entre `res.headers.get('Content-Length')` e `arquivo.size` antes de oferecer o
  download ao analista.
- **Impacto técnico**: uma resposta truncada por rede (conexão instável, proxy corporativo) resulta
  em `res.ok === true` mas um `Blob` menor que o `.REM` real; a função devolve normalmente, sem sinal
  de que o conteúdo está incompleto.
- **Impacto de negócio**: um `.REM` truncado enviado ao Nexxera tem o mesmo efeito prático do bug que
  este delta corrige — registro CNAB 240 com colunas deslocadas ou registro final faltando — mas sem
  a rede de proteção do teste de regressão adicionado aqui, porque a causa é truncamento de rede, não
  reencode.
- **Métrica de baseline**: 0 dos caminhos de download de arquivo binário no SISPAG (`baixarRemessa`,
  único caso hoje) fazem checagem de tamanho — 0/1.

### F-availability-2: Nenhuma telemetria de sucesso/falha para o download de remessa

- **Severidade**: P3
- **Tactic violada**: Monitor
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:306-320`
- **Evidência (objetiva)**:
  ```tsx
  onClick={() =>
    acao(async () => {
      const { nome, arquivo } = await baixarRemessa(l.id)
      const url = URL.createObjectURL(arquivo)
      const a = document.createElement('a')
      a.href = url
      a.download = nome
      a.click()
      URL.revokeObjectURL(url)
    }, 'Arquivo baixado')
  }
  ```
  Falha vira apenas um toast (via `acaoLote`); sucesso e falha não deixam rastro consultável fora do
  navegador do analista.
- **Impacto técnico**: se esta classe de bug (ou outra, ex. truncamento de F-availability-1) reincidir
  em produção, a equipe só fica sabendo por reclamação do analista ou rejeição do banco — não há
  métrica agregada de falhas de download por tenant/lote.
- **Impacto de negócio**: aumenta o MTTR de um incidente de corrupção de remessa, porque a detecção
  depende de um humano notar e reportar, em vez de um sinal operacional.
- **Métrica de baseline**: 0 chamadas de log/telemetria no handler de download (`LoteCard.tsx:306-320`).

## 5. Cards Kanban

### [availability-1] Checar `Content-Length` antes de oferecer o `.REM` baixado

- **Problema**
  > `baixarRemessa` aceita qualquer resposta `res.ok` como completa e converte direto para `Blob`,
  > sem comparar o tamanho recebido com o `Content-Length` declarado pelo backend. Uma resposta
  > truncada por rede produziria um `.REM` incompleto entregue ao analista como se fosse o arquivo
  > final — o mesmo tipo de dano (colunas do CNAB 240 corrompidas) que este delta corrigiu para o
  > caso de reencode, mas por uma causa diferente (rede, não encoding).

- **Melhoria Proposta**
  > Em `src/frontend/lib/sispag.ts`, ler `Content-Length` do header da resposta e comparar com
  > `arquivo.size` antes de retornar; se divergirem, lançar um erro específico (ex.
  > `RemessaTruncadaError`) que `acaoLote` trata com uma mensagem clara ("baixe novamente"). Tactic
  > Bass: **Sanity Checking**.

- **Resultado Esperado**
  > Toda resposta truncada é detectada antes de chegar ao disco do analista. Métrica: checagem de
  > tamanho presente em 1/1 downloads binários do SISPAG (hoje 0/1).

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Downloads binários do SISPAG com checagem de `Content-Length`: 0/1 → 1/1
  - Teste de regressão cobrindo resposta truncada: ausente → presente em `sispag.test.ts`
- **Risco de não fazer**: um download truncado por instabilidade de rede corporativa (cenário
  plausível para analistas em VPN) chega ao banco como remessa malformada, indistinguível do bug de
  encoding que este delta acabou de fechar — mesmo impacto de negócio, causa raiz diferente.
- **Dependências**: nenhuma.

### [availability-2] Log de sucesso/falha no download de remessa

- **Problema**
  > O download do `.REM` não deixa nenhum rastro fora do navegador do analista: sucesso e falha só
  > aparecem como um toast local. Isso significa que qualquer reincidência de corrupção nesse fluxo
  > (a classe de bug que este delta corrige, ou a de F-availability-1) só é percebida quando o Nexxera
  > rejeita a remessa ou o analista reporta manualmente.

- **Melhoria Proposta**
  > Adicionar uma chamada de log (client-side logger existente, ou endpoint de telemetria do
  > backend) em `LoteCard.tsx` registrando `loteId`, resultado (sucesso/erro) e tamanho em bytes do
  > arquivo baixado. Quando este fluxo migrar para o backend Lambda (alvo do CLAUDE.md), o
  > equivalente é logar via `LogService` no handler que serve `/sispag/lotes/:id/remessa/arquivo`.
  > Tactic Bass: **Monitor**.

- **Resultado Esperado**
  > Falhas e sucessos de download de remessa ficam consultáveis centralmente. Métrica: 0 → 1 evento
  > logado por download.

- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Risco de não fazer**: MTTR de um incidente de corrupção de remessa continua dependente de
  detecção manual pelo analista ou pelo banco, em vez de sinal operacional.
- **Dependências**: nenhuma; pode ser combinado com availability-1 se ambos forem tocados na mesma
  sessão de trabalho.

## 6. Notas do agente

- Escopo: delta frontend-only (`sispag.ts`, `LoteCard.tsx`, `sispag.test.ts`), `--quick` — tactics de
  infra (DLQ, EventBridge, RDS, CloudWatch) marcadas N/A por não pertencerem a este delta, não por
  ausência real no repo (repo não tem `infra/` de qualquer forma, ver CLAUDE.md).
- Este delta corrige um bug de corrupção silenciosa de dados num write path financeiro (remessa
  bancária), com teste de regressão byte-exato. Não há P0 introduzido ou deixado por este delta — o
  P0-class que existia (favorecido acentuado corrompendo colunas fixas do CNAB 240) é fechado aqui.
  Reportado como contexto no Cenário Geral, não como finding, porque a instrução do run exige P0
  apenas para defeito introduzido/deixado pelo delta.
- Cross-QA: `qa-integrability` e `qa-fault-tolerance` devem revisar o mesmo diff sob a ótica de
  contrato HTTP (mudança de `{ nome, conteudo: string }` para `{ nome, arquivo: Blob }` é breaking
  para qualquer outro consumidor de `baixarRemessa`) e de tratamento de erro, respectivamente — não
  duplicado aqui.
