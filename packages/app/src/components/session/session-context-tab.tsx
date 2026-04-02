import { createMemo, createEffect, createResource, on, onCleanup, For, Show, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { checksum } from "@opencode-ai/util/encode"
import { findLast } from "@opencode-ai/util/array"
import { same } from "@/utils/same"
import { Icon } from "@opencode-ai/ui/icon"
import { Accordion } from "@opencode-ai/ui/accordion"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { File } from "@opencode-ai/ui/file"
import { Markdown } from "@opencode-ai/ui/markdown"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { Message, Part, UserMessage } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContextMetrics } from "./session-context-metrics"
import { estimateSessionContextBreakdown, type SessionContextBreakdownKey } from "./session-context-breakdown"
import { createSessionContextFormatter } from "./session-context-format"
import { createContextSourceView, sortSkills, toolGroups, instructionGroups, type ContextSourceCategory, type ContextSkillSort } from "./session-context-sources"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

const SOURCE_COLOR: Record<ContextSourceCategory, string> = {
  instructions: "var(--syntax-info)",
  skills: "var(--syntax-string)",
  tools: "var(--syntax-warning)",
  conversation: "var(--syntax-success)",
  files: "var(--syntax-property)",
  logs: "var(--syntax-error)",
  other: "var(--syntax-comment)",
}

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-12-regular text-text-weak">{props.label}</div>
      <div class="text-12-medium text-text-strong">{props.value}</div>
    </div>
  )
}

function RawMessageContent(props: { message: Message; getParts: (id: string) => Part[]; onRendered: () => void }) {
  const file = createMemo(() => {
    const parts = props.getParts(props.message.id)
    const contents = JSON.stringify({ message: props.message, parts }, null, 2)
    return {
      name: `${props.message.role}-${props.message.id}.json`,
      contents,
      cacheKey: checksum(contents),
    }
  })

  return (
    <File
      mode="text"
      file={file()}
      overflow="wrap"
      class="select-text"
      onRendered={() => requestAnimationFrame(props.onRendered)}
    />
  )
}

