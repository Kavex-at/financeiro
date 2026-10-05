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
| C5 | Gerar a remessa **e enviá-la ao diretório Nexxera** | P:91, P:102 |
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
| D-A | C5: a solução **envia** ao Nexxera | Transporte é externo e manual; não há estado `ENVIADO` nem cliente Nexxera para SISPAG (SM:77-84). O caminho da pasta Nexxera (pergunta B1, TI Columbia) nunca foi respondido | (a) entregar envio automático (depende da resposta de B1 + homologação do banco) **ou** (b) formalizar por escrito que o UC-1 termina na geração do `.REM`, com marcador humano de "enviado" |
| D-B | C7: baixa **sem toque manual** | A baixa real é feita pelo Conexos no `.RET` D+1 (usuário `CONEXOS`) ou à mão pela analista; nossa conciliação é manual e nunca rodou em produção | Declarar que "conciliação" da Kavex = refletir o status (ADR-0055), não baixar |
| D-C | C6: monitorar o retorno | Lemos o status por sincronização; não há poller de `.RET` próprio | Idem: aceitar a sincronização como "monitoramento" |
| D-D | C8: auditoria completa | Ledgers de remessa/conciliação existem; trilha das transições de lote e de itens é follow-up P1 não feito | Implementar (item G-09) |

## 4. Estado do UC-1 por etapa

Legenda: ✅ funciona e testado · 🟡 funciona com ressalva · ❌ falta · ❓ não provado ao vivo.

| Etapa | Estado | Evidência / observação |
|---|---|---|
| Ingestão da carteira | 🟡 | Funciona e roda em produção, mas a run grava `success` mesmo quando **todas** as filiais falham (`IngestaoPagamentosService.ts:187-210`). Secrets Conexos do GitHub Actions estavam desatualizados em 28–30/09 e congelaram a carteira sem alarme (memória) |
| Painel | ✅ | `SispagPainelService`, aba "Títulos a pagar" |
| Formação automática | ❌ | **Bug:** `listElegiveisParaFormacao` só exclui título em lote `RASCUNHO`; título já em remessa volta para novo lote (viola B2; caso 3143 em 02/10). Conta pagadora é fixa (Itaú 55795-4) para todas as filiais |
| Montagem manual | ✅ | Frontend e backend alinhados; lock otimista por `versao` (exceto incluir/remover item) |
| Elegibilidade / destino boleto (DDA) | ❌ | Em produção **0 de 38.393 títulos têm código de barras** e só 4 de 2.672 itens do fin124 estão ligados a título; boleto sem DDA é bloqueado (B4). As remessas de 16/09 e 22–23/09 pararam aqui. Sincronização DDA não tem cron |
| Finalização | ✅ | Com confirmação; reabrir/cancelar OK |
| Geração de remessa | 🟡 | Provada em HML e PRD (2 remessas fil 1 e 2 aceitas pelo banco — relato verbal, 24/09). Defeitos silenciosos: conta não encontrada cai em `contas[0]`; banco desconhecido vira Itaú (`?? 341`) |
| Envio ao banco | ❌ | Não existe, por desenho (ver D-A) |
| Retorno `.RET` | ❌ | **Bug:** `ConexosSispagRetornoClient.ts:146` faz `Number(r.filCod)`; `.RET` multi-filial tem `filCod` nulo → 0 → HTTP 500 no fin050 → eventos BD/00 descartados sem erro |
| Sync de status | ❓ | Código e testes OK (1612 testes passam); **ground truth ao vivo pendente** (`sync-status-lote-sispag-gt-gap.md`); herda o problema dos secrets e do `filCod` |
| Conciliação própria | 🟡 | Só manual; `processar`/`dryRun` usam `z.coerce.boolean()` (`"false"` vira `true`) numa rota que escreve no fin010 |
| Auditoria | ❌ | Sem trilha de transição de lote/item (follow-up P1) |
| Observabilidade | 🟡 | Reaper só loga warning; sem alerta para remessa falha/indeterminada, ingestão com 0 títulos ou remessa gerada sem retorno |

## 5. Backlog para entregar o UC-1

Prioridade: **P0** = impede o UC-1 de funcionar ou pode causar pagamento errado; **P1** = necessário para a
aceitação (confiança/auditoria/operação); **P2** = polimento. Cada item tem critério de aceite verificável.

### P0 — bloqueantes

| ID | Item | Critério de aceite |
|---|---|---|
| G-01 | **Boleto sem DDA/código de barras** (origem do problema: 73% dos itens com barras sem vínculo DDA). Definir o caminho viável: confirmar hipótese "ERP só associa com vencimento idêntico", ou resolver a barras por outra via. Agendar a sincronização DDA (hoje só manual) | Em PRD, um lote real de boletos das filiais 1/2 passa por `gerarRemessa` sem `BoletoSemCodigoBarrasError`; taxa de itens bloqueados medida e documentada; cron DDA ativo |
| G-02 | **Duplicação de título entre lotes**: `listElegiveisParaFormacao` deve excluir títulos em qualquer lote vivo (RASCUNHO, FINALIZADO, REMESSA_GERADA, RETORNADO) | Teste de repositório: título em lote `REMESSA_GERADA` não é elegível; teste SQL do UNIQUE parcial cobre os 4 estados |
| G-03 | **`.RET` multi-filial**: tratar `filCod` nulo em `ConexosSispagRetornoClient` (não coagir a 0) e falhar alto quando o fin050 não responder | Teste com fixture de `.RET` multi-filial lê BD/00 de todas as filiais; erro do fin050 vira `eventosNaoLidos>0` e alerta, nunca silêncio |
| G-04 | **Falhas silenciosas na remessa**: conta pagadora inexistente → erro (não `contas[0]`); banco fora do mapa → erro (não Itaú) | Testes: lote com conta inexistente e `bncCod` desconhecido lançam erro de domínio antes de qualquer escrita no Conexos |
| G-05 | **Ingestão que mascara falha**: run `success` só se ao menos uma filial lê títulos; falha total/parcial vira `error`/`partial` + alerta. Corrigir os secrets dos crons e testá-los | Run com Bad Credentials em todas as filiais aparece como falha; alerta chega a um humano; workflow de teste manual verde |
| G-06 | **Validar o UC-1 ao vivo** (ground truth): sync de status contra Conexos em PRD, e uma remessa de ponta a ponta (filial 1 ou 2) até `BAIXADO`, comparando com o Conexos | Script `validate-sync-status-lote-sispag` roda com sessão de robô e diverge 0 na amostra; lote real chega a `BAIXADO` sem intervenção da Kavex além de "gerar remessa" |
| G-07 | **Decidir D-A (envio ao banco)** e registrar por escrito (ADR) | ADR publicada; se (b), ver G-08; se (a), abrir feature com B1 respondida |

### P1 — necessários para aceitação

| ID | Item | Critério de aceite |
|---|---|---|
| G-08 | **Marcador humano "enviado ao banco"** (data, quem, protocolo opcional) e alerta de "remessa gerada há N dias úteis sem retorno". Só se D-A = (b) | Analista registra o envio na UI; lote exibe a informação; alerta dispara ao passar o limite |
| G-09 | **Auditoria** das transições de lote e da situação dos itens (quem/quando/de→para), consultável na UI | Tabela só-inclusão; toda transição L1–L11 grava ator; tela de histórico por lote |
| G-10 | **Alertas operacionais**: remessa falha/indeterminada, execução `reconciling` presa, ingestão com 0 títulos, sync parado. Reaper deve notificar, não só logar | Cada condição gera `Alerta` visível no painel e/ou notificação externa; teste simula cada uma |
| G-11 | **Segregação de funções**: hoje `sispag:executar` cobre criar, cancelar, remessa, `.REM` e conciliação; `ator()` cai em `'unknown'`; 9 rotas mutantes sem `assertUserCanActOnFilial`; `app_user.role` default `admin` | Permissão específica para `gerarRemessa`/conciliar (ou decisão registrada de manter uma); checagem de filial nas 9 rotas; rota sem usuário → 401, nunca `'unknown'` |
| G-12 | **Conciliação segura**: usar booleanos estritos (como `gerarRemessaSchema`) em `conciliarSchema`; documentar que ela não é parte do UC-1 quando o Conexos baixa sozinho (D-B) | Teste: `"false"` é rejeitado ou vale `false`; ADR/Doc de papel da conciliação |
| G-13 | **Conta pagadora por filial/fornecedor** (hoje fixa) | Auto-lote usa a conta configurada da filial; Santander tratado como exceção ou explicitamente fora |
| G-14 | **UX de risco no frontend** (ver 5.1) | Os itens F-01…F-07 resolvidos |
| G-15 | **Commitar o trabalho local não versionado** (fixtures `.rem` redigidos, `remessa-cnab.test.ts`, probes novos) — estão untracked na `main` | Arquivos revisados (sem dado sensível) e commitados, ou descartados |
| G-16 | **Confirmar com a Columbia** as perguntas que afetam o UC-1: data de débito em dia não útil/feriado/31-12; envio do arquivo no dia D ou antes; causa da rejeição de 16/09 (fil 7); horário de corte do banco | Respostas registradas no INB e refletidas em B5 |

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

- [ ] **D1** Um lote de boletos Itaú da filial 1 **e** da 2, montado na UI, vai de `RASCUNHO` a `BAIXADO` em produção, com a remessa aceita pelo banco (G-01, G-06).
- [ ] **D2** Nenhum título aparece em dois lotes vivos (G-02).
- [ ] **D3** Falha em qualquer filial da ingestão, em `.RET` multi-filial ou em escrita no Conexos **aparece** como erro/alerta (G-03, G-04, G-05, G-10).
- [ ] **D4** Existe trilha de auditoria por lote com ator e horário (G-09).
- [ ] **D5** A decisão sobre "envio ao banco" e "conciliação" está registrada e a UI diz a verdade sobre ela (G-07, G-08, D-A…D-D).
- [ ] **D6** `typecheck`, `lint`, testes e a validação ao vivo (ground truth) passam; sem pendência P0 nos itens acima.

## 7. Estado dos gates desta revisão

| Verificação | Resultado |
|---|---|
| Backend `npm run typecheck` | passa |
| Backend Jest escopado (SISPAG, routes, http) | 61 suítes / 1612 testes passam |
| Backend `test:sql` (migrations 0067–0069) | **não executado** (exige Postgres) |
| Frontend `npm run typecheck` | 1 erro, fora do SISPAG (dependência ausente) |
| Frontend `npm run lint` | 0 erros, 19 warnings (2 em SISPAG) |
| Frontend testes SISPAG | 7 suítes / 122 testes passam |

Testes verdes **não** provam o UC-1: a conciliação própria nunca rodou em produção, TED/PIX estão atrás de flags
desligadas e o ground truth do sync está pendente.

## 8. Limites desta revisão
- Conclusões sobre produção (remessas aceitas, `.RET` D+1, 0 códigos de barras, secrets quebrados) vêm dos docs e da memória do projeto, com datas até 02/10; **não foram reverificadas**. Reconfirmar G-05 e os números de G-01 antes de agir.
- Não foram auditados `/metricas` e `/operacao` (painéis que também medem SISPAG), nem a conformidade LGPD além do que as rotas expõem.
- Os itens de defeito (G-02, G-03, G-04, G-05, G-12) foram lidos no código por um agente, não reproduzidos com teste; o primeiro passo de cada um deve ser um teste que falhe.
