#!/usr/bin/env bun

import { $ } from "bun"
import { getCurrentSidecar, inferTarget, stageSidecar, stale, windowsify } from "./utils"

const target = Bun.env.TAURI_ENV_TARGET_TRIPLE ?? inferTarget()
const sidecar = getCurrentSidecar(target)
const binary = windowsify(`../opencode/dist/${sidecar.ocBinary}/bin/opencode`)
const stamp = `../opencode/dist/${sidecar.ocBinary}/build.stamp`

if (
  !(await Bun.file(binary).exists()) ||
  await stale(stamp, [
    "../opencode/src",
    "../opencode/package.json",
    "../opencode/tsconfig.json",
  ])
) {
  await (sidecar.ocBinary.includes("-baseline")
    ? $`cd ../opencode && bun run build --single --baseline`
    : $`cd ../opencode && bun run build --single`)
  await Bun.write(stamp, `${Date.now()}\n`)
}

await stageSidecar(binary, target)
