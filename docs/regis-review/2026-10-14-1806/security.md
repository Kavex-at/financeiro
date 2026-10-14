---
qa: Security
qa_slug: security
run_id: 2026-10-14-1806
agent: qa-security
generated_at: 2026-10-14T18:30:00-03:00
scope: backend
score: 9
findings_count: 4
cards_count: 2
---

# Security — Regis-Review (delta sispag-guarda-codbar-repetido)

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista com `sispag:executar` (ou insider lendo log/ledger) | Geração de remessa de lote com boleto repetido ou ilegível | `BoletoCodigoBarrasRepetidoError`, `RemessaService.verificarCodigoBarrasRepetido`, gate 5.1 do `RemessaCnabValidator`, `respondLoteError` | Produção, remessa real a caminho do banco | Aborta antes de finalizar; só o código mascarado (5+4) sai em message/userMessage/details/stack/ledger/log/HTTP | 0 sequências de 10+ dígitos em qualquer saída; 0 rota nova; 0 escrita nova no ERP |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Campos do erro com saneamento `\d{10,}` | 4 de 4 campos de texto livre (docCod, titCod, vencimento, credor) + mascarado | 100% | ✅ | `BoletoCodigoBarrasRepetidoError.ts` `item`/`mascara` |
| Saídas com código completo (message, userMessage, details, stack) | 0 (teste de rota `not.toMatch(/\d{10,}/)`) | 0 | ✅ | `routes/sispag.test.ts` (novo) |
| Caminhos que montam string de barcode | 3 (erro lote, erro arquivo, log WARN) — todos via `mascarar`/`mascarado` | só mascarado | ✅ | leitura de `RemessaService.ts`, `RemessaCnabValidator.ts` |
| Rotas/permissões novas | 0 (`SISPAG_EXECUTAR` inalterada) | 0 | ✅ | `git diff --stat` (sem diff em `routes/sispag.ts`) |
| Escritas novas no ERP | 0 (só `listarLinhasDigitaveisDoLote`, leitura) | 0 | ✅ | diff de `RemessaService.ts` |
| Itens listados na `message` | cap 20 + "(+N)"; `details`/`userMessage` sem cap | cap em todas as saídas | ⚠️ | `montarMessage` vs `montarUserMessage` |
| Bits do código revelados pela máscara | 5 primeiros (banco 3, moeda 1, DV 1) + 4 últimos do campo livre | mínimo necessário | ⚠️ (aceitável) | `AnaliseCodigoBarrasRepetido.mascarar` |
| Hardcoded secrets / SQL novo / dependências novas | 0 / 0 / 0 | 0 | ✅ | `git diff origin/main` |

> ⚠️ **Não medível localmente**: aparição real de barcode em logs de produção (Render). Requer busca por `\d{10,}` nos logs pós-deploy.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | N/A neste delta (sem alarme novo) | N/A | — |
| Detect Service Denial | N/A | N/A | — |
| Verify Message Integrity | DV mod-10 dos 3 campos + DV geral mod-11 antes de aceitar código; falha fechado | ✅ | `CodigoBarrasBoleto.ts` `paraBarras`/`dvGeralValido` |
| Detect Message Delay | N/A | N/A | — |
| Identify Actors | `ator(req)` inalterado | ✅ | `routes/sispag.ts` |
| Authenticate Actors | inalterado | ✅ | — |
| Authorize Actors | `exigirPermissao(SISPAG_EXECUTAR)` na rota de remessa, sem rota nova | ✅ | `routes/sispag.ts` |
| Limit Access | `details` com docCod/titCod/valor/credor só ao ator que já vê o lote | ✅ | `respondLoteError` |
| Limit Exposure | tipo do erro não tem campo para código completo; máscara 5+4; log só `mascarados` | ✅ | `BoletoCodigoBarrasRepetidoError.ts` |
| Encrypt Data | N/A | N/A | — |
| Separate Entities | análise pura sem I/O, separada do erro e do ledger | ✅ | `AnaliseCodigoBarrasRepetido.ts` |
| Change Default Settings | N/A | N/A | — |
| Validate Input | `paraBarras`: charset `^\d+$`, comprimento exato 44/47, DVs, rejeita prefixo 8; nunca lança; sem alocação proporcional ao input | ✅ | `CodigoBarrasBoleto.ts` |
| Revoke Access / Lock Computer | N/A | N/A | — |
| Inform Actors | `userMessage` em pt-BR com orientação; WARN estruturado | ✅ | erro + `logService.warn` |
| Restore | rascunho preservado; retomada reexecuta a guarda | ✅ | `RemessaService.ts` (2.1) |
| Audit Trail | ledger `failed` com mensagem mascarada; log com loteId/flpCod/contagens | ✅ | `ledger.fail(key, { mensagem })` |

## 4. Findings

### F-security-1: `details` e `userMessage` sem teto de itens (só a `message` tem cap de 20)

- **Severidade**: P2
- **Tactic violada**: Limit Exposure
- **Localização**: `BoletoCodigoBarrasRepetidoError.ts` (`montarUserMessage`, `details = norm`)
- **Evidência (objetiva)**:
  ```
  MAX_TITULOS_NA_MENSAGEM = 20 aplicado só em montarMessage;
  montarUserMessage faz g.itens.map(descreverItem) sem slice; details = norm completo.
  ```
