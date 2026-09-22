import 'reflect-metadata';
import DebitDateOutsideWindowError from '../../errors/DebitDateOutsideWindowError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import DebitDateService from './DebitDateService.js';

/** Vencimento como o ERP grava: 15:00Z do dia pretendido (o dia UTC é o que vale). */
const venc = (civil: string): number => Date.parse(`${civil}T15:00:00Z`);

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 2,
    docCod: '801',
    titCod: '1',
    credor: 'CRONOS',
    valor: 100,
    vencimento: venc('2026-09-30'),
    modalidade: 'CREDITO_CONTA',
    incluidoPor: 'u1',
    ...over,
});

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 2,
    status: 'FINALIZADO',
    criadoPor: 'u1',
    versao: 3,
    itens: [item()],
    ...over,
});

/** Relógio ao meio-dia de Brasília do dia dado. */
const calendarAt = (civil: string) =>
    BankingCalendar.withClock(() => new Date(`${civil}T15:00:00Z`));

const make = (l: LotePagamento | null = lote(), hoje = '2026-09-22') => {
    const repo = { getLoteComItens: jest.fn().mockResolvedValue(l) };
    return {
        repo,
        service: new DebitDateService(repo as unknown as LotePagamentoRepository, calendarAt(hoje)),
    };
};

