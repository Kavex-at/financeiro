# Pedir autorização de favorecido — busca no Conexos (v0.61.0)

Capturas de 2026-10-09 do **frontend real desta versão** (Next.js, Chrome headless), com a API
simulada por um mock local de **dados fictícios** (ACME/BETA são inventados). A máscara de
CPF/CNPJ, conta e chave PIX é a do `MaskDestino` real, e o 429 da última tela vem do
`buildPayeeSearchLimiter` real (a 31ª busca no minuto). Nada aqui foi lido do Conexos.

| # | Tela | O que mostra |
|---|------|--------------|
| 1 | `01-pagina-com-dialogo.png` | O pedido abre com a busca no lugar do campo de código. |
| 2 | `02-resultados-da-busca.png` | Busca "acme": nome, nome fantasia, código, CNPJ mascarado, TED já autorizado, selo **Bloqueado**. |
| 3 | `03-previa-ted-mascarada.png` | Favorecido escolhido; conta do cadastro mascarada (`banco 237 · ag. 1234 · cc ****9876-5`). |
| 4 | `04-sem-chave-pix-bloqueia.png` | PIX sem chave no cadastro: aviso e botão desabilitado. |
| 5 | `05-ted-ja-autorizado-pix-livre.png` | TED já autorizado fica desabilitado; PIX escolhido com a chave mascarada. |
| 6 | `06-limite-por-usuario-429.png` | Passou de 30 buscas/min: "Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo." |
