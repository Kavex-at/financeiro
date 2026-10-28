# Modais

Modais interrompem o fluxo para confirmação, entrada de dados ou informação crítica. O DS define seis variantes cobrindo os casos comuns, mais um exemplo concreto (ReprocessModal) que materializa o padrão multi-etapas.

## Princípios

- **Modal tem custo cognitivo** — use quando a ação exige foco ou confirmação. Para feedback passivo, prefira toast.
- **Focus trap obrigatório** enquanto aberto.
- **ESC fecha** (salvo em modais com form dirty, que prompt antes de fechar).
- **Click no overlay fecha** — mas pode ser desabilitado quando há conteúdo sensível.
- **Retorno de foco** ao elemento que disparou o modal ao fechar.
- **Empilhamento** de modais é permitido mas desencorajado — prefira wizards (MultiStepDialog) a sequência de modais.

## Classificação Atomic

Organism. Internamente usa Radix Dialog (já parte do shadcn).

## Variantes

| Variante | Uso | Botão principal | Cor |
|---|---|---|---|
| `ConfirmDialog` | Confirmar ação reversível | Verbo da ação | primary |
| `DestructiveConfirmDialog` | Confirmar ação irreversível | Verbo destrutivo | danger |
| `FormDialog` | Modal com formulário | "Salvar" / verbo | primary |
| `InfoDialog` | Explicação ou ajuda rica | "Entendi" | secondary |
| `Drawer` | Conteúdo lateral deslizante | — | — |
| `MultiStepDialog` | Fluxo multi-etapas (wizard) | "Próximo" / verbo final | primary |

## Tamanhos

Larguras do `Dialog` (`components/ui/dialog.tsx`). O `Drawer` tem escala própria (400 / 560 / 720 /
960px), ver § Drawer.

| Size | Width |
|---|---|
| `sm` | 400px |
| `md` | 600px (default) |
| `lg` | 800px |
| `xl` | 1024px |
| `full` | 90vw, 90vh |

## API base — compound

Todos os modais compartilham a raiz:

```tsx
<Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Content size="md">
        <Dialog.Header>
            <Dialog.Title>Título</Dialog.Title>
            <Dialog.Description>Descrição opcional</Dialog.Description>
        </Dialog.Header>

        <Dialog.Body>
            {/* conteúdo */}
        </Dialog.Body>

        <Dialog.Footer>
            <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
            <Button variant="primary" onClick={onConfirm}>Confirmar</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
```

## ConfirmDialog

### Uso

Confirmar ação reversível mas não trivial (ex: "Reprocessar 5 notas?").

### API

```tsx
<ConfirmDialog
    open={open}
    onOpenChange={setOpen}
    title="Reprocessar nota?"
    description="A nota será re-enviada para processamento. Você pode acompanhar o status na tabela."
    confirmLabel="Reprocessar"
    onConfirm={handleReprocess}
/>
```

### Props

| Prop | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `open` | `boolean` | sim | Controlled |
| `onOpenChange` | `(open: boolean) => void` | sim | — |
| `title` | `string` | sim | Título curto |
| `description` | `ReactNode` | sim | Explicação completa |
| `confirmLabel` | `string` | sim | Verbo da ação |
| `cancelLabel` | `string` | não, default `"Cancelar"` | — |
| `onConfirm` | `() => void \| Promise<void>` | sim | Callback |
| `onCancel` | `() => void` | não | Callback customizado (default fecha) |
| `loading` | `boolean` | não | Estado async |
| `size` | Size | default `'sm'` | — |

### Comportamento

- Botão `Confirmar` em estado primary + texto com verbo.
- Botão `Cancelar` à esquerda, secondary.
- Se `onConfirm` retorna Promise, botão entra em loading automaticamente.
- ESC e click no overlay fecham como se fosse Cancel.

## DestructiveConfirmDialog

### Uso

Confirmar ação irreversível (delete, override de dados).

### API

Mesma que `ConfirmDialog`, com diferenças visuais:

```tsx
<DestructiveConfirmDialog
    open={open}
    onOpenChange={setOpen}
    title="Excluir membro?"
    description="Esta ação não pode ser desfeita. O membro perderá acesso imediato à plataforma."
    confirmLabel="Excluir membro"
    onConfirm={handleDelete}
/>
```

