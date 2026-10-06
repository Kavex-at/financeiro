---
type: regis-review-kanban
run_id: 2026-10-06-1500-sispag-remessa-download-export
total: 23
counts: { p0: 0, p1: 0, p2: 10, p3: 13 }
---

# Kanban — financeiro — 2026-10-06-1500-sispag-remessa-download-export

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.

---

## P0 — Crítico

_Nenhum card nesta prioridade._

---

## P1 — Alto

_Nenhum card nesta prioridade._

---

## P2 — Médio

### [availability-1] Validar conteúdo do `.REM` baixado pelo gabCod

**QA**: Availability
**Tactic alvo**: Sanity Checking
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> O fallback por `gabCod` devolve o conteúdo sob o nome do lote sem conferir se é o arquivo certo (F-availability-1).

**Melhoria Proposta**
> Sanity Checking: ler o header do CNAB (sequencial da remessa) e comparar com `remessaNum`; se divergir, lançar `RemittanceFileUnavailableError`. Tocar `RemessaService.baixarArquivo`.

**Resultado Esperado**
> Conteúdo de outro arquivo nunca é entregue: validações de identidade no fallback 0 → 1.

**Métricas de sucesso**
- Validação de identidade no fallback: 0 → 1

**Risco de não fazer**
> entrega silenciosa de CNAB errado se o `gabCod` registrado divergir.

**Dependências**: nenhuma

---

### [availability-2] Contar uso do fallback e indisponibilidade; confirmar timeout do download

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> Não há contagem do fallback nem de `REMESSA_ARQUIVO_INDISPONIVEL`, e o timeout do GET de download não foi confirmado (F-availability-2).

**Melhoria Proposta**
> Monitor: elevar o log de arquivo indisponível a `warn` com campos contáveis, confirmar o timeout em `ConexosBaseClient.getGeneric` e expor no painel de operação.

**Resultado Esperado**
> Alerta quando arquivos somem do fin015 acima de um limite semanal; download com timeout explícito.

**Métricas de sucesso**
- Eventos contáveis: 0 → 2 tipos

**Risco de não fazer**
> degradação só percebida pelo analista.

**Dependências**: painel-operacao

---

### [deployability-1] Garantir que o frontend tolere backend antigo na exportação

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> O FE novo chama rota inexistente no BE antigo durante a janela de deploy, resultando em 404 genérico.

**Melhoria Proposta**
> Mapear 404/405 em `lib/sispag.ts` para mensagem "Exportação indisponível, tente em instantes"; documentar ordem BE antes de FE no DEPLOY.md.

**Resultado Esperado**
> Erro amigável durante a janela; 0 telas quebradas.

**Métricas de sucesso**
- Mensagem tratada em 404: não → sim

**Risco de não fazer**
> confusão pontual a cada rota nova.

**Dependências**: nenhuma

---

### [fault-tolerance-1] Validar o corpo de `baixarRemessa` antes de servir como remessa

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-1

**Problema**
> `baixarRemessa` converte qualquer resposta em string (`String(raw ?? '')`); um objeto vira `"[object Object]"` e o fallback novo o entrega como arquivo de remessa.

**Melhoria Proposta**
> Sanity Checking: em `ConexosSispagWriteClient.baixarRemessa`, rejeitar resposta não-string ou vazia com `ConexosError`; em `baixarArquivo`, aplicar `RemessaCnabValidator` (linhas de 240 colunas) ao conteúdo e, se inválido, lançar `RemittanceFileUnavailableError`.

**Resultado Esperado**
> Download nunca devolve conteúdo que não seja CNAB válido. Caminhos validados: 0/1 → 1/1.

**Métricas de sucesso**
- Caminhos de download com validação do corpo: 0/1 → 1/1
- Teste cobrindo resposta objeto/vazia: ausente → presente

**Risco de não fazer**
> o analista baixa um arquivo corrompido sem aviso quando o Conexos mudar o envelope de resposta.

**Dependências**: nenhuma

---

### [integrability-1] Validar a forma do CNAB no download por gabCod

**QA**: Integrability
**Tactic alvo**: Adhere to Standards / Contract testing
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> `baixarRemessa` coage qualquer resposta para string; um corpo JSON de erro viraria "remessa" válida no fallback.

**Melhoria Proposta**
> No fallback de `RemessaService.baixarArquivo`, reaproveitar `RemessaCnabValidator` (ou checar linhas de 240 colunas) e lançar `RemittanceFileUnavailableError` se inválido; no client, rejeitar `raw` não-string. Adicionar teste com fixture sanitizada (já existem em `__fixtures__/`).

**Resultado Esperado**
> Respostas não-CNAB aceitas: possível → 0; fixtures de contrato 0 → 1.

