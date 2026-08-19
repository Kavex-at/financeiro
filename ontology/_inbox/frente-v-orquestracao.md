# Frente V — Workflow de Aprovação · Plano de Orquestração

> ## ⚠ Correção (2026-08-19) — a `fin103` não é questão de acesso
>
> Vários trechos abaixo supõem que `fin103/list` devolvia vazio por **falta de permissão de tela** e
> que "pedir acesso" tornaria a varredura 500× mais barata. **Isso está errado.** A `fin103` é a
> **fila pessoal de aprovação do usuário logado**: o vazio significa que a conta de integração não
> tem nada a aprovar. Não há acesso a pedir, e o custo de **uma chamada por título é estrutural**.
> A pendência **PV-07** foi reformulada — ver `ontology/_inbox/frente-v-pendencias-validacao.md`.


> **Status:** rascunho de orquestração (Onda 0 em execução).
> **Data:** 2026-08-18.
> **Escopo deste doc:** como vamos construir a Frente V — sequenciamento, paralelismo, gates,
> contratos de fronteira e os prompts prontos para as sessões filhas. Não é spec de domínio
> (isso é do `frente-v-ontologia-rascunho.md`) nem spec técnica (é dos outros spikes).

---

## 1. O que é a Frente V

Painel de **rastreamento do workflow de aprovação** dos títulos. Para cada documento/título,
responder com precisão auditável:

- Quando o documento foi **finalizado** (marco zero do relógio).
- Quais **etapas de aprovação** existem — ou que **não existe workflow nenhum**.
- Quem **recebeu** cada etapa e **quando**.
- Quem **aprovou/rejeitou** e **quando**.
- **Quanto tempo** cada pessoa levou, e há quanto tempo a etapa atual está parada.
- **Status agregado**: sem WF / aguardando N aprovações / aprovado / rejeitado.

Exemplo canônico do cliente (usar como caso de teste de aceite):

> "O documento 123 foi finalizado às 10:00 de 18/08; o Fulano recebeu o WF de aprovação às 18:09
> desse mesmo dia e aprovou às 10:00 do dia 19/08."

**Fase 2 (fora de escopo agora, mas o modelo precisa suportar):** analítico — tempo médio de
aprovação por fornecedor, por cliente final, por funcionário.

---

## 2. Decisões travadas (Yuri, 2026-08-18)

| # | Decisão | Escolha | Consequência |
|---|---------|---------|--------------|
| D1 | Universo de documentos | **Somente Contas a Pagar** | Integra `fin026` / `com308` / `fin103` / `fin106`. Contas a Receber e pedidos ficam fora. |
| D2 | Postura da ferramenta | **Somente leitura / track** | Zero escrita no ERP na Fase 1. Dispensa gates de write-back, alçada e homologação de escrita. |
| D3 | Histórico | **Snapshot periódico + eventos derivados no nosso Postgres** | Habilita medir duração de etapa mesmo se o ERP só expuser estado atual; habilita a Fase 2 de graça. Cria job de ingestão + migrations. |
| D4 | Fatiamento | **3 fatias em paralelo** | Exige o **contrato de API travado antes** de abrir as fatias (ver §5). |

---

## 3. Descoberta que ancora tudo

O workflow de aprovação da Columbia **não é um módulo "workflow"** no Conexos — ele é implementado
como **bloqueio de título por alçada**. A peça central é o schema `FinTituloBloq`
(`docs/conexos-api/090-fin0.json`, também em `100-fin1.json`, `070-com3.json`, `190-psq0.json`):

