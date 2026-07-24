"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { UserButton } from "@clerk/nextjs"

import { ModeToggle } from "@/components/mode-toggle"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AdminUserSummary } from "@/lib/admin/user-summary"

interface AdminClientProps {
  initialUsers: AdminUserSummary[]
}

export function AdminClient({ initialUsers }: AdminClientProps) {
  const [users, setUsers] = React.useState(initialUsers)
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  async function handleToggleUnlimited(userId: string, unlimited: boolean) {
    setPendingId(userId)
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, unlimited } : u)))
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlimited }),
      })
      if (!res.ok) throw new Error("request failed")
    } catch {
      // Revert on failure — the optimistic update above was wrong.
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, unlimited: !unlimited } : u)))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="mb-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <h1 className="text-lg font-semibold">Admin dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Every signed-in user, their resource count, and chat usage.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle />
          <UserButton />
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Resources</TableHead>
              <TableHead>Chats used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Unlimited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{user.name ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </div>
                </TableCell>
                <TableCell>{user.resourceCount}</TableCell>
                <TableCell>
                  {user.unlimited ? "—" : `${user.chatCount}/${user.chatLimit}`}
                </TableCell>
                <TableCell>
                  {user.unlimited ? (
                    <Badge variant="default">Unlimited</Badge>
                  ) : user.chatCount >= user.chatLimit ? (
                    <Badge variant="destructive">Limit reached</Badge>
                  ) : (
                    <Badge variant="outline">Free</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={user.unlimited}
                    disabled={pendingId === user.id}
                    onCheckedChange={(checked) => handleToggleUnlimited(user.id, checked)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {users.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No users yet.</p>
        )}
      </section>
    </div>
  )
}
