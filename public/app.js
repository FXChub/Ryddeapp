const choreList = document.querySelector("#chore-list");
const peopleList = document.querySelector("#people-list");
const choresStatus = document.querySelector("#chores-status");
const setupStatus = document.querySelector("#setup-status");
const todayProgress = document.querySelector("#today-progress");
const tabs = [...document.querySelectorAll("[data-view-tab]")];
const views = [...document.querySelectorAll("[data-view]")];

let chores = [];
let people = [];

async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
        window.location.replace("/");
        throw new Error("Your session has expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function selectView(name) {
    for (const tab of tabs) {
        const selected = tab.dataset.viewTab === name;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
    for (const view of views) view.hidden = view.dataset.view !== name;
    if (name === "stats") loadStats();
}

function renderPeople() {
    peopleList.replaceChildren();
    if (!people.length) {
        peopleList.append(element("li", "quiet-empty", "Add everyone who shares the chores."));
        return;
    }

    for (const [index, person] of people.entries()) {
        const item = element("li", "person-row");
        const avatar = element("span", `person-avatar avatar-${index % 5}`, person.name.trim().charAt(0).toUpperCase());
        avatar.setAttribute("aria-hidden", "true");
        item.append(avatar, element("span", "person-name", person.name));
        peopleList.append(item);
    }
}

function formatDate(value, options = { month: "short", day: "numeric" }) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(`${value.replace(" ", "T")}Z`));
}

function isToday(value) {
    return new Date(value.replace(" ", "T") + "Z").toLocaleDateString() === new Date().toLocaleDateString();
}

function renderChores() {
    choreList.replaceChildren();
    document.querySelector("#chore-tab-count").textContent = String(chores.length);

    const doneToday = chores.filter((chore) => chore.last_completed_at && isToday(chore.last_completed_at)).length;
    todayProgress.textContent = chores.length
        ? `${doneToday} of ${chores.length} chores checked off today`
        : "Your list is ready when you are";

    if (!chores.length) {
        const empty = element("div", "empty-list");
        empty.append(element("span", "empty-spark", "✳"), element("h3", "", "Start with one small thing."), element("p", "", "Add a chore to make your household list."));
        choreList.append(empty);
        return;
    }

    for (const [index, chore] of chores.entries()) {
        const row = element("article", "chore-row");
        const number = element("span", "chore-number", String(index + 1).padStart(2, "0"));
        const details = element("div", "chore-details");
        details.append(element("h3", "", chore.title));
        if (chore.description) details.append(element("p", "", chore.description));
        const history = chore.last_completed_at
            ? `Last done by ${chore.last_completed_by} · ${formatDate(chore.last_completed_at)}`
            : "Not checked off yet";
        details.append(element("span", "chore-history", `${history} · ${chore.completion_count} total`));

        const action = element("div", "chore-action");
        const personSelect = document.createElement("select");
        personSelect.className = "person-select";
        personSelect.setAttribute("aria-label", `Who completed ${chore.title}?`);
        personSelect.add(new Option(people.length ? "Who did it?" : "Add a person first", ""));
        for (const person of people) personSelect.add(new Option(person.name, String(person.id)));
        personSelect.disabled = !people.length;
        const completeButton = element("button", "complete-button", "Done");
        completeButton.type = "button";
        completeButton.disabled = !people.length;
        completeButton.setAttribute("aria-label", `Mark ${chore.title} done`);
        completeButton.addEventListener("click", () => completeChore(chore, personSelect, completeButton));
        action.append(personSelect, completeButton);

        row.append(number, details, action);
        choreList.append(row);
    }
}

async function refreshHousehold() {
    const [latestChores, latestPeople] = await Promise.all([
        request("/api/chores"),
        request("/api/people")
    ]);
    chores = latestChores;
    people = latestPeople;
    renderPeople();
    renderChores();
}

