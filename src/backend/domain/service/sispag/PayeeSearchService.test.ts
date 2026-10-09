import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import type AuthorizedPayeeRepository from '../../repository/sispag/AuthorizedPayeeRepository.js';
import PayeeSearchService from './PayeeSearchService.js';

const montar = () => {
    const sispag = {
        buscarPessoas: jest.fn().mockResolvedValue({
            pessoas: [
                {
                    pesCod: '77',
                    nome: 'ACME LTDA',
                    nomeFantasia: 'ACME',
                    documento: '12345678000195',
                    situacao: 1,
                },
                { pesCod: '88', nome: 'BETA SA', situacao: 2 },
            ],
            truncado: true,
        }),
    };
    const autorizacoes = {
        listarVigentesPorPesCods: jest.fn().mockResolvedValue([
            { id: 'A1', pesCod: '77', modalidade: 'TED', estado: 'AUTORIZADO' },
            { id: 'A2', pesCod: '88', modalidade: 'PIX', estado: 'PENDENTE' },
        ]),
    };
    const env = {
        getEnvironmentVars: async () => ({ sispagCadastroFilCod: 3 }),
    } as unknown as EnvironmentProvider;
    const service = new PayeeSearchService(
        sispag as unknown as ConexosSispagClient,
        autorizacoes as unknown as AuthorizedPayeeRepository,
        new MaskDestino(),
        env,
    );
    return { service, sispag, autorizacoes };
};

describe('PayeeSearchService', () => {
    it('devolve as pessoas com documento mascarado e a autorização vigente de cada modalidade', async () => {
        const { service, sispag, autorizacoes } = montar();
        const r = await service.buscar('acme');
        expect(sispag.buscarPessoas).toHaveBeenCalledWith('acme', 3);
        expect(autorizacoes.listarVigentesPorPesCods).toHaveBeenCalledWith(['77', '88']);
        expect(r.truncado).toBe(true);
        expect(r.favorecidos).toEqual([
            {
                pesCod: '77',
                nome: 'ACME LTDA',
                nomeFantasia: 'ACME',
                documentoMascarado: '**.345.678/****-**',
                situacao: 1,
                autorizacao: {
                    TED: { estado: 'AUTORIZADO', id: 'A1' },
                    PIX: { estado: 'NENHUMA' },
                },
            },
            {
                pesCod: '88',
                nome: 'BETA SA',
                situacao: 2,
                autorizacao: {
                    TED: { estado: 'NENHUMA' },
                    PIX: { estado: 'PENDENTE', id: 'A2' },
                },
            },
        ]);
    });

    it('nunca devolve o documento em claro', async () => {
        const { service } = montar();
        const r = await service.buscar('acme');
        expect(JSON.stringify(r)).not.toContain('12345678000195');
    });

    it('texto com menos de 3 letras não lê o Conexos', async () => {
        const { service, sispag } = montar();
        await expect(service.buscar(' ac ')).resolves.toEqual({ favorecidos: [], truncado: false });
        expect(sispag.buscarPessoas).not.toHaveBeenCalled();
    });

    it('código curto (só dígitos) lê o Conexos mesmo com 1 dígito', async () => {
        const { service, sispag } = montar();
        await service.buscar('7');
        expect(sispag.buscarPessoas).toHaveBeenCalledWith('7', 3);
    });

    it('sem pessoa não consulta autorizações', async () => {
        const { service, sispag, autorizacoes } = montar();
        sispag.buscarPessoas.mockResolvedValueOnce({ pessoas: [], truncado: false });
        await expect(service.buscar('zzzz')).resolves.toEqual({ favorecidos: [], truncado: false });
        expect(autorizacoes.listarVigentesPorPesCods).not.toHaveBeenCalled();
    });
});
