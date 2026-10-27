---
type: regis-review-kanban
run_id: 2026-10-27-1803-sispag-vinculo-data-divergente
scope: delta ADR-0078 phase 1 (v0.76.0)
total: 14
counts: { p0: 0, p1: 2, p2: 7, p3: 5 }
qas_run: [fault-tolerance, modifiability, security, testability]
qas_skipped: [availability, deployability, integrability, performance]
---

# Kanban — financeiro — 2026-10-27-1803-sispag-vinculo-data-divergente

> Revisão **reduzida**: 4 de 8 QAs. Cada card abaixo vem verbatim do arquivo QA de origem, acrescido de um ID estável (`<qa-slug>-N`).
> Ordem: P0 (nenhum) → P1 (S → XL) → P2 (S → XL) → P3 (S → XL).

---

## P0 — Crítico

_Nenhum. 0 findings P0 nos 4 QAs rodados._

---

## P1 — Alto

### [testability-3] Executar roteiro manual HML antes de habilitar phase 2 em PRD

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (meia-tarde do analista + um worker acompanhando)
**Findings**: F-testability-3

**Problema**
> `ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md` nunca foi executado; v0.76.0 saiu com a cadeia confirmar→gravar→listar observada apenas em mocks. Os CHECKs da migration 0091 (`reconhecimento_tudo_ou_nada_check`, enum do tipo, faixa do motivo, ator ≠ 'sistema') nunca foram vistos sob dados reais.

**Melhoria Proposta**
> Rodar o roteiro em HML (V10 completo + V-HML1 ack phase 1), colar o resultado em `ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md` (seção "Execução — <data>"), e só então abrir `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` em PRD. Tactic alvo: **Executable Assertions** (o roteiro é o único check-list human-in-the-loop vs o banco real).

**Resultado Esperado**
> Execuções registradas do roteiro: 0 → 1 (V-HML1 completo com evidências).

**Métricas de sucesso**
- Execuções do roteiro registradas: 0 → ≥ 1
- CHECKs 0091 observados sob dados reais: 0 → 4

**Risco de não fazer**
> O primeiro reconhecimento em PRD é a primeira execução integrada da regra; se o CHECK estiver mal escrito, o erro aparece como `postgres error 23514` para o analista.

**Dependências**: HML com migration 0091 aplicada (gate independente deste card).

---

### [modifiability-1] Extrair o fluxo de reconhecimento tipado de `BoletoSuggestionService`

**QA**: Modifiability
**Tactic alvo**: Split Module / Refactor
**Esforço**: M
**Findings**: F-modifiability-1