async function completeChore(chore, select, button) {
    if (!select.value) {
        choresStatus.textContent = "Choose who completed this chore first.";
        return;
    }

    button.disabled = true;
    choresStatus.textContent = "Saving completion …";
    try {
        await request("/api/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ choreId: chore.id, personId: Number(select.value) })
        });
        choresStatus.textContent = `${chore.title} checked off.`;
        await refreshHousehold();
    } catch (error) {
        choresStatus.textContent = error.message;
        button.disabled = false;
    }
}

function renderRankings(target, items, labelFor, emptyText) {
    target.replaceChildren();
    if (!items.length) {
        target.append(element("p", "quiet-empty", emptyText));
        return;
    }

    const max = Math.max(1, ...items.map((item) => item.completion_count));
    for (const [index, item] of items.entries()) {
        const row = element("div", "rank-row");
        const top = element("div", "rank-top");
        top.append(element("span", "rank-position", String(index + 1).padStart(2, "0")), element("span", "rank-name", labelFor(item)), element("strong", "rank-value", String(item.completion_count)));
        const track = element("span", "rank-track");
        const bar = element("span", `rank-bar rank-bar-${index % 4}`);
        bar.style.width = `${item.completion_count ? Math.max(5, item.completion_count / max * 100) : 0}%`;
        track.append(bar);
        row.append(top, track);
        target.append(row);
    }
}

function renderRecent(items) {
    const target = document.querySelector("#recent-list");
    target.replaceChildren();
    if (!items.length) {
        target.append(element("p", "quiet-empty", "Completed chores will show up here."));
        return;
    }

    for (const item of items) {
        const row = element("article", "recent-row");
        row.append(
            element("span", "recent-date", formatDate(item.completed_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })),
            element("strong", "recent-chore", item.chore_title),
            element("span", "recent-person", item.person_name)
        );
        target.append(row);
    }
}

async function loadStats() {
    const status = document.querySelector("#stats-status");
    status.textContent = "Updating the household picture …";
    try {
        const stats = await request(`/api/stats?period=${encodeURIComponent(document.querySelector("#stats-period").value)}`);
        document.querySelector("#metric-total").textContent = String(stats.summary.total_completions);
        document.querySelector("#metric-people").textContent = String(stats.summary.active_people);
        document.querySelector("#metric-chores").textContent = String(stats.summary.completed_chores);
        renderRankings(document.querySelector("#people-stats"), stats.byPerson, (item) => item.name, "Add household members to start your stats.");
        renderRankings(document.querySelector("#chore-stats"), stats.byChore, (item) => item.title, "Add chores to see them here.");
        renderRecent(stats.recent);
        status.textContent = "";
    } catch (error) {
        status.textContent = error.message;
    }
}

async function submitForm(form, endpoint, getPayload, onSuccess) {
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    setupStatus.textContent = "Saving to your household database …";
    try {
        const result = await request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(getPayload(new FormData(form)))
        });
        form.reset();
        await refreshHousehold();
        setupStatus.textContent = onSuccess(result);
        if (!document.querySelector("#stats-view").hidden) loadStats();
    } catch (error) {
        setupStatus.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

for (const tab of tabs) tab.addEventListener("click", () => selectView(tab.dataset.viewTab));
for (const tab of tabs) {
    tab.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            selectView(next.dataset.viewTab);
            next.focus();
        }
    });
}

document.querySelector("#person-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, "/api/people", (data) => ({ name: data.get("name") }), (person) => `${person.name} added to the household.`);
});
document.querySelector("#chore-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, "/api/chores", (data) => ({ title: data.get("title"), description: data.get("description") }), (chore) => `${chore.title} added to the list.`);
});
document.querySelector("#stats-period").addEventListener("change", loadStats);
document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
        await request("/api/auth/logout", { method: "POST" });
    } finally {
        window.location.replace("/");
    }
});

document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
request("/api/auth/status").then((status) => {
    document.querySelector("#signed-in-user").textContent = status.username;
    return refreshHousehold();
}).catch((error) => {
    choresStatus.textContent = error.message;
    todayProgress.textContent = "Could not connect to your household database";
});