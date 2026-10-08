import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import AuthorizedPayeeActiveExistsError from '../../errors/AuthorizedPayeeActiveExistsError.js';
import AuthorizedPayeeVersionConflictError from '../../errors/AuthorizedPayeeVersionConflictError.js';
import PayeeApprovalBySolicitorError from '../../errors/PayeeApprovalBySolicitorError.js';
import PayeeDestinationChangedSinceShownError from '../../errors/PayeeDestinationChangedSinceShownError.js';
import PayeeReapprovalNotConfirmedError from '../../errors/PayeeReapprovalNotConfirmedError.js';
import PayeeWithoutPaymentDataError from '../../errors/PayeeWithoutPaymentDataError.js';
import type { AuthorizedPayee } from '../../interface/sispag/AuthorizedPayeeInterface.js';
import type {
    ChavePixFavorecido,
    ContaFavorecido,
} from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AuthorizedPayeeRule from '../../libs/sispag/AuthorizedPayeeRule.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import PayeeFingerprint from '../../libs/sispag/PayeeFingerprint.js';
import type AuthorizedPayeeRepository from '../../repository/sispag/AuthorizedPayeeRepository.js';
import type LogService from '../LogService.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import AuthorizedPayeeService, { chaveDoPar } from './AuthorizedPayeeService.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';

const CHAVE_HMAC = 'k'.repeat(32);
const CONTA_COMPLETA = '87654321';

const conta = (over: Partial<ContaFavorecido> = {}): ContaFavorecido => ({
    pctCodSeq: 10,
    banco: 237,
    agencia: '1234',
    conta: CONTA_COMPLETA,
    dvConta: '0',
    padrao: true,
    ...over,
});

const chaveEmail: ChavePixFavorecido = {
    cixCod: 5,
    chave: 'fornecedor@empresa.com.br',
    tipo: 'EMAIL',
    padrao: true,
    pesCod: '7001',
};

const registro = (over: Partial<AuthorizedPayee> = {}): AuthorizedPayee => ({
    id: 'a1',
    pesCod: '7001',
    credor: 'ACME',
    modalidade: 'TED',
    estado: 'PENDENTE',
    avisos: [],
    origemSolicitacao: 'MANUAL',
    filCodLeitura: 1,
    solicitadoPor: 'ana',
    solicitadoEm: '2026-10-08T10:00:00.000Z',
    versao: 1,
    ...over,
});

interface Montagem {
    contas?: ContaFavorecido[];
    chaves?: ChavePixFavorecido[];
    documento?: string;
    falhaLeitura?: boolean;
    enabled?: boolean;
    ted?: boolean;
    registros?: AuthorizedPayee[];
}

