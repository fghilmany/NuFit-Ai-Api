// Shared CORS headers for all 3 Edge Functions -- the KMP client calls these from Android/iOS
// (no browser origin), but Supabase's own dashboard/test tools go through a browser, so headers
// are still needed for that path.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
