---
qa: Security
qa_slug: security
run_id: 2026-10-29-sispag-grupo-na-carteira
agent: qa-security
generated_at: 2026-10-29T00:00:00Z
scope: backend+frontend (delta)
score: 8
findings_count: 3
cards_count: 2
---

# Security — Regis-Review (delta sispag-grupo-na-carteira)

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro autenticado | Tenta confirmar 1:1 o boleto que fecha a soma de um grupo sugerido (I21v) | `BoletoSuggestionService.confirmarUm` (`src/backend/domain/service/sispag/BoletoSuggestionService.ts:1283–1295`) | Carteira de títulos lida sob cache do motor; marcas de bloqueio podem falhar na leitura | Lançar `BoletoSuggestionNotAvailableError` (409) com `userMessage` fixa; nenhum dado sensível (linha digitável, emissor, barras) sai no payload | 0 confirmações 1:1 de boleto de grupo sugerido; 0 bytes de PII/credencial no corpo do 409 |

Escopo: APENAS o delta não commitado (base = `adfaf786`, v0.78.0). Verificação de hygiene cross-cutting (secrets, Terraform, IAM) permanece inalterada em relação ao v0.78.0 — fora do escopo do review reduzido.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novas SQL em string com interpolação introduzidas pelo delta | 0 | 0 | ✅ | `git diff HEAD` nos arquivos `src/backend/domain/service/sispag/*.ts` e `CenarioGrupoBoleto.ts` — nenhum `backtick` com SQL + `${}` |
| Novos endpoints / handlers HTTP no delta | 0 | 0 novos endpoints não autenticados | ✅ | `git diff HEAD` em `src/backend/routes/` / `http/` → sem mudança (comportamento reaproveita rota existente de confirmação) |
| Novos secrets / credenciais em texto plano | 0 | 0 | ✅ | `git diff HEAD` — nenhum literal `AKIA`, `password`, `token`, URL com `:password@` |
| Vazamento de dado sensível no corpo do 409 (barras, linha digitável, emissor desmascarado) | 0 (userMessage estática pt-BR + `details` com chaves já conhecidas pelo caller) | 0 | ✅ | `src/backend/domain/errors/BoletoSuggestionNotAvailableError.ts:30–37` + `BoletoSuggestionService.ts:1288–1292` |
| Novos campos de API expostos sem validação Zod no FE | 0 (`grupoSugerido` validado por `grupoSugeridoRefSchema`) | 0 | ✅ | `src/frontend/lib/sispag.ts:2448–2458, 2478–2480` |
| Escopo de filial aplicado no cálculo da sugestão de grupo | **não medível neste delta** (motor opera sobre todos os títulos ativos lidos de `tituloRepo.listAtivos`; delta não altera a leitura) | user-scoping no backend | ⚠️ | `BoletoSuggestionService.ts:1156–1178` — mesmo repo e mesmo filtro de antes |

> ⚠️ **Não medível neste delta**: o escopo de filial por usuário no Express legado. O backend atual expõe o painel SISPAG multi-filial sem filtro por usuário em `listAtivos`; o delta não introduz nem agrava — herda a postura prévia. Investigação profunda é do Regis-Review completo, não deste review reduzido.

## 3. Tactics — Cobertura (apenas o que o delta toca)

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Validate Input | Novo campo `grupoSugerido` validado por `grupoSugeridoRefSchema` antes de uso no FE | ✅ | `src/frontend/lib/sispag.ts:2448–2458` |
| Limit Access | 1:1 do boleto de grupo sugerido é refusado com 409 explícito — fecha a porta ao caminho que pagaria o boleto errado | ✅ | `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1283–1294` |
| Limit Exposure | `GrupoSugeridoRef` publica apenas `ddcCod/ditCod/numeroBoleto/nTitulos/valorBoletoCentavos/confirmavel/motivo` — sem linha digitável, barras ou emissor desmascarado (coerente com I15k) | ✅ | `src/backend/domain/interface/sispag/SugestaoBoleto.ts:383–396` + `CenarioGrupoBoleto.ts:60–75` |
| Audit Trail | Falha ao ler marcas (bloqueios) e falha ao calcular grupo caem em `logService.warn` com `erro: err.message` e tipo `BUSINESS_WARN`; nada do estado da sugestão de grupo é persistido em audit log por si — o audit do pagamento vive na confirmação já existente | ⚠️ parcial | `BoletoSuggestionService.ts:1097–1133` |
| Separate Entities | `CenarioGrupoBoleto` extrai montagem pura e passa a ser **compartilhado** entre `BoletoSuggestionService` e `GrupoBoletoService` — reduz divergência semântica entre as duas superfícies, diminuindo chance de regras de "quem pode ver o quê" ficarem fora de sincronia | ✅ | `src/backend/domain/service/sispag/CenarioGrupoBoleto.ts:33–75`; `GrupoBoletoService.ts:815–829` |
| Authorize Actors | Delta não altera a camada de autorização; herda a de v0.78.0 (allow-list por rota Express) | N/A delta | — |
| Encrypt Data / Detect Intrusion / Revoke Access / Restore | Fora do escopo do delta | N/A | — |