### Diferenças visuais

- Ícone `AlertTriangle` no header, cor `danger`.
- Botão `Confirmar` em `variant="danger"` (vermelho).
- Opcional: campo de confirmação por digitação (`requireTyping: "EXCLUIR"`) para ações muito destrutivas.

```tsx
<DestructiveConfirmDialog
    ...
    requireTyping={{
        expected: 'EXCLUIR',
        prompt: 'Digite EXCLUIR para confirmar:',
    }}
/>
```

Quando `requireTyping` presente, botão Confirm fica desabilitado até o texto bater exatamente.

## FormDialog

### Uso

Modal contendo um formulário (ex: adicionar membro, editar conta).

### API compound

```tsx
<FormDialog.Root open={open} onOpenChange={setOpen} size="md">
    <FormDialog.Header>
        <FormDialog.Title>Adicionar membro</FormDialog.Title>
        <FormDialog.Description>Envie um convite por e-mail</FormDialog.Description>
    </FormDialog.Header>

    <FormDialog.Body>
        <AddMemberForm formRef={formRef} onSubmit={handleSubmit} />
    </FormDialog.Body>

    <FormDialog.Footer>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button
            variant="primary"
            onClick={() => formRef.current?.submit()}
            loading={submitting}
        >
            Adicionar
        </Button>
    </FormDialog.Footer>
</FormDialog.Root>
```

### Comportamento

- Form vive dentro do body; botão de submit no footer dispara via ref.
- Ao fechar com form dirty: confirm "Descartar alterações?" antes de fechar.
- Enter no último campo submete; Esc cancela (com prompt se dirty).
- `autoFocus` no primeiro campo ao abrir.

## InfoDialog

### Uso

Conteúdo informativo longo (help, changelog, detalhes). Sem decisão, apenas leitura.

### API

```tsx
<InfoDialog
    open={open}
    onOpenChange={setOpen}
    title="Como funciona o reprocessamento"
    size="md"
>
    <div className="space-y-md">
        <p>Ao reprocessar uma nota, ela é re-enviada para a fila...</p>
        <ul className="list-disc pl-lg space-y-xs">
            <li>Notas com status SAVED entram na fila de contabilização</li>
            <li>Notas PENDING são reenviadas com flag is_reprocessing</li>
        </ul>
        <Link href="/docs/reprocessamento">Ver documentação completa</Link>
    </div>
</InfoDialog>
```

### Props

| Prop | Tipo | Descrição |
|---|---|---|
| `open`, `onOpenChange` | — | Controlled |
| `title` | `string` | — |
| `children` | `ReactNode` | Conteúdo rico |
| `dismissLabel` | `string` | default `"Entendi"` |
| `size` | Size | default `'md'` |

### Comportamento

- Um único botão no footer ("Entendi") — sem ação secundária.
- Suporta conteúdo rolável se ultrapassar altura da viewport.

## Drawer

### Uso

Conteúdo lateral deslizante. Bom para detalhes (preview de nota, logs), filtros em mobile, formulários secundários.

### API

```tsx
<Drawer.Root open={open} onOpenChange={setOpen} side="right" size="lg">
    <Drawer.Header>
        <Drawer.Title>Detalhes da nota #001234</Drawer.Title>
        <Drawer.CloseButton />
    </Drawer.Header>

    <Drawer.Body>
        <NotaDetailsContent id={notaId} />
    </Drawer.Body>

    <Drawer.Footer>
        <Button variant="primary">Reprocessar</Button>
    </Drawer.Footer>
</Drawer.Root>
```

### Props — Drawer.Root

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `side` | `'left' \| 'right' \| 'bottom'` | `'right'` | Lado de entrada |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Largura: 400 / 560 / 720 / 960px (tela cheia abaixo de `sm`); altura 40/60/80/95vh se bottom |
| `modal` | `boolean` | `true` | `false` = gaveta de detalhe ao lado do conteúdo (ver abaixo) |
| `closeOnOverlayClick` | `boolean` | `true` | Só no modo modal |
| `focusKey` | `string` | — | Identidade do conteúdo; trocar com a gaveta aberta re-foca a gaveta |

