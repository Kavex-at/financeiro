# Frente V — Prompts prontos para as sessões

> Cada bloco abaixo é para **colar em uma sessão nova do Claude Code**, na raiz do repo.
> A ordem importa: os blocos da mesma onda podem rodar **simultaneamente**; ondas diferentes, não.
> Contexto comum: `ontology/_inbox/frente-v-orquestracao.md` e
> `ontology/_inbox/frente-v-aprovacoes-conexos-spike.md`.

---

## ONDA 0 — Spikes

**Situação em 2026-08-18:** S1 (API do Conexos) e 0-A (anatomia do slice) já foram executados na
sessão de orquestração — os arquivos `frente-v-aprovacoes-conexos-spike.md` e
`frente-v-anatomia-slice.md` existem. **Restam 0-B e 0-C**, que podem rodar em paralelo (escrevem
arquivos distintos e não se tocam).

### ~~Sessão 0-A · Anatomia do vertical slice~~ — CONCLUÍDA

Resultado em `ontology/_inbox/frente-v-anatomia-slice.md`. Prompt mantido abaixo apenas para o caso
de precisar reexecutar/aprofundar.

```
Leia CLAUDE.md e ontology/_inbox/frente-v-orquestracao.md.

Vamos criar a Frente V — Workflow de Aprovação: um novo vertical slice ao lado de
permutas / sispag / recebimentos. Fase 1 é read-only, escopo Contas a Pagar: ler do
Conexos a trilha de aprovação dos títulos, materializar histórico no nosso Postgres
via job periódico, e expor num painel.

Produza o mapa de anatomia que um agente implementador precisa para criar essa frente
seguindo EXATAMENTE os padrões já usados. Use a frente `recebimentos` como referência
primária e `sispag` como secundária. Documente com arquivo:linha:

1. Cadeia completa de um endpoint: src/backend/index.ts → http/ → registro da rota →
   routes/<frente>.ts → service → repository → client. Com trechos de código reais.
2. DI/tsyringe: onde as classes são registradas/resolvidas, decorators, reflect-metadata.
3. Validação Zod nos boundaries: exemplos reais e onde ficam.
4. RBAC/auth/multi-filial: src/backend/middleware/, JWT Supabase, resolução de
   filCod e do usuário Conexos por request (veja domain/client/ConexosSessionResolver.ts).
5. Acesso ao Conexos: ConexosBaseClient (paginate, PAGE_SIZE, MAX_PAGES, CHUNK_SIZE),
   legacyConexosAdapter, sub-clients por família, retry via Executors, ADR-0012.
6. Persistência: src/backend/migrations/ (convenção de numeração — o próximo livre é 0049),
   como as migrations rodam, SQL parametrizado nos repositories, precedentes de cache de
   dados do ERP (ADR-0014).
7. Jobs: src/backend/jobs/ (ingest-*.ts, probe-*.ts) — como um job é declarado e agendado
   hoje; ADR-0028 (cron horário da Frente IV).
8. Testes: *.test.ts vs *.integration.test.ts, stubs/fakes, harness de ERP fake (docs/e2e/),
   jest config, comandos.
9. Frontend: estrutura de src/frontend/app/<frente>/, grid, filtros, drawer, data fetching,
   tipos compartilhados, testes.
10. Release: scripts/bump-version.ps1, lockstep FE/BE, CHANGELOG.
11. Checklist "criar frente nova do zero": lista ordenada de TODOS os arquivos a criar/tocar,
    com o caminho proposto. Recomende o slug (`aprovacoes` vs `workflow-aprovacao`) e justifique.
12. Armadilhas: leia ontology/_inbox/migration-debt.md e
    ontology/_inbox/frente-iv-arquitetura-modular.md e liste o que NÃO repetir.

Só leitura. Escreva em ontology/_inbox/frente-v-anatomia-slice.md. Português.
```

### Sessão 0-B · Rascunho de ontologia + ADR

