import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? 'fallback-dev-secret-do-not-use-in-production'
)

const protectedRoutes = ['/dashboard']
const authRoutes = ['/login', '/register']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const sessionToken = req.cookies.get('session')?.value

  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route))
  const isAuthRoute = authRoutes.includes(pathname)

  // Validate the token
  let isValidSession = false
  if (sessionToken) {
    try {
      await jwtVerify(sessionToken, SESSION_SECRET)
      isValidSession = true
    } catch {
      isValidSession = false
    }
  }

  // Redirect unauthenticated users away from protected routes
  if (isProtected && !isValidSession) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Redirect already-authenticated users away from login/register
  if (isAuthRoute && isValidSession) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
}
