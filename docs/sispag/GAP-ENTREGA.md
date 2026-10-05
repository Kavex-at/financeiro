# SISPAG (Frente II) — O que falta para considerar entregue

> Revisão de 2026-10-05, sobre a `main` (v0.51.0). Cobre a página `/sispag` (frontend), o módulo
> backend (`routes/sispag.ts`, `domain/**/sispag`, jobs, migrations) e os requisitos de proposta + ontologia.
> **Método:** leitura do código e dos docs + `typecheck` e testes escopados. **Não foi feito nenhum teste ao vivo**
> contra Conexos/banco; o que é "provado em produção" vem dos docs e da memória do projeto (marcado como tal).
> Números de linha são aproximados. Detalhes e evidências: seções 4 e 5.

## 1. Caso de uso escolhido como critério de "entregue"

**UC-1 — Pagamento diário de boletos, Itaú, filiais 1 e 2 (as que já tiveram remessa aceita).**

1. A carteira do dia é ingerida do Conexos (fin064 + alçada com308).
2. O sistema forma lotes candidatos (ou a analista monta à mão), um lote por filial.
3. A analista ajusta e **finaliza** o lote.
4. A analista pede a remessa; o Conexos gera o `.REM` (fin015) e a Kavex valida o CNAB.
5. A remessa chega ao banco (hoje: manual e externa).
6. O banco devolve o `.RET`; o Conexos o processa.
7. A Kavex reflete o resultado: lote `BAIXADO` (tudo pago) ou `RETORNADO` (algum item rejeitado).
8. Tudo é auditável e nada se perde em silêncio.

**Fora do UC-1 (segunda onda):** TED, PIX, destino manual, filiais 4/6/7, lote misto, tributos, internacional (este último está fora de escopo por ADR-0021).

**Definição de pronto do UC-1:** os critérios D1–D6 da seção 6. A letra da proposta (P:102-103) é maior do que isso; a diferença está na seção 3 e precisa de decisão do Yuri.

## 2. Requisitos considerados

Fontes: P = `docs/proposta/Proposta_Kavex_Columbia_Financeiro.md`; SM = `ontology/state-machines/lote-pagamento.md`;
BR = `ontology/business-rules/`; INB = `ontology/_inbox/`. Lista completa extraída dos docs (R-01…R-33, R-F1…F8, perguntas abertas, trilha de produção) em
[`ANEXO-requisitos.md`](ANEXO-requisitos.md); ADRs relevantes: 0015, 0018, 0021, 0039, 0040, 0049, 0050, 0053–0056.

### 2.1 Contratuais (proposta)
| ID | Requisito | Fonte |
|---|---|---|
| C1 | Painel diário dos títulos a vencer e aprovados (com298/fin064) | P:88 |
| C2 | Identificação diária e montagem automática do lote candidato | P:84 |
| C3 | Montagem assistida: analista inclui/exclui títulos | P:89 |
| C4 | Gate de finalização que dispara o processamento; analista tem a palavra final | P:90 |
| C5 | Gerar a remessa **e enviá-la ao diretório Nexxera** (envio automático = passo 2, ver G-07) | P:91, P:102 |
| C6 | Monitorar o retorno bancário | P:92 |
| C7 | Conciliar a baixa no ERP **sem toque manual** | P:93, P:102 |
| C8 | Auditoria de todas as ações (sistema e usuários) | P:94, P:154 |
| C9 | Multi-filial (todas) | P:153 |
| C10 | RBAC, Conexos resiliente, alertas de falha | P:152, 155, 156 |
| C11 | Zero pagamentos perdidos por falha de processo na janela de observação | P:103 |

