# Frente V — tasks (TaskScoper)

> **Slug:** `frente-v-aprovacoes` · **Worktree:** `C:/tmp/frente-v-wt` · **Base:** `main`
> **Entrada:** `frente-v-aprovacoes-interview.md`, ADR-0038, `frente-v-pendencias-validacao.md`
>
> **Desvio registrado do plano original (D4):** o plano previa 3 fatias em worktrees paralelos. A
> execução paralela por subagentes se mostrou indisponível (12 falhas consecutivas de infraestrutura),
> então as três fatias rodam **sequencialmente no mesmo worktree**, na ordem F1 → F2 → F3. O
> resultado é o mesmo; o que se perde é o paralelismo de relógio. As fronteiras entre fatias
> continuam valendo como pontos de gate verde.

---

## Contrato de API — TRAVADO

Rotas montadas na **raiz** (`app.use('/aprovacoes', ...)`), como as demais frentes. Todo campo
derivado é calculado no **backend**.

```ts
// ── GET /aprovacoes ────────────────────────────────────────────────────────────
type StatusWorkflow =
    | 'SEM_WORKFLOW' | 'AGUARDANDO' | 'APROVADO' | 'REJEITADO' | 'INDETERMINADO';

interface AprovacaoListItem {
    id: string;                       // `${filCod}:${docCod}:${titCod}`
    filCod: number;
    documentoNumero?: string;
    tituloNumero?: string;
    fornecedorCod?: number;
    fornecedorNome?: string;
    valor?: number;
    moeda?: string;
    dataEmissao?: string;             // ISO 8601
    dataVencimento?: string;
    dataFinalizacao?: string;         // hoje sempre ausente — PV-04
    statusWorkflow: StatusWorkflow;
    etapasConcluidas: number;
    etapasTotais: number;
    etapaAtual?: {
        nome?: string;
        alcada?: string;
        responsavelNome?: string;
        recebidoEm?: string;
        paradaHaSegundos?: number;    // NÃO é duração — ver duracao-etapa-aprovacao.md
    };
    tempoTotalSegundos?: number;
    lacunas: string[];
}

interface AprovacoesListResponse {
    items: AprovacaoListItem[];
    page: number;
    pageSize: number;
    total: number;
    snapshotEm?: string;              // I7 — idade do dado, obrigatório na UI
}

// filtros (query string): page, pageSize, filCod, status, fornecedorCod,
//                         responsavel, emissaoDe, emissaoAte, busca

// ── GET /aprovacoes/:id/trilha ─────────────────────────────────────────────────
type EtapaStatus = 'PENDENTE' | 'CONCLUIDA' | 'REJEITADA' | 'INDETERMINADO';

interface EtapaTrilha {
    fblCod: number;
    ftbCod: number;
    nome?: string;
    alcada?: string;
    acao?: string;                    // LIBERAR | APROVAR — PV-02
    responsavelNome?: string;
    responsavelCod?: number;          // hoje sempre ausente — PV-10
    status: EtapaStatus;
    statusErp?: number;               // valor bruto preservado — PV-01
    recebidoEm?: string;
    agidoEm?: string;
    duracaoSegundos?: number;         // null quando pendente — I3
    paradaHaSegundos?: number;        // só quando pendente
    observacao?: string;
}

interface TrilhaResponse {
    cabecalho: AprovacaoListItem;
    etapas: EtapaTrilha[];            // ordem cronológica por recebidoEm
    lacunas: string[];
    snapshotEm?: string;
}
```

---

## F1 — Ingestão e modelo

### T1.1 — Constantes e DTOs tipados
**Arquivos:** `domain/interface/aprovacoes/{constants,TituloAprovacao,EtapaAprovacao}.ts`
**Aceite:** status como constantes tipadas (nunca string crua); `ETAPA_STATUS_ERP` é o **único**
ponto que traduz `ftbVldStatus`; PV-01 citado no comentário; `docTip = 2` como constante nomeada.

### T1.2 — Ports e container
**Arquivos:** `domain/interface/aprovacoes/ports.ts`, `domain/aprovacoesContainer.ts`,
`domain/appContainer.ts` (editar)
**Aceite:** `TrilhaAprovacaoGatewayInterface` **sem nenhum método de escrita** (D2); tokens `Symbol`;
`registerAprovacoesPorts()` idempotente; chamado no `bootstrapAppContainer`.

### T1.3 — Migration
**Arquivo:** `migrations/0049_aprovacao_trilha.sql`
**Aceite:** três tabelas; PK natural em título e etapa; `status_erp` preservado; `ativo` default true;
`lacunas jsonb`; índices para os filtros do painel; SQL idempotente (`IF NOT EXISTS`).

