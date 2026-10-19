import { inject, injectable, singleton } from 'tsyringe';
import ConexosError from '../errors/ConexosError.js';
import ConexosWriteDisabledError from '../errors/ConexosWriteDisabledError.js';
import ErpResponseReader from '../errors/ErpResponseReader.js';
import NotImplementedError from '../errors/NotImplementedError.js';
import {
    type AjusteRenegociacaoInput,
    BLOQUEIO_SCHEMA,
    type BloqueioTitulo,
    COMANDO_BLOQUEIO_SCHEMA,
    type ComandoBloqueio,
    type ComposicaoInput,
    type CriarRenegociacaoInput,
    RENEGOCIACAO_SCHEMA,
    RENEGOCIACAO_TITULO_SCHEMA,
    type Renegociacao,
    type SessaoConexos,
    TITULO_FIN064_SCHEMA,
    type TituloDaRenegociacaoInput,
    type TituloFin064,
} from '../interface/sispag/RenegociacaoInterface.js';
import EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import ConexosBaseClient from './ConexosBaseClient.js';
import { buildLegacyConexosAdapter } from './legacyConexosAdapter.js';

/**
 * O cancelamento de renegociação NÃO finalizada (`PUT fin070/cancelar/{frnCod}` existe na spec)
 * ainda não foi provado em HML: é o portão G3 (M9). Até lá, o método lança `NotImplementedError`
 * e a compensação do serviço termina `indeterminado` (alerta, ação humana). Virar `true` exige a
 * prova G3 registrada em `_inbox/sispag-centavos-hml-achados.md`.
 */
export const CANCELAMENTO_FIN070_PROVADO = false;

/** Tamanho de página das leituras paginadas (o `listGenericPaginated` devolve UMA página). */
const PAGINA = 200;
/** Guarda de varredura: 40 × 200 = 8.000 linhas. */
const MAX_PAGINAS = 40;

type Row = Record<string, unknown>;

const numero = (v: string): number => Number(v);

/**
 * ConexosRenegociacaoClient — Renegociação de Pagamentos (`fin070`), Liberação de Títulos
 * (`fin103`), comandos da regra de bloqueio (`fin106`) e leitura do título (`fin064`), para o
 * ajuste de centavos do título (ADR-0073, I18c–e).
 *
 * **Sessão explícita (I18f):** todo método recebe a `SessaoConexos` do chamador (a do servidor,
 * `ConexosSessionRegistry.robot()`); nada aqui consulta o resolver por-request.
 *
 * **Escrita em tentativa única** (`postGenericOnce`/`putGenericOnce`, sem re-POST em 401) e só com
 * `conexosWriteEnabled`; o sucesso é decidido pela RELEITURA no serviço, não pelo `200`. Os corpos
 * espelham os que funcionaram em HML (`jobs/probe-hml-renegociacao-fin070.ts`, frnCod 3 e 4).
 *
 * Falha do ERP vira `ConexosError` com a KEY preservada (`codigoErp`) e a classificação
 * determinística × transitória (`ehDeterministica`). Nenhum método recebe ou loga código de barras:
 * a obs carrega só o marcador e a máscara 5+4.
 */
@singleton()
@injectable()
export default class ConexosRenegociacaoClient {
    public constructor(
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
    ) {}

    /** KEY crua do ERP (`FIN_070.TIPO_OP_NAO_PERMITE_VALOR`, …) de uma falha, quando houver. */
    public static codigoErp = (err: unknown): string | undefined => {
        const data = ErpResponseReader.responseOf(err)?.data as
            | { messages?: Array<{ message?: string; valid?: string; vars?: { msg?: string } }> }
            | undefined;
        return ErpResponseReader.pickMessage(data?.messages)?.message;
    };

    /** Recusa de negócio (4xx que não 408/429): repetir devolve o mesmo veredito. */
    public static ehDeterministica = (err: unknown): boolean =>
        err instanceof ConexosError
            ? err.code === 'CONEXOS_UPSTREAM_REJECTED'
            : ErpResponseReader.isDeterministicRefusal(err);

    // ── Escritas (fin070) ───────────────────────────────────────────────────

