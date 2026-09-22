---
type: regis-review-kanban
run_id: 2026-09-22-1556
total: 7
counts: { p0: 0, p1: 1, p2: 3, p3: 3 }
---

# Kanban — financeiro — 2026-09-22-1556

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado
> Esperado. Ordem: P0 (S → XL), depois P1, P2, P3. Escopo desta rodada: frontend, `--quick`,
> delta-only (branch `fix/sispag-rem-download-latin1`). 0 cards P0 neste ciclo.
>
> Dois cards abaixo (`cross-1`, `cross-2`) são fusões editoriais de findings quase idênticos vindos
> de QAs diferentes — ver `REPORT.md` §7 para o racional de cada fusão. Os demais são cópia verbatim
> das seções QA originais.

---

## P0 — Crítico

Nenhum card P0 neste ciclo.

---

## P1 — Alto

### [deployability-1] Checklist de verificação manual do `.REM` no Preview Deployment antes de mergear fixes de formato SISPAG

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> O fix deste delta corrige corrupção de bytes no CNAB 240 entregue ao banco, mas o único portão
> antes de produção é um teste unitário com fixture sintético de 9 bytes
> (`src/frontend/lib/sispag.test.ts:11-16`). `DEPLOY.md` não tem seção de staging/homolog para o
> frontend, apesar de a Vercel já gerar um Preview Deployment por PR por padrão.

**Melhoria Proposta**
> Acrescentar a `DEPLOY.md` (ou a um novo `docs/runbooks/sispag-remessa-checklist.md`) um passo
> obrigatório para PRs que tocam geração/entrega de remessa: baixar o `.REM` do Vercel Preview
> Deployment (gerado automaticamente por PR) e validar num leitor CNAB 240 / comparar com um arquivo
> já aceito pelo banco, antes de aprovar o merge. Tactic alvo: Scale Rollouts, usando a
> infraestrutura de preview que a Vercel já provê sem custo adicional.

**Resultado Esperado**
> Toda mudança em `lib/sispag.ts` / rotas de remessa passa por um humano abrindo o arquivo real
> gerado no preview antes de ir a produção. Checklist de verificação manual: 0 → 1. Fixture de teste
> sintético (9 bytes) é mantido para regressão de unidade — o checklist cobre o caso de arquivo real,
> que o fixture não cobre.

**Métricas de sucesso**
- Checklist de verificação manual documentado para mudanças de formato SISPAG: 0 → 1
- Fixture de teste de regressão com `.REM` real (não só bytes sintéticos): 0 → 1

**Risco de não fazer**
> O único portão antes de produção continua sendo um fixture sintético de 9 bytes; um novo problema
> de formato nesta classe (geração/entrega de remessa) só apareceria em produção, com o analista já
> submetendo o arquivo ao banco.

**Dependências**: Nenhuma.

---

## P2 — Médio

### [cross-1] Sanity check `Content-Length` vs `blob.size` no download de arquivos binários financeiros

**QA**: Availability, Fault Tolerance, Security
**Tactic alvo**: Sanity Checking / Verify Message Integrity
**Esforço**: S (≤1d)
**Findings**: F-availability-1, F-fault-tolerance-1, F-security-2

**Problema**
> `baixarRemessa` (`src/frontend/lib/sispag.ts:450-458`) aceita qualquer resposta com
> `res.ok === true` e a converte direto para `Blob`, sem comparar `Content-Length` com
> `arquivo.size`. Um corpo truncado por instabilidade de rede (VPN corporativa, proxy) produz um
> `.REM` incompleto entregue ao analista como se fosse o arquivo final — o mesmo tipo de dano
> (colunas do CNAB 240 corrompidas / registro final faltando) que este delta corrigiu para o caso de
> reencode, mas por uma causa diferente (transporte, não encoding). Três QAs (Availability, Fault
> Tolerance, Security) chegaram ao mesmo achado por ângulos distintos.

**Melhoria Proposta**
> No backend, expor `Content-Length` (Express já o define por padrão para `res.send(Buffer)`); no
> frontend, ler `res.headers.get('content-length')` e comparar com `arquivo.size` após `res.blob()`;
> se divergirem, lançar um erro tipado (ex. `RemessaTruncadaError`/`RemessaIncompletaError`) que
> `acaoLote` trata com uma mensagem clara ("baixe novamente"), caindo no mesmo caminho de
> `toast.error` que já existe em `page.tsx`. Tactic Bass: **Sanity Checking / Verify Message
> Integrity**.

**Resultado Esperado**
> Toda resposta truncada é detectada antes de chegar ao disco do analista. Downloads binários do
> SISPAG com checagem de tamanho: 0/1 → 1/1.

**Métricas de sucesso**
- Downloads binários do SISPAG com checagem de `Content-Length`: 0/1 → 1/1
- Teste de regressão cobrindo resposta truncada (`Content-Length` maior que `blob.size`): ausente →
  presente em `sispag.test.ts`

