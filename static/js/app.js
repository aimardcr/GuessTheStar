const state = {
    session: null,
    user: null,
    currentRound: null,
    answered: false,
};

const WIN_THRESHOLD = 6;

const els = {
    imageStage: document.querySelector(".image-stage"),
    gameImage: document.getElementById("gameImage"),
    choices: Array.from(document.querySelectorAll("[data-slot]")),
    feedback: document.getElementById("feedback"),
    statRound: document.getElementById("statRound"),
    statCorrect: document.getElementById("statCorrect"),
    statGuesses: document.getElementById("statGuesses"),
    statProgressLabel: document.getElementById("statProgressLabel"),
    progressBar: document.getElementById("progressBar"),
    authSection: document.getElementById("authSection"),
    profileSection: document.getElementById("profileSection"),
    profileName: document.getElementById("profileName"),
    profileUsername: document.getElementById("profileUsername"),
    profileForm: document.getElementById("profileForm"),
    displayNameInput: document.getElementById("displayNameInput"),
    usernameInput: document.getElementById("usernameInput"),
    currentPasswordInput: document.getElementById("currentPasswordInput"),
    newPasswordInput: document.getElementById("newPasswordInput"),
    profileMessage: document.getElementById("profileMessage"),
    authUsername: document.getElementById("authUsername"),
    authName: document.getElementById("authName"),
    authPassword: document.getElementById("authPassword"),
    authError: document.getElementById("authError"),
    loginBtn: document.getElementById("loginBtn"),
    registerBtn: document.getElementById("registerBtn"),
    loginActions: document.getElementById("loginActions"),
    registerActions: document.getElementById("registerActions"),
    loginSwitch: document.getElementById("loginSwitch"),
    registerSwitch: document.getElementById("registerSwitch"),
    showRegisterLink: document.getElementById("showRegisterLink"),
    showLoginLink: document.getElementById("showLoginLink"),
    authDisplayRow: document.getElementById("authDisplayRow"),
    logoutBtn: document.getElementById("logoutBtn"),
    toast: document.getElementById("toast"),
    openProfile: document.getElementById("openProfile"),
    profileModal: document.getElementById("profileModal"),
    closeProfile: document.getElementById("closeProfile"),
    resultModal: document.getElementById("resultModal"),
    resultStatus: document.getElementById("resultStatus"),
    resultDetail: document.getElementById("resultDetail"),
    resultContinue: document.getElementById("resultContinue"),
    sidebarLeaderboard: document.getElementById("sidebarLeaderboard"),
    sidebarSelf: document.getElementById("sidebarSelf"),
    easterEggVideo: document.getElementById("easterEggVideo"),
};

let devToolsFlagged = false;
let pendingAdvance = null;
let authMode = "login";

function detectDevTools(allow = 120) {
    if (devToolsFlagged) return;
    const start = +new Date();
    const d = new Function("debugger;");
    d();
    const end = +new Date();
    if (end - start > allow) {
        devToolsFlagged = true;
        window.location.reload();
    }
}

function initDevToolsDetection() {
    const handler = () => detectDevTools(120);
    window.addEventListener("load", handler);
    window.addEventListener("resize", handler);
    window.addEventListener("mousemove", handler);
    window.addEventListener("focus", handler);
    window.addEventListener("blur", handler);
}

function setFeedback(message, tone = "muted") {
    els.feedback.textContent = message || "";
    els.feedback.className = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "muted";
}

function setAuthMode(mode = "login") {
    authMode = mode;
    const isRegister = mode === "register";
    els.authDisplayRow?.classList.toggle("d-none", !isRegister);
    els.loginActions?.classList.toggle("d-none", isRegister);
    els.registerActions?.classList.toggle("d-none", !isRegister);
    els.loginSwitch?.classList.toggle("d-none", isRegister);
    els.registerSwitch?.classList.toggle("d-none", !isRegister);
    els.authError.textContent = "";
    // Reset fields to avoid leaking register-only data in login mode
    if (!isRegister) {
        els.authName.value = "";
    }
    els.authPassword.value = "";
}

