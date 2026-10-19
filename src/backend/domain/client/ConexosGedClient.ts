import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import type { ArquivoGed, DocumentoGed, PastaGed } from '../interface/sispag/GedArquivo.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/** Uma pasta de processo raramente passa de uma dúzia de arquivos; 100 é folga larga. */
const PAGE_SIZE = 100;

const strOpt = z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? undefined : String(v).trim() || undefined));

/** Boundary de `GET com298/{docCod}`: só o processo interessa. */
const CABECALHO_SCHEMA = z.object({ priCod: z.coerce.number().int().positive().nullish() });

/** Nó da árvore de `arq020/TelaDocumento/list`. `data` nulo = nó do processo (sem pasta). */
interface NoArvore {
    label?: unknown;
    data?: unknown;
    children?: unknown;
}
const PASTA_SCHEMA = z.object({
    dcmCod: z.coerce.number().int().positive(),
    dcmDesDescricao: strOpt,
});

/** Boundary de `arq020/arqDocFiles/list/{dcmCod}`. Sem `adfCodSeq` ou nome, não há o que baixar. */
const ARQUIVO_SCHEMA = z.object({
    dcmCod: z.coerce.number().int().positive(),
    adfCodSeq: z.coerce.number().int().positive(),
    binEspName: strOpt,
    adfEspDescricao: strOpt,
    tflDesDescricao: strOpt,
    binNumSize: z.coerce.number().nullish(),
});

/**
 * Conexos `arq020` — Arquivamento de Documentos (GED). SÓ LEITURA (ADR-0073, I15p): acha e baixa
 * o PDF da NFS-e de um título a pagar, pelo mesmo caminho que o `psq014` abre na tela:
 * `com298/{docCod}` (processo) → `arq020/TelaDocumento/list` (pastas do processo) →
 * `arq020/arqDocFiles/list/{dcmCod}` (arquivos) → `arq020/arqDocFiles/download/{dcmCod}/{seq}`.
 * Upload, exclusão, compartilhamento e troca de pasta existem no `arq020` e NÃO são tocados aqui.
 */
@singleton()
@injectable()
export default class ConexosGedClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /**
     * Processo (`priCod`) do documento a pagar; `undefined` quando o documento não tem processo.
     * Lido do `psq014` (Pesquisa de Documentos a Pagar, a tela de onde o GED é aberto): o `com298`
     * só acha documento com parte fiscal e devolve RECORDNOTFOUND para o puramente financeiro
     * (medido em PRD, 2026-10-19: 5 de 5 títulos MULTILOG). O `com298` fica como segunda fonte.
     */
    public priCodDoDocumento = async (params: {
        filCod: number;
        docCod: string;
        docTip: number;
    }): Promise<number | undefined> => {
        const opts = { filCod: params.filCod };
        try {
            const doc = await this.base.getGeneric<unknown>(
                `psq014/${params.filCod}/${params.docTip}/${params.docCod}`,
                opts,
            );
            const priCod = this.priCodDe(doc);
            if (priCod !== undefined) return priCod;
        } catch {
            // segue para o com298: o psq014 é a fonte, não a única
        }
        return this.priCodDe(await this.base.getGeneric<unknown>(`com298/${params.docCod}`, opts));
    };

    private priCodDe = (cabecalho: unknown): number | undefined => {
        const parsed = CABECALHO_SCHEMA.safeParse(cabecalho);
        return parsed.success ? (parsed.data.priCod ?? undefined) : undefined;
    };

    /** Pastas do GED do processo do documento, em qualquer nível da árvore. */
    public pastasDoDocumento = async (doc: DocumentoGed): Promise<PastaGed[]> => {
        const arvore = await this.base.postGeneric<unknown>(
            'arq020/TelaDocumento/list',
            {
                parameters: {
                    filCod: String(doc.filCod),
                    vldTodos: 0,
                    docTip: String(doc.docTip),
                    docCod: doc.docCod,
                    priCod: String(doc.priCod),
                },
            },
            { filCod: doc.filCod },
        );
        return Array.isArray(arvore) ? this.achatar(arvore as NoArvore[]) : [];
    };

    /** Arquivos de uma pasta, filtrados pelo documento (como a tela faz). */
    public arquivosDaPasta = async (
        dcmCod: number,
        doc: Omit<DocumentoGed, 'priCod'>,
    ): Promise<ArquivoGed[]> => {
        const { rows } = await this.base.listGenericPaginated<unknown>(
            `arq020/arqDocFiles/list/${dcmCod}`,
            {
                fieldList: [],
                filterList: {
                    filCodFilterDoc: String(doc.filCod),
                    docCodFilterDoc: doc.docCod,
                    docTipFilterDoc: String(doc.docTip),
                },
                pageNumber: 1,
                pageSize: PAGE_SIZE,
                serviceName: 'arq020.arquivos',
            },
            { filCod: doc.filCod },
        );
        return rows.flatMap((row) => {
            const parsed = ARQUIVO_SCHEMA.safeParse(row);
            if (!parsed.success) return [];
            const a = parsed.data;
            const nome = a.binEspName ?? a.adfEspDescricao;
            if (!nome) return [];
            return [
                {
                    dcmCod: a.dcmCod,
                    adfCodSeq: a.adfCodSeq,
                    nome,
                    ...(a.tflDesDescricao ? { tipo: a.tflDesDescricao } : {}),
                    ...(a.binNumSize != null ? { tamanho: a.binNumSize } : {}),
                },
            ];
        });
    };

    /** Bytes do arquivo. */
    public baixarArquivo = (params: {
        dcmCod: number;
        adfCodSeq: number;
        filCod: number;
    }): Promise<Buffer> =>
        this.base.getBinary(`arq020/arqDocFiles/download/${params.dcmCod}/${params.adfCodSeq}`, {
            filCod: params.filCod,
        });

    private achatar = (nos: NoArvore[]): PastaGed[] =>
        nos.flatMap((no) => {
            const pasta = PASTA_SCHEMA.safeParse(no.data);
            const filhos = Array.isArray(no.children)
                ? this.achatar(no.children as NoArvore[])
                : [];
            if (!pasta.success) return filhos;
            return [
                {
                    dcmCod: pasta.data.dcmCod,
                    ...(pasta.data.dcmDesDescricao
                        ? { descricao: pasta.data.dcmDesDescricao }
                        : {}),
                },
                ...filhos,
            ];
        });
}
