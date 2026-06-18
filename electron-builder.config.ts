import { defineConfig } from 'electron-builder'

export default defineConfig({
  appId: 'com.refmap.app',
  productName: 'Ref Map',
  copyright: 'Copyright © 2026',

  // GitHub Releases as the auto-update source.
  // Set owner/repo to match your GitHub repository.
  // To publish: GH_TOKEN=<your_token> npm run dist:win:publish
  publish: [
    {
      provider: 'github',
      owner: 'hsantinello',
      repo: 'refmap',
      releaseType: 'release',
    },
  ],

  directories: {
    output: 'dist-release',
    buildResources: 'build',
  },

  files: [
    'out/**/*',
    'node_modules/**/*',
    '!node_modules/.cache',
  ],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.png',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Ref Map',
  },

  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'build/icon.icns',
    category: 'public.app-category.graphics-design',
  },
})
