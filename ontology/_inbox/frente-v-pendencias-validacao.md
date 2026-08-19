# Frente V — Pendências de validação com o time

> **Este é o documento de referência das decisões que NÃO estão validadas.**
> O Yuri validará cada item com o time da Columbia. Até lá, o código adota a premissa registrada
> aqui — **sempre fail-safe**, nunca inventando precisão que o dado não tem.
>
> Cada pendência tem um **ID** (`PV-nn`) citado no código, na ontologia e nos testes. Ao fechar uma
> pendência, procure pelo ID no repo (`grep -rn "PV-01"`) para achar tudo que depende dela.
>
> **Última atualização:** 2026-08-19.

---

## Índice rápido

| ID | Pergunta | Impacto se a premissa estiver errada | Status |
|----|----------|--------------------------------------|--------|
| **PV-01** | O que é `ftbVldStatus = 7`? | Etapas classificadas como `INDETERMINADO` no painel | 🔴 aberta |
| **PV-02** | `LIBERAR` vs `APROVAR` — qual a diferença? | Ambas contam como "concluiu a etapa" | 🟡 aberta |
| **PV-03** | `ftbTimBloq` é mesmo "quando o aprovador recebeu"? | A duração medida muda de significado | 🔴 aberta |
| **PV-04** | Qual campo é o "documento finalizado" do exemplo do cliente? | Marco zero do relógio ausente no painel | 🟡 aberta |
| **PV-05** | Aprovação por e-mail conta como etapa? | Etapas podem estar faltando na trilha | 🟡 aberta |
| **PV-06** | `regerarBloqueios` é usado na operação? | Trilha pode ser reescrita sem detectarmos | 🟡 aberta |
| **PV-07** | ~~Acesso à tela `fin103`~~ → existe projeção em massa de `FinTituloBloq`? | Custo de 1 chamada/título é **estrutural**; campos ausentes precisam de outra fonte | 🔴 **reformulada** |
| **PV-08** | Janela de backfill: quanto histórico o cliente quer? | Volume e tempo da primeira carga | 🟡 aberta |
| **PV-09** | Quais filiais entram no escopo? | Cobertura do painel | 🟡 aberta |
| **PV-10** | Identidade do aprovador é o nome (`usnDesNomeCmd`)? | Analítico da Fase 2 frágil a mudança de nome | 🟡 aberta |

🔴 = pode mudar o comportamento visível do produto · 🟡 = ajuste localizado

---

## PV-01 — O que é `ftbVldStatus = 7`? 🔴

**Evidência.** Na amostra de 300 títulos da filial 2, `ftbVldStatus` assumiu três valores:

| Valor | Ocorrências | Leitura |
|-------|-------------|---------|
| `1` | 8 | pendente (nesses, `ftbTimCmd == ftbTimBloq` — ninguém agiu) |
| `2` | 156 | respondido — bate com o "Respondido" visto na tela `PSQ_027` |
| `7` | **13** | **desconhecido** |

O spec OpenAPI não traz legenda para este enum (diferente de `docTip`, `titVldStatus` e `titVldBloq`,
que trazem). O `configList` do endpoint de log traria — mas depende de **PV-07**.

**Premissa adotada no código:** qualquer `ftbVldStatus` fora de `{1, 2}` é mapeado para
`EtapaStatus.INDETERMINADO`, e o título inteiro recebe `StatusWorkflow.INDETERMINADO` com uma
entrada em `lacunas[]` explicando. **Não** é tratado como aprovado nem como rejeitado.

**Por que fail-safe assim:** classificar 13 etapas reais como "aprovadas" por chute produziria um
número de tempo médio errado num painel financeiro auditável. Aparecer como "indeterminado" é
honesto e visível — o analista vê que há algo a esclarecer.

**Como fechar:** perguntar à analista, ou obter o `configList` da tela `fin103` (PV-07).
Ao fechar, atualizar `ETAPA_STATUS_ERP` em `src/backend/domain/interface/aprovacoes/constants.ts`.

---

## PV-02 — `LIBERAR` vs `APROVAR` 🟡

**Evidência.** `fbaDesNome` na amostra: `LIBERAR` 122×, `APROVAR` 34×, vazio 21× (etapa pendente).
São duas ações distintas configuradas no ERP, não sinônimos.

