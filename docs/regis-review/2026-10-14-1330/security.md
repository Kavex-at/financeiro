---
qa: Security
qa_slug: security
run_id: 2026-10-14-1330
agent: qa-security
generated_at: 2026-10-14T13:30:00-03:00
scope: backend
score: 7.5
findings_count: 5
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta sispag-sugestao-boleto-dda)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado com `sispag:ver` (ou sessão roubada / script) | Colher linhas digitáveis em massa ou forçar uma decisão que valide um boleto de terceiro para um credor | `routes/sispag.ts` (6 rotas novas), `BoletoSuggestionService`, tabelas 0084, `GET /sispag/boletos-dda` | Produção, single-tenant Columbia, JWT Supabase/app + `exigirPermissao` | Autorizar por permissão, ator só do JWT, cópia auditada fail-closed, decisão como evidência (sem escrita no Conexos), trilha só-inclusão | 100% das cópias via `copiar-linha` com `LINHA_COPIADA` gravado antes da resposta; 0 caminho de decisão que escreva no Conexos; 0 vazamento de barras/linha em log/coluna |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas no delta | 6 (3 `ver`: 2 GET + 1 POST copiar-linha; 3 `executar`: confirmar, rejeitar, revogar) | 100% com `exigirPermissao` | ✅ 6/6 | `routes/sispag.ts:773-914` |
| Rotas novas com body Zod `.strict()` | 4/4 POST (ator no body = 400) | 100% | ✅ | `SugestaoBoletoSchemas.ts` |
| Rotas novas com rate limit | 4/6 (3 decisões + copiar-linha); 2 GET sem limiter | 100% das rotas que devolvem dado sensível | ⚠️ | `routes/sispag.ts` (limiteDecisaoBoleto / limiteCopiaLinha) |
| Limite de cópia | 30/min por `sub`, balde próprio | — | ✅ (MemoryStore por processo) | `http/rateLimit.ts` |
| Ator vindo do body/query | 0 sítios; `ator(req)` = `req.user.sub` (username) e `exigirAtor` recusa `sistema`/`unknown`/vazio | 0 | ✅ | `routes/sispag.ts:149`, `BoletoSuggestionService.ts:64,578` |
| Sítios de log tocando dado de boleto no delta | 5 (`logService` em Service); 0 contêm barras/linha; só chave do título, máscara, ator, `codigoErro` | 0 com barras/linha | ✅ | `grep logService BoletoSuggestionService.ts` |
| Colunas que podem guardar barras/linha | 0 colunas dedicadas; mas 0 CHECKs de formato (só teste de regex por nome de coluna); texto livre: `motivo` (≤500, Zod), `numero_boleto` | CHECK/validador de padrão | ⚠️ | `0084_*.sql`, `0084_*.test.ts:136` |
| SQL parametrizado (interpolação em template com variável) | 0 sítios | 0 | ✅ | `grep '\${' SugestaoBoletoRepository.ts` |
| Trigger append-only (UPDATE/DELETE/TRUNCATE) na trilha | 1 tabela, 3 operações cobertas; 24 testes de integração na 0084 | 100% | ✅ | `0084_*.sql:156-176` |
| Cache-Control no-store em `copiar-linha` | presente (sucesso); POST, linha fora da URL | presente | ✅ | `routes/sispag.ts:866` |
| Rotas que devolvem linha digitável sem trilha | 1 (`GET /boletos-dda`, estado aceito) sem limiter e sem auditoria | 0 (ou compensação) | ⚠️ aceito | `routes/sispag.ts:1046` |
| Escopo por filial (`req.user.filiais`) nas rotas novas | 0 de 6 usam | — | ⚠️ (igual ao restante do SISPAG) | `grep filiais routes/sispag.ts` = 0 |
| Segredos/credenciais no delta | 0 | 0 | ✅ | revisão do diff |
| `npm audit` | ⚠️ **Não medível**: fora do escopo do delta; sem dependência nova no diff | — | — | — |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Eventos `LINHA_COPIADA`/decisões com ator e hora; sem alarme de volume | ⚠️ parcial | `sispag_sugestao_boleto_evento`, índice `(ator,tipo,ocorrido_em)` |
| Detect Service Denial | Rate limit 30/min nas rotas de decisão/cópia | ⚠️ parcial (GET sem limiter) | `rateLimit.ts` |
| Verify Message Integrity | Releitura anti-TOCTOU do banco na confirmação; CHECKs | ✅ | `BoletoSuggestionService.ts:reler` |
| Detect Message Delay | N/A: sem mensagens assíncronas; defasagem do DDA já exibida (`ddaDefasadoHoras`) | N/A | — |
| Identify Actors | `sub`=username do banco (reescrito por `resolverAcesso`); CHECK `<> 'sistema'` no ator | ✅ | `acesso.ts:195`, 0084 CHECKs |
| Authenticate Actors | Middleware existente (JWT) a montante | ✅ | `http/auth.ts` |
| Authorize Actors | `ver` leitura/cópia, `executar` decisão; matriz testada | ✅ | `routePermissions.test.ts` |
| Limit Access | Sem escopo por filial; qualquer `ver` copia linha de qualquer filial | ⚠️ parcial | F-security-3 |
| Limit Exposure | Emissor mascarado na listagem; `emissorChave` removida da API; barras/linha nunca em listagem | ✅ | `decisaoParaApi`, `paraView` |
| Encrypt Data | TLS/at-rest herdados (Supabase); `emissor_chave` completa (banco:agência:conta) em claro no banco | ⚠️ parcial | F-security-4 |
| Separate Entities | Evidência separada de autoridade; passo 1 sem escrita no Conexos | ✅ | ADR-0068 I15a/b |
| Change Default Settings | N/A | N/A | sem default novo |
| Validate Input | Zod `.strict()` nos bodies; query Zod; `id` UUID; motivo ≤500 | ✅ | `SugestaoBoletoSchemas.ts` |
| Revoke Access | `revogar` do par com motivo, versão otimista, no-op idempotente | ✅ | `revogarPar` |
| Lock Computer | N/A: sem bloqueio de conta no delta | N/A | — |
| Inform Actors | 409/422/503 nomeados com `userMessage` em pt-BR e `details` apenas chave do título | ✅ | `BoletoSuggestionNotAvailableError` |
| Audit Trail | Trilha só-inclusão com trigger; INSERT na mesma transação da decisão | ✅ (com a lacuna aceita do GET) | 0084 |
| Restore | Migration aditiva + rollback; trilha não restaura estado | ✅ | `rollbacks/0084_*.rollback.sql` |

