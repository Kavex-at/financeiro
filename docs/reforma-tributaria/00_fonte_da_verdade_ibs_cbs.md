# Reforma Tributária do Consumo (IBS/CBS) — Fonte da Verdade

> **Status:** OFICIAL — fonte da verdade normativa para o desenvolvimento do projeto Financeiro Columbia.
> **Data de corte da pesquisa:** 2026-08-02 (véspera da obrigatoriedade sob rejeição dos campos IBS/CBS na NF-e).
> **Escopo:** aplicação do IBS e da CBS a trading companies (importação por conta e ordem / por encomenda) e
> impacto nas quatro frentes do projeto (Permutas, SISPAG, Popula GED, Conciliação de Recebimentos/NDe).
> **Regra de precedência:** em conflito entre este documento e código/ontologia, este documento prevalece até
> que um ADR o revise. Ele NÃO substitui parecer jurídico — consolida o estado normativo para orientar dev/teste.

---

## 1. Base normativa

| Norma | O que é | Relevância |
|-------|---------|-----------|
| **EC 132/2023** | Emenda da Reforma Tributária do Consumo | Cria IBS, CBS e IS; extingue gradualmente PIS/COFINS/ICMS/ISS/IPI |
| **LC 214/2025** (16/01/2025) | Lei complementar instituidora do IBS/CBS/IS | Fato gerador, base de cálculo (art. 12), importação (arts. 63–90), split payment (arts. 31 e ss.), ano-teste (art. 348) |
| **Resolução CGIBS nº 6/2026** (30/04/2026) + **Decreto nº 12.955/2026** (29/05/2026) | Primeira regulamentação abrangente do comércio exterior sob IBS/CBS | Regimes aduaneiros especiais (drawback, Recof, Repetro, ZFM/ZPE) |
| **NT 2025.002-RTC** (versões 1.33 → 1.36 → 1.40/1.50) | Nota Técnica NF-e/NFC-e da reforma | Novos grupos XML (IBS/CBS/IS), finalidades 5/6 (Nota de Crédito/Débito), regras de validação e rejeição |
| **Ajuste SINIEF 49/2025** (05/12/2025) + **Ajuste SINIEF 15/2026** (30/04/2026) | Regras de uso das Notas de Débito/Crédito | Hipóteses de uso do finNFe 5/6; exigibilidade deslocada para **03/08/2026** |

## 2. Cronograma e estado atual (o que vale HOJE, 02/08/2026)

### Cronograma macro 2026–2033

| Ano | O que acontece |
|-----|----------------|
| **2026** | **Ano-teste**: CBS 0,9% + IBS 0,1% (alíquotas simbólicas). Recolhimento **dispensado** se o contribuinte cumprir as obrigações acessórias (art. 348, §1º) — principalmente o destaque correto de IBS/CBS nos documentos fiscais eletrônicos |
| **2027** | CBS em alíquota cheia; **PIS/COFINS extintos**; IS (Imposto Seletivo) passa a valer; split payment inicia em estágio opcional B2B |
| **2029–2032** | Transição do IBS × ICMS/ISS (redução gradual de ~10%/ano dos tributos antigos) |
| **2033** | Regime pleno: só IBS/CBS/IS; ICMS e ISS extintos |

### Estado operacional em agosto/2026 (fatos que afetam o projeto AGORA)

