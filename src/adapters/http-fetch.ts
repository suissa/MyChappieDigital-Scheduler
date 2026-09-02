/** `HttpPort` over global `fetch`. Behaviours only see the port interface. */

import type { HttpPort } from "../behaviors/kind.js";

export const fetchHttpPort: HttpPort = {
  async postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  },
};

/** A port that refuses every call — used when a slice must stay fully offline. */
export const offlineHttpPort: HttpPort = {
  async postJson(url) {
    throw new Error(`offline http port: refused POST ${url}`);
  },
};
