# sispag-confirmar-em-conjunto — entrevista (OfficeHours, modo `new`)

Feature: `/feature-new` "confirmar títulos irmãos em conjunto na gaveta de sugestão do SISPAG".
Maintainer: Yuri. Ideia de 2026-10-27; entrevista em 2026-10-29. Depende do PR #133 (ADR-0079, I15s,
gaveta não modal e `numeroDocumento` na API), já em `main` (v0.77.2).

## Motivação

Credores como NELSON HEUSI (pesCod 387, filial 2) têm dezenas de títulos de mesmo valor (R$ 647,56),
cada um casado com o seu boleto pelo número (nº do documento = nº do boleto, sinal `NUMERO_CONFIAVEL`,
I15s). Hoje a analista abre e confirma um por um. Na cópia local de PRD, NELSON HEUSI tem 108 títulos
ativos só na filial 2.

## Decidido antes da entrevista (2026-10-27)

- **Seleção:** nada vem marcado; a analista marca cada linha. Cada linha mostra título, nº do documento,
  nº do boleto, diferença de valor e diferença de dias.

## Eixo Entidade

- Nenhuma entidade nova. A confirmação em conjunto produz N `DecisaoSugestaoBoleto` `CONFIRMADA`
  comuns, iguais às de hoje.
- **Auditoria (Q3):** por linha + id do conjunto. Cada linha mantém o seu evento `DECISAO_CONFIRMADA`
  e ganha, no `detalhe`, o id do conjunto, a origem "confirmação em conjunto" e o título em que a
  gaveta foi aberta. Sem tabela nova e sem evento próprio do conjunto.

## Eixo Ação

- **Ação nova** `confirmarSugestoesEmConjunto`. Cada linha passa pelo MESMO `confirmar` de hoje
  (releitura ao vivo, anti-TOCTOU, lock de grupo, idempotência).
- **Falha parcial (Q1):** independente por linha. O que passa confirma; o que falha volta com o motivo;
  a tela mostra "X confirmados, Y recusados". Não existe tudo-ou-nada.
- **Limite (Q2):** 30 linhas por conjunto; acima disso, 422.
- **Este título (Q8):** o título em que a gaveta foi aberta é a primeira linha da lista, desmarcado,
  quando ele próprio é elegível. O botão de confirmação individual continua funcionando.
- **Ajuste de centavos (Q5, esclarecido):** é o ajuste automático que já existe (ADR-0074), disparado
  **uma vez por título**, como no confirmar individual. Não é uma operação de grupo. A emenda da
  I18a(4) para +1..+5 dias fica **fora** deste PR (PR separado).

## Eixo Invariante (elegibilidade)

- Mesmo `pesCod` **e** mesma filial do título de origem (Q7).
- Sugestão confirmável hoje e escolhida pela âncora `NUMERO_CONFIAVEL` (I15s).
- Ficam de fora: títulos que exigem reconhecimento tipado (ADR-0078) ou o reconhecimento simples
  (I15o), `AMBIGUA`, `DISPUTADA`, títulos já confirmados, em grupo (ADR-0077) ou em lote finalizado.
- **Aglomerado tipo TIME LOG (Q6):** a linha em que o título seria `AMBIGUA` sem a âncora (boletos
  idênticos e o número é o único desempate) recebe o aviso "escolhido só pelo número" e entra na
  contagem do resumo. Continua marcável: é justamente o caso NELSON HEUSI.
- **Faixa (Q4):** par com centavos **e** +1..+5 dias aparece, marcável, com o aviso "ajuste manual no
  Conexos" e conta no resumo, porque a I18a(4) não o ajusta sozinho.

## Eixo Integração

- Nenhuma escrita no Conexos pela confirmação (I15b). A única escrita no ERP é a do ajuste de centavos
  já existente, agendada depois do commit de cada linha, com o modo e o kill-switch de hoje
  (`SISPAG_LIVE_WRITE_ENABLED`).
