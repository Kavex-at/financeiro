# Interview Transcript — sispag-favorecido-autorizado — 2026-10-08

**Mode:** tweak
**Entity affected:** LotePagamento (I13), ExcecaoDestino (I12, a remover), PendenciaCadastro,
PerfilCanalFornecedor, AlertaItemLote, nova entidade FavorecidoAutorizado
**Gatilho:** feedback da Columbia rejeitou a conferência por 2ª pessoa por lote (I13l, L12/L13):
custa tempo da analista e vai contra o objetivo de automatizar.

## Lido antes da entrevista

- `business-rules/verificacao-ted-pix-sispag.md` (I13a–m), `destino-pagamento-sispag.md` (I10),
  `excecao-destino-sispag.md` (I12)
- `entities/{pendencia-cadastro, perfil-canal-fornecedor, alerta-item-lote, bloqueio-duplicidade,
  lote-pagamento, excecao-destino}.md`, `actions/sispag/conferir-lote.md`,
  `state-machines/lote-pagamento.md` (L3, L4, L8, L12, L13)
- ADR-0054, 0061, 0063, 0064; `Permission.ts` (`sispag:excecao`, `sispag:conferir`, `sispag:cadastro`)

## Comportamento atual (confirmado na ontologia)

- Destino TED/PIX = `cmn025` primeiro, `ExcecaoDestino` `APROVADA` (2ª pessoa, `sispag:excecao`)
  como fallback (I10, I12). Exceção vai ao `fin015` sem `pctCodSeq` (H3/H5 não provadas).
- Verificação TED/PIX (I13) ao definir modalidade e no `finalizarLote`: duplicidade FORTE/FRACA
  bloqueia até JUSTIFICAR/RETIRAR; canal habitual alerta sem bloquear; sem dado no cadastro e sem
  exceção → item sai do lote (`ItemsRemovedByCheckError`, a finalização não acontece naquela
  tentativa) + `PendenciaCadastro` (fila `sispag:cadastro`).
- Lote com ≥1 TED/PIX fica `FINALIZADO` aguardando conferência (L12) por pessoa ≠ finalizador /
  incluidor / criador; L13 devolve; L8 barra sem conferência (`ConferenceRequiredError`).
- **Nenhuma regra hoje compara o destino do `cmn025` com um valor aprovado antes**: o cadastro é
  confiado como está. A troca de conta no `cmn025` (vetor clássico de fraude) só era pega pela
  conferência humana e, fracamente, pelo canal habitual.

## Delta decidido pelo usuário (não reperguntar)

1. Nova entidade **FavorecidoAutorizado** (vocabulário favorecido/fornecedor, nunca "cliente"):
   lista de fornecedores que podem receber por TED/PIX; dados vêm do `cmn025`.
2. Aprovação amarra **fornecedor + destino**: impressão digital (fingerprint) do destino lido do
   `cmn025` (banco/agência/conta para TED; chave para PIX). A cada verificação compara `cmn025`
   ao vivo com o fingerprint: igual → automático; diferente → item retido/retirado e fornecedor
   volta para reaprovação.
3. Aprovação por **duas pessoas** (aprovador ≠ cadastrante), com **permissão nova**
   (ex.: `sispag:autorizar_favorecido`).
4. **Revogação** com motivo, auditada. **Sem expiração.**
5. **Remove** a conferência por lote: I13l, L12 `conferirLote`, L13 `devolverLote`,
   `ConferenceRequiredError`, `SelfConferenceError`, `sispag:conferir`, `exigeConferencia`,
   `conferidoPor/Em`, `devolvidoPor/Em/motivoDevolucao`.
6. **Apaga ExcecaoDestino por inteiro** (I12, ADR-0061), inclusive registros: dado de pagamento
   nunca difere do Conexos. Destino = `cmn025` apenas.
7. Item bloqueado **sai do lote** (remoção pelo sistema, auditada, como I13j-1); o lote segue.
   Dois motivos distintos, donos distintos: (a) favorecido não autorizado / destino mudou desde a
   aprovação; (b) sem dado TED/PIX no `cmn025`.
