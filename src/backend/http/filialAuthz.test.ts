import {
    FilialForbiddenError,
    assertUserCanActOnFilial,
    filiaisPermitidas,
    userCanActOnFilial,
} from './filialAuthz.js';

describe('filialAuthz (security-1)', () => {
    it('allows a filCod that is in the user allow-list', () => {
        expect(userCanActOnFilial({ sub: 'u', filiais: [1, 4] }, 4)).toBe(true);
        expect(() => assertUserCanActOnFilial({ sub: 'u', filiais: [1, 4] }, 4)).not.toThrow();
    });

    it('denies a filCod outside the user allow-list', () => {
        expect(userCanActOnFilial({ sub: 'u', filiais: [1, 2] }, 9)).toBe(false);
        expect(() => assertUserCanActOnFilial({ sub: 'u', filiais: [1, 2] }, 9)).toThrow(
            FilialForbiddenError,
        );
    });

    it('allows any filCod when no allow-list is provisioned (documented gap)', () => {
        expect(userCanActOnFilial({ sub: 'u' }, 9)).toBe(true);
        expect(filiaisPermitidas({ sub: 'u' })).toBeUndefined();
    });

    it('denies when there is no user at all', () => {
        expect(userCanActOnFilial(undefined, 4)).toBe(false);
        expect(() => assertUserCanActOnFilial(undefined, 4)).toThrow(FilialForbiddenError);
    });

    it('FilialForbiddenError carries a 403 statusCode + code', () => {
        const err = new FilialForbiddenError(7);
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('FILIAL_NAO_AUTORIZADA');
    });
});
