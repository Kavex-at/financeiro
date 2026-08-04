import type { AuthUser } from './auth.js';

/**
 * Per-filial authorization (Regis security-1 / Bass: Authorize Actors).
 *
 * Money-moving multi-filial routes (borderô/baixa/NDe) MUST validate that the acting user is allowed
 * to act on the `filCod` carried in the request body — `requireRole('admin')` alone lets an analyst
 * of SP fire on MG by changing a number. This guard checks the `filiais` allow-list carried on the
 * authenticated user against the target `filCod`.
 *
 * MINIMAL GUARD (documented gap): the current Supabase JWT only carries `sub`/`email`/`role` — there
 * is NO per-filial claim yet and no `app_user_filial` table. Until one exists (JWT claim
 * `permissions.filiais: number[]` OR a DB relation — see ontology follow-up), this guard reads an
 * OPTIONAL `filiais` allow-list off the user. Policy:
 *  - user has a `filiais` list → allow ONLY the listed filiais (deny otherwise);
 *  - user has NO list (claim not provisioned yet) → allow (backwards-compatible with today's tokens,
 *    role gate still applies) but the seam is in place for the real claim to lock it down with ONE
 *    change and no route edits.
 * The same tactic should be replicated on the SISPAG money-moving routes for parity.
 */
export interface FilialScopedUser extends AuthUser {
    /** Allow-list of filiais the user may act on. Absent = not provisioned yet (see docstring). */
    filiais?: number[];
}

export class FilialForbiddenError extends Error {
    public readonly statusCode: number = 403;
    public readonly code: string = 'FILIAL_NAO_AUTORIZADA';

    constructor(filCod: number) {
        super(`user not authorized to act on filial ${filCod}`);
        this.name = 'FilialForbiddenError';
    }
}

/** Reads the (optional) per-filial allow-list off an authenticated user. */
export const filiaisPermitidas = (user: FilialScopedUser | undefined): number[] | undefined => {
    if (!user) return undefined;
    return Array.isArray(user.filiais) ? user.filiais : undefined;
};

/**
 * Returns `true` when `user` may act on `filCod`. No allow-list provisioned → `true` (see docstring).
 */
export const userCanActOnFilial = (user: FilialScopedUser | undefined, filCod: number): boolean => {
    if (!user) return false;
    const permitidas = filiaisPermitidas(user);
    if (permitidas === undefined) return true;
    return permitidas.includes(filCod);
};

/** Throws `FilialForbiddenError` (403) when the user may not act on `filCod`. */
export const assertUserCanActOnFilial = (
    user: FilialScopedUser | undefined,
    filCod: number,
): void => {
    if (!userCanActOnFilial(user, filCod)) {
        throw new FilialForbiddenError(filCod);
    }
};
