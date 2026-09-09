/**
 * Guarda de exaustividade — Regis-Review 2026-09-08, card `assertNever-propagacao`.
 *
 * Existe por causa de um defeito concreto: o `IngestaoPermutasService.toEstadoRow`
 * tinha um `default: return 'descoberta'` que engolia qualquer estado novo. Quando
 * `JA_PERMUTADO` entrou no enum, o `tsc` saiu com exit 0 e todo adiantamento já
 * permutado teria sido gravado como "não avaliado" — em silêncio, sem erro de
 * compilação, sem teste vermelho. O `grep` é a ferramenta errada para essa classe
 * de mudança; o compilador é a certa, desde que se dê a ele o que checar.
 *
 * Duas técnicas, para dois formatos de código:
 *
 * 1. **`switch` que despacha** → chame `assertNever` no `default`. Se a união
 *    ganhar um membro, o argumento deixa de ser `never` e o build quebra ali.
 *
 * 2. **Particionamento por estado** (contar, agrupar, distribuir em baldes) →
 *    NÃO use `switch`; declare o mapa como `Record<Uniao, …>`. O TypeScript exige
 *    TODAS as chaves da união num literal de `Record`, então um membro novo quebra
 *    o build no próprio mapa, que é onde a decisão precisa ser tomada.
 *
 * A diferença importa: um `=== 'x'` solto é um PREDICADO ("é este estado?") e
 * continua correto quando surge um sexto estado. Envolvê-lo em guarda seria ruído.
 * O que precisa de guarda é enumeração do conjunto inteiro.
 */
export default class ExhaustivenessGuard {
    /**
     * Chamado no `default` de um `switch` que deveria ser exaustivo.
     *
     * O valor chega tipado como `never` quando todos os membros da união foram
     * tratados. Se alguém acrescentar um membro e não tratá-lo, o tipo real deixa
     * de ser atribuível a `never` e o `tsc` falha na chamada — antes do teste,
     * antes do deploy, antes da produção.
     *
     * O `throw` é a rede de runtime para o caso de o valor vir de fora do
     * TypeScript (linha de banco, payload de API) e escapar da checagem estática.
     * Mensagem em português: quem lê isso num log é o analista da Columbia ou o
     * time da Kavex, às 2h da manhã (ADR-0042).
     */
    public static assertNever = (valor: never, contexto: string): never => {
        throw new Error(`${contexto}: valor fora da união tratada — ${String(valor)}`);
    };
}
