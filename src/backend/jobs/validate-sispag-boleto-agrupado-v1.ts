import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import { DECISAO_SUGESTAO_BOLETO } from '../domain/interface/sispag/ConfirmacaoEmissorBoleto.js';
import type { DecisaoChaveada } from '../domain/interface/sispag/SugestaoBoleto.js';
import {
    MOTIVO_GRUPO_INELEGIVEL,
    type SugestaoGrupoBoleto,
} from '../domain/interface/sispag/GrupoBoletoInterface.js';
import type { TituloAPagar } from '../domain/interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido from '../domain/libs/boleto/AnaliseCodigoBarrasRepetido.js';
import ValorAbertoLiquido, {
    type ValoresAbertoTitulo,
} from '../domain/libs/boleto/ValorAbertoLiquido.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import BoletoDdaRepository from '../domain/repository/sispag/BoletoDdaRepository.js';
import BloqueioDuplicidadeRepository from '../domain/repository/sispag/BloqueioDuplicidadeRepository.js';
import GrupoBoletoRepository from '../domain/repository/sispag/GrupoBoletoRepository.js';
import LotePagamentoRepository from '../domain/repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../domain/repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../domain/repository/sispag/TituloAPagarRepository.js';
import MotorGrupoBoleto, {
    type EntradaMotorGrupo,
} from '../domain/service/sispag/MotorGrupoBoleto.js';
import { ConexosService } from '../services/conexos.js';
import { ConexosSessionStore } from '../services/conexosSessionStore.js';
import {
    FLAG_SESSAO,
    GuardaSomenteLeituraConexos,
    SessaoUnicaConexos,
    TravaSomenteLeituraPg,
} from './validate-sispag-ajuste-centavos-v1.js';

/**
 * VALIDAÇÃO GROUND-TRUTH EM PRODUÇÃO — SOMENTE LEITURA — boleto agrupado (ADR-0077, Task 22).
 *
 * ── O QUE MEDE ───────────────────────────────────────────────────────────────────────────
 *   GT1 — roda o `MotorGrupoBoleto` sobre a carteira e o pool DDA reais (o mesmo cenário da tela):
 *     grupos sugeridos, confirmáveis, não confirmáveis por motivo, intercambiáveis (I21f) e
 *     cruzados de filial; confere o caso PEDRONI (38883–38885 × boleto 332841) ou justifica a
 *     ausência; e prova que nenhuma sugestão é subconjunto de um conjunto aberto (I21e, M1).
 *   GT2 — para cada título dos grupos SUGERIDOS, lê o `fin064` ao vivo (régua líquida da I17b) e
 *     compara com o `valor` local usado pelo motor; conta quantos grupos a confirmação recusaria
 *     (alimenta a G1). Leitura ilegível recusa o grupo (fail-closed).
 *   V1 (permissão do CLONEX em `fin010`/`fin015`) é opcional e NÃO faz parte deste job.
 *
 * ── POR QUE NÃO ESCREVE ──────────────────────────────────────────────────────────────────
 *   1. Conexos: o adapter legado é embrulhado por `GuardaSomenteLeituraConexos` (escrita lança sem
 *      chegar à rede; `POST` só para caminho `list`). Só `fin064/list` é chamado.
 *   2. Banco: só leitura, com `default_transaction_read_only = on` em todo `pg.Client` do
 *      processo (`TravaSomenteLeituraPg`) e conferido com `SHOW` antes de ler. Não sobe o
 *      container de migrations da aplicação.
 *   3. Sessão Conexos: UM login (`SessaoUnicaConexos`) e store DESLIGADO — nunca adota nem publica
 *      a sessão do robô.
 *
 * ── ⚠️ EFEITO COLATERAL: UM LOGIN EM PRD ─────────────────────────────────────────────────
 *   O login pode derrubar uma sessão viva do mesmo usuário. Rode com o go explícito do maintainer,
 *   fora do horário de remessa, e só com a flag abaixo.
 *
 * ── SAÍDA ────────────────────────────────────────────────────────────────────────────────
 *   Contagens, chaves de título e valores. Código de barras só mascarado (5+4), nunca completo.
 *   JSON em `$PROBE_OUT/resultado.json`.
 *
 *   cd src/backend
 *   ALVO=prd SOMENTE_LEITURA=1 PROBE_OUT=/tmp/validate-sispag-boleto-agrupado-v1 \
 *     npx tsx jobs/validate-sispag-boleto-agrupado-v1.ts --eu-entendo-que-derruba-uma-sessao-viva
 */
