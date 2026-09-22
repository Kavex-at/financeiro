---
type: regis-review-report
run_id: 2026-09-22-1556
generated_at: 2026-09-22T16:05:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: frontend, --quick, delta-only (branch fix/sispag-rem-download-latin1, git diff origin/main..HEAD)
total_cards: 7
total_p0: 0
total_p1: 1
total_p2: 3
total_p3: 3
overall_score: 8.2
---

# Regis-Review — financeiro — 2026-09-22-1556

**Escopo desta rodada**: revisão de delta, não do repositório inteiro. 4 arquivos alterados
(`src/frontend/lib/sispag.ts`, `src/frontend/app/sispag/components/LoteCard.tsx`,
`src/frontend/lib/sispag.test.ts`, `ontology/_inbox/sispag-rem-download-latin1-tasks.md`), 95
inserções / 8 remoções, 1 commit (`ca094fb`). A mudança troca `res.text()` por `res.blob()` em
`baixarRemessa`: o backend já enviava o `.REM` (CNAB 240) como `Buffer` latin1
(`src/backend/routes/sispag.ts:468-474`, fora do diff); o frontend decodificava esses bytes como
UTF-8 e depois reempacotava a string num novo `Blob`, deslocando as colunas fixas do registro
bancário sempre que o nome do favorecido tinha acento. O fix elimina os dois passos de reencoding.

**P0: nenhum.** As 8 seções não reportam nenhum finding P0 introduzido ou deixado por este delta —
o próprio bug de corrupção silenciosa que motivou o fix é tratado como contexto do Cenário Geral em
cada QA, não como achado aberto, porque o diff avaliado é exatamente o que o fecha.

## 1. Executive scorecard

Pesos aplicados ao `overall_score` (SaaS financeiro multi-tenant, escritas que movem dinheiro):
Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 ·
Performance 1.0 · Integrability 0.9 · Deployability 0.9 (peso total 9.0).

> As colunas P0–P3 desta tabela contam **findings por QA** (visão de auditoria, uma linha por
> agente especialista). O `KANBAN.md` consolida esses findings em **7 cards** após dedup de causas-
> raiz compartilhadas entre QAs (ver §3 e §7) — os totais de card por prioridade estão no frontmatter
> deste arquivo e no de `KANBAN.md`, e não somam 1:1 com esta tabela.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7.5 | 0 | 0 | 1 | 1 | F-availability-1: sem sanity check de `Content-Length` no download do `.REM` |
| Deployability | 8.0 | 0 | 1 | 0 | 0 | F-deployability-1: fix de CNAB 240 sem verificação manual pré-merge (fixture de 9 bytes) |
| Fault Tolerance | 8.5 | 0 | 0 | 0 | 1 | F-fault-tolerance-1: download não valida tamanho do blob antes de disparar |
| Integrability | 8.5 | 0 | 0 | 1 | 1 | F-integrability-1: 2ª implementação independente de download-blob no frontend |
| Modifiability | 8.7 | 0 | 0 | 1 | 1 | F-modifiability-1: padrão de download por blob duplicado (`api.ts` vs `sispag.ts`) |
| Performance | 9.0 | 0 | 0 | 0 | 0 | Nenhum finding — troca é estritamente uma melhoria (1 cópia em memória em vez de 2) |
| Security | 8.0 | 0 | 0 | 1 | 1 | F-security-2: nenhuma verificação de integridade em runtime no path corrigido |
| Testability | 7.5 | 0 | 0 | 1 | 1 | F-testability-1: wiring de download no `LoteCard` sem teste de componente |
| **Overall (findings)** | **8.2** | **0** | **1** | **5** | **6** | — |

Score interpretation:
- 0–3: estrutural risk — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

`overall_score` = 8.2 — no limite superior da faixa "saudável com oportunidades pontuais". Nenhuma
QA abaixo de 7.5; Performance e Fault Tolerance são as mais altas (9.0 e 8.5).

