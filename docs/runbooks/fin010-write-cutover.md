# Runbook — Cutover da escrita `fin010` (dry-run → baixa real)

> Fase 3 (ADR-0013) — risco arquitetural #1. A baixa/permuta no `fin010` é a **primeira escrita** do
> sistema no Conexos e é **irreversível por nós** (o estorno é manual, na UI do `fin010`). Este runbook é
> o procedimento para destravar a escrita com segurança. **Homologação-first, sempre.**

## Flags (EnvironmentProvider / Render)

| Flag | Default seguro | Efeito |
|------|----------------|--------|
| `CONEXOS_BASE_URL` | (Render, `sync:false`) | ERP alvo. Homologação = `https://columbiatrading-hml.conexos.cloud/api` |
| `CONEXOS_WRITE_ENABLED` | `false` | Liga o caminho de escrita. `false` ⇒ tudo vira dry-run |
| `CONEXOS_DRY_RUN` | `true` | `true` ⇒ monta/loga o payload SEM POST |

**Escrita real só acontece com `CONEXOS_WRITE_ENABLED=true` E `CONEXOS_DRY_RUN=false`.** Qualquer outra
combinação ⇒ dry-run. O `EnvironmentProvider` é `@singleton` com cache — **mudar flag exige restart** do
serviço (redeploy/restart no Render).

## Procedimento

### Fase 1 — Homologação (obrigatória antes de produção)
1. No Render (ou `.env` local), defina: `CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api`,
   `CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`. Restart.
2. Garanta que existe **1 par adto→invoice controlado e reversível** com alocação feita (`permuta_alocacao`).
3. Na UI: Permutas → aba cross-process → **Baixar** → confira o **preview (dry-run)**:
   - rode primeiro com `CONEXOS_DRY_RUN=true` (preview) e confira invoice/juros/conta;
   - depois `=false` e **Executar baixa**.
4. Confirme no `fin010` de homologação: borderô criado, baixa/permuta gravada (`bxaCodSeq`).
5. Confira a trilha: `GET /permutas/adiantamentos/:docCod/execucoes` → status `settled` com `bor_cod`/`bxa_cod_seq`.

### Fase 2 — Produção (1 caso real controlado)
1. Só após a Fase 1 verde. Aponte `CONEXOS_BASE_URL` de volta para produção. Restart.
2. Mantenha `CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`.
3. Execute **UM** par adto→invoice combinado com o analista, ao vivo, **reversível** (o analista sabe estornar).
4. Confira no ERP + na trilha de execução. Se algo divergir, **estorne no `fin010`** e investigue.

## Rollback / desligar a escrita
- **Imediato:** `CONEXOS_DRY_RUN=true` (ou `CONEXOS_WRITE_ENABLED=false`) + restart → nenhuma escrita nova.
- **Baixa já gravada:** não há rollback automático — **estornar manualmente no `fin010`** (UI). A linha em
  `permuta_alocacao_execucao` fica `settled`; um job de conciliação (follow-up) detectará a divergência.
  **Cobertura insuficiente (ADR-0043):** quando a soma do **em aberto** dos títulos não cobre o
  `valorAlocado`, a execução **aborta antes do 1º POST** (422 `ALOCACAO_SEM_COBERTURA`, nada
  escrito). Para o que escapar dessa janela, a linha fica **`parcial`** com `valor_residual_usd`,
  **não** `settled`. Um `parcial` é pendência: **re-aloque o par** para lançar o que faltou (a chave
  de idempotência inclui o `atualizado_em` da alocação, então re-alocar libera o novo lançamento).

### Rollback do código com linhas `parcial` já gravadas

> **Leia isto ANTES de reverter o commit da ADR-0043.** Migrations são forward-only: reverter o
> código **não** remove o estado `parcial` do banco, e a versão anterior não sabe o que ele significa.
> O `beginExecution` antigo só preserva `= 'settled'`, então uma linha `parcial` cairia no ramo ELSE,
> voltaria para `reconciling` e o serviço **re-POSTaria uma baixa que já existe no `fin010`**.

Passos, nesta ordem:

1. **Corte a escrita primeiro:** `CONEXOS_WRITE_ENABLED=false` + restart. Nada de novo entra enquanto
   você audita.
2. **Veja se existe alguma linha `parcial`:**
   ```sql
   SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod,
          bor_cod, bxa_cod_seq, valor_baixado, valor_residual_usd
     FROM permuta_alocacao_execucao
    WHERE status = 'parcial';
   ```
   **Nenhuma linha ⇒ pode reverter sem mais nada.** Este é o caso enquanto o delta não tiver produzido
   a primeira baixa parcial em produção.
