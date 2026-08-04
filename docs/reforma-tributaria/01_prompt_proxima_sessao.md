# Prompt — Sessão de Auditoria: solução atual × Fonte da Verdade IBS/CBS

> Copiar o bloco abaixo como prompt inicial da próxima sessão do Claude Code neste repo.
> Fase seguinte (após a auditoria): implementação dos gaps priorizados via `/feature-tweak`/`/feature-new`.

---

```
Esta sessão é uma AUDITORIA DE CONFORMIDADE, não uma sessão de implementação.

Fonte da verdade: docs/reforma-tributaria/00_fonte_da_verdade_ibs_cbs.md (leia primeiro, na íntegra).
Em conflito entre código/ontologia e esse documento, o documento prevalece.

## Objetivo
Testar e auditar a solução atual (Frente IV — Conciliação de Recebimentos/NDe em primeiro lugar;
Frentes I e II em segundo) contra os requisitos RT-001..RT-014 do §10 do documento, e produzir um
gap report com evidências. NÃO implementar mudanças de produto nesta sessão.

## Passos

1. Para cada RT-001..RT-014, localize o código/config relevante e colete evidência (file:line).
   Pontos de partida já mapeados:
   - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts (orquestrador; etapas
     sn → fin014 → nota-debito → fiscal → obs → homologado → poll)
   - src/backend/domain/service/recebimentos/SnPayloadBuilder.ts (payloads com299/com297)
   - src/backend/domain/client/ConexosNdeFiscalClient.ts (com300 fisVldTipoNfDebito=6, com131, com194)
   - src/backend/domain/client/ConexosNdeClient.ts (homologação com297, ContingenciaDecider)
   - src/backend/domain/service/recebimentos/constants.ts (NDE_*, ENCOMENDA_PERCENTUAIS_RESOLVED)
   - Propagação cega de dprVldCstIbsCbs:"-1" em RecebimentoNumerarioService.ts:477-491
   - Hard-zero de juros/multa/desconto em RecebimentoNumerarioService.ts:803-827
   - Warn não-bloqueante de docMnyValor=0 em RecebimentoNumerarioService.ts:978-984
   - ontology/business-rules/{separacao-multa-juros,encomenda-percentuais,adiantamento-cliente}.md (STUBs)
   - ontology/integrations/recebimentos-numerario-real-fiscal-spec.md (7 pendências fiscais do HAR real)

2. Rode a suíte existente (cd src/backend && npm test, npm run typecheck) e registre o baseline.
   Onde faltar evidência de comportamento, escreva TESTES DE CARACTERIZAÇÃO (podem ser commitados —
   são testes, não mudança de produto): ex. "o payload da SN propaga dprVldCstIbsCbs=-1",
   "fin014 envia juros/multa/desconto = 0", "docMnyValor=0 não bloqueia o fluxo",
   "fisVldTipoNfDebito é sempre 6 independente da hipótese".

3. Verificação dinâmica (SOMENTE dry-run/homologação — NUNCA escrita real em produção; o gate
   dryRun default do RecebimentoNumerarioService deve permanecer ativo): se houver acesso ao
   Conexos de homologação, capture o que o ERP devolve hoje em validaConfigDoc,
   comDocProdutos/initialValues (CST IBS/CBS) e, se disponível, um XML de NDe autorizada
   pós-03/08/2026 (verificar grupos UB/W03, finNFe, tpNFDebito, DFeReferenciado). Se não houver
   acesso, marque como INDETERMINADO com o que seria necessário para verificar.

4. Produza docs/reforma-tributaria/02_auditoria_gap_report.md com:
   - Tabela RT × veredito (CONFORME / GAP / INDETERMINADO / ERP) × evidência × severidade
   - Lista dos testes de caracterização criados
   - Riscos ordenados (o que pode rejeitar NF, o que perde a dispensa do art. 348, o que é compliance
     de negócio da Columbia)
   - Backlog priorizado para a fase de implementação, com sugestão de entrada no pipe
     (/feature-tweak ou /feature-new por item) — SEM implementar

5. Registre os info-gaps que dependem do fiscal da Columbia (os 4 do §10 do documento, mais os que
   surgirem) em ontology/_inbox/reforma-tributaria-gap.md no formato do InfoGapBroker.

## Restrições
- Nenhuma mudança de comportamento de produto nesta sessão (testes de caracterização e docs são ok).
- Nenhuma escrita real no Conexos (dry-run only; escrita fiscal é irreversível).
- Human-in-the-loop: qualquer dúvida de domínio fiscal vira info-gap no _inbox, não suposição.
```