```
Leia CLAUDE.md, ontology/README.md, ontology/_inbox/frente-v-orquestracao.md e
ontology/_inbox/frente-v-aprovacoes-conexos-spike.md (este último tem os fatos técnicos
já confirmados — não reinvestigue a API).

Escopo da Frente V, já decidido: somente Contas a Pagar, somente leitura/track, com
histórico materializado no nosso Postgres. Fase 2 (analítico por fornecedor/cliente/
funcionário) fora de escopo, mas o modelo precisa suportar.

Produza um rascunho de proposta de ontologia:

1. Aprenda o formato lendo ontology/entities/recebimento.md, entities/titulo-a-pagar.md,
   entities/lote-pagamento.md, 2-3 arquivos de actions/recebimentos/,
   state-machines/recebimento.md, state-machines/lote-pagamento.md,
   business-rules/idempotencia-quitacao-nde.md, integrations/conexos-fin095-extrato.md,
   glossary.md, relationships.md, _index.json, _coverage.json, e os ADRs 0022 e 0037.
   Documente as seções obrigatórias de cada tipo de artefato.

2. Proponha o delta:
   - Entidades (conjunto MÍNIMO coerente). Candidatos: trilha-aprovacao, etapa-aprovacao,
     evento-aprovacao, alcada. ATENÇÃO: `titulo-a-pagar` já existe — decida se estende ou cria.
     Modele os DOIS mecanismos do ERP: a escada fixa de 3 liberações gravada no título
     (titVld/titTim/usnDesNome 1..3) e a fila de bloqueios por alçada (FinTituloBloq).
   - Ações em ontology/actions/aprovacoes/: ingerir-trilha-aprovacao, expor-painel-aprovacoes,
     detalhar-trilha-aprovacao.
   - State machines: (a) status de aprovação do título; (b) status de uma etapa. Transições
     nomeadas com regra explícita (princípio P3), cobrindo regerarBloqueios, etapa cancelada,
     e título sem WF.
   - Business rules: duração de etapa (relógio corrido, America/Sao_Paulo, o que fazer sem
     timestamp de atribuição), definição de "sem workflow", idempotência da ingestão por
     snapshot, trilha regerada, e a distinção origem ERP vs DERIVADO por evento.
   - Integration: ontology/integrations/conexos-fin026-fin103-aprovacao.md.
   - Glossário: bloqueio, alçada, comando, liberação, wffUuid, aprovador — COM desambiguação
     contra os termos das frentes I-IV (aprovação de borderô, NC/ND, NDe).
   - ADR de bootstrap da Frente V. Confira o maior número em ontology/decisions/ — há
     duplicatas (0034 e 0036 aparecem 2x); reporte isso e use o próximo livre.
   - Impacto em _index.json, _coverage.json e relationships.md.

3. Perguntas P0/P1 para o OfficeHoursInterviewer, nos 4 eixos (Entity, Action, Invariant,
   Integration). Comece pelas 6 perguntas P0 já levantadas no spike e acrescente as suas.

Só leitura fora do arquivo de saída. Escreva em ontology/_inbox/frente-v-ontologia-rascunho.md.
```

### Sessão 0-C · Plano de frontend + refino do contrato

