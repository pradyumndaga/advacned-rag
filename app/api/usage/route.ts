import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { getChatUsage } from "@/lib/usage/chat-usage"

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const usage = await getChatUsage(userId)
  return NextResponse.json({ usage })
}
