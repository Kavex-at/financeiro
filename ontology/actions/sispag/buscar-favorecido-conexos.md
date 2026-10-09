---
name: buscarFavorecidoConexos
type: action
entity: FavorecidoAutorizado
ontology_version: "0.39.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/service/sispag/PayeeSearchService.ts
  - src/backend/domain/service/sispag/AuthorizedPayeeService.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/favorecidos-autorizados/components/SolicitarAutorizacaoDialog.tsx
last_review: 2026-10-09
preconditions:
  - "Usuário com `sispag:executar` (quem pede; ver não basta)."
  - "Texto com 3 letras ou mais; código e CPF/CNPJ (só dígitos) com qualquer tamanho."
  - "No máximo 30 buscas por minuto por usuário (`buildPayeeSearchLimiter`); acima, 429 `MUITAS_BUSCAS`, sem leitura no Conexos."
postconditions:
  - "Busca: pessoas do `cmn025` (código, razão social, nome fantasia, `pesVldStatus`), CPF/CNPJ só mascarado (`MaskDestino.documento`), e o estado da autorização vigente por modalidade. Até 20 por leitura, com aviso de que há mais."
  - "Prévia: para (favorecido, modalidade), o destino que o resolvedor I10 escolhe agora no `cmn025`, mascarado (I14l): OK | SEM_DADO | FALHA_LEITURA, com os avisos de I14c. Sem impressão (HMAC)."
side_effects:
  - "Somente leitura no `cmn025`, na filial do tenant (`sispagCadastroFilCod`). Nenhuma escrita local ou no ERP, nenhum evento na trilha."
---

# buscarFavorecidoConexos

Emenda da ADR-0065, sem regra nova. Quem pede a autorização acha o favorecido no cadastro do
Conexos sem abrir o Conexos e sem saber o código: digita nome, nome fantasia, CPF/CNPJ ou código,
escolhe numa lista e vê o destino do cadastro **mascarado** antes de pedir. Daí segue
`solicitarAutorizacaoFavorecido` (origem `MANUAL`), que nunca aprova.

## Leitura no `cmn025/list`

| Termo | Filtro | Leituras |
|-------|--------|----------|
| 11 ou 14 dígitos (com ou sem pontuação) | `pdcDocFederal#EQ` com os dígitos; sem linha, com o documento formatado | 1–2 |
| outros só dígitos | `pesCod#EQ` | 1 |
| texto | `dpeNomPessoa#LIKE` e `dpeNomFantasia#LIKE`, em maiúsculas, mesclados por código | 2 |

A prévia são as leituras do resolvedor (conta: `cmn025/ctcorr`; PIX: `cmnPessoasPix` + documento).
O destino de **cada** linha da lista não é lido: seriam ~40 leituras por busca, e o Conexos tem
teto de sessões.

## Por que mostrar a máscara a quem pede não muda regra

I14l já diz que o destino é sempre mostrado mascarado e que o valor completo só sai pelo
"revelar" auditado (`sispag:autorizar_favorecido`). O `reconferir` já devolve a máscara a quem tem
`sispag:ver`. A prévia não expõe nada novo; a conferência de quem aprova segue independente (lê
de novo e compara a impressão, I14c).

## Gaps

- **Semântica do `#LIKE` no `cmn025` não medida ao vivo** ("contém" × "começa com", acento,
  caixa) nem o formato guardado em `pdcDocFederal`. O HML não aceita o usuário do `.env` de
  produção. Se for "começa com", a busca acha menos, mas não erra. Sonda pronta:
  `src/backend/jobs/probe-cmn025-busca-hml.ts`.
- Cadastro sem destino para a modalidade: a tela avisa e não deixa pedir (o pedido não poderia
  ser aprovado). Falha de leitura não bloqueia o pedido: quem aprova lê de novo.