function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function applyZoomState(active, seed) {
    if (!els.imageStage) return;
    if (active) {
        const rng = mulberry32(seed === undefined ? Date.now() : seed);
        const offsetX = (rng() * 60 - 30).toFixed(0) + "px";
        const offsetY = (rng() * 60 - 30).toFixed(0) + "px";
        els.imageStage.style.setProperty("--offset-x", offsetX);
        els.imageStage.style.setProperty("--offset-y", offsetY);
        els.imageStage.classList.add("zoomed");
        els.imageStage.classList.remove("revealed");
    } else {
        els.imageStage.classList.remove("zoomed");
        els.imageStage.classList.add("revealed");
    }
}

function setStatusChip(status) {
    return;
}

function updateProgress(session) {
    if (!session) return;
    els.statRound.textContent = session.round_number;
    els.statCorrect.textContent = session.round_correct;
    els.statGuesses.textContent = session.round_guesses;

    const pct = Math.min(100, (session.round_guesses / session.round_size) * 100);
    els.progressBar.style.width = `${pct}%`;
    els.statProgressLabel.textContent = `${session.round_guesses} / ${session.round_size}`;
    setStatusChip({ ready: session.round_ready });

    if (session.round_ready) {
        setFeedback("Round complete. Saving or resetting…", "success");
    }
}

function setUser(user) {
    state.user = user;
    if (user) {
        els.authSection.classList.add("d-none");
        els.profileSection.classList.remove("d-none");
        els.profileUsername.textContent = `@${user.username}`;
        els.displayNameInput.value = user.display_name || "";
        els.usernameInput.value = user.username || "";
        els.profileMessage.textContent = "";
        if (els.openProfile) {
            els.openProfile.textContent = "Profile";
            els.openProfile.classList.remove("cta-light");
        }
        if (els.logoutBtn) {
            els.logoutBtn.classList.remove("d-none");
        }
    } else {
        els.authSection.classList.remove("d-none");
        els.profileSection.classList.add("d-none");
        if (els.profileName) {
            els.profileName.textContent = "-";
        }
        els.profileUsername.textContent = "-";
        setAuthMode("login");
        if (els.openProfile) {
            els.openProfile.textContent = "Login";
            els.openProfile.classList.add("cta-light");
        }
        if (els.logoutBtn) {
            els.logoutBtn.classList.add("d-none");
        }
    }
}

function clearChoiceStyles() {
    els.choices.forEach((btn) => {
        btn.classList.remove("correct", "incorrect");
        btn.disabled = false;
    });
}

async function fetchStatus(retry = 0) {
    try {
        const res = await fetch("/api/v1/status");
        if (!res.ok) throw new Error("Failed to load status");
        const data = await res.json();
        state.session = data.session;
        setUser(data.user);
        updateProgress(state.session);
    } catch (error) {
        console.error(error);
        if (retry < 1) {
            setTimeout(() => fetchStatus(retry + 1), 800);
            return;
        }
        setFeedback("Cannot load session. Try refreshing.", "danger");
    }
}

function renderRound(round) {
    state.currentRound = round;
    state.answered = false;
    clearChoiceStyles();
    setFeedback("Who is this?");
    applyZoomState(true, getZoomSeed(round));

    if (round && round.image_url) {
        setImageSource(round.image_url);
    }

    (round.choices || []).forEach((choice, idx) => {
        const btn = els.choices[idx];
        if (btn) {
            btn.textContent = choice.name;
            btn.dataset.id = choice.id;
            btn.disabled = false;
        }
    });
}

