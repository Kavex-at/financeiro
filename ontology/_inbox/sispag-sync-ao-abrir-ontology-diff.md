# Ontology Diff Proposal: sispag-sync-ao-abrir

> /feature-tweak LotePagamento, regra `sincronizacao-status-lote-sispag` (I11, ADR-0055).
> **Rascunho. Ainda não aplicado.** Aguarda aprovação do Yuri.
> Base: `origin/main` @ `17874ea`, ontologia **v0.38.0**, último ADR **0065**.

## Análise dos candidatos

| Candidato | Filtros | Decisão |
|---|---|---|
| L11 ganha um 3º gatilho, a abertura da tela (SWR, TTL medido contra a última run finalizada de `sispag-sincronizacao`) | A: Y (o mesmo padrão da carteira, ADR-0060); B: estrutura na ontologia, valores em config; C: Y; D: estende L11, sem ação nova; E: gatilho de ação existente | **ACCEPT**: só texto de gatilho, nenhuma entidade, ação ou estado novo |
| TTL 30 min / limiar de stale / cooldown (valores) | B: valor de instância | **REJECT-CONFIG**: env vars (padrão `SISPAG_*_MIN` do ADR-0060), citados só como default no ADR |
| "Depois da carteira, nunca em paralelo" | C: Y enquanto existir o cap de sessões do robô; restrição de integração, não do domínio | **ACCEPT no ADR**, só uma linha na regra (não vira invariante) |
| Permissão `sispag:ver` basta | consequência de I11a/I11g (read-only no ERP) | **ACCEPT no ADR**. Fica fora da regra, porque RBAC não é ontologia |
| Mudar invariantes I11a–h ou a cadência do cron | A regra já diz que cadência é config | **Sem mudança** (decisão do usuário) |
| Frequência real do cron do GH Actions (2–3x/dia em vez de 12x) | operacional | **REJECT-NOT-DOMAIN**: evidência no ADR, nada na ontologia |

## Arquivos alterados

1. `ontology/business-rules/sincronizacao-status-lote-sispag.md`: seção "Gatilho" + `last_review`
2. `ontology/state-machines/lote-pagamento.md`: coluna "Ação/gatilho" da linha L11
3. `ontology/entities/lote-pagamento.md`: **nenhuma mudança** (as menções a L11, nas linhas 80 e 198, não citam gatilho)
4. `ontology/decisions/0066-sispag-lotes-sincronizam-ao-abrir-a-tela.md`: novo
5. `ontology/_index.json` / `_coverage.json`: versão 0.38.0 → **0.38.1** + nota; `related_files` da regra ganha o service/rota/hook novos quando o TaskScoper fixar os nomes

## Diff

**business-rules/sincronizacao-status-lote-sispag.md: `## Gatilho`**

```diff
-Agendado (cron) + manual ("Sincronizar agora" no card do lote). A cadência é configuração
-operacional, não regra: hoje GitHub Actions, dias úteis, de hora em hora.
+Três gatilhos, a mesma função (L11) e as mesmas invariantes I11a–h:
+
+1. **Abertura da tela do SISPAG** (ADR-0066): *stale-while-revalidate*. A tela mostra o que está
+   gravado e dispara uma passada só se a última run **finalizada** do pipeline
+   `sispag-sincronizacao` (cron, manual ou abertura, todas contam) for mais velha que o TTL. Freios
+   idênticos aos da carteira (ADR-0060): TTL, uma passada por vez (uma run em andamento mais nova que
+   o limiar de stale bloqueia outra) e cooldown depois de passada que falhou. Roda **depois** do
+   refresh da carteira, nunca em paralelo (cap de sessões do robô no Conexos).
+2. **Manual**: "Sincronizar agora" no card do lote (inalterado).
+3. **Agendado (cron)**: rede de segurança para quando ninguém abre a tela.
+
+Cadência, TTL, limiar de stale e cooldown são configuração operacional, não regra. Como L11 é
+read-only no ERP (I11a/I11g), a permissão de ver o SISPAG basta para disparar a passada da abertura.
```