### 2.2 Regras de negócio (ontologia) que o UC-1 exercita
| ID | Regra | Fonte |
|---|---|---|
| B1 | Só entra no lote título aprovado (alçadas 1/2/3 = 1) e não pago; revalidado na finalização | BR/elegibilidade-titulo-lote |
| B2 | Um título não pode estar em dois lotes vivos | BR/nao-duplicacao-titulo-lote |
| B3 | Um lote = uma filial | BR/lote-uma-filial |
| B4 | Boleto exige boleto DDA associado; sem isso bloqueia **antes** de escrever no ERP | BR/boleto-exige-codigo-de-barras, ADR-0040 |
| B5 | Data de débito escolhível dentro da janela útil; nunca corrigida em silêncio | BR/data-debito-remessa-sispag, ADR-0049 |
| B6 | Escritas no fin015/fin052 não são idempotentes: ledger write-ahead + lock + retomada fail-closed | BR/retomada-remessa-sispag, ADR-0039 |
| B7 | Status do lote segue a baixa do título (fin064 prevalece); sync read-only | BR/sincronizacao-status-lote-sispag, ADR-0055 |
| B8 | Remessa só vira entregável após validação CNAB | INB/sispag-remessa-ground-truth-followups |
| B9 | Conta pagadora default Itaú; Santander só como exceção por fornecedor | INB/sispag-fin015-exploration |

## 3. Divergências contrato × decisão do repo (precisam de decisão, não de código)

| # | Proposta diz | Repo decidiu / realidade | Decisão necessária |
|---|---|---|---|
| D-A | C5: a solução **envia** ao Nexxera | Transporte é externo e manual; não há estado `ENVIADO` nem cliente Nexxera para SISPAG (SM:77-84). O caminho da pasta Nexxera (pergunta B1, TI Columbia) nunca foi respondido | **Decidido em 05/10: dois passos.** Agora o UC-1 termina na geração do `.REM` + marcador humano de "enviado"; a integração Nexxera continua no escopo e vem depois, com o fluxo provado (G-07) |
| D-B | C7: baixa **sem toque manual** | A baixa real é feita pelo Conexos no `.RET` D+1 (usuário `CONEXOS`) ou à mão pela analista; nossa conciliação é manual e nunca rodou em produção | Declarar que "conciliação" da Kavex = refletir o status (ADR-0055), não baixar |
| D-C | C6: monitorar o retorno | Lemos o status por sincronização; não há poller de `.RET` próprio | Idem: aceitar a sincronização como "monitoramento" |
| D-D | C8: auditoria completa | Ledgers de remessa/conciliação existem; trilha das transições de lote e de itens é follow-up P1 não feito | Implementar (item G-09) |

## 4. Estado do UC-1 por etapa

Legenda: ✅ funciona e testado · 🟡 funciona com ressalva · ❌ falta · ❓ não provado ao vivo.

| Etapa | Estado | Evidência / observação |
|---|---|---|
| Ingestão da carteira | ✅ após deploy | Roda em produção (1.398 títulos em 04/10). A run gravava `success` com 0 filiais lidas; corrigido na branch (G-05). Secrets do Actions já refeitos |
| Painel | ✅ | `SispagPainelService`, aba "Títulos a pagar" |
| Formação automática | ✅ após deploy | Bug do título já em remessa corrigido na branch (G-02). Conta pagadora continua fixa (Itaú 55795-4) para todas as filiais (G-13). Inclusão manual ainda tem a brecha (G-21) |
| Montagem manual | ✅ | Frontend e backend alinhados; lock otimista por `versao` (exceto incluir/remover item) |
| Elegibilidade / destino boleto (DDA) | ❌ | O vínculo DDA↔título é feito pelo Conexos (valor, fornecedor, data) e na maioria dos casos não ocorre; quando ocorre a data diferia por dias (G-01). Boleto sem vínculo é bloqueado (B4); as remessas de 16/09 e 22–23/09 pararam aqui. Sincronização DDA não tem cron; o robô recebe 403 na leitura de pendentes |
| Finalização | ✅ | Com confirmação; reabrir/cancelar OK |
| Geração de remessa | 🟡 | Provada em HML e PRD (2 remessas fil 1 e 2 aceitas pelo banco — relato verbal, 24/09). Banco desconhecido agora recusa (G-04); o fallback para a conta da filial é intencional e agora vai para o log |
| Envio ao banco | ❌ | Não existe, por desenho (ver D-A) |
| Retorno `.RET` | ✅ após deploy | `filCod` nulo virava 0 → HTTP 500 no fin050 → BD/00 descartados sem erro; corrigido na branch (G-03), falta confirmar com `.RET` multi-filial real |
| Sync de status | ❓ | Código e testes OK (1612 testes passam); **ground truth ao vivo pendente** (`sync-status-lote-sispag-gt-gap.md`); herda o problema dos secrets e do `filCod` |
| Conciliação própria | 🟡 | Só manual; `processar`/`dryRun` usam `z.coerce.boolean()` (`"false"` vira `true`) numa rota que escreve no fin010 |
| Auditoria | ❌ | Sem trilha de transição de lote/item (follow-up P1) |
| Observabilidade | 🟡 | Reaper só loga warning; sem alerta para remessa falha/indeterminada, ingestão com 0 títulos ou remessa gerada sem retorno |