function RawMessage(props: {
  message: Message
  getParts: (id: string) => Part[]
  onRendered: () => void
  time: (value: number | undefined) => string
}) {
  return (
    <Accordion.Item value={props.message.id}>
      <StickyAccordionHeader>
        <Accordion.Trigger>
          <div class="flex items-center justify-between gap-2 w-full">
            <div class="min-w-0 truncate">
              {props.message.role} <span class="text-text-base">• {props.message.id}</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="shrink-0 text-12-regular text-text-weak">{props.time(props.message.time.created)}</div>
              <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak" />
            </div>
          </div>
        </Accordion.Trigger>
      </StickyAccordionHeader>
      <Accordion.Content class="bg-background-base">
        <div class="p-3">
          <RawMessageContent message={props.message} getParts={props.getParts} onRendered={props.onRendered} />
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

type Meta = { text: string; tone?: "loaded" }

function groupLabel(key: string) {
  if (key === "built_in") return "Built-in"
  if (key === "project_user") return "User"
  if (key === "runtime") return "Agent"
  if (key === "mcp") return "User"
  return key
}

export function SessionContextTab() {
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const [skillSort, setSkillSort] = createSignal<ContextSkillSort>("alpha")
  const [toolSort, setToolSort] = createSignal<"built_in" | "mcp">("built_in")
  const [skillQuery, setSkillQuery] = createSignal("")
  const language = useLanguage()
  const providers = useProviders()
  const { params, view } = useSessionLayout()
  const dialog = useDialog()

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync.data.message[id] ?? []) as Message[]
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const visibleUserMessages = createMemo(
    () => {
      const revert = info()?.revert?.messageID
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const metrics = createMemo(() => getSessionContextMetrics(messages(), providers.all()))
  const ctx = createMemo(() => metrics().context)
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const cost = createMemo(() => {
    return usd().format(metrics().totalCost)
  })

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const msg = findLast(visibleUserMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.modelLabel
  })

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: messages(),
          parts: sync.data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
        })
      },
    ),
  )

  const breakdownLabel = (key: SessionContextBreakdownKey) => {
    if (key === "system") return language.t("context.breakdown.system")
    if (key === "user") return language.t("context.breakdown.user")
    if (key === "assistant") return language.t("context.breakdown.assistant")
    if (key === "tool") return language.t("context.breakdown.tool")
    return language.t("context.breakdown.other")
  }

  const sourceLabel = (key: ContextSourceCategory) => {
    if (key === "instructions") return language.t("context.sources.instructions")
    if (key === "skills") return language.t("context.sources.skills")
    if (key === "tools") return language.t("context.sources.tools")
    if (key === "conversation") return language.t("context.sources.conversation")
    if (key === "files") return language.t("context.sources.files")
    if (key === "logs") return language.t("context.sources.logs")
    return language.t("context.sources.other")
  }

  const sourceMeta = (item: { group?: string; share?: number; calls?: number }) => {
    const list: Meta[] = []

    if (item.group === "mcp") {
      list.push({ text: "MCP" })
    }

    if (item.group === "skill_list") {
      list.push({ text: language.t("context.sources.groupSkillList") })
    }

    if (item.group === "loaded_skill") {
      list.push({ text: language.t("context.sources.groupLoadedSkill"), tone: "loaded" })
    }

    if (item.group === "skill_list" && item.share !== undefined) {
      list.push({
        text: language.t("context.sources.skillShare", {
          percent: item.share.toLocaleString(language.intl()),
        }),
      })
    }

    if (item.group === "loaded_skill" && item.share !== undefined) {
      list.push({
        text: language.t("context.sources.loadedShare", {
          percent: item.share.toLocaleString(language.intl()),
        }),
      })
    }

    if (item.calls !== undefined) {
      list.push({
        text: language.t("context.sources.calls", {
          count: item.calls.toLocaleString(language.intl()),
        }),
      })
    }

    return list
  }

  const [sourceData] = createResource(
    () => {
      if (!settings.general.showContextSources()) return
      const sessionID = params.id
      const messageID = ctx()?.message.id
      if (!sessionID || !messageID) return
      return { sessionID, messageID }
    },
    async (input) => {
      return sdk.client.session
        .messageContext(input)
        .then((result) => result.data ?? { input: 0, segments: [] })
        .catch(() => ({ input: 0, segments: [] }))
    },
  )

  const sources = createMemo(() => {
    if (!settings.general.showContextSources()) return
    const data = sourceData()
    if (!data?.segments?.length) return
    return createContextSourceView(data)
  })

  const [activeSegment, setActiveSegment] = createSignal<string | null>(null)

  const skillStats = createMemo(() => {
    const segment = sources()?.segments.find((item) => item.key === "skills")
    if (!segment) return null
    const loaded = segment.items.filter((item) => sourceMeta(item).some((m) => m.tone === "loaded"))
    const desc = segment.items.filter((item) => sourceMeta(item).every((m) => m.tone !== "loaded"))

    return {
      loaded: {
        count: loaded.length,
        percent: loaded.reduce((acc, item) => acc + item.percent, 0),
      },
      desc: {
        count: desc.length,
        percent: desc.reduce((acc, item) => acc + item.percent, 0),
      },
    }
  })

  const stats = [
    { label: "context.stats.session", value: () => info()?.title ?? params.id ?? "—" },
    { label: "context.stats.messages", value: () => counts().all.toLocaleString(language.intl()) },
    { label: "context.stats.provider", value: providerLabel },
    { label: "context.stats.model", value: modelLabel },
    { label: "context.stats.limit", value: () => formatter().number(ctx()?.limit) },
    { label: "context.stats.totalTokens", value: () => formatter().number(ctx()?.total) },
    { label: "context.stats.usage", value: () => formatter().percent(ctx()?.usage) },
    { label: "context.stats.inputTokens", value: () => formatter().number(ctx()?.input) },
    { label: "context.stats.outputTokens", value: () => formatter().number(ctx()?.output) },
    { label: "context.stats.reasoningTokens", value: () => formatter().number(ctx()?.reasoning) },
    {
      label: "context.stats.cacheTokens",
      value: () => `${formatter().number(ctx()?.cacheRead)} / ${formatter().number(ctx()?.cacheWrite)}`,
    },
    { label: "context.stats.userMessages", value: () => counts().user.toLocaleString(language.intl()) },
    { label: "context.stats.assistantMessages", value: () => counts().assistant.toLocaleString(language.intl()) },
    { label: "context.stats.totalCost", value: cost },
    { label: "context.stats.sessionCreated", value: () => formatter().time(info()?.time.created) },
    { label: "context.stats.lastActivity", value: () => formatter().time(ctx()?.message.time.created) },
  ] satisfies { label: string; value: () => JSX.Element }[]

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined
  const getParts = (id: string) => (sync.data.part[id] ?? []) as Part[]

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll("context")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      view().setScroll("context", next)
    })
  }

  createEffect(
    on(
      () => messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div class="px-6 pt-4 pb-10 flex flex-col gap-10">
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
          <For each={stats}>
            {(stat) => <Stat label={language.t(stat.label as Parameters<typeof language.t>[0])} value={stat.value()} />}
          </For>
        </div>

        <Show when={sources()}>
          {(data) => {
            const getActive = () => activeSegment() || data().segments[0]?.key;
            return (
              <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between">
                  <div class="text-12-regular text-text-weak">{language.t("context.sources.title")}</div>
                  <Show when={skillStats()}>
                    {(stats) => (
                      <div class="flex items-center gap-1.5 text-11-regular text-text-weak">
                        <span>⚡</span>
                        <span class="text-text-strong">{stats().loaded.count.toLocaleString(language.intl())}</span>
                        <span>Skill {language.t("context.sources.summaryLoaded")}</span>
                        <span class="text-text-weaker">({stats().loaded.percent.toLocaleString(language.intl())}%)</span>
                        <span class="text-text-weaker">·</span>
                        <span class="text-text-strong">{stats().desc.count.toLocaleString(language.intl())}</span>
                        <span>Skill {language.t("context.sources.summaryDescription")}</span>
                        <span class="text-text-weaker">({stats().desc.percent.toLocaleString(language.intl())}%)</span>
                      </div>
                    )}
                  </Show>
                </div>

                <div class="flex gap-2 w-full overflow-x-auto pb-1 scrollbar-hide">
                  <For each={data().segments}>
                    {(segment) => {
                      const weight = Math.max(15, Math.min(60, segment.percent))
                      const isActive = () => getActive() === segment.key
                      
                      return (
                        <button
                          onClick={() => setActiveSegment(segment.key)}
                          class={`flex flex-col gap-1.5 rounded-md border p-2 min-w-0 transition-all text-left focus:outline-none ${isActive() ? "bg-surface-elevated border-border-strong shadow-sm" : "bg-surface-base border-border-base opacity-70 hover:opacity-100 hover:border-border-strong cursor-pointer"}`}
                          style={{ "flex": `${weight} 1 0%`, "border-top-color": SOURCE_COLOR[segment.key], "border-top-width": isActive() ? "3px" : "2px" }}
                        >
                          <div class="text-11-medium text-text-strong truncate w-full">{sourceLabel(segment.key)}</div>
                          <div class="flex items-end justify-between w-full mt-auto">
                            <div class="text-[10px] text-text-weaker truncate">{formatter().number(segment.tokens)}</div>
                            <div class="text-12-medium text-text-strong leading-none">{segment.percent.toLocaleString(language.intl())}%</div>
                          </div>
                        </button>
                      )
                    }}
                  </For>
                </div>

                <div class="flex flex-col gap-1">
                  <For each={data().segments}>
                    {(segment) => {
                      const isActive = () => getActive() === segment.key;
                      const maxTokens = Math.max(1, ...segment.items.map((i) => i.tokens));
                      
                      const SegmentItem = (props: { item: any }) => {
                        const item = props.item;
                        const ratio = item.tokens / maxTokens;
                        const contentLines: string[] = [];
                        if (item.content) {
                          contentLines.push(item.content);
                        } else if (item.items && item.items.length > 0) {
                          item.items.forEach((i: any) => {
                            if (i.content) {
                              contentLines.push(`// --- ${i.title} ---`);
                              contentLines.push(i.content);
                              contentLines.push("");
                            }
                          });
                        }
                        const resolvedContent = contentLines.join("\n").trim();
                        const hasContent = !!resolvedContent;
                        
                        return (
                          <div 
                            class={`flex items-start justify-between gap-3 text-12-regular px-1.5 py-1 rounded transition-colors bg-[var(--item-bg)] hover:bg-[var(--item-hover-bg)] ${hasContent ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (!hasContent) return;
                              dialog.show(() => (
                                <Dialog size="large" fit class="w-[min(calc(100vw-40px),720px)] h-[min(calc(100vh-40px),600px)] -mt-20 min-h-0 overflow-hidden">
                                  <div class="flex flex-col flex-1 min-w-0 p-8 h-full bg-surface-base">
                                    <h1 class="text-16-medium text-text-strong mb-4 shrink-0">{item.title}</h1>
                                    <div class="flex-1 min-h-0 overflow-y-auto w-full">
                                      <Markdown text={`\`\`\`text\n${resolvedContent}\n\`\`\``} />
                                    </div>
                                  </div>
                                </Dialog>
                              ));
                            }}
                            style={{
                              "--item-bg": `color-mix(in srgb, ${SOURCE_COLOR[segment.key]} ${Math.max(2, ratio * 20)}%, transparent)`,
                              "--item-hover-bg": `color-mix(in srgb, ${SOURCE_COLOR[segment.key]} ${Math.max(6, ratio * 20 + 8)}%, transparent)`,
                            } as any}
                          >
                            <div class="min-w-0 flex flex-col justify-center">
                              <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="text-text-strong truncate">{item.title}</span>
                                <Show when={sourceMeta(item).length > 0}>
                                  <For each={sourceMeta(item)}>
                                    {(meta) => (
                                      <span
                                        class={`px-1 rounded text-[10px] leading-tight border whitespace-nowrap ${
                                          meta.tone === "loaded"
                                            ? "text-text-strong border-transparent"
                                            : "bg-surface-base text-text-weak border-border-base"
                                        }`}
                                        style={
                                          meta.tone === "loaded"
                                            ? {
                                                "background-color": "color-mix(in srgb, var(--syntax-string) 30%, var(--surface-base))",
                                              }
                                            : undefined
                                        }
                                      >
                                        {meta.text}
                                      </span>
                                    )}
                                  </For>
                                </Show>
                              </div>
                              <Show when={item.source}>
                                {(source) => <div class="text-11-regular text-text-weaker truncate mt-0.5" title={source()}>{source()}</div>}
                              </Show>
                            </div>
                            <div class="shrink-0 text-right">
                              <div class="text-text-strong">{formatter().number(item.tokens)}</div>
                              <div class="text-[10px] text-text-weaker leading-tight">
                                {item.percent.toLocaleString(language.intl())}%
                              </div>
                            </div>
                          </div>
                        );
                      };

                      return (
                        <Show when={isActive()}>
                          <div class="flex flex-col gap-1 mt-1">
                            <Show when={segment.key === "skills"}>
                              <div class="px-2 pt-1 pb-1 flex items-center justify-between gap-3">
                                <div class="flex-1 max-w-[200px]">
                                  <input 
                                    type="text" 
                                    placeholder={language.t("context.sources.searchSkills")} 
                                    value={skillQuery()} 
                                    onInput={(e) => setSkillQuery(e.currentTarget.value)}
                                    class="w-full bg-surface-base border border-border-base rounded text-11-regular px-2 py-0.5 outline-none focus:border-border-strong text-text-strong placeholder-text-weaker shadow-sm transition-colors"
                                  />
                                </div>
                                <div class="flex items-center gap-0.5 bg-surface-base p-0.5 rounded shadow-sm border border-border-base shrink-0">
                                  <button
                                    onClick={() => setSkillSort("alpha")}
                                    class={`px-2 py-0.5 rounded-sm text-[10px] leading-tight transition-colors ${
                                      skillSort() === "alpha" ? "bg-background-base text-text-strong shadow-sm" : "text-text-weaker hover:text-text-base cursor-pointer"
                                    }`}
                                  >
                                    {language.t("context.sources.sortAlpha")}
                                  </button>
                                  <button
                                    onClick={() => setSkillSort("calls")}
                                    class={`px-2 py-0.5 rounded-sm text-[10px] leading-tight transition-colors ${
                                      skillSort() === "calls" ? "bg-background-base text-text-strong shadow-sm" : "text-text-weaker hover:text-text-base cursor-pointer"
                                    }`}
                                  >
                                    {language.t("context.sources.sortCalls")}
                                  </button>
                                  <button
                                    onClick={() => setSkillSort("percent")}
                                    class={`px-2 py-0.5 rounded-sm text-[10px] leading-tight transition-colors ${
                                      skillSort() === "percent" ? "bg-background-base text-text-strong shadow-sm" : "text-text-weaker hover:text-text-base cursor-pointer"
                                    }`}
                                  >
                                    {language.t("context.sources.sortPercent")}
                                  </button>
                                </div>
                              </div>
                              <div class="max-h-[300px] overflow-y-auto pl-2 py-1 flex flex-col gap-[1px]">
                                <For each={sortSkills(segment.items, skillSort(), skillQuery())}>
                                  {(item) => <SegmentItem item={item} />}
                                </For>
                              </div>
                            </Show>
                            
                            <Show when={segment.key === "instructions"}>
                              <div class="max-h-[300px] overflow-y-auto pl-2 py-1 flex flex-col gap-2">
                                <For each={instructionGroups(segment.items)}>
                                  {(group) => (
                                    <div class="flex flex-col gap-[1px]">
                                      <div class="text-11-medium text-text-weak px-1.5 pb-1 flex items-center justify-between">
                                        <span>{groupLabel(group.key)}</span>
                                        <span>{formatter().number(group.tokens)}</span>
                                      </div>
                                      <For each={group.items}>
                                        {(item) => <SegmentItem item={item} />}
                                      </For>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                            
                            <Show when={segment.key === "tools"}>
                              <div class="px-2 pt-1 pb-1 flex items-center justify-end gap-3 mx-1 mb-1">
                                <div class="flex items-center gap-0.5 bg-surface-base p-0.5 rounded shadow-sm border border-border-base shrink-0">
                                  <button
                                    onClick={() => setToolSort("built_in")}
                                    class={`px-2 py-0.5 rounded-sm text-[10px] leading-tight transition-colors ${
                                      toolSort() === "built_in" ? "bg-background-base text-text-strong shadow-sm" : "text-text-weaker hover:text-text-base cursor-pointer"
                                    }`}
                                  >
                                    Built-in
                                  </button>
                                  <button
                                    onClick={() => setToolSort("mcp")}
                                    class={`px-2 py-0.5 rounded-sm text-[10px] leading-tight transition-colors ${
                                      toolSort() === "mcp" ? "bg-background-base text-text-strong shadow-sm" : "text-text-weaker hover:text-text-base cursor-pointer"
                                    }`}
                                  >
                                    User
                                  </button>
                                </div>
                              </div>
                              <div class="max-h-[300px] overflow-y-auto pl-2 py-1 flex flex-col gap-2 pt-1">
                                <For each={toolGroups(segment.items).sort((a, b) => {
                                  if (toolSort() === "built_in") return a.key === "built_in" ? -1 : 1;
                                  return a.key === "mcp" ? -1 : 1;
                                })}>
                                  {(group) => (
                                    <div class="flex flex-col gap-[1px]">
                                      <div class="text-11-medium text-text-weak px-1.5 pb-1 flex items-center justify-between border-b border-border-base mx-1.5 mb-1.5 pt-1 first:pt-0">
                                        <span>{groupLabel(group.key)}</span>
                                        <span>{formatter().number(group.tokens)}</span>
                                      </div>
                                      <For each={group.items}>
                                        {(tool) => <SegmentItem item={tool} />}
                                      </For>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                            
                            <Show when={segment.key !== "skills" && segment.key !== "instructions" && segment.key !== "tools"}>
                              <div class="max-h-[300px] overflow-y-auto pl-2 py-1 flex flex-col gap-[1px]">
                                <For each={segment.items}>
                                  {(item) => <SegmentItem item={item} />}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </Show>

        <Show when={breakdown().length > 0}>
          <div class="flex flex-col gap-2 mt-4 opacity-70 transition-opacity hover:opacity-100">
            <div class="text-12-regular text-text-weak">{language.t("context.breakdown.legacyTitle")}</div>
            <div class="h-2 w-full rounded-full bg-surface-base overflow-hidden flex">
              <For each={breakdown()}>
                {(segment) => (
                  <div
                    class="h-full"
                    style={{
                      width: `${segment.width}%`,
                      "background-color": BREAKDOWN_COLOR[segment.key],
                    }}
                  />
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              <For each={breakdown()}>
                {(segment) => (
                  <div class="flex items-center gap-1 text-11-regular text-text-weak">
                    <div class="size-2 rounded-sm" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                    <div>{breakdownLabel(segment.key)}</div>
                    <div class="text-text-weaker">{segment.percent.toLocaleString(language.intl())}%</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">{language.t("context.systemPrompt.title")}</div>
              <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-text-weak">{language.t("context.rawMessages.title")}</div>
          <Accordion multiple>
            <For each={messages()}>
              {(message) => (
                <RawMessage message={message} getParts={getParts} onRendered={restoreScroll} time={formatter().time} />
              )}
            </For>
          </Accordion>
        </div>
      </div>
    </ScrollView>
  )
}
