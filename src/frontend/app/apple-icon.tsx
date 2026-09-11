import { ImageResponse } from 'next/og'

/**
 * Variante PNG da marca (`apple-touch-icon`). O `icon.svg` já resolve a aba em qualquer navegador
 * atual; este arquivo existe para os consumidores que **não** leem favicon SVG — iOS/Safari ao
 * salvar na tela inicial e alguns clientes Microsoft, que sondam `apple-touch-icon` para o ícone
 * pequeno do card de link.
 *
 * Mesma barra do `icon.svg` em escala 180/32. O que muda de propósito é o canto: aqui o tile é
 * quadrado porque o iOS aplica a própria máscara arredondada por cima — arredondar dos dois lados
 * deixaria a borda serrilhada. O `icon.svg`, que ninguém mascara, traz o raio no próprio arquivo.
 */

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2266a4',
      }}
    >
      <div
        style={{
          width: '45px',
          height: '101px',
          borderRadius: '11px',
          backgroundColor: '#ffffff',
        }}
      />
    </div>,
    { ...size },
  )
}