### 4.1 O que já rodou em produção (verificado em 05/10 nos logs do GitHub Actions)

| Fluxo | Evidência | Leitura |
|---|---|---|
| **Sync de status** (`sincronizar-lotes-sispag`) | 8 execuções agendadas de 30/09 a 03/10, todas `success`. Cada uma leu 5 lotes, **0 falhas de leitura**, `eventosNaoLidos=0`. Em 30/09 e 01/10 houve 4 transições no total; em 03/10 o quadro era **4 lotes `BAIXADO` e 1 `REMESSA_GERADA`** (lote `0298b1ad`, filial 1, títulos 5351 e 3143) | O sync **roda e fecha lotes** em produção. Isso **não** é validação contra o Conexos (G-06). O `eventosNaoLidos=0` não prova nada para `.RET` multi-filial enquanto o G-03 não estiver deployado |
| **Ingestão + formação** (`ingest-sispag`) | Falhou 25–27/09 e 29/09 (login inválido, exit 1); `success` em 28/09, 29/09 (manual), 30/09–04/10. Em 04/10 leu **1.398 títulos** e formou **6 lotes / 100 títulos, desfez 3** | Credenciais voltaram. Como o G-02 ainda não está em produção, esses 6 lotes podem conter título já em remessa |
| **Flag de boleto DDA na ingestão** | Em 04/10 `titulosPendentes/list` respondeu **403 ACCESS_DENIED** para o robô (usuário 138, FIN_041) nas filiais 1–7; o código só avisa e segue (`temBoleto=false`) | Afeta a coluna "tem boleto" e a leitura do DDA pelo cron — entra em G-01 |
| **Reaper** | `success` a cada ~3–6 h (de 04/10 11:32 a 05/10 07:18 UTC), embora o cron peça 15 min | O GitHub atrasa schedules; qualquer SLA baseado nesses crons precisa contar com isso |
| **Detector de staleness** | `success` (4 execuções em 04–05/10) | — |
| **Sync em 05/10** | **Nenhuma execução** de segunda-feira até 15:09 UTC, embora o cron cubra 11–22 UTC em dia útil | Observação, não conclusão: pode ser atraso do GitHub ou o schedule perdido; verificar |
| **Validação ao vivo** (`validate-sync-status-lote-sispag-v1`) | **Não rodou** | G-06 |

> `success` do GitHub Actions **não prova que a carteira foi lida** (memória do projeto, 28–30/09). Para ingestão, o sinal confiável passa a ser a run `error` de G-05, depois do deploy.

## 5. Backlog para entregar o UC-1

Prioridade: **P0** = impede o UC-1 de funcionar ou pode causar pagamento errado; **P1** = necessário para a
aceitação (confiança/auditoria/operação); **P2** = polimento. Cada item tem critério de aceite verificável.

### P0 — bloqueantes

