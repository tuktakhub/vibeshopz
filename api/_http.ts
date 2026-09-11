/**
 * Minimal request/response typing for Vercel's Node.js runtime.
 *
 * Declared locally so the project does not have to pull in the (heavy)
 * `@vercel/node` package just to get two interfaces.
 */

export interface ApiRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  send(body: string): void;
  setHeader(name: string, value: string): void;
}

export function headerValue(
  headers: ApiRequest["headers"],
  name: string
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
