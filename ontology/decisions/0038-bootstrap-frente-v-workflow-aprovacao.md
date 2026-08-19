# ADR-0038 — Bootstrap da Frente V: rastreamento do workflow de aprovação

> ## ⚠ Correção (2026-08-19) — a `fin103` não é questão de acesso
>
> Vários trechos abaixo supõem que `fin103/list` devolvia vazio por **falta de permissão de tela** e
> que "pedir acesso" tornaria a varredura 500× mais barata. **Isso está errado.** A `fin103` é a
> **fila pessoal de aprovação do usuário logado**: o vazio significa que a conta de integração não
> tem nada a aprovar. Não há acesso a pedir, e o custo de **uma chamada por título é estrutural**.
> A pendência **PV-07** foi reformulada — ver `ontology/_inbox/frente-v-pendencias-validacao.md`.


- **Status:** aceito
- **Data:** 2026-08-19
- **Contexto de origem:** pedido do Yuri (2026-08-18) + sondagem read-only em produção
- **Supersede:** nada. **Relaciona-se com:** ADR-0002 (propósito, 3 frentes), ADR-0022 (4ª frente)

---

## Contexto

A Columbia não tem visibilidade agregada sobre o **workflow de aprovação dos títulos a pagar**. A
informação existe no ERP, mas só título a título, numa aba de "Bloqueios e Liberações". Não há como
responder "quanto tempo leva uma aprovação?", "quem está segurando?", "que documentos estão parados?".

A Frente V nasce para responder isso. Numa **Fase 2**, fora deste ADR, virá o analítico (tempo médio
por fornecedor, cliente final e funcionário).

### O que a sondagem em produção revelou

Uma sonda read-only (`jobs/probe-aprovacoes-fin026.ts`, `jobs/probe-aprovacoes-trilha.ts`), rodada
com autorização explícita, mudou o entendimento em pontos que **nenhum spec OpenAPI revelaria**:

1. O workflow **não é** a escada `titVld1/2/3Libera` — essa vale `1` em 100% dos títulos, sem
   timestamps nem nomes. É vestigial.
2. O workflow **é** o bloqueio por alçada (`FinTituloBloq`), com **11 etapas distintas** na filial 2
   (CONTROLLER, TI, FISCAL, DIRETORIA II, …), duas ações (`LIBERAR`, `APROVAR`) e **14 pessoas**.
3. Os timestamps **preservam hora, minuto e segundo** — o produto pedido é viável.
4. O histórico **é retido** pelo ERP: há backfill.
5. O universo tem de vir de `psq014/list` (pesquisa), **não** de `fin026/list` (carteira corrente).
6. **~49%** dos títulos da filial 2 têm trilha; mediana de **2,5 h**, p90 de **70 h**, cauda de **234 h**.

---

## Decisão

Criar a **Frente V — Workflow de Aprovação** como vertical slice próprio (`aprovacoes`), com:

### D1 — Escopo: somente Contas a Pagar (`docTip = 2`)
Contas a receber, pedidos, contábil e importação ficam fora. É onde a dor está e onde o mecanismo
foi verificado.

### D2 — Read-only absoluto no ERP
Nenhuma escrita, em nenhuma circunstância. O port de leitura **não expõe** método de escrita — a
superfície do contrato torna a escrita inexpressável, em vez de depender de disciplina.

### D3 — Persistência própria com backfill histórico
Snapshot no nosso Postgres (`titulo_aprovacao`, `etapa_aprovacao`, `aprovacao_ingestao_run`).

> **Correção em relação ao plano inicial:** a decisão original previa *event-sourcing por diffing de
> snapshots*, porque supúnhamos que o ERP descartava a trilha ao resolver o bloqueio. **A sondagem
> provou o contrário.** Como o ERP retém o histórico e é a fonte da verdade, um **UPSERT por chave
> natural** entrega o mesmo resultado com uma fração da complexidade. Event-sourcing seria custo sem
> benefício.

