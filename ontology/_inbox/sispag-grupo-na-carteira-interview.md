# Entrevista — título de grupo sugerido na carteira (`/feature-tweak boleto-agrupado-sispag`)

Data: 2026-10-29. Só decisões de produto; cada pergunta traz o **default recomendado** (responda "ok" ou
corrija). Base: ADR-0077 (I21e/f, I15q), `sugestao-boleto-dda-sispag.md` (I15e/I15m).

## Contexto medido (PRD, cópia de 2026-10-29)

RHENUS (pesCod 1550), vencimento 29/10: títulos 1/5541/1 (R$ 434,38) e 1/5566/1 (R$ 25.935,47); boleto DDA
129818 (ddc 165 / dit 24398) de R$ 26.369,85 = a soma exata. `GrupoBoletoService.sugerir` devolve o grupo como
**confirmável** (1 das 27 confirmáveis, de 29 sugestões do dia). Mas a carteira mostra 5541 como `SO_FRACA` e 5566
como `SO_ATENCAO`, com o **próprio boleto 129818 oferecido 1:1 e confirmável** (R$ 434,38 acima do título). Confirmar
isso consome o boleto (decisão `CONFIRMADA` tira o boleto do motor de grupos): o grupo some, o vínculo de barra 1:1 não
acontece (só valor igual, ADR-0071), 5566 fica bloqueado e 5541 órfão. Hoje o 1:1 e o grupo são dois motores que não
se enxergam.

## Respostas

**Respostas: defaults aceitos por Yuri em 2026-10-29** (todas as 9 perguntas, como escritas abaixo).

## Perguntas

1. **O boleto de uma sugestão de grupo some da lista 1:1 ou aparece como "pertence ao grupo"?**
   Default: **deixa de ser candidato confirmável** de qualquer título e aparece, no detalhe (gaveta) do título, como
   linha informativa **não confirmável** "pertence à sugestão de grupo (N títulos, Σ R$ …)" com o atalho para o grupo.
   Nunca como `UNICA_SEGURA`/`SO_ATENCAO` confirmável.

2. **Só a sugestão confirmável marca os títulos, ou também a não confirmável (aguardando alçada, par sem vigência…)?**
   Default: **as duas marcam** (evidência é a mesma: o conjunto fechado soma o boleto); a não confirmável mostra o
   motivo que a Boletos agrupados já mostra, e o título não oferece confirmar o boleto 1:1 do mesmo jeito.

3. **E se o título já tem uma sugestão 1:1 forte com OUTRO boleto?**
   Default: o 1:1 **vence** quando o desfecho é `UNICA_SEGURA`, `CONFIRMADA`, `ORFA` ou `EM_GRUPO` (continua como
   hoje; o título só ganha o ponteiro informativo para o grupo). O grupo toma a vez nos desfechos `AMBIGUA`,
   `SO_ATENCAO`, `SO_FRACA`, `SO_VENCIDA`, `DISPUTADA` e `SEM_CANDIDATO`, que passam a mostrar
   situação nova **"Em grupo sugerido"**. Na dúvida entre os dois sinais fortes, a tela nunca confirma sozinha.

4. **Uma decisão 1:1 já confirmada nesse boleto (a analista confirmou 129818 para 5566 ontem)?**
   Default: **nada muda sozinho** (I15g: o sistema não anula decisão da analista). O grupo continua indisponível
   (boleto ocupado, I15q) e o outro título (5541) segue como está. Follow-up, fora deste tweak: aviso no 5541
   "grupo possível bloqueado pela decisão 1:1 de 5566; anule para compor".

5. **A situação de pagamento "Boleto sem DDA" muda para esses títulos?**
   Default: **continua "Boleto sem DDA"** até o grupo ser confirmado (aí já vale a isenção do `EM_GRUPO`), mas o
   texto da sugestão passa a dizer "há grupo sugerido: confirme em Boletos agrupados". Não vira "pronto" e não libera
   lote por causa de uma sugestão.

6. **O que o link faz na tabela de títulos e na gaveta?**
   Default: um selo "Grupo sugerido" na linha e na gaveta, com ação **"Ver grupo"** que abre a aba Boletos agrupados
   já posicionada no grupo. **Não há botão de confirmar na carteira**: confirmar continua só na aba (reconhecimento
   de avisos, I21i).

7. **Contagem e filtro por situação?**
   Default: a situação nova entra em `contagemSituacao` e no filtro de situação da tabela, ao lado das demais.

