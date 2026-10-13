# Regis-Review (versão reduzida) — PR #115, coluna "Forma de pagamento"

- **Run:** 2026-10-13-1505 · escopo `frontend`, `--quick` · delta `origin/main...feat/sispag-coluna-forma-pagamento`
- **Versão reduzida, pedida pelo usuário:** 3 dos 8 atributos de qualidade, os que um delta só de
  UI/filtro no frontend toca. Fora: security, deployability, integrability, availability e
  fault-tolerance — o delta não muda backend, I/O, auth, dados persistidos nem deploy.
- Consolidação feita pelo orquestrador (sem `qa-consolidator`, que exige as 8 seções).

## Resultado

| QA | Nota | P0 | P1 | P2 | P3 | Seção |
|---|---|---|---|---|---|---|
| Modifiability | 7/10 | 0 | 0 | 2 | 2 | [modifiability.md](modifiability.md) |
| Testability | 8/10 | 0 | 0 | 2 | 1 | [testability.md](testability.md) |
| Performance | 9/10 | 0 | 0 | 0 | 2 | [performance.md](performance.md) |

**Nenhum P0.** Pela regra do gate, nada re-entra no loop; P2/P3 viram follow-ups em
`ontology/_inbox/sispag-coluna-forma-pagamento-regis-followups.md` (não implementados).

## Destaques

- **Mapa de rótulos do `titVldPagopor` em três cópias** (`FORMA_CONEXOS_ROTULO` e
  `FORMA_ROTULO_TABELA` no frontend, `PAGO_POR_CONEXOS_ROTULO` no backend) sem teste de paridade.
  `rotuloFormaConexos`/`FORMA_CONEXOS_ROTULO` ficaram sem chamador.
- **Código fora do mapa** (ex.: 11, ou o código de TED se aparecer um novo) cai em "sem forma no
  Conexos" — o ERP mandou um valor; o rótulo deveria dizer o código.
- **Cobertura do filtro:** categoria só testada combinada com filial; sem asserção de página
  para a coluna/chips/dica; chip escolhido que some com outro filtro deixa a tabela vazia sem chip
  pressionado (comportamento não decidido).
- **Performance:** +0,1–0,3 ms por tecla em 1.260 títulos (estimativa analítica); memos estáveis.
  First Load JS não medido (`--quick`).
