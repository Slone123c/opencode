#!/usr/bin/env bun

import { $, argv } from "bun"
import path from "node:path"
import { bun, signApp } from "./utils"

function patch(args: string[]) {
  if (process.platform !== "darwin") return args
  if (!args.includes("build")) return args
  if (args.includes("--no-bundle")) return args

  const next = [...args]
  const long = next.indexOf("--bundles")
  const short = next.indexOf("-b")
  const idx = long >= 0 ? long : short

  if (idx >= 0) {
    if (next[idx + 1]) next[idx + 1] = "app"
    return next
  }

  next.push("-b", "app")
  return next
}

const args = patch(argv.slice(2))

await bun(["./scripts/ensure-sidecar.ts"])
await $`bunx tauri ${args}`

if (process.platform !== "darwin") process.exit(0)
if (!args.includes("build")) process.exit(0)

const mode = args.includes("--debug") ? "debug" : "release"
const root = path.join(import.meta.dir, "../src-tauri/target", mode, "bundle")
const mac = path.join(root, "macos")
const dmg = path.join(root, "dmg")
const apps = Array.from(new Bun.Glob("*.app").scanSync({ cwd: mac })).sort()

for (const app of apps) {
  await signApp(path.join(mac, app))
}

const dmgs = Array.from(new Bun.Glob("*.dmg").scanSync({ cwd: dmg })).sort()
if (apps.length !== 1 || dmgs.length !== 1) process.exit(0)

const app = path.join(mac, apps[0]!)
const file = path.join(dmg, dmgs[0]!)
await $`rm -f ${file}`
await $`hdiutil create -volname ${path.basename(app, ".app")} -srcfolder ${app} -ov -format UDZO ${file}`
