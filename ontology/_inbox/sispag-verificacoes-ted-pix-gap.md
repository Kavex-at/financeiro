# Gaps — sispag-verificacoes-ted-pix (ADR-0063)

> Aberto pelo OntologyCurator em 2026-10-05, ao escrever a ontologia v0.36.0. As regras A–E foram
> decididas pelo usuário; abaixo está só o que **não** foi decidido e que a escrita revelou. Onde há
> **proposta**, ela está na ontologia como default e precisa de confirmação.

## P0 (bloqueia a parte afetada)

### Q1 — Oferta = envio (I10b) × retirada por falta de dado (I13j)

Hoje a tela **só oferece** TED/PIX quando `destino(item)` resolve (I10b). Mantido isso, a analista
nunca consegue escolher TED/PIX para um favorecido sem conta/chave, e então:

- a retirada pelo sistema (I13j-1) só acontece se o cadastro mudar entre a oferta e a verificação;
- **nenhuma `PendenciaCadastro` é aberta** para o caso mais comum (favorecido sem dado nenhum), que
  é justamente o que a regra D quer levar ao responsável pelo cadastro.

O BPMN ("Revisar lote e definir a forma de pagamento" → "Verificar títulos TED e PIX" → "Falta dado
de pagamento?") sugere que a escolha é livre e a verificação é quem decide. Opções:

- **(a)** Liberar a escolha de TED/PIX sempre; a verificação retira o item e abre a pendência. I10b
  passa a valer só para o **envio** (a tela continua mostrando de onde viria o destino).
- **(b)** Manter I10b; TED/PIX indisponível mostra a ação "sinalizar falta de dado", que abre a
  pendência sem incluir nada.
- **(c)** Manter I10b e abrir a pendência também quando a oferta é calculada (sem ação da analista).

**Sem proposta da curadoria** (muda uma invariante vigente). Bloqueia a tarefa de UI da modalidade e
o teste do caminho I13j-1.

## P1

### Q2 — Escopo da contraparte de duplicidade: só a filial do item ou todas?

O `fin064` é lido por filial; a probe comparou entre filiais (`filCod|docCod`). **Proposta:** mesma
filial do item (o lote é de uma filial, I4), com leitura cross-filial como evolução. Confirmar.

### Q3 — Janela de leitura do `fin064` para a duplicidade

FORTE inclui títulos pagos e o histórico começa em 2026-01 (6 de 7 filiais). Ler tudo do favorecido
a cada verificação pode ser caro. **Proposta:** filtrar por favorecido (`pesCodFor`) sem limite de
data se o filtro existir no `fin064/list`; senão, janela configurável (default: desde 2026-01-01).
Precisa de sonda (o filtro por favorecido no `fin064` não foi testado).

### Q4 — Chave do `PerfilCanalFornecedor`

A probe agrupou por **nome** do favorecido (a baixa `fin010` não trouxe `pesCod` na sonda). A
verificação procura por `pesCod`. Confirmar se a baixa do `fin010` (ou o borderô) expõe `pesCod`;
senão, definir a ponte nome → `pesCod` (e o que fazer com homônimos: sem perfil).

### Q5 — `finalizarLote` quando a verificação retira item

**Proposta (na ontologia):** a retirada é gravada e a finalização **não** acontece
(`ItemsRemovedByCheckError`), para a analista ver o lote que vai finalizar. Alternativa: finalizar
com o que sobrou. Lote que fica vazio continua `RASCUNHO` vazio (manual) — e o automático?

### Q6 — Duplicidade FRACA contra título pago

A decisão B diz "inclusive pagos" só para a FORTE. **Proposta (na ontologia):** mesma fonte e mesmo
universo da FORTE (inclusive pagos). Confirmar.

### Q7 — Justificativa entre lotes

A alerta pertence ao item **no lote**. Se o lote é cancelado e o título vai a outro lote, a alerta é
nova e pede nova justificativa. **Proposta:** assim (fail-closed). Alternativa: reaproveitar a
justificativa por (título, contraparte).

### Q8 — Concessão default de `sispag:conferir` e `sispag:cadastro`

Precedente (`sispag:excecao`): só papel `Administrador`. Com um só administrador que também
finaliza, nenhum lote TED/PIX chega à remessa. Quem recebe as permissões na Columbia?

## P2

### Q9 — Quem mais fica impedido de conferir

A regra exclui `finalizadoPor`, `incluidoPor` de item e `criadoPor` de lote manual. Ficaram de fora:
quem definiu a modalidade TED/PIX, quem justificou uma duplicidade, quem cadastrou/aprovou a
`ExcecaoDestino` usada. Manter só o decidido?

### Q10 — Re-verificar no `gerarRemessa` (L8)?

A verificação roda na edição e no finalizar. Entre o finalizar/conferência e a remessa pode surgir
duplicata nova (outro lançamento no ERP). **Proposta:** não re-verificar em L8 (o I10a ao vivo já
reconfere o destino); registrar para avaliar com uso.

### Q11 — Retirada pelo sistema em lote automático

A remoção pela lixeira marca o lote automático como manual (`marcarManual`). A retirada pelo
sistema (I13j) também? E a formação automática pode voltar a lotar o título com pendência de
cadastro aberta? **Proposta:** mesma remoção (marca manual); a formação não olha a pendência (o
título volta e sai de novo enquanto o cadastro não for corrigido) — confirmar se isso é ruído.

### Q12 — Estados `OBSOLETA` / `DESCARTADA` da alerta

Introduzidos pela curadoria para contraparte que sumiu e item que deixou de ser TED/PIX ou saiu do
lote. Confirmar que a analista não precisa ver alerta obsoleta (só a trilha).

## Observação (não é gap de domínio)

- A ADR-0061 tem `adr_number: 0060` no frontmatter (drift do renumeramento em `8daee5b`).

## Resoluções (2026-10-05, sessão do /feature-tweak)

| Q | Decisão | Fonte |
|---|---|---|
| Q1 | **(a)** Escolha de TED/PIX livre com a flag ligada; a verificação retira e abre a pendência. I10b revisado em `business-rules/destino-pagamento-sispag.md`. | O pedido descreve explicitamente "TED sem conta / PIX sem chave → título sai do lote", o que só acontece com a escolha livre. |
| Q2 | Contraparte só na **filial do item** (proposta da curadoria). Caso canônico fil 4 docs 6173/6702 é intra-filial. | curadoria |
| Q3 | Janela: `fin064` com vencimento ≥ 2026-01-01 (início do histórico em 6/7 filiais), paginando de verdade; filtro por favorecido se o `fin064` aceitar, senão filtra em memória. Confirmar na implementação. | evidência do pedido |
| Q4 | **Resolvido:** `Fin010Baixa` expõe `pesCod` (`src/backend/domain/interface/permutas/Fin010Baixa.ts`). Perfil por `pesCod`. | código |
| Q5 | Proposta aceita: retirada pela verificação interrompe aquela finalização (`ItemsRemovedByCheckError`). | curadoria |
| Q6 | Proposta aceita: FRACA também compara contra pagos. | curadoria |
| Q7 | Proposta aceita: justificativa não migra de lote. | curadoria |
| Q8 | Nenhuma concessão default na migration; conceder pela tela de usuários. Registrado no PR como passo de rollout. | decisão de rollout |
| Q9 | Fica a regra da ADR (finalizadoPor, incluidoPor, criadoPor de lote manual). Ampliar = follow-up. | curadoria |
| Q10 | Não re-verifica no L8 (I10a/I12f já reconferem destino no envio). | curadoria |
| Q11 | Retirada pelo sistema **não** muda `automatico`; o cron pode recolocar o título (sem modalidade) — a verificação roda de novo se a analista escolher TED/PIX. | curadoria |
| Q12 | `OBSOLETA`/`DESCARTADA` aceitos. | curadoria |
