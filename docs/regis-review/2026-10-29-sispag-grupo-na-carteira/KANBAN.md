---
type: regis-review-kanban
run_id: 2026-10-29-sispag-grupo-na-carteira
review_mode: reduced-delta
qas_reviewed: [fault-tolerance, modifiability, security, testability]
total: 15
counts: { p0: 0, p1: 3, p2: 6, p3: 6 }
---

# Kanban — financeiro — 2026-10-29-sispag-grupo-na-carteira

> Review reduzido (4 de 8 QAs) sobre o delta não commitado da feature `sispag-grupo-na-carteira` (base `adfaf786`, v0.78.0). Availability, Deployability, Integrability e Performance **não** rodaram por desenho — não é falha.
>
> **Nenhum P0 presente.** Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado, copiado verbatim das seções QA.
> Ordem: P0 (vazio) → P1 (S → XL) → P2 → P3.

---

## P0 — Crítico

_Nenhum card nesta prioridade. Confirmação explícita pelos 4 agents: o delta não introduz dupla gravação, não cria write path novo e o único caminho que escreve (`confirmar`) continua anti-TOCTOU e, para o novo caso, apenas RECUSA (409)._

---

## P1 — Alto

### [testability-1] Cobrir o fallback real do motor de grupos no `BoletoSuggestionService`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-1, F-testability-5

**Problema**
> O catch de `gruposSugeridos` (que protege `motorGrupo.sugerir` + `CenarioGrupoBoleto.montar/paraMotor1a1`) nunca é exercitado pelo suite. O único teste que diz cobri-lo falha na leitura de marcas, não no motor.

**Melhoria Proposta**
> Acrescentar dois casos a `BoletoSuggestionService.test.ts` (seção "sugestão de grupo na carteira"): (1) `jest.spyOn(motorGrupo, 'sugerir').mockImplementation(() => { throw new Error('boom') })` → listagem volta ao 1:1, `logService.warn` chamado; (2) `jest.spyOn(CenarioGrupoBoleto, 'paraMotor1a1').mockImplementation(() => { throw ... })` → mesmo comportamento. Renomear o teste atual para "falha ao ler marcas não derruba a listagem" (ver testability-5).

**Resultado Esperado**
> Branches de fallback de `gruposSugeridos` cobertos 1/2 → 2/2. Garantia de que a carteira não cai mesmo com crash no motor de grupos.

**Métricas de sucesso**
- Ramos de catch cobertos: 1/2 → 2/2
- Testes com nome fiel ao setup: n−1 → n

**Risco de não fazer**
> Um `TypeError` em `CenarioGrupoBoleto.paraMotor1a1` (p.ex. após uma mudança em `GrupoSugeridoRef`) derruba a carteira inteira em produção sem o CI gritar.

**Dependências**: Nenhuma

---

### [testability-2] Isolar `listTitulosEmLotesComprometidos` como `comprometidosOuNenhum` + teste de rejeição

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism / Sandbox
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> A nova dependência `loteRepo.listTitulosEmLotesComprometidos` entra no `Promise.all` principal sem wrapper tolerante. Qualquer falha (lock, SQL lenta, erro transitório) rejeita toda a listagem, regredindo o comportamento histórico da carteira.

**Melhoria Proposta**
> Espelhar `marcasOuNenhuma`: criar `comprometidosOuNenhum()` que loga `warn` e retorna `[]`, e tratar `[]` como "sem comprometidos" (grupo sugerido pode ser desligado nesta execução). Adicionar teste `h.loteRepo.listTitulosEmLotesComprometidos.mockRejectedValue(...)` que afirma que (a) listagem segue com 1:1, (b) `logService.warn` chamado, (c) `grupoSugerido` ausente nos títulos.

**Resultado Esperado**
> Falha de 1 das 2 leituras novas do grupo deixa de ser falha global: cobertura de 1/2 → 2/2 "soft-degrade reads" na `sugerirAgora`.

**Métricas de sucesso**
- Testes BE do delta: 10 → 11
- Falhas em `listTitulosEmLotesComprometidos` que derrubam a carteira: hoje = total; alvo = 0

**Risco de não fazer**
> Uma SQL "mais pesada" em `com298` leva a página do SISPAG a 500 no horário de corte, sem recuperação automática.

**Dependências**: Nenhuma

---

### [modifiability-1] Fatiar `BoletoSuggestionService` em agregador + extratores de cenário

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-1

