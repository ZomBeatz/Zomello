import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, Plus, Radar, Server, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { canFindServers, checkServer, findServers, nameFromUrl, NO_SERVERS, openServer, type FoundServer, type ServerCheck } from "../servers";
import { uid } from "../utils";
import { ask, InlineEdit } from "./ui";
import { openExternal } from "../storage";

/** Settings → Zomello Servers: add the servers you use (yours or other people's) and open them. */
export function ServersPanel() {
  const servers = useStore((s) => s.data.settings.servers ?? NO_SERVERS);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ServerCheck | null>(null);
  const [error, setError] = useState("");
  const [found, setFound] = useState<FoundServer[] | null>(null);
  const [looking, setLooking] = useState(false);
  const save = (list: typeof servers) => useStore.getState().updateSettings({ servers: list });

  const add = (url: string, name?: string) => {
    if (servers.some((s) => s.url === url)) {
      setError("That server is already in the list.");
      return;
    }
    const entry = { id: uid(), name: name || nameFromUrl(url), url };
    save([...servers, entry]);
    setAddress("");
    setProblem(null);
    setError("");
    void openServer(entry);
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    setProblem(null);
    try {
      const r = await checkServer(address);
      if (r.ok) add(r.url);
      else if (r.certProblem) setProblem(r);
      else setError(r.error ?? "Couldn't reach a Zomello Server there.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" id="set-servers">
      <h3>
        <Server size={15} /> Zomello Servers
      </h3>
      <p className="muted small">
        Your boards here stay on this device. You can also use boards on a Zomello Server, your own or one someone invited you to.
        Each server opens in its own window, where you sign in with the account its owner gave you.
      </p>

      {servers.length > 0 && (
        <ul className="server-list">
          {servers.map((s) => (
            <li key={s.id}>
              <Server size={16} className="muted" />
              <span className="grow server-name">
                <InlineEdit value={s.name} onSave={(name) => save(servers.map((x) => (x.id === s.id ? { ...x, name: name.trim() || x.name } : x)))} />
                <span className="muted small">{s.url}</span>
              </span>
              <button className="btn sm" onClick={() => void openServer(s)}>
                <ExternalLink size={14} /> Open
              </button>
              <button
                className="icon-btn"
                title="Remove from this list"
                aria-label={`Remove ${s.name}`}
                onClick={async () => {
                  if (await ask(`Remove “${s.name}” from this list? Nothing on the server changes; you can add it again any time.`, { okText: "Remove" }))
                    save(servers.filter((x) => x.id !== s.id));
                }}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="row gap-sm wrap server-add"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="grow"
          placeholder="Server address, e.g. zomello.example.com or 192.168.1.50:7311"
          autoCapitalize="none"
          spellCheck={false}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button className="btn primary sm" disabled={busy || !address.trim()}>
          <Plus size={14} /> {busy ? "Checking…" : "Add server"}
        </button>
      </form>
      {canFindServers && (
        <div className="server-find">
          <button
            className="btn sm"
            disabled={looking}
            onClick={async () => {
              setLooking(true);
              setFound(await findServers().catch(() => []));
              setLooking(false);
            }}
          >
            <Radar size={14} /> {looking ? "Looking…" : "Find servers on this network"}
          </button>
          {found && found.length === 0 && (
            <p className="muted small">
              None found. A server in Docker, on another network, or behind a firewall that blocks network discovery won't show
              up here; add it by its address instead.
            </p>
          )}
          {found && found.length > 0 && (
            <ul className="server-list">
              {found.map((f) => {
                const added = servers.some((s) => s.url === f.url);
                return (
                  <li key={f.url}>
                    <Radar size={16} className="muted" />
                    <span className="grow server-name">
                      <span>{f.name}</span>
                      <span className="muted small">{f.url}</span>
                    </span>
                    {added ? (
                      <span className="muted small">
                        <Check size={13} className="inline-icon" /> Added
                      </span>
                    ) : (
                      <button className="btn sm primary" onClick={() => add(f.url, f.name)}>
                        <Plus size={14} /> Add
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p className="danger-text small">
          <AlertTriangle size={13} className="inline-icon" /> {error}
        </p>
      )}
      {problem && (
        <div className="callout small">
          <p>
            <AlertTriangle size={13} className="inline-icon" /> {problem.error}
          </p>
          <p>
            Install the server's certificate on this computer first:{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), void openExternal(`${problem.url.replace(/^https:/, "http:")}/zomello-ca.crt`))}>
              download it
            </a>
            , open it, and add it to the trusted certificates. Or ask the server's owner to use Tailscale or a real certificate.
          </p>
          <div className="row gap-sm">
            <button className="btn sm" onClick={() => add(problem.url)}>
              Add it anyway
            </button>
            <button className="btn sm ghost" onClick={() => setProblem(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
