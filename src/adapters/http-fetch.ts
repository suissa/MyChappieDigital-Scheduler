/** `HttpPort` over global `fetch`. Behaviours only see the port interface. */

import type { HttpPort, HttpRequest, HttpResponse } from "../behaviors/kind.js";

const parse = async (res: Response): Promise<HttpResponse> => {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
};

export const fetchHttpPort: HttpPort = {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const init: RequestInit = {
      method: req.method,
      headers: { ...(req.headers ?? {}) },
    };
    if (req.body !== undefined && req.method !== "GET") {
      init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      init.headers = { "content-type": "application/json", ...(req.headers ?? {}) };
    }
    return parse(await fetch(req.url, init));
  },
  async postJson(url, body) {
    const r = await this.request({ method: "POST", url, body });
    return { status: r.status, json: r.json };
  },
};

/** A port that refuses every call — used when a slice must stay fully offline. */
export const offlineHttpPort: HttpPort = {
  async request(req) {
    throw new Error(`offline http port: refused ${req.method} ${req.url}`);
  },
  async postJson(url) {
    throw new Error(`offline http port: refused POST ${url}`);
  },
};
