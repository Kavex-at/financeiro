# Regis-Review (reduzido) 2026-10-15-0130 — métricas compartilhadas

> Escopo: delta da branch `feat/sispag-sugestao-para-todo-titulo` contra `origin/main` (v0.68.1), tweak
> `sispag-sugestao-para-todo-titulo` (ADR-0072; I15m–o): todo título BOLETO sem DDA ganha um desfecho
> visível; aviso "boleto vence antes do título" com reconhecimento validado no servidor. Worktree:
> `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-sugestao-para-todo-titulo`
> (use SEMPRE caminhos dentro dele). Delta = `git diff origin/main HEAD`.

## O que muda
Motor (`MotorSugestaoBoleto.analisar`: uma passada devolve a lista legada e `desfechos`): UNICA_SEGURA,
AMBIGUA, SO_ATENCAO, SO_FRACA, SO_VENCIDA, DISPUTADA, SEM_CANDIDATO (+CONFIRMADA/ORFA); top-3 por título;
candidato fraco/ambíguo/disputado/vencido é exibível mas NÃO confirmável (409; vencido no débito 422).
Regra: sinal `VENCE_ANTES_DO_TITULO` + `diasVencidoNoDebito`; confirmar exige `reconheceAvisos` (422
`WarningAcknowledgementRequiredError`). Rotas: `GET /sugestoes-boleto/titulo`, filtro `situacao`, body de
confirmar. Frontend: badge, painel, `ReconhecerAvisoDialog`, filtro por situação. Sem migration (`sinais`
é JSONB). Passo 2 (I17) intocado.

## Baselines (relatados pelo AutoLoopRunner)
typecheck OK; lint 0 erros; backend 257 suites / 4809 testes; `test:sql` 20 suites / 164; frontend jest
1058 (2 suites quebram só por `@radix-ui/react-dropdown-menu` ausente no symlink); PatternGuardian 0;
SpecVerifier aprovado; DesignSystemReviewer: 3 achados de token de cor em linhas já existentes.
Medição somente leitura (PRD, 894 títulos elegíveis): com desfecho 25,5% → 100%. UNICA_SEGURA 196,
SO_ATENCAO 3, AMBIGUA 281, SO_FRACA 233, SO_VENCIDA 78, DISPUTADA 61, SEM_CANDIDATO 42.
Motor: ~0,6 s fora do jest para 1,1k títulos × 8,8k boletos.

## Fora do escopo
Confirmar ATENCAO sem âncora; escolher entre ambíguos; alargar a janela do passo 2; boleto acima/abaixo
do título; remover título vencido do lote.
