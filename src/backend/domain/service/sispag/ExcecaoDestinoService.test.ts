import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import type { DestinoManual, ExcecaoDestino } from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import DestinoManualValidator from '../../libs/sispag/DestinoManualValidator.js';
import ExcecaoDestinoRule from '../../libs/sispag/ExcecaoDestinoRule.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import type ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import type LogService from '../LogService.js';
import type DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import ExcecaoDestinoService, { type AtorExcecao } from './ExcecaoDestinoService.js';

const DOC = '11144477735';

const ENTRADA_CONTA = {
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta: '99887766',
    contaDv: '1',
    titularDocumento: '111.444.777-35',
};
const CONTA: DestinoManual = { ...ENTRADA_CONTA, tipo: 'CONTA', titularDocumento: DOC };
const ENTRADA_PIX = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'CPF_CNPJ',
    chavePix: '111.444.777-35',
    titularDocumento: DOC,
};

const ator = (id: string, temPermissao = true): AtorExcecao => ({
    id,
    permissoes: new Set(temPermissao ? ['sispag:ver', 'sispag:excecao'] : ['sispag:ver']),
});

const excecao = (over: Partial<ExcecaoDestino> = {}): ExcecaoDestino => ({
    id: 'E1',
    pesCod: '7001',
    filCod: 1,
    destino: CONTA,
    estado: 'PENDENTE',
    origem: 'MANUAL',
    justificativa: 'cadastro desatualizado',
    cadastradoPor: 'ana',
    cadastradoEm: '2026-10-05T10:00:00.000Z',
    versao: 1,
    ...over,
});

const build = (env: Record<string, unknown> = { sispagExcecaoDestinoEnabled: true }) => {
    const repo = {
        insert: jest.fn().mockImplementation(async (n) => excecao({ ...n, id: 'E1' })),
        getById: jest.fn().mockResolvedValue(excecao()),
        aprovar: jest
            .fn()
            .mockImplementation(async () => excecao({ estado: 'APROVADA', aprovadoPor: 'bia' })),
        transition: jest
            .fn()
            .mockImplementation(async (t) => excecao({ estado: t.para, decididoPor: t.ator })),
        list: jest.fn().mockResolvedValue([]),
        listAprovadas: jest.fn().mockResolvedValue([]),
        listEventos: jest.fn().mockResolvedValue([]),
    };
    const sispag = {
        getDocumentoFavorecido: jest.fn().mockResolvedValue(DOC),
        getTituloAPagar: jest.fn().mockResolvedValue({ pesCod: '7001' }),
    };
    const environment = {
        getEnvironmentVars: jest.fn().mockResolvedValue(env),
    };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    };
    const resolver = {
        novoCache: jest.fn().mockReturnValue(new Map()),
        resolve: jest.fn().mockResolvedValue({ origem: 'NENHUM' }),
    };
    const validator = new DestinoManualValidator();
    const svc = new ExcecaoDestinoService(
        repo as unknown as ExcecaoDestinoRepository,
        new ExcecaoDestinoRule(validator),
        validator,
        sispag as unknown as ConexosSispagClient,
        environment as unknown as EnvironmentProvider,
        log as unknown as LogService,
        new MaskDestino(),
        resolver as unknown as DestinoPagamentoResolver,
    );
    return { svc, repo, sispag, log, resolver };
};

const tudoLogado = (log: { info: jest.Mock; warn: jest.Mock }): string =>
    JSON.stringify([log.info.mock.calls, log.warn.mock.calls]);

