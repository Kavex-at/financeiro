import 'reflect-metadata';
import { FONTES_ATIVIDADE } from '../../interface/perfil/AtividadeUsuarioInterface.js';
import AtividadeUsuarioRepository from './AtividadeUsuarioRepository.js';

const USERNAME = 'ana.souza';
const consultaBase = {
    userId: 7,
    username: USERNAME,
    inicio: '2026-09-01T03:00:00.000Z',
    fim: '2026-10-01T03:00:00.000Z',
    limit: 26,
};

const linha = (over: Record<string, unknown> = {}) => ({
    em: '2026-09-30T14:02:03.123456Z',
    frente: 'permutas',
    acao: 'baixa_permuta',
    alvo_tipo: 'adiantamento',
    alvo_id: '12345',
    valor: '1500.25',
    status_bruto: 'settled',
    fonte: 'permuta_execucao',
    fonte_id: '99',
    detalhe: { filCod: 1, conexosUsername: 'ANA_SOUZA' },
    ...over,
});

/** Os ramos do UNION ALL do histórico, cada um do seu `FROM` até o próximo `UNION ALL`. */
const ramos = (sql: string): string[] =>
    sql
        .split(/\bUNION ALL\b/)
        .map((s) => s.trim())
        .filter(Boolean);

describe('AtividadeUsuarioRepository.historico', () => {
    it('SQL 100% parametrizado: nenhum valor da consulta aparece no texto', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };
        await new AtividadeUsuarioRepository(db as never).historico({
            ...consultaBase,
            frente: 'sispag',
            tipo: 'remessa_gerada',
            status: 'erro',
            cursor: { em: '2026-09-20T10:00:00.000001Z', fonte: 'remessa', fonteId: '5' },
        });
        const [sql, params] = db.selectMany.mock.calls[0];
        expect(sql).not.toContain(USERNAME);
        expect(sql).not.toContain('2026-');
        expect(sql).not.toMatch(/'sispag'\s*\)/);
        expect(params).toMatchObject({
            username: USERNAME,
            userId: 7,
            inicio: consultaBase.inicio,
            fim: consultaBase.fim,
            frente: 'sispag',
            tipo: 'remessa_gerada',
            cursorEm: '2026-09-20T10:00:00.000001Z',
            cursorFonte: 'remessa',
            cursorId: '5',
            limit: 26,
        });
        // O filtro de status chega como pares fonte:bruto derivados da tabela única.
        expect(params.statusChaves).toEqual(
            expect.arrayContaining([
                'remessa:error',
                'conciliacao:error',
                'permuta_execucao:error',
            ]),
        );
        expect(params.statusChaves).not.toContain('remessa:settled');
    });

    it('o filtro de ator e a janela de tempo estão DENTRO de cada ramo do UNION ALL', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };
        await new AtividadeUsuarioRepository(db as never).historico(consultaBase);
        const [sql] = db.selectMany.mock.calls[0];
        const partes = ramos(sql);
        expect(partes).toHaveLength(FONTES_ATIVIDADE.length);
        for (const parte of partes) {
            expect(parte).toMatch(/= \$username/);
            expect(parte).toMatch(/>= \$inicio::timestamptz/);
            expect(parte).toMatch(/< \$fim::timestamptz/);
        }
        // Cada fonte aparece em exatamente um ramo.
        for (const fonte of FONTES_ATIVIDADE) {
            expect(partes.filter((p) => p.includes(`'${fonte}'::text`))).toHaveLength(1);
        }
    });

    it('dry_run = false nos ledgers que têm a coluna; evento de acesso casa ator OU alvo', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };
        await new AtividadeUsuarioRepository(db as never).historico(consultaBase);
        const [sql] = db.selectMany.mock.calls[0];
        const partes = ramos(sql);
        for (const tabela of [
            'permuta_alocacao_execucao',
            'remessa_execucao',
            'conciliacao_execucao',
            'solicitacao_numerario_execucao',
        ]) {
            const parte = partes.find((p) => new RegExp(`FROM ${tabela}\\b`).test(p));
            expect(parte).toBeDefined();
            expect(parte).toMatch(/dry_run = false/);
        }
        const acesso = partes.find((p) => p.includes('app_user_access_event'));
        expect(acesso).toMatch(/ator = \$username OR \w+\.alvo_user_id = \$userId/);
        // Do outro lado vem só o username.
        expect(acesso).toMatch(/JOIN app_user \w+ ON/);
    });

    it('datação: COALESCE(encerrado_em, criado_em) nas execuções; atualizado_em na conciliação', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };
        await new AtividadeUsuarioRepository(db as never).historico(consultaBase);
        const partes = ramos(db.selectMany.mock.calls[0][0]);
        for (const tabela of [
            'permuta_alocacao_execucao',
            'remessa_execucao',
            'solicitacao_numerario_execucao',
        ]) {
            const parte = partes.find((p) => new RegExp(`FROM ${tabela}\\b`).test(p));
            expect(parte).toMatch(/COALESCE\(\w+\.encerrado_em, \w+\.criado_em\)/);
        }
        const conc = partes.find((p) => /FROM conciliacao_execucao\b/.test(p));
        expect(conc).toMatch(/\w+\.atualizado_em AS em/);
    });

    it('keyset (em DESC, fonte ASC, fonte_id DESC) com o predicado completo e LIMIT', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };
        await new AtividadeUsuarioRepository(db as never).historico(consultaBase);
        const [sql, params] = db.selectMany.mock.calls[0];
        expect(sql).toMatch(
            /ORDER BY a\.em DESC, a\.fonte COLLATE "C" ASC, a\.fonte_id COLLATE "C" DESC/,
        );
        expect(sql).toMatch(
            /a\.em < \$cursorEm::timestamptz\s+OR \(a\.em = \$cursorEm::timestamptz AND \(a\.fonte COLLATE "C" > \$cursorFonte OR \(a\.fonte = \$cursorFonte AND a\.fonte_id COLLATE "C" < \$cursorId\)\)\)/,
        );
        expect(sql).toMatch(/LIMIT \$limit/);
        // Sem cursor: os parâmetros do keyset viajam nulos (o predicado vira no-op).
        expect(params).toMatchObject({ cursorEm: null, cursorFonte: null, cursorId: null });
    });

    it('nenhuma coluna de credencial no SQL', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };
        await new AtividadeUsuarioRepository(db as never).historico(consultaBase);
        const [sql] = db.selectMany.mock.calls[0];
        expect(sql).not.toMatch(/password_hash|conexos_password_enc|auth_user_id/);
    });

    it('mapeia a linha: valor numeric→number, em em texto com microssegundos, detalhe opcional', async () => {
        const db = {
            selectMany: jest
                .fn()
                .mockResolvedValue([linha(), linha({ valor: null, detalhe: {}, fonte_id: '100' })]),
        };
        const [a, b] = await new AtividadeUsuarioRepository(db as never).historico(consultaBase);
        expect(a).toEqual({
            em: '2026-09-30T14:02:03.123456Z',
            frente: 'permutas',
            acao: 'baixa_permuta',
            alvoTipo: 'adiantamento',
            alvoId: '12345',
            valor: 1500.25,
            statusBruto: 'settled',
            fonte: 'permuta_execucao',
            fonteId: '99',
            detalhe: { filCod: 1, conexosUsername: 'ANA_SOUZA' },
        });
        expect(b.valor).toBeUndefined();
        expect(b.detalhe).toEqual({});
    });

    it('detalhe para o rótulo do alvo: lote, conciliação e o que mudou no evento de acesso', async () => {
        const db = {
            selectMany: jest.fn().mockResolvedValue([
                linha({
                    acao: 'remessa_gerada',
                    frente: 'sispag',
                    alvo_tipo: 'lote',
                    fonte: 'remessa',
                    detalhe: { filCod: 7, remessaNum: '231002', banco: '341' },
                }),
                linha({
                    acao: 'retorno_conciliado',
                    frente: 'sispag',
                    alvo_tipo: 'retorno',
                    fonte: 'conciliacao',
                    fonte_id: '2',
                    detalhe: { bncCod: 341, agendados: 2, rejeitados: 1 },
                }),
                linha({
                    acao: 'acesso_recebido',
                    frente: 'plataforma',
                    alvo_tipo: 'usuario',
                    fonte: 'acesso_evento',
                    fonte_id: '3',
                    detalhe: {
                        tipoAcesso: 'excecao',
                        outroUsername: 'admin',
                        excecoesAntes: [],
                        excecoesDepois: [
                            { permissao: 'metricas:ver', efeito: 'conceder', extra: 1 },
                        ],
                    },
                }),
                linha({
                    acao: 'acesso_recebido',
                    frente: 'plataforma',
                    alvo_tipo: 'usuario',
                    fonte: 'acesso_evento',
                    fonte_id: '4',
                    // trilha torta não derruba o histórico: a lista some, o resto fica
                    detalhe: { tipoAcesso: 'excecao', excecoesDepois: [{ permissao: 1 }] },
                }),
            ]),
        };
        const [rem, conc, exc, torta] = await new AtividadeUsuarioRepository(db as never).historico(
            consultaBase,
        );
        expect(rem.detalhe).toEqual({ filCod: 7, remessaNum: 231002, banco: '341' });
        expect(conc.detalhe).toEqual({ bncCod: 341, agendados: 2, rejeitados: 1 });
        expect(exc.detalhe.excecoesDepois).toEqual([
            { permissao: 'metricas:ver', efeito: 'conceder' },
        ]);
        expect(torta.detalhe).toEqual({ tipoAcesso: 'excecao' });
    });

    it('o ramo de remessa traz o número da remessa do lote; nada além do nome do outro usuário', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };
        await new AtividadeUsuarioRepository(db as never).historico(consultaBase);
        const partes = ramos(db.selectMany.mock.calls[0][0]);
        const remessa = partes.find((p) => /FROM remessa_execucao\b/.test(p));
        expect(remessa).toMatch(/LEFT JOIN lote_pagamento \w+ ON \w+\.id = r\.lote_id/);
        const acesso = partes.find((p) => p.includes('app_user_access_event'));
        // do app_user do outro lado, só `username`
        expect(acesso?.match(/\bt\.\w+/g)?.filter((c) => c !== 't.id')).toEqual(['t.username']);
    });

    it('linha fora do contrato (fonte desconhecida) falha alto', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([linha({ fonte: 'app_user' })]) };
        await expect(
            new AtividadeUsuarioRepository(db as never).historico(consultaBase),
        ).rejects.toThrow();
    });
});

