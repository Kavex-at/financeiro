# Follow-ups de observabilidade — sispag-verificacoes-ted-pix (ADR-0063, Task 11)

Revisão do ObservabilityAdvisor em 2026-10-06 sobre o job `calcular-perfil-canal` e os eventos da
verificação TED/PIX. Nenhum P0.

## Aplicado nesta entrega

- **P1** `PerfilCanalService`: cada leitura que falha (fin133, fin095, fin010 borderôs/baixas) loga
  `perfil de canal: leitura falhou (<etapa>)` com filial, conta ou borderô e só o tipo do erro.
- **P1** `CalcularPerfilCanalJob`: falha ao fechar a run no caminho de erro não engole mais o log
  estruturado.
- **P2** `VerificacaoTedPixService`: o log de conclusão sai como `warn` quando houve item pendente
  ou retirado.

## Pendente (P2)

1. `IngestaoPagamentosService`: a falha ao encerrar bloqueios por duplicidade só gera `warn`; levar
   para as métricas da run (`falhaEncerrarBloqueios`).
2. `VerificacaoTedPixService`: acrescentar ao log de conclusão as contagens de alertas criadas e
   fechadas (hoje só na trilha `sispag_verificacao_evento`).
3. Workflow `calcular-perfil-canal.yml` (timeout 45 min): run morta por timeout fica `running` em
   `job_execucao`; conferir se algum reaper de runs presas cobre o pipeline (hoje só a staleness,
   em até 9 dias).
4. `CalcularPerfilCanalJob`: no erro de "zero perfis", dizer a causa provável (baixas ou débitos
   em zero, ou limiares altos demais).
