/**
 * Estado de prontidão do processo (card `availability-1`).
 *
 * `/health` é o `healthCheckPath` do Render. Enquanto a flag de shutdown vivia
 * num closure dentro do `gracefulShutdown`, `/health` continuava respondendo 200
 * depois do SIGTERM — e o balanceador seguia livre para mandar requisição nova
 * por uma conexão keep-alive já aberta, dentro da janela de drain. Uma delas pode
 * cair na fatia `createRun → finishRun`, que é exatamente o órfão `reconciling`
 * que o shutdown gracioso veio evitar.
 *
 * Módulo, e não parâmetro, porque produtor (o handler de sinal) e consumidor
 * (a rota) não se conhecem e não devem se conhecer.
 *
 * Só transita numa direção: um processo que começou a descer não volta a aceitar
 * tráfego. Por isso não existe `unmarkDraining` — o reset é exclusivo de teste.
 */
let draining = false;

/** Marca o processo como "descendo". Idempotente. */
export const markDraining = (): void => {
    draining = true;
};

/** `true` entre o sinal de shutdown e a saída do processo. */
export const isDraining = (): boolean => draining;

/** Reset do estado global entre testes. Não usar em runtime. */
export const resetReadinessForTests = (): void => {
    draining = false;
};
