# HANDOFF — 2026-08-03, fim da sessão do fix do título da SN

> **Substitui** a versão anterior deste arquivo (sessão de auditoria + Fase B). A versão antiga está
> no histórico do git e **contém um diagnóstico hoje sabidamente errado** — o "achado nº 4" (a
> automação nunca gera os títulos, precisa capturar a tela com032). Isso foi refutado com medição:
> ver §3. Não use a versão antiga como referência de estado.
>
> Esta sessão **terminou por limite de cota**, não por conclusão: a sessão do Claude Code
> `719f54d5-9a36-4d70-bc05-090cc45ff379` bateu o limite semanal às 07:05 (BRT) e reseta às **19:00
> America/Sao_Paulo**. A última pergunta do Yuri ficou sem resposta lá; **está respondida no §5
> deste documento**.

## 1. Onde o trabalho está

| | |
|---|---|
| Branch de trabalho | `fix/sn-titulo-condicao-fail-closed` @ `e408ac3` |
| Worktree | `C:/tmp/sn-titulo-wt` (working tree limpo) |
| Branch base do tweak | `fix/sn-cond-pgto-finalizacao` @ `eea1102` (worktree `C:/tmp/sn-condpgto-wt`) |
| Suíte | **97 suites / 1024 testes verdes**, `npm run typecheck` limpo |
| Versões | FE e BE em `0.19.0` (lockstep) — **bump ainda não feito** |
| Push / PR | **nada pushado, nenhum PR aberto** |

Commits acima da base (mais novo primeiro):

```
e408ac3 docs(regis-review): consolidate the 8-QA run for the SN title fix
baffab6 fix(recebimentos): gate the untested payment-condition branch and stop masking transport errors
8598ef6 docs(ontology): SN title lifecycle + conditional payment condition (ADR-0025)
6d9c8c2 fix(recebimentos): stop destroying the SN title — item first, payment condition only when demanded
```

A base (`fix/sn-cond-pgto-finalizacao`) já contém o **merge do colega** (`9c4224a`, NDe com297 real +
autorização SEFAZ assíncrona), a reancoragem das suítes de ERP fake ao contrato novo (`961f1f2`) e as
sondas de título no HML (`eea1102`). Os dois fixes validados no ERP em sessões anteriores
(`escolherCondicaoPagamento` casando por cliente com paginação por `count`; discriminador
`docVldFinalizado === 1`) sobreviveram ao merge e têm teste de regressão.

## 2. O que esta sessão fez, em uma frase

Descobriu que o "gap dos títulos" nunca foi um gap: **o ERP cria o título na geração do documento e
era o nosso PUT da condição de pagamento que o destruía** — e corrigiu isso pelo pipe completo
(`/feature-tweak` → TDD → PatternGuardian → ontologia → Regis-Review → remediação do P0), parando
antes do bump e do PR porque a validação no HML depende do Yuri.

## 3. O diagnóstico que mudou (leitura obrigatória)

Detalhe completo, com todas as medições: **`docs/e2e/gap-titulos-diagnostico.md`**.

O resumo que importa, medido documento a documento no HML (SKYJACK, pri 186, filial 2, R$ 123,45):

| doc | sequência | resultado |
|---|---|---|
| 732 | parou antes do item, condição default | `mnyTitValor` **123,45** — o título já existia |
| 734 | PUT da condição → item (**ordem antiga do produto**) | PUT zerou `docMnyValor` **e** o título; reaplicar não regenera |
| 735 | item → PUT da condição | o item **preserva** o título; o PUT **destrói** |
| 736 / 737 | geração → item → finalizar, **sem PUT** | `docVldFinalizado: 1` e título `titCod 1` visível no `lov/TituloBorderoReceber` |

Quatro consequências:

1. O título nasce na geração do com299. **Nenhuma tela extra (com032) é necessária.**
2. `vldRwCondpgt: 1` **não é** gatilho de regeneração de parcelas — é flag de permissão que o ERP já
   devolve no GET, ao lado de `vldRwPlanfin: 1` e `right: "RW"`. O comentário do código que atribuía
   esse papel a ele estava errado.