## 4. Findings (achados)

### F-security-1: Trilha de cópia contornável por `GET /boletos-dda` (estado aceito, risco residual sem compensação)

- **Severidade**: P2 (aceito pelo mantenedor; registrado por exigir baseline de compensação)
- **Tactic violada**: Audit Trail / Detect Service Denial
- **Localização**: `routes/sispag.ts:1046-1059` vs `:856-872`
- **Evidência (objetiva)**:
  ```
  copiar-linha: ver + limiter 30/min por sub + LINHA_COPIADA fail-closed
  GET /boletos-dda: ver, SEM limiter, SEM evento, página ≤100 linhas com linhaDigitavel
  ```
- **Impacto técnico**: um insider/sessão roubada com `ver` pagina o pool inteiro sem deixar rastro; o controle fail-closed protege só quem escolhe a rota auditada.
- **Impacto de negócio**: a linha digitável é meio de pagamento (um boleto adulterado trocado no remessa é perda financeira); a promessa "toda cópia é auditada" vale só para a UI nova. Mitigação existente: a validação ao vivo da remessa (ADR-0040) e o fato de a linha vir do `fin124`, não do usuário.
- **Métrica de baseline**: 1 rota (de 2 que devolvem linha) sem trilha e sem limiter; 953 títulos BOLETO não flagados no escopo.

### F-security-2: Nenhum CHECK/validador impede barras (44) ou linha (47) em texto livre

- **Severidade**: P2
- **Tactic violada**: Limit Exposure / Validate Input
- **Localização**: `0084_sispag_sugestao_boleto.sql` (`motivo`, `numero_boleto`, `motivo_revogacao`, `detalhe`, `evidencia`)
- **Evidência (objetiva)**:
  ```
  teste: expect(CODIGO).not.toMatch(/\b(codbar|linha_digitavel|codigo_barras)\s+TEXT/i)  -- só nome de coluna
  RejeitarSugestaoBodySchema: motivo: z.string().max(500)   -- sem rejeitar 44/47 dígitos
  ```
- **Impacto técnico**: um analista que cola a linha digitável no campo "motivo" a persiste na tabela de decisões e na trilha (append-only: nunca removível) e, via `GET /confirmacoes-emissor`, `motivoRevogacao` volta na API.
- **Impacto de negócio**: a invariante I15k ("nunca a linha completa em ledger/evidência") vira convenção, e a trilha imutável impede corrigir.
- **Métrica de baseline**: 3 campos de texto livre (≤500 chars) sem validação de padrão; 0 CHECKs `~ '\d{44}'`.

