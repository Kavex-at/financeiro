import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    CONTA_PAGADORA_DEFAULT,
    type ContaCorrentePagadora,
    ITAU_BNCCOD,
} from '../../interface/sispag/SispagInterface.js';
import LogService from '../LogService.js';

/** Conta pagadora escolhida para um lote: o par que `lote_pagamento` guarda (`banco`, `conta`). */
export interface ContaPagadoraEscolhida {
    banco: string;
    /** `numeroConta-dv`, o mesmo formato que a remessa e o seletor da tela comparam. */
    conta: string;
}

/** `55795-4` — formato único de conta pagadora (lote, seletor da tela e remessa). */
export const formatarContaPagadora = (c: ContaCorrentePagadora): string =>
    `${c.numeroConta}-${c.dvConta ?? ''}`;

/**
 * Decide a conta pagadora de um lote NOVO a partir das contas que a FILIAL realmente tem no
 * `fin005` (G-13). Regra (B9): Itaú é o padrão.
 *
 * - Uma conta Itaú na filial → ela.
 * - Várias → a preferida ({@link CONTA_PAGADORA_DEFAULT}), se estiver entre elas.
 * - Nenhuma, várias sem a preferida, ou `fin005` ilegível → `undefined`: o lote nasce SEM conta
 *   e a analista escolhe (o finalizar recusa lote sem conta). Nunca chuta uma conta de outro
 *   banco nem grava uma que a filial não tem.
 */
@injectable()
export default class ContaPagadoraResolver {
    public constructor(
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public resolverPadrao = async (filCod: number): Promise<ContaPagadoraEscolhida | undefined> => {
        let contas: ContaCorrentePagadora[];
        try {
            contas = await this.sispag.listContasCorrentes(filCod);
        } catch (error) {
            await this.avisar('fin005 ilegível — lote sem conta pagadora', filCod, {
                motivo: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
        const itau = contas.filter((c) => c.bncCod === ITAU_BNCCOD && c.numeroConta !== undefined);
        const escolhida =
            itau.length === 1
                ? itau[0]
                : itau.find((c) => formatarContaPagadora(c) === CONTA_PAGADORA_DEFAULT.conta);
        if (!escolhida) {
            await this.avisar(
                itau.length === 0
                    ? 'filial sem conta Itaú — lote sem conta pagadora'
                    : 'filial com várias contas Itaú, nenhuma é a preferida — lote sem conta pagadora',
                filCod,
                { contasItau: itau.map(formatarContaPagadora), totalContas: contas.length },
            );
            return undefined;
        }
        return { banco: CONTA_PAGADORA_DEFAULT.banco, conta: formatarContaPagadora(escolhida) };
    };

    private avisar = async (
        message: string,
        filCod: number,
        data: Record<string, unknown>,
    ): Promise<void> => {
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message,
            data: { filCod, ...data },
        });
    };
}
