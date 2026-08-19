# Frente V — Entrevista (OfficeHours, modo deep)

> **Feature slug:** `frente-v-aprovacoes` · **Branch:** `feat/frente-v-aprovacoes`
> **Data:** 2026-08-19 · **entity_changed: true**
>
> Esta entrevista foi conduzida com uma vantagem incomum: **o domínio já foi sondado contra a
> produção** (ver `frente-v-probe-resultado.md`). Por isso ela não parte do zero — parte dos fatos
> observados e foca no que ainda é ambíguo. As ambiguidades que dependem do time da Columbia estão
> em `frente-v-pendencias-validacao.md` e **não bloqueiam** a implementação: cada uma tem premissa
> fail-safe registrada.

---

## Intenção de negócio (1-2 frases)

Dar ao financeiro da Columbia visibilidade sobre **o workflow de aprovação dos títulos a pagar**:
para cada título, quem precisou aprovar, quando recebeu, quando agiu, quanto tempo levou, e em que
pé está. Hoje isso só existe título a título, numa aba do ERP, sem visão agregada nem medição.

## Exemplo concreto (caso de aceite)

Observado em produção — doc 4156, título 1, filial 1:

```
Etapa:      CONTROLLER
Alçada:     COMPRAS
Ação:       LIBERAR
Quem agiu:  DANILO_LARA
Recebeu:    2026-05-14 07:12:46 BRT
Agiu:       2026-05-15 06:41:40 BRT
Duração:    23h29m
Status:     2 (respondido)
```

## Consumidor

Painel web (Next.js) para a analista financeira, atrás de autenticação e da allow-list de filiais.
Alimentado por API própria, que lê do **nosso Postgres** — não do ERP ao vivo.

---

## Eixo 1 — Entidade

**P: O que é a unidade de informação nova?**
R: A **etapa de aprovação** de um título. Um título tem zero, uma ou várias etapas. Na amostra da
filial 2, 148 títulos geraram 177 etapas.

**P: Qual a chave natural?**
R: `(fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod)`. `fbl_cod` identifica o tipo de bloqueio
(CONTROLLER, TI, FISCAL…) e `ftb_cod` a instância dele naquele título.

**P: `titulo-a-pagar` já existe na ontologia. Estende ou cria nova?**
R: **Cria novas, sem tocar em `titulo-a-pagar`.** Três razões:

1. **Universo diferente.** `titulo-a-pagar` é a *carteira corrente* do SISPAG, ingerida do `fin064`,
   filtrada por janela de vencimento e sem títulos internacionais. A Frente V precisa do universo
   **histórico** (`psq014/list`) — o doc 4156 nem existe na carteira do SISPAG.
2. **Cadência diferente.** A carteira SISPAG roda diariamente para decidir pagamento; a trilha de
   aprovação é histórica e imutável depois de resolvida.
3. **Acoplamento indevido.** Estender `titulo-a-pagar` faria a Frente V herdar as regras de
   elegibilidade de lote (I2, I4, ADR-0021) que não têm nada a ver com aprovação.

Fica um **`titulo_aprovacao`** próprio (o cabeçalho observado) e **`etapa_aprovacao`** (a trilha).

**P: E a escada `titVld1/2/3Libera`, que a Frente II usa?**
R: **Não entra.** A sondagem provou que ela vale `1` em 100% dos títulos, sem timestamps nem nomes —
é vestigial. Registrado como follow-up para a Frente II, cuja ontologia a descreve incorretamente.

**entity_changed = true.**

---

## Eixo 2 — Ação

**P: Que ações o sistema executa?**

| Ação | Tipo | Descrição |
|------|------|-----------|
| `ingerirTrilhaAprovacao` | job + trigger manual | Varre o universo de títulos e persiste a trilha |
| `exporPainelAprovacoes` | leitura | Lista paginada com status agregado e filtros |
| `detalharTrilhaAprovacao` | leitura | Timeline de um título |

**P: Alguma escreve no ERP?**
R: **Nenhuma.** Read-only no Conexos é invariante da frente (decisão D2). A única escrita é no nosso
Postgres.

**P: Como a ingestão funciona, dado que custa 1 chamada por título?**
R: Duas fases:

- **Backfill** — primeira carga, janela configurável (12 meses por padrão, PV-08). Longo por
  natureza. Precisa ser **interrompível e retomável**: grava progresso por página e por título, e
  uma nova execução continua de onde parou em vez de recomeçar.
- **Incremental** — passadas seguintes só reprocessam títulos cuja trilha pode ter mudado.

**P: O que impede duas execuções concorrentes?**
R: `withAdvisoryLock` do `PostgreeDatabaseClient`, no mesmo padrão da Frente IV.

---

## Eixo 3 — Invariantes

| # | Invariante | Por quê |
|---|------------|---------|
| **I1** | **Zero escrita no Conexos.** Nenhum PUT, `aplicarComando`, `trocaBloqueio`, `regerarBloqueios` | Decisão D2. Uma escrita acidental num fluxo de aprovação financeira libera pagamento indevido |
| **I2** | **A ingestão é idempotente.** Reprocessar o mesmo título não duplica etapa | UPSERT por chave natural |
| **I3** | **Nenhuma duração é inventada.** Sem `ftbTimCmd`, a etapa é "pendente" e não gera duração | Painel financeiro auditável — número estimado em silêncio é pior que número ausente |
| **I4** | **Status desconhecido nunca vira aprovado.** `ftbVldStatus` fora de `{1,2}` → `INDETERMINADO` + `lacunas[]` | PV-01: há 13 etapas com status `7` |
| **I5** | **O `fil_cod` vem sempre do registro, nunca de default** | Consultar a trilha com a filial errada devolve `count: 0` **sem erro** — falso negativo mudo (observado com o doc 4156) |
| **I6** | **Etapa que some do ERP é marcada inativa, nunca apagada** | PV-06 (`regerarBloqueios`); preserva auditoria |
| **I7** | **O painel expõe o horário do snapshot** | O dado não é ao vivo; o analista precisa saber a idade dele |

---

## Eixo 4 — Integração

**Leitura do universo:** `POST psq014/list`
— filtros `filCod#EQ`, `docTip#EQ: 2` (ENTRADA A PAGAR), `docDtaEmissao#GE` (**epoch ms**).

**Leitura da trilha:** `POST fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`
— corpo `CnxListRequest` vazio basta. Equivalente: `com308/financeiroAPagar/infoTitulo/list/{docCod}/{titCod}`.

**Armadilhas confirmadas em produção:**

- Datas trafegam como **epoch ms**; string ISO é recusada (`ECnxDataType can't be converted to Date`).
- Operadores de intervalo: `#GE` `#GT` `#LE` `#LT` funcionam; **`#BETWEEN` não existe**.
- Campos `Tim*` preservam hora; campos `Dta*` são data pura.
- Grafia varia por endpoint e **não é intercambiável**: `fin026/list` usa `titVld1Libera`,
  `fin026/infoTitulo` usa `titVld1libera`. Trocar devolve 500.
- `fin103/list` exige `filCod#EQ` e hoje devolve vazio por falta de acesso (PV-07).

**Persistência:** Postgres próprio, migrations `0049+`, SQL com **parâmetros nomeados**
(`$filCod` + objeto) — o `PostgreeDatabaseClient` não aceita `$1` posicional.

**Isolamento para o futuro:** o acesso ao ERP fica atrás do port `TrilhaAprovacaoGatewayInterface`.
Quando PV-07 for resolvido, entra uma implementação `fin103` no lugar da atual sem tocar no job.

---

## Fora de escopo (explícito)

- Qualquer escrita no ERP (aprovar/liberar pelo painel).
- Contas a receber (`docTip = 1`), pedidos, contábil.
- **Fase 2 — analítico** (tempo médio por fornecedor/cliente/funcionário). O schema é desenhado para
  suportá-lo, mas nenhuma tela ou endpoint de agregação é entregue agora.
- Notificação/cobrança de aprovadores parados.

---

## Pendências que não bloqueiam

Dez itens em `frente-v-pendencias-validacao.md` (PV-01 a PV-10), cada um com premissa fail-safe
adotada no código e citado por ID nos comentários. Os que mais mexem no comportamento visível:
**PV-01** (`ftbVldStatus = 7`), **PV-03** (semântica de `ftbTimBloq`) e **PV-07** (acesso ao `fin103`).