3. **Havendo linhas:** para cada uma, confira no `fin010` (pelo `bor_cod`) o que de fato foi baixado.
   O `bxa_cod_seq` estar preenchido significa que a baixa **existe** — o resíduo é o que faltou.
4. **Só depois de auditar**, converta cada linha para o vocabulário que a versão antiga entende:
   ```sql
   UPDATE permuta_alocacao_execucao
      SET status = 'settled'
    WHERE status = 'parcial' AND idempotency_key = $1;   -- uma a uma, após conferir no ERP
   ```
   Isso **perde** a informação do resíduo — anote `valor_residual_usd` antes, porque o saldo continua
   em aberto no adiantamento e vai precisar de re-alocação depois.
5. **Agora sim** reverta o commit e faça o deploy.

**Se você pular estes passos**, a migration `0055` te protege: um trigger no banco recusa reabrir
qualquer execução com `bxa_cod_seq` preenchido, e a rota devolve **500** em vez de duplicar a baixa.
Isso é rede de segurança, não procedimento — o 500 aparece para a analista no meio do trabalho dela.

## Sinais de problema
- Linha presa em `reconciling` em `permuta_alocacao_execucao`: o processo morreu entre o POST e a confirmação.
  Cheque no `fin010` (pelo `bor_cod` persistido) se a baixa entrou; se sim, marque `settled` manualmente; se
  não, retry.
- **409 `RECONCILIACAO_EM_ANDAMENTO`** *(ADR-0043)*: outra execução do MESMO adiantamento está em voo
  agora (advisory lock). Não é erro de escrita e **nada foi enviado ao ERP** — espere alguns segundos
  e recarregue. Não clique de novo.
- **422 `ALOCACAO_SEM_COBERTURA`** *(ADR-0043)*: o em aberto dos títulos da invoice não cobre o
  `valorAlocado` — **nada foi escrito**. Confira no ERP se algum título foi renegociado/cancelado
  depois da alocação e re-aloque o par pelo valor que de fato cabe.
- **`status='parcial'`** *(ADR-0043)*: a baixa entrou, mas não cobriu todo o alocado; o que faltou
  está em `valor_residual_usd`. O borderô existe e pode ser finalizado; o resíduo se resolve
  **re-alocando o par**. Não marque `settled` à mão.
- `status='error'` com `erp_response`: leia a mensagem do ERP; corrija e re-execute (idempotente — par já
  `settled` é pulado).

## Invariantes que o código já garante
- Anti-super-pagamento: o valor vem do em-aberto vivo do ERP (passo 2); em-aberto ≤ 0 ⇒ aborta.
- Anti-drift (I-Write-1): aborta se o ERP quer baixar **mais** que o alocado esperado, **por título**.
- Idempotência por par adto↔invoice **e por versão da alocação** (a chave inclui `atualizado_em`
  da alocação: re-alocar o par libera um novo lançamento, por decisão);
  escritas (criar borderô / gravar baixa) são **tentativa única** (sem retry → sem baixa duplicada).
- **I-Recon-5 (serialização por adiantamento):** advisory lock por `adiantamentoDocCod`. Dois
  analistas reconciliando o **mesmo** adiantamento em janela sobreposta não geram mais dois borderôs:
  o segundo recebe 409 e **não toca o ERP**. Adiantamentos distintos seguem em paralelo.
- **I-Write-8 (fechamento do alocado):** o em aberto de cada título é **derivado**
  (`titMnyValorMneg − titMnyTotPago / titFltTaxaMneg`), porque `titVldStatus = 1` significa **ATIVO**
  (ciclo de vida do registro), não "em aberto" — título quitado volta na lista com face cheia.
  Cobertura insuficiente detectada **antes** do 1º POST ⇒ 422; detectada **depois** ⇒ `parcial` com
  resíduo. Nunca `settled` mudo.
  *(Título baixado externamente **não** é este caso: ele já falha ruidosamente no passo 2. O caso
  real é título **renegociado ou cancelado depois da alocação**.)*

> **Vigência.** As duas linhas acima entraram com a ADR-0043. Se estiver diagnosticando um incidente,
> confirme que a versão em produção já as traz — `GET /health` devolve a `version`, e a ADR aparece
> no `CHANGELOG.md` da release que a introduziu. Em versão anterior, valem as mitigações manuais:
> combinar quem reconcilia qual adto, e cruzar `valorPermutar` (ERP) × soma das baixas registradas.
