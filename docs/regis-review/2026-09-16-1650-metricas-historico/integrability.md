---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-16-1650-metricas-historico
agent: qa-integrability
generated_at: 2026-09-18T00:00:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| `kavex-report-ciclo` (skill Python, repo externo em `~/.claude/skills/`) | `GET /metricas/ciclo?inicio=&fim=` (report semanal, sexta à tarde) | `routes/metricas.ts` → `MetricasCicloService` → `MetricasCicloRepository` → `metricas.metricas_ciclo()` | Produção, pós-deploy do delta (ADR-0048) | A resposta para um consumidor que NÃO envia `historico` deve ser byte a byte a de antes da mudança — mesmos 9 campos do contrato + `parcial`/`apurado_ate`, mesma ordem, mesmo `serieInicio` | 0 desvio de forma ou de piso da série para chamadas sem `historico`; nenhuma alteração de código no consumidor externo é necessária |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Campos do contrato preservados (forma, ordem, tipo) | 9/9 + `parcial`/`apurado_ate`, ordem idêntica | 9/9 sem desvio | ✅ | `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:63-71`, guarda estática `src/backend/migrations/vwMetricasCiclo.test.ts:34-43` |
| Chaves de `metrica` alteradas/renomeadas/removidas no delta | 0 | 0 | ✅ | `git diff origin/main -- src/backend/migrations/0058*.sql` vazio; 0060 não redefine `metricas_ciclo()` nem a view |
| `metrics.py` envia `historico` na query | Nunca (chave ausente de `COLUNAS`/query) | Nunca, até a skill ser alterada | ✅ | `/home/inteli/.claude/skills/kavex-report-ciclo/scripts/metrics.py:72-79` (`urlencode({"inicio":..., "fim":...})`, sem `historico`) |
| `--inicio`/`--fim` opcionais em `metrics.py` | `required=True` nos dois | Continuar obrigatório (senão a garantia D3 depende do script externo) | ✅ (mas ver F-integrability-1) | `metrics.py:81-83` |
| `serieInicio` para chamada sem `historico` | Inalterado, `metricas.serie_inicio()` | Inalterado | ✅ | `MetricasCicloRepository.ts:79-89`; teste `routes/metricas.test.ts:120-128` |
| `vw_metricas_ciclo` ainda ancorada em `serie_inicio()` | Sim, não redefinida na 0060 | Sim | ✅ | `src/backend/migrations/0060_metricas_historico_inicio.sql` (comentário "NÃO é redefinida" + guarda estática `vwMetricasCiclo.test.ts:130-160`) |
| Teste de contrato rodando contra o consumidor real (`metrics.py`) | 0 (nenhum teste do financeiro invoca o script da skill) | ≥1 (contract test cross-repo, mesmo que smoke) | ❌ | `find .github/workflows -exec grep -l metrics.py` → vazio; skill vive fora do repo (`~/.claude/skills/kavex-report-ciclo`, sem submodule/pin) |
| Estratégia de versionamento de API explícita (`/v1`, header) | Ausente — compat feita via query flag opt-in (`?historico=`) | N/A para 1 flag; recomendável documentar o padrão antes da 2ª mudança de forma | ⚠️ | `src/backend/routes/metricas.ts:9-22` (regex de data, enum `historico`, sem prefixo de versão em nenhuma rota do backend) |
| Observabilidade por consumidor (tela vs. skill) no endpoint | Não medível — sem log/metric diferenciando origem da chamada | Log de qual client chama com qual flag, para detectar quebra silenciosa do lado da skill | ⚠️ não medível localmente | Requer produção/CloudWatch-equivalente; grep em `routes/metricas.ts` não mostra `LogService` nem correlação de UA/flag |

