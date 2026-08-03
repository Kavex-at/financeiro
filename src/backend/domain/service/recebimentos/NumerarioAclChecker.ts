import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import LogService from '../LogService.js';

/** Resultado do pré-flight de ACL — `ok` libera; senão `motivo` explica (403 na rota). */
export interface NumerarioAclResult {
    ok: boolean;
    motivo?: string;
}

/**
 * Ações que a conta de serviço PRECISA ter no `com297`/famílias fiscais para rodar o numerário REAL
 * (spec §"ACL da conta de serviço"). Comparação por SUBSTRING case-insensitive contra os textos de
 * permissão devolvidos pelo ERP — o shape exato de `permissoes/new/com297` não foi confirmado por HAR,
 * então casamos por rótulo, não por estrutura rígida.
 */
const ACL_REQUERIDAS: readonly string[] = [
    'com300', // UPDATE fiscal
    'com131', // GERAR OBS
    'com297', // HOMOLOGAR / HOMOLOGAR CONTINGENCIA
    'com194', // SELECT validações
];

/**
 * NumerarioAclChecker — pré-flight FAIL-CLOSED da ACL da conta de serviço antes de qualquer escrita do
 * numerário REAL. Consulta `GET /api/permissoes/new/com297` e verifica que os grants exigidos
 * (com300 UPDATE, com131 GERAR OBS, com297 HOMOLOGAR + CONTINGENCIA, com194 SELECT) estão presentes.
 *
 * O shape da resposta é INCERTO (sem HAR): então o checker é DEFENSIVO — serializa a resposta e casa os
 * rótulos por substring; um 401/403 na própria consulta vira `ok:false` (fail-closed) e é logado. Gate
 * de rota (`NDE_ACL_PREFLIGHT`) decide se roda; aqui só respondemos ok/motivo. Ver spec fiscal §ACL.
 */
@injectable()
export default class NumerarioAclChecker {
    constructor(
        @inject(ConexosBaseClient) private base: ConexosBaseClient,
        @inject(LogService) private logService: LogService,
    ) {}

    public verificar = async (params: { filCod: number }): Promise<NumerarioAclResult> => {
        const { filCod } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.getGeneric<unknown>('permissoes/new/com297', { filCod });
            const texto = JSON.stringify(raw ?? {}).toLowerCase();
            const faltando = ACL_REQUERIDAS.filter((k) => !texto.includes(k.toLowerCase()));
            if (faltando.length > 0) {
                const motivo = `service account missing ACL grants for: ${faltando.join(', ')}`;
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'numerário ACL preflight DENIED (missing grants)',
                    data: { filCod, faltando },
                });
                return { ok: false, motivo };
            }
            return { ok: true };
        } catch (cause) {
            // Fail-closed: 401/403 (ou qualquer falha) na consulta de permissões NEGA a escrita.
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'numerário ACL preflight FAILED (fail-closed) — escrita bloqueada',
                data: {
                    filCod,
                    erro: cause instanceof Error ? cause.message : String(cause),
                },
            });
            return { ok: false, motivo: 'ACL preflight failed (fail-closed)' };
        }
    };
}