8. Verifica em cada passo: na aprovação (sanidade), ao definir TED/PIX, e no `finalizarLote`
   (autoritativo). Falha fechada (I13b) mantida.
9. Duplicidade (I13c–h) fica, como aviso + confirmação da analista; sem 2ª pessoa.
10. Perfil de canal **não pré-preenche** a lista; vira relatório (fornecedores pagos por TED/PIX,
    com confiança do `PerfilCanalFornecedor`) para o usuário validar com a Columbia.
11. Dado de pagamento só leitura no lote.

## Consequências que já seguem do decidido (registrar, não perguntar)

- **H3/H5 deixam de importar**: sem exceção, todo destino TED vai por `pctCodSeq` e todo PIX por
  chave do `cmnPessoasPix`. `SISPAG_EXCECAO_DESTINO_ENABLED` / `SISPAG_DESTINO_MANUAL_ENABLED`,
  `ExcecaoDesabilitadaError`, `DestinoManualValidator` (se só servia à exceção), a tela
  `/sispag/excecoes`, o alerta `SISPAG_EXCECAO_DIVERGENCIA` e `PendenciaCadastro.comExcecaoAprovada`
  saem junto.
- I10 passa a ter só o passo 1 do resolvedor; I10d/I10e/I10i/I10k precisam ser reescritos (I10i
  hoje só vale para a exceção).
- A guarda humana anti-fraude migra da conferência por lote para a **aprovação do par
  (fornecedor, destino)**. É a 2ª pessoa uma vez por destino, não por lote.
- I10f (congelamento após import no `fin015`) continua.
- Boleto segue fora de tudo isto.

## Perguntas em aberto (com recomendação)

Prioridade: **P0** = bloqueia o desenho/ontologia; **P1** = pode ter default e virar gap.

### Bloco A — Fila de cadastro (motivo b)

**A1 (P0). A `PendenciaCadastro` / fila `sispag:cadastro` sobrevive?** Você disse não ter certeza de
que o cadastro do Conexos passa pela nossa fila.
- (i) mantém a fila como está; (ii) **remove a entidade**: o motivo (b) vira só a remoção auditada
  com mensagem "favorecido sem conta/chave no cadastro do Conexos — pedir ao responsável pelo
  cadastro", visível na trilha do lote; (iii) vira apenas uma seção do relatório do item 10.
- **Recomendação: (ii)**, e o mesmo relatório do item 10 lista "TED/PIX retirados por falta de
  dado" para quem quiser cobrar. Menos uma fila que ninguém fora da Kavex se comprometeu a olhar;
  `sispag:cadastro` sai. Reabre se a Columbia indicar quem cuida do cadastro.

### Bloco B — Modelo do FavorecidoAutorizado

**B1 (P0). Granularidade: por fornecedor ou por (fornecedor, modalidade)?**
- **Recomendação: por (fornecedor, modalidade)** — `TED` e `PIX` são autorizações separadas, cada
  uma com seu fingerprint. Assim a troca da chave PIX não derruba o TED e vice-versa, e aprovar TED
  não libera PIX por tabela.

**B2 (P0). Qual destino o fingerprint pina quando o `cmn025` tem mais de um?** Hoje: TED = conta
ativa default primeiro (qualquer banco); PIX = I10k (chave CPF/CNPJ do favorecido, depois default,
depois as demais).
- **Recomendação: pina o destino exato que o resolvedor escolheria no momento da aprovação** (TED:
  banco+agência+conta+DV da conta escolhida; PIX: tipo+chave). Se depois o resolvedor passar a
  escolher outra conta/chave (nova default, conta desativada), é "destino mudou" → reaprovação.
  Alternativa rejeitada: pinar o conjunto de todas as contas (qualquer conta nova invalidaria).