1. **03/08/2026 — obrigatoriedade sob rejeição**: preenchimento dos grupos IBS/CBS na NF-e (modelo 55) torna-se obrigatório **sob pena de rejeição** para empresas do regime regular (CRT=3, Lucro Real/Presumido — caso da Columbia). NT 2025.002 v1.40 em produção. Simples/MEI: 04/01/2027.
2. **03/08/2026 — Notas de Débito/Crédito eletrônicas exigíveis**: início da exigibilidade das obrigações acessórias das ND/NC do IBS/CBS (Ajuste SINIEF 15/2026, que deslocou os efeitos do Ajuste SINIEF 49/2025).
3. **01/09/2026**: `DFeReferenciado` obrigatório em devoluções.
4. **03/11/2026**: NT v1.50 (tributação monofásica reformulada) obrigatória em produção.
5. **Desde 01/01/2026**: preenchimento do **cClassTrib** (código de classificação tributária, 6 dígitos) obrigatório em DI/DUIMP — é o cumprimento dessa obrigação acessória que garante a **dispensa** de recolhimento de CBS/IBS na importação em 2026.
6. **Risco central de compliance 2026**: emitir documento fiscal **sem** o grupo IBS/CBS corretamente preenchido ⇒ perda da dispensa do art. 348, §1º ⇒ o tributo do ano-teste passa a ser **devido** (0,9% + 0,1%), além de alimentar incorretamente a apuração assistida.

## 3. IBS/CBS na importação — o papel da trading

### Incidência e contribuinte

- **Art. 63, LC 214**: IBS/CBS incidem na importação de bens e serviços por qualquer pessoa, independentemente da finalidade — alíquota **igual à da operação interna** com o mesmo bem/serviço (princípio da equiparação).
- **Fato gerador**: bens — desembaraço aduaneiro (entrega da mercadoria submetida a despacho para consumo, admitida antecipação); serviços — liquidação cambial/pagamento.
- **Base de cálculo na importação**: valor aduaneiro + II + IPI (quando aplicável) + taxas e direitos aduaneiros — cálculo "por fora".
- **Importação por conta e ordem**: o **adquirente** é considerado quem promove a entrada (art. 72); a **trading permanece responsável legal** pelo recolhimento ao realizar o despacho — estrutura análoga à atual, mas sem ICMS-Difal (elimina dupla tributação em remessas interestaduais).
- **Importação por encomenda**: o **encomendante predeterminado** é o responsável pelos tributos.
- **Princípio do destino**: o IBS é devido ao ente do **destinatário/adquirente final**, não ao do desembaraço — o campo "local de entrega" na NF passa a ser criticamente relevante (art. 11).

### Créditos

- Não-cumulatividade ampla: crédito integral e imediato inclusive sobre bens de capital (sem parcelamento em 48x como no ICMS).
- Na conta e ordem, o crédito segue o destinatário jurídico da operação (adquirente), conforme arranjo documental — indicação incorreta de destino ⇒ **glosa de créditos**.

### Regimes aduaneiros especiais

- **Drawback suspensão**: suspensão de IBS/CBS garantida (art. 90, LC 214). **Drawback isenção e restituição NÃO se aplicam a IBS/CBS.**
- Recof, Repetro, ZPE, ZFM: incorporados pela Res. CGIBS 6/2026 + Decreto 12.955/2026 com regras adaptadas.
- OEA: art. 76, §2º autoriza recolhimento posterior para operadores certificados.

## 4. Base de cálculo (art. 12, LC 214) — coração das regras de negócio da Frente IV

### Integra a base (§1º) — "valor integral cobrado a qualquer título"

- Acréscimos decorrentes de ajuste do valor da operação;
- **Juros, multas, acréscimos e encargos** ← diretamente relevante para as regras de juros/multa da Conciliação de Recebimentos;
- Descontos concedidos **sob condição**;
- Transporte cobrado como parte da operação; tributos e preços públicos; seguros e taxas.

### NÃO integra a base (§2º)

- O próprio IBS/CBS (cálculo "por fora") e o IPI;
- **Descontos incondicionais**;
- **Inciso IV — reembolsos/ressarcimentos por valores pagos em operações por conta e ordem ou em nome de terceiros, DESDE QUE a documentação fiscal seja emitida em nome do terceiro.**

### Consequência direta para o modelo de negócio da Columbia (repasse de custos / numerário)

A exclusão do reembolso da base de IBS/CBS é **condicional e formal**:

