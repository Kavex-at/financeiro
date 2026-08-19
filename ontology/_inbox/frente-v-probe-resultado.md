# Frente V — Resultado do probe (Onda 0.5)

> ## ⚠ Correção (2026-08-19) — a `fin103` não é questão de acesso
>
> Vários trechos abaixo supõem que `fin103/list` devolvia vazio por **falta de permissão de tela** e
> que "pedir acesso" tornaria a varredura 500× mais barata. **Isso está errado.** A `fin103` é a
> **fila pessoal de aprovação do usuário logado**: o vazio significa que a conta de integração não
> tem nada a aprovar. Não há acesso a pedir, e o custo de **uma chamada por título é estrutural**.
> A pendência **PV-07** foi reformulada — ver `ontology/_inbox/frente-v-pendencias-validacao.md`.


> **Scripts:** `src/backend/jobs/probe-aprovacoes-fin026.ts` e `probe-aprovacoes-trilha.ts`
> (somente leitura, guarda `PROBE_ALLOW_PRD`).
> **Ambientes:** `columbiatrading-hml` (filiais 1/2/3) e **produção** (filiais 1/2/3), esta última
> com autorização explícita do Yuri em 2026-08-18.
> **Escritas realizadas: nenhuma.**
> Evidência bruta em `C:/tmp/probe-aprov-prd*`, `C:/tmp/probe-trilha*`, `C:/tmp/probe-survey-fil2`.

---

## 0. Veredito

**A Frente V é viável, o dado é rico, e há backfill histórico.**

O workflow de aprovação da Columbia está inteiramente legível por API, com etapa, alçada, ação,
**pessoa** e timestamps com hora. Exemplo real (doc 4156/1, filial 1):

```
CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA · status 2 (respondido)
  recebeu (ftbTimBloq): 2026-05-14 07:12:46 BRT
  liberou (ftbTimCmd):  2026-05-15 06:41:40 BRT
  → 23h29m
```

Isso é exatamente o formato pedido pelo cliente.

---

## ⚠ 1. Correção de duas conclusões anteriores deste documento

Uma rodada anterior deste probe concluiu que (a) o workflow era raríssimo (3 títulos em toda a
produção) e (b) o ERP descartava a trilha ao resolver o bloqueio, o que impediria backfill. **As duas
conclusões estavam erradas**, e o Yuri as derrubou ao encontrar a trilha completa de uma nota antiga
na tela `PSQ_027`.

O erro foi de **método**, não de leitura: a varredura usou `fin026/list`, que projeta a **carteira
corrente** de títulos, e mediu apenas os que estão **bloqueados agora** (`vldIsBloqueado = 1`). Um
título já liberado sai desse recorte — mas a trilha dele continua gravada.

| Conclusão anterior | Status | Realidade |
|---|---|---|
| "3 títulos com workflow em toda a produção" | ❌ **errada** | Eram 3 títulos **pendentes agora**. Na amostra da filial 2, **49,3% dos títulos têm trilha** |
| "O ERP descarta a trilha; painel nasce vazio, sem backfill" | ❌ **errada** | A trilha é **retida** e legível por API. **Backfill é possível** |
| "`aprovador` é setor, então Fase 2 por funcionário é inviável" | ⚠ **parcial** | `aprovador` é o rótulo da alçada (às vezes setor, às vezes pessoa), mas **`usnDesNomeCmd` traz a pessoa**. Fase 2 por funcionário **é viável** |

**Lição para o desenho:** o universo de títulos da Frente V vem de **`psq014/list`** (tela de
pesquisa, cobre o histórico), **não** de `fin026/list` (carteira corrente). O doc 4156 é a prova:
existe no `psq014` e não aparece no `fin026`.

---

## 2. Situação real das liberações na filial 2

Amostra de **300 títulos** a pagar (`psq014/list`, `filCod=2`, `docTip=2`, emissão desde 2025-08-01;
universo total no ERP: **23.632 títulos**). Cada título detalhado via
`fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`.

> ⚠ A amostra é a **primeira página** do `psq014/list`, não uma amostra aleatória. Serve para
> dimensionar e caracterizar; não é estimativa estatística com intervalo de confiança.

