import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import GuardaHmlE2e, {
    avaliarCaminhoV7,
    avaliarProvaV7Bloqueada,
    escolherOcorrenciaRejeicao,
    FASES_E2E,
    FASES_QUE_ESCREVEM,
} from './hmlE2eGuarda.js';

/**
 * Prova HML ponta a ponta do boleto agrupado (ADR-0077, Task 21). O job ESCREVE em HML (lote
 * nativo, borderô, baixas, retorno sintético) e roda o código de PRODUÇÃO (`GrupoBoletoService` +
 * `RemessaService`); por isso a recusa é verificada aqui, sem tocar em rede nenhuma:
 *
 *  - só HML (URL com `-hml` e `HML_ENV_FILE`), nunca a produção do cliente;
 *  - o Postgres é um banco LOCAL descartável (o serviço de produção grava nele), nunca o de
 *    produção; vazio também é recusado (sem banco o serviço não roda);
 *  - fase que ESCREVE exige a autorização explícita da pessoa responsável, datada de HOJE:
 *    `HML_AUTORIZO_ESCRITA=<AAAA-MM-DD>` — autorização de ontem não vale;
 *  - o job chama os serviços, nunca as escritas do Conexos por conta própria.
 */

const HOJE = '2026-10-26';
const OK = {
    conexosBaseUrl: 'https://columbiatrading-hml.conexos.cloud/api',
    hmlEnvFile: '/home/inteli/.claude-tech/hml-conexos.env',
    databaseConnectionString: 'postgres://postgres:test@localhost:55432/sispag_agrupado_e2e',
    fase: 'plano',
    hoje: HOJE,
};
const avaliar = (over: Record<string, unknown> = {}) =>
    GuardaHmlE2e.avaliar({ ...OK, ...over } as Parameters<typeof GuardaHmlE2e.avaliar>[0]);

describe('GuardaHmlE2e — recusas', () => {
    it('HML + banco local + fase de leitura: permitido, sem motivos', () => {
        expect(avaliar()).toEqual({ permitido: true, motivos: [] });
    });

    it.each([
        ['produção do cliente', 'https://columbiatrading.conexos.cloud/api'],
        ['URL ausente', undefined],
        ['URL qualquer', 'http://localhost:3001'],
        ['HML só no caminho', 'https://columbiatrading.conexos.cloud/api/-hml'],
    ])('recusa URL do Conexos que não é HML (%s)', (_n, url) => {
        const r = avaliar({ conexosBaseUrl: url });
        expect(r.permitido).toBe(false);
        expect(r.motivos.join(' ')).toMatch(/HML/);
    });

    it('recusa sem HML_ENV_FILE (a credencial de HML vem de arquivo privado)', () => {
        const r = avaliar({ hmlEnvFile: undefined });
        expect(r.permitido).toBe(false);
        expect(r.motivos.join(' ')).toMatch(/HML_ENV_FILE/);
    });

    it.each([
        ['produção (Supabase)', 'postgres://u:p@db.abc.supabase.co:5432/postgres'],
        ['host remoto qualquer', 'postgres://u:p@10.0.0.5:5432/sispag'],
        ['vazio (o serviço de produção precisa de banco)', ''],
        ['ausente', undefined],
        ['host local só no usuário', 'postgres://localhost:x@db.example.com/sispag'],
    ])('recusa banco que não é local e descartável (%s)', (_n, dsn) => {
        const r = avaliar({ databaseConnectionString: dsn });
        expect(r.permitido).toBe(false);
        expect(r.motivos.join(' ')).toMatch(/Postgres|banco/i);
    });

    it.each([
        'postgres://postgres:test@localhost:55432/x',
        'postgres://postgres:test@127.0.0.1:5432/x',
        'postgres://postgres:test@[::1]:5432/x',
    ])('aceita banco local: %s', (dsn) => {
        expect(avaliar({ databaseConnectionString: dsn }).permitido).toBe(true);
    });

    it('recusa fase desconhecida', () => {
        const r = avaliar({ fase: 'apagar-tudo' });
        expect(r.permitido).toBe(false);
        expect(r.motivos.join(' ')).toMatch(/fase/i);
    });

    it('acumula todos os motivos de uma vez (o operador conserta tudo numa rodada)', () => {
        const r = avaliar({
            conexosBaseUrl: 'https://columbiatrading.conexos.cloud/api',
            hmlEnvFile: undefined,
            databaseConnectionString: '',
        });
        expect(r.motivos.length).toBeGreaterThanOrEqual(3);
    });
});