| ID | Item | Critério de aceite |
|---|---|---|
| G-01 | **Boleto: o título nasce sem vínculo com o DDA.** *(Reenquadrado em 05/10 com a informação do time.)* O Conexos faz o vínculo DDA↔título **sozinho**, por valor, fornecedor e data; nos testes com boletos a maioria dos DDA ficou sem título associado, e nos poucos casos que casaram a **data diferia por alguns dias**. Nós **não** vamos criar matching próprio: o problema é a tolerância de data do Conexos e/ou a diferença entre vencimento do título e o do boleto. Trabalho: (1) medir, nos DDA sem vínculo, a distância em dias entre vencimento do boleto e do título, e se valor e fornecedor batem; (2) decidir com a Columbia o tratamento (ajustar o vencimento no título, tolerância configurável no ERP, ou fluxo assistido em que a analista confirma o par e a Kavex só leva o vínculo ao ERP); (3) tornar o `BoletoSemCodigoBarrasError` acionável na tela (qual DDA é o candidato e por que não vinculou); (4) agendar a sincronização DDA (hoje só manual). **Achado novo de produção:** o robô do cron recebe `403 ACCESS_DENIED` (FIN_041) em `fin015/finItemSispag/titulosPendentes/list` em **todas** as filiais (log de 04/10), então o flag `temBoleto` da carteira fica sempre falso nas execuções do cron | Em PRD, um lote real de boletos das filiais 1/2 passa por `gerarRemessa` sem `BoletoSemCodigoBarrasError`; relatório com distribuição da diferença de datas e do motivo de cada DDA sem vínculo; permissão FIN_041 do robô resolvida (ou a leitura movida para um caminho que o robô acesse); cron DDA ativo |
| G-02 | **Duplicação de título entre lotes na formação automática.** ✅ **Corrigido na branch** (`dbe4d0c`): `listElegiveisParaFormacao` agora exclui título em lote `RASCUNHO`, `FINALIZADO`, `REMESSA_GERADA` ou `RETORNADO`. Ressalvas: (a) **não existe UNIQUE parcial no banco** (a migration 0023 diz que a garantia é só do serviço; a ontologia afirma o contrário e está errada); (b) a inclusão **manual** (`loteRascunhoComTitulo`) ainda só olha `RASCUNHO` — ver G-21; (c) um lote `REMESSA_GERADA` abandonado (remessa que nunca foi ao banco) passa a segurar os títulos de forma permanente, sem caminho de liberação | Teste de repositório cobre os 4 estados e a ausência de `CANCELADO` (feito); **depois do deploy**, o próximo `formar-lotes` não lota o título 3143 (lote `0298b1ad`, ainda `REMESSA_GERADA`) |
| G-03 | **`.RET` multi-filial.** ✅ **Corrigido na branch** (`89f0bad`): `filCod` nulo herda a filial da consulta (não vira 0) e a falha de leitura do cadastro de eventos agora é **contada em `eventosNaoLidos`** e logada. Não foi possível reproduzir contra o ERP real | Testes (feitos): `filCod` nulo → filial da consulta; cadastro de eventos que falha → `eventosNaoLidos ≥ 1`. **Depois do deploy:** conferir num `.RET` multi-filial real que BD/00 são lidos |
| G-04 | **Remessa: banco desconhecido e conta divergente.** ✅ **Parcialmente corrigido na branch** (`baa9ea8`): banco fora do mapa FEBRABAN agora **recusa antes de escrever no ERP** (antes virava Itaú 341). **O `contas[0]` foi mantido de propósito:** o lote automático grava a conta Itaú 55795-4 para todas as filiais e o fallback para a conta da filial é o que faz a remessa funcionar (há teste dedicado, "usa a conta pagadora da FILIAL"). Tornar isso erro quebraria as filiais cuja conta é outra. Agora o fallback gera **WARN no log** com a conta do lote e a usada. A correção de fundo é a conta por filial (G-13), que passa a ser pré-requisito | Banco não mapeado lança erro e não chama `criarLote` (feito); WARN do fallback (feito); G-13 elimina o fallback |
| G-05 | **Ingestão que mascara falha.** ✅ **Corrigido na branch** (`a59685d`): nenhuma filial lida (ou Conexos sem filiais) → a run fecha como `error`, a carteira **não é tocada**, o job sai com 1 e entra no alerta de falha do workflow. Leitura parcial continua `success`, mas guarda `error_message` com as filiais que falharam, devolve `filiaisComFalha` e o job emite `::warning::` no Actions. Observação: os secrets já foram refeitos (ingestão leu 1.398 títulos em 04/10); em 29/09 o login inválido já derrubava o job com exit 1, então o caso silencioso era o de login válido e leitura de filial falhando | Testes (feitos): zero filiais → `error` sem `upsert`; parcial → `success` + filiais registradas. **Depois do deploy:** simular credencial ruim num dispatch manual e ver o workflow vermelho |
| G-06 | **Validar o UC-1 ao vivo** (ground truth). **Situação em 05/10:** o script de validação (`validate-sync-status-lote-sispag-v1`) **não foi executado** (o doc `sync-status-lote-sispag-gt-gap.md` segue PENDENTE). O que existe é uso real do sync pelo cron — ver seção 4.1. Falta comparar com o Conexos e levar um lote novo de ponta a ponta | Script roda com sessão de robô e diverge 0 na amostra; lote real chega a `BAIXADO` sem intervenção da Kavex além de "gerar remessa" |
| G-07 | **Envio ao banco em dois passos (decidido em 05/10).** **Passo 1 (agora, dentro do UC-1):** a Kavex gera e valida o `.REM`; o envio segue manual e externo. Entrega: marcador humano "enviado ao banco" e alerta de remessa sem retorno (G-08), e a UI/documentação dizendo claramente que o arquivo não é transmitido. **Passo 2 (futuro, fora do UC-1):** integração Nexxera, **dentro do escopo contratual**, a fazer **depois** que o fluxo estiver provado e robusto; depende da resposta da TI da Columbia sobre a pasta Nexxera (pergunta B1) e da homologação do bancário | ADR registrando os dois passos e o critério de entrada do passo 2 (UC-1 estável em produção por N ciclos, B1 respondida); G-08 entregue |