**B3 (P0). PIX continua exigindo chave CPF/CNPJ igual ao documento do favorecido (titularidade)?**
I10i/I12i hoje só valem para a exceção; no cadastro, I10k prefere a chave CPF/CNPJ mas aceita
default/e-mail/telefone/aleatória.
- **Recomendação:** aceitar qualquer tipo de chave do `cmn025`, mas a tela de aprovação mostra o
  tipo e marca "chave não é o CPF/CNPJ do favorecido" como aviso. A 2ª pessoa é quem decide. Se
  preferir rigor: só chave CPF/CNPJ = `pdcDocFederal` (mais seguro, menos fornecedores elegíveis).

**B4 (P1). Titularidade da conta TED:** o `cmn025` expõe documento do titular da conta? Se sim,
conta de terceiro (doc ≠ favorecido) bloqueia a aprovação, só avisa, ou ignora?
- **Recomendação:** se o campo existir, aviso forte na aprovação (não bloqueio); se não existir,
  registrar como limitação. Precisa de probe no `ctcorr`.

**B5 (P1). Armazenamento do fingerprint.**
- **Recomendação:** guardar **HMAC (SHA-256, segredo do tenant)** do destino normalizado + versão
  mascarada para exibição. O valor completo não precisa ficar no nosso banco (a fonte é o
  `cmn025`). Assim não reabrimos o problema de proteção de dado da I10h.

**B6 (P1). O que o aprovador vê?** Mascarado (I10h) ou completo?
- **Recomendação:** completo **só na tela de aprovação** para quem tem a permissão nova (é o que
  ele precisa conferir contra o documento do fornecedor), mascarado em todo o resto. Nunca em log.

**B7 (P1). Quem pode cadastrar (pedir a autorização)?** Mesma permissão nova (como `sispag:excecao`,
separação só pela regra cadastrante ≠ aprovador) ou qualquer usuário com `sispag:executar`?
- **Recomendação:** cadastrar com `sispag:executar` (a analista pede ao tropeçar no item), aprovar
  só com `sispag:autorizar_favorecido`, aprovador ≠ cadastrante comparado pelo usuário autenticado
  no backend. Revogar: só `sispag:autorizar_favorecido`.

**B8 (P1). Estados.** Proposta: `PENDENTE → AUTORIZADO`, `PENDENTE → REJEITADO`,
`AUTORIZADO → REAPROVACAO_PENDENTE` (destino mudou; sistema), `REAPROVACAO_PENDENTE → AUTORIZADO`
(nova aprovação por 2ª pessoa grava novo fingerprint), `AUTORIZADO|REAPROVACAO_PENDENTE → REVOGADO`
(motivo). No máximo 1 vigente por (fornecedor, modalidade).
- **Recomendação:** aceitar. Na reaprovação, o aprovador vê "antes × agora" mascarado. Pedir a
  reaprovação é automático (não precisa de novo cadastrante); a regra cadastrante ≠ aprovador vira
  "aprovador ≠ quem aprovou da última vez"? → **Recomendo:** só exigir aprovador com a permissão
  (o sistema é o "cadastrante" da reaprovação). Confirmar.

### Bloco C — Comportamento no lote

