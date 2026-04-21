import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    // Redirect to a client-side page that will exchange the code
    // The Supabase client in the browser will pick up the session from the URL hash
    return NextResponse.redirect(`${origin}/auth/confirm?code=${code}`)
  }

  return NextResponse.redirect(`${origin}/login`)
}