```
Leia CLAUDE.md, ontology/design/taste-profile.md, ontology/design/component-mapping.md,
ontology/_inbox/frente-v-orquestracao.md (o §5 traz o contrato de API v0 — sua tarefa
inclui criticá-lo, não só aceitá-lo) e ontology/_inbox/frente-v-aprovacoes-conexos-spike.md.

Frente V: painel read-only de Contas a Pagar mostrando a trilha de aprovação de cada título.
Os dados vêm do NOSSO Postgres (snapshot do ERP), não do ERP ao vivo — a UI precisa mostrar
o horário do snapshot. Caso canônico: "o documento 123 foi finalizado às 10:00 de 18/08, o
Fulano recebeu o WF às 18:09 desse dia e aprovou às 10:00 do dia 19/08".

1. Levante o que existe: src/frontend/app/{recebimentos,sispag,permutas}/ e os componentes
   compartilhados. Com arquivo:linha: padrão de página, grid, filtros, paginação, estados de
   loading/erro/vazio, drawer de detalhe, formatação de moeda/data, badges de status, data
   fetching, tipos compartilhados com o backend, testes de frontend.
2. Design system: extraia de taste-profile.md e component-mapping.md o checklist que o
   DesignSystemReviewer vai cobrar.
3. Proponha a UI:
   - Tela 1, grid: colunas (documento, título, filial, fornecedor, valor, vencimento,
     finalização, status do WF, etapa atual, aprovador atual, tempo parado, aprovações
     concluídas/necessárias), filtros, ordenação, busca. Justifique cada coluna e diga
     quais cortar se ficar larga demais.
   - Tela 2, timeline da trilha: eventos com tipo, ator, timestamp, duração desde o anterior,
     resultado; marco "documento finalizado" como origem do relógio. Represente: as 3
     liberações do título, os bloqueios por alçada, etapas em paralelo, canceladas, regeradas,
     pendentes. OBRIGATÓRIO: sinalizar visualmente eventos de origem DERIVADO (inferidos por
     diffing) vs ERP — é dado financeiro auditável.
   - Estados de exceção: sem workflow, WF regerado, etapa sem aprovador, lacunas[], snapshot velho.
   - Wireframes ASCII das duas telas.
4. Contrato de API refinado: partindo do §5 do doc de orquestração, entregue os TypeScript
   types finais de GET /aprovacoes e GET /aprovacoes/:id/trilha, com filtros e
   paginação. Aponte o que mudou em relação ao v0 e por quê. Todo campo derivado é calculado
   no BACKEND.
5. Ganchos para a Fase 2, sem implementar.
6. Lista de arquivos a criar em src/frontend/app/aprovacoes/.

Só leitura. Escreva em ontology/_inbox/frente-v-frontend-plan.md.
```

---

## ONDA 0.5 — Probe em homologação (1 sessão) — **pode rodar já**

Dependia de 0-A, que está concluída. **Este é o gate real do projeto** — sem ele, o desenho de
persistência é chute. Rode em paralelo com 0-B e 0-C.

```
Leia CLAUDE.md, ontology/_inbox/frente-v-aprovacoes-conexos-spike.md (§6 descreve o probe)
e ontology/_inbox/frente-v-anatomia-slice.md. Siga o padrão dos scripts existentes em
src/backend/jobs/probe-*.ts.

Escreva e execute contra HOMOLOGAÇÃO um script SOMENTE-LEITURA
src/backend/jobs/probe-aprovacoes-fin026.ts que responda, com evidência bruta salva em
docs/conexos-api/screens/ ou ontology/_inbox/:

1. POST fin026/list com filterList {docTip#EQ: 2}, pageSize 5 — confirme o serviceName
   correto, a grafia exata dos campos de liberação (titTim1Libera vs titTim1libera) e,
   CRÍTICO, se a HORA sobrevive em titTim1Libera ou se vem zerada (meia-noite). Veja o
   comentário BR_NOON_SHIFT_MS em domain/client/ConexosBaseClient.ts:9.
2. POST fin103/list com {docTip#EQ: 2} — confirme acesso e colete a distribuição de valores
   distintos de fbaVldAcao e ftbVldStatus, para descobrir os enums que o spec não documenta.
3. GET fin026/infoTitulo/{filCod}/2/{docCod}/{titCod} num título já aprovado — confirme a
   escada completa com observações e cancelamentos.
4. GET fin026/log/2/{docCod}/{titCod} — DESCUBRA o formato da resposta (o spec não a tipa).
   Se ela contiver a auditoria de mudanças com usuário e data, isso muda o desenho inteiro
   da persistência: reporte em destaque.
5. Teste se filterList aceita operador de intervalo de data (tente #GE, #BETWEEN, #GT).

NÃO faça nenhuma chamada de escrita. Nenhum PUT, POST de comando, trocaBloqueio ou
regerarBloqueios. Se algo exigir escrita para ser respondido, pare e me pergunte.

Escreva as conclusões em ontology/_inbox/frente-v-probe-resultado.md, respondendo
explicitamente às perguntas P0 nº 1, 2 e 3 do spike.
```

---

## ONDA 1 — Convergência (1 sessão, humano no loop)

Depende de 0-A, 0-B, 0-C e 0.5. **Não paralelize.**

```
/feature-new Frente V — Workflow de Aprovação: painel read-only que mostra, para cada
título de Contas a Pagar, a trilha completa de aprovação — quando o documento foi
finalizado, quem recebeu cada etapa e quando, quem aprovou/rejeitou e quando, quanto tempo
cada etapa levou, e o status atual (sem workflow / aguardando N aprovações / aprovado /
rejeitado). Dados vindos do Conexos (fin026/list + fin103/list) e materializados no nosso
Postgres por job periódico, para permitir medir durações e, numa Fase 2, o analítico de
tempo médio por fornecedor, cliente final e funcionário.

Contexto obrigatório antes da entrevista, leia nesta ordem:
  ontology/_inbox/frente-v-orquestracao.md
  ontology/_inbox/frente-v-aprovacoes-conexos-spike.md
  ontology/_inbox/frente-v-probe-resultado.md
  ontology/_inbox/frente-v-ontologia-rascunho.md
  ontology/_inbox/frente-v-anatomia-slice.md
  ontology/_inbox/frente-v-frontend-plan.md

O OfficeHoursInterviewer deve começar pelas perguntas P0 já levantadas nesses documentos —
não repita o que já está respondido lá.

Ao final desta sessão eu preciso, obrigatoriamente:
  1. ontology diff aprovado + ADR de bootstrap da Frente V;
  2. o CONTRATO DE API TRAVADO e escrito em ontology/_inbox/frente-v-contrato-api.md
     (é o que destrava as 3 fatias paralelas — sem ele não abrimos a Onda 2);
  3. três tasks.md do TaskScoper, um por fatia:
       frente-v-f1-ingestao-tasks.md
       frente-v-f2-api-grid-tasks.md
       frente-v-f3-timeline-tasks.md

PARE antes da implementação. Esta sessão não roda AutoLoopRunner.
```

---

## ONDA 2 — Implementação (3 sessões em paralelo, worktrees separados)

