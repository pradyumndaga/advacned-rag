import { clerkClient } from "@clerk/nextjs/server"
import { listResources } from "@/lib/ingestion/resource-store"
import { getChatUsage } from "@/lib/usage/chat-usage"

export interface AdminUserSummary {
  id: string
  email: string
  name: string | null
  resourceCount: number
  chatCount: number
  chatLimit: number
  unlimited: boolean
}

// Clerk holds the user roster; Redis holds resource counts and chat usage
// per userId — this joins the two for the admin dashboard. There's no
// paginated UI for this yet, so a generous single-page limit covers the
// scale this app actually runs at.
export async function listUsersWithUsage(): Promise<AdminUserSummary[]> {
  const clerk = await clerkClient()
  const { data: users } = await clerk.users.getUserList({ limit: 500 })

  return Promise.all(
    users.map(async (user) => {
      const email =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
        user.emailAddresses[0]?.emailAddress ??
        ""
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || null
      const [resources, usage] = await Promise.all([
        listResources(user.id),
        getChatUsage(user.id),
      ])
      return {
        id: user.id,
        email,
        name,
        resourceCount: resources.length,
        chatCount: usage.count,
        chatLimit: usage.limit,
        unlimited: usage.unlimited,
      }
    })
  )
}