## 2. Top riscos (cross-QA)

Escopo `--quick`/delta produziu 7 cards no total, 0 deles P0. Listamos os 7, ranqueados por
severidade × leverage × impacto de negócio — não há 10 riscos distintos a reportar honestamente
neste ciclo; inflar a lista violaria a regra de não inventar conteúdo.

### R-1: Ausência de sanity check de integridade (`Content-Length` vs `blob.size`) no download de arquivo financeiro
- **QA(s) afetados**: Availability, Fault Tolerance, Security
- **Findings de origem**: F-availability-1 (`availability.md`), F-fault-tolerance-1 (`fault-tolerance.md`), F-security-2 (`security.md`)
- **Evidência sintetizada**: `baixarRemessa` (`src/frontend/lib/sispag.ts:450-458`) verifica só
  `res.ok`; não há comparação entre `Content-Length` e `arquivo.size` após `res.blob()` — 0
  verificações de integridade em runtime, antes e depois deste delta. Tactic violada: **Sanity
  Checking / Verify Message Integrity**.
- **Impacto técnico**: um corpo truncado por rede (VPN instável, proxy corporativo) resulta em
  `res.ok === true` e um `.REM` incompleto entregue como se fosse completo.
- **Impacto de negócio**: mesmo efeito prático do bug que este delta corrigiu — colunas do CNAB 240
  deslocadas ou registro final faltando — só que por causa diferente (transporte, não encoding). O
  arquivo pode ser submetido ao banco antes de alguém notar.
- **Card(s) Kanban relacionados**: cross-1
- **Custo de inação em 6 meses**: baixo em probabilidade isolada (exige corte de rede a meio da
  resposta), mas sem rede de proteção nenhuma — se ocorrer, o sintoma é indistinguível do bug já
  corrigido, custando um ciclo de investigação equivalente a este. Premissa: sem esse card, o time
  volta a investigar do zero cada nova corrupção de `.REM`.

### R-2: Fix de formato de arquivo bancário (CNAB 240) sem verificação manual pré-merge
- **QA(s) afetados**: Deployability
- **Findings de origem**: F-deployability-1 (`deployability.md`)
- **Evidência sintetizada**: o único portão antes de produção é um teste unitário com fixture
  sintético de 9 bytes (`sispag.test.ts:11`); `DEPLOY.md` não tem checklist de staging para mudanças
  em geração/entrega de remessa, apesar de a Vercel já gerar Preview Deployment por PR.
- **Impacto técnico**: um fixture de 9 bytes cobre a lógica de bytes, não a forma real de um `.REM`
  de centenas de linhas com nomes reais de favorecido.
- **Impacto de negócio**: um novo problema de formato nesta classe (geração/entrega de remessa) só
  apareceria de novo com o analista já submetendo o arquivo ao banco — não há precedente registrado
  de rejeição bancária *causada por encoding* neste repositório; o risco aqui é de processo (ausência
  de checklist), não de recorrência de um incidente documentado.
- **Card(s) Kanban relacionados**: deployability-1
- **Custo de inação em 6 meses**: 1 checklist de ~30min por PR de formato de remessa evita depender
  só de teste unitário sintético como último portão antes do banco.

### R-3: Duplicação do padrão de download de blob (`exportarRelatorio` vs `baixarRemessa`)
- **QA(s) afetados**: Integrability, Modifiability
- **Findings de origem**: F-integrability-1, F-integrability-2 (`integrability.md`), F-modifiability-1 (`modifiability.md`)
- **Evidência sintetizada**: duas implementações independentes de "fetch blob + parse
  `Content-Disposition` + `createObjectURL` + disparo do `<a>`" (`lib/api.ts:585-625` e
  `lib/sispag.ts:450-458`), com regex de filename divergente e `revokeObjectURL` protegido por
  `try/finally` só em um dos dois. `baixarRemessa` já existia antes deste PR — o delta não criou a
  duplicação, apenas trocou como os bytes são lidos, o que aproximou seu padrão do de
  `exportarRelatorio` e deixou a duplicação preexistente mais visível.
