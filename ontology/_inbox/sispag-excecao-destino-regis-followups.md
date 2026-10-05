# Follow-ups do Regis-Review — sispag-excecao-destino (ADR-0061)

Run: `docs/regis-review/2026-10-05-1645-sispag-excecao-destino/` (8 QAs; consolidador não rodado, nenhum P0).
**Nenhum P0 (Crítico).** Nada abaixo foi implementado neste ciclo (anti-recursão).

- [P1] Uso da exceção no envio grava item e trilha em dois commits: pôr `setExcecaoDestinoItem` e `marcarUso` na mesma transação (fault-tolerance-1)
- [P1] `RemessaService.ts` com 1600 linhas e complexidade 93: dividir por responsabilidade (modifiability-1, pré-existente)
- [P2] Reler a exceção logo antes da escrita no fin015 (janela entre pré-voo e import) (fault-tolerance-3)
- [P2] Criar workflow agendado para o job `aposentar-excecoes-substituidas` (hoje só à mão) (fault-tolerance-2 / availability-2 / deployability-2)
- [P2] Alerta quando a flag de exceção está ligada com menos de 2 titulares de `sispag:excecao` (deployability-3)
- [P2] Trigger de auditoria em `excecao_destino` (hoje só a trilha é só-inclusão; update direto no banco não deixa rastro) (security-1)
- [P2] Conta/chave em claro na tabela e em `audit.depois.destino`: plano LGPD/anonimização (security-2)
- [P2] Alarme agregado para negações de auto-aprovação e aviso a terceiro ao cadastrar/aprovar (security-3)
- [P2] Teto de valor ou terceira aprovação contra conluio de dois titulares (security-4, watchlist da ADR-0061)
- [P2] Script de reversão testado para a conversão `aprovar_destino` → `excecao` (deployability-1)
- [P2] Varredura `aposentarSubstituidas` sequencial: concorrência 4 e log de duração (performance-1)
- [P2] Testes dos jobs `aposentar-excecoes-substituidas` e `probe-destino-manual-uso` (testability-1)
- [P2] Injetar gerador de id no `ExcecaoDestinoRepository` (testability-2)
- [P2] Painel: contador de APROVADA com divergência pendente e limite de PENDENTE configurável (availability-3)
- [P2] Frontend DS: Tooltip/skeleton/retry/aria-label na tela de exceções (DesignSystemReviewer P2)
- [P2] `routes/sispag.ts` acessa clients e repositórios direto; dividir arquivo (modifiability-2)
- [P3] Alias `SISPAG_DESTINO_MANUAL_ENABLED` sem data de remoção (integrability-1)
- [P3] `list`/`listAprovadas` sem LIMIT e filtro `IS NULL OR` (performance-2)
- [P3] Piso de cobertura por arquivo para repositório e regra novos (testability-3)

## Itens abertos da feature (não são do Regis-Review)

- Q1 (layout da planilha) bloqueia T10, carga em planilha, como follow-up.
- Q4: contagem de `destino_manual` em produção não medida (sem acesso ao banco).
- Q6 decidida (flag renomeada + alias); Q8 parcial; Q10 e Q11 abertas.
