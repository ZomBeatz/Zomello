import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, Monitor, Plus, Radar, ScanQrCode, Server, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { canFindServers, checkServer, findServers, nameFromUrl, NO_SERVERS, openServer, type FoundServer, type ServerCheck } from "../servers";
import { uid } from "../utils";
import { ask, InlineEdit } from "./ui";
import { deviceWord, isApplePhoneOrTablet, isMobileApp, openExternal } from "../storage";
import { ensureLocalNetwork, goToPlace, LOCAL_NETWORK_HELP, placeFromInput, reachable } from "../places";

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

      {isMobileApp && <ComputerConnect />}

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
              if (!(await ensureLocalNetwork())) {
                setLooking(false);
                setError(LOCAL_NETWORK_HELP);
                return;
              }
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
            , open it, and add it to the trusted certificates. Or ask the server's owner to use a real certificate.
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

/**
 * Phone app: use the boards on your computer (the Zomello app there, with Phones & tablets turned on).
 * Encrypted only: the computer's https address, with its Zomello certificate installed on this phone.
 */
function ComputerConnect() {
  const servers = useStore((s) => s.data.settings.servers ?? NO_SERVERS);
  const computer = servers.find((s) => s.kind === "computer");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [setupPage, setSetupPage] = useState<string | null>(null);
  const share = useStore((s) => s.data.settings.shareWithDevices);
  const connect = async (link = text) => {
    setBusy(true);
    setError("");
    setSetupPage(null);
    try {
      const { origin, code } = placeFromInput(link);
      if (!(await ensureLocalNetwork())) {
        setError(LOCAL_NETWORK_HELP);
        return;
      }
      if (!(await reachable(origin))) {
        // Not trusted yet (or not there): the computer's setup page, opened in the browser, installs its certificate.
        if (/^http:\/\/[^/]+\/setup/i.test(link.trim())) setSetupPage(link.trim().split("#")[0]);
        setError(
          `Couldn't reach your computer there over a secure connection. Check that Zomello is open on it with Phones & tablets turned on, that this ${deviceWord} is on the same Wi‑Fi, and that its Zomello certificate is installed on this ${deviceWord} (Settings → Phones & tablets on the computer shows how).`,
        );
        return;
      }
      const entry = { id: computer?.id ?? uid(), name: "My computer", url: origin, kind: "computer" as const };
      useStore.getState().updateSettings({ servers: [entry, ...servers.filter((s) => s.id !== entry.id && s.url !== origin)] });
      await goToPlace(origin, code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** The camera reads the QR code from Settings → Phones & tablets → Pair a device, then connects. */
  const scanQr = async () => {
    setError("");
    try {
      const qr = await import("@tauri-apps/plugin-barcode-scanner");
      let perm = await qr.checkPermissions();
      if (perm !== "granted") perm = await qr.requestPermissions();
      if (perm !== "granted") return setError(
          isApplePhoneOrTablet
            ? `Zomello needs the camera to scan the code. Allow it in the ${deviceWord}'s Settings → Zomello → Camera, or type the address instead.`
            : `Zomello needs the camera to scan the code. Allow it in the ${deviceWord}'s Settings → Apps → Zomello → Permissions, or type the address instead.`,
        );
      const { content } = await qr.scan({ windowed: false, formats: [qr.Format.QRCode] });
      if (!content) return;
      setText(content);
      await connect(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) setError(`Couldn't scan: ${msg}`);
    }
  };

  return (
    <div className="computer-connect">
      <h4>
        <Monitor size={15} /> Boards on your computer
      </h4>
      {computer ? (
        <div className="row gap-sm wrap">
          <button className="btn primary sm" onClick={() => void goToPlace(computer.url)}>
            <Monitor size={14} /> Open my computer's boards
          </button>
          <span className="muted small">{computer.url}</span>
        </div>
      ) : (
        <ol className="small computer-steps">
          <li>
            On your computer, open Zomello → <b>Settings → Phones &amp; tablets</b>, turn it on, and install its certificate on this
            phone if you haven't (it shows how).
          </li>
          <li>
            Choose <b>Pair a device</b> and type or paste the <b>https</b> address it shows (the whole link with the code works too).
          </li>
        </ol>
      )}
      <form
        className="row gap-sm wrap server-add"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <input
          className="grow"
          placeholder={computer ? "Connect to a different computer: https://…" : "https://192.168.1.10:7311"}
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn sm" disabled={busy || !text.trim()}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </form>
      <button className="btn sm" disabled={busy} onClick={() => void scanQr()}>
        <ScanQrCode size={14} /> Scan the QR code on your computer
      </button>
      {error && <p className="danger-text small">{error}</p>}
      {setupPage && (
        <button className="btn sm primary" onClick={() => void openExternal(setupPage)}>
          <ExternalLink size={14} /> Install your computer's certificate
        </button>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={!!share}
          onChange={(e) => useStore.getState().updateSettings({ shareWithDevices: e.target.checked })}
        />
        Let my other devices see this {deviceWord}'s boards
      </label>
      <p className="muted small">
        Your other phones and tablets connected to the same computer can then open and edit this {deviceWord}'s boards, while both
        are on the same Wi‑Fi. Boards marked <b>Private: only on this device</b> (in a board's menu) never leave this {deviceWord}.
      </p>
      <p className="muted small">
        Your boards travel encrypted, and stay on your computer: this {deviceWord} shows them while it can reach it. Switch back any time
        with <b>Boards on this {deviceWord}</b> in the menu.
      </p>
    </div>
  );
}