    public criarRenegociacao = async (
        sessao: SessaoConexos,
        p: CriarRenegociacaoInput,
    ): Promise<{ frnCod: number }> => {
        const resposta = await this.escrever<Row>(sessao, 'post', 'fin070', p.filCod, {
            filCod: p.filCod,
            pesCod: p.pesCod,
            frnVldTipo: 2,
            frnVldTpop: 0,
            frnDtaReneg: p.dataRenegEpoch,
            frnEspObs: p.obs.toUpperCase(),
        });
        const lido = RENEGOCIACAO_SCHEMA.safeParse(resposta);
        if (!lido.success) {
            throw new ConexosError({
                endpoint: 'fin070',
                message: 'fin070: resposta do POST sem frnCod — reconhecer pelo marcador',
            });
        }
        return { frnCod: lido.data.frnCod };
    };

    public incluirTitulo = async (
        sessao: SessaoConexos,
        p: TituloDaRenegociacaoInput,
    ): Promise<void> => {
        await this.escrever(sessao, 'post', 'fin070/titulos', p.filCod, this.identidade(p));
    };

    public gravarComposicao = async (sessao: SessaoConexos, p: ComposicaoInput): Promise<void> => {
        await this.escrever(sessao, 'post', 'fin070/titulos/composicao', p.filCod, {
            ...this.identidade(p),
            frgMnyValor: p.valor,
            frgDtaVencimento: p.vencimentoEpoch,
            ...(p.frgEspNumero !== undefined ? { frgEspNumero: p.frgEspNumero } : {}),
            ...(p.pgtCod !== undefined ? { pgtCod: p.pgtCod } : {}),
            ...(p.dupEspOrdem !== undefined ? { dupEspOrdem: p.dupEspOrdem } : {}),
        });
    };

    /**
     * `PUT fin070` com o cabeçalho RELIDO + `frnMnyValor`/`frnVldTpop` (I18b). O `PUT` leva o
     * registro inteiro; regravar a leitura evita apagar campo que não mandamos.
     */
    public aplicarAjuste = async (
        sessao: SessaoConexos,
        p: AjusteRenegociacaoInput,
    ): Promise<void> => {
        await this.exigirEscrita();
        const atual = await this.ler<Row>(sessao, `fin070/${p.frnCod}`, p.filCod);
        await this.escrever(sessao, 'put', 'fin070', p.filCod, {
            ...atual,
            frnVldTpop: p.frnVldTpop,
            frnMnyValor: p.frnMnyValor,
        });
    };

    public finalizarRenegociacao = async (
        sessao: SessaoConexos,
        p: { filCod: number; frnCod: number },
    ): Promise<void> => {
        await this.escrever(sessao, 'put', `fin070/finalizar/${p.frnCod}`, p.filCod, {});
    };

    /** Compensação antes do `finalizar` (I18h). Rota a provar em HML (G3). */
    public cancelarRenegociacao = async (
        sessao: SessaoConexos,
        p: { filCod: number; frnCod: number },
    ): Promise<void> => {
        await this.exigirEscrita();
        if (!CANCELAMENTO_FIN070_PROVADO) {
            throw new NotImplementedError(
                `cancelamento da renegociação fin070 ${p.frnCod} não provado em HML (portão G3)`,
            );
        }
        await this.escrever(sessao, 'put', `fin070/cancelar/${p.frnCod}`, p.filCod, {});
    };

    // ── Escritas (fin103) ───────────────────────────────────────────────────

    public validarSelecionado = async (
        sessao: SessaoConexos,
        p: { filCod: number; linha: Row; fbaCod: number },
    ): Promise<void> => {
        await this.escrever(sessao, 'post', 'fin103/validaSelecionado', p.filCod, {
            items: [{ ...p.linha, fbaCod: p.fbaCod }],
        });
    };

    public aplicarComando = async (
        sessao: SessaoConexos,
        p: { filCod: number; linha: Row; fbaCod: number },
    ): Promise<void> => {
        await this.escrever(sessao, 'post', 'fin103/aplicarComando', p.filCod, {
            items: [{ ...p.linha, fbaCod: p.fbaCod }],
        });
    };

    // ── Leituras ────────────────────────────────────────────────────────────

