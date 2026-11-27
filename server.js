const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const dbPath = path.join(__dirname, "chores.db");
const publicPath = path.join(__dirname, "public");
const sessionCookie = "household_session";
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);
const schema = fs.readFileSync(path.join(__dirname, "database.sql"), "utf8");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");
db.exec(schema);

app.use(express.json({ limit: "10kb" }));

function hashSession(token) {
    return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res, token, maxAge) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

app.use((req, res, next) => {
    const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`));
    const token = cookie?.slice(sessionCookie.length + 1);
    if (token) {
        const session = db.prepare(`
            SELECT s.user_id, u.username
            FROM auth_session s
            JOIN auth_user u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?
        `).get(hashSession(token), Date.now());
        if (session) {
            req.authToken = token;
            req.authUser = { id: session.user_id, username: session.username };
        } else {
            setSessionCookie(res, "", 0);
        }
    }
    next();
});

function requireAuth(req, res, next) {
    if (!req.authUser) return res.status(401).json({ error: "Please sign in to continue" });
    next();
}

function sendAppPage(req, res) {
    if (!req.authUser) return res.sendFile(path.join(publicPath, "auth.html"));
    return res.sendFile(path.join(publicPath, "index.html"));
}

app.get("/", sendAppPage);
app.get("/index.html", (req, res) => {
    if (!req.authUser) return res.redirect("/");
    return res.sendFile(path.join(publicPath, "index.html"));
});
app.get("/login", (req, res) => {
    if (req.authUser) return res.redirect("/");
    return res.sendFile(path.join(publicPath, "auth.html"));
});
app.use(express.static(publicPath, { index: false }));

app.get("/api/auth/status", (req, res) => {
    const configured = Boolean(db.prepare("SELECT id FROM auth_user WHERE id = 1").get());
    res.json({ configured, authenticated: Boolean(req.authUser), username: req.authUser?.username ?? null });
});

function normalizeUsername(value) {
    const username = String(value ?? "").trim().toLowerCase();
    return /^[a-z0-9._-]{3,32}$/.test(username) ? username : null;
}

async function derivePassword(password, salt) {
    return scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

async function createPasswordRecord(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = (await derivePassword(password, salt)).toString("hex");
    return { salt, hash };
}

async function verifyPassword(password, salt, storedHash) {
    const actual = await derivePassword(password, salt);
    if (!storedHash) return false;
    const expected = Buffer.from(storedHash, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function issueSession(res, userId) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + sessionLifetime;
    db.prepare("DELETE FROM auth_session WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO auth_session (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
        .run(userId, hashSession(token), expiresAt);
    setSessionCookie(res, token, Math.floor(sessionLifetime / 1000));
}

app.post("/api/auth/setup", async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password ?? "");
    if (!username) return res.status(400).json({ error: "Use 3–32 letters, numbers, dots, dashes, or underscores for the username" });
    if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: "Your password must be between 8 and 128 characters" });
    }

    const { salt, hash } = await createPasswordRecord(password);
    const createInitialUser = db.transaction(() => {
        if (db.prepare("SELECT id FROM auth_user WHERE id = 1").get()) return false;
        db.prepare("INSERT INTO auth_user (id, username, password_salt, password_hash) VALUES (1, ?, ?, ?)")
            .run(username, salt, hash);
        return true;
    });

    try {
        if (!createInitialUser()) return res.status(409).json({ error: "The household login has already been created. Please sign in." });
        issueSession(res, 1);
        return res.status(201).json({ username });
    } catch (error) {
        return sendDatabaseError(res, error);
    }
});

app.post("/api/auth/login", async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password ?? "");
    if (!username || !password || password.length > 128) {
        return res.status(401).json({ error: "Username or password is incorrect" });
    }

    const user = db.prepare("SELECT id, username, password_salt, password_hash FROM auth_user WHERE username = ?").get(username);
    const valid = await verifyPassword(password, user?.password_salt ?? "household-login-dummy-salt", user?.password_hash);
    if (!user || !valid) return res.status(401).json({ error: "Username or password is incorrect" });

    issueSession(res, user.id);
    return res.json({ username: user.username });
});

app.post("/api/auth/logout", (req, res) => {
    if (req.authToken) db.prepare("DELETE FROM auth_session WHERE token_hash = ?").run(hashSession(req.authToken));
    setSessionCookie(res, "", 0);
    res.json({ ok: true });
});

app.get("/api/health", (req, res) => {
    res.json({ ok: true, database: path.basename(dbPath) });
});

app.use("/api", requireAuth);

function sendDatabaseError(res, error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) {
        const duplicate = error.code.includes("UNIQUE");
        return res.status(duplicate ? 409 : 400).json({
            error: duplicate ? "That name is already in use" : "A related record was not found"
        });
    }

    console.error(error);
    return res.status(500).json({ error: "Could not save your changes" });
}

function positiveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

app.get("/api/chores", (req, res) => {
    const chores = db.prepare(`
        SELECT c.id, c.title, c.description, c.created_at,
            (SELECT COUNT(*) FROM completion x WHERE x.chore_id = c.id) AS completion_count,
            (SELECT x.completed_at FROM completion x WHERE x.chore_id = c.id ORDER BY x.completed_at DESC, x.id DESC LIMIT 1) AS last_completed_at,
            (SELECT p.name FROM completion x JOIN person p ON p.id = x.person_id WHERE x.chore_id = c.id ORDER BY x.completed_at DESC, x.id DESC LIMIT 1) AS last_completed_by
        FROM chore c
        ORDER BY c.title COLLATE NOCASE
    `).all();
    res.json(chores);
});

app.post("/api/chores", (req, res) => {
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim() || null;
    if (!title || title.length > 100 || (description && description.length > 240)) {
        return res.status(400).json({ error: "Enter a chore name (up to 100 characters) and a description under 240 characters" });
    }

    try {
        const result = db.prepare("INSERT INTO chore (title, description) VALUES (?, ?)").run(title, description);
        res.status(201).json({ id: Number(result.lastInsertRowid), title, description, completion_count: 0 });
    } catch (error) {
        return sendDatabaseError(res, error);
    }
});

app.get("/api/people", (req, res) => {
    res.json(db.prepare(`
        SELECT p.id, p.name, COUNT(c.id) AS completion_count
        FROM person p
        LEFT JOIN completion c ON c.person_id = p.id
        GROUP BY p.id
        ORDER BY p.name COLLATE NOCASE
    `).all());
});

app.post("/api/people", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name || name.length > 60) {
        return res.status(400).json({ error: "Enter a name up to 60 characters" });
    }

    try {
        const result = db.prepare("INSERT INTO person (name) VALUES (?)").run(name);
        res.status(201).json({ id: Number(result.lastInsertRowid), name, completion_count: 0 });
    } catch (error) {
        return sendDatabaseError(res, error);
    }
});

app.post("/api/completions", (req, res) => {
    const choreId = positiveId(req.body?.choreId);
    const personId = positiveId(req.body?.personId);
    if (!choreId || !personId) {
        return res.status(400).json({ error: "Choose a chore and the person who completed it" });
    }

    try {
        const result = db.prepare("INSERT INTO completion (chore_id, person_id) VALUES (?, ?)").run(choreId, personId);
        const completion = db.prepare(`
            SELECT c.id, c.completed_at, h.title AS chore_title, p.name AS person_name
            FROM completion c
            JOIN chore h ON h.id = c.chore_id
            JOIN person p ON p.id = c.person_id
            WHERE c.id = ?
        `).get(Number(result.lastInsertRowid));
        res.status(201).json(completion);
    } catch (error) {
        return sendDatabaseError(res, error);
    }
});

app.get("/api/stats", (req, res) => {
    const period = ["week", "month", "all"].includes(req.query.period) ? req.query.period : "week";
    const cutoff = period === "week" ? "-7 days" : period === "month" ? "-30 days" : null;
    const condition = cutoff ? "WHERE c.completed_at >= datetime('now', ?)" : "";
    const params = cutoff ? [cutoff] : [];

    const summary = db.prepare(`
        SELECT COUNT(c.id) AS total_completions,
            COUNT(DISTINCT c.person_id) AS active_people,
            COUNT(DISTINCT c.chore_id) AS completed_chores
        FROM completion c
        ${condition}
    `).get(...params);
    const byPerson = db.prepare(`
        SELECT p.id, p.name, COUNT(c.id) AS completion_count
        FROM person p
        LEFT JOIN completion c ON c.person_id = p.id ${cutoff ? "AND c.completed_at >= datetime('now', ?)" : ""}
        GROUP BY p.id
        ORDER BY completion_count DESC, p.name COLLATE NOCASE
    `).all(...params);
    const byChore = db.prepare(`
        SELECT h.id, h.title, COUNT(c.id) AS completion_count
        FROM chore h
        LEFT JOIN completion c ON c.chore_id = h.id ${cutoff ? "AND c.completed_at >= datetime('now', ?)" : ""}
        GROUP BY h.id
        ORDER BY completion_count DESC, h.title COLLATE NOCASE
    `).all(...params);
    const recent = db.prepare(`
        SELECT c.id, c.completed_at, h.title AS chore_title, p.name AS person_name
        FROM completion c
        JOIN chore h ON h.id = c.chore_id
        JOIN person p ON p.id = c.person_id
        ${condition}
        ORDER BY c.completed_at DESC, c.id DESC
        LIMIT 12
    `).all(...params);

    res.json({ period, summary, byPerson, byChore, recent });
});

app.listen(PORT, () => {
    console.log(`Home Chores is running at http://localhost:${PORT}`);
});
