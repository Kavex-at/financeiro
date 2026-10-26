import 'reflect-metadata';
import type { ArquivoRetornoDetalhe } from '../../interface/sispag/Fin052Retorno.js';
import type GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import CasamentoRetornoGrupo from './CasamentoRetornoGrupo.js';

/**
 * A linha do `fin052` do item de BORDERÊ (ADR-0077, I21r, G4 — HML 2026-10-20, gar 7): uma linha
 * (o J) com `filCod/bncCod/flpCod/itsCodSeq` + `borCod`, SEM `docCod/titCod`, sem valor pago e
 * sem `borTimCad`. Casa-se com o grupo pela execução DESTE lote: o `borCod` sozinho pode ter sido
 * reutilizado pelo ERP, então ele só vale conferido com o `bor_cod` da execução do lote.
 */

const TITULOS = ['901', '902', '903'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' }));

const linhaJ = (over: Partial<ArquivoRetornoDetalhe> = {}): ArquivoRetornoDetalhe => ({
    filCod: 2,
    bncCod: 4,
    gtbCodSeq: 1,
    garCodSeq: 7,
    flpCod: 48,
    itsCodSeq: 1,
    eventoCod: '00',
    eventoDescricao: 'PAGAMENTO EFETUADO',
    borCod: 252,
    ...over,
});

const execucao = (over: Record<string, unknown> = {}) => ({
    id: 'E1',
    grupoId: 'G1',
    loteId: 'L1',
    filCod: 2,
    borCod: 252,
    itsCodSeq: 1,
    etapa: 'importado',
    ...over,
});

const make = (execucoes: Array<Record<string, unknown>> = [execucao()]) => {
    const execRepo = { listarPorLote: jest.fn().mockResolvedValue(execucoes) };
    const grupoRepo = {
        buscarPorId: jest.fn(async (id: string) =>
            id === 'G1' ? { id: 'G1', titulos: TITULOS } : null,
        ),
    };
    const service = new CasamentoRetornoGrupo(
        execRepo as unknown as GrupoBoletoExecucaoRepository,
        grupoRepo as unknown as GrupoBoletoRepository,
    );
    return { service, execRepo, grupoRepo };
};

describe('CasamentoRetornoGrupo (I21r, I11i)', () => {
    it('J com borCod e itsCodSeq da execução do lote ⇒ o grupo e os N títulos', async () => {
        const { service, execRepo } = make();
        const r = await service.casar({ loteId: 'L1', linha: linhaJ() });
        expect(r).toEqual({ grupoId: 'G1', execucaoId: 'E1', titulos: TITULOS });
        expect(execRepo.listarPorLote).toHaveBeenCalledWith('L1');
    });

    it('execução sem itsCodSeq gravado: casa só pelo borCod conferido', async () => {
        const { service } = make([execucao({ itsCodSeq: undefined })]);
        expect((await service.casar({ loteId: 'L1', linha: linhaJ() }))?.grupoId).toBe('G1');
    });

    it('borCod que não é o da execução do lote (reutilizado pelo ERP, ou de terceiro) ⇒ não casa', async () => {
        const { service } = make();
        expect(
            await service.casar({ loteId: 'L1', linha: linhaJ({ borCod: 999 }) }),
        ).toBeUndefined();
    });

    it('itsCodSeq diferente do item nativo da execução ⇒ não casa', async () => {
        const { service } = make();
        expect(
            await service.casar({ loteId: 'L1', linha: linhaJ({ itsCodSeq: 9 }) }),
        ).toBeUndefined();
    });

    it('lote sem execução de grupo (ou com outro borCod) ⇒ não casa e não lê grupo nenhum', async () => {
        const { service, grupoRepo } = make([]);
        expect(await service.casar({ loteId: 'L1', linha: linhaJ() })).toBeUndefined();
        expect(grupoRepo.buscarPorId).not.toHaveBeenCalled();
    });

    it('linha de TÍTULO (com docCod) nunca é de grupo: não consulta nada', async () => {
        const { service, execRepo } = make();
        const r = await service.casar({
            loteId: 'L1',
            linha: linhaJ({ docCod: '813', titCod: '1' }),
        });
        expect(r).toBeUndefined();
        expect(execRepo.listarPorLote).not.toHaveBeenCalled();
    });

    it('linha sem borCod ⇒ não casa', async () => {
        const { service } = make();
        expect(
            await service.casar({ loteId: 'L1', linha: linhaJ({ borCod: undefined }) }),
        ).toBeUndefined();
    });

    it('grupo da execução que não existe mais ⇒ não casa (nunca inventa títulos)', async () => {
        const { service } = make([execucao({ grupoId: 'G-SUMIU' })]);
        expect(await service.casar({ loteId: 'L1', linha: linhaJ() })).toBeUndefined();
    });
});
