import { inject, injectable } from 'tsyringe';
import ConexosGedClient from '../../client/ConexosGedClient.js';
import { type ArquivoGed, DOC_TIP_PAGAR } from '../../interface/sispag/GedArquivo.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { ChaveTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import {
    FONTE_TITULO_DPS,
    STATUS_TITULO_DPS,
    type TituloDps,
} from '../../interface/sispag/TituloDps.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import Clock from '../../libs/clock/Clock.js';
import ExtratorTextoPdf from '../../libs/pdf/ExtratorTextoPdf.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import TituloDpsRepository from '../../repository/sispag/TituloDpsRepository.js';
import LogService from '../LogService.js';
import BoletoSuggestionService from './BoletoSuggestionService.js';
import LeituraDanfse from './LeituraDanfse.js';
import SelecaoLeituraDps from './SelecaoLeituraDps.js';

/** O motivo gravado é para o operador; não precisa da pilha nem de corpo de resposta. */
const MAX_MOTIVO = 300;

const digitos = (texto?: string): string => (texto ?? '').replace(/\D/g, '').replace(/^0+/, '');
const ehPdf = (a: ArquivoGed): boolean =>
    (a.tipo ?? '').toUpperCase() === 'PDF' || /\.pdf$/i.test(a.nome);

export interface ResultadoLeituraDps {
    alvos: number;
    lidos: number;
    semPdf: number;
    semDps: number;
    erros: number;
}

type Leitura = Omit<TituloDps, 'filCod' | 'docCod' | 'titCod' | 'fonte'>;

/**
 * Leitor do DPS (ADR-0073, D2): para os títulos que a ordem de DPS não resolveu, abre o GED do
 * documento a pagar no Conexos (o mesmo caminho do `psq014`), baixa o PDF da NFS-e, lê
 * "NÚMERO DA DPS" e grava em `titulo_dps`. SÓ LEITURA no Conexos (I15b). Cada título é tratado
 * isoladamente: falha de um vira `ERRO` com motivo e não interrompe os outros. A sugestão passa a
 * usar o DPS no próximo cálculo do cenário (âncora direta e prova do escopo, I15p).
 */
@injectable()
export default class LeitorDpsService {
    public constructor(
        @inject(BoletoSuggestionService) private readonly sugestao: BoletoSuggestionService,
        @inject(TituloDpsRepository) private readonly dpsRepo: TituloDpsRepository,
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(ConexosGedClient) private readonly ged: ConexosGedClient,
        @inject(ExtratorTextoPdf) private readonly extrator: ExtratorTextoPdf,
        @inject(LeituraDanfse) private readonly danfse: LeituraDanfse,
        @inject(SelecaoLeituraDps) private readonly selecao: SelecaoLeituraDps,
        @inject(Clock) private readonly clock: Clock,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public executar = async (params: { limite: number }): Promise<ResultadoLeituraDps> => {
        const [desfechos, tentativas] = await Promise.all([
            this.sugestao.desfechosAgora(),
            this.dpsRepo.listarTentativas(),
        ]);
        const alvos = this.selecao.selecionar(
            desfechos,
            tentativas,
            this.clock.now(),
            params.limite,
        );
        const resultado: ResultadoLeituraDps = {
            alvos: alvos.length,
            lidos: 0,
            semPdf: 0,
            semDps: 0,
            erros: 0,
        };
        for (const chave of alvos) {
            const titulo = await this.tituloRepo.buscarPorChave(chave);
            if (!titulo) continue; // saiu da carteira entre a seleção e a leitura
            const leitura = await this.lerComSeguranca(titulo);
            await this.dpsRepo.registrar({
                filCod: chave.filCod,
                docCod: chave.docCod,
                titCod: chave.titCod,
                fonte: FONTE_TITULO_DPS.PDF_GED,
                ...leitura,
            });
            this.contar(resultado, leitura);
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'leitura de DPS concluída',
            data: { ...resultado },
        });
        return resultado;
    };