1. Documento do custo repassado (frete, armazenagem, taxas, despachante etc.) emitido **em nome do cliente adquirente** ⇒ repasse EXCLUÍDO da base da Columbia.
2. Documento emitido **em nome da Columbia** ⇒ o repasse INTEGRA a base tributável dela (o cliente toma crédito, mas a operação é tributada na trading).
3. **Taxas administrativas, margens ou comissões embutidas no repasse integram a base** — a cobrança precisa segregar explicitamente serviço próprio (tributável) × reembolso (excluído), referenciando a NF original em nome do cliente.
4. Histórico contencioso de PIS/COFINS em conta e ordem foi **codificado** em critério documental objetivo — o compliance passa a ser verificável por documento, não por tese econômica.

## 5. Notas de Débito e Crédito eletrônicas (novo DF-e)

- Criadas pela LC 214/2025 e operacionalizadas pela NT 2025.002 como **novas finalidades da NF-e modelo 55**: `finNFe = 5` (Nota de Crédito) e `finNFe = 6` (Nota de Débito), com tipos qualificadores (`tpNFDebito` / `tpNFCredito`).
- **Finalidade**: registrar ajustes que impactem débitos/créditos de IBS e CBS **não refletidos no documento original** — ND aumenta o valor/tributo da operação original; NC reduz/anula.
- **Hipóteses de ND** incluem expressamente **multa e juros** (cobrança pós-faturamento), além de venda para entrega futura com pagamento antecipado, perdas de estoque, crédito presumido ZFM etc. (Ajuste SINIEF 49/2025).
- Ajustes com impacto em base/crédito **exigem** o documento específico, sob risco de inconsistência na apuração assistida e rejeição.
- Devem **referenciar o DF-e original** (grupo `DFeReferenciado` — chave de acesso + item).
- Exigibilidade a partir de **03/08/2026** (Ajuste SINIEF 15/2026).

> ⚠️ **Colisão terminológica com o projeto:** a "NDe" do projeto (Nota de Débito emitida via Conexos ao
> executar um `Recebimento`) e a "Nota de Débito eletrônica" da reforma (finNFe=6) **não são automaticamente
> a mesma coisa** — mas o fato de a reforma transformar a nota de débito em DF-e com efeito tributário muda o
> enquadramento do documento que a Columbia emite. Ver §7.

## 6. Novos campos/grupos de documento fiscal (NT 2025.002) — checklist técnico

- **Grupo UB (por item)**: `CST` (situação tributária IBS/CBS) + `cClassTrib` (classificação tributária, tabela nacional); subgrupos `IBSUF` (alíquota estadual, diferimento, redução), `IBSMun` (alíquota municipal), `CBS` (alíquota federal); `gTribRegular`, `gIBSCredPres`/`gCBSCredPres` (crédito presumido), `gTribCompraGov`, `gIBSCBSMono` (monofásica), `gAjusteCompet`, `gEstornoCred`, `gTransfCred`.
- **Grupo B**: `cMunFGIBS` (município do fato gerador), `tpNFDebito`/`tpNFCredito`, `dPrevEntrega`.
- **Grupo VC**: `DFeReferenciado` (chave + item).
- **Grupo W03**: totais de IBS/CBS/IS da nota (tributos "por fora").
- **Rejeições**: faixa 1100–1199 dedicada aos novos tributos (ex.: UB12-10).
- **NFS-e nacional**: layout também ganha campos IBS/CBS durante a transição (ISS convive até 2032; serviços passam a ser tributados por IBS/CBS progressivamente a partir de 2027–2029).

## 7. Split payment — impacto futuro na Conciliação de Recebimentos