describe('ExcecaoDestinoService.registrar (E1)', () => {
    const base = {
        ator: ator('ana'),
        filCod: 1,
        pesCod: '7001',
        destino: ENTRADA_CONTA,
        justificativa: 'cadastro desatualizado',
    };

    it('valida o formato, lê a titularidade AO VIVO e cria PENDENTE — nunca APROVADA', async () => {
        const { svc, repo, sispag } = build();
        const r = await svc.registrar(base);
        expect(sispag.getDocumentoFavorecido).toHaveBeenCalledWith('7001', 1);
        const gravado = repo.insert.mock.calls[0][0];
        expect(gravado).toMatchObject({
            pesCod: '7001',
            filCod: 1,
            origem: 'MANUAL',
            cadastradoPor: 'ana',
            justificativa: 'cadastro desatualizado',
            destino: { ...ENTRADA_CONTA, titularDocumento: DOC },
        });
        expect(gravado).not.toHaveProperty('estado');
        expect(r.estado).toBe('PENDENTE');
    });

    it('a resposta é só máscara: nunca conta, chave ou documento', async () => {
        const { svc } = build();
        const r = await svc.registrar(base);
        const json = JSON.stringify(r);
        expect(r.destinoMascarado).toBe('banco 237 · ag. 1234 · cc ****7766-1');
        expect(r.titularDocumentoMascarado).toBe('***.444.777-**');
        expect(json).not.toContain('99887766');
        expect(json).not.toContain(DOC);
    });

    it('o favorecido pode vir pelo título, lido ao vivo', async () => {
        const { svc, repo, sispag } = build();
        await svc.registrar({
            ator: ator('ana'),
            filCod: 2,
            docCod: '100',
            titCod: '1',
            destino: ENTRADA_CONTA,
            justificativa: 'j',
        });
        expect(sispag.getTituloAPagar).toHaveBeenCalledWith(2, '100', '1');
        expect(repo.insert.mock.calls[0][0]).toMatchObject({ pesCod: '7001', filCod: 2 });
    });

    it('sem favorecido identificável: falha fechada', async () => {
        const { svc, sispag, repo } = build();
        sispag.getTituloAPagar.mockResolvedValue(null);
        await expect(
            svc.registrar({
                ator: ator('ana'),
                filCod: 2,
                docCod: '100',
                titCod: '1',
                destino: ENTRADA_CONTA,
                justificativa: 'j',
            }),
        ).rejects.toMatchObject({ code: 'DOCUMENTO_FAVORECIDO_INDISPONIVEL' });
        expect(repo.insert).not.toHaveBeenCalled();
    });

    it('flag desligada → 403 e nada gravado', async () => {
        const { svc, repo } = build({});
        await expect(svc.registrar(base)).rejects.toMatchObject({
            code: 'EXCECAO_DESABILITADA',
            statusCode: 403,
        });
        expect(repo.insert).not.toHaveBeenCalled();
    });

    it('sem sispag:excecao → 403 (segunda trava, além do guard da rota)', async () => {
        const { svc, repo } = build();
        await expect(svc.registrar({ ...base, ator: ator('ana', false) })).rejects.toMatchObject({
            code: 'EXCECAO_SEM_PERMISSAO',
            statusCode: 403,
        });
        expect(repo.insert).not.toHaveBeenCalled();
    });

    it('justificativa obrigatória (400)', async () => {
        const { svc } = build();
        await expect(svc.registrar({ ...base, justificativa: '   ' })).rejects.toMatchObject({
            code: 'EXCECAO_MOTIVO_OBRIGATORIO',
            statusCode: 400,
        });
    });

    it('formato inválido → 400 sem ecoar o valor', async () => {
        const { svc, repo } = build();
        const err = await svc
            .registrar({ ...base, destino: { ...ENTRADA_CONTA, bancoCod: '99' } })
            .catch((e: unknown) => e);
        expect(err).toMatchObject({ code: 'DESTINO_MANUAL_INVALIDO', statusCode: 400 });
        expect(JSON.stringify(err)).not.toContain('99887766');
        expect(repo.insert).not.toHaveBeenCalled();
    });

    it('I10i — titular divergente do favorecido → 422, nada gravado', async () => {
        const { svc, sispag, repo } = build();
        sispag.getDocumentoFavorecido.mockResolvedValue('11222333000181');
        await expect(svc.registrar(base)).rejects.toMatchObject({
            code: 'EXCECAO_TITULARIDADE',
            statusCode: 422,
        });
        expect(repo.insert).not.toHaveBeenCalled();
    });

    it('documento do favorecido indisponível → falha fechada', async () => {
        const { svc, sispag, repo } = build();
        sispag.getDocumentoFavorecido.mockResolvedValue(undefined);
        await expect(svc.registrar(base)).rejects.toMatchObject({
            code: 'DOCUMENTO_FAVORECIDO_INDISPONIVEL',
        });
        expect(repo.insert).not.toHaveBeenCalled();
    });

    it('PIX: só chave CPF/CNPJ; e-mail/telefone/aleatória → 422', async () => {
        const { svc, repo } = build();
        await expect(
            svc.registrar({
                ...base,
                destino: { ...ENTRADA_PIX, chavePixTipo: 'EMAIL', chavePix: 'a@b.com' },
            }),
        ).rejects.toMatchObject({ code: 'EXCECAO_TITULARIDADE' });
        expect(repo.insert).not.toHaveBeenCalled();
        await svc.registrar({ ...base, destino: ENTRADA_PIX });
        expect(repo.insert).toHaveBeenCalledTimes(1);
    });

    it('o log (português) leva id, favorecido, tipo e ator — nunca conta, chave ou documento', async () => {
        const { svc, log } = build();
        await svc.registrar(base);
        const logado = tudoLogado(log);
        expect(logado).toContain('exceção de destino cadastrada');
        expect(logado).toContain('E1');
        expect(logado).toContain('7001');
        expect(logado).toContain('ana');
        expect(logado).not.toContain('99887766');
        expect(logado).not.toContain(DOC);
    });
});

