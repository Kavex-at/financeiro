# Tasks: sispag-filtros-data-boleto

**Spec source:** decisões do usuário no lote paralelo SISPAG A/B/C (Grupo B), 2026-10-06 — sem entrevista.
**Ontology diff:** no — filtro de tela, nenhuma entidade/regra muda.
**entity_changed:** false
**Estimated scope:** M (kit de filtro compartilhado + 6 abas + 1 parâmetro de query no backend)

> **Layout real:** `src/backend/` e `src/frontend/`. Sem `infra/` → AwsInfraArchitect não é acionado.
> Não mexe em dinheiro nem em escrita no Conexos → GroundTruthValidator não se aplica.

## Decisões de projeto (registradas aqui porque o usuário pediu para documentar)

| Aba | Data filtrada (rótulo) | Origem | Onde filtra |
|-----|------------------------|--------|-------------|
| Títulos a pagar | Vencimento | `titulo.vencimento` (dia ERP, epoch UTC) | cliente |
| Lotes candidatos | Vencimento | o lote passa se **qualquer item** vence no intervalo | cliente |
| Finalizados | Remessa gerada | `remessaGeradaEm`, senão `finalizadoEm` (instante → dia em BRT) | cliente |
| Lançamento Lote (REM) | Data de crédito | `flpDtaCredito` — única data que o `fin015/list` devolve; é a data em que o lote foi lançado para pagamento | cliente |
| Retorno Lote (RET) | Recebido em | `garTimCadastro` (cadastradoEm), senão `garTimProc` (instante → dia em BRT) | cliente |
| Boletos DDA | Vencimento | `vencimento` do boleto (data civil) | **servidor** (a aba é paginada no backend) |

- **"Qualquer item" nos candidatos** (e não o intervalo min–max do lote): é o que responde "tem algo
  vencendo nesse período?", e um lote longo não aparece em todo intervalo que só toca suas bordas.
- **Chips de boleto (Todos / Boleto / Sem boleto)** em Títulos e Lotes candidatos. Num título,
  `temBoleto`. Num lote, cada item tem boleto se a carteira diz `temBoleto` **ou** a modalidade é
  `BOLETO`; "Boleto" = lote com ≥1 item com boleto, "Sem boleto" = lote com ≥1 item sem boleto.
  Lote misto aparece nos dois: o filtro nunca esconde um lote que tem o que se procura.
- Intervalo inclusivo nas duas pontas; item sem a data filtrada sai quando há intervalo ativo.
- O estado do filtro vive no `SispagPanel`, então já sobrevive à troca de aba (exceto Boletos DDA,
  cujo estado é do próprio componente, desmontado ao sair da aba — fica como estava).

## Task list

### Task 1: Testes do kit de filtro (data + boleto) — falham primeiro
**Files:** `src/frontend/app/permutas/components/tabela-filtro.test.tsx` (novo)
- [ ] Sem opções extras o hook se comporta como antes (filial + busca + paginação)
- [ ] `getDatas`: passa se qualquer data cai em [de, até], inclusivo; só `de` ou só `até` funciona
- [ ] Item sem data sai com intervalo ativo
- [ ] `getBoleto`: `com` = algum true, `sem` = algum false; contagem por chip antes do filtro de boleto
- [ ] Trocar data/boleto volta à página 1; `limparFiltros` zera tudo
- [ ] `FiltroBarra` só mostra data/boleto quando as props opt-in vêm

### Task 2: Kit de filtro — opt-in, retrocompatível com Permutas
**Files:** `tabela-filtro.tsx`, `components/ui/date-picker.tsx` (aceita `aria-label`)
- [ ] 5º parâmetro opcional `extras` em `useTabelaFiltro`; campos novos opcionais em `TabelaFiltro`
- [ ] `FiltroBarra` com `rotuloData` e `filtroBoleto` opcionais; rótulo "<Data> de/até"; botão Limpar

### Task 3: Conversão de datas para dia civil
**Files:** `src/frontend/app/sispag/components/filtroDatas.ts` (+ teste)
- [ ] dia ERP (epoch UTC) → `YYYY-MM-DD` sem fuso; instante (ISO/epoch) → dia em America/Sao_Paulo

### Task 4: Aplicar nas abas da página SISPAG (edição localizada em `page.tsx`)
- [ ] Títulos, Candidatos, Finalizados, REM, Retornos com o rótulo da tabela acima
- [ ] Aba REM ganha filial + busca + paginação (antes não tinha filtro) e coluna "Crédito"
- [ ] Retornos ganha coluna "Recebido em" (a data filtrada fica visível)
- [ ] "Ir para o lote" limpa também data e boleto (senão o lote pode estar escondido)

### Task 5: Boletos DDA — intervalo de vencimento no servidor
**Files:** `PaginacaoBoletoDda.ts` (+ teste), `BoletoDdaService.ts`, `routes/sispag.ts` (+ teste), `lib/sispag.ts`, `BoletosDdaTab.tsx`
- [ ] `vencimentoDe`/`vencimentoAte` (`YYYY-MM-DD`, Zod regex) filtram antes da contagem por situação
- [ ] Query inválida → 400; boleto sem vencimento sai com intervalo ativo

### Task 6: Gates
- [ ] typecheck, lint, test (FE e BE); PatternGuardian (BE); DesignSystemReviewer (FE); Regis-Review