| Campo | Significado | Uso na Frente V |
|-------|-------------|-----------------|
| `wffUuid` | UUID do workflow | correlaciona etapas de uma mesma trilha |
| `aprovador` | nome do aprovador | ator da etapa |
| `acdCod`, `alcadaUsuario`, `limitaAlcada` | alçada | regra de quem pode aprovar |
| `fblCod` / `ftbCod` / `fbaCod` | bloqueio / bloqueio-do-título / ação | chave natural da etapa |
| `docDtaFinalizacao` | data/hora de finalização do documento | **marco zero do relógio** |
| `ftbTimBloq` | data do bloqueio | criação da etapa |
| `ftbTimCmd` | hora de aplicação do comando | ação do aprovador |
| `usnCodCmd` / `usnDesNomeCmd` | usuário do comando | quem agiu |
| `fbaVldAcao` | ação do comando | aprovou / liberou / cancelou |
| `ftbVldStatus` | situação do bloqueio | status da etapa |
| `fbaVldRespProcesso` | 0-ALÇADA / 1-ÚNICO / 2-MESMO GESTOR / 3-OUTRO GESTOR | tipo de responsabilidade |
| `titDtaLibera`, `titVldBloq`, `possuiDependencia` | liberação, bloqueado, dependência | status agregado |

### 3.1 Segundo mecanismo: a escada de 3 liberações (descoberto no spike)

Além da fila de bloqueios, o Conexos grava **no próprio título** uma escada fixa de três liberações,
com ator e timestamp por nível — `titVld1/2/3Libera`, `titTim1/2/3Libera`, `usnDesNome1/2/3Lib`,
observação (`titLngNobslibera`) e cancelamento (`titUsnNclib`/`titTimNclib`). Essa trilha é
**durável**: vive no registro do título, não numa linha transitória de bloqueio.

### 3.2 Endpoints que sustentam a Fase 1

| # | Endpoint | Papel |
|---|----------|-------|
| E1 | `POST /api/fin026/list` → `FinTituloFin026` | **grid pronto**: título + escada de 3 liberações, em massa e paginado |
| E2 | `POST /api/fin103/list` → `FinTituloBloq` | **fila de aprovação** em massa: bloqueios, alçadas, `docDtaFinalizacao`, `ftbTimBloq` |
| E4 | `GET /api/fin026/infoTitulo/{filCod}/{docTip}/{docCod}/{titCod}` | escada completa com observações e cancelamentos |
| E5 | `POST /api/fin026/infoTitulo/list/{...}` | todas as etapas de bloqueio de um título |

Join E1 ⋈ E2 por `filCod` + `docTip` + `docCod` + `titCod`. Filtro do escopo: `docTip#EQ: 2`
(1 = SAÍDA A RECEBER, 2 = ENTRADA A PAGAR).

> **Risco #1 ELIMINADO.** Havia a suspeita de que só existissem endpoints "por título", o que tornaria
> a ingestão cara. Falso: `fin026/list` e `fin103/list` são listagens em massa, filtráveis e paginadas.
> Duas chamadas paginadas por filial cobrem o painel inteiro. Detalhes em
> `frente-v-aprovacoes-conexos-spike.md`.

---

## 4. Ondas de trabalho

```
ONDA 0 — Reconhecimento estático (specs + código)
   S1 API Conexos de bloqueio/alçada  -> frente-v-aprovacoes-conexos-spike.md   [CONCLUÍDO]
   S2 Anatomia do vertical slice      -> frente-v-anatomia-slice.md             [CONCLUÍDO]
   S3 Rascunho de ontologia + ADR     -> frente-v-ontologia-rascunho.md         [pendente]
   S4 Plano de frontend + contrato    -> frente-v-frontend-plan.md              [pendente]
   S5 Persistência e histórico        -> ABSORVIDO pela Onda 0.5 + fatia F1
      (o desenho de schema depende do que o probe responder; fazê-lo antes seria chute)
        |
        v
ONDA 0.5 — PROBE  [CONCLUIDO: HML + PRODUCAO]  -> frente-v-probe-resultado.md
   A trilha e legivel, tem HORA, tem PESSOA e tem BACKFILL. Exemplo real (doc 4156/1, fil 1):
     CONTROLLER . COMPRAS . LIBERAR . DANILO_LARA . status 2
     recebeu 2026-05-14 07:12:46 -> liberou 2026-05-15 06:41:40  (23h29m)
   Filial 2, amostra de 300 titulos (universo 23.632): 49,3% tem trilha; 11 etapas distintas;
   14 aprovadores; mediana 2,5h, p90 70h, max 234h.
   UNIVERSO CERTO e psq014/list (pesquisa), NAO fin026/list (carteira corrente).
   PENDENTE: acesso do usuario de API a tela fin103 -> hoje a ingestao custa 1 chamada por titulo.
ONDA 1 — Convergência (sessão única, humano no loop)  ... BLOQUEIA A ONDA 2
   1a. Consolidar spikes -> perguntas P0 para o analista da Columbia
   1b. /feature-new (interview) -> OfficeHoursInterviewer, modo deep
   1c. OntologyCurator -> diff aprovado + ADR de bootstrap da Frente V
   1d. **TRAVAR O CONTRATO DE API** (§5) — artefato que destrava o paralelismo
   1e. TaskScoper -> 3 tasks.md, um por fatia
        |
        v
ONDA 2 — Implementação (3 worktrees em paralelo)  ....... PARALELO REAL
   F1 Ingestão + modelo   (migrations, job, repository, serviço de trilha)
   F2 API + grid          (endpoints REST, painel lista, filtros)
   F3 Timeline de detalhe (endpoint de trilha, drawer/timeline, durações)
        |
        v
ONDA 3 — Integração e entrega (sessão única)
   3a. Merge das 3 fatias em ordem F1 -> F2 -> F3
   3b. /regis-review de escopo (backend + frontend) — P0 remediados, P1-P3 no inbox
   3c. Roteiro de QA em tenant dev + validação do caso canônico (§1)
   3d. Rebase em main -> bump de versão (FE+BE lockstep) -> PR
```