    public lerRenegociacao = async (
        sessao: SessaoConexos,
        p: { filCod: number; frnCod: number },
    ): Promise<Renegociacao> => {
        const cabecalho = RENEGOCIACAO_SCHEMA.safeParse(
            await this.ler<Row>(sessao, `fin070/${p.frnCod}`, p.filCod),
        );
        if (!cabecalho.success) {
            throw new ConexosError({
                endpoint: `fin070/${p.frnCod}`,
                message: `fin070/${p.frnCod}: cabeçalho ilegível`,
            });
        }
        const linhas = await this.listarTudo(
            sessao,
            `fin070/titulos/list/${p.frnCod}`,
            p.filCod,
            {},
        );
        const titulos = linhas
            .map((r) => RENEGOCIACAO_TITULO_SCHEMA.safeParse(r))
            .filter((r) => r.success)
            .map((r) => r.data);
        const totais = titulos.map((t) => t.mnyValorTotal);
        const completo = totais.length > 0 && totais.every((v) => v !== undefined);
        const soma = completo
            ? Math.round(totais.reduce<number>((acc, v) => acc + Math.round((v ?? 0) * 100), 0)) /
              100
            : undefined;
        const c = cabecalho.data;
        return {
            frnCod: c.frnCod,
            finalizada: c.frnVldFin === 1,
            cancelada: c.frnVldCan === 1,
            ...(c.frnEspObs !== undefined ? { obs: c.frnEspObs } : {}),
            ...(soma !== undefined ? { mnyValorTotal: soma } : {}),
            titulos: titulos.map((t) => ({ docCod: t.docCod, titCod: t.titCod })),
        };
    };

    /**
     * I18i: renegociações cuja obs contém o marcador de correlação (a resposta do `POST` pode ter se
     * perdido). Varre o `fin070/list` da filial e casa em memória, sem diferenciar maiúsculas
     * (filtro no servidor não provado). Devolve os `frnCod` — zero, um ou (anomalia) vários.
     */
    public buscarRenegociacaoPorMarcador = async (
        sessao: SessaoConexos,
        p: { filCod: number; marcador: string },
    ): Promise<number[]> => {
        const alvo = p.marcador.trim().toUpperCase();
        if (alvo === '') return [];
        const linhas = await this.listarTudo(sessao, 'fin070/list', p.filCod, {});
        return linhas
            .map((r) => RENEGOCIACAO_SCHEMA.safeParse(r))
            .filter((r) => r.success && (r.data.frnEspObs ?? '').toUpperCase().includes(alvo))
            .map((r) => (r.success ? r.data.frnCod : 0));
    };

    /** Todos os títulos do documento no `fin064` (I18d: o título novo; I18a: o estado ao vivo). */
    public listarTitulosDoDocumento = async (
        sessao: SessaoConexos,
        p: { filCod: number; docCod: string },
    ): Promise<TituloFin064[]> => {
        const linhas = await this.listarTudo(sessao, 'fin064/list', p.filCod, {
            'docCod#EQ': p.docCod,
        });
        return linhas
            .map((r) => TITULO_FIN064_SCHEMA.safeParse(r))
            .filter((r) => r.success && r.data.docCod === p.docCod)
            .map((r) => (r as { data: TituloFin064 }).data);
    };

    /** Bloqueios do documento na Liberação de Títulos (`fin103/list`). */
    public listarBloqueios = async (
        sessao: SessaoConexos,
        p: { filCod: number; docCod: string },
    ): Promise<BloqueioTitulo[]> => {
        const linhas = await this.listarTudo(sessao, 'fin103/list', p.filCod, {
            filCod: p.filCod,
            'docCod#EQ': p.docCod,
        });
        const bloqueios: BloqueioTitulo[] = [];
        for (const row of linhas) {
            const lido = BLOQUEIO_SCHEMA.safeParse(row);
            if (!lido.success || lido.data.docCod !== p.docCod) continue;
            const b = lido.data;
            bloqueios.push({
                docCod: b.docCod,
                titCod: b.titCod,
                fblCod: b.fblCod,
                ...(b.ftbCod !== undefined ? { ftbCod: b.ftbCod } : {}),
                ...(b.ftbVldStatus !== undefined ? { ftbVldStatus: b.ftbVldStatus } : {}),
                ...(b.titMnyTotal !== undefined ? { titMnyTotal: b.titMnyTotal } : {}),
                row,
            });
        }
        return bloqueios;
    };

