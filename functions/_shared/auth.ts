import { anonClient } from "./supabaseClient.ts";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

/** Verifies the `Authorization: Bearer <token>` header against Supabase Auth and returns the
 * caller's user id. Mirrors how the client authenticates (data/auth/datasource/AuthRemoteDataSource.kt
 * -- a real Supabase GoTrue access token). Throws UnauthorizedError -> caller maps to HTTP 401,
 * matching the client's `Failure.Unauthorized()` handling for both AI Custom Plan and Chat. */
export async function requireUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) throw new UnauthorizedError();

  const { data, error } = await anonClient().auth.getUser(token);
  if (error || !data.user) throw new UnauthorizedError();
  return data.user.id;
}
