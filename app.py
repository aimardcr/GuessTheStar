import os
import random
import uuid
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

from flask import Flask, jsonify, render_template, request, send_file, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash
from dotenv import load_dotenv


# ---------------------------------------------------------
# App setup
# ---------------------------------------------------------
load_dotenv()
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

def build_db_uri() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url.replace("postgres://", "postgresql://", 1)

    host = os.environ.get("DB_HOST")
    if host:
        name = os.environ.get("DB_NAME", "guessthestar")
        user = os.environ.get("DB_USER", "guessthestar")
        password = os.environ.get("DB_PASSWORD", "guessthestar")
        port = os.environ.get("DB_PORT", "5432")
        return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}"

    return "sqlite:///guessthestar.db"

app.config.update(
    SQLALCHEMY_DATABASE_URI=build_db_uri(),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
)

db = SQLAlchemy(app)


# ---------------------------------------------------------
# Constants
# ---------------------------------------------------------
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
CHOICE_COUNT = 3
ROUND_SIZE = 10
WIN_THRESHOLD = 6
SESSION_TTL = timedelta(minutes=25)
USERNAME_MAX = 32
PASSWORD_MIN = 8


# ---------------------------------------------------------
# Models
# ---------------------------------------------------------
class User(db.Model):
    __tablename__ = "gts_users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    display_name = db.Column(db.String(128), nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    correct_guesses = db.Column(db.Integer, default=0)
    rounds_won = db.Column(db.Integer, default=0)
    rounds_played = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_public(self):
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "correct_guesses": self.correct_guesses,
            "rounds_won": self.rounds_won,
            "rounds_played": self.rounds_played,
        }


class Person(db.Model):
    __tablename__ = "gts_people"

    id = db.Column(db.String(128), primary_key=True)
    display_name = db.Column(db.String(128), nullable=False)
    image_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    images = db.relationship(
        "PersonImage",
        backref="person",
        lazy=True,
        cascade="all, delete-orphan",
    )


class PersonImage(db.Model):
    __tablename__ = "gts_person_images"

    id = db.Column(db.String(36), primary_key=True)
    person_id = db.Column(db.String(128), db.ForeignKey("gts_people.id"), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    file_hash = db.Column(db.String(64), nullable=False)
    file_path = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class GameSession(db.Model):
    __tablename__ = "gts_game_sessions"

    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("gts_users.id"), nullable=True)
    round_number = db.Column(db.Integer, default=1)
    round_guesses = db.Column(db.Integer, default=0)
    round_correct = db.Column(db.Integer, default=0)
    round_ready = db.Column(db.Boolean, default=False)
    served_images = db.Column(db.JSON, default=list)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship("User", lazy=True)

    def to_public(self):
        return {
            "session_id": self.id,
            "round_number": self.round_number,
            "round_guesses": self.round_guesses,
            "round_correct": self.round_correct,
            "round_ready": self.round_ready,
            "round_size": ROUND_SIZE,
        }


