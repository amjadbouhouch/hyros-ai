import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@hyros-ai/ui";
import { api } from "@hyros-ai/api-client";
import type { HealthResponse, User } from "@hyros-ai/types";
import { formatDate } from "@hyros-ai/utils";

export function App() {
  const [greeting, setGreeting] = useState<string>("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // Call the Rust `greet` command to verify the Tauri IPC bridge.
    invoke<string>("greet", { name: "Hyros" })
      .then(setGreeting)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: "2rem" }}>
      <h1>Hyros AI — Desktop</h1>
      {greeting && <p style={{ color: "green" }}>{greeting}</p>}

      <section>
        <h2>Gateway health</h2>
        {error ? (
          <p style={{ color: "crimson" }}>Error: {error}</p>
        ) : health ? (
          <p>
            <strong>{health.status}</strong> · v{health.version} · {formatDate(health.timestamp)}
          </p>
        ) : (
          <p>Loading…</p>
        )}
      </section>

      <section>
        <h2>Users</h2>
        <ul>
          {users.map((u) => (
            <li key={u.id}>
              {u.name} — {u.email} (joined {formatDate(u.createdAt)})
            </li>
          ))}
        </ul>
      </section>

      <Button onClick={() => void load()}>Refresh</Button>
    </div>
  );

  async function load() {
    try {
      const { data: healthData, error: healthErr } = await api.health.get();
      if (healthErr) throw healthErr;
      setHealth(healthData);

      const { data: usersData, error: usersErr } = await api.users.get();
      if (usersErr) throw usersErr;
      setUsers(usersData ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
}