describe('ExcecaoDestinoService.aprovar (E2, I12b)', () => {
    it('aprovador diferente do cadastrante aprova; reconfere a titularidade ao vivo', async () => {
        const { svc, repo, sispag } = build();
        const r = await svc.aprovar({ id: 'E1', ator: ator('bia') });
        expect(sispag.getDocumentoFavorecido).toHaveBeenCalledWith('7001', 1);
        expect(repo.aprovar).toHaveBeenCalledWith({ id: 'E1', ator: 'bia' });
        expect(r.estado).toBe('APROVADA');
    });

    it('o próprio cadastrante é negado NO SERVIÇO, independente da UI, e nada é gravado', async () => {
        const { svc, repo } = build();
        await expect(svc.aprovar({ id: 'E1', ator: ator('ana') })).rejects.toMatchObject({
            code: 'EXCECAO_APROVACAO_PROPRIO_CADASTRANTE',
            statusCode: 403,
        });
        expect(repo.aprovar).not.toHaveBeenCalled();
    });

    it('ator sem id identificável nunca aprova (falha fechada)', async () => {
        const { svc, repo } = build();
        await expect(svc.aprovar({ id: 'E1', ator: ator('unknown') })).rejects.toMatchObject({
            code: 'EXCECAO_APROVACAO_PROPRIO_CADASTRANTE',
        });
        expect(repo.aprovar).not.toHaveBeenCalled();
    });

    it('sem sispag:excecao → 403', async () => {
        const { svc, repo } = build();
        await expect(svc.aprovar({ id: 'E1', ator: ator('bia', false) })).rejects.toMatchObject({
            code: 'EXCECAO_SEM_PERMISSAO',
        });
        expect(repo.aprovar).not.toHaveBeenCalled();
    });

    it('flag desligada → 403', async () => {
        const { svc } = build({});
        await expect(svc.aprovar({ id: 'E1', ator: ator('bia') })).rejects.toMatchObject({
            code: 'EXCECAO_DESABILITADA',
        });
    });

    it('só a PENDENTE aprova (409 nos outros estados)', async () => {
        const { svc, repo } = build();
        for (const estado of ['APROVADA', 'REJEITADA', 'SUBSTITUIDA', 'REVOGADA'] as const) {
            repo.getById.mockResolvedValue(excecao({ estado }));
            await expect(svc.aprovar({ id: 'E1', ator: ator('bia') })).rejects.toBeInstanceOf(
                ExcecaoEstadoInvalidoError,
            );
        }
        expect(repo.aprovar).not.toHaveBeenCalled();
    });

    it('titularidade que mudou desde o cadastro barra a aprovação', async () => {
        const { svc, sispag, repo } = build();
        sispag.getDocumentoFavorecido.mockResolvedValue('11222333000181');
        await expect(svc.aprovar({ id: 'E1', ator: ator('bia') })).rejects.toMatchObject({
            code: 'EXCECAO_TITULARIDADE',
        });
        expect(repo.aprovar).not.toHaveBeenCalled();
    });

    it('inexistente → 404', async () => {
        const { svc, repo } = build();
        repo.getById.mockResolvedValue(null);
        await expect(svc.aprovar({ id: 'X', ator: ator('bia') })).rejects.toMatchObject({
            code: 'EXCECAO_NAO_ENCONTRADA',
            statusCode: 404,
        });
    });

    it('PIX também exige a segunda pessoa (sem isenção)', async () => {
        const { svc, repo } = build();
        repo.getById.mockResolvedValue(
            excecao({
                destino: {
                    tipo: 'CHAVE_PIX',
                    chavePixTipo: 'CPF_CNPJ',
                    chavePix: DOC,
                    titularDocumento: DOC,
                },
            }),
        );
        await expect(svc.aprovar({ id: 'E1', ator: ator('ana') })).rejects.toMatchObject({
            code: 'EXCECAO_APROVACAO_PROPRIO_CADASTRANTE',
        });
    });

    it('o log leva id, favorecido, tipo e ator', async () => {
        const { svc, log } = build();
        await svc.aprovar({ id: 'E1', ator: ator('bia') });
        const logado = tudoLogado(log);
        expect(logado).toContain('exceção de destino aprovada');
        expect(logado).toContain('bia');
        expect(logado).not.toContain('99887766');
    });
});