- **Impacto técnico**: cada correção futura de encoding/filename tem 2 lugares candidatos, e nada
  garante que os dois sejam corrigidos juntos.
- **Impacto de negócio**: os próximos endpoints de download binário no roadmap (retorno Nexxera, PDF
  do GED/SharePoint) têm chance real de reimplementar o mesmo padrão do zero e reintroduzir a mesma
  classe de bug que este delta acabou de fechar.
- **Card(s) Kanban relacionados**: cross-2
- **Custo de inação em 6 meses**: cada nova frente de download (GED, Nexxera) soma ~1 dia de retrabalho
  evitável por não herdar o helper compartilhado.

### R-4: Wiring de download no `LoteCard` sem teste de componente
- **QA(s) afetados**: Testability
- **Findings de origem**: F-testability-1 (`testability.md`)
- **Evidência sintetizada**: `sispag.test.ts` cobre `baixarRemessa` isoladamente; nenhum teste
  exercita o `onClick` real (`LoteCard.tsx:306-322`) que consome o `Blob` e dispara
  `URL.createObjectURL`/`a.click()`/`revokeObjectURL`. `find src/frontend/app/sispag -iname
  '*.test.*'` retorna vazio.
- **Impacto técnico**: uma reintrodução do bug bem no componente (ex. reencodar o `Blob` já correto
  em volta do `a.click()`) passaria pelo CI verde.
- **Impacto de negócio**: o teste atual defende a função, não o fluxo do analista — a mesma classe de
  incidente que motivou este PR poderia voltar por um ponto que o CI não cobre.
- **Card(s) Kanban relacionados**: testability-1
- **Custo de inação em 6 meses**: retrabalho de investigação equivalente ao desta branch, caso a
  regressão ocorra no componente em vez de na função.

### R-5: MIME do `Blob` herdado do backend sem whitelist no cliente
- **QA(s) afetados**: Security
- **Findings de origem**: F-security-1 (`security.md`)
- **Evidência sintetizada**: antes do delta o frontend fixava `type: 'text/plain;charset=latin1'`
  explicitamente; agora `res.blob()` herda o `Content-Type` do backend sem checagem. Mitigado hoje
  por `Content-Disposition: attachment` no backend (fora do diff), mas essa é a única camada
  restante.
- **Impacto técnico**: uma resposta futura com `Content-Type` inesperado (rota nova, erro não coberto
  por `res.ok`) herdaria o tipo sem validação no cliente.
- **Impacto de negócio**: baixo isoladamente — remove uma camada de defesa-em-profundidade num
  artefato que carrega CNPJ e dados bancários de fornecedores.
- **Card(s) Kanban relacionados**: security-2
- **Custo de inação em 6 meses**: baixo; débito acumulável, não urgente.

### R-6: Nenhuma telemetria de sucesso/falha para o download de remessa
- **QA(s) afetados**: Availability
- **Findings de origem**: F-availability-2 (`availability.md`)
- **Evidência sintetizada**: sucesso e falha do download só viram um toast local (`LoteCard.tsx:306-320`); 0 chamadas de log/telemetria.
- **Impacto técnico**: nenhuma métrica agregada de falha de download por tenant/lote.
- **Impacto de negócio**: aumenta o MTTR de qualquer reincidência de corrupção — a detecção depende
  de reclamação do analista ou rejeição do banco, não de sinal operacional.
- **Card(s) Kanban relacionados**: availability-2
- **Custo de inação em 6 meses**: MTTR de incidente futuro permanece dependente de detecção manual.