**C1 (P0). Momento da remoção.** Ao **definir TED/PIX** num item de favorecido não autorizado, o
item já sai do lote, ou a tela recusa/avisa e a remoção só acontece no `finalizarLote`?
- **Recomendação:** ao definir a modalidade, **avisa no item** ("favorecido não autorizado para
  TED" / "destino mudou desde a aprovação" / "sem conta no cadastro") com atalho "pedir
  autorização"; **não remove**. Remoção só no `finalizarLote`. Tirar o item enquanto a analista
  edita surpreende e a impede de trocar para boleto.

**C2 (P0). No `finalizarLote`, depois de retirar itens, o lote finaliza na mesma chamada?** Hoje
`ItemsRemovedByCheckError` deixa o lote em `RASCUNHO`. Você disse "o lote segue".
- **Recomendação:** retira, grava a retirada e **finaliza na mesma chamada** com os itens restantes,
  devolvendo a lista de retirados na resposta (desde que sobre ≥1 item; se esvaziar, fica
  `RASCUNHO` ou cancela?). `ItemsRemovedByCheckError` sai. Confirmar o caso "esvaziou".

**C3 (P0). Recheque no `gerarRemessa` (L8).** Entre `FINALIZADO` e a remessa o `cmn025` pode mudar,
e agora não há mais conferência humana nesse intervalo. Hoje o envio já reconfere o destino ao vivo.
O que acontece se o fingerprint divergir (ou a autorização for revogada) com o lote `FINALIZADO`?
- (i) **barra a remessa inteira** com erro nomeado por item, antes de qualquer escrita; analista
  reabre (L4), o finalizar retira o item; (ii) retira o item ali mesmo e gera com o resto.
- **Recomendação: (i)**. L8 é a primeira escrita no ERP e tem ledger/retomada (ADR-0039);
  mudar a composição do lote dentro dela complica a marca d'água. Fail-closed, sem surpresa.

**C4 (P1). Notificação de "destino mudou".** Só in-app?
- **Recomendação:** in-app: (1) selo no item retirado com o motivo, (2) lista "Autorizações
  aguardando reaprovação" para quem tem a permissão, (3) `Alerta` operacional (DbAlertSink, já
  existe) do tipo `SISPAG_DESTINO_ALTERADO` com dedup por (fornecedor, modalidade). Sem e-mail.

**C5 (P1). Título retirado volta sozinho?** Depois da reaprovação/autorização, o título retirado
volta na próxima formação automática (como a retirada da ADR-0050) ou fica de fora até inclusão
manual?
- **Recomendação:** volta pela formação automática normal (não é bloqueio como `BloqueioDuplicidade`).
  Enquanto não autorizado, se cair em lote de novo, será retirado de novo no finalizar — aceitável,
  mas a formação poderia já pular títulos cujo item TED/PIX estaria bloqueado? Não: a formação não
  conhece a modalidade (fin064 não traz). Então só retirada no finalizar.

### Bloco D — Duplicidade e canal

**D1 (P0). Confirmação da duplicidade: o que fica?**
- **Recomendação:** manter tudo de I13c–h como está (já era só a analista): JUSTIFICAR com texto
  obrigatório e RETIRAR com `BloqueioDuplicidade`. A única mudança é que a justificativa deixa de
  ser vista por um conferente. Simplificar para "confirmar" sem texto perde a trilha do porquê,
  que é o que sobra de controle agora que não há 2ª pessoa no lote.

**D2 (P1). Alerta de canal habitual (I13i).**
- (i) mantém no item, informativa; (ii) remove do lote, só alimenta o relatório; (iii) remove.
- **Recomendação: (ii)**. A alerta existia para o conferente; sem conferente, no item vira ruído.
  A autorização por fornecedor já cobre o risco que ela sinalizava. `CANAL_HABITUAL` sai de
  `AlertaItemLote`; `PerfilCanalFornecedor` e `calcularPerfilCanal` ficam para o relatório.

**D3 (P1). Relatório do item 10:** onde mora e o que mostra?
- **Recomendação:** tela/exportação em `/sispag` (somente leitura): fornecedor, `pesCod`, grupo
  dominante, participação, nº pagamentos, meses, confiança, se tem conta/chave no `cmn025`, e
  status de autorização. Ação "cadastrar autorização" a partir da linha (cria `PENDENTE`, não
  aprova). Confirmar que criar `PENDENTE` em lote a partir do relatório é aceitável.

### Bloco E — Transição

**E1 (P0). TED/PIX está ligado em produção hoje?** (`SISPAG_TED_ENABLED`, `SISPAG_PIX_ENABLED`
nasceram desligados.) Se estão desligados, bootstrap e migração quase somem.
- **Recomendação:** confirmar o estado das flags em produção antes de desenhar a transição.

