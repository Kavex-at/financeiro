---
type: regis-review-kanban
run_id: 2026-09-29-0104
total: 28
counts: { p0: 0, p1: 5, p2: 18, p3: 5 }
---

# Kanban — financeiro — 2026-09-29-0104

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Dentro de mesma prioridade e esforço, ordem por QA (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability).
> Escopo: feature `sispag-ted-pix` (ADR-0054). Nenhum agente QA reportou P0. O P0 do gate PatternGuardian do mesmo ciclo (logger global imprimindo o corpo de `POST .../destino`) já foi remediado no commit `e8cb1e5` e por isso não gera card (ver REPORT.md, seção 1).
> Cards sobrepostos (modifiability-1 / integrability-3 / testability-2; performance-1 / performance-3 / fault-tolerance-2 / availability-1) foram mantidos como escritos pelos agentes; ver REPORT.md seção 3 para a execução consolidada.

---

## P0 — Crítico

_Nenhum card neste ciclo (ver nota no topo sobre o P0 do PatternGuardian, já remediado)._

---

## P1 — Alto

### [security-1] Sanear erro cru nos jobs (nunca logar AxiosError inteiro)

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-5

**Problema**
> Cerca de 10 jobs terminam com `console.error(e)`; em falha de login do Conexos o AxiosError inclui `config.data` com a senha. Pré-existente.

**Melhoria Proposta**
> Criar helper de erro seguro (mensagem + status, sem `config`/`request`) e usar nos jobs; teste que falha em `console.error(e)` cru em `src/backend/jobs`. Tactic: Limit Exposure.

**Resultado Esperado**
> 10 arquivos com log cru para 0, com teste de regressão.

**Métricas de sucesso**
- jobs com `console.error(e)`: 10 → 0

**Risco de não fazer**
> A próxima falha de login imprime a senha do robô em log retido.

**Dependências**: nenhuma

---

### [testability-1] Gravar goldens de `.REM` TED/PIX após o PRD supervisionado

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> O delta gera TED/PIX sem nenhum golden aceito pelo banco (0 de 6 hipóteses com evidência gravada). Os testes atuais concordam com o próprio gerador, então um erro de layout só aparece na rejeição em produção.

**Melhoria Proposta**
> Depois de cada teste supervisionado (checklist do tasks.md), capturar o `.REM` enviado e o retorno do banco, mascarar dados sensíveis e gravar como fixture (Recordable Test Cases). Adicionar testes golden byte a byte para o TED e o PIX em `RemessaService.test.ts` (ou arquivo à parte) e ligar `RemessaCnabValidator` ao mesmo golden. Manter as flags OFF até o golden existir.

**Resultado Esperado**
> Goldens aceitos pelo banco de 0 para ≥ 2 (TED, PIX); hipóteses H1, H3–H7 com evidência gravada de 0/6 para 6/6.

**Métricas de sucesso**
- Goldens TED/PIX aceitos pelo banco: 0 → 2
- Hipóteses com evidência gravada: 0/6 → 6/6

**Risco de não fazer**
> regressão de layout no `.REM` passa verde em CI e só é descoberta com rejeição bancária em PRD.

**Dependências**: execução do PRD supervisionado (probe `probe-sispag-ted-pix-supervisionado.ts`).

---

### [modifiability-2] Separar edição de destino do LotePagamentoService

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: M
**Findings**: F-modifiability-2

**Problema**
> O service ganhou +238 LOC misturando ciclo de vida do lote e destino manual (676 LOC, 22 imports).

**Melhoria Proposta**
> Increase Semantic Coherence: criar `DestinoItemService` com `definirDestinoManualItem`/`limparDestinoManualItem` e `atualizarModalidadeItem`, delegando ao Resolver/Validator.

**Resultado Esperado**
> LotePagamentoService 676 → ≤ 450 LOC; imports 22 → ≤ 15.

**Métricas de sucesso**
- LOC: 676 → ≤ 450
- Imports: 22 → ≤ 15

**Risco de não fazer**
> Regras de destino evoluem dentro do serviço mais crítico de lotes.

**Dependências**: Nenhuma.

---

### [fault-tolerance-3] Criar reaper de lotes presos e reconciliação diária com o fin015

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring / Reconcile
**Esforço**: M
**Findings**: F-fault-tolerance-4