describe('AtividadeUsuarioRepository.agregados', () => {
    const agregadosRow = {
        permutas_concluidas: '3',
        permutas_parciais: '1',
        permutas_valor_baixado: '1000.50',
        permutas_aguardando_bordero: '2',
        permutas_com_erro: '1',
        sispag_lotes_finalizados: '2',
        sispag_remessas_geradas: '1',
        sispag_valor_remessado: '5000.00',
        sispag_valor_agendado: '4000.00',
        sispag_valor_pago_confirmado: '1000.00',
        sispag_retornos_conciliados: '1',
        sispag_com_erro: '2',
        recebimentos_concluidas: '4',
        recebimentos_valor: '800.10',
        recebimentos_com_erro: '0',
    };

    it('uma ida ao banco, parametrizada, intervalo semiaberto [$inicio, $fim)', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(agregadosRow) };
        await new AtividadeUsuarioRepository(db as never).agregados({
            username: USERNAME,
            inicio: consultaBase.inicio,
            fim: consultaBase.fim,
        });
        expect(db.selectFirst).toHaveBeenCalledTimes(1);
        const [sql, params] = db.selectFirst.mock.calls[0];
        expect(params).toEqual({
            username: USERNAME,
            inicio: consultaBase.inicio,
            fim: consultaBase.fim,
        });
        expect(sql).not.toContain(USERNAME);
        expect(sql).toMatch(/>= \$inicio::timestamptz/);
        expect(sql).toMatch(/< \$fim::timestamptz/);
        expect(sql).not.toMatch(/password_hash|conexos_password_enc/);
    });

    it('Permutas usa o MESMO EXISTS de borderô da 0070 (finalizado e não estornado)', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(agregadosRow) };
        await new AtividadeUsuarioRepository(db as never).agregados({
            username: USERNAME,
            inicio: consultaBase.inicio,
            fim: consultaBase.fim,
        });
        const [sql] = db.selectFirst.mock.calls[0];
        expect(sql).toMatch(
            /EXISTS \(\s*SELECT 1\s+FROM permuta_bordero b\s+WHERE b\.fil_cod = x\.fil_cod\s+AND b\.bor_cod = x\.bor_cod\s+AND b\.bor_vld_finalizado = 1\s+AND b\.bor_cod_estornado IS NULL\s*\)/,
        );
        expect(sql).toMatch(/status = 'settled' AND finalizada/);
        expect(sql).toMatch(/status IN \('settled', 'parcial'\) AND finalizada/);
    });

    it('SISPAG: 1ª remessa settled não-dry por lote (LATERAL ... LIMIT 1), lote CANCELADO fora', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(agregadosRow) };
        await new AtividadeUsuarioRepository(db as never).agregados({
            username: USERNAME,
            inicio: consultaBase.inicio,
            fim: consultaBase.fim,
        });
        const [sql] = db.selectFirst.mock.calls[0];
        expect(sql).toMatch(/JOIN LATERAL/);
        expect(sql).toMatch(/ORDER BY COALESCE\(x\.encerrado_em, x\.criado_em\), x\.id\s+LIMIT 1/);
        expect(sql).toMatch(/status <> 'CANCELADO'/);
        expect(sql).toMatch(/situacao IN \('AGENDADO', 'PAGO'\)/);
        expect(sql).toMatch(/situacao = 'PAGO'/);
        // O ator da 1ª remessa é filtrado DEPOIS de escolhê-la entre todos os usuários.
        expect(sql).toMatch(/r1\.executado_por = \$username/);
    });

    it('converte numeric do driver em número', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(agregadosRow) };
        const r = await new AtividadeUsuarioRepository(db as never).agregados({
            username: USERNAME,
            inicio: consultaBase.inicio,
            fim: consultaBase.fim,
        });
        expect(r).toEqual({
            permutas: {
                concluidas: 3,
                parciais: 1,
                valorBaixado: 1000.5,
                aguardandoBordero: 2,
                comErro: 1,
            },
            sispag: {
                lotesFinalizados: 2,
                remessasGeradas: 1,
                valorRemessado: 5000,
                valorAgendado: 4000,
                valorPagoConfirmado: 1000,
                retornosConciliados: 1,
                comErro: 2,
            },
            recebimentos: { concluidas: 4, valor: 800.1, comErro: 0 },
        });
    });

    it('linha nula ou torta falha alto', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(null) };
        await expect(
            new AtividadeUsuarioRepository(db as never).agregados({
                username: USERNAME,
                inicio: consultaBase.inicio,
                fim: consultaBase.fim,
            }),
        ).rejects.toThrow();
    });
});
