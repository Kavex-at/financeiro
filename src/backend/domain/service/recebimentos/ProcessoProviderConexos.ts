import { inject, injectable, singleton } from 'tsyringe';
import ConexosCadastroClient from '../../client/ConexosCadastroClient.js';
import type { ProcessoListItem } from '../../client/ConexosCadastroClient.js';
import type { Processo } from '../../interface/recebimentos/GerDocProcesso.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { SOLICITACAO_NUMERARIO_MOE_COD } from '../../interface/recebimentos/constants.js';
import type {
    ClienteProcesso,
    ListCandidatosInput,
    ProcessoProviderInterface,
} from '../../interface/recebimentos/ports.js';
import LogService from '../LogService.js';

/** TTL do cache de clientes por filial. */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
    expiraEm: number;
    processos: Processo[];
}

/**
 * ProcessoProviderConexos — processos e clientes REAIS do `imp021` (Frente IV).
 *
 * Substitui o `ProcessoProviderStub` (4 fixtures in-memory). Duas operações:
 *   - `listClientes`  → clientes com processo aberto na filial (seletor do modal)
 *   - `listCandidatosParaTransacao` → processos do cliente escolhido
 *
 * **Por que o analista escolhe o cliente:** o extrato bancário não traz `pesCod`
 * nem CNPJ. O único sinal é o histórico, truncado em ~24 caracteres pelo banco
 * (`"TED 745.0001.BROWN-FORMA"` para BROWN-FORMAN), e o próprio ERP classifica
 * boa parte como "CRÉDITO DESCONHECIDO". Casar automaticamente violaria o
 * invariante do ADR-0022 — *match incerto nunca auto-baixa*.
 *
 * **Cache:** sem ele, cada abertura do modal dispara um full-scan do `imp021`
 * (237 processos na filial 1, ~5 páginas). TTL em memória resolve com ~20 linhas;
 * snapshot persistido é melhor quando houver mais de uma instância — anotado no
 * inbox da ontologia.
 */
@singleton()
@injectable()
export default class ProcessoProviderConexos implements ProcessoProviderInterface {
    private readonly cache = new Map<number, CacheEntry>();

    public constructor(
        @inject(ConexosCadastroClient) private readonly cadastro: ConexosCadastroClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /**
     * Converte uma linha do `imp021` para `Processo`.
     *
     * O client devolve `priCod`/`pesCod` como STRING, mas o `processoSchema` exige
     * inteiro positivo. Uma linha sem identidade numérica é DESCARTADA (com
     * contagem no log) em vez de coalescida para zero — um `priCod: 0` viajaria
     * até o payload do com299 e só apareceria como erro no ERP.
     *
     * `moeCod`: o `imp021` **não** expõe moeda do processo (só `moeCodConv`, de
     * conversão, e `moeCodSeg`, de seguro — verificado em produção). Assume-se BRL
     * e a suposição é marcada em `moeCodAssumido` para a UI poder avisar. Assumir
     * calado num payload financeiro é como o dry-run vira bug quando deixar de ser
     * dry-run.
     */
    private mapProcesso = (r: ProcessoListItem, filCod: number): Processo | null => {
        const priCod = Number(r.priCod);
        const pesCod = Number(r.pesCod);
        if (!Number.isInteger(priCod) || priCod <= 0) return null;
        if (!Number.isInteger(pesCod) || pesCod <= 0) return null;

        const nome = r.importador?.trim();
        return {
            priCod,
            pesCod,
            filCod,
            priEspRefcliente: r.priEspRefcliente ?? '',
            dpeNomPessoa: nome && nome.length > 0 ? nome : `(sem nome) — cliente ${pesCod}`,
            moeCod: SOLICITACAO_NUMERARIO_MOE_COD,
            moeCodAssumido: true,
            contraparte: nome,
        };
    };

    /** Processos abertos da filial, com cache TTL. */
    private carregarProcessos = async (filCod: number): Promise<Processo[]> => {
        const cached = this.cache.get(filCod);
        if (cached && cached.expiraEm > Date.now()) return cached.processos;

        const rows = await this.cadastro.listProcessos({ filCod });
        const processos: Processo[] = [];
        let descartados = 0;
        for (const r of rows) {
            const p = this.mapProcesso(r, filCod);
            if (p) processos.push(p);
            else descartados += 1;
        }

        if (descartados > 0) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: `[RECEBIMENTOS] imp021 filial ${filCod}: ${descartados} processo(s) sem priCod/pesCod numérico descartado(s)`,
                data: { filCod, descartados, total: rows.length },
            });
        }

        this.cache.set(filCod, { expiraEm: Date.now() + CACHE_TTL_MS, processos });
        return processos;
    };

    public listClientes = async (input: { filCod: number }): Promise<ClienteProcesso[]> => {
        const processos = await this.carregarProcessos(input.filCod);
        const porCliente = new Map<number, ClienteProcesso>();

        for (const p of processos) {
            const atual = porCliente.get(p.pesCod);
            if (atual) atual.processosAbertos += 1;
            else
                porCliente.set(p.pesCod, {
                    pesCod: p.pesCod,
                    dpeNomPessoa: p.dpeNomPessoa,
                    processosAbertos: 1,
                });
        }

        // Ordena por NOME: o analista procura pelo nome do cliente, não pela
        // quantidade de processos.
        return [...porCliente.values()].sort((a, b) =>
            a.dpeNomPessoa.localeCompare(b.dpeNomPessoa, 'pt-BR'),
        );
    };

    /**
     * Processos candidatos. Com `pesCod` (caminho principal) consulta o ERP
     * filtrado; sem nenhum filtro devolve `[]` — despejar os 237 processos da
     * filial num modal não ajuda ninguém a decidir.
     */
    public listCandidatosParaTransacao = async (
        input: ListCandidatosInput,
    ): Promise<Processo[]> => {
        if (input.pesCod !== undefined) {
            const rows = await this.cadastro.listProcessos({
                filCod: input.filCod,
                pesCods: [String(input.pesCod)],
            });
            return rows
                .map((r) => this.mapProcesso(r, input.filCod))
                .filter((p): p is Processo => p !== null);
        }

        const contraparte = input.contraparte?.trim().toLowerCase();
        if (!contraparte) return [];

        // Compatibilidade: match FROUXO por nome sobre a lista já cacheada. É a
        // heurística do stub e continua sendo só uma sugestão.
        const processos = await this.carregarProcessos(input.filCod);
        return processos.filter((p) => {
            const alvo = (p.contraparte ?? p.dpeNomPessoa).toLowerCase();
            return alvo.includes(contraparte) || contraparte.includes(alvo);
        });
    };

    /** Invalida o cache de uma filial (ou de todas). Usado em teste e no reload. */
    public invalidarCache = (filCod?: number): void => {
        if (filCod === undefined) this.cache.clear();
        else this.cache.delete(filCod);
    };
}