class GameRound(db.Model):
    __tablename__ = "gts_game_rounds"

    id = db.Column(db.String(36), primary_key=True)
    session_id = db.Column(db.String(36), db.ForeignKey("gts_game_sessions.id"), nullable=False)
    correct_person_id = db.Column(db.String(128), db.ForeignKey("gts_people.id"), nullable=False)
    image_id = db.Column(db.String(36), db.ForeignKey("gts_person_images.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    person = db.relationship("Person", lazy=True)
    image = db.relationship("PersonImage", lazy=True)


# ---------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------
def normalize_username(value: str) -> str:
    """
    Lowercase and strip all whitespace characters entirely.
    Example: 'Foo Bar ' -> 'foobar'
    """
    return "".join((value or "").split()).lower()


def hash_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def sync_media_library() -> None:
    """
    Scan static/images, register people + images in the database,
    and keep the table in sync with the filesystem.
    """
    base_dir = Path(__file__).parent / "static" / "images"
    if not base_dir.exists():
        return

    seen_people = set()
    seen_images = set()

    for folder in base_dir.iterdir():
        if not folder.is_dir():
            continue

        person_id = folder.name.lower()
        seen_people.add(person_id)
        display_name = " ".join(part.capitalize() for part in folder.name.replace("_", " ").split())

        person = Person.query.get(person_id)
        if not person:
            person = Person(id=person_id, display_name=display_name)
            db.session.add(person)
        else:
            person.display_name = display_name

        image_count = 0
        for file_path in folder.iterdir():
            if file_path.suffix.lower() not in IMAGE_EXTENSIONS or not file_path.is_file():
                continue

            image_count += 1
            file_hash = hash_file(file_path)
            key = (person_id, file_path.name)
            seen_images.add(key)

            image = PersonImage.query.filter_by(person_id=person_id, filename=file_path.name).first()
            if not image:
                image = PersonImage(
                    id=str(uuid.uuid4()),
                    person_id=person_id,
                    filename=file_path.name,
                    file_hash=file_hash,
                    file_path=str(file_path.resolve()),
                )
                db.session.add(image)
            else:
                image.file_hash = file_hash
                image.file_path = str(file_path.resolve())

        person.image_count = image_count

    # Remove people no longer on disk
    for stale_person in Person.query.all():
        if stale_person.id not in seen_people:
            db.session.delete(stale_person)

    # Remove orphan images that disappeared from disk
    for stale_image in PersonImage.query.all():
        key = (stale_image.person_id, stale_image.filename)
        if key not in seen_images:
            db.session.delete(stale_image)

    db.session.commit()


def current_user() -> Optional[User]:
    user_id = session.get("user_id")
    if not user_id:
        return None
    return User.query.get(user_id)


def ensure_game_session() -> GameSession:
    """
    Return the current game session (create if missing/expired) and
    extend its TTL. Associates the session with the logged-in user if present.
    """
    session_id = session.get("game_session_id")
    now = datetime.utcnow()

    active_session = None
    if session_id:
        candidate = GameSession.query.get(session_id)
        if candidate and candidate.expires_at > now:
            active_session = candidate

    if not active_session:
        active_session = GameSession(
            id=str(uuid.uuid4()),
            user_id=session.get("user_id"),
            expires_at=now + SESSION_TTL,
            served_images=[],
        )
        db.session.add(active_session)
        db.session.commit()
        session["game_session_id"] = active_session.id

    # keep session fresh
    active_session.expires_at = now + SESSION_TTL
    if session.get("user_id") and active_session.user_id != session.get("user_id"):
        active_session.user_id = session.get("user_id")
    db.session.commit()
    return active_session


def reset_round_state(game_session: GameSession, increment_round: bool = True) -> None:
    game_session.round_guesses = 0
    game_session.round_correct = 0
    game_session.round_ready = False
    game_session.served_images = []
    if increment_round:
        game_session.round_number += 1
    game_session.expires_at = datetime.utcnow() + SESSION_TTL
    db.session.commit()


def get_active_round_payload(session_id: str):
    cached = session.get("active_round")
    if not cached:
        return None
    if cached.get("session_id") != session_id:
        session.pop("active_round", None)
        session.modified = True
        return None
    # ensure the round still exists
    round_id = cached.get("round_id")
    if not round_id or not GameRound.query.get(round_id):
        session.pop("active_round", None)
        session.modified = True
        return None
    return cached.get("payload")


def cache_active_round(session_id: str, payload: dict) -> None:
    session["active_round"] = {
        "session_id": session_id,
        "round_id": payload.get("round_id"),
        "payload": payload,
        "cached_at": datetime.utcnow().isoformat(),
    }
    session.modified = True


def clear_active_round() -> None:
    if session.pop("active_round", None) is not None:
        session.modified = True


def pick_random_image(person: Person, used_ids: List[str]) -> Optional[PersonImage]:
    candidates = [img for img in person.images if img.id not in used_ids and Path(img.file_path).exists()]
    if not candidates:
        candidates = [img for img in person.images if Path(img.file_path).exists()]
    if not candidates:
        return None
    return random.choice(candidates)


def build_round_payload(game_session: GameSession):
    people = Person.query.filter(Person.image_count > 0).all()
    if len(people) < CHOICE_COUNT:
        return None, ("Not enough people with images", 500)

    correct_person = random.choice(people)
    correct_image = pick_random_image(correct_person, game_session.served_images or [])
    if not correct_image:
        return None, ("No images available for selected person", 500)

    distractors = [p for p in people if p.id != correct_person.id]
    random.shuffle(distractors)
    distractors = distractors[: CHOICE_COUNT - 1]

    choices = [correct_person] + distractors
    random.shuffle(choices)

    round_id = str(uuid.uuid4())
    game_round = GameRound(
        id=round_id,
        session_id=game_session.id,
        correct_person_id=correct_person.id,
        image_id=correct_image.id,
    )
    db.session.add(game_round)
    db.session.commit()

    payload = {
        "round_id": round_id,
        "image_id": correct_image.id,
        "image_url": f"/api/v1/images/{correct_image.id}",
        "choices": [{"id": p.id, "name": p.display_name} for p in choices],
        "round_number": game_session.round_number,
        "round_size": ROUND_SIZE,
        "round_state": {
            "guesses": game_session.round_guesses,
            "correct": game_session.round_correct,
            "ready": game_session.round_ready,
        },
    }
    return payload, None


def sorted_users():
    users = User.query.all()
    users.sort(
        key=lambda u: (
            -(u.correct_guesses + (u.rounds_won * 10)),
            -u.rounds_won,
            -u.correct_guesses,
            u.username,
        )
    )
    return users


def leaderboard_rows(limit: int = 10):
    ordered = sorted_users()
    rows = []
    for idx, row in enumerate(ordered[:limit], start=1):
        points = row.correct_guesses + (row.rounds_won * 10)
        win_rate = float(row.rounds_won) / row.rounds_played if row.rounds_played else 0
        rows.append(
            {
                "rank": idx,
                "username": row.username,
                "display_name": row.display_name,
                "correct_guesses": row.correct_guesses,
                "rounds_won": row.rounds_won,
                "rounds_played": row.rounds_played,
                "win_rate": win_rate,
                "points": points,
            }
        )
    return rows


def user_rank(user: User):
    ordered = sorted_users()
    for idx, row in enumerate(ordered, start=1):
        if row.id == user.id:
            points = row.correct_guesses + (row.rounds_won * 10)
            win_rate = float(row.rounds_won) / row.rounds_played if row.rounds_played else 0
            return {
                "rank": idx,
                "username": row.username,
                "display_name": row.display_name,
                "correct_guesses": row.correct_guesses,
                "rounds_won": row.rounds_won,
                "rounds_played": row.rounds_played,
                "win_rate": win_rate,
                "points": points,
            }
    return None


def seed_fake_users(min_count: int = 50) -> None:
    """
    Populate synthetic leaderboard entries if the database has fewer than min_count users.
    """
    existing_usernames = {row.username for row in User.query.with_entities(User.username).all()}
    current = len(existing_usernames)
    if current >= min_count:
        return

    needed = min_count - current
    generated = 0
    attempts = 0
    max_attempts = needed * 10

    while generated < needed and attempts < max_attempts:
        attempts += 1
        suffix = random.randint(1, 9999)
        username = f"player{suffix:04d}"
        if username in existing_usernames:
            continue
        existing_usernames.add(username)
        display_name = f"Guest {suffix:04d}"
        rounds_played = random.randint(5, 30)
        rounds_won = random.randint(0, rounds_played)
        correct_guesses = random.randint(max(rounds_won, 3), rounds_won * 5 + 25)
        user = User(
            username=username,
            display_name=display_name,
            password_hash=generate_password_hash("changeme"),
            correct_guesses=correct_guesses,
            rounds_won=rounds_won,
            rounds_played=rounds_played,
        )
        db.session.add(user)
        generated += 1

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()


# ---------------------------------------------------------
# Routes - Pages
# ---------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html", choice_count=CHOICE_COUNT)


@app.route("/leaderboard")
def leaderboard_page():
    return render_template("leaderboard.html")


# ---------------------------------------------------------
# Routes - API
# ---------------------------------------------------------
@app.route("/api/v1/status", methods=["GET"])
def get_status():
    game_session = ensure_game_session()
    user = current_user()
    return jsonify({"user": user.to_public() if user else None, "session": game_session.to_public()})


@app.route("/api/v1/auth/register", methods=["POST"])
def register():
    payload = request.json or {}
    raw_username = (payload.get("username") or "").strip()
    username = normalize_username(raw_username)
    display_name = (payload.get("display_name") or "").strip()
    password = payload.get("password") or ""

    if not username or not display_name or not password:
        return jsonify({"error": "Username, display name, and password are required."}), 400
    if any(ch.isspace() for ch in raw_username):
        return jsonify({"error": "Username cannot contain spaces."}), 400
    if len(username) > USERNAME_MAX:
        return jsonify({"error": f"Username must be {USERNAME_MAX} characters or fewer."}), 400
    if len(password) < PASSWORD_MIN:
        return jsonify({"error": f"Password must be at least {PASSWORD_MIN} characters."}), 400

    user = User(
        username=username,
        display_name=display_name,
        password_hash=generate_password_hash(password),
    )
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Username already exists."}), 400

    session["user_id"] = user.id
    active_session = ensure_game_session()
    active_session.user_id = user.id
    db.session.commit()

    return jsonify({"user": user.to_public(), "session": active_session.to_public()})


@app.route("/api/v1/auth/login", methods=["POST"])
def login():
    payload = request.json or {}
    username = normalize_username(payload.get("username") or "")
    password = payload.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid credentials."}), 401

    session["user_id"] = user.id
    active_session = ensure_game_session()
    active_session.user_id = user.id
    db.session.commit()

    return jsonify({"user": user.to_public(), "session": active_session.to_public()})


@app.route("/api/v1/auth/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"success": True})


@app.route("/api/v1/profile", methods=["PATCH"])
def update_profile():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.json or {}
    new_username = payload.get("username")
    new_display_name = payload.get("display_name")
    current_password = payload.get("current_password") or ""
    new_password = payload.get("new_password")

    if new_username and normalize_username(new_username) != user.username:
        return jsonify({"error": "Username cannot be changed."}), 400
    if new_display_name:
        clean_name = new_display_name.strip()
        if not clean_name:
            return jsonify({"error": "Display name cannot be empty."}), 400
        user.display_name = clean_name

    if new_password:
        if len(new_password) < PASSWORD_MIN:
            return jsonify({"error": f"Password must be at least {PASSWORD_MIN} characters."}), 400
        if not check_password_hash(user.password_hash, current_password):
            return jsonify({"error": "Current password is incorrect."}), 400
        user.password_hash = generate_password_hash(new_password)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Username already exists."}), 400

    return jsonify({"user": user.to_public()})


@app.route("/api/v1/game/round", methods=["GET"])
def next_round():
    game_session = ensure_game_session()
    if game_session.round_ready:
        return jsonify({"error": "Current round is complete. Submit results before continuing."}), 409

    cached_payload = get_active_round_payload(game_session.id)
    if cached_payload:
        return jsonify(cached_payload)

    payload, error = build_round_payload(game_session)
    if error:
        message, status = error
        return jsonify({"error": message}), status
    cache_active_round(game_session.id, payload)
    return jsonify(payload)


@app.route("/api/v1/game/answer", methods=["POST"])
def submit_answer():
    payload = request.json or {}
    round_id = payload.get("round_id")
    selected_id = payload.get("selected_id")

    if not round_id or not selected_id:
        return jsonify({"error": "round_id and selected_id are required."}), 400

    game_round = GameRound.query.get(round_id)
    if not game_round:
        return jsonify({"error": "Round not found."}), 404

    game_session = ensure_game_session()
    if game_round.session_id != game_session.id:
        return jsonify({"error": "Round does not belong to this session."}), 403

    correct = selected_id == game_round.correct_person_id
    clear_active_round()
    game_session.round_guesses += 1
    if correct:
        game_session.round_correct += 1

    used_ids = set(game_session.served_images or [])
    if game_round.image_id not in used_ids:
        game_session.served_images = list(used_ids | {game_round.image_id})

    if game_session.round_guesses >= ROUND_SIZE:
        game_session.round_ready = True

    db.session.delete(game_round)
    db.session.commit()

    correct_person = Person.query.get(game_round.correct_person_id)
    return jsonify(
        {
            "correct": correct,
            "correct_id": game_round.correct_person_id,
            "correct_name": correct_person.display_name if correct_person else None,
            "round_state": {
                "guesses": game_session.round_guesses,
                "correct": game_session.round_correct,
                "ready": game_session.round_ready,
            },
        }
    )


@app.route("/api/v1/game/complete", methods=["POST"])
def complete_round():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    game_session = ensure_game_session()
    if not game_session.round_ready:
        return jsonify({"error": "Round is not complete yet."}), 400

    user.correct_guesses += game_session.round_correct
    user.rounds_played += 1
    if game_session.round_correct >= WIN_THRESHOLD:
        user.rounds_won += 1

    reset_round_state(game_session, increment_round=True)

    return jsonify(
        {
            "user": user.to_public(),
            "session": game_session.to_public(),
        }
    )


@app.route("/api/v1/session/reset", methods=["POST"])
def reset_session_round():
    game_session = ensure_game_session()
    clear_active_round()
    reset_round_state(game_session, increment_round=True)
    return jsonify({"session": game_session.to_public()})


@app.route("/api/v1/leaderboard", methods=["GET"])
def api_leaderboard():
    user = current_user()
    return jsonify({"entries": leaderboard_rows(), "current_user": user_rank(user) if user else None})


@app.route("/api/v1/images/<image_id>", methods=["GET"])
def get_image(image_id):
    image = PersonImage.query.get(image_id)
    if not image or not Path(image.file_path).exists():
        return jsonify({"error": "Image not found"}), 404
    response = send_file(image.file_path)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


# ---------------------------------------------------------
# Startup tasks
# ---------------------------------------------------------
with app.app_context():
    db.create_all()
    sync_media_library()
    if os.environ.get("SEED_FAKE_USERS", "").lower() in {"1", "true", "yes"}:
        seed_fake_users()


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5555)
