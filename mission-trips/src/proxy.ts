import { NextResponse, type NextRequest } from "next/server";

// Passes the requested path to server components so a signed-out visitor can
// be sent back to the right page after logging in. Authorization itself
// happens on the server for every page and action, never here.
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
