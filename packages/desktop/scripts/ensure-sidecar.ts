#!/usr/bin/env bun

import path from "node:path"
import { bun, getCurrentSidecar, inferTarget, stageSidecar, stale, windowsify } from "./utils"

const target = Bun.env.TAURI_ENV_TARGET_TRIPLE ?? inferTarget()
const sidecar = getCurrentSidecar(target)
const binary = windowsify(`../opencode/dist/${sidecar.ocBinary}/bin/opencode`)
const stamp = `../opencode/dist/${sidecar.ocBinary}/build.stamp`
const dir = path.join(import.meta.dir, "../../opencode")

if (
  !(await Bun.file(binary).exists()) ||
  await stale(stamp, [
    "../opencode/src",
    "../opencode/package.json",
    "../opencode/tsconfig.json",
  ])
) {
  await bun(sidecar.ocBinary.includes("-baseline") ? ["run", "build", "--single", "--baseline"] : ["run", "build", "--single"], dir)
  await Bun.write(stamp, `${Date.now()}\n`)
}

await stageSidecar(binary, target)