**Problema**
> `BoletoSuggestionService` chegou a 1477 LOC e 41 imports; concentra sincronização, cache, confirmação, ancoragem DPS e agora grupo sugerido. Cada feature SISPAG volta aqui.

**Melhoria Proposta**
> Aplicar **Split Module** extraindo o leitor-de-cenário (`sugerirAgora` + `calcularCenario` + dependências de repositório) para um `SugestaoCenarioLoader` injetável; manter em `BoletoSuggestionService` só o contrato público (`listar`, `confirmar`, `anular`, `reconhecer`). Mover `marcasOuNenhuma`, `dpsLidosOuNenhum`, `numerosOuDesligado` para o loader.

**Resultado Esperado**
> `BoletoSuggestionService.ts` < 900 LOC; novo `SugestaoCenarioLoader.ts` ~400 LOC; nenhuma mudança de contrato externo.

**Métricas de sucesso**
- LOC `BoletoSuggestionService.ts`: 1477 → < 900
- Injeções no construtor: 17 → ≤ 10

**Risco de não fazer**
> Em 2 features o arquivo passa de 1700 LOC e vira *bus factor* do Yuri.

**Dependências**: Nenhuma; feito em `/feature-tweak` dedicado.

---

## P2 — Médio

### [fault-tolerance-1] Alarmar quando o fallback das marcas desliga a sugestão de grupo

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-fault-tolerance-2

**Problema**
> Quando `bloqueioRepo.listAtivos` falha, a carteira volta silenciosamente ao 1:1 pré-emenda ADR-0077 e permite confirmar o boleto do grupo para um único título — reintroduzindo o defeito do PRD 2026-10-29. Só há `log.warn`; sem contador nem alarme.

**Melhoria Proposta**
> Instrumentar uma métrica/contagem agregada (ex.: `LogService` com `type: BUSINESS_ERROR` quando o fallback é acionado por N execuções consecutivas, ou expor um gauge "sugestao_grupo_desligada"). Alternativa low-cost: subir o `logService.warn` da leitura de marcas para `error` quando o fallback persistir por mais do que um ciclo do cache (30 s). Toca `BoletoSuggestionService.marcasOuNenhuma` e `gruposSugeridos`.

**Resultado Esperado**
> Analista/operações detectam o degrade em minutos, não só por reclamação do usuário. Métrica observável: `# log.error sugestao_grupo_desligada`: 0 hoje → > 0 quando o fallback ocorre em dias úteis.

**Métricas de sucesso**
- Alarmes de fallback detectados por dia: 0 → ≥ 1 nos dias em que o fallback acontece
- MTTR do defeito "boleto do grupo aparece 1:1" durante incidente de infra: desconhecido → ≤ 15 min

**Risco de não fazer**
> Um incidente de infra sem assinatura em `log.error` pode permitir duplicata de pagamento até a próxima conciliação manual.

**Dependências**: Nenhuma

---

### [security-1] Alarmar e observar quando a leitura de marcas de bloqueio falha

**QA**: Security
**Tactic alvo**: Audit Trail; Detect Intrusion
**Esforço**: S
**Findings**: F-security-1

**Problema**
> Quando `bloqueioRepo.listAtivos()` falha, o `BoletoSuggestionService` desliga silenciosamente toda a sugestão de grupo da execução e devolve 1:1 "normal" para a carteira. Como a guarda de 409 em `confirmarUm` depende do `desfecho.grupoSugerido`, uma falha no leitor abre uma janela em que o analista consegue confirmar 1:1 o boleto que I21v criou para fechar o grupo — exatamente o cenário que o delta foi feito para prevenir. Hoje o único rastro é um `logService.warn` com `BUSINESS_WARN`.

