import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { isCurrentUserAdmin } from "@/lib/admin/is-admin"
import { setUnlimited } from "@/lib/usage/chat-usage"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const { unlimited } = await request.json()
  if (typeof unlimited !== "boolean") {
    return NextResponse.json({ error: "unlimited must be a boolean" }, { status: 400 })
  }

  const { id } = await params
  await setUnlimited(id, unlimited)
  return NextResponse.json({ success: true })
}