### Cobertura

| Métrica | Valor |
|---|---|
| Títulos amostrados | 300 |
| **Com trilha de aprovação** | **148 (49,3%)** |
| Etapas encontradas | 177 (169 resolvidas + 8 pendentes) |
| Títulos com mais de uma etapa | ~29 (177 etapas em 148 títulos) |

### Etapas de aprovação existentes (`fblDesNome`)

| Etapa | Ocorrências |
|---|---|
| CONTROLLER | 105 |
| TI | 22 |
| WALTER | 14 |
| DIRETORIA II | 7 |
| COMERCIAL/MARKETING | 7 |
| FISCAL | 6 |
| OPERACIONAL | 6 |
| COORDENADOR FISCAL | 4 |
| FINANCEIRO | 3 |
| DIRETOR DE NEGOCIOS - PRICING | 2 |
| RECURSOS HUMANOS | 1 |

**São 11 etapas distintas** — o workflow é bem mais rico do que um fluxo único. `CONTROLLER`
domina (59%), mas há trilhas por área.

### Ações (`fbaDesNome`)

| Ação | Ocorrências |
|---|---|
| LIBERAR | 122 |
| APROVAR | 34 |
| _(vazio — etapa sem ação tomada)_ | 21 |

**São duas ações distintas**, não uma. A ontologia precisa distinguir `LIBERAR` de `APROVAR`.

### Status (`ftbVldStatus`) — a legenda que faltava

| Valor | Ocorrências | Leitura inferida |
|---|---|---|
| `2` | 156 | **respondido/resolvido** — bate com o "Respondido" que o Yuri viu na tela |
| `7` | 13 | **desconhecido** — precisa de confirmação |
| `1` | 8 | **pendente** (nos pendentes, `ftbTimCmd == ftbTimBloq`) |

> `ftbVldStatus = 7` (13 casos) é a única lacuna de legenda que sobra. Confirmar com a analista ou
> pela tela.

### Aprovadores — a pessoa que agiu (`usnDesNomeCmd`)

| Pessoa | Etapas |
|---|---|
| DANILO_LARA | 85 |
| WALTER_CROCE | 26 |
| LUIZ_PRADO | 13 |
| RICARDO_PRADO | 8 |
| DANIEL_ROCHA | 7 |
| ANA_BARCELLOS | 7 |
| MARIANE_FIGA | 6 |
| ANNE_BARRETO | 5 |
| ELAINE_FERNANDES | 4 |
| MARIAJOANA_ROSA | 3 |
| ROGERIO_MELONI | 2 |
| ESTELA_DIAS, TATIANE_BARBOSA, LILIAN_SANTOS | 1 cada |
| _(vazio — etapa pendente)_ | 8 |

**14 pessoas identificadas.** DANILO_LARA responde por 48% das etapas resolvidas — é o gargalo
natural a observar no painel.

### Alçada / rótulo do aprovador (`aprovador`)

| Rótulo | Etapas |
|---|---|
| COMPRAS | 127 |
| RICARDO DO PRADO | 22 |
| WALTER CROCE | 7 |
| FISCAL | 5 |
| COMERCIAL | 5 |
| MARIA JOANA NASCIMENTO DOS ANJOS ROSA | 4 |
| ELAINE FERNANDES DA SILVA | 1 |
| ESTELA LIRA DIAS | 1 |

**O campo mistura setor e pessoa.** É um rótulo de alçada, não uma identidade. Para o analítico da
Fase 2, a chave de pessoa é **`usnDesNomeCmd`** (e idealmente `usnCodCmd`, que não vem nesta
projeção — ver §4).

### ⏱ Tempo de aprovação — a métrica-produto, já calculável

Sobre 169 etapas resolvidas, `ftbTimCmd − ftbTimBloq`:

| Métrica | Valor |
|---|---|
| Média | **20,4 h** |
| Mediana (p50) | **2,5 h** |
| p90 | **70 h** |
| Mínimo | ~0 h |
| Máximo | **234,4 h** (≈ 9,8 dias) |

