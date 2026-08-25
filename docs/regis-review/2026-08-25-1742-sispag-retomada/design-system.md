---
qa: Design System
qa_slug: design-system
run_id: 2026-08-25-1742-sispag-retomada
agent: DesignSystemReviewer
generated_at: 2026-08-25T17:42:00Z
scope: frontend
score: 6
findings_count: 4
cards_count: 4
---

# Design System — Regis-Review

> **Nota editorial (orquestrador).** O agente retornou 6 findings; **2 foram descartados na
> verificação** porque partiam de uma API que não existe neste repositório: ele recomendava
> `notify()` com persistência em `NotificationCenter`, citando "Patterns §21" e
> `docs/application/flows/notificacoes.md`. Verificado: `grep` por `notify(`, `NotificationCenter`
> e o doc citado não retorna nada em `src/frontend`. É regra de outro projeto.
>
> A **preocupação por trás** de um deles continua válida e foi mantida, reescrita sem a
> prescrição inexistente: uma ação financeira atrás de um toast efêmero. Os findings de
> acessibilidade e de token foram confirmados por inspeção direta e ficam como estão.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador SISPAG | Abre o painel com avisos críticos (execuções presas, lote cancelado, conciliação parcial, lista cortada) durante a montagem de lotes de pagamento | Banners e toasts de `app/sispag/page.tsx` | PRD | Avisos com hierarquia clara, linguagem acionável e anunciados por leitor de tela | Nenhuma informação crítica transmitida só por cor; alerta crítico anunciado ao aparecer |

## 2. Métricas Observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Banners críticos sem `role`/`aria-live` | 2 | 0 | ❌ | `page.tsx:483` e `:514` — `grep` por `role=` só acha `aria-label` em checkbox e badges |
| Cores hardcoded em aviso | 1 (`text-amber-700`) | 0 | ❌ | `page.tsx:606` |
| Avisos competindo no topo da tela | 3 | 1 primário + contexto | ⚠️ | `page.tsx:483-530` + `:605` |
| Ícones com `aria-hidden` ou label | conformes | — | ✅ | `page.tsx:485, 515` |
| Ação financeira atrás de toast efêmero | 1 | 0 | ⚠️ | `page.tsx:344-357` |

## 3. Findings Detalhados

### F-design-system-1: banner de execuções presas sem `role="alert"` / `aria-live`

- **Severidade**: P1
- **Padrão violado**: acessibilidade — informação crítica não anunciada
- **Localização**: `src/frontend/app/sispag/page.tsx:483-512`
- **Evidência**: o bloco é um `<div>` com classes de cor; `grep 'role=|aria-live'` no arquivo não
  retorna nada nessa faixa (só `aria-label` em checkbox na linha 668 e badges em 963/975).
- **Impacto**: quem usa leitor de tela não é notificado de que há execução presa — ou seja, de que
  pode existir lote órfão no Conexos. O aviso é puramente visual.
- **Baseline**: 1 banner crítico sem live region → alvo 0.

### F-design-system-2: banner de contexto sem `role="region"`

- **Severidade**: P2
- **Localização**: `page.tsx:514-530`
- **Evidência**: mesmo `grep`. É o aviso de que gerar remessa e conciliar ESCREVEM no Conexos.
- **Impacto**: menor que o F-1 (é contexto, não alerta), mas é justamente a informação que
  distingue "montar lote" de "mexer no ERP".
- **Baseline**: 1 região sem landmark → alvo 0.

### F-design-system-3: cor hardcoded no aviso de lista cortada

- **Severidade**: P2
- **Localização**: `page.tsx:606` — `text-amber-700 dark:text-amber-500`
- **Evidência**: o aviso irmão, na linha 515, usa `text-warning`. Inconsistência dentro do mesmo
  arquivo.
- **Baseline**: 1 ocorrência → alvo 0.

### F-design-system-4: decisão financeira atrás de um toast que expira

- **Severidade**: P1
- **Localização**: `page.tsx:344-357`
- **Evidência**:
  ```tsx
  toast.warning('O lote anterior foi cancelado no Conexos', {
    duration: 60000,
    action: { label: 'Gerar um lote novo', onClick: () => { ... confirmarNovoLote: true ... } },
  })
  ```
