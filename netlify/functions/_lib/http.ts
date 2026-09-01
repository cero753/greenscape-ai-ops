/** Shared HTTP helpers for Netlify Functions (v2 API). */

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400)
}

export function notFound(message = 'Not found'): Response {
  return json({ error: message }, 404)
}

export function methodNotAllowed(): Response {
  return json({ error: 'Method not allowed' }, 405)
}

export function serverError(message: string): Response {
  return json({ error: message }, 500)
}

/** Parse JSON body, returning null on failure instead of throwing. */
export async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}
