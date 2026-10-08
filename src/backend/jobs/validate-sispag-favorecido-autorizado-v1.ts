import 'reflect-metadata';
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import type { PayeeDestination } from '../domain/interface/sispag/AuthorizedPayeeInterface.js';
import { CHAVE_PIX_TIPO_POR_CIX_VLD_TIPO } from '../domain/interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import MaskDestino from '../domain/libs/sispag/MaskDestino.js';
import PayeeFingerprint from '../domain/libs/sispag/PayeeFingerprint.js';
import PerfilCanalFornecedorRepository from '../domain/repository/sispag/PerfilCanalFornecedorRepository.js';
import DestinoPagamentoResolver, {
    DESTINO_ORIGEM,
} from '../domain/service/sispag/DestinoPagamentoResolver.js';

/**
 * GROUND TRUTH (read-only) — sispag-favorecido-autorizado (ADR-0065, Task 16 do tasks.md).
 *
 * Pergunta: o destino que o `DestinoPagamentoResolver` escolhe (e cuja impressão a aprovação grava)
 * é o MESMO que se deriva direto do payload CRU do cadastro do Conexos (`cmn025`) pela regra I10 /
 * I10k? E a impressão (HMAC) dos dois lados é igual?
 *
 *   TED  → `cmn025/ctcorr/list`: só `pctVldStatus = 1`; a `pctVldDefault = 1` primeiro; senão a 1ª.
 *   PIX  → `cmn025/cmnPessoasPix/list`: só `cixVldSituacao = 1`; ordem I10k = chave CPF/CNPJ igual
 *          ao documento do favorecido (`cmn025/list`), depois a default, depois as demais.
 *
 * Fonte = cmn025 lido CRU (a reimplementação aqui NÃO usa o client normalizado). Amostra = até 20
 * favorecidos do relatório de candidatos (perfil TED_PIX + pagos por TED/PIX), estratificada TED/PIX.
 * Chave = (pesCod, modalidade). Tolerância = 0 divergências. Não é cálculo monetário: o gate
 * monetário do GroundTruthValidator não se aplica; este check o substitui (decisão do TaskScoper).
 *
 * ── SEGURANÇA ─────────────────────────────────────────────────────────────────────────────
 * NENHUMA escrita: nem no Conexos, nem no banco local. Uma sessão do Conexos, chamadas
 * sequenciais (cap de sessões; memória "probe local derruba sessão Conexos"). Rodar com
 * `databaseConnectionString=""` para a sessão do robô NÃO ir para o store de produção (memória
 * "sessão do robô contaminável por dev local") — a lista de favorecidos vem então de
 * `VAL_PES_CODS` (CSV). A saída é SÓ mascarada: nunca conta ou chave completas.
 *
 * Sem `SISPAG_FAVORECIDO_FINGERPRINT_KEY` o script usa um segredo ALEATÓRIO desta execução (a
 * comparação de impressões só exige o mesmo segredo dos dois lados).
 *
 * Run (máquina com acesso ao Conexos; NÃO rodar em paralelo com outro probe):
 *   cd src/backend
 *   databaseConnectionString="" VAL_FIL=2 VAL_PES_CODS=1161,2034,... \
 *     npx tsx jobs/validate-sispag-favorecido-autorizado-v1.ts
 *   # ou, com a lista vinda do relatório (banco LOCAL com os perfis), sem VAL_PES_CODS:
 *   databaseConnectionString=<postgres local> VAL_FIL=2 npx tsx jobs/validate-sispag-favorecido-autorizado-v1.ts
 *
 * Saída: uma linha por (pesCod, modalidade) com EXATO | DIVERGENTE | SEM_DADO | FALHA_LEITURA e as
 * máscaras; exit 1 se houver qualquer DIVERGENTE (P0: volta ao loop).
 */

const AMOSTRA_MAX = 20;
const FIL = Number(process.env.VAL_FIL ?? 2);
const log = (s: string): void => console.log(`[val-favorecido] ${s}`);
const motivo = (e: unknown): string => {
    const status = (e as { response?: { status?: number } } | undefined)?.response?.status;
    return status !== undefined ? `HTTP ${status}` : e instanceof Error ? e.name : 'erro';
};

type Linha = {
    pesCod: string;
    modalidade: 'TED' | 'PIX';
    resultado: 'EXATO' | 'DIVERGENTE' | 'SEM_DADO' | 'FALHA_LEITURA';
    resolver?: string;
    cru?: string;
    nota?: string;
};

const listarCru = async (
    base: ConexosBaseClient,
    endpoint: string,
    pesCod: string,
    pageSize: number,
): Promise<Array<Record<string, unknown>>> => {
    const { rows } = await base.runWithRetry(() =>
        base.listGenericPaginated<Record<string, unknown>>(
            endpoint,
            {
                fieldList: [],
                filterList: { 'pesCod#EQ': pesCod },
                serviceName: 'cmn025',
                pageNumber: 1,
                pageSize,
            },
            { filCod: FIL },
        ),
    );
    return rows;
};

/** I10 TED, reimplementado sobre o payload cru. */
const tedDoCru = (rows: Array<Record<string, unknown>>): PayeeDestination | undefined => {
    const ativas = rows.filter((r) => Number(r.pctVldStatus) === 1);
    const escolhida = ativas.find((r) => Number(r.pctVldDefault) === 1) ?? ativas[0];
    if (!escolhida) return undefined;
    return {
        tipo: 'TED',
        banco: String(escolhida.pctNumBanco ?? ''),
        ...(escolhida.pctEspNumAgencia != null
            ? { agencia: String(escolhida.pctEspNumAgencia) }
            : {}),
        conta: String(escolhida.pctEspNumContaBanc ?? ''),
        ...(escolhida.pctEspDvconta != null ? { contaDv: String(escolhida.pctEspDvconta) } : {}),
    };
};

