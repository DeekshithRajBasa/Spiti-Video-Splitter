'use strict'
// Apple Silicon refuses to run unsigned code, so give the app an ad-hoc signature
// when no Developer ID certificate is configured. Users still see Gatekeeper's
// "unidentified developer" prompt the first time (right-click → Open).
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return // a real certificate will sign it
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
