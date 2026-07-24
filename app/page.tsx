import { auth } from "@clerk/nextjs/server"
import { HomeClient } from "@/components/home/home-client"

export default async function Page() {
  await auth.protect()
  return <HomeClient />
}
