import { injectable } from 'tsyringe';
import {
    AUTHORIZED_PAYEE_MODALITY,
    type PayeeDestination,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import {
    CHAVE_PIX_TIPO,
    type ChavePixTipo,
    type ContaFavorecido,
    DESTINO_MANUAL_TIPO,
    type DestinoManual,
} from '../../interface/sispag/SispagInterface.js';

/** Rótulo curto do tipo de chave, em português (é o que a analista lê na tela). */
const ROTULO_CHAVE: Readonly<Record<ChavePixTipo, string>> = {
    [CHAVE_PIX_TIPO.CPF_CNPJ]: 'CPF/CNPJ',
    [CHAVE_PIX_TIPO.EMAIL]: 'e-mail',
    [CHAVE_PIX_TIPO.TELEFONE]: 'telefone',
    [CHAVE_PIX_TIPO.ALEATORIA]: 'aleatória',
};

/**
 * MaskDestino — a ÚNICA máscara de destino de pagamento (ADR-0054 I10h), reutilizada por log,
 * API e tela. O frontend exibe o texto que sai daqui; não re-mascara dado completo, porque dado
 * completo não chega lá.
 *
 * Regra geral: nunca devolve o valor inteiro. Valor curto demais para mostrar um pedaço sem
 * revelar tudo sai só com asteriscos.
 */
@injectable()
export default class MaskDestino {
    /** `****5678-9`: até 4 últimos dígitos da conta, sempre deixando pelo menos 2 escondidos. */
    public conta = (conta: string, dv?: string): string => {
        const d = conta.replace(/\D/g, '');
        const visiveis = d.length <= 2 ? 0 : Math.min(4, d.length - 2);
        const fim = visiveis > 0 ? d.slice(-visiveis) : '';
        return `****${fim}${dv ? `-${dv}` : ''}`;
    };

    /** CPF `***.456.789-**`; CNPJ `**.345.678/****-**`; qualquer outra coisa, asteriscos. */
    public documento = (documento: string): string => {
        const d = documento.replace(/\D/g, '');
        if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
        if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
        return '*'.repeat(Math.min(d.length || 3, 14));
    };

    /** `j***@dominio.com`. */
    public email = (email: string): string => {
        const arroba = email.indexOf('@');
        if (arroba <= 0) return '***';
        return `${email.slice(0, 1)}***${email.slice(arroba)}`;
    };

    /** `+55 (11) *****-4321`. */
    public telefone = (telefone: string): string => {
        const d = telefone.replace(/\D/g, '');
        if (d.length < 12) return `*****-${d.slice(-2)}`;
        return `+${d.slice(0, 2)} (${d.slice(2, 4)}) *****-${d.slice(-4)}`;
    };

    /** Chave aleatória (EVP): só os 4 últimos. */
    public aleatoria = (chave: string): string => `****-${chave.slice(-4)}`;

    /** Despacha pelo TIPO informado — nunca infere. Tipo desconhecido cai no mais restritivo. */
    public chavePix = (tipo: ChavePixTipo | undefined, chave: string): string => {
        switch (tipo) {
            case CHAVE_PIX_TIPO.CPF_CNPJ:
                return this.documento(chave);
            case CHAVE_PIX_TIPO.EMAIL:
                return this.email(chave);
            case CHAVE_PIX_TIPO.TELEFONE:
                return this.telefone(chave);
            default:
                return this.aleatoria(chave);
        }
    };

    /** `PIX e-mail j***@dominio.com`. */
    public chavePixRotulada = (tipo: ChavePixTipo | undefined, chave: string): string =>
        `PIX ${tipo ? ROTULO_CHAVE[tipo] : 'chave'} ${this.chavePix(tipo, chave)}`;

    /** `banco 237 · ag. 1234 · cc ****4321-0`. A agência não identifica a conta; fica visível. */
    public contaBancaria = (params: {
        banco: string | number;
        agencia?: string;
        conta: string;
        dv?: string;
    }): string => {
        const banco = String(params.banco).padStart(3, '0');
        const ag = params.agencia ? ` · ag. ${params.agencia}` : '';
        return `banco ${banco}${ag} · cc ${this.conta(params.conta, params.dv)}`;
    };

    public destinoManual = (destino: DestinoManual): string =>
        destino.tipo === DESTINO_MANUAL_TIPO.CONTA
            ? this.contaBancaria({
                  banco: destino.bancoCod,
                  agencia: destino.agencia,
                  conta: destino.conta,
                  dv: destino.contaDv,
              })
            : this.chavePixRotulada(destino.chavePixTipo, destino.chavePix);

    /**
     * I14l — o destino que o resolvedor escolheu, na forma do favorecido autorizado: TED com banco e
     * agência completos e a conta com os 4 últimos dígitos; PIX com o tipo e um trecho da chave.
     */
    public destino = (destino: PayeeDestination): string =>
        destino.tipo === AUTHORIZED_PAYEE_MODALITY.TED
            ? this.contaBancaria({
                  banco: destino.banco,
                  ...(destino.agencia
                      ? {
                            agencia: destino.agenciaDv
                                ? `${destino.agencia}-${destino.agenciaDv}`
                                : destino.agencia,
                        }
                      : {}),
                  conta: destino.conta,
                  ...(destino.contaDv ? { dv: destino.contaDv } : {}),
              })
            : this.chavePixRotulada(destino.chaveTipo as ChavePixTipo | undefined, destino.chave);

    public contaFavorecido = (conta: ContaFavorecido): string =>
        this.contaBancaria({
            banco: conta.banco,
            ...(conta.agencia ? { agencia: conta.agencia } : {}),
            conta: conta.conta ?? '',
            ...(conta.dvConta ? { dv: conta.dvConta } : {}),
        });
}
