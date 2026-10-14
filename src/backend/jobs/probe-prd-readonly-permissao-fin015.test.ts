import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guarda ESTÁTICA da sonda de PRD (ADR-0071, Task 18): o job só LÊ. O teste lê o fonte e falha se
 * qualquer método de escrita do client (ou helper HTTP de escrita) aparecer no código — o job
 * roda contra a produção do cliente, então "só leitura" é verificado, não prometido.
 */
const FONTE = readFileSync(path.join(__dirname, 'probe-prd-readonly-permissao-fin015.ts'), 'utf8');

/** Sem comentários: a documentação do cabeçalho pode nomear o que o job NÃO faz. */
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');

const PROIBIDOS = [
    'editarItemDoRascunho',
    'confirmarCodigoBarras',
    // `POST`: a Conexos/Columbia ainda não confirmou que a validação não tem efeito (Q7).
    'validarCodigoBarras',
    'removerItemDoRascunho',
    'importarTitulos',
    'criarLote',
    'finalizarLote',
    'gerarRemessa',
    'sugerirRemessa',
    'postGeneric',
    'putGeneric',
    'deleteGeneric',
    'postMultipart',
    'postGenericOnce',
    'putGenericOnce',
];

describe('probe-prd-readonly-permissao-fin015 (ADR-0071, Task 18)', () => {
    it.each(PROIBIDOS)('o código NÃO usa `%s`', (nome) => {
        expect(CODIGO).not.toContain(nome);
    });

    it('só lê: usa a leitura do rascunho e nenhuma outra chamada ao client de escrita', () => {
        expect(CODIGO).toContain('lerItensDoRascunho');
        const usos = [...CODIGO.matchAll(/client\.(\w+)/g)].map((m) => m[1]);
        expect(new Set(usos)).toEqual(new Set(['lerItensDoRascunho']));
    });

    it('exige a flag explícita que reconhece o efeito colateral sobre a sessão do robô', () => {
        expect(FONTE).toContain("'--eu-entendo-que-derruba-a-sessao-do-robo'");
        expect(CODIGO).toMatch(/process\.argv\.includes\(FLAG\)/);
    });

    it('recusa sem databaseConnectionString="" e documenta que NÃO prova permissão de PUT', () => {
        expect(CODIGO).toMatch(/process\.env\.databaseConnectionString !== ''/);
        expect(FONTE).toMatch(/não é prova de permissão de `PUT`/i);
        expect(FONTE).toMatch(/V-PRD1/);
    });

    it('registra a alternativa preferida: a matriz de permissões do robô para o fin015', () => {
        expect(FONTE).toMatch(/matriz de permissões do[\s*]+robô para o programa `fin015`/);
    });

    it('não carrega nem imprime credencial nem código de barras', () => {
        expect(CODIGO).not.toMatch(/CONEXOS_PASSWORD|HML_ENV_FILE|itsNumCodbar\s*\)/);
        // `itsNumCodbar` aparece só para CONTAR (comCodigo), nunca em console.log direto.
        expect(CODIGO).not.toMatch(/console\.log\([^)]*itsNumCodbar/);
    });
});