### R-7: Colisão semântica do identificador `arquivo` (Blob vs filename) em `sispag.ts`
- **QA(s) afetados**: Modifiability
- **Findings de origem**: F-modifiability-2 (`modifiability.md`)
- **Evidência sintetizada**: `GerarRemessaResult.arquivo?: string` (linha 289) e o retorno de
  `baixarRemessa` `arquivo: Blob` (linha 450) coexistem no mesmo arquivo de 643 LOC com tipos
  incompatíveis sob o mesmo nome.
- **Impacto técnico**: custo cognitivo de leitura para quem tocar `sispag.ts` de novo.
- **Impacto de negócio**: baixo risco imediato, sem bug funcional.
- **Card(s) Kanban relacionados**: modifiability-2
- **Custo de inação em 6 meses**: marginal, acumulável.

## 3. Cross-cutting findings

### CC-1: Sem camada de sanity check em runtime para downloads binários financeiros
- **Aparece em**: Availability, Fault Tolerance, Security
- **Findings**: F-availability-1, F-fault-tolerance-1, F-security-2
- **Diagnóstico unificado**: os três agentes, de ângulos diferentes (disponibilidade, tolerância a
  falhas, integridade de mensagem), convergem no mesmo gap: `baixarRemessa` valida só `res.ok` e
  nunca compara o tamanho declarado (`Content-Length`) com o `Blob` efetivamente recebido. Este delta
  fecha a causa de corrupção conhecida (reencoding), mas não instala uma rede de proteção genérica
  para outras causas de bytes divergentes (truncamento de rede, proxy, gzip mal configurado).
- **Recomendação consolidada**: card `cross-1` — comparar `Content-Length` com `arquivo.size` e
  lançar erro tipado em caso de divergência, resolvendo os três achados com uma única mudança em
  `sispag.ts`.

### CC-2: Padrão de download de blob duplicado sem abstração compartilhada
- **Aparece em**: Integrability, Modifiability
- **Findings**: F-integrability-1, F-integrability-2, F-modifiability-1
- **Diagnóstico unificado**: o repositório já tinha um primitivo correto (`exportarRelatorio` em
  `lib/api.ts`) para "buscar blob + parse filename + baixar", mas `baixarRemessa` foi implementado
  (antes deste PR) com sua própria cópia, regex ligeiramente diferente e sem `try/finally` no
  `revokeObjectURL`. O bug corrigido por este delta é sintoma direto de não haver um único primitivo
  testado e reusado.
- **Recomendação consolidada**: card `cross-2` — extrair `downloadBlobFromResponse` compartilhado em
  `lib/http.ts` ou `lib/download.ts`, migrar os dois consumidores. Resolve ambos os findings e
  blinda os próximos endpoints de download do roadmap (GED, retorno Nexxera).

### CC-3: Observabilidade do path de download fica só no toast local
- **Aparece em**: Availability, Integrability (nota "Observability of integration failures", herdado)
- **Findings**: F-availability-2
- **Diagnóstico unificado**: nem sucesso nem falha do download deixam rastro fora do navegador do
  analista. Não é regressão deste delta, mas é o mesmo gap que aumentaria o MTTR de qualquer
  recorrência dos riscos R-1/CC-1.
- **Recomendação consolidada**: card `availability-2` — log de `loteId`/resultado/tamanho em bytes;
  ao evoluir `cross-1`, aproveitar o mesmo ponto para logar divergências de tamanho detectadas.

### CC-4: Cobertura de teste concentrada na função pura, lacuna no wiring do componente
- **Aparece em**: Testability (achado principal), citado por Fault Tolerance e Integrability como
  observação cruzada
- **Findings**: F-testability-1
- **Diagnóstico unificado**: o novo teste em `sispag.test.ts` prova fidelidade de bytes na função
  `baixarRemessa`, mas o `onClick` em `LoteCard.tsx` — onde o `Blob` vira efeito de DOM real — segue
  sem nenhum teste de componente, um gap pré-existente que este delta toca mas não fecha.
