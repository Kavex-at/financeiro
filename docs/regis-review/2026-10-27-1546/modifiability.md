---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-27-1546
agent: qa-modifiability
generated_at: 2026-10-27T15:59:00.609028+00:00
scope: backend
score: 8
findings_count: 0
cards_count: 0
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Equipe SISPAG | Corrigir reconhecimento de rejeição e retomada sem modificar lote antigo | BorderoGrupoBoletoService, RemessaService e retirada existente | Backend Express/Render, ERP com estado incerto | Centralizar prova de ausência e reutilizar retirada; manter configuração de escrita | Uma guarda privada compartilhada, zero client/SQL/schema novos e 314 testes focados verdes |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Guarda de vínculo anterior | 1 método privado; 2 pontos chamadores | Uma regra compartilhada entre adoção e retomada | ✅ | BorderoGrupoBoletoService.ts:639,980,1004 |
| Retomada com grupos presentes | 1 branch grupos.length > 0; 2 regressões completo/parcial | Sempre preparar antes de barra/finalização | ✅ | RemessaService.ts:1276; RemessaService.test.ts:4495,4535 |
| Superfície arquitetural introduzida | 0 clients, repositories, tabelas ou dependências novos | Reutilizar boundaries atuais | ✅ | git diff --stat; imports do delta |
| Composição de limpeza | 1 caminho distingue execução reaproveitada após ausência do item atual | Preservar antigo e continuar saudável | ✅ | BorderoGrupoBoletoService.ts:1318; teste:1326 |
| Mapeamento ontológico amostrado | 5/5 caminhos relevantes existem (100%) | 100% | ✅ | ontology/_index.json:1906-1915; Path.exists para 5 referências |
| Distribuição LOC fonte backend | p50 96; p95 728; máximo 2415 | Referência do agente: p50 ≤150, p95 ≤400, máximo ≤600 | ⚠️ | Python rglob, sem tests/node_modules/dist; percentil nearest-rank; contexto preexistente |
| Tamanho de BorderoGrupoBoletoService | 1589 linhas atuais; delta +103/-3 | Conter nova regra num método e evitar repetição | ⚠️ | Python splitlines; git diff --numstat |
| Tamanho de RemessaService | 2403 linhas atuais; delta +12/-7 | Alteração localizada na retomada | ⚠️ | Mesmos comandos; tamanho preexistente não reaberto como finding |
| Gates finais do coordenador | 305 suites / 5979 testes; typecheck e lint exit 0; 124 warnings no baseline; diff check 0 | Zero falhas | ✅ | _shared-metrics.md, atualização final |
| Testes focados | 4 suites / 314 testes aprovados | Zero regressões observadas | ✅ | Jest --runInBand --silent nas quatro suites SISPAG |
| Complexidade cognitiva específica do delta | Não medida | Não introduzir ramificações duplicadas da regra | ⚠️ | Sem análise AST diferencial nesta revisão quick |

Apêndice obrigatório — top-10 maiores arquivos fonte (contexto do repositório, não lista de achados do delta):

| Arquivo | Linhas |
|---|---|
| `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` | 2415 |
| `src/backend/domain/service/sispag/RemessaService.ts` | 2403 |
| `src/backend/routes/sispag.ts` | 1869 |
| `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` | 1735 |
| `src/backend/domain/client/ConexosSispagWriteClient.ts` | 1705 |
| `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts` | 1589 |
| `src/backend/domain/service/sispag/LotePagamentoService.ts` | 1478 |
| `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts` | 1359 |
| `src/backend/domain/client/ConexosGerDocProcessoClient.ts` | 1300 |
| `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts` | 1262 |

Apêndice obrigatório — top-10 serviços com maior fan-in. Contagem de arquivos fonte backend com import estático relativo terminado no nome do serviço; exclui testes, dist e node_modules. Não inclui imports dinâmicos nem resolve aliases.

