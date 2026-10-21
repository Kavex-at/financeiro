import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { EstadoVivoGrupo, GrupoBoleto } from '../../interface/sispag/GrupoBoletoInterface.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { EtapaBordero } from './EtapaBorderoGrupo.js';
import type { ExecucaoParaSituacao } from './SituacaoGrupoBoleto.js';

/** O que a situação precisa de uma linha do ledger do borderô (`GrupoBoletoExecucao`). */
export interface ExecucaoLida {
    criadoEm: Date;
    escritaIniciadaEm?: Date;
    etapa: EtapaBordero;
    jRejeitadoEm?: Date;
}

/**
 * EstadoVivoGrupoBoleto — montagem PURA das entradas da I19u e da situação derivada a partir do
 * que foi lido (pool DDA, carteira, ledger). Fonte única para a listagem de grupos
 * (`GrupoBoletoService.listar`, leitura em lote) e para o lote/formação (`LeituraGrupoBoleto`,
 * leitura pontual): os dois decidem órfão e situação com a mesma régua (ADR-0076).
 */
export default class EstadoVivoGrupoBoleto {
    /**
     * I19u: `boleto` ausente = saiu do pool; título ausente (ou `null`) = saiu da carteira. O
     * vínculo do ERP no boleto vem só quando presente. Títulos na ordem do grupo.
     */
    public static montar = (
        grupo: GrupoBoleto,
        boleto: BoletoDda | null | undefined,
        tituloDe: (c: {
            filCod: number;
            docCod: string;
            titCod: string;
        }) => TituloAPagar | null | undefined,
    ): EstadoVivoGrupo => {
        const titulos = grupo.titulos.flatMap((t) => {
            const c = tituloDe(t);
            if (!c) return [];
            return [
                {
                    filCod: t.filCod,
                    docCod: t.docCod,
                    titCod: t.titCod,
                    pago: c.pago,
                    ativo: c.ativo !== false,
                    ...(c.temBoleto !== undefined ? { temBoleto: c.temBoleto } : {}),
                },
            ];
        });
        if (!boleto) return { titulos };
        return {
            boleto: {
                ...(boleto.filCod != null ? { filCod: boleto.filCod } : {}),
                ...(boleto.docCod ? { docCod: boleto.docCod } : {}),
                ...(boleto.titCod ? { titCod: boleto.titCod } : {}),
            },
            titulos,
        };
    };

    /** Execuções do ledger na forma da `SituacaoGrupoBoleto` (início = `t0`, senão a criação). */
    public static execucoes = (lidas: readonly ExecucaoLida[]): ExecucaoParaSituacao[] =>
        lidas.map((x) => ({
            iniciadaEm: new Date(x.escritaIniciadaEm ?? x.criadoEm).getTime(),
            etapa: x.etapa,
            ...(x.jRejeitadoEm ? { jRejeitadoEm: new Date(x.jRejeitadoEm).getTime() } : {}),
        }));
}
