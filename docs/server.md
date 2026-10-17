# Zomello Server

Zomello for several people on one always-on machine: a home server, NAS, Raspberry Pi or VPS.

- Everyone signs in with their own account and has their own boards.
- Boards can be shared: the owner invites people by username, and they accept from their Home page.
- Changes show up live for everyone on the board.
- Admins add people, reset passwords, turn accounts off, and manage every board from the **Admin** page.

It's the same app as the desktop version, in the browser. Phones and tablets can install it as an app ("Add to Home screen" / "Install app") once it's served over https.

## Setup guide

Three parts. Parts 1 and 2 happen once, on your PC. Part 3 happens on the server.

```
Your PC  ──git push──▶  GitHub  ──builds the image──▶  ghcr.io  ◀──docker pull──  Your server
```

### Part 1: Put Zomello on GitHub (on your PC, once)

1. On github.com, click **New repository**. Name it `zomello` and leave every "Add a README / .gitignore / license" box unticked. **Private** is fine.
2. In the Zomello folder, connect it and upload. Swap in your username:
   ```bash
   git remote add origin git@github.com:YOUR-GITHUB-NAME/zomello.git
   git push -u origin master
   ```
   This uses your SSH key. If GitHub doesn't know it yet, add `~/.ssh/id_ed25519.pub` under GitHub → Settings → SSH and GPG keys.

After that, `git push` uploads new changes whenever you want.

### Part 2: Let GitHub build the server image (automatic)

Every push starts **Actions → Server image**. It builds Zomello Server for normal PCs/VPSes and for Raspberry Pis, then publishes it as `ghcr.io/your-github-name/zomello-server`. The first build takes a while, roughly 30–60 minutes, because the Raspberry Pi version is built under emulation. Later builds reuse the unchanged parts.

When it shows a green check, the image is under **Packages** on your GitHub profile.

**If the repository is private**, the image is private too. Pick one:
- **Make just the image public:** Packages → zomello-server → Package settings → Change visibility → Public. The code stays private; only the built app is public.
- **Keep it private:** the server signs in once. Make a token on GitHub (Settings → Developer settings → Personal access tokens → Tokens (classic)) with only the `read:packages` box ticked, then on the server run:
  ```bash
  docker login ghcr.io -u YOUR-GITHUB-NAME
  ```
  Paste the token as the password.

### Part 3: Run it on the server

1. **Install Docker**, if the server doesn't have it. On Debian/Ubuntu/Raspberry Pi OS: `curl -fsSL https://get.docker.com | sh`. Unraid, TrueNAS and Synology have Docker in their app centers.
2. **Make a folder** and put in it the file [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) from this repository:
   ```bash
   mkdir ~/zomello && cd ~/zomello
   curl -O https://raw.githubusercontent.com/YOUR-GITHUB-NAME/zomello/master/deploy/docker-compose.yml
   ```
   For a private repository, download the file from GitHub in a browser and copy it over.
3. **Edit** `docker-compose.yml` and replace `YOUR-GITHUB-NAME` with your username **in lowercase**.
4. **Start it:**
   ```bash
   docker compose up -d
   ```
5. **Open** `http://<server-address>:7311` in a browser. It asks you to create the **admin account**.
6. **Add people:** sidebar → **Admin** → **Add a person**. Send them the sign-in details it gives you.
7. **Phones and tablets:** to install Zomello as an app they need https. See *https: pick one* below. Tailscale is the easiest.

**Updating** after you push changes and the GitHub build finishes:
```bash
cd ~/zomello && docker compose pull && docker compose up -d
```

### Or: build it on the server instead of GitHub

If the server has the source code (`git clone` it), `docker compose up -d` in the Zomello folder builds the image right there. It uses the `docker-compose.yml` at the top of the repository and needs no GitHub packages. Update with `git pull && docker compose up -d --build`.

## Where the data lives

Everything Zomello stores lives in the `zomello-data` volume (`/data` inside the container):

| Path | What |
|---|---|
| `zomello.db` | accounts, boards, cards (SQLite) |
| `attachments/` | files attached to cards |
| `backups/` | a copy of the database every day, last 14 kept |
| `tls/` | the server's own certificate, if `ZOMELLO_TLS=self` |

Updating never touches the volume, so your data stays put.

The image builds on x86-64 and on arm64 (Raspberry Pi 4/5) alike. It's about 46 MB and runs as a non-root user with no shell inside.

## Install on Windows, macOS or Linux (no Docker)

Zomello Server is also a single program, like Plex Media Server. GitHub builds it for you: **Actions → Server downloads**, then pick the file for your computer from the run's **Artifacts** (a version tag also puts them on the release page):

| Computer | File |
|---|---|
| Windows | `zomello-server-windows-x64.exe` |
| Mac with Apple Silicon (M1 and newer) | `zomello-server-macos-apple-silicon` |
| Mac with Intel | `zomello-server-macos-intel` |
| Linux PC, NAS or VPS | `zomello-server-linux-x64` |
| Raspberry Pi 4/5 (64-bit OS) | `zomello-server-linux-arm64` |

1. **Run it.** On Windows, double-click it; if SmartScreen warns, choose **More info → Run anyway**. On Mac or Linux, open a terminal in its folder, run `chmod +x zomello-server-*`, then run the file. Macs may refuse an unsigned download the first time: right-click → **Open**, or allow it in System Settings → Privacy & Security.
2. **First run:** your browser opens to create the admin account. If it doesn't, go to `http://localhost:7311`.
3. **Start it with the computer** (optional): run it once more with `install`, e.g. `zomello-server-windows-x64.exe install` from an **administrator** Command Prompt, or `./zomello-server-linux-x64 install`. The setup depends on the system:
   - **Windows:** a startup task that runs before anyone signs in, plus a firewall rule for port 7311.
   - **Mac:** a LaunchAgent that starts when you sign in.
   - **Linux:** a systemd service. Run it with `sudo` for a system-wide one; without `sudo` it's for your user, and `sudo loginctl enable-linger $USER` keeps it running while you're signed out.

   `uninstall` undoes this. Your data stays.

Where it keeps everything:

| System | Data folder |
|---|---|
| Windows | `C:\ProgramData\Zomello Server` |
| macOS | `~/Library/Application Support/Zomello Server` |
| Linux | `~/.local/share/zomello-server` (or `/var/lib/zomello-server` when run as root) |

Settings go in **`settings.env`** inside that folder. Zomello creates the file with every setting listed, so you only remove the `#` from the ones you want and restart. The server prints the file's location when it starts.

**The Zomello desktop app uses port 7311 too** (for phone & tablet access). To run both on one computer, give the server another port in `settings.env`, e.g. `ZOMELLO_PORT=7312`.

### Building it yourself

You'll need Node 20+ and Rust. Run `npm ci && npm run server`. The program lands in `server/target/release/zomello-server`.

## Settings

Settings are environment variables. In `docker-compose.yml` they go under `environment:`. Without Docker, put them in `settings.env` in the data folder (environment variables win if both are set).

| Variable | Default | What it does |
|---|---|---|
| `ZOMELLO_DATA` | the system's data folder (`/data` in Docker) | Where everything is stored |
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
