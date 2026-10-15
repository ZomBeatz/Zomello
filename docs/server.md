# Zomello Server

Zomello for several people on one always-on machine: a home server, NAS, Raspberry Pi or VPS.

- Everyone signs in with their own account and has their own boards.
- Boards can be shared: the owner invites people by username, and they accept from their Home page.
- Changes show up live for everyone on the board.
- Admins add people, reset passwords, turn accounts off, and manage every board from the **Admin** page.

It's the same app as the desktop version, in the browser. Phones and tablets can install it as an app ("Add to Home screen" / "Install app") once it's served over https.

## Install with Docker (recommended)

In the Zomello folder:

```bash
docker compose up -d
```

Then open `http://<server-address>:7311`. The first visit asks you to create the **admin account**. After that, open **Admin** in the sidebar to add people.

Everything Zomello stores lives in the `zomello-data` volume (`/data` inside the container):

| Path | What |
|---|---|
| `zomello.db` | accounts, boards, cards (SQLite) |
| `attachments/` | files attached to cards |
| `backups/` | a copy of the database every day, last 14 kept |
| `tls/` | the server's own certificate, if `ZOMELLO_TLS=self` |

To update, rebuild and restart: `docker compose up -d --build`. Your data stays in the volume.

The image builds on x86-64 and on arm64 (Raspberry Pi 4/5) alike. It's about 46 MB and runs as a non-root user with no shell inside.

## Install without Docker

You'll need Node 20+ and Rust. Build it with:

```bash
npm ci
npm run server
```

That builds the web app into one program, `server/target/release/zomello-server`. Copy it anywhere and run it. It keeps its data in `./data` unless you set `ZOMELLO_DATA`. A systemd unit could look like this:

```ini
[Unit]
Description=Zomello Server
After=network-online.target

[Service]
ExecStart=/opt/zomello/zomello-server
Environment=ZOMELLO_DATA=/var/lib/zomello
User=zomello
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Settings

Settings are environment variables. In `docker-compose.yml` they go under `environment:`.

| Variable | Default | What it does |
|---|---|---|
| `ZOMELLO_DATA` | `./data` (`/data` in Docker) | Where everything is stored |
| `ZOMELLO_PORT` | `7311` | Port to listen on |
| `ZOMELLO_BIND` | `0.0.0.0` | Address to listen on (`127.0.0.1` when a proxy on the same machine is in front) |
| `ZOMELLO_TLS` | `off` | `off`, `self` or `files` (see below) |
| `ZOMELLO_HOSTS` | | Extra names/addresses for the `self` certificate, e.g. `zomello.lan,192.168.1.50` |
| `ZOMELLO_TLS_CERT`, `ZOMELLO_TLS_KEY` | | PEM files for `files` |
| `ZOMELLO_PUBLIC_URL` | | The address people use. It's shown on the Admin page. |

## https: pick one

Browsers only offer "Install app" on https. Pick whichever of these suits you:

1. **Tailscale.** This is the easiest and safest way to reach it from anywhere: nothing is exposed to the internet. Run `tailscale serve --bg 7311` on the server, and everyone on your tailnet opens `https://<machine>.<tailnet>.ts.net`. Keep `ZOMELLO_TLS=off`.
2. **A reverse proxy with a real domain** (Caddy, Nginx Proxy Manager, Traefik). Keep `ZOMELLO_TLS=off` and point the proxy at port 7311. With Caddy it's two lines:
   ```
   zomello.example.com {
       reverse_proxy localhost:7311
   }
   ```
   Live updates use a long-lived connection (server-sent events). Caddy handles them as-is. With Nginx, turn off `proxy_buffering` for `/api/events`.
3. **Zomello's own certificate** (`ZOMELLO_TLS=self`). This is for a home network without a domain. Zomello creates its own certificate authority, limited to private addresses and the names in `ZOMELLO_HOSTS`. Each device installs it once: the sign-in page (and the Admin page) has **Download this server's certificate** with steps for Android, iPhone/iPad, Windows and Mac. The same port answers both http and https, so people can fetch the certificate over http first.
4. **Your own certificate files** (`ZOMELLO_TLS=files` plus `ZOMELLO_TLS_CERT` / `ZOMELLO_TLS_KEY`).

Don't port-forward Zomello straight to the internet. Use option 1 or 2 instead.

## People and boards

- **Adding people.** Admin → People → Add a person. Zomello suggests a temporary password and gives you sign-in details to copy and send. People change their password in Settings → Your account.
- **Admins** can make other people admins, rename them, reset passwords, turn accounts off (which signs them out everywhere), or delete them. A deleted person's boards are handed to you.
- **Sharing.** A board's owner opens ⋯ → Share… and invites people by username. Everyone on a board can add, change and complete cards. Only the owner can invite, remove people, archive or delete the board, or make someone else the owner. Members can leave a board.
- **Admins and boards.** Admin → Boards lists every board on the server. From there an admin can change a board's owner, add or remove people, or delete it.
- **Names.** A person's name is tied to their account. When it changes, cards assigned to them follow.

## Backups and recovery

- **Daily backups** of the database land in `backups/` inside the data folder, and the last 14 are kept. **Admin → Download a backup now** gives you a copy at any time.
- **Backing up everything** (attachments included) means backing up the whole data folder or volume, e.g. `docker run --rm -v zomello-data:/data -v "$PWD":/out alpine tar czf /out/zomello-data.tgz -C /data .`
- **Restoring:** stop Zomello, put the backup file in place as `zomello.db`, and start it again.
- **Forgot the admin password:**
  ```bash
  docker exec -it zomello zomello-server reset-password <username>
  ```
  This also turns the account back on and signs it out everywhere. `create-admin <username>` adds a new admin the same way.

## Security notes

- **Passwords** are stored as Argon2 hashes.
- **Sign-in protection.** After 5 wrong passwords, sign-in pauses for a minute. The answer doesn't reveal whether a username exists.
- **Sessions** use an HttpOnly cookie, `Secure` over https, and last 60 days. Changing a password or turning an account off ends that account's sessions.
- **Requests from other websites** are refused (origin check).
- **Attached files** can only be fetched by people on a board that uses them.
- **Calendar feeds** are fetched only from addresses saved on a board.