async function loadRound() {
    if (state.session && state.session.round_ready) {
        if (state.user) {
            await completeRound();
        } else {
            await resetRound();
        }
        return;
    }

    try {
        const res = await fetch("/api/v1/game/round");
        if (res.status === 409) {
            state.session.round_ready = true;
            updateProgress(state.session);
            setFeedback("Round complete. Saving or resetting…", "success");
            if (state.user) {
                await completeRound();
            } else {
                await resetRound();
            }
            return;
        }
        if (!res.ok) {
            throw new Error("Failed to load round");
        }
        const round = await res.json();
        renderRound(round);
    } catch (error) {
        setFeedback("Could not load round.", "danger");
        console.error(error);
    }
}

function highlightChoices(selectedId, correctId) {
    els.choices.forEach((btn) => {
        const isCorrect = btn.dataset.id === correctId;
        const isSelected = btn.dataset.id === selectedId;
        if (isCorrect) {
            btn.classList.add("correct");
        } else if (isSelected) {
            btn.classList.add("incorrect");
        }
        btn.disabled = true;
    });
    applyZoomState(false);
}

async function submitAnswer(choiceId) {
    if (!state.currentRound || state.answered) return;
    state.answered = true;

    // Only show if the URI is something like /#reza
    if (window.location.hash === "#reza") {
        showEasterEgg(() => {
            // After easter egg is closed, continue with the answer submission
            processAnswer(choiceId);
        });
        return;
    }

    // If no easter egg, process answer immediately
    await processAnswer(choiceId);
}

async function processAnswer(choiceId) {
    try {
        const res = await fetch("/api/v1/game/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                round_id: state.currentRound.round_id,
                selected_id: choiceId,
            }),
        });

        if (!res.ok) {
            throw new Error("Failed to submit answer");
        }

        const data = await res.json();
        highlightChoices(choiceId, data.correct_id);

        state.session.round_guesses = data.round_state.guesses;
        state.session.round_correct = data.round_state.correct;
        state.session.round_ready = data.round_state.ready;
        updateProgress(state.session);

        if (data.correct) {
            setFeedback("Nice! That was correct.", "success");
        } else {
            setFeedback(`It was ${data.correct_name}.`, "danger");
        }
        const delay = 2500;
        if (state.session.round_ready) {
            const drawThreshold = Math.max(0, WIN_THRESHOLD - 1);
            const outcome =
                state.session.round_correct >= WIN_THRESHOLD
                    ? "win"
                    : state.session.round_correct === drawThreshold
                    ? "draw"
                    : "lose";
            const summary =
                outcome === "win"
                    ? `You won with ${state.session.round_correct}/${state.session.round_size}.`
                    : outcome === "draw"
                    ? `Draw: ${state.session.round_correct}/${state.session.round_size}.`
                    : `You lost with ${state.session.round_correct}/${state.session.round_size}. Tertangkap basah kau suki 😹!`;
            setTimeout(() => {
                showResultModal(outcome, summary);
            }, delay);
        } else {
            setTimeout(() => loadRound(), delay);
        }
    } catch (error) {
        setFeedback("Error submitting answer.", "danger");
        console.error(error);
        state.answered = false;
    }
}

async function completeRound() {
    try {
        const res = await fetch("/api/v1/game/complete", { method: "POST" });
        if (res.status === 401) {
            showToast("Login to save your points. Resetting locally.");
            await resetRound();
            return;
        }
        if (!res.ok) throw new Error("Failed to complete round");
        const data = await res.json();
        state.user = data.user;
        state.session = data.session;
        setUser(state.user);
        updateProgress(state.session);
        showToast("Your points has been updated.");
        loadSidebarLeaderboard();
        await loadRound();
    } catch (error) {
        console.error(error);
        setFeedback("Unable to complete round.", "danger");
    }
}

async function resetRound() {
    try {
        const res = await fetch("/api/v1/session/reset", { method: "POST" });
        if (!res.ok) throw new Error("Failed to reset round");
        const data = await res.json();
        state.session = data.session;
        updateProgress(state.session);
        await loadRound();
    } catch (error) {
        console.error(error);
        setFeedback("Unable to reset round.", "danger");
    }
}

