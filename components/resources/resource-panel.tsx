"use client"

import * as React from "react"
import {
  Captions,
  FileCode2,
  FileText,
  Globe,
  Loader2,
  PlayCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Resource, ResourceStatus, SourceType } from "@/lib/ingestion/types"

const KIND_ICON: Record<SourceType, React.ElementType> = {
  pdf: FileText,
  markdown: FileCode2,
  srt: Captions,
  vtt: Captions,
  youtube: PlayCircle,
  webpage: Globe,
}

type VisibleGroup = "queued" | "processing" | "ready"

const GROUPS: { key: VisibleGroup; title: string }[] = [
  { key: "queued", title: "Queued" },
  { key: "processing", title: "Processing" },
  { key: "ready", title: "Ready" },
]

// specs.md §3.1: failed items surface with a red dot inside whichever group
// they'd otherwise sit in, rather than a fourth always-visible group — most
// failures happen mid-ingestion, so "processing" is where they land.
function displayGroup(status: ResourceStatus): VisibleGroup {
  return status === "failed" ? "processing" : status
}

function StatusDot({ status }: { status: ResourceStatus }) {
  if (status === "processing") {
    return <Loader2 className="size-3 shrink-0 animate-spin text-amber-500" />
  }
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "queued" && "bg-muted-foreground/40",
        status === "ready" && "bg-emerald-500",
        status === "failed" && "bg-red-500"
      )}
    />
  )
}

interface ResourcePanelProps {
  refreshSignal: number
  onSelect: (resourceId: string) => void
}

export function ResourcePanel({ refreshSignal, onSelect }: ResourcePanelProps) {
  const [resources, setResources] = React.useState<Resource[]>([])

  const fetchResources = React.useCallback(async () => {
    try {
      const res = await fetch("/api/resources")
      const data = await res.json()
      setResources(data.resources ?? [])
    } catch {
      // polling loop — a transient failure here just gets retried next tick
    }
  }, [])

  // Refetch immediately whenever a new upload is triggered, not just on the
  // next poll tick. The set-state-in-effect rule's static analysis can't
  // tell this setState happens after an await, not synchronously — this is
  // exactly the "subscribe + setState in a callback" pattern the rule allows.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchResources()
  }, [fetchResources, refreshSignal])

  // Poll while anything hasn't settled yet; stop once everything has (§3.1).
  React.useEffect(() => {
    const unsettled = resources.some(
      (r) => r.status === "queued" || r.status === "processing"
    )
    if (!unsettled) return
    const interval = setInterval(fetchResources, 2000)
    return () => clearInterval(interval)
  }, [resources, fetchResources])

  const grouped = GROUPS.map((group) => ({
    ...group,
    items: resources.filter((r) => displayGroup(r.status) === group.key),
  }))

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-foreground">Resources</h2>

      {resources.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing added yet — use the panel above to add a source.
        </p>
      )}

      {grouped.map(
        (group) =>
          group.items.length > 0 && (
            <div key={group.key} className="flex flex-col gap-1.5">
              <p className="px-1 text-xs font-medium text-muted-foreground">
                {group.title} · {group.items.length}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((resource) => {
                  const Icon = KIND_ICON[resource.kind]
                  const clickable = resource.status === "ready"
                  return (
                    <button
                      key={resource.id}
                      type="button"
                      disabled={!clickable}
                      onClick={() => onSelect(resource.id)}
                      title={
                        resource.status === "failed"
                          ? resource.error
                          : undefined
                      }
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                        clickable
                          ? "cursor-pointer hover:bg-muted/60"
                          : "cursor-default opacity-70"
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{resource.label}</span>
                      <StatusDot status={resource.status} />
                    </button>
                  )
                })}
              </div>
            </div>
          )
      )}
    </div>
  )
}