| Serviço | Arquivos importadores |
|---|---|
| `src/backend/domain/service/LogService.ts` | 71 |
| `src/backend/domain/service/operacao/NotificacaoService.ts` | 11 |
| `src/backend/domain/service/sispag/RegraSugestaoBoleto.ts` | 10 |
| `src/backend/domain/service/sispag/DestinoPagamentoResolver.ts` | 6 |
| `src/backend/domain/service/sispag/SituacaoPagamentoService.ts` | 5 |
| `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts` | 4 |
| `src/backend/domain/service/sispag/LotePagamentoService.ts` | 4 |
| `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` | 4 |
| `src/backend/domain/service/permutas/ErpErrorInterpreter.ts` | 4 |
| `src/backend/domain/service/permutas/EleicaoPermutasService.ts` | 4 |

⚠️ **Não medível localmente nesta revisão quick**: custo real de mudança em horas, ciclos completos do grafo de dependências, complexidade AST diferencial e drift total da ontologia. Exigem análise específica além do delta; a amostra de caminhos não é uma auditoria integral. Terraform/tenants não são mensuráveis: não há infra atual.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Guarda nova isolada como método; arquivos hospedeiros grandes preexistentes | ⚠️ parcial | BorderoGrupoBoletoService.ts:1004; tabela LOC |
| Increase Semantic Coherence | Prova do vínculo antigo pertence à preparação; reconhecimento da retomada pertence à remessa; retirada mantém responsabilidade própria | ✅ presente | BorderoGrupoBoletoService.ts:1004; RemessaService.ts:1276; RetiradaCodigoBarrasService.ts:511 |
| Encapsulate | Checks de chave, identidade, status e leitura fechada encapsulados em unresolvedPreviousBatch | ✅ presente | BorderoGrupoBoletoService.ts:1004-1065 |
| Use an Intermediary | Clients existentes encapsulam ERP; retirada coordena compensação do novo rascunho | ✅ presente | BorderoGrupoBoletoService.ts:1044-1057,1318 |
| Restrict Dependencies | Novas verificações usam ledger e write já injetados; nenhum acesso direto a SQL ou HTTP no delta | ✅ presente | git diff dos serviços; construtor BorderoGrupoBoletoService |
| Refactor | Retomada consolidada em branch única para grupos presentes; método comum elimina repetição entre adoção e seguir | ✅ presente | RemessaService.ts:1276; BorderoGrupoBoletoService.ts:639,980 |
| Abstract Common Services | Retirada e leitura nativa existentes reaproveitadas; sem novo fluxo paralelo de remoção | ✅ presente | BorderoGrupoBoletoService.test.ts:1326; RetiradaCodigoBarrasService.ts:511 |
| Defer Binding | Dependências tsyringe e flags de escrita existentes; obrigação de ausência continua regra de domínio, sem flag para contorná-la | ✅ presente | BorderoGrupoBoletoService.ts:1287; EnvironmentProvider; testes por construtor |

## 4. Findings (achados)

Nenhum achado adicional acionável no delta final inspecionado. A guarda centralizada cobre adoção e retomada; a retomada completa e parcial volta a preparar; a limpeza distingue o item atual do borderô antigo. Não se reabriu a dívida preexistente de tamanho dos serviços como novo incidente arquitetural.

## 5. Cards Kanban

Nenhum card novo de Modifiability: não há finding adicional desta correção. A prova HML pendente está no card testability-1 e no gate existente da Task 21.

## 6. Notas do agente

Escopo quick: correção do reenvio rejeitado, sem revisão ampla da dívida preexistente.
Refactor/Encapsulate conectam Integrability; tamanho e composição conectam Testability.
Defer Binding por kill-switch conecta Deployability; a ausência comprovada não deve virar flag opcional.
Amostra ontológica 5/5 confirma caminhos, não a completude de todas as entidades.
Não houve ERP/rede/DB; gates completos pertencem ao coordenador.
