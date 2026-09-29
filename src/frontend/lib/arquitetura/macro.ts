/**
 * Vista MACRO — as frentes do contrato em raias horizontais, na linguagem do negócio.
 *
 * Cada raia é lida da esquerda (origem do dado) para a direita (efeito no ERP).
 * O eixo vertical separa as frentes; a maturidade do nó carrega a informação de
 * onde cada uma já chegou.
 *
 * Revisada contra a `main` em 2026-09-29 (v0.44.0). A Popula GED (antiga Frente III)
 * saiu do diagrama: o contrato vigente tem três frentes, e ela nunca teve código.
 */

import type { ArqEdge, ArqNode } from './types'

const RAIA_PERMUTAS = 0
const RAIA_SISPAG = 420
const RAIA_RECEBIMENTOS = 900

const COL = (n: number) => 40 + n * 290

export const MACRO_NODES: ArqNode[] = [
    // ─────────────────────────── Frente I — Permutas ───────────────────────────
    {
        id: 'macro-permutas-eleicao',
        position: { x: COL(0), y: RAIA_PERMUTAS },
        data: {
            label: 'Eleição de adiantamentos',
            subtitle: 'Job · 06h, 12h e 18h BRT',
            frente: 'permutas',
            camada: 'job',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Varre o ERP em busca de PROFORMAs finalizadas que sejam adiantamento, em todas as filiais, e grava um snapshot da eleição no banco. É o ponto de entrada da frente: sem eleição não há candidata. Roda três vezes ao dia via GitHub Actions e também pode ser disparada pelo botão "Atualizar" do painel — disparos simultâneos são fundidos num só.',
            arquivos: [
                'src/backend/jobs/ingest-permutas.ts',
                'src/backend/domain/service/permutas/IngestaoPermutasService.ts',
                'src/backend/domain/service/permutas/EleicaoPermutasService.ts',
                'src/backend/domain/service/permutas/IngestaoCoalescerService.ts',
                '.github/workflows/ingest-permutas.yml',
            ],
            programasErp: ['com308', 'com298'],
            docRefs: [
                'ADR-0006 — ingestão manual como interface humana do mesmo compute',
                'ADR-0043 — fidelidade do snapshot de eleição',
            ],
        },
    },
    {
        id: 'macro-permutas-gates',
        position: { x: COL(1), y: RAIA_PERMUTAS },
        data: {
            label: 'Gates de elegibilidade',
            subtitle: '4 portas · motivo visível',
            frente: 'permutas',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Um adiantamento só vira candidata se passar por quatro portas: é PROFORMA, tem saldo a permutar, está totalmente pago e tem D.I ou DUIMP atrelada (que fornece a data-base do aging). Resíduos de até R$ 1,00 são tolerados, e quando mais de uma porta reprova o painel mostra o motivo de maior prioridade. Um adiantamento que já foi permutado no ERP aparece como JÁ PERMUTADO — um estado próprio, não um bloqueio.',
            arquivos: [
                'src/backend/domain/service/permutas/ElegibilidadeService.ts',
                'ontology/business-rules/elegibilidade-permuta.md',
            ],
            programasErp: ['com298', 'com308', 'imp019', 'imp223'],
            docRefs: [
                'ontology/state-machines/elegibilidade-permuta-candidata.md',
                'ADR-0043 — JÁ PERMUTADO como estado de primeira classe',
                'ADR-0046 — tolerância de resíduo e prioridade dos motivos',
            ],
        },
    },
    {
        id: 'macro-permutas-excecao',
        position: { x: COL(1) + 20, y: RAIA_PERMUTAS - 190 },
        data: {
            label: 'Exceção manual',
            subtitle: 'Permutado fora do painel',
            frente: 'permutas',
            camada: 'humano',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Quando o analista sabe que um adiantamento bloqueado por falta de saldo já foi permutado por fora, o administrador o marca como tal, com justificativa obrigatória. Não escreve nada no ERP; é reversível e fica registrado quem marcou e por quê.',
            arquivos: [
                'src/backend/domain/service/permutas/ExcecaoPermutaService.ts',
                'src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts',
            ],
            docRefs: ['ADR-0047 — exceção manual "permutado fora do painel"'],
        },
    },
    {
        id: 'macro-permutas-casamento',
        position: { x: COL(2), y: RAIA_PERMUTAS },
        data: {
            label: 'Casamento com a invoice',
            subtitle: '1:1 automático · N:M assistido',
            frente: 'permutas',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Conta quantas invoices finalizadas existem no processo. Nenhuma → bloqueada. Exatamente uma → elegível, casa sozinha. Mais de uma → casamento manual, que não é reprovação: falta apenas o analista escolher a alocação. Para importadores cadastrados no cliente-filtro, o adiantamento vai direto para permuta manual entre processos.',
            arquivos: [
                'src/backend/domain/service/permutas/CasamentoInvoiceService.ts',
                'src/backend/domain/service/permutas/AlocacaoPermutasService.ts',
                'src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts',
            ],
            programasErp: ['com298', 'imp021'],
            docRefs: [
                'ADR-0005 — casamento manual como 4º estado',
                'ADR-0007 — cliente-filtro e permuta manual',
                'ADR-0008 — alocação N:M entre processos',
            ],
        },
    },
    {
        id: 'macro-permutas-analista',
        position: { x: COL(2) + 20, y: RAIA_PERMUTAS - 190 },
        data: {
            label: 'Analista decide',
            subtitle: 'Human-in-the-loop',
            frente: 'permutas',
            camada: 'humano',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Invariante de produto: a solução executa o mecânico e audita; a decisão permanece humana. Nos casos compostos o analista define como o valor se distribui entre proformas e invoices, e é ele quem clica em "Processar". O julgamento sobre divergência cambial está fora de escopo — a solução calcula o delta, não decide o que fazer com ele.',
            docRefs: ['ADR-0002 — human-in-the-loop como invariante de produto'],
        },
    },
    {
        id: 'macro-permutas-variacao',
        position: { x: COL(3), y: RAIA_PERMUTAS },
        data: {
            label: 'Variação cambial',
            subtitle: 'Juros (131) ou desconto (130)',
            frente: 'permutas',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Compara a taxa negociada do adiantamento com a da invoice. Delta positivo vira juros (conta 131, passiva); negativo vira desconto (conta 130, ativa). Também absorve o resíduo de centavos quando a baixa consome o adiantamento por inteiro, com guarda de sanidade de R$ 1,00.',
            arquivos: ['src/backend/domain/service/permutas/VariacaoCambialPermutaService.ts'],
            programasErp: ['com308'],
            docRefs: ['ADR-0020 — âncora no valor real do adiantamento'],
        },
    },
    {
        id: 'macro-permutas-baixa',
        position: { x: COL(4), y: RAIA_PERMUTAS },
        data: {
            label: 'Baixa no ERP',
            subtitle: 'fin010 · em produção',
            frente: 'permutas',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Grava a baixa da permuta no borderô do ERP — escrita irreversível, ligada em produção. Até 2026-09-08 foram 137 execuções somando R$ 38,4 milhões. Cada execução é registrada antes da chamada (ledger write-ahead com chave de idempotência), roda sob trava por adiantamento e confere a cobertura antes do primeiro POST. Quando o ERP aceita só parte do valor, a execução termina como "parcial" com o resíduo registrado, em vez de virar erro. O POST não repete em caso de falha de autenticação — repetir seria baixa duplicada.',
            arquivos: [
                'src/backend/domain/client/ConexosBaixaClient.ts',
                'src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts',
                'src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts',
            ],
            programasErp: ['fin010'],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Uma baixa enviada só se desfaz à mão no fin010. E, ao contrário do SISPAG, nenhum job varre execuções de permuta presas no meio do caminho — elas dependem de o analista reprocessar.',
                    origem: 'ADR-0013 / ADR-0044',
                },
            ],
            docRefs: [
                'ADR-0029 — "Processar" volta para a baixa fin010',
                'ADR-0044 — baixa parcial vira estado terminal',
                'docs/runbooks/fin010-write-cutover.md',
            ],
        },
    },
    {
        id: 'macro-permutas-bordero',
        position: { x: COL(5), y: RAIA_PERMUTAS },
        data: {
            label: 'Gestão do borderô',
            subtitle: 'Finalizar · excluir · estornar',
            frente: 'permutas',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'O borderô gerado pelas baixas é acompanhado numa tela própria: finalizar, excluir ou estornar. As ações são sempre por filial (o número do borderô se repete entre filiais) e são enviadas uma única vez, sem retentativa. Um borderô que ficou vazio é removido por quem o criou e recusado na aprovação.',
            arquivos: [
                'src/backend/domain/service/permutas/BorderoGestaoService.ts',
                'src/frontend/app/permutas/borderos/page.tsx',
            ],
            programasErp: ['fin010'],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Borderô em período contábil fechado não finaliza, e não há correção de código para isso: é uma ação da contabilidade.',
                    origem: 'ADR-0030',
                },
            ],
            docRefs: [
                'ontology/state-machines/status-permuta-bordero.md',
                'ADR-0030 — borderô órfão e aprovação vazia',
            ],
        },
    },

    // ─────────────────────────── Frente II — SISPAG ────────────────────────────
    {
        id: 'macro-sispag-ingestao',
        position: { x: COL(0), y: RAIA_SISPAG },
        data: {
            label: 'Ingestão da carteira',
            subtitle: 'Job diário · 07h BRT',
            frente: 'sispag',
            camada: 'job',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Traz a carteira de títulos a pagar do ERP e persiste localmente, com upsert diário; o detalhe continua sendo lido ao vivo do ERP. Títulos internacionais ficam de fora já na ingestão: pagamento internacional é câmbio manual da tesouraria e saiu do escopo. Se a execução falhar, o próprio workflow registra o alerta.',
            arquivos: [
                'src/backend/jobs/ingest-pagamentos.ts',
                'src/backend/domain/service/sispag/IngestaoPagamentosService.ts',
                '.github/workflows/ingest-sispag.yml',
            ],
            programasErp: ['fin064', 'com308', 'com298'],
            docRefs: [
                'ADR-0016 — persistir a carteira',
                'ADR-0021 — internacional fora do escopo',
            ],
        },
    },
    {
        id: 'macro-sispag-lote',
        position: { x: COL(1), y: RAIA_SISPAG },
        data: {
            label: 'Formação de lotes',
            subtitle: 'Automática · por filial',
            frente: 'sispag',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Logo depois da ingestão, agrupa os títulos a vencer em até 7 dias que ainda não estão em lote — um lote por filial. A conta pagadora sugerida é o Itaú, e o analista pode trocar. Um lote automático que passa a conter título vencido é descartado e refeito.',
            arquivos: [
                'src/backend/jobs/formar-lotes.ts',
                'src/backend/domain/service/sispag/FormacaoLotesService.ts',
            ],
            docRefs: ['ADR-0018 — formação automática de lotes'],
        },
    },
    {
        id: 'macro-sispag-dda',
        position: { x: COL(2) + 20, y: RAIA_SISPAG - 200 },
        data: {
            label: 'Boletos via DDA',
            subtitle: 'Código de barras do ERP',
            frente: 'sispag',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'O código de barras do boleto não é digitado nem extraído de PDF: vem da associação DDA que o próprio ERP faz. Ao importar o título no lote nativo, o ERP anexa o código e define a modalidade. Boleto sem associação DDA é bloqueado antes de ir para a remessa. Uma aba dedicada mostra os boletos DDA recebidos.',
            arquivos: [
                'src/backend/domain/service/sispag/BoletoDdaService.ts',
                'src/backend/domain/client/ConexosDdaClient.ts',
                'src/frontend/app/sispag/components/BoletosDdaTab.tsx',
            ],
            programasErp: ['fin124', 'fin015'],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'A sincronização dos boletos DDA não tem agendamento: roda pelo botão da aba ou à mão. A aba pode mostrar uma fotografia antiga.',
                    origem: 'src/backend/jobs/ingest-boletos-dda.ts',
                },
            ],
            docRefs: ['ADR-0040 — boleto vem da associação DDA do ERP'],
        },
    },
    {
        id: 'macro-sispag-revisao',
        position: { x: COL(2), y: RAIA_SISPAG },
        data: {
            label: 'Revisão do lote',
            subtitle: 'Rascunho · analista ajusta',
            frente: 'sispag',
            camada: 'humano',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Enquanto o lote está em rascunho, o analista inclui e retira títulos, escolhe a forma de pagamento de cada item e a conta pagadora. Um título também pode ser retirado do lote direto da aba de títulos; retirar de um lote automático o torna manual. Concorrência entre analistas é resolvida por número de versão: quem salva por cima recebe conflito.',
            arquivos: [
                'src/backend/domain/service/sispag/LotePagamentoService.ts',
                'src/backend/domain/service/sispag/SispagPainelService.ts',
                'src/frontend/app/sispag/page.tsx',
            ],
            docRefs: [
                'ontology/state-machines/lote-pagamento.md',
                'ADR-0050 — retirar título do lote',
            ],
        },
    },
    {
        id: 'macro-sispag-duplo-pagamento',
        position: { x: COL(1) + 30, y: RAIA_SISPAG + 190 },
        data: {
            label: 'Título único por lote',
            subtitle: 'Garantia no serviço, não no banco',
            frente: 'sispag',
            camada: 'infra',
            maturidade: 'parcial',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Um título a pagar não pode estar em dois lotes ao mesmo tempo — se estivesse, e ambos gerassem remessa, a mesma conta seria paga duas vezes. A garantia existe e funciona, mas mora na camada de serviço (transação + trava cooperativa). O banco impede apenas a repetição dentro de um mesmo lote.\n\nA escolha está documentada na migração: o status vive no lote e o título vive no item, então uma restrição entre lotes exigiria copiar o status para o item. A chave de idempotência da remessa impede duas remessas do mesmo lote, mas não o mesmo título em dois lotes.',
            arquivos: [
                'src/backend/migrations/0023_lote_pagamento.sql',
                'src/backend/domain/service/sispag/LotePagamentoService.ts',
            ],
            riscos: [
                {
                    nivel: 'alto',
                    texto:
                        'Com a remessa real ligada, o risco deixou de ser tela inconsistente: um script de correção com SQL direto ou um job que insira itens fora do serviço poderia colocar o mesmo título em dois lotes, e nada no banco barraria.',
                    origem: 'Regis-Review — fault-tolerance-6',
                },
            ],
            docRefs: ['docs/regis-review/2026-08-25-1742-sispag-retomada'],
        },
    },
    {
        id: 'macro-sispag-gate',
        position: { x: COL(3), y: RAIA_SISPAG },
        data: {
            label: 'Finalizar e datar',
            subtitle: 'Gate do analista · data de débito',
            frente: 'sispag',
            camada: 'humano',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Nenhum lote segue sem que uma pessoa o finalize: exige pelo menos um item e forma de pagamento em todos. Na hora de gerar a remessa, o analista escolhe a data de débito — hoje por padrão, com atalho para o próximo dia útil — dentro de uma janela limitada pelo título que vence primeiro; a tela diz qual é. A data é validada antes de qualquer escrita no ERP.',
            arquivos: [
                'src/backend/domain/service/sispag/LotePagamentoService.ts',
                'src/backend/domain/service/sispag/DebitDateService.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto: 'Feriados locais não entram no cálculo do próximo dia útil.',
                    origem: 'ontology/_inbox/sispag-data-pagamento-gap.md',
                },
            ],
            docRefs: [
                'ADR-0049 — data de débito escolhível',
                'ontology/business-rules/data-debito-remessa-sispag.md',
            ],
        },
    },
    {
        id: 'macro-sispag-remessa',
        position: { x: COL(4), y: RAIA_SISPAG },
        data: {
            label: 'Geração da remessa',
            subtitle: 'CNAB 240 · motor nativo do ERP',
            frente: 'sispag',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'A plataforma não gera CNAB: orquestra o motor que o ERP já tem. Cria o lote nativo, importa os títulos, finaliza e pede a remessa, guardando as chaves e o nome do arquivo. Cada geração é registrada antes da primeira chamada, roda sob trava por lote e usa o lote como chave de idempotência — um lote nunca gera duas remessas. Se cair no meio, a retomada consulta o ERP para saber onde parou, em vez de exigir conserto manual. Fica gravado quem gerou, na plataforma e no ERP.',
            arquivos: [
                'src/backend/domain/service/sispag/RemessaService.ts',
                'src/backend/domain/client/ConexosSispagWriteClient.ts',
                'src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts',
            ],
            programasErp: ['fin015'],
            docRefs: [
                'ADR-0039 — retomada consultando o ERP',
                'ADR-0041 — execução registra a identidade Conexos',
                'ontology/business-rules/retomada-remessa-sispag.md',
            ],
        },
    },
    {
        id: 'macro-sispag-reaper',
        position: { x: COL(4) + 30, y: RAIA_SISPAG + 190 },
        data: {
            label: 'Vigia de execuções presas',
            subtitle: 'Job · a cada 15 min',
            frente: 'sispag',
            camada: 'job',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Procura gerações de remessa e conciliações que ficaram paradas no meio — um lote nativo órfão, uma baixa incerta — e emite um alerta estruturado. Só avisa, não age: a correção passa pela retomada, disparada por uma pessoa.',
            arquivos: [
                'src/backend/jobs/reaper-sispag-reconciling.ts',
                '.github/workflows/reaper-sispag.yml',
            ],
        },
    },
    {
        id: 'macro-sispag-transporte',
        position: { x: COL(5), y: RAIA_SISPAG },
        data: {
            label: 'Transporte ao banco',
            subtitle: 'Manual · fora do sistema',
            frente: 'sispag',
            camada: 'humano',
            maturidade: 'inexistente',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'O arquivo .REM é baixado pela tela, byte a byte, e uma pessoa da Columbia o leva à VAN (Nexxera). Remessas geradas pela plataforma já foram aceitas pelo banco (21–25/09, confirmado pela Columbia em 28/09). O que não existe é a automação deste passo: não há cliente da VAN no código, e por isso o estado do lote se chama "remessa gerada", não "enviada" — o sistema não observa o envio.',
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'O arquivo carrega dados bancários e passa por mãos e pastas fora do controle da plataforma. O download exige permissão de execução do SISPAG.',
                    origem: 'ontology/_inbox/sispag-native-vs-nexxera.md',
                },
            ],
            docRefs: ['ontology/state-machines/lote-pagamento.md'],
        },
    },
    {
        id: 'macro-sispag-retorno',
        position: { x: COL(6), y: RAIA_SISPAG },
        data: {
            label: 'Retorno e conciliação',
            subtitle: 'fin052 → lote baixado',
            frente: 'sispag',
            camada: 'servico',
            maturidade: 'parcial',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Lê o arquivo de retorno que o ERP ingeriu, confere os eventos bancários e as baixas, e só marca o lote como BAIXADO quando todo item tem baixa e nada foi rejeitado; senão o lote fica RETORNADO e a conciliação pode ser refeita. É idempotente por arquivo de retorno. O código está pronto e provado em homologação; na operação de hoje, o retorno ainda é tratado pela Columbia no próprio ERP.',
            arquivos: [
                'src/backend/domain/service/sispag/ConciliacaoRetornoService.ts',
                'src/backend/domain/client/ConexosSispagRetornoClient.ts',
            ],
            programasErp: ['fin052', 'fin050', 'fin010'],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'O botão antigo "Simular retorno" continua exposto: leva o lote a RETORNADO sem arquivo nem baixa, um beco sem saída na máquina de estados.',
                    origem: 'ontology/state-machines/lote-pagamento.md',
                },
            ],
            docRefs: ['ontology/_inbox/sispag-fin052-retorno-provado-hml.md'],
        },
    },

    // ──────────────────── Frente IV — Conciliação de Recebimentos ──────────────
    {
        id: 'macro-receb-extrato',
        position: { x: COL(0), y: RAIA_RECEBIMENTOS },
        data: {
            label: 'Ingestão do extrato',
            subtitle: 'Job · toda hora',
            frente: 'recebimentos',
            camada: 'job',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Lê do ERP os lançamentos de crédito das contas bancárias, normaliza e deduplica por chave natural. O extrato vem do Conexos, não direto da VAN. Roda de hora em hora com retentativa, nunca lê antes de 03/08 (go-live) e também aceita upload de planilha como alternativa manual.',
            arquivos: [
                'src/backend/jobs/ingest-extratos.ts',
                'src/backend/domain/service/recebimentos/IngestaoTransacoesService.ts',
                'src/backend/domain/client/ConexosExtratoClient.ts',
                '.github/workflows/ingest-extratos.yml',
            ],
            programasErp: ['fin133', 'fin095', 'fin134'],
            docRefs: [
                'ADR-0023 — extrato via Conexos fin095',
                'ADR-0028 — piso da ingestão e cron horário',
                'ADR-0032 — conta corporativa sem filial',
            ],
        },
    },
    {
        id: 'macro-receb-painel',
        position: { x: COL(1), y: RAIA_RECEBIMENTOS },
        data: {
            label: 'Painel de recebimentos',
            subtitle: 'Créditos a conciliar',
            frente: 'recebimentos',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Lista os créditos recebidos e o estado de cada um (importada, parcial, processada, erro). Responde primeiro do banco e só depois enriquece com dados do ERP, para a tela não esperar o Conexos. Créditos que não são da operação podem ser arquivados.',
            arquivos: [
                'src/backend/domain/service/recebimentos/RecebimentosPainelService.ts',
                'src/frontend/app/recebimentos/page.tsx',
            ],
            docRefs: [
                'ADR-0038 — painel responde do banco e enriquece depois',
                'ADR-0033 — arquivamento',
            ],
        },
    },
    {
        id: 'macro-receb-alocacao',
        position: { x: COL(2), y: RAIA_RECEBIMENTOS },
        data: {
            label: 'Alocação pelo analista',
            subtitle: 'Crédito → processo / SN',
            frente: 'recebimentos',
            camada: 'humano',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'O analista escolhe a qual processo do cliente o crédito pertence e quanto vai para cada um — ou aloca contra uma Solicitação de Numerário que já existe. O teto é o saldo do título. Hoje toda alocação é manual.',
            arquivos: [
                'src/backend/domain/service/recebimentos/ProcessoProviderConexos.ts',
                'src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts',
            ],
            programasErp: ['imp021', 'com299'],
            docRefs: ['ADR-0027 — alocar contra SN existente'],
        },
    },
    {
        id: 'macro-receb-automacao',
        position: { x: COL(2) + 30, y: RAIA_RECEBIMENTOS + 190 },
        data: {
            label: 'Casamento, rateio e regras',
            subtitle: 'Automáticos · ainda stub',
            frente: 'recebimentos',
            camada: 'servico',
            maturidade: 'planejado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'O desenho da frente prevê sugerir o casamento crédito ↔ recebível, ratear entre processos e aplicar regras por cliente automaticamente. As portas existem no código, ligadas a implementações de mentira; o trabalho hoje é feito pelo analista na alocação.',
            arquivos: [
                'src/backend/domain/recebimentosContainer.ts',
                'src/backend/domain/service/recebimentos/stubs/',
            ],
            docRefs: ['ontology/state-machines/recebimento.md'],
        },
    },
    {
        id: 'macro-receb-sn',
        position: { x: COL(3), y: RAIA_RECEBIMENTOS },
        data: {
            label: 'SN e baixa no ERP',
            subtitle: 'com299 → fin014 · em produção',
            frente: 'recebimentos',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Gera a Solicitação de Numerário no processo, ajusta a condição de pagamento quando necessário e baixa o recebimento no financeiro. Cada etapa é registrada num ledger antes de ser executada, então uma execução interrompida retoma de onde parou. Até 2026-09-14 foram 23 execuções reais, 12 concluídas, somando R$ 2,03 milhões.',
            arquivos: [
                'src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts',
                'src/backend/domain/service/recebimentos/SnPayloadBuilder.ts',
                'src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts',
                'src/backend/domain/client/ConexosFin014Client.ts',
            ],
            programasErp: ['com299', 'com194', 'fin014'],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Não há vigia para execuções de SN presas: elas retomam quando alguém tenta de novo, e a tela marca as interrompidas.',
                    origem: 'ontology/_inbox/frente-iv-fase1-followups.md',
                },
            ],
            docRefs: [
                'ADR-0025 — condição de pagamento, fail-closed',
                'ADR-0034 — gcd resolvido pelo histórico do processo',
                'ADR-0045 — a spine real é o ledger de SN',
            ],
        },
    },
    {
        id: 'macro-receb-nde',
        position: { x: COL(4), y: RAIA_RECEBIMENTOS },
        data: {
            label: 'Emissão da NDe',
            subtitle: 'com297 · só por encomenda',
            frente: 'recebimentos',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'Emite pelo ERP a Nota de Débito Eletrônica, com endereço tirado do CNPJ do processo e descrição do item no próprio documento, e pede a homologação. Só processos por encomenda geram NDe; conta e ordem de terceiros termina em "quitado sem NDe", e modalidade desconhecida é bloqueada.',
            arquivos: [
                'src/backend/domain/client/ConexosNdeClient.ts',
                'src/backend/domain/client/ConexosNdeFiscalClient.ts',
                'src/backend/domain/service/recebimentos/ContingenciaDecider.ts',
            ],
            programasErp: ['com297', 'com300', 'com131'],
            riscos: [
                {
                    nivel: 'alto',
                    texto:
                        'Há NDes já emitidas indevidamente em processos de conta e ordem, anteriores à regra. O diagnóstico está aberto.',
                    origem: 'ontology/_inbox/nde-indevidas-conta-e-ordem-diagnostico.md',
                },
            ],
            docRefs: [
                'ADR-0031 — NDe dispensada em conta e ordem',
                'ADR-0033 — NDe só por encomenda',
                'ADR-0035 — endereço pelo CNPJ do processo',
            ],
        },
    },
    {
        id: 'macro-receb-sefaz',
        position: { x: COL(5), y: RAIA_RECEBIMENTOS },
        data: {
            label: 'Reconciliação com a SEFAZ',
            subtitle: 'Job · toda hora',
            frente: 'recebimentos',
            camada: 'job',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'De hora em hora confere no ERP o estado das NDes que ainda aguardam a SEFAZ e fecha as execuções como concluídas. A aba de NDe lista também as notas emitidas fora da ferramenta, marcadas como origem ERP.',
            arquivos: [
                'src/backend/jobs/reconciliar-nde-sefaz.ts',
                '.github/workflows/reconciliar-nde.yml',
            ],
            programasErp: ['com297'],
            docRefs: [
                'ADR-0036 — homologação medida pelo estado gravado',
                'ADR-0037 — aba NDe lista pela execução',
            ],
        },
    },

    // ─────────────────────────────── Sistemas ──────────────────────────────────
    {
        id: 'macro-conexos',
        position: { x: COL(7) + 20, y: RAIA_SISPAG },
        data: {
            label: 'Conexos ERP',
            subtitle: 'Sistema de registro',
            frente: 'plataforma',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'macro',
            descricao:
                'O sistema de registro da Columbia e a fonte de verdade de tudo que o financeiro faz. As três frentes leem dele e escrevem nele em produção, sempre em pontos específicos e protegidos por ledger. Toda a arquitetura parte de uma premissa: o ERP é soberano, a automação orquestra.',
            programasErp: [
                'fin010 — borderô e baixa (permutas)',
                'fin014 — baixa de recebimento',
                'fin015 — lotes SISPAG e remessa',
                'fin052 / fin050 — retorno bancário',
                'fin064 — carteira a pagar',
                'fin095 / fin133 — extrato',
                'fin124 — boletos DDA',
                'com297 — NDe',
                'com298 / com308 — títulos e taxa',
                'com299 — Solicitação de Numerário',
                'imp019 / imp223 — D.I e DUIMP',
                'imp021 — processos e importadores',
            ],
        },
    },
]