**Problema**
> Lote com `nativeFlpCod` e sem `.REM` (ou ledger em `reconciling`) só é tratado se a analista reenviar. Não há job que detecte a idade do estado nem que compare o que acreditamos ter enviado com o ERP.

**Melhoria Proposta**
> Job diário (o scheduler ainda não existe, então começar como script em `jobs/` com cron do GitHub Actions) que lista ledgers abertos há mais de N horas e lotes finalizados sem retorno, e os publica no painel de operação como bloqueados. Nunca reexecuta escrita, apenas sinaliza. Depois comparar `nativeFlpCod` contra `getLoteNativo` para detectar divergência.

**Resultado Esperado**
> Todo lote preso vira item visível em até 24 h. Jobs de detecção de estado preso: 0 → 1.

**Métricas de sucesso**
- Idade máxima de um lote preso sem alerta: ilimitada → 24 h

**Risco de não fazer**
> pagamentos atrasados sem ninguém notar, e o painel mostrando um estado que o ERP não confirma.

**Dependências**: decisão sobre o scheduler (Render cron versus GitHub Actions). Ver a memória sobre os secrets Conexos dos crons desatualizados.

---

### [modifiability-1] Extrair montagem de itens de remessa do RemessaService

**QA**: Modifiability
**Tactic alvo**: Split Module / Refactor
**Esforço**: L
**Findings**: F-modifiability-1, F-modifiability-4

**Problema**
> RemessaService tem 1499 LOC e complexidade 93 em `gerarRemessaSerializado`; o delta acrescentou +388 LOC. Cada nova modalidade edita esse arquivo.

**Melhoria Proposta**
> Split Module: extrair `RemessaItensBuilder` (montarItensImport, resolução de destino) e a orquestração de data de débito para services próprios; Refactor em `gerarRemessaSerializado` por etapas. Migrar proporcionalmente em `/feature-tweak` que tocar o arquivo, cobertos pelos testes de paridade existentes.

**Resultado Esperado**
> RemessaService ≤ 600 LOC; complexidade da função principal 93 → ≤ 30 (meta intermediária); imports 27 → ≤ 15.

**Métricas de sucesso**
- LOC RemessaService: 1499 → ≤ 600
- Complexidade cognitiva máxima: 93 → ≤ 30

**Risco de não fazer**
> Cada nova modalidade adiciona ~200-400 LOC ao arquivo; em 6 meses passa de 2000 LOC.

**Dependências**: Manter flags e testes de paridade (byte-idêntico com flags OFF) verdes.

---


## P2 — Médio

### [availability-1] Limitar tempo e volume das leituras de cadastro no preflight

**QA**: Availability
**Tactic alvo**: Retry / Degradation
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> O preflight de destino faz uma leitura Conexos por item TED/PIX, com retry e timeout de 40s, dentro do request. Pior caso teórico de 120s por leitura.

**Melhoria Proposta**
> Memoizar leituras por `pesCod` na execução do `DestinoPagamentoResolver` e aplicar orçamento de tempo total do preflight; falhar fechado com mensagem clara ao exceder.

**Resultado Esperado**
> Leituras por lote: N itens → nº de favorecidos distintos; falha por orçamento em tempo limitado (valor a calibrar).

**Métricas de sucesso**
- Chamadas Conexos por lote: N itens → nº de favorecidos distintos

**Risco de não fazer**
> lotes grandes travam o analista quando o Conexos degrada.

**Dependências**: nenhuma

---

### [availability-3] Confirmar o campo de documento do favorecido antes do go-live

**QA**: Availability
**Tactic alvo**: Shadow / Self-Test
**Esforço**: S
**Findings**: F-availability-3

**Problema**
> `CAMPO_DOCUMENTO_FAVORECIDO` é hipótese; se errado, a titularidade falha fechada para todos os itens de cadastro.

**Melhoria Proposta**
> Executar a sonda supervisionada, fixar o campo e adicionar teste de contrato com amostra real anonimizada; manter flags OFF até lá.

**Resultado Esperado**
> Leituras de produção confirmando o campo: 0 → ≥1; hipóteses validadas: 0 → todas do checklist.

**Métricas de sucesso**
- Leituras de produção confirmando o campo: 0 → ≥1

**Risco de não fazer**
> go-live sem TED/PIX funcional e analistas presos ao destino manual.

**Dependências**: janela de teste supervisionado em PRD