describe('ExcecaoDestinoService.rejeitar / revogar (E3, E5)', () => {
    it('rejeitar exige motivo; o cadastrante pode rejeitar a própria PENDENTE', async () => {
        const { svc, repo } = build();
        await expect(
            svc.rejeitar({ id: 'E1', ator: ator('ana'), motivo: '  ' }),
        ).rejects.toMatchObject({ code: 'EXCECAO_MOTIVO_OBRIGATORIO', statusCode: 400 });
        const r = await svc.rejeitar({ id: 'E1', ator: ator('ana'), motivo: 'conta de terceiro' });
        expect(repo.transition).toHaveBeenCalledWith({
            id: 'E1',
            de: 'PENDENTE',
            para: 'REJEITADA',
            evento: 'REJEICAO',
            ator: 'ana',
            motivo: 'conta de terceiro',
        });
        expect(r.estado).toBe('REJEITADA');
    });

    it('revogar exige motivo; qualquer titular revoga a APROVADA, inclusive o cadastrante', async () => {
        const { svc, repo } = build();
        repo.getById.mockResolvedValue(excecao({ estado: 'APROVADA', aprovadoPor: 'bia' }));
        await expect(
            svc.revogar({ id: 'E1', ator: ator('ana'), motivo: '' }),
        ).rejects.toMatchObject({ code: 'EXCECAO_MOTIVO_OBRIGATORIO' });
        const r = await svc.revogar({ id: 'E1', ator: ator('ana'), motivo: 'fornecedor trocou' });
        expect(repo.transition).toHaveBeenCalledWith(
            expect.objectContaining({
                de: 'APROVADA',
                para: 'REVOGADA',
                evento: 'REVOGACAO',
                ator: 'ana',
                motivo: 'fornecedor trocou',
            }),
        );
        expect(r.estado).toBe('REVOGADA');
    });

    it('rejeitar/revogar valem mesmo com a flag desligada (reduzem risco)', async () => {
        const { svc, repo } = build({});
        repo.getById.mockResolvedValue(excecao({ estado: 'APROVADA', aprovadoPor: 'bia' }));
        await expect(
            svc.revogar({ id: 'E1', ator: ator('bia'), motivo: 'desligar' }),
        ).resolves.toBeDefined();
    });

    it('sem sispag:excecao → 403', async () => {
        const { svc } = build();
        await expect(
            svc.rejeitar({ id: 'E1', ator: ator('bia', false), motivo: 'x' }),
        ).rejects.toMatchObject({ code: 'EXCECAO_SEM_PERMISSAO' });
    });

    it('estado errado → 409', async () => {
        const { svc } = build();
        await expect(
            svc.revogar({ id: 'E1', ator: ator('bia'), motivo: 'x' }),
        ).rejects.toBeInstanceOf(ExcecaoEstadoInvalidoError);
    });

    it('o log carrega o ator e o id, nunca o motivo livre nem o destino', async () => {
        const { svc, log } = build();
        await svc.rejeitar({ id: 'E1', ator: ator('bia'), motivo: 'texto livre sensível' });
        const logado = tudoLogado(log);
        expect(logado).toContain('exceção de destino rejeitada');
        expect(logado).not.toContain('99887766');
    });
});

