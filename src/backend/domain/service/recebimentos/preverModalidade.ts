import { PRI_VLD_TIPO_ROTULO } from '../../interface/recebimentos/constants.js';

/**
 * PREVISÃO da modalidade de um crédito ainda não alocado — PURA, sem DI e sem I/O.
 *
 * ## Por que "previsão" e não "modalidade"
 *
 * A modalidade (`imp021.priVldTipo`) pertence ao PROCESSO, não ao crédito. Um crédito do extrato só
 * ganha uma quando o analista o aloca. Antes disso, o máximo honesto é olhar os processos abertos do
 * cliente que aparenta ter pago e dizer "provavelmente esta".
 *
 * ## Por que a ambiguidade não vira maioria
 *
 * Cliente NÃO determina modalidade. Medido na carteira real (5.755 processos, 2026-08-10):
 * PERNOD RICARD tem 204 processos POR ENCOMENDA e 2 PRÓPRIA; SKECHERS tem 469 CONTA E ORDEM e 1
 * PRÓPRIA. Escolher a maioria acertaria ~99% e erraria exatamente nos casos raros — que são os
 * fiscalmente delicados, porque a modalidade decide se sai uma Nota de Débito irreversível.
 *
 * Então: modalidade única entre os processos abertos do cliente → prevê. Mais de uma → devolve
 * `ambigua` e a coluna mostra "—". Um "—" honesto custa ao analista abrir o modal; um rótulo errado
 * custa uma nota indevida.
 *
 * ## O que esta previsão NÃO é
 *
 * Ela **nunca** decide emissão. Quem decide é o gate 0.5, no servidor, lendo o `imp021` do processo
 * efetivamente escolhido (ADR-0031 D3). Isto aqui é dica de tela — o mesmo estatuto de
 * `contraparte`.
 */

/** Um processo aberto, reduzido ao que a previsão precisa. */
export interface ProcessoParaPrevisao {
    pesCod: number;
    /** Nome do cliente no ERP (`dpeNomPessoa`). */
    dpeNomPessoa: string;
    priVldTipo?: number;
}

export interface ModalidadePrevista {
    priVldTipo: number;
    rotulo: string;
}

/**
 * Normalização de nome para casamento: caixa, acentos, pontuação e sufixos societários fora.
 *
 * O histórico do banco vem TRUNCADO em ~24 caracteres (`"TED 745.0001.BROWN-FORMA"`), então o
 * casamento é por prefixo, não por igualdade — e o sufixo societário some porque o extrato quase
 * nunca chega a ele.
 */
const normalizar = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\b(LTDA|S\/A|SA|S\.A|EIRELI|ME|EPP|COMPANY|CO)\b/g, ' ')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();

/** Comprimento mínimo do casamento por prefixo. */
const MIN_PREFIXO = 6;

/**
 * Índice cliente → modalidades, construído UMA vez por lote de transações.
 *
 * Construir por transação seria O(transações × processos) — com 500 créditos e 5.755 processos, meio
 * milhão de comparações de string por request.
 */
export class IndiceModalidadePorCliente {
    private readonly porNome: Array<{ nome: string; tipos: Set<number> }>;

    public constructor(processos: ProcessoParaPrevisao[]) {
        const agrupado = new Map<string, Set<number>>();
        for (const p of processos) {
            if (p.priVldTipo === undefined) continue;
            const nome = normalizar(p.dpeNomPessoa);
            if (nome.length < MIN_PREFIXO) continue;
            const set = agrupado.get(nome) ?? new Set<number>();
            set.add(p.priVldTipo);
            agrupado.set(nome, set);
        }
        this.porNome = [...agrupado].map(([nome, tipos]) => ({ nome, tipos }));
    }

    /**
     * Prevê a modalidade a partir da contraparte do extrato.
     *
     * Devolve `undefined` quando: não há contraparte, nenhum cliente casa, mais de um cliente casa
     * (o prefixo truncado é ambíguo), ou o cliente casado tem processos de mais de uma modalidade.
     * Os quatro casos viram "—" na tela — a distinção entre eles não muda o que o analista faz.
     */
    public prever = (contraparte?: string): ModalidadePrevista | undefined => {
        if (!contraparte) return undefined;
        const alvo = normalizar(contraparte);
        if (alvo.length < MIN_PREFIXO) return undefined;

        const casados = this.porNome.filter(
            (c) => c.nome.startsWith(alvo) || alvo.startsWith(c.nome),
        );
        // Prefixo curto casando com dois clientes distintos não é previsão, é sorteio.
        if (casados.length !== 1) return undefined;

        const tipos = casados[0]?.tipos;
        if (tipos === undefined || tipos.size !== 1) return undefined;

        const priVldTipo = [...tipos][0] as number;
        return { priVldTipo, rotulo: PRI_VLD_TIPO_ROTULO[priVldTipo] ?? `Tipo ${priVldTipo}` };
    };
}