### P1 — necessários para aceitação

| ID | Item | Critério de aceite |
|---|---|---|
| G-08 | **Marcador humano "enviado ao banco"** (data, quem, protocolo opcional) e alerta de "remessa gerada há N dias úteis sem retorno". **Parte do passo 1 de G-07 — entra no UC-1** | Analista registra o envio na UI; lote exibe a informação; alerta dispara ao passar o limite |
| G-09 | **Auditoria** das transições de lote e da situação dos itens (quem/quando/de→para), consultável na UI | Tabela só-inclusão; toda transição L1–L11 grava ator; tela de histórico por lote |
| G-10 | **Alertas operacionais**: remessa falha/indeterminada, execução `reconciling` presa, ingestão com 0 títulos, sync parado. Reaper deve notificar, não só logar | Cada condição gera `Alerta` visível no painel e/ou notificação externa; teste simula cada uma |
| G-11 | **Segregação de funções**: hoje `sispag:executar` cobre criar, cancelar, remessa, `.REM` e conciliação; `ator()` cai em `'unknown'`; 9 rotas mutantes sem `assertUserCanActOnFilial`; `app_user.role` default `admin` | Permissão específica para `gerarRemessa`/conciliar (ou decisão registrada de manter uma); checagem de filial nas 9 rotas; rota sem usuário → 401, nunca `'unknown'` |
| G-12 | **Conciliação segura**: usar booleanos estritos (como `gerarRemessaSchema`) em `conciliarSchema`; documentar que ela não é parte do UC-1 quando o Conexos baixa sozinho (D-B) | Teste: `"false"` é rejeitado ou vale `false`; ADR/Doc de papel da conciliação |
| G-13 | **Conta pagadora por filial/fornecedor** (hoje fixa em Itaú 55795-4 nos lotes automáticos; a remessa compensa com o fallback para a conta da filial). Pré-requisito para tirar o fallback de G-04 | Auto-lote usa a conta configurada da filial; Santander tratado como exceção ou explicitamente fora; fallback `contas[0]` removido |
| G-14 | **UX de risco no frontend** (ver 5.1) | Os itens F-01…F-07 resolvidos |
| G-15 | **Commitar o trabalho local não versionado** (fixtures `.rem` redigidos, `remessa-cnab.test.ts`, probes novos) — estão untracked na `main` | Arquivos revisados (sem dado sensível) e commitados, ou descartados |
| G-16 | **Confirmar com a Columbia** as perguntas que afetam o UC-1: data de débito em dia não útil/feriado/31-12; envio do arquivo no dia D ou antes; causa da rejeição de 16/09 (fil 7); horário de corte do banco | Respostas registradas no INB e refletidas em B5 |
| G-21 | **Inclusão manual de título só checa lote `RASCUNHO`** (`loteRascunhoComTitulo`, usado em `LotePagamentoService`): a analista consegue colocar num novo rascunho um título que já está em lote `FINALIZADO` ou `REMESSA_GERADA`. Não alterado nesta rodada porque o caso legítimo de **reenvio após rejeição** (`RETORNADO`) e o de remessa abandonada precisam de uma regra de liberação definida pelo negócio | Regra decidida (quais estados bloqueiam a inclusão manual e como liberar um lote abandonado); teste cobrindo os estados; mensagem acionável na tela |

