export type ContextSourceCategory = "instructions" | "skills" | "tools" | "conversation" | "other"
export type ContextSkillSort = "alpha" | "calls" | "percent"

export type ContextSourceItem = {
  category: ContextSourceCategory
  key: string
  title: string
  source?: string
  group?: string
  calls?: number
  tokens: number
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
