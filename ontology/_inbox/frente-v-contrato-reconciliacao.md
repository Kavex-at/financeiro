# Frente V — reconciliação das duas versões do contrato de API

> **Data:** 2026-08-19. **Status:** decidido para a F2; itens diferidos listados no §3.
>
> Duas sessões trabalharam a Frente V em paralelo e produziram **duas versões do contrato**:
>
> - **v0** — em `frente-v-aprovacoes-tasks.md`. É o que a **F1 já implementou** e o que as duas
>   metades da F2 estão construindo.
> - **v1** — em `frente-v-frontend-plan.md` §4.2, com 27 mudanças propostas sobre o v0.
>
> Este documento decide o que entra agora, o que fica para depois, e por quê.

---

## 1. O que foi ADOTADO na F2

### 1.1 `etapaAtual` determinística + `etapasAbertas`

**Problema real.** O v0 define `etapaAtual` no singular sem dizer *qual*, se houver mais de uma
pendente. Duas execuções da mesma consulta poderiam devolver aprovadores diferentes — a fila
"mudaria sozinha" aos olhos do analista.

**Decisão.** `etapaAtual` = a etapa `PENDENTE` com `recebidoEm` mais antigo; desempate por menor
`fblCod`, depois menor `ftbCod`. Acrescentado `etapasAbertas: number`, para a UI mostrar
`CONTROLLER +2` em vez de fingir que só existe uma.

**Por que não adotamos o `etapasAtuais[]` que a v1 propõe.** A justificativa da v1 é *"o probe achou
177 etapas em 148 títulos, logo etapas paralelas existem"*. Isso não se sustenta: 177 etapas em 148
títulos prova que há **várias etapas ao longo do tempo** (uma concluída + uma pendente, tipicamente),
**não** que haja duas **abertas ao mesmo tempo**. Nenhum dado da sondagem estabelece simultaneidade.

O defeito verdadeiro do v0 era a **escolha não-determinística**, e é esse que foi corrigido. Se a
simultaneidade for observada em produção, `etapasAbertas` já expõe o fato, e migrar para uma lista
vira uma adição — não uma correção.

### 1.2 Marco zero honesto

**Problema real.** `docDtaFinalizacao` não vem na projeção acessível (**PV-04**). Preencher
`dataFinalizacao` com `docDtaEmissao` seria uma mentira silenciosa exatamente no ponto em que o
cliente ancorou o aceite ("o documento foi finalizado às 10:00").

**Decisão.** O backend **não fabrica** o campo: `dataFinalizacao` fica ausente e o título carrega a
lacuna `SEM_DATA_FINALIZACAO`. O frontend rotula a coluna como **"Emissão"** e mostra
`dataEmissao` — que é outro dado, honestamente nomeado.

**Diferença para a v1.** A v1 propõe `marcoZero: { em, campo, fonte, substituto }` — um objeto com
proveniência. A intenção é a mesma e é boa; a implementação é mais cara e, enquanto o substituto for
sempre o mesmo campo, um rótulo honesto na coluna entrega o mesmo resultado ao analista. Fica no §3
para reavaliação quando **PV-07** liberar o `fin103` e o campo real aparecer.

---

## 2. O que foi ADOTADO fora do contrato

### 2.1 Paginação no servidor (achado da v1, não é mudança de contrato)

O `useTabelaFiltro` (`app/permutas/components/tabela-filtro.tsx`) filtra e pagina **em memória**:
recebe `items` inteiro e faz `filter(...)` + `slice(...)`. Serve às frentes cujas listas cabem no
cliente; **não serve à Frente V**, que tem 23.632 títulos só na filial 2 em 12 meses.

**Decisão.** A F2 usa paginação **do servidor** (o endpoint já recebe `page`/`pageSize` e devolve
`total`), reusando `FiltroBarra` e `Paginacao` como **componentes visuais** alimentados por um objeto
`TabelaFiltro<T>` montado a partir da resposta. Consistência visual sem herdar a premissa errada.

---

## 3. DIFERIDO — reavaliar depois da F2

Nenhum destes é bloqueante; todos são melhorias de nomeação ou estrutura sobre um contrato que já
funciona. Mudá-los agora invalidaria a F1 e as duas metades da F2 em voo, por ganho marginal.

| # | Proposta da v1 | Mérito | Por que esperar |
|---|----------------|--------|-----------------|
| D1 | `etapasTotais` → `etapas: { concluidas, abertas, canceladas, totalConhecido, totalEhDefinitivo }` | **Alto.** `etapasTotais` sugere um denominador planejado que o ERP não expõe; `totalConhecido` fecha essa porta | É renomeação com semântica; cabe num `/feature-tweak` barato depois que a tela existir |
| D2 | `lacunas: string[]` → `Lacuna[]` estruturada com severidade | Médio | Já temos `Lacuna` como união tipada em `constants.ts` + `LACUNA_DESCRICAO`. O ganho extra é de apresentação |
| D3 | `marcoZero` com proveniência | **Alto**, mas ver §1.2 | Reavaliar quando PV-07 trouxer `docDtaFinalizacao` — aí a proveniência passa a ter dois valores possíveis e o objeto se justifica |
| D4 | Demais 23 itens do §4.2 do `frente-v-frontend-plan.md` | variado | Revisar em bloco após a F3, com a tela na mão |

---

## 4. Nota de processo

A divergência não foi erro de ninguém: duas sessões atacaram a mesma frente e só uma tinha os spikes
0-B/0-C. O sintoma — dois contratos plausíveis para a mesma fronteira — é exatamente o que a **Onda 1**
do plano de orquestração existia para evitar, travando o contrato antes de abrir as fatias.

Lição para a próxima frente: **o contrato só está travado quando existe um único arquivo com esse
papel**, referenciado por todas as fatias. Ter um "plano de frontend" que também propõe contrato cria
duas fontes de verdade.
