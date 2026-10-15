"""Gera build/dmg-background.png — o fundo da janela do instalador no Mac.

O macOS desenha por cima dois ícones: o do Ref Map e o atalho da pasta
Aplicativos, nas posições de package.json → build.dmg.contents (150,150) e
(450,150). Este fundo só traz a caixa de instruções embaixo: como instalar e,
como o app não tem assinatura da Apple, como liberar na primeira abertura.

Uso: python scripts/make-dmg-background.py   (precisa de Pillow)
     python scripts/make-dmg-background.py --preview   (simula os ícones)
"""
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 600, 440
S = 2  # desenha em 2x e reduz: texto mais nítido
img = Image.new('RGB', (W * S, H * S), (18, 18, 18))
d = ImageDraw.Draw(img)

FONTES = 'C:/Windows/Fonts/'
def fonte(nome, tam):
    return ImageFont.truetype(FONTES + nome, tam * S)

f_txt = fonte('segoeui.ttf', 12)
f_bold = fonte('segoeuib.ttf', 12)
f_en = fonte('segoeui.ttf', 10)

LARANJA = (249, 115, 22)
BRANCO = (235, 235, 235)
CINZA = (150, 150, 150)

x0, y0, x1, y1 = 28, 232, W - 28, H - 16
d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=12 * S, fill=(30, 22, 18), outline=(120, 60, 20), width=S)

linhas = [
    (f_bold, LARANJA, 'Para instalar: arraste o Ref Map para a pasta Aplicativos.'),
    (f_txt, BRANCO, 'O Mac bloqueou na primeira abertura? É normal. Para liberar:'),
    (f_txt, BRANCO, '1. Abra o Ref Map e feche o aviso (Concluído / OK).'),
    (f_txt, BRANCO, '2. Ajustes do Sistema → Privacidade e Segurança.'),
    (f_txt, BRANCO, '3. Role até o fim e clique em "Abrir Mesmo Assim".'),
    (f_en, CINZA, 'Drag Ref Map to Applications. Blocked on first launch? Close the warning, then'),
    (f_en, CINZA, 'System Settings → Privacy & Security → "Open Anyway".'),
]
ty = y0 + 14
for f, cor, texto in linhas:
    d.text(((x0 + 18) * S, ty * S), texto, font=f, fill=cor)
    ty += 17 if f is f_en else 24
    if texto.startswith('Para instalar') or texto.startswith('3.'):
        ty += 6

img = img.resize((W, H), Image.LANCZOS)
img.save('build/dmg-background.png')
print('ok: build/dmg-background.png', img.size)

if '--preview' in sys.argv:
    # Simulação do que a pessoa vê: ícones de 80px centrados nas posições do DMG.
    prev = img.copy()
    pd = ImageDraw.Draw(prev)
    icone = Image.open('build/icon.png').convert('RGBA').resize((80, 80))
    prev.paste(icone, (150 - 40, 150 - 40), icone)
    pasta = (120, 170, 230)
    pd.rounded_rectangle([410, 120, 490, 182], radius=8, fill=pasta)
    pd.rounded_rectangle([410, 112, 445, 126], radius=4, fill=pasta)
    f_lbl = ImageFont.truetype(FONTES + 'segoeui.ttf', 12)
    for x, nome in [(150, 'Ref Map'), (450, 'Applications')]:
        w = pd.textlength(nome, font=f_lbl)
        pd.text((x - w / 2, 196), nome, font=f_lbl, fill=BRANCO)
    out = sys.argv[sys.argv.index('--preview') + 1]
    prev.save(out)
    print('preview:', out)