describe('GuardaHmlE2e — autorização de escrita', () => {
    it('as fases são as da prova, na ordem, e só plano e estado não escrevem', () => {
        expect(FASES_E2E).toEqual([
            'plano',
            'canonico',
            'falha',
            'retomada',
            'retomada-varredura',
            'v7',
            'estado',
        ]);
        expect(FASES_QUE_ESCREVEM).toEqual([
            'canonico',
            'falha',
            'retomada',
            'retomada-varredura',
            'v7',
        ]);
    });

    it.each(FASES_QUE_ESCREVEM)('fase %s sem autorização é recusada', (fase) => {
        const r = avaliar({ fase });
        expect(r.permitido).toBe(false);
        expect(r.motivos.join(' ')).toMatch(/HML_AUTORIZO_ESCRITA/);
    });

    it.each(FASES_QUE_ESCREVEM)('fase %s com a autorização de HOJE passa', (fase) => {
        expect(avaliar({ fase, autorizaEscrita: HOJE }).permitido).toBe(true);
    });

    it.each([
        ['de ontem', '2026-10-25'],
        ['"sim" não vale (a autorização é datada)', 'sim'],
        ['vazia', ''],
    ])('autorização %s é recusada', (_n, valor) => {
        const r = avaliar({ fase: 'canonico', autorizaEscrita: valor });
        expect(r.permitido).toBe(false);
    });

    it('plano e estado nunca pedem autorização (só leitura)', () => {
        expect(avaliar({ fase: 'plano' }).permitido).toBe(true);
        expect(avaliar({ fase: 'estado' }).permitido).toBe(true);
    });
});

