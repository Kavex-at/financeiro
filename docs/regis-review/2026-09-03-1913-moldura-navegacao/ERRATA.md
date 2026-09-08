# ERRATA — run `2026-09-03-1913-moldura-navegacao`

> Registrada em 2026-09-03, depois da consolidação. Vale para `deployability.md`, `REPORT.md`
> e `KANBAN.md`.

## O que estava errado

O prompt que orientou o agente `qa-deployability` afirmava, como fato medido, que:

> "a `main` estava com `next build` quebrado por dois erros de tipo pré-existentes
> (`app/login/page.tsx:23` e `components/auth/RouteGate.tsx:21`, ambos `usePathname()`/
> `useSearchParams()` retornando `null` sob Next 16) e **nenhum gate acusou**."

**Isso é falso nas duas metades.** Verificado depois, de forma independente e no mesmo worktree:

1. Com os dois arquivos no estado exato de `origin/main`, `npm run build` termina em **exit 0**,
   "Compiled successfully", 12 rotas prerenderizadas. A `main` compila.
2. A justificativa de tipos também não se sustenta. As declarações instaladas (Next 16.2.7,
   declaração única em `node_modules/next/dist/`) são **não-nulláveis**:

   ```
   node_modules/next/dist/client/components/navigation.d.ts:24:
     export declare function useSearchParams(): ReadonlyURLSearchParams;
   node_modules/next/dist/client/components/navigation.d.ts:42:
     export declare function usePathname(): string;
   ```

## O que de fato aconteceu

Um artefato do ambiente, criado por mim e não pelo repositório. O `node_modules` deste worktree é
um symlink para o checkout principal, e o Turbopack aborta com
`Symlink [project]/node_modules is invalid, it points out of the filesystem root`. Para contornar,
substituí o symlink por uma cópia hard-link e deixei o symlink original **dentro de
`src/frontend/`**, como `node_modules.symlink/`.

Esse nome não casa com nenhuma regra de exclusão (`tsconfig` e Next excluem `node_modules`, não
`node_modules.symlink`), então a árvore inteira entrou no programa do TypeScript como **código de
primeira parte** — com uma segunda cópia das declarações do `next` dentro. A prova está no próprio
log da terceira tentativa de build, que falhou apontando para dentro dela:

```
./node_modules.symlink/@babel/core/src/config/files/index-browser.ts:3:30
Type error: Could not find a declaration file for module 'gensync'.
```

Os erros de "possibly null" desapareceram no instante em que movi esse diretório para fora — não
por causa das edições que eu havia feito. Eu atribuí a causa ao Next 16 sem verificar a declaração
instalada, e escrevi essa atribuição em comentário de código, no CHANGELOG e no prompt deste run.

## Consequências para este relatório

| Item | Situação |
|---|---|
| **F-deployability-1 / card `deployability-1`** — "o job `frontend` do CI não roda `npm run build`" | **O achado continua VÁLIDO e verificável** em `.github/workflows/ci.yml` (o job do backend roda `build`; o do frontend não). O que cai é a **evidência dramática** que eu forneci. |
| Severidade **P1** do `deployability-1` | **Questionável.** A regra 7 do `qa-section.md` exige baseline numérico para P0/P1, e o baseline aqui era o incidente falso. Sem ele, o achado é um gap de gate sem incidente observado — leia como **P2** até que alguém produza um caso real. |
| **R-3** no `REPORT.md` §2 (Top risks) | Mesma correção: o risco existe, a narrativa de "2 erros passaram os 4 checks neste ciclo" **não aconteceu**. |
| Menções a `usePathname()`/`useSearchParams()` "nulláveis" | Falsas em todo o run. Afeta também o card `deployability-2` (helper `useSafePathname()`), cuja premissa era essa tipagem — **rebaixar para P3 / descartar**. |
| Demais 7 QAs | **Não afetados** — nenhum dependia dessa evidência. |

## O que foi feito no código

As duas edições que eu havia introduzido (`searchParams?.get` em `app/login/page.tsx` e
`usePathname() ?? ''` em `components/auth/RouteGate.tsx`) foram **revertidas** para o estado de
`origin/main`. Estavam fora do escopo da moldura, não corrigiam nada, e carregavam comentários que
afirmavam algo falso — comentário errado é pior que comentário nenhum, porque o próximo leitor
confia nele.

Nota lateral: o achado de **Security** (`F-security-1`, open redirect no `returnTo`) **não depende
disto e continua inteiro**. Com o arquivo revertido, as linhas voltam a ser
`app/login/page.tsx:23,32,42` e o valor lido é `searchParams.get('returnTo') || '/'` — o defeito é
inteiramente herdado, e este delta não toca mais o arquivo.
