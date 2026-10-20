import type { BoletoDda } from '../../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../../interface/sispag/SispagInterface.js';
import CodigoBarrasSintetico from '../../../libs/boleto/CodigoBarrasSintetico.js';

type TituloFixture = Partial<TituloAPagar> & { vencimentoCivil?: string };
type BoletoFixture = Partial<BoletoDda> & { banco?: string; serie?: number };

/**
 * Casos canônicos do boleto agrupado (I19, ADR-0076). Códigos de barras SINTÉTICOS
 * (`CodigoBarrasSintetico`): nenhum boleto real no repositório (I17j). Chaves e valores dos casos
 * de PRD/HML (PEDRONI, AR SOLUÇÕES, 333111) servem só de rótulo.
 */
export default class FixturesGrupoBoleto {
    /** Data civil → epoch-ms à meia-noite UTC (forma do `titDtaVencimento` do ERP). */
    public static utc = (civil: string): number => Date.parse(`${civil}T00:00:00Z`);

    public static titulo = (over: TituloFixture = {}): TituloAPagar => {
        const { vencimentoCivil, ...resto } = over;
        return {
            filCod: 2,
            docCod: '1',
            titCod: '1',
            pesCod: '9001',
            credor: 'CREDOR TESTE',
            valor: 525,
            vencimento: FixturesGrupoBoleto.utc(vencimentoCivil ?? '2026-10-21'),
            liberado: true,
            pago: false,
            temBoleto: false,
            formaPagamentoConexos: 6,
            ativo: true,
            ...resto,
        };
    };

    public static boleto = (over: BoletoFixture = {}): BoletoDda => {
        const { banco, serie, ...resto } = over;
        const valor = resto.valor ?? 1575;
        const vencimento = resto.vencimento ?? '2026-10-21';
        return {
            ddcCod: 900,
            ditCod: 1,
            numero: '1',
            valor,
            vencimento,
            codbar: CodigoBarrasSintetico.barras({
                valor,
                vencimento,
                ...(banco ? { banco } : {}),
                // Série de 3 dígitos: varia o código sem mexer na conta emissora (mesmo `emissorChave`).
                serie: serie ?? (resto.ditCod ?? 1) % 1000,
            }),
            ...resto,
        };
    };

    /** PEDRONI fil 2: 38883/38884/38885 (3 × R$ 525,00, venc. 21/10) → boleto 332841 R$ 1.575,00. */
    public static pedroni = (): { titulos: TituloAPagar[]; boletos: BoletoDda[] } => ({
        titulos: ['38883', '38884', '38885'].map((docCod) =>
            FixturesGrupoBoleto.titulo({ docCod, credor: 'PEDRONI' }),
        ),
        boletos: [FixturesGrupoBoleto.boleto({ ditCod: 332841, numero: '332841' })],
    });

    /** PEDRONI intercambiável (I19f): 3 boletos de R$ 1.575,00 × 9 títulos de R$ 525,00. */
    public static pedroniIntercambiavel = (): {
        titulos: TituloAPagar[];
        boletos: BoletoDda[];
    } => ({
        titulos: Array.from({ length: 9 }, (_, i) =>
            FixturesGrupoBoleto.titulo({ docCod: String(38883 + i), credor: 'PEDRONI' }),
        ),
        boletos: [332843, 332841, 332842].map((ditCod) =>
            FixturesGrupoBoleto.boleto({ ditCod, numero: String(ditCod) }),
        ),
    });

    /** HML AR SOLUÇÕES: 552/1 + 558/1 → R$ 2.346,94 (borderô 252, lote flp 48, gar 7). */
    public static arSolucoes = (): { titulos: TituloAPagar[]; boletos: BoletoDda[] } => ({
        titulos: [
            FixturesGrupoBoleto.titulo({
                docCod: '552',
                pesCod: '7300',
                credor: 'AR SOLUCOES',
                valor: 1200,
                vencimentoCivil: '2026-10-23',
            }),
            FixturesGrupoBoleto.titulo({
                docCod: '558',
                pesCod: '7300',
                credor: 'AR SOLUCOES',
                valor: 1146.94,
                vencimentoCivil: '2026-10-23',
            }),
        ],
        boletos: [
            FixturesGrupoBoleto.boleto({
                ddcCod: 77,
                ditCod: 252,
                valor: 2346.94,
                vencimento: '2026-10-23',
            }),
        ],
    });

    /** Caso 333111: títulos vencem 25/10, boleto 26/10 — não sugerido; manual com aviso. */
    public static caso333111 = (): { titulos: TituloAPagar[]; boletos: BoletoDda[] } => ({
        titulos: ['501', '502'].map((docCod) =>
            FixturesGrupoBoleto.titulo({
                docCod,
                pesCod: '9333',
                valor: 500,
                vencimentoCivil: '2026-10-25',
            }),
        ),
        boletos: [
            FixturesGrupoBoleto.boleto({
                ditCod: 333111,
                numero: '333111',
                valor: 1000,
                vencimento: '2026-10-26',
            }),
        ],
    });
}