## 3. Tactics — Cobertura no nf-projects (delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Escolha do piso (`PISO.serie`/`PISO.historico`) fica em método privado `piso()` do repository; service e rota nunca veem a string SQL | ✅ presente | `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:27-36,92` |
| Use an Intermediary | N/A para este delta — não há client externo novo, é o financeiro servindo de provedor para a skill | N/A — justificativa: delta não adiciona integração de saída, só serve leitura | — |
| Restrict Communication Paths | Único ponto de entrada (`GET /metricas/ciclo`), Zod recusa fuso explícito e valores fora de `true`/`false` | ✅ presente | `src/backend/routes/metricas.ts:20-23,45-51` |
| Adhere to Standards | Segue à risca `references/contrato-metricas.md` (9 campos nomeados, `parcial`+`apurado_ate`, semântica de "série iniciada em") | ✅ presente | Guarda estática compara literalmente com `COLUNAS_DO_CONTRATO` — `vwMetricasCiclo.test.ts:19-27,34-43` |
| Abstract Common Services | N/A — não há serviço de infraestrutura comum tocado neste delta | N/A | — |
| Discover Service | N/A no escopo do delta — SSM/paths de client não tocados | N/A | — |
| Tailor Interface | `?historico=true` como opt-in explícito é exatamente "tailor interface for consumer": consumidor antigo não muda, consumidor novo pede explicitamente o comportamento novo | ✅ presente, bem executado | `routes/metricas.ts:53-61`; ADR-0048 D3 |
| Configure Behavior | Piso do histórico é `TIMESTAMP` fixo hardcoded na migration (`2026-08-07 18:00:00`), decisão deliberada do Yuri, não configurável via SSM/env | ⚠️ parcial (aceito, documentado) | `0060_metricas_historico_inicio.sql` comentário "Data FIXA... envelhece"; ADR-0048 "Consequências" |
| Manage Resources | N/A — sem pool/conexão nova neste delta | N/A | — |
| Orchestrate | `Promise.all([serieInicio(piso), listar(piso)])` no service garante que as duas leituras usam o MESMO piso — evita orquestração divergente (rótulo de uma série sobre dados de outra) | ✅ presente | `MetricasCicloService.ts:36-40` |
| Manage Resource Coupling | N/A — não há recurso compartilhado novo | N/A | — |
| Contract testing (moderno) | Forte DENTRO do repo (guardas estáticas + testes de rota que fixam forma/ordem/piso), mas ZERO teste roda contra o consumidor real (`metrics.py`) — contrato é só "code as documentation" nos dois lados, sincronizado manualmente | ⚠️ parcial | `vwMetricasCiclo.test.ts`, `routes/metricas.test.ts`; ausência confirmada em `.github/workflows/` |
| Versioning strategy (moderno) | Nenhuma no backend (nem para este endpoint nem para os demais) — mudanças de comportamento passam por flags opt-in ad hoc, caso a caso | ⚠️ parcial/ausente | Nenhum prefixo `/v1` em `src/backend/routes/`; padrão não documentado em CLAUDE.md nem em `contrato-metricas.md` |
| Backward-compatibility shims (moderno) | Exemplar neste delta: flag opt-in + teste explícito de equivalência + ADR nomeando a decisão e o motivo | ✅ presente, referência | ADR-0048 D3; `routes/metricas.test.ts:120-135` |
| Observability of integration failures (moderno) | Ausente — endpoint não loga nem diferencia chamadas da tela vs. da skill; falha silenciosa do lado da skill (ex.: parse quebrado) não gera sinal no financeiro | ❌ ausente | `routes/metricas.ts` sem `LogService`; não medível localmente (requer produção) |

## 4. Findings (achados)

### F-integrability-1: Contrato cross-repo sem teste consumidor-driven contra o script real da skill