---

### [deployability-1] Declarar as 3 flags SISPAG TED/PIX no render.yaml e no DEPLOY.md

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-1

**Problema**
> `SISPAG_TED_ENABLED`, `SISPAG_DESTINO_MANUAL_ENABLED` e `SISPAG_PIX_ENABLED` só existem no código. O Blueprint e o DEPLOY.md documentam os outros kill-switches, mas não estes.

**Melhoria Proposta**
> Adicionar as 3 chaves em `render.yaml` com `sync: false` e comentário (ordem de ligação: DESTINO_MANUAL, TED, PIX; como desligar). Incluir a ordem no DEPLOY.md e linkar o checklist supervisionado do tasks.md.

**Resultado Esperado**
> Operador liga e desliga cada flag sem consultar o código. Flags declaradas: 0 de 3 para 3 de 3.

**Métricas de sucesso**
- Flags declaradas no Blueprint: 0/3 → 3/3

**Risco de não fazer**
> no go-live, uma variável digitada errada mantém a feature OFF sem aviso, ou a flag certa não é achada num incidente.

**Dependências**: nenhuma

---

### [deployability-2] Tornar o frontend tolerante a backend sem as rotas de destino

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> Vercel e Render fazem deploy independente. Se o front novo chegar antes do backend, ou o backend sofrer rollback sozinho, o card do lote chama rotas ausentes.

**Melhoria Proposta**
> Front trata 404/ausência dos campos de destino como "recurso indisponível" (esconde o botão), e o backend expõe as flags ativas em rota já existente para o front decidir o que renderizar. Documentar a ordem (backend primeiro, front depois) no runbook de rollback.

**Resultado Esperado**
> Janela de incompatibilidade deixa de gerar erro visível ao analista (erros visíveis na janela: não medido → 0).

**Métricas de sucesso**
- Teste de front com backend sem rotas de destino: ausente → presente

**Risco de não fazer**
> rollback parcial vira incidente confuso na tela do SISPAG.

**Dependências**: nenhuma

---

### [integrability-1] Confirmar o campo de CPF/CNPJ e gravar fixtures de `cmn025/list` e `cmnPessoasPix`

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: S
**Findings**: F-integrability-1, F-integrability-2

**Problema**
> `CAMPO_DOCUMENTO_FAVORECIDO='pesNumCpfCnpj'` é hipótese e o `chavePixRowSchema` nunca viu uma linha real. Sem fixture, o teste só prova o que foi escrito à mão.

**Melhoria Proposta**
> Rodar a sonda `probe-sispag-ted-pix-supervisionado.ts` no teste supervisionado, gravar a resposta mascarada em `__fixtures__/`, ajustar a constante e trocar os mocks de `ConexosSispagClient.test.ts` por fixture. Tactic: Contract testing.

**Resultado Esperado**
> Fixtures gravadas: 0 -> 2; campo documento confirmado: 0 -> 1.

**Métricas de sucesso**
- Endpoints novos com fixture: 0/2 -> 2/2
- Campos hipotéticos: 1 -> 0

**Risco de não fazer**
> o teste em PRD falha por nome de campo, ou drift do ERP degrada para "sem destino" sem erro.

**Dependências**: teste supervisionado em PRD (checklist do tasks.md).

---

### [performance-1] Paralelizar o pré-voo de destino do envio com fan-out limitado

**QA**: Performance
**Tactic alvo**: Increase Concurrency
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> O pré-voo lê o título de cada item TED/PIX em série (`for ... await`, `RemessaService.ts:1395`), enquanto a oferta usa fan-out 4. Com Conexos lento, o tempo cresce linearmente com N.

**Melhoria Proposta**
> Trocar o loop por `bounded.run(itens, ..., CONEXOS_FANOUT_LIMIT)`, como no painel, preservando a ordem da lista `ausentes`, o `assinatura` determinístico e o cache compartilhado. Mover `CONEXOS_FANOUT_LIMIT` para constante compartilhada. Tactic: Increase Concurrency.

**Resultado Esperado**
> Pré-voo de lote com 50 itens TED/PIX: ~50 leituras seriais para ~13 rodadas de 4 (tempo estimado ÷ ~4). Medir antes e depois com o probe supervisionado.

**Métricas de sucesso**
- Concorrência do pré-voo: 1 → 4
- Latência do pré-voo (50 itens): medir no probe; meta ≥ 3x mais rápido