3. O PUT recalcula `docMnyValor` a partir das linhas de item — por isso, aplicado antes do item,
   colapsava o documento para zero.
4. A condição "sugestiva" do cadastro é exigência **por-pessoa**, não universal. O SKYJACK no HML não
   tem uma, e a com194 devolveu `count: 0` (nem aviso). A exigência que motivou o passo original veio
   da pessoa **194** (L-FOUNDERS) em **produção**.

**Divergência HML × produção que segue sem explicação:** em produção, o mesmo código com a ordem
antiga **manteve** o título (SN 18345 do colega, `titCod 4`, baixa fin014 gravada). No HML destrói.
A causa provável é a condição de pagamento envolvida (a de produção tem regra de parcelamento; a
`101` do HML, aparentemente não). Por isso a correção **não assume nenhum dos dois comportamentos** —
ela verifica o resultado e falha fechado.

## 4. A correção implementada

`completarSnAdiantamento` virou dois passos, em `RecebimentoNumerarioService`:

1. **`addLineItem`** primeiro — foi medido que a linha de item preserva o título.
2. **`applyPaymentConditionIfRequired`** depois, e **só** se a com194 acusar validação bloqueante
   (`fdvVldErr === 2`) mencionando condição de pagamento. Quando entra: mantém o fail-closed de nunca
   gravar condição de outro cliente e ganha discriminador próprio — relê o documento e exige
   `mnyTitValor === docMnyValor`, falhando com o `docCod` na mensagem se as parcelas foram destruídas.

Remediação do **P0** do Regis-Review, no mesmo worktree:

- **`SN_COND_PGTO_AUTOAJUSTE`** (default ligado; desligar é opt-out) + log de tipo estável
  `sn-cond-pgto-exigida-pelo-erp` com `docCod`, `pesCod` e `idempotencyKey` **antes** de qualquer
  escrita. Com a flag desligada a etapa para com o documento **íntegro** (item e título preservados).
- **Gate transporte × domínio na leitura da com194**: 401/403/404/405 **param** a etapa (antes eram
  mascarados como "sem pendência"); 5xx e timeout seguem best-effort. Lista extraída para
  `STATUS_TRANSPORTE`, aplicada também no `classifyValidatorError`.
