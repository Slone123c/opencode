import { describe, expect, test } from "bun:test"
import {
  buildContextSourceSummary,
  loadedSkillItems,
  skillCalls,
  skillItems,
  splitSkillDescription,
} from "../../src/session/context-source"

describe("session.context-source", () => {
  test("splits the skill tool description into wrapper and skill list", () => {
    const result = splitSkillDescription([
      "Load a specialized skill that provides domain-specific instructions and workflows.",
      "",
      "<available_skills>",
      "  <skill>",
      "    <name>debugging</name>",
      "    <description>Debug a bug</description>",
      "  </skill>",
      "</available_skills>",
    ].join("\n"))

    expect(result.wrapper).toContain("Load a specialized skill")
    expect(result.list).toContain("<available_skills>")
    expect(result.list).toContain("<name>debugging</name>")
  })

  test("extracts per-skill items and preserves invocation counts", () => {
    const result = skillItems(
      [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "<available_skills>",
        "  <skill>",
        "    <name>debugging</name>",
        "    <description>Debug a bug</description>",
        "    <location>file:///Users/slone/.codex/skills/debugging/SKILL.md</location>",
        "  </skill>",
        "  <skill>",
        "    <name>learn</name>",
        "    <description>Capture reusable lessons</description>",
        "    <location>file:///Users/slone/.codex/skills/learn/SKILL.md</location>",
        "  </skill>",
        "</available_skills>",
      ].join("\n"),
      {
        debugging: 2,
      },
    )

    expect(
      result.map((item) => ({
        key: item.key,
        title: item.title,
        source: item.source,
        group: item.group,
        calls: item.calls,
      })),
    ).toEqual([
      {
        key: "skill:debugging",
        title: "debugging",
        source: "~/.codex/skills/debugging/SKILL.md",
        group: "skill_list",
        calls: 2,
      },
      {
        key: "skill:learn",
        title: "learn",
        source: "~/.codex/skills/learn/SKILL.md",
        group: "skill_list",
        calls: 0,
      },
    ])
    expect(result[0]?.chars).toBeGreaterThan(0)
    expect(result[1]?.chars).toBeGreaterThan(0)
  })

  test("counts skill tool invocations from assistant tool parts", () => {
    const result = skillCalls([
      {
        info: {
          id: "msg_1",
          sessionID: "sess_1",
          role: "assistant",
        },
        parts: [
          {
            id: "part_1",
            sessionID: "sess_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_1",
            tool: "skill",
            state: {
              status: "completed",
              input: {
                name: "learn",
              },
              output: "",
              title: "Loaded skill: learn",
              metadata: {
                name: "learn",
              },
              time: {
                start: 1,
                end: 2,
              },
            },
          },
          {
            id: "part_2",
            sessionID: "sess_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_2",
            tool: "skill",
            state: {
              status: "error",
              input: {
                name: "debugging",
              },
              error: "nope",
              time: {
                start: 3,
                end: 4,
              },
            },
          },
          {
            id: "part_3",
            sessionID: "sess_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_3",
            tool: "read",
            state: {
              status: "completed",
              input: {
                file: "a.ts",
              },
              output: "",
              title: "Read file",
              metadata: {},
              time: {
                start: 5,
                end: 6,
              },
            },
          },
        ],
      } as any,
      {
        info: {
          id: "msg_2",
          sessionID: "sess_1",
          role: "assistant",
        },
        parts: [
          {
            id: "part_4",
            sessionID: "sess_1",
            messageID: "msg_2",
            type: "tool",
            callID: "call_4",
            tool: "skill",
            state: {
              status: "running",
              input: {
                name: "learn",
              },
              time: {
                start: 7,
              },
            },
          },
        ],
      } as any,
    ])

    expect(result).toEqual({
      debugging: 1,
      learn: 2,
    })
  })

  test("extracts loaded skill items from completed skill tool output", () => {
    const result = loadedSkillItems([
      {
        info: {
          id: "msg_1",
          sessionID: "sess_1",
          role: "assistant",
        },
        parts: [
          {
            id: "part_1",
            sessionID: "sess_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_1",
            tool: "skill",
            state: {
              status: "completed",
              input: {
                name: "learn",
              },
              output: '<skill_content name="learn"># Skill: learn\n\nbody</skill_content>',
              title: "Loaded skill: learn",
              metadata: {
                name: "learn",
                dir: "/Users/slone/.codex/skills/learn",
              },
              time: {
                start: 1,
                end: 2,
              },
            },
          },
          {
            id: "part_2",
            sessionID: "sess_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_2",
            tool: "skill",
            state: {
              status: "completed",
              input: {
                name: "learn",
              },
              output: '<skill_content name="learn">more</skill_content>',
              title: "Loaded skill: learn",
              metadata: {
                name: "learn",
                dir: "/Users/slone/.codex/skills/learn",
              },
              time: {
                start: 3,
                end: 4,
              },
            },
          },
          {
            id: "part_3",
            sessionID: "sess_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_3",
            tool: "skill",
            state: {
              status: "error",
              input: {
                name: "debugging",
              },
              error: "failed",
              time: {
                start: 5,
                end: 6,
              },
            },
          },
        ],
      } as any,
    ])

    expect(result).toEqual([
      {
        category: "skills",
        key: "loaded_skill:learn",
        title: "learn",
        source: "~/.codex/skills/learn/SKILL.md",
        group: "loaded_skill",
        calls: 2,
        chars:
          '<skill_content name="learn"># Skill: learn\n\nbody</skill_content>'.length +
          '<skill_content name="learn">more</skill_content>'.length,
        ratio: 4,
      },
    ])
  })

  test("groups known sources and keeps the remainder in other", () => {
    const result = buildContextSourceSummary({
      input: 120,
      items: [
        {
          category: "instructions",
          key: "provider_prompt",
          title: "Provider Prompt",
          source: "qwen.txt",
          chars: 40,
        },
        {
          category: "skills",
          key: "skill:learn",
          title: "learn",
          source: "skill",
          chars: 80,
          group: "skill_list",
          calls: 2,
        },
        {
          category: "tools",
          key: "read.description",
          title: "Description",
          source: "read",
          chars: 44,
        },
        {
          category: "tools",
          key: "read.schema",
          title: "Schema",
          source: "read",
          chars: 36,
        },
        {
          category: "conversation",
          key: "user_messages",
          title: "User Messages",
          source: "messages",
          chars: 20,
        },
      ],
    })

    const map = Object.fromEntries(result.segments.map((segment) => [segment.key, segment.tokens]))

    expect(map.instructions).toBe(10)
    expect(map.skills).toBe(20)
    expect(map.tools).toBe(20)
    expect(map.conversation).toBe(5)
    expect(map.other).toBe(65)

    const skills = result.segments.find((segment) => segment.key === "skills")
    expect(skills?.items).toEqual([
      {
        category: "skills",
        key: "skill:learn",
        title: "learn",
        source: "skill",
        tokens: 20,
        group: "skill_list",
        calls: 2,
      },
    ])

    const other = result.segments.find((segment) => segment.key === "other")
    expect(other?.items).toEqual([
      {
        category: "other",
        key: "unknown_residual",
        title: "Unknown Residual",
        source: "request",
        tokens: 65,
      },
    ])
  })

  test("uses per-item ratio for content-type-aware estimation", () => {
    // 120 chars of JSON at ratio 3 = 40 tokens; 120 chars text at ratio 4 = 30 tokens
    const result = buildContextSourceSummary({
      input: 100,
      items: [
        {
          category: "tools",
          key: "read.schema",
          title: "Schema",
          source: "read",
          chars: 120,
          ratio: 3,
        },
        {
          category: "instructions",
          key: "prompt",
          title: "Prompt",
          source: "codex.txt",
          chars: 120,
        },
      ],
    })

    const map = Object.fromEntries(result.segments.map((segment) => [segment.key, segment.tokens]))

    // ratio 3 → 40 tokens, ratio 4 → 30 tokens, total known = 70, input = 100
    expect(map.tools).toBe(40)
    expect(map.instructions).toBe(30)
    expect(map.other).toBe(30)
  })
})
