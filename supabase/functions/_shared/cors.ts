// Shared CORS helpers for Edge Functions.

const ALLOWED_ORIGINS = [
  'https://charitytooling.com',
  'https://www.charitytooling.com',
  'http://localhost:5173',
  'http://localhost:4173',
];

export function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, stripe-signature',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
  }
  return null;
}

export function json(body: unknown, init: ResponseInit = {}, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders(origin),
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}
