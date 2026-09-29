import { injectable } from 'tsyringe';
import { z } from 'zod';
import ChavePixTitularNaoVerificavelError from '../../errors/ChavePixTitularNaoVerificavelError.js';
import DestinoManualInvalidoError from '../../errors/DestinoManualInvalidoError.js';
import DestinoTitularDivergenteError from '../../errors/DestinoTitularDivergenteError.js';
import DocumentoFavorecidoIndisponivelError from '../../errors/DocumentoFavorecidoIndisponivelError.js';
import { destinoManualSchema } from '../../interface/sispag/DestinoManualSchema.js';
import {
    CHAVE_PIX_TIPO,
    DESTINO_MANUAL_TIPO,
    type DestinoManual,
} from '../../interface/sispag/SispagInterface.js';

/** Tipos de chave PIX que a analista pode DIGITAR — os de titular conferível (I10i). */
const CHAVE_PIX_TIPOS_DIGITAVEIS: readonly string[] = [CHAVE_PIX_TIPO.CPF_CNPJ];

const soDigitos = (v: unknown): unknown => (typeof v === 'string' ? v.replace(/\D/g, '') : v);

/**
 * Entrada crua da rota/tela, ANTES da normalização: aceita documento com pontuação e chave com
 * espaços. O `destinoManualSchema` (forma estrita) roda depois de normalizar.
 */
const entradaSchema = z.discriminatedUnion('tipo', [
    z
        .object({
            tipo: z.literal(DESTINO_MANUAL_TIPO.CONTA),
            bancoCod: z.string(),
            agencia: z.string(),
            agenciaDv: z.string().optional(),
            conta: z.string(),
            contaDv: z.string(),
            titularDocumento: z.preprocess(soDigitos, z.string()),
        })
        .strict(),
    z
        .object({
            tipo: z.literal(DESTINO_MANUAL_TIPO.CHAVE_PIX),
            chavePixTipo: z.string(),
            chavePix: z.string(),
            titularDocumento: z.preprocess(soDigitos, z.string()),
        })
        .strict(),
]);

/** Rótulo em português do campo, para a mensagem ao operador (nunca o valor). */
const ROTULO_CAMPO: Readonly<Record<string, string>> = {
    tipo: 'tipo de destino',
    bancoCod: 'banco (3 dígitos FEBRABAN)',
    agencia: 'agência',
    agenciaDv: 'DV da agência',
    conta: 'conta',
    contaDv: 'DV da conta',
    titularDocumento: 'CPF/CNPJ do titular',
    chavePixTipo: 'tipo da chave PIX',
    chavePix: 'chave PIX',
};

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * DestinoManualValidator — formato e titularidade do destino digitado (ADR-0054, I10a–d, I10i).
 *
 * `validar` recebe a entrada crua e devolve o `DestinoManual` NORMALIZADO (só dígitos, e-mail em
 * minúsculas, telefone `+55DDNNNNNNNNN`, UUID em minúsculas) — é o valor que se grava e que vai
 * ao ERP. O tipo da chave é o que a analista escolheu; nada é inferido (D4).
 *
 * `conferirTitularidade` é a checagem bloqueante do I10i. Documento do favorecido ausente é
 * FALHA FECHADA, não "passa".
 *
 * Nenhum erro daqui carrega valor digitado: só nomes de campo (I10h).
 */
@injectable()
export default class DestinoManualValidator {
    public validar = (entrada: unknown): DestinoManual => {
        const bruto = entradaSchema.safeParse(entrada);
        if (!bruto.success) {
            throw new DestinoManualInvalidoError({ campos: this.camposDoErro(bruto.error) });
        }
        const normalizado = this.normalizar(bruto.data);
        const forma = destinoManualSchema.safeParse(normalizado);
        if (!forma.success) {
            throw new DestinoManualInvalidoError({ campos: this.camposDoErro(forma.error) });
        }
        const destino = forma.data;
        const invalidos: string[] = [];
        if (!this.documentoValido(destino.titularDocumento)) invalidos.push('titularDocumento');
        if (destino.tipo === DESTINO_MANUAL_TIPO.CHAVE_PIX && !this.chaveValida(destino)) {
            invalidos.push('chavePix');
        }
        if (invalidos.length > 0) {
            throw new DestinoManualInvalidoError({ campos: invalidos.map(this.rotulo) });
        }
        return destino;
    };