**Risco de não fazer**
> Uma corrupção de origem diferente do bug já corrigido (rede, proxy, gzip mal configurado, ou uma
> regressão futura que reintroduza `res.text()` em outro ponto sem que o teste unitário atual cubra)
> passa despercebida até o analista submeter o arquivo ao banco — mesmo impacto de negócio do bug
> fechado por este delta, causa raiz diferente.

**Dependências**: Nenhuma.

---

### [cross-2] Extrair helper compartilhado de download de blob (`exportarRelatorio` + `baixarRemessa`)

**QA**: Integrability, Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-integrability-1, F-integrability-2, F-modifiability-1

**Problema**
> O frontend tem duas implementações independentes do padrão "buscar blob do backend, extrair
> filename do `Content-Disposition`, disparar o download": `lib/api.ts::exportarRelatorio`
> (`api.ts:585-625`) e `lib/sispag.ts::baixarRemessa` (`sispag.ts:450-458`), com regexes de filename
> divergentes (uma aceita aspas opcionais, a outra exige aspas) e `URL.revokeObjectURL` protegido por
> `try/finally` só em um dos dois (`api.ts:616-625` sim; `LoteCard.tsx:309-316` não). O delta não
> criou essa segunda implementação — `baixarRemessa` já existia antes deste PR; o delta apenas trocou
> como os bytes são lidos (`res.text()` → `res.blob()`), o que aproximou estruturalmente seu padrão
> do já existente em `exportarRelatorio` e tornou a duplicação preexistente mais visível.

**Melhoria Proposta**
> Extrair um helper único (`downloadBlobFromResponse(res: Response, fallbackFilename: string):
> Promise<{ nome: string; arquivo: Blob }>`, incluindo `URL.createObjectURL` + `try/finally` +
> disparo do `<a>`) em `src/frontend/lib/http.ts` ou novo `lib/download.ts`. Migrar
> `exportarRelatorio` e `baixarRemessa` para reusá-lo. Tactic: Abstract Common Services.

**Resultado Esperado**
> Implementações de download-blob no frontend: 2 → 1. Próximos endpoints de download (GED, retorno
> Nexxera, PDF SharePoint — todos no roadmap imediato) herdam automaticamente byte-fidelity e
> `revokeObjectURL` seguro, sem reimplementar.

**Métricas de sucesso**
- Implementações independentes de download-blob: 2 → 1
- Parsers de `Content-Disposition` distintos: 2 → 1
- Call sites protegidos por `try/finally` no revoke: 1/2 → 2/2

**Risco de não fazer**
> O próximo endpoint de download binário (GED/Nexxera/SharePoint) tem chance real de reintroduzir a
> mesma classe de bug corrigida nesta branch, implementando o padrão pela 3ª vez do zero.

**Dependências**: Nenhuma — refactor isolado ao frontend, sem mudança de contrato de backend.

---

### [testability-1] Cobrir o wiring de download do `LoteCard` com um teste de componente

**QA**: Testability
**Tactic alvo**: Specialized Interfaces / Limit Structural Complexity
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> O fix troca `res.text()` por `res.blob()` e o `onClick` do botão "Baixar" em
> `LoteCard.tsx:306-322` entrega esse `Blob` direto a `URL.createObjectURL`. O teste novo
> (`sispag.test.ts`) cobre a função `baixarRemessa` isoladamente, mas nenhum teste exercita o clique
> real do componente — o ponto exato onde uma reintrodução do bug (reencodar o `Blob` já correto em
> string no meio do caminho) passaria despercebida pelo CI.

**Melhoria Proposta**
> Adicionar `LoteCard.test.tsx` (Testing Library) cobrindo o clique em "Baixar": mock de
> `baixarRemessa` retornando um `Blob` de bytes conhecidos, spy em
> `URL.createObjectURL`/`URL.revokeObjectURL` (polyfill necessário em `jest.setup.ts`, já que
> `jsdom` não implementa `createObjectURL` nativamente) e assert de que o `Blob` passado é o mesmo
> objeto, sem reconstrução intermediária. Tactic: Specialized Interfaces (expor o polyfill de
> `URL.createObjectURL` como utilitário reusável em `jest.setup.ts`, como já existe para
> `ResizeObserver`).

**Resultado Esperado**
> Testes de componente em `src/frontend/app/sispag/components/`: 0 → ≥1 arquivo cobrindo o fluxo de
> download do `.REM`. Cobertura de linha de `LoteCard.tsx` no relatório `--coverage` sobe a partir do
> baseline atual (não medido nesta rodada `--quick`).

**Métricas de sucesso**
- Testes de componente em `app/sispag/components/`: 0 → ≥1
- `jest.setup.ts`: polyfill de `URL.createObjectURL`/`revokeObjectURL` ausente → presente (reusável
  por outras telas que baixam arquivo, ex. futura Frente IV)

