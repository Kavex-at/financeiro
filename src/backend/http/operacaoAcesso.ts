import type { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';

/**
 * Recorte de acesso ao Painel de Operação POR USUÁRIO, não por papel (`OPERACAO_USUARIOS`, CSV).
 *
 * `requireRole('admin')` não restringe nada aqui: 12 de 12 contas da plataforma são `admin`
 * (`docs/impacto/h1-permutas-achados.md` §6). Restringir por identidade é o único recorte com
 * efeito real enquanto o RBAC por perfil não existir.
 *
 * **Fail-OPEN, deliberadamente.** Lista vazia = qualquer `admin` entra, que é o comportamento de
 * hoje. O painel é ferramenta de INCIDENTE: uma env ausente ou mal digitada não pode trancar a
 * porta justamente na hora de diagnosticar, e um lockout silencioso durante uma queda é pior do
 * que a exposição que ele evitaria. O `ConfigDoctor` reporta a ausência como
 * `degrada-silenciosamente`, então o buraco fica visível em vez de esquecido.
 *
 * Não substitui `requireRole('admin')` — soma. Os dois ficam na rota.
 */
export const usuarioPodeVerOperacao = (
    username: string | undefined,
    permitidos: readonly string[],
): boolean => {
    if (permitidos.length === 0) return true; // sem allow-list = sem recorte por identidade
    if (username === undefined || username.trim() === '') return false;
    return permitidos.includes(username.trim().toLowerCase());
};

/** 404, não 403: para quem não é do recorte, a tela simplesmente não existe. */
export const requireOperacaoAcesso = () => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
        const username = req.user?.sub ?? req.user?.email;

        if (usuarioPodeVerOperacao(username, env.operacaoUsuarios)) {
            next();
            return;
        }
        // 403 diria "existe e você não pode"; 404 não confirma a existência da rota. Como o
        // recorte é por obscuridade DELIBERADA (o pedido é que o painel não apareça para quem
        // não opera), confirmar a rota entregaria metade do que ele quer esconder.
        res.status(404).json({ error: 'Not found' });
    };
};
