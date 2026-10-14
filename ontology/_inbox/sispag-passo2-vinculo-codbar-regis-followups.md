# Follow-ups — sispag-passo2-vinculo-codbar (Regis-Review 2026-10-14-2230)

Nada abaixo foi implementado nesta entrega, exceto os itens marcados "corrigido".

## Antes de `on` em PRD (bloqueiam a ligação, não o merge)
- **Integrability-1 (P1):** contrato medido só em HML; 0/3 endpoints confirmados em PRD. Fechar V-PRD1/V-PRD2
  (permissão do robô para `PUT fin015/finItemSispag`, um título real controlado) e agendar a sonda como
  checagem de contrato. Ordem decidida: HML V1–V9 → sonda PRD read-only (com go) → shadow em PRD → 1 título.
- **V6** (retorno bancário/pool) não observável em HML.
- Pergunta à Columbia/Conexos: boleto ACIMA do título (caso NELSON, +R$ 0,01) não é viável via SISPAG.

## P2
- **FT F-ft-2:** janela de um round-trip entre a releitura e o PUT (ERP sem lock otimista; o PUT reenvia a
  linha inteira; `bate()` só confere os 5/6 campos escritos).
- **FT F-ft-3:** decisões carregadas uma vez; 3 leituras de rascunho (até 500 linhas) por item.
- **FT F-ft-4:** abortar no item N descarta a lista de retiradas acumulada; `VINCULO_FALHOU` duplica na
  retomada; sem reaper/alerta para lote parado no meio do vínculo.
- **Integrability-2:** `splitCodBar` é `z.unknown()`; modalidade desconhecida cai em 6 por `|| 6`.
- **Integrability-5:** sem contadores de erro por endpoint.
- **Security F-1:** eventos `VINCULO_*` registram `ator='sistema'`; o executor da remessa não aparece (o
  humano que autorizou está em `decisao_id`).
- **Testability:** `VinculoCodigoBarrasSelo` sem teste de render próprio.

## P3
- FT F-ft-5: `VINCULO_SIMULADO` sem dedupe em shadow.
- Security: guarda do job HML é `includes('-hml')` (trocar por allowlist de host); `sanea` do job só mascara
  20+ dígitos (linha digitável formatada escapa); mascaramento duplicado em 4 mecanismos; `ConexosError.cause`
  pode carregar o código.
- Integrability-4: `bancoLote` opcional reintroduz o defeito V4 (falha fechado) — tornar obrigatório.
- Testability: tie-break "prefira decisão humana" provado com a guarda mockada; sem fixtures gravadas das
  respostas do ERP (V4 mostrou que o ERP surpreende mocks).

## Texto desatualizado (rascunhos)
`sispag-passo2-vinculo-codbar-proposta.md` e `-tasks.md` ainda dizem "só aviso" para anular depois do
vínculo (Q11); a regra I17l vigente retira o item na próxima remessa. O aviso do frontend em
`SugestaoBoletoPainel.tsx` poderia dizer isso.
