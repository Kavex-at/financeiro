import 'reflect-metadata';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import type {
    ChavePixFavorecido,
    ContaFavorecido,
    ExcecaoDestino,
} from '../../interface/sispag/SispagInterface.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import type ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import type LogService from '../LogService.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import ExcecaoSubstituicaoService from './ExcecaoSubstituicaoService.js';

const EXC_CONTA: ExcecaoDestino = {
    id: 'E1',
    pesCod: '7001',
    filCod: 1,
    destino: {
        tipo: 'CONTA',
        bancoCod: '237',
        agencia: '1234',
        conta: '99887766',
        contaDv: '1',
        titularDocumento: '11144477735',
    },
    estado: 'APROVADA',
    origem: 'MANUAL',
    justificativa: 'j',
    cadastradoPor: 'ana',
    cadastradoEm: '2026-10-05T10:00:00.000Z',
    aprovadoPor: 'bia',
    versao: 2,
};
const EXC_PIX: ExcecaoDestino = {
    ...EXC_CONTA,
    id: 'E2',
    destino: {
        tipo: 'CHAVE_PIX',
        chavePixTipo: 'CPF_CNPJ',
        chavePix: '11144477735',
        titularDocumento: '11144477735',
    },
};

const contaCadastro = (over: Partial<ContaFavorecido> = {}): ContaFavorecido => ({
    pctCodSeq: 5,
    banco: 237,
    agencia: '1234',
    conta: '99887766',
    dvConta: '1',
    padrao: true,
    ...over,
});
const chaveCadastro = (over: Partial<ChavePixFavorecido> = {}): ChavePixFavorecido => ({
    cixCod: 9,
    chave: '111.444.777-35',
    tipo: 'CPF_CNPJ',
    padrao: true,
    pesCod: '7001',
    ...over,
});

const build = () => {
    const repo = {
        transition: jest.fn().mockResolvedValue({}),
        appendAudit: jest.fn().mockResolvedValue('A1'),
    };
    const notificacao = { emitir: jest.fn().mockResolvedValue({}) };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new ExcecaoSubstituicaoService(
        repo as unknown as ExcecaoDestinoRepository,
        notificacao as unknown as NotificacaoService,
        new MaskDestino(),
        log as unknown as LogService,
    );
    return { svc, repo, notificacao, log };
};

describe('ExcecaoSubstituicaoService (ADR-0061, I12c)', () => {
    it('cadastro igual à exceção: só a substituição, sem divergência nem alerta', async () => {
        const { svc, repo, notificacao } = build();
        const r = await svc.aposentar({
            excecao: EXC_CONTA,
            cadastro: { contas: [contaCadastro()] },
        });
        expect(r).toEqual({ aposentada: true, divergiu: false });
        expect(repo.transition).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'E1',
                de: 'APROVADA',
                para: 'SUBSTITUIDA',
                evento: 'SUBSTITUICAO',
                ator: 'sistema',
            }),
        );
        expect(repo.appendAudit).not.toHaveBeenCalled();
        expect(notificacao.emitir).not.toHaveBeenCalled();
    });

    it('cadastro diferente: DIVERGENCIA_CADASTRO na trilha (mascarada) e Alerta, sem valores em claro', async () => {
        const { svc, repo, notificacao, log } = build();
        const r = await svc.aposentar({
            excecao: EXC_CONTA,
            cadastro: { contas: [contaCadastro({ conta: '55554444' })] },
        });
        expect(r).toEqual({ aposentada: true, divergiu: true });
        const audit = repo.appendAudit.mock.calls[0][0];
        expect(audit).toMatchObject({ excecaoId: 'E1', evento: 'DIVERGENCIA_CADASTRO' });
        const tudo = JSON.stringify([
            audit,
            notificacao.emitir.mock.calls,
            log.info.mock.calls,
            log.warn.mock.calls,
        ]);
        expect(tudo).not.toContain('99887766');
        expect(tudo).not.toContain('55554444');
        expect(tudo).not.toContain('11144477735');
        expect(notificacao.emitir).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo: 'sispag-excecao-divergencia',
                alvo: 'excecao:E1',
                severidade: 'aviso',
                detalhe: { excecaoId: 'E1', pesCod: '7001', tipo: 'CONTA' },
            }),
        );
    });

    it('conta: qualquer das contas ativas iguais basta (não diverge)', async () => {
        const { svc } = build();
        const r = await svc.aposentar({
            excecao: EXC_CONTA,
            cadastro: { contas: [contaCadastro({ conta: '1' }), contaCadastro()] },
        });
        expect(r.divergiu).toBe(false);
    });

    it('PIX: compara a chave só por dígitos contra as chaves do cadastro', async () => {
        const { svc } = build();
        expect(
            (await svc.aposentar({ excecao: EXC_PIX, cadastro: { chaves: [chaveCadastro()] } }))
                .divergiu,
        ).toBe(false);
        expect(
            (
                await svc.aposentar({
                    excecao: EXC_PIX,
                    cadastro: { chaves: [chaveCadastro({ chave: 'a@b.com', tipo: 'EMAIL' })] },
                })
            ).divergiu,
        ).toBe(true);
    });

    it('idempotente: transição que já aconteceu (estado inválido) vira aposentada=false, sem trilha nem alerta', async () => {
        const { svc, repo, notificacao } = build();
        repo.transition.mockRejectedValue(new ExcecaoEstadoInvalidoError({ acao: 'SUBSTITUICAO' }));
        const r = await svc.aposentar({
            excecao: EXC_CONTA,
            cadastro: { contas: [contaCadastro({ conta: '1' })] },
        });
        expect(r).toEqual({ aposentada: false, divergiu: false });
        expect(repo.appendAudit).not.toHaveBeenCalled();
        expect(notificacao.emitir).not.toHaveBeenCalled();
    });

    it('erro inesperado da transição sobe', async () => {
        const { svc, repo } = build();
        repo.transition.mockRejectedValue(new Error('banco caiu'));
        await expect(
            svc.aposentar({ excecao: EXC_CONTA, cadastro: { contas: [contaCadastro()] } }),
        ).rejects.toThrow('banco caiu');
    });

    it('I5: falha do alerta não desfaz a aposentadoria (best-effort, vira aviso)', async () => {
        const { svc, notificacao, log } = build();
        notificacao.emitir.mockRejectedValue(new Error('sink fora'));
        const r = await svc.aposentar({ excecao: EXC_CONTA, cadastro: { contas: [] } });
        expect(r).toEqual({ aposentada: true, divergiu: true });
        expect(log.warn).toHaveBeenCalled();
    });
});
