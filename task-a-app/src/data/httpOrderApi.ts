import type { OrderApi, PushResult } from '../core/ports';
import type { Order, StatusChangePayload } from '../core/types';

export interface HttpOrderApiOptions {
  baseUrl: string;
  /** Aborts a request that is hanging on a captive portal or dying signal. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * HTTP transport for the OrderApi port.
 *
 * The only interesting decision here is the classification of failures.
 * `transient` means retrying is safe and might work; `permanent` means the
 * request will fail identically forever and must leave the queue. Getting this
 * wrong in either direction is expensive: retrying a permanent failure blocks
 * the queue behind it, and treating a timeout as permanent throws away a
 * driver's work.
 */
export class HttpOrderApi implements OrderApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpOrderApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // Bound deliberately. Held as `this.fetchImpl` and called as a method, an
    // unbound `fetch` arrives with the api instance as its receiver, which
    // browsers reject ("Illegal invocation"). Hermes does not check, so the
    // bug is invisible on device and fatal on web.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async fetchOrders(since: number | null): Promise<Order[]> {
    const query = since === null ? '' : `?since=${since}`;
    const response = await this.request(`/orders${query}`, { method: 'GET' });
    if (!response.ok) throw new Error(`Fetch failed with ${response.status}`);
    const body = (await response.json()) as { orders: Order[] };
    return body.orders;
  }

  async pushStatusChange(
    orderId: string,
    payload: StatusChangePayload,
    idempotencyKey: string,
  ): Promise<PushResult> {
    let response: Response;
    try {
      response = await this.request(`/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The server is required to return the original outcome for a repeat
          // of this key. A response lost on a flaky link must not become a
          // second write.
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      return { kind: 'transient', message: describe(error) };
    }

    if (response.ok) {
      const body = (await response.json()) as { order: Order };
      return { kind: 'applied', order: body.order };
    }

    if (response.status === 409) {
      const body = (await response.json()) as { order: Order };
      return { kind: 'conflict', serverOrder: body.order };
    }

    // 408 and 429 are 4xx but explicitly mean "try again".
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      return { kind: 'transient', message: `Server returned ${response.status}` };
    }

    return { kind: 'permanent', message: await safeText(response) };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()) || `Server returned ${response.status}`;
  } catch {
    return `Server returned ${response.status}`;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'Request timed out' : error.message;
  }
  return String(error);
}