### T1.4 — Cliente Conexos
**Arquivos:** `domain/client/ConexosAprovacoesClient.ts` + teste
**Aceite:** `listUniverso` (psq014/list, epoch ms, `orderList` estável) e `listTrilha`
(fin026/infoTitulo/list); path literal (nunca `listGenericPaginated`); `filCod` sempre do registro
(I5); zero métodos de escrita; teste cobre as armadilhas 1-5 da integração.

### T1.5 — Resolvers de status e duração
**Arquivos:** `domain/service/aprovacoes/{EtapaStatusResolver,StatusWorkflowResolver,DuracaoCalculator}.ts` + testes
**Aceite:** ordem de precedência da máquina de estados (INDETERMINADO antes de tudo); duração `null`
quando pendente / `agidoEm <= recebidoEm`; `paradaHaSegundos` separado; teste com o caso canônico do
doc 4156 (23h29m).

### T1.6 — Repositories
**Arquivos:** `domain/repository/aprovacoes/{TituloAprovacao,EtapaAprovacao,AprovacaoIngestaoRun}Repository.ts` + testes
**Aceite:** SQL com **parâmetros nomeados** (`$filCod`, não `$1`); UPSERT idempotente; anti-fantasma
**por título**; nada é deletado (I6).

### T1.7 — Serviço de ingestão + job
**Arquivos:** `domain/service/aprovacoes/IngestaoAprovacoesService.ts` + teste, `jobs/ingest-aprovacoes.ts`
**Aceite:** backfill retomável por cursor; `withAdvisoryLock`; run de auditoria; respeita a janela
configurável (PV-08); os 5 cenários da regra de idempotência passam.

**Gate F1:** typecheck + lint + testes verdes.

---

## F2 — API e grid

### T2.1 — Gate e rota
**Arquivos:** `http/aprovacoesGate.ts`, `routes/aprovacoes.ts`, `index.ts` (editar),
`domain/libs/environment/EnvironmentProvider.ts` (editar)
**Aceite:** `GET /aprovacoes` e `GET /aprovacoes/:id/trilha` conforme o contrato; Zod no boundary;
RBAC e allow-list de filiais no padrão da Frente IV; `snapshotEm` sempre presente.

### T2.2 — Serviço de painel
**Arquivos:** `domain/service/aprovacoes/AprovacoesPainelService.ts` + teste
**Aceite:** filtros e paginação em SQL; campos derivados no backend; `lacunas` propagadas.

### T2.3 — Página de lista
**Arquivos:** `src/frontend/app/aprovacoes/{page,layout}.tsx`, `components/status-badges.tsx`,
`lib/aprovacoes.ts`, `components/AppShell.tsx` (editar)
**Aceite:** reusa `tabela-filtro` e `components/ui/*`; estados loading/erro/vazio; `observadoEm`
visível; DesignSystemReviewer verde.

**Gate F2:** typecheck + lint + testes + DesignSystemReviewer.

---

## F3 — Timeline

### T3.1 — Drawer de trilha
**Arquivos:** `src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx` + teste
**Aceite:** timeline vertical cronológica; distingue `CONCLUIDA` de `PENDENTE` de `INDETERMINADO`;
mostra duração só onde existe e "parada há" só em pendente; `lacunas` visíveis; renderiza o caso
canônico do doc 4156 corretamente.

**Gate F3:** typecheck + lint + testes + DesignSystemReviewer.

---

## Definition of Done

1. `npm run typecheck` ✅ (backend e frontend)
2. `npm run lint` ✅
3. `npm test` ✅
4. PatternGuardian ✅
5. Ontology diff presente (entity_changed = true) ✅
6. DesignSystemReviewer ✅ (F2/F3)
7. Regis-Review rodado **uma vez** ao final; P0 remediados, P1-P3 no inbox ✅
8. Rebase em `main` + bump de versão FE/BE lockstep + PR ✅
9. **Todas as premissas PV-nn citadas no código por ID** ✅

## Riscos desta execução

| Risco | Mitigação |
|-------|-----------|
| Ingestão cara (PV-07) | Backfill retomável; port permite trocar por `fin103` depois |
| `filCod` errado → falso negativo mudo (I5) | Teste de regressão dedicado |
| 13 etapas `INDETERMINADO` (PV-01) | `status_erp` bruto preservado; reclassificação por migration |
| Escopo grande numa sessão | Gates verdes por fatia, na ordem F1 → F2 → F3 |
