# Info-gaps — Reforma Tributária IBS/CBS · auditoria RT-001..RT-014

> Origem: auditoria de conformidade 2026-08-02/03 contra
> `docs/reforma-tributaria/00_fonte_da_verdade_ibs_cbs.md` (§10). Gap report com evidências:
> `docs/reforma-tributaria/02_auditoria_gap_report.md`. **Todos os gaps abaixo dependem do fiscal
> da Columbia (ou de artefato que só ele obtém)** — não são resolvíveis por código. Responder AQUI
> (editar o arquivo) destrava os itens do backlog §6 do gap report.

## P0 — bloqueiam a conformidade de 03/08/2026

### RT-GAP-1 · `xml-nde-autorizada` — o gcd "NOTA DE DÉBITO ELETRÔNICA" emite finNFe=6 com grupos IBS/CBS?
A NDe da automação é gerada no com297 com a config `gcd` "NOTA DE DÉBITO ELETRÔNICA" e homologada na
SEFAZ. Não sabemos o que o XML autorizado contém.
- **Pergunta:** obter **1 XML de NDe autorizada pós-03/08/2026** (ou de homologação SEFAZ) e conferir:
  `finNFe` (esperado 6), `tpNFDebito`, grupo UB por item (`CST` ≠ vazio, `cClassTrib` preenchido),
  grupo W03 (totais IBS/CBS) e `DFeReferenciado` (presente? referenciando o quê?).
- **Por quê:** decide o veredito de RT-001/RT-002/RT-003 (GAP do app × ERP resolve). Sem grupo IBS/CBS
  válido, a Columbia perde a dispensa do art. 348 §1º em TODA NDe emitida pela automação.
- **Ação ao responder:** se o XML estiver correto → RT-001/RT-003 viram **ERP (monitorar)** e o
  backlog #1/#4 vira verificação leve; se não → backlog #1/#4 são urgentes + chamado Conexos.

### RT-GAP-2 · `cst-classificacao-itens` — quem classifica o cClassTrib dos itens (41978 e afins)?
O template `comDocProdutos/initialValues` devolveu `dprVldCstIbsCbs: "-1"` (não classificado) no HAR
de produção, e a automação o propaga cegamente (evidência: `RecebimentoNumerarioService.ts:477-491`).
- **Pergunta:** quem é responsável por classificar o CST/cClassTrib IBS/CBS dos produtos usados na
  NDe (41978, e o produto `2` que aparece no item da SN) no cadastro do Conexos? Já está classificado
  hoje (`dprVldCstIbsCbs` ≠ `-1`)? Há um mutirão de classificação em andamento na Columbia?
- **Por quê:** RT-001/RT-008 — item sem classificação ⇒ grupo UB inválido ⇒ rejeição ou perda da
  dispensa. Também explica a divergência `prdCod` 2 × 41978 (com194).
- **Ação ao responder:** destrava backlog #1 (gate fail-closed sabe o que exigir) e #3 (prdCod).

### RT-GAP-3 · `docmnyvalor-zero` — NDe autorizada com valor 0 é aceitável para o fiscal?
Observado em produção (HAR): após homologação, `docMnyValor` 100→0 (item mantém 100). Hoje a
automação só loga warn e conclui (evidência: `RecebimentoNumerarioService.ts:976-984`; pendência #1
de `ontology/integrations/recebimentos-numerario-real-fiscal-spec.md`).
- **Pergunta:** o documento fiscal autorizado fica com base de cálculo ZERO no XML, ou o zero é só um
  artefato da tela com297 (o valor real vive no item)? Se o XML sai zerado: isso é aceitável?
- **Por quê:** RT-007 — DF-e com base zerada = obrigação acessória descumprida (art. 348 §1º).
- **Ação ao responder:** se for artefato de tela → documentar e manter warn; se for base real →
  backlog #2 (bloquear com revisão humana) vira P0 imediato.

## P1 — compliance de negócio (não travam a emissão de amanhã, travam o modelo)

### RT-GAP-4 · `repasse-em-nome-de-quem` — documentos dos custos repassados saem em nome da Columbia ou do cliente?
Art. 12 §2º IV, LC 214: reembolso de custos (frete, armazenagem, despachante, taxas) só fica FORA da
base IBS/CBS da Columbia se o documento do custo estiver **em nome do cliente adquirente**.
- **Pergunta:** na operação real (conta e ordem E encomenda), em nome de quem são emitidos hoje os
  documentos dos custos que a Columbia repassa via Solicitação de Numerário/NDe? Varia por tipo de
  custo? Existe controle disso?
- **Por quê:** RT-005/RT-006 — se saem em nome da Columbia, o numerário repassado INTEGRA a base
  tributável dela (maior exposição financeira do modelo). A automação não registra esse vínculo hoje
  (`RateioRecebimento` não tem o campo).
- **Ação ao responder:** modela backlog #5 (vínculo documental por item repassado) + define se a
  comissão/serviço próprio precisa de item/documento segregado na cobrança.

### RT-GAP-5 · `percentuais-encomenda-ibs-cbs` — os 0,1%/0,9% da regra de encomenda são o IBS/CBS do ano-teste?
A regra-stub `encomenda-percentuais.md` cita exatamente 0,1% / 0,9% — as alíquotas de teste de 2026
(IBS 0,1% + CBS 0,9%, LC 214 art. 348). Coincidência suspeita demais para ignorar.
- **Pergunta:** os "percentuais de encomenda" aplicados na conciliação são o repasse do IBS/CBS-teste
  na importação por encomenda? Se sim: qual a base de cálculo exata, qual o arredondamento praticado,
  e o que muda em 2027 (CBS em alíquota cheia)?
- **Por quê:** RT-009 — se for tributo, a regra tem vigência NORMATIVA (não contratual) e não pode
  sair do STUB sem base legal definida. `ENCOMENDA_PERCENTUAIS_RESOLVED=false` já trava a escrita.
- **Ação ao responder:** alimenta o OfficeHours da Fase 4 (regra `encomenda-percentuais`) com a
  semântica correta + vigência.

## P2 — 2027 (não urgentes, registrar agora)

### RT-GAP-6 · `variacao-cambial-permutas` — a classificação juros/desconto das baixas fin010 é acréscimo financeiro para IBS/CBS?
Nas Permutas, a variação cambial da baixa é roteada para `bxaMnyJuros` (positiva) ou `bxaMnyDesconto`
(negativa) — valores ≠ 0 reais enviados ao fin010 (`ReconciliacaoPermutaService.ts:644-652,714-715`).
Sob o art. 12 §1º, juros/acréscimos integram a base; descontos só ficam fora se incondicionais.
- **Pergunta:** para o fiscal, a variação cambial de adiantamento em permuta lançada nesses campos é
  (a) mera atualização de valor sem natureza de acréscimo financeiro, ou (b) acréscimo/desconto com
  efeito na base IBS/CBS quando a CBS estiver em alíquota cheia (2027)?
- **Ação ao responder:** se (b), abrir `/feature-tweak` para reclassificar o lançamento (campo
  distinto ou documento de ajuste) antes de 2027.

## Registro

- Auditoria NÃO alterou comportamento de produto. Artefatos: gap report + 6 testes de caracterização
  (`RecebimentoNumerario.reformaTributaria.characterization.test.ts`) + este arquivo.
- Gate dry-run confirmado ativo por default (`CONEXOS_DRY_RUN !== 'false'`;
  `EnvironmentProvider.ts:120-121`). Nenhuma chamada dinâmica ao Conexos nesta sessão (sem `.env`).
