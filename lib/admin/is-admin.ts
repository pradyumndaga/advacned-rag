import { currentUser } from "@clerk/nextjs/server"

function allowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return allowlist().includes(email.toLowerCase())
}

// Admin status is derived from the signed-in user's real email (fetched via
// currentUser(), a Backend API call) rather than the session JWT's claims —
// the default Clerk session token doesn't include email unless a custom
// claim is configured, so relying on it would silently deny every admin.
export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await currentUser()
  if (!user) return false
  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
  return isAdminEmail(email)
}