### 5.1 Frontend (`/sispag`)

| ID | Problema | Local | Correção / aceite |
|---|---|---|---|
| F-01 | Filtro "Conciliados" agrupa `RETORNADO` (rejeitado) com `BAIXADO` | `page.tsx:392` | Separar; lote rejeitado nunca aparece como conciliado |
| F-02 | KPI "Lotes candidatos" conta tudo menos CANCELADO; a aba só RASCUNHO | `page.tsx:744` | Mesmo critério nos dois |
| F-03 | Sem confirmação em: remover item, remover destino, "Formar lotes automáticos" (pode desfazer lotes) | `LoteCard.tsx:947`, `page.tsx:818` | Diálogo de confirmação com efeito descrito |
| F-04 | Diálogo "Gerar remessa" fecha antes da chamada e não diz que escreve no Conexos | `GerarRemessaDialog.tsx` | Permanece aberto com progresso; texto explícito |
| F-05 | Erros viram toast "API 500" (código do erro descartado em `loteRequest`/`fetchLotes`/`fetchRetornos`…) | `lib/sispag.ts` | Todas as chamadas traduzem `code`; mensagem em português ao operador |
| F-06 | Painel com erro sem botão de retry; aba Retornos não carrega sozinha e erra só por toast | `page.tsx:712`, `1148` | Estado de erro persistente com retry; carregar ao abrir a aba |
| F-07 | Cada `LoteCard` RASCUNHO chama `fetchContasPagadoras` ao montar (N chamadas ao Conexos); `fetchLotes` carrega todos e pagina no cliente | `LoteCard.tsx:412`, `page.tsx:203` | Carregar ao expandir; paginar no servidor |
| F-08 (P2) | Faltam telas: execuções (`GET /execucoes`), sync em massa, divergências entre itens, histórico por lote | — | Ao menos execuções `reconciling`/`error` visíveis (liga com G-10) |
| F-09 (P2) | "Lançamento Lote (REM)" sem vazio, busca, filtro ou paginação | `page.tsx:1063` | Padrão das outras abas |
| F-10 (P2) | A11y/DS: `aria-label` genérico nos checkboxes, falta `aria-pressed`, cor amber fixa, botão desabilitado sem tooltip, `AdicionarTituloDialog` corta em 300 sem avisar, 2 warnings de lint | vários | Conforme DesignSystemReviewer |
| F-11 (P2) | `listLotesSchema.status` aceita só 3 dos 6 estados | `routes/sispag.ts:~170` | Alinhar ao tipo do front |
| F-12 (P2) | Usuário só-leitura não vê aviso de "somente leitura" | `page.tsx:169` | Aviso visível |

