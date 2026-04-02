import { $ } from "bun"
import native from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "opencode-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "opencode-darwin-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    ocBinary: "opencode-windows-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "opencode-windows-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "opencode-linux-x64-baseline",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "opencode-linux-arm64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

export function inferTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin"
  if (process.platform === "darwin" && process.arch === "x64") return "x86_64-apple-darwin"
  if (process.platform === "linux" && process.arch === "arm64") return "aarch64-unknown-linux-gnu"
  if (process.platform === "linux" && process.arch === "x64") return "x86_64-unknown-linux-gnu"
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc"
  throw new Error(`Unsupported target for ${process.platform}/${process.arch}`)
}

export function getCurrentSidecar(target = RUST_TARGET) {
  if (!target && !RUST_TARGET) throw new Error("RUST_TARGET not set")

  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === target)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${RUST_TARGET}'`)

  return binaryConfig
}

export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
  await $`mkdir -p src-tauri/sidecars`
  const dest = windowsify(`src-tauri/sidecars/opencode-cli-${target}`)
  await $`cp ${source} ${dest}`
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }

  console.log(`Copied ${source} to ${dest}`)
  return dest
}

export async function signBinary(path: string) {
  if (process.platform !== "darwin") return
  await $`codesign --force --sign - ${path}`
}

export async function signApp(dir: string) {
  if (process.platform !== "darwin") return
  const root = path.join(dir, "Contents/MacOS")
  const files = Array.from(new Bun.Glob("*").scanSync({ cwd: root })).sort()

  for (const file of files) {
    await signBinary(path.join(root, file))
  }

  await $`codesign --force --deep --sign - ${dir}`

  for (const file of files) {
    await $`codesign -vv ${path.join(root, file)}`
  }
}

export async function stageSidecar(source: string, target = RUST_TARGET) {
  await signBinary(source)
  const dest = await copyBinaryToSidecarFolder(source, target)
  await signBinary(dest)
  return dest
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}

function bundleRoot(root: string, mode: "debug" | "release") {
  return path.join(root, "src-tauri/target", mode, "bundle")
}

export function appBundle(root: string, mode: "debug" | "release") {
  const dir = path.join(bundleRoot(root, mode), "macos")
  const apps = (() => {
    try {
      return native
        .readdirSync(dir, { withFileTypes: true })
        .filter((item) => item.isDirectory() && item.name.endsWith(".app"))
        .map((item) => item.name)
        .sort()
    } catch {
      return []
    }
  })()
  if (apps.length !== 1) throw new Error(`Expected 1 app bundle in ${dir}, found ${apps.length}`)
  return path.join(dir, apps[0]!)
}

export function dmgBundle(root: string, mode: "debug" | "release", app: string) {
  return path.join(bundleRoot(root, mode), "dmg", `${path.basename(app, ".app")}.dmg`)
}

async function files(dir: string): Promise<string[]> {
  return Promise.all(
    (await fs.readdir(dir, { withFileTypes: true })).map(async (item) => {
      const file = path.join(dir, item.name)
      if (item.isDirectory()) return files(file)
      if (item.isFile()) return [file]
      return []
    }),
  ).then((arr) => arr.flat())
}

async function mtime(file: string) {
  return fs
    .stat(file)
    .then((x) => x.mtimeMs)
    .catch(() => 0)
}

export async function stale(bin: string, deps: string[]) {
  const built = await mtime(bin)
  if (!built) return true

  return Promise.all(
    deps.map(async (dep) => {
      const stat = await fs.stat(dep).catch(() => undefined)
      if (!stat) return 0
      if (stat.isDirectory()) {
        return Promise.all((await files(dep)).map(mtime)).then((arr) => Math.max(0, ...arr))
      }
      return stat.mtimeMs
    }),
  ).then((arr) => Math.max(0, ...arr) > built)
}