### F-security-3: Confirmação não é escopada por filial e qualquer `ver` copia a linha de qualquer título

- **Severidade**: P2
- **Tactic violada**: Limit Access
- **Localização**: `routes/sispag.ts:773-914`; `BoletoSuggestionService.copiarLinha`
- **Evidência (objetiva)**:
  ```
  grep -c "filiais" routes/sispag.ts  -> 0 ; copiarLinha só chama reler(): aceita QUALQUER par título×boleto ativo
  ```
- **Impacto técnico**: `copiarLinha` não exige que o par seja uma sugestão do motor; a chave (título, boleto) é arbitrária. O evento registra o par escolhido, não uma sugestão real, o que dilui o valor forense. A claim `filiais` existe no token mas nenhuma rota SISPAG a usa (postura herdada).
- **Impacto de negócio**: analista da filial A confirma/rejeita título da filial B; atribuição auditável, mas sem barreira.
- **Métrica de baseline**: 0/6 rotas novas filtram por `req.user.filiais`.

### F-security-4: Chave do emissor (banco:agência:conta) completa em claro em 3 tabelas

- **Severidade**: P3
- **Tactic violada**: Encrypt Data / Limit Exposure
- **Localização**: `0084` — `emissor_chave` em `sispag_confirmacao_emissor_boleto`, `sispag_decisao_sugestao_boleto`, `sispag_sugestao_boleto_evento`
- **Evidência (objetiva)**: `chave: \`${banco}:${agencia}:${conta}\`` (`CodigoBarrasBoleto.ts`); API remove via `decisaoParaApi`/`paraViewPar` (mitigado na saída).
- **Impacto técnico**: conta bancária de credor identificável no banco e nas linhas append-only (não anonimizáveis/LGPD-eliminação difícil). Sem uso fora do backend.
- **Impacto de negócio**: dado de terceiro retido para sempre na trilha; baixo risco de vazamento, custo de eliminação alto.
- **Métrica de baseline**: 3 tabelas, 1 delas imutável.

### F-security-5: Confirmação em tier ATENCAO cria par vigente que rotula próximos boletos como CONHECIDO (lavagem de evidência) e chave GENERICA colide

- **Severidade**: P2
- **Tactic violada**: Verify Message Integrity / Authorize Actors
- **Localização**: `BoletoSuggestionService.confirmar` (par criado em qualquer tier confirmável), `RegraSugestaoBoleto.avaliar` (`parConfirmado` → CONHECIDO), `CodigoBarrasBoleto.emissor` (chave `banco:8 primeiros do campo livre`)
- **Evidência (objetiva)**:
  ```
  CONFIRMAVEIS = {CONHECIDO, FORTE, ATENCAO}; inserirPar() sem diferenciar tier
  GENERICO: chave = `${banco}:${livre.slice(0,8)}`  (prefixo, não conta)
  medido: ATENCAO 4 de 953 candidatos; FORTE 248
  ```
- **Impacto técnico**: uma confirmação "ATENCAO" (Δ até R$10/2%, ±10 dias) torna o par (credor, emissor) vigente; boletos futuros desse emissor sobem para CONHECIDO dentro dos limites globais (não os alarga, I15d). Em bancos ≠ 341/237 a chave é um prefixo que pode coincidir entre emissores distintos, então o par "vale" para boleto de outro cedente. Hoje só rotula (passo 1); vira risco real se o passo 3 consumir o par.
- **Impacto de negócio**: evidência humana "lavada" de uma decisão de baixa confiança; o passo 3 precisa tratar GENERICO como não-elegível (já previsto) e ATENCAO como não-semente de par.
- **Métrica de baseline**: 4 ATENCAO confirmáveis hoje (0,4% de 953); risco latente, não explorado.

## 5. Cards Kanban

### [security-1] Compensar a lacuna do GET /boletos-dda: rate limit e contagem de leitura

- **Problema**
  > `GET /boletos-dda` devolve a linha digitável a `sispag:ver` sem limiter e sem trilha, esvaziando o controle fail-closed de `copiar-linha`. É estado aceito, mas sem nenhum controle compensatório.

- **Melhoria Proposta**
  > Aplicar o mesmo limiter por `sub` (ou um balde "listagem" de ex. 60/min) e um evento agregado `LISTAGEM_LINHAS` (ator, página, nº de linhas) com `Cache-Control: no-store`. Não muda a decisão do mantenedor de manter `ver`.

