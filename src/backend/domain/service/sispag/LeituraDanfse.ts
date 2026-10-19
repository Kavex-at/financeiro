import { injectable } from 'tsyringe';
import type { ItemPdf } from '../../libs/pdf/ExtratorTextoPdf.js';

/** Valor logo abaixo do rótulo: até esta distância vertical (pontos). */
const MAX_DISTANCIA_ABAIXO = 20;
/** …e alinhado à esquerda com o rótulo, com esta folga horizontal. */
const TOLERANCIA_COLUNA = 15;
/** Valor na mesma linha: mesma linha de base (±) e até esta distância à direita. */
const TOLERANCIA_LINHA = 2;
const MAX_DISTANCIA_DIREITA = 250;

const ROTULO_DPS = /^numero da dps\b/;
const ROTULO_NFSE = /^numero da nfs-?e\b/;
const NUMERO = /^\d{1,15}$/;
/** Número logo depois do rótulo no mesmo trecho (`Número da DPS: 25459`); data não casa. */
const NUMERO_APOS_ROTULO = /^\s*[:-]?\s*(\d{1,15})(?![\d/])/;

const normalizar = (texto: string): string =>
    texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** O que o DANFSe diz do documento. Campo ausente = não achado (nunca adivinhado). */
export interface LeituraDanfseResultado {
    dps?: string;
    nfse?: string;
}

/**
 * Lê "NÚMERO DA DPS" e "NÚMERO DA NFS-e" do DANFSe (ADR-0073, I15p) a partir dos trechos de texto
 * posicionados do PDF. PURA. O valor de um rótulo é, nesta ordem: o número no próprio trecho
 * (`Número da DPS: 25459`), o número logo abaixo e alinhado (layout em colunas e empilhado), ou o
 * primeiro número à direita na mesma linha. Data, série e números de outra coluna não casam.
 */
@injectable()
export default class LeituraDanfse {
    public ler = (itens: ItemPdf[]): LeituraDanfseResultado => {
        const dps = this.valorDe(itens, ROTULO_DPS);
        const nfse = this.valorDe(itens, ROTULO_NFSE);
        return { ...(dps ? { dps } : {}), ...(nfse ? { nfse } : {}) };
    };

    private valorDe = (itens: ItemPdf[], rotulo: RegExp): string | undefined => {
        for (const r of itens) {
            const texto = normalizar(r.texto);
            const m = rotulo.exec(texto);
            if (!m) continue;
            const valor =
                NUMERO_APOS_ROTULO.exec(texto.slice(m[0].length))?.[1] ??
                this.abaixo(itens, r) ??
                this.aDireita(itens, r);
            if (valor) return valor;
        }
        return undefined;
    };

    private abaixo = (itens: ItemPdf[], r: ItemPdf): string | undefined =>
        itens
            .filter(
                (i) =>
                    i.pagina === r.pagina &&
                    NUMERO.test(i.texto) &&
                    r.y - i.y > 0 &&
                    r.y - i.y <= MAX_DISTANCIA_ABAIXO &&
                    Math.abs(i.x - r.x) <= TOLERANCIA_COLUNA,
            )
            .sort((a, b) => b.y - a.y)[0]?.texto;

    private aDireita = (itens: ItemPdf[], r: ItemPdf): string | undefined =>
        itens
            .filter(
                (i) =>
                    i.pagina === r.pagina &&
                    NUMERO.test(i.texto) &&
                    Math.abs(i.y - r.y) <= TOLERANCIA_LINHA &&
                    i.x > r.x &&
                    i.x - r.x <= MAX_DISTANCIA_DIREITA,
            )
            .sort((a, b) => a.x - b.x)[0]?.texto;
}