**Problema**
> `BoletoSuggestionService` chegou a 1 287 LOC (+105 nesta feature) absorvendo o reconhecimento tipado da divergência de data (I15r) e o novo `contextoPorTitulo`. O arquivo já era o maior service do SISPAG e a fase 2 (binding real, flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`) vai cair aqui também.

**Melhoria Proposta**
> Aplicar **Split Module**: mover a lógica de reconhecimento tipado (`confirmar` → bloco I15r, `validadeDoReconhecimento`, `contextoPorTitulo`) para um colaborador `ReconhecimentoDecisaoService` já pronto para a fase 2. Manter o `BoletoSuggestionService` apenas como orquestrador transacional. Reaproveitar `ConferenciaReconhecimento` (já extraído).

**Resultado Esperado**
> `BoletoSuggestionService` ≤ 900 LOC no próximo ciclo; novo colaborador 150–250 LOC; teste do novo colaborador independente do setup transacional pesado.

**Métricas de sucesso**
- LOC `BoletoSuggestionService.ts`: 1287 → ≤ 900
- Fan-in de métodos de reconhecimento: direcionados ao novo serviço

**Risco de não fazer**
> Na fase 2 o arquivo passa de 1 400 LOC; conflito de rebase crônico com outras features SISPAG em paralelo (worktree-first amplifica isso).

**Dependências**: feito antes do PR de fase 2 do binding (`SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`).

---

## P2 — Médio

### [fault-tolerance-1] Logar o motivo do fail-closed de `validadeDoReconhecimento`

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking (observabilidade)
**Esforço**: S
**Findings**: F-fault-tolerance-1

**Problema**
> Quando `calcularCenario` lança, o serviço devolve `{}` sem logar — a tela mostra "reconhecimento inválido" sem motivo. Hoje nenhum alarme dispara.

**Melhoria Proposta**
> No `catch`, emitir `logService.warn({type: BUSINESS_WARN, message: 'validade_reconhecimento_indefinida', data: {decisaoId, erro}})`. Manter o retorno `{}` (fail-closed na tela).

**Resultado Esperado**
> 100% das vezes em que `reconhecimentoValido` sai `undefined` por erro ficam no log central, com `decisaoId` e `erro`.

**Métricas de sucesso**
- Erros silenciados em `validadeDoReconhecimento`: 100% → 0%

**Risco de não fazer**
> Incidente silencioso durante fase 2 do ADR-0078, quando o `vinculo_caminho = DATA_DIVERGENTE` passa a depender diretamente desse derivado.

**Dependências**: nenhuma.

---

### [testability-1] Criar teste unitário direto para `ConferenciaReconhecimento`

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> A regra I15r (tabela-de-verdade do reconhecimento tipado) hoje é afirmada só via `BoletoSuggestionService.test.ts`. Qualquer refactor do service que redirecione a chamada apaga toda a cobertura da regra sem CI reclamar. `ConferenciaReconhecimento.ts` tem 93 LOC e 1 chamador — perfil clássico de serviço sem teste direto.

**Melhoria Proposta**
> Criar `src/backend/domain/service/sispag/ConferenciaReconhecimento.test.ts` cobrindo: tipo exigido vs faltante, Δ visto == Δ atual (válido), Δ diverge por 1 dia, valor diverge por 1 centavo, motivo 9 chars (reject) / 10 (accept) / 500 (accept) / 501 (reject), ator 'sistema' (reject), reconhecimento sem exigência (inócuo). Tactic alvo: **Limit Structural Complexity** — teste no ponto da verdade.

**Resultado Esperado**
> Testes diretos de `ConferenciaReconhecimento`: 0 → ≥ 8 casos. Regra I15r coberta nominalmente no arquivo da própria regra, não só no chamador.

**Métricas de sucesso**
- Testes diretos em `ConferenciaReconhecimento.test.ts`: 0 → ≥ 8
- Mapa `_index.json` referencia 1→1 regra I15r a arquivo de teste homônimo

**Risco de não fazer**
> Regressão silenciosa na checagem de motivo/ator chega em PRD junto com phase 2 (quando a gravação for executada).

**Dependências**: nenhuma.

---

### [testability-2] Adicionar testes para `FaixaBloqueadosHoje` e `VencimentoCelula`

**QA**: Testability
**Tactic alvo**: Observe System State
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> Dois componentes alterados neste delta (+90 e +22 LOC) não aparecem em nenhum `.test.tsx`. `FaixaBloqueadosHoje` é o aviso visual de "título com data divergente bloqueado hoje" — comportamento que depende diretamente de I15r/I17p e muda com a prop `prazoBoleto`.

**Melhoria Proposta**
> Criar `FaixaBloqueadosHoje.test.tsx` (render com 0, 1 e N títulos bloqueados; esconder quando lista vazia; mostrar contador) e `VencimentoCelula.test.tsx` (origem `BOLETO_SUGERIDO` vs `TITULO` vs `TITULO_FALLBACK`; marcador "perdido"). Tactic alvo: **Observe System State** no boundary da UI. Usar Testing Library (jest-environment-jsdom já configurado).

**Resultado Esperado**
> Cobertura dos dois componentes: 0 testes → ≥ 6 (3 por componente).

**Métricas de sucesso**
- `grep -l "FaixaBloqueadosHoje\|VencimentoCelula" src/frontend --include="*.test.*"`: 0 → 2

**Risco de não fazer**
> O único canal de feedback visual do estado "exige reconhecimento" degrada sem aviso.

**Dependências**: nenhuma.

---

### [testability-4] Rodar probe HML de rolagem no sábado e armar o caso canônico

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S
**Findings**: F-testability-4

**Problema**
> `PrazoFinalBoleto.test.ts` cobre segunda/sexta identidade, sábado/domingo→segunda, feriado-nacional-segunda e domingo-finados; o caso "sábado isolado adjacente a feriado útil anterior" fica só na probe HML — que não rodou. Phase 2 abre a gravação sob flag; sem a probe, a decisão de habilitar fica empírica-zero.

**Melhoria Proposta**
> Executar `probe-hml-vinculo-data-divergente-rem.ts` no HML em um sábado real adjacente a feriado útil anterior; registrar o par (`barraVenc`, `prazoEfetivo`) e promover o par para `PrazoFinalBoleto.test.ts` como caso nominal "sábado após feriado útil → próxima segunda". Tactic alvo: **Recordable Test Cases**.

**Resultado Esperado**
> Casos no teste unitário: 4 → ≥ 5; probe registrada em `_shared-metrics.md` próximo ciclo.

**Métricas de sucesso**
- Casos em `PrazoFinalBoleto.test.ts`: 4 → ≥ 5
- Execuções da probe sábado: 0 → ≥ 1

**Risco de não fazer**
> Phase 2 abre em feriado colado com sábado e desconta um dia útil silenciosamente da ponta do prazo.

**Dependências**: HML calendário com um sábado após feriado útil disponível na janela.

---

### [modifiability-2] Centralizar aritmética de dia civil em um utilitário puro compartilhado

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> Três sítios novos (`FatorVencimentoBoleto.ts:6`, `ElegibilidadeVinculoCodigoBarras.ts:120-129`, `frontend/prazoTitulo.ts:12-17`) redeclaram `DIA_MS = 86_400_000` e sua própria `diasEntre`/`diferencaDias`. `BankingCalendar` já existe no backend mas não é usado nos novos puros, e o frontend não tem equivalente.

**Melhoria Proposta**
> Criar `domain/libs/calendar/CivilDays.ts` (puro, sem DI) com `diffDays(a: CivilDate, b: CivilDate): number` e `MS_PER_DAY`, e espelho equivalente em `src/frontend/lib/civilDays.ts`. Migrar os 3 sítios novos. Documentar que `BankingCalendar` continua sendo a porta de entrada para "hoje" e rolagem bancária.

**Resultado Esperado**
> 1 função por camada; nome único (`diffDays`); zero `86_400_000` solto no delta.

**Métricas de sucesso**
- Ocorrências de `86_400_000`/`24 * 60 * 60 * 1000` nos novos arquivos: 3 → 0

**Risco de não fazer**
> O próximo cálculo de prazo (fase 2) adiciona um 4º sítio; drift semântico silencioso quando alguém trocar `Math.round` por `Math.trunc`.

**Dependências**: nenhuma.

---

### [modifiability-3] Separar `lerCodigo` em dois caminhos coesos (1:1 vs borderô)

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence / Encapsulate
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> `ElegibilidadeVinculoCodigoBarras.lerCodigo` serve `avaliar` (1:1, retorna `FATOR_VENCIMENTO_DIVERGE`) e `avaliarItemDeBordero` (retorna `BOLETO_INCONSISTENTE`) via default-arg. O chamador do borderô monta um `EntradaElegibilidadeVinculo` com `as` (l.229), o que esconde campos obrigatórios do 1:1.

**Melhoria Proposta**
> Extrair o núcleo de decodificação (`limpo`, `decodificar`, conferência valor/fator) para uma função pura `decodificarCodigo(entrada: EntradaCodigoBarrasBase)` sem default-arg; cada caminho (`avaliar`/`avaliarItemDeBordero`) traduz o resultado para o próprio enum `MotivoInelegivelVinculo` sem herdar campos uns dos outros.

**Resultado Esperado**
> Zero `as EntradaElegibilidadeVinculo`; dois contratos de retorno distintos tipados; mudar ADR-0077 não força leitura de ADR-0078.

**Métricas de sucesso**
- `grep -c "as EntradaElegibilidadeVinculo" src/backend`: 1 → 0
- Default-args em `lerCodigo`: 1 → 0

**Risco de não fazer**
> Tweak em uma das regras (I17d ou I21o) quebra a outra em teste de integração; já quase aconteceu neste delta (ver test suite de 36 LOC só para o novo contrato).

**Dependências**: nenhuma.

---

### [security-2] Cruzar `filCod` do body do `confirmar` com a allow-list de filiais do ator antes da fase 2

**QA**: Security
**Tactic alvo**: Limit Access
**Esforço**: S
**Findings**: F-security-2

**Problema**
> Hoje `POST /sugestoes-boleto/confirmar` só exige a permissão booleana `SISPAG_EXECUTAR`. O `filCod` chega livre pelo corpo. Quando a flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` subir em PRD (fase 2 do ADR-0078), um reconhecimento plantado em filial errada vai alimentar o vínculo real.

**Melhoria Proposta**
> Em `routes/sispag.ts`, aplicar o mesmo guarda de filial já usado em `finalizar`/`gerar remessa` (via `exigirFilialAutorizada(req, body.filCod)`). Tactic: Limit Access.

**Resultado Esperado**
> 100% dos `confirmar` com `filCod` fora da allow-list do ator → 403. Hoje: 0% barrado.

**Métricas de sucesso**
- Endpoints SISPAG mutantes com cheque de filial: parcial → 100%

**Risco de não fazer**
> Quando V-PRD2 ligar `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, um ator de uma filial consegue destravar vínculo de boleto com data divergente em outra.

**Dependências**: precede a liberação de V-PRD2 da fase 2.

---

## P3 — Baixo

### [fault-tolerance-2] Aceitar `Idempotency-Key` na rota de confirmação de sugestão

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> A rota `POST /sispag/sugestao-boleto/confirmar` não lê `Idempotency-Key`. A idempotência de facto está no serviço (unicidade `(ddcCod,ditCod)`), mas sem o header o cliente não distingue "retransmitido" de "primeiro envio".

**Melhoria Proposta**
> Padronizar com `formacao`/`remessa`/`conciliar`: ler o header e propagar para o `LogService` (`idempotencyKey` no `data`) para correlação de retentativas; comportamento do serviço não muda.

**Resultado Esperado**
> Toda confirmação registra `idempotencyKey`; dashboard pode medir taxa de retransmissão.

**Métricas de sucesso**
- Rotas de escrita SISPAG honrando `Idempotency-Key`: 3/4 → 4/4

**Risco de não fazer**
> Perda de observabilidade de duplo-POST acidental em proxies.

**Dependências**: nenhuma.

---

### [testability-5] Property-based test da decodificação do fator de vencimento

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-5

**Problema**
> `FatorVencimentoBoleto.decodificar` tem 8 casos exemplares; o espaço real é 0000..9999 × 1997..2049. A regra "é idempotente e não lê relógio" é afirmada por 1 teste de muting `useFakeTimers`. `fast-check` já é dependência e é usado em outros cantos.

**Melhoria Proposta**
> Adicionar `fc.property(fc.integer({min:0,max:9999}), ..., (f,ref) => decodificar(f,ref)===decodificar(f,ref))` em `FatorVencimentoBoleto.test.ts`, além de uma propriedade "para todo fator válido, `addDays(1997-10-07, fator) === vencimento` dentro do ciclo escolhido". Tactic alvo: **Limit Non-Determinism**.

**Resultado Esperado**
> Propriedades no fator de vencimento: 0 → ≥ 2; cobertura efetiva do domínio sobe de 8 casos para 10⁴.

**Métricas de sucesso**
- Propriedades fast-check em `FatorVencimentoBoleto.test.ts`: 0 → ≥ 2

**Risco de não fazer**
> Baixo; inversão de ciclo passa até alguém se queixar no dia do reinício.

**Dependências**: nenhuma.

---

### [modifiability-4] Enviar `diasAtePrazo` do backend em vez de recomputar no frontend

**QA**: Modifiability
**Tactic alvo**: Use an Intermediary
**Esforço**: S
**Findings**: F-modifiability-4

**Problema**
> `frontend/prazoTitulo.ts:24-29` recalcula `diasAtePrazo` a partir de `diasAteVencimento + diferencaDias(vencimentoTitulo, prazoEfetivo)`. O backend já tem `PrazoBoletoCalculador` com todos os insumos; estender o DTO `PrazoBoleto` com `diasAtePrazo` elimina o espelho de aritmética na UI.

**Melhoria Proposta**
> Adicionar `diasAtePrazoBoleto` ao DTO `PrazoBoleto` em `domain/interface/sispag/PrazoBoleto.ts`, calculado em `PrazoBoletoCalculador` com o `hoje` BRT que o service já recebe. UI apenas lê.

**Resultado Esperado**
> Função pura `diasAtePrazo` sai da UI; cálculo canônico vive só no backend.

**Métricas de sucesso**
- Linhas de aritmética de data em `prazoTitulo.ts`: 29 → ≤ 10

**Risco de não fazer**
> Baixo; incorporar quando mexer na próxima regra de prazo.

**Dependências**: idealmente após [modifiability-2].

---

### [security-1] Redigir/validar `reconhecimento_motivo` antes de persistir

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-1

**Problema**
> O campo `motivo` do reconhecimento (I15r) vira coluna persistente e também viaja no `detalhe` do evento. Sem redação ou allow-list, uma analista cola CPF, cartão ou segredo e esses dados herdam a janela de retenção da trilha SISPAG, que é longa por design (audit trail).

**Melhoria Proposta**
> Em `SugestaoBoletoSchemas.ts`, refinar `motivo` com `.regex()` que recuse sequências que casem com CPF/CNPJ/cartão (ou passar por `ReconhecimentoDivergencia.sanitizarMotivo`) antes de montar `ReconhecimentoConferido`. Tactic: Limit Exposure.

**Resultado Esperado**
> 0 campos `reconhecimento_motivo` contendo match de regex PII em uma amostra de 1k linhas (hoje: não há regra).

**Métricas de sucesso**
- % motivos com PII detectada: desconhecido → 0% (regex server-side)

**Risco de não fazer**
> Um audit LGPD futuro paga o custo de limpar `sispag_decisao_sugestao_boleto` + `sispag_evento_sugestao_boleto`.

**Dependências**: nenhuma.

---

### [security-3] Diretório dedicado e modo 0700 para dumps dos HML probes

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-3

**Problema**
> `probe-hml-vinculo-data-divergente*.ts` escreve em `/tmp/hml-vinculo-data-divergente` sem criar o diretório restrito; arquivos saem com umask padrão. Dumps carregam payloads inteiros do ERP HML.

**Melhoria Proposta**
> Trocar o default por `path.join(os.tmpdir(), 'hml-vinculo-data-divergente')` e criar com `fs.mkdir(OUT, { recursive: true, mode: 0o700 })` antes de qualquer `writeFile`. Tactic: Limit Exposure.

**Resultado Esperado**
> Diretório `/tmp/hml-vinculo-data-divergente` com modo 0700 (hoje 0755) e arquivos sem leitura para `other`.

**Métricas de sucesso**
- Permissão do diretório de dump: 0755 → 0700

**Risco de não fazer**
> Baixo em HML; cria hábito ruim para probes PRD.

**Dependências**: nenhuma.

---
