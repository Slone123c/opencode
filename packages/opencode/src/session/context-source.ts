import path from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { asSchema } from "ai"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Global } from "../global"
import { Auth } from "../auth"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { ProviderTransform } from "../provider/transform"
import { Instance } from "../project/instance"
import { InstructionPrompt } from "./instruction"
import { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { ToolRegistry } from "../tool/registry"

const CATEGORY = ["instructions", "skills", "tools", "conversation", "other"] as const
const estimateTokens = (chars: number, ratio = 4) => Math.ceil(chars / ratio)

export type ContextCategory = (typeof CATEGORY)[number]

export namespace SessionContextSource {
  export const Category = z.enum(CATEGORY)

  export const Item = z.object({
    category: Category,
    key: z.string(),
    title: z.string(),
    source: z.string().optional(),
    group: z.string().optional(),
    calls: z.number().int().min(0).optional(),
    tokens: z.number(),
  })
  export type Item = z.infer<typeof Item>

  export const Segment = z.object({
    key: Category,
    tokens: z.number(),
    items: Item.array(),
  })
  export type Segment = z.infer<typeof Segment>

  export const Info = z.object({
    input: z.number(),
    segments: Segment.array(),
  })
  export type Info = z.infer<typeof Info>
}

type SummaryItemInput = {
  category: ContextCategory
  key: string
  title: string
  source?: string
  group?: string
  calls?: number
  chars?: number
  tokens?: number
  ratio?: number
}

export function splitSkillDescription(description: string) {
  const start = description.indexOf("<available_skills>")
  const end = description.indexOf("</available_skills>")

  if (start === -1 || end === -1 || end < start) {
    return {
      wrapper: description.trim(),
      list: "",
    }
  }

  return {
    wrapper: description.slice(0, start).trim(),
    list: description.slice(start, end + "</available_skills>".length).trim(),
  }
}

const matchTag = (input: string, tag: string) => {
  const match = input.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match?.[1]?.trim()
}

const skillSource = (input?: string) => {
  if (!input) return
  if (!input.startsWith("file://")) return input
  return shorten(fileURLToPath(input))
}

export function skillItems(description: string, calls: Record<string, number> = {}) {
  const split = splitSkillDescription(description)
  const blocks = split.list.match(/<skill>[\s\S]*?<\/skill>/g) ?? []

  return blocks.flatMap((block) => {
    const name = matchTag(block, "name")
    if (!name) return []

    return [
      {
        category: "skills" as const,
        key: `skill:${name}`,
        title: name,
        source: skillSource(matchTag(block, "location")),
        group: "skill_list",
        calls: calls[name] ?? 0,
        chars: block.length,
        ratio: 3.5,
      },
    ]
  })
}

export function loadedSkillItems(messages: MessageV2.WithParts[]) {
  const map = messages
    .flatMap((msg) => (msg.info.role === "assistant" ? msg.parts : []))
    .reduce((acc, part) => {
      if (part.type !== "tool" || part.tool !== "skill") return acc
      if (part.state.status !== "completed") return acc
      if (part.state.time.compacted) return acc

      const name =
        typeof part.state.metadata.name === "string"
          ? part.state.metadata.name
          : typeof part.state.input.name === "string"
            ? part.state.input.name
            : undefined
      if (!name) return acc

      const dir = typeof part.state.metadata.dir === "string" ? part.state.metadata.dir : undefined
      const prev = acc.get(name) ?? {
        category: "skills" as const,
        key: `loaded_skill:${name}`,
        title: name,
        source: dir ? shorten(path.join(dir, "SKILL.md")) : undefined,
        group: "loaded_skill",
        calls: 0,
        chars: 0,
        ratio: 4,
      }

      prev.calls += 1
      prev.chars += part.state.output.length
      if (!prev.source && dir) prev.source = shorten(path.join(dir, "SKILL.md"))
      acc.set(name, prev)
      return acc
    }, new Map<string, SummaryItemInput & { chars: number; calls: number; ratio: number }>())

  return [...map.values()].sort((a, b) => b.chars - a.chars || a.title.localeCompare(b.title))
}

export function skillCalls(messages: MessageV2.WithParts[]) {
  return Object.fromEntries(
    messages
      .flatMap((msg) => (msg.info.role === "assistant" ? msg.parts : []))
      .flatMap((part) => {
        if (part.type !== "tool" || part.tool !== "skill") return []
        const name =
          typeof part.state.input.name === "string"
            ? part.state.input.name
            : part.state.status === "completed" && typeof part.state.metadata.name === "string"
              ? part.state.metadata.name
              : undefined
        if (!name) return []
        return [name]
      })
      .reduce((acc, name) => {
        acc.set(name, (acc.get(name) ?? 0) + 1)
        return acc
      }, new Map<string, number>()),
  )
}

export function buildContextSourceSummary(input: { input: number; items: SummaryItemInput[] }): SessionContextSource.Info {
  if (!input.input) return { input: 0, segments: [] }

  const base = input.items
    .map((item) => ({
      category: item.category,
      key: item.key,
      title: item.title,
      source: item.source,
      group: item.group,
      calls: item.calls,
      tokens: item.tokens ?? estimateTokens(item.chars ?? 0, item.ratio),
    }))
    .filter((item) => item.tokens > 0)

  const known = base.reduce((sum, item) => sum + item.tokens, 0)
  const scaled =
    known <= input.input
      ? base
      : base
          .map((item) => ({
            ...item,
            tokens: Math.floor(item.tokens * (input.input / known)),
          }))
          .filter((item) => item.tokens > 0)

  const used = scaled.reduce((sum, item) => sum + item.tokens, 0)
  const extra = Math.max(0, input.input - used)

  const grouped = new Map<ContextCategory, SessionContextSource.Item[]>()
  for (const item of scaled) {
    const list = grouped.get(item.category) ?? []
    list.push(item)
    grouped.set(item.category, list)
  }

  if (extra > 0) {
    const list = grouped.get("other") ?? []
    list.push({
      category: "other",
      key: "unknown_residual",
      title: "Unknown Residual",
      source: "request",
      tokens: extra,
    })
    grouped.set("other", list)
  }

  return {
    input: input.input,
    segments: CATEGORY.flatMap((key) => {
      const items = (grouped.get(key) ?? []).sort((a, b) => b.tokens - a.tokens || a.title.localeCompare(b.title))
      if (items.length === 0) return []
      return [
        {
          key,
          tokens: items.reduce((sum, item) => sum + item.tokens, 0),
          items,
        },
      ]
    }),
  }
}

const charsFromUserPart = (part: MessageV2.Part) => {
  if (part.type === "text") return part.text.length
  if (part.type === "file") return part.source?.text.value.length ?? 0
  if (part.type === "agent") return part.source?.value.length ?? 0
  return 0
}

const charsFromAssistantPart = (part: MessageV2.Part) => {
  if (part.type === "text") return { assistant: part.text.length, tool: 0 }
  if (part.type === "reasoning") return { assistant: part.text.length, tool: 0 }
  if (part.type !== "tool") return { assistant: 0, tool: 0 }

  const input = JSON.stringify(part.state.input).length
  if (part.state.status === "pending") return { assistant: 0, tool: input + part.state.raw.length }
  if (part.state.status === "completed") return { assistant: 0, tool: input + part.state.output.length }
  if (part.state.status === "error") return { assistant: 0, tool: input + part.state.error.length }
  return { assistant: 0, tool: input }
}

const shorten = (source: string) => {
  const home = [Global.Path.home, process.env.HOME, process.env.USERPROFILE].find((item) => item && source.startsWith(item))
  if (home) return "~/" + path.relative(home, source)
  return source
}

const instructionItem = (input: string) => {
  const lines = input.split("\n")
  const head = lines[0] ?? ""
  const body = lines.slice(1).join("\n").trim()
  const source = head.startsWith("Instructions from: ") ? head.slice("Instructions from: ".length).trim() : ""
  const label = source && source.startsWith("http")
    ? "Global Instructions"
    : source && source.startsWith(Instance.worktree)
      ? "Project Instructions"
      : source && source.startsWith(Instance.directory)
        ? "Project Instructions"
        : source && source.startsWith(Global.Path.home)
          ? "Global Instructions"
          : source
            ? "Global Instructions"
            : "Project Instructions"
  return {
    category: "instructions" as const,
    key: `instruction:${source || "inline"}`,
    title: label,
    source: source ? shorten(source) : undefined,
    chars: body.length,
  }
}

const append = (items: SummaryItemInput[], item: SummaryItemInput | undefined) => {
  if (!item) return
  const size = item.tokens ?? estimateTokens(item.chars ?? 0, item.ratio)
  if (size <= 0) return
  items.push(item)
}

const toolDetail = (items: SummaryItemInput[], input: {
  category: ContextCategory
  id: string
  description?: string
  schema?: unknown
  label?: string
  group?: string
}) => {
  if (input.description?.trim()) {
    append(items, {
      category: input.category,
      key: `${input.id}.description`,
      title: input.label ?? "Description",
      source: input.id,
      group: input.group,
      chars: input.description.trim().length,
    })
  }
  const json = input.schema ? JSON.stringify(input.schema) : ""
  if (!json) return
  append(items, {
    category: input.category,
    key: `${input.id}.schema`,
    title: input.label ?? "Schema",
    source: input.id,
    group: input.group,
    chars: json.length,
    ratio: 3,
  })
}

const conversationItems = (messages: MessageV2.WithParts[]) => {
  const counts = messages.reduce(
    (acc, msg) => {
      if (msg.info.role === "user") {
        return {
          ...acc,
          user: acc.user + msg.parts.reduce((sum, part) => sum + charsFromUserPart(part), 0),
        }
      }

      if (msg.info.role !== "assistant") return acc
      const next = msg.parts.reduce(
        (sum, part) => {
          const val = charsFromAssistantPart(part)
          return {
            assistant: sum.assistant + val.assistant,
            tool: sum.tool + val.tool,
          }
        },
        { assistant: 0, tool: 0 },
      )

      return {
        user: acc.user,
        assistant: acc.assistant + next.assistant,
        tool: acc.tool + next.tool,
      }
    },
    { user: 0, assistant: 0, tool: 0 },
  )

  return [
    {
      category: "conversation" as const,
      key: "user_messages",
      title: "User Messages",
      source: "messages",
      chars: counts.user,
    },
    {
      category: "conversation" as const,
      key: "assistant_messages",
      title: "Assistant Messages",
      source: "messages",
      chars: counts.assistant,
    },
    {
      category: "conversation" as const,
      key: "tool_call_content",
      title: "Tool Call Content",
      source: "messages",
      chars: counts.tool,
      ratio: 3,
    },
    {
      category: "conversation" as const,
      key: "message_framing",
      title: "Message Framing",
      source: "overhead",
      tokens: messages.length * 4,
    },
  ]
}

export async function estimateMessageContextSource(input: {
  sessionID: string
  messageID: string
}): Promise<SessionContextSource.Info> {
  const messages = await Session.messages({ sessionID: input.sessionID })
  const target = messages.find((item) => item.info.id === input.messageID)
  if (!target || target.info.role !== "assistant") return { input: 0, segments: [] }

  const relevant = messages.filter((item) => item.info.id <= input.messageID)
  const targetInfo = target.info
  const fallback = await Agent.defaultAgent().then((item) => Agent.get(item)).catch(() => undefined)
  const agent = (await Agent.get(targetInfo.agent).catch(() => undefined)) ?? fallback
  const model = await Provider.getModel(targetInfo.providerID, targetInfo.modelID)
  const provider = await Provider.getProvider(model.providerID).catch(() => undefined)
  const auth = await Auth.get(model.providerID).catch(() => undefined)
  const isCodex = provider?.id === "openai" && auth?.type === "oauth"
  const parent = relevant.findLast((item) => item.info.id === targetInfo.parentID && item.info.role === "user")
  const calls = skillCalls(relevant)
  const loaded = loadedSkillItems(relevant)
  const items: SummaryItemInput[] = []

  if (agent?.prompt?.trim()) {
    append(items, {
      category: "instructions",
      key: "agent_prompt",
      title: "Agent Prompt",
      source: agent.name,
      chars: agent.prompt.trim().length,
    })
  } else {
    const prompt = isCodex ? SystemPrompt.instructionsInfo() : SystemPrompt.providerInfo(model)
    append(items, {
      category: "instructions",
      key: "provider_prompt",
      title: "Provider Prompt",
      source: prompt.source,
      chars: prompt.text.trim().length,
    })
  }

  const env = await SystemPrompt.environment(model)
  for (let i = 0; i < env.length; i++) {
    append(items, {
      category: "instructions",
      key: env.length === 1 ? "environment_prompt" : `environment_prompt:${i}`,
      title: "Environment Prompt",
      source: `${model.providerID}/${model.api.id}`,
      chars: env[i].length,
    })
  }

  for (const instruction of await InstructionPrompt.system()) {
    append(items, instructionItem(instruction))
  }

  if (parent?.info.role === "user" && parent.info.system?.trim()) {
    append(items, {
      category: "instructions",
      key: "user_system_prompt",
      title: "User System Prompt",
      source: parent.info.id,
      chars: parent.info.system.trim().length,
    })
  }

  for (const tool of await ToolRegistry.tools({ modelID: model.api.id, providerID: model.providerID }, agent).catch(() => [])) {
    const schema = ProviderTransform.schema(model, z.toJSONSchema(tool.parameters))
    if (tool.id === "skill") {
      const split = splitSkillDescription(tool.description)
      append(items, {
        category: "skills",
        key: "skill_wrapper",
        title: "Skill Tool Wrapper",
        source: "skill",
        chars: split.wrapper.length,
      })
      for (const item of skillItems(tool.description, calls)) {
        append(items, item)
      }
      for (const item of loaded) {
        append(items, item)
      }
      append(items, {
        category: "skills",
        key: "skill_params",
        title: "Skill Tool Params",
        source: "skill",
        chars: JSON.stringify(schema).length,
        ratio: 3,
      })
      continue
    }

    toolDetail(items, {
      category: "tools",
      id: tool.id,
      description: tool.description,
      label: "Description",
    })
    toolDetail(items, {
      category: "tools",
      id: tool.id,
      schema,
      label: "Schema",
    })
  }

  for (const [id, tool] of Object.entries(await MCP.tools().catch(() => ({})))) {
    const schema = ProviderTransform.schema(model, asSchema(tool.inputSchema).jsonSchema)
    toolDetail(items, {
      category: "tools",
      id,
      description: tool.description,
      label: "Description",
      group: "mcp",
    })
    toolDetail(items, {
      category: "tools",
      id,
      schema,
      label: "Schema",
      group: "mcp",
    })
  }

  for (const item of conversationItems(relevant)) {
    append(items, item)
  }

  return buildContextSourceSummary({
    input: target.info.tokens.input,
    items,
  })
}