    private lerComSeguranca = async (titulo: TituloAPagar): Promise<Leitura> => {
        try {
            return await this.ler(titulo);
        } catch (err: unknown) {
            const status = (err as { response?: { status?: number } }).response?.status;
            const msg = err instanceof Error ? err.message : String(err);
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao ler o PDF da NFS-e no GED',
                data: { ...this.chaveDe(titulo), status: status ?? null },
            });
            return {
                status: STATUS_TITULO_DPS.ERRO,
                motivo: `${status ? `HTTP ${status}: ` : ''}${msg}`.slice(0, MAX_MOTIVO),
            };
        }
    };

    private ler = async (titulo: TituloAPagar): Promise<Leitura> => {
        const base = {
            ...(titulo.pesCod ? { pesCod: titulo.pesCod } : {}),
            ...(titulo.numeroDocumento ? { nfse: titulo.numeroDocumento } : {}),
        };
        const doc = { filCod: titulo.filCod, docCod: titulo.docCod, docTip: DOC_TIP_PAGAR };
        const priCod = await this.ged.priCodDoDocumento(doc);
        if (priCod === undefined) {
            return {
                ...base,
                status: STATUS_TITULO_DPS.SEM_PDF,
                motivo: 'documento sem processo',
            };
        }
        const arquivos: ArquivoGed[] = [];
        for (const pasta of await this.ged.pastasDoDocumento({ ...doc, priCod })) {
            arquivos.push(...(await this.ged.arquivosDaPasta(pasta.dcmCod, doc)));
        }
        const escolha = this.escolherPdf(arquivos.filter(ehPdf), titulo.numeroDocumento);
        if ('motivo' in escolha) {
            return { ...base, status: STATUS_TITULO_DPS.SEM_PDF, motivo: escolha.motivo };
        }
        const pdf = escolha.arquivo;
        const bytes = await this.ged.baixarArquivo({
            dcmCod: pdf.dcmCod,
            adfCodSeq: pdf.adfCodSeq,
            filCod: titulo.filCod,
        });
        const lido = this.danfse.ler(await this.extrator.extrair(bytes));
        if (!lido.dps) {
            return { ...base, status: STATUS_TITULO_DPS.SEM_DPS_NO_PDF, arquivo: pdf.nome };
        }
        const nfseTitulo = digitos(titulo.numeroDocumento);
        if (lido.nfse && nfseTitulo && digitos(lido.nfse) !== nfseTitulo) {
            return {
                ...base,
                status: STATUS_TITULO_DPS.ERRO,
                arquivo: pdf.nome,
                motivo: `NFS-e do PDF (${lido.nfse}) diferente da do título (${titulo.numeroDocumento})`,
            };
        }
        return {
            ...base,
            ...(lido.nfse ? { nfse: lido.nfse } : {}),
            dps: lido.dps,
            status: STATUS_TITULO_DPS.LIDO,
            arquivo: pdf.nome,
        };
    };

    /** O PDF cujo nome traz o nº da NFS-e; sem ele, o único PDF da pasta; senão, nenhum. */
    private escolherPdf = (
        pdfs: ArquivoGed[],
        nfse?: string,
    ): { arquivo: ArquivoGed } | { motivo: string } => {
        const alvo = digitos(nfse);
        const pelaNota = alvo
            ? pdfs.find((a) => (a.nome.match(/\d+/g) ?? []).some((n) => digitos(n) === alvo))
            : undefined;
        if (pelaNota) return { arquivo: pelaNota };
        const [unico] = pdfs;
        if (pdfs.length === 1 && unico) return { arquivo: unico };
        return {
            motivo:
                pdfs.length === 0
                    ? 'nenhum PDF no GED do processo'
                    : `${pdfs.length} PDFs no GED e nenhum com o nº da NFS-e no nome`,
        };
    };

    private contar = (r: ResultadoLeituraDps, leitura: Leitura): void => {
        if (leitura.status === STATUS_TITULO_DPS.LIDO) r.lidos += 1;
        else if (leitura.status === STATUS_TITULO_DPS.SEM_PDF) r.semPdf += 1;
        else if (leitura.status === STATUS_TITULO_DPS.SEM_DPS_NO_PDF) r.semDps += 1;
        else r.erros += 1;
    };

    private chaveDe = (t: TituloAPagar): ChaveTitulo => ({
        filCod: t.filCod,
        docCod: t.docCod,
        titCod: t.titCod,
    });
}
