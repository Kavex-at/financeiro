# Follow-ups — "nada a reconciliar" deixa de ser 500 (I-Recon-8) · 2026-09-14

> Tweak disparado pelo primeiro teste em produção do fix de parcelas (v0.36.2). Regra registrada em
> `business-rules/idempotencia-reconciliacao.md` (I-Recon-8).

## Implementado

- `reconciliar` devolve terminal vazio + `BUSINESS_WARN` quando não há alocação — nunca lança.
- Modal conta/dispara só linhas com algo a processar; as demais ficam visíveis, em cinza, com o
  motivo. Fonte única `temAlgoAProcessar` / `motivoSemProcessar`.

## Estágio de aprendizado — que regra teria evitado este bug?

O bug não foi de lógica: foi de **taxonomia de erro**. Uma condição de domínio esperada ("este
adiantamento não tem o que baixar") saiu como `Error` genérico, e o handler — corretamente, para um
`Error` sem tipo — devolveu 500. O código já tem a família certa de erros
(`AlocacaoSemCoberturaError` → 422, `ReconciliacaoEmAndamentoError` → 409), mas ela só é usada nas
recusas que alguém lembrou de tipar.

**Diff proposto para o CLAUDE.md do core** (seção Conventions / TypeScript Style):

> - **`throw new Error(...)` cru em serviço é proibido.** Todo `throw` num `domain/service/` carrega
>   um tipo de erro do domínio (`domain/errors/`) com `statusCode`. Um `Error` sem tipo vira **HTTP
>   500** no handler, e 500 significa "o servidor quebrou" — não "esta entrada não se aplica".
>   Antes de lançar, responda: *isto é falha do servidor, recusa da requisição (4xx), ou um
>   não-evento que deveria ser terminal vazio?* Só a primeira é `Error`.

Racional medido: `grep -c "throw new Error(" domain/service/permutas/` dá **11 sítios** só em
permutas — cada um é um 500 potencial numa tela de analista. Este tweak converteu 1; os outros 10
não foram auditados (P2 abaixo).

## P2 — auditar os outros `throw new Error` de serviço

Os 10 restantes em `domain/service/permutas/` merecem a mesma pergunta. Candidatos visíveis:
`adiantamento ${x} not found` e `adiantamento ${x} without filial` (ambos em
`reconciliarSerializado`) são claramente 4xx/estado de dados, não 500. Não tocados aqui para manter
o tweak cirúrgico.

## P3 — o mesmo padrão nas outras frentes

SISPAG e Recebimentos têm serviços com o mesmo estilo de `throw` cru. Vale um sweep quando alguém
estiver na área — não é urgente enquanto não houver relato de 500 na tela.

## Validado em produção

O gatilho deste tweak é ele próprio a validação do v0.36.2: adto 4471 → invoice 4755 **parcela 2**,
borderô 2466, R$ 150.061,81 + R$ 1.827,75 de variação = R$ 151.889,56, exatamente o saldo a
permutar do adiantamento. Falta **aprovar o borderô 2466** (fica `EM CADASTRO` até lá — por isso a
parcela ainda aparece aberta no ERP) e repetir em 579 (adto 6833 → invoice 7144).

Ver [[exitworktree-alerta-apos-squash-merge]] para a limpeza do worktree depois do merge.
