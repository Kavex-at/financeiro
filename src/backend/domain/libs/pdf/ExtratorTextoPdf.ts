import { injectable, singleton } from 'tsyringe';

/** PDFs de NFS-e têm 1–2 páginas; o teto protege contra um arquivo errado de centenas de páginas. */
const MAX_PAGINAS = 5;

/** Um trecho de texto do PDF com a posição (pontos; `y` cresce para cima, como no PDF). */
export interface ItemPdf {
    texto: string;
    pagina: number;
    x: number;
    y: number;
}

/**
 * Extrai os trechos de texto de um PDF com o `pdfjs-dist` (build legacy, Node), sem renderizar e
 * sem worker, cada um com página e posição — o leitor do DANFSe (ADR-0073) acha o valor de um
 * rótulo pela posição (mesma linha ou logo abaixo), não pela ordem do texto. O módulo é carregado
 * sob demanda: quem nunca lê PDF não paga o carregamento.
 */
@singleton()
@injectable()
export default class ExtratorTextoPdf {
    public extrair = async (bytes: Uint8Array): Promise<ItemPdf[]> => {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const doc = await pdfjs.getDocument({
            data: new Uint8Array(bytes),
            isEvalSupported: false,
            disableFontFace: true,
            // Só texto: sem as fontes-padrão não há o que renderizar, e o aviso seria ruído.
            verbosity: pdfjs.VerbosityLevel.ERRORS,
        }).promise;
        try {
            const itens: ItemPdf[] = [];
            for (let pagina = 1; pagina <= Math.min(doc.numPages, MAX_PAGINAS); pagina += 1) {
                const conteudo = await (await doc.getPage(pagina)).getTextContent();
                for (const item of conteudo.items) {
                    if (!('str' in item) || item.str.trim() === '') continue;
                    itens.push({
                        texto: item.str.trim(),
                        pagina,
                        x: item.transform[4],
                        y: item.transform[5],
                    });
                }
            }
            return itens;
        } finally {
            await doc.destroy();
        }
    };
}
