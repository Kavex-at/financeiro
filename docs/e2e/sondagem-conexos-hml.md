# Sondagem do Conexos HOMOLOGAÇÃO (columbiatrading-hml) — viabilidade do E2E real

> **Data:** 2026-08-03 · **Método:** 3 rodadas de sondagem 100% leitura (login, list POSTs,
> validadores idempotentes, GETs, `initialValues` — nenhum documento criado/alterado).
> Credenciais: usuário informado pelo Yuri, guardado em `src/backend/.env` (gitignored), com
> `CONEXOS_BASE_URL` travado no HML neste checkout. Scripts: scratchpad da sessão (`probe-hml*.mjs`).

## Veredito

**O HML é utilizável para o E2E real, com 3 lacunas de configuração/seed a resolver antes da leg
fiscal (NDe).** A metade de leitura+ingestão+alocação roda hoje; a escrita da SN encontra duas
configs ausentes; a NDe precisa do código da configuração do com297.

## O que o HML TEM (verificado)

| Item | Estado |
|------|--------|
| Acesso direto (sem allowlist de IP) | ✅ responde da máquina local |
| Login + `usnCod` + 7 filiais | ✅ (Cariacica, Itajaí, Barueri, Curitiba, Recife, BH, SP) |
| ACL da conta (`com300/com131/com297/com194`) | ✅ todas presentes |
| Contas `fin133` com movimento | ✅ (ex.: gerNum 38 Itaú com 570 lançamentos; Bradesco 213; Banestes 214) |
| Extrato `fin095` | ⚠️ **dados param em nov–dez/2025** (117 créditos/2 anos na conta 38; 0 nos últimos 90 dias). Janela de ingestão `dias: 365` cobre |
| Processos abertos `imp021` | ✅ todas as filiais (fil 2 com 174) |
| Processos com variante **SN - ENCOMENDA** | ✅ fil 1 pri 17 (BELLIZ, pesCod 676), fil 1 pri 16, fil 2 pri 186–188 (SKYJACK); pri 20 tem só CTA E ORDEM; fil 4 sem variante SN nos recentes |
| Cadastro dos processos (endCodFis + CNPJ) | ✅ nos 8 amostrados |
| SEFAZ de homologação | ✅ há doc com297 AUTORIZADO (doc 111, `vldTpNf:"10"`, `vldAutorizado:1`, valor 3.000, `fisVldTipoNfDebito:4`) |
| **CST IBS/CBS no template de item** | ✅ **`dprVldCstIbsCbs: "-1"` confirmado no HML** (initialValues de doc real) — espelha produção; o E2E fiscal lá é REPRESENTATIVO do gap RT-001 |

## O que FALTA (bloqueia a leg de escrita/fiscal)

1. **Conta de projeto "ADIANTAMENTO DE CLIENTE ENCOMENDA" ausente** no `lov/ContasProjetoCtb` do
   pri 17 (só DESPACHANTE/FORNECEDORES/CÂMBIO) → a etapa de item da SN **falha-fechado** (por design).
   Ação: cadastrar a conta no HML (prjCod 1) OU indicar processo/filial que já a tenha.
2. **Condição "BELLIZ - DUPLICATA" inexistente** no LOV (alfabeticamente apareceria antes de
   BONDUELLE; não está) → a SN seguiria com default e a finalização pode travar na com194
   ("condição diferente da sugerida"). Ação: cadastrar a condição do cliente de teste no HML.
   ⚠️ Achado de produto: no HML o LOV `CondPgtoPessoa` devolve lista GLOBAL (ignora `pesCod`) —
   o `escolherCondicaoPagamento` (primeira contendo DUPLICATA) escolheria a de OUTRO cliente.
3. **Código da configuração "NOTA DE DÉBITO ELETRÔNICA" no com297 desconhecido**: o `com297/list`
   do HML **não expõe `gcdCod`/`gcdDesNome`** nas rows (fieldList explícito vem null; fieldList
   vazio não traz os campos) e os LOVs de config sem contexto de pessoa retornam 401.
   Ação (Yuri, UI do HML): abrir com297 → Gerar documento → dropdown "Configuração" e anotar
   nome/código; setar `COM297_GCD_NOTA_DEBITO=<gcdCod>` no `.env`.
   ⚠️ Achado de produto: **`resolveGcdCodByName` não funciona** quando o list não devolve
   `gcdDesNome` — em produção o mesmo caminho nunca rodou live; o env override é o plano B correto.

## Observações fiscais (alimentam a auditoria RT)

- `finDocFiscal` (com300) do HML **não tem nenhum campo IBS/CBS** e o doc autorizado usa
  `fisVldTipoNfDebito: 4` (tipo diverso do hardcode 6 do app) — o leiaute NT 2025.002 pode não
  estar ativo no HML; o XML de lá pode não conter grupo IBS/CBS. Não usar o HML como prova de
  conformidade do XML — continua valendo o info-gap #1 (XML de produção pós-03/08).
- O snapshot do HML aparenta ser de ~dez/2025–jan/2026 (extrato até nov–dez/2025; a config NDe de
  produção pode não existir lá).

## Plano proposto

- **Fase A (sem escrita — pode rodar já):** harness E2E apontado ao HML real com persistência
  in-memory: ingestão `dias: 365` → painel → pré-flight de alocação (read-only) + execução em
  `dryRunOverride`. Valida clients/normalização/classificação contra o ERP real.
- **Fase B (escrita no HML — só após os 3 seeds acima e aprovação do Yuri passo a passo):**
  alocação real no processo de teste (SN → fin014 → NDe → fiscal → homologação SEFAZ-HML) com
  captura dos payloads para o dossiê fiscal.