- **Impacto técnico**: lote grande com repetição massiva gera resposta HTTP/toast arbitrariamente longa; credor+valor de todos os itens saem de uma vez.
- **Impacto de negócio**: sem vazamento de segredo (mesmos dados da tela do lote); só ruído e payload. Baixo.
- **Métrica de baseline**: cap 20 na message vs 0 (sem cap) em 2 de 3 saídas; lote medido com 10 títulos × 2 boletos (PEDRONI).

### F-security-2: Saneamento só cobre sequências contíguas de 10+ dígitos

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `BoletoCodigoBarrasRepetidoError.ts` `sanear`/`mascara`
- **Evidência (objetiva)**:
  ```
  sanear = texto.replace(/\d{10,}/g, '…')
  ```
- **Impacto técnico**: código com separadores ("34191.09008 ...") digitado em `credor` ou `mascarado` passaria. Hoje nenhum caller envia isso (credor vem do título local; `mascarado` vem de `mascarar`), então é defesa em profundidade, não vazamento observado.
- **Impacto de negócio**: nenhum observado.
- **Métrica de baseline**: 0 ocorrências nos 3 caminhos de construção; 0 de 305 testes tocados falham o regex.

### F-security-3: Máscara 5+4 revela banco emissor, DV e 4 últimos do campo livre

- **Severidade**: P3 (informativo)
- **Tactic violada**: Limit Exposure
- **Localização**: `AnaliseCodigoBarrasRepetido.mascarar`
- **Evidência (objetiva)**:
  ```
  barras44 = banco(3) moeda(1) DV(1) fator(4) valor(10) livre(25)
  mascarar = slice(0,5) + '…' + slice(-4)  -> banco+moeda+DV + últimos 4 do livre
  ```
- **Impacto técnico**: não identifica a conta do beneficiário (conta/agência ficam no meio do campo livre, fora da janela; valor e vencimento não aparecem). Entropia residual enorme; o DV é derivável do restante e não ajuda a reconstruir. O banco emissor já é visível na tela do lote.
- **Impacto de negócio**: não relevante para fraude; suficiente para a analista distinguir os grupos.
- **Métrica de baseline**: 9 de 44 dígitos expostos (20%), nenhum do bloco valor/fator nem da conta completa.

### F-security-4: Boleto de arrecadação (prefixo 8) vira "ilegível" e bloqueia o lote

- **Severidade**: P3
- **Tactic violada**: Validate Input (efeito colateral de disponibilidade, não brecha)
- **Localização**: `CodigoBarrasBoleto.paraBarras` (`c.startsWith('8')`); `ConexosSispagWriteClient` (`invalidos`)
- **Evidência (objetiva)**:
  ```
  if (!SO_DIGITOS.test(c) || c.startsWith('8')) return undefined;  // => ilegiveis, fail-closed
  ```
- **Impacto técnico**: a segurança está correta (fail-closed); porém concessionária/convênio com `itsNumCodbar` de 48 dígitos já cai em `invalidos` pelo schema do cliente e aborta, mesmo sem repetição. Depende de a Columbia ter esse tipo na carteira BOLETO.
- **Impacto de negócio**: eventual bloqueio de remessa legítima; `SEM_GROUND_TRUTH` de frequência.
- **Métrica de baseline**: não medido (requer contagem em prod de itens BOLETO com prefixo 8).

## 5. Cards Kanban

### [security-1] Aplicar o mesmo teto de 20 itens a userMessage e details

- **Problema**
  > Só a `message` limita a 20 títulos; `userMessage` e `details` listam todos, com credor e valor, e saem na resposta 409.
- **Melhoria Proposta**
  > Em `BoletoCodigoBarrasRepetidoError`, truncar `itens` em `normalizar` (mantendo contagem total `+N`) para as três saídas; opcional: sanear também `mascarado` por regex de dígitos com separadores.
- **Resultado Esperado**
  > Payload do 409 limitado: itens por resposta sem cap → máx. 20 (+N).
- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Itens por saída: ilimitado → ≤ 20
  - Saídas com regex `\d[\d .]{9,}` : 0 → 0 (teste novo com separadores)
- **Risco de não fazer**: toast e resposta enormes em lote grande; defesa em profundidade menor.
- **Dependências**: nenhuma.

### [security-2] Medir prefixo 8 (arrecadação) na carteira BOLETO antes do PR 2

- **Problema**
  > Códigos de convênio (prefixo 8, 48 dígitos) são tratados como ilegíveis e abortam o lote; a frequência real é desconhecida.
- **Melhoria Proposta**
  > Contar em prod itens BOLETO com `itsNumCodbar` iniciando em 8; se > 0, decidir entre tratá-los separadamente (análise por linha de 48) ou manter fail-closed com mensagem própria.
- **Resultado Esperado**
  > Decisão documentada na ADR-0069 com número; sem aborto surpresa.
- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Itens BOLETO prefixo 8 medidos: não medido → número registrado
- **Risco de não fazer**: remessa legítima bloqueada sem explicação específica.
- **Dependências**: acesso de leitura à produção.

## 6. Notas do agente

- Fluxo verificado: `e.message` (já mascarada) alimenta `ledger.fail`; log WARN leva só `mascarados`, contagens e loteId; `respondLoteError` repassa `userMessage`/`details` já saneados. Nenhum P0/P1 no delta.
- Sem rota, permissão, migration, SQL ou escrita ERP novos; `paraBarras` valida charset e comprimento antes de qualquer fatiamento (sem overflow/injeção).
- Cross-QA: Fault Tolerance (fail-closed, Audit Trail), Availability (F-security-4 bloqueio de lote).
