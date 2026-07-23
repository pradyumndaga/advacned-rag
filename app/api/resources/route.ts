import { NextResponse } from "next/server"
import { listResources } from "@/lib/ingestion/resource-store"

export async function GET() {
  const resources = await listResources()
  return NextResponse.json({ resources })
}
