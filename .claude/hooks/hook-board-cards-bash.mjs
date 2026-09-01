// hook-board-cards-bash.mjs — rede de segurança: tasks.md escrito via Bash também vira card.
// ----------------------------------------------------------------------------
// O `hook-board-cards.mjs` do kavex-pipe roda no PostToolUse de `Edit|Write`. Só que o
// modo auto instrui o modelo a preferir Bash (`cat > ... <<'EOF'`, `sed -i`, heredoc de
// python) para mexer em arquivo — e aí o hook nunca dispara. Medido em 2026-09-01:
// 3 eventos `hook_tasks` em ~5 semanas contra 8 tasks.md no `ontology/_inbox/`;
// `painel-operacao-tasks.md` e `invoice-pago-detalhe-tasks.md` nasceram por heredoc e
// não produziram um card sequer.
//
// Este hook cobre o caminho Bash. Não substitui o contrato: escrever o tasks.md com a
// ferramenta Write continua sendo o certo — aqui é a rede embaixo do trapézio.
//
// Idempotente de graça: `sincronizarCards` casa por (featureSlug, título), então rodar
// junto com o hook do plugin não duplica card.
// Fail-open por contrato: quadro fora do ar NUNCA derruba o loop.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Resolução do plugin -----------------------------------------------------
// Hook de projeto não recebe ${CLAUDE_PLUGIN_ROOT}. Acha a maior versão instalada.
function pluginRoot() {
    if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
    const bases = [
        process.env.CLAUDE_CONFIG_DIR,
        path.join(os.homedir(), '.claude-kavex'),
        path.join(os.homedir(), '.claude'),
    ].filter(Boolean);
    for (const base of bases) {
        const cache = path.join(base, 'plugins', 'cache', 'kavex', 'kavex-pipe');
        let versoes = [];
        try {
            versoes = fs.readdirSync(cache).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
        } catch {
            continue;
        }
        if (!versoes.length) continue;
        const cmp = (a, b) => {
            const pa = a.split('.').map(Number);
            const pb = b.split('.').map(Number);
            return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
        };
        return path.join(cache, versoes.sort(cmp).pop());
    }
    return '';
}

let input;
try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
    process.exit(0);
}

const cmd = input.tool_input?.command || '';
if (!/-tasks\.md/.test(cmd)) process.exit(0);

// --- Quais tasks.md o comando ESCREVEU ---------------------------------------
// Detectar "escrita" por verbo solto no comando é largo demais: a primeira versão
// deste hook usava /(>>?|...)/ e o `2>&1` de um comando de LEITURA casou com o `>`,
// sincronizando três features que não deviam ir para o quadro. Custou 17 cards
// indevidos em 2026-09-01. Agora o caminho precisa ser o ALVO de uma construção de
// escrita — `2>&1`, `grep x -tasks.md` e `node check.mjs <path>` não casam mais.
const ALVO = String.raw`\s*(?:'([^']*-tasks\.md)'|"([^"]*-tasks\.md)"|([^\s'"\`<>|;&]*-tasks\.md))`;
const ESCRITAS = [
    // redirect: `> x-tasks.md`, `>> x-tasks.md` (mas NÃO `2>&1`, que não tem path depois)
    new RegExp(String.raw`>>?${ALVO}`, 'g'),
    new RegExp(String.raw`\btee\b(?:\s+-a)?${ALVO}`, 'g'),
    new RegExp(String.raw`\bsed\b\s+-i\S*\s+(?:'[^']*'|"[^"]*"|\S+)${ALVO}`, 'g'),
    new RegExp(String.raw`\b(?:mv|cp|install)\b\s+(?:'[^']*'|"[^"]*"|\S+)${ALVO}`, 'g'),
];
// Heredoc de script (python/perl/node) que manipula o arquivo: o path vive no corpo,
// não numa posição sintática reconhecível. Aí sim vale o match largo.
const ehScriptInline = /\b(?:python3?|perl|node|ruby)\b[^|]*<<|\bnode\b\s+-e\b/.test(cmd);

const alvos = new Set();
for (const re of ESCRITAS) {
    for (const m of cmd.matchAll(re)) {
        const p = m[1] || m[2] || m[3];
        if (p) alvos.add(p);
    }
}
if (ehScriptInline) for (const p of cmd.match(/[^\s'"`<>|;&]+-tasks\.md/g) || []) alvos.add(p);
if (!alvos.size) process.exit(0);

// `cd <dir> && cat > ontology/_inbox/x-tasks.md` → o caminho é relativo ao `cd`.
const cdAlvo = (cmd.match(/\bcd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))/) || [])
    .slice(2)
    .find(Boolean);
const expandir = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const bases = [cdAlvo ? expandir(cdAlvo) : null, process.cwd()].filter(Boolean);
const candidatos = new Set();
for (const bruto of alvos) {
    const p = expandir(bruto);
    if (path.isAbsolute(p)) {
        candidatos.add(p);
        continue;
    }
    for (const base of bases) candidatos.add(path.resolve(base, p));
}

const arquivos = [...candidatos].filter((p) => {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
});
if (!arquivos.length) process.exit(0);

// Afordância de depuração: `KAVEX_BOARD_DRYRUN=1` mostra o que o hook DETECTOU e sai
// antes de qualquer chamada de rede. Existe porque a deteção de escrita é a parte
// deste hook que já errou uma vez — e errar aqui cria card indevido no quadro do time.
if (process.env.KAVEX_BOARD_DRYRUN) {
    console.error('DRYRUN alvos: ' + arquivos.join(', '));
    process.exit(0);
}

const raiz = pluginRoot();
if (!raiz) process.exit(0);

const { logEvent } = await import(path.join(raiz, 'scripts', 'telemetry.mjs'));
const { config, sincronizarCards } = await import(path.join(raiz, 'scripts', 'board.mjs'));

const cfg = config();
if (!cfg) {
    logEvent({ event: 'board_sync', comando: 'hook_tasks_bash', verdict: 'skip_sem_config', files: arquivos.length });
    process.exit(0);
}

for (const arquivo of arquivos) {
    const slug = path.basename(arquivo).replace(/-tasks\.md$/, '');
    try {
        const r = await sincronizarCards(cfg, arquivo, slug);
        logEvent({ event: 'board_sync', comando: 'hook_tasks_bash', verdict: 'ok', feature: slug, ...r });
        if (r.criados) console.error('quadro: ' + r.criados + ' card(s) criado(s) para ' + slug + ' (via Bash)');
        // Formato quebrado é o outro modo de falha silenciosa — precisa aparecer no terminal.
        if (!r.criados && r.motivo) console.error('quadro: nenhum card para ' + slug + ' — ' + r.motivo);
    } catch (erro) {
        logEvent({
            event: 'board_sync',
            comando: 'hook_tasks_bash',
            verdict: 'fail',
            feature: slug,
            erro: String(erro.message).slice(0, 200),
        });
        console.error('quadro: não consegui criar os cards de ' + slug + ' (' + erro.message + ') — loop segue');
    }
}

process.exit(0);