**Risco de não fazer**
> Lotes grandes com flags ligadas expiram a requisição de gerar remessa.

**Dependências**: nenhuma; validar no PRD supervisionado.

---

### [performance-3] Impor orçamento de tempo ao pré-voo e confirmar timeout dos clients Conexos

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S
**Findings**: F-performance-3

**Problema**
> O pré-voo não tem deadline global e não confirmei timeout explícito nos clients Conexos.

**Melhoria Proposta**
> Confirmar o timeout por chamada na camada HTTP compartilhada do Conexos e documentar. Adicionar orçamento (ex.: 60s) ao pré-voo que aborta com erro operacional em português, sem escrita (o pré-voo é read-only, então é seguro). Tactic: Bound Execution Times.

**Resultado Esperado**
> Pior caso do pré-voo limitado a 60s (hoje sem limite); erro claro no lugar de timeout do proxy (100s).

**Métricas de sucesso**
- Deadline do pré-voo: nenhum → 60s
- Clients Conexos com timeout explícito: não verificado → 100%

**Risco de não fazer**
> Uma chamada travada segura a trava do lote até a requisição expirar.

**Dependências**: [performance-1] reduz a chance de estourar o orçamento.

---

### [fault-tolerance-1] Preservar a assinatura de destinos no ledger em toda gravação, com flags ligadas ou não

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-fault-tolerance-2

**Problema**
> Com as flags TED/PIX desligadas, `prepararDestinos` regrava o `request_payload` sem `destinos`. Numa retomada de lote parcialmente importado, o pin de destino some. Com a assinatura ilegível, `destinosDoLedger` degrada para "sem pin". Numa retomada com `apenasChaves`, a assinatura fica só com os itens que faltam.

**Melhoria Proposta**
> Em `comDestinos`, mesclar (não substituir) a assinatura existente do `anterior` com a nova, por chave de item. Quando houver `flpCodExistente` e o ledger anterior tiver `destinos`, mantê-los mesmo com flags OFF. Quando o ledger tiver `destinos` que falham no parse, falhar fechado com `DestinoCongeladoError(INDETERMINADO)`. Adicionar 3 testes: flag OFF na retomada, payload corrompido e retomada parcial encadeada.

**Resultado Esperado**
> O pin de destino sobrevive a qualquer sequência de retomadas. Testes de cenários de retomada com pin: 0 → 3.

**Métricas de sucesso**
- Caminhos de retomada que perdem o pin: 3 → 0
- Testes de pin em retomada: 0 → 3

**Risco de não fazer**
> pagamento a destino diferente do 1º envio em retomada encadeada, depois de acionar o kill-switch.

**Dependências**: nenhuma.

---

### [fault-tolerance-2] Limitar e paralelizar o pré-voo de destinos

**QA**: Fault Tolerance
**Tactic alvo**: Timeout
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> O pré-voo lê o Conexos item a item, em série, antes do `criarLote`. Um lote com dezenas de TED/PIX estende a requisição de envio. Não há limite agregado de tempo.

**Melhoria Proposta**
> Usar leituras com concorrência limitada (ex.: 5) e um teto de tempo total do pré-voo, expresso via `RetryExecutor`/`FallbackExecutor` (nunca `setTimeout`). Estourar o teto falha fechado, sem escrita.

**Resultado Esperado**
> Latência do pré-voo limitada e previsível. Chamadas sequenciais por lote: N x 2 a 3 → no máximo ceil(N/5) x 3 (medir em PRD supervisionado).

**Métricas de sucesso**
- Tempo do pré-voo para um lote de 30 itens: ⚠️ não medido → abaixo de 10 s (a validar)

**Risco de não fazer**
> timeouts do proxy em lotes grandes, que forçam retomadas sem necessidade.

**Dependências**: nenhuma.

---

### [security-4] Exigir role nos GETs de SISPAG e validar o mapeamento do claim admin

**QA**: Security
**Tactic alvo**: Limit Access
**Esforço**: S
**Findings**: F-security-3

**Problema**
> 5 GETs de painel/lotes exigem só autenticação, e falta confirmar como o claim de role vira `admin` em produção.

**Melhoria Proposta**
> Aplicar `requireRole` de leitura (analista/admin) com teste de rota por perfil; documentar a origem do claim. Tactic: Limit Access.