- **Recomendação consolidada**: card `testability-1` — teste de componente cobrindo o clique,
  incluindo polyfill de `URL.createObjectURL` reusável em `jest.setup.ts`.

## 4. Quick wins (≤5 dias úteis)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| cross-1 | Availability / Fault Tolerance / Security | S | P2 | Downloads binários do SISPAG com checagem de `Content-Length`: 0/1 → 1/1 |
| cross-2 | Integrability / Modifiability | S | P2 | Implementações duplicadas de download-blob: 2 → 1 |
| deployability-1 | Deployability | S | P1 | Checklist de verificação manual do `.REM` real: 0 → 1 |
| testability-1 | Testability | S | P2 | Testes de componente em `app/sispag/components/`: 0 → ≥1 |

Todos os 7 cards deste ciclo têm esforço **S (≤1d)** — é um delta pequeno e pontual, sem achados que
justifiquem esforço M/L/XL. Estes 4 são os que valem defender como "aceitamos isso como primeira
sprint pós-aprovação": P1 único do ciclo + as duas causas-raiz cross-QA (CC-1, CC-2) + a lacuna de
regressão mais provável de reincidir (CC-4).

## 5. Strategic moves (M / L / XL)

Nenhum card de esforço M/L/XL neste ciclo. Escopo é `--quick`, delta frontend-only de 4 arquivos —
não há achado que justifique investimento de maior fôlego nesta rodada. Não incluído por não haver
conteúdo real a reportar (regra de não inventar conteúdo).

## 6. O que está bem (e por quê)

1. **Verify Message Integrity / Comparison** — o delta fecha, com prova objetiva, a corrupção
   silenciosa que existia: teste byte-a-byte com bytes reais do defeito histórico (`0xC3`/`0xC7`)
   contra o que `res.text()` produziria. `sispag.test.ts:19-36`.
2. **Exception Detection** — `res.ok` checado, erro tipado com status HTTP, testado.
   `sispag.ts:452`, `sispag.test.ts:39-43`.
3. **Reduce Overhead / Increase Resource Efficiency** — remove o round-trip decode(UTF-8) +
   reencode(Blob); 1 cópia em memória do payload em vez de 2, sem regressão de bundle (0 dependências
   novas). Performance score 9.0, 0 findings.
4. **Recordable Test Case exemplar** — o teste novo documenta o próprio bug no código do teste
   (`'JO?O ?A\r\n'` vs bytes originais), reduzindo custo de teste futuro no mesmo boundary.
   `sispag.test.ts:1-44`.
5. **Blast radius contido** — 1 único call site afetado pela mudança de assinatura, 1 commit atômico,
   0 coordenação cross-service exigida (backend já enviava latin1 antes do delta).
   `routes/sispag.ts:468-474` (fora do diff, inalterado).
6. **Defer Binding melhorado** — o MIME type do `Blob` deixa de ser hardcoded no frontend
   (`'text/plain;charset=latin1'`) e passa a vir do `Content-Type` do backend — menos conhecimento
   duplicado entre as camadas.
7. **Rollback pronto** — runbook dedicado aplicável 1:1 (frontend-only, sem migration); reversão
   "quase instantânea" via troca de alias Vercel. `docs/runbooks/rollback.md:16-24,60-65`.
8. **Sem ampliação de superfície de ataque** — 0 secrets no diff, 0
   `dangerouslySetInnerHTML`/`innerHTML` novos, `requireRole('admin')` da rota consumida inalterado.

## 7. Limitações da análise

- **Não medível localmente** (declarado pelos agentes): taxa de rejeição de remessa pelo Nexxera
  atribuível a corrupção de encoding antes deste fix; MTTR real do incidente; timeout do `apiFetch`
  sob carga; p95 de tamanho/linhas de `.REM` em produção; se o header `Content-Type` chega intacto
  até o browser em produção atrás de proxy/CDN.
