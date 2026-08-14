# Follow-ups — writers da máquina de estados da TransacaoBancaria (ADR-0034)

Aberto em 2026-08-13, na fatia que deu writers reais a `parcial`/`erro` e fez o backfill da carteira.
Nada aqui bloqueia a entrega; são dívidas conhecidas que preferimos registrar a resolver à força.

---

## P0 — pendente de ação do Yuri

### Medir o backfill antes de aplicar

A migração `0046` reescreve o status de linhas reais. **A carteira vai encolher visivelmente e o
"a distribuir" vai cair de uma vez.** As consultas de medição estão no rodapé do próprio arquivo de
migração (versões `SELECT`-only, agrupadas pelo status de destino).

Combinado com o Yuri: rodar em homologação e contra a produção, levar contagem e soma a ele, e só
então deixar a migração entrar. Os números vão para a seção D8 da ADR-0034, hoje marcada
`⚠️ Números medidos: pendentes`.

---

## P1 — vale resolver na próxima fatia que tocar o assunto

### `blocked` não deixa rastro persistido

Um pré-flight reprovado (cadastro/elegibilidade) não escreve nem status nem linha de ledger — o
`beginExecution` só roda depois dele. Então "tentei alocar e o cadastro do cliente barrou" é invisível
para quem não estava olhando a tela naquele instante.

O conserto seria abrir a linha de ledger **antes** do pré-flight, o que muda a semântica de
idempotência (uma tentativa bloqueada passaria a ocupar a chave). Decidimos não fazer aqui: mexer na
chave de idempotência do caminho do dinheiro merece fatia própria.

### `valorNaoAlocado` e a fronteira do Módulo 2

O KPI agora é Σ `(valor − alocado)` sobre todo status que não é `processada`. Quando o Módulo 2
começar a escrever `conciliada`/`manual`, esses créditos entram na conta automaticamente — o que
provavelmente está certo, mas ninguém validou com o Yuri o que "a distribuir" deve significar num
mundo com matching. Revisar junto com o Módulo 2.

### `ndePendentes` continua fixo em 0

`RecebimentosPainelService` devolve `ndePendentes: 0` literal e a aba NDe segue vazia — o Módulo 5 não
existe. É o próximo KPI decorativo a incomodar, e agora o único que sobrou. Registrado para não ser
descoberto numa demo.

---

## P2 — contradições de ontologia a reconciliar quando o Módulo 2 chegar

### `conciliada` tem duas definições incompatíveis

- `state-machines/transacao-bancaria.md`: "match resolvido **e executado/pronto**".
- `actions/recebimentos/atribuir-baixa.md`: a mesma transição produz "rascunho local, **nenhuma
  escrita no ERP** (I1)".

Um estado cujo gatilho não escreve no ERP não pode significar "executado". Escolher uma: ou
`conciliada` = "rascunho montado, match confiável, ainda não executado", ou ela é engolida por
`processada` e some do enum.

### `parcial` passou a ter dois gatilhos possíveis

Hoje deriva da Σ do ledger de numerário (dinheiro já baixado). No Módulo 2, `atribuirBaixa` pretende
escrevê-la a partir do matching (palpite sobre cobertura), e `Recebimento.classificacaoMatch` já tem
um membro `parcial` com o mesmo nome e outro significado. Nada define a sincronização entre os dois.
Reconciliar ou renomear um deles — o tooltip da tela hoje diz explicitamente "dinheiro que já se
moveu", e essa promessa não pode ser quebrada em silêncio.

### `TRANSACAO_ALLOWED[CONCILIADA]` diverge do TB5 da doc

A doc diz `{importada, parcial, manual} → erro`; a tabela em código não admite `conciliada → erro`.
Ponto morto enquanto `conciliada` não tem writer, mas vai importar no Módulo 2.

---

## P3 — observações

### Corrida benigna no split concorrente

Duas alocações do mesmo crédito settlando em paralelo (duas abas abertas) podem ambas ler a Σ antes do
`markSettled` da outra, e ambas decidirem `parcial` — mesmo com o crédito completo. Direção segura (o
crédito fica na fila em vez de sumir dela) e a varredura horária conserta.

A alternativa livre de corrida seria fazer `SUM` e `UPDATE` numa statement só, o que acoplaria o
`TransacaoRepository` à tabela do ledger e quebraria a fronteira de porta. Não vale o preço enquanto o
sintoma for "um crédito fica mais um turno na fila".

### `valor` congela fora de `importada`

Consequência do latch reforçado (ADR-0034 D7): um crédito com qualquer alocação para de ter
`valor`/`contraparte`/`visto_em_run_id` refrescados pelo cron. Correto para `processada` e deliberado
para `parcial` (o denominador da regra Σ não pode se mexer sob uma alocação em curso), mas significa
que uma **correção de extrato pelo banco** deixa de ser vista nesses créditos. Se isso acontecer na
prática, o conserto é um caminho explícito de "re-sincronizar valor", não afrouxar o latch.

### `RecebimentoPipelineService` e o agregado `Recebimento` continuam mortos

O fluxo real nunca cria um `Recebimento`; escreve direto no ledger. `recebimento`,
`rateio_recebimento`, `RecebimentoRepository` e todos os `*Stub` só são exercitados por uma rota que
fabrica a transação inline. Isso não muda com esta ADR, mas fica registrado porque a ontologia ainda
descreve o `Recebimento` como a spine da conciliação.