function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("show");
    setTimeout(() => els.toast.classList.remove("show"), 2500);
}

async function submitAuth(endpoint) {
    const rawUsername = els.authUsername.value.trim();
    const username = rawUsername.replace(/\s+/g, "").toLowerCase();
    const password = els.authPassword.value;
    const displayName = els.authName.value.trim() || username;

    if (!username || !password) {
        els.authError.textContent = "Username and password are required.";
        return;
    }

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, display_name: displayName }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Auth failed");
        }
        state.user = data.user;
        state.session = data.session || state.session;
        setUser(state.user);
        updateProgress(state.session);
        els.authPassword.value = "";
        showToast(endpoint.includes("register") ? "Account created." : "Welcome back.");
        hideProfileModal();
    } catch (error) {
        els.authError.textContent = error.message;
    }
}

async function updateProfile(event) {
    event.preventDefault();
    try {
        const res = await fetch("/api/v1/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                display_name: els.displayNameInput.value.trim(),
                current_password: els.currentPasswordInput.value,
                new_password: els.newPasswordInput.value,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Update failed");
        }
        state.user = data.user;
        setUser(state.user);
        els.currentPasswordInput.value = "";
        els.newPasswordInput.value = "";
        els.profileMessage.textContent = "Profile updated.";
        showToast("Profile updated.");
    } catch (error) {
        els.profileMessage.textContent = error.message;
    }
}

async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    state.user = null;
    setUser(null);
    window.location.reload();
}

function bindEvents() {
    els.choices.forEach((btn) => {
        btn.addEventListener("click", () => submitAnswer(btn.dataset.id));
    });
    if (els.gameImage) {
        els.gameImage.addEventListener("contextmenu", (e) => e.preventDefault());
        els.gameImage.addEventListener("dragstart", (e) => e.preventDefault());
    }
    if (els.authUsername) {
        const sanitizeUsername = () => {
            const cleaned = els.authUsername.value.replace(/\s+/g, "");
            if (els.authUsername.value !== cleaned) {
                const pos = els.authUsername.selectionStart;
                els.authUsername.value = cleaned;
                if (pos !== null) {
                    els.authUsername.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
                }
            }
        };
        els.authUsername.addEventListener("input", sanitizeUsername);
        els.authUsername.addEventListener("keydown", (e) => {
            if (e.key === " ") {
                e.preventDefault();
            }
        });
    }
    els.loginBtn.addEventListener("click", () => submitAuth("/api/v1/auth/login"));
    els.registerBtn.addEventListener("click", () => submitAuth("/api/v1/auth/register"));
    els.showRegisterLink?.addEventListener("click", (e) => {
        e.preventDefault();
        setAuthMode("register");
    });
    els.showLoginLink?.addEventListener("click", (e) => {
        e.preventDefault();
        setAuthMode("login");
    });
    els.profileForm.addEventListener("submit", updateProfile);
    els.logoutBtn.addEventListener("click", logout);
    els.openProfile.addEventListener("click", () => showProfileModal());
    els.closeProfile.addEventListener("click", () => hideProfileModal());
    els.profileModal.addEventListener("click", (e) => {
        if (e.target === els.profileModal || e.target.classList.contains("modal-backdrop")) {
            hideProfileModal();
        }
    });
    const profileCard = document.querySelector(".profile-modal .profile-card");
    if (profileCard) {
        profileCard.addEventListener("click", (e) => e.stopPropagation());
    }
    els.resultContinue.addEventListener("click", () => {
        hideResultModal();
        if (pendingAdvance) {
            pendingAdvance();
            pendingAdvance = null;
        }
    });
}

function showResultModal(outcome, detail) {
    if (!els.resultModal) return;
    els.resultStatus.textContent =
        outcome === "win" ? "You Win" : outcome === "draw" ? "Draw" : "You Lose";
    els.resultDetail.innerHTML = detail;
    els.resultModal.classList.add("show");
    pendingAdvance = () => {
        if (state.user) {
            completeRound();
        } else {
            resetRound();
        }
    };
}

