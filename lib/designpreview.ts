/** Afgrænser designets demodata og stockfotos til det aftalte staging-preview. */
export function erDesignpreview(miljoe: Record<string, string | undefined> = process.env): boolean {
  return miljoe.VERCEL_ENV === 'preview'
    && miljoe.NEXT_PUBLIC_SUPABASE_URL === 'https://prgmenbwabwkgitjclrj.supabase.co'
}
