import { injectable } from 'tsyringe';

/** Título visto pelo pareamento por ordem. `nfse` = `doc_esp_numero`. */
export interface TituloOrdem {
    chave: string;
    pesCod?: string;
    nfse?: string;
    /**
     * DPS lido do PDF: o título casa pela âncora direta (I15p(1)), não entra na ordem, não disputa
     * outros boletos, e o boleto `<dps>000` sai da ordem.
     */
    dps?: string;
}

/** Boleto livre visto pelo pareamento por ordem. */
export interface BoletoOrdem {
    chave: string;
    emissorChave?: string;
    numero?: string;
}

/** Ponto de prova de um escopo: (NFS-e, DPS) lido de um PDF que casou um boleto do emissor. */
export interface ProvaDps {
    pesCod: string;
    emissorChave: string;
    nfse: number;
    dps: number;
}

export interface EntradaOrdemDps {
    titulos: TituloOrdem[];
    boletos: BoletoOrdem[];
    /** Arestas de candidato do motor (par dentro do envelope, não rejeitado, não ocupado). */
    candidatos: ReadonlyMap<string, readonly string[]>;
    provas: ProvaDps[];
}

/** Número inteiro estrito (sem sinal, sem separador), seguro em `Number`. */
const INTEIRO = /^\d{1,15}$/;
/** Número de boleto de emissor de NFS-e: `<DPS>000`. */
const NUMERO_DPS = /^(\d{1,15})000$/;

const inteiro = (texto?: string): number | undefined => {
    const t = (texto ?? '').trim();
    return INTEIRO.test(t) ? Number(t) : undefined;
};

/** DPS embutido no número do boleto (`<DPS>000`), ou `undefined` fora do formato. */
const dpsDoBoleto = (numero?: string): number | undefined => {
    const m = NUMERO_DPS.exec((numero ?? '').trim());
    return m?.[1] ? Number(m[1].replace(/^0+(?=\d)/, '')) : undefined;
};

const escopo = (pesCod: string, emissorChave: string): string => `${pesCod}|${emissorChave}`;

/**
 * Âncora DPS por ordem (I15p(2), ADR-0073). PURA: sem I/O, sem relógio.
 *
 * O emissor de NFS-e numera o boleto como `<DPS>000`, e DPS e NFS-e são duas sequências
 * crescentes do mesmo estabelecimento. Num escopo (credor, emissor) PROVADO por um DPS lido de PDF,
 * um grupo conexo de candidatos com tantos títulos quanto boletos se resolve pela ordem: o k-ésimo
 * título por NFS-e casa com o k-ésimo boleto por número. Na dúvida, não pareia (o título vai para a
 * leitura do PDF):
 *  - contagens diferentes, título sem NFS-e, boleto fora de `N000`;
 *  - boleto do grupo que também é candidato de título de fora do grupo;
 *  - par que cruza um ponto de prova do escopo (NFS-e maior com DPS menor, ou vice-versa);
 *  - par da ordem que não é aresta de candidato (fora do envelope).
 */
@injectable()
export default class AncoraOrdemDps {
    /**
     * Pontos de prova: cada DPS lido cujo `<DPS>000` aparece no pool (livre ou já vinculado pelo
     * ERP) prova o escopo (credor, emissor daquele boleto).
     */
    public provas = (
        lidos: ReadonlyArray<{ pesCod?: string; nfse?: string; dps: string }>,
        pool: ReadonlyArray<{ numero?: string; emissorChave?: string }>,
    ): ProvaDps[] => {
        const emissoresPorDps = new Map<number, Set<string>>();
        for (const b of pool) {
            const dps = dpsDoBoleto(b.numero);
            if (dps === undefined || !b.emissorChave) continue;
            const emissores = emissoresPorDps.get(dps) ?? new Set<string>();
            emissores.add(b.emissorChave);
            emissoresPorDps.set(dps, emissores);
        }
        const provas: ProvaDps[] = [];
        for (const l of lidos) {
            const nfse = inteiro(l.nfse);
            const dps = inteiro(l.dps);
            if (!l.pesCod || nfse === undefined || dps === undefined) continue;
            for (const emissorChave of emissoresPorDps.get(dps) ?? []) {
                provas.push({ pesCod: l.pesCod, emissorChave, nfse, dps });
            }
        }
        return provas;
    };

