import { clerkMiddleware } from "@clerk/nextjs/server"

// Next.js 16 renamed the middleware.ts convention to proxy.ts (same
// underlying request-handling behavior, just a different file/export name
// — see node_modules/next/dist/docs/.../file-conventions/proxy.md). Clerk's
// clerkMiddleware() still returns a plain NextMiddleware-compatible
// function, so exporting it here works the same as it would from
// middleware.ts.
//
// This only establishes Clerk's auth context for every request — it does
// NOT gate access itself. Clerk's own createRouteMatcher-based middleware
// protection pattern is deprecated in this version in favor of protecting
// each page/route individually (auth.protect() in app/page.tsx, manual
// userId checks in API routes), so that's what this app does instead.
export default clerkMiddleware()

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
}
