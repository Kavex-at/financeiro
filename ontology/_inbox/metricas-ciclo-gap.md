# Gap — metricas-ciclo

> Aberto em 2026-09-14 pelo `/feature-new`. A implementação seguiu com o palpite marcado em cada item;
> nenhuma chave de `metrica` é permanente até o merge. **Responder abaixo de cada pergunta.**

## P0 — decidir antes do merge (a chave vira permanente)

### G1 — Frente IV: de onde medir, e o que fazer com "sem toque humano"

`recebimento`, `recebimento_execucao` e `rateio_recebimento` têm **0 linhas** em produção. A alocação
real acontece na trilha da SN (`solicitacao_numerario_execucao`: 23 execuções reais, 12 concluídas,
R$ 2,03 mi). E nenhuma tabela registra se uma alocação teve "toque humano": toda SN é disparada por
analista, e não há regra automática cadastrada.

**Palpite implementado:** fonte = trilha da SN; métricas `recebimentos_alocacoes_concluidas_pct` e
`recebimentos_valor_alocado`. O "% sem toque humano" **não** é emitido.

Opções:
- (a) manter o palpite, e criar `recebimentos_alocacao_sem_toque_pct` quando existir alocação
  automática que grave o ator;
- (b) emitir já um `recebimentos_nde_sem_revisao_pct` (`revisao_humana = false`). Hoje daria **0%**:
  todas as 12 SN concluídas precisaram de revisão no com194;
- (c) outra definição.

**Resposta (Yuri, 2026-09-14):** se todo registro é disparado por alguém, descartar o "% sem toque
humano". → Opção (a) sem a métrica futura: fonte = trilha da SN; ficam taxa de conclusão e R$.

## P1 — o palpite é defensável, mas a decisão é de negócio

### G2 — Baixa de permuta em borderô desfeito

20 baixas `settled` (R$ 3,03 mi) estão em borderô CANCELADO (`bor_vld_finalizado = 2`). A tela ainda
trata ESTORNADO (`bor_cod_estornado IS NOT NULL`) como permuta liberada para relançar.
**Palpite:** as duas situações ficam fora do numerador e do R$, e dentro do denominador (a tentativa
não ficou de pé). Na semana de 2026-06-19 isso é a diferença entre 39% e 80%.
Borderô EM CADASTRO (baixa gravada, borderô não finalizado no ERP) **conta** como concluída. Confirmar.
O `permuta_bordero` é cache: se a sincronização atrasar, o cancelamento demora a aparecer.

**Resposta (Yuri, 2026-09-14):** de acordo que cancelado/estornado não conta, e **em cadastro também não
conta**. Pode virar outra métrica, mas não é concluída. → Implementado: só borderô FINALIZADO
(`bor_vld_finalizado = 1`, sem estorno) conclui e entra no R$. Consequência aplicada no mesmo sentido:
baixa cujo borderô **não está no cache** também não conta (situação desconhecida não é finalizada). Em
2026-09-14 são 4 baixas / R$ 2,76 mi, dos borderôs 2466 (fil 1) e 19254–19256 (fil 2), de 10 e
14/08. O cache foi atualizado hoje e eles não aparecem: provável exclusão no ERP, vale conferir.
Métrica de "em cadastro", se vier, entra com chave nova.

### G3 — Início da série

**Palpite:** `2026-09-11 20:00` (a janela do ciclo 6). O ledger tem dados desde 2026-06-22, mas
não são emitidos: o ledger de permutas apaga linhas quando um borderô é excluído, e as definições
não existiam antes. Se quiserem a série desde o go-live de cada frente, a mudança é uma linha
(`serie_inicio`) numa migration nova. É uma decisão consciente contra a regra 2, não um ajuste técnico.

**Resposta (Yuri, 2026-09-14):** sim.

## Achados na skill `kavex-report-ciclo` (fora deste repo)

- **K1 — `--fim` só com data zera o resultado.** `metrics.py` filtra `janela_fim <= fim`. Com
  `--fim 2026-09-18`, o Postgres lê `2026-09-18 00:00` e a janela que fecha às 20:00 some. Use
  `--fim 2026-09-18T20:00:00`, ou troque o filtro para `janela_fim::date <= %(fim)s::date`.
- **K2 — `config/columbia.json` não existe**, e `--config` é obrigatório. Precisa de
  `{"metricas": [{"frente": "Financeiro", "dsn_env": "DSN_FINANCEIRO"}]}`.
- **K3 — `render.py` imprime `{valor}{unidade}` cru.** Sai `1283986.92R$` e `92.3%`. `R$` precisa de
  prefixo e separador de milhar; valor `None` sairia como `None%`. A view nunca emite `%` com
  denominador zero, justamente para não produzir isso.
- **K4 — "série iniciada neste ciclo" é fixo no `render.py`.** Toda linha sem baseline recebe o texto,
  inclusive a partir do ciclo 7. O "série iniciada em [data]" do brief precisa vir da menor
  `janela_inicio` já vista (ou de uma coluna nova, o que mudaria o contrato).
