import { beforeEach, describe, expect, it, vi } from "vitest";

function createSelectChain(rows: unknown[]) {
  return {
    from() {
      return {
        where() {
          return Promise.resolve(rows);
        },
      };
    },
  };
}

function createDb() {
  return {
    select: vi
      .fn()
      .mockImplementationOnce(() => createSelectChain([
        {
          id: "user-1",
          email: "ola.turmo@gmail.com",
          name: "Ola Turmo",
        },
      ]))
      .mockImplementationOnce(() => createSelectChain([]))
      .mockImplementationOnce(() => createSelectChain([])),
  } as any;
}

describe("actorMiddleware Tailscale forwarded autologin", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PAPERCLIP_TAILSCALE_AUTOLOGIN_ENABLED = "true";
    process.env.PAPERCLIP_TAILSCALE_AUTOLOGIN_USER_EMAIL = "ola.turmo@gmail.com";
    delete process.env.PAPERCLIP_TAILSCALE_AUTOLOGIN_PROXY_TOKEN;
  });

  it("autologins board access for trusted Tailscale forwarded IPs without the proxy token header", async () => {
    const { actorMiddleware } = await import("../middleware/auth.js");

    const req = {
      method: "GET",
      originalUrl: "/actor",
      header(name: string) {
        if (name.toLowerCase() === "x-forwarded-for") return "100.93.14.69";
        return undefined;
      },
      actor: { type: "none", source: "none" },
    } as any;
    const res = {} as any;
    const next = vi.fn();

    await actorMiddleware(createDb(), {
      deploymentMode: "authenticated",
      resolveSession: async () => null,
    })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.actor).toMatchObject({
      type: "board",
      userId: "user-1",
      userName: "Ola Turmo",
      userEmail: "ola.turmo@gmail.com",
      source: "session",
      companyIds: [],
      memberships: [],
      isInstanceAdmin: false,
    });
  }, 30_000);
});
