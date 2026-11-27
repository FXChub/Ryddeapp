const form = document.querySelector("#auth-form");
const title = document.querySelector("#auth-title");
const copy = document.querySelector("#auth-copy");
const submit = document.querySelector("#auth-submit");
const password = document.querySelector("#password");
const message = document.querySelector("#auth-message");

let setupMode = false;

async function request(url, options) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
}

async function checkAuth() {
    try {
        const status = await request("/api/auth/status");
        if (status.authenticated) {
            window.location.replace("/");
            return;
        }
        setupMode = !status.configured;
        title.textContent = setupMode ? "Set up your home." : "Welcome back.";
        copy.textContent = setupMode
            ? "Create the login for your household."
            : "Sign in to see the household list.";
        submit.textContent = setupMode ? "Create household login" : "Sign in";
        password.autocomplete = setupMode ? "new-password" : "current-password";
    } catch (error) {
        message.textContent = error.message;
        submit.disabled = true;
    }
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = "";
    try {
        await request(setupMode ? "/api/auth/setup" : "/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: form.elements.username.value,
                password: password.value
            })
        });
        window.location.replace("/");
    } catch (error) {
        message.textContent = error.message;
        submit.disabled = false;
    }
});

checkAuth();