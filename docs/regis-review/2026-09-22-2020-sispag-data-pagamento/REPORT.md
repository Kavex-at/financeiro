---
type: regis-review-report
run_id: 2026-09-22-2020-sispag-data-pagamento
generated_at: 2026-09-22T21:15:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: delta da branch fix/sispag-data-pagamento vs origin/main (ADR-0049 — data de débito selecionável na remessa SISPAG), --quick
total_cards: 22
total_p0: 0
total_p1: 2
total_p2: 10
total_p3: 10
overall_score: 7.8
---

# Regis-Review — financeiro — 2026-09-22-2020-sispag-data-pagamento

**Escopo desta revisão:** exclusivamente o delta de `fix/sispag-data-pagamento` (`git diff
origin/main...HEAD`, 23 arquivos backend + 11 frontend, migration `0061`) — a feature que troca a
data de débito da remessa SISPAG de `hojeUtc()` (bug de fuso: virava o dia às 21h BRT) para uma
data escolhida pela analista dentro da janela `[hoje BRT, menor vencimento] ∩ dias úteis bancários`
(I8a), persistida antes de qualquer escrita e congelada assim que o lote nativo existe no fin015
(I8b). **Não é** uma auditoria do módulo SISPAG inteiro — código pré-existente só entra como
contexto de blast radius quando os agentes o citam explicitamente.

**Resultado em uma frase:** nenhum P0 foi encontrado; a feature em si é fail-closed, sem chamadas
novas ao ERP fora do necessário, com boa cobertura de teste na lógica de negócio nova — mas ela
pousa em cima de um hotspot conhecido (`RemessaService.gerarRemessaSerializado`, complexidade
cognitiva 91) e expõe, sem fechar, um RBAC que não separa ninguém em produção numa escrita que move
dinheiro real.

## 1. Executive scorecard

**Overall score = 7,8/10** (média ponderada dos 8 QAs; pesos calibrados para um SaaS financeiro
multi-tenant que executa escritas que movem dinheiro — Security 1,5, Fault Tolerance 1,3,
Availability 1,2, Modifiability 1,2, Testability 1,0, Performance 1,0, Integrability 0,9,
Deployability 0,9; total de peso = 9,0). Média simples (não ponderada) dos 8 scores: 7,75 — as duas
leituras convergem porque nenhum QA destoa fortemente da média.

**P0: 0 | P1: 2 | P2: 10 | P3: 10 | Total: 22 cards**

| QA | Score (0–10) | Peso | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|---|
| Availability | 8,0 | 1,2 | 0 | 0 | 2 | 2 | F-availability-1: BankingCalendar não cobre feriados municipais/estaduais nem 31/12 |
| Deployability | 8,0 | 0,9 | 0 | 0 | 1 | 1 | F-deployability-1: mudança no payload do fin015 sobe a 100% do tráfego sem rollout faseado |
| Integrability | 7,0 | 0,9 | 0 | 0 | 2 | 2 | F-integrability-2: RemessaService concentra 10 colaboradores, 3 Clients — hotspot de troca de provedor |
| Modifiability | 6,5 | 1,2 | 0 | 1* | 2 | 2 | F-modifiability-1: complexidade cognitiva 91 em gerarRemessaSerializado (teto: 15) |
| Performance | 8,0 | 1,0 | 0 | 0 | 0 | 2 | F-performance-1: holidays(year) recomputado sem memoização por dia iterado |
| Fault Tolerance | 8,5 | 1,3 | 0 | 0 | 1 | 2 | F-fault-tolerance-1: retomada de status='error' pula checagem de órfão — agora também perde rastro de data_debito |
| Security | 8,0 | 1,5 | 0 | 0 | 1 | 1 | F-security-1: RBAC não separa ninguém em produção (todo usuário nasce admin) |
| Testability | 8,0 | 1,0 | 0 | 1 | 2 | 0 | F-testability-2: persistência de data_debito sem teste de integração real contra Postgres |
| **Overall** | **7,8** | **9,0** | **0** | **2** | **10** | **10** | — |

\* O card `[modifiability-1]` absorveu o card `[integrability-2]` (mesmo hotspot, achados
complementares — ver seção 7). A contagem de findings por QA na tabela acima reflete os arquivos de
origem (`*.md` de cada agente); a contagem de **cards** no KANBAN.md já está deduplicada (22, não
23).

Score interpretation:
- 0–3: estrutural risk — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

Modifiability (6,5) é o único QA na faixa "dívida defensável" — puxado por um arquivo que já era o
maior hotspot do domínio SISPAG antes desta feature e que ela tocou sem compensar com extração
equivalente. Os outros 7 QAs estão na faixa "saudável com oportunidades pontuais".

