---
name: detalharTrilhaAprovacao
type: action
entity: EtapaAprovacao
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/aprovacoes/AprovacoesPainelService.ts
  - src/backend/domain/service/aprovacoes/DuracaoCalculator.ts
  - src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts
  - src/backend/domain/repository/aprovacoes/EtapaAprovacaoRepository.ts
  - src/backend/domain/errors/AprovacaoIdInvalidoError.ts
  - src/backend/routes/aprovacoes.ts
  - src/frontend/lib/aprovacoes.ts
  - src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx
last_review: 2026-08-19
preconditions:
  - "Requisição autenticada; `aprovacoesEnabled` ligado (`aprovacoesGate`)."
  - "`id` no formato `${filCod}:${docCod}:${titCod}` — validado por regex Zod na rota E revalidado por `parseId` no serviço."
  - "Título presente no snapshot local; a ação nunca consulta o ERP."
postconditions:
  - "Devolve `{ cabecalho, etapas, lacunas, snapshotEm }` — a timeline completa de UM título, só com as etapas `ativo = true`."
  - "`snapshotEm` é o `observado_em` DESTE título, não o `MAX` da tabela."
  - "Título inexistente OU em filial fora da allow-list devolve o MESMO 404."
  - "Nenhuma escrita: nem no ERP, nem no Postgres."
side_effects:
  - "Uma leitura do título com sua trilha (`findById`)."
  - "`id` malformado lança `AprovacaoIdInvalidoError`; a regex da rota já barra a maior parte dos casos antes disso (400)."
---

# detalharTrilhaAprovacao — a timeline de um título

> **Vigência:** 2026-08-19 (ADR-0038). `GET /aprovacoes/:id/trilha` devolve a trilha completa de um
> título: cada etapa com quem, quando recebeu, quando agiu, quanto levou e o que o ERP registrou. É a
> tela onde o caso canônico do cliente é respondido linha a linha. Leitura pura sobre o snapshot
> local.

## Superfície

```
GET /aprovacoes/{filCod}:{docCod}:{titCod}/trilha
```

Resposta:

```jsonc
{
  "cabecalho": { /* o mesmo AprovacaoListItem do grid */ },
  "etapas": [
    {
      "fblCod": 6, "ftbCod": 1,
      "nome": "CONTROLLER", "alcada": "COMPRAS", "acao": "LIBERAR",
      "responsavelNome": "DANILO_LARA", "responsavelCod": null,
      "status": "CONCLUIDA", "statusErp": 2,
      "recebidoEm": "…", "agidoEm": "…",
      "duracaoSegundos": 84534, "paradaHaSegundos": null,
      "observacao": null
    }
  ],
  "lacunas": ["SEM_DATA_FINALIZACAO"],
  "snapshotEm": "…"
}
```

O cabeçalho é **o mesmo objeto** que o grid devolve, montado pelo mesmo código. Se o drawer mostrasse
um status ou um tempo diferente do da linha que o abriu, o analista teria razão em desconfiar dos dois.

## O `id` é validado duas vezes, de propósito

1. **Na rota:** regex Zod `^\d+:\d+:\d+$`.
2. **No serviço:** `parseId` reparte, exige `^\d+$` em cada parte e recusa o que não for inteiro
   seguro e positivo.

A segunda barreira não é redundância cerimonial. `Number('')` é `0` e `Number('x')` é `NaN` — ambos
viram, **sem erro nenhum**, uma consulta que não casa com linha alguma e devolve "não encontrado". Um
404 por id inválido e um 404 por título inexistente são bugs de naturezas opostas, e um `Number()`
silencioso apaga a diferença. `'+1'`, `' 1 '`, `'1.0'` e `'1e3'` são **recusados**, não normalizados.

`parseId` também é público porque `montarId` é seu inverso e o par tem de ser testado junto: o id do
contrato é a única identidade que o frontend conhece.

## 404 para filial não autorizada — e não 403

Título inexistente e título em filial fora da allow-list devolvem a **mesma** resposta.

Responder 403 no segundo caso **confirmaria a existência** do título a quem não tem acesso a ele: um
usuário poderia varrer ids e mapear quais documentos existem em filiais que não pode ver, só pela
diferença entre os códigos de status. A indistinção é a proteção.