function hideResultModal() {
    if (!els.resultModal) return;
    els.resultModal.classList.remove("show");
}

function showProfileModal() {
    if (!els.profileModal) return;
    if (!state.user) {
        setAuthMode("login");
    }
    els.profileModal.classList.add("show");
}

function hideProfileModal() {
    if (!els.profileModal) return;
    els.profileModal.classList.remove("show");
}

function showEasterEgg(onClose) {
    if (!els.easterEggVideo || !els.gameImage) return;
    
    // Hide the game image and show the video
    els.gameImage.style.display = 'none';
    els.easterEggVideo.style.display = 'block';
    
    // Make sure image stage stays revealed (no zoom)
    if (els.imageStage) {
        els.imageStage.classList.remove('zoomed');
        els.imageStage.classList.add('revealed');
    }
    
    // Play the video
    els.easterEggVideo.play();
    
    // When video ends, hide it and continue
    const hideEasterEgg = () => {
        els.easterEggVideo.style.display = 'none';
        els.easterEggVideo.pause();
        els.easterEggVideo.currentTime = 0;
        els.gameImage.style.display = 'block';
        els.easterEggVideo.removeEventListener('ended', hideEasterEgg);
        if (onClose) onClose();
    };
    
    // Auto-hide when video ends
    els.easterEggVideo.addEventListener('ended', hideEasterEgg, { once: true });
}

function renderSidebarLeaderboard(entries, currentUser) {
    if (!els.sidebarLeaderboard) return;
    const container = els.sidebarLeaderboard;
    container.innerHTML = "";
    container.classList.add("sidebar-board");
    const top = (entries || []).slice(0, 5);
    if (!top.length) {
        container.innerHTML = '<div class="muted">No data yet.</div>';
        return;
    }
    top.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "leaderboard-row";
        row.innerHTML = `
            <span>#${entry.rank}</span>
            <span>${entry.display_name || "—"}</span>
            <span>${entry.points} pts</span>
        `;
        container.appendChild(row);
    });
    if (els.sidebarSelf) {
        const name = (currentUser?.display_name || currentUser?.username || "").toLowerCase();
        const hideSelf = !currentUser || name.startsWith("guest");
        if (hideSelf) {
            els.sidebarSelf.textContent = "";
            els.sidebarSelf.classList.add("d-none");
        } else {
            els.sidebarSelf.classList.remove("d-none");
            els.sidebarSelf.textContent = `@${currentUser.username} • ${currentUser.points} pts`;
        }
    }
}

async function loadSidebarLeaderboard() {
    if (!els.sidebarLeaderboard) return;
    try {
        const res = await fetch("/api/v1/leaderboard");
        if (!res.ok) throw new Error("Failed to load leaderboard");
        const data = await res.json();
        renderSidebarLeaderboard(data.entries || [], data.current_user);
    } catch (error) {
        els.sidebarLeaderboard.innerHTML = `<div class="text-danger">${error.message}</div>`;
    }
}

async function init() {
    setAuthMode("login");
    bindEvents();
    initDevToolsDetection();
    await fetchStatus();
    loadSidebarLeaderboard();
    await loadRound();
}

init();

function setImageSource(url) {
    if (!els.gameImage) return;
    els.gameImage.classList.remove("ready");
    els.gameImage.onload = () => {
        requestAnimationFrame(() => {
            els.gameImage.classList.add("ready");
        });
    };
    els.gameImage.src = "";
    requestAnimationFrame(() => {
        els.gameImage.src = url;
    });
}

function getZoomSeed(round) {
    if (round?.round_id) {
        let hash = 0;
        for (let i = 0; i < round.round_id.length; i++) {
            hash = (hash * 31 + round.round_id.charCodeAt(i)) >>> 0;
        }
        return hash || Date.now();
    }
    return Date.now();
}
