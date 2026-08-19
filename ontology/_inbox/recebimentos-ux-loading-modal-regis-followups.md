# Regis-Review — follow-ups de `fix/recebimentos-ux-loading-modal`

**Feature:** painel responde do banco e enriquece o ERP depois (ADR-0038) + modal de alocação
(ordenação, contenção de rolagem, valor sugerido pela SN).
**Gate:** escopo restrito ao delta (`eef343f`), 4 eixos — Performance, Fault Tolerance, Security,
Design System. **P0: nenhum, nos quatro.**
**Data:** 2026-08-19.

Dois achados foram remediados no ciclo em vez de virarem follow-up (justificativa em cada um).
O restante está aqui e **não foi implementado**, conforme a regra do pipe.

---

## Remediados neste ciclo (exceções à regra P1 → inbox)

| # | Eixo | Achado | Por que não virou follow-up |
|---|------|--------|------------------------------|
| R1 | Performance / Fault Tolerance | `heavyRouteLimiter` (10 req/min **por IP**) em `/painel/enriquecimento` | Defeito introduzido por ESTE diff que quebra a própria feature em uso normal: 6 botões de status + arquivadas + recarregar estouram o teto numa sessão de exploração, e o 429 caía no catch silencioso — Modalidade congelada em "—" e reconciliação do SEFAZ não executada. Limiter removido; o volume de leitura do ERP é o mesmo de antes da ADR, então o `globalLimiter` que já cobria o `/painel` é a proteção proporcional. |
| R2 | Fault Tolerance | `catch {}` totalmente silencioso em `enriquecer` | Também código novo deste diff. "Silent catch num caminho que dispara escrita financeira" torna a falha indistinguível de sucesso. Agora o estado vira `(indisponível)` no cabeçalho da coluna Modalidade — sem toast (a carteira está correta), mas detectável. |

---

## F1 — P1 · Fault Tolerance · a reconciliação do SEFAZ depende da tela

**Onde:** `RecebimentosPainelService.montarEnriquecimento` / `hidratarNdes` → `reconciliar`.

A gravação do número da NDe e do flag `ndeAutorizado` no ledger migrou do caminho crítico de
`/painel` para `/painel/enriquecimento`, que **só o navegador chama**. Nenhum job, cron ou
integração invoca `montarEnriquecimento`. Consequências: consumidor não-browser que bata só em
`/painel` nunca reconcilia; aba fechada / JS abortado / throttling de aba em segundo plano adiam a
reconciliação para a próxima sessão de alguém.

É idempotente e autocura (`if (autorizado && nde.ndeAutorizado !== true)`), então a divergência
ledger×ERP fecha sozinha na próxima carga bem-sucedida. O que incomoda é a janela ficar sem dono:
relatórios que leem `ndeAutorizado` direto do Postgres mentem até lá.

**Encaminhamento sugerido:** mover a reconciliação para um job dedicado (EventBridge no alvo, cron no
Express de hoje), desacoplando-a de quem abre a tela. Isso também resolve F3.

## F2 — P1 · Performance · requisição abandonada continua rodando no servidor

**Onde:** `lib/recebimentos.ts` (`fetchPainelRecebimentos`, `fetchPainelEnriquecimento`) e
`page.tsx` (`carregar`/`enriquecer`).

A guarda de sequência (`requisicao.current`) descarta o **resultado** no cliente; o servidor segue
até o fim. Os controles de busca ficam desabilitados durante a carga, então trocas de filtro em
rajada não são alcançáveis — mas o **enriquecimento roda em segundo plano** e sobrevive à troca, de
modo que dois ou três podem se sobrepor, cada um com o orçamento de 12s do com297.

**Encaminhamento sugerido:** `AbortController` no cliente (ref, `.abort()` ao substituir a sequência)
**e** `req.on('aborted')` no Express para cortar de fato — só o lado cliente não economiza servidor.

## F3 — P2 · Security · escrita sob GET sem `requireRole('admin')`

