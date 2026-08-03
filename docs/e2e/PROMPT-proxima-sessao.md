# Prompt da próxima sessão — integrar o colega e fechar o E2E da Frente IV

> Cole o bloco abaixo como primeira mensagem da sessão nova.

---

Esta sessão é de INTEGRAÇÃO + IMPLEMENTAÇÃO, continuando o E2E real da Frente IV.

Leia primeiro, na íntegra e nesta ordem:
1. `docs/e2e/HANDOFF-proxima-sessao.md` (estado completo, branches, achados, runbook)
2. `docs/e2e/fase-b-rodada2-e-gap-titulos.md` (o gap que bloqueia o fluxo)
3. `docs/reforma-tributaria/02_auditoria_gap_report.md` (§6 backlog fiscal — contexto de fundo)

## Contexto em uma frase

O E2E da Frente IV roda de verdade contra o Conexos de homologação e cria documentos reais; três
bugs já foram corrigidos e validados no ERP, mas o fluxo para na finalização da SN porque **a
automação nunca gera os títulos (parcelas) do documento** — e um colega commitou avanços na leg da
NDe que precisam ser integrados aos nossos fixes.

## Tarefas, em ordem

1. **Integrar o trabalho do colega.** `git fetch origin` e leia `git show 9c4224a` inteiro
   (branch `origin/feat/recebimentos-numerario-real`) + o arquivo que ele adicionou
   `ontology/_inbox/com299-sn-generation-har.md`.
   - Avalie o que dele já resolve os achados 1, 2, 3 e 5 do handoff (§4).
   - **Atenção especial:** o HAR dele pode conter o contrato da geração de TÍTULOS (achado nº 4).
     Se contiver, isso destrava a tarefa 3 sem precisar de HAR novo.
2. **Merge/rebase em `dev`**, preservando os dois fixes já validados contra o ERP real
   (branch `fix/sn-cond-pgto-finalizacao`, worktree `C:/tmp/sn-condpgto-wt`, commits `fb693fc` e
   `aebc905`): condição de pagamento do próprio cliente com paginação por `count`, e verificação
   `docVldFinalizado===1` após finalizar. Ambos têm teste de regressão — se algum quebrar no merge,
   o merge está errado, não o teste. Rode `npm test` (baseline: 97 suites / ~1005 testes verdes).
3. **Fechar o gap dos títulos (com032).** Se o HAR do colega não cobrir, peça ao Yuri capturar:
   doc **733** no HML → botão **Financeiro** → gerar/salvar o título de R$ 123,45 → DevTools/Network
   → endpoint + payload. Com o contrato, implemente a etapa `etapaTitulos` entre
   `completarSnAdiantamento` e a finalização, com discriminador próprio (reler o doc e exigir
   `mnyTitValor === docMnyValor`), seguindo a doutrina "cada etapa tem seu discriminador".
4. **Repetir a Fase B** (o Yuri dispara o comando — o classificador bloqueia o agente):
   `cd src/backend && npx jest recebimentos.e2e.hmlWrite --testPathIgnorePatterns "/node_modules/"`.
   Objetivo: seguir para fin014 → NDe → fiscal → observações → homologação → SEFAZ.
5. **Quando a NDe for autorizada:** capturar o XML/documento e responder as perguntas fiscais
   pendentes — sai com grupo IBS/CBS? `finNFe=6`? `tpNFDebito`? `DFeReferenciado`? (RT-001/002/003).
   Isso alimenta `ontology/_inbox/reforma-tributaria-gap.md` (info-gap nº 1).
6. **Fechar o pipe** da branch de fixes: `/regis-review` no escopo tocado, remediar apenas P0,
   rebase e PR.

## Restrições

- Testes `*.integration.test.ts` batem no ERP REAL — **só o Yuri os dispara**; nunca tente rodá-los
  sozinho. Todo o resto (`npm test`) é livre.
- `CONEXOS_BASE_URL` em `src/backend/.env` está travado no HML; **jamais** aponte para produção.
  Produção é somente leitura, e qualquer escrita lá exige o Yuri agindo pessoalmente, passo a passo.
- Não reinstale Docker (disco cheio; o harness não precisa dele).
- Mudança de produto passa pelo pipe (`/feature-tweak` ou `/feature-new`) em worktree dedicado.
- Delegue a agentes/tasks paralelas sempre que der, para economizar janela de contexto.
