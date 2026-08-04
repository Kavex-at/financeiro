# Prompt da próxima sessão — validar a correção do título no HML e fechar o pipe

> Cole o bloco abaixo como **primeira mensagem** de uma sessão nova, com contexto zerado.
> Escrito em 2026-08-03, quando a sessão anterior (`719f54d5`) foi interrompida pelo limite semanal
> de cota do Claude Code.

---

Você está continuando um trabalho já em andamento. Responda sempre em **português**.

O trabalho vive em um **git worktree**, não no checkout principal:

```
cd C:/tmp/sn-titulo-wt
```

Branch: `fix/sn-titulo-condicao-fail-closed` @ `e408ac3`. Working tree limpo, **97 suites / 1024
testes verdes**, typecheck limpo, nada pushado, nenhum PR aberto.

## Leia primeiro, na íntegra e nesta ordem

1. `C:/tmp/sn-titulo-wt/docs/e2e/HANDOFF-proxima-sessao.md` — estado completo. O **§5** responde o que
   já foi provado E2E no HML e o que não; o **§6** tem o próximo passo.
2. `C:/tmp/sn-titulo-wt/docs/e2e/gap-titulos-diagnostico.md` — as medições reais (docs 732–737) que
   definem por que o fluxo da SN é o que é. **Não mexa no fluxo da SN sem ter lido isto.**
3. `C:/tmp/sn-titulo-wt/ontology/_inbox/sn-titulo-condicao-fail-closed-regis-followups.md` — o que
   ficou fora de propósito e as decisões pendentes.
4. `CLAUDE.md` na raiz — convenções e as Inviolable Rules do projeto.

⚠️ **Documentos com informação obsoleta**, que existem no repo e vão te enganar se você os tratar
como estado atual: `docs/e2e/fase-b-rodada2-e-gap-titulos.md` concluiu que "a automação nunca gera os
títulos" e que era preciso capturar a tela **com032**. **Isso foi refutado por medição** — o ERP cria
o título na geração e era o nosso PUT da condição de pagamento que o destruía. Se você encontrar
cópias antigas de `HANDOFF-proxima-sessao.md` / `PROMPT-proxima-sessao.md` no checkout principal
(`.../financeiro/financeiro/docs/e2e/`), elas são de duas sessões atrás e carregam esse mesmo erro.
A verdade é a do worktree.

## Contexto em um parágrafo

Frente IV (Conciliação de Recebimentos, NDe). O fluxo real é: SN de adiantamento no com299 → baixa no
`fin014` → NDe no com297 → fiscal (com300) → observações (com131) → homologação → SEFAZ. Ele já roda
contra o Conexos de **homologação** criando documentos reais. A sessão anterior descobriu, medindo
documento a documento no HML, que o passo que aplicava a condição de pagamento via `PUT com299`
**destruía as parcelas (o título) que o ERP cria na geração** — o que travava a finalização e,
consequentemente, toda a leg seguinte. A correção já está implementada e verde: a linha de item vem
primeiro, e a condição de pagamento só é aplicada se a **com194** acusar validação bloqueante, com
verificação `mnyTitValor === docMnyValor` e falha fechada. Falta **validar isso contra o HML** e
fechar o pipe (bump, rebase, PR).

## Tarefas, em ordem

1. **Peça ao Yuri para disparar a Fase B** e analise a saída (ele roda; você não pode — ver
   Restrições):

   ```
   cd C:/tmp/sn-titulo-wt/src/backend
   npx jest recebimentos.e2e.hmlWrite --testPathIgnorePatterns "/node_modules/"
   ```

   Esperado: a SN gera, recebe a linha de item, **não** tem a condição tocada (o SKYJACK não dispara
   a com194) e finaliza com `docVldFinalizado: 1`. Daí em diante é território virgem no HML — `fin014`
   achando o título real, NDe no com297, leg fiscal, homologação. **Bug novo ali é progresso.**
   O teste é exploratório: não exige sucesso, o valor está na etapa alcançada e na mensagem do ERP
   (`[LEDGER]` / `[FASE-B]` no console).

2. **Se o fluxo quebrar depois da SN:** diagnostique com a mesma disciplina da sessão anterior —
   sonda read-only primeiro, experimento mínimo que **discrimina** hipóteses depois, e só então
   mudança de produto pelo pipe (`/feature-tweak`) em worktree dedicado. Cada etapa tem seu próprio
   discriminador; nunca trate HTTP 200 como sucesso.

3. **Se o fluxo fechar até a NDe:** capture o XML/documento autorizado e responda as perguntas
   fiscais pendentes — sai com grupo IBS/CBS? `finNFe=6`? `tpNFDebito`? `DFeReferenciado`?
   (RT-001/002/003). Isso alimenta `ontology/_inbox/reforma-tributaria-gap.md` (info-gap nº 1).

4. **Feche o pipe:** bump de versão + `CHANGELOG.md` + `chore(release)` → rebase da base → PR.
   O Regis-Review **já rodou** (`docs/regis-review/2026-08-03-0904/`, 38 cards, único P0 remediado),
   então o gate está cumprido — **não rode outro**. Antes do bump, confirme com o Yuri qual leitura
   vale: `0.19.1` (3 commits `fix` vs. a base do tweak) ou `0.20.0` (29 commits vs. `main`, incluindo
   os `feat` do colega). Isso decide o que sobe.

5. **Não implemente os follow-ups P1+** do Regis-Review por iniciativa própria — eles estão no inbox
   de propósito. Se sobrar janela, o de maior valor é o **checkpoint intra-etapa no ledger** (três
   lentes independentes convergiram nele), mas é mudança de máquina de estados com migração: pede
   `/feature-tweak` próprio.

## Restrições (invioláveis)

- Testes `*.integration.test.ts` batem no **ERP real** e criam documentos. **Só o Yuri os dispara** —
  monte o comando, explique o custo (quantos documentos, qual valor) e espere. Todo o resto
  (`npm test`, `npm run typecheck`) é livre.
- `CONEXOS_BASE_URL` em `src/backend/.env` está travado no HML. **Jamais** aponte para produção.
  Produção é somente leitura; qualquer escrita lá exige o Yuri agindo pessoalmente, passo a passo.
- **Não teste em produção sem ler o §5 do handoff.** A leg `fin014 → NDe` nunca foi vista em
  homologação, e o ramo condicional da condição de pagamento não foi exercitado em nenhum ambiente.
- Mudança de produto passa pelo pipe (`/feature-tweak` / `/feature-new`) em **worktree dedicado** com
  caminho curto em `C:/tmp/`. Não trabalhe no checkout principal.
- Não reinstale Docker (disco cheio; o harness não precisa dele).
- Se o Conexos estiver aberto no browser do Yuri, avise: o login do teste já bateu em
  `LOGIN_ERROR_MAX_SESSIONS` e o client mata sessão antiga para entrar.
- Delegue a subagentes/tasks paralelas sempre que der, para economizar janela de contexto.

## Três decisões que estão esperando o Yuri

Traga-as de volta quando fizerem sentido no fluxo, sem transformar a sessão em questionário:

1. Cadastrar uma condição de pagamento sugerida para o SKYJACK no HML, para tornar o ramo condicional
   testável em homologação em vez de estrear em produção com flag e log como única rede.
2. Idioma das mensagens de erro que o analista lê na modal (o `CLAUDE.md` pede inglês; 5 dos 7 `throw`
   estão em pt-BR por serem instruções operacionais).
3. `ontology/CHANGELOG.md` parado em v0.3.0 enquanto a ontologia está em 0.12.1.