- **O que é**: recolhimento automático de IBS/CBS pelo prestador de serviços de pagamento no momento da **liquidação financeira** — o fornecedor recebe apenas o **valor líquido**; o tributo vai direto ao fisco (arts. 31 e ss.).
- **Modalidades**: split padrão (consulta em tempo real ao sistema CGIBS/RFB), split simplificado, e recolhimento pelo adquirente.
- **Parcelamento**: art. 34, II — segregação e recolhimento **proporcionais na liquidação de cada parcela**.
- **Cronograma**: estágio inicial **2027**, uso **opcional** e voltado a operações B2B; obrigatoriedade posterior conforme regulamentação.
- **Impacto direto na Frente IV**: quando o split alcançar os recebimentos da Columbia, o extrato (Nexxera/fin095) passará a exibir **valores líquidos de IBS/CBS**, quebrando qualquer matching 1:1 entre valor do recebível e valor creditado. O motor de conciliação precisará tolerar/decompor a diferença `bruto − (IBS+CBS)` por parcela. **Não é exigência para 2026**, mas é decisão de arquitetura a antecipar.

## 8. Impacto por frente do projeto

> Preenchido a partir do mapeamento do código atual (ver §9). Resumo da exposição:

| Frente | Exposição à reforma | Urgência |
|--------|--------------------|---------| 
| **IV — Conciliação de Recebimentos / NDe** | **ALTA** — emite documento de cobrança (NDe) com juros/multa/repasses; é o ponto onde IBS/CBS, ND eletrônica (finNFe=6), art. 12 e split payment convergem | Imediata (obrigações de 03/08/2026) |
| **I — Permutas (PROFORMA × INVOICE)** | Média — baixas/ajustes de adiantamento podem exigir NC/ND de ajuste sob IBS/CBS; valores de invoice passarão a conter destaque IBS/CBS | 2026–2027 |
| **II — SISPAG (pagamentos)** | Média-baixa — pagamentos a fornecedores refletirão documentos com IBS/CBS; retenções e conciliação de retorno podem mudar com split payment (2027+) | 2027 |
| **III — Popula GED (NC/ND)** | Média — a NC/ND que hoje "nasce em planilha e sobe como rascunho" tende a virar/conviver com DF-e de crédito/débito com efeito tributário; o casamento PDF×documento pode ganhar novos tipos documentais | 2026–2027 |

### Detalhamento

- **Frente IV**: a NDe é gerada no `com297` (documento fiscal de saída homologado na SEFAZ — ADR-0024), tipada hoje como `fisVldTipoNfDebito = 6` ("Pagamento Antecipado") — exatamente uma das hipóteses de **Nota de Débito eletrônica** do Ajuste SINIEF 49/2025 (venda para entrega futura com pagamento antecipado). Ou seja: **o documento que a automação emite É (ou está a um passo de ser) o novo DF-e da reforma**, e passa a estar sujeito às regras de grupo IBS/CBS, referenciamento e tipos qualificadores a partir de 03/08/2026.
- **Frente I**: a classificação juros/desconto (contas 130/131) é **variação cambial**, não tributo — sem impacto direto de IBS/CBS na regra em si; mas as baixas `fin010` enviam `bxaMnyJuros/Multa/Desconto`, campos que sob o art. 12, §1º passam a ter efeito na base quando não forem zero.
- **Frente II**: CNAB/remessa não muda em 2026; com split payment (2027+) a conciliação de retorno pode passar a ver líquidos de tributo. Não há modalidade de pagamento de tributo (DARF/segmento N) no escopo.
- **Frente III**: sem código hoje. Quando implementada, a NC/ND que "nasce em planilha" tende a colidir com o novo regime em que ajustes de débito/crédito **exigem DF-e específico** — o escopo "só anexa PDF" continua válido, mas o documento casado poderá ser um finNFe 5/6.

## 9. Estado atual da solução × exigências (inventário de 02/08/2026, app v0.19.0)

### 9.1 O que a solução faz hoje (fatos verificados no código)

