import { describe, expect, test } from "bun:test"
import { createContextSourceView, instructionGroups, skillGroups, sortSkills, toolGroups } from "./session-context-sources"

describe("createContextSourceView", () => {
  test("sorts segments by token size", () => {
    const result = createContextSourceView({
      input: 100,
      segments: [
        {
          key: "conversation",
          tokens: 10,
          items: [],
        },
        {
          key: "tools",
          tokens: 40,
          items: [],
        },
        {
          key: "instructions",
          tokens: 25,
          items: [],
        },
      ],
    })

    expect(result.segments.map((segment) => segment.key)).toEqual(["tools", "instructions", "conversation"])
  })

  test("preserves detail labels and source markers", () => {
    const result = createContextSourceView({
      input: 100,
      segments: [
        {
          key: "skills",
          tokens: 50,
          items: [
            {
              category: "skills",
              key: "skill:learn",
              title: "learn",
              source: "~/.codex/skills/learn/SKILL.md",
              tokens: 45,
              group: "skill_list",
              calls: 2,
            },
            {
              category: "skills",
              key: "skill_params",
              title: "Params",
              source: "skill",
              tokens: 5,
            },
          ],
        },
      ],
    })

    expect(result.segments[0].items).toEqual([
      {
        category: "skills",
        key: "skill:learn",
        title: "learn",
        source: "~/.codex/skills/learn/SKILL.md",
        tokens: 45,
        group: "skill_list",
        calls: 2,
        percent: 45,
        share: 100,
      },
      {
        category: "skills",
        key: "skill_params",
        title: "Params",
        source: "skill",
        tokens: 5,
        percent: 5,
        share: undefined,
      },
    ])
  })

  test("computes per-group share for skill list items", () => {
    const result = createContextSourceView({
      input: 100,
      segments: [
        {
          key: "skills",
          tokens: 40,
          items: [
            {
              category: "skills",
              key: "skill:debugging",
              title: "debugging",
              source: "~/.codex/skills/debugging/SKILL.md",
              tokens: 15,
              group: "skill_list",
              calls: 1,
            },
            {
              category: "skills",
              key: "skill:learn",
              title: "learn",
              source: "~/.codex/skills/learn/SKILL.md",
              tokens: 5,
              group: "skill_list",
              calls: 0,
            },
            {
              category: "skills",
              key: "skill_wrapper",
              title: "Skill Tool Wrapper",
              source: "skill",
              tokens: 20,
            },
          ],
        },
      ],
    })

    expect(result.segments[0]?.items.map((item) => [item.key, item.share, item.calls])).toEqual([
      ["skill_wrapper", undefined, undefined],
      ["skill:debugging", 75, 1],
      ["skill:learn", 25, 0],
    ])
  })

  test("keeps loaded skill share separate from skill list share", () => {
    const result = createContextSourceView({
      input: 100,
      segments: [
        {
          key: "skills",
          tokens: 60,
          items: [
            {
              category: "skills",
              key: "skill:learn",
              title: "learn",
              source: "~/.codex/skills/learn/SKILL.md",
              tokens: 10,
              group: "skill_list",
              calls: 2,
            },
            {
              category: "skills",
              key: "loaded_skill:learn",
              title: "learn",
              source: "~/.codex/skills/learn/SKILL.md",
              tokens: 30,
              group: "loaded_skill",
              calls: 2,
            },
            {
              category: "skills",
              key: "skill_wrapper",
              title: "Skill Tool Wrapper",
              source: "skill",
              tokens: 20,
            },
          ],
        },
      ],
    })

    expect(result.segments[0]?.items.map((item) => [item.key, item.share])).toEqual([
      ["loaded_skill:learn", 100],
      ["skill_wrapper", undefined],
      ["skill:learn", 100],
    ])
  })

  test("sorts loaded skills before description entries", () => {
    const items = [
      {
        category: "skills" as const,
        key: "skill:learn",
        title: "learn",
        source: "~/.codex/skills/learn/SKILL.md",
        tokens: 40,
        percent: 40,
        share: 100,
        group: "skill_list",
        calls: 0,
      },
      {
        category: "skills" as const,
        key: "loaded_skill:debugging",
        title: "debugging",
        source: "~/.codex/skills/debugging/SKILL.md",
        tokens: 10,
        percent: 10,
        share: 100,
        group: "loaded_skill",
        calls: 1,
      },
      {
        category: "skills" as const,
        key: "skill:alpha",
        title: "alpha",
        source: "~/.codex/skills/alpha/SKILL.md",
        tokens: 50,
        percent: 50,
        share: 100,
        group: "skill_list",
        calls: 0,
      },
    ]

    expect(sortSkills(items, "percent", "").map((item) => item.key)).toEqual([
      "loaded_skill:debugging",
      "skill:alpha",
      "skill:learn",
    ])
    expect(sortSkills(items, "alpha", "").map((item) => item.key)).toEqual([
      "loaded_skill:debugging",
      "skill:alpha",
      "skill:learn",
    ])
    expect(sortSkills(items, "calls", "").map((item) => item.key)).toEqual([
      "loaded_skill:debugging",
      "skill:alpha",
      "skill:learn",
    ])
  })

  test("groups skills into loaded, description, and supporting sections", () => {
    const items = [
      {
        category: "skills" as const,
        key: "skill:learn",
        title: "learn",
        source: "~/.codex/skills/learn/SKILL.md",
        tokens: 40,
        percent: 40,
        share: 100,
        group: "skill_list",
        calls: 0,
      },
      {
        category: "skills" as const,
        key: "loaded_skill:debugging",
        title: "debugging",
        source: "~/.codex/skills/debugging/SKILL.md",
        tokens: 10,
        percent: 10,
        share: 100,
        group: "loaded_skill",
        calls: 1,
      },
      {
        category: "skills" as const,
        key: "skill_wrapper",
        title: "Skill Tool Wrapper",
        source: "skill",
        tokens: 20,
        percent: 20,
      },
    ]

    expect(
      skillGroups(items, "percent", "").map((group) => ({
        key: group.key,
        tokens: group.tokens,
        items: group.items.map((item) => item.key),
      })),
    ).toEqual([
      {
        key: "loaded_skill",
        tokens: 10,
        items: ["loaded_skill:debugging"],
      },
      {
        key: "skill_list",
        tokens: 40,
        items: ["skill:learn"],
      },
      {
        key: "other",
        tokens: 20,
        items: ["skill_wrapper"],
      },
    ])
  })

  test("groups instructions into built-in, project-user, and runtime sections", () => {
    const items = [
      {
        category: "instructions" as const,
        key: "provider_prompt",
        title: "Provider Prompt",
        source: "qwen.txt",
        tokens: 20,
        percent: 20,
      },
      {
        category: "instructions" as const,
        key: "instruction:/repo/AGENTS.md",
        title: "Project Instructions",
        source: "/repo/AGENTS.md",
        tokens: 12,
        percent: 12,
      },
      {
        category: "instructions" as const,
        key: "user_system_prompt",
        title: "User System Prompt",
        source: "msg_1",
        tokens: 8,
        percent: 8,
      },
      {
        category: "instructions" as const,
        key: "environment_prompt",
        title: "Environment Prompt",
        source: "provider/model",
        tokens: 6,
        percent: 6,
      },
    ]

    expect(
      instructionGroups(items).map((group) => ({
        key: group.key,
        tokens: group.tokens,
        items: group.items.map((item) => item.key),
      })),
    ).toEqual([
      {
        key: "built_in",
        tokens: 20,
        items: ["provider_prompt"],
      },
      {
        key: "project_user",
        tokens: 20,
        items: ["instruction:/repo/AGENTS.md", "user_system_prompt"],
      },
      {
        key: "runtime",
        tokens: 6,
        items: ["environment_prompt"],
      },
    ])
  })

  test("groups tools by source and mcp state", () => {
    const items = [
      {
        category: "tools" as const,
        key: "edit.description",
        title: "Description",
        source: "edit",
        tokens: 12,
        percent: 12,
      },
      {
        category: "tools" as const,
        key: "edit.schema",
        title: "Schema",
        source: "edit",
        tokens: 30,
        percent: 30,
      },
      {
        category: "tools" as const,
        key: "mcp.fetch.description",
        title: "Description",
        source: "mcp.fetch",
        group: "mcp",
        tokens: 5,
        percent: 5,
      },
      {
        category: "tools" as const,
        key: "mcp.fetch.schema",
        title: "Schema",
        source: "mcp.fetch",
        group: "mcp",
        tokens: 9,
        percent: 9,
      },
    ]

    expect(
      toolGroups(items).map((group) => ({
        key: group.key,
        tokens: group.tokens,
        items: group.items.map((item) => ({
          key: item.key,
          tokens: item.tokens,
          items: item.items.map((child) => child.key),
        })),
      })),
    ).toEqual([
      {
        key: "built_in",
        tokens: 42,
        items: [
          {
            key: "edit",
            tokens: 42,
            items: ["edit.schema", "edit.description"],
          },
        ],
      },
      {
        key: "mcp",
        tokens: 14,
        items: [
          {
            key: "mcp.fetch",
            tokens: 14,
            items: ["mcp.fetch.schema", "mcp.fetch.description"],
          },
        ],
      },
    ])
  })

  test("keeps other details available for expansion", () => {
    const result = createContextSourceView({
      input: 100,
      segments: [
        {
          key: "other",
          tokens: 20,
          items: [
            {
              category: "other",
              key: "provider_overhead",
              title: "Provider Overhead",
              source: "request",
              tokens: 8,
            },
            {
              category: "other",
              key: "unknown_residual",
              title: "Unknown Residual",
              source: "request",
              tokens: 12,
            },
          ],
        },
      ],
    })

    expect(result.segments[0].items.map((item) => item.key)).toEqual(["unknown_residual", "provider_overhead"])
  })
})