    /**
     * I10i: o titular do destino é o favorecido do título. Para chave CPF/CNPJ, a própria chave
     * também tem de ser o documento dele. `titulo` (`docCod/titCod`) só identifica o item na
     * mensagem.
     */
    public conferirTitularidade = (
        destino: DestinoManual,
        documentoFavorecido: string | undefined,
        titulo?: string,
    ): void => {
        const ref = titulo !== undefined ? { titulo } : {};
        if (documentoFavorecido === undefined || !this.documentoValido(documentoFavorecido)) {
            throw new DocumentoFavorecidoIndisponivelError(ref);
        }
        if (destino.titularDocumento !== documentoFavorecido) {
            throw new DestinoTitularDivergenteError({ campo: 'titularDocumento', ...ref });
        }
        // Só a chave CPF/CNPJ tem titular conferível daqui: o dono das outras está no DICT, que
        // só banco consulta. Decisão de 2026-09-29 — ver ChavePixTitularNaoVerificavelError.
        if (
            destino.tipo === DESTINO_MANUAL_TIPO.CHAVE_PIX &&
            !CHAVE_PIX_TIPOS_DIGITAVEIS.includes(destino.chavePixTipo)
        ) {
            throw new ChavePixTitularNaoVerificavelError(ref);
        }
        if (
            destino.tipo === DESTINO_MANUAL_TIPO.CHAVE_PIX &&
            destino.chavePixTipo === CHAVE_PIX_TIPO.CPF_CNPJ &&
            destino.chavePix !== documentoFavorecido
        ) {
            throw new DestinoTitularDivergenteError({ campo: 'chavePix', ...ref });
        }
    };

    /** CPF (11) ou CNPJ (14) com DV válido; sequência repetida é inválida. */
    public documentoValido = (documento: string): boolean => {
        if (!/^(\d{11}|\d{14})$/.test(documento) || /^(\d)\1+$/.test(documento)) return false;
        return documento.length === 11 ? this.cpfValido(documento) : this.cnpjValido(documento);
    };

    private normalizar = (e: z.infer<typeof entradaSchema>): Record<string, unknown> => {
        if (e.tipo === DESTINO_MANUAL_TIPO.CONTA) {
            return {
                tipo: e.tipo,
                bancoCod: e.bancoCod.trim(),
                agencia: e.agencia.trim(),
                ...(e.agenciaDv !== undefined && e.agenciaDv.trim() !== ''
                    ? { agenciaDv: e.agenciaDv.trim() }
                    : {}),
                conta: e.conta.trim(),
                contaDv: e.contaDv.trim(),
                titularDocumento: e.titularDocumento,
            };
        }
        return {
            tipo: e.tipo,
            chavePixTipo: e.chavePixTipo,
            chavePix: this.normalizarChave(e.chavePixTipo, e.chavePix),
            titularDocumento: e.titularDocumento,
        };
    };

    private normalizarChave = (tipo: string, chave: string): string => {
        const c = chave.trim();
        switch (tipo) {
            case CHAVE_PIX_TIPO.CPF_CNPJ:
                return c.replace(/\D/g, '');
            case CHAVE_PIX_TIPO.EMAIL:
            case CHAVE_PIX_TIPO.ALEATORIA:
                return c.toLowerCase();
            case CHAVE_PIX_TIPO.TELEFONE: {
                const d = c.replace(/\D/g, '');
                // Sem DDI (DDD + número, 10–11 dígitos) → Brasil. Com `+` e outro DDI, fica como
                // está e a validação recusa.
                if (!c.startsWith('+') && (d.length === 10 || d.length === 11)) return `+55${d}`;
                return `+${d}`;
            }
            default:
                return c;
        }
    };

    private chaveValida = (d: Extract<DestinoManual, { tipo: 'CHAVE_PIX' }>): boolean => {
        switch (d.chavePixTipo) {
            case CHAVE_PIX_TIPO.CPF_CNPJ:
                return this.documentoValido(d.chavePix);
            case CHAVE_PIX_TIPO.EMAIL:
                return d.chavePix.length <= 77 && EMAIL.test(d.chavePix);
            case CHAVE_PIX_TIPO.TELEFONE:
                // +55, DDD 11–99, número de 8 ou 9 dígitos.
                return /^\+55[1-9][1-9]\d{8,9}$/.test(d.chavePix);
            case CHAVE_PIX_TIPO.ALEATORIA:
                return UUID.test(d.chavePix);
            default:
                return false;
        }
    };

    private cpfValido = (cpf: string): boolean => {
        const n = cpf.split('').map(Number);
        const dv = (ate: number): number => {
            let soma = 0;
            for (let i = 0; i < ate; i += 1) soma += (n[i] ?? 0) * (ate + 1 - i);
            const r = (soma * 10) % 11;
            return r === 10 ? 0 : r;
        };
        return dv(9) === n[9] && dv(10) === n[10];
    };

    private cnpjValido = (cnpj: string): boolean => {
        const n = cnpj.split('').map(Number);
        const dv = (ate: number): number => {
            const pesos =
                ate === 12
                    ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
                    : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
            let soma = 0;
            for (let i = 0; i < ate; i += 1) soma += (n[i] ?? 0) * (pesos[i] ?? 0);
            const r = soma % 11;
            return r < 2 ? 0 : 11 - r;
        };
        return dv(12) === n[12] && dv(13) === n[13];
    };

    private rotulo = (campo: string): string => ROTULO_CAMPO[campo] ?? campo;

    private camposDoErro = (erro: z.ZodError): string[] =>
        erro.issues.map((i) => {
            const campo = i.path[0];
            if (i.code === 'unrecognized_keys') return 'campos não reconhecidos';
            return typeof campo === 'string' ? this.rotulo(campo) : 'tipo de destino';
        });
}