1. **A solução não calcula, não classifica e não apura nenhum tributo.** É um orquestrador de documentos e valores: `com299 (SN) → fin014 (baixa) → com297 (NDe) → com300 (fiscal) → com131 (obs SINIEF) → homologar → poll SEFAZ` (`src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts`).
2. **Todo conteúdo tributário vem do ERP**: CFOP (`cfoEspCod`), tipo de operação (`tpcCod`), série (`fisEspSerie`) e classificação vêm de `com299/gerDoc/validaConfigDoc`; a observação SINIEF é gerada pelo servidor (`com131/geraObs`). O único campo fiscal que a solução **decide** é `fisVldTipoNfDebito = 6` (Pagamento Antecipado) no `com300` (`ConexosNdeFiscalClient.ts`).
3. **Já existe IBS/CBS no wire e a solução o propaga cegamente**: o template de `com299/comDocProdutos/initialValues` devolve `dprVldCstIbsCbs: "-1"` (CST IBS/CBS *não classificado*) e o spread do template reenvia esse valor sem crítica (`RecebimentoNumerarioService.ts:477-491`).
4. **Juros, multa e desconto são hard-zerados** na baixa `fin014` (`bxaMnyJuros: 0, bxaMnyMulta: 0, bxaMnyDesconto: 0` — `RecebimentoNumerarioService.ts:803-827`). As regras que os separariam são STUBs de Fase 4 (`ontology/business-rules/separacao-multa-juros.md`, `encomenda-percentuais.md`, `adiantamento-cliente.md`).
5. **O ERP Conexos já está instrumentado para a reforma** — classificador tributário IBS/CBS na Invoice (`log009`), tela `com377` (redução de alíquota IBS/CBS), `com353`, ~80 campos IBS/CBS no swagger (monofasia, créditos, alíquotas origem/destino). **A solução não lê nem escreve nenhum deles.**
6. **Pendências fiscais internas já registradas e não-bloqueantes**: NDe homologada com `docMnyValor = 0` (só gera warn — `RecebimentoNumerarioService.ts:978-984`); divergência de `prdCod` (item gravado `2`, com194 espera `41978` → "produto errado na nota"). Ver `ontology/integrations/recebimentos-numerario-real-fiscal-spec.md`.
7. **Extrato** vem do Conexos `fin095` (read-only, ADR-0023); matching/rateio/regras do motor de conciliação ainda são stubs — o caminho real é payment-driven (analista aloca).
8. **Nenhum documento do projeto** (proposta, ontologia, docs) menciona LC 214/2025, split payment ou imposto seletivo. Este documento fecha essa lacuna.

### 9.2 Confronto exigência × estado atual