    /** Pares `tituloChave|boletoChave` ancorados pela ordem. */
    public parear = (entrada: EntradaOrdemDps): Set<string> => {
        const pares = new Set<string>();
        const provasPorEscopo = this.provasPorEscopo(entrada.provas);
        if (provasPorEscopo.size === 0) return pares;
        const arestas = this.arestasOrdenaveis(entrada, provasPorEscopo);
        const disputantes = this.disputantes(entrada);
        const tituloPorChave = new Map(entrada.titulos.map((t) => [t.chave, t]));
        const boletoPorChave = new Map(entrada.boletos.map((b) => [b.chave, b]));
        for (const grupo of this.componentes(arestas)) {
            const ordem = this.resolverGrupo(grupo, {
                arestas,
                disputantes,
                tituloPorChave,
                boletoPorChave,
            });
            for (const [t, b] of ordem) pares.add(`${t}|${b}`);
        }
        return pares;
    };

    private provasPorEscopo = (provas: ProvaDps[]): Map<string, ProvaDps[]> => {
        const porEscopo = new Map<string, ProvaDps[]>();
        for (const p of provas) {
            const k = escopo(p.pesCod, p.emissorChave);
            porEscopo.set(k, [...(porEscopo.get(k) ?? []), p]);
        }
        return porEscopo;
    };

    /**
     * Arestas que podem entrar na ordem: título com NFS-e e sem DPS lido; boleto `N000` de escopo
     * provado, cujo DPS não é de outro título; par coerente com todas as provas do escopo.
     */
    private arestasOrdenaveis = (
        entrada: EntradaOrdemDps,
        provasPorEscopo: ReadonlyMap<string, ProvaDps[]>,
    ): Map<string, Set<string>> => {
        const boletoPorChave = new Map(entrada.boletos.map((b) => [b.chave, b]));
        const dpsLidos = new Set(entrada.titulos.map((t) => inteiro(t.dps)));
        const arestas = new Map<string, Set<string>>();
        for (const t of entrada.titulos) {
            const nfse = inteiro(t.nfse);
            if (!t.pesCod || t.dps || nfse === undefined) continue;
            const pesCod = t.pesCod;
            const doTitulo = new Set(
                (entrada.candidatos.get(t.chave) ?? []).filter((bChave) => {
                    const b = boletoPorChave.get(bChave);
                    const dps = dpsDoBoleto(b?.numero);
                    if (!b?.emissorChave || dps === undefined || dpsLidos.has(dps)) return false;
                    const provas = provasPorEscopo.get(escopo(pesCod, b.emissorChave)) ?? [];
                    return provas.length > 0 && provas.every((p) => this.coerente(nfse, dps, p));
                }),
            );
            if (doTitulo.size > 0) arestas.set(t.chave, doTitulo);
        }
        return arestas;
    };

    /**
     * Quem disputa cada boleto, pelas arestas COMPLETAS do motor (inclui título sem NFS-e). Título
     * com DPS lido não disputa: o boleto dele é só o `<dps>000`.
     */
    private disputantes = (entrada: EntradaOrdemDps): Map<string, Set<string>> => {
        const comDps = new Set(entrada.titulos.filter((t) => t.dps).map((t) => t.chave));
        const disputantes = new Map<string, Set<string>>();
        for (const [tChave, bChaves] of entrada.candidatos) {
            if (comDps.has(tChave)) continue;
            for (const b of bChaves) {
                const ts = disputantes.get(b) ?? new Set<string>();
                ts.add(tChave);
                disputantes.set(b, ts);
            }
        }
        return disputantes;
    };