    /** Comandos da regra de bloqueio (`fin106/finBloqCmd/list/{fblCod}`), lidos AO VIVO (I18e). */
    public listarComandosDoBloqueio = async (
        sessao: SessaoConexos,
        p: { filCod: number; fblCod: number },
    ): Promise<ComandoBloqueio[]> => {
        const linhas = await this.listarTudo(
            sessao,
            `fin106/finBloqCmd/list/${p.fblCod}`,
            p.filCod,
            {},
        );
        const comandos: ComandoBloqueio[] = [];
        for (const row of linhas) {
            const lido = COMANDO_BLOQUEIO_SCHEMA.safeParse(row);
            if (!lido.success) continue;
            const c = lido.data;
            const cancelado =
                c.fbaTimCan !== undefined && c.fbaTimCan !== null && c.fbaTimCan !== '';
            comandos.push({
                fbaCod: c.fbaCod,
                nome: (c.fbaDesNome ?? '').trim(),
                ativo: !cancelado && (c.fbaVldStatus === undefined || c.fbaVldStatus === 1),
            });
        }
        return comandos;
    };

    // ── Peças ───────────────────────────────────────────────────────────────

    /** Base client amarrado à sessão EXPLÍCITA (mesmo adapter do container, sem o resolver). */
    private sobre = (sessao: SessaoConexos): ConexosBaseClient =>
        new ConexosBaseClient(buildLegacyConexosAdapter(async () => sessao));

    private identidade = (p: TituloDaRenegociacaoInput): Row => ({
        filCod: p.filCod,
        frnCod: p.frnCod,
        docTip: p.docTip,
        docCod: numero(p.docCod),
        titCod: numero(p.titCod),
    });

    private exigirEscrita = async (): Promise<void> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        if (env.conexosWriteEnabled !== true) throw new ConexosWriteDisabledError();
    };

    private escrever = async <T>(
        sessao: SessaoConexos,
        metodo: 'post' | 'put',
        endpoint: string,
        filCod: number,
        corpo: Row,
    ): Promise<T> => {
        await this.exigirEscrita();
        const base = this.sobre(sessao);
        try {
            return metodo === 'post'
                ? await base.postGenericOnce<T>(endpoint, corpo, { filCod })
                : await base.putGenericOnce<T>(endpoint, corpo, { filCod });
        } catch (cause) {
            throw this.falha(endpoint, cause);
        }
    };

    private ler = async <T>(
        sessao: SessaoConexos,
        endpoint: string,
        filCod: number,
    ): Promise<T> => {
        const base = this.sobre(sessao);
        try {
            return await base.runWithRetry(() => base.getGeneric<T>(endpoint, { filCod }));
        } catch (cause) {
            throw this.falha(endpoint, cause);
        }
    };

    /** Lê TODAS as páginas (o `listGenericPaginated` devolve uma); estouro da guarda lança. */
    private listarTudo = async (
        sessao: SessaoConexos,
        endpoint: string,
        filCod: number,
        filterList: Row,
    ): Promise<Row[]> => {
        const base = this.sobre(sessao);
        const servico = endpoint.split('/')[0] ?? endpoint;
        const linhas: Row[] = [];
        for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
            let res: { count: number; rows: Row[] };
            try {
                res = await base.runWithRetry(() =>
                    base.listGenericPaginated<Row>(
                        endpoint,
                        {
                            fieldList: [],
                            filterList,
                            pageNumber: pagina,
                            pageSize: PAGINA,
                            serviceName: servico,
                        },
                        { filCod },
                    ),
                );
            } catch (cause) {
                throw this.falha(endpoint, cause);
            }
            linhas.push(...res.rows);
            if (res.rows.length < PAGINA || linhas.length >= res.count) return linhas;
        }
        throw new ConexosError({
            endpoint,
            message: `${endpoint}: leitura excedeu ${MAX_PAGINAS} páginas — incompleta`,
        });
    };

    private falha = (endpoint: string, cause: unknown): ConexosError => {
        if (cause instanceof ConexosError) return cause;
        const chave = ConexosRenegociacaoClient.codigoErp(cause);
        return new ConexosError({
            endpoint,
            cause,
            message: `Conexos call to ${endpoint} failed${chave ? `: ${chave}` : ''}`,
        });
    };
}