- **Impacto**: o clique cria um lote de pagamento no ERP. O toast some em 60s — se a pessoa sair
  para conferir o fin015 (que é exatamente o que a mensagem pede), volta e a opção sumiu. Pior:
  não há estado persistente dizendo se a criação chegou a acontecer.
- **Nota**: o agente recomendou `notify()` + `NotificationCenter`. **Essa API não existe aqui.**
  A alternativa realista neste repo é um diálogo de confirmação (o projeto já usa `Dialog` em
  `AlocarProcessosDialog` e afins).
- **Baseline**: 1 ação financeira em toast → alvo 0.

## 4. Cards Kanban

### [design-system-1] `role="alert"` + `aria-live="assertive"` no banner de execuções presas

- **Problema**
  > O aviso de que há escrita sem confirmação — o que pode significar lote órfão no Conexos — é um
  > `<div>` sem papel semântico. Quem usa leitor de tela não fica sabendo.
- **Melhoria Proposta**
  > Envolver em `role="alert" aria-live="assertive"`. Se outros avisos críticos surgirem, extrair
  > um `AlertBanner` em vez de repetir os atributos.
- **Resultado Esperado**
  > O alerta é anunciado ao aparecer, sem depender de o operador estar olhando para o topo da tela.
- **Severidade**: P1 · **Esforço**: S · **Findings**: F-design-system-1

### [design-system-2] `role="region"` + `aria-label` no banner de contexto

- **Problema**
  > O aviso "gerar remessa e conciliar ESCREVEM no Conexos" não é navegável por landmark.
- **Melhoria Proposta**
  > `role="region"` com `aria-label` descritivo. Não usar `alert`: é contexto permanente, e
  > `assertive` em algo que está sempre lá vira ruído.
- **Resultado Esperado**
  > Navegação por landmarks alcança a informação que separa estado local de escrita no ERP.
- **Severidade**: P2 · **Esforço**: S · **Findings**: F-design-system-2

### [design-system-3] Trocar `text-amber-700` por `text-warning`

- **Problema**
  > Cor hardcoded no aviso de lista cortada, enquanto o aviso vizinho usa token.
- **Melhoria Proposta**
  > Usar `text-warning`, como na linha 515.
- **Resultado Esperado**
  > Um token só governa os dois avisos; mudança de tema não deixa um deles para trás.
- **Severidade**: P2 · **Esforço**: S · **Findings**: F-design-system-3

### [design-system-4] Tirar a criação de lote de dentro de um toast

- **Problema**
  > "Gerar um lote novo" é uma decisão com dinheiro, oferecida num toast de 60s. A própria mensagem
  > manda a pessoa conferir o lote cancelado no fin015 — e se ela for conferir, a opção expira. Não
  > sobra registro de que a oferta existiu nem de qual foi a escolha.
- **Melhoria Proposta**
  > Diálogo de confirmação (o projeto já usa `Dialog`), disparado pelo `LoteAnteriorCanceladoError`,
  > com o `flpCod` cancelado no corpo e estado de carregamento no botão. **Não** adotar a sugestão
  > original de `notify()`/`NotificationCenter`: não existe neste repositório.
- **Resultado Esperado**
  > A decisão sobrevive ao tempo que a pessoa leva para conferir o ERP, e o resultado é visível.
- **Severidade**: P1 · **Esforço**: M · **Findings**: F-design-system-4

## 5. Notas do Agente

- Escopo limitado aos 5 pontos de UI do delta. Não avaliei responsividade nem componentes fora dele.
- **Descartados na verificação**: 2 findings que dependiam de `notify()`/`NotificationCenter` e de
  um "Patterns §21" inexistentes neste repositório.
- Não medível sem teste com pessoa real: se a hierarquia entre os 3 avisos leva o operador ao mais
  urgente primeiro.

## Resumo de Severidade

| Severidade | Encontrados |
|---|---|
| P0 | 0 |
| P1 | 2 |
| P2 | 2 |
| P3 | 0 |

**Score: 6/10** — acessibilidade dos avisos críticos ausente e uma decisão financeira em componente
efêmero; nada que bloqueie merge.