**Métricas de sucesso**
- Respostas não-CNAB aceitas: possível → 0

**Risco de não fazer**
> remessa corrompida entregue silenciosamente se o Conexos mudar o formato.

**Dependências**: nenhuma

---

### [security-1] Registrar o ator no export de títulos de remessas

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S
**Findings**: F-security-1

**Problema**
> O export só emite um log de aplicação sem usuário. Uma planilha com credores e valores pode sair sem rastro de quem a baixou.

**Melhoria Proposta**
> Passar o usuário autenticado a `exportar()` e registrar ator + loteIds + contagem na trilha de auditoria persistida das ações SISPAG (ou no `LogService` com campo `actor`).

**Resultado Esperado**
> 100% dos exports com ator e lotes registrados (hoje 0%).

**Métricas de sucesso**
- Exports com ator persistido: 0% → 100%

**Risco de não fazer**
> vazamento interno da carteira de pagamentos sem investigação possível.

**Dependências**: nenhuma.

---

### [testability-1] Cobrir 403 e erro inesperado na rota de export de títulos

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> A rota POST /sispag/remessas/titulos/exportar não tem teste direto de 403 nem do rethrow de erro não-domínio.

**Melhoria Proposta**
> Adicionar 2 casos em `routes/sispag.test.ts`: usuário sem `sispag:ver` → 403 sem chamar o serviço; serviço lançando Error genérico → 500.

**Resultado Esperado**
> Ramos da rota de export testados 3/5 → 5/5; teste de rota do delta 4 → 6 casos.

**Métricas de sucesso**
- Casos de teste da rota de export: 4 → 6

**Risco de não fazer**
> regressão de autorização passa despercebida.

**Dependências**: nenhuma

---

### [performance-1] Paginar `listLotes` da aba Finalizados

**QA**: Performance
**Tactic alvo**: Bound Queue Sizes
**Esforço**: M (2-5d)
**Findings**: F-performance-1

**Problema**
> `listLotes` carrega todos os lotes e todos os itens sem LIMIT; o delta aumentou o cabeçalho devolvido.

**Melhoria Proposta**
> Adicionar `limit/offset` (padrão do CLAUDE.md) ou janela por `criado_em` na aba Finalizados. Tocar `LotePagamentoRepository.listLotes`, a rota `GET /sispag/lotes` e `page.tsx`.

**Resultado Esperado**
> Payload da aba limitado a uma página; tempo de resposta constante com o crescimento da base.

**Métricas de sucesso**
- lotes por resposta: ilimitado → ≤ 50
- p95 de `GET /sispag/lotes`: baseline a medir → < 500ms

**Risco de não fazer**
> a aba degrada gradualmente com o acúmulo de lotes automáticos.

**Dependências**: ajuste no frontend (`useTabelaFiltro` pagina no cliente hoje).

---

### [testability-2] Teste de integração Postgres para listLotesPorIds e projeção de listLotes

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M (2–5d)
**Findings**: F-testability-2

**Problema**
> A projeção SQL nova é validada só com pool mockado.

**Melhoria Proposta**
> Criar `describe('integration: LotePagamentoRepository')` contra Postgres de teste (Sandbox), com 3 lotes e itens.

**Resultado Esperado**
> Testes de integração em repositórios SISPAG 0 → 3 casos neste repositório.

**Métricas de sucesso**
- Casos de integração: 0 → 3

**Risco de não fazer**
> erro de SQL só descoberto em produção.

**Dependências**: setup de Postgres de teste (docker-compose.test)

---

### [modifiability-1] Fatiar RemessaService, LotePagamentoRepository, routes/sispag, lib/sispag e LoteCard

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: L
**Findings**: F-modifiability-1, F-modifiability-4

**Problema**
> Cinco arquivos do SISPAG têm 1087-1665 LOC e receberam mais ~200 linhas neste delta; toda feature os toca.

**Melhoria Proposta**
> Split Module: extrair `RemessaDownloadService` (baixarArquivo + fallback), router `sispag/remessas.ts`, repositório de leitura de lotes (listLotes/listLotesPorIds/projeção), subcomponentes de `LoteCard` e `lib/sispag/` por domínio. Fazer proporcionalmente a cada tweak.

**Resultado Esperado**
> Arquivos > 600 LOC no SISPAG: 5 → 0.

**Métricas de sucesso**
- max LOC por arquivo SISPAG: 1665 → 600

**Risco de não fazer**
> conflitos e regressões crescentes nas frentes do SISPAG.

**Dependências**: nenhuma

---


## P3 — Baixo

### [availability-3] Endurecer o export (log não bloqueante e teto de títulos)

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: S
**Findings**: F-availability-3, F-availability-4

