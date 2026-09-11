# Follow-ups — rateio por parcela pelo em-aberto (I-Write-9) · 2026-09-11

> Origem: investigação do erro relatado por analistas ao clicar **Processar** em grupo da aba
> Automáticas com 2+ adiantamentos. Causa-raiz e correção em `business-rules/fin010-write-contract.md`
> (I-Write-9) e no PR #72. Sondas: `jobs/probe-permuta-titulo-emaberto.ts`,
> `jobs/retry-permuta-com-erro.ts`.

## Implementado nesta rodada

- **I-Write-9** — a parcela entra no rateio pelo **em-aberto**, parcela quitada fica fora.
  `abertoDaParcela` virou fonte única, compartilhada com a cobertura (I-Write-8a).
- **Limpeza do ponteiro** — `clearBorCod(filCod, borCod)` zera o `bor_cod` das linhas `error` quando
  o borderô órfão é apagado (emenda ao I-Write-7).

## P2 — dívida ANTERIOR encontrada de passagem: `bor_cod` sem filial

`bor_cod` é sequencial **por filial** — o mesmo número existe em filiais diferentes ao mesmo tempo
(medido: bor 2436 na filial 1, bor 2771 na filial 4). Três métodos de
`PermutaExecucaoRepository` filtram **só pelo número**:

| método | risco |
|--------|-------|
| `countByBorCod(borCod)` | conta linhas de outra filial ⇒ borderô vazio deixa de ser apagado (`BorderoGestaoService:140`) |
| `listByBorCod(borCod)` | mostra baixas de outra filial na tela do borderô (`:305`) |
| `deleteByBorCod(borCod)` | **apaga trilha de outra filial** (`:201`) — o mais grave dos três |

`clearBorCod` já nasce escopado por filial. Os três acima **não** foram tocados: mudar a assinatura
mexe em `BorderoGestaoService` em 4 pontos e merece rodada própria, com teste de colisão entre
filiais. Nenhum incidente conhecido — a colisão exige o mesmo número vivo em duas filiais **e** uma
operação de gestão de borderô sobre ele.

## P3 — âncora I-Write-6 em invoice multi-parcela

`ancorarNoAdto` segue condicionada a `titulos.length === 1`, e não a "uma única parcela **aberta**".
Numa invoice de 2 parcelas com só 1 aberta (o caso 7144/4755), a âncora fica desligada e a variação
é rateada por taxa — comportamento anterior, preservado de propósito. Ligar a âncora ali mudaria o
arredondamento de centavos de baixas reais; decidir com o time antes.

## P3 — painel não distingue "pendente" de "falhou"

As três permutas que quebraram voltavam ao painel como **Pendente**, idênticas a uma linha nunca
processada: `statusPorAdto` só é populado por vínculo de borderô, e execução com `error` não produz
vínculo (`AbaAutomaticas.tsx:107`). O analista clica, recebe o toast de erro e a linha não muda —
o histórico da falha só existe no ledger. Um badge "falhou" lendo `permuta_alocacao_execucao`
resolveria.

## Aberto — validação em produção

O fix foi validado por **pré-voo read-only** (adto 4471 → invoice 4755 roteia para a parcela 2,
USD 29.575,24 / BRL 150.061,81) e por 3 regressões em teste. **Falta** a execução real: combinado
com o Yuri que o deploy vem primeiro e a analista clica "Processar" no processo 173, para a
confirmação vir pelo caminho de produção — e não por escrita de máquina de dev, que o
`EnvironmentProvider` bloqueia de propósito (`PERMITIR_ESCRITA_PRD_LOCAL`).

Casos à espera: adto **6833** → invoice 7144 parcela 2 (USD 31.814,88), adto **4471** → invoice 4755
parcela 2 (USD 29.575,24), invoice **4803** (USD 180.576,48, duas parcelas abertas).

## Observação operacional — conta do Conexos

O login voltou `LOGIN_ERROR_MAX_SESSIONS` com três sessões de `MPS_FRANCINEI` antes de suceder no
retry. A integração assina como o usuário de uma analista, não como robô dedicado: nossas escritas
são atribuídas a uma pessoa e competem com as sessões dela. Ver
[[conexos-robo-clonex-sem-permissao-fin010]] — o outro lado do mesmo assunto.
