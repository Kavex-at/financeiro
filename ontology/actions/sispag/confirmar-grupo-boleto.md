---
name: confirmarGrupoBoleto
type: action
entity: GrupoBoleto
ontology_version: "0.48.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-20
preconditions:
  - "Usuário com `sispag:executar`; identidade do JWT (nunca `sistema`, I21i)."
  - "I21a–d reavaliadas ao vivo-local no momento do confirmar (anti-TOCTOU, nunca do cache da sugestão): boleto livre e no pool, N >= 2 títulos do mesmo pesCod e da mesma filial, soma exata ao centavo pela régua líquida, cada título elegível (I21c)."
  - "Origem SUGERIDO: o conjunto é o grupo fechado recalculado (I21e/f) e está `confirmavel`. Origem MANUAL: janela 0..10 dias por título (I21g), senão GroupedBoletoDueWindowError (422)."
  - "Datas pela I21h: boleto não vencido em relação à data de débito (do lote, ou o próprio vencimento do boleto sem lote)."
  - "Aviso TITULO_VENCE_ANTES_DO_BOLETO reconhecido quando exigido (WarningAcknowledgementRequiredError, 422), conferido contra a avaliação recalculada."
postconditions:
  - "1 GrupoBoleto CONFIRMADO + N GrupoBoletoTitulo com snapshot (valor líquido, vencimento), origem, intercambiavel, avisosReconhecidos."
  - "Par (pesCod, emissorChave) criado VIGENTE na mesma transação, ou reutilizado (no-op no par)."
  - "Evento GRUPO_CONFIRMADO na trilha (código mascarado); títulos saem da sugestão 1:1 com desfecho EM_GRUPO (I15q)."
  - "Confirmar de novo o mesmo (boleto, títulos) devolve o grupo existente; corrida resolvida pelos índices únicos parciais WHERE estado = 'CONFIRMADO' (I21i)."
side_effects:
  - "Escrita só local, numa transação. Zero escrita no Conexos (o borderô só nasce na remessa, I21l)."
  - "LogService em pt-BR, código sempre mascarado."
---

# confirmarGrupoBoleto

ADR-0077 (P0-1, P1-2, P1-3). A pessoa confirma que **um** boleto DDA paga **N** títulos do mesmo credor.
Recusa com erro nomeado: soma (`GroupedBoletoSumMismatchError`), título inelegível
(`GroupedBoletoTitleIneligibleError`), filiais diferentes (`GroupedBoletoCrossBranchError`), janela manual
(`GroupedBoletoDueWindowError`). Título com `DecisaoSugestaoBoleto CONFIRMADA` não entra: anular a decisão
antes (I15l). O grupo confirmado fica disponível para inclusão manual e para a formação automática como uma
unidade (I21j). Idempotente. **Planned.**
