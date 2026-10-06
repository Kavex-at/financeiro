import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type { PendenciaCadastro } from '../../interface/sispag/SispagInterface.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import type PendenciaCadastroRepository from '../../repository/sispag/PendenciaCadastroRepository.js';
import type LogService from '../LogService.js';
import PendenciaCadastroService from './PendenciaCadastroService.js';

const pendencia = (over: Partial<PendenciaCadastro> = {}): PendenciaCadastro => ({
    id: 'P1',
    pesCod: '90001',
    filCod: 4,
    credor: 'FORNECEDOR A',
    tipo: 'CONTA',
    estado: 'ABERTA',
    abertaPor: 'sistema',
    abertaEm: '2026-10-05T10:00:00.000Z',
    origens: [
        {
            loteId: 'L1',
            filCod: 4,
            docCod: '6173',
            titCod: '1',
            desfecho: 'RETIRADO',
            registradaEm: '2026-10-05T10:00:00.000Z',
        },
    ],
    ...over,
});

const build = (abertas: PendenciaCadastro[]) => {
    const repo = {
        listAbertas: jest.fn().mockResolvedValue(abertas),
        resolverDoFavorecido: jest.fn().mockResolvedValue(1),
        tocarConferencia: jest.fn().mockResolvedValue(undefined),
    };
    const sispag = {
        listContasFavorecido: jest.fn().mockResolvedValue([]),
        listChavesPixFavorecido: jest.fn().mockResolvedValue([]),
    };
    const excecoes = { findAprovada: jest.fn().mockResolvedValue(null) };
    const log = { info: jest.fn(), warn: jest.fn() };
    const service = new PendenciaCadastroService(
        repo as unknown as PendenciaCadastroRepository,
        sispag as unknown as ConexosSispagClient,
        excecoes as unknown as ExcecaoDestinoRepository,
        new BoundedConcurrency(),
        log as unknown as LogService,
    );
    return { service, repo, sispag, excecoes, log };
};

describe('PendenciaCadastroService.listarAbertas (I13k)', () => {
    it('reconfere cada ABERTA no cmn025; a que ganhou o dado é RESOLVIDA pelo sistema e sai', async () => {
        const h = build([pendencia(), pendencia({ id: 'P2', pesCod: '90002', tipo: 'CHAVE_PIX' })]);
        h.sispag.listContasFavorecido.mockResolvedValue([{ banco: 341 }]); // P1 agora tem conta
        const lista = await h.service.listarAbertas();
        expect(h.sispag.listContasFavorecido).toHaveBeenCalledWith('90001', 4);
        expect(h.sispag.listChavesPixFavorecido).toHaveBeenCalledWith('90002', 4);
        expect(h.repo.resolverDoFavorecido).toHaveBeenCalledWith('90001', 'CONTA');
        expect(h.repo.tocarConferencia).toHaveBeenCalledWith('P2');
        expect(lista.map((p) => p.id)).toEqual(['P2']);
    });

    it('devolve favorecido, tipo e títulos de origem; comExcecaoAprovada derivado', async () => {
        const h = build([pendencia()]);
        h.excecoes.findAprovada.mockResolvedValue({ id: 'E1' });
        const [p] = await h.service.listarAbertas();
        expect(p).toMatchObject({
            pesCod: '90001',
            credor: 'FORNECEDOR A',
            tipo: 'CONTA',
            comExcecaoAprovada: true,
            origens: [{ docCod: '6173', desfecho: 'RETIRADO' }],
        });
    });

    it('falha de leitura do cmn025 não resolve e não derruba a lista (falha fechada)', async () => {
        const h = build([pendencia(), pendencia({ id: 'P2', pesCod: '90002' })]);
        h.sispag.listContasFavorecido
            .mockRejectedValueOnce(new Error('HTTP 504 conta 99887766'))
            .mockResolvedValueOnce([]);
        const lista = await h.service.listarAbertas();
        expect(lista.map((p) => p.id).sort()).toEqual(['P1', 'P2']);
        expect(h.repo.resolverDoFavorecido).not.toHaveBeenCalled();
        expect(JSON.stringify(h.log.warn.mock.calls)).not.toContain('99887766');
    });

    it('fila vazia não lê o Conexos', async () => {
        const h = build([]);
        expect(await h.service.listarAbertas()).toEqual([]);
        expect(h.sispag.listContasFavorecido).not.toHaveBeenCalled();
    });

    it('não existe transição manual ABERTA → RESOLVIDA (nenhum método público além da listagem)', () => {
        const h = build([]);
        const publicos = Object.keys(h.service).filter(
            (k) => typeof (h.service as unknown as Record<string, unknown>)[k] === 'function',
        );
        // Os privados também são campos (arrow functions); o contrato é que a ÚNICA ação exposta
        // à rota é a listagem — nada como "resolver", "fechar" ou "concluir".
        expect(publicos).toContain('listarAbertas');
        expect(publicos.filter((k) => /resolver|fechar|concluir|marcar/i.test(k))).toEqual([]);
    });
});
