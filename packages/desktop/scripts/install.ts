#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { appBundle, dmgBundle, signApp } from "./utils"

if (process.platform !== "darwin") {
  throw new Error("desktop install script only supports macOS")
}

const args = Bun.argv.slice(2)
const mode = args.includes("--debug") ? "debug" : "release"
const make = !args.includes("--no-dmg")
const open = !args.includes("--no-open")
const dir = (() => {
  const flag = args.find((item) => item.startsWith("--dir="))
  if (flag) return flag.slice("--dir=".length)
  const idx = args.indexOf("--dir")
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]!
  return "/Applications"
})()
const root = path.join(import.meta.dir, "..")

console.log(`Building ${mode} desktop app...`)
await $`bun ./scripts/ensure-sidecar.ts`.cwd(root)
if (mode === "debug") await $`bunx tauri build --debug -b app`.cwd(root)
if (mode === "release") await $`bunx tauri build -b app`.cwd(root)

const src = appBundle(root, mode)
const dst = path.join(dir, path.basename(src))
const name = path.basename(src, ".app")

await signApp(src)

if (make) {
  const file = dmgBundle(root, mode, src)
  await $`mkdir -p ${path.dirname(file)}`
  await $`rm -f ${file}`
  await $`hdiutil create -volname ${name} -srcfolder ${src} -ov -format UDZO ${file}`
  console.log(`Created ${file}`)
}

await $`mkdir -p ${dir}`
await $`osascript -e ${`tell application "${name}" to quit`}`.cwd(root).nothrow()
await Bun.sleep(1000)
await $`rm -rf ${dst}`
await $`ditto ${src} ${dst}`
await signApp(dst)

console.log(`Installed ${dst}`)

if (open) {
  await $`open ${dst}`
  console.log(`Opened ${dst}`)
}
