---
type: regis-review-kanban
run_id: 2026-10-27-1546
total: 2
counts: { p0: 0, p1: 1, p2: 1, p3: 0 }
source_cards: 4
source_counts: { p0: 0, p1: 1, p2: 3, p3: 0 }
---

# Kanban — financeiro — 2026-10-27-1546

Lista operacional deduplicada, ordenada por prioridade e esforço. Há 2 ações únicas, derivadas de 4 cards fonte. Os textos originais estão preservados verbatim abaixo; as duas fichas de apoio HML são rastreabilidade, não tickets adicionais.

| ID estável para execução | Prioridade | Esforço | QAs / cards fonte | Ação |
|---|---|---|---|---|
| deployability-1 | P1 | S (≤1d) | Deployability, Availability, Testability: deployability-1, availability-1, testability-1 | Comprovar a guarda em HML antes do merge, com todas as pós-condições dos três cards |
| integrability-1 | P2 | S (≤1d) | Integrability: integrability-1 | Validar contrato bruto fin015 no follow-up existente |

Gates locais finais: 305 suites / 5979 testes (89,147 s); typecheck 0; lint 0, 124 warnings (mesma contagem da baseline); diff check 0. Focados: 314/314. Dependência de gates locais citada nas fontes está satisfeita; dependência HML permanece. Task 22 é gate separado da feature. Nenhum card autoriza chamadas ERP nesta revisão.

## P0 — Crítico

Nenhuma ação.

## P1 — Alto

### [deployability-1] Comprove a guarda em HML antes do merge

- **Problema**
  > A última V7 real terminou 5/6 porque o borderô continuava no lote anterior; a guarda nova ainda tem 0 provas HML registradas. O merge ativa o fluxo em produção sob os kill-switches existentes.
- **Melhoria Proposta**
  > Aplicar o gate de Scale Rollouts já definido na Task 21: no ciclo HML autorizado, observar o grupo inteiro `RETIRADO` com `BORDERO_ANTERIOR_NAO_RESOLVIDO`, alerta acionável, antigo preservado e nenhuma importação indevida. Registrar retomada e continuidade dos demais itens após limpeza observada do rascunho atual. Anexar evidência saneada ao plano/achados e PR; manter merge bloqueado enquanto faltar a prova. Não adicionar flag, migration ou liberação automática.
- **Resultado Esperado**
  > De 0 para ≥1 rodada pós-correção aprovada nos critérios aplicáveis da Task 21, com vínculo antigo persistente tratado antes da finalização e gates locais finais registrados.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Provas HML pós-guarda: 0 → ≥1 aprovada com evidência saneada.
  - Importações do grupo com vínculo antigo persistente na rodada: baseline nova não medida → 0.
- **Risco de não fazer**: liberar a correção sem validar o contrato ERP repetiria por meses tentativas inválidas e retrabalho operacional.
- **Dependências**: gates finais do coordenador; execução HML autorizada no ciclo próprio; Task 22 continua sendo gate separado da feature, sem repetição nesta revisão.

## P2 — Médio

### [integrability-1] Valide o contrato bruto das leituras usadas como prova de liberação

- **Problema**
  > O adapter converte resposta sem rows válidas em lista vazia; a guarda pode interpretar drift como ausência completa do item anterior. Os testes do serviço recebem clientes mockados e não verificam essa normalização.
- **Melhoria Proposta**
  > Aplicar Adhere to Standards com uma leitura estrita, limitada aos endpoints fin015 usados pela guarda, preservando a distinção entre ausência válida e envelope inválido antes da normalização. Exigir os campos do cabeçalho necessários ao contrato, conforme fixtures reais, e testar do adapter ao cliente; manter comportamento dos demais consumidores fora do escopo.
- **Resultado Esperado**
  > Respostas inválidas usadas como prova de ausência: permitidas pela normalização atual → 0; erro deve produzir BORDERO_ANTERIOR_NAO_RESOLVIDO sem importação e com alerta.
- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Envelopes sem rows, rows não-array e cabeçalho com campos obrigatórios ausentes: 100% rejeitados pelo contrato estrito.
  - Fixtures válidas de lote vazio e item ausente: 100% preservam o caminho permitido.
- **Risco de não fazer**: Em seis meses, mudança incompatível do ERP pode ser tratada como liberação do item e recriar a recusa tardia.
- **Dependências**: Fixtures saneadas do contrato fin015; prova HML continua pendente e separada.

## P3 — Baixo

Nenhuma ação.

## Anexo — fichas fonte incorporadas à ação deployability-1

Não importar como ações adicionais. Textos preservados verbatim; prioridade operacional consolidada P1. Findings de origem: F-availability-1, F-deployability-1 e F-testability-1.

### [availability-1] Comprove retirada e continuidade no ERP após a guarda

- **Problema**
  > A V7 anterior terminou 5/6 devido ao vínculo residual no lote antigo. A guarda e as correções locais de retomada/limpeza ainda não têm prova HML posterior registrada; mocks não demonstram a continuidade dos demais pagamentos.

- **Melhoria Proposta**
  > Aplicar Self-Test e validar Degradation no roteiro HML aprovado, em execução separada autorizada: item ainda vinculado produz retirada de todos os títulos e Alerta acionável; antigo permanece intacto; rascunho atual é saneado sem excluir borderô reaproveitado; demais itens seguem. Exercitar retomada do rascunho completo, falha de leitura e lote esvaziado, documentando resíduos. Não automatizar liberação do lote antigo.

- **Resultado Esperado**
  > Passar de 0 provas HML pós-correção registradas para 1 execução completa com todas as pós-condições documentadas antes do merge, incluindo ausência de importação indevida e de mutação no antigo.

- **Tactic alvo**: Self-Test / Degradation
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Prova HML pós-correção registrada: 0 → 1 execução completa aprovada.
  - Importações do grupo com vínculo persistente: alvo 0 na execução observada; baseline pós-correção não medido.
  - Mutações do lote/borderô antigos pela guarda: alvo 0 na execução observada; baseline pós-correção não medido.
- **Risco de não fazer**: manter por seis meses um caminho localmente validado sem confirmação da recuperação no ERP, acumulando bloqueios e intervenção manual em rejeições.
- **Dependências**: gates finais do coordenador após correções de retomada e limpeza; execução HML separada conforme Task 21. Nenhuma chamada ERP autorizada por este card/review.

---

### [testability-1] Registrar prova HML da guarda e da retirada seletiva

- **Problema**
  > Os 314 testes locais passam, mas não há rodada HML pós-correção registrada. A integração anterior falhou na finalização apesar da importação aceita.
- **Melhoria Proposta**
  > Aplicar Recordable Test Cases na fixture HML autorizada da Task 21; registrar leituras completas, RETIRADO, alerta, preservação de item/baixas antigos e continuidade do avulso. Anexar evidência saneada e converter divergências do ERP em fixture de regressão. Não testar liberação automática nesta rodada.
- **Resultado Esperado**
  > Rodadas com pós-condições reais comprovadas: 0 → 1; nenhuma exclusão no antigo ou segundo borderô.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Rodadas HML pós-correção com evidência: 0 → 1.
  - Item antigo e suas baixas: contagem anterior → mesma contagem posterior.
- **Risco de não fazer**: Promover em produção uma suposição de integração que só foi confirmada no fake.
- **Dependências**: Fixture e execução HML autorizadas; gate obrigatório antes do merge já previsto na Task 21.