describe('ExcecaoDestinoService — leituras', () => {
    it('listar devolve só resumos mascarados', async () => {
        const { svc, repo } = build();
        repo.list.mockResolvedValue([excecao()]);
        const r = await svc.listar({ estado: 'PENDENTE' });
        expect(repo.list).toHaveBeenCalledWith({ estado: 'PENDENTE' });
        expect(r).toHaveLength(1);
        expect(JSON.stringify(r)).not.toContain('99887766');
        expect(r[0]).not.toHaveProperty('destino');
    });

    it('listar não exige a flag (a tela precisa ver o que existe para revogar)', async () => {
        const { svc } = build({});
        await expect(svc.listar()).resolves.toEqual([]);
    });
});

describe('ExcecaoDestinoService.aposentarSubstituidas (I12c, job)', () => {
    const aprovada = (id: string, tipo: 'CONTA' | 'PIX' = 'CONTA') =>
        excecao({
            id,
            estado: 'APROVADA',
            aprovadoPor: 'bia',
            ...(tipo === 'PIX'
                ? {
                      destino: {
                          tipo: 'CHAVE_PIX',
                          chavePixTipo: 'CPF_CNPJ',
                          chavePix: DOC,
                          titularDocumento: DOC,
                      } as DestinoManual,
                  }
                : {}),
        });

    it('usa o MESMO resolver (função de cadastro válido) com aposentarExcecao e as flags de modalidade forçadas', async () => {
        const { svc, repo, resolver } = build();
        repo.listAprovadas.mockResolvedValue([aprovada('E1'), aprovada('E2', 'PIX')]);
        resolver.resolve.mockResolvedValue({ origem: 'CADASTRO' });
        repo.getById.mockResolvedValue(excecao({ estado: 'SUBSTITUIDA' }));
        const r = await svc.aposentarSubstituidas();
        expect(resolver.resolve).toHaveBeenNthCalledWith(
            1,
            { modalidade: 'TED' },
            expect.objectContaining({
                flags: { ted: true, pix: true, excecao: true },
                filCod: 1,
                pesCod: '7001',
                aposentarExcecao: true,
            }),
        );
        expect(resolver.resolve).toHaveBeenNthCalledWith(
            2,
            { modalidade: 'PIX' },
            expect.objectContaining({ aposentarExcecao: true }),
        );
        expect(r).toEqual({ inspecionadas: 2, aposentadas: 2, falhas: 0 });
    });

    it('cadastro sem destino: a exceção segue APROVADA (nada aposentado)', async () => {
        const { svc, repo, resolver } = build();
        repo.listAprovadas.mockResolvedValue([aprovada('E1')]);
        resolver.resolve.mockResolvedValue({ origem: 'EXCECAO' });
        const r = await svc.aposentarSubstituidas();
        expect(r).toEqual({ inspecionadas: 1, aposentadas: 0, falhas: 0 });
    });

    it('idempotente: já SUBSTITUIDA por outra execução não conta de novo', async () => {
        const { svc, repo, resolver } = build();
        repo.listAprovadas.mockResolvedValue([]);
        const r = await svc.aposentarSubstituidas();
        expect(r).toEqual({ inspecionadas: 0, aposentadas: 0, falhas: 0 });
        expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('leitura que falha conta como falha e a varredura SEGUE nas demais', async () => {
        const { svc, repo, resolver, log } = build();
        repo.listAprovadas.mockResolvedValue([aprovada('E1'), aprovada('E2')]);
        resolver.resolve
            .mockRejectedValueOnce(new Error('504 do Conexos'))
            .mockResolvedValueOnce({ origem: 'CADASTRO' });
        repo.getById.mockResolvedValue(excecao({ estado: 'SUBSTITUIDA' }));
        const r = await svc.aposentarSubstituidas();
        expect(r).toEqual({ inspecionadas: 2, aposentadas: 1, falhas: 1 });
        expect(tudoLogado(log)).not.toContain('99887766');
    });
});