- **Severidade**: P1
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/routes/metricas.ts:20-61` (provedor) × `/home/inteli/.claude/skills/kavex-report-ciclo/scripts/metrics.py:72-79` (consumidor, fora deste repositório, sem pin/submodule)
- **Evidência (objetiva)**:
  ```
  # financeiro: nenhum workflow referencia o script da skill
  $ find .github/workflows -iname "*.yml" | xargs grep -l "metrics.py|kavex-report-ciclo"
  (vazio)

  # a garantia da ADR-0048 D3 depende de uma propriedade do OUTRO lado (metrics.py sempre
  # exigir --inicio/--fim, nunca enviar historico) que este repo só verifica por leitura manual
  ```
- **Impacto técnico**: se alguém alterar `metrics.py` (ou o config `columbia.json`) para tornar `--inicio`/`--fim` opcionais, ou adicionar um `--historico`, nada no CI do financeiro detecta a mudança de comportamento no consumidor antes de produção — a garantia "o report não muda" vira uma promessa não verificável automaticamente.
- **Impacto de negócio**: o `kavex-report-ciclo` alimenta o report que vai para o Diretor de TI/Presidente da Columbia; uma quebra silenciosa nesse pipeline só aparece quando o número do report já está errado, não em CI.
- **Métrica de baseline**: 0 testes cross-repo executando `metrics.py` contra este backend; 0 referências a `metrics.py`/`kavex-report-ciclo` em `.github/workflows/*.yml`.

### F-integrability-2: Nenhuma estratégia de versionamento de API — compatibilidade depende de flags ad hoc caso a caso

- **Severidade**: P2
- **Tactic violada**: Versioning strategy
- **Localização**: `src/backend/routes/metricas.ts` (toda a árvore de rotas, sem prefixo de versão)
- **Evidência (objetiva)**:
  ```
  router.get('/ciclo', ...)   // sem /v1, sem header Accept-Version
  ```
- **Impacto técnico**: este delta resolveu bem uma mudança de comportamento (piso da série) com uma flag opt-in bem testada; mas não há convenção documentada para a PRÓXIMA mudança de forma (ex.: renomear uma coluna do contrato, ou mudar o tipo de `valor`). Cada mudança futura repete o exercício ad hoc de "qual flag, opt-in ou default" sem um padrão para se apoiar.
- **Impacto de negócio**: risco crescente de inconsistência entre mudanças futuras (uma vem como query flag, outra como novo endpoint, outra quebra direto) à medida que mais consumidores externos (a própria skill, futuras integrações do roadmap — Nexxera/GED/SharePoint) passarem a depender de contratos do financeiro.
- **Métrica de baseline**: 0 rotas versionadas em `src/backend/routes/`; 0 menção a versionamento de API em `CLAUDE.md` ou `references/contrato-metricas.md`.

### F-integrability-3: Sem observabilidade por consumidor no endpoint de contrato externo

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/routes/metricas.ts:44-63`
- **Evidência (objetiva)**:
  ```
  router.get('/ciclo', asyncHandler(async (req, res) => { ... res.json(leitura); }));
  // nenhum LogService.info/warn distinguindo `historico=true` (tela) de ausente (skill/report)
  ```
- **Impacto técnico**: se a skill começar a falhar ao consumir a resposta (schema mudou do lado dela, timeout, autenticação), o financeiro não tem nenhum sinal — nem contagem de chamadas sem `historico`, nem taxa de erro por consumidor.
- **Impacto de negócio**: falha do report semanal (`kavex-report-ciclo`) só é percebida quando o Diretor de TI perceber a ausência/erro do relatório, não por alerta proativo do lado provedor.
- **Métrica de baseline**: ⚠️ não medível localmente — requer produção/CloudWatch-equivalente para confirmar ausência de log estruturado por chamada.

## 5. Cards Kanban

### [integrability-1] Adicionar smoke test cross-repo do `metrics.py` contra o contrato do financeiro

- **Problema**
  > A garantia da ADR-0048 D3 ("o report não muda") depende de uma propriedade do script `metrics.py`, que vive em `~/.claude/skills/kavex-report-ciclo`, fora deste repositório e sem pin de versão. Hoje a verificação é só leitura manual de código nos dois lados (F-integrability-1).

- **Melhoria Proposta**
  > Tactic: Contract testing. Criar um teste (pode ser um job de CI leve, não bloqueante para o merge diário, mas rodado ao menos semanalmente) que baixa/executa `metrics.py --config columbia.json --inicio <fixo> --fim <fixo>` contra uma instância de teste do financeiro e valida: (a) a query nunca contém `historico`; (b) as 9 colunas do contrato + `parcial`/`apurado_ate` batem com `contrato-metricas.md`. Alternativa mais barata: versionar `metrics.py`/`contrato-metricas.md` como submodule ou pacote referenciado por commit SHA, para que qualquer PR que altere a forma do contrato seja obrigado a atualizar a referência.

- **Resultado Esperado**
  > Mudança futura no `metrics.py` ou no contrato da API que quebre a suposição da ADR-0048 é pega em CI, não em produção. Métrica: testes cross-repo relacionados a `metrics.py` — 0 → ≥1.

- **Tactic alvo**: Contract testing
- **Severidade**: P1
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Testes cross-repo executando `metrics.py`: 0 → ≥1
  - Workflows referenciando `kavex-report-ciclo`/`metrics.py`: 0 → ≥1
- **Risco de não fazer**: uma mudança inocente no script da skill (ex.: tornar `--inicio` opcional para "facilitar o uso") reativa silenciosamente a ambiguidade que a ADR-0048 D3 fechou deliberadamente, e só aparece quando o número do report já saiu errado para o cliente.
- **Dependências**: acesso de CI ao repositório/skill `kavex-report-ciclo` (hoje só existe localmente em `~/.claude/skills/`).

### [integrability-2] Documentar (e aplicar) uma convenção de versionamento para `/metricas/ciclo` e futuras rotas de contrato externo

- **Problema**
  > O delta resolveu bem uma mudança pontual com flag opt-in testada, mas não existe padrão documentado para a próxima mudança de forma do contrato — cada caso futuro repete a decisão do zero (F-integrability-2). O roadmap já prevê mais consumidores externos (Nexxera, GED, SharePoint) e mais leitores da mesma família de contrato.

- **Melhoria Proposta**
  > Tactic: Versioning strategy / Adhere to Standards. Adicionar uma seção em `references/contrato-metricas.md` (ou em CLAUDE.md) definindo: quando usar flag opt-in (mudança aditiva, como este delta) vs. quando exigir novo endpoint/versão (mudança de forma nos 9 campos). Não precisa de prefixo `/v1` imediato — o ganho é ter a regra escrita antes da segunda mudança.

- **Resultado Esperado**
  > Próxima mudança de contrato segue uma decisão já tomada, não uma nova negociação ad hoc. Métrica: convenção de versionamento documentada — ausente → presente em `references/contrato-metricas.md`.

- **Tactic alvo**: Versioning strategy
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Risco de não fazer**: acúmulo de flags ad hoc (`?historico=`, e as próximas) sem regra unificadora, até que uma delas precise ser removida e ninguém souber quem ainda depende dela.
- **Dependências**: nenhuma.

### [integrability-3] Logar/instrumentar chamadas a `/metricas/ciclo` por origem (`historico` presente vs. ausente)

- **Problema**
  > O endpoint que alimenta o report do Diretor de TI não emite nenhum sinal distinguindo a chamada da tela da chamada do `kavex-report-ciclo`, nem taxa de erro por consumidor (F-integrability-3).

- **Melhoria Proposta**
  > Tactic: Observability of integration failures. Adicionar `LogService.info` de baixo custo no handler de `/metricas/ciclo` registrando `historico` (booleano) e o resultado (linhas devolvidas, erro), seguindo o padrão de log em português já usado no restante do domínio.

- **Resultado Esperado**
  > Uma falha do report (ex.: autenticação da skill quebrada, resposta vazia) aparece nos logs do financeiro antes de o cliente notar a ausência do report. Métrica: chamadas logadas com origem — 0% → 100%.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Risco de não fazer**: MTTR alto para qualquer degradação silenciosa do consumo da skill — descoberta reativa, pelo cliente, em vez de proativa.
- **Dependências**: nenhuma.

## 6. Notas do agente

Auditoria adversarial da garantia central ("o report não muda") **se sustenta**: confirmado
byte a byte via teste + guarda estática + leitura do `metrics.py` real — nenhum P0 encontrado. Os 3
findings são sobre a robustez do MECANISMO de garantia (contract test cross-repo, versionamento,
observabilidade), não sobre a garantia em si estar quebrada hoje. Cross-QA: F-integrability-1 e
F-integrability-3 se sobrepõem a Fault Tolerance/Observability (mesma ausência de sinal de falha
cross-repo) — sinalizar ao consolidator para não duplicar cards. F-integrability-3 também toca
Availability (report é dependência crítica de negócio sem alerta).
