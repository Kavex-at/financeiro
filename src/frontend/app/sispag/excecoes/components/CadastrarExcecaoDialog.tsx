'use client'

import { Landmark } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  cadastrarExcecao,
  type DestinoManualEntrada,
  type ExcecaoDestinoResumo,
  validarDestinoManual,
} from '@/lib/sispag'

type Aba = 'CONTA' | 'CHAVE_PIX'

/** Um campo de texto com label, erro inline e `aria-describedby` (docs/design-system/forms.md). */
function Campo({
  id,
  label,
  valor,
  onChange,
  erro,
  className,
  inputMode = 'numeric',
  descricao,
}: {
  id: string
  label: string
  valor: string
  onChange: (v: string) => void
  erro?: string
  className?: string
  inputMode?: 'numeric' | 'text'
  descricao?: string
}) {
  const erroId = `${id}-erro`
  const descId = `${id}-desc`
  const describedBy = [erro ? erroId : null, descricao && !erro ? descId : null]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={valor}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="aria-invalid:border-destructive"
      />
      {erro ? (
        <p id={erroId} role="alert" className="text-xs text-destructive">
          {erro}
        </p>
      ) : descricao ? (
        <p id={descId} className="text-xs text-muted-foreground">
          {descricao}
        </p>
      ) : null}
    </div>
  )
}

/** De quem é a exceção: um título (lido ao vivo pelo backend) ou um favorecido digitado. */
export interface FavorecidoDaExcecao {
  filCod: number
  docCod?: string
  titCod?: string
  credor?: string
}

/**
 * "Cadastrar exceção de destino" (ADR-0060) — conta (TED) ou chave PIX CPF/CNPJ de um favorecido
 * que difere do cadastro do Conexos. A exceção nasce PENDENTE: outra pessoa com a permissão
 * precisa aprová-la. Vale para o favorecido, em qualquer lote, até ser revogada ou o cadastro
 * assumir. Não escreve no cadastro do Conexos.
 *
 * O formato é conferido aqui (espelho do backend). Titularidade (o CPF/CNPJ tem de ser o do
 * favorecido, lido ao vivo) e permissão são do backend: a mensagem dele fica INLINE com o diálogo
 * aberto. O valor digitado não é logado nem reexibido: depois de salvar só a máscara existe.
 */