**state-machines/lote-pagamento.md: linha L11, 3ª coluna**

```diff
-| L11 | ... | `sincronizarStatus` (cron agendado + "Sincronizar agora") | ... | 2026-09-29 (ADR-0055) |
+| L11 | ... | `sincronizarStatus` (abertura da tela com TTL + "Sincronizar agora" + cron de segurança — ADR-0066) | ... | 2026-09-29 (ADR-0055); gatilho 2026-10-09 (ADR-0066) |
```

## ADR proposto (rascunho)

> **Número 0066:** livre em `origin/main` e em todas as branches locais/remotas em 2026-10-09.
> Sessões paralelas podem tomá-lo; **renumerar no rebase** se colidir (e a versão 0.38.1 junto).

```markdown
---
adr_number: 0066
title: Os lotes do SISPAG sincronizam com o ERP ao abrir a tela (TTL de 30 min), depois da carteira
date: 2026-10-09
status: accepted
type: change
related_entities: [LotePagamento]
related_actions: [sincronizarStatus]
related_integrations: []
continues: [0055, 0060]
---

## Contexto
O cron `sincronizar-lotes-sispag.yml` (`48 11-22 * * 1-5`, 12 passadas/dia) rodou de fato 2–3
vezes por dia: em 07/10 às 17:57 e 23:19 UTC, em 08/10 às 17:59 e 23:33 UTC e em 09/10 nenhuma
vez até 14:06 UTC. Lotes já baixados no Conexos ficaram em `REMESSA_GERADA` até a analista clicar
em "Sincronizar agora". A operadora espera ver a tela atualizada ao abri-la, como já acontece com
a carteira (ADR-0060).

## Decisão
1. L11 ganha um 3º gatilho, a abertura da tela, com *stale-while-revalidate*. A passada roda só se
   a última run finalizada do pipeline `sispag-sincronizacao` em `job_execucao` (cron, manual ou
   abertura) tiver mais de TTL (default 30 min, env).
2. Os freios são os do ADR-0060: TTL, uma por vez (uma run em andamento mais nova que o limiar de
   stale bloqueia outra) e cooldown depois de uma passada que falhou. A contenção nunca é erro para
   a tela.
3. A passada roda **depois** do refresh da carteira, nunca em paralelo. Cada uma faz fan-out 4, e
   o robô tem cap de sessões (`LOGIN_ERROR_MAX_SESSIONS`).
4. A permissão é `sispag:ver`, porque L11 só lê do ERP (I11a/I11g). O botão por lote não muda.
5. O cron continua como rede de segurança. **Nenhuma invariante I11a–h muda.**

## Consequências
- O estado do lote passa a ter frescor de ≤ TTL para quem abre a tela, sem depender do GH Actions.
- Custo: no máximo uma passada por TTL, serializada atrás da carteira. Com o TTL alto, a abertura
  deixa de sincronizar sem redeploy.
- Escritas locais seguem fora dos flags de escrita no ERP (I11g). A passada sem mudança não sobe
  `versao` (I11h), então aberturas repetidas não geram ruído de concorrência.

## Rejeitado
- Só "consertar o cron": o atraso do agendador do GH Actions não está sob nosso controle
  (REJECT-NOT-DOMAIN).
- Rodar junto com a carteira: estoura o cap de sessões do robô.
```

## Rejeições / watchlist

Nenhum ADR de rejeição separado: as rejeições acima cabem no próprio ADR-0066. Nada vai para a watchlist.

---
Responder: **approve** | **edit [arquivo] [instrução]** | **reject [motivo]** | **partial [...]**

---
**Aprovado em 2026-10-13** pelo usuário, com emenda: um único "Sincronizar agora" na tela (passada completa, `sispag:ver`) substitui o botão por lote. Versão final 0.39.1 (main já estava em 0.39.0). Aplicado no ADR-0066.