| # | Exigência (norma) | Estado atual | Gap/risco |
|---|-------------------|--------------|-----------|
| 1 | Grupo IBS/CBS (CST + cClassTrib) obrigatório em todo DF-e a partir de 03/08/2026, sob rejeição (NT 2025.002 v1.40) | Solução propaga `dprVldCstIbsCbs:"-1"`; não verifica se a NDe homologada saiu com grupo IBS/CBS válido | **ALTO** — rejeição SEFAZ e/ou perda da dispensa do art. 348 |
| 2 | ND eletrônica (finNFe=6) com tipo qualificador correto e exigível desde 03/08/2026 (Aj. SINIEF 49/2025 + 15/2026) | `fisVldTipoNfDebito=6` ("Pagamento Antecipado") hardcoded para todos os casos | **MÉDIO** — tipo correto p/ adiantamento; **errado** quando a cobrança for juros/multa ou complemento |
| 3 | Juros/multa/acréscimos integram a base IBS/CBS (art. 12, §1º) | Hard-zerados no fin014; regra de separação é STUB | **MÉDIO hoje / ALTO quando cobrar** — cobrança de juros/multa sem ND com destaque = base omitida |
| 4 | Reembolso conta-e-ordem fora da base SÓ com doc fiscal em nome do terceiro (art. 12, §2º, IV) | Solução não valida nem registra em nome de quem está o documento do custo repassado | **ALTO (negócio)** — repasse pode virar base tributável da Columbia |
| 5 | Ajustes de base/crédito exigem NC/ND referenciando o DF-e original (`DFeReferenciado`; obrigatório em devoluções desde 01/09/2026) | Solução não referencia documento algum; não sabe se o Conexos o faz | **INDETERMINADO** — verificar no XML autorizado |
| 6 | Documento fiscal com valor correto (base íntegra) | Pendência conhecida: `docMnyValor` zerado após homologação, apenas warn | **ALTO** — DF-e autorizado com base 0 |
| 7 | Item da nota com produto/classificação corretos | Divergência `prdCod` 2×41978 apontada pelo com194 | **MÉDIO** — classificação tributária do item errada |
| 8 | cClassTrib obrigatório em DI/DUIMP desde 01/01/2026 (condição da dispensa na importação) | Fora do escopo da solução (processo de importação no ERP) | Monitorar — risco do cliente, não do app |
| 9 | Split payment: extrato com valores líquidos de IBS/CBS por parcela (2027+, art. 34, II) | Matching/conciliação assume valor cheio; motor ainda stub | **BAIXO hoje / estrutural em 2027** — decisão de arquitetura do matching |
| 10 | Alíquotas de teste 2026: CBS 0,9% + IBS 0,1% | Regra-stub `encomenda-percentuais.md` cita exatamente **0,1% / 0,9%** sem definir base/destino | **HIPÓTESE A VALIDAR**: os "percentuais de encomenda" são provavelmente o repasse do IBS/CBS-teste na importação por encomenda |

## 10. Requisitos derivados (RT-xxx) — fonte da verdade para dev/teste

> Status a preencher pela sessão de auditoria: `CONFORME` / `GAP` / `INDETERMINADO` / `ERP` (responsabilidade do Conexos, monitorar).

