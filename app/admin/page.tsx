import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { isCurrentUserAdmin } from "@/lib/admin/is-admin"
import { listUsersWithUsage } from "@/lib/admin/user-summary"
import { AdminClient } from "@/components/admin/admin-client"

export default async function AdminPage() {
  await auth.protect()
  if (!(await isCurrentUserAdmin())) {
    redirect("/")
  }

  const users = await listUsersWithUsage()
  return <AdminClient initialUsers={users} />
}