const OUT = process.env.PROBE_OUT ?? '/tmp/validate-sispag-boleto-agrupado-v1';
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);
/** Caso de referência do PEDRONI (filial 2): três títulos e o boleto 332841. */
const PEDRONI_DOCS = ['38883', '38884', '38885'] as const;
const PEDRONI_BOLETO = 332841;

type Linha = Record<string, unknown>;

/** Leitor do `fin064` ao vivo (a forma mínima do `ConexosSispagClient`). */
export interface LeitorValoresAberto {
    lerValoresAberto: (
        filCod: number,
        docCod: string,
        titCod: string,
    ) => Promise<
        { legivel: true; valores: ValoresAbertoTitulo } | { legivel: false; motivo: string }
    >;
}

export interface DependenciasValidacaoGrupo {
    motor: Pick<MotorGrupoBoleto, 'sugerir'>;
    entrada: EntradaMotorGrupo;
    sispag: LeitorValoresAberto;
}

const civil = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);
const chaveTitulo = (filCod: number, docCod: string, titCod: string): string =>
    `${filCod}:${docCod}:${titCod}`;

/** Recusa antes de qualquer login ou leitura; devolve o motivo ou `undefined` se pode rodar. */
export const conferirGuardasBoletoAgrupado = (
    env: Record<string, string | undefined>,
    argv: readonly string[],
): string | undefined => {
    if (env.ALVO !== 'prd') return 'exige ALVO=prd.';
    if (env.SOMENTE_LEITURA !== '1') return 'exige SOMENTE_LEITURA=1.';
    if (!argv.includes(FLAG_SESSAO)) {
        return `o login pode derrubar uma sessão viva em PRD. Rode com ${FLAG_SESSAO}.`;
    }
    const base = (env.CONEXOS_BASE_URL ?? '').toLowerCase();
    if (base.includes('hml')) return `CONEXOS_BASE_URL é HML (${base}); este job é só PRD.`;
    const usuario = env.CONEXOS_USERNAME ?? '';
    if (usuario === '' || !env.CONEXOS_PASSWORD) return 'CONEXOS_USERNAME/PASSWORD ausentes.';
    if (usuario.toUpperCase() === 'CLONEX') {
        return 'CONEXOS_USERNAME é o CLONEX; use o login do SERVIDOR.';
    }
    const conexao = env.databaseConnectionString ?? '';
    if (conexao === '') return 'databaseConnectionString ausente (banco de PRD, só leitura).';
    try {
        const host = new URL(conexao).hostname.toLowerCase();
        if (HOSTS_LOCAIS.has(host)) return 'databaseConnectionString aponta para banco local.';
    } catch {
        return 'databaseConnectionString ilegível.';
    }
    return undefined;
};

export class ValidacaoBoletoAgrupadoV1 {
    public constructor(private readonly deps: DependenciasValidacaoGrupo) {}

    /**
     * Sugestões que são subconjunto ESTRITO do conjunto aberto do mesmo (filial, credor,
     * vencimento do título). Deve ser zero: o motor só sugere conjunto fechado (I21e).
     */
    public static contarSubconjuntos = (
        sugestoes: readonly SugestaoGrupoBoleto[],
        todos: readonly TituloAPagar[],
    ): number => {
        // Conjunto aberto → títulos cobertos pelas sugestões dele (intercambiáveis dividem o
        // conjunto entre K boletos: a UNIÃO deles é que precisa fechar o conjunto).
        const cobertos = new Map<string, { abertos: number; docs: Set<string> }>();
        for (const s of sugestoes) {
            const primeiro = s.titulos[0];
            const ref = primeiro
                ? todos.find(
                      (t) =>
                          t.filCod === s.filCod &&
                          t.docCod === primeiro.docCod &&
                          t.titCod === primeiro.titCod,
                  )
                : undefined;
            if (!ref) continue;
            const dia = civil(ref.vencimento ?? 0);
            const chave = `${s.filCod}:${ref.pesCod}:${dia}`;
            const abertos = todos.filter(
                (t) =>
                    t.filCod === s.filCod &&
                    t.pesCod === ref.pesCod &&
                    t.ativo !== false &&
                    !t.pago &&
                    t.vencimento !== undefined &&
                    civil(t.vencimento) === dia,
            ).length;
            const atual = cobertos.get(chave) ?? { abertos, docs: new Set<string>() };
            for (const t of s.titulos) atual.docs.add(`${t.docCod}/${t.titCod}`);
            cobertos.set(chave, atual);
        }
        return [...cobertos.values()].filter((c) => c.abertos > c.docs.size).length;
    };

    public executar = async (): Promise<{
        gt1: Linha & { porMotivo: Record<string, number>; pedroni: Linha; cruzados: number };
        gt2: Linha & { divergencias: Linha[] };
    }> => {
        const sugestoes = this.deps.motor.sugerir(this.deps.entrada);
        return { gt1: this.gt1(sugestoes), gt2: await this.gt2(sugestoes) };
    };

    private gt1 = (sugestoes: SugestaoGrupoBoleto[]) => {
        const porMotivo: Record<string, number> = {};
        for (const s of sugestoes) {
            for (const m of s.motivos.length > 0 ? s.motivos : s.motivo ? [s.motivo] : []) {
                porMotivo[m] = (porMotivo[m] ?? 0) + 1;
            }
        }
        const confirmaveis = sugestoes.filter((s) => s.confirmavel).length;
        return {
            sugestoes: sugestoes.length,
            confirmaveis,
            naoConfirmaveis: sugestoes.length - confirmaveis,
            porMotivo,
            intercambiaveis: sugestoes.filter((s) => s.intercambiavel).length,
            cruzados: porMotivo[MOTIVO_GRUPO_INELEGIVEL.CRUZA_FILIAL] ?? 0,
            subconjuntos: ValidacaoBoletoAgrupadoV1.contarSubconjuntos(
                sugestoes,
                this.deps.entrada.titulos,
            ),
            pedroni: this.pedroni(sugestoes),
        };
    };

    private pedroni = (sugestoes: SugestaoGrupoBoleto[]): Linha => {
        const presente = sugestoes.some((s) =>
            PEDRONI_DOCS.every((d) => s.titulos.some((t) => t.docCod === d)),
        );
        if (presente) return { presente: true };
        const naCarteira = PEDRONI_DOCS.every((d) =>
            this.deps.entrada.titulos.some((t) => t.docCod === d && !t.pago && t.ativo !== false),
        );
        if (!naCarteira) return { presente: false, justificativa: 'TITULOS_FORA_DA_CARTEIRA' };
        const noPool = this.deps.entrada.boletos.some(
            (b) => b.ditCod === PEDRONI_BOLETO || b.numero === String(PEDRONI_BOLETO),
        );
        if (!noPool) return { presente: false, justificativa: 'BOLETO_332841_FORA_DO_POOL' };
        return { presente: false, justificativa: 'NAO_SUGERIDO_VER_MOTIVOS' };
    };

    private gt2 = async (sugestoes: SugestaoGrupoBoleto[]) => {
        const vivos = new Map<string, number | undefined>();
        const divergencias: Linha[] = [];
        let ilegiveis = 0;
        let recusados = 0;
        for (const s of sugestoes) {
            let recusado = false;
            let somaVivo = 0;
            for (const t of s.titulos) {
                const chave = chaveTitulo(s.filCod, t.docCod, t.titCod);
                if (!vivos.has(chave)) {
                    const lido = await this.deps.sispag.lerValoresAberto(
                        s.filCod,
                        t.docCod,
                        t.titCod,
                    );
                    vivos.set(
                        chave,
                        lido.legivel
                            ? ValorAbertoLiquido.calcularCentavos(lido.valores)
                            : undefined,
                    );
                    if (vivos.get(chave) === undefined) ilegiveis += 1;
                }
                const vivo = vivos.get(chave);
                if (vivo === undefined) {
                    recusado = true;
                    continue;
                }
                somaVivo += vivo;
                if (vivo !== t.valorCentavos) {
                    recusado = true;
                    divergencias.push({
                        filCod: s.filCod,
                        docCod: t.docCod,
                        titCod: t.titCod,
                        localCentavos: t.valorCentavos,
                        vivoCentavos: vivo,
                        boleto: AnaliseCodigoBarrasRepetido.mascarar(s.codbarMascarado ?? ''),
                    });
                }
            }
            if (!recusado && somaVivo !== s.valorBoletoCentavos) recusado = true;
            if (recusado) recusados += 1;
        }
        return {
            gruposAvaliados: sugestoes.length,
            titulosLidos: vivos.size,
            ilegiveis,
            divergentes: divergencias.length,
            gruposRecusados: recusados,
            divergencias,
        };
    };
}

const chaveadas = (d: DecisaoChaveada[]): DecisaoChaveada[] => d;

