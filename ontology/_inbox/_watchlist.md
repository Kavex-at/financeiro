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
- **Módulo 6 (observabilidade):** transversal, não é entidade/ação única — **semeado** em cada fase
  (correlation id, run de auditoria, logs) e **consolidado na Fase 6** (dashboards/métricas/alertas).
  Não modelar como entidade agora.
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

## Identidade e autorização (ADR-0030, curadoria 2026-08-06)

- **Entidade `Permissao` — NÃO criada (REJECT-PREMATURE).** `role` é atributo **enumerado** de dois
  valores (`'admin' | 'operador'`) sem ciclo de vida próprio; criar a entidade agora seria **modelar o
  vazio**. A dimensão que *seria* entidade/relação — o escopo por filial (`Usuario N—M Filial`) — está
  explicitamente **fora de escopo**. **Promover quando** `app_user_filial` entrar em escopo: aí `role` +
  `filiais` ganham ciclo de vida, e o fechamento do `filialAuthz` fail-OPEN é o gatilho natural
  (`_inbox/supabase-auth-regis-followups.md`).
- **Entidade `Sessao` — NÃO criada (REJECT-NOT-DOMAIN).** Depois da migração para o GoTrue, a sessão é
  **100% propriedade do provedor**: zero linhas no nosso banco, zero invariantes enforçáveis, nenhuma
  ação de domínio. O que era de domínio virou `business-rules/revogacao-de-acesso.md`. **Revisitar só
  se** passarmos a persistir sessão do nosso lado (ex.: device tracking, sessão única por usuário,
  auditoria de login) — aí ela ganha linhas e invariantes, e a decisão muda.
- **`pendenteMigracao` — condição transitória, NÃO estado do ciclo de vida.** Derivada de
  `authUserId IS NULL`, **ortogonal** a `ativo`/`inativo` (em 2026-08-06 todo `app_user` de produção é
  `ativo` **e** pendente ao mesmo tempo). **Vigência 2026-08-06 → Fase 4** do cutover. **Se ainda
  existir em 2026-11**, o cutover empacou e isto deixa de ser condição transitória para virar dívida
  nomeada — reavaliar.
- **Guarda "não pode restar zero admin ativo" — NÃO implementada.** Entrou só a versão barata
  (I-Usuario-6: proibir a **autodesativação**). Rebaixar o último admin para `operador` continua
  possível. A guarda completa exige `COUNT` transacional + tratamento de corrida entre dois admins.
  Note que a ADR-0030 **encarece o escape hatch** ao remover o default hardcoded do `seed-admin`.
- **TTL de 30 s × escala horizontal do Render.** A invalidação do cache de autorização é
  **process-local** e só é suficiente porque o backend roda em instância única (`plan: starter`). **No
  dia da segunda instância**, a latência real de revogação vira o TTL cheio — **sem erro, sem log, sem
  alarme**. Premissa datada em `business-rules/revogacao-de-acesso.md`; revisitar **antes** de escalar,
  não depois.
- **I-Usuario-5 INERTE em produção.** `CONEXOS_CRED_ENC_KEY` ausente do `render.yaml` ⇒ `SecretCipher`
  desabilitado ⇒ o vínculo Conexos por usuário não funciona e **tudo já cai no usuário-robô hoje**. A
  ontologia assevera uma invariante que o ambiente não exerce — registrado porque **uma invariante
  inerte parece cumprida**.
