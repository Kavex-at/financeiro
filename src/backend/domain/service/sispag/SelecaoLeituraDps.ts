import { injectable } from 'tsyringe';
import {
    type ChaveTitulo,
    type DesfechoTitulo,
    SITUACAO_SUGESTAO_TITULO,
    type SituacaoSugestaoTitulo,
} from '../../interface/sispag/SugestaoBoleto.js';
import { STATUS_TITULO_DPS, type TentativaDps } from '../../interface/sispag/TituloDps.js';

/** Depois disto, o título que falhou não é mais lido automaticamente. */
export const MAX_TENTATIVAS_DPS = 3;
/** Intervalo mínimo entre tentativas do mesmo título (o PDF pode subir ao GED depois). */
export const INTERVALO_RELEITURA_MS = 12 * 60 * 60 * 1000;

/** O que a ordem de DPS não resolveu (I15p): ambíguo, só informativo ou disputado. */
const SITUACOES_SEM_DESEMPATE: ReadonlySet<SituacaoSugestaoTitulo> = new Set([
    SITUACAO_SUGESTAO_TITULO.AMBIGUA,
    SITUACAO_SUGESTAO_TITULO.SO_FRACA,
    SITUACAO_SUGESTAO_TITULO.DISPUTADA,
]);
/** Boleto de emissor de NFS-e: `<DPS>000`. */
const NUMERO_DPS = /^\d+000$/;

const chave = (t: ChaveTitulo): string => `${t.filCod}:${t.docCod}:${t.titCod}`;

/**
 * Quem precisa da leitura do PDF da NFS-e (D2 do ADR-0073). PURA. Um título entra quando:
 * a sugestão segue sem desempate (`AMBIGUA`, `SO_FRACA`, `DISPUTADA`); ao menos um candidato é de
 * emissor de NFS-e (número `N000`); ainda não há DPS `LIDO`; e, se já falhou, passaram 12 h desde
 * a última tentativa e ela não esgotou as tentativas. Ordem = a dos desfechos (menor vencimento
 * primeiro), cortada no limite da execução.
 */
@injectable()
export default class SelecaoLeituraDps {
    public selecionar = (
        desfechos: DesfechoTitulo[],
        tentativas: TentativaDps[],
        agora: number,
        limite: number,
    ): ChaveTitulo[] => {
        const porTitulo = new Map(tentativas.map((t) => [chave(t), t]));
        const alvos: ChaveTitulo[] = [];
        for (const d of desfechos) {
            if (alvos.length >= limite) break;
            if (!SITUACOES_SEM_DESEMPATE.has(d.situacao)) continue;
            if (!d.candidatos.some((c) => NUMERO_DPS.test(c.numeroBoleto ?? ''))) continue;
            if (!this.podeLer(porTitulo.get(chave(d)), agora)) continue;
            alvos.push({ filCod: d.filCod, docCod: d.docCod, titCod: d.titCod });
        }
        return alvos;
    };

    private podeLer = (t: TentativaDps | undefined, agora: number): boolean => {
        if (!t) return true;
        if (t.status === STATUS_TITULO_DPS.LIDO) return false;
        if (t.tentativas >= MAX_TENTATIVAS_DPS) return false;
        return agora - Date.parse(t.lidoEm) >= INTERVALO_RELEITURA_MS;
    };
}