**Resultado Esperado**
> GETs sem role: 5 → 0.

**Métricas de sucesso**
- GETs sem role: 5 → 0

**Risco de não fazer**
> Qualquer usuário autenticado lê dados de pagamento.

**Dependências**: definição de perfis (transição de auth em 3 passos)

---

### [testability-3] Introduzir `ClockProvider` injetável nos serviços SISPAG

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> Existem 2 `Date.now()` diretos (`SispagPainelService.ts:110`, `IngestaoPagamentosService.ts:166`) e nenhum fake timer nos testes do escopo.

**Melhoria Proposta**
> Criar `ClockProvider` (`@singleton() @injectable()`) e injetá-lo nesses dois serviços (Limit Non-Determinism); nos testes, usar um clock fixo. Isso cobre o mesmo ponto do card de Modifiability.

**Resultado Esperado**
> Leituras de tempo não abstraídas de 2 → 0; testes com relógio controlado de 0 → ≥ 2.

**Métricas de sucesso**
- `Date.now()` direto em service/sispag: 2 → 0
- Testes com clock injetado: 0 → ≥ 2

**Risco de não fazer**
> a próxima regra de cutoff de horário nasce sem teste determinístico.

**Dependências**: nenhuma.

---

### [availability-2] Alerta ativo para remessa falha/indeterminada

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: M
**Findings**: F-availability-2

**Problema**
> Falhas de remessa só são gravadas em ledger e log; ninguém é avisado.

**Melhoria Proposta**
> Cron/GH Action (ou alerta do Render) que consulta `remessa_execucao` em falha/indeterminado além de um limite e notifica o time; instrumentar duração `candidato → conciliado`.

**Resultado Esperado**
> Detecção de falha: manual → automática; alarmes ativos: 0 → ≥5.

**Métricas de sucesso**
- Alarmes ativos: 0 → ≥5

**Risco de não fazer**
> pagamentos atrasados descobertos pelo cliente.

**Dependências**: definição do canal de notificação

---

### [integrability-3] Extrair a montagem do `fin015` de `RemessaService`

**QA**: Integrability
**Tactic alvo**: Encapsulate
**Esforço**: M
**Findings**: F-integrability-4

**Problema**
> `RemessaService` tem 12 dependências e complexidade 93; qualquer mudança de payload ou de gateway passa por ele.

**Melhoria Proposta**
> Extrair `Fin015ImportBuilder` (`montarItensImport`) atrás de interface, deixando `RemessaService` só orquestrar. Fazer junto com a integração Nexxera (`/feature-new`). Tactic: Encapsulate / Orchestrate.

**Resultado Esperado**
> Dependências 12 -> ≤8; trocar o formato do `fin015` toca 1 arquivo.

**Métricas de sucesso**
- Deps do construtor: 12 -> ≤8
- Complexidade de `gerarRemessaSerializado`: 93 -> <60

**Risco de não fazer**
> o Nexxera entra em cima de um orquestrador ainda maior.

**Dependências**: testes de paridade do delta (rede de segurança).

---

### [modifiability-3] Tirar acesso a repository/client de routes/sispag.ts

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies / Split Module
**Esforço**: M
**Findings**: F-modifiability-3

**Problema**
> Rotas importam 4 repository/client direto (PRE_EXISTING) e o delta acrescentou mais 122 linhas ao arquivo de 832 LOC.

**Melhoria Proposta**
> Restrict Dependencies: expor leituras via services/facades (ex. `SispagPainelService`) e dividir o arquivo de rotas por recurso (lotes, remessa, ingestão).

**Resultado Esperado**
> Imports repository/client em routes/sispag.ts 4 → 0; arquivo 832 → ≤ 400 LOC por router.

**Métricas de sucesso**
- Imports diretos: 4 → 0
- LOC por arquivo de rota: 832 → ≤ 400

**Risco de não fazer**
> Migração Lambda mais cara; rotas continuam acopladas a schema.

**Dependências**: Alinha com `ontology/_inbox/migration-debt.md`.

---

### [security-2] Alertar troca de destino e limitar por ator

**QA**: Security
**Tactic alvo**: Detect Intrusion
**Esforço**: M
**Findings**: F-security-1, F-security-4

**Problema**
> A trilha só-inclusão prova quem trocou, mas ninguém é avisado. Um admin pode trocar muitos destinos antes da remessa.