### Por que a Onda 1 é serializada

As três fatias compartilham dois artefatos: o **modelo de domínio** (nomes de entidades, status,
transições) e o **contrato de API**. Se abrirmos as fatias antes de travá-los, os três worktrees
divergem e o merge da Onda 3 vira retrabalho. A Onda 1 é curta — uma entrevista e um diff de
ontologia — e paga por si.

---

## 5. Contrato de fronteira (a travar na Onda 1)

Proposta **v0** — a ser ratificada/corrigida com os resultados de S1, S4 e S5. Regra de ouro:
**todo campo derivado é calculado no backend**, nunca no frontend, para que o analítico da Fase 2
use exatamente os mesmos números do painel.

```ts
// GET /aprovacoes  — lista paginada de títulos a pagar com seu status de WF
type StatusWorkflow =
    | 'SEM_WORKFLOW'      // documento finalizado, nenhuma etapa de aprovação existe
    | 'AGUARDANDO'        // há pelo menos uma etapa pendente
    | 'APROVADO'          // todas as etapas concluídas com aprovação
    | 'REJEITADO'         // alguma etapa terminou em recusa/cancelamento
    | 'INDETERMINADO';    // dados insuficientes no ERP (sempre explicitar, nunca inventar)

interface AprovacaoListItem {
    id: string;                        // chave natural opaca: filCod:docTip:docCod:titCod
    filCod: number;
    documentoNumero: string;
    tituloNumero: string;
    fornecedorNome: string;
    fornecedorCod: number;
    valor: number;
    moeda: string;
    dataVencimento: string | null;     // ISO 8601
    dataFinalizacao: string | null;    // ISO 8601 — marco zero do relógio
    statusWorkflow: StatusWorkflow;
    etapasConcluidas: number;
    etapasTotais: number | null;       // null quando o ERP não permite saber o total
    etapaAtual: {
        nome: string;
        aprovador: string | null;
        desdeEm: string | null;        // ISO 8601
        paradaHaSegundos: number | null;
    } | null;
    tempoTotalDecorridoSegundos: number | null; // de dataFinalizacao até conclusão ou agora
}

interface AprovacoesListResponse {
    items: AprovacaoListItem[];
    page: number;
    pageSize: number;
    total: number;
    snapshotEm: string;                // ISO 8601 — quando o job ingeriu por último
}

// GET /aprovacoes/:id/trilha  — timeline completa de um título
type TipoEventoTrilha =
    | 'DOCUMENTO_FINALIZADO'
    | 'ETAPA_CRIADA'
    | 'ETAPA_ATRIBUIDA'
    | 'ETAPA_APROVADA'
    | 'ETAPA_REJEITADA'
    | 'ETAPA_CANCELADA'
    | 'WORKFLOW_REGERADO'
    | 'TITULO_LIBERADO';

interface EventoTrilha {
    tipo: TipoEventoTrilha;
    ocorridoEm: string;                // ISO 8601, America/Sao_Paulo
    ator: { nome: string; codigo: number | null } | null;
    etapa: { nome: string; fblCod: number; ftbCod: number; alcada: string | null } | null;
    duracaoDesdeEventoAnteriorSegundos: number | null;
    observacao: string | null;
    origem: 'ERP' | 'DERIVADO';        // veio do Conexos ou inferimos por diffing de snapshots
}

interface TrilhaResponse {
    cabecalho: AprovacaoListItem;
    eventos: EventoTrilha[];           // ordem cronológica
    lacunas: string[];                 // avisos: "sem timestamp de atribuição da etapa X"
}
```

