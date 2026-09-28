import {
    PERMISSION,
    PERMISSION_CATALOG,
    type Permission,
} from '../../domain/interface/auth/Permission.js';
import type { AcessoRequisicao } from '../acesso.js';

/**
 * `req.acesso` para testes de rota que montam o router sem a cadeia real de auth + acesso
 * (ADR-0053). No app real quem preenche é o `resolverAcesso`.
 */
export class AcessoFixture {
    /** O papel do dia do deploy: as nove permissões. */
    public static readonly administrador = (): AcessoRequisicao =>
        AcessoFixture.com([...PERMISSION_CATALOG]);

    /** Quem só vê as três frentes e as métricas — nenhuma permissão de `executar`. */
    public static readonly somenteLeitura = (): AcessoRequisicao =>
        AcessoFixture.com([
            PERMISSION.PERMUTAS_VER,
            PERMISSION.SISPAG_VER,
            PERMISSION.RECEBIMENTOS_VER,
            PERMISSION.METRICAS_VER,
        ]);

    /**
     * Ponte para os testes escritos antes da ADR-0053, que variavam o `role` do token:
     * `admin` (ou ausente) = Administrador; qualquer outro papel = só leitura.
     */
    public static readonly porPapelLegado = (role?: string): AcessoRequisicao =>
        role === undefined || role === 'admin'
            ? AcessoFixture.administrador()
            : AcessoFixture.somenteLeitura();

    public static readonly com = (permissoes: Permission[]): AcessoRequisicao => ({
        userId: 1,
        papel: { id: 1, nome: 'Administrador' },
        permissoes: new Set<Permission>(permissoes),
    });
}
