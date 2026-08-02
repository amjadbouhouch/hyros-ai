import { useEffect, useState } from "react";
import { api } from "@hyros-ai/api-client";
import type { HealthResponse, User } from "@hyros-ai/types";
import { formatDate } from "@hyros-ai/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setError(null);
      const { data: healthData, error: healthErr } = await api.health.get();
      if (healthErr) throw healthErr;
      setHealth(healthData);

      const { data: usersData, error: usersErr } = await api.users.get();
      if (usersErr) throw usersErr;
      setUsers(usersData ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="flex min-h-dvh flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-wider uppercase">
          Hyros AI — Web
        </h1>
        <p className="text-sm text-muted-foreground">Powered by Tailwind CSS v4 + shadcn/ui</p>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Gateway health</CardTitle>
            <CardDescription>Status from the Hyros AI gateway</CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="text-sm text-destructive">Error: {error}</p>
            ) : health ? (
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2.5 rounded-full ${
                      health.status === "ok" ? "bg-primary" : "bg-destructive"
                    }`}
                  />
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-semibold uppercase">{health.status}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-muted-foreground">Version</dt>
                  <dd>v{health.version}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-muted-foreground">Checked</dt>
                  <dd>{formatDate(health.timestamp)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </CardContent>
          <CardContent>
            <Button onClick={() => void load()}>Refresh</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Fetched from the gateway API</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {users.map((u) => (
                  <li key={u.id} className="flex flex-col gap-0.5 py-3">
                    <span className="text-sm font-medium">{u.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {u.email} · joined {formatDate(u.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No users found.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}