**Melhoria Proposta**
> Emitir alerta a cada gravação de `destino_manual` (ator, lote, valor do título, sem o destino), limite de trocas por ator/hora e sinalização no card do lote. Avaliar quatro olhos acima de um valor de corte (revisita ADR-0054 D3). Tactic: Detect Intrusion.

**Resultado Esperado**
> Trocas notificadas 0% → 100%; teto configurável por ator.

**Métricas de sucesso**
- trocas de destino notificadas: 0% → 100%

**Risco de não fazer**
> Fraude descoberta só na conciliação bancária.

**Dependências**: canal de notificação definido

---

### [security-3] Definir retenção e cifra de coluna do destino digitado

**QA**: Security
**Tactic alvo**: Encrypt Data
**Esforço**: M
**Findings**: F-security-2

**Problema**
> `destino_manual` e a trilha guardam conta, chave e documento em claro; o trigger impede qualquer purga.

**Melhoria Proposta**
> Cifrar em nível de aplicação (chave em env/SSM) ou tokenizar o valor na trilha; definir retenção/anonimização com exceção controlada ao trigger (migration dedicada). Tactic: Encrypt Data.

**Resultado Esperado**
> Dado completo só cifrado; retenção documentada.

**Métricas de sucesso**
- colunas sensíveis cifradas: 0/2 → 2/2

**Risco de não fazer**
> Dump do banco expõe contas de fornecedores; pedido de eliminação sem resposta.

**Dependências**: decisão jurídica de retenção

---

### [testability-4] Teste de integração Postgres para o SQL de destino do `LotePagamentoRepository`

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M
**Findings**: F-testability-4

**Problema**
> As queries novas de `destino_manual` só rodam contra pool mockado (0 casos de integração nos métodos novos), embora o CI já tenha o job `test:sql` com Postgres real.

**Melhoria Proposta**
> Adicionar um `LotePagamentoRepository.integration.test.ts` no diretório coberto pelo `test:sql` (Sandbox) cobrindo gravar destino, congelamento após envio, trilha de auditoria e recusa de UPDATE/DELETE.

**Resultado Esperado**
> Casos de integração no repositório de 0 → ≥ 6; suites `test:sql` de 2 → 3.

**Métricas de sucesso**
- Casos de integração nos métodos novos: 0 → ≥ 6
- Suites em `test:sql`: 2 → 3

**Risco de não fazer**
> erro de coluna ou cast no SQL novo só aparece em PRD, com destino de pagamento gravado errado.

**Dependências**: nenhuma (Postgres do CI já existe).

---

### [testability-2] Extrair fatias de `RemessaService` e quebrar o teste de 2.057 LOC

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: L
**Findings**: F-testability-2

**Problema**
> `gerarRemessaSerializado` tem complexidade cognitiva 93 (+2 no delta) e o teste do arquivo tem 2.057 LOC. Cada flag nova multiplica caminhos, e a suíte fica cara de manter.

**Melhoria Proposta**
> Extrair a montagem de itens (`montarItensImport`) e a escolha de forma de lançamento para classes DI menores (Limit Structural Complexity), cada uma com teste próprio; dividir `RemessaService.test.ts` por responsabilidade. Feito de forma proporcional no próximo `/feature-tweak` que tocar o arquivo.

**Resultado Esperado**
> Complexidade de `gerarRemessaSerializado` 93 → ≤ 30; maior arquivo de teste do escopo 2.057 → ≤ 800 LOC.

**Métricas de sucesso**
- Complexidade cognitiva de `gerarRemessaSerializado`: 93 → ≤ 30
- LOC do maior teste do escopo: 2.057 → ≤ 800

**Risco de não fazer**
> a próxima modalidade (ex.: boleto de concessionária) empurra a complexidade acima de 100 e as mudanças passam a exigir revisão manual de todos os caminhos.

**Dependências**: nenhuma; os testes de paridade (flags OFF = main) protegem a refatoração.

---


## P3 — Baixo

### [integrability-2] Alertar drift de schema por endpoint Conexos

**QA**: Integrability
**Tactic alvo**: Manage Resources / Observability
**Esforço**: S
**Findings**: F-integrability-5

**Problema**
> Linhas descartadas por schema só viram `Logger.warn`; não há contador por endpoint nem alerta.

