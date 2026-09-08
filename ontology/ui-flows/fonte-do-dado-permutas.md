# UI Flow — Fonte do dado na Gestão de Permutas

> **Tipo:** invariante de apresentação. Não introduz entidade, ação ou estado de domínio
> (`entity_changed=false`). Nenhuma leitura ou escrita nova no Conexos. Vigência: 2026-09-08
> (fix `permutas-fixture-fonte`). Relacionado: [[permuta]], [[adiantamento]].

## A regra

**O que está na tela é o que está no banco.** Num painel onde a analista decide baixa de
adiantamento, essa é a promessa implícita da interface. Quando ela não puder ser cumprida, a tela
diz — ela nunca preenche o silêncio com um palpite plausível.

## O que existia antes

`src/frontend/lib/api.ts`, `fetchGestaoPermutas` devolvia `gestaoPermutasFixture` em **dois**
caminhos, sem sinalizar nenhum:

```ts
if (!json?.pendentes?.length && !json?.invoicesEmAberto?.length) {
  return gestaoPermutasFixture      // backend OK, resposta legitimamente vazia
}
…
} catch {
  return gestaoPermutasFixture      // backend caiu, 500, timeout, rede, 401
}
```

O fixture (`lib/permutas-fixture.ts`, 227 linhas) são dados reais sondados contra o Conexos —
exportadores nominais (DBP PIPING, QINGDAO COVENANT, …) e valores em USD. Nasceu como rede de
segurança de demo, e o comentário no código dizia isso; nunca foi desligado.

O tipo já carregava o discriminador (`fonte: 'banco' | 'fixture'`, `lib/types.ts:236`) e o fixture
se identificava corretamente. **Nenhuma tela lia o campo.** O sinal existia e era jogado fora.

O caminho que disparava no dia a dia era o segundo, e é o pior dos dois: "zero pendentes" é um
estado **correto e desejável** do domínio, e era indistinguível de falha — substituído por linhas
fantasma. O primeiro (backend fora) mostrava uma carteira plausível e obsoleta.

Consequência lateral: o `catch` engolia também a `SessionExpiredError` do `apiFetch`, então uma
sessão expirada virava fixture em vez de abrir o `SessionExpiredModal`.

## Os três casos, agora distintos

| Caso | `fetchGestaoPermutas` | A tela mostra |
|---|---|---|
| Carteira legitimamente vazia | `fonte: 'banco'`, listas vazias, totais zerados | KPIs em 0 — o estado real |
| Falha (HTTP, rede, 401) | **lança** | Banner de erro + "Tentar novamente" |
| Demo explícito (`NEXT_PUBLIC_DEMO_MODE=true`) | fixture, `fonte: 'fixture'` | Banner destrutivo permanente |

## Invariantes

- **O fixture só existe atrás de `NEXT_PUBLIC_DEMO_MODE`.** Default OFF em todo ambiente,
  `local` inclusive — diferente de `isSispagEnabled()`, aqui não há default por ambiente.
- **Um build deployado com o flag ligado ESTOURA.** `assertDemoEnv()` espelha `assertAuthEnv()`
  (ADR/card security-1): dado falso num painel financeiro é da mesma família de erro que subir sem
  gate de autenticação, e merece o mesmo fail-fast em vez de um deploy bonito e mentiroso.
- **Falha nunca vira dado.** A única coisa que converte falha em conteúdo é o modo demo.
- **Falha de refresh preserva o dado anterior** (`docs/design-system/patterns.md` §Error states):
  a carteira que já estava na tela era real; o banner diz que pode estar desatualizada. Esvaziar o
  painel perderia informação verdadeira.
- **`SessionExpiredError` não é tratada aqui.** Sobe para o `SessionExpiredModal`, que é o dono
  daquela UX (`lib/http.ts`), e não vira banner genérico.

## Arquivos

```
src/frontend/lib/api.ts                                # os três caminhos
src/frontend/lib/features.ts                           # isDemoMode() + assertDemoEnv()
src/frontend/app/permutas/components/banners.tsx       # DemoDataBanner + LoadErrorBanner
src/frontend/app/permutas/components/usePermutasData.ts# estado `error`
src/frontend/app/permutas/page.tsx                     # composição dos três estados
```

## O painel de Recebimentos já tinha sido corrigido

Vale registrar porque o código induz ao erro: o cabeçalho de `lib/recebimentos.ts:9-11` **ainda
afirma** que `fetchPainelRecebimentos()` "cai num FIXTURE (rede de segurança do demo — espelha
`fetchGestaoPermutas`)". **A afirmação é falsa desde uma fatia anterior.** Verificado em
2026-09-08: `fetchPainelRecebimentos` (`recebimentos.ts:837-867`) lança em `!res.ok` e sempre
devolve `fonte: 'banco'`; `recebimentosPainelFixture` só é importado por
`lib/recebimentos.test.ts` e `app/recebimentos/page.test.tsx`. O próprio tipo já diz a verdade
(`recebimentos.ts:201`): "`fixture` sobrevive só para os testes […] nenhum caminho de produção
produz esse valor desde que os fallbacks silenciosos saíram".

Com este fix, os **dois** painéis passam a seguir o mesmo protocolo — falha nunca vira conteúdo.

### Backlog (não nesta fatia)

- **Corrigir o cabeçalho de `lib/recebimentos.ts:9-11`**, que descreve um comportamento removido.
  Comentário errado é pior que comentário nenhum: o próximo leitor confia nele — este aqui já
  custou um diagnóstico errado durante esta própria fatia.
- Validação Zod no boundary do frontend (backlog §3.4): `fetchGestaoPermutas` faz
  `as Partial<GestaoPermutasResponse>` sem validar o que o backend devolveu.
- `apiFetch` sem timeout nem `AbortSignal` (backlog §2.2). Antes deste fix um backend pendurado
  virava fixture de imediato; agora fica em `loading` até o navegador desistir. O fix não criou o
  buraco, mas subiu o custo dele.