**Premissa adotada:** ambas são tratadas como **conclusão positiva** da etapa. A ação bruta é
preservada em `etapa_aprovacao.acao` e exibida na timeline, para o analista ver a diferença mesmo
que o agregado não a use.

**Risco se errada:** se `APROVAR` for uma etapa intermediária (ex.: aprova mas não libera para
pagamento), o status agregado do título estaria otimista.

**Como fechar:** perguntar à analista o que cada ação significa no fluxo.

---

## PV-03 — `ftbTimBloq` é "quando o aprovador recebeu"? 🔴

**Evidência.** Nas etapas pendentes, `ftbTimCmd == ftbTimBloq` — consistente com "o bloqueio nasce e
ainda não teve comando". No caso resolvido (doc 4156/1), `ftbTimBloq` = 2026-05-14 07:12:46 e
`ftbTimCmd` = 2026-05-15 06:41:40.

**Premissa adotada:** `ftbTimBloq` = momento em que a etapa passou a existir e ficou disponível para
o aprovador; `ftbTimCmd` = momento da ação. A duração da etapa é `ftbTimCmd − ftbTimBloq`.

**Risco se errada:** se o bloqueio for criado pela regra bem antes de ser atribuído/notificado a
alguém, a duração medida inclui um tempo que não é "espera do aprovador" — e o painel acusaria
lentidão de quem não recebeu ainda.

**Como fechar:** perguntar à analista se, na prática, o aprovador é notificado no instante em que o
bloqueio é criado.

---

## PV-04 — Qual campo é o "documento finalizado"? 🟡

**Evidência.** O exemplo do cliente começa em *"o documento 123 foi finalizado às 10:00 de 18/08"*.
O schema `FinTituloBloq` declara `docDtaFinalizacao`, mas ele **não vem preenchido** na projeção do
`fin026/infoTitulo/list` (depende de PV-07). Candidatos disponíveis hoje, via `psq014/list`:
`docDtaEmissao` (data pura, sem hora), `docVldFinalizado` (flag), `usnDesNomeFimDoc` (quem finalizou).

**Premissa adotada:** o marco zero da timeline é a **primeira etapa criada** (`min(ftbTimBloq)`),
não a finalização do documento. A finalização aparece como evento separado **apenas quando houver
dado**; caso contrário entra em `lacunas[]`.

**Risco se errada:** o tempo total do título fica subestimado — não conta o intervalo entre
finalizar o documento e o workflow começar.

**Como fechar:** obter `docDtaFinalizacao` via PV-07, ou confirmar com a analista qual campo da tela
corresponde a "finalizado".

---

## PV-05 — Aprovação por e-mail conta como etapa? 🟡

**Evidência.** O ERP tem `FinBloqEmail`, `ViewFinBloqEnvioEmail` e a flag `fblVldEmailDaprovar` —
existe notificação/aprovação por e-mail configurável.

**Premissa adotada:** só existe o que está em `FinTituloBloq`. Se a aprovação por e-mail gravar a
etapa normalmente, nada muda; se ela existir fora disso, a trilha estará incompleta e não teremos
como saber.

**Como fechar:** perguntar à analista se aprovadores respondem por e-mail e se isso aparece na tela
de Bloqueios e Liberações.

---

## PV-06 — `regerarBloqueios` é usado? 🟡

**Evidência.** Existe `POST com308/infoTitulo/regerarBloqueios`, que reescreve as etapas de um título.

**Premissa adotada:** a ingestão faz **UPSERT** por chave natural
(`fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod`) e, ao reprocessar um título, marca como
`ativo = false` as etapas que sumiram do ERP (mesma doutrina anti-fantasma da Frente II). Nenhuma
etapa é apagada — a que some fica registrada como inativa.

**Risco se errada:** se a regeração for frequente e trocar os códigos das etapas, o histórico
acumula linhas inativas e a trilha exibida pode confundir.

**Como fechar:** perguntar com que frequência a operação regera bloqueios.

---

## PV-07 — ~~Acesso do usuário de API à tela `fin103`~~ → **ENTENDIMENTO CORRIGIDO** ✅🔴

> **Corrigido pelo Yuri em 2026-08-19.** A hipótese original estava errada e vinha sendo repetida em
> vários documentos. Registrada aqui na íntegra porque o erro é instrutivo.

