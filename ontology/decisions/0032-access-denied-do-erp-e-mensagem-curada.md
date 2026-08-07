# ADR-0032 — `ACCESS_DENIED` do ERP vira mensagem acionável; erro typed fala ao cliente

- **Status:** aceito
- **Data:** 2026-08-06
- **Contexto de origem:** `/feature-tweak integrations/conexos` — incidente em produção do "Processar"
  da aba Automáticas (Frente I), diagnosticado nos logs do Render em 2026-08-06
- **Relacionado:** ADR-0026 (recusa determinística do ERP), ADR-0029 (o "Processar" volta a ser a baixa
  `fin010`), `ontology/integrations/conexos.md` §"Contrato de leitura de ERRO",
  Regis card `security-3` (F-security-5)

## Contexto

O analista clicou **Processar** em `/permutas` (aba Automáticas) e recebeu
`Falha ao processar o processo 2444: API 500 — Internal server error`. Mesma coisa no processo 2074.

A cadeia real, lida no log:

```
POST /permutas/adiantamentos/19017/reconciliar
  → auto-alocação (ReconciliacaoPermutaService)
  → AlocacaoPermutasService.buscarInvoices
  → ConexosCadastroClient.listDeclaracaoByProcesso   (imp019 + imp223 em Promise.all)
      imp019/list → 200 count=0
      imp223/list → 403 ACCESS_DENIED
  → Promise.all rejeita → alocar lança → criarRascunhosAtomico re-lança
  → escapa do reconciliar → errorMiddleware → 500 genérico
```

O corpo do 403 continha **o diagnóstico inteiro**: usuário do ERP (`SIMONE_PEREIRA`), tela negada
(`IMP_223` — DUIMP), operação (`SELECT`), caminho de menu e a lista de quem pode conceder o acesso
(`gerentesUsuario`). Nada disso chegava a lugar nenhum, por duas razões independentes:

1. **O envelope não era lido.** `ACCESS_DENIED` não tem `messages[]` nem `itemMessages` — as duas únicas
   formas que o `ErpErrorInterpreter` sabia ler. Caía no fallback `err.message`, que é
   `Conexos call to imp223/list failed`: verdadeiro, inútil.
2. **Nada typed atravessava o middleware.** O `errorMiddleware` devolve corpo genérico por decisão
   deliberada (Regis `security-3` / F-security-5: o 500 vazava `err.message` e o corpo cru do ERP).
   Mesmo que a frase existisse, ela morria ali.

Resultado prático: um problema de **permissão**, cuja solução o próprio ERP já tinha escrito na resposta,
custou uma escavação no log do Render para ser identificado.

Por que só agora, e só com alguns analistas: desde a sessão por usuário (2026-07-10,
`ConexosSessionResolver`), uma chamada dentro de request corre com a credencial Conexos **do analista
logado**; job/cron cai no robô. O robô **tem** o grant em `IMP_223` — por isso a eleição monta a lista de
automáticas sem reclamar e só o clique falha. A superfície é por-analista, não por-processo.

## Decisão

### 1. `ACCESS_DENIED` ganha leitor próprio

Novo `domain/errors/ErpAccessDenied.ts`, dono do envelope de ponta a ponta (parse + frase). Mora em
`errors/` porque os três consumidores precisam dele e `ConexosError` não pode depender de um serviço:

| Consumidor | Uso |
|---|---|
| `ConexosError` | classificação + `userMessage` |
| `ErpErrorInterpreter` | `friendly` (vence `itemMessages` e o mapa PT) |
| log do `errorMiddleware` | payload cru, server-side |

Não fica no `ErpResponseReader` porque aquele é leitura **crua**, sem tradução — e este módulo compõe
texto de operação. Como todo consumidor está em caminho de tratamento de erro, **nunca lança**.