- **Cobertura de teste**: `--quick` não rodou `npm test -- --coverage`; os números de cobertura de
  linha/branch de `LoteCard.tsx` citados em `testability.md` são o piso global do `jest.config.js`,
  não uma medição específica do delta.
- **Escopo do diff**: revisão restrita a `src/frontend/lib/sispag.ts`,
  `src/frontend/app/sispag/components/LoteCard.tsx`, `src/frontend/lib/sispag.test.ts` (+ arquivo de
  tasks da ontologia). `src/backend/routes/sispag.ts` foi lido só como contexto não-modificado por
   múltiplos agentes — nenhum finding de backend foi gerado porque nada ali mudou.
- **O que o pipe não cobre**: chaos engineering, threat modeling formal, custo cloud, UX,
  acessibilidade.
- **Correção editorial sobre precedente citado por Security e Deployability**: os drafts de Security
  e Deployability citam a nota de memória do time sobre a filial 7 (`PG160901.REM`, lote cancelado
  depois de gerado; 2º teste interrompido por um boleto sem código de barras) como precedente de
  rejeição bancária causada por encoding. **Essa nota não registra uma rejeição causada por
  encoding** — é um incidente de outra natureza (lote cancelado + boleto sem código de barras). Este
  relatório remove essa citação como evidência: o card `deployability-1` (P1) permanece de pé por
  seus próprios méritos — ausência de verificação manual de um `.REM` real antes do merge, com o
  único portão de teste sendo um fixture sintético de 9 bytes — sem depender do precedente da filial
  7. R-2 e a linha de risco correspondente foram redigidas para refletir isso.
- **Correção editorial sobre origem de `baixarRemessa`**: os drafts de Integrability e Modifiability
  descrevem o efeito do delta como se ele tivesse introduzido uma "segunda implementação" de
  download. `baixarRemessa` já existia antes deste PR; o delta apenas trocou `res.text()` por
  `res.blob()`. A duplicação com `exportarRelatorio` é preexistente, apenas tornada mais visível
  pela mudança. O card `cross-2` e CC-2 foram redigidos para não implicar o contrário.
- **Dedup de cards**: por instrução do consolidador, 3 findings quase idênticos sobre
  `Content-Length` vs `blob.size` (availability-1, fault-tolerance-1, security-1) foram fundidos no
  card `cross-1` (severidade P2, a mais alta entre os três originais); 2 findings sobre duplicação do
  helper de download (integrability-1, modifiability-1, mais a nota de `try/finally` de
  integrability-2) foram fundidos no card `cross-2`. Nenhum conteúdo foi descartado — todas as
  referências aos findings de origem estão preservadas nos cards fundidos.
- **Janela temporal**: snapshot do dia 2026-09-22. Código é vivo — refazer a revisão quando este
  módulo crescer de novo ou trimestralmente.

## 8. Ações recomendadas (30 dias)

1. Fechar `cross-1` (Sanity Checking / Verify Message Integrity — `Content-Length` vs `blob.size`)
   antes de abrir qualquer novo endpoint de download financeiro (GED, retorno Nexxera) — é o único
   gap que os três QAs de confiabilidade/segurança convergem em apontar.
2. Implementar `deployability-1` (checklist de verificação manual do `.REM` no Preview Deployment) —
   único P1 do ciclo, esforço S, puramente processual.
3. Extrair o helper compartilhado (`cross-2`) antes de iniciar a Frente IV (Conciliação de
   Recebimentos), que introduzirá novos endpoints de download e herdaria a duplicação se não for
   resolvida agora.
4. Cobrir o wiring do `LoteCard` com teste de componente (`testability-1`) para fechar a lacuna de
   regressão exatamente no ponto que este fix tocou.
5. Agrupar `availability-2`, `modifiability-2` e `security-2` (P3) numa sprint de manutenção — não
   bloqueantes, mas de esforço S cada, baixo custo para fechar em lote.
