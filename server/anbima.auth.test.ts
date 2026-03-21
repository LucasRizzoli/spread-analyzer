import { describe, it, expect } from "vitest";

describe("ANBIMA Feed API credentials", () => {
  it("deve ter ANBIMA_CLIENT_ID e ANBIMA_CLIENT_SECRET definidos", () => {
    expect(process.env.ANBIMA_CLIENT_ID).toBeTruthy();
    expect(process.env.ANBIMA_CLIENT_SECRET).toBeTruthy();
    expect(process.env.ANBIMA_CLIENT_ID).not.toBe("");
    expect(process.env.ANBIMA_CLIENT_SECRET).not.toBe("");
  });

  it("deve conseguir obter token OAuth2 da ANBIMA", async () => {
    const clientId = process.env.ANBIMA_CLIENT_ID!;
    const clientSecret = process.env.ANBIMA_CLIENT_SECRET!;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const response = await fetch("https://api.anbima.com.br/oauth/access-token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    });

    expect([200, 201]).toContain(response.status);
    const data = await response.json() as { access_token?: string };
    expect(data.access_token).toBeTruthy();
  }, 15000);
});