Só abra depois que `frente-v-contrato-api.md` existir e estiver aprovado.
Cada sessão cria seu próprio worktree (Inviolable Rule #10), caminho curto em `C:/tmp`.

### Fatia F1 · Ingestão + modelo

```
/feature-new --base main Frente V fatia 1 — ingestão e modelo: migrations do schema de
trilha de aprovação (títulos observados, etapas, eventos append-only, execução do job),
ConexosAprovacoesClient (fin026/list, fin103/list, fin026/infoTitulo), repository com SQL
parametrizado, serviço de reconciliação de snapshot idempotente, e job periódico de
ingestão. Somente leitura no ERP.

Worktree: C:/tmp/frente-v-f1-wt (branch feat/frente-v-f1-ingestao).

Especificação obrigatória: ontology/_inbox/frente-v-f1-ingestao-tasks.md
Contrato travado:          ontology/_inbox/frente-v-contrato-api.md
Fatos da API:              ontology/_inbox/frente-v-aprovacoes-conexos-spike.md
Resultado do probe:        ontology/_inbox/frente-v-probe-resultado.md
Padrões a seguir:          ontology/_inbox/frente-v-anatomia-slice.md

Invariantes que NÃO podem ser quebradas:
  - zero escrita no Conexos (nenhum PUT/POST de comando);
  - ingestão idempotente: reprocessar o mesmo snapshot não duplica evento;
  - todo evento carrega origem ERP ou DERIVADO;
  - todo evento carrega usnCod (não só o nome), fornecedorCod e filCod — as dimensões da Fase 2;
  - SQL sempre parametrizado; próxima migration livre é a 0049.

Chame o ObservabilityAdvisor: esta fatia cria um job novo.
NÃO rode /regis-review nesta fatia — ele roda uma vez só, na Onda 3, sobre as três integradas.
```

### Fatia F2 · API + grid

```
/feature-new --base main Frente V fatia 2 — API e painel de lista: endpoint
GET /aprovacoes (paginado, com filtros de período, filial, status do workflow,
aprovador, fornecedor e "sem workflow") e a página src/frontend/app/aprovacoes/ com o
grid dos títulos a pagar e seu status de aprovação.

Worktree: C:/tmp/frente-v-f2-wt (branch feat/frente-v-f2-api-grid).

Especificação obrigatória: ontology/_inbox/frente-v-f2-api-grid-tasks.md
Contrato travado:          ontology/_inbox/frente-v-contrato-api.md
Plano de UI:               ontology/_inbox/frente-v-frontend-plan.md
Padrões a seguir:          ontology/_inbox/frente-v-anatomia-slice.md

A fatia F1 está sendo desenvolvida em paralelo e cria o schema e o repository. Para não
bloquear: implemente contra a interface do repository definida no contrato e use um stub
em memória nos testes, no padrão de src/backend/domain/service/recebimentos/stubs.
NÃO edite as migrations nem os arquivos da F1 — conflito de merge garantido.

Invariantes: todo campo derivado (durações, status agregado) vem calculado do backend;
a resposta sempre expõe snapshotEm; RBAC no padrão das rotas existentes.
Rode o DesignSystemReviewer (esta fatia toca frontend).
NÃO rode /regis-review nesta fatia.
```

### Fatia F3 · Timeline de detalhe

```
/feature-new --base main Frente V fatia 3 — timeline da trilha: endpoint
GET /aprovacoes/:id/trilha e o drawer/página de detalhe com a linha do tempo vertical
da aprovação de um título — marco de finalização do documento, cada etapa com ator,
timestamp, duração e resultado, incluindo etapas pendentes, canceladas e regeradas.

Worktree: C:/tmp/frente-v-f3-wt (branch feat/frente-v-f3-timeline).

Especificação obrigatória: ontology/_inbox/frente-v-f3-timeline-tasks.md
Contrato travado:          ontology/_inbox/frente-v-contrato-api.md
Plano de UI:               ontology/_inbox/frente-v-frontend-plan.md

As fatias F1 e F2 rodam em paralelo. Implemente contra a interface do repository do
contrato, com stub em memória nos testes. NÃO edite migrations, nem os arquivos da F1,
nem a página de lista da F2.

Invariantes: eventos de origem DERIVADO devem ser visualmente distintos dos de origem ERP;
lacunas[] precisa aparecer na UI (nunca estimar um tempo em silêncio); durações calculadas
no backend.

Caso de aceite obrigatório: o exemplo canônico do cliente precisa renderizar corretamente —
"documento finalizado às 10:00 de 18/08, Fulano recebeu o WF às 18:09 desse dia e aprovou
às 10:00 do dia 19/08".

Rode o DesignSystemReviewer. NÃO rode /regis-review nesta fatia.
```

---

## ONDA 3 — Integração e entrega (1 sessão)

```
Integre as três fatias da Frente V e leve ao PR.

1. Faça o merge na ordem F1 → F2 → F3 (feat/frente-v-f1-ingestao,
   feat/frente-v-f2-api-grid, feat/frente-v-f3-timeline). Substitua os stubs em memória
   das fatias F2/F3 pelo repository real da F1. Conflito não-trivial: pare e me chame.
2. Gates verdes no conjunto: typecheck, lint, test, PatternGuardian, DesignSystemReviewer.
3. Valide o caso canônico do cliente ponta a ponta contra o tenant de homologação.
4. Rode /regis-review com escopo backend + frontend. Remedie apenas os P0, no mesmo
   worktree; P1/P2/P3 vão para ontology/_inbox/frente-v-regis-followups.md.
5. Rebase em main, bump de versão FE+BE em lockstep via scripts/bump-version.ps1 -Execute,
   CHANGELOG, commit chore(release), e abra o PR.
6. Atualize CLAUDE.md: a tabela de frentes passa a ter cinco linhas.
```

---

## Resumo do paralelismo

| Onda | Sessões simultâneas | Bloqueia | Artefato que destrava a próxima |
|------|---------------------|----------|---------------------------------|
| 0 | 2 restantes (0-B, 0-C) — S1 e 0-A já feitos | — | os `_inbox` de spike |
| 0.5 | 1 | 0-A | `frente-v-probe-resultado.md` (responde P0 1-3) |
| 1 | 1 | tudo acima | **`frente-v-contrato-api.md`** + ontology diff + 3 tasks.md |
| 2 | 3 (F1, F2, F3) | Onda 1 | três branches verdes |
| 3 | 1 | Onda 2 | PR |
