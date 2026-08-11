---
name: gerarSolicitacaoNumerario
type: action
entity: Recebimento
ontology_version: "0.17"
implementation_status: implemented
status: stable
owners: [yuri]
related_files:
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/service/recebimentos/SnPayloadBuilder.ts
  - src/backend/domain/service/recebimentos/ContingenciaDecider.ts
  - src/backend/domain/client/ConexosNdeFiscalClient.ts
  - src/backend/domain/client/ConexosNdeClient.ts
  - src/backend/domain/interface/recebimentos/NdeFiscal.ts
  - src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts
  - src/backend/migrations/0042_solicitacao_numerario_execucao_fiscal.sql
  - src/backend/routes/recebimentos.ts
  - src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx
  - src/frontend/lib/recebimentos.ts
last_review: 2026-08-10
preconditions:
  - "TransacaoBancaria (crédito) presente no painel de Recebimentos, com conta bancária conhecida (transacao.gerNum). Rota devolve 422 se gerNum ausente."
  - "Operador aciona 'Alocar' na transação e distribui o valor por 1..N processos candidatos (human-in-the-loop); cada linha tem um 'Processar' próprio."
  - "Uma SELEÇÃO existe: para cada processo a analista escolheu 'Criar novo SN' OU uma SN existente do processo (docCod, listada por listarSolicitacoesNumerario). 'Processar' é gated na seleção (human-in-the-loop, ADR-0002/0022/0027) — sem seleção, não executa."
  - "Papel admin (requireRole('admin')) + authz por-filial (assertUserCanActOnFilial, filial do processo)."
  - "ACL pré-flight da conta de serviço (com300 UPDATE, com131 GERAR OBS, com297 HOMOLOGAR/CONTINGENCIA, com194 SELECT) → 403 antes de qualquer escrita."
  - "Modalidade do processo resolvida no servidor (gate 0.5: imp021.priVldTipo via ConexosCadastroClient.listProcessos). READY só com a modalidade conhecida — ela decide se a NDe é devida (ADR-0031)."
  - "Config de Documento (gcdCod) da SN resolvida no gate 3 por HISTÓRICO do processo (com299/list) → mapa filial SN_GCD_COD_BY_FIL → nome (SN_CONFIG_NOME_RE), toda rota validada contra lov/ConfigDocProcesso. Só se aplica ao ramo 'criar novo SN' — ver ADR-0034."
  - "Endereço do documento (endCod) resolvido no gate 1.5: o endereço da pessoa cujo pdcDocFederal é o do processo (com191/endereco/list, comparação por dígitos; empate por endVldDefault e depois menor endCod). NUNCA o endCodFis do validaProcessoPessoa — esse é o endereço PADRÃO da pessoa, e numa pessoa multi-estabelecimento o ERP recusa o par (endereço de um, CNPJ de outro) com endCod Generic.NOT_VALID. Sem endereço correspondente → BLOCKED_CADASTRO antes de qualquer escrita. Ver ADR-0035."
  - "Escrita irreversível gated: só executa o POST real com CONEXOS_WRITE_ENABLED=true E CONEXOS_DRY_RUN=false (default dry-run)."
