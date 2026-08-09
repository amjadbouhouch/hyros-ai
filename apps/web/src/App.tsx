import { useEffect, useState } from "react";
import { api } from "@hyros-ai/api-client";
import type { HealthResponse } from "@hyros-ai/domain";
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

      <section className="grid max-w-lg gap-6">
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
      </section>
    </main>
  );
}