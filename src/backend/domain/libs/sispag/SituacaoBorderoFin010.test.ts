import { SITUACAO_BORDERO } from '../../interface/permutas/Fin010Baixa.js';
import SituacaoBorderoFin010 from './SituacaoBorderoFin010.js';

/** Combinações medidas no HML em 2026-10-21 (achados T9) e as que não foram vistas. */
describe('SituacaoBorderoFin010.classificar', () => {
    const c = SituacaoBorderoFin010.classificar;

    it('medidas: 0 em cadastro, 1 finalizado, 2 cancelado, 3 + borCodNovo estornado', () => {
        expect(c({ borVldFinalizado: 0, borCodNovo: null })).toBe(SITUACAO_BORDERO.EM_CADASTRO);
        expect(c({ borVldFinalizado: 1 })).toBe(SITUACAO_BORDERO.FINALIZADO);
        expect(c({ borVldFinalizado: 2, borCodNovo: null })).toBe(SITUACAO_BORDERO.CANCELADO);
        expect(c({ borVldFinalizado: 3, borCodNovo: 44 })).toBe(SITUACAO_BORDERO.ESTORNADO);
    });

    it('fail-closed: ausente, desconhecido ou borCodNovo fora do estorno ⇒ indeterminado', () => {
        expect(c({})).toBe(SITUACAO_BORDERO.INDETERMINADO);
        expect(c({ borVldFinalizado: null })).toBe(SITUACAO_BORDERO.INDETERMINADO);
        expect(c({ borVldFinalizado: 4 })).toBe(SITUACAO_BORDERO.INDETERMINADO);
        expect(c({ borVldFinalizado: 3 })).toBe(SITUACAO_BORDERO.INDETERMINADO);
        expect(c({ borVldFinalizado: 2, borCodNovo: 9 })).toBe(SITUACAO_BORDERO.INDETERMINADO);
        expect(c({ borVldFinalizado: 0, borCodNovo: 9 })).toBe(SITUACAO_BORDERO.INDETERMINADO);
    });
});
