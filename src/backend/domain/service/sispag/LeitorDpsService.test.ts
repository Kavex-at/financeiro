import 'reflect-metadata';
import type ConexosGedClient from '../../client/ConexosGedClient.js';
import type { ArquivoGed } from '../../interface/sispag/GedArquivo.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { DesfechoTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import type { TituloDps } from '../../interface/sispag/TituloDps.js';
import type Clock from '../../libs/clock/Clock.js';
import type ExtratorTextoPdf from '../../libs/pdf/ExtratorTextoPdf.js';
import type { ItemPdf } from '../../libs/pdf/ExtratorTextoPdf.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type TituloDpsRepository from '../../repository/sispag/TituloDpsRepository.js';
import type LogService from '../LogService.js';
import type BoletoSuggestionService from './BoletoSuggestionService.js';
import LeitorDpsService from './LeitorDpsService.js';
import LeituraDanfse from './LeituraDanfse.js';
import SelecaoLeituraDps from './SelecaoLeituraDps.js';

const DESFECHO_41155 = {
    filCod: 2,
    docCod: '41155',
    titCod: '1',
    situacao: 'SO_FRACA',
    candidatos: [{ numeroBoleto: '776132000' }, { numeroBoleto: '776138000' }],
} as unknown as DesfechoTitulo;

const TITULO_41155 = {
    filCod: 2,
    docCod: '41155',
    titCod: '1',
    pesCod: '386',
    numeroDocumento: '86666',
} as unknown as TituloAPagar;

const PDF_NF: ArquivoGed = { dcmCod: 46415, adfCodSeq: 1, nome: 'NF_86666.PDF', tipo: 'PDF' };

const DANFSE: ItemPdf[] = [
    { texto: 'NÚMERO DA NFS-e', pagina: 1, x: 400, y: 760 },
    { texto: '86666', pagina: 1, x: 400, y: 750 },
    { texto: 'NÚMERO DA DPS', pagina: 1, x: 400, y: 735 },
    { texto: '776132', pagina: 1, x: 400, y: 725 },
];

const montar = (
    over: {
        desfechos?: DesfechoTitulo[];
        titulo?: TituloAPagar | null;
        priCod?: number;
        arquivos?: ArquivoGed[];
        itens?: ItemPdf[];
        gedFalha?: Error;
    } = {},
) => {
    const registrados: TituloDps[] = [];
    const sugestao = { desfechosAgora: jest.fn(async () => over.desfechos ?? [DESFECHO_41155]) };
    const dpsRepo = {
        listarTentativas: jest.fn(async () => []),
        registrar: jest.fn(async (t: TituloDps) => {
            registrados.push(t);
        }),
    };
    const tituloRepo = {
        buscarPorChave: jest.fn(async () =>
            over.titulo === undefined ? TITULO_41155 : over.titulo,
        ),
    };
    const ged = {
        priCodDoDocumento: jest.fn(async () => {
            if (over.gedFalha) throw over.gedFalha;
            return 'priCod' in over ? over.priCod : 4100;
        }),
        pastasDoDocumento: jest.fn(async () => [{ dcmCod: 46415 }]),
        arquivosDaPasta: jest.fn(async () => over.arquivos ?? [PDF_NF]),
        baixarArquivo: jest.fn(async () => Buffer.from('%PDF')),
    };
    const extrator = { extrair: jest.fn(async () => over.itens ?? DANFSE) };
    const log = { info: jest.fn(async () => undefined), warn: jest.fn(async () => undefined) };
    const clock = { now: () => Date.parse('2026-10-19T18:00:00Z') };
    const service = new LeitorDpsService(
        sugestao as unknown as BoletoSuggestionService,
        dpsRepo as unknown as TituloDpsRepository,
        tituloRepo as unknown as TituloAPagarRepository,
        ged as unknown as ConexosGedClient,
        extrator as unknown as ExtratorTextoPdf,
        new LeituraDanfse(),
        new SelecaoLeituraDps(),
        clock as unknown as Clock,
        log as unknown as LogService,
    );
    return { service, registrados, ged, extrator, log };
};