describe('o job (fonte)', () => {
    const CAMINHO = path.join(__dirname, 'probe-hml-boleto-agrupado-e2e.ts');
    const FONTE = existsSync(CAMINHO) ? readFileSync(CAMINHO, 'utf8') : '';
    /** Sem comentários: o cabeçalho pode nomear o que o job NÃO faz. */
    const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
        .join('\n');

    it('existe', () => {
        expect(existsSync(CAMINHO)).toBe(true);
    });

    it('roda o código de PRODUÇÃO: GrupoBoletoService e RemessaService.gerarRemessa', () => {
        expect(CODIGO).toContain('GrupoBoletoService');
        expect(CODIGO).toContain('RemessaService');
        expect(CODIGO).toMatch(/\.gerarRemessa\(/);
        expect(CODIGO).toMatch(/\.confirmar\(/);
    });

    it.each([
        'criarBorderoDoGrupo',
        'gravarBaixaSimples',
        'importarBorderoPendente',
        'excluirBaixa',
        'excluirBordero',
        'editarItemDoRascunho',
        'confirmarCodigoBarras',
        'validarCodigoBarras',
        'importarTitulos',
        'removerItemDoRascunho',
        'finalizarBordero',
        'cancelarBordero',
    ])('o job não faz a escrita `%s` por conta própria (quem escreve é o serviço)', (nome) => {
        expect(CODIGO).not.toContain(nome);
    });

    it('não usa o client de escrita do fin015: lote, import e finalização são do serviço', () => {
        expect(CODIGO).not.toContain('ConexosSispagWriteClient');
    });

    it('a única escrita direta é o RETORNO SINTÉTICO (o banco simulado): carregar e processar o .RET', () => {
        expect(CODIGO).toMatch(/carregarArquivoRetorno/);
        expect(CODIGO).toMatch(/processarArquivoRetorno/);
    });

    it('recusa pela guarda ANTES de qualquer outra coisa e sai com código 1', () => {
        expect(CODIGO).toMatch(/GuardaHmlE2e\.avaliar\(/);
        expect(CODIGO).toMatch(/RECUSADO/);
        expect(CODIGO).toMatch(/process\.exit\(1\)/);
        const i = CODIGO.indexOf('GuardaHmlE2e.avaliar(');
        expect(i).toBeGreaterThan(-1);
        expect(CODIGO.indexOf('bootstrapAppContainer(')).toBeGreaterThan(i);
    });

    it('só barras SINTÉTICAS e só a máscara 5+4 no console e na trilha', () => {
        expect(CODIGO).toContain('CodigoBarrasSintetico');
        expect(CODIGO).toMatch(/mascarar|…/);
        expect(CODIGO).not.toMatch(/console\.\w+\([^)]*(codbar|linhaDigitavel)(?!Mascarad)/);
    });

    it('registra a trilha e documenta o estado que deixa em HML', () => {
        expect(CODIGO).toContain('trilha.jsonl');
        expect(FONTE).toMatch(/Estado deixado em HML/i);
        expect(FONTE).toMatch(/HML_AUTORIZO_ESCRITA/);
    });

    it('cobre as quatro provas: canônico, falha determinística (V3), retomada e V7', () => {
        for (const fase of ['canonico', 'falha', 'retomada', 'v7']) {
            expect(CODIGO).toContain(`'${fase}'`);
        }
        expect(FONTE).toMatch(/V3/);
        expect(FONTE).toMatch(/V7/);
        expect(FONTE).toMatch(/BORDERO_ANTERIOR_NAO_RESOLVIDO/);
    });

    it('confere "nunca dois borderôs vivos" no fin010/list', () => {
        expect(CODIGO).toMatch(/buscarBorderoPorIdentidade|buscarBorderosNaJanela|listBorderos/);
    });

    it('nunca importa credencial de produção: usa `hmlEnvFile` antes de tudo', () => {
        const iEnv = CODIGO.indexOf("'./hmlEnvFile.js'");
        const iContainer = CODIGO.indexOf('appContainer');
        expect(iEnv).toBeGreaterThan(-1);
        expect(iEnv).toBeLessThan(iContainer);
    });
});

describe('escolherOcorrenciaRejeicao (V7)', () => {
    const EVENTOS = [
        { cod: '00', descricao: 'PAGAMENTO EFETUADO', tipo: 2, tipoRetorno: 1 },
        { cod: 'AE', descricao: 'DATA DE PAGAMENTO ALTERADA', tipo: 2, tipoRetorno: 0 },
        { cod: 'NA', descricao: 'PAGAMENTO CANCELADO', tipo: 2, tipoRetorno: 2 },
        { cod: 'XX', descricao: 'TIPO 1', tipo: 1, tipoRetorno: 2 },
    ];

    it('sem pedido, escolhe uma rejeição (tipo 2, tpret 2)', () => {
        expect(escolherOcorrenciaRejeicao(EVENTOS)).toEqual({
            ok: true,
            cod: 'NA',
            descricao: 'PAGAMENTO CANCELADO',
        });
    });

    it('recusa o pedido `AE` (informativo): não é rejeição', () => {
        const r = escolherOcorrenciaRejeicao(EVENTOS, 'AE');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.motivo).toMatch(/não é rejeição/);
    });

    it('aceita o pedido que o ERP marca como rejeição e recusa código inexistente', () => {
        expect(escolherOcorrenciaRejeicao(EVENTOS, 'NA').ok).toBe(true);
        expect(escolherOcorrenciaRejeicao(EVENTOS, 'ZZ').ok).toBe(false);
    });

    it('sem nenhuma rejeição na tabela, recusa', () => {
        expect(escolherOcorrenciaRejeicao(EVENTOS.slice(0, 2)).ok).toBe(false);
    });
});

describe('avaliarCaminhoV7 (a 2ª remessa não pode passar por erro)', () => {
    it('erro na 2ª remessa NÃO é prova, mesmo sem caminho', () => {
        expect(avaliarCaminhoV7({ reaproveitou: false, retirou: false, status: 'erro' }).ok).toBe(
            false,
        );
    });
    it('caminho indefinido falha', () => {
        const r = avaliarCaminhoV7({ reaproveitou: false, retirou: false, status: 'gerada' });
        expect(r).toEqual({ ok: false, caminho: 'indefinido' });
    });
    it('reaproveitado ou retirado, sem erro, passa', () => {
        expect(avaliarCaminhoV7({ reaproveitou: true, retirou: false, status: 'gerada' }).ok).toBe(
            true,
        );
        expect(
            avaliarCaminhoV7({ reaproveitou: false, retirou: true, status: 'gerada' }).caminho,
        ).toBe('RETIRADO');
    });
});

describe('avaliarProvaV7Bloqueada — evidência observada', () => {
    const evidence = {
        status: 'gerada',
        motivo: 'BORDERO_ANTERIOR_NAO_RESOLVIDO',
        freshGuardWithdrawal: true,
        oldContext: 'presente' as const,
        oldItemBefore: 'item-1',
        oldItemAfter: 'item-1',
        oldBorderoBefore: 'bordero-1',
        oldBorderoAfter: 'bordero-1',
        oldBaixasBefore: 'baixas-1',
        oldBaixasAfter: 'baixas-1',
        remainingGroupItems: 0,
        newNativeGroupItems: 0,
        rejectionAlertIds: ['rejeicao'],
        newAlerts: [
            {
                id: 'guarda',
                alvo: '2:grupo:G',
                acao: 'confira o borderô',
                situacao:
                    'borderô antigo 9, lote nativo 7: o item 1 ainda está vinculado ao lote anterior',
            },
        ],
        rejectionTarget: 'G',
        expectedGuardTarget: '2:grupo:G',
        expectedGuardContext: ['borderô antigo 9', 'lote nativo 7', 'ainda está vinculado'],
        groupSignature: 'sha-group',
        controlSignature: 'sha-control',
        controlCents: 5000,
        js: [
            {
                mascara: '42200…2000',
                signature: 'sha-control',
                barraCentavos: 5000,
                pagCentavos: 5000,
            },
        ],
    };
    it('aceita retirada com contexto preservado e somente o controle na remessa', () => {
        expect(avaliarProvaV7Bloqueada(evidence)).toEqual({ ok: true, falhas: [] });
    });
    it.each(['ausente', 'ambiguo'] as const)('recusa contexto antigo %s', (oldContext) => {
        expect(avaliarProvaV7Bloqueada({ ...evidence, oldContext }).ok).toBe(false);
    });
    it.each([
        'oldItemBefore',
        'oldItemAfter',
        'oldBorderoAfter',
        'oldBaixasAfter',
    ] as const)('recusa perda ou alteração de %s', (field) => {
        expect(avaliarProvaV7Bloqueada({ ...evidence, [field]: '' }).ok).toBe(false);
    });
    it('recusa mutação do código no J mesmo mantendo a máscara e os valores', () => {
        expect(
            avaliarProvaV7Bloqueada({
                ...evidence,
                js: [{ ...evidence.js[0], signature: 'sha-other-code-same-mask' }],
            }).ok,
        ).toBe(false);
    });
    it('recusa mutação do snapshot antigo mesmo quando ainda presente', () => {
        expect(
            avaliarProvaV7Bloqueada({ ...evidence, oldItemAfter: 'sha-mutated-middle-digits' }).ok,
        ).toBe(false);
    });
    it('recusa membros restantes ou import nativo do grupo', () => {
        expect(avaliarProvaV7Bloqueada({ ...evidence, remainingGroupItems: 1 }).ok).toBe(false);
        expect(avaliarProvaV7Bloqueada({ ...evidence, newNativeGroupItems: 1 }).ok).toBe(false);
    });
    it('recusa remessa sem controle correto ou contendo o grupo', () => {
        for (const js of [
            [],
            [{ ...evidence.js[0], pagCentavos: 4999 }],
            [...evidence.js, { ...evidence.js[0], signature: evidence.groupSignature }],
        ]) {
            expect(avaliarProvaV7Bloqueada({ ...evidence, js }).ok).toBe(false);
        }
    });
    it('exige alerta novo, acionável, com alvo distinto da rejeição', () => {
        for (const newAlerts of [
            [],
            [{ ...evidence.newAlerts[0], id: 'rejeicao' }],
            [{ ...evidence.newAlerts[0], alvo: 'G' }],
            [{ ...evidence.newAlerts[0], acao: '' }],
        ]) {
            expect(avaliarProvaV7Bloqueada({ ...evidence, newAlerts }).ok).toBe(false);
        }
    });
    it('recusa alerta sem evidência do vínculo antigo', () => {
        expect(
            avaliarProvaV7Bloqueada({
                ...evidence,
                newAlerts: [{ ...evidence.newAlerts[0], situacao: 'outro problema' }],
            }).ok,
        ).toBe(false);
    });
    it('ledger com import ou adoção não prova retirada antes do import', () => {
        expect(avaliarProvaV7Bloqueada({ ...evidence, freshGuardWithdrawal: false }).ok).toBe(
            false,
        );
    });
    it('erro ou retirada sem motivo correto não prova a guarda', () => {
        expect(avaliarProvaV7Bloqueada({ ...evidence, status: 'erro' }).ok).toBe(false);
        expect(avaliarProvaV7Bloqueada({ ...evidence, motivo: '' }).ok).toBe(false);
    });
});