describe('DebitDateService', () => {
    describe('getWindow', () => {
        it('vencimento num sábado: max recua para sexta e o limitante é esse título', async () => {
            const { service } = make(
                lote({ itens: [item({ vencimento: venc('2026-09-26'), docCod: '555' })] }),
            );
            const w = await service.getWindow('L1');
            expect(w.hoje).toBe('2026-09-22');
            expect(w.min).toBe('2026-09-22');
            expect(w.max).toBe('2026-09-25');
            expect(w.sugerida).toBe('2026-09-22');
            expect(w.amanha).toBe('2026-09-23');
            expect(w.naoUteis).toEqual([]);
            expect(w.vazia).toBeUndefined();
            expect(w.limitante).toEqual({
                itemId: '2:555:1',
                credor: 'CRONOS',
                documento: '555/1',
                vencimento: '2026-09-26',
            });
        });

        it('dois itens: o vencimento mais cedo define max e limitante', async () => {
            const { service } = make(
                lote({
                    itens: [
                        item({ docCod: '801', vencimento: venc('2026-10-05') }),
                        item({ docCod: '802', credor: 'OUTRO', vencimento: venc('2026-09-29') }),
                    ],
                }),
            );
            const w = await service.getWindow('L1');
            expect(w.max).toBe('2026-09-29');
            expect(w.limitante?.documento).toBe('802/1');
            expect(w.naoUteis).toEqual(['2026-09-26', '2026-09-27']);
        });

        it('item já vencido: janela vazia (titulo_vencido) com limitante', async () => {
            const { service } = make(lote({ itens: [item({ vencimento: venc('2026-09-21') })] }));
            const w = await service.getWindow('L1');
            expect(w.vazia).toEqual({ motivo: 'titulo_vencido' });
            expect(w.limitante?.vencimento).toBe('2026-09-21');
            expect(w.min).toBeUndefined();
            expect(w.max).toBeUndefined();
            expect(w.sugerida).toBeUndefined();
        });

        it('hoje sábado e menor vencimento domingo: sem_dia_util', async () => {
            const { service } = make(
                lote({ itens: [item({ vencimento: venc('2026-09-27') })] }),
                '2026-09-26',
            );
            const w = await service.getWindow('L1');
            expect(w.vazia).toEqual({ motivo: 'sem_dia_util' });
        });

        it('hoje sábado com janela: sugerida é o primeiro dia útil', async () => {
            const { service } = make(lote(), '2026-09-26');
            const w = await service.getWindow('L1');
            expect(w.min).toBe('2026-09-28');
            expect(w.sugerida).toBe('2026-09-28');
            expect(w.amanha).toBe('2026-09-28');
        });

        it('item sem vencimento: titulo_sem_vencimento (fail-closed)', async () => {
            const { service } = make(
                lote({ itens: [item(), item({ docCod: '900', vencimento: undefined })] }),
            );
            const w = await service.getWindow('L1');
            expect(w.vazia).toEqual({ motivo: 'titulo_sem_vencimento' });
            expect(w.limitante?.documento).toBe('900/1');
        });

        it('max no Carnaval (terça 2026-02-17) recua para sexta 2026-02-13', async () => {
            const { service } = make(
                lote({ itens: [item({ vencimento: venc('2026-02-17') })] }),
                '2026-02-10',
            );
            const w = await service.getWindow('L1');
            expect(w.max).toBe('2026-02-13');
        });

        it('vencimento hoje mesmo (dia útil): janela de um dia, sem amanhã', async () => {
            const { service } = make(lote({ itens: [item({ vencimento: venc('2026-09-22') })] }));
            const w = await service.getWindow('L1');
            expect(w.min).toBe('2026-09-22');
            expect(w.max).toBe('2026-09-22');
            expect(w.amanha).toBeUndefined();
        });

        it('lote nativo já criado com data: congelada preenchida e janela ainda reportada', async () => {
            const { service } = make(lote({ nativeFlpCod: 41, dataDebito: '2026-09-23' }));
            const w = await service.getWindow('L1');
            expect(w.congelada).toEqual({
                data: '2026-09-23',
                nativeFlpCod: 41,
                motivo: 'lote_nativo_criado',
            });
            expect(w.min).toBe('2026-09-22');
            expect(w.max).toBe('2026-09-30');
        });

        it('data congelada que já passou: motivo no_passado', async () => {
            const { service } = make(lote({ nativeFlpCod: 41, dataDebito: '2026-09-21' }));
            const w = await service.getWindow('L1');
            expect(w.congelada?.motivo).toBe('no_passado');
        });

        it('lote nativo sem data (legado) não inventa congelada', async () => {
            const { service } = make(lote({ nativeFlpCod: 41 }));
            const w = await service.getWindow('L1');
            expect(w.congelada).toBeUndefined();
        });

        it('lote não FINALIZADO: LoteEstadoInvalidoError', async () => {
            const { service } = make(lote({ status: 'RASCUNHO' }));
            await expect(service.getWindow('L1')).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        });

        it('lote inexistente: LoteEstadoInvalidoError', async () => {
            const { service } = make(null);
            await expect(service.getWindow('LX')).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        });
    });

    describe('validate', () => {
        const alvo = lote({ itens: [item({ vencimento: venc('2026-09-29') })] });

        it('aceita um dia útil dentro da janela', () => {
            const { service } = make();
            expect(service.validate(alvo, '2026-09-24')).toBe('2026-09-24');
        });

        const recusa = (dataDebito: string, motivo: string, l: LotePagamento = alvo) => {
            const { service } = make();
            try {
                service.validate(l, dataDebito);
                throw new Error('deveria ter recusado');
            } catch (e) {
                expect(e).toBeInstanceOf(DebitDateOutsideWindowError);
                expect((e as DebitDateOutsideWindowError).details.motivo).toBe(motivo);
                return e as DebitDateOutsideWindowError;
            }
        };

        it('depois do menor vencimento: depois_do_vencimento, com a janela e o limitante', () => {
            const e = recusa('2026-09-30', 'depois_do_vencimento');
            expect(e.details).toMatchObject({
                dataDebito: '2026-09-30',
                min: '2026-09-22',
                max: '2026-09-29',
            });
            expect(e.details.limitante?.documento).toBe('801/1');
        });

        it('antes de hoje: antes_de_hoje', () => {
            recusa('2026-09-21', 'antes_de_hoje');
        });

        it('sábado dentro do intervalo: nao_util', () => {
            recusa('2026-09-26', 'nao_util');
        });

        it('feriado: nao_util', () => {
            const l = lote({ itens: [item({ vencimento: venc('2026-10-30') })] });
            recusa('2026-10-12', 'nao_util', l);
        });

        it('janela vazia: recusa com o motivo da janela', () => {
            const l = lote({ itens: [item({ vencimento: venc('2026-09-20') })] });
            recusa('2026-09-22', 'titulo_vencido', l);
        });
    });

    describe('resolve', () => {
        it('sem data pedida: usa a sugerida (primeiro dia útil da janela)', () => {
            const { service } = make(lote(), '2026-09-26');
            expect(service.resolve(lote())).toBe('2026-09-28');
        });

        it('sem data pedida e janela vazia: mesma recusa', () => {
            const { service } = make();
            const l = lote({ itens: [item({ vencimento: venc('2026-09-20') })] });
            expect(() => service.resolve(l)).toThrow(DebitDateOutsideWindowError);
        });

        it('com data pedida: valida', () => {
            const { service } = make();
            expect(service.resolve(lote(), '2026-09-23')).toBe('2026-09-23');
            expect(() => service.resolve(lote(), '2026-10-01')).toThrow(
                DebitDateOutsideWindowError,
            );
        });
    });
});
