import { describe, expect, test } from "bun:test"
import { defaultSettings } from "./settings"

describe("settings", () => {
  test("enables context sources by default", () => {
    expect(defaultSettings.general.showContextSources).toBe(true)
  })
})