## 4. Findings

### F-security-1: Falha silenciosa na leitura de `BloqueioDuplicidade` desliga toda a sugestão de grupo da execução sem alarme

- **Severidade**: P2
- **Tactic violada**: Audit Trail / Detect Intrusion
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1095–1110`
- **Evidência (objetiva)**:
  ```ts
  private marcasOuNenhuma = async (): Promise<...> => {
      try {
          return await this.bloqueioRepo.listAtivos();
      } catch (err: unknown) {
          await this.logService.warn({
              type: LOG_TYPE.BUSINESS_WARN,
              message:
                  'falha ao ler marcas ativas; sugestão de grupo desligada na carteira nesta execução',
              data: { erro: err instanceof Error ? err.message : String(err) },
          });
          return undefined;
      }
  };
  ```
- **Impacto técnico**: um erro transitório (ou induzido) no `BloqueioDuplicidadeRepository` apaga silenciosamente o `grupoSugerido` do payload: todos os títulos voltam a mostrar o 1:1 "normal", **sem o guard de 409** do `confirmarUm` disparar (porque `desfecho.grupoSugerido` fica indefinido). Como a excepção é apenas `warn` com `BUSINESS_WARN`, não existe alarme nem rate counter.
- **Impacto de negócio**: janela em que o analista confirma 1:1 um boleto que *deveria* ser pago via grupo — exatamente o cenário que o delta foi feito para prevenir. Em termos de blast radius, não cria pagamento duplicado por si (o grupo ainda não entrou no lote), mas re-abre o risco funcional de pagamento parcial que I21v fecha.
- **Métrica de baseline**: 0 alarmes/contadores sobre `message: 'falha ao ler marcas ativas…'` — `grep -rn "marcas ativas" src/backend` encontra apenas o site do `warn`.

### F-security-2: 409 do caminho "boleto é de grupo sugerido" não vaza dado sensível (confirmação positiva)

- **Severidade**: P3 (positivo — serve de baseline para o consolidator)
- **Tactic violada**: — (confirmação de Limit Exposure)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1286–1294` + `src/backend/domain/errors/BoletoSuggestionNotAvailableError.ts:17–37`
- **Evidência (objetiva)**:
  ```ts
  if (doGrupo && doGrupo.ddcCod === chave.ddcCod && doGrupo.ditCod === chave.ditCod) {
      throw new BoletoSuggestionNotAvailableError({
          ...chave,
          motivo:
              'Este boleto fecha a soma de um grupo sugerido (vários títulos do credor): ' +
              'confirme o grupo na aba Boletos agrupados em vez de confirmá-lo 1:1.',
      });
  }
  ```
  O erro expõe apenas `userMessage` fixa + `details` com `filCod/docCod/titCod/ddcCod/ditCod` (todos originados do próprio request). Nenhum `linhaDigitavel`, `codigoBarras`, nem `emissor` cru.
- **Impacto técnico**: nenhum — comportamento preservado.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 0 campos sensíveis no payload do 409 (medido por inspeção direta do construtor do erro).

### F-security-3: Pointer `GrupoSugeridoRef` herda a (falta de) escopo-por-filial do painel SISPAG legado

- **Severidade**: P2 (débito pré-existente, apenas ampliado em superfície)
- **Tactic violada**: Authorize Actors (tenant/filial scoping no backend)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1156–1200` (leitura `tituloRepo.listAtivos` sem filtro por usuário) + `src/backend/domain/interface/sispag/SugestaoBoleto.ts:383–396` (novo campo exposto)
- **Evidência (objetiva)**:
  ```ts
  // sugerirAgora()
  this.tituloRepo.listAtivos(),
  ...
  this.loteRepo.listTitulosEmLotesComprometidos(),
  ```
  Nenhuma dessas chamadas recebe `usuario`/`filCod` do caller. O resultado é consumido pelo motor e devolvido inteiro no `grupoSugerido` ao FE.
- **Impacto técnico**: um analista com acesso ao painel vê `ddcCod/ditCod/numeroBoleto/nTitulos/valorBoletoCentavos` de qualquer filial. **Não é introduzido** pelo delta — os títulos, boletos e `desfecho` já voltavam multi-filial no v0.78.0; o novo campo é só mais um atributo da mesma linha. Mas a superfície cresce.
- **Impacto de negócio**: baixo em curto prazo (os valores já apareciam na mesma listagem); relevante para quando o SSO corporativo + RBAC entrar (requisito do produto). Fica anotado para o Regis-Review completo.
- **Métrica de baseline**: 0 chamadas de `listAtivos`/`listTitulosEmLotesComprometidos` com parâmetro de escopo por usuário no delta nem na base.

## 5. Cards Kanban

### [security-1] Alarmar e observar quando a leitura de marcas de bloqueio falha

- **Problema**
  > Quando `bloqueioRepo.listAtivos()` falha, o `BoletoSuggestionService` desliga silenciosamente toda a sugestão de grupo da execução e devolve 1:1 "normal" para a carteira. Como a guarda de 409 em `confirmarUm` depende do `desfecho.grupoSugerido`, uma falha no leitor abre uma janela em que o analista consegue confirmar 1:1 o boleto que I21v criou para fechar o grupo — exatamente o cenário que o delta foi feito para prevenir. Hoje o único rastro é um `logService.warn` com `BUSINESS_WARN`.
- **Melhoria Proposta**
  > Elevar o site de `warn` para um sinal observável: incluir métrica/contador (ou tag `grupo_sugerido_desligado=true` propagada até a resposta) e um alarme operacional quando ocorrer N vezes em M minutos. Alternativa mais forte: tratar a falha como erro no `sugerirAgora` (fail-closed) e devolver 503 ao FE em vez de servir 1:1 "normal" sem o guard. Tactic alvo: **Audit Trail + Detect Intrusion**. Arquivos: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1095–1133`.