**E2 (P0). Bootstrap.** Com a lista vazia, todo item TED/PIX seria retirado no finalizar.
- **Recomendação:** aceitar, **atrás de flag** (`SISPAG_FAVORECIDO_AUTORIZADO_ENABLED`); ligar a
  flag só depois que a Columbia validar o relatório e as primeiras autorizações estiverem
  aprovadas. Com a flag desligada e TED/PIX ligado: comportamento? → **Recomendo:** TED/PIX não é
  oferecido sem a flag nova (nunca voltar a um estado sem controle anti-fraude, já que a
  conferência sai).

**E3 (P0). Lotes `FINALIZADO` aguardando conferência no deploy.**
- **Recomendação:** a migração **não** marca nada como conferido; esses lotes passam a obedecer à
  nova guarda de L8 (C3): se todos os favorecidos TED/PIX estão autorizados e o destino bate, geram
  remessa; senão barram. Contar quantos existem antes.

**E4 (P0). Apagar `ExcecaoDestino` "inclusive registros" × trilha só-inclusão.** A trilha da
exceção (I12e) e a `lote_pagamento_item_destino_audit` têm trigger que recusa DELETE, e itens já
enviados podem ter `excecao_destino_id` congelado (I10f).
- **Recomendação:** dropar as tabelas operacionais (`excecao_destino`), mas **antes** exportar
  registros + trilha para um arquivo de arquivo (ou manter a tabela de trilha como somente leitura
  histórica); manter `excecao_destino_id` nulo/inerte nos itens já remetidos. Antes, contar quantas
  exceções existem em produção (por estado) e quantos itens as usaram. Se uma exceção `APROVADA`
  está em item de lote `RASCUNHO`/`FINALIZADO`, o item cai no motivo (b) na próxima verificação.
  Confirmar se apagar a trilha também é desejado (afeta auditoria).

**E5 (P1). Concessões de permissão.** `sispag:conferir` e `sispag:excecao` saem do catálogo
(ADR-0053, `CHECK` das tabelas de permissão). Quem recebe `sispag:autorizar_favorecido`?
- **Recomendação:** converter as concessões atuais de `sispag:excecao` em
  `sispag:autorizar_favorecido` na migração; `sispag:conferir` só é removida. Papel
  `Administrador` recebe a nova.

## Extracted rules (proposta, sujeita às respostas acima)

- R1: Item TED/PIX só segue para remessa se existe `FavorecidoAutorizado` vigente para
  (fornecedor, modalidade) **e** o destino resolvido ao vivo no `cmn025` tem o mesmo fingerprint.
- R2: Destino de pagamento = `cmn025` apenas; nenhum dado de pagamento fora do Conexos.
- R3: Autorizar exige 2 pessoas (aprovador ≠ cadastrante, backend) e a permissão nova.
- R4: Fingerprint divergente → autorização vai a reaprovação; item sai do lote no finalizar
  (motivo `DESTINO_ALTERADO`); remessa barra se divergir após finalizar.
- R5: Sem conta/chave no `cmn025` → item sai do lote (motivo `SEM_DADO_PAGAMENTO`).
- R6: Favorecido sem autorização → item sai do lote (motivo `FAVORECIDO_NAO_AUTORIZADO`).
- R7: Falha de leitura nunca autoriza, nunca retira (I13b).
- R8: Duplicidade continua bloqueando o finalizar até resolução pela analista.
- R9: Toda autorização, rejeição, revogação, reaprovação e remoção pelo sistema é auditada (só-inclusão).
- R10: Sem conferência por lote; `FINALIZADO → REMESSA_GERADA` sem guarda de 2ª pessoa.

### entity_changed: true
### Ontology diff needed: yes
- NEW entity `FavorecidoAutorizado` (+ state machine), NEW permission, NEW business rule (ou I13
  reescrita) com o fingerprint.
- REMOVE `ExcecaoDestino` (entity, state machine, I12, 6 actions), `conferirLote`/`devolverLote`
  (L12/L13), I13l, `exigeConferencia` e atributos de conferência/devolução.