Implementação: `components/ui/drawer.tsx` (Radix Dialog). Tokens: `--z-drawer`, `--shadow-drawer`,
`--duration-slow`.

### Comportamento

- Slide de duração `duration-slow` (300ms); sem animação com `prefers-reduced-motion`.
- Backdrop com `bg-overlay` (modal).
- Focus trap (modal).
- ESC fecha.
- O foco entra no painel ao abrir (no próprio painel, anunciado pelo título, não na primeira ação)
  e volta ao elemento que abriu ao fechar.

### Drawer não modal (`modal={false}`)

Para detalhe de uma linha que o usuário compara com a tabela atrás (ex.: "Boletos DDA do título",
SISPAG). Sem backdrop e sem focus trap: a página continua visível e clicável; clique fora **não**
fecha (só ESC e o X). Abrir outra linha com a gaveta aberta troca o conteúdo (`focusKey`) e o foco
passa a voltar para o último gatilho. A linha ativa na tabela fica marcada com
`aria-current="true"` e fundo `primary/10` com filete à esquerda (`--shadow-selection`, ver
`tokens.md` § Seleção de linha). `role="dialog"` sem `aria-modal`.

Entre `xl` e `2xl` (1280–1535px) a gaveta não modal estreita para `--drawer-detail-width` (480px),
o contêiner da tabela atrás termina onde ela começa (`--drawer-detail-reserve`) e a tabela compacta:
cabeçalhos quebram linha, Credor fica truncado (nome no `title`) e as colunas de baixa prioridade
saem, só enquanto a gaveta está aberta. Com a navegação lateral expandida (224px) a tabela não
cabe nos 527px que sobram: Vencimento e Forma de pagamento ficam a uma rolagem horizontal, nunca
sob a gaveta.
No SISPAG (1280px) ficam à vista Credor, Documento, Nº doc, Valor, Vencimento e Forma de pagamento,
onde está o gatilho que troca o título da gaveta; somem Situação, Próxima ação e Filial.

## MultiStepDialog (wizard)

### Uso

Fluxos com mais de uma etapa (seleção → edição → revisão → envio). O ReprocessModal é o exemplo canônico.

### Anatomia

```
┌──────────────────────────────────────────────────────┐
│ Header                                                │
│  Título do wizard                  [X]                │
│  ① Selecionar ─ ② Editar ─ ③ Revisar ─ ④ Envio       │
├──────────────────────────────────────────────────────┤
│ Body (conteúdo da etapa atual)                        │
│                                                       │
│                                                       │
├──────────────────────────────────────────────────────┤
│ Footer                                                │
│  [← Voltar]              [Cancelar]  [Próximo →]     │
└──────────────────────────────────────────────────────┘
```

### API compound

```tsx
<MultiStepDialog.Root open={open} onOpenChange={setOpen} size="lg">
    <MultiStepDialog.Header>
        <MultiStepDialog.Title>Reprocessar nota</MultiStepDialog.Title>
        <MultiStepDialog.Stepper
            steps={[
                { id: 'select', label: 'Selecionar' },
                { id: 'edit', label: 'Editar' },
                { id: 'review', label: 'Revisar' },
                { id: 'submit', label: 'Envio' },
            ]}
            activeStepId={activeStep}
        />
    </MultiStepDialog.Header>

    <MultiStepDialog.Body>
        {activeStep === 'select' && <SelectStep ... />}
        {activeStep === 'edit' && <EditStep ... />}
        {activeStep === 'review' && <ReviewStep ... />}
        {activeStep === 'submit' && <SubmitStep ... />}
    </MultiStepDialog.Body>

    <MultiStepDialog.Footer>
        <MultiStepDialog.BackButton disabled={activeStep === 'select'} onClick={prev} />
        <MultiStepDialog.Spacer />
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        {activeStep !== 'submit' ? (
            <MultiStepDialog.NextButton onClick={next} disabled={!canAdvance} />
        ) : (
            <Button variant="primary" loading={submitting} onClick={confirm}>
                Reprocessar
            </Button>
        )}
    </MultiStepDialog.Footer>
</MultiStepDialog.Root>
```

### Props — Stepper