**Problema**
> O log pós-geração é aguardado e não há teto de itens (F-availability-3, F-availability-4).

**Melhoria Proposta**
> Exception Prevention / Handling: capturar falha do log sem derrubar a resposta e limitar o total de títulos (ex.: 20 mil) com 422 explicativo.

**Resultado Esperado**
> Export nunca falha por causa do log; memória limitada de forma determinística.

**Métricas de sucesso**
- Teto de títulos: nenhum → definido

**Risco de não fazer**
> baixo; pressão de memória pontual.

**Dependências**: nenhuma

---

### [fault-tolerance-2] Comparar identidade do conteúdo no fallback por `gabCod`

**QA**: Fault Tolerance
**Tactic alvo**: Comparison
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-2

**Problema**
> O fallback por `gabCod` não confere que o arquivo baixado corresponde ao `remessaNum`/lote registrado.

**Melhoria Proposta**
> Comparison: ler o header CNAB (número sequencial do arquivo) e comparar com `lote.remessaNum` antes de devolver; divergência vira `RemittanceFileUnavailableError`.

**Resultado Esperado**
> Arquivo servido sempre pertence ao lote pedido, mesmo com reciclagem de `gabCod`.

**Métricas de sucesso**
- Fallbacks com checagem de identidade do conteúdo: 0/1 → 1/1

**Risco de não fazer**
> baixa probabilidade de servir remessa de outro lote após reciclagem de `gabCod` no ERP.

**Dependências**: fault-tolerance-1 (reutiliza o parser CNAB)

---

### [fault-tolerance-3] Medir duração e tamanho da exportação de títulos

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3

**Problema**
> A exportação serializa tudo em memória sem métrica de duração/linhas além do log de contagem.

**Melhoria Proposta**
> Condition Monitoring: registrar `durationMs` e número de linhas no log `títulos de remessas exportados`; revisar `MAX_LOTES_EXPORT` com base no p95 observado.

**Resultado Esperado**
> Visibilidade do custo real da exportação antes que ela degrade o processo.

**Métricas de sucesso**
- Exportações com duração registrada: 0% → 100%

**Risco de não fazer**
> crescimento de lotes degrada o painel sem sinal prévio.

**Dependências**: nenhuma

---

### [integrability-2] Garantir paridade de MAX_LOTES_EXPORT/STATUS_COM_REMESSA entre BE e FE

**QA**: Integrability
**Tactic alvo**: Manage Resource Coupling
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> Constantes copiadas à mão com comentário "espelha".

**Melhoria Proposta**
> Teste de paridade que leia ambos os arquivos, ou expor o teto num endpoint existente.

**Resultado Esperado**
> Divergência detectada em CI; testes de paridade 0 → 1.

**Métricas de sucesso**
- Testes de paridade: 0 → 1

**Risco de não fazer**
> UI e BE divergem após mudança de teto.

**Dependências**: nenhuma

---

### [integrability-3] Preferir gabCod registrado como caminho primário do download

**QA**: Integrability
**Tactic alvo**: Orchestrate
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> O primário depende de página única de 20 linhas; o fallback paga 2 chamadas.

**Melhoria Proposta**
> Quando `nativeGabCod` existe, baixar direto por ele e usar a grade como fallback, mantendo a checagem de nome.

**Resultado Esperado**
> Chamadas ao Conexos por download: 2 → 1.

**Métricas de sucesso**
- Chamadas ao Conexos por download: 2 → 1

**Risco de não fazer**
> carga desnecessária em sessão Conexos limitada.

**Dependências**: validar em dev que o download por gabCod devolve o arquivo certo.

---

### [modifiability-2] Reusar BankingCalendar para fuso e extrair serializador XLSX comum

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-2, F-modifiability-3

**Problema**
> Offset BRT hardcoded e serialização exceljs duplicada com Permutas.

**Melhoria Proposta**
> Abstract Common Services: `XlsxPlanilhaWriter` compartilhado; datas via `BankingCalendar`.

**Resultado Esperado**
> Serializadores XLSX: 2 → 1; offsets locais: 1 → 0.

**Métricas de sucesso**
- serializadores XLSX: 2 → 1

**Risco de não fazer**
> divergência de formatação e fuso entre planilhas.

**Dependências**: nenhuma

---

### [modifiability-3] Externalizar o teto de lotes do export

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> `MAX_LOTES_EXPORT` é constante de código; ajustar exige redeploy.

**Melhoria Proposta**
> Defer Binding: ler via `EnvironmentProvider` com o default atual.

**Resultado Esperado**
> Ajuste sem alteração de código.

