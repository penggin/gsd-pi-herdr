'use strict'

const { existsSync } = require('fs')
const { join } = require('path')

/** Install-time fallback — mirrors src/resources/shared/gsd-pi-logo.ts */
const fallback = {
  GSD_PI_BRAND: 'GSD-Pi',
  GSD_WEBSITE: 'https://github.com/penggin/gsd-pi-herdr',
  GSD_PI_LOGO: [
    '  ██████╗ ███████╗██████╗ ─ ██████╗ ██╗',
    ' ██╔════╝ ██╔════╝██╔══██╗ ██╔══██╗██║',
    ' ██║  ███╗███████╗██║  ██║ ██████╔╝██║',
    ' ██║   ██║╚════██║██║  ██║ ██╔═══╝ ██║',
    ' ╚██████╔╝███████║██████╔╝ ██║     ██║',
    '  ╚═════╝ ╚══════╝╚═════╝  ╚═╝     ╚═╝',
  ],
  renderGsdPiLogo(color) {
    return '\n' + this.GSD_PI_LOGO.map(color).join('\n') + '\n'
  },
}

const distLogo = join(__dirname, '..', '..', 'dist', 'logo.js')

function isRequireEsmError(err) {
  return err && typeof err === 'object' && err.code === 'ERR_REQUIRE_ESM'
}

function loadLogo() {
  if (!existsSync(distLogo)) return fallback

  try {
    return require(distLogo)
  } catch (err) {
    if (isRequireEsmError(err)) return fallback
    throw err
  }
}

module.exports = loadLogo()
