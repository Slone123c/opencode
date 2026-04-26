import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { appBundle, bunArgs, bunEnv, dmgBundle, stale } from "./utils"

const dirs: string[] = []

async function temp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sidecar-"))
  dirs.push(dir)
  return dir
}

async function write(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("desktop.sidecar", () => {
  test("treats missing binary as stale", async () => {
    const dir = await temp()
    const src = path.join(dir, "src/index.ts")
    const bin = path.join(dir, "dist/opencode")
    await write(src, "export {}")

    expect(await stale(bin, [path.join(dir, "src")])).toBe(true)
  })

  test("rebuilds when source is newer than binary", async () => {
    const dir = await temp()
    const src = path.join(dir, "src/index.ts")
    const bin = path.join(dir, "dist/opencode")
    await write(bin, "old")
    await Bun.sleep(20)
    await write(src, "new")

    expect(await stale(bin, [path.join(dir, "src")])).toBe(true)
  })

  test("skips rebuild when binary is newer than sources", async () => {
    const dir = await temp()
    const src = path.join(dir, "src/index.ts")
    const bin = path.join(dir, "dist/opencode")
    await write(src, "old")
    await Bun.sleep(20)
    await write(bin, "new")

    expect(await stale(bin, [path.join(dir, "src")])).toBe(false)
  })
})

describe("desktop.bundle", () => {
  test("returns the only app bundle for a mode", async () => {
    const dir = await temp()
    const file = path.join(dir, "src-tauri/target/release/bundle/macos/OpenCode Dev.app")
    await fs.mkdir(file, { recursive: true })

    expect(appBundle(dir, "release")).toBe(file)
    expect(dmgBundle(dir, "release", file)).toBe(
      path.join(dir, "src-tauri/target/release/bundle/dmg/OpenCode Dev.dmg"),
    )
  })

  test("fails when no app bundle exists", async () => {
    const dir = await temp()

    expect(() => appBundle(dir, "release")).toThrow("Expected 1 app bundle")
  })

  test("fails when multiple app bundles exist", async () => {
    const dir = await temp()
    await fs.mkdir(path.join(dir, "src-tauri/target/debug/bundle/macos/A.app"), { recursive: true })
    await fs.mkdir(path.join(dir, "src-tauri/target/debug/bundle/macos/B.app"), { recursive: true })

    expect(() => appBundle(dir, "debug")).toThrow("Expected 1 app bundle")
  })
})

describe("desktop.bun", () => {
  test("uses local bun when version satisfies packageManager", () => {
    expect(bunArgs(["run", "build"], "1.3.11", "1.3.11")).toEqual(["bun", "run", "build"])
    expect(bunArgs(["run", "build"], "1.3.12", "1.3.11")).toEqual(["bun", "run", "build"])
    expect(bunEnv("1.3.12", "1.3.11")).toBeUndefined()
  })

  test("uses local bun with version override when local bun is too old", () => {
    expect(bunArgs(["run", "build"], "1.3.10", "1.3.11")).toEqual(["bun", "run", "build"])
    expect(bunEnv("1.3.10", "1.3.11")).toMatchObject({
      OPENCODE_SKIP_BUN_VERSION_CHECK: "1",
    })
  })
})