## 2. Top 10 risks (cross-QA)

Ranqueados por severidade x leverage x impacto de negócio — não é simplesmente "os 10 piores
findings". Nenhum P0 existe neste delta; por isso a lista mistura os 2 P1 reais com os P2/P3 de
maior raio de blast.

### R-1: Nenhum teste de integração cobre o encoding de data (to_char/::date) que esta feature existe para corrigir

- **QA(s) afetados**: Testability (origem), Fault Tolerance e Availability (blast radius se regredir)
- **Findings de origem**: F-testability-2 (testability.md §4)
- **Evidência sintetizada**: 0 testes describe('integration:...') em domain/repository/**; 0
  infraestrutura de Postgres de teste (docker-compose*test*) no repo; a própria migration 0061
  documenta o alerta ("lida sempre com to_char(...) para não passar pelo parse DATE → Date local
  do node-pg") — a classe exata de bug que motivou a ADR-0049.
- **Impacto técnico**: se o cast ::date/to_char se comportar diferente do esperado em produção
  (timezone da sessão do pool divergente do assumido), a "data congelada" exibida na tela pode não
  bater com o que está no Conexos — silenciosamente, porque nenhum teste executa esse caminho contra
  um driver pg real (os 5 testes novos de LotePagamentoRepository.test.ts verificam a string
  do SQL contra um mock, não a execução).
- **Impacto de negócio**: reincidência do exato bug que motivou toda a feature (o gotcha de produção
  já registrado — "SISPAG filial 7: 1ª remessa não validada"); remessa com data de débito errada
  exige cancelamento manual do lote nativo no fin015.
- **Card(s) Kanban relacionados**: testability-2
- **Custo de inação em 6 meses**: assumindo o ritmo observado de 1 migration em coluna DATE/timestamp
  por trimestre nesta frente (a 0061 é a mais recente), cada nova mudança de schema roda sem a
  rede de segurança que pegaria justamente essa classe de regressão — a probabilidade cumulativa de
  reintroduzir o bug de encoding cresce a cada ciclo sem custo de detecção antes de produção.

### R-2: RemessaService.gerarRemessaSerializado é um hotspot de complexidade e acoplamento que esta feature aprofundou

- **QA(s) afetados**: Modifiability (origem), Integrability (mesmo arquivo, ângulo de acoplamento),
  Testability (arquivo de teste irmão chegou a 1452 LOC)
- **Findings de origem**: F-modifiability-1, F-modifiability-2 (modifiability.md §4), F-integrability-2
  (integrability.md §4)
- **Evidência sintetizada**: complexidade cognitiva 91 (Biome, teto 15 — 6x o limite); RemessaService.ts
  em 1111 LOC (alvo ≤600, limiar de risco arquitetural ≤1000 já ultrapassado antes desta feature);
  10 colaboradores injetados no construtor, 3 deles Clients (heurística: ≤2 Clients diretos por
  service). O delta seguiu o precedente certo ao extrair DebitDateService, mas inseriu os 2 novos
  pontos de chamada (resolverDataDebito, encoding dataDebitoErp) dentro da função já mais
  complexa, em vez de delegar via um orquestrador fino.
- **Impacto técnico**: qualquer nova regra de SISPAG — e há 3 perguntas P1 já abertas em
  ontology/_inbox/sispag-data-pagamento-gap.md sobre esta mesma feature — provavelmente volta a
  tocar este arquivo; trocar o gateway bancário (Nexxera) ou subir a versão do fin015 não fica
  isolado num client fino.
- **Impacto de negócio**: é a função que cria o lote nativo no ERP e dispara a remessa bancária real
  — dinheiro saindo. Já há um incidente de produção documentado neste exato fluxo (filial 7,
  remessa gerada e depois cancelada por boleto sem código de barras); regressões aqui têm custo
  direto, não hipotético.
- **Card(s) Kanban relacionados**: modifiability-1 (absorve integrability-2)
- **Custo de inação em 6 meses**: com 3 gaps P1 já na fila para este mesmo arquivo, cada
  /feature-tweak seguinte soma complexidade sobre uma base 6x acima do teto do linter; o tempo de
  review/QA manual cresce por ciclo, e a probabilidade de uma regressão silenciosa no fluxo que move
  dinheiro aumenta de forma monotônica, não linear.

### R-3: Retomada a partir de status='error' pula a checagem de órfão — e agora também perde rastro da data de débito

- **QA(s) afetados**: Fault Tolerance
- **Findings de origem**: F-fault-tolerance-1 (fault-tolerance.md §4)
- **Evidência sintetizada**: um timeout de rede durante write.criarLote (escrita única,
  não-idempotente) grava status='error' no ledger; na retomada, como a checagem de lote órfão
  (adotarPorMarcaDagua) só roda para status='reconciling', o código chama criarLote de novo
  sem verificar se a tentativa anterior já criou o lote no fin015 — comprovado por
  RemessaService.test.ts:796-801, que hoje exige esse comportamento. O reaper pré-existente
  também só varre reconciling.
- **Impacto técnico**: pode deixar um lote nativo vazio órfão no fin015, nunca coberto pelo reaper;
  com esta feature, cada nova tentativa sobrescreve data_debito, perdendo o rastro de qual data o
  lote fantasma da primeira tentativa carregava.
- **Impacto de negócio**: o lote fantasma não move dinheiro sozinho (nasce vazio), mas é sujeira
  crescente no ERP que exige limpeza manual — e a auditoria dessa limpeza fica mais difícil à medida
  que o volume de remessas cresce.
- **Card(s) Kanban relacionados**: fault-tolerance-1
- **Custo de inação em 6 meses**: acumulação silenciosa proporcional à taxa de timeout de rede do
  cliente do fin015 (sem instrumentação hoje); cada ocorrência só é descoberta via SQL manual, nunca
  por alerta — o custo cresce com o volume de remessas, não com a gravidade do bug em si.

### R-4: RBAC é um no-op em produção — a nova capacidade de escolher a data de débito herda esse gap

- **QA(s) afetados**: Security
- **Findings de origem**: F-security-1 (security.md §4)
- **Evidência sintetizada**: app_user.role DEFAULT 'admin' — todo usuário nasce admin; o próprio
  time documentou no teste (sispag.test.ts:42-44): "na prática o requireRole('admin') não
  separa ninguém em produção".
- **Impacto técnico**: requireRole('admin') continua correto como mecanismo, mas com 1 papel
  efetivo ele não reduz o conjunto de atores que podem escolher uma dataDebito arbitrária (dentro
  da janela) e disparar a remessa.
- **Impacto de negócio**: o requisito cross-cutting de RBAC descrito na proposta comercial (SSO
  corporativo + RBAC) não está em vigor; qualquer credencial vazada ou reaproveitada dentro da
  empresa move dinheiro sem que o controle ofereça atrito algum — e esta feature aumenta o número de
  decisões de negócio (qual data) que um "admin" universal toma sozinho.
- **Card(s) Kanban relacionados**: security-1
- **Custo de inação em 6 meses**: à medida que mais analistas/clientes entram na mesma conta, a
  superfície de quem pode disparar remessa sem responsabilidade financeira formal cresce com o
  headcount, não com a necessidade de negócio — o controle existe hoje só no papel do código.

### R-5: Primeira remessa real pós-deploy roda sem rede de segurança para erro de calendário bancário

- **QA(s) afetados**: Deployability, Availability
- **Findings de origem**: F-deployability-1 (deployability.md §4), F-availability-1 (availability.md §4)
- **Evidência sintetizada**: render.yaml — plan: starter, autoDeploy: true, sem canary/blue-green
  (Render Starter não suporta); BankingCalendar.ts:36 documenta gap autoadmitido:
  "Fora de escopo (gap P1): feriados municipais/estaduais e 31/12 — são valor de praça".
- **Impacto técnico**: a janela [hoje BRT, min(vencimento)] ∩ dias úteis pode aceitar como "dia
  útil" uma data que a praça bancária real da conta pagadora não trabalha; o ERP recusaria no
  finalizarLote, mas só depois do criarLote já ter acontecido — e a primeira exposição real dessa
  lógica de calendário é a primeira remessa real pós-deploy, para 100% do tráfego, sem amostra prévia.
- **Impacto de negócio**: reexecução manual pela analista às vésperas do corte bancário diário; o
  risco é maior justamente nos dias em que o calendário nacional não cobre a praça específica
  (comum em capitais e feriados religiosos estaduais).
- **Card(s) Kanban relacionados**: deployability-1, availability-1
- **Custo de inação em 6 meses**: o mesmo padrão de exposição total se repete a cada deploy desta
  frente; cada nova filial/conta pagadora numa praça com calendário próprio reintroduz o sintoma que
  a ADR-0049 já corrigiu para o caso nacional.

### R-6: Frontend consome as respostas de /remessa/janela e /remessa sem validar a forma (contrato duplicado à mão)

- **QA(s) afetados**: Integrability
- **Findings de origem**: F-integrability-1 (integrability.md §4)
- **Evidência sintetizada**: 0 arquivos com Zod nos 2 arquivos de frontend do delta que consomem a
  nova rota; sispagRequest<T> faz "body as T" — cast sem checagem de forma em runtime; o tipo
  JanelaDataDebito é uma cópia manual do backend, mantida à mão nas duas pontas.
- **Impacto técnico**: uma mudança de forma no backend (renomear motivo, adicionar valor a um
  union) não é pega pelo TypeScript do frontend em runtime — só em build, e só se o campo divergente
  for usado num tipo estreito.
- **Impacto de negócio**: uma resposta inesperada cai no default genérico da tela em vez de falhar
  de forma visível — a analista vê uma mensagem menos precisa num fluxo que decide quando dinheiro
  sai do banco.
- **Card(s) Kanban relacionados**: integrability-1
- **Custo de inação em 6 meses**: cada resposta às 3 perguntas P1 abertas no gap file (que
  provavelmente mexem no contrato de motivos/janela) carrega o risco de quebrar a tela sem qualquer
  sinal de erro visível ao time até a analista reportar.

### R-7: Enum de motivos de recusa mantido em 2 fontes sem link de compilador entre backend e frontend

- **QA(s) afetados**: Modifiability
- **Findings de origem**: F-modifiability-4 (modifiability.md §4)
- **Evidência sintetizada**: MOTIVO_FORA_DA_JANELA (backend, 6 valores, as const) vs.
  JanelaDataDebito.vazia.motivo (frontend, união literal com só 3 valores) e
  DebitDateOutsideWindowError.details.motivo no frontend tipado como string solto — perde a
  união por completo.
- **Impacto técnico**: adicionar um 7º motivo no backend não quebra o build do frontend — o campo
  correspondente já é string.
- **Impacto de negócio**: mensagem de erro genérica/confusa na tela do analista exatamente quando o
  SISPAG mais precisa ser claro (dinheiro real, janela de débito).
- **Card(s) Kanban relacionados**: modifiability-3
- **Custo de inação em 6 meses**: as 3 perguntas P1 abertas em sispag-data-pagamento-gap.md
  provavelmente adicionam pelo menos 1 motivo novo; sem o link de tipos, o lado frontend fica
  esquecido até alguém notar em produção.

### R-8: Interação de UI nova (diálogo → toast de erro) sem nenhum teste de componente

- **QA(s) afetados**: Testability
- **Findings de origem**: F-testability-1 (testability.md §4)
- **Evidência sintetizada**: LoteCard.tsx (+50/-24) e page.tsx (+15, 2 else if novos mapeando
  DebitDateOutsideWindowError/DebitDateFrozenError para toast) não têm arquivo de teste;
  GerarRemessaDialog.test.tsx testa o diálogo isolado, com acao mockada — nunca o caminho real.
- **Impacto técnico**: uma regressão no mapeamento erro→toast (ex.: instanceof quebrando com
  bundling diferente) passaria pela suíte inteira sem nenhum teste vermelho.
- **Impacto de negócio**: a mensagem "Data de débito já fixada no Conexos (fin015)" é o que diz à
  analista para cancelar o lote nativo em vez de tentar de novo — se cair no branch genérico, ela
  perde a instrução acionável e pode abrir chamado por algo que a UI já sabia explicar.
- **Card(s) Kanban relacionados**: testability-1
- **Custo de inação em 6 meses**: cada regressão futura nesse mapeamento vira chamado de suporte em
  vez de autoatendimento pela analista, no fluxo mais sensível a horário do sistema.

### R-9: Write-ahead de data_debito + marca d'água não é transacional

- **QA(s) afetados**: Availability, Fault Tolerance
- **Findings de origem**: F-availability-2 (availability.md §4), F-fault-tolerance-3 (fault-tolerance.md §4)
- **Evidência sintetizada**: loteRepo.setDataDebito e ledger.setRequestPayload são 2 UPDATEs
  sequenciais sem TransactionClient compartilhado; uma queda entre os dois deixa data_debito
  persistida sem a marca d'água correspondente.
- **Impacto técnico**: o sistema já trata esse caso como fail-closed (RemessaEmDuvidaError,
  coberto por teste) — não há duplicação de escrita, mas o dado fica órfão e é recalculado
  silenciosamente, sem log.
- **Impacto de negócio**: aumento marginal de falsos-positivos "remessa em dúvida" (interrupção
  operacional evitável); uma investigação futura lendo lote_pagamento.data_debito direto no banco
  pode concluir erroneamente qual foi a data de fato tentada.
- **Card(s) Kanban relacionados**: availability-2, fault-tolerance-3
- **Custo de inação em 6 meses**: cada crash nessa janela estreita (rara, mas não-zero) gera uma
  escalação humana evitável e um registro de banco que não reflete a realidade — custo cumulativo em
  tempo de investigação, não em dinheiro perdido.

### R-10: GET /sispag/lotes/:id/remessa/janela está sub-protegida em relação às rotas irmãs

- **QA(s) afetados**: Availability, Security
- **Findings de origem**: F-availability-3 (availability.md §4), F-security-2 (security.md §4)
- **Evidência sintetizada**: a rota nova não tem heavyRouteLimiter (ao contrário da POST
  .../remessa irmã) nem requireRole('admin') (ao contrário de /linhas-digitaveis e
  /remessa/arquivo, que citam LGPD Art. 6º / LC 105 no próprio código) — apesar de devolver
  credor/documento do título limitante.
- **Impacto técnico**: baixo isoladamente (leitura de 2 SELECTs, dado já exposto em GET /lotes/:id),
  mas é a única leitura nova do fluxo de remessa sem os 2 guards que as rotas irmãs já adotam.
- **Impacto de negócio**: nenhum imediato — é inconsistência de política acumulada, não regressão de
  superfície nova.
- **Card(s) Kanban relacionados**: availability-3, security-2
- **Custo de inação em 6 meses**: se /lotes/:id ou /linhas-digitaveis algum dia endurecerem sem
  que esta rota acompanhe, ela vira o elo mais fraco por acidente, não por decisão.

## 3. Cross-cutting findings

### CC-1: RemessaService como god-object da Frente II — mesma causa-raiz em Modifiability, Integrability e Testability

- **Aparece em**: Modifiability, Integrability, Testability
- **Findings**: F-modifiability-1, F-modifiability-2 (Modifiability), F-integrability-2
  (Integrability), F-testability-3 (Testability)
- **Diagnóstico unificado**: RemessaService.gerarRemessaSerializado acumula orquestração de 6+
  chamadas ao ERP, idempotência, retomada, validação CNAB e agora a decisão de data de débito, num
  único arquivo de 1111 LOC com 10 colaboradores injetados (3 Clients). O arquivo de teste espelha o
  mesmo padrão: 1452 LOC, ~16 responsabilidades no mesmo describe. Cada feature nova (incluindo
  esta) segue o precedente certo ao extrair a regra de negócio nova (DebitDateService), mas
  insere os pontos de chamada dela de volta no monolito — o arquivo nunca encolhe o suficiente para
  compensar o que cresce.
- **Recomendação consolidada**: card [modifiability-1] (absorve [integrability-2]) extrai um
  orquestrador dedicado para a sequência de escrita do fin015; o card [testability-3] espelha essa
  decomposição no lado do teste, extraindo o describe "data de débito" para um arquivo satélite. Os
  dois cards compartilham a mesma rede de segurança (os 144+321 testes já verdes de
  RemessaService.test.ts) e deveriam ser sequenciados juntos, não em paralelo.

### CC-2: Contrato SISPAG duplicado à mão entre backend e frontend, sem verificação estrutural

- **Aparece em**: Integrability, Modifiability
- **Findings**: F-integrability-1 (Integrability), F-modifiability-4 (Modifiability)
- **Diagnóstico unificado**: não há pacote de tipos compartilhado nem geração de schema entre
  src/backend e src/frontend (dois package.json independentes). O sintoma aparece em duas
  camadas do mesmo problema: (a) a forma da resposta (JanelaDataDebito/GerarRemessaResult)
  nunca é validada em runtime no frontend (as T sem Zod); (b) o enum de motivos de recusa
  (MOTIVO_FORA_DA_JANELA) é copiado parcialmente à mão, perdendo 3 dos 6 valores. Nos dois casos,
  o TypeScript do frontend não detecta o drift porque o tipo correspondente já é solto o bastante
  para aceitar qualquer coisa.
- **Recomendação consolidada**: o card [integrability-1] (Zod no boundary do frontend) e o card
  [modifiability-3] (propagar o enum completo, avaliar geração de tipos a partir do Zod do
  backend) resolvem as duas camadas do mesmo problema; fazer os dois no mesmo PR evita que a
  validação de forma (a) rode sobre um enum ainda incompleto (b).

### CC-3: Gap de calendário bancário amplificado por deploy sem rollout gradual

- **Aparece em**: Availability, Deployability
- **Findings**: F-availability-1 (Availability), F-deployability-1 (Deployability)
- **Diagnóstico unificado**: o BankingCalendar documenta conscientemente que feriados
  municipais/estaduais e 31/12 estão fora de escopo — uma decisão de escopo razoável para a v1. O
  problema não é a decisão em si, é que a plataforma de deploy (Render Starter, autoDeploy: true,
  sem canary) entrega essa lógica a 100% do tráfego de remessa assim que o health check passa. As
  duas limitações se somam: um gap de cobertura conhecido + zero cohort de validação = a primeira
  remessa real pós-deploy é o primeiro teste em produção plena.
- **Recomendação consolidada**: o card [deployability-1] (flag de validação em dry-run forçado por
  N remessas antes da escrita real) é a mitigação de curto prazo — reusa o mecanismo
  dryRunOverride já existente, esforço S. O card [availability-1] (cobertura de feriados por
  praça) é a correção de raiz, esforço M. Recomenda-se sequenciar o card de deploy primeiro (fecha o
  risco imediato) e o de cobertura de calendário em seguida (fecha a causa).

### CC-4: Escrita write-ahead não-transacional cria estado órfão silencioso (padrão, não bug único)

- **Aparece em**: Availability, Fault Tolerance
- **Findings**: F-availability-2 (Availability), F-fault-tolerance-3 (Fault Tolerance)
- **Diagnóstico unificado**: setDataDebito (Postgres) e setRequestPayload/marca d'água (Postgres,
  tabela diferente) rodam como 2 UPDATEs sequenciais sem transação compartilhada. O sistema já é
  fail-closed nessa janela (comprovado por teste), então não há risco de dano funcional — mas cada
  QA aponta a mesma lacuna estrutural de ângulos diferentes: Availability como "dado órfão sem log",
  Fault Tolerance como "atomicidade ausente no write-ahead".
- **Recomendação consolidada**: um único card ([fault-tolerance-3], envolver as duas escritas em
  db.withTransaction) elimina a janela por completo, o que também resolve [availability-2] por
  construção — não seria mais possível ter data_debito sem a marca d'água correspondente. Vale
  implementar [fault-tolerance-3] primeiro e reavaliar se [availability-2] (log do órfão) ainda é
  necessário depois.

### CC-5: GET /sispag/lotes/:id/remessa/janela como elo mais fraco do arquivo em 2 dimensões

- **Aparece em**: Availability, Security
- **Findings**: F-availability-3 (Availability), F-security-2 (Security)
- **Diagnóstico unificado**: a rota nova de leitura desta feature não replica os 2 guards que suas
  rotas irmãs no mesmo arquivo já adotam — heavyRouteLimiter (presente na POST .../remessa
  irmã) e requireRole('admin') (presente em /linhas-digitaveis e /remessa/arquivo, que tocam
  dado de fornecedor equivalente). Nenhuma das duas ausências é uma regressão de superfície nova
  (o mesmo dado já sai de GET /lotes/:id, que também não tem os dois guards), mas é uma
  oportunidade de fechar as duas no mesmo PR, já que tocam a mesma declaração de rota.
- **Recomendação consolidada**: cards [availability-3] e [security-2] são pequenos (S cada) e
  tocam o mesmo bloco de código (routes/sispag.ts:440-457) — recomenda-se implementá-los juntos
  num único commit em vez de dois PRs separados.

## 4. Quick wins (≤5 dias úteis)

Esforço S, severidade ≥ P2 — candidatos para a primeira sprint pós-aprovação.

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| availability-2 | Availability | S | P2 | 100% dos casos de data_debito órfã (persistida sem native_flp_cod) logados via logService.warn, em vez de silenciosos |
| deployability-1 | Deployability | S | P2 | ≥3 remessas de validação em dry-run forçado antes da 1ª escrita real pós-deploy de mudança futura no fin015 |
| integrability-1 | Integrability | S | P2 | 0 → ≥2 endpoints frontend do módulo SISPAG com Zod validando a forma da resposta antes do uso |
| modifiability-3 | Modifiability | S | P2 | DebitDateOutsideWindowError.details.motivo deixa de ser string solto e passa a ser a união dos 6 valores reais |
| testability-1 | Testability | S | P2 | Cobertura de arquivos de lógica de frontend do delta: 50% (2/4) → 100% (4/4); mapeamento erro→toast testado |
| testability-3 | Testability | S | P2 | RemessaService.test.ts: 1452 → ≤900 LOC, sem perder nenhum caso, via extração do describe "data de débito" |

Esses 6 cards resolvem 6 dos 10 P2 do run sem competir por atenção com trabalho de feature nova —
argumento defensável em reunião como "aceitamos isso como primeira sprint pós-aprovação".

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| modifiability-1 (absorve integrability-2) | Modifiability, Integrability | L | Split Module / Refactor / Use an Intermediary | Complexidade cognitiva 91 (teto 15, 6x acima) e 10 colaboradores injetados (limite heurístico 2 Clients) em RemessaService.ts, o arquivo que dispara escrita bancária real; 3 perguntas P1 já abertas sobre esta mesma regra vão tocar o mesmo arquivo se não for feito antes |
| testability-2 | Testability | M | Abstract Data Sources | 0 testes de integração em domain/repository/** contra a exata classe de bug (encoding to_char/::date) que motivou a ADR-0049 — a migration 0061 já documenta o risco no próprio comentário |
| security-1 | Security | M | Authorize Actors | 1 papel efetivo em produção (admin) para N usuários; a proposta comercial promete RBAC como requisito cross-cutting, e esta feature aumenta o número de decisões de negócio (qual data de débito) que um "admin" universal toma sozinho |
| fault-tolerance-1 | Fault Tolerance | M | Reconcile / Condition Monitoring | 0% dos casos status='error' AND native_flp_cod IS NULL passam por checagem de órfão hoje (100% dos reconciling passam); com data_debito agora escolhível, cada lote fantasma carrega uma data que ninguém mais rastreia |
| modifiability-2 | Modifiability | M | Restrict Dependencies | 4 imports de domain/repository/*/domain/client/* em routes/sispag.ts (alvo: 0) — a cadeia route → Service → Repository → Client é regra sem exceções no CLAUDE.md, policiada pelo PatternGuardian, e este arquivo é o precedente ruim que cada novo endpoint copia |
| availability-1 | Availability | M | Exception Prevention | Cobertura de feriados de praça: 0% → alvo 100% das praças com conta pagadora ativa; hoje é gap autoadmitido no próprio código-fonte, não hipótese |
| integrability-3 | Integrability | M | Contract testing | 0 de 2 arquivos de teste do delta usam fixture real do fin015; o próprio RemessaService.ts documenta pelo menos 1 caso histórico de mudança de encoding do ERP descoberta em produção (itsVldModalidade) |

## 6. O que está bem (e por quê)

1. **Fail-closed sistemático antes de qualquer escrita no ERP** (tactic Sanity Checking /
   Exception Prevention). DebitDateService.validate roda 100% das vezes antes do criarLote;
   confirmado por Availability, Fault Tolerance e Security de forma independente —
   RemessaService.ts:322-327.
2. **O bug de origem foi corrigido corretamente, com teste dedicado ao horário-limite** (tactic
   Timestamp / Limit Non-Determinism). hojeUtc() (meia-noite UTC, o bug real) foi substituído
   por todayBrt() via BankingCalendar, com 2 testes cobrindo 23h30 e meia-noite BRT —
   BankingCalendar.test.ts:89-98. Testability chama isso de implementação "exemplar".
3. **Write-ahead + marca d'água estendida corretamente para incluir dataDebito** (tactic Verify
   Message Integrity / Idempotent Replay). Um retry com data diferente da persistida é recusado,
   não ignorado — RemessaService.ts:454-459, 860-861, com 8 cenários de "data congelada"
   cobertos por teste.
4. **Zero superfície nova de risco**: nenhum segredo hardcoded, nenhum SQL não-parametrizado,
   nenhuma dependência nova de runtime, nenhuma chamada nova ao Conexos introduzida pelo delta —
   confirmado independentemente por Security e Performance.
5. **Split correto no lado novo do domínio**: DebitDateService (194 LOC) e BankingCalendar (138
   LOC) nasceram como classes coesas e testáveis (withClock para injeção de relógio), em vez de
   crescer RemessaService ainda mais — tactic Split Module / Increase Semantic Coherence,
   confirmado por Modifiability e Testability.
6. **Calendário bancário calculado em código, sem dependência externa nova** (tactic Reduce
   Overhead / Increase Competence Set). Evita uma classe inteira de falha de disponibilidade (API
   de feriados fora do ar) — decisão documentada e consciente, elogiada por Availability e
   Performance.
7. **Migration aditiva, idempotente, nullable, sem backfill, com runbook de rollback dedicado**
   (tactic Idempotent deploys / Rollback). docs/runbooks/rollback.md classifica esta migration
   como caso "seguro"; BootMigrator usa advisory lock nomeado — confirmado por Deployability.
8. **~60 casos de teste dedicados à regra nova (I8/I8b)**, com injeção de dependência via
   construtor em 100% dos testes de serviço/rota (tactic Specialized Interfaces / Executable
   Assertions) — nenhum container.resolve em teste unitário, nenhuma chamada de rede real,
   nenhum estado compartilhado via beforeAll/afterAll.

## 7. Limitações da análise

**Métricas declaradas "não medíveis localmente" pelos agentes:**
- Frequência real de rejeição do ERP por feriado de praça não coberto; MTTR de uma remessa presa em
  RemessaEmDuvidaError/DebitDateFrozenError (Availability) — requer logs de produção; infra/
  não existe neste repo.
- Injeção de falha (crash entre setDataDebito e criarLote) para confirmar o comportamento do
  dado órfão (Availability, Fault Tolerance) — requer fault-injection, fora do escopo --quick.
- Tempo real de build/deploy em produção e teto real do pool de conexões Supavisor (Deployability).
- Taxa de erro por integração / observability de falhas do fin015 agregada por dependência
  (Integrability).
- Latência real p50/p95 em produção/HML; bundle size e cold start são N/A (backend roda em
  Express/Render, não Lambda) (Performance).
- Infra de segurança multi-tenant (IAM, CloudTrail, GuardDuty, SSM, cross-account) — estado-alvo,
  não existe neste repositório (Security).
- Percentual de cobertura de linhas/branches por diretório — --quick não rodou npm test --coverage;
  os pisos de jest.config.cjs (domain/service/: lines 88%, branches 60%) não foram
  verificados contra o delta especificamente (Testability).

**O que este pipe não cobre:** chaos engineering / fault-injection real, threat modeling formal,
custo de infraestrutura cloud, UX e acessibilidade, penetration testing, carga real em produção.

**Divergência registrada entre agentes (transparência de método):** Availability classifica a
ausência de heavyRouteLimiter em GET /remessa/janela como P3 (inconsistente com o padrão do
arquivo); Performance, avaliando a mesma rota sob a lente de custo computacional, considera o
comportamento aceitável ("mesmo padrão das demais leituras do arquivo"). O achado de Availability
foi mantido no KANBAN.md (mais conservador, foco em consistência de política) — a divergência de
julgamento entre os dois agentes é registrada aqui, não resolvida por este consolidador.

**Cards mesclados:** [integrability-2] (extrair adapter fino para as 6 chamadas em série do fin015)
foi absorvido por [modifiability-1] (extrair RemessaWriteOrchestrator/dividir
gerarRemessaSerializado) no KANBAN.md — os dois agentes, de forma independente, recomendaram
extrair um orquestrador do mesmo método (RemessaService.gerarRemessaSerializado) pelo mesmo
motivo (hotspot de complexidade/acoplamento), sinalizado explicitamente nas notas cruzadas de ambos
(modifiability.md §6, integrability.md §6). O card mesclado herda a severidade P1 (a mais alta das
duas) e cita as 3 findings de origem (F-modifiability-1, F-modifiability-2, F-integrability-2).
Nenhum outro card teve conteúdo alterado além da renumeração/deduplicação descrita aqui.

**Janela temporal:** este é um snapshot do delta em 2026-09-22, escopado à branch
fix/sispag-data-pagamento (ADR-0049). Código pré-existente do módulo SISPAG (ex.: arquitetura de
retomada da ADR-0039, já revisada em docs/regis-review/2026-08-25-1742-sispag-retomada/) não foi
reavaliado aqui, exceto quando diretamente tocado ou amplificado pelo delta. Recomenda-se repetir o
Regis-Review completo do módulo SISPAG trimestralmente, não apenas por delta de feature.

## 8. Ações recomendadas

1. **Fechar os 6 quick wins de esforço S na primeira sprint pós-aprovação** (availability-2,
   deployability-1, integrability-1, modifiability-3, testability-1, testability-3) — baixo custo,
   resolve 6 dos 10 P2 sem competir com trabalho de feature nova.
2. **Adicionar o teste de integração de round-trip de data_debito contra Postgres real
   (testability-2) antes do próximo /feature-tweak que toque coluna DATE/timestamp no SISPAG** —
   é a rede de segurança que falta exatamente para a classe de bug (encoding de fuso) que a ADR-0049
   corrigiu.
3. **Extrair o orquestrador de escrita do fin015 de dentro de RemessaService (modifiability-1,
   absorve integrability-2) como trilha própria**, fora da janela de outra feature, usando a suíte
   de testes já verde (RemessaService.test.ts) como rede de segurança.
4. **Provisionar o segundo papel RBAC (security-1) e estender a checagem de órfão para
   status='error' (fault-tolerance-1) em paralelo** — reduzem blast radius de um incidente real de
   escrita financeira, sem dependência entre si.
5. **Antes do próximo deploy de mudança no payload do fin015, combinar a flag de validação em
   dry-run (deployability-1) com a extensão de cobertura de feriados de praça (availability-1)** — a
   combinação fecha o gap "primeira remessa real sem rede de segurança" identificado em CC-3.