export function CadastrarExcecaoDialog({
  favorecido,
  tedEnabled,
  pixEnabled,
  preferirPix = false,
  onOpenChange,
  onCadastrada,
}: {
  /** Ausente = tela de exceções: a pessoa informa filial e código do favorecido. */
  favorecido?: FavorecidoDaExcecao
  tedEnabled: boolean
  pixEnabled: boolean
  preferirPix?: boolean
  onOpenChange: (open: boolean) => void
  onCadastrada: (excecao: ExcecaoDestinoResumo) => void
}) {
  const inicial: Aba = pixEnabled && (preferirPix || !tedEnabled) ? 'CHAVE_PIX' : 'CONTA'
  const [aba, setAba] = React.useState<Aba>(inicial)
  const [filial, setFilial] = React.useState(favorecido ? String(favorecido.filCod) : '')
  const [pesCod, setPesCod] = React.useState('')
  const [conta, setConta] = React.useState({
    bancoCod: '',
    agencia: '',
    agenciaDv: '',
    conta: '',
    contaDv: '',
  })
  const [chavePix, setChavePix] = React.useState('')
  const [titular, setTitular] = React.useState('')
  const [justificativa, setJustificativa] = React.useState('')
  const [erros, setErros] = React.useState<Partial<Record<string, string>>>({})
  const [erroServidor, setErroServidor] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const campoConta = (k: keyof typeof conta) => (v: string) => {
    setConta((c) => ({ ...c, [k]: v }))
    setErros((e) => ({ ...e, [k]: undefined }))
  }
  const limpar = (k: string) => setErros((e) => ({ ...e, [k]: undefined }))

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return
    const entrada: DestinoManualEntrada =
      aba === 'CONTA'
        ? { tipo: 'CONTA', ...conta, titularDocumento: titular }
        : { tipo: 'CHAVE_PIX', chavePixTipo: 'CPF_CNPJ', chavePix, titularDocumento: titular }
    const { destino, erros: validados } = validarDestinoManual(entrada)
    const encontrados: Partial<Record<string, string>> = { ...validados }
    const filCod = favorecido ? favorecido.filCod : Number.parseInt(filial, 10)
    if (!favorecido) {
      if (!Number.isInteger(filCod) || filCod <= 0) encontrados.filial = 'Informe a filial.'
      if (pesCod.trim() === '') encontrados.pesCod = 'Informe o código do favorecido.'
    }
    if (justificativa.trim() === '') {
      encontrados.justificativa = 'Explique por que o destino difere do cadastro do Conexos.'
    }
    setErros(encontrados)
    setErroServidor(null)
    if (!destino || Object.keys(encontrados).length > 0) return
    setSalvando(true)
    try {
      const criada = await cadastrarExcecao({
        filCod,
        ...(favorecido?.docCod && favorecido.titCod
          ? { docCod: favorecido.docCod, titCod: favorecido.titCod }
          : { pesCod: pesCod.trim() }),
        destino,
        justificativa: justificativa.trim(),
      })
      onCadastrada(criada)
    } catch (err) {
      setErroServidor(err instanceof Error ? err.message : 'Não foi possível cadastrar a exceção.')
    } finally {
      setSalvando(false)
    }
  }

  const doTitulo = favorecido?.docCod && favorecido.titCod
  const prefixo = doTitulo ? `excecao-${favorecido.docCod}-${favorecido.titCod}` : 'excecao'

  return (
    <Dialog open onOpenChange={(aberto) => { if (!salvando) onOpenChange(aberto) }}>
      <DialogContent size="lg">
        <form onSubmit={salvar} noValidate>
          <DialogHeader>
            <DialogTitle>Cadastrar exceção de destino</DialogTitle>
            <DialogDescription>
              {doTitulo
                ? `Favorecido do título ${favorecido.docCod}/${favorecido.titCod}${favorecido.credor ? ` · ${favorecido.credor}` : ''}. `
                : ''}
              Só vale quando o cadastro do Conexos não tem conta ou chave ativa, e só depois de
              aprovada por OUTRA pessoa. O cadastro do Conexos não é alterado.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {!favorecido ? (
              <div className="grid grid-cols-6 gap-3">
                <Campo
                  id={`${prefixo}-filial`}
                  label="Filial"
                  valor={filial}
                  onChange={(v) => {
                    setFilial(v)
                    limpar('filial')
                  }}
                  erro={erros.filial}
                  className="col-span-2"
                  descricao="Filial usada para ler o cadastro."
                />
                <Campo
                  id={`${prefixo}-pescod`}
                  label="Código do favorecido (pesCod)"
                  valor={pesCod}
                  onChange={(v) => {
                    setPesCod(v)
                    limpar('pesCod')
                  }}
                  erro={erros.pesCod}
                  className="col-span-4"
                />
              </div>
            ) : null}
            <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
              <TabsList aria-label="Tipo de destino">
                {tedEnabled ? <TabsTrigger value="CONTA">TED (conta)</TabsTrigger> : null}
                {pixEnabled ? <TabsTrigger value="CHAVE_PIX">PIX (chave)</TabsTrigger> : null}
              </TabsList>
              {tedEnabled ? (
                <TabsContent value="CONTA" className="grid grid-cols-6 gap-3 pt-2">
                  <Campo
                    id={`${prefixo}-banco`}
                    label="Banco (FEBRABAN)"
                    valor={conta.bancoCod}
                    onChange={campoConta('bancoCod')}
                    erro={erros.bancoCod}
                    className="col-span-2"
                    descricao="3 dígitos. Ex.: 237"
                  />
                  <Campo
                    id={`${prefixo}-agencia`}
                    label="Agência"
                    valor={conta.agencia}
                    onChange={campoConta('agencia')}
                    erro={erros.agencia}
                    className="col-span-3"
                  />
                  <Campo
                    id={`${prefixo}-agencia-dv`}
                    label="DV da agência"
                    valor={conta.agenciaDv}
                    onChange={campoConta('agenciaDv')}
                    erro={erros.agenciaDv}
                    className="col-span-1"
                  />
                  <Campo
                    id={`${prefixo}-conta`}
                    label="Conta"
                    valor={conta.conta}
                    onChange={campoConta('conta')}
                    erro={erros.conta}
                    className="col-span-4"
                  />
                  <Campo
                    id={`${prefixo}-conta-dv`}
                    label="DV da conta"
                    valor={conta.contaDv}
                    onChange={campoConta('contaDv')}
                    erro={erros.contaDv}
                    className="col-span-2"
                  />
                </TabsContent>
              ) : null}
              {pixEnabled ? (
                <TabsContent value="CHAVE_PIX" className="space-y-3 pt-2">
                  <Campo
                    id={`${prefixo}-chave`}
                    label="Chave PIX (CPF/CNPJ)"
                    valor={chavePix}
                    onChange={(v) => {
                      setChavePix(v)
                      limpar('chavePix')
                    }}
                    erro={erros.chavePix}
                    inputMode="text"
                    descricao="Só chave CPF/CNPJ, a única em que conseguimos conferir o titular."
                  />
                </TabsContent>
              ) : null}
            </Tabs>
            <Campo
              id={`${prefixo}-titular`}
              label="CPF/CNPJ do titular"
              valor={titular}
              onChange={(v) => {
                setTitular(v)
                limpar('titularDocumento')
              }}
              erro={erros.titularDocumento}
              descricao="Tem de ser o CPF/CNPJ do favorecido, como está no cadastro do Conexos."
            />
            <div className="space-y-1.5">
              <Label htmlFor={`${prefixo}-justificativa`}>Justificativa</Label>
              <Textarea
                id={`${prefixo}-justificativa`}
                value={justificativa}
                onChange={(e) => {
                  setJustificativa(e.target.value)
                  limpar('justificativa')
                }}
                aria-invalid={erros.justificativa ? true : undefined}
                aria-describedby={erros.justificativa ? `${prefixo}-justificativa-erro` : undefined}
                autoComplete="off"
              />
              {erros.justificativa ? (
                <p
                  id={`${prefixo}-justificativa-erro`}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {erros.justificativa}
                </p>
              ) : null}
            </div>
            {erroServidor ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
              >
                {erroServidor}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? <Spinner aria-hidden /> : <Landmark className="size-4" aria-hidden />}
              Cadastrar exceção
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
