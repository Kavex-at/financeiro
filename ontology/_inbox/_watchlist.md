# Ontology Watchlist — conceitos premature / a revisitar

> Conceitos capturados durante curadorias que **não entraram** na ontologia agora (premature ou
> aguardando contrato/decisão), mas que devem ser revisitados quando houver mais profundidade ou um 2º
> cliente. Cada item aponta a curadoria/ADR que o registrou.

## Frente IV — Conciliação de Recebimentos + NDe (ADR-0022, curadoria 2026-07-24)

- **Regras de negócio DEFERIDAS à Fase 4** (stubs criados, semântica não fixada — não modelar antes da
  hora): `encomenda-percentuais` (0,1%/0,9% — base, significado, contas, arredondamento);
  `adiantamento-cliente` (critério de identificação + ciclo do `CreditoCliente`); `separacao-multa-juros`
  (informado × calculado, destino por parcela, divergência esperado×pago). Cada uma tem OfficeHours
  própria na Fase 4.
- **Nexxera — canal/formato (O7):** API vs SFTP/CNAB240 vs OFX, auth, sandbox **não confirmados**.
  Modelado com port channel-agnostic; **spike na Fase 0**. Revisitar quando o contrato do vendor fechar
  (define o adaptador concreto).
- **Write de recebível (O3):** aposta = `fin010` parametrizado. **Confirmar o shape do payload/endpoint
  no build (Fase 5)** — capturar uma baixa real de recebível se a parametrização não fechar.
- **Emissão da NDe:** endpoint/trigger de emissão no Conexos **a confirmar na Fase 5** (junto do O3).
  Idempotência ("já emitida") já modelada; o contrato wire não.
- ~~**Módulo 6 (observabilidade):** transversal, não é entidade/ação única — **semeado** em cada fase
  (correlation id, run de auditoria, logs) e **consolidado na Fase 6** (dashboards/métricas/alertas).
  Não modelar como entidade agora.~~ **FECHADO em 2026-09-01 pela ADR-0042.** A consolidação
  aconteceu: `JobRun` (read-model sobre as três tabelas de run) e `Alerta` (persistido) entraram
  como entidades, com quatro ações em `actions/operacao/`. A previsão de que observabilidade "não é
  entidade única" estava certa quanto à origem — ela nasceu semeada em cada frente — e errada quanto
  ao destino: o que faltava era exatamente um agregado de leitura por cima do que já estava semeado.
  Ficam abertos, como follow-up e fora do slice, os dois pontos cegos nomeados na ADR-0042 (detector
  hospedado no próprio GH Actions; `DbAlertSink` incapaz de alertar que o backend caiu), cuja solução
  comum é um dead-man's switch externo.
- **Enum de componentes do rateio** (`PRINCIPAL | MULTA | JUROS | ENCOMENDA | …`) e a **estratégia de
  distribuição** (greedy por saldo / vencimento / componente): forma esboçada em `RateioRecebimento`;
  enum e motor concretos na **Fase 3/4**.
- **Sub-estados de execução** (ex.: `executando`/`pending` no write-ahead ledger do `Recebimento`):
  detalhe de implementação da **Fase 5** (espelha `permuta_alocacao_execucao`) — não fixados na
  state-machine skeleton de propósito.
- **Scheduler (O4, herdado do SISPAG):** sem runtime de job/cron nativo (Express). Cadência do Módulo 1
  começa manual-trigger + cron probe (como a ingestão SISPAG); EventBridge é o alvo.

## SN — condição de pagamento / título (curadoria 2026-08-03, ADR-0025)

- **"Documento financeiro finalizável ⟺ título == valor do documento" como business-rule própria:** NÃO
  criada agora. É um **discriminador de etapa** do contrato Conexos (mesma doutrina de
  `conexos-nde-fiscal.md`: 200 ≠ sucesso), medido em **um** ERP. Promover a regra de negócio só se
  aparecer num 2º ERP/cliente — aí o invariante deixa de ser contrato de integração e vira domínio.
- **Divergência HML × produção no efeito do `PUT` que troca `pgtCod`:** em produção (SN 18345) as parcelas
  sobreviveram; no HML são destruídas. Hipótese (não confirmada): a condição de produção tem regra de
  parcelamento, a `101` do HML não. Revisitar se um cliente real cair no caso **bloqueante** — é o único
  cenário em que o `PUT` volta a rodar de verdade.
