import { ApiError } from '@app/shared';
import type { z } from 'zod';

/** Error from the API, carrying the §6 check that failed when there is one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | undefined,
  ) {
    super(describe(status, body));
  }
}

function describe(status: number, body: ApiError | undefined): string {
  if (!body) return `HTTP ${status}`;
  const check = body.check ? ` (${body.check})` : '';
  return `${body.error}${check}: ${body.detail}`;
}

/** POST JSON to the same-origin API and parse the response with a shared schema. */
export async function postJson<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
): Promise<z.infer<T>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = ApiError.safeParse(await res.json().catch(() => undefined));
    throw new ApiRequestError(res.status, parsed.success ? parsed.data : undefined);
  }
  return schema.parse(await res.json());
}
