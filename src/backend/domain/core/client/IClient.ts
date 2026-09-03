export default interface IClient {
    init(): Promise<void>;
    /**
     * Libera o recurso que o client segura (pool, socket, sessão). **Opcional**:
     * a maioria dos clients fala HTTP sem estado e não tem o que fechar — torná-lo
     * obrigatório forçaria implementação vazia em ~17 sítios.
     *
     * Quem implementa entra no shutdown gracioso via `http/lifecycle.ts`. É o
     * contrato que faltava quando o pool do `conexosSessionStore` ficou de fora
     * do SIGTERM sem ninguém notar.
     */
    close?(): Promise<void>;
}
