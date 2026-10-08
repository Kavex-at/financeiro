import { createHmac } from 'node:crypto';
import { inject, injectable, singleton } from 'tsyringe';
import {
    AUTHORIZED_PAYEE_MODALITY,
    type PayeeDestination,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import EnvironmentProvider from '../environment/EnvironmentProvider.js';

/** Impressão digital do destino e a versão do segredo que a produziu (I14b). */
export interface PayeeFingerprintValue {
    fingerprint: string;
    keyId: string;
}

/** Só dígitos, sem zeros à esquerda (`'0'` continua `'0'`). */
const digitos = (v: string | undefined): string => {
    const d = (v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return d;
};

/** DV de conta/agência: alfanumérico em caixa alta (o `X` do Banco do Brasil). */
const dv = (v: string | undefined): string => (v ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();

/**
 * PayeeFingerprint — HMAC-SHA256, com o segredo do tenant, do destino NORMALIZADO que o resolvedor
 * I10 escolheu (ADR-0065 I14b). A impressão não é reversível e o valor bruto nunca sai daqui: quem
 * guarda e compara é o `AuthorizedPayeeService`, só com a impressão.
 *
 * Normalização (tem de ser estável entre leituras do mesmo cadastro):
 *   TED  `ted|banco|agencia|agenciaDv|conta|contaDv` — dígitos sem zeros à esquerda; DV em caixa alta.
 *   PIX  `pix|TIPO|chave` — CPF/CNPJ e telefone só dígitos; e-mail e aleatória em minúsculas, sem
 *        espaços nas pontas.
 *
 * Sem segredo configurado, falha (a flag do favorecido autorizado já resolve `false` nesse caso; isto
 * é a segunda trava, falha fechada).
 */
@singleton()
@injectable()
export default class PayeeFingerprint {
    public constructor(
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
    ) {}

    public calcular = async (destino: PayeeDestination): Promise<PayeeFingerprintValue> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        const chave = env.sispagFavorecidoFingerprintKey;
        if (!chave) {
            throw new Error(
                'segredo do favorecido autorizado ausente (SISPAG_FAVORECIDO_FINGERPRINT_KEY): impressão do destino não calculada',
            );
        }
        const fingerprint = createHmac('sha256', chave)
            .update(this.canonico(destino), 'utf8')
            .digest('hex');
        return { fingerprint, keyId: env.sispagFavorecidoFingerprintKeyId };
    };

    private canonico = (destino: PayeeDestination): string => {
        if (destino.tipo === AUTHORIZED_PAYEE_MODALITY.TED) {
            return [
                'ted',
                digitos(destino.banco),
                digitos(destino.agencia),
                dv(destino.agenciaDv),
                digitos(destino.conta),
                dv(destino.contaDv),
            ].join('|');
        }
        const tipo = (destino.chaveTipo ?? '').toUpperCase();
        const chave =
            tipo === 'CPF_CNPJ' || tipo === 'TELEFONE'
                ? destino.chave.replace(/\D/g, '')
                : destino.chave.trim().toLowerCase();
        return ['pix', tipo, chave].join('|');
    };
}