- **Resultado Esperado**
  > Qualquer falha na leitura de marcas é detectável em minutos. Taxa de confirmações 1:1 feitas sob falha de bloqueio: 0 (contador/alerta). Alarme com threshold explícito registrado no runbook.
- **Tactic alvo**: Audit Trail; Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Contador `sispag.sugestao_grupo_desligada_total`: inexistente → emitido a cada ocorrência
  - Janela de confirmação 1:1 sem guard por falha de marcas: desconhecida → 0 (bloqueio ou alarme explícito)
- **Risco de não fazer**: incidente em que um bug/queda no `BloqueioDuplicidade` abre pagamentos avulsos de boletos que fechariam o grupo, sem ninguém saber que a guarda estava desligada.
- **Dependências**: nenhuma.

### [security-2] Escopar `listAtivos`/`listTitulosEmLotesComprometidos` por filial do usuário autenticado

- **Problema**
  > O cálculo do painel SISPAG (incluindo o novo `grupoSugerido`) lê todos os títulos ativos e todos os lotes comprometidos sem filtro por filial/usuário. O delta não introduz o débito, mas amplia a superfície ao incluir um ponteiro para o grupo sugerido na resposta — mais um atributo multi-filial exposto para qualquer analista com acesso à rota. Quando o SSO corporativo + RBAC do roadmap entrar, esse caminho não suporta a promessa.
- **Melhoria Proposta**
  > Propagar `filCod[]` do contexto autenticado para `TituloAPagarRepository.listAtivos`, `LoteRepository.listTitulosEmLotesComprometidos` e `BloqueioDuplicidadeRepository.listAtivos`, filtrando o pool antes do motor rodar. Tactic alvo: **Authorize Actors**. Como o delta já encapsulou a montagem em `CenarioGrupoBoleto.montar`, a extensão fica num só ponto para as duas superfícies (carteira + aba Boletos agrupados).
- **Resultado Esperado**
  > Analista com acesso a filiais X e Y nunca vê `grupoSugerido` (nem título, nem boleto) da filial Z. 0 chaves de outras filiais no payload de `/sispag/sugestoes`.
- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - % das queries de leitura do painel SISPAG com parâmetro de escopo por usuário: 0% → 100%
  - Teste de integração que afirma "usuário sem acesso à filial N não recebe nenhum título/pointer dessa filial": inexistente → presente
- **Risco de não fazer**: ao ligar o SSO/RBAC, o painel se torna o primeiro vetor de vazamento cross-filial do produto; retrabalho sob pressão.
- **Dependências**: definição do contrato de contexto autenticado (fora deste delta).

## 6. Notas do agente

- Review reduzido: só o delta não commitado em `/.../worktrees/sispag-grupo-na-carteira`. Secret hygiene, Terraform, IAM, GuardDuty, CloudTrail não re-examinados — o delta não os toca.
- Verifiquei explicitamente que **nenhuma SQL nova** foi introduzida: todas as leituras adicionais (`bloqueioRepo.listAtivos`, `loteRepo.listTitulosEmLotesComprometidos`, `grupoRepo.listarConfirmados`) já existiam no v0.78.0 com SQL parametrizado.
- O 409 do caminho novo (F-security-2) está limpo: `userMessage` é string estática, `details` só repete as chaves que o próprio caller mandou. Nada de linha digitável/emissor cru vaza.
- Cross-QA para o consolidator: F-security-1 encosta em **Fault Tolerance** (fail-open vs fail-closed numa dependência de leitura) e em **Observability**; F-security-3 encosta em **Modifiability** (contrato de autorização pendente) e em **Testability** (teste de scoping ausente).
- Não há P0 defendível neste delta: as mudanças de superfície ou são leitura (sem write path novo) ou são um refusal 409 explícito que fortalece o invariante de pagamento.