| ID | Requisito | Norma | Componente | Prazo |
|----|-----------|-------|------------|-------|
| **RT-001** | Toda NDe emitida deve sair autorizada com grupo IBS/CBS válido (CST ≠ `-1`, cClassTrib preenchido). A solução deve **fail-closed** (ou `revisao_humana`) se detectar CST não classificado no template/retorno | NT 2025.002 v1.40; LC 214 art. 60 e 348 §1º | `SnPayloadBuilder`, `RecebimentoNumerarioService.completarSnAdiantamento`, `ConexosNdeFiscalClient` | 03/08/2026 |
| **RT-002** | O tipo da ND (`fisVldTipoNfDebito`/`tpNFDebito`) deve refletir a hipótese real: adiantamento = "pagamento antecipado"; juros/multa = tipo próprio; nunca hardcode único | Aj. SINIEF 49/2025; NT 2025.002 (B25.1) | `constants.ts` (`NDE_FISCAL_TIPO_NF_DEBITO_*`), `etapaFiscal()` | 03/08/2026 |
| **RT-003** | NDe de ajuste deve referenciar o DF-e original (chave de acesso + item) quando exigido | NT 2025.002 (grupo VC/DFeReferenciado); Aj. SINIEF 49/2025 | config `gcd` no Conexos + verificação do XML autorizado | 01/09/2026 (devoluções) |
| **RT-004** | Quando juros/multa forem cobrados (regra `separacao-multa-juros`), o valor deve compor a base IBS/CBS via ND com destaque — não pode ser liquidado "por fora" sem documento | LC 214 art. 12 §1º, II | `etapaFin014` (hoje hard-zero), futura regra de negócio | quando a regra sair de STUB |
| **RT-005** | Repasse de custos ao cliente só é excluído da base se o documento do custo estiver **em nome do cliente**; a solução deve registrar/validar esse vínculo documental por item repassado | LC 214 art. 12 §2º, IV | modelo de dados do `Recebimento`/`RateioRecebimento`; processo Columbia | imediato (compliance) |
| **RT-006** | Comissão/serviço próprio da Columbia deve ser segregado do reembolso na cobrança (documentos ou itens distintos), pois integra a base | LC 214 art. 12 §1º | emissão NDe / processo | imediato (compliance) |
| **RT-007** | NDe homologada com `docMnyValor = 0` deve **bloquear** o fluxo (erro/`revisao_humana`), não apenas warn — base zerada é infração acessória | LC 214 art. 60; art. 348 §1º | `etapaHomologar`/`etapaPoll` (`RecebimentoNumerarioService.ts:978-984`) | imediato |
| **RT-008** | Divergência de produto do item (`prdCod` 2 × 41978) deve ser resolvida antes de produção — item errado ⇒ cClassTrib errado | NT 2025.002 (grupo UB por item) | `adicionarProduto()`, template `comDocProdutos` | imediato |
| **RT-009** | Percentuais de encomenda (0,1%/0,9%): validar com o fiscal da Columbia se são o repasse do IBS/CBS-teste; se sim, a base, arredondamento (`round2`) e vigência (2026 apenas; muda em 2027) devem ser definidos na regra — e o cálculo passa a ter **vigência normativa**, não contratual | LC 214 arts. 343–348 | `EncomendaValorCalculator`, `ontology/business-rules/encomenda-percentuais.md` | antes de sair de STUB |
| **RT-010** | O motor de conciliação (matching) deve ser desenhado para tolerar/decompor diferença `bruto − (IBS+CBS)` por parcela quando o split payment alcançar os recebimentos | LC 214 arts. 31 e ss., art. 34 II | `MatchingEngineStub` → engine real; `normalizarLancamento` | arquitetura já; funcional 2027+ |
| **RT-011** | Nenhuma emissão automatizada pode deixar obrigação acessória descumprida silenciosamente — falhas fiscais devem ser auditáveis (ledger) e visíveis (painel), pois custam a dispensa do art. 348 | LC 214 art. 348 §1º | ledger de etapas (`0041/0042`), painel recebimentos | contínuo |
| **RT-012** | Permutas: baixas `fin010` com `bxaMnyJuros/Multa/Desconto` ≠ 0 ganham efeito de base IBS/CBS — revisar a classificação (variação cambial × acréscimo financeiro) com o fiscal | LC 214 art. 12 §1º | `ReconciliacaoPermutaService`, `ConexosBaixaClient` | 2027 (CBS plena) |
| **RT-013** | GED/NC-ND: quando a Frente III for implementada, o casamento deve reconhecer os novos DF-e finNFe 5/6 como tipos documentais | NT 2025.002 | (futuro) | na implementação |
| **RT-014** | Monitorar NT v1.50 (monofasia, obrigatória 03/11/2026) e a evolução do leiaute — responsabilidade primária do Conexos, mas payloads propagados pela solução não podem quebrar | NT 2025.002 v1.50 | clients Conexos (`.passthrough()` ajuda) | 03/11/2026 |

### Info-gaps para o fiscal da Columbia (P0 de negócio)

1. A configuração de documento "NOTA DE DÉBITO ELETRÔNICA" (`gcd` do com297) já emite **finNFe=6 com grupos IBS/CBS** no XML autorizado? (Pedir um XML de NDe autorizada pós-03/08/2026.)
2. Os **percentuais de encomenda 0,1%/0,9%** são o repasse do IBS/CBS do ano-teste? Qual a base?
3. Os documentos de custos repassados (frete, armazenagem, despachante) saem **em nome da Columbia ou do cliente adquirente**? (Determina o art. 12 §2º IV.)
4. Quem classifica o `cClassTrib` dos itens (produto 41978 e afins) no Conexos, e ele está classificado hoje (`dprVldCstIbsCbs` ≠ `-1`)?

## Fontes

