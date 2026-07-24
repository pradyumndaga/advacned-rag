import { auth } from "@clerk/nextjs/server"
import { isCurrentUserAdmin } from "@/lib/admin/is-admin"
import { HomeClient } from "@/components/home/home-client"

export default async function Page() {
  await auth.protect()
  const isAdmin = await isCurrentUserAdmin()
  return <HomeClient isAdmin={isAdmin} />
}
