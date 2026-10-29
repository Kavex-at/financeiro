import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type {
    GrupoBoleto,
    SugestaoGrupoBoleto,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import type { LoteComprometidoRef, TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { DecisaoChaveada, ParVigenteChave } from '../../interface/sispag/SugestaoBoleto.js';
import type { EntradaMotorGrupo } from './MotorGrupoBoleto.js';
import type { GrupoSugeridoChaveado } from './MotorSugestaoBoleto.js';

const chaveTitulo = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

/** O que o cenário do motor de grupos lê do banco (tudo já carregado por quem chama). */
export interface DadosCenarioGrupo {
    titulos: TituloAPagar[];
    boletos: BoletoDda[];
    pares: ParVigenteChave[];
    /** `DecisaoSugestaoBoleto CONFIRMADA` ativas. */
    decisoes: DecisaoChaveada[];
    grupos: GrupoBoleto[];
    /** Títulos com `BloqueioDuplicidade ATIVO`. */
    marcas: Array<{ filCod: number; docCod: string; titCod: string }>;
    /** Títulos em lote `FINALIZADO`/`REMESSA_GERADA`. */
    comprometidos: Array<{ filCod: number; docCod: string; titCod: string } & LoteComprometidoRef>;
}

/**
 * Monta a `EntradaMotorGrupo` do MESMO jeito para a aba de sugestões de grupo (leitura ao vivo,
 * `GrupoBoletoService.sugerir`) e para a carteira de títulos (cenário em cache do
 * `BoletoSuggestionService`, I21v). Puro: sem I/O.
 */
export default class CenarioGrupoBoleto {
    public static montar = (d: DadosCenarioGrupo): EntradaMotorGrupo => {
        const loteComprometido = new Map(
            d.comprometidos.map((c) => [chaveTitulo(c), { id: c.id, status: c.status }] as const),
        );
        return {
            titulos: d.titulos.map((t) => {
                const lote = loteComprometido.get(chaveTitulo(t));
                return lote ? { ...t, loteComprometido: lote } : t;
            }),
            boletos: d.boletos,
            paresVigentes: d.pares.map((p) => ({ pesCod: p.pesCod, emissorChave: p.emissorChave })),
            decisoesConfirmadas: d.decisoes,
            gruposConfirmados: d.grupos.map((g) => ({
                id: g.id,
                ddcCod: g.ddcCod,
                ditCod: g.ditCod,
                titulos: g.titulos,
            })),
            marcasAtivas: d.marcas.map((m) => ({
                filCod: m.filCod,
                docCod: m.docCod,
                titCod: m.titCod,
            })),
        };
    };

    /** Sugestões de grupo → o formato que o motor 1:1 consome (I21v). Só o ponteiro, sem barras. */
    public static paraMotor1a1 = (sugestoes: SugestaoGrupoBoleto[]): GrupoSugeridoChaveado[] =>
        sugestoes.map((s) => ({
            ddcCod: s.ddcCod,
            ditCod: s.ditCod,
            ...(s.numeroBoleto !== undefined ? { numeroBoleto: s.numeroBoleto } : {}),
            nTitulos: s.titulos.length,
            valorBoletoCentavos: s.valorBoletoCentavos,
            confirmavel: s.confirmavel,
            ...(s.motivo !== undefined ? { motivo: s.motivo } : {}),
            titulos: s.titulos.map((t) => ({
                filCod: t.filCod,
                docCod: t.docCod,
                titCod: t.titCod,
            })),
        }));
}
