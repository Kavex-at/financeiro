import { injectable } from 'tsyringe';
import {
    FORNECEDOR_ORIGEM,
    FORNECEDOR_ORIGEM_PRIORIDADE,
    type EvidenciaConta,
    type MapeamentoConta,
} from '../../interface/sispag/FornecedorContaBoleto.js';

/**
 * Transforma as evidências (boleto × fornecedor) no mapeamento conta → fornecedor. PURA.
 *
 * Por chave, vale só a origem MAIS confiável que tem evidência: um vínculo/decisão vence qualquer
 * quantidade de inferências. Dentro dela, 2+ fornecedores distintos tornam a chave AMBÍGUA — não
 * se nomeia, nunca se escolhe por maioria. Inferência com menos de `EVIDENCIAS_MINIMAS_INFERIDO`
 * boletos não nomeia nada (ADR-0081).
 */
/**
 * Boletos distintos (por barras) que uma INFERÊNCIA precisa para nomear a conta. Uma coincidência
 * de valor e dia pode ser acaso; duas, de boletos diferentes, já são padrão. Vínculo do Conexos e
 * decisão da analista valem a partir de 1 (Regis-Review 2026-10-30, P1).
 */
export const EVIDENCIAS_MINIMAS_INFERIDO = 2;

@injectable()
export default class ConsolidacaoFornecedorConta {
    public consolidar = (evidencias: EvidenciaConta[]): MapeamentoConta[] => {
        const porChave = new Map<string, EvidenciaConta[]>();
        for (const e of evidencias) {
            const lista = porChave.get(e.chave);
            if (lista) lista.push(e);
            else porChave.set(e.chave, [e]);
        }
        const mapeamentos: MapeamentoConta[] = [];
        for (const [chave, lista] of porChave) {
            const origem = FORNECEDOR_ORIGEM_PRIORIDADE.find((o) =>
                lista.some((e) => e.origem === o),
            );
            if (origem === undefined) continue;
            const doTier = lista.filter((e) => e.origem === origem);
            const fornecedores = new Set(doTier.map((e) => e.pesCod));
            const base = {
                chave,
                origem,
                evidencias: new Set(doTier.map((e) => e.boleto)).size,
                ultimaEvidenciaEm: new Date(Math.max(...doTier.map((e) => e.vistoEm.getTime()))),
            };
            if (
                origem === FORNECEDOR_ORIGEM.INFERIDO &&
                base.evidencias < EVIDENCIAS_MINIMAS_INFERIDO
            ) {
                continue;
            }
            const [unico] = [...fornecedores];
            if (fornecedores.size !== 1 || unico === undefined) {
                mapeamentos.push({ ...base, ambiguo: true });
                continue;
            }
            const credor = this.nomeMaisComum(doTier.filter((e) => e.pesCod === unico));
            mapeamentos.push({
                ...base,
                pesCod: unico,
                ...(credor ? { credor } : {}),
                ambiguo: false,
            });
        }
        return mapeamentos.sort((a, b) => a.chave.localeCompare(b.chave));
    };

    /** O nome mais frequente; empate → o visto mais recentemente. */
    private nomeMaisComum = (evidencias: EvidenciaConta[]): string | undefined => {
        const nomes = new Map<string, { n: number; recente: number }>();
        for (const e of evidencias) {
            const nome = e.credor?.trim();
            if (!nome) continue;
            const atual = nomes.get(nome) ?? { n: 0, recente: 0 };
            nomes.set(nome, {
                n: atual.n + 1,
                recente: Math.max(atual.recente, e.vistoEm.getTime()),
            });
        }
        return [...nomes.entries()].sort(
            ([, a], [, b]) => b.n - a.n || b.recente - a.recente,
        )[0]?.[0];
    };
}