A frase nomeia a tela pelo `cpoDesArquivo` (`IMP_223`), que é a chave que o admin do ERP usa para
conceder acesso, e omite a conta genérica `CONEXOS` da lista de gerentes — mandar o analista "falar com
CONEXOS" é conselho morto.

### 2. `ACCESS_DENIED` é uma recusa com status próprio

Estende a tabela do ADR-0026:

| Situação | `code` | `retryable` | HTTP para fora |
|---|---|---|---|
| 4xx com envelope `ACCESS_DENIED` | `CONEXOS_ACCESS_DENIED` | `false` | **403** |
| Demais 4xx (exceto 408/429) | `CONEXOS_UPSTREAM_REJECTED` | `false` | 502 |

Continua não-retentável (permissão não muda por insistência — ADR-0026 já valia). O que muda é o
**desfecho**: 403 conta ao cliente que o problema é de **acesso**, não do dado enviado, que é o que um
502 sugere. Um `403` sem o envelope segue como recusa comum em 502 — o status sozinho não basta.

### 3. Exceção CURADA ao corpo genérico (revisão do F-security-5)

O `errorMiddleware` passa a responder com `statusCode` + `userMessage` **quando o erro implementa
`HandlerError`** — cujo contrato já define `userMessage` como *"human, pt-BR, curated. Safe to render in
a banner"* e `details` como whitelisted, sem PII nem segredo.

Tudo que **não** é typed continua genérico em 500. A regra do F-security-5 permanece intacta para o que
ela protegia: `err.message` cru e o corpo do ERP **nunca** cruzam. O que passa a existir é um canal
declarado para o que a aplicação **escolheu** dizer.

Aprovado explicitamente por Yuri (2026-08-06) incluir na frase o usuário do ERP e os nomes dos gerentes:
são a parte acionável, e são colegas do próprio analista.

## Consequências

- Toda `ACCESS_DENIED` de qualquer endpoint (`com298`, `com308`, `fin010`, `imp019`, `imp223`, …) chega
  ao analista nomeando tela, ação e quem libera — não só a que motivou o incidente.
- Erros typed que já existiam (`AlocacaoSaldoError`, `ConexosError` de timeout/recusa, …) passam a
  atravessar o middleware com a própria mensagem, em vez de virar 500 genérico quando a rota esquecia de
  mapeá-los. O mapeamento por-rota deixa de ser a única porta.
- **Não resolve o acesso em si.** O grant em `IMP_223` para os analistas da Frente I segue pendente do
  lado do ERP (`CATIA_OLIVEIRA` / `MPS_FRANCINEI` / `RICARDO_PRADO` / `CONEXOS`).
- **Fora de escopo, registrado como follow-up:** rotear as leituras Conexos pelo robô mantendo as
  escritas `fin010` na sessão do analista. Isso eliminaria a classe inteira de "analista sem permissão de
  leitura numa tela acessória" — a escrita é que precisa sair no nome dele, não a consulta. Ver
  `ontology/_inbox/conexos-access-denied-followups.md`.

## Alternativas consideradas

- **Engolir o 403 do `imp223` e seguir.** Rejeitada, e é a alternativa perigosa: `temDi` vem de
  `decl !== undefined` (`AlocacaoPermutasService`), e o `imp019` respondeu `count=0`. Engolir o erro
  produziria `temDi: false` e a recusa *"invoice sem D.I/DUIMP — cannot be permuted"* num processo que
  provavelmente **tem** DUIMP. Trocaria um erro barulhento e correto por um silencioso e errado.
- **Só enriquecer o log, sem mudar a UI.** Rejeitada: mantém o diagnóstico dependente de acesso ao
  Render, e a informação já estava lá — o custo é a escavação, não a ausência.
- **Mapear o erro na rota `/reconciliar`, como `/alocacoes` faz.** Rejeitada como solução única: resolve
  uma rota e deixa as outras cegas. O mapeamento central cobre todas; a rota individual continua livre
  para dar tratamento especial quando precisar.
