import { injectable, singleton } from 'tsyringe';

/**
 * Marca o processo como O SERVIDOR HTTP (ADR-0073, I18f/I18g). Nasce desligado: jobs, crons e
 * scripts compartilham o `bootstrapAppContainer` com o servidor, então "estou no servidor" não
 * pode ser inferido do container. Só o `index.ts` liga, no boot do servidor.
 *
 * Usado pelo ajuste de centavos: fora do servidor o modo efetivo cai a `shadow` (crons rodam com
 * outra credencial e não podem escrever no título).
 */
@singleton()
@injectable()
export default class ServerProcessMarker {
    private servidor = false;

    public ligar = (): void => {
        this.servidor = true;
    };

    public ehServidor = (): boolean => this.servidor;
}