/** I10k PIX, reimplementado sobre o payload cru. */
const pixDoCru = (
    rows: Array<Record<string, unknown>>,
    documento: string | undefined,
): PayeeDestination | undefined => {
    const ativas = rows
        .filter((r) => Number(r.cixVldSituacao) === 1 && r.cixDesChave != null)
        .map((r) => ({
            chave: String(r.cixDesChave),
            tipo: CHAVE_PIX_TIPO_POR_CIX_VLD_TIPO[Number(r.cixVldTipo)],
            padrao: Number(r.cixVldDefault) === 1,
        }));
    const doDocumento = ativas.find(
        (c) => c.tipo === 'CPF_CNPJ' && documento && c.chave.replace(/\D/g, '') === documento,
    );
    const escolhida = doDocumento ?? ativas.find((c) => c.padrao) ?? ativas[0];
    if (!escolhida) return undefined;
    return {
        tipo: 'PIX',
        ...(escolhida.tipo ? { chaveTipo: escolhida.tipo } : {}),
        chave: escolhida.chave,
    };
};

const amostra = async (): Promise<string[]> => {
    const lista = (process.env.VAL_PES_CODS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (lista.length > 0) return lista.slice(0, AMOSTRA_MAX);
    // Do relatório de candidatos (banco LOCAL): metade dominante TED_PIX, metade só com TED/PIX.
    const { perfis } = await container
        .resolve(PerfilCanalFornecedorRepository)
        .listarCandidatos({ limite: 200, deslocamento: 0 });
    const dominantes = perfis.filter((p) => p.grupoDominante === 'TED_PIX');
    const outros = perfis.filter((p) => p.grupoDominante !== 'TED_PIX');
    const metade = AMOSTRA_MAX / 2;
    return [
        ...dominantes.slice(0, metade),
        ...outros.slice(0, AMOSTRA_MAX - Math.min(metade, dominantes.length)),
    ]
        .slice(0, AMOSTRA_MAX)
        .map((p) => p.pesCod);
};

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
    if (!env.sispagFavorecidoFingerprintKey) {
        env.sispagFavorecidoFingerprintKey = randomBytes(32).toString('hex');
        log('segredo HMAC ausente: usando um aleatório desta execução (só para comparar os lados)');
    }
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);
    const resolver = container.resolve(DestinoPagamentoResolver);
    const fingerprint = container.resolve(PayeeFingerprint);
    const mask = new MaskDestino();
    const pesCods = await amostra();
    log(`filial de leitura ${FIL} · ${pesCods.length} favorecido(s) · tolerância 0`);

    const linhas: Linha[] = [];
    for (const pesCod of pesCods) {
        const cache = resolver.novoCache();
        for (const modalidade of ['TED', 'PIX'] as const) {
            try {
                const resolvido = await resolver.resolve(
                    { modalidade },
                    { flags: { ted: true, pix: true }, filCod: FIL, pesCod, cache },
                );
                const viaResolver =
                    resolvido.origem === DESTINO_ORIGEM.CADASTRO
                        ? resolver.destinoFavorecido(resolvido)
                        : undefined;
                const cru =
                    modalidade === 'TED'
                        ? tedDoCru(await listarCru(base, 'cmn025/ctcorr/list', pesCod, 50))
                        : pixDoCru(
                              await listarCru(base, 'cmn025/cmnPessoasPix/list', pesCod, 50),
                              await sispag.getDocumentoFavorecido(pesCod, FIL),
                          );
                if (!viaResolver && !cru) {
                    linhas.push({ pesCod, modalidade, resultado: 'SEM_DADO' });
                    continue;
                }
                const [a, b] = await Promise.all([
                    viaResolver ? fingerprint.calcular(viaResolver) : undefined,
                    cru ? fingerprint.calcular(cru) : undefined,
                ]);
                linhas.push({
                    pesCod,
                    modalidade,
                    resultado: a && b && a.fingerprint === b.fingerprint ? 'EXATO' : 'DIVERGENTE',
                    ...(viaResolver ? { resolver: mask.destino(viaResolver) } : {}),
                    ...(cru ? { cru: mask.destino(cru) } : {}),
                    ...(!viaResolver || !cru
                        ? { nota: viaResolver ? 'só o resolver achou' : 'só o cru achou' }
                        : {}),
                });
            } catch (error) {
                linhas.push({
                    pesCod,
                    modalidade,
                    resultado: 'FALHA_LEITURA',
                    nota: motivo(error),
                });
            }
        }
    }

    console.log('='.repeat(78));
    for (const l of linhas) {
        log(
            `${l.pesCod} ${l.modalidade} ${l.resultado}` +
                (l.resolver ? ` · resolver=${l.resolver}` : '') +
                (l.cru ? ` · cru=${l.cru}` : '') +
                (l.nota ? ` · ${l.nota}` : ''),
        );
    }
    const conta = (r: Linha['resultado']): number => linhas.filter((l) => l.resultado === r).length;
    console.log('='.repeat(78));
    log(
        `EXATO=${conta('EXATO')} DIVERGENTE=${conta('DIVERGENTE')} SEM_DADO=${conta('SEM_DADO')} FALHA_LEITURA=${conta('FALHA_LEITURA')}`,
    );
    process.exit(conta('DIVERGENTE') > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error(`[val-favorecido] falhou: ${motivo(e)}`);
    process.exit(2);
});
