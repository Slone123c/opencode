export type ContextSourceCategory = "instructions" | "skills" | "tools" | "conversation" | "files" | "logs" | "other"
export type ContextSkillSort = "alpha" | "calls" | "percent"

export type ContextSourceItem = {
  category: ContextSourceCategory
  key: string
  title: string
  source?: string
  group?: string
  calls?: number
  tokens: number
  content?: string
}

export type ContextSourceSegment = {
  key: ContextSourceCategory
  tokens: number
  items: ContextSourceItem[]
}

export type ContextSourceInfo = {
  input: number
  segments: ContextSourceSegment[]
}

export type ContextSourceViewItem = ContextSourceItem & {
  percent: number
  share?: number
}

export type ContextSourceViewSegment = {
  key: ContextSourceCategory
  tokens: number
  percent: number
  width: number
  items: ContextSourceViewItem[]
}

export type ContextSourceSkillGroup = {
  key: "loaded_skill" | "skill_list" | "other"
  tokens: number
  items: ContextSourceViewItem[]
}

export type ContextSourceInstructionGroup = {
  key: "built_in" | "project_user" | "runtime"
  tokens: number
  items: ContextSourceViewItem[]
}

export type ContextSourceToolItem = {
  key: string
  title: string
  group?: string
  tokens: number
  percent: number
  items: ContextSourceViewItem[]
}

export type ContextSourceToolGroup = {
  key: "built_in" | "mcp"
  tokens: number
  items: ContextSourceToolItem[]
}

const percent = (tokens: number, input: number) => (tokens / input) * 100
const label = (tokens: number, input: number) => Math.round(percent(tokens, input) * 10) / 10

const rank = (item: { group?: string }) => (item.group === "loaded_skill" ? 0 : 1)

export function sortSkills(items: ContextSourceViewItem[], mode: ContextSkillSort, query: string) {
  const list = query
    ? items.filter((item) => {
        const q = query.toLowerCase()
        return item.title.toLowerCase().includes(q) || item.source?.toLowerCase().includes(q)
      })
    : [...items]

  return list.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (mode === "percent") return b.percent - a.percent || a.title.localeCompare(b.title)
    if (mode === "calls") return (b.calls ?? 0) - (a.calls ?? 0) || a.title.localeCompare(b.title)
    return a.title.localeCompare(b.title)
  })
}

export function skillGroups(items: ContextSourceViewItem[], mode: ContextSkillSort, query: string) {
  const list = sortSkills(items, mode, query)
  return [
    {
      key: "loaded_skill",
      items: list.filter((item) => item.group === "loaded_skill"),
    },
    {
      key: "skill_list",
      items: list.filter((item) => item.group === "skill_list"),
    },
    {
      key: "other",
      items: list.filter((item) => item.group !== "loaded_skill" && item.group !== "skill_list"),
    },
  ]
    .map((group) => ({
      ...group,
      tokens: group.items.reduce((sum, item) => sum + item.tokens, 0),
    }))
    .filter((group) => group.items.length > 0) as ContextSourceSkillGroup[]
}

const instructionKey = (item: ContextSourceViewItem) => {
  if (item.key === "provider_prompt" || item.key === "agent_prompt") return "built_in"
  if (item.key.startsWith("environment_prompt")) return "runtime"
  return "project_user"
}

export function instructionGroups(items: ContextSourceViewItem[]) {
  return [
    {
      key: "built_in",
      items: items.filter((item) => instructionKey(item) === "built_in"),
    },
    {
      key: "project_user",
      items: items.filter((item) => instructionKey(item) === "project_user"),
    },
    {
      key: "runtime",
      items: items.filter((item) => instructionKey(item) === "runtime"),
    },
  ]
    .map((group) => ({
      ...group,
      tokens: group.items.reduce((sum, item) => sum + item.tokens, 0),
    }))
    .filter((group) => group.items.length > 0) as ContextSourceInstructionGroup[]
}

export function toolGroups(items: ContextSourceViewItem[]) {
  const buckets = [
    {
      key: "built_in",
      items: items.filter((item) => item.group !== "mcp"),
    },
    {
      key: "mcp",
      items: items.filter((item) => item.group === "mcp"),
    },
  ]

  return buckets
    .map((bucket) => {
      const map = bucket.items.reduce((acc, item) => {
        const key = item.source ?? item.key
        const prev = acc.get(key) ?? {
          key,
          title: key,
          group: item.group,
          tokens: 0,
          percent: 0,
          items: [] as ContextSourceViewItem[],
        }
        prev.tokens += item.tokens
        prev.percent += item.percent
        prev.items.push(item)
        acc.set(key, prev)
        return acc
      }, new Map<string, ContextSourceToolItem>())

      return {
        key: bucket.key,
        tokens: bucket.items.reduce((sum, item) => sum + item.tokens, 0),
        items: [...map.values()]
          .map((item) => ({
            ...item,
            items: [...item.items].sort((a, b) => b.tokens - a.tokens || a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => b.tokens - a.tokens || a.title.localeCompare(b.title)),
      }
    })
    .filter((bucket) => bucket.items.length > 0) as ContextSourceToolGroup[]
}

export function createContextSourceView(input: ContextSourceInfo) {
  return {
    input: input.input,
    segments: [...input.segments]
      .map((segment) => {
        const groups = segment.items.reduce(
          (acc, item) => {
            if (!item.group) return acc
            acc.set(item.group, (acc.get(item.group) ?? 0) + item.tokens)
            return acc
          },
          new Map<string, number>(),
        )

        return {
          key: segment.key,
          tokens: segment.tokens,
          percent: label(segment.tokens, input.input),
          width: percent(segment.tokens, input.input),
          items: [...segment.items]
            .sort((a, b) => b.tokens - a.tokens || a.title.localeCompare(b.title))
            .map((item) => ({
              ...item,
              percent: label(item.tokens, input.input),
              share: item.group ? label(item.tokens, groups.get(item.group) ?? 0) : undefined,
            })),
        }
      })
      .sort((a, b) => b.tokens - a.tokens),
  }
}