**Risco de não fazer**
> O mesmo bug de encoding corrompendo CNAB 240 (já ocorreu em produção, ver commit `ca094fb`) pode
> reaparecer no wiring do componente sem que o CI acuse — o teste atual só defende a metade "de
> baixo" do fluxo.

**Dependências**: Nenhuma.

---

## P3 — Baixo

### [availability-2] Log de sucesso/falha no download de remessa

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: S (≤1d)
**Findings**: F-availability-2

**Problema**
> O download do `.REM` não deixa nenhum rastro fora do navegador do analista: sucesso e falha só
> aparecem como um toast local (`LoteCard.tsx:306-320`). Qualquer reincidência de corrupção nesse
> fluxo (a classe de bug que este delta corrige, ou a de `cross-1`) só é percebida quando o Nexxera
> rejeita a remessa ou o analista reporta manualmente.

**Melhoria Proposta**
> Adicionar uma chamada de log (client-side logger existente, ou endpoint de telemetria do backend)
> em `LoteCard.tsx` registrando `loteId`, resultado (sucesso/erro) e tamanho em bytes do arquivo
> baixado. Quando este fluxo migrar para o backend Lambda (alvo do CLAUDE.md), o equivalente é logar
> via `LogService` no handler que serve `/sispag/lotes/:id/remessa/arquivo`. Tactic Bass: **Monitor**.

**Resultado Esperado**
> Falhas e sucessos de download de remessa ficam consultáveis centralmente. Evento logado por
> download: 0 → 1.

**Métricas de sucesso**
- Eventos logados por download de remessa: 0 → 1

**Risco de não fazer**
> MTTR de um incidente de corrupção de remessa continua dependente de detecção manual pelo analista
> ou pelo banco, em vez de sinal operacional.

**Dependências**: Nenhuma; pode ser combinado com `cross-1` se ambos forem tocados na mesma sessão
de trabalho.

---

### [modifiability-2] Renomear campo `arquivo: Blob` em `baixarRemessa` para evitar colisão com `GerarRemessaResult.arquivo: string`

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S (≤1d)
**Findings**: F-modifiability-2

**Problema**
> `sispag.ts` usa `arquivo` para dois significados incompatíveis no mesmo módulo: nome do arquivo
> (`GerarRemessaResult.arquivo?: string`, linha 289) e conteúdo binário (retorno de `baixarRemessa`,
> linha 450, `Blob`).

**Melhoria Proposta**
> Renomear o campo do retorno de `baixarRemessa` para `blob` ou `bytes` (ajustando
> `LoteCard.tsx:309` e `sispag.test.ts`). Tactic: Increase Semantic Coherence.

**Resultado Esperado**
> Nenhuma ocorrência de `arquivo` com tipos incompatíveis no mesmo arquivo.

**Métricas de sucesso**
- Ocorrências do identificador `arquivo` com tipos incompatíveis em `sispag.ts`: 2 → 0

**Risco de não fazer**
> Custo cognitivo marginal a cada leitura futura de `sispag.ts`; baixo, mas acumulável em um arquivo
> de 643 LOC que já concentra 3 fatias de domínio (remessa, conciliação, geração).

**Dependências**: Nenhuma.

---

### [security-2] Não herdar o `Content-Type` do backend sem whitelist explícita no `Blob` do cliente

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S (≤1d)
**Findings**: F-security-1

**Problema**
> Antes do delta, o frontend fixava explicitamente o `type` do `Blob`
> (`text/plain;charset=latin1`), independente do que o backend mandasse. Depois do delta,
> `res.blob()` herda o `Content-Type` do servidor sem checagem — funciona hoje porque o backend
> responde com `Content-Disposition: attachment`, mas essa é a única camada de defesa restante, e
> ela vive num arquivo fora deste diff.

**Melhoria Proposta**
> Em `baixarRemessa()`, envolver o resultado de `res.blob()` numa whitelist simples (aceitar só
> `text/plain` para este endpoint; qualquer outro `Content-Type` vira erro explícito) — tactic
> **Validate Input** aplicada ao dado que atravessa a fronteira HTTP, tratando o header do servidor
> como entrada externa não confiável por padrão.

**Resultado Esperado**
> O frontend volta a ter uma camada independente de proteção de tipo de conteúdo para o path de
> download financeiro, sem depender só do header do backend. Validação de MIME no cliente: ausente
> → presente, com teste cobrindo um `Content-Type` inesperado.

**Métricas de sucesso**
- Validação de MIME no cliente para este endpoint: ausente → presente
- Teste cobrindo `Content-Type` inesperado: ausente → presente

**Risco de não fazer**
> Baixo isoladamente (mitigado hoje pelo backend), mas acumula débito de defesa-em-profundidade num
> fluxo que lida com CNPJ e dados bancários de fornecedores.

**Dependências**: Nenhuma.