| Prop | Tipo | Descrição |
|---|---|---|
| `steps` | `Step[]` | Lista ordenada |
| `activeStepId` | `string` | Step atual |
| `completedStepIds` | `string[]` | Steps concluídos (check verde) |
| `allowJumpToCompleted` | `boolean` | default `true` — clicar em step concluído volta |

**`Step`:**

```ts
{
    id: string;
    label: string;
    description?: string;
    optional?: boolean;    // visual: exibe "(opcional)" ao lado do label
    hidden?: boolean;      // remove do stepper e pula na navegação
}
```

### Passos condicionais — skip dinâmico

Em fluxos reais, uma etapa nem sempre se aplica (ex.: "Ajustes" só faz sentido se existem campos editáveis no lote selecionado). O padrão é: a **página** decide em tempo real quais steps são relevantes e passa `hidden: true` nos que devem ser pulados. O modal é burro — ele apenas respeita a lista.

```tsx
const steps = useMemo<Step[]>(() => [
    { id: 'select',  label: 'Seleção' },
    { id: 'adjust', label: 'Ajustes', optional: true, hidden: !hasAdjustableFields },
    { id: 'review', label: 'Revisão' },
    { id: 'submit', label: 'Resultado' },
], [hasAdjustableFields]);
```

**Regras:**

- Steps com `hidden: true` **não aparecem no Stepper** e são pulados tanto pelo botão "Próximo" quanto por "Voltar".
- Se o usuário já estava no step hoje escondido quando a condição muda, o modal navega automaticamente para o próximo step visível (nunca fica travado em step oculto).
- Mudar `hidden` em runtime é permitido, mas evite fazê-lo com frequência — a sensação deve ser de ausência (o step nunca existiu), não de desaparecimento.
- Nunca use `hidden` para esconder a etapa final (submit/resultado) — ela é estrutural.
- A lógica de "qual step é o próximo" permanece no consumidor (`next()` / `prev()` calculam o próximo step com `hidden !== true`).

**Exemplo de helper no consumer:**

```ts
function nextVisible(current: string, steps: Step[]): string {
    const visible = steps.filter((s) => !s.hidden);
    const idx = visible.findIndex((s) => s.id === current);
    return visible[Math.min(idx + 1, visible.length - 1)].id;
}
```

### Comportamento

- Step ativo em cor `primary`, com número ou ícone do step.
- Steps concluídos em cor `success` com ícone check.
- Steps futuros em cor `muted`.
- Clicar em step concluído volta (se `allowJumpToCompleted`).
- Não permite avançar se `canAdvance === false` (validação da etapa atual).
- Botão "Próximo" muda label no último step (ex: "Reprocessar", "Confirmar").
- Estado do wizard vive na **página**, não no modal. O modal é burro; a lógica de qual step mostrar está no consumer.

### Estados

- **idle**: step inativo.
- **active**: step atual, destacado.
- **completed**: step concluído, verde com check.
- **invalid**: step com erro (ex: submissão falhou), vermelho com ícone alerta.
- **disabled**: step bloqueado (pré-requisito não cumprido).

## Exemplo concreto — ReprocessModal

Este exemplo materializa o padrão multi-etapas para o caso real de reprocessamento de nota fiscal. Vive em `features/notas/`, não no DS.

