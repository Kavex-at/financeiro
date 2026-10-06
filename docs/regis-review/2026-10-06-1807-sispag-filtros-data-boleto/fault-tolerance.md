---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
agent: qa-fault-tolerance
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 9
findings_count: 2
cards_count: 1
---

# Fault Tolerance — Regis-Review

Escopo: delta dos commits `65d1fdf` e `da095fa`. O delta é somente leitura: filtros de data/boleto nas abas do SISPAG, mais `vencimentoDe/vencimentoAte` em memória no `GET /sispag/boletos-dda`. Não há escrita no Conexos/Nexxera, nem SQL, nem migration, nem fila SQS, nem mudança de estado de lote/permuta. As inspeções A–E (idempotência, transação, outbox, DLQ, reaper, reconciliação) não são tocadas pelo delta e ficam fora do score.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (UI) ou cliente HTTP malformado | Envia `vencimentoDe/Ate` inválidos, invertidos ou impossíveis (`2026-99-99`); refaz a consulta várias vezes (duplo clique, mudança rápida de data) | `GET /sispag/boletos-dda` (`routes/sispag.ts`, `PaginacaoBoletoDda`) e filtros client-side do kit `tabela-filtro.tsx` | Operação normal, leitura pura sobre o snapshot DDA em memória | Rejeitar formato inválido com 400 (Sanity Checking); consulta é idempotente por natureza, sem efeito colateral; nenhum estado financeiro é alterado | 0 escritas no delta; 100% dos formatos fora de `YYYY-MM-DD` retornam 400; 0 itens financeiros em estado intermediário por causa do filtro |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas (DB/externas) introduzidas no delta | 0 | 0 para um filtro de leitura | ✅ | `git show --stat 65d1fdf da095fa`; `_shared-metrics.md` ("no SQL, no Conexos write") |
| Parâmetros novos validados com Zod no boundary | 2/2 (`vencimentoDe`, `vencimentoAte`) | 100% | ✅ | `src/backend/routes/sispag.ts` (diff `boletosDdaSchema`) |
| Casos de 400 cobertos por teste (formato inválido, lixo/injection) | 2 | ≥ 1 por parâmetro | ✅ | `src/backend/routes/sispag.test.ts` (diff) |
| Validação semântica da data (mês/dia reais) | 0/2 (regex só valida forma) | 2/2 | ⚠️ | `DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/` |
| Validação de intervalo invertido (de > até) | ausente | presente ou resposta explícita | ⚠️ | `PaginacaoBoletoDda.ts` `vencimentoOk` |
| Endpoints mutantes novos sem idempotência | 0 | 0 | ✅ | delta não adiciona POST/PUT |
| Callsites de mutação de estado sem trilha de auditoria (do delta) | 0 | 0 | ✅ | delta sem mutação |
| Timeouts / DLQ / reaper / reconciliação | Não afetados pelo delta | n/a | N/A | ver nota 6 |

> ⚠️ **Não medível localmente**: taxa de erro de `GET /sispag/boletos-dda` em produção. Requer logs/APM do Render. Recomendação: contar 400 por parâmetro para detectar clientes com data malformada.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution / Replacement / Predictive Model / Increase Competence Set | N/A: delta de leitura, sem componente de risco a substituir | N/A | n/a |
| Sanity Checking | Zod `regex` estrito em `vencimentoDe/Ate`; formato garante comparação por string. Faltam validade calendária e ordem de/até | ⚠️ parcial | `routes/sispag.ts` (`boletosDdaSchema`); `PaginacaoBoletoDda.ts` |
| Comparison / Voting | N/A: sem redundância de réplicas em filtro de leitura | N/A | n/a |
| Timestamp | Datas civis separadas em dia ERP (UTC) e instante (BRT) para evitar deslocamento de dia | ✅ presente | `filtroDatas.ts` (`diaDoErp`, `diaEmBrasilia`) |
| Timeout / Condition Monitoring / Self-Test | Não alterados; sem chamada externa nova | N/A | `_shared-metrics.md` |
| Redundancy / Recovery (forward/backward) | N/A: sem escrita a recuperar | N/A | n/a |
| Reintroduction (Shadow, State Resync, Escalating Restart) | N/A | N/A | n/a |
| Rollback / Compensating Transaction | N/A: sem transação nem write externo | N/A | n/a |
| Idempotent Replay | Consulta puramente funcional (`paginar` sem estado), reexecutar é seguro; `chave` do React inclui o filtro, evitando resposta obsoleta | ✅ presente | `PaginacaoBoletoDda.ts`; `BoletosDdaTab.tsx` (`chave`) |
| Repair State / Reconcile / Quarantine | N/A: não toca fila de exceção, lote ou permuta | N/A | n/a |

