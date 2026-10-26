# Boleto agrupado — roteiro de rollout e acompanhamento (Task 24, ADR-0077)

**Não há flag: o merge é o rollout.** O fluxo fica ativo no deploy, sob os kill-switches existentes.
**Parar tudo:** `SISPAG_LIVE_WRITE_ENABLED=false` (desliga a escrita do borderô e as demais escritas do SISPAG).
Com `CONEXOS_DRY_RUN` ligado ou a escrita Conexos desligada, a etapa `preparar_bordero` só simula
(execução `simulado`, log, zero escrita).

## Antes do merge (portões, `sispag-boleto-agrupado-tasks.md`)

- [ ] Task 21 — HML ponta a ponta: `canonico` **feito** (2026-10-26, borderô 253); faltam `falha` (V3), `retomada`, `v7`.
- [ ] Task 22 — medição PRD só leitura GT1/GT2 (`jobs/validate-sispag-boleto-agrupado-v1.ts`), com o go do maintainer, fora do horário de remessa.
- [ ] Task 25 — gates finais (PatternGuardian, Regis-Review, rebase, versão, PR).

## Primeiro grupo real (com o maintainer, em tela, não pelo cron)

1. **Escolha de propósito.** PEDRONI 38883–38885 × boleto 332841 (R$ 1.575,00, vencimento 21/10) se ainda estiver em aberto; senão o próximo grupo confirmável da medição GT1. Nunca um grupo que o cron formaria sozinho.
2. **Confirmar** o grupo na aba "Boletos agrupados", conferindo na tela os N títulos, o valor e a máscara do código. Quem confirma é a analista, com o maintainer ao lado.
3. **Montar o lote** com o grupo e **gerar a remessa** em horário de baixo movimento.
4. **Conferir, nesta ordem:**
   - `fin010`: o borderô do grupo (`borCod`, `borTimCad` no ledger), **em cadastro**, com N baixas, uma por título, total = boleto. **Nunca finalizar nem cancelar o borderô à mão.**
   - Item do lote: **um** item nativo com `borCod`, valor = boleto, sem `docCod/titCod`.
   - `.REM`: **um** J, barra == pagamento == soma dos títulos (a guarda I16 já confere; olhar o arquivo na primeira vez).
   - Retorno: o J do banco devolvido com o `borCod`; N títulos `vldPago 1`, borderô finalizado **pelo ERP**, grupo `PAGO`.
5. Divergência em qualquer passo ⇒ `/investigate`, nada de correção à mão no ERP.

## Primeiro `.RET` real com item de borderô (V6 / GT3)

- Só leitura: o `fin052` da execução, linhas de detalhe (J), `itsCodSeq`, `borCod` e a ocorrência.
- Registrar em `sispag-boleto-agrupado-hml-achados.md` ("PRD só leitura"). Se a linha vier diferente da medida em HML (casamento por `borCod`), abrir `/investigate`.

## Contagens da primeira semana

Rodar no banco de PRD (somente leitura), comparar com a medição GT1/GT2 da Task 22:

```sql
-- grupos por estado
SELECT estado, count(*) FROM sispag_grupo_boleto GROUP BY estado;
-- execuções por etapa (retirado, limpeza_pendente, indeterminado merecem olho)
SELECT etapa, count(*) FROM sispag_grupo_boleto_execucao GROUP BY etapa;
-- trilha por tipo de evento
SELECT tipo, count(*) FROM sispag_grupo_boleto_evento
 WHERE ocorrido_em >= $inicio GROUP BY tipo;  -- GRUPO_CONFIRMADO/PAGO/RETIRADO/DIVERGENTE, BORDERO_*
-- alertas do grupo
SELECT severidade, count(*) FROM alerta
 WHERE tipo = 'sispag-bordero-grupo-pendente' AND janela_inicio >= $inicio GROUP BY severidade;
```

Metas de leitura (não são regra): `GRUPO_DIVERGENTE` e `indeterminado` devem ser **zero**; qualquer
`limpeza_pendente` ou alerta `sispag-bordero-grupo-pendente` é um borderô em cadastro no ERP que a analista
precisa resolver. Se o número de grupos pagos ficar muito abaixo do que a GT1 previu, ver os motivos de
retirada (`GRUPO_BOLETO_FALHOU`, `BORDERO_ANTERIOR_NAO_RESOLVIDO`) antes de mexer em regra.

## V1 — permissão do login do robô (conferência do dono, não portão)

Permissão do robô em `fin010` (borderô/baixa) e `fin015 borderosPendentes`. Sem ela, o primeiro grupo
falha na `preparar_bordero` com erro nomeado e **nada é escrito**; ver com a Columbia (matriz `ger014`).

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Alerta `sispag-bordero-grupo-pendente` (`limpeza_pendente`) | Borderô em cadastro no ERP: a analista exclui/cancela **lá**; o sistema não finaliza nem cancela. |
| J rejeitado (`REJEITADO`) | O grupo não volta sozinho a uma remessa; resolver o borderô antigo no ERP, depois incluir de novo (reaproveita se reaparecer pendente). |
| `indeterminado` | Parar e `/investigate`; nada foi escrito além do ledger. |
| Parar o rollout | `SISPAG_LIVE_WRITE_ENABLED=false`; grupos `CONFIRMADO` seguem confirmados, sem remessa. |