postconditions:
  - "dry-run → monta e loga os payloads da rota escolhida (novo SN: com299/fin014/com297/fiscal; SN existente: fin014/com297/fiscal), NENHUM POST, retorna preview (dryRun:true)."
  - "existing-SN → PULA com299 (geração/gerDocProcesso) E a completação (completarSnAdiantamento: linha de item / condição de pagamento / discriminador do título); referencia o docCod da SN selecionada; NÃO cria documento novo (invariante alocacao-sn-existente / I-Receb-3: sem SN duplicada). Entra direto na baixa fin014 + com297 contra o docCod selecionado."
  - "existing-SN → o valor alocado ≤ SALDO da SN selecionada. O saldo é o do TÍTULO (lov/TituloBorderoReceber lido pela própria baixa fin014), NÃO o valor do documento da listagem com299/list — over-allocation contra o saldo do título falha na baixa (I-Receb-3)."
  - "real (novo SN) → Solicitação de Numerário (com299) gerada E finalizada; docCod = messages[0].vars.docCod."
  - "real → SN completada ANTES de finalizar, nesta ordem: (1) linha de item (comDocProdutos) com o valor alocado — preserva o título que o ERP criou na geração; (2) condição de pagamento SÓ se a com194 acusar validação BLOQUEANTE (fdvVldErr===2) de condição de pagamento."
  - "real → se a condição foi aplicada, o efeito é VERIFICADO: mnyTitValor === docMnyValor (>0) na releitura; divergência ⇒ a etapa FALHA com a causa nomeada (o PUT destruiu as parcelas), nunca finaliza documento sem título."
  - "real → baixa fin014 do crédito: borderô → validar título (docCod da SN) → gravar baixa → finalizar, com conta financeira = a conta do PRÓPRIO pagamento (transacao.gerNum), NÃO um env var fixo."
  - "real → nota de débito com297 gerada + produto 41978; depois a cauda fiscal na ordem OBRIGATÓRIA fiscal → observações → homologar."
  - "real → fiscal com300 (read-modify-write): fisVldTipoNfDebito=6 (Pagamento antecipado); sucesso ⟺ resp.fisVldTipoNfDebito===6."
  - "real → observações com131 (geraObs): AJUSTE SINIEF; sucesso ⟺ fisEspObs preenchido; guard idempotente (não reapenda se já contém o marcador)."
  - "real → homologação com297 (ContingenciaDecider roteia por vldTpNf; docVldComvalidacoes 1=ok / 2=aviso→com194+revisao_humana / else=falha) + poll SEFAZ vldAutorizado (timeout ≠ erro, retoma no poll)."
  - "conta-e-ordem (imp021.priVldTipo=2) → roda com299 + fin014 e PARA: nenhuma etapa com297/com300/com131 e nenhum poll SEFAZ. Settla com etapa 'quitado-sem-nde', nd_doc_cod nulo POR REGRA (não é lacuna) e resultado ndeDispensada:true. Nenhum registro em nota_debito_eletronica. Ver ADR-0031 / I-Receb-4."
  - "modalidade indeterminável (processo ausente no imp021 | priVldTipo nulo | read falhou) → status blocked com motivo nomeando o campo e o priCod, ANTES de qualquer escrita (o write-ahead nem abre). Falha de transporte vira TRANSPORT_ERROR, não veredito de domínio."
side_effects:
  - "Escritas IRREVERSÍVEIS no Conexos (com299 gerDocProcesso, fin014 baixa, com297 nota de débito + fiscal + homologar) — cada uma tentativa única / postGenericOnce."
  - "Trilha write-ahead estendida (solicitacao_numerario_execucao + colunas 0042: txn_id, valor, fin014_bor_cod, nd_doc_cod, etapa, revisao_humana, nde_autorizado); retomada-safe por etapa."
  - "Idempotência por alocação: chave sn-real:{txnId}:{priCod}:{valor} — split-safe (um pagamento pode ser dividido em vários processos, Σ valor ≤ transacao.valor)."
---

# gerarSolicitacaoNumerario — "Processar" processo → SN + baixa + NDe fiscal (REAL, split-capable)

> **Vigência:** v0.12 (2026-08-01). O botão **"Processar"** (modal "Alocar processos" em
> `/recebimentos`) deixou de ser DRY-RUN-only e passa a rodar a **automação REAL, split-capable**
> no Conexos para um pagamento bancário alocado a um processo: gera a Solicitação de Numerário,
> dá a baixa `fin014` (conta = a conta do próprio pagamento), emite a nota de débito e conclui a
> **cauda fiscal** (fiscal → observações SINIEF → homologar → poll SEFAZ). Gated por
> `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN` (default dry-run). Orquestrador nativo de recebimentos
> `RecebimentoNumerarioService` — reusa os clients Conexos compartilhados, **não** chama o serviço
> de adiantamento de permutas. Fecha o GAP `nota-debito-fiscal` que Permutas deixou aberto.

## Fluxo (por alocação)

`RecebimentoNumerarioService.processarAlocacao({ txnId, transacao, priCod, valor, processoFields, ator, dryRunOverride? })`
orquestra, **por alocação** (uma linha do split):

1. **com299 (SN):** monta o payload via `SnPayloadBuilder` (builder compartilhado com a rota dry-run;
   o antigo seam `SolicitacaoNumerarioService.enviarAoErp` que lançava `NotImplementedError` foi
   **RETIRADO**), gera a SN, **completa** e **finaliza**. Sucesso ⟺ `messages[0].valid==='SUCESSO'`,
   `docCod` em `vars.docCod`; finalização ⟺ `docVldFinalizado === 1` na releitura.
   - **(a) linha de item** (`comDocProdutos`, conta de rateio derivada da variante da SN) — **primeiro**:
     ela PRESERVA o título que o ERP criou na geração e materializa o `mnyBruto`.
   - **(b) condição de pagamento — CONDICIONAL** (vigência 2026-08-03, ADR-0025): só quando a `com194`
     acusa validação **bloqueante** (`fdvVldErr === 2`) mencionando condição de pagamento (leitura
     best-effort: com194 fora do ar ⇒ segue sem o PUT). Escolhe a condição do **próprio** cliente
     (`lov/CondPgtoPessoa`, paginado por `count`, casada contra `dpeNomPessoa`) — sem ela, **fail-closed**.
   - **(c) discriminador do passo (b):** relê o documento e exige `mnyTitValor === docMnyValor` (`> 0`).
     O `PUT` que troca `pgtCod` **destrói as parcelas e não as regenera** — se destruiu, a etapa falha
     aqui com a causa nomeada, em vez de finalizar um documento sem título. Ver
     `integrations/conexos-com299-gerdoc.md` (banner "CICLO DE VIDA DO TÍTULO").
2. **fin014 (baixa do crédito):** borderô → validar título (docCod da SN) → gravar baixa → finalizar,
   com **`gerNum = transacao.gerNum`** (a conta em que o pagamento entrou — derivada, não escolhida;
   `FIN014_CONTA_FINANCEIRA` deixou de ser usado nesta trilha).
3. **com297 (nota de débito):** gera a NDe + **produto 41978**, depois a cauda fiscal na ordem
   **OBRIGATÓRIA** (homologar antes gera doc sem a observação SINIEF):
   - **(a) fiscal — com300** (read-modify-write): `GET` o `finDocFiscal` inteiro → `PUT` com
     `fisVldTipoNfDebito = 6` (Pagamento antecipado). Sucesso ⟺ `resp.fisVldTipoNfDebito===6`.
   - **(b) observações — com131** (`geraObs`): sucesso ⟺ `fisEspObs` preenchido; guard idempotente
     (GET antes; se `fisEspObs` já contém `AJUSTE SINIEF`, pula).
   - **(c) homologar — com297** (`ConexosNdeClient.homologar` + `ContingenciaDecider` roteando por
     `vldTpNf`): `docVldComvalidacoes` 1=ok / 2=aviso (coleta com194 + marca `revisao_humana`) /
     else=falha. Depois **poll SEFAZ** `vldAutorizado` com timeout (timeout ≠ erro — retoma no poll).
4. **Gate:** `dryRun = !conexosWriteEnabled || conexosDryRun || dryRunOverride` → monta+loga os 4
   payloads e retorna preview, sem nenhum POST.
5. **Write-ahead + retomada:** cada etapa grava progresso na trilha estendida (etapa
   `sn|sn-finalizar|fin014|fin014-done|nota-debito|fiscal-done|obs-done|homologado|concluido|error`);
   documento já criado NÃO é recriado — a re-execução avança para a etapa pendente.

## Gate 3 — qual Configuração de Documento (`gcd`) gera a SN (v0.17, ADR-0034)

O gate 3 responde duas coisas sobre o ramo **"criar novo SN"**: se o processo aceita uma SN e **com qual
`gcd`** ela seria gerada. A autoridade sobre o que o processo aceita continua sendo o
`lov/ConfigDocProcesso`; o que mudou é **como se escolhe dentro dela**:

1. **HISTÓRICO do próprio processo** — o `gcdCod` da SN mais recente (`com299/list`). É a evidência mais
   forte que existe: aquele `gcd` já gerou SN aceita naquele processo/filial.
2. **MAPA filial → gcd** (`SN_GCD_COD_BY_FIL`, ex. `"1:150,4:185"`) — para processo **sem** histórico.
3. **NOME** (`SN_CONFIG_NOME_RE`, desempate `SN_GCD_COD` → ENCOMENDA → 1ª) — comportamento histórico.

