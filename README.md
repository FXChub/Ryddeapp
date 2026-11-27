# Household Chores

A small household chore tracker built with Express, SQLite, and vanilla JavaScript. Add household members and reusable chores, record who completed each chore, and compare activity over the last 7 days, 30 days, or all time.

## Start

From this folder, run:

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The first visit lets you create the household username and password; later visits show the sign-in form. The password is stored as a salted scrypt hash in `chores.db`, never as plain text. Sign-in sessions are stored as hashed, expiring tokens in the same database.

The server creates `chores.db` and its tables from `database.sql` on startup. Completion history is kept in SQLite between restarts.

## API

- `GET /api/chores` and `POST /api/chores` – list and add chores
- `GET /api/people` and `POST /api/people` – list and add household members
- `POST /api/completions` – record a chore with `{"choreId":1,"personId":1}`
- `GET /api/stats?period=week|month|all` – summarize completions by person and chore
- `GET /api/health` – check the server and database