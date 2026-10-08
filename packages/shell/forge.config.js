const path = require('path')
const fs = require('fs/promises')
const { execFileSync } = require('child_process')
const AdmZip = require('adm-zip')

// The zip maker uses PowerShell on Windows, which stores paths with backslashes. The zip format
// requires '/', and other systems' tools otherwise extract files named like "resources\app.asar".
function fixZipSeparators(file) {
  const zip = new AdmZip(file)
  const entries = zip.getEntries().filter((e) => e.entryName.includes('\\'))
  if (!entries.length) return 0
  for (const entry of entries) entry.entryName = entry.entryName.replace(/\\/g, '/')
  zip.writeZip(file)
  return entries.length
}

module.exports = {
  packagerConfig: {
    name: 'damecon-browser',
    asar: true,
    extraResource: ['browser/ui'],
    icon: 'icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux'],
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              name: 'browser',
              preload: {
                js: './preload.ts',
              },
            },
          ],
        },
        devServer: {
          client: {
            overlay: false,
          },
        },
      },
    },
  ].filter(Boolean),
  hooks: {
    postMake: async (config, makeResults) => {
      for (const { artifacts } of makeResults)
        for (const file of artifacts.filter((a) => a.endsWith('.zip'))) {
          const fixed = fixZipSeparators(file)
          if (fixed) console.log(`Fixed ${fixed} backslash paths in ${path.basename(file)}`)
        }
      return makeResults
    },
    postPackage: async (config, options) => {
      try {
        var src = path.join(__dirname, '../../extensions')
        var dst = path.join(options.outputPaths[0], 'extensions')
        try {
          await fs.mkdir(dst)
        } catch {}
        const directories = (await fs.readdir(src, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
        for (const dir of directories) {
          var regex = /^(?!kc3kai).*$/
          if (regex.test(dir)) {
            await fs.cp(path.join(src, dir), path.join(dst, dir), { recursive: true })
          }
        }
      } catch (error) {
        console.log('Error copying extensions', error)
      }

      // Electron's binary only carries a linker ad-hoc signature that doesn't cover the bundle,
      // so a downloaded copy is reported as "damaged". Sealing the whole bundle turns that into
      // the regular "unidentified developer" prompt that System Settings can allow.
      if (options.platform === 'darwin') {
        const app = path.join(options.outputPaths[0], `${config.packagerConfig.name}.app`)
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
      }
    },
  },
}
