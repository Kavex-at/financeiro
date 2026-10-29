import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import BatchConfirmationTooLargeError from '../../errors/BatchConfirmationTooLargeError.js';
import TitleSuggestionNotFoundError from '../../errors/TitleSuggestionNotFoundError.js';
import {
    CONFIRMACAO_CONJUNTO_MAXIMO,
    type ChaveLinhaConjunto,
    type ContextoConjunto,
    type IrmaosConjunto,
    type ResultadoConjunto,
    type ResultadoLinhaConjunto,
    STATUS_LINHA_CONJUNTO,
} from '../../interface/sispag/ConfirmacaoEmConjunto.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { LOTE_STATUS } from '../../interface/sispag/SispagInterface.js';
import type { ChaveTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import { isHandlerError } from '../../libs/handler/HandlerError.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';
import AjusteCentavosTituloService from './AjusteCentavosTituloService.js';
import BoletoSuggestionService, { type CenarioDecisao } from './BoletoSuggestionService.js';
import RegraIrmaosConjunto, { chaveDoTitulo } from './RegraIrmaosConjunto.js';

/** I15t(1): lote local em que o título já não entra no conjunto. */
const LOTES_FINALIZADOS: ReadonlySet<string> = new Set([
    LOTE_STATUS.FINALIZADO,
    LOTE_STATUS.REMESSA_GERADA,
    LOTE_STATUS.RETORNADO,
]);

const MOTIVO_INESPERADO = 'Não foi possível confirmar este título agora. Tente de novo.';

const chaveDaLinha = (c: ChaveLinhaConjunto): string =>
    `${chaveDoTitulo(c)}:${c.ddcCod}:${c.ditCod}`;

/**
 * ConfirmacaoEmConjuntoService — confirmação em conjunto de títulos irmãos (I15t, ADR-0080).
 *
 * - **Listagem** (`listarIrmaos`): do cenário em cache, como a lista de sugestões; só exibe.
 * - **Escrita** (`confirmarEmConjunto`): cada linha passa pelo MESMO `confirmar` (releitura ao vivo,
 *   anti-TOCTOU, lock de grupo, idempotência), em transação própria e em sequência, com a
 *   elegibilidade do conjunto conferida ao vivo dentro dele. Resultado por linha; nunca
 *   tudo-ou-nada. Os ajustes de centavos vão para uma fila sequencial depois da última linha.
 */
@injectable()
export default class ConfirmacaoEmConjuntoService {
    public constructor(
        @inject(BoletoSuggestionService) private readonly sugestoes: BoletoSuggestionService,
        @inject(RegraIrmaosConjunto) private readonly regra: RegraIrmaosConjunto,
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(BoletoDdaRepository) private readonly boletoRepo: BoletoDdaRepository,
        @inject(AjusteCentavosTituloService)
        private readonly ajusteCentavos: AjusteCentavosTituloService,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public listarIrmaos = async (chave: ChaveTitulo): Promise<IrmaosConjunto> => {
        const desfechos = await this.sugestoes.desfechosEmCache();
        const origem = desfechos.find((d) => chaveDoTitulo(d) === chaveDoTitulo(chave));
        if (!origem) throw new TitleSuggestionNotFoundError(chave);
        const base = { origem: this.soTitulo(chave), maximo: CONFIRMACAO_CONJUNTO_MAXIMO };
        if (!origem.pesCod) return { ...base, irmaos: [] };
        const pesCod = origem.pesCod;
        const doCredor = desfechos.filter((d) => d.pesCod === pesCod && d.filCod === chave.filCod);
        // O pool só importa a partir do boleto mais cedo dos irmãos (aviso de idênticos, I15t(5)).
        const desde = doCredor
            .flatMap((d) => d.candidatos.map((c) => c.vencimentoBoleto))
            .sort()[0];
        const [emLotes, pool] = await Promise.all([
            this.loteRepo.listTitulosEmLotesAbertos(),
            desde ? this.boletoRepo.listBoletos({ vencimentoDesde: desde }) : Promise.resolve([]),
        ]);
        const emLoteFinalizado = new Set(
            emLotes.filter((i) => LOTES_FINALIZADOS.has(i.status)).map(chaveDoTitulo),
        );
        return {
            ...base,
            irmaos: this.regra.irmaos({
                origem: { ...this.soTitulo(chave), pesCod },
                desfechos: doCredor,
                emLoteFinalizado,
                pool,
            }),
        };
    };

    public confirmarEmConjunto = async (input: {
        origem: ChaveTitulo;
        itens: ChaveLinhaConjunto[];
        ator: string;
    }): Promise<ResultadoConjunto> => {
        const itens = [...new Map(input.itens.map((i) => [chaveDaLinha(i), i])).values()];
        if (itens.length > CONFIRMACAO_CONJUNTO_MAXIMO) {
            throw new BatchConfirmationTooLargeError({
                pedidas: itens.length,
                maximo: CONFIRMACAO_CONJUNTO_MAXIMO,
            });
        }
        // O credor da origem vem da carteira de agora, nunca do cliente.
        const tituloOrigem = await this.tituloRepo.buscarPorChave(input.origem);
        if (!tituloOrigem?.pesCod) throw new TitleSuggestionNotFoundError(input.origem);
        const conjunto: ContextoConjunto = {
            id: randomUUID(),
            origem: this.soTitulo(input.origem),
            pesCod: tituloOrigem.pesCod,
        };

        // Um cenário recalculado do banco para o conjunto inteiro (I15t(4)): cada linha ainda relê
        // título, boleto e decisões ao vivo dentro do confirmar.
        const cenario = await this.sugestoes.cenarioParaConjunto();
        const resultados: ResultadoLinhaConjunto[] = [];
        const pedidosAjuste: Array<{
            filCod: number;
            docCod: string;
            titCod: string;
            decisaoId: string;
        }> = [];
        for (const item of itens) {
            const r = await this.confirmarLinha(item, input.ator, conjunto, cenario);
            resultados.push(r.resultado);
            if (r.decisaoId) {
                pedidosAjuste.push({ ...this.soTitulo(item), decisaoId: r.decisaoId });
            }
        }
        this.ajusteCentavos.agendarEmSequencia(pedidosAjuste);

        const recusadas = resultados.filter(
            (r) => r.status === STATUS_LINHA_CONJUNTO.RECUSADA,
        ).length;
        const resultado: ResultadoConjunto = {
            conjuntoId: conjunto.id,
            resultados,
            confirmadas: resultados.length - recusadas,
            recusadas,
        };
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'confirmação em conjunto concluída',
            data: {
                conjuntoId: conjunto.id,
                origem: chaveDoTitulo(input.origem),
                pesCod: conjunto.pesCod,
                pedidas: itens.length,
                confirmadas: resultado.confirmadas,
                novas: pedidosAjuste.length,
                recusadas,
                ator: input.ator,
            },
        });
        return resultado;
    };

    private confirmarLinha = async (
        item: ChaveLinhaConjunto,
        ator: string,
        conjunto: ContextoConjunto,
        cenario: CenarioDecisao,
    ): Promise<{ resultado: ResultadoLinhaConjunto; decisaoId?: string }> => {
        const recusa = (motivo: string) => ({
            resultado: { chave: item, status: STATUS_LINHA_CONJUNTO.RECUSADA, motivo },
        });
        if (item.filCod !== conjunto.origem.filCod) {
            return recusa(
                'O título é de outra filial: a confirmação em conjunto é só na mesma filial.',
            );
        }
        try {
            // Lido ao vivo por linha: um lote pode ter sido finalizado no meio do conjunto.
            const emLotes = await this.loteRepo.listTitulosEmLotesAbertos();
            const finalizado = emLotes.some(
                (l) => LOTES_FINALIZADOS.has(l.status) && chaveDoTitulo(l) === chaveDoTitulo(item),
            );
            if (finalizado) {
                return recusa(
                    'O título está num lote já finalizado: confirme-o sozinho, se ainda couber.',
                );
            }
            const r = await this.sugestoes.confirmar({ ...item, ator, conjunto }, cenario);
            return r.criada
                ? {
                      resultado: { chave: item, status: STATUS_LINHA_CONJUNTO.CONFIRMADA },
                      decisaoId: r.decisao.id,
                  }
                : { resultado: { chave: item, status: STATUS_LINHA_CONJUNTO.JA_CONFIRMADA } };
        } catch (err) {
            if (isHandlerError(err) && err.statusCode < 500) return recusa(err.userMessage);
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'confirmação em conjunto: falha inesperada numa linha',
                data: {
                    conjuntoId: conjunto.id,
                    titulo: chaveDoTitulo(item),
                    erro: err instanceof Error ? err.message : String(err),
                },
            });
            return recusa(MOTIVO_INESPERADO);
        }
    };

    private soTitulo = (c: ChaveTitulo): ChaveTitulo => ({
        filCod: c.filCod,
        docCod: c.docCod,
        titCod: c.titCod,
    });
}
