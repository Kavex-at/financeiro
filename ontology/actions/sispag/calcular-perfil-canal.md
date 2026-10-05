---
name: calcularPerfilCanal
type: action
entity: PerfilCanalFornecedor
ontology_version: "0.36.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/jobs/probe-canal-por-fornecedor.ts
  - src/backend/domain/client/ConexosExtratoClient.ts
last_review: 2026-10-05
preconditions:
  - "Job periódico (cron) ou disparo administrativo; uma rodada por vez (advisory lock)."
  - "Limiares de confiança e janela de histórico vindos da configuração do tenant."
postconditions:
  - "Para cada favorecido com pagamento na janela: PerfilCanalFornecedor gravado (UPSERT) com contagens por grupo, pagamentosUnicos, mesesDistintos, grupoDominante, participacao, confianca, calculadoEm, jobRunId."
  - "Rodada com falha não apaga perfis anteriores; filial ilegível é registrada como parcial no JobRun."
side_effects:
  - "Leitura no Conexos: fin010 (baixas a pagar por borderô, todas as páginas) e fin095 (débitos do extrato). Nenhuma escrita no ERP."
  - "Escrita local: sispag_perfil_canal_fornecedor + JobRun."
---

# calcularPerfilCanal

ADR-0063, I13i. Promove a lógica da `probe-canal-por-fornecedor.ts` a job: casa cada baixa a pagar
com o débito do extrato por valor exato e data ±1,5 dia, **só casamento único**, classifica o canal
pelo histórico do banco e agrega por favorecido.

Cadência sugerida: diária fora do horário de operação (o perfil muda devagar; a varredura de
borderôs é cara). Sujeita à mesma disciplina de sessão Conexos dos demais crons (secrets próprios,
cap de sessões).