- **Invariante restaurado** no teste E2E: exige **exatamente uma** chamada à com194 antes da
  homologação e **exatamente uma** depois (o `lastIndexOf` que eu havia introduzido aceitava "alguma
  depois", deixando um refactor remover a nova em silêncio).

Ontologia: **ADR-0025** + ciclo de vida do título na integração com299; `_index`/`_coverage` em
`0.12.1`.

## 5. RESPOSTA À PERGUNTA PENDENTE — a solução está indo E2E no HML?

**Não. E ainda não é hora de testar em produção.** O que existe hoje:

### Provado no HML, com escrita real

- A cadeia **geração → item → finalização** do com299, terminando em `docVldFinalizado: 1` e com o
  título visível no `lov/TituloBorderoReceber` — que é exatamente o LOV que a `etapaFin014` consulta
  (docs **736** e **737**).
- **Ressalva grande:** isso foi provado pelos **experimentos** (`hmlTituloCondicao`), que chamam os
  clients passo a passo espelhando o serviço. **O código do produto corrigido nunca rodou contra o
  HML** — nem pela rota real (`POST /recebimentos/transacoes/:id/solicitacao-numerario`).

### Nunca exercitado no HML

| Leg | Situação |
|---|---|
| `completarSnAdiantamento` corrigido, pela rota real | é exatamente o que o teste da Fase B faz — **não rodou ainda** |
| `etapaFin014` (borderô / baixa) contra título real | nunca — **antes dos docs 736/737 não existia título no HML** |
| NDe no com297 | nunca no HML. Os fixes do colega foram provados em **produção** (SN 18345), não em homologação |
| Fiscal (com300), observações (com131), homologação, poll SEFAZ | nunca no HML |
| `applyPaymentConditionIfRequired` (o ramo condicional) | **não é exercitável no HML** com o SKYJACK — sem condição sugerida, a com194 devolve `count: 0`. Este é o P0. Os testes dele são mocks derivados de **uma** medição real |
| Fail-closed `mnyTitValor === docMnyValor` contra o ERP | nunca disparou de verdade — só em mock |
| Persistência Postgres (ledger + `nota_debito_eletronica`) | tudo fake nos E2E; nunca exercitada neste fluxo |
| Gate fiscal RT-001 (`dprVldCstIbsCbs: "-1"`) | segue **não implementado** (backlog da auditoria IBS/CBS) |

### Sobre o teste em produção

Duas coisas verdadeiras ao mesmo tempo, e vale ter as duas na cabeça:

- **Produção está mais adiante que o HML nas legs finais.** O colega já executou a SN 18345 ponta a
  ponta lá, com NDe. Um teste em produção não seria inédito.
- **Mas produção nunca rodou o código novo.** E a mudança mexeu justamente no passo cujo
  comportamento **divergia** entre os dois ambientes. Com o código novo, em produção o PUT
  simplesmente não acontece para clientes sem condição sugerida (a com194 não acusa) — o que é o
  caminho que produção já demonstrou funcionar. Para um cliente **com** condição sugerida (pessoa
  194) o ramo novo dispara, e esse é o caminho que **nenhum ambiente exercitou**.

**Ordem defensável:** rodar a Fase B no HML (§6) → se passar da SN e quebrar mais adiante, corrigir
com evidência de homologação → só então produção, e preferencialmente com um cliente **sem** condição
sugerida, para não estrear o ramo condicional junto. Se a decisão for testar em produção antes disso,
que seja consciente de que a leg `fin014 → NDe` nunca foi vista em homologação.

## 6. PRÓXIMO PASSO Nº 1 — a Fase B no worktree novo

**O Yuri dispara** (o classificador de permissões bloqueia o agente em `*.integration.test.ts`):

```
cd C:/tmp/sn-titulo-wt/src/backend
npx jest recebimentos.e2e.hmlWrite --testPathIgnorePatterns "/node_modules/"
```

Repare no caminho: worktree **`sn-titulo-wt`** (tem a correção). O `sn-condpgto-wt` tem só o merge.
O fake do repositório de NDe já está registrado ali — sem ele a homologação quebraria por falta de
Postgres em vez de por comportamento do ERP.

O que esperar: a SN gera, recebe a linha de item, **não** tem a condição tocada (SKYJACK não dispara
a com194) e finaliza com `docVldFinalizado: 1`. Daí em diante o fluxo entra em território virgem no
HML — `fin014` achando o título real, NDe no com297, leg fiscal, homologação. **Bug novo ali é
progresso**, porque significa que a barreira que travava tudo caiu.

O teste é exploratório de propósito: aceita `settled`, `error`, `blocked` ou `skipped`, e o valor está
no `[LEDGER]` / `[FASE-B]` do console (etapa alcançada + mensagem do ERP).

## 7. Pendências de processo para fechar o pipe

1. **Bump de versão** — duas leituras, e a escolha define o que sobe:
   - vs. a branch base do tweak: 3 commits, todos `fix` → **0.19.1**
   - vs. `main`: 29 commits, incluindo os `feat` do colega (execução real da SN, NDe fiscal, extrato
     real) → **0.20.0**

   Comando: `scripts/bump-version.ps1 -Execute` + `CHANGELOG.md` + commit `chore(release): vX.Y.Z`.
2. **Rebase** da base (default `main`) e **PR**. Nada foi pushado; abrir PR é ação para fora e ficou
   esperando o Yuri.
3. **Regis-Review já rodou** — `docs/regis-review/2026-08-03-0904/` (`REPORT.md` + `KANBAN.md`),
   **38 cards**. O gate está cumprido: o único P0 foi remediado nesta rodada.

| Lente | Nota | Cards |
|---|---|---|
| Performance | 8 | 3 |
| Availability · Fault Tolerance · Security · Testability | 7 | 3 · 5 · 4 · 6 |
| Integrability | 6 | 7 |
| Modifiability | 5 | 5 |
| **Deployability** | **4** | 5 (trouxe o único P0) |

Follow-ups P1+ **não implementados**, em
`ontology/_inbox/sn-titulo-condicao-fail-closed-regis-followups.md`: distinguir a falha do
fail-closed em métrica; fixture HAR da com194; checkpoint intra-etapa no ledger (apontado por 3
lentes independentes); runbook da Frente IV; `.gitattributes`; `PaymentConditionSelector`.

## 8. Três decisões esperando o Yuri

1. **Prova do ramo condicional** (a mais relevante). Cadastrar uma condição de pagamento sugerida
   para o SKYJACK no HML tornaria `applyPaymentConditionIfRequired` testável de verdade em
   homologação — a alternativa é estrear em produção com a flag e o log como única rede.
2. **Idioma das mensagens de erro.** O `CLAUDE.md` exige inglês; 5 dos 7 `throw` deste serviço estão
   em pt-BR **porque o analista os lê na modal**. Saídas: formalizar a exceção no `CLAUDE.md`
   (mensagem de usuário pt-BR, log técnico em inglês) ou criar um mapper que separe os canais.
   Traduzir só as novas deixaria a interface bilíngue.
3. **`ontology/CHANGELOG.md`** parado em v0.3.0 enquanto a ontologia está em 0.12.1 — reconstruir ou
   aposentar o arquivo.

## 9. Ambiente (não precisa refazer)

- **Sem Docker** (disco cheio; foi desinstalado — não reinstale). O harness usa ERP fake em processo
  e fakes in-memory nos tokens de DI.
- **HML acessível** em `columbiatrading-hml.conexos.cloud`, credenciais em `src/backend/.env`
  (gitignored, `CONEXOS_BASE_URL` **travado no HML**). Usuário `MPS_FRANCINEI`.
- **Cuidado com sessões concorrentes:** o login já bateu em `LOGIN_ERROR_MAX_SESSIONS` (3 sessões
  abertas) e o client matou uma sessão antiga para entrar. Se o Conexos estiver aberto no browser, a
  corrida pode derrubar a sessão do Yuri.
- **Dados-mestre no HML** já criados (detalhes em `hml-setup-executado.md`): conta de projeto **699**,
  configuração de documento **186**, CFOPs `5949-ND`/`6949-ND`.
- **Lint:** funciona no CI (`ubuntu-latest`, EOL normalizado pelo checkout). A quebra é **local, no
  Windows**, por falta de `.gitattributes` — a afirmação "lint quebrado repo-wide" do handoff antigo
  estava errada.

## 10. Resíduos no HML

| doc | estado |
|---|---|
| 731, 732, 733 | resíduos antigos, sem título / sem baixa / sem NDe |
| 734 | ordem antiga: item e valor, **sem** título, não finalizado |
| 735 | ordem invertida: título destruído pelo PUT, não finalizado |
| **736, 737** | **finalizados, com título aberto de R$ 123,45** (`titCod 1`) — os primeiros do HML em que a leg `fin014` pode ser exercitada |

Nota lateral: `docEspNumero` sai como a **data** (`"03082026"`) e o título herda `"030820261"`; as SNs
de produção usam o nº do PROCESSO. Follow-up já anotado no HAR do colega, não tocado aqui.

## 11. Mapa de leitura

| Arquivo | Para quê |
|---|---|
| `docs/e2e/gap-titulos-diagnostico.md` | as medições que refutaram o achado nº 4 — **leia antes de mexer no fluxo da SN** |
| `docs/regis-review/2026-08-03-0904/REPORT.md` + `KANBAN.md` | a revisão de arquitetura desta mudança |
| `ontology/_inbox/sn-titulo-condicao-fail-closed-regis-followups.md` | o que ficou fora de propósito |
| `ontology/decisions/` (ADR-0025) | a decisão condicional + fail-closed |
| `ontology/_inbox/com299-sn-generation-har.md` | o log de produção do colega (SN 18345) |
| `docs/e2e/hml-setup-executado.md` | dados-mestre do HML |
| `docs/reforma-tributaria/02_auditoria_gap_report.md` | backlog fiscal IBS/CBS (contexto de fundo, RT-001 ainda sem gate) |
| `docs/e2e/fase-b-rodada2-e-gap-titulos.md` | histórico — **contém o diagnóstico refutado**; leia só como registro |