A distribuição é fortemente assimétrica: metade das aprovações sai em **2,5 horas**, mas a cauda
chega a **10 dias**. É precisamente o tipo de dispersão que justifica o painel — a média sozinha
(20,4 h) esconde o problema.

---

## 3. Como ler a trilha (contrato confirmado em produção)

**Universo:** `POST psq014/list` — filtros `filCod#EQ`, `docTip#EQ` (2 = a pagar),
`docDtaEmissao#GE` (epoch ms).

**Trilha de um título:** `POST fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`
(corpo `CnxListRequest` vazio basta). `com308/financeiroAPagar/infoTitulo/list/{docCod}/{titCod}`
devolve **exatamente o mesmo**.

Campos preenchidos numa etapa resolvida:

| Campo | Exemplo | Papel na Frente V |
|---|---|---|
| `fblCod` / `ftbCod` | 6 / 1 | chave da etapa |
| `fblDesNome` | `CONTROLLER` | **nome da etapa** |
| `aprovador` | `COMPRAS` | rótulo da alçada |
| `fbaDesNome` | `LIBERAR` | **ação tomada** |
| `usnDesNomeCmd` | `DANILO_LARA` | **quem agiu** |
| `ftbVldStatus` | `2` | situação da etapa |
| `ftbTimBloq` | 2026-05-14 07:12:46 BRT | **etapa criada / recebida** |
| `ftbTimCmd` | 2026-05-15 06:41:40 BRT | **ação aplicada** |

⚠ **Cuidado com falso negativo silencioso:** consultar a trilha com o `filCod` errado devolve
`count: 0` **sem erro**. O doc 4156 mora na filial 1; consultá-lo como filial 2 retorna vazio. O
`filCod` tem de vir do próprio registro, nunca de um default.

### O que NÃO vem nesta projeção

`docDtaFinalizacao` (o marco zero do relógio), `usnCodCmd` (código estável da pessoa), `acdCod`,
`wffUuid`, `fbaVldAcao`, `motCodCanc`. O schema `FinTituloBloq` declara todos — quem os projeta é,
provavelmente, o `fin103/list`, ao qual não temos acesso (§4).

**Impacto prático:** sem `docDtaFinalizacao`, o "documento finalizado às 10:00" do exemplo do cliente
precisa vir de outro campo (`psq014/list` traz `docDtaEmissao` e `usnDesNomeFimDoc`) ou do `fin103`.
Sem `usnCodCmd`, a identidade da pessoa é o **nome** — frágil para o analítico da Fase 2.

---

## 4. ⚠ Pré-requisito operacional: acesso à tela `fin103`

`POST fin103/list` devolve `count = 0` em **todas as filiais, em produção e homologação**, mesmo
havendo títulos bloqueados. O spec do Conexos explica: o usuário precisa ser *"liberado para a
empresa (filial) e a **tela** onde a API está relacionada"*. Nosso usuário de API não tem `fin103`.

**Por que vale pedir** — o acesso resolve três coisas de uma vez:

1. **Custo da ingestão.** Hoje é **1 chamada por título** (23.632 títulos só na filial 2, 12 meses).
   Com o `fin103/list` seria uma varredura paginada — duas ordens de grandeza mais barata.
2. **Campos que faltam** (`docDtaFinalizacao`, `usnCodCmd`, `acdCod`, `wffUuid`).
3. **Legendas dos enums**, via `configList` do endpoint de log da tela.

**Ação:** pedir ao administrador do Conexos da Columbia a liberação do usuário de integração para
**`fin103`** (e, se formos ler configuração de alçadas, `fin102` e `fin106`).

`psq027` — a tela onde o Yuri viu a trilha — **existe** (responde 405, não 404) mas não aceita `POST`
nos paths testados. Não é necessária: o `fin026/infoTitulo/list` já entrega o mesmo dado.

---

## 5. Outros achados técnicos confirmados

- **Timestamps:** epoch em milissegundos. Campos `Tim*` **preservam hora/minuto/segundo**; campos
  `Dta*` são data pura (meia-noite). O `configList` confirma: `titTim1Libera → DATETIME`,
  `titDtaVencimento → DATE`.