`/painel/enriquecimento` reconcilia o ledger, o que é escrita, sob um verbo de leitura e sem role.
**Não amplia o blast radius**: o `/painel` da `main` já fazia exatamente isso, com o mesmo perfil de
ator. Mas isolar a escrita numa rota nomeada é o momento natural de alinhar à convenção
"write-ish → `requireRole('admin')`" usada no resto do arquivo. Resolvido de graça se F1 mover a
reconciliação para um job.

## F4 — P2 · Security · o recorte das duas chamadas coincide por convenção, não por construção

`fetchPainelRecebimentos` e `fetchPainelEnriquecimento` montam o `URLSearchParams` de forma
independente. Hoje nenhuma passa `filCod`, então batem. Se um tweak futuro passar `filCod` só numa
delas, o backend responde recortes diferentes e o merge por `txnId` pinta modalidade calculada sobre
outro universo de filiais. Não é vazamento (o servidor continua barrando quem não pode ver) — é UI
inconsistente. **Encaminhamento:** extrair `buildPainelQuery(opts)` compartilhado no lib.

## F5 — P2 · Performance · `/enriquecimento` re-executa `listParaPainel`

A mesma query que `montarPainel` acabou de rodar. É O(limit) com índice e barata perto do
`imp021`/`com297` que vêm a seguir, mas é desperdício — e entre as duas chamadas o recorte pode
mudar (ingestão nova), fazendo o serviço prever modalidade para linhas que a tela não tem.
**Encaminhamento:** aceitar `txnIds` opcional na rota; quando vier, pula o SELECT e reduz o custo da
previsão. Sem `txnIds`, comportamento atual.

## F6 — P1 (contestado) · Design System · o tratamento de recarga escurece a área de dados

O revisor apontou `opacity-60 pointer-events-none` + `aria-busy` como violação de
`patterns.md §8.1` ("não escureça / não bloqueie a área").

**Contestado, com a fonte.** §8.1 trata de *polling / atualização em segundo plano* e se exclui
explicitamente deste caso na própria lista "Quando **não** usar": *"Operações iniciadas pelo usuário
— use loading de botão + toast de resultado"*. Trocar filtro é operação iniciada pelo usuário, e o
loading de botão exigido pela seção está implementado. O escurecimento é adicional e foi **requisito
explícito do Yuri** no report que originou esta feature ("dimmed + pointer-events disabled, or an
overlay").

**Encaminhamento:** decisão do Yuri — manter como pedido, ou remover o dim e ficar só com o spinner
do botão. Se ficar como está, vale uma nota em `patterns.md` dizendo o que fazer em recarga
iniciada pelo usuário **com dados na tela**, que hoje é o vão entre §8 e §8.1.

## F7 — P3 · Security · `filiais: []` significa "todas", não "nenhuma"

`filialAuthz.ts` devolve `undefined` sem claim e `RecebimentosPainelService.resolverFilCods` trata
`undefined` **e** array vazio como "todas as filiais do ERP". O comentário do módulo promete o
oposto ("allow ONLY the listed filiais, deny otherwise"). Um usuário provisionado com lista vazia
recebe o tenant inteiro. **Pré-existente na `main`**, fora do escopo deste tweak, mas é falha de
provisionamento silenciosa. **Encaminhamento:** tratar allow-list vazia como negar tudo.

## F8 — P3 · Performance · `useTabelaFiltro` memoiza omitindo os acessores das deps

`getFilCod`/`getBuscaTexto` chegam inline (identidade nova a cada render) e ficam fora das deps de
propósito — incluí-las anularia o memo. Correto enquanto forem puras, como são nos dois chamadores
atuais. Um chamador futuro que capture prop externa em closure veria resultado stale.
**Encaminhamento:** aceitar `buscaTexto` já resolvido como string, ou exigir `useCallback`.

## F9 — P3 · Fault Tolerance · guarda de sequência fora do updater

`if (id !== requisicao.current) return` antes de `setPainel`, em vez de dentro do updater. Janela
estreitíssima e sem cenário concreto de inconsistência no código atual. Caveat idiomático.
