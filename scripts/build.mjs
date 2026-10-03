import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildPackage} from './compiler-package.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await buildPackage({root, compiler:process.env.SOLIDLIL_LILSCRIPT_BIN,
  profiles:[{name:'public',config:'src/lilscript.toml',mode:process.env.SOLIDLIL_BUILD_MODE ?? 'production'}],
  aliases:{'solid-api.js':'index.js','web-api.js':'web.js'},
})