- **Toda rota é validada contra o `ConfigDocProcesso`** antes de virar decisão; um `gcd` ausente de lá
  falharia a geração com `gcdDesNomeProc NOT_VALID` e por isso é descartado (cai para a rota seguinte).
- **O nome da config NÃO é uniforme entre filiais.** Medido em produção (2026-08-10, processo 699 /
  filial 4): das 29 configs aceitas, nenhuma se chama "Solicitação de Numerário" — a SN daquela filial é
  `gcd 185 "ADIANTAMENTO DE CLIENTES"`, com que as 7 SNs existentes do processo foram geradas. Casar só
  por nome declarava inelegível um processo comprovadamente elegível.
- **O `SN_GCD_COD` global nunca decide sozinho** (só desempata dentro da rota 3): na filial 4 o `gcd 150`
  é `"IMPLANTAÇÃO DE SALDO FINANCEIRO - CLIENTES NACIONAIS ENCOMENDA"`, outro documento. Aceitá-lo
  geraria o documento errado, de forma irreversível.
- **Variante exige o separador `" - "`**: sem ele a variante é `ENCOMENDA` (senão a conta-alvo do rateio
  vira uma conta inexistente e `addLineItem` falha **depois** da SN shell existir — documento órfão).
- A **origem** do `gcd` (histórico / mapa / nome) entra no `motivo` do READY — auditoria de documento real.

## Ramo — SN existente (v0.13, ADR-0027)

Quando a alocação referencia uma SN **já existente** (o `docCod` selecionado da listagem
`listarSolicitacoesNumerario`), o passo **1 (com299: geração + `completarSnAdiantamento` — linha de
item / condição de pagamento / discriminador do título)** é **PULADO**: o documento já existe e já tem
título. **O gate 3 também não roda** (ADR-0034 D5): ele responde "com qual config a SN seria CRIADA", e
nada é criado aqui — `preflight.gcdCod`/`gcdDesNome` não são lidos neste ramo. Os gates **0.5
(modalidade)** e **1 (cadastro)** continuam valendo, porque decidem a baixa e a NDe, que ainda rodam. A execução entra direto no passo **2 (fin014)** contra o `docCod` selecionado, seguida do passo
**3 (com297 + cauda fiscal)**. O caminho **"Criar novo SN"** permanece o fluxo completo (1→2→3),
inalterado.

- **Teto ≤ saldo (I-Receb-3):** o valor alocado não pode exceder o **saldo do TÍTULO** da SN. Esse saldo
  **não** está na listagem `com299/list` (document-level: `mnyBruto`/`docMnyValor`); ele vem da leitura
  do título (`lov/TituloBorderoReceber`) que a **própria baixa `fin014` já executa** — o **ponto de
  enforcement** é a baixa/título, não o valor da lista. Ver `business-rules/alocacao-sn-existente.md`.
- **Sem duplicata:** o ramo existente **não** cria um segundo documento (com299 pulado). A idempotência
  reusa `sn-real:{txnId}:{priCod}:{valor}`; o handle passa a ser o `docCod` **selecionado** em vez do
  gerado — a re-execução nunca duplica nem a SN nem a baixa.

## Ramo — POR CONTA E ORDEM DE TERCEIROS (v0.16, ADR-0031)

Quando o processo é **por conta e ordem de terceiros** (`imp021.priVldTipo = 2`), a alocação roda os
passos **1 (com299)** e **2 (fin014)** por inteiro e **PARA**: o passo **3 (com297 + cauda fiscal)**
não acontece. A documentação fiscal do repasse sai em nome do terceiro — a Columbia não é quem emite.
Terminal `quitado-sem-nde`, `nd_doc_cod` nulo por regra. Ver
`business-rules/nde-dispensada-conta-e-ordem.md` (I-Receb-4).

- **Fonte da modalidade:** `imp021` lido **no servidor** (gate 0.5 do pré-flight, antes do gate de
  cadastro), nunca o payload do browser — é a chave que liga/desliga um documento fiscal
  irreversível. Um read a mais por Processar é o custo aceito.