**Melhoria Proposta**
> Emitir contagem estruturada (`endpoint`, `descartadas`, `total`) via `LogService` e definir limiar de alerta. Tactic: Observability of integration failures.

**Resultado Esperado**
> Drift detectável em minutos; métricas por endpoint do SISPAG: 0 -> 1 por endpoint.

**Métricas de sucesso**
- Métricas por endpoint: 0 -> 1 por endpoint

**Risco de não fazer**
> mudança silenciosa do ERP só é vista pelo analista.

**Dependências**: nenhuma.

---

### [integrability-4] Padronizar leitores do client com Zod

**QA**: Integrability
**Tactic alvo**: Tailor Interface
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> `listContasCorrentes`, `listContasFavorecido` e `listExteriorDocCods` usam `Number()`/`String()` sem validação.

**Melhoria Proposta**
> Aplicar `safeParse` com descarte contado, no padrão de `listChavesPixFavorecido`. Tactic: Tailor Interface. Fazer no próximo `/feature-tweak` que tocar esses leitores.

**Resultado Esperado**
> Leitores com Zod: 5/8 -> 8/8; `NaN` não chega ao import.

**Métricas de sucesso**
- Leitores com Zod: 5/8 -> 8/8

**Risco de não fazer**
> `pctCodSeq` inválido chega ao import do lote.

**Dependências**: nenhuma.

---

### [performance-2] Memoizar leitura do título e do documento do favorecido no fluxo

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> `getTituloAPagar` e `getDocumentoFavorecido` não passam pelo `CacheCadastroDestino`; só contas e chaves passam.

**Melhoria Proposta**
> Estender `memo` do resolver (ou um memo irmão) para `documento:{filCod}:{pesCod}`. O título é lido uma vez por item e já é a unidade mínima, então basta o documento. Tactic: Reduce Overhead.

**Resultado Esperado**
> Leituras cmn025 por lote: 1 por item MANUAL para 1 por favorecido distinto.

**Métricas de sucesso**
- Leituras `getDocumentoFavorecido` por lote com M itens do mesmo favorecido: M → 1

**Risco de não fazer**
> Carga desnecessária no Conexos, sem impacto funcional.

**Dependências**: nenhuma.

---

### [testability-5] Pisos de cobertura por arquivo e propriedades nos módulos de destino

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-5, F-testability-6

**Problema**
> Os 3 módulos novos (`MaskDestino`, `DestinoManualValidator`, `DestinoPagamentoResolver`) não têm piso de cobertura próprio, e as funções puras só têm casos por exemplo (24 casos, 0 propriedades).

**Melhoria Proposta**
> Medir a cobertura desses arquivos e registrar pisos por arquivo em `jest.config.cjs` (ratchet, como já feito em `http/*`). Adicionar testes `fast-check` para as propriedades "a máscara nunca contém o valor completo" e "o validador é total". Registrar também um piso global no frontend.

**Resultado Esperado**
> Pisos por arquivo nos módulos novos de 0 → 3; propriedades de 0 → ≥ 3; piso de branches em `domain/service/` 60% → 70%.

**Métricas de sucesso**
- Pisos por arquivo nos módulos de destino: 0 → 3
- Propriedades `fast-check` no escopo: 0 → ≥ 3

**Risco de não fazer**
> os ramos do resolver erodem sem o CI acusar, e dado sensível pode vazar por um caso de borda que os exemplos não cobrem.

**Dependências**: corrida de cobertura completa (não feita neste ciclo `--quick`).

---

### [deployability-3] Smoke check pós-deploy que confirma versão e última migration

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: M
**Findings**: F-deployability-3

**Problema**
> `/health` é o único sinal pós-deploy e não confirma migration aplicada nem versão. O incidente de 2026-09-23 (migração não aplicada por semanas) mostra o custo.

**Melhoria Proposta**
> Expor `version` e `lastMigration` em `/health` (sem dado sensível) e adicionar workflow pós-merge ou `workflow_dispatch` que compara com o esperado (`0066`) e falha se divergir.

**Resultado Esperado**
> Deploy sem a migration esperada detectado em minutos. Checks pós-deploy: 0 → 1.

**Métricas de sucesso**
- Tempo para detectar migration não aplicada: indeterminado → menos de 10 min

**Risco de não fazer**
> repetição silenciosa do incidente de 2026-09-23.

**Dependências**: nenhuma

---

