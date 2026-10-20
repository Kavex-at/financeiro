import { inject, injectable } from 'tsyringe';
import {
    AVISO_GRUPO,
    type AvaliacaoGrupo,
    type AvaliacaoTituloGrupo,
    type AvisoGrupo,
    type BoletoGrupoEntrada,
    type EntradaAvaliacaoGrupo,
    type EstadoVivoGrupo,
    GRUPO_BOLETO_ESTADO,
    GRUPO_BOLETO_ORIGEM,
    type GrupoBoleto,
    type GrupoBoletoOrigem,
    MOTIVO_GRUPO_INELEGIVEL,
    MOTIVO_GRUPO_ORFAO,
    type MotivoGrupoInelegivel,
    type MotivoGrupoOrfao,
    type ResultadoOrfao,
    type TituloGrupoEntrada,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import { PAGO_POR_CONEXOS } from '../../interface/sispag/PagoPorConexos.js';
import AnaliseCodigoBarrasRepetido from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import ValorAbertoLiquido from '../../libs/boleto/ValorAbertoLiquido.js';

const M = MOTIVO_GRUPO_INELEGIVEL;

/** Janela da composição manual (I19g, P0-2): `0 ≤ vencimentoBoleto − vencimentoTitulo ≤ 10`. */
export const JANELA_MANUAL_DIAS_MIN = 0;
export const JANELA_MANUAL_DIAS_MAX = 10;

/** N ≥ 2 (I19a, PI-1): um título só segue o caminho 1:1 (I15/I17). */
export const MINIMO_TITULOS_GRUPO = 2;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Diferença em dias CIVIS (`YYYY-MM-DD` como UTC meia-noite, ADR-0070); `NaN` se inválida. */
const diasEntre = (de: string, ate: string): number =>
    Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);

/** Precedência fixa de exibição (a ordem do `MOTIVO_GRUPO_INELEGIVEL`). */
const ORDEM: ReadonlyMap<MotivoGrupoInelegivel, number> = new Map(
    Object.values(M).map((m, i) => [m, i]),
);
const ordenar = (motivos: Iterable<MotivoGrupoInelegivel>): MotivoGrupoInelegivel[] =>
    [...new Set(motivos)].sort((a, b) => (ORDEM.get(a) ?? 0) - (ORDEM.get(b) ?? 0));

interface BoletoLido {
    motivos: MotivoGrupoInelegivel[];
    valorCentavos?: number;
    vencimento?: string;
    codigoMascarado?: string;
    banco?: string;
    emissorChave?: string;
}

/**
 * Regras PURAS do boleto agrupado (I19a–d, I19g, I19h, I19u; ADR-0076). Sem I/O, sem log e sem
 * relógio: tudo que decide entra como argumento (a data de débito, os valores do `fin064` já
 * lidos, as marcas, as decisões). É a mesma função da sugestão (com o `valor` local, G1), da
 * confirmação (com o `fin064` ao vivo) e da conferência da remessa (I19p(1)).
 *
 * Valores em centavos inteiros, pela régua líquida da I17b (`ValorAbertoLiquido`, importada);
 * nenhuma tolerância (I19b, D3). O valor do boleto é o que NÓS decodificamos do código, nunca o
 * campo do DDA. A saída carrega só a máscara 5+4 (I17j): o código completo morre aqui.
 */
