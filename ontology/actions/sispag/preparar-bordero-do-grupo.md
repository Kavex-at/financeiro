---
name: prepararBorderoDoGrupo
type: action
entity: LotePagamento
ontology_version: "0.48.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-21
preconditions:
  - "L8 (gerarRemessa) em curso, depois de criarLote e antes de importar; lote nativo aberto (rascunho)."
  - "Kill-switch sispagLiveWriteEnabled ligado, conexosWriteEnabled ligado, conexosDryRun desligado (dry-run monta e loga, sem POST)."
  - "Grupo elegível ao vivo, conferido antes de qualquer escrita da remessa (I21p(1)): títulos liberados e não pagos, soma exata pela régua líquida, boleto no pool, par VIGENTE."
  - "gerNum da conta pagadora do lote lido ao vivo do fin005 (H2/H10); ausente => falha antes do POST."
  - "Grupo com J rejeitado antes: borderô antigo lido no fin010 pela identidade borCod + borTimCad (I21s): ausente (sem linha, ou borCod reusado com outro borTimCad)/cancelado => cria novo; em borderosPendentes do lote novo => reaproveita; senão => retirada I21p(3) com BORDERO_ANTERIOR_NAO_RESOLVIDO."
postconditions:
  - "Borderô fin010 em cadastro (borVldTipo 2, borDtaMvto = dataDebito) com N baixas, cada uma do título esperado, e vlrTotalLiquido == valorBoleto em centavos, observados na releitura (I21l) — criado agora ou reaproveitado."
  - "Borderô importado como UM item nativo (borCod, sem docCod/titCod, itsMnyValor == valorBoleto), observado na releitura (I21n)."
  - "Barra do boleto vinculada ao item pela sequência I17e (modalidade 7/6, I21o), antes da guarda I16."
  - "Write-ahead com t0 (antes do POST fin010), t1 (depois), borCod + borTimCad (identidade, com filCod; I21l), gerNum, baixas e etapa; evento BORDERO_PREPARADO (ou BORDERO_REAPROVEITADO). Nada escrito em borEspNrbanco (sem marcador, emenda 2026-10-21)."
side_effects:
  - "Escrita no ERP: POST fin010, fin010/baixas/validacao/tituloBaixa, POST fin010/baixas, fin015 borderosPendentes/importar, sequência I17e (validacao/codigoBarras, confirmaCodigoBarras, PUT finItemSispag)."
  - "Identidade Conexos registrada no write-ahead (I-2); LogService pt-BR, código mascarado."
  - "Nunca finalizarBordero, cancelarBordero nem fin146 (I21m)."
  - "Falha transitória: aborta, ledger failed, retomada continua (I21p(2)). Falha determinística: retirada do grupo + limparBorderoDoGrupo do borderô criado nesta remessa (I21p(3))."
---

# prepararBorderoDoGrupo

ADR-0077 (P0-4). Etapa `preparar_bordero` do L8, **persistida** no write-ahead (escreve no ERP), chamada
apenas de `RemessaService.gerarRemessa`, por grupo, entre `criarLote` e `importar`. Ordem completa:
`criarLote → preparar_bordero → importar (títulos avulsos + borderôs) → vincular_codbar → guarda I16 →
finalizar → gerar_remessa`. Sem permissão nova: herda `sispag:executar` de quem gera a remessa; o grupo já
tem autor próprio (I21i). Retomável pelo reconhecimento ao vivo da I21s (identidade `filCod` + `borCod` +
`borTimCad`; busca por janela de `borTimCad` entre `t0` e `t1` quando a resposta se perdeu; baixas
faltantes; item já importado). O ERP reusa `borCod` depois de `excluirBordero`: `borCod` sozinho nunca
identifica o borderô (emenda 2026-10-21 da ADR-0077). O vínculo da barra **não** depende do modo I17k (P0-5). **Planned.**
