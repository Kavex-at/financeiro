---
adr_number: 0038
title: O painel de recebimentos responde só com o Postgres e as leituras de ERP (previsão de modalidade e hidratação da aba NDe) saem para uma segunda rota, aplicada por cima da tela já renderizada
date: 2026-08-19
status: accepted
type: change
related_entities: [TransacaoBancaria, NotaDebitoEletronica]
related_actions: []
related_integrations: [conexos-nde-fiscal, conexos-imp021]
supersedes_decisions: []
amends_decisions: [0033, 0037]
---

# ADR 0038: o painel responde do banco e enriquece com o ERP depois

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`fix/recebimentos-ux-loading-modal` (worktree, base `main`). **Fonte:** `/feature-tweak` com o Yuri
(2026-08-19), a partir de um report de UX: "a tela fica em branco por vários segundos".
**`entity_changed = false`** — nenhuma coluna nova, nenhuma regra de negócio alterada. O que muda é
**quando** cada pedaço da projeção de leitura chega à tela.

## Contexto

`GET /recebimentos/painel` fazia tudo num request só, e duas das etapas dependiam de **ler o ERP**:

1. **Previsão de modalidade** (ADR-0033) — `construirIndicePrevisao` varre o `imp021` de cada filial
   permitida para montar o índice cliente → modalidade. São ~5.755 processos em 7 filiais, com cache
   em memória de 10 minutos e **nenhum orçamento de tempo**.
2. **Hidratação da aba NDe** (ADR-0037) — um grid do com297 por filial, para reconciliar o SEFAZ e
   trazer as NDes emitidas fora da ferramenta. Tem teto: `PAINEL_NDE_HIDRATACAO_BUDGET_MS` (12s) no
   total e 8s por filial.

Somadas, elas podiam segurar a resposta por mais de dez segundos. E o que ficava esperando não era
periférico: **os KPIs e a carteira inteira**, que saem de três queries do Postgres e estavam prontos
em centenas de milissegundos. O analista via uma tela vazia enquanto o dado que ele veio buscar já
existia do lado do servidor.

Piorava com a ADR-0034: o filtro de status virou server-side, então **cada clique num botão de
status** paga esse mesmo pedágio.

## Decisão

**`GET /recebimentos/painel` passa a ser Postgres-only.** Devolve transações, KPIs, a aba NDe como o
banco a conhece e a modalidade de **fato** (que vem do ledger, também Postgres — barata).

**Nasce `GET /recebimentos/painel/enriquecimento`**, que aceita exatamente a mesma query (status,
arquivadas, tesouraria, filial) e devolve:

- `modalidades`: mapa `txnId → modalidade PREVISTA`;
- `ndes`: a aba NDe hidratada contra o com297;
- `ndePendentes`: o KPI corrigido (COUNT do banco − reconciliadas + externas pendentes).

A tela chama a segunda rota **depois** de renderizar a carteira e aplica o resultado por cima.

### Três invariantes que sustentam o corte

1. **Fato vence previsão, sempre.** O mapa de `modalidades` só inclui transação **sem** modalidade de
   fato. As duas respostas chegam em momentos diferentes; devolver o fato ali abriria uma corrida em
   que o palpite pinta por cima da modalidade efetivamente executada — e a modalidade decide se sai
   uma nota de débito irreversível (ADR-0033).
2. **O recorte é o mesmo nas duas rotas.** `resolverRecorte` é fonte única. Recortes divergentes
   preencheriam a modalidade de um crédito que não está na tela e deixariam de fora um que está.
3. **Falhar no enriquecimento não apaga nada.** Tudo que ele devolve é substituição idempotente
   sobre conteúdo já correto. ERP fora do ar → mapa vazio e as linhas do banco; a UI trata o erro
   como silencioso, sem toast e sem estado de erro.

### O que veio junto do lado da tela

- **Skeleton só na primeira carga.** Recarga (recarregar, trocar status, ver arquivadas) mantém a
  tabela montada, apagada e inerte — nunca volta a skeleton (`skeleton.md`, `patterns.md §8.1`).
- **O botão que disparou a busca mostra spinner e fica desabilitado.**
- **Falha de recarga preserva a carteira** e vira faixa com "Tentar de novo"; só a primeira carga,
  que não tem o que preservar, vira estado de erro de tela cheia.
- **Guarda de sequência** (`requisicao.current`): resposta de um filtro abandonado não pinta a tela.

## Consequências

**Positivas.** O primeiro paint passa a valer o tempo do Postgres. A reconciliação do SEFAZ continua
acontecendo (migrou junto com a leitura que a habilita — é o mesmo grid; duplicá-la para manter a
escrita na rota antiga custaria um segundo com297 por carga de tela).

**Negativas / aceitas.**

- A coluna Modalidade nasce "—" e preenche depois. Mitigado por um spinner no cabeçalho da coluna:
  sem ele, um "—" transitório passaria por resposta final.
- Duas rotas onde havia uma, com o recorte precisando concordar. Mitigado pelo `resolverRecorte`
  compartilhado e por um teste que trava a igualdade do filtro.
- `/painel/enriquecimento` executa a **reconciliação do SEFAZ** (escrita no ledger) sob um verbo
  GET, sem `requireRole('admin')`. Não amplia o blast radius — o `/painel` já fazia exatamente isso,
  com o mesmo perfil de ator —, mas isolar a escrita numa rota nomeada é o momento natural para
  alinhá-la à convenção "write-ish → admin" usada no resto do arquivo. Registrado como follow-up.
- **Sem limiter próprio, por decisão.** A primeira versão levava `heavyRouteLimiter`; o gate de
  Performance mostrou que o teto dele (10 req/min por IP) é incompatível com uma rota que a TELA
  dispara — 6 botões de status, mais arquivadas e recarregar, estouram numa sessão de exploração, e
  o 429 apareceria como coluna Modalidade eternamente em "—". O volume de leitura do ERP é o mesmo
  de antes da ADR (o trabalho mudou de rota, não aumentou), então o `globalLimiter` que já cobria o
  `/painel` continua sendo a proteção proporcional.

## Alternativas descartadas

- **Aquecer o cache do `imp021` no boot.** Reduz a frequência do pior caso, não o elimina: o cache é
  em memória por instância, e reciclagem ou segunda instância reabrem a janela fria. Continua
  disponível como otimização futura, ortogonal a esta decisão.
- **Só diferir a modalidade, mantendo a hidratação da NDe inline.** Deixaria os 12s de orçamento do
  com297 no caminho crítico — o primeiro paint melhoraria sem ficar imediato.
- **Duas rotas separadas** (`/modalidades` e `/ndes`). Mais granular e mais resiliente, porém mais
  superfície de API para manter, sem ganho perceptível: as duas leituras rodam em paralelo dentro da
  mesma chamada.

## Emenda (2026-09-01, ADR-0042)

A hidratação da NDe descrita acima deixou a gravação do número do SEFAZ e do flag `ndeAutorizado`
dependente de alguém ter a tela aberta — `GET /painel/enriquecimento` só é chamado pelo navegador
(follow-up **F1**). A ADR-0042 dá à reconciliação um **job próprio**; a rota de enriquecimento
continua servindo a tela, mas deixa de ser a única escritora. A decisão desta ADR — painel responde
do banco, ERP enriquece depois — permanece válida e inalterada.