**Melhoria Proposta**
> Elevar o site de `warn` para um sinal observável: incluir métrica/contador (ou tag `grupo_sugerido_desligado=true` propagada até a resposta) e um alarme operacional quando ocorrer N vezes em M minutos. Alternativa mais forte: tratar a falha como erro no `sugerirAgora` (fail-closed) e devolver 503 ao FE em vez de servir 1:1 "normal" sem o guard. Tactic alvo: **Audit Trail + Detect Intrusion**. Arquivos: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1095–1133`.

**Resultado Esperado**
> Qualquer falha na leitura de marcas é detectável em minutos. Taxa de confirmações 1:1 feitas sob falha de bloqueio: 0 (contador/alerta). Alarme com threshold explícito registrado no runbook.

**Métricas de sucesso**
- Contador `sispag.sugestao_grupo_desligada_total`: inexistente → emitido a cada ocorrência
- Janela de confirmação 1:1 sem guard por falha de marcas: desconhecida → 0 (bloqueio ou alarme explícito)

**Risco de não fazer**
> Incidente em que um bug/queda no `BloqueioDuplicidade` abre pagamentos avulsos de boletos que fechariam o grupo, sem ninguém saber que a guarda estava desligada.

**Dependências**: Nenhuma

---

### [security-2] Escopar `listAtivos`/`listTitulosEmLotesComprometidos` por filial do usuário autenticado

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: M
**Findings**: F-security-3

**Problema**
> O cálculo do painel SISPAG (incluindo o novo `grupoSugerido`) lê todos os títulos ativos e todos os lotes comprometidos sem filtro por filial/usuário. O delta não introduz o débito, mas amplia a superfície ao incluir um ponteiro para o grupo sugerido na resposta — mais um atributo multi-filial exposto para qualquer analista com acesso à rota. Quando o SSO corporativo + RBAC do roadmap entrar, esse caminho não suporta a promessa.

**Melhoria Proposta**
> Propagar `filCod[]` do contexto autenticado para `TituloAPagarRepository.listAtivos`, `LoteRepository.listTitulosEmLotesComprometidos` e `BloqueioDuplicidadeRepository.listAtivos`, filtrando o pool antes do motor rodar. Tactic alvo: **Authorize Actors**. Como o delta já encapsulou a montagem em `CenarioGrupoBoleto.montar`, a extensão fica num só ponto para as duas superfícies (carteira + aba Boletos agrupados).

**Resultado Esperado**
> Analista com acesso a filiais X e Y nunca vê `grupoSugerido` (nem título, nem boleto) da filial Z. 0 chaves de outras filiais no payload de `/sispag/sugestoes`.

**Métricas de sucesso**
- % das queries de leitura do painel SISPAG com parâmetro de escopo por usuário: 0% → 100%
- Teste de integração que afirma "usuário sem acesso à filial N não recebe nenhum título/pointer dessa filial": inexistente → presente

**Risco de não fazer**
> Ao ligar o SSO/RBAC, o painel se torna o primeiro vetor de vazamento cross-filial do produto; retrabalho sob pressão.

**Dependências**: Definição do contrato de contexto autenticado (fora deste delta).

---

### [modifiability-2] Mover a reconciliação grupo-vs-1:1 para fora do `MotorSugestaoBoleto`

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> `aplicarGrupoSugerido` / `marcarGrupoSugerido` / `sugestoesValidas` colocam o conhecimento do motor de grupos dentro do motor 1:1. O arquivo cresceu de 1243 → 1374 e passou a ter duas responsabilidades.

**Melhoria Proposta**
> Aplicar **Increase Semantic Coherence**: criar `ReconciliadorGrupoE1a1` (puro) que recebe `{sugestoes, desfechos, gruposSugeridos}` do motor 1:1 e devolve a versão marcada. `MotorSugestaoBoleto` volta a desconhecer `GrupoSugeridoRef` fora do shape de entrada; o reconciliador tem seu próprio arquivo e teste.

**Resultado Esperado**
> `MotorSugestaoBoleto.ts` < 1200 LOC; reconciliador < 200 LOC e testável sem *fixtures* 1:1.

**Métricas de sucesso**
- LOC `MotorSugestaoBoleto.ts`: 1374 → < 1200
- Métodos privados sobre `gruposSugeridos` no motor 1:1: 3 → 0

**Risco de não fazer**
> Próxima regra de interação grupo×1:1 engorda o motor 1:1 inevitavelmente.

**Dependências**: Nenhuma

---

### [modifiability-3] Explicitar a regra "sugestão de grupo não rouba 1:1 forte alheio"

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> `sugestoesValidas` reusa `this.avaliar` + `FORCA` para decidir. A regra I21v fica dependente de internals do avaliador 1:1 e invisível quando se procura "por que o grupo sumiu".

**Melhoria Proposta**
> **Encapsulate**: expor um predicado explícito `rouba1a1Forte(boleto, titulosForaDoGrupo, pares)` em `RegraSugestaoBoleto` (ou análogo) com teste nomeado; `sugestoesValidas` chama o predicado. Logar com `LOG_TYPE.BUSINESS_WARN` o grupo descartado com motivo "colidiria com 1:1 forte alheio".

**Resultado Esperado**
> Grep por "rouba 1:1 forte" encontra 1 função, 1 teste, 1 log — o incidente futuro resolve em minutos.

**Métricas de sucesso**
- Teste nomeado presente: 0 → 1
- Log de grupo descartado por colisão: ausente → emitido

**Risco de não fazer**
> Debug lento no primeiro incidente de I21v em produção.

**Dependências**: Nenhuma

---

### [testability-3] Fechar cobertura de `SITUACOES_QUE_MANTEM` (`ORFA`, `EM_GRUPO`)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> A tabela `SITUACOES_QUE_MANTEM` tem 4 valores. Só `UNICA_SEGURA` e `CONFIRMADA` são provados; `ORFA` e `EM_GRUPO` são regressões ao alcance de um `delete`.

**Melhoria Proposta**
> Em `MotorSugestaoBoleto.grupoSugerido.test.ts`, acrescentar: (1) um título com decisão `CONFIRMADA` **órfã** (sem boleto no pool) dentro de uma sugestão de grupo → `situacao === 'ORFA'`, `grupoSugerido` presente; (2) um título com `grupoBoletoId` (`EM_GRUPO`) dentro de uma sugestão → `situacao === 'EM_GRUPO'`, `grupoSugerido` presente. Pode reusar as fixtures existentes.

**Resultado Esperado**
> Ramos cobertos de `SITUACOES_QUE_MANTEM`: 2/4 → 4/4.

**Métricas de sucesso**
- Testes do motor "preserva situação forte": 2 → 4

**Risco de não fazer**
> Regressão silenciosa em órfã transforma o rótulo "anule o grupo" em "em grupo sugerido", confundindo a analista.

**Dependências**: Nenhuma

---

### [testability-4] Teste de integração do aviso de seleção no `SispagPanel`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S/M
**Findings**: F-testability-4

**Problema**
> `avisoSelecaoGrupoSugerido` tem teste unitário, mas a ligação com `toast.warning` em `page.tsx:774-778` não tem teste — o Q8 depende de inspeção visual.

**Melhoria Proposta**
> Novo arquivo `src/frontend/app/sispag/page.selecao-grupo.test.tsx` (ou acréscimo ao suite existente de `SispagPanel`): mockar `apiFetch` para devolver desfecho `GRUPO_SUGERIDO` para 5541 e disparar `userEvent.click` na checkbox do título. Afirmar `toast.warning` chamado uma vez com descrição do grupo e, ao desmarcar e remarcar, segue chamando (ou não — formalizar a semântica atual: só chama quando não estava selecionado).

**Resultado Esperado**
> Cobertura de componente para o aviso Q8: 0 → 1 caso feliz + 1 caso de guard (`!selecionados.has(...)`).

**Métricas de sucesso**
- Testes de página sobre `toggleSelecao` + grupo sugerido: 0 → 2

**Risco de não fazer**
> Refactor silencioso de `toggleSelecao` apaga o Q8; o incidente que motivou a emenda ADR-0077 de 2026-10-29 volta.

**Dependências**: Nenhuma

---

## P3 — Baixo

### [fault-tolerance-2] Capturar `code` do driver nos warns de fallback

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> `gruposSugeridos` e `marcasOuNenhuma` logam só `err.message`; `code` nativo (pg/axios) some. Dificulta correlacionar o fallback com causas de infra.

**Melhoria Proposta**
> Replicar o helper `codigoDoErro` já existente em `BoletoSuggestionService:887-890` nos dois warns do fallback. Toca `BoletoSuggestionService.marcasOuNenhuma`, `BoletoSuggestionService.gruposSugeridos`, `BoletoSuggestionService.dpsLidosOuNenhum`.

**Resultado Esperado**
> Logs de fallback carregam `codigoErro` quando aplicável. Métrica observável: % de warns de fallback com `codigoErro`: 0 % → ≥ 50 % (quando a origem é pg/driver).

**Métricas de sucesso**
- % warns com `codigoErro` estruturado: 0 → ≥ 50 %

**Risco de não fazer**
> Debugging reativo baseado em `message` apenas; piora MTTR.

**Dependências**: Nenhuma

---

### [fault-tolerance-3] Preservar `totalCandidatos` para títulos em `GRUPO_SUGERIDO`

**QA**: Fault Tolerance (observabilidade de domínio)
**Tactic alvo**: — (observabilidade de domínio)
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> Títulos marcados `GRUPO_SUGERIDO` reportam `totalCandidatos: 0` mesmo tendo candidatos ATENCAO no envelope, porque `alocaveis` filtra à força-1 antes de `alocarDesfechos` contar.

**Melhoria Proposta**
> Separar duas visões em `alocarDesfechos`: `candidatos` exibidos continuam filtrados (I21v impede confirmar), mas `totalCandidatos` conta `pendentes[i].candidatos.length` (não `alocaveis[i].candidatos.length`). Toca `MotorSugestaoBoleto.alocarDesfechos` e `aplicarGrupoSugerido`.

**Resultado Esperado**
> A UI do título `GRUPO_SUGERIDO` pode informar "N candidatos 1:1 disponíveis se o grupo for anulado". Métrica observável: nos títulos de fixture RHENUS, `totalCandidatos`: 0 → > 0 para 5566.

**Métricas de sucesso**
- `totalCandidatos` ≥ número real de candidatos no envelope em todos os testes de `GRUPO_SUGERIDO`

**Risco de não fazer**
> UX ligeiramente opaca; nenhuma consequência financeira.

**Dependências**: Nenhuma

---

### [modifiability-4] Centralizar o mapa de estados `SituacaoSugestaoTitulo`

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-4

**Problema**
> Adicionar `GRUPO_SUGERIDO` custou 6 edições paralelas (2 BE, 4 FE). Nenhum teste força cobertura exaustiva dos mapas (`ROTULO_SITUACAO`, `TOM_SITUACAO`, `SITUACAO_SEM_PAINEL`, `rotulos.ts`).

**Melhoria Proposta**
> **Abstract Common Services**: tipar `ROTULO_SITUACAO` e `TOM_SITUACAO` com `Record<SituacaoSugestaoTitulo, …>` (TypeScript já pede exhaustive) e adicionar teste `expect(Object.keys(ROTULO_SITUACAO)).toEqual(SITUACOES_SUGESTAO_TITULO)` em `sugestaoBoleto.test.ts`.

**Resultado Esperado**
> Adicionar um estado novo passa de 6 edições para 4; esquecer `TOM_SITUACAO` quebra `npm run typecheck`.

**Métricas de sucesso**
- Teste de exaustividade: 0 → 1
- Tempo médio de adicionar estado (observacional): 2 h → 30 min

**Risco de não fazer**
> Pequeno agora, significativo quando a Frente IV também usar máquinas análogas.

**Dependências**: Nenhuma

---

### [modifiability-5] Expor flag `sugestaoGrupoDegradada` no payload da listagem

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-5

**Problema**
> Quando a leitura de `BloqueioDuplicidadeRepository.listAtivos` falha, a listagem volta ao 1:1 antigo sem avisar o cliente; a tela não distingue "não há grupo hoje" de "fallback silencioso".

**Melhoria Proposta**
> **Defer Binding** com contrato: incluir `sugestaoGrupoDegradada?: true` em `ListagemSugestoes`, setado quando `marcasOuNenhuma` retornar `undefined`. FE pinta uma faixa amarela discreta no painel.

**Resultado Esperado**
> Incidente futuro: analista vê imediatamente que a sugestão de grupo está off; não liga para o Yuri.

**Métricas de sucesso**
- Branch de degradação observável no payload: 0 → 1

**Risco de não fazer**
> Silêncio parcial em incidente — a analista não vê que "não há grupo sugerido hoje" é por falha, e não por ausência de candidato.

**Dependências**: Nenhuma

---

### [testability-5] Renomear teste de fallback para refletir o ramo exercitado

**QA**: Testability
**Tactic alvo**: Executable Assertions (clareza)
**Esforço**: S (≤ 15 min)
**Findings**: F-testability-5

**Problema**
> O caso "falha no motor de grupos não derruba a listagem" (`BoletoSuggestionService.test.ts:2046`) na verdade falha a leitura de marcas, não o motor. Falso-positivo semântico.

**Melhoria Proposta**
> Renomear para "falha ao ler marcas de duplicidade não derruba a listagem (sugestão de grupo desligada)" e deixar o teste do motor para o card testability-1.

**Resultado Esperado**
> 0 testes com nome enganoso no suite do delta.

**Métricas de sucesso**
- Testes com rótulo fiel: n−1 → n

**Risco de não fazer**
> Multiplicador cognitivo para bugs futuros.

**Dependências**: Combina com testability-1.
