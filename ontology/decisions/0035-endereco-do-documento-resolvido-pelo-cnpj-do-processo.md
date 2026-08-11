---
id: 0035
title: O endereço do documento é resolvido pelo CNPJ do processo, não pelo endCodFis do validador
status: accepted
date: 2026-08-11
deciders: [yuri]
supersedes: []
amends: [0034]
related_files:
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/client/ConexosGerDocProcessoClient.ts
---

# ADR-0035 — O endereço do documento é resolvido pelo CNPJ do processo, não pelo `endCodFis` do validador

## Contexto

Todo documento gerado pela Frente IV (a SN no `com299` e a NDe no `com297`) leva no header um par
`endCodFis` + `pdcDocFederal`: **em que endereço** e **para qual CNPJ** o documento é emitido. Até aqui
os dois vinham da MESMA chamada, `com299/gerDoc/validaProcessoPessoa`, e eram repassados verbatim.

Em produção (2026-08-11), a analista processou o pagamento de **R$ 174.036,61** da **DYNAMIS**
(`pesCod 699`, processo **3639**, filial 2, ref. `0016DYS/26`). A SN existente foi aceita, a **baixa
fin014 finalizou** — e a emissão da NDe morreu no `com297/gerDocProcesso`:

```json
{"type":"SELECTION_ERROR","validation":{"main":{"itemMessages":[
  {"item":"endCod","messages":[{"message":"Generic.NOT_VALID","vars":{"atributo":"1"}}]}]}}}
```

Sondagem read-only do ERP (`src/backend/routes/recebimentos.probe.endCod.integration.test.ts`) mostrou
que o `endCod: 1` que mandamos **não é dado do processo** — e que o par que enviamos é incoerente:

- A DYNAMIS tem **dois** endereços, ambos marcados `FISCAL`, no mesmo logradouro:
  `endCod 1` = CNPJ `10.384.567/0001-62` (`endVldDefault: 1`) e `endCod 2` = CNPJ `10.384.567/0004-05`.
- O processo 3639 é do estabelecimento **`/0004-05`** — ou seja, do endereço **2**.
- O `validaProcessoPessoa` devolve `endCodFis: 1` **junto de** `pdcDocFederal: 10384567000405`:
  o endereço **padrão da pessoa** com o CNPJ **do processo**. Nem o `com299` nem o `com297` mudam
  isso — as duas telas respondem igual.
- As **140 NDes** já emitidas para essa pessoa na filial 2 carregam **todas** `endCod: 2`.
- O processo **1408**, da mesma pessoa, que **tem** NDes emitidas com `endCod 2`, também recebe
  `endCodFis: 1` do validador.

O campo nunca foi o endereço do documento; ele só parecia ser, porque todo cliente que rodou até aqui
tinha um único estabelecimento — e aí o padrão coincide com o do processo. A DYNAMIS é o primeiro
cliente multi-estabelecimento a passar pelo fluxo.

Agravante: o `com297/gerDoc/validaConfigDoc` **aceitou** o par incoerente (HTTP 200). Nenhum validador
read-only reprova; quem reprova é a geração — que é escrita, e roda **depois** da baixa fin014 estar
finalizada. O custo do erro é uma execução partida no meio: dinheiro baixado, nota não emitida.

## Decisão

O endereço do documento passa a ser **resolvido**, não copiado:

1. `validaProcessoPessoa` continua sendo a fonte do **`pdcDocFederal`** (o CNPJ do processo). Seu
   `endCodFis` vira **diagnóstico** — é logado quando diverge, e nunca alimenta payload.
2. Novo **gate 1.5** no pré-flight: `com191/endereco/list/{pesCod}` lista os endereços da pessoa, e o
   escolhido é aquele cujo `pdcDocFederal` é o do processo (comparação por **dígitos** — o ERP devolve
   o CNPJ ora cru, ora formatado). Empate entre endereços de mesmo CNPJ resolve por `endVldDefault` e
   depois pelo menor `endCod`, para ser determinístico.
3. Sem candidato → **`BLOCKED_CADASTRO`**, antes de qualquer escrita, dizendo qual CNPJ faltou e quais
   endereços existem. Este é o caso em que a mensagem "regularize o cadastro" é verdadeira — antes ela
   era exibida para um defeito que era nosso.
4. O fallback `END_COD_FIS_DEFAULT = 1` da etapa da NDe **morre**. Ele produzia exatamente o valor
   errado: `1` é o endereço padrão, que é justamente o que o ERP recusa numa pessoa com dois
   estabelecimentos. Chegar na emissão sem endereço resolvido é bug de chamada → fail-closed.

O endereço resolvido vale para **todos** os documentos da execução (SN e NDe), não só para a NDe: um
par (endereço, CNPJ) incoerente é incoerente nas duas telas.

## Consequências

- Cliente com um estabelecimento: nenhum comportamento muda (o padrão É o do processo).
- Cliente multi-estabelecimento: a SN passa a ser gerada no endereço **do processo**, não mais no
  endereço padrão da pessoa. Isto **muda dado de negócio** — a SN 18752 do processo 3639, gerada antes
  desta ADR, está no `endCod 1` / CNPJ `/0001-62` enquanto o processo é `/0004-05`. ⚠️ Pendente de
  verificação com o Yuri: se o adiantamento deve mesmo seguir o estabelecimento do processo, as SNs já
  existentes nessa condição precisam ser corrigidas no ERP antes de emitir NDe contra elas.
- Uma chamada read-only a mais por alocação (`com191/endereco/list`), no pré-flight, antes da escrita.
- O `WARN` de divergência (`endCodUsado` ≠ `endCodFisSugeridoErp`) mede quantas execuções teriam
  falhado. Se um dia o ERP passar a devolver o endereço do documento, o log seca sozinho.
- A Frente I (`GerarSolicitacaoNumerarioService`, permutas) **ainda** usa o
  `END_COD_FIS_DEFAULT = 1` hardcoded em 5 pontos. Mesmo defeito latente, escopo separado — migrar no
  próximo `/feature-tweak` que tocar aquele writer.

## Alternativas consideradas

- **Resolver pelo histórico de NDes da pessoa** (a rota que a ADR-0034 usou para o `gcd`): funcionaria
  para a DYNAMIS (140 documentos, todos `endCod 2`), mas não para o primeiro documento de um cliente
  novo, e herdaria o estabelecimento de um documento antigo em vez de olhar o processo atual.
- **Mapear o endereço por filial em env** (à la `SN_GCD_COD_BY_FIL`): o endereço varia por
  pessoa-e-processo, não por filial — o mapa seria por definição incompleto.
- **Só corrigir a NDe, deixando a SN no endereço padrão**: manteria SN e NDe da mesma execução em
  estabelecimentos diferentes.