/** O cenário local do motor (o mesmo da tela), só com SELECT. */
const carregarEntrada = async (): Promise<EntradaMotorGrupo> => {
    const [titulos, boletos, pares, decisoes, grupos, marcas, comprometidos] = await Promise.all([
        container.resolve(TituloAPagarRepository).listAtivos(),
        container.resolve(BoletoDdaRepository).listBoletos({}),
        container.resolve(SugestaoBoletoRepository).listarParesVigentes(),
        container
            .resolve(SugestaoBoletoRepository)
            .listarChaveadas(DECISAO_SUGESTAO_BOLETO.CONFIRMADA),
        container.resolve(GrupoBoletoRepository).listarConfirmados(),
        container.resolve(BloqueioDuplicidadeRepository).listAtivos(),
        container.resolve(LotePagamentoRepository).listTitulosEmLotesComprometidos(),
    ]);
    const lote = new Map(
        comprometidos.map(
            (c) =>
                [
                    chaveTitulo(c.filCod, c.docCod, c.titCod),
                    { id: c.id, status: c.status },
                ] as const,
        ),
    );
    return {
        titulos: titulos.map((t) => {
            const l = lote.get(chaveTitulo(t.filCod, t.docCod, t.titCod));
            return l ? { ...t, loteComprometido: l } : t;
        }),
        boletos,
        paresVigentes: pares.map((p) => ({ pesCod: p.pesCod, emissorChave: p.emissorChave })),
        decisoesConfirmadas: chaveadas(decisoes),
        gruposConfirmados: grupos.map((g) => ({
            id: g.id,
            ddcCod: g.ddcCod,
            ditCod: g.ditCod,
            titulos: g.titulos,
        })),
        marcasAtivas: marcas.map((m) => ({ filCod: m.filCod, docCod: m.docCod, titCod: m.titCod })),
    };
};

const recusar = (motivo: string): number => {
    console.error(`RECUSADO: ${motivo}`);
    return 1;
};

const main = async (): Promise<number> => {
    const recusa = conferirGuardasBoletoAgrupado(process.env, process.argv);
    if (recusa) return recusar(recusa);
    mkdirSync(OUT, { recursive: true });

    // Banco ANTES do login: uma falha aqui não gasta o único login.
    TravaSomenteLeituraPg.aplicar();
    const db = container.resolve(PostgreeDatabaseClient);
    await db.init();
    const ro = await db.selectFirst<{ default_transaction_read_only: string }>(
        'SHOW default_transaction_read_only',
    );
    if (ro?.default_transaction_read_only !== 'on') {
        return recusar('a sessão do banco não está em modo somente leitura.');
    }
    const entrada = await carregarEntrada();

    const svc = new ConexosService({ sessionStore: new ConexosSessionStore({ db: null }) });
    const sessao = SessaoUnicaConexos.limitarAUmLogin(svc);
    const chamadas: Array<{ metodo: string; path: string }> = [];
    const legacy = GuardaSomenteLeituraConexos.envolver(
        buildLegacyConexosAdapter(async () => svc),
        chamadas,
    );
    const sispag = new ConexosSispagClient(new ConexosBaseClient(legacy));
    const resultado = await new ValidacaoBoletoAgrupadoV1({
        motor: container.resolve(MotorGrupoBoleto),
        entrada,
        sispag,
    }).executar();
    const recusadas = chamadas.filter((c) => c.metodo.startsWith('RECUSADO:'));
    const saida = {
        ...resultado,
        carteira: entrada.titulos.length,
        boletosNoPool: entrada.boletos.length,
        logins: sessao.logins(),
        chamadas: chamadas.length,
        recusadas,
    };
    writeFileSync(`${OUT}/resultado.json`, JSON.stringify(saida, null, 2));
    console.log(
        JSON.stringify({
            gt1: saida.gt1,
            gt2: { ...saida.gt2, divergencias: saida.gt2.divergencias.length },
        }),
    );
    console.log(
        `logins=${sessao.logins()} chamadas=${chamadas.length} recusadas=${recusadas.length}`,
    );
    console.log(`JSON: ${OUT}/resultado.json`);
    return recusadas.length === 0 ? 0 : 1;
};

if (process.argv[1]?.endsWith('validate-sispag-boleto-agrupado-v1.ts')) {
    main()
        .then((code) => process.exit(code))
        .catch((e) => {
            console.error(
                '[validate-sispag-boleto-agrupado-v1] FATAL:',
                redactErrorMessage(e instanceof Error ? e.message : String(e)),
            );
            process.exit(1);
        });
}