const montar = (m: Montagem = {}) => {
    const envVars = {
        sispagFavorecidoAutorizadoEnabled: m.enabled ?? true,
        sispagTedEnabled: m.ted ?? true,
        sispagPixEnabled: true,
        sispagFavorecidoFingerprintKey: CHAVE_HMAC,
        sispagFavorecidoFingerprintKeyId: 'v1',
    };
    const env = { getEnvironmentVars: async () => envVars } as unknown as EnvironmentProvider;
    const falha = Object.assign(new Error(`conta ${CONTA_COMPLETA} indisponível`), {
        response: { status: 503 },
    });
    const sispag = {
        listContasFavorecido: m.falhaLeitura
            ? jest.fn().mockRejectedValue(falha)
            : jest.fn().mockResolvedValue(m.contas ?? [conta()]),
        listChavesPixFavorecido: m.falhaLeitura
            ? jest.fn().mockRejectedValue(falha)
            : jest.fn().mockResolvedValue(m.chaves ?? []),
        getDocumentoFavorecido: jest.fn().mockResolvedValue(m.documento),
    };
    const resolver = new DestinoPagamentoResolver(sispag as never, new MaskDestino());
    const fingerprint = new PayeeFingerprint(env);
    const banco = new Map((m.registros ?? []).map((r) => [r.id, { ...r }]));
    const repo = {
        buscarVigente: jest.fn(
            async (pesCod: string, modalidade: string) =>
                [...banco.values()].find(
                    (r) =>
                        r.pesCod === pesCod &&
                        r.modalidade === modalidade &&
                        ['PENDENTE', 'AUTORIZADO', 'REAPROVACAO_PENDENTE'].includes(r.estado),
                ) ?? null,
        ),
        buscarPorId: jest.fn(async (id: string) => banco.get(id) ?? null),
        listar: jest.fn(async () => [...banco.values()]),
        listarVigentesPorPesCods: jest.fn(async (pesCods: string[]) =>
            [...banco.values()].filter(
                (r) =>
                    pesCods.includes(r.pesCod) &&
                    ['PENDENTE', 'AUTORIZADO', 'REAPROVACAO_PENDENTE'].includes(r.estado),
            ),
        ),
        inserir: jest.fn(async (input: Record<string, unknown>) => {
            const id = `novo-${banco.size + 1}`;
            banco.set(
                id,
                registro({
                    id,
                    pesCod: String(input.pesCod),
                    modalidade: input.modalidade as 'TED',
                    solicitadoPor: String(input.solicitadoPor),
                    origemSolicitacao: input.origemSolicitacao as 'ITEM',
                }),
            );
            return id;
        }),
        atualizarComVersao: jest.fn(
            async (id: string, versao: number, patch: Record<string, unknown>) => {
                const r = banco.get(id);
                if (!r || r.versao !== versao) return 0;
                const limpo = Object.fromEntries(
                    Object.entries(patch).map(([k, v]) => [
                        k,
                        v === null ? undefined : v instanceof Date ? v.toISOString() : v,
                    ]),
                );
                banco.set(id, { ...r, ...limpo, versao: r.versao + 1 } as AuthorizedPayee);
                return 1;
            },
        ),
        registrarEvento: jest.fn().mockResolvedValue('ev'),
        listarEventos: jest.fn().mockResolvedValue([]),
    };
    const notificacao = { emitir: jest.fn().mockResolvedValue(null) };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const db = { withTransaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
    const service = new AuthorizedPayeeService(
        repo as unknown as AuthorizedPayeeRepository,
        new AuthorizedPayeeRule(),
        resolver,
        fingerprint,
        notificacao as unknown as NotificacaoService,
        env,
        db as unknown as PostgreeDatabaseClient,
        logService as unknown as LogService,
    );
    const eventos = () => repo.registrarEvento.mock.calls.map(([e]) => e);
    const fpDe = async (destino: Parameters<PayeeFingerprint['calcular']>[0]) =>
        (await fingerprint.calcular(destino)).fingerprint;
    return { service, repo, banco, notificacao, logService, sispag, eventos, fpDe };
};

const FP_CONTA = {
    tipo: 'TED' as const,
    banco: '237',
    agencia: '1234',
    conta: CONTA_COMPLETA,
    contaDv: '0',
};

describe('AuthorizedPayeeService — solicitar (F1/F5)', () => {
    it('F1: sem vigente cria PENDENTE com o ator autenticado e evento SOLICITADO', async () => {
        const { service, eventos } = montar();
        const r = await service.solicitar({
            pesCod: '7001',
            modalidade: 'TED',
            origem: 'RELATORIO',
            filCod: 2,
            ator: 'ana',
        });
        expect(r).toMatchObject({ estado: 'PENDENTE', solicitadoPor: 'ana' });
        expect(eventos()).toEqual([
            expect.objectContaining({
                evento: 'SOLICITADO',
                ator: 'ana',
                dados: { origem: 'RELATORIO' },
            }),
        ]);
    });

    it('PENDENTE já vigente → 409, nada gravado', async () => {
        const { service, repo } = montar({ registros: [registro()] });
        await expect(
            service.solicitar({
                pesCod: '7001',
                modalidade: 'TED',
                origem: 'ITEM',
                filCod: 1,
                ator: 'bia',
            }),
        ).rejects.toBeInstanceOf(AuthorizedPayeeActiveExistsError);
        expect(repo.inserir).not.toHaveBeenCalled();
    });

    it('F5: REAPROVACAO_PENDENTE é confirmada (grava o solicitante, evento CONFIRMADO)', async () => {
        const { service, eventos } = montar({
            registros: [
                registro({ estado: 'REAPROVACAO_PENDENTE', solicitadoPor: undefined, versao: 4 }),
            ],
        });
        const r = await service.solicitar({
            pesCod: '7001',
            modalidade: 'TED',
            origem: 'ITEM',
            filCod: 1,
            ator: 'carla',
        });
        expect(r).toMatchObject({
            estado: 'REAPROVACAO_PENDENTE',
            solicitadoPor: 'carla',
            versao: 5,
        });
        expect(eventos().map((e) => e.evento)).toEqual(['CONFIRMADO']);
    });
});

describe('AuthorizedPayeeService — aprovar (F2/F6)', () => {
    it('F2: lê o cmn025, confere a impressão mostrada e grava fingerprint + keyId + máscara', async () => {
        const { service, eventos, fpDe } = montar({ registros: [registro()] });
        const fp = await fpDe(FP_CONTA);
        const r = await service.aprovar({
            id: 'a1',
            fingerprintMostrado: fp,
            versao: 1,
            ator: 'bia',
        });
        expect(r).toMatchObject({
            estado: 'AUTORIZADO',
            fingerprint: fp,
            fingerprintChaveId: 'v1',
            destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
            decididoPor: 'bia',
            ultimaConferenciaResultado: 'IGUAL',
        });
        expect(eventos()).toEqual([
            expect.objectContaining({
                evento: 'APROVADO',
                ator: 'bia',
                dados: expect.objectContaining({
                    destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
                }),
            }),
        ]);
    });

    it('aprovador = solicitante (id autenticado) → 403, nada gravado', async () => {
        const { service, repo, fpDe } = montar({ registros: [registro()] });
        await expect(
            service.aprovar({
                id: 'a1',
                fingerprintMostrado: await fpDe(FP_CONTA),
                versao: 1,
                ator: 'ana',
            }),
        ).rejects.toBeInstanceOf(PayeeApprovalBySolicitorError);
        expect(repo.atualizarComVersao).not.toHaveBeenCalled();
    });

    it('destino mudou desde que a tela mostrou → 409', async () => {
        const { service } = montar({ registros: [registro()] });
        await expect(
            service.aprovar({ id: 'a1', fingerprintMostrado: 'outra', versao: 1, ator: 'bia' }),
        ).rejects.toBeInstanceOf(PayeeDestinationChangedSinceShownError);
    });

    it('cmn025 sem conta → PayeeWithoutPaymentDataError', async () => {
        const { service } = montar({ contas: [], registros: [registro()] });
        await expect(
            service.aprovar({ id: 'a1', fingerprintMostrado: 'x', versao: 1, ator: 'bia' }),
        ).rejects.toBeInstanceOf(PayeeWithoutPaymentDataError);
    });

    it('F6 sem pedido confirmado → PayeeReapprovalNotConfirmedError', async () => {
        const { service, fpDe } = montar({
            registros: [
                registro({
                    estado: 'REAPROVACAO_PENDENTE',
                    solicitadoPor: undefined,
                    fingerprint: 'velho',
                    fingerprintChaveId: 'v1',
                }),
            ],
        });
        await expect(
            service.aprovar({
                id: 'a1',
                fingerprintMostrado: await fpDe(FP_CONTA),
                versao: 1,
                ator: 'bia',
            }),
        ).rejects.toBeInstanceOf(PayeeReapprovalNotConfirmedError);
    });

    it('versão divergente → 409 de conflito', async () => {
        const { service } = montar({ registros: [registro({ versao: 3 })] });
        await expect(
            service.aprovar({ id: 'a1', fingerprintMostrado: 'x', versao: 2, ator: 'bia' }),
        ).rejects.toBeInstanceOf(AuthorizedPayeeVersionConflictError);
    });

    it('PIX com chave que não é o documento do favorecido: aprova com aviso', async () => {
        const { service, fpDe } = montar({
            chaves: [chaveEmail],
            registros: [registro({ modalidade: 'PIX' })],
        });
        const fp = await fpDe({ tipo: 'PIX', chaveTipo: 'EMAIL', chave: chaveEmail.chave });
        const r = await service.aprovar({
            id: 'a1',
            fingerprintMostrado: fp,
            versao: 1,
            ator: 'bia',
        });
        expect(r.avisos).toEqual(['PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO']);
    });
});

describe('AuthorizedPayeeService — rejeitar/revogar (F3/F7)', () => {
    it('rejeitar grava motivo, decisor e evento', async () => {
        const { service, eventos } = montar({ registros: [registro()] });
        const r = await service.rejeitar({
            id: 'a1',
            motivo: ' conta de terceiro ',
            versao: 1,
            ator: 'bia',
        });
        expect(r).toMatchObject({
            estado: 'REJEITADO',
            motivoDecisao: 'conta de terceiro',
            decididoPor: 'bia',
        });
        expect(eventos()[0]).toMatchObject({
            evento: 'REJEITADO',
            dados: { de: 'PENDENTE', motivo: 'conta de terceiro' },
        });
    });

    it('revogar sem motivo recusa; com motivo vai a REVOGADO', async () => {
        const { service } = montar({
            registros: [
                registro({ estado: 'AUTORIZADO', fingerprint: 'f', fingerprintChaveId: 'v1' }),
            ],
        });
        await expect(
            service.revogar({ id: 'a1', motivo: '', versao: 1, ator: 'bia' }),
        ).rejects.toThrow();
        const r = await service.revogar({
            id: 'a1',
            motivo: 'fornecedor encerrado',
            versao: 1,
            ator: 'bia',
        });
        expect(r.estado).toBe('REVOGADO');
    });
});

describe('AuthorizedPayeeService — verificarDestinoAutorizado (I14d)', () => {
    it('OK com AUTORIZADO e impressão igual; uma leitura por par e uma consulta de autorizações', async () => {
        const base = montar();
        const fp = await base.fpDe(FP_CONTA);
        const { service, repo, sispag } = montar({
            registros: [
                registro({ estado: 'AUTORIZADO', fingerprint: fp, fingerprintChaveId: 'v1' }),
            ],
        });
        const r = await service.verificarDestinoAutorizado([
            { pesCod: '7001', modalidade: 'TED', filCod: 1 },
            { pesCod: '7001', modalidade: 'TED', filCod: 1 },
        ]);
        expect(r.get(chaveDoPar('7001', 'TED'))).toEqual({
            resultado: 'OK',
            autorizacaoId: 'a1',
            destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
        });
        expect(repo.listarVigentesPorPesCods).toHaveBeenCalledTimes(1);
        expect(sispag.listContasFavorecido).toHaveBeenCalledTimes(1);
    });

    it('sem autorização → FAVORECIDO_NAO_AUTORIZADO; sem dado → SEM_DADO_PAGAMENTO', async () => {
        const a = montar();
        expect(
            (
                await a.service.verificarDestinoAutorizado([
                    { pesCod: '7001', modalidade: 'TED', filCod: 1 },
                ])
            ).get('7001:TED')?.resultado,
        ).toBe('FAVORECIDO_NAO_AUTORIZADO');
        const b = montar({ contas: [] });
        expect(
            (
                await b.service.verificarDestinoAutorizado([
                    { pesCod: '7001', modalidade: 'TED', filCod: 1 },
                ])
            ).get('7001:TED')?.resultado,
        ).toBe('SEM_DADO_PAGAMENTO');
    });

    it('DESTINO_ALTERADO aplica F4: grava observado, limpa solicitante, evento e alerta deduplicado', async () => {
        const { service, banco, eventos, notificacao } = montar({
            registros: [
                registro({
                    estado: 'AUTORIZADO',
                    fingerprint: 'impressao-antiga',
                    fingerprintChaveId: 'v1',
                    destinoMascarado: 'banco 341 · ag. 1 · cc ****9999-1',
                    decididoEm: '2026-10-08T11:00:00.000Z',
                }),
            ],
        });
        const r = await service.verificarDestinoAutorizado([
            { pesCod: '7001', modalidade: 'TED', filCod: 1 },
        ]);
        expect(r.get('7001:TED')?.resultado).toBe('DESTINO_ALTERADO');
        const depois = banco.get('a1');
        expect(depois).toMatchObject({
            estado: 'REAPROVACAO_PENDENTE',
            destinoObservadoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
            ultimaConferenciaResultado: 'DIFERENTE',
        });
        expect(depois?.solicitadoPor).toBeUndefined();
        expect(eventos()).toEqual([
            expect.objectContaining({
                evento: 'REAPROVACAO_ABERTA',
                ator: 'sistema',
                dados: {
                    antes: 'banco 341 · ag. 1 · cc ****9999-1',
                    agora: 'banco 237 · ag. 1234 · cc ****4321-0',
                },
            }),
        ]);
        expect(notificacao.emitir).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo: 'sispag-destino-alterado',
                alvo: 'favorecido:7001:TED',
            }),
        );
    });

    it('FALHA_LEITURA não altera estado nem emite alerta (I14f)', async () => {
        const { service, repo, notificacao } = montar({
            falhaLeitura: true,
            registros: [
                registro({ estado: 'AUTORIZADO', fingerprint: 'f', fingerprintChaveId: 'v1' }),
            ],
        });
        const r = await service.verificarDestinoAutorizado([
            { pesCod: '7001', modalidade: 'TED', filCod: 1 },
        ]);
        expect(r.get('7001:TED')?.resultado).toBe('FALHA_LEITURA');
        expect(repo.atualizarComVersao).not.toHaveBeenCalled();
        expect(notificacao.emitir).not.toHaveBeenCalled();
    });

    it('flag TED desligada: TED não passa (o envio usaria outra conta), PIX segue verificado', async () => {
        const { service, sispag } = montar({ ted: false, chaves: [chaveEmail] });
        const r = await service.verificarDestinoAutorizado([
            { pesCod: '7001', modalidade: 'TED', filCod: 1 },
            { pesCod: '7001', modalidade: 'PIX', filCod: 1 },
        ]);
        expect(r.get('7001:TED')?.resultado).toBe('FAVORECIDO_NAO_AUTORIZADO');
        expect(r.get('7001:PIX')?.resultado).toBe('FAVORECIDO_NAO_AUTORIZADO');
        expect(sispag.listContasFavorecido).not.toHaveBeenCalled();
        expect(sispag.listChavesPixFavorecido).toHaveBeenCalledTimes(1);
    });

    it('guarda desligada no tenant (I14k): todo par é FAVORECIDO_NAO_AUTORIZADO, sem ler o Conexos', async () => {
        const { service, sispag, repo } = montar({ enabled: false });
        const r = await service.verificarDestinoAutorizado([
            { pesCod: '7001', modalidade: 'PIX', filCod: 1 },
        ]);
        expect(r.get('7001:PIX')?.resultado).toBe('FAVORECIDO_NAO_AUTORIZADO');
        expect(sispag.listChavesPixFavorecido).not.toHaveBeenCalled();
        expect(repo.listarVigentesPorPesCods).not.toHaveBeenCalled();
    });
});