describe('LeitorDpsService — PDF da NFS-e no GED → titulo_dps (ADR-0073, I15p)', () => {
    it('caso do print: lê DPS 776132 do NF_86666.PDF e grava LIDO com credor e NFS-e', async () => {
        const { service, registrados, ged } = montar();
        const r = await service.executar({ limite: 10 });
        expect(r).toMatchObject({ alvos: 1, lidos: 1, semPdf: 0, semDps: 0, erros: 0 });
        expect(registrados).toEqual([
            {
                filCod: 2,
                docCod: '41155',
                titCod: '1',
                pesCod: '386',
                nfse: '86666',
                dps: '776132',
                status: 'LIDO',
                fonte: 'PDF_GED',
                arquivo: 'NF_86666.PDF',
            },
        ]);
        expect(ged.pastasDoDocumento).toHaveBeenCalledWith({
            filCod: 2,
            docCod: '41155',
            docTip: 2,
            priCod: 4100,
        });
        expect(ged.baixarArquivo).toHaveBeenCalledWith({ dcmCod: 46415, adfCodSeq: 1, filCod: 2 });
    });

    it('entre vários PDFs, escolhe o que traz o nº da NFS-e no nome', async () => {
        const outro: ArquivoGed = { dcmCod: 46415, adfCodSeq: 2, nome: 'BOLETO.PDF', tipo: 'PDF' };
        const { service, ged } = montar({ arquivos: [outro, PDF_NF] });
        await service.executar({ limite: 10 });
        expect(ged.baixarArquivo).toHaveBeenCalledWith({ dcmCod: 46415, adfCodSeq: 1, filCod: 2 });
    });

    it('PDF único sem o nº no nome é lido; vários sem o nº = SEM_PDF com motivo', async () => {
        const unico: ArquivoGed = { dcmCod: 46415, adfCodSeq: 3, nome: 'nota.pdf' };
        const a = montar({ arquivos: [unico] });
        await a.service.executar({ limite: 10 });
        expect(a.registrados[0]?.status).toBe('LIDO');

        const b = montar({
            arquivos: [unico, { dcmCod: 46415, adfCodSeq: 4, nome: 'outra.pdf' }],
        });
        await b.service.executar({ limite: 10 });
        expect(b.registrados[0]).toMatchObject({ status: 'SEM_PDF' });
        expect(b.registrados[0]?.dps).toBeUndefined();
        expect(b.registrados[0]?.motivo).toMatch(/2 PDFs/);
    });

    it('arquivo que não é PDF é ignorado', async () => {
        const { service, registrados } = montar({
            arquivos: [{ dcmCod: 46415, adfCodSeq: 5, nome: 'NF_86666.XML', tipo: 'XML' }],
        });
        await service.executar({ limite: 10 });
        expect(registrados[0]).toMatchObject({ status: 'SEM_PDF' });
    });

    it('documento sem processo → SEM_PDF, sem abrir o GED', async () => {
        const { service, registrados, ged } = montar({ priCod: undefined });
        await service.executar({ limite: 10 });
        expect(registrados[0]).toMatchObject({ status: 'SEM_PDF' });
        expect(ged.pastasDoDocumento).not.toHaveBeenCalled();
    });

    it('PDF sem "NÚMERO DA DPS" → SEM_DPS_NO_PDF com o nome do arquivo', async () => {
        const { service, registrados } = montar({ itens: DANFSE.slice(0, 2) });
        const r = await service.executar({ limite: 10 });
        expect(r.semDps).toBe(1);
        expect(registrados[0]).toMatchObject({
            status: 'SEM_DPS_NO_PDF',
            arquivo: 'NF_86666.PDF',
        });
    });

    it('NFS-e do PDF diferente da do título → ERRO, nunca grava DPS de outra nota', async () => {
        const itens = DANFSE.map((i) => (i.texto === '86666' ? { ...i, texto: '86672' } : i));
        const { service, registrados } = montar({ itens });
        const r = await service.executar({ limite: 10 });
        expect(r.erros).toBe(1);
        expect(registrados[0]).toMatchObject({ status: 'ERRO' });
        expect(registrados[0]?.dps).toBeUndefined();
        expect(registrados[0]?.motivo).toMatch(/86672.*86666/);
    });

    it('falha do Conexos (ex.: 403 do robô) vira ERRO com motivo e não derruba os outros', async () => {
        const erro = Object.assign(new Error('Request failed with status code 403'), {
            response: { status: 403 },
        });
        const outro = { ...DESFECHO_41155, docCod: '41156' } as DesfechoTitulo;
        const { service, registrados } = montar({
            desfechos: [DESFECHO_41155, outro],
            gedFalha: erro,
        });
        const r = await service.executar({ limite: 10 });
        expect(r).toMatchObject({ alvos: 2, erros: 2 });
        expect(registrados.map((t) => t.status)).toEqual(['ERRO', 'ERRO']);
        expect(registrados[0]?.motivo).toMatch(/403/);
    });

    it('título que saiu da carteira entre a seleção e a leitura é pulado sem gravar', async () => {
        const { service, registrados } = montar({ titulo: null });
        const r = await service.executar({ limite: 10 });
        expect(r.alvos).toBe(1);
        expect(registrados).toEqual([]);
    });

    it('registra o resumo da execução no log (contagens, sem conteúdo do PDF)', async () => {
        const { service, log } = montar();
        await service.executar({ limite: 10 });
        expect(log.info).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'leitura de DPS concluída',
                data: expect.objectContaining({ alvos: 1, lidos: 1 }),
            }),
        );
    });
});