    /** Pareamento k-ésimo × k-ésimo do grupo, ou nenhum par quando qualquer guarda falha. */
    private resolverGrupo = (
        grupo: Grupo,
        ctx: {
            arestas: ReadonlyMap<string, ReadonlySet<string>>;
            disputantes: ReadonlyMap<string, ReadonlySet<string>>;
            tituloPorChave: ReadonlyMap<string, TituloOrdem>;
            boletoPorChave: ReadonlyMap<string, BoletoOrdem>;
        },
    ): Array<readonly [string, string]> => {
        if (grupo.titulos.size !== grupo.boletos.size) return [];
        const deFora = [...grupo.boletos].some((b) =>
            [...(ctx.disputantes.get(b) ?? [])].some((t) => !grupo.titulos.has(t)),
        );
        if (deFora) return [];
        const porNfse = [...grupo.titulos]
            .map((chave) => ({ chave, n: inteiro(ctx.tituloPorChave.get(chave)?.nfse) ?? -1 }))
            .sort((x, y) => x.n - y.n);
        const porDps = [...grupo.boletos]
            .map((chave) => ({
                chave,
                n: dpsDoBoleto(ctx.boletoPorChave.get(chave)?.numero) ?? -1,
            }))
            .sort((x, y) => x.n - y.n);
        if (this.repetido(porNfse) || this.repetido(porDps)) return [];
        const ordem = porNfse.map((t, k) => [t.chave, porDps[k]?.chave ?? ''] as const);
        return ordem.every(([t, b]) => ctx.arestas.get(t)?.has(b)) ? ordem : [];
    };

    /** Mesma ordem dos dois lados da prova; na própria NFS-e da prova, só o próprio DPS. */
    private coerente = (nfse: number, dps: number, p: ProvaDps): boolean =>
        Math.sign(nfse - p.nfse) === Math.sign(dps - p.dps);

    private repetido = (itens: Array<{ n: number }>): boolean =>
        itens.some((x, i) => i > 0 && itens[i - 1]?.n === x.n);

    /** Componentes conexos do grafo bipartido título–boleto, em ordem determinística. */
    private componentes = (arestas: ReadonlyMap<string, ReadonlySet<string>>): Grupo[] => {
        const titulosDoBoleto = new Map<string, string[]>();
        for (const [t, bs] of arestas) {
            for (const b of bs) titulosDoBoleto.set(b, [...(titulosDoBoleto.get(b) ?? []), t]);
        }
        const visitados = new Set<string>();
        const grupos: Grupo[] = [];
        for (const inicio of [...arestas.keys()].sort()) {
            if (visitados.has(inicio)) continue;
            grupos.push(this.explorar(inicio, arestas, titulosDoBoleto, visitados));
        }
        return grupos;
    };

    /** Busca em largura a partir de um título; marca os títulos visitados. */
    private explorar = (
        inicio: string,
        arestas: ReadonlyMap<string, ReadonlySet<string>>,
        titulosDoBoleto: ReadonlyMap<string, string[]>,
        visitados: Set<string>,
    ): Grupo => {
        const grupo: Grupo = { titulos: new Set<string>(), boletos: new Set<string>() };
        const fila = [inicio];
        visitados.add(inicio);
        while (fila.length > 0) {
            const t = fila.pop() ?? '';
            grupo.titulos.add(t);
            const novos = [...(arestas.get(t) ?? [])].filter((b) => !grupo.boletos.has(b));
            for (const b of novos) grupo.boletos.add(b);
            const vizinhos = new Set(
                novos
                    .flatMap((b) => titulosDoBoleto.get(b) ?? [])
                    .filter((outro) => !visitados.has(outro)),
            );
            for (const outro of vizinhos) {
                visitados.add(outro);
                fila.push(outro);
            }
        }
        return grupo;
    };
}

/** Componente conexo do grafo de candidatos ordenáveis. */
interface Grupo {
    titulos: Set<string>;
    boletos: Set<string>;
}
