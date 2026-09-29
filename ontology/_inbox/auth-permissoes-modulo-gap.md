# Gaps — auth-permissoes-modulo

> Aberto pela AutoLoopRunner em 2026-09-28. Responda aqui; o loop não está pausado por isto
> (default conservador aplicado, ver abaixo).

## P1 — `GET /sispag/lotes/:id/linhas-digitaveis` e `GET /sispag/boletos-dda`: `ver` ou `executar`?

**O que a tabela aprovada diz:** "Mapeamento por rota" da entrevista, seção `/sispag`, lista as duas
como **"hoje: aberta → proposta: `sispag:ver`"**.

**O que o código da `main` (v0.43.1) faz:** as duas já estavam protegidas por `requireRole('admin')`,
com comentário explícito de LGPD:

- `routes/sispag.ts`, `/lotes/:id/linhas-digitaveis`: "a linha digitável é destino de pagamento —
  carrega banco, agência e conta do cedente no campo livre, além do valor. Sem o guard, um loop de
  `curl` extrai a carteira de boletos da Columbia. LGPD Art. 6º e LC 105."
- `routes/sispag.ts`, `/boletos-dda`: "Mesmo guard das linhas digitáveis do lote: código de barras é
  destino de pagamento."

A premissa "hoje: aberta" da tabela está errada para essas duas linhas. A tabela inteira foi
desenhada como "equivalente ao comportamento de hoje" (I6), e rotas com dado bancário sensível que
hoje exigem admin foram para `executar` (JC-3: `/contas-pagadoras`, `/remessa/arquivo`).

**Default aplicado (conservador, equivalente a hoje):** as duas ficam em **`sispag:executar`**.
Consequência na tela: quem só tem `sispag:ver` não vê a aba de Boletos DDA nem os botões de copiar
linha digitável do lote (o front esconde essas chamadas para quem não executa).

**Pergunta:** confirma `sispag:executar` para as duas (equivalência com hoje, como a JC-3), ou quer
abrir para `sispag:ver` (quem só consulta passa a ver código de barras / linha digitável)?

- Se confirmar: nada a fazer.
- Se quiser `ver`: trocar as duas linhas em `src/backend/routes/sispag.ts`, a tabela de
  `src/backend/http/routePermissions.test.ts` e o gate do front em `app/sispag` (é um tweak pequeno).

## Resposta (2026-09-29, dono do ciclo)

**Abrir para `sispag:ver`.** As duas rotas passam a exigir `sispag:ver`; a aba Boletos DDA e o
"Copiar linha digitável" aparecem para quem só vê. "Atualizar DDA", o `.REM` e as contas pagadoras
seguem em `sispag:executar`. Aplicado em `routes/sispag.ts`, `http/routePermissions.test.ts`,
`routes/sispag.test.ts`, `app/sispag/page.tsx`, `BoletosDdaTab.tsx`, `LoteCard.tsx` e testes; ADR-0053
atualizada.