> **Prefixo das rotas:** os routers são montados na **raiz** em `src/backend/index.ts:81-125`
> (`app.use('/recebimentos', ...)`), não sob `/api`. Por isso o contrato usa `/aprovacoes` e não
> `/api/aprovacoes`. Os caminhos `/api/fin026/...` citados no §3 são do **ERP Conexos**, coisa
> diferente.

> **Padrão de paralelismo já existente no repo:** a Frente IV resolveu exatamente este problema com
> **ports + `Symbol` tokens + container por frente**
> (`domain/interface/recebimentos/ports.ts:11`, `domain/recebimentosContainer.ts:47`). As fatias F2 e
> F3 programam contra o *port* e registram um stub; quando a F1 entra, troca-se o binding e nada mais
> muda. Ver `frente-v-anatomia-slice.md` §0.

Pontos não-negociáveis do contrato:

1. **`origem: 'ERP' | 'DERIVADO'`** em todo evento. Nunca apresentar um tempo inferido como se fosse
   registro do ERP. Auditoria financeira exige essa distinção.
2. **`lacunas[]`** explícito. Quando o timestamp de "recebeu a etapa" não existir, o painel diz isso —
   não estima em silêncio.
3. **`snapshotEm`** visível na UI. O usuário precisa saber que está vendo o snapshot das 14h, não o ERP agora.
4. **`INDETERMINADO`** é status de primeira classe, não um erro.
5. Durações em **segundos corridos** no contrato; a formatação é decisão de apresentação. Se houver
   regra de dias úteis, entra como campo adicional calculado no backend — nunca substituindo o corrido.

---

## 6. Riscos e como cada um é endereçado