8. **Selecionar o título para um lote enquanto o grupo é só sugestão?**
   Default: **não bloqueia** (a regra de bloqueio é do grupo confirmado), mas a tela avisa "faz parte de grupo
   sugerido: confirme o grupo em vez de pagar avulso" ao selecionar. Se a pergunta 3 mantiver um 1:1 forte, nenhum
   aviso é necessário.

9. **Quando a sugestão de grupo muda ou some (sincronização do DDA, novo título, decisão)?**
   Default: o selo acompanha o cenário em cache (TTL 30 s, invalidado em confirmar/anular/sync); confirmar o grupo
   troca o selo por `EM_GRUPO`; anular volta ao 1:1.

## O que não perguntamos (decidido por regra existente)

- Grupo ambíguo (G6) segue sem sugestão e, portanto, sem selo e sem retirar boleto do 1:1.
- Composição manual (I21g) não é sugestão: não marca nada.

---

## Adendo 2026-10-29 (tarde) — o grupo se confirma na gaveta e a aba Boletos agrupados sai

Yuri experimentou a versão local e decidiu (2026-10-29). **Isto REVERTE a pergunta 6** ("não há botão de
confirmar na carteira; confirmar continua só na aba"). As demais respostas (1 a 5 e 7 a 9) seguem valendo.

**Aprovado por Yuri em 2026-10-29: o delta de ontologia e as sub-perguntas S1 a S10, todas com o default recomendado.**

### Decisões

1. **A gaveta do título mostra E confirma o grupo.** `BoletosDoTituloDialog` mostra o grupo inline: o boleto (número,
   valor, vencimento, emissor mascarado), todos os títulos que ele paga (o título atual destacado) e a soma contra o
   valor do boleto. Tem o botão **Confirmar grupo**; antes de confirmar mostra os avisos da I21i para reconhecer, os
   mesmos que o fluxo de hoje mostra, **reusando os componentes e o endpoint de confirmar existentes** (nenhum caminho
   de escrita novo). Grupo não confirmável mostra o motivo. Grupo confirmado (`EM_GRUPO`) mostra o grupo com **Anular
   grupo**. O mesmo bloco abre a partir de qualquer título do grupo.
2. **A aba "Boletos agrupados" é removida.** A aba **Boletos DDA (fin124)** a absorve: cartão-resumo **"Pagam vários
   títulos"**; filtro **"Em grupo"**; cada boleto agrupado é uma linha expansível com os títulos dele, com **Confirmar
   grupo** (mesmo fluxo de avisos) ou o motivo de não confirmável; grupo confirmado mostra o estado "confirmado" e
   **Anular**. A composição manual (I21g) vira a ação **"Compor com títulos"** na linha de um boleto "Sem título".
3. **Os links "Ver grupo"** (faixa "Ver grupo sugerido", selo da tabela, gaveta) abrem a **gaveta do título**, sem
   trocar de aba.

### O que a aba antiga faz hoje e onde cada parte cai

| Hoje (`GrupoBoletoPainel` / `page.tsx`) | Depois |
|---|---|
| Lista de sugestões: credor, filial, boleto mascarado, valor, vencimento, títulos e soma | Linha expansível do boleto na aba Boletos DDA (chip "Em grupo"); o mesmo conteúdo no bloco da gaveta |
| Explicação de intercambiável (I21f) | Dentro da linha expandida e do bloco da gaveta |
| Botão **Confirmar grupo** (spinner, erro inline) | Linha expandida e bloco da gaveta, o mesmo endpoint `confirmarGrupoBoleto`, com reconhecimento dos avisos antes |
| "Não confirmável: motivo" (sem botão; alçada, cruza filial…) | Linha expandida e bloco da gaveta, o mesmo texto |
| Tabela de grupos confirmados: credor, boleto, valor, vencimento, títulos, **situação derivada** (`SituacaoGrupoBadge`) e **orientação** por situação (REJEITADO, ORFAO, DIVERGENTE, RETIDO) | Linha do boleto em estado "confirmado" com o badge de situação e a orientação; o mesmo bloco na gaveta de qualquer título do grupo |
| **Anular** (diálogo de motivo 10 a 500 caracteres; aviso se o grupo estava em lote comprometido) | Linha confirmada e bloco da gaveta, o mesmo `MotivoDecisaoDialog` e `anularGrupoBoleto` |
| **Compor grupo** (`onCompor` leva à aba DDA; `ComporGrupoBoletoDialog`, reconhecimento do aviso de vencimento) | Ação **Compor com títulos** na linha do boleto (hoje a ação existe em todo boleto não vinculado, não vencido e com código de barras); o diálogo é o mesmo |
| Atualização (`onAlterado`: relê lotes, painel e grupos) | Igual, mais a recarga da lista de boletos DDA e das sugestões da carteira |
| Estados de carregamento, erro com "Tentar de novo" e vazio | Mantidos na aba DDA (a seção "Em grupo" e a gaveta) |
| Escrita só com `sispag:executar` (sem a permissão os botões nem aparecem) | Igual: sem a permissão o bloco é só leitura |
| Destaque do cartão vindo da carteira (`focoBoleto`, desta feature) | Deixa de existir: "Ver grupo" abre a gaveta |
| `gruposConfirmados` na `page.tsx` (títulos de grupo não se selecionam avulsos) | Mantido (não é da aba) |

### Sub-perguntas abertas (cada uma com o default recomendado)

- **S1. Onde fica o bloco na gaveta?** Default: **no topo** quando a situação é `GRUPO_SUGERIDO` (substitui o aviso
  atual); quando o 1:1 é forte (`UNICA_SEGURA`), o bloco aparece **abaixo da seção do 1:1**, recolhido, com o título
  "Este título também faz parte de um grupo sugerido", para nunca haver dois botões de confirmar competindo no mesmo
  nível. Em `EM_GRUPO`, o bloco é o conteúdo principal (hoje a gaveta nem abre para `EM_GRUPO`).
- **S2. Os avisos da I21i na sugestão.** A sugestão de grupo hoje **não expõe `avisos`** (só o diálogo de composição
  os trata; a aba de sugestões confirma sem reconhecimento e mostra o erro do servidor se faltar). Default: expor
  `avisos` (já calculados pela regra) na sugestão e extrair o reconhecimento do `ComporGrupoBoletoDialog` num
  componente compartilhado (`ReconhecerAvisosGrupo`), usado pela gaveta, pela linha do DDA e pela composição. O
  servidor segue reavaliando tudo (anti-TOCTOU); o reconhecimento é só de tela.
- **S3. De onde a gaveta tira os dados do grupo?** Default: **buscar ao abrir** (`fetchSugestoesGrupoBoleto` e
  `fetchGruposBoleto` da filial, que já existem), casando por `ddcCod`+`ditCod`; sem mudar o payload do 1:1. O
  ponteiro `grupoSugerido` continua só como índice (selo e contagem).
- **S4. Como o chip "Em grupo" e o cartão entram no backend da aba DDA?** A lista de boletos DDA (`BoletoDdaService`)
  não conhece grupos hoje. Default: acrescentar a cada boleto o campo opcional `grupo { estado: SUGERIDO|CONFIRMADO,
  id?, nTitulos, confirmavel }` e a contagem `emGrupo`, calculados com o mesmo `CenarioGrupoBoleto` e o mesmo
  cenário em cache; o filtro é **ortogonal à situação do boleto** (parâmetro `emGrupo=true`), porque um boleto
  `CANDIDATO` ou `AMBIGUO` pode ser de grupo. O cartão "Pagam vários títulos" mostra o total e "N confirmáveis".
- **S5. Em que boletos aparece "Compor com títulos"?** Default: **as mesmas condições de hoje** (não vinculado, não
  vencido, com código de barras), não só em "Sem título", para não perder a composição de um boleto `CANDIDATO` ou
  `AMBIGUO`.
- **S6. Depois de confirmar ou anular na gaveta?** Default: a gaveta **fica aberta** e passa a mostrar o estado novo
  (`EM_GRUPO` com Anular, ou de volta à sugestão), com um aviso `role="status"`; a carteira, os lotes e a aba DDA são
  relidos.
- **S7. "Ver grupo" a partir de um título que já está `EM_GRUPO`.** Default: o rótulo "em boleto agrupado" da tabela
  vira um botão que abre a gaveta (hoje é texto sem ação).
- **S8. Link antigo.** Default: nenhum link externo conhece a aba `boletos-agrupados`; se a tela guardar a aba
  ativa, o valor antigo cai em `boletos-dda`.
- **S9. Aviso ao selecionar título de grupo sugerido (pergunta 8).** Default: **mantido**, com o texto ajustado para
  "confirme o grupo na gaveta do título" (e não mais "na aba").
- **S10. Mensagens do servidor que citam a aba.** Default: reescrever para "na gaveta do título ou na aba Boletos
  DDA" (a recusa do confirmar 1:1, o motivo de `GRUPO_SUGERIDO` e o detalhe da situação de pagamento).
