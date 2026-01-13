const leaderboardBody = document.getElementById("leaderboardBody");
const selfRank = document.getElementById("selfRank");

function renderRow(entry, isSelf = false) {
    const row = document.createElement("div");
    row.className = `leaderboard-row ${isSelf ? "me" : ""}`;
    const winRate = Math.round((entry.win_rate || 0) * 100);
    row.innerHTML = `
        <span>${entry.rank}</span>
        <span>${entry.display_name || "—"}</span>
        <span>@${entry.username}</span>
        <span>${entry.points}</span>
        <span>${winRate}%</span>
    `;
    leaderboardBody.appendChild(row);
}

function renderLeaderboard(entries, currentUser) {
    leaderboardBody.innerHTML = "";
    if (!entries.length) {
        leaderboardBody.innerHTML = '<div class="muted">No entries yet.</div>';
        return;
    }
    entries.forEach((entry) => renderRow(entry, currentUser && entry.username === currentUser.username));

    if (currentUser && !entries.some((e) => e.username === currentUser.username)) {
        const spacer = document.createElement("div");
        spacer.className = "leaderboard-row head";
        spacer.innerHTML = "<span>...</span><span>...</span><span>...</span><span>...</span><span>...</span>";
        leaderboardBody.appendChild(spacer);
        renderRow(currentUser, true);
    }

    if (currentUser) {
        selfRank.textContent = `You · #${currentUser.rank}`;
    } else {
        selfRank.textContent = "Guest";
    }
}

async function loadLeaderboard() {
    try {
        const res = await fetch("/api/v1/leaderboard");
        if (!res.ok) throw new Error("Unable to load leaderboard");
        const data = await res.json();
        renderLeaderboard(data.entries || [], data.current_user);
    } catch (error) {
        leaderboardBody.innerHTML = `<div class="text-danger">${error.message}</div>`;
    }
}

loadLeaderboard();
