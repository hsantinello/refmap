// Roda depois do empacotamento e ANTES de gerar o .dmg/.zip (só no macOS):
//
// 1) CONFERE A ARQUITETURA dos binários nativos (better-sqlite3, sharp/libvips,
//    ffmpeg). Na v0.0.34 o DMG Intel saiu com todos eles em arm64, porque os dois
//    DMGs eram gerados numa máquina com chip Apple: o app nem abria em Mac Intel.
//    Agora cada arquitetura é compilada na sua máquina (publish.yml), e este passo
//    derruba o build se algo vier errado — antes de qualquer arquivo ser publicado.
//
// 2) ASSINATURA AD-HOC (gratuita, sem conta de desenvolvedor Apple). Sem nenhuma
//    assinatura, o macOS em chip Apple diz que o app "está danificado e não pode
//    ser aberto" — aviso sem o botão "Abrir Mesmo Assim". Com a ad-hoc, o aviso
//    vira "a Apple não pôde verificar…", que a pessoa libera em Ajustes do
//    Sistema → Privacidade e Segurança (instrução no fundo do DMG). O
//    electron-builder 25 não faz ad-hoc sozinho: com CSC_IDENTITY_AUTO_DISCOVERY
//    false ele apenas pula a assinatura.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
// context.arch é o enum Arch do electron-builder: 1 = x64, 3 = arm64.
const ARCH = { 1: 'x64', 3: 'arm64' }
const LIPO = { x64: 'x86_64', arm64: 'arm64' }

// Só Mach-O interessa: pacotes como o onnxruntime-node trazem binários de Linux
// e Windows junto, e o `lipo` falha neles (foi o que derrubou o 1º build da 0.0.35).
function ehMachO(p) {
  const fd = fs.openSync(p, 'r')
  const b = Buffer.alloc(4)
  fs.readSync(fd, b, 0, 4, 0)
  fs.closeSync(fd)
  const m = b.toString('hex')
  return m === 'cffaedfe' || m === 'cefaedfe' || m === 'cafebabe'
}

// Binários que o app USA de fato: têm de estar na arquitetura do build. Os demais
// (ex.: onnxruntime-node traz darwin/arm64 e darwin/x64 juntos e nem é usado)
// só são assinados.
const ESSENCIAIS = [
  /better-sqlite3[\\/]build[\\/]Release[\\/]better_sqlite3\.node$/,
  /ffmpeg-static[\\/]ffmpeg$/,
  /@img[\\/]sharp-darwin-[^\\/]+[\\/]lib[\\/][^\\/]+\.node$/,
  /@img[\\/]sharp-libvips-darwin-[^\\/]+[\\/]lib[\\/][^\\/]+\.dylib$/,
]

function binariosNativos(dir) {
  const achados = []
  const andar = d => {
    for (const nome of fs.readdirSync(d)) {
      const p = path.join(d, nome)
      const st = fs.lstatSync(p)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) andar(p)
      else if ((/\.(node|dylib)$/.test(nome) || (nome === 'ffmpeg' && p.includes('ffmpeg-static'))) && ehMachO(p)) achados.push(p)
    }
  }
  if (fs.existsSync(dir)) andar(dir)
  return achados
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const arch = ARCH[context.arch]
  const esperado = LIPO[arch]
  if (!esperado) throw new Error(`[after-pack] arquitetura inesperada: ${arch}`)

  const unpacked = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
  const binarios = binariosNativos(unpacked)
  const errados = []
  for (const b of binarios) {
    const archs = execFileSync('lipo', ['-archs', b]).toString().trim().split(/\s+/)
    const rel = path.relative(unpacked, b)
    console.log(`[after-pack] ${archs.join(',').padEnd(14)} ${rel}`)
    if (ESSENCIAIS.some(re => re.test(b)) && !archs.includes(esperado)) errados.push(`${rel} (${archs.join(',')})`)
  }
  for (const re of ESSENCIAIS) {
    if (!binarios.some(b => re.test(b))) errados.push(`não encontrado: ${re}`)
  }
  if (errados.length) {
    throw new Error(`[after-pack] binários fora de ${esperado} no build ${arch}:\n  ${errados.join('\n  ')}`)
  }

  // Em chip Apple, binário sem NENHUMA assinatura nem executa. O --deep só cobre
  // bundles/frameworks, não os binários soltos em Resources: assina um a um antes.
  for (const b of binarios) execFileSync('codesign', ['--force', '--sign', '-', b], { stdio: 'inherit' })

  console.log(`[after-pack] assinatura ad-hoc: ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' })
}
