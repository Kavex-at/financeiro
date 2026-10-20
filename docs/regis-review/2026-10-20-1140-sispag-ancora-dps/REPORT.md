# Regis-Review (reduzido) 2026-10-20-1140 — âncora DPS na sugestão de boleto DDA (ADR-0073)

Escopo: delta `worktree-sispag-dda-ordem-dps` × `origin/main` (v0.69.0). Reduzido (memória
`regis-review-reduzido-por-feature`): 4 QAs escolhidos pelo risco, `model=sonnet`. Contexto e baselines em
`_shared-metrics.md`. Consolidado pelo orquestrador.

| QA | Score | Achados | P0 | P1 | P2 | P3 |
|----|------:|--------:|---:|---:|---:|---:|
| Security | 8.0 | 3 | 0 | 0 | 2 | 1 |
| Fault Tolerance | 7 | 4 | 0 | 1 | 2 | 1 |
| Integrability | 7 | 5 | 0 | 1 | 3 | 1 |
| Testability | 7 | 4 | 0 | 1 | 2 | 1 |

**Veredito: nenhum P0 — o gate passa.** Os P1–P3 vão para
`ontology/_inbox/sispag-ancora-dps-regis-followups.md` (não implementados neste ciclo, Inviolable Rule #11).

## O que os quatro olhares concordam

- **Somente leitura no Conexos, SQL parametrizado, isolamento por título.** Nenhuma escrita no ERP; falha de um
  título vira `ERRO` gravado com motivo e não para os outros; `registrar` é UPSERT idempotente.
- **Os achados que só apareceram ao vivo estão travados por teste** (`psq014` antes do `com298`; download em
  base64; dois layouts reais de DANFSe).

## Pontos que mais de um QA levantou (prioridade dos follow-ups)

1. **DPS gravado sem conferência da NFS-e** (Security F-2, Fault Tolerance F-2): quando o PDF não traz o nº da
   NFS-e, ou é o único PDF da pasta sem o nº no nome, o DPS é aceito sem cruzar com o título e nunca é relido.
   Impacto contido: a âncora não sobe tier e a analista confirma — mas é o caminho de um desempate errado.
2. **Falha silenciosa de contrato** (Integrability F-1/F-3, Fault Tolerance F-3): Zod/envelope descartados viram
   `SEM_PDF`; o `catch` do `psq014` não loga; transiente consome tentativa; o job só sai 1 se tudo falhar.
3. **A leitura de `titulo_dps` não tem proteção no cenário** (Fault Tolerance F-1, P1): se a consulta falhar, a
   lista de sugestões falha junto, embora o DPS seja só sinal auxiliar. A tabela nasce na 0087 pelo
   BootMigrator, então o risco real é falha de banco, não migration ausente.
4. **`ExtratorTextoPdf` fora do CI** (Testability F-1, P1): ts-jest CJS não carrega o `pdfjs` ESM; foi validado
   por smoke e ao vivo. Bump do `pdfjs-dist` não teria teste vermelho.
5. **Limites de tamanho/tempo do PDF e isolamento do parser** (Security F-1/F-3, P2/P3): sem teto de bytes antes
   do parse; o parser roda no mesmo passo de CI que tem os segredos de produção.

## Fora do que se mediu
Nenhum QA rodou testes nem shell (bloqueado fora do worktree); baselines vieram do orquestrador. Ninguém mediu
cobertura numérica.