describe('AuthorizedPayeeService — reconferir e revelar', () => {
    it('reconferir AUTORIZADO igual → IGUAL + evento CONFERIDO; devolve o destino atual mascarado e a impressão', async () => {
        const base = montar();
        const fp = await base.fpDe(FP_CONTA);
        const { service, eventos } = montar({
            registros: [
                registro({ estado: 'AUTORIZADO', fingerprint: fp, fingerprintChaveId: 'v1' }),
            ],
        });
        const r = await service.reconferir('a1', 'carla');
        expect(r.autorizacao.ultimaConferenciaResultado).toBe('IGUAL');
        expect(r.atual).toEqual({
            resultado: 'OK',
            destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
            fingerprint: fp,
            avisos: [],
        });
        expect(eventos()[0]).toMatchObject({
            evento: 'CONFERIDO',
            ator: 'carla',
            dados: { resultado: 'IGUAL' },
        });
    });

    it('reconferir com destino diferente abre a reaprovação (F4)', async () => {
        const { service } = montar({
            registros: [
                registro({ estado: 'AUTORIZADO', fingerprint: 'velho', fingerprintChaveId: 'v1' }),
            ],
        });
        const r = await service.reconferir('a1', 'carla');
        expect(r.autorizacao.estado).toBe('REAPROVACAO_PENDENTE');
    });

    it('revelar devolve o destino completo SÓ na resposta; trilha e logs nunca têm o valor', async () => {
        const { service, eventos, logService } = montar({ registros: [registro()] });
        const r = await service.revelar('a1', 'bia');
        expect(r.destino).toMatchObject({ tipo: 'TED', conta: CONTA_COMPLETA });
        expect(eventos()).toEqual([
            expect.objectContaining({
                evento: 'DESTINO_REVELADO',
                dados: { destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0' },
            }),
        ]);
        expect(JSON.stringify(eventos())).not.toContain(CONTA_COMPLETA);
        expect(JSON.stringify(logService.info.mock.calls)).not.toContain(CONTA_COMPLETA);
    });

    it('nenhum caminho põe o destino completo no LogService (inclusive a falha de leitura)', async () => {
        const a = montar({ falhaLeitura: true, registros: [registro()] });
        await a.service.verificarDestinoAutorizado([
            { pesCod: '7001', modalidade: 'TED', filCod: 1 },
        ]);
        await a.service.reconferir('a1', 'carla');
        const b = montar({
            registros: [
                registro({ estado: 'AUTORIZADO', fingerprint: 'x', fingerprintChaveId: 'v1' }),
            ],
        });
        await b.service.verificarDestinoAutorizado([
            { pesCod: '7001', modalidade: 'TED', filCod: 1 },
        ]);
        for (const m of [a, b]) {
            const tudo = JSON.stringify([
                m.logService.info.mock.calls,
                m.logService.warn.mock.calls,
                m.logService.error.mock.calls,
                m.notificacao.emitir.mock.calls,
                m.repo.registrarEvento.mock.calls,
            ]);
            expect(tudo).not.toContain(CONTA_COMPLETA);
        }
        expect(JSON.stringify(a.logService.warn.mock.calls)).toContain('HTTP 503');
    });
});