export const MACRO_EDGES: ArqEdge[] = [
    // Permutas
    { id: 'me-p1', source: 'macro-permutas-eleicao', target: 'macro-permutas-gates', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-p2', source: 'macro-permutas-gates', target: 'macro-permutas-casamento', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-p3', source: 'macro-permutas-casamento', target: 'macro-permutas-variacao', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-p4', source: 'macro-permutas-variacao', target: 'macro-permutas-baixa', tipo: 'escrita', estado: 'ambos', vista: 'macro' },
    { id: 'me-p5', source: 'macro-permutas-analista', target: 'macro-permutas-casamento', label: 'casos N:M', tipo: 'humano', estado: 'ambos', vista: 'macro' },
    { id: 'me-p6', source: 'macro-permutas-excecao', target: 'macro-permutas-gates', label: 'já permutado', tipo: 'humano', estado: 'ambos', vista: 'macro' },
    { id: 'me-p7', source: 'macro-permutas-baixa', target: 'macro-permutas-bordero', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },

    // SISPAG
    { id: 'me-s1', source: 'macro-sispag-ingestao', target: 'macro-sispag-lote', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-s2', source: 'macro-sispag-lote', target: 'macro-sispag-revisao', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-s3', source: 'macro-sispag-revisao', target: 'macro-sispag-gate', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-s4', source: 'macro-sispag-gate', target: 'macro-sispag-remessa', tipo: 'escrita', estado: 'ambos', vista: 'macro' },
    { id: 'me-s5', source: 'macro-sispag-remessa', target: 'macro-sispag-transporte', label: 'manual', tipo: 'gap', estado: 'ambos', vista: 'macro', destaque: true },
    { id: 'me-s6', source: 'macro-sispag-transporte', target: 'macro-sispag-retorno', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-s7', source: 'macro-sispag-lote', target: 'macro-sispag-duplo-pagamento', label: 'invariante', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-s8', source: 'macro-sispag-dda', target: 'macro-sispag-revisao', label: 'boletos', tipo: 'leitura', estado: 'ambos', vista: 'macro' },
    { id: 'me-s9', source: 'macro-sispag-reaper', target: 'macro-sispag-remessa', label: '15 min', tipo: 'agendamento', estado: 'ambos', vista: 'macro' },

    // Recebimentos
    { id: 'me-r1', source: 'macro-receb-extrato', target: 'macro-receb-painel', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-r2', source: 'macro-receb-painel', target: 'macro-receb-alocacao', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-r3', source: 'macro-receb-alocacao', target: 'macro-receb-sn', tipo: 'escrita', estado: 'ambos', vista: 'macro' },
    { id: 'me-r4', source: 'macro-receb-sn', target: 'macro-receb-nde', tipo: 'escrita', estado: 'ambos', vista: 'macro' },
    { id: 'me-r5', source: 'macro-receb-nde', target: 'macro-receb-sefaz', tipo: 'fluxo', estado: 'ambos', vista: 'macro' },
    { id: 'me-r6', source: 'macro-receb-automacao', target: 'macro-receb-alocacao', label: 'sugestão', tipo: 'gap', estado: 'ambos', vista: 'macro' },

    // ERP
    { id: 'me-c1', source: 'macro-permutas-bordero', target: 'macro-conexos', label: 'fin010', tipo: 'escrita', estado: 'ambos', vista: 'macro' },
    { id: 'me-c2', source: 'macro-conexos', target: 'macro-sispag-retorno', label: 'fin052', tipo: 'leitura', estado: 'ambos', vista: 'macro' },
    { id: 'me-c3', source: 'macro-conexos', target: 'macro-receb-sefaz', label: 'com297', tipo: 'leitura', estado: 'ambos', vista: 'macro' },
]