- [LC 214/2025 (Planalto)](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm)
- [Portal NF-e — Adequações NF-e/NFC-e Reforma Tributária](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=AklZnck3o6I%3D)
- [Tecnospeed — NT 2025.002 IBS/CBS/IS: grupos, campos e validação](https://blog.tecnospeed.com.br/nota-tecnica-reforma-tributaria-nfe-nfce/)
- [Tecnospeed — Notas Fiscais de Débito e Crédito na Reforma](https://blog.tecnospeed.com.br/notas-fiscais-de-debito-e-credito-na-reforma-tributaria/)
- [Grant Thornton — Notas de Débito e Crédito CBS/IBS](https://www.grantthornton.com.br/insights/artigos-e-publicacoes/notas-de-debito-e-credito--cbs-e-ibs/)
- [Ajuste SINIEF 49/2025 — impactos (Tecnospeed)](https://blog.tecnospeed.com.br/ajuste-sinief-49-2025-impactos/)
- [Sawaya — Ajuste SINIEF 49/25: ND/NC (ICMS, IBS e CBS)](https://sawayaadv.com.br/ajuste-sinief-49-25-novas-regras-para-notas-de-debito-e-credito-icms-ibs-e-cbs/)
- [Metrópole — Regras de emissão da ND/NC do IBS e CBS](https://metropolecontabilidade.com.br/reforma-tributaria-conheca-as-regras-para-emissao-da-nota-de-debito-e-da-nota-de-credito-do-ibs-e-da-cbs/)
- [reformatributaria.com — Reembolso de despesas e o art. 12, §2º, IV](https://www.reformatributaria.com/opiniao/reembolso-de-despesas-reforma-tributaria-uma-analise-do-inciso-iv-2o-do-artigo-12-da-lei-complementar-no-214-de-2025/)
- [Salomão Advogados — Do ICMS ao IBS/CBS: importação por conta e ordem](https://salomaoadv.com.br/4198-2/)
- [ConJur — Importação, IBS e CBS: a regulamentação (Res. CGIBS 6/2026, Dec. 12.955/2026)](https://www.conjur.com.br/2026-jun-16/importacao-ibs-e-cbs-o-que-revela-a-regulamentacao-da-reforma-tributaria/)
- [Planning — Importação na Reforma Tributária: tributos e créditos](https://planning.com.br/importacao-reforma-tributaria-ibs-cbs/)
- [Logcomex — O que muda no Drawback](https://blog.logcomex.com/reforma-tributaria-2026-o-que-muda-no-drawback)
- [Avalara — Split Payment na LC 214/2025](https://site.avalarabrasil.com.br/reforma-tributaria/split-payment-lei-complementar-214-2025/)
- [ConJur — Split payment e pagamento parcelado (art. 34, II)](https://conjur.com.br/2025-dez-17/split-payment-e-operacoes-com-pagamento-parcelado-uma-analise-sobre-a-apropriacao-de-creditos-pelo-adquirente/)
- [Simplifique — IBS/CBS na NF-e: campos obrigatórios em 03/08/2026](https://simplifique.contmatic.com.br/blogs/ibs-cbs-nfe-campos-obrigatorios-agosto-2026)
- [Pedroso — NT 2025.002-RTC v1.33 e aplicação do IBS/CBS em 2026](https://www.pedrosoadvogados.com.br/reforma-tributaria-nota-tecnica-2025-002-rtc-versao-1-33-e-aplicacao-do-ibs-cbs-em-2026)
- [Sperling — Destaque de IBS/CBS/IS em 2026 e art. 348](https://sperling.adv.br/publicacoes/reforma-tributaria-do-consumo-esclarecimentos-sobre-destaque-de-ibs-cbs-e-is-em-2026/)
- [ReformaTributária360 — validação suspensa × obrigação legal mantida](https://reformatributaria360.com.br/noticias/ibs-e-cbs-sistema-nao-vai-rejeitar-mas-a-lei-continua-exigindo/)