- **Fail-closed:** processo ausente no `imp021`, `priVldTipo` nulo ou read com falha ⇒ `blocked` com
  `motivo` nomeando campo e `priCod`, **sem abrir o write-ahead**. Não se adivinha modalidade.
- **NÃO confundir com a variante da config de SN** (`"... - TERCEIROS"`, gcd 151), que só decide a
  conta de rateio da linha de item: eixos independentes (ADR-0031 D3).
- **Ortogonal ao ramo SN existente:** uma alocação conta e ordem contra SN existente pula o com299
  (I-Receb-3) **e** para antes do com297 (I-Receb-4).

## Rota

`POST /recebimentos/transacoes/:txnId/solicitacao-numerario` — carrega a transação (`gerNum`, `valor`);
**422 se `gerNum` ausente**; body = uma alocação `{ priCod, valor>0, priEspRefcliente?, pesCod,
dpeNomPessoa, moeCod, dryRun? }`. Guards: `heavyRouteLimiter` + `requireRole('admin')` +
`assertUserCanActOnFilial` (filial do processo) + **ACL pré-flight** único. HTTP 200 mesmo em erro de
etapa (o `status` carrega o desfecho); um re-POST com o mesmo body retoma.

## Invariante SPLIT (novo)

- Um pagamento (`TransacaoBancaria`) gera **1..N** alocações (uma por processo). A soma dos valores
  alocados respeita **Σ valor ≤ transacao.valor** (saldo corrente na UI; over-allocation bloqueada).
- **Idempotência por alocação:** chave `sn-real:{txnId}:{priCod}:{valor}` — split-safe (a mesma
  transação dividida em vários processos gera SNs distintas; a mesma alocação nunca duplica).

## Conta financeira — derivada, não escolhida

- A conta da baixa `fin014` é a conta do **próprio pagamento** (`transacao.gerNum`): o crédito já
  carrega a conta em que caiu. Regra estrutural (derivação); o valor concreto de `gerNum` é instância.

## Gating + retomada

- **Gate de escrita:** `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN` (default dry-run), homologação-first.
- **Retomada-safe:** trilha estendida (0042); 401/403 ou erro de etapa → `markError` + `{status:'error', etapa}` (fail-closed).
- `docMnyValor==0` pós-homologação → `logService.warn` + flag, **não bloqueia** (decisão do stakeholder).

## Por que está na ontologia (universalidade)

Universal: transformar um crédito conciliável em uma **solicitação de numerário** → **baixa** →
**nota de débito eletrônica com cauda fiscal** é o encadeamento recorrente de contas-a-receber com
encomenda em comex. A estrutura (escolher o processo → montar o documento → baixar na conta do
pagamento → emitir a NDe → fiscal/observações SINIEF/homologar/autorizar na SEFAZ → gate humano →
gated antes do write) é do domínio; os códigos (`gcdCod`, produto `41978`, contas de rateio) e a
conta concreta (`gerNum`) são config/instância do tenant. A cauda fiscal (SINIEF/SEFAZ) é
regulatória — estável. Ver `integrations/conexos-nde-fiscal.md` e `integrations/conexos-com299-gerdoc.md`.

## Fonte / spec

Cauda fiscal confirmada por HAR real (produção, doc 18337, filial 2, 2026-08-01):
`integrations/recebimentos-numerario-real-fiscal-spec.md`.

## Fora de escopo / gaps (não modelados como verdade de domínio)

- Regra de **percentuais da encomenda** (0,1%/0,9%) — permanece NÃO-RESOLVIDA; a SN usa o valor
  alocado. Ver `business-rules/encomenda-percentuais.md`.
- Divergência `prdCod` (item `2` × com194 reclama `41978`) e `docMnyValor→0` pós-homologação —
  gates fiscais/operacionais do spec (PENDÊNCIAS), tratados por log + `revisao_humana`, não modelados.
- **Regeneração das parcelas destruídas pelo PUT da condição** (tela `com032` "Financeiro") — **NÃO
  implementada** por decisão (ADR-0025): caminho mais longo, HAR não capturado, e só necessário se um
  cliente real cair no caso bloqueante COM PUT destrutivo. Hoje a etapa falha fechada e instrui o
  analista a gerar as parcelas na com032 e reprocessar.