- **Regeneração das parcelas via tela `com032` ("Financeiro"):** HAR não capturado, caminho deliberadamente
  não implementado (ADR-0025). Só vale o esforço se o caso acima ocorrer em produção.
- **Máquina de estados do documento com299 no ERP** (gerado → com item → com condição → finalizado → com
  título): NÃO modelada — é ciclo de vida **do ERP**, não do nosso agregado (o nosso é `etapa` na trilha de
  execução). Revisitar só se um 2º ERP exibir o mesmo ciclo.

## Permutas — snapshot de estados (curadoria 2026-09-08, ADR-0043)

- **Aposentar o motivo `multiplas-invoices`:** **0 ocorrências** em 250 runs / 152.516 linhas de
  snapshot (2026-06-20 → 2026-09-08). Convive com `composto-nm`, que cobre o caso geral de N:M.
  **Não removido agora** — 0 ocorrências não é impossibilidade, e mudar a taxonomia de motivos ficou
  fora do escopo do ciclo. Revisitar no próximo `/retro-ontology`; promover a rejeição formal se um
  2º cliente também não o produzir.
- **Generalizar `fidelidade-snapshot-eleicao` para os demais pipelines com snapshot**
  (`recebimento_ingestao_run`, `pagamento_ingestao_run`): ambos persistem contagens de header ao
  lado de linhas de detalhe, portanto podem ter a **mesma classe de bug** (header × detalhe
  divergindo). **Não medido** — por isso a regra nasceu escopada a `PermutaCandidata`, com a
  generalização como nota, não como invariante transversal. Promover só com evidência medida nos
  outros dois.
- **ADRs 0034 e 0036 estão DUPLICADOS** em `ontology/decisions/` (dois arquivos com cada número:
  `0034-gcd-da-sn-resolvido-por-historico-do-processo.md` +
  `0034-maquina-de-estados-da-transacao-ganha-writers.md`; `0036-descricao-item-nde-no-documento.md`
  + `0036-homologacao-da-nde-medida-pelo-estado-gravado.md`). **Não corrigido neste ciclo** (renumerar quebra referências
  cruzadas já escritas). Registrado para uma limpeza deliberada: decidir se renumera com
  `superseded_by` ou se mantém e documenta a colisão.

## Permutas — integridade da baixa (curadoria 2026-09-08, ADR-0044)

- **`ExecucaoPermuta` como entidade própria: NÃO criada.** O ledger `permuta_alocacao_execucao` já
  tem chave versionada, 5 estados (`pending`/`reconciling`/`settled`/`parcial`/`error`), valor
  residual, identidade Conexos (ADR-0041) e trilha de auditoria — é o candidato natural. Segue
  modelado *dentro* de `business-rules/idempotencia-reconciliacao.md` + ação `reconciliarPermuta`,
  pela regra "entidade existente antes de entidade nova". **Promover se** ganhar um 6º estado, ou
  uma **ação própria** de resolução de resíduo (hoje a resolução é re-alocar, que é ação da
  `Permuta`, não do ledger).
- **`state-machines/execucao-permuta.md`: NÃO criado.** A máquina está desenhada em ASCII dentro da
  business-rule e um arquivo separado duplicaria a fonte — dois lugares para o mesmo diagrama é como
  o drift da chave de idempotência nasceu. Promover **junto** com o item acima, nunca antes.
- **Paridade `ExecucaoStatus` backend × frontend.** `PermutaExecucaoRepository.ts:5` e
  `src/frontend/lib/types.ts:255` são espelhos manuais. Cada estado novo custa duas edições e nada
  detecta a divergência. Não é questão de ontologia hoje; vira, se a divergência produzir um bug de
  domínio (badge errado sobre dinheiro já movido).
- **Borderô FINALIZADO com resíduo — seam aceito, não resolvido.** `status-permuta-bordero.md`
  devolve `finalizado` (ela responde sobre o *borderô*); o resíduo fica com o ledger + o reaper +
  o saldo do adto. Revisitar se aparecer um caso real em que o resíduo se perdeu na prática — aí a
  costura vira um 4º estado, não antes.
