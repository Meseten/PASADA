# Testing PASADA on Linux (Zorin OS)

Two programs run at the same time: the **engine** (the hidden backend) and the
**screens** (what you see and click). Open two terminal windows.

## 1. Start the engine (Terminal 1)

```bash
cd pasada/backend
source venv/bin/activate
python main.py
```

Leave this window open. The engine listens on port 43888. If it starts fine,
you will see boot messages and no red errors.

## 2. Start the screens (Terminal 2)

Zorin's built-in Node is too old, so point the terminal at Node 20 first:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd pasada/frontend
npm run dev
```

If npm packages are not installed yet on this machine, run `npm install` once
before `npm run dev`.

## 3. Open and log in

Open **http://localhost:3000** in the browser (Firefox is fine).

- Log in with your usual username and password.
- The screen waits up to ~60 seconds the first time while the engine loads the
  records. After that, everything is fast.

## 4. Try the new login protection

1. Log out.
2. Type the right username but a WRONG password, 5 times.
   - Tries 1–4: the message says how many tries are left.
   - Try 5: the message says the account is locked for 15 minutes.
3. While locked, try the CORRECT password — it must still be refused.
4. Check the Logs page: a lock entry (`LOGIN_LOCKED`) is recorded.
5. To unlock immediately for testing, restart Terminal 1 (Ctrl+C, then run
   `python main.py` again). The lock is kept in memory only, so a restart
   clears it.

## 5. Quick pass over the rest

- **Dashboard** — cards fill in; the "Route Fullness Check" panel shows plain
  words like "GREEN: Not full yet — can accept new operators".
- **Records page** — add an operator, edit a name only (dates must not move),
  change a motor number (dates move only if the auto-date toggle is ON in
  Settings).
- **Settings** — backups download; "Fix Records Now" runs and finishes.
- **Switch dark/light** from the top bar — colors should stay readable.

## 6. Stop everything

Ctrl+C in each terminal.

## Troubleshooting

- "Cannot connect to PASADA" on the login screen → the engine is not running.
  Check Terminal 1 for errors, make sure nothing else holds port 43888
  (`sudo ss -ltnp | grep 43888`).
- Port already in use → another PASADA engine is still open; close it or
  restart the computer.
- If the browser shows an old screen, hard-refresh (Ctrl+Shift+R).
