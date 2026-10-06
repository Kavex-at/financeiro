# Follow-ups do Regis-Review: sispag-filtros-data-boleto

**Run:** `docs/regis-review/2026-10-06-1807-sispag-filtros-data-boleto/` (escopo: delta dos commits
`65d1fdf` e `da095fa`). **P0: nenhum.** Nada aqui foi implementado nesta entrega; é a fila de melhorias.

Scores: availability 8 · deployability 8 · integrability 8,5 · modifiability 7,5 · performance 9 ·
fault-tolerance 9 · security 9 · testability 8.

## P2

- **testability-1:** a fiação de filtro em `src/frontend/app/sispag/page.tsx` (+78 linhas) não tem teste
  de página. Os acessores por aba (`filtrosAbas.ts`) e o kit estão cobertos, mas trocar o acessor de uma
  aba passaria verde. Proposta: um teste de página por aba (5), conferindo rótulo e campo filtrado.
- **modifiability-1:** `page.tsx` em 1402 LOC (era 1333). Extrair cada aba para um componente próprio.
  Dívida herdada que o delta agravou um pouco.
- **modifiability-2 / DesignSystemReviewer #6:** o kit `FiltroBarra`/`useTabelaFiltro`/`Paginacao` mora em
  `app/permutas/components/` e tem 11 consumidores (Permutas, Recebimentos, SISPAG). Mover para
  `src/frontend/components/` e separar o hook da UI.

## P3

- **Validação de data de calendário e intervalo invertido** (levantado por security-1, availability-1,
  integrability-1, fault-tolerance-1, testability-2, modifiability-3): `DATA_CIVIL_REGEX` aceita
  `2026-13-45`, e `vencimentoDe > vencimentoAte` devolve 200 com lista vazia. Proposta: `.refine` de data
  real + checagem de ordem → 400. A UI já impede os dois casos (`<input type="date">` com `min`/`max`).
- **integrability-3:** criar um `DataCivilSchema` compartilhado; o mesmo padrão de data já aparece em
  ~10 arquivos do backend.
- **performance-1:** os campos de data da aba Boletos DDA disparam um GET por mudança, sem debounce (a busca
  textual tem). Debounce e medir o p95 de `GET /sispag/boletos-dda`.
- **performance-2:** registrar o First Load JS de `/sispag` e `/permutas` a cada ciclo.
- **security-2:** `GET /sispag/boletos-dda` não tem rate limiter de leitura.
- **availability-2:** logar o tamanho do pool DDA e a duração da requisição (o filtro é O(n) em memória).
- **deployability-1:** a aba DDA depende do backend novo. Se o frontend subir antes, o filtro de data
  daquela aba fica sem efeito por alguns minutos. Documentar a ordem backend-primeiro no `DEPLOY.md`.
- **deployability-2:** smoke test pós-deploy para `/sispag/boletos-dda`.
- **testability-3:** propriedades `fast-check` para o filtro de intervalo e o de fuso.
- **fault-tolerance-2:** nas abas filtradas no cliente, uma lista cortada pelo teto do backend faz o
  filtro dizer "nenhum resultado" para o que nem chegou. A aba Títulos já avisa o corte; as outras não
  têm teto conhecido hoje.
