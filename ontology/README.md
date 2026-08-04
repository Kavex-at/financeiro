# Ontologia Financeiro

**Versão atual:** 0.1.0  
**Bootstrap:** 2026-06-10 (template a partir de `fechamento-processos` v0.10.2 — domínio **vazio**)  
**Seeds:** [`/03_ontologia.md`](../docs-contexto/03_ontologia.md) (plataforma, herdado) · [`/03_ontologia_financeiro.md`](../docs-contexto/03_ontologia_financeiro.md) (domínio, seed das 4 frentes)

## O que é esta pasta

`/ontology/` é a **fonte de verdade do domínio** do produto Financeiro (Columbia Trading) — a **Automação Financeira** em quatro frentes (Permutas, SISPAG, Popula GED, Conciliação de Recebimentos; ver [`../docs-contexto/03_ontologia_financeiro.md`](../docs-contexto/03_ontologia_financeiro.md)). Cada entidade, relacionamento, ação, regra de negócio e integração com sistemas externos tem representação aqui. As pastas de domínio **ainda estão vazias** — o domínio é modelado incrementalmente via `/feature-new`.

O código TypeScript em `backend/` *implementa* a ontologia. A ontologia *define* o que deve existir. Discrepâncias são bugs — não na ontologia, no código.

## Princípios de Modelagem (P1-P7)

**P1 — Modela como o negócio fala, não como o sistema armazena.**  
Se o controller chama de "operação de importação" e o ERP chama de `t_imp_op_001`, a ontologia chama de `OperacaoImportacao`.

**P2 — Objeto > Tabela.**  
Um objeto pode mapear para múltiplas tabelas no ERP. Uma tabela do ERP pode ser parte de múltiplos objetos.

**P3 — Ações são primeira-classe.**  
Não há "objetos passivos". Toda mudança de estado é uma ação nomeada com regras explícitas.

**P4 — Regulação é parte da ontologia.**  
NCM não é um código numérico; é um objeto com classificação, alíquotas, regimes aplicáveis, relação histórica.

**P5 — Tempo é parte da ontologia.**  
Cada propriedade pode ser histórica. Alíquota mudou em 2024? A ontologia sabe disso.

**P6 — Cliente-específico é configuração, não fork.**  
Cada cliente tem configurações que variam, mas estrutura é a mesma.

**P7 — Write-back é cidadão de primeira classe.**  
Toda ação que modifica realidade deve ter caminho de volta para o sistema-fonte (ERP).

## Princípios de Implementação (I1-I6)

**I1 — Tipado fortemente.** TypeScript types; compilador verifica relações.  
**I2 — Versionado.** Cada release é versionada com migrations entre versões.  
**I3 — Schema-first.** JSON Schema/Zod como source of truth.  
**I4 — Test-driven.** Cada objeto e ação tem testes unitários.  
**I5 — Observable.** Toda execução de ação é logada via `EventoIntegracao`.  
**I6 — Documentation-as-code.** Documentação vive no repositório.

## Estrutura

```
ontology/
  README.md                 # este arquivo
  CHANGELOG.md              # histórico de versões + roadmap
  glossary.md               # vocabulário do domínio
  entities/                 # 1 arquivo por entidade (vazio no bootstrap)
  relationships.md          # tabela de relações + grafo
  state-machines/           # ciclos de vida formais
  actions/                  # 1 arquivo por ação (vazio no bootstrap)
  workflows/                # composições de ações
  business-rules/           # regras invioláveis com teste canônico
  integrations/             # contratos com sistemas externos
  ui-flows/                 # mapa tela → ações da ontologia
  design/                   # extensão do design system
  decisions/                # ADRs leves
  _inbox/                   # perguntas abertas pendentes (criadas por agents)
  _index.json               # gerado: entidade → arquivos de código
  _coverage.json            # gerado: % cobertura código vs ontologia
```

## Como contribuir

1. **Feature nova com entidade nova:** `/feature-new` — o `OntologyCurator` propõe diff antes de qualquer código.
2. **Ajuste em regra existente:** `/feature-tweak` — Curator decide se diff é necessário.
3. **Edição direta:** edite o arquivo da entidade/ação, atualize `last_review` e abra PR com o diff.
4. **Dúvida:** abra `_inbox/<slug>.md` com sua pergunta. O time responde no arquivo.

## Status de implementação

| Flag | Significado |
|------|-------------|
| `implemented` | Existe em `backend/src/` e está funcionando |
| `partial` | Existe parcialmente (ex: entidade criada, ações faltando) |
| `planned` | Definido na ontologia, ainda não implementado |

## Rastreabilidade

`_index.json` mapeia cada entidade para todos os arquivos de código relacionados.  
`_coverage.json` mostra % de entidades/ações cobertas por código implementado.

Após 2-3 features, use `/feature-tweak entities/<nome> "review"` para listar todos os arquivos via `_index.json`.