```tsx
type Step = 'select' | 'edit' | 'review' | 'submit';

function ReprocessModal({ open, onOpenChange, nota }: Props) {
    const [step, setStep] = useState<Step>('select');
    const [formData, setFormData] = useState<ReprocessFormData>({
        numeroProcesso: nota.numeroProcesso ?? '',
        contaProjeto: nota.contaProjeto ?? '',
        forceOverride: false,
    });
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<SubmitResult | null>(null);

    const next = () => {
        const order: Step[] = ['select', 'edit', 'review', 'submit'];
        const idx = order.indexOf(step);
        if (idx < order.length - 1) setStep(order[idx + 1]);
    };

    const prev = () => {
        const order: Step[] = ['select', 'edit', 'review', 'submit'];
        const idx = order.indexOf(step);
        if (idx > 0) setStep(order[idx - 1]);
    };

    const submit = async () => {
        setSubmitting(true);
        try {
            await reprocessNota(nota.id, formData);
            setResult({ success: true });
            toast.success('Nota enviada para reprocessamento');
        } catch (err) {
            setResult({ success: false, error: err.message });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <MultiStepDialog.Root open={open} onOpenChange={onOpenChange} size="lg">
            <MultiStepDialog.Header>
                <MultiStepDialog.Title>Reprocessar nota {nota.id}</MultiStepDialog.Title>
                <MultiStepDialog.Stepper
                    steps={[
                        { id: 'select', label: 'Tipo' },
                        { id: 'edit', label: 'Configuração' },
                        { id: 'review', label: 'Revisão' },
                        { id: 'submit', label: 'Resultado' },
                    ]}
                    activeStepId={step}
                    completedStepIds={stepsCompletedBefore(step)}
                />
            </MultiStepDialog.Header>

            <MultiStepDialog.Body>
                {step === 'select' && (
                    <SelectTypeStep
                        onChange={(type) => setFormData(d => ({ ...d, type }))}
                    />
                )}
                {step === 'edit' && (
                    <EditDataStep
                        value={formData}
                        onChange={setFormData}
                    />
                )}
                {step === 'review' && (
                    <ReviewStep
                        nota={nota}
                        formData={formData}
                    />
                )}
                {step === 'submit' && (
                    <SubmitResultStep
                        result={result}
                        submitting={submitting}
                    />
                )}
            </MultiStepDialog.Body>

            <MultiStepDialog.Footer>
                <MultiStepDialog.BackButton
                    onClick={prev}
                    disabled={step === 'select' || step === 'submit'}
                />
                <MultiStepDialog.Spacer />
                {step !== 'submit' && (
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                )}
                {step === 'review' ? (
                    <Button variant="primary" loading={submitting} onClick={submit}>
                        Reprocessar
                    </Button>
                ) : step === 'submit' ? (
                    <Button variant="primary" onClick={() => onOpenChange(false)}>
                        Fechar
                    </Button>
                ) : (
                    <MultiStepDialog.NextButton onClick={next} />
                )}
            </MultiStepDialog.Footer>
        </MultiStepDialog.Root>
    );
}
```

## Acessibilidade

- Todas as variantes usam `role="dialog"` com `aria-modal="true"`.
- `aria-labelledby` → `Dialog.Title` id.
- `aria-describedby` → `Dialog.Description` id (se presente).
- Focus trap: Tab cicla apenas dentro do modal.
- Focus inicial: primeiro elemento focável (ou elemento com `autoFocus`).
- Focus retorna ao trigger ao fechar.
- ESC fecha (configurável).
- Scroll do body bloqueado enquanto modal aberto.
- `MultiStepDialog.Stepper` tem `role="list"` e cada step é `<li>` com `aria-current="step"` no ativo.

## Comportamento em ações async

- Botão de ação em `loading` durante a promise.
- Modal **não fecha** enquanto loading.
- ESC e overlay click desabilitados durante loading.
- Em caso de erro, mantém o modal aberto e mostra mensagem; usuário decide tentar de novo ou cancelar.

## Empilhamento (stacking)

- Dois modais simultaneamente é permitido mas raro. Use quando confirmação emerge de um modal já aberto (ex: FormDialog aberto → usuário tenta fechar com dirty → ConfirmDialog pergunta).
- z-index aumenta automaticamente (`--z-modal-backdrop` + `--z-modal` empilham via Radix).
- Evite 3+ modais empilhados — sinaliza problema de design.

## Do / Don't

**Do**

- Use verbo específico no botão de confirmação, não "OK".
- Use `DestructiveConfirmDialog` com `requireTyping` para ações muito destrutivas (deletar tenant, resetar dados de usuário).
- Use `MultiStepDialog` quando a etapa exige decisão/revisão progressiva.
- Use `Drawer` para detalhes "rastreáveis" em que o usuário pode querer navegar no conteúdo principal.
- Mantenha modais focados — um propósito por modal.

**Don't**

- Não use modal para feedback passivo (use toast).
- Não use modal para mostrar mensagem de erro sem permitir recuperação.
- Não abra modal automaticamente ao carregar página (interrompe expectativa do usuário).
- Não coloque CTAs que não sejam a ação do modal no footer (links externos, settings).
- Não use dois botões primary no mesmo footer — confunde o usuário.
- Não feche modal em erro de submit — usuário perde contexto.
- Não tente animar modais durante scroll da página.
