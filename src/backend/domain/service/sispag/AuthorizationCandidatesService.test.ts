import 'reflect-metadata';
import type { ChannelProfile } from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import type AuthorizedPayeeRepository from '../../repository/sispag/AuthorizedPayeeRepository.js';
import type PerfilCanalFornecedorRepository from '../../repository/sispag/PerfilCanalFornecedorRepository.js';
import type VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import AuthorizationCandidatesService from './AuthorizationCandidatesService.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';

const perfil = (over: Partial<ChannelProfile> = {}): ChannelProfile => ({
    pesCod: '7001',
    credor: 'ACME',
    contagens: { BOLETO: 1, TED_PIX: 9, OUTROS: 0 },
    pagamentosUnicos: 10,
    mesesDistintos: 6,
    grupoDominante: 'TED_PIX',
    participacao: 0.9,
    confianca: 'ALTA',
    janelaInicio: 0,
    janelaFim: 1,
    ...over,
});

const montar = () => {
    const perfis = {
        listarCandidatos: jest.fn().mockResolvedValue({
            perfis: [perfil(), perfil({ pesCod: '7002', credor: 'BETA' })],
            total: 2,
        }),
        upsertRodada: jest.fn(),
    };
    const autorizacoes = {
        listarVigentesPorPesCods: jest
            .fn()
            .mockResolvedValue([
                { id: 'A1', pesCod: '7001', modalidade: 'TED', estado: 'AUTORIZADO' },
            ]),
        inserir: jest.fn(),
        atualizarComVersao: jest.fn(),
        registrarEvento: jest.fn(),
    };
    const eventos = {
        listarRetiradosSemDado: jest.fn().mockResolvedValue([
            {
                docCod: '6173',
                titCod: '1',
                pesCod: '7003',
                ocorridoEm: '2026-10-08T10:00:00.000Z',
            },
        ]),
        registrar: jest.fn(),
    };
    const sispag = {
        listContasFavorecido: jest.fn(async (pesCod: string) =>
            pesCod === '7001'
                ? [{ pctCodSeq: 1, banco: 237, agencia: '1', conta: '87654321', padrao: true }]
                : [],
        ),
        listChavesPixFavorecido: jest.fn(async (pesCod: string) => {
            if (pesCod === '7002') throw new Error('HTTP 503');
            return [];
        }),
        getDocumentoFavorecido: jest.fn(),
    };
    const env = {
        getEnvironmentVars: async () => ({ conexosFilCod: 2 }),
    } as unknown as EnvironmentProvider;
    const service = new AuthorizationCandidatesService(
        perfis as unknown as PerfilCanalFornecedorRepository,
        autorizacoes as unknown as AuthorizedPayeeRepository,
        eventos as unknown as VerificacaoEventoRepository,
        new DestinoPagamentoResolver(sispag as never, new MaskDestino()),
        env,
    );
    return { service, perfis, autorizacoes, eventos, sispag };
};

describe('AuthorizationCandidatesService — listarCandidatosAutorizacao (ADR-0065)', () => {
    it('linha por favorecido: perfil, o que o cadastro tem por modalidade e o estado da autorização', async () => {
        const { service, perfis } = montar();
        const r = await service.listar({ pagina: 2, limite: 25 });
        expect(perfis.listarCandidatos).toHaveBeenCalledWith({ limite: 25, deslocamento: 25 });
        expect(r.total).toBe(2);
        expect(r.candidatos[0]).toEqual({
            pesCod: '7001',
            credor: 'ACME',
            grupoDominante: 'TED_PIX',
            participacao: 0.9,
            pagamentos: 10,
            pagamentosTedPix: 9,
            meses: 6,
            confianca: 'ALTA',
            cadastro: { TED: 'SIM', PIX: 'NAO' },
            autorizacao: { TED: { estado: 'AUTORIZADO', id: 'A1' }, PIX: { estado: 'NENHUMA' } },
        });
        // Falha de leitura é dita, não vira "não tem".
        expect(r.candidatos[1]?.cadastro).toEqual({ TED: 'NAO', PIX: 'FALHA_LEITURA' });
        expect(r.retiradosSemDado).toHaveLength(1);
    });

    it('nenhuma escrita em lugar nenhum e nenhum destino completo na resposta', async () => {
        const { service, perfis, autorizacoes, eventos } = montar();
        const r = await service.listar({ pagina: 1, limite: 50 });
        expect(perfis.upsertRodada).not.toHaveBeenCalled();
        expect(autorizacoes.inserir).not.toHaveBeenCalled();
        expect(autorizacoes.atualizarComVersao).not.toHaveBeenCalled();
        expect(autorizacoes.registrarEvento).not.toHaveBeenCalled();
        expect(eventos.registrar).not.toHaveBeenCalled();
        expect(JSON.stringify(r)).not.toContain('87654321');
    });

    it('lê o cmn025 com cache por favorecido (uma leitura de contas por favorecido da página)', async () => {
        const { service, sispag } = montar();
        await service.listar({ pagina: 1, limite: 50 });
        expect(sispag.listContasFavorecido).toHaveBeenCalledTimes(2);
        expect(sispag.listContasFavorecido).toHaveBeenCalledWith('7001', 2);
    });
});
