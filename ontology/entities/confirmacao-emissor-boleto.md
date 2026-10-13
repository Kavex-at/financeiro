---
name: ConfirmacaoEmissorBoleto
type: entity
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties: [id, pesCod, credor, emissorChave, layoutEmissor, bancoEmissor, emissorMascarado, estado, evidencia, confirmadoPor, confirmadoEm, revogadoPor, revogadoEm, motivoRevogacao, versao]
relationships:
  - "ConfirmacaoEmissorBoleto N—1 Favorecido (pesCod no cmn025; sem entidade local, como em TituloAPagar e FavorecidoAutorizado)"
  - "ConfirmacaoEmissorBoleto 1—N DecisaoSugestaoBoleto (as decisões por título que a criaram ou que a usam; o vínculo é lógico por (pesCod, emissorChave), não FK obrigatória)"
  - "ConfirmacaoEmissorBoleto 1—N EventoSugestaoBoleto (trilha só-inclusão; ledger, não entidade de domínio)"
last_review: 2026-10-14
universality_evidence:
  - "Sondagem PRD 2026-10-13: ~836 de ~1090 títulos BOLETO sem DDA associado; o ERP só associa valor exato + dia exato (0 divergências em ~250 associados); o item fin124 não traz beneficiário (15 campos), só o código de barras"
  - "Medição PRD 2026-10-14 (boletos livres × títulos sem flag, candidato único): banco 237 = 162, 341 = 82, 104 = 17, 329 = 14, 422 = 7, 033 = 3 — 341+237 cobrem 244 de 290 (84 %)"
  - "Entrevista 2026-10-14 (decisões Q1–Q5 em ontology/_inbox/sispag-sugestao-boleto-dda-interview.md)"
  - "Conceito universal de contas a pagar no Brasil: o DDA entrega o boleto sem beneficiário legível; reconhecer qual conta emissora pertence a qual fornecedor é o passo que toda tesouraria faz à mão. Estrutura = ontologia; os pares confirmados = dado operacional"
  - "1 cliente apenas: revisar universalidade com o Francinei (não bloqueante, mesmo precedente da ADR-0065)"
---

# ConfirmacaoEmissorBoleto

> **Origem:** ADR-0068 (2026-10-14). Registro de que **os boletos emitidos por uma conta bancária
> (emissor) pertencem a um credor** — afirmado por um analista, com a evidência que ele viu.
> Code-facing: `BoletoIssuerConfirmation` (constante `BOLETO_ISSUER_CONFIRMATION_STATE`). Tabelas
> propostas: `sispag_confirmacao_emissor_boleto` e a trilha compartilhada só-inclusão
> `sispag_sugestao_boleto_evento` (trigger recusa UPDATE/DELETE/TRUNCATE, padrão ADR-0065).
> Regras em `business-rules/sugestao-boleto-dda-sispag.md` (I15). **Status: planned** — ontologia à
> frente do código.

## O que é e o que não é

- **É** evidência humana e auditada, com escopo exato no par (`pesCod`, `emissorChave`).
- **Não é** autoridade de pagamento. Confirmar **não** torna `temBoleto = true`, não escreve no Conexos
  e não dispensa a validação ao vivo da remessa (`BoletoSemCodigoBarrasError`, ADR-0040). I15a.
- **Não é** a `FavorecidoAutorizado`: aquela amarra um **destino de TED/PIX** do cadastro a duas
  pessoas; esta diz que uma **conta emissora de boleto** pertence a um credor, por uma pessoa.
- **Não é** autorização de valor: não alarga tolerância nenhuma (I15d).

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `pesCod` · `credor` | number · string | Credor no `cmn025`; `credor` = snapshot do nome. Sem `filCod` (o emissor é do credor, não da filial). |
| `emissorChave` | string | Banco + agência + conta **derivados do código de barras de 44 dígitos**. Layout real para 341 (Itaú) e 237 (Bradesco), ex. `237:2656:0092740`. Outros bancos: chave genérica `banco:<8 dígitos do campo livre>`. Imutável. |
| `layoutEmissor` | `ITAU_341 \| BRADESCO_237 \| GENERICO` | Como a chave foi derivada. `GENERICO` **nunca** é elegível a automático (I15i). |
| `bancoEmissor` | string | Código FEBRABAN de 3 dígitos. |
| `emissorMascarado` | string | Exibição: banco e agência completos, conta com os 4 últimos dígitos (padrão I14l). A chave completa **não** aparece para quem só tem `sispag:ver`. |
| `estado` | `VIGENTE \| REVOGADA` | **No máximo 1 `VIGENTE`** por (`pesCod`, `emissorChave`) — índice único parcial. `REVOGADA` é terminal; reconfirmar cria **nova** linha. |
| `evidencia` | JSON | Snapshot imutável da decisão que criou o par: título (`filCod/docCod/titCod`, valor, vencimento, `doc_esp_numero`), boleto (`ddcCod`, `ditCod`, `numero`, valor, vencimento, `codbar` mascarado), delta com sinal, sinais usados, tier. Nunca a linha digitável completa. |
| `confirmadoPor` · `confirmadoEm` | string · Date | Pessoa com `sispag:executar`. **Nunca** `sistema` (I15g). |
| `revogadoPor` · `revogadoEm` · `motivoRevogacao` | string? · Date? · string? | Quem revoga: **qualquer** pessoa com `sispag:executar` (ADR-0068, Q-A). Motivo obrigatório. |
| `versao` | number | Lock otimista. |

**Sem expiração.** Vive até ser revogada.

## Estado (2 estados, 1 transição — sem arquivo de state machine)

```
(nenhuma) --confirmarSugestaoBoleto--> VIGENTE --revogarConfirmacaoEmissor--> REVOGADA
```

Cada transição grava um evento na trilha só-inclusão com quem, quando e (na revogação) o motivo.
Confirmar sobre par já `VIGENTE` é no-op e devolve a linha existente (I15j). Revogar o par cancela as
decisões por título **ainda não aplicadas no ERP** (ADR-0068, Q-E; no passo 1 não existe decisão
aplicada, logo é só marcação do derivado `PAR_REVOGADO`).

## Diferenças para entidades vizinhas

- `FavorecidoAutorizado` (ADR-0065): destino TED/PIX, duas pessoas, fingerprint HMAC. Aqui: emissor
  de boleto, uma pessoa, chave em claro derivada de dado já público no DDA, exibida mascarada.
- `BoletoDda`: espelho somente leitura do pool; a confirmação **nunca** altera o pool.
- `DecisaoSugestaoBoleto`: a decisão **por título**; esta é o **par**.