> Detalhe de implementação a conhecer: a rota passa `filCodsPermitidos: filiaisPermitidas(req.user)`.
> Quando o JWT **não** carrega a claim `filiais` — situação de hoje —, o valor é indefinido e nenhuma
> restrição por filial é aplicada nesta rota. Isso é **consistente** com o grid, cujo fallback é "todas
> as filiais do ERP"; quando a claim for provisionada, as duas superfícies passam a restringir juntas.
> Premissa registrada em **PV-09**.

## Só etapas ativas na tela, todas no banco

A timeline mostra apenas `ativo = true`. Etapas desativadas — porque sumiram do ERP, tipicamente após
`regerarBloqueios` (**PV-06**) — **permanecem no banco** com o último status conhecido.

Mostrar as duas trilhas misturadas confundiria o analista: ele veria a mesma alçada duas vezes, com
tempos diferentes, sem nada explicando qual vale. Apagá-las destruiria a auditoria de que aquilo
chegou a acontecer. Guardar e não exibir é a única opção que preserva as duas necessidades.

## Ordenação: o mesmo critério total do grid

`recebidoEm` crescente; empate por menor `fblCod`, depois menor `ftbCod`; etapa sem `recebidoEm` no
fim. É **o mesmo comparador** que escolhe a `etapaAtual` no grid — deliberadamente, para que a
primeira pendente da timeline seja exatamente a etapa que a linha do grid apontou como atual.

## `duracaoSegundos` vem do banco, `paradaHaSegundos` é recalculado

| Campo | Origem | Por quê |
|-------|--------|---------|
| `duracaoSegundos` | gravado pela ingestão | É um **fato fechado**: `agidoEm − recebidoEm` não muda mais. Recalcular seria recomputar uma constante |
| `paradaHaSegundos` | recalculado contra `agora` | É uma **espera em curso**, cresce a cada leitura. O valor do banco estaria velho desde o instante em que foi gravado |

Só isso já resume a regra de [duração](../../business-rules/duracao-etapa-aprovacao.md): o painel
mistura um número imutável com um número vivo, e eles **não podem** ser somados nem confundidos.

## `snapshotEm` aqui é diferente do snapshot do grid

No grid, `snapshotEm` é `MAX(observado_em)` da tabela — "quão fresco está o painel como um todo".

No detalhe, é o `observado_em` **deste título**. Aqui sabemos exatamente quando este dado foi lido, e
essa é a idade que importa para quem está olhando uma trilha específica. Num backfill parcial, os dois
números podem estar a dias de distância, e usar o máximo global no detalhe faria um registro antigo
parecer recém-observado.

## Campos que hoje chegam vazios (e por quê)

| Campo | Estado | Pendência |
|-------|--------|-----------|
| `responsavelCod` | sempre ausente | `usnCodCmd` não vem na projeção acessível — a identidade da pessoa é o nome (**PV-10**) |
| `cabecalho.dataFinalizacao` | sempre ausente | `docDtaFinalizacao` idem; lacuna `SEM_DATA_FINALIZACAO` (**PV-04**/**PV-07**) |
| `statusErp = 7` | preservado bruto, status `INDETERMINADO` | significado desconhecido (**PV-01**) — 13 ocorrências reais |
| `acao` | `LIBERAR` ou `APROVAR`, exibido cru | diferença de negócio entre as duas em aberto (**PV-02**) |

Nenhum deles é preenchido por inferência. O `statusErp` bruto viaja até a UI justamente para que o
analista possa dizer "esse 7 é X" e a pendência feche com uma migration sobre `status_erp`, sem
reingerir 23 mil títulos.

## Por que está na ontologia (universalidade)

Universal: depois de ver **que** um título está parado, a pergunta seguinte é sempre **onde** e **com
quem** — a trilha é a resposta, e é o artefato que sustenta uma conversa com o aprovador. A estrutura
(timeline ordenada por critério total, ativas na tela e inativas na auditoria, fato fechado separado
de espera em curso, idade do próprio registro, valor bruto do ERP preservado) é do domínio.
Configuração do tenant: quais campos da etapa a tela mostra e como os rotula.