**Métricas de sucesso**
- constantes de regra hardcoded no export: 2 → 1

**Risco de não fazer**
> baixo.

**Dependências**: nenhuma

---

### [performance-2] Pular a grade fin015 quando o lote já tem `gabCod` registrado

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S (≤1d)
**Findings**: F-performance-2

**Problema**
> O download sempre consulta a grade (página única de 20) antes de cair no `gabCod`; no caso reciclado são 2 chamadas Conexos seriais.

**Melhoria Proposta**
> Baixar direto por `gabCod` registrado e validar o nome devolvido; usar a grade só sem `gabCod`. Tocar `RemessaService.baixarArquivo`. Preservar a regra de nunca usar `gabCod` da grade.

**Resultado Esperado**
> Chamadas Conexos por download de 2 → 1 no caso com `gabCod`.

**Métricas de sucesso**
- chamadas Conexos por download: 2 → 1
- p95 do download no caso reciclado: até 20s → < 10s

**Risco de não fazer**
> espera longa e risco de timeout no Render nos lotes com `flpCod` reciclado.

**Dependências**: confirmar que `baixarRemessa` devolve o nome do arquivo para validar identidade.

---

### [performance-3] Medir duração e bytes do export e carregar `exceljs` sob demanda

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S (≤1d)
**Findings**: F-performance-3, F-performance-4

**Problema**
> O export não registra duração/tamanho, e `exceljs` é importado estaticamente no código compartilhado com ~58 jobs.

**Melhoria Proposta**
> Adicionar `ms` e `bytes` ao log de `exportar`; usar `await import('exceljs')` dentro de `serializar` (ou `WorkbookWriter` em stream se o teto subir).

**Resultado Esperado**
> Dados reais para calibrar o teto de 50 lotes; menos módulos carregados no boot dos jobs.

**Métricas de sucesso**
- campos de duração/tamanho no log: 0 → 2
- tempo de import no boot de job: baseline a medir → redução mensurável

**Risco de não fazer**
> o teto de 50 fica no escuro; o custo de boot permanece.

**Dependências**: nenhuma.

---

### [security-2] Sanitizar o filename do download de remessa

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S
**Findings**: F-security-2

**Problema**
> O download usa `nomeArquivo` do ERP direto no header; o export já sanitiza.

**Melhoria Proposta**
> Extrair um helper de nome de arquivo (remove `[^\w.-]`) e usar nas duas rotas. Tactic: Validate Input.

**Resultado Esperado**
> Sítios com filename não sanitizado: 1 → 0.

**Métricas de sucesso**
- Sítios sem sanitização: 1 → 0

**Risco de não fazer**
> baixo; erro 500 em nome atípico.

**Dependências**: nenhuma.

---

### [security-3] Teste de regressão contra formula injection no export

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S
**Findings**: F-security-3

**Problema**
> O XLSX é seguro hoje por usar células string, mas nada trava uma mudança para CSV ou para células de fórmula.

**Melhoria Proposta**
> Teste que gere o xlsx com credor `=1+1` e `@SUM(A1)` e confirme que a célula lida é string (não fórmula); comentar no serviço que CSV exigiria prefixar `'`.

**Resultado Esperado**
> Testes de formula injection: 0 → 1.

**Métricas de sucesso**
- Testes de formula injection: 0 → 1

**Risco de não fazer**
> regressão silenciosa em futura troca de formato.

**Dependências**: nenhuma.

---

### [testability-3] Gravar fixtures de resposta do fin015 para o download de remessa

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S (≤1d)
**Findings**: F-testability-3

**Problema**
> O fallback por gabCod depende de formato de resposta do Conexos descrito só em literais.

**Melhoria Proposta**
> Redigir (como em `redigir-fixture-rem.ts`) uma resposta do fin015 em `__fixtures__` e usá-la nos casos de `baixarArquivo`.

**Resultado Esperado**
> Fixtures de resposta fin015: 0 → 2 (grade com 20 itens sem o arquivo; linha sem gabLngDados).

**Métricas de sucesso**
- Fixtures fin015: 0 → 2

**Risco de não fazer**
> drift do contrato não detectado.

**Dependências**: nenhuma

---

### [deployability-2] Avaliar flag simples para recursos novos de SISPAG

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: M (2–5d)
**Findings**: F-deployability-2

**Problema**
> Sem flags, qualquer feature entra em produção para todos de uma vez.

**Melhoria Proposta**
> Flag por env/permissão para features de leitura de baixo risco; opcional.

**Resultado Esperado**
> Habilitar por grupo antes de abrir geral.

**Métricas de sucesso**
- Features com flag: 0 → 1

**Risco de não fazer**
> baixo.

**Dependências**: nenhuma

---

