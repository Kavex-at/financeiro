import { ImageResponse } from 'next/og'

/**
 * Imagem do card de link (`og:image`) — é o que Teams, Outlook e Slack mostram ao desdobrar a URL.
 * Sem este arquivo o unfurl vinha com o placeholder cinza: o crawler achava `<title>` e
 * `<meta name="description">`, mas nenhuma imagem.
 *
 * Desenhada aqui em vez de versionada como PNG para não introduzir binário no repo e para o
 * wordmark acompanhar o header real da aplicação (`AppShellLogo`): a barra em `--primary`
 * (`oklch(0.50 0.12 250)` = `#2266a4`) seguida de "Columbia Trading / Financeiro".
 *
 * Duas restrições do renderer (Satori) que explicam escolhas abaixo: aceita só um subconjunto de
 * CSS — flexbox sim, grid não, e todo elemento com mais de um filho precisa de `display: flex`
 * explícito; e a fonte embutida do Next só tem peso normal, então `fontWeight: 700` não produz
 * negrito de verdade. A hierarquia do card vem do contraste de corpo e cor, não do peso. Carregar
 * a DM Sans da aplicação exigiria buscar o arquivo na rede durante o build — um build que quebra
 * offline em troca de um negrito não vale a troca.
 */

export const alt = 'Columbia Trading · Financeiro — plataforma financeira'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BRAND = '#2266a4'

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#ffffff',
        padding: '80px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            width: '28px',
            height: '84px',
            borderRadius: '8px',
            backgroundColor: BRAND,
            marginRight: '28px',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <div style={{ fontSize: '64px', fontWeight: 700, color: '#0a0a0a' }}>Columbia Trading</div>
          <div style={{ fontSize: '40px', color: '#737373', marginLeft: '20px' }}>/ Financeiro</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '44px', color: '#404040' }}>Plataforma financeira</div>
        <div style={{ fontSize: '28px', color: '#737373', marginTop: '18px' }}>
          Permutas · SISPAG · Popula GED · Conciliação de Recebimentos
        </div>
      </div>

      <div style={{ display: 'flex', height: '12px', width: '100%', backgroundColor: BRAND }} />
    </div>,
    { ...size },
  )
}
