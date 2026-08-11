# Columbia Trading — Financeiro

Automação assistida da **área Financeira da Columbia Trading**. O projeto cobre quatro frentes onde o
processo manual hoje gera exposição — **dado que não fecha, pagamento que não sai, documento que não
destrava, crédito que não concilia** — mantendo o analista no controle das decisões de julgamento e transferindo à solução o
trabalho mecânico. Todas as frentes integram com o ERP **Conexos** (mesmo tenant do
`fechamento-processos` — hoje **só o lado leitura**; a escrita no ERP será desenhada via `/feature-new`),
operam multi-filial e registram trilha de auditoria completa.

> **Fonte canônica do escopo:** [`docs/proposta/`](./docs/proposta/) ·
> **Domínio:** [`03_ontologia_financeiro.md`](./docs-contexto/03_ontologia_financeiro.md) ·
> **Entrega:** Kavex (*created by Clonex*).

## As quatro frentes

| Frente | Em uma frase | Integra |
|---|---|---|
| **I. Permutas** (Adiantamentos ↔ Invoices) | Reconciliar PROFORMA × INVOICE na baixa; auto 1:1, assistido N:M; backlog → 0 | Conexos `fin010` |
| **II. SISPAG** (Pagamentos) | Montar lote diário, gerar remessa, enviar ao banco, conciliar retorno; zero pagamento perdido | Conexos `com298` + Nexxera |
| **III. Popula GED** (NC/ND) | Casar PDF do SharePoint com a NC/ND e subir no GED para destravar a baixa | SharePoint + GED |
| **IV. Conciliação de Recebimentos** (NDe) | Importar movimentações da Nexxera, casar cada crédito com os recebíveis em aberto, ratear, aplicar regras e efetivar a baixa — culminando na emissão da **Nota de Débito Eletrônica**. Contrapartida de entrada da Frente II | Nexxera + Conexos (`com299`/`gerDoc`) |

**Requisitos transversais:** auth corporativa + RBAC · multi-filial · auditoria completa · integração
Conexos resiliente (sessão/retry/rate-limit) · observabilidade · padronização (portal único futuro).

## Estado do repositório

Fundação **rodável** (bootstrapped do template [`fechamento-processos`](../fechamento-processos)): backend
Express/DDD com **auth Supabase (GoTrue) + autorização por `app_user`** e cliente Conexos, frontend
Next.js com Design System. O **domínio ainda
não foi modelado** em código/ontologia — nasce via o pipeline (`/feature-new`), guiado por
`docs-contexto/03_ontologia_financeiro.md`.

- **Atual:** Express + Next.js (deploy Render). · **Alvo:** Lambda + API Gateway + Terraform multi-tenant.
- Dívida entre os dois: [`ontology/_inbox/migration-debt.md`](./ontology/_inbox/migration-debt.md).

## Pipeline de desenvolvimento

```
/feature-new "<intenção>"
  → OfficeHoursInterviewer → OntologyCurator → TaskScoper → AutoLoopRunner
       (gates: typecheck, lint, test, PatternGuardian, ontology diff, DesignSystemReviewer, Regis-Review)
```

| Comando | Quando |
|---|---|
| `/feature-new <intent>` | Entidade ou flow novo |
| `/feature-tweak <entity> "<intent>"` | Ajuste em regra existente |
| `/investigate <symptom>` | Bug — root cause antes do código |
| `/regis-review` | Revisão de arquitetura 8-QA (Bass & Clements) |

## Como rodar localmente

```bash
# Backend → :3001
cd src/backend && npm ci && npm run dev      # GET /health, GET /conexos/filiais

# Frontend → :3000 (ou :3002 se ocupado)
cd src/frontend && npm ci && npm run dev
```

Dev sem Supabase: `.env` (gitignored) já com `DEV_AUTH_BYPASS=true` / `environment=local` (backend) e
`NEXT_PUBLIC_DEV_AUTH_BYPASS=true` / `NEXT_PUBLIC_ENV=local` (frontend). O bypass injeta um usuário
sintético (`dev-bypass@local`, papel `admin`) — antes ele deixava `req.user` indefinido e **toda
mutação respondia 401 em dev**. O nome é inconfundível de propósito: ele vaza para `executado_por`,
e lixo óbvio na trilha é melhor que um e-mail plausível atribuído a uma pessoa real.

## Estrutura

```
.
├── .claude/                    Pipeline (19 agentes + 13 comandos)
├── CLAUDE.md                   Configuração do pipeline
├── docs-contexto/              Seeds de ontologia (herdados, contexto):
│   ├── 03_ontologia.md             plataforma (read-only)
│   └── 03_ontologia_financeiro.md  domínio (4 frentes) ← propósito
├── docs/proposta/              Proposta Kavex × Columbia (fonte canônica, CONFIDENCIAL)
├── ontology/                   Source of truth do domínio (a modelar via /feature-new)
└── src/{backend,frontend}/     App (Express + Next.js)
```