### P2 — dívida e documentação
- G-17: Documentação desatualizada: `actions/sispag/finalizar-lote.md` ("sem downstream"), BRs de elegibilidade / lote-uma-filial / não-duplicação e `_index.json` com `planned`; faltam arquivos de ação de `gerarRemessa` e `conciliarRetorno`; cabeçalho de `routes/sispag.ts` ("SPIKE READ-ONLY"), comentários "admin" e "CRON não configurado".
- G-18: `routes/sispag.ts` (924 linhas) e `RemessaService` (1602 linhas) monolíticos; rotas resolvem client/repositório direto (migration-debt).
- G-19: Janela de ingestão (-15d/+45d), teto de 25 títulos por lote e horizonte de 7 dias hardcoded; revisar com os dados de `docs/impacto/h2-sispag-achados.md`.
- G-20: Gate do frontend: `npm run typecheck` falha por `@radix-ui/react-dropdown-menu` ausente (fora do SISPAG; checar `package.json`/lockfile).

## 6. Critérios de aceite do UC-1 (checklist de entrega)

- [ ] **D1** Um lote de boletos Itaú da filial 1 **e** da 2, montado na UI, vai de `RASCUNHO` a `BAIXADO` em produção, com a remessa aceita pelo banco (G-01, G-06). *(Hoje bloqueado pelo vínculo DDA.)*
- [ ] **D2** Nenhum título aparece em dois lotes vivos (G-02 na formação automática — corrigido na branch, falta deploy; G-21 na inclusão manual).
- [ ] **D3** Falha em qualquer filial da ingestão, em `.RET` multi-filial ou em escrita no Conexos **aparece** como erro/alerta (G-03, G-04, G-05, G-10).
- [ ] **D4** Existe trilha de auditoria por lote com ator e horário (G-09).
- [ ] **D5** A decisão de dois passos para o envio ao banco está registrada em ADR (G-07), o marcador "enviado" e o alerta de remessa sem retorno existem (G-08), e a UI diz a verdade sobre o que a Kavex faz e não faz (D-A…D-D).
- [ ] **D6** `typecheck`, `lint`, testes e a validação ao vivo (ground truth) passam; sem pendência P0 nos itens acima.

## 7. Estado dos gates desta revisão

| Verificação | Resultado |
|---|---|
| Backend `npm run typecheck` | passa |
| Backend Jest escopado (SISPAG, routes, http, jobs) | antes das correções: 61 suítes / 1612 testes; **depois: 63 suítes / 1603 testes, todos passam** (o escopo de busca diferiu entre as duas medições; +8 testes novos) |
| Backend `npm run typecheck` (após as correções) | passa |
| Backend `test:sql` (migrations 0067–0069) | **não executado** (exige Postgres) |
| Frontend `npm run typecheck` | 1 erro, fora do SISPAG (dependência ausente) |
| Frontend `npm run lint` | 0 erros, 19 warnings (2 em SISPAG) |
| Frontend testes SISPAG | 7 suítes / 122 testes passam |

Testes verdes **não** provam o UC-1: a conciliação própria nunca rodou em produção, TED/PIX estão atrás de flags
desligadas e o ground truth do sync está pendente.

## 8. Limites desta revisão
- Conclusões sobre produção (remessas aceitas, `.RET` D+1, 0 códigos de barras, secrets quebrados) vêm dos docs e da memória do projeto, com datas até 02/10; **não foram reverificadas**. Reconfirmar G-05 e os números de G-01 antes de agir.
- Não foram auditados `/metricas` e `/operacao` (painéis que também medem SISPAG), nem a conformidade LGPD além do que as rotas expõem.
- G-02 a G-05 foram relidos no código e corrigidos com testes unitários (mocks). Os testes **não** substituem a confirmação em produção descrita em cada item. O banco não foi consultado: o `docs` de ontologia que fala em UNIQUE parcial foi contrastado com a migration 0023, não com o banco real.
