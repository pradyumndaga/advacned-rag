import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { isCurrentUserAdmin } from "@/lib/admin/is-admin"
import { listUsersWithUsage } from "@/lib/admin/user-summary"

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const users = await listUsersWithUsage()
  return NextResponse.json({ users })
}