@injectable()
export default class RegraGrupoBoleto {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
    ) {}

    public avaliar = (entrada: EntradaAvaliacaoGrupo): AvaliacaoGrupo => {
        const boleto = this.lerBoleto(entrada.boleto, entrada.titulos);
        // ── I19c + janela (I19g) por título ──
        const titulos = entrada.titulos.map((t) =>
            this.avaliarTitulo(t, entrada.origem, boleto.vencimento, entrada.grupoId),
        );
        const conta = this.somar(titulos, boleto.valorCentavos);
        const motivosGrupo = ordenar([
            ...this.motivosDeForma(entrada),
            ...boleto.motivos,
            ...this.motivosDoParEDatas(entrada, boleto.vencimento),
            ...conta.motivos,
        ]);
        const motivos = ordenar([...motivosGrupo, ...titulos.flatMap((t) => t.motivos)]);
        const motivo = motivosGrupo[0] ?? titulos.find((t) => t.motivos.length > 0)?.motivos[0];
        const exigeAviso =
            entrada.origem === GRUPO_BOLETO_ORIGEM.MANUAL &&
            titulos.some((t) => (t.deltaDias ?? 0) > 0);

        return {
            confirmavel: motivos.length === 0,
            ...(motivo !== undefined ? { motivo } : {}),
            motivos,
            motivosGrupo,
            titulos,
            avisos: exigeAviso ? [AVISO_GRUPO.TITULO_VENCE_ANTES_DO_BOLETO] : [],
            ...this.dadosDoBoleto(boleto),
            ...(conta.soma !== undefined ? { somaTitulosCentavos: conta.soma } : {}),
            ...(conta.delta !== undefined ? { deltaCentavos: conta.delta } : {}),
        };
    };

    /**
     * Janela de data de UM título (I19e/I19g). Sugestão: só o mesmo vencimento (`Δ = 0`). Manual:
     * `0 ≤ Δ ≤ 10`; `Δ > 0` exige o aviso `TITULO_VENCE_ANTES_DO_BOLETO`. Δ em dias civis.
     */
    public janela = (
        vencimentoTitulo: string,
        vencimentoBoleto: string,
        origem: GrupoBoletoOrigem,
    ): { deltaDias: number; dentro: boolean; aviso: boolean } => {
        const deltaDias = diasEntre(vencimentoTitulo, vencimentoBoleto);
        const maximo = origem === GRUPO_BOLETO_ORIGEM.MANUAL ? JANELA_MANUAL_DIAS_MAX : 0;
        const dentro = deltaDias >= JANELA_MANUAL_DIAS_MIN && deltaDias <= maximo;
        return { deltaDias, dentro, aviso: dentro && deltaDias > 0 };
    };

    /**
     * Avisos que a avaliação RECALCULADA exige e o pedido não reconheceu (PI-2, padrão I15o).
     * Lista vazia = pode confirmar; senão o serviço lança `WarningAcknowledgementRequiredError`.
     */
    public avisosFaltantes = (
        avaliacao: AvaliacaoGrupo,
        reconhecidos: readonly string[],
    ): AvisoGrupo[] => avaliacao.avisos.filter((a) => !reconhecidos.includes(a));

    /**
     * I19u — grupo `CONFIRMADO` órfão: boleto fora do pool ou com vínculo do ERP; título pago,
     * inativo (ou fora da carteira), com DDA do ERP, ou com líquido diferente do snapshot. Devolve
     * o PRIMEIRO motivo pela precedência de `MOTIVO_GRUPO_ORFAO`. `ANULADO`/`PAGO` nunca são órfãos.
     */
    public orfao = (grupo: GrupoBoleto, vivo: EstadoVivoGrupo): ResultadoOrfao => {
        if (grupo.estado !== GRUPO_BOLETO_ESTADO.CONFIRMADO) return { orfao: false };
        if (!vivo.boleto) return { orfao: true, motivo: MOTIVO_GRUPO_ORFAO.BOLETO_FORA_DO_POOL };
        if (this.vinculadoPeloErp(vivo.boleto)) {
            return { orfao: true, motivo: MOTIVO_GRUPO_ORFAO.BOLETO_VINCULADO_ERP };
        }
        const chave = (t: { filCod: number; docCod: string; titCod: string }): string =>
            `${t.filCod}:${t.docCod}:${t.titCod}`;
        const vivos = new Map(vivo.titulos.map((t) => [chave(t), t]));
        const checagens: Array<{
            motivo: MotivoGrupoOrfao;
            falha: (t: (typeof vivo.titulos)[number] | undefined, snapshot: number) => boolean;
        }> = [
            { motivo: MOTIVO_GRUPO_ORFAO.TITULO_PAGO, falha: (t) => t?.pago === true },
            { motivo: MOTIVO_GRUPO_ORFAO.TITULO_INATIVO, falha: (t) => !t?.ativo },
            { motivo: MOTIVO_GRUPO_ORFAO.TITULO_COM_DDA_ERP, falha: (t) => t?.temBoleto === true },
            {
                motivo: MOTIVO_GRUPO_ORFAO.VALOR_LIQUIDO_DIVERGENTE,
                falha: (t, snapshot) =>
                    t?.liquidoCentavos !== undefined && t.liquidoCentavos !== snapshot,
            },
        ];
        for (const { motivo, falha } of checagens) {
            for (const s of grupo.titulos) {
                if (falha(vivos.get(chave(s)), s.valorLiquidoCentavos)) {
                    return {
                        orfao: true,
                        motivo,
                        titulo: { filCod: s.filCod, docCod: s.docCod, titCod: s.titCod },
                    };
                }
            }
        }
        return { orfao: false };
    };

    /** Par (I19a, P1-3) e I19h: boleto vencido na data de débito; sem lote, vale o boleto. */
    private motivosDoParEDatas = (
        e: EntradaAvaliacaoGrupo,
        vencimentoBoleto: string | undefined,
    ): MotivoGrupoInelegivel[] => {
        const motivos: MotivoGrupoInelegivel[] = [];
        if (!e.parVigente && !e.parConfirmavelNoAto) motivos.push(M.PAR_NAO_VIGENTE);
        if (vencimentoBoleto !== undefined) {
            const referencia = e.dataDebito ?? vencimentoBoleto;
            if (diasEntre(referencia, vencimentoBoleto) < 0) motivos.push(M.BOLETO_VENCIDO);
        }
        return motivos;
    };

    /** I19b: Σ líquidos == boleto, em centavos, sem tolerância; um líquido ausente ⇒ fail-closed. */
    private somar = (
        titulos: AvaliacaoTituloGrupo[],
        valorBoletoCentavos: number | undefined,
    ): { soma?: number; delta?: number; motivos: MotivoGrupoInelegivel[] } => {
        const liquidos = titulos.map((t) => t.valorLiquidoCentavos);
        if (!liquidos.every((v): v is number => v !== undefined)) {
            return { motivos: [M.VALOR_ABERTO_INDISPONIVEL] };
        }
        const soma = liquidos.reduce((acc, v) => acc + v, 0);
        if (valorBoletoCentavos === undefined) return { soma, motivos: [] };
        const delta = valorBoletoCentavos - soma;
        return { soma, delta, motivos: delta === 0 ? [] : [M.SOMA_DIFERENTE] };
    };

    /** Campos do boleto lido que vão na saída (só os presentes; nunca o código). */
    private dadosDoBoleto = (b: BoletoLido): Partial<AvaliacaoGrupo> => ({
        ...(b.valorCentavos !== undefined ? { valorBoletoCentavos: b.valorCentavos } : {}),
        ...(b.vencimento !== undefined ? { vencimentoBoleto: b.vencimento } : {}),
        ...(b.codigoMascarado !== undefined ? { codigoMascarado: b.codigoMascarado } : {}),
        ...(b.banco !== undefined ? { banco: b.banco } : {}),
        ...(b.emissorChave !== undefined ? { emissorChave: b.emissorChave } : {}),
    });

    /** I19a (N ≥ 2, mesmo credor), I19d (uma filial), boleto livre. */
    private motivosDeForma = (e: EntradaAvaliacaoGrupo): MotivoGrupoInelegivel[] => {
        const motivos: MotivoGrupoInelegivel[] = [];
        if (e.titulos.length < MINIMO_TITULOS_GRUPO) motivos.push(M.MENOS_DE_DOIS_TITULOS);
        if (new Set(e.titulos.map((t) => t.filCod)).size > 1) motivos.push(M.CRUZA_FILIAL);
        // Título sem `pesCod` não prova o mesmo credor (H3: um borderô = um favorecido).
        const credores = new Set(e.titulos.map((t) => t.pesCod ?? ''));
        if (credores.size > 1 || credores.has('')) motivos.push(M.CREDORES_DIFERENTES);
        if (this.vinculadoPeloErp(e.boleto)) motivos.push(M.BOLETO_VINCULADO_ERP);
        return motivos;
    };

    private vinculadoPeloErp = (b: { filCod?: number; docCod?: string; titCod?: string }) =>
        b.filCod != null && !!b.docCod && !!b.titCod;

    /**
     * O boleto pelo código, decodificado por nós (I19b): valor e vencimento. Pool divergente do
     * código ⇒ `BOLETO_INCONSISTENTE` (mesma conferência da I17d). A referência do ciclo do fator
     * de vencimento é o vencimento do pool (ou do primeiro título com data).
     */
    private lerBoleto = (b: BoletoGrupoEntrada, titulos: TituloGrupoEntrada[]): BoletoLido => {
        const codigo = (b.codigo ?? '').replace(/[\s.]/g, '');
        if (codigo === '') return { motivos: [M.BOLETO_INDISPONIVEL] };
        const referencia = b.poolVencimento ?? titulos.find((t) => t.vencimento)?.vencimento;
        // Sem referência não há como escolher o ciclo do fator de vencimento (fail-closed).
        if (referencia === undefined) return { motivos: [M.DATA_INDISPONIVEL] };
        const decodificado = this.codigoBarras.decodificar(codigo, referencia);
        if (!decodificado) return { motivos: [M.CODIGO_INVALIDO] };
        const emissor = this.codigoBarras.emissor(decodificado.barras);
        const lido: BoletoLido = {
            motivos: [],
            valorCentavos: decodificado.valorCentavos,
            codigoMascarado: AnaliseCodigoBarrasRepetido.mascarar(decodificado.barras),
            banco: decodificado.banco,
            ...(decodificado.vencimento !== undefined
                ? { vencimento: decodificado.vencimento }
                : {}),
            ...(emissor ? { emissorChave: emissor.chave } : {}),
        };
        const valorDiverge =
            b.poolValor !== undefined &&
            Math.round(b.poolValor * 100) !== decodificado.valorCentavos;
        const dataDiverge =
            b.poolVencimento !== undefined &&
            decodificado.vencimento !== undefined &&
            b.poolVencimento !== decodificado.vencimento;
        if (valorDiverge || dataDiverge) lido.motivos.push(M.BOLETO_INCONSISTENTE);
        if (decodificado.vencimento === undefined) lido.motivos.push(M.DATA_INDISPONIVEL);
        return lido;
    };

    /** I19c: cada causa com motivo próprio (exibido, nunca descartado — PI-7). */
    private motivosDeElegibilidade = (
        t: TituloGrupoEntrada,
        grupoId: string | undefined,
    ): MotivoGrupoInelegivel[] => {
        const causas: Array<[boolean, MotivoGrupoInelegivel]> = [
            [!t.liberado, M.NAO_LIBERADO],
            [t.pago, M.PAGO],
            [!t.ativo, M.INATIVO],
            [t.formaPagamentoConexos !== PAGO_POR_CONEXOS.BOLETO, M.FORMA_NAO_BOLETO],
            [t.temBoleto === true, M.TEM_BOLETO_ERP],
            [t.decisaoConfirmada, M.DECISAO_1_1_CONFIRMADA],
            [t.marcaRetencaoAtiva, M.MARCA_RETENCAO_ATIVA],
            [t.emLoteComprometido, M.EM_LOTE_COMPROMETIDO],
            [
                t.grupoConfirmadoId !== undefined && t.grupoConfirmadoId !== grupoId,
                M.EM_OUTRO_GRUPO,
            ],
        ];
        return causas.filter(([falha]) => falha).map(([, motivo]) => motivo);
    };

    /** I19c (elegibilidade do título) + janela da I19e/I19g + líquido da I17b. */
    private avaliarTitulo = (
        t: TituloGrupoEntrada,
        origem: GrupoBoletoOrigem,
        vencimentoBoleto: string | undefined,
        grupoId: string | undefined,
    ): AvaliacaoTituloGrupo => {
        const motivos = this.motivosDeElegibilidade(t, grupoId);

        let deltaDias: number | undefined;
        if (t.vencimento === undefined) {
            motivos.push(M.DATA_INDISPONIVEL);
        } else if (vencimentoBoleto !== undefined) {
            const janela = this.janela(t.vencimento, vencimentoBoleto, origem);
            deltaDias = janela.deltaDias;
            if (!janela.dentro) motivos.push(M.FORA_DA_JANELA);
        }

        const valorLiquidoCentavos = ValorAbertoLiquido.calcularCentavos(t.aberto);
        if (valorLiquidoCentavos === undefined) motivos.push(M.VALOR_ABERTO_INDISPONIVEL);

        return {
            filCod: t.filCod,
            docCod: t.docCod,
            titCod: t.titCod,
            motivos: ordenar(motivos),
            ...(valorLiquidoCentavos !== undefined ? { valorLiquidoCentavos } : {}),
            ...(deltaDias !== undefined && !Number.isNaN(deltaDias) ? { deltaDias } : {}),
        };
    };
}