## 4. Findings (achados)

### F-fault-tolerance-1: Intervalo de vencimento inválido retorna lista vazia silenciosa

- **Severidade**: P3
- **Tactic violada**: Sanity Checking
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts` (`DATA_CIVIL_REGEX`, `vencimentoOk`); `src/backend/routes/sispag.ts` (`boletosDdaSchema`)
- **Evidência (objetiva)**:
  ```
  export const DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  ...
  (vencimentoDe === undefined || b.vencimento >= vencimentoDe) &&
  (vencimentoAte === undefined || b.vencimento <= vencimentoAte)
  ```
  `vencimentoDe=2026-13-45` passa no Zod; `de > ate` também. Ambos resultam em `total: 0` com HTTP 200, sem sinal de erro.
- **Impacto técnico**: um intervalo impossível ou invertido é tratado como "nenhum boleto" e não como entrada inválida. A UI sai de `<input type="date">`, que já impede datas impossíveis, então o risco real é cliente HTTP direto ou o usuário digitar de > até.
- **Impacto de negócio**: a analista pode concluir que não há boletos a pagar no período quando na verdade o filtro estava invertido. Baixo, pois a lista vazia mostra a dica "Ajuste ... o vencimento" quando `filtrando`.
- **Métrica de baseline**: 2 de 2 parâmetros sem validação semântica; 0 testes de intervalo invertido.

### F-fault-tolerance-2: Filtros client-side operam sobre a lista já carregada (sem aviso de truncamento)

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/frontend/app/sispag/page.tsx`; `src/frontend/app/permutas/components/tabela-filtro.tsx` (filtros de data/boleto nas abas títulos, candidatos, finalizados, REM, RET)
- **Evidência (objetiva)**: o delta filtra no cliente, sobre o que a aba recebeu. Se a fonte for paginada ou truncada a montante, o filtro por data mostra "nenhum resultado" para itens que não foram carregados. Não verificado se alguma dessas listas é truncada hoje (a nota de memória sobre `listGenericPaginated` de página única sugere cautela, mas é anterior ao delta).
- **Impacto técnico**: possível falso negativo de visualização, sem efeito sobre estado financeiro.
- **Impacto de negócio**: analista pode achar que um título não existe quando só não foi carregado. Mitigado pelo fato de ser leitura.
- **Métrica de baseline**: 5 abas com filtro client-side; 1 (DDA) com filtro server-side e contagem coerente com o filtro (`contagem` calculada depois do intervalo, coberto por teste).

Sem finding P0/P1: o delta não introduz dual-write, SQS, escrita financeira ou perda silenciosa de dados.

## 5. Cards Kanban

### [fault-tolerance-1] Validar data civil real e intervalo invertido em `/sispag/boletos-dda`

- **Problema**
  > O regex `^\d{4}-\d{2}-\d{2}$` aceita `2026-13-45` e o endpoint aceita `vencimentoDe > vencimentoAte`; ambos devolvem 200 com lista vazia, indistinguível de "sem boletos no período".

- **Melhoria Proposta**
  > Sanity Checking: no `boletosDdaSchema`, trocar o `regex` por refinement que valida a data de calendário (ex.: `Date.UTC` round-trip) e adicionar `.superRefine` rejeitando `de > ate` com 400. Em `FiltroBarra`, desabilitar/avisar quando de > até. Adicionar casos em `sispag.test.ts`. Documentar em F-fault-tolerance-2 que a UI deve sinalizar listas truncadas, se existirem.

- **Resultado Esperado**
  > Entradas impossíveis ou invertidas retornam 400 com mensagem em português; casos inválidos aceitos: 2 → 0.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Formatos semanticamente inválidos aceitos pelo Zod: 2 classes (data impossível, de > ate) → 0
  - Testes de 400 para esses casos: 0 → 2
- **Risco de não fazer**: leitura enganosa ocasional ("sem boletos") por cliente HTTP ou digitação invertida; sem risco financeiro direto.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta; ele é leitura pura, então inspeções A–E (idempotência SQS/POST, transação, outbox, DLQ, reaper, reconciliação, compensação, trilha de auditoria) não se aplicam e não entram no score. Esses gaps estruturais pertencem a runs de escopo `all`.
- F-fault-tolerance-2 é suposição de risco não verificada; não foi medido se alguma lista das abas é truncada hoje.
- Cross-QA: o regex estrito com a observação "nada disto chega a SQL" cruza com Security (input validation); testes de 400 cruzam com Testability.
