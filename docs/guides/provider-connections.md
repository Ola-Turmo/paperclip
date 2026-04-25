# Paperclip Provider Connections

Paperclip provider tooling exposes Zapier SDK and Composio CLI through one scoped wrapper:

```bash
paperclip-connections <provider> --company <PER|KUR|GAT|LOV|PAR|EMD|TRT|AII> -- <provider command>
```

The live install path is `/home/.paperclip/provider-tooling`. Policy lives in `/home/.paperclip/provider-tooling/provider-governance.json`.

## Quick Commands

```bash
paperclip-connections companies
paperclip-connections policy show --company KUR
paperclip-connections quickstart --company KUR
```

## Zapier SDK

Zapier uses the existing `zapier-sdk` CLI account state in the provider-tooling Zapier home. The gate enforces command classes per company before the CLI is invoked.

```bash
paperclip-connections zapier --company PER -- get-profile
paperclip-connections zapier --company PER -- list-connections
paperclip-connections zapier --company PER -- run-action <app-action> --connection-id <id> --inputs '{...}' --json
```

Use Zapier for existing SaaS apps and Zapier-managed connections where the standard app covers the workflow. Keep Paperclip-side identity in the Paperclip issue/comment/activity trail.

## Composio CLI

Composio is isolated by company. Each company gets its own CLI home, cache, and session directory under:

```text
/home/.paperclip/provider-tooling/composio/companies/<COMPANY>/
```

This prevents one company connection from becoming the default for another company.

```bash
paperclip-connections composio --company KUR -- version
paperclip-connections composio --company KUR -- login
paperclip-connections composio --company KUR -- link gmail
paperclip-connections composio --company KUR -- connections list
paperclip-connections composio --company KUR -- search send email --toolkits gmail --limit 5
paperclip-connections composio --company KUR -- execute GMAIL_SEND_EMAIL --dry-run --get-schema
```

Use Composio for agentic tool execution, toolkit search, account linking, triggers, and provider APIs that need one session per company.

## Scope Changes

Grant or narrow scope with policy edits through the wrapper; every policy edit creates a timestamped backup.

```bash
paperclip-connections scope grant \
  --provider composio \
  --company KUR \
  --classes identity,catalog,connection-read,credentials-mutate,action-run,workflow-run \
  --toolkits gmail,github,slack,googlecalendar,googledrive
```

Use `proxy` or `admin` classes only for a specific approved company policy. Destructive deletes should remain blocked unless there is an approved Paperclip issue.

## Operating Rule

Zapier and Composio are not interchangeable:

- Zapier is the durable integration/workflow layer for standard SaaS connections and Zapier app surfaces.
- Composio is the company-scoped agent tool layer for direct action/search/trigger/proxy workflows.
- Both must be invoked through `paperclip-connections` from Paperclip so policy, company isolation, and audit assumptions stay intact.

## Payment Provider Routing

Payment providers are market-scoped, not interchangeable:

- `KUR`, `LOV`, and `PER` target Norway and must use Stripe for payments.
- `AII`, `EMD`, `GAT`, `PAR`, and `TRT` do not primarily target Norway and must use Suby for payments.

Inspect payment scope:

```bash
paperclip-connections stripe --company KUR -- env
paperclip-connections suby --company GAT -- env
paperclip-connections policy show --provider stripe --company LOV
paperclip-connections policy show --provider suby --company TRT
```

Suby API reference for agents:

```bash
paperclip-connections suby --company GAT -- docs
```

Suby live actions require a company-scoped API key in the configured env var, for example `PAPERCLIP_GAT_SUBY_API_KEY`. Generate the key in Suby dashboard settings and store it once; the dashboard only shows merchant API keys once. Do not rotate an existing Suby merchant API key from automation without a dedicated approval issue.

Suby workflow rules:

- Products use `POST https://api.suby.fi/api/product/create`.
- One-time payments use `POST https://api.suby.fi/api/payment/create`.
- Subscriptions use `POST https://api.suby.fi/api/subscription/create`.
- Webhooks must verify `X-Webhook-Signature` using the configured webhook secret before changing access, revenue, or customer state.
- Refunds, subscription cancellation, key rotation, and destructive payment operations require a dedicated approval issue.