- **Resultado Esperado**
  > Colheita em massa passa a ser limitada e visível: rotas com linha sem limiter 1 → 0; evento de listagem por usuário consultável.

- **Tactic alvo**: Detect Service Denial / Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Rotas que devolvem linha sem limiter: 1 → 0
  - Eventos de leitura em massa auditáveis: 0 → 1 tipo
- **Risco de não fazer**: um insider extrai o pool de boletos sem rastro por 6 meses.
- **Dependências**: nenhuma (mantém a decisão ADR-0053).

### [security-2] Rejeitar texto livre com 44 ou 47 dígitos em motivo e campos persistidos

- **Problema**
  > `motivo`/`motivo_revogacao` aceitam qualquer texto ≤500 e vão para tabelas e para a trilha imutável; colar a linha digitável viola I15k de forma irreversível.

- **Melhoria Proposta**
  > Refinar o Zod (rejeitar `\d{44}|\d{47}` com pontuação opcional) nos bodies `rejeitar`/`revogar` e adicionar CHECK `motivo !~ '\d{44}'` na 0085 para `motivo`, `motivo_revogacao`, `numero_boleto`.

- **Resultado Esperado**
  > 0 caminho para persistir barras/linha; teste de integração com payload de 47 dígitos retorna 400.

- **Tactic alvo**: Validate Input / Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Campos de texto livre sem validador de padrão: 3 → 0
- **Risco de não fazer**: dado sensível imutável na trilha, sem remoção possível.
- **Dependências**: nova migration aditiva.

### [security-3] Exigir que copiar-linha e confirmar operem só sobre sugestão vigente e respeitem filial

- **Problema**
  > `copiarLinha` aceita par título×boleto arbitrário (basta estar ativo), e nenhuma rota usa `req.user.filiais`; o evento registra um par que o motor nunca sugeriu.

- **Melhoria Proposta**
  > Em `copiarLinha`, exigir que (título, boleto) seja sugestão do motor (ou ao menos o boleto estar livre e o título elegível) e, se `req.user.filiais` existir, recusar `filCod` fora dele nas 6 rotas (guarda única no router).

- **Resultado Esperado**
  > Auditoria de cópia ligada a sugestão real; 0/6 → 6/6 rotas com escopo de filial quando a claim existe.

- **Tactic alvo**: Limit Access / Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Rotas novas com escopo de filial: 0/6 → 6/6
- **Risco de não fazer**: separação por filial inexistente quando o RBAC por filial for exigido.
- **Dependências**: decisão do mantenedor sobre semântica de `filiais` no SISPAG.

### [security-4] Impedir que confirmação ATENCAO/GENERICO vire semente de par vigente para o passo 3

- **Problema**
  > Qualquer tier confirmável cria o par (credor, emissor); a chave genérica é só prefixo do campo livre e pode colidir entre cedentes. Hoje só rotula CONHECIDO; o passo 3 poderia automatizar sobre ela.

- **Melhoria Proposta**
  > Registrar `tier_origem` no par e exigir CONHECIDO/FORTE para que o par conte como `parConfirmado` em automático; manter GENERICO fora do automático (já) e exibir aviso de colisão. Documentar no ADR-0068 como pré-condição do passo 3.

- **Resultado Esperado**
  > Pares originados em ATENCAO/GENERICO nunca promovem tier nem entram em automação sem reconfirmação.

- **Tactic alvo**: Verify Message Integrity
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-5, F-security-4
- **Métricas de sucesso**:
  - Pares com `tier_origem` ATENCAO elegíveis a promoção: n/a → 0
- **Risco de não fazer**: uma decisão de baixa confiança vira autoridade quando o passo 3 consumir os pares.
- **Dependências**: desenho do passo 3.

## 6. Notas do agente

- Escopo: só o delta; decisões do mantenedor (par+título, `ver` copia com trilha, GET `ver` sem trilha, GENERICO nunca automático) não foram reabertas — F-security-1 só mede o risco residual.
- Nenhum P0/P1: o delta não escreve no Conexos, ator só do JWT, SQL parametrizado, trilha fail-closed e append-only, logs sem barras/linha. `npm audit` não medível (sem dependência nova).
- Cross-QA: Audit Trail (F-1) com Fault Tolerance (fail-closed 503 quando a trilha falha); Validate Input (F-2) com Integrability; F-5 com Testability (falta teste de promoção por par ATENCAO).
- Limiter usa MemoryStore por processo: efetivo apenas em instância única (Render); com 2+ instâncias o teto de 30/min multiplica.
