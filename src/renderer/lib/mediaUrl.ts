// URLs do esquema `refmap://` (ver src/main/media-protocol.ts).
//
// Nunca monte `file://` no renderer: com `webSecurity` ligado o Chromium
// bloqueia, e foi justamente para desligar o `webSecurity` que este esquema
// existe.

/** Arquivo de imagem/vídeo do usuário, por caminho absoluto. */
export function mediaUrl(caminhoAbsoluto: string): string {
  return `refmap://media/${encodeURIComponent(caminhoAbsoluto)}`
}

/** Base da biblioteca do Whisper empacotada com o app. */
export const LIB_URL = 'refmap://lib/'