### D4 — Entidades próprias, sem estender `TituloAPagar`
`TituloAprovacao` e `EtapaAprovacao` são novas. Não compartilham tabela com a carteira do SISPAG:
universos, cadências e regras são diferentes, e o doc 4156 (com trilha completa) **nem existe** na
carteira corrente.

### D5 — Fail-safe sobre dado desconhecido
`ftbVldStatus` fora de `{1, 2}` → `INDETERMINADO`, nunca `CONCLUIDA`. O valor bruto é preservado em
`status_erp` para reclassificação futura por migration, sem reingerir 23 mil títulos.

### D6 — Nenhuma duração é estimada
Sem `agidoEm`, não há duração. A ausência aparece em `lacunas[]` e na UI. "Parada há X" é campo
distinto de "durou X" e não entra em média alguma.

### D7 — Acesso ao ERP atrás de um port
`TrilhaAprovacaoGatewayInterface` + token tsyringe, no padrão da Frente IV
(`domain/interface/recebimentos/ports.ts`). Quando **PV-07** (acesso à tela `fin103`) for resolvida,
entra uma implementação nova sem tocar no job nem no serviço.

---

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
|-------------|----------------------|
| **Ler o ERP ao vivo, sem persistir** | 1 chamada por título torna o painel inutilizável (segundos por linha). E impede o analítico da Fase 2 |
| **Estender `TituloAPagar` da Frente II** | Universos diferentes (carteira corrente × histórico); herdaria regras de elegibilidade de lote irrelevantes; o doc 4156 nem aparece na carteira |
| **Event-sourcing por diffing de snapshots** | Justificava-se só se o ERP descartasse a trilha. Ele não descarta. Complexidade sem retorno |
| **Esperar o acesso ao `fin103` para começar** | O acesso é externo e sem prazo. O caminho atual funciona, e o port isola a troca |
| **Usar a escada `titVld1/2/3Libera`** | Vestigial: `1` para todos, sem timestamp nem nome. Produziria um painel dizendo que tudo está aprovado |
| **Bloquear a implementação até validar tudo com o time** | Dez pendências (PV-01..PV-10) são de negócio e têm premissa fail-safe segura. Bloquear custaria semanas por questões que não mudam a arquitetura |

---

## Consequências

### Positivas
- Diagnóstico inédito: 11 etapas, 14 aprovadores, mediana 2,5 h e cauda de 10 dias já são entregáveis.
- Backfill histórico viável — o painel nasce com dado, não vazio.
- Fase 2 fica barata: pessoa, fornecedor e filial já materializados por etapa.

### Negativas / custos aceitos
- **Ingestão cara enquanto PV-07 não sair:** 1 chamada por título, 23.632 na filial 2 em 12 meses.
  Mitigado por backfill retomável e cursor persistido.
- **Campos ausentes:** `docDtaFinalizacao` (o marco zero pedido no exemplo do cliente) e `usnCodCmd`
  (identidade estável da pessoa) não vêm na projeção acessível. Mitigado por `lacunas[]` e coluna
  nullable pronta.
- **13 etapas em `INDETERMINADO`** até PV-01 fechar. Visível, não escondido.
- O painel depende de um snapshot: a UI **precisa** expor `observadoEm` (I7).

### Pendências que este ADR NÃO resolve
Dez itens em `ontology/_inbox/frente-v-pendencias-validacao.md` (PV-01..PV-10), cada um com premissa
fail-safe registrada e ID citado no código. As de maior impacto: **PV-01** (`ftbVldStatus = 7`),
**PV-03** (semântica de `ftbTimBloq`), **PV-07** (acesso ao `fin103`).

---

## Follow-up para outra frente

`ontology/entities/titulo-a-pagar.md` (Frente II) afirma que `aprovado` deriva do AND de
`titVld1/2/3libera`. A sondagem provou que essas flags são vestigiais. O **código** usa outra fonte
(`vldLib` do `fin064`, `ConexosSispagClient.ts:150`) e está correto — a **ontologia** é que descreve
o campo errado. Corrigir em ciclo próprio da Frente II.