| # | Risco | Impacto | Endereçado por |
|---|-------|---------|----------------|
| ~~R1~~ | ~~Não existe endpoint de varredura em massa~~ | — | **RESOLVIDO** pelo spike: `fin026/list` e `fin103/list` são listagens em massa filtráveis |
| R2 | ERP expõe só estado atual dos bloqueios | Duração de etapa incompleta | Parcialmente mitigado: a escada de 3 liberações é durável no título. O snapshot cobre o resto (atribuição, aging, Fase 2) |
| ~~R8~~ | ~~Timestamps podem perder a hora~~ | — | ✅ **ENCERRADO** pelo probe em produção: `ftbTimBloq` = `2026-08-17 11:37:31 BRT`. Os campos `Tim*` carregam hora; os `Dta*` não |
| **R9** | **Enums `fbaVldAcao` / `ftbVldStatus` sem legenda no spec** | Não dá para distinguir aprovou / cancelou / encaminhou | Probe coleta a distribuição de valores + confirmação do analista |
| ~~R10~~ | ~~Log não tipado~~ | — | ✅ **ENCERRADO**: é auditoria de verdade (`logList`), mas veio **vazia** em todos os títulos. Não serve como fonte da trilha. O `configList` da mesma resposta traz as legendas dos enums |
| **R11** | **Usuário de API sem acesso à tela `fin103`** — a varredura em massa da fila devolve vazio mesmo havendo títulos bloqueados | Perde-se o endpoint mais eficiente e boa parte da projeção de campos (`docDtaFinalizacao`, `acdCod`, `wffUuid`) | **Pedido de provisionamento ao admin do Conexos da Columbia** (fin103, fin102, fin106). Contorno: `fin026/list` + `fin026/infoTitulo/list` |
| ~~R12~~ | ~~Volume ínfimo / sem backfill~~ | — | ❌ **ERRADO, retirado.** Media apenas os bloqueios PENDENTES. Na realidade ~49% dos títulos têm trilha e o histórico é retido — **backfill é possível** |
| ~~R13~~ | ~~`aprovador` é setor, não pessoa~~ | — | ✅ **RESOLVIDO**: `aprovador` é rótulo de alçada (mistura setor e pessoa), mas `usnDesNomeCmd` traz a pessoa. Fase 2 por funcionário é viável |
| **R14** | **Custo do backfill**: sem acesso ao `fin103`, a trilha custa **1 chamada por título** (23.632 na filial 2 em 12 meses) | Job de backfill longo; risco de rate-limit | Pedir acesso ao `fin103` (vira paginação). Enquanto isso, desenhar o backfill **interrompível e retomável** |
| **R15** | **Falso negativo silencioso por `filCod` errado** — consultar a trilha com a filial errada devolve `count: 0` **sem erro** | Títulos apareceriam como "sem workflow" | O `filCod` tem de vir do próprio registro, nunca de default. Teste de regressão obrigatório |
| **R16** | **`usnCodCmd` não vem na projeção** — só o nome da pessoa | Identidade instável para o analítico da Fase 2 (nome muda/duplica) | Depende do acesso ao `fin103`; senão, chave por nome com normalização |
| R3 | `regerarBloqueios` reescreve a trilha | Eventos derivados duplicam ou somem | Regra de negócio explícita (`WORKFLOW_REGERADO`) no rascunho de ontologia |
| R4 | Falta o timestamp de "aprovador recebeu a etapa" | O caso canônico do cliente (§1) não fecha | S1 deve cravar; se faltar, vira pergunta P0 ao analista e `lacunas[]` na UI |
| R5 | Columbia pode não usar alçadas de fato | Modelo superdimensionado | Pergunta P0 na entrevista da Onda 1 |
| R6 | Backfill inicial pesado | Primeira carga demora / pressiona o ERP | S5 define janela móvel e estratégia de backfill |
| R7 | Merge das 3 fatias | Conflito em rotas/tipos compartilhados | Contrato travado (§5) + ordem de merge F1→F2→F3 + rebase obrigatório |

---

## 7. Gates de qualidade (herdados do kavex-pipe, sem exceção)

Cada fatia da Onda 2 fecha com: `typecheck` ✅ · `lint` ✅ · `test` ✅ · **PatternGuardian** ✅ ·
critérios de aceite ✅ · **DesignSystemReviewer** ✅ (fatias com frontend) · ontology diff presente
se `entity_changed=true` ✅.

O **Regis-Review** roda **uma vez**, na Onda 3, com escopo `backend` + `frontend`, sobre as três
fatias já integradas — não uma vez por fatia. Rodá-lo três vezes desperdiçaria o gate e produziria
findings redundantes sobre código que ainda vai mudar no merge. Só P0 re-entra no loop; P1/P2/P3
vão para `ontology/_inbox/frente-v-regis-followups.md`.

`ObservabilityAdvisor` é obrigatório na fatia F1 (job novo de ingestão).

---

## 8. Fase 2 (analítico) — o que preparar agora sem implementar

Não construir nada de analítico agora. Mas três decisões da Fase 1 determinam se a Fase 2 será
barata ou uma reescrita:

1. **Tabela de eventos append-only** com ator, fornecedor, filial e duração já materializados por
   evento — o analítico vira `GROUP BY` em vez de recomputar trilhas.
2. **Chave estável de ator** (`usnCod` do Conexos, não o nome) — "tempo médio do funcionário" exige
   identidade estável; nome muda e duplica.
3. **Dimensões de negócio no evento**: `fornecedorCod` e o cliente final do processo (`pesCodProc` /
   `pesCodLig` no `FinTituloBloq`) gravados no momento da ingestão. Se não gravarmos agora, a Fase 2
   precisa de um join retroativo contra o ERP para dados históricos que talvez já não existam lá.

Isso não adiciona escopo de UI nem de API na Fase 1 — é só disciplina no schema de F1.
