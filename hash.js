const database = require ("better-sqlite3");
const db = new database("hash.db");
const bcrypt = require("bcrypt");

async function tryBcrypt () {
    const password = "password123";

    const hash1 = await bcrypt.hash(password, 12);
    const hash2 = await bcrypt.hash(password, 12);

    console.log("Hash 1:", hash1);
    console.log("Hash 2:", hash2);

    console.log(
        await bcrypt.compare(password, hash1)
    );

    console.log(
        await bcrypt.compare("Feilpassord", hash1)
    );
}

tryBcrypt();