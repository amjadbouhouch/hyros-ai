# Supabase + Google OAuth Setup (one-time)

> Runbook for **TASK-002**. The code scaffolding is already done; this is the
> manual, one-time setup you perform in the Supabase + Google Cloud consoles,
> then paste the keys into the `.env` files. Source of truth:
> `agent-os-architecture.md` §4 (Auth: Supabase + SSO, Google OAuth).

## 0. What's already done (code side)

- `@supabase/supabase-js` added to the gateway + desktop.
- Gateway server client: `apps/gateway/src/lib/supabase.ts` (service-role).
- Desktop browser client: `apps/desktop/src/lib/supabase.ts` (anon, PKCE).
- Env templates: root `.env.example` (server) and `apps/desktop/.env.example`.

## 1. Create a Supabase project

1. https://supabase.com → **New project**.
2. Note the **Project URL** (Settings → API → `Project URL`).
3. Note the **anon public** key and the **service_role** key
   (Settings → API → `Project API keys`).

## 2. Enable Google OAuth

1. **Google Cloud Console** → APIs & Services → Credentials →
   **Create Credentials → OAuth client ID**
   (Application type: *Web application*).
2. Under **Authorized redirect URIs**, add Supabase's callback:
   `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
   (find `<PROJECT_REF>` in your Supabase project URL/settings).
3. Configure the **OAuth consent screen** (app name, support email; scopes:
   `openid`, `email`, `profile`).
4. Copy the Google **Client ID** and **Client secret**.
5. **Supabase dashboard** → Authentication → Providers → **Google** → enable,
   paste the Client ID + Client secret.

## 3. Add the desktop redirect URL (Tauri deep link)

1. **Supabase dashboard** → Authentication → URL Configuration → **Redirect URLs**.
2. Add the Tauri custom-protocol callback:
   `hyros://auth/callback`
   (this scheme is registered in the Tauri config during TASK-004).
3. For **dev-mode login** (`tauri dev`), also add:
   `http://localhost:3000/auth/oauth/callback/*`

   > Why: macOS only routes custom URL schemes to bundled `.app`s, so a bare
   > `tauri dev` binary can never receive the `hyros://` deep link. In dev the
   > desktop instead redirects the browser to the gateway, which holds the
   > one-time auth code until the app polls for it
   > (`apps/gateway/src/auth/oauth-bridge.ts`). Production keeps the deep link.

## 4. Paste the keys

### Gateway — root `.env` (gitignored; create it)

```env
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

### Desktop — `apps/desktop/.env` (gitignored; create it)

```env
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

> Vite only exposes `VITE_`-prefixed vars to the bundle (see
> `apps/desktop/vite.config.ts` `envPrefix`). The anon key is public-safe
> (RLS-protected). The service-role key must NEVER appear in the desktop env.

## 5. Verify

```bash
bun --filter @hyros-ai/gateway run typecheck
bun --filter @hyros-ai/desktop run typecheck
```

Once these pass, proceed to **TASK-003** (gateway JWT middleware) and
**TASK-004** (desktop Google OAuth flow).