**O que eu supunha (ERRADO).** Que `fin103/list` fosse uma listagem administrativa de todos os
bloqueios, devolvendo vazio por **falta de permissão de tela** do usuário de API. Daí a conclusão de
que bastava "pedir acesso ao administrador do Conexos" para a varredura ficar 500× mais barata.

**O que é de verdade.** A `fin103` é a **fila pessoal de aprovação do usuário logado** — lista os
títulos que *aquele usuário* tem para liberar ou bloquear. O retorno vazio significa simplesmente que
o **Francinei** (a conta de integração) **não tem nada a aprovar**. Não há acesso a pedir: a tela
nunca serviria para varredura, por desenho.

### Consequências

1. **O custo de uma chamada por título é ESTRUTURAL, não temporário.** Não existe atalho esperando
   liberação. As mitigações que já estão no código — `BoundedConcurrency` (limite 4), cursor de
   retomada por página, tolerância a título problemático — deixam de ser paliativo e passam a ser
   **a arquitetura**.

2. **Os campos ausentes precisam de outra fonte.** `docDtaFinalizacao` (PV-04), `usnCodCmd` (PV-10),
   `acdCod`, `wffUuid` e `fbaVldAcao` não virão da `fin103`. Candidatos a investigar:
   - `psq014/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}` — exige os filtros
     `fExibirPrevisao` e `fExibirRenegociados`; **pode projetar mais campos** que o `fin026`. É o
     teste mais barato e o próximo a fazer.
   - `com308/financeiroAPagar/infoTitulo/list/{docCod}/{titCod}` — já verificado, projeta o mesmo
     conjunto do `fin026`.
   - Algum relatório do módulo financeiro (`docs/conexos-api/reports.md` não foi varrido com essa
     pergunta em mente).

3. **Nada do que já foi construído se perde.** O port `TrilhaAprovacaoGatewayInterface` continua
   sendo o ponto de troca: se aparecer uma projeção melhor, entra uma implementação nova sem tocar no
   job nem no serviço. A diferença é que agora não sabemos se essa implementação existe.

### Pergunta que substitui a antiga

**Existe no Conexos alguma projeção que devolva `FinTituloBloq` (ou equivalente) para VÁRIOS títulos
de uma vez, sem depender de quem está logado?** É pergunta para o fornecedor do ERP ou para quem
conhece o módulo financeiro a fundo — não é algo que a sondagem consiga responder sozinha, porque não
se pode provar a inexistência de um endpoint varrendo os specs.

**Enquanto não houver resposta:** a varredura segue com uma chamada por título, e o dimensionamento
da janela de backfill (PV-08) passa a ser a alavanca principal de custo.

## PV-08 — Janela de backfill 🟡

**Premissa adotada:** 12 meses, configurável por env (`APROVACOES_BACKFILL_DESDE`, epoch ms).
Base: a amostra usou emissão desde 2025-08-01 e encontrou 23.632 títulos na filial 2.

**Como fechar:** perguntar ao cliente quanto histórico ele quer ver no painel. Cada mês adicional
custa proporcionalmente na primeira carga.

---

## PV-09 — Filiais no escopo 🟡

**Evidência.** Produção tem ao menos as filiais 1, 2 e 3. Volume de títulos a pagar muito desigual
(filial 2 concentra).

**Premissa adotada:** a varredura respeita a allow-list de filiais do usuário, no mesmo padrão do
`resolverFilCodsAcessiveis` da Frente IV (`src/backend/routes/recebimentos.ts`).

**Como fechar:** confirmar quais filiais o painel deve cobrir.

---

## PV-10 — Identidade do aprovador 🟡

**Evidência.** A projeção atual traz `usnDesNomeCmd` (`DANILO_LARA`) mas **não** `usnCodCmd`.
O campo `aprovador` mistura setor (`COMPRAS`) e pessoa (`RICARDO DO PRADO`), então não serve como
identidade.

**Premissa adotada:** a chave de pessoa é o **nome normalizado** de `usnDesNomeCmd`
(trim + upper). O código já grava a coluna `usn_cod_cmd`, nullable, para receber o código quando
PV-07 for resolvido.

**Risco se errada:** se uma pessoa mudar de nome de usuário, o analítico da Fase 2 a contará como
duas.

**Como fechar:** resolver PV-07, ou confirmar que os nomes de usuário são estáveis.