- REWRITE I10 (resolvedor só cadastro; I10d/e/i/k), I13i/j/k (conforme A1/D2), L3/L4/L8.
- Possível REMOVE `PendenciaCadastro` (A1). ADR nova superseding ADR-0061 e emendando 0054/0063.
### Reason: rule change

### Open questions
Ver blocos A–E acima. P0: A1, B1, B2, B3, C1, C2, C3, D1, E1, E2, E3, E4.

---

## Respostas do usuário (2026-10-08)

| # | Decisão |
|---|---|
| A1 | **Remover** `PendenciaCadastro` e a permissão/fila `sispag:cadastro`. Motivo (b) vira remoção auditada com mensagem "pedir ao responsável pelo cadastro" + aparece no relatório. |
| B1 | Autorização por **(favorecido, modalidade)**, fingerprint próprio por modalidade. |
| B2 | Fingerprint = o destino exato que o resolvedor escolhe na aprovação (TED default, PIX ordem I10k). Resolvedor escolher outro = "destino mudou". |
| B3 | PIX aceita **qualquer chave do cmn025**; aviso na aprovação quando não for o CPF/CNPJ do favorecido. |
| C1 | Definir TED/PIX em favorecido não autorizado: **aviso no item** + atalho "pedir autorização". Remoção só no `finalizarLote`. |
| C2 | Finalizar retira e finaliza na mesma chamada com os restantes (`ItemsRemovedByCheckError` sai). **Lote que fica vazio volta/fica em RASCUNHO.** |
| C3 | `gerarRemessa` (L8) barra o lote inteiro (erro nomeado por item) se fingerprint divergir ou autorização revogada, antes de qualquer escrita no ERP. |
| D1 | Duplicidade mantida como hoje (I13c–h): JUSTIFICAR com texto obrigatório, RETIRAR com `BloqueioDuplicidade`. Sem 2ª pessoa. |
| E1 | `SISPAG_TED_ENABLED` / `SISPAG_PIX_ENABLED` **não estão ligadas em produção**. |
| E2 | Flag nova `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED`; desligada = TED/PIX não oferecido. Ligada só depois do relatório validado com a Columbia. |
| E3 | Lotes FINALIZADO aguardando conferência não são marcados; passam pela guarda nova da L8. |
| E4 | **Apagar** `ExcecaoDestino`, trilha e tabelas (o usuário nunca cadastrou exceção; flags desligadas em prod). Drop das tabelas/triggers; FK em itens fica inerte ou removida. |
| P1 | Defaults aceitos: HMAC do fingerprint + versão mascarada; `sispag:executar` cadastra, `sispag:autorizar_favorecido` aprova/revoga, aprovador ≠ cadastrante; REAPROVACAO_PENDENTE aberta pelo sistema basta um aprovador; alerta in-app `SISPAG_DESTINO_ALTERADO`; canal habitual sai do item e só alimenta o relatório; relatório só leitura com ação "criar autorização PENDENTE"; `sispag:excecao` → `sispag:autorizar_favorecido`, `sispag:conferir` removida. |

### P1 em aberto — como a analista confere se o destino está atualizado, com o destino mascarado
Proposta (a confirmar pelo usuário no diff):
1. **Selo de conferência** no item/autorização: "igual ao Conexos (lido às HH:MM) · igual ao aprovado em DD/MM por X" ou "diferente do aprovado". O sistema compara o cmn025 ao vivo com o fingerprint, que é a pergunta real.
2. **Máscara parcial reconhecível:** banco e agência completos, conta com os 4 últimos dígitos; PIX com tipo da chave e trecho (ex.: CNPJ `12.***.***/0001-90`), titular/nome do favorecido.
3. **Botão "reconferir com o Conexos"**: relê o cmn025 na hora e atualiza o selo.
4. **Revelar completo** só para `sispag:autorizar_favorecido`, auditado na trilha (I10h já previa "revelar só para quem edita").