- **Filtro por intervalo de data existe:** `#GE` `#GT` `#LE` `#LT` funcionam **com epoch ms**.
  `#BETWEEN` **não existe**. String ISO é recusada (`ECnxDataType can't be converted to Date`).
- **`fin103/list` exige `filCod#EQ`** — sem filtro, ou só com `docTip#EQ`, devolve 400.
- **`psq014/infoTitulo/list` exige** os filtros `fExibirPrevisao` e `fExibirRenegociados`.
- **Grafia varia por endpoint e não é intercambiável:** `fin026/list` usa `titVld1Libera`
  (L maiúsculo); `fin026/infoTitulo` usa `titVld1libera` (minúsculo). Trocar devolve 500.
- **`fin026/log`** é auditoria de verdade (`logList`), mas veio **vazia** em todos os títulos —
  não serve como fonte da trilha. O `configList` da mesma resposta traz as legendas dos enums.
- **A escada `titVld1/2/3Libera` é vestigial:** vale 1 em 100% dos títulos, sem timestamps nem
  nomes. **`titVldNLibera = 1` não significa "o nível N aprovou".**

> **Follow-up fora desta frente:** `ontology/entities/titulo-a-pagar.md` afirma que `aprovado` deriva
> do AND de `titVld1/2/3libera`. Isso descreve errado o campo. O código usa outra fonte
> (`vldLib` do `fin064`, `src/backend/domain/client/ConexosSispagClient.ts:150`), então o
> comportamento está correto — mas a ontologia da Frente II precisa de correção.

---

## 6. Perguntas P0 — situação

| # | Pergunta | Situação |
|---|---|---|
| 1 | Legendas de `ftbVldStatus` | ✅ `1`=pendente, `2`=respondido. ⏳ **falta `7`** (13 casos) |
| 2 | Os timestamps preservam a hora? | ✅ **sim** |
| 3 | `ftbTimBloq` = "quando o aprovador recebeu"? | ⚠ plausível e consistente (nos pendentes `ftbTimCmd == ftbTimBloq`); **confirmar com a analista** |
| 4 | A Columbia usa alçadas ou a escada de 3 níveis? | ✅ **bloqueios nomeados** — 11 etapas distintas. A escada é vestigial |
| 5 | Aprovação por e-mail conta como etapa? | ⏳ analista |
| 6 | `regerarBloqueios` é usado? | ⏳ analista |
| 7 | O que `titVldNLibera = 1` significa? | ✅ **não é "aprovado"** |
| 8 | `aprovador` é setor ou pessoa? | ✅ **mistura os dois**; a identidade da pessoa é `usnDesNomeCmd` |
| 9 | O workflow é pouco usado? | ✅ **não** — ~49% dos títulos têm trilha |
| **10 (novo)** | **`LIBERAR` vs `APROVAR` — qual a diferença de negócio?** | ⏳ analista |
| **11 (novo)** | **Qual campo é o "documento finalizado" do exemplo do cliente?** | ⏳ `docDtaFinalizacao` não vem na projeção; candidatos: `docDtaEmissao`, `usnDesNomeFimDoc` (psq014) |

---

## 7. Recomendações

1. **Pedir hoje** o acesso do usuário de API à tela `fin103`. É o item de maior prazo, não depende de
   nós, e derruba o custo da ingestão em duas ordens de grandeza.
2. **Seguir para a Onda 1.** O desenho está destravado: a trilha é legível, tem hora, tem pessoa, e
   tem backfill.
3. **Levar à analista** as perguntas 3, 5, 6, 10 e 11 — e mostrar os números do §2, que já são um
   diagnóstico entregável por si só (11 etapas, 14 aprovadores, mediana 2,5 h, cauda de 10 dias).
4. **Dimensionar o backfill** antes de codar a F1: 23.632 títulos × 1 chamada na filial 2, 12 meses.
   Com `fin103` liberado, isso vira paginação. Sem ele, é um job de backfill longo, com rate-limit e
   retomada — desenhar para ser interrompível.
