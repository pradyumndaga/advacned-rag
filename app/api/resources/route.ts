import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { listResources } from "@/lib/ingestion/resource-store"

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const resources = await listResources()
  return NextResponse.json({ resources })
}
