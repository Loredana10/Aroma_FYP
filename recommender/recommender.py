"""
Aroma Hybrid Recommendation Engine
====================================
Pipeline:
  1. Cold Start (0 ratings)      - demographic similarity (age band + gender)
  2. Warm Start (1–4 ratings)    - content-based only + demographic boost
  3. Full Hybrid (5+ ratings)    - content-based (70%) + WMF collaborative (30%)
                                   WMF trained on explicit ratings + implicit log signals
  4. Contextual boost            - mood + time of day via similar-user signals
  5. Weather boost               - soft preference for hot/iced drinks
  6. Wind-down boost             - low-caffeine boost when relaxing/evening
  7. Dietary filter              - hard removal of incompatible drinks

Implicit ratings (supervisor suggestion):
  The user-item matrix fed to matrix factorisation is augmented with implicit
  signals derived from log frequency. A drink logged N times without a rating
  contributes a synthetic preference score of min(N/10, 1.0) with confidence
  weight c_ui = 1 + ALPHA * N. Explicit ratings always have higher confidence.
  The IMPLICIT_CAP additive boost in hybrid_scores() is removed to avoid
  double-counting now that implicit signals are baked into MF training.

Cold start (supervisor suggestion):
  Instead of returning community-popular drinks for users with 0 ratings,
  the engine finds the K most demographically similar users (matching age band
  and gender) and recommends what they rated highly. This justifies why the app
  collects age/gender data and produces more meaningful first-time recommendations.

Prints full terminal log on every request.
"""

import os
import sys

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import MinMaxScaler
from scipy import sparse
import psycopg2
from psycopg2.extras import RealDictCursor

app = Flask(__name__)

DB_CONFIG = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", 5434)),
    "database": os.getenv("DB_NAME",     "aroma_db"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", "12345"),
}

# Implicit rating confidence scaling factor
# A drink logged N times gets confidence weight: 1 + ALPHA * N
# Higher ALPHA = implicit signals dominate more relative to explicit ratings
ALPHA = 15

# Cold-start demographic similarity
DEMO_K = 20   # number of similar users to consider

# Age range strings as stored in the users table age_range column.
# These map directly to the app profile screen options.
# "<18" is treated as equivalent to the survey "<18" band.
# The recommender matches on exact string equality so no conversion needed.

def get_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)


# ─── TERMINAL HELPERS ────────────────────────────────────────────────────────

def p(msg=""):
    print(msg, flush=True)

def section(title):
    p(); p("=" * 60); p("  " + title); p("=" * 60)

def divider():
    p("-" * 60)


# ─── 1. DATA LOADERS ─────────────────────────────────────────────────────────

def load_drinks():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT drink_id, name, category, type, base,
                       caffeine_mg, shots, dairy_free, vegan, gluten_free,
                       COALESCE(milk_alternative_available, false) AS milk_alternative_available
                FROM drinks
                ORDER BY drink_id
            """)
            rows = cur.fetchall()
    return pd.DataFrame([dict(r) for r in rows])


def load_all_ratings():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT user_id, drink_id, star_rating AS rating,
                       mood, time_of_day, weather
                FROM ratings
                WHERE star_rating IS NOT NULL
            """)
            rows = cur.fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    p(f"  [DB] load_all_ratings → {len(df)} rows")
    return df


def load_user_ratings(user_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT drink_id, star_rating AS rating
                FROM ratings
                WHERE user_id = %s AND star_rating IS NOT NULL
            """, (user_id,))
            rows = cur.fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    p(f"  [DB] load_user_ratings({user_id}) → {len(df)} rows")
    return df


def load_user_log_counts(user_id):
    """Returns {drink_id: count} for a single user."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT drink_id, COUNT(*) AS log_count
                FROM logs
                WHERE user_id = %s
                GROUP BY drink_id
            """, (user_id,))
            rows = cur.fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    if df.empty:
        return {}
    return dict(zip(df["drink_id"], df["log_count"]))


def load_all_user_log_counts():
    """
    Returns {user_id: {drink_id: count}} for ALL users.
    Used to build the implicit signal matrix for WMF training.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT user_id, drink_id, COUNT(*) AS log_count
                FROM logs
                GROUP BY user_id, drink_id
            """)
            rows = cur.fetchall()
    result = {}
    for row in rows:
        uid  = row["user_id"]
        did  = row["drink_id"]
        cnt  = row["log_count"]
        if uid not in result:
            result[uid] = {}
        result[uid][did] = cnt
    p(f"  [DB] load_all_user_log_counts → {sum(len(v) for v in result.values())} (user,drink) pairs across {len(result)} users")
    return result


def load_user_demographics(user_id):
    """
    Loads age_range and gender for the requesting user.
    age_range is stored as a string e.g. "18-24", "<18", "25-34".
    Returns dict with keys: age_range (str|None), gender (str|None)
    """
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT age_range, gender
                    FROM users
                    WHERE user_id = %s
                """, (user_id,))
                row = cur.fetchone()
        if row:
            return {"age_range": row["age_range"], "gender": row["gender"]}
    except Exception as e:
        p(f"  [DB] load_user_demographics — could not load: {e}")
    return {"age_range": None, "gender": None}


def load_all_user_demographics():
    """
    Returns DataFrame with columns: user_id, age_range, gender
    age_range is a string e.g. "18-24", "<18", "25-34".
    Used for demographic cold-start matching.
    """
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT user_id, age_range, gender
                    FROM users
                    WHERE age_range IS NOT NULL AND gender IS NOT NULL
                """)
                rows = cur.fetchall()
        df = pd.DataFrame([dict(r) for r in rows])
        p(f"  [DB] load_all_user_demographics → {len(df)} users with age_range+gender")
        return df
    except Exception as e:
        p(f"  [DB] load_all_user_demographics — error: {e}")
        return pd.DataFrame(columns=["user_id", "age_range", "gender"])


# ─── 2. DEMOGRAPHIC COLD START ───────────────────────────────────────────────

def normalise_age_range(age_range):
    """
    Normalises age_range strings from the DB to a consistent lowercase form
    for comparison. Handles minor variations like "18-24" vs "18 - 24".
    Returns None if age_range is missing or unrecognisable.
    """
    if not age_range:
        return None
    normalised = str(age_range).strip().lower().replace(" ", "")
    return normalised if normalised else None


def demographic_cold_start(user_id, user_demographics, all_demographics_df,
                            all_ratings_df, drinks_df):
    """
    Cold-start recommendation using demographic similarity.

    Finds users in the same age band and/or gender, computes a match score,
    then returns a scored dict {drink_id: score} based on what similar
    demographic users rated highly.

    Matching logic:
      - Same age band + same gender  → similarity = 1.0 (perfect match)
      - Same age band only           → similarity = 0.6
      - Same gender only             → similarity = 0.4
      - Neither                      → excluded from the pool

    Returns ({}, reason_string) if no demographic data is available.
    """
    user_age_range = normalise_age_range(user_demographics.get("age_range"))
    user_gender    = user_demographics.get("gender", "").strip().lower() if user_demographics.get("gender") else None

    p(f"  [DEMO] User demographics: age_range='{user_age_range}', gender='{user_gender}'")

    if all_demographics_df.empty:
        p("  [DEMO] No demographic data in DB — falling back to community popular")
        return {}, "no_demographic_data"

    # Normalise the age_range and gender columns for consistent string comparison.
    all_demographics_df = all_demographics_df.copy()
    all_demographics_df["age_range"] = all_demographics_df["age_range"].apply(normalise_age_range)
    all_demographics_df["gender"]    = all_demographics_df["gender"].str.strip().str.lower()

    # Determine if this user's gender is represented in the training data.
    # If no other user shares the same gender (e.g. non-binary users when the
    # survey data only contains male/female responses), we treat gender as
    # unavailable and rely on age band alone. This avoids excluding the user
    # entirely while still producing meaningful demographic recommendations.
    genders_in_db = set(
        str(row.get("gender", "") or "").strip().lower()
        for _, row in all_demographics_df.iterrows()
    )
    gender_represented = user_gender is not None and user_gender in genders_in_db

    if user_gender is not None and not gender_represented:
        p(f"  [DEMO] Gender '{user_gender}' not found in training data — using age band only")

    # Build similarity scores for each other user
    similar_users = {}
    for _, row in all_demographics_df.iterrows():
        other_id = row["user_id"]
        if other_id == user_id:
            continue

        other_age_range = str(row.get("age_range") or "").strip().lower()
        other_gender    = str(row.get("gender", "") or "").strip().lower()

        band_match   = (user_age_range is not None and other_age_range == user_age_range)
        # Only consider gender matching if the user's gender exists in the data
        gender_match = (gender_represented and other_gender == user_gender)

        if band_match and gender_match:
            sim = 1.0
        elif band_match and not gender_represented:
            # Gender unknown or unrepresented in training data — age band is the best signal
            sim = 0.7
        elif band_match:
            # Same age range but different gender
            sim = 0.6
        elif gender_match:
            # Same gender but different age range — weakest match
            sim = 0.4
        else:
            continue  # no useful signal — exclude

        similar_users[other_id] = sim

    if not similar_users:
        p("  [DEMO] No demographically similar users found — falling back to community popular")
        return {}, "no_similar_users"

    # Log the top similar users
    top_similar = sorted(similar_users.items(), key=lambda x: x[1], reverse=True)[:10]
    p(f"  [DEMO] Found {len(similar_users)} demographically similar users")
    p(f"  [DEMO] Top {len(top_similar)} by similarity:")
    p(f"  {'User ID':<36} {'Sim':>6}")
    p(f"  {'-'*36} {'-'*6}")
    for uid, sim in top_similar:
        p(f"  {str(uid):<36} {sim:>6.2f}")

    # Aggregate ratings from similar users, weighted by similarity
    similar_user_ids = set(similar_users.keys())
    demo_ratings     = all_ratings_df[all_ratings_df["user_id"].isin(similar_user_ids)].copy()

    if demo_ratings.empty:
        p("  [DEMO] Similar users have no ratings yet — falling back to community popular")
        return {}, "similar_users_unrated"

    p(f"  [DEMO] {len(demo_ratings)} ratings found among similar users")

    raw_scores  = {}
    weight_sums = {}
    for _, row in demo_ratings.iterrows():
        did    = int(row["drink_id"])
        rating = float(row["rating"])
        sim    = similar_users.get(row["user_id"], 0.0)
        raw_scores[did]  = raw_scores.get(did, 0.0)  + rating * sim
        weight_sums[did] = weight_sums.get(did, 0.0) + sim

    avg_scores = {did: raw_scores[did] / weight_sums[did]
                  for did in raw_scores if weight_sums[did] > 0}
    max_s = max(avg_scores.values()) if avg_scores else 1.0
    norm  = {did: v / max_s for did, v in avg_scores.items()}

    p(f"  [DEMO] Scored {len(norm)} drinks from demographic signals")
    p()
    p(f"  {'Drink Name':<34} {'Demo Score':>10}")
    p(f"  {'-'*34} {'-'*10}")
    lookup = {int(row["drink_id"]): str(row["name"]) for _, row in drinks_df.iterrows()}
    for did, score in sorted(norm.items(), key=lambda x: x[1], reverse=True)[:10]:
        p(f"  {lookup.get(did, str(did)):<34} {score:>10.4f}")

    return norm, "demographic_similarity"


def community_popular_fallback(all_ratings_df, drinks_df):
    """
    Final fallback: return community average ratings as scores.
    Used only when demographic data is completely unavailable.
    """
    popular = (
        all_ratings_df.groupby("drink_id")["rating"]
        .mean().reset_index()
        .rename(columns={"rating": "avg_rating"})
    )
    scores = {
        int(r["drink_id"]): float(r["avg_rating"]) / 5.0
        for _, r in popular.iterrows()
    }
    lookup = {int(row["drink_id"]): str(row["name"]) for _, row in drinks_df.iterrows()}
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    p()
    p(f"  {'Rank':<5} {'Avg/5':>6}  {'Drink Name':<34} {'Type':<6} {'Caffeine':>8}")
    divider()
    for rank, (did, score) in enumerate(ranked, 1):
        d = drinks_df[drinks_df["drink_id"] == did]
        if d.empty:
            continue
        d = d.iloc[0]
        tag = "  <<< TOP 3" if rank <= 3 else ""
        p(f"  {rank:<5} {score:>6.4f}  {lookup.get(did, str(did)):<34} {str(d['type']):<6} {int(d['caffeine_mg']):>6}mg{tag}")
    return scores


# ─── 3. CONTENT-BASED ────────────────────────────────────────────────────────

def build_feature_matrix(drinks_df):
    df               = drinks_df.copy()
    category_dummies = pd.get_dummies(df["category"], prefix="cat")
    type_dummies     = pd.get_dummies(df["type"],     prefix="temp")
    base_dummies     = pd.get_dummies(df["base"],     prefix="base")
    binary           = df[["dairy_free", "vegan", "gluten_free"]].astype(int)
    numerical        = df[["caffeine_mg", "shots"]].copy()
    scaler           = MinMaxScaler()
    numerical_scaled = pd.DataFrame(
        scaler.fit_transform(numerical),
        columns=["caffeine_mg_scaled", "shots_scaled"]
    )
    numerical_scaled = numerical_scaled.fillna(0.0)
    feature_matrix = pd.concat(
        [category_dummies, type_dummies, base_dummies, binary, numerical_scaled],
        axis=1
    )
    return feature_matrix.values.astype(np.float64), scaler


def content_based_scores(user_ratings_df, drinks_df, feature_matrix):
    liked = user_ratings_df[user_ratings_df["rating"] >= 4]["drink_id"].tolist()
    if not liked:
        liked = user_ratings_df["drink_id"].tolist()
    if not liked:
        return {}

    drinks_reset = drinks_df.reset_index(drop=True)
    id_to_pos    = {int(row["drink_id"]): pos for pos, row in drinks_reset.iterrows()}
    scores       = {}

    for pos, row in drinks_reset.iterrows():
        drink_id     = int(row["drink_id"])
        sim_total    = 0.0
        weight_total = 0.0
        for liked_id in liked:
            liked_pos = id_to_pos.get(int(liked_id))
            if liked_pos is None:
                continue
            rating_rows = user_ratings_df[user_ratings_df["drink_id"] == liked_id]["rating"].values
            if len(rating_rows) == 0:
                continue
            user_rating  = float(rating_rows[0])
            weight       = user_rating / 5.0
            sim          = cosine_similarity(
                feature_matrix[pos].reshape(1, -1),
                feature_matrix[liked_pos].reshape(1, -1)
            )[0][0]
            sim_total    += sim * weight
            weight_total += weight
        scores[drink_id] = sim_total / weight_total if weight_total > 0 else 0.0
    return scores


# ─── 4. WEIGHTED MATRIX FACTORISATION (WMF) WITH IMPLICIT SIGNALS ────────────

def build_combined_matrix(all_ratings_df, all_log_counts):
    """
    Combines explicit ratings and implicit log-frequency signals.

    Three cases:

    Case 1 - Unrated, logged multiple times:
      User keeps drinking it but never rated it — positive implicit signal.
      preference  = min(count / 10.0, 1.0)
      confidence  = 1 + ALPHA * count

    Case 2 - Rated >= 4 stars AND logged multiple times:
      Both signals agree — user explicitly likes it and keeps coming back.
      We reinforce confidence of the explicit rating with log frequency.
      preference  = star / 5.0  (explicit stays as-is)
      confidence  = (1 + ALPHA * 5) + ALPHA * count

    Case 3 - Rated 1, 2, or 3 stars AND logged multiple times:
      Low/mediocre rating. User may log out of habit or availability.
      Do NOT reinforce — explicit star rating is the more reliable signal.
      preference  = star / 5.0
      confidence  = 1 + ALPHA * 5  (standard, no boost)

    Returns:
      pref_df        — DataFrame(user_id, drink_id, rating)
      confidence_map — dict {(user_id, drink_id): confidence_weight}
    """
    rows           = []
    confidence_map = {}

    # Build a lookup: (user_id, drink_id) -> star_rating
    rated_lookup = {}
    for _, r in all_ratings_df.iterrows():
        rated_lookup[(r["user_id"], int(r["drink_id"]))] = float(r["rating"])

    # Step 1: Add all explicit ratings with base confidence
    for _, r in all_ratings_df.iterrows():
        uid, did = r["user_id"], int(r["drink_id"])
        pref = float(r["rating"]) / 5.0
        rows.append({"user_id": uid, "drink_id": did, "rating": pref})
        confidence_map[(uid, did)] = 1 + ALPHA * 5

    # Step 2: Process log counts with three-way logic
    implicit_unrated = 0
    implicit_boosted = 0
    implicit_ignored = 0

    for uid, counts in all_log_counts.items():
        for did, cnt in counts.items():
            did  = int(did)
            pair = (uid, did)
            star = rated_lookup.get(pair)

            if star is None:
                # Case 1: unrated but logged — implicit positive signal
                pref = min(cnt / 10.0, 1.0)
                rows.append({"user_id": uid, "drink_id": did, "rating": pref})
                confidence_map[pair] = 1 + ALPHA * cnt
                implicit_unrated += 1

            elif star >= 4.0:
                # Case 2: liked (4-5 stars) and logged frequently — reinforce
                existing_conf = confidence_map.get(pair, 1 + ALPHA * 5)
                confidence_map[pair] = existing_conf + ALPHA * cnt
                implicit_boosted += 1

            else:
                # Case 3: rated <= 3 stars — low rating dominates, ignore log count
                implicit_ignored += 1

    p(f"  [WMF] Implicit signal breakdown:")
    p(f"         Unrated + logged           : {implicit_unrated} rows added")
    p(f"         Rated >= 4 stars + logged  : {implicit_boosted} confidence boosts applied")
    p(f"         Rated <= 3 stars + logged  : {implicit_ignored} ignored (low rating dominates)")
    p(f"  [WMF] Combined matrix: {len(all_ratings_df)} explicit + {implicit_unrated} implicit rows = {len(rows)} total")

    pref_df = pd.DataFrame(rows)
    return pref_df, confidence_map


def build_confidence_matrix(confidence_map, user_map, drink_map, num_users, num_drinks):
    """
    Converts the confidence dict into a dense numpy matrix C[u, i] for gradient weighting.
    Unobserved (u,i) pairs default to 1.0 (uniform low confidence).
    """
    C = np.ones((num_users, num_drinks))
    for (uid, did), conf in confidence_map.items():
        u_idx = user_map.get(uid)
        d_idx = drink_map.get(did)
        if u_idx is not None and d_idx is not None:
            C[u_idx, d_idx] = conf
    return C


def proc_col(col):
    uniq     = col.unique()
    name2idx = {o: i for i, o in enumerate(uniq)}
    return name2idx, np.array([name2idx[x] for x in col]), len(uniq)


def create_embeddings(n, K):
    np.random.seed(3)
    return 6 * np.random.random((n, K)) / K


def df2matrix(df, nrows, ncols, col="rating"):
    return sparse.csc_matrix(
        (df[col].values, (df["user_enc"].values, df["drink_enc"].values)),
        shape=(nrows, ncols)
    )


def gradient(df, Y, emb_user, emb_item, conf_matrix=None):
    """
    Computes gradients for matrix factorisation.
    If conf_matrix is provided, each cell's gradient is weighted by c_ui,
    so high-confidence (explicit/frequently-logged) signals dominate training.
    This is the core of Weighted Matrix Factorisation (WMF).
    """
    Y_dense = np.array(Y.todense())
    mask    = (Y_dense != 0).astype(float)

    if conf_matrix is not None:
        # Weight gradient by confidence — WMF core step
        weighted_mask = mask * conf_matrix
        N = weighted_mask.sum()
        if N == 0:
            return np.zeros_like(emb_user), np.zeros_like(emb_item)
        pred_u = (emb_user @ emb_item.T) * mask
        pred_i = (emb_item @ emb_user.T).T * mask
        grad_u = -2 / N * ((Y_dense - pred_u) * weighted_mask @ emb_item)
        grad_i = -2 / N * (((Y_dense - pred_i) * weighted_mask).T @ emb_user)
    else:
        N = mask.sum()
        if N == 0:
            return np.zeros_like(emb_user), np.zeros_like(emb_item)
        pred_u = (emb_user @ emb_item.T) * mask
        pred_i = (emb_item @ emb_user.T).T * mask
        grad_u = -2 / N * ((Y_dense - pred_u) @ emb_item)
        grad_i = -2 / N * ((Y_dense - pred_i).T @ emb_user)

    return grad_u, grad_i


def train_mf(df_enc, num_users, num_drinks, K=5, iterations=300, lr=0.05, conf_matrix=None):
    """
    Trains matrix factorisation embeddings.
    When conf_matrix is provided, trains as Weighted MF (WMF):
    high-confidence cells (explicit ratings, frequently-logged drinks) exert
    stronger gradient pull, baking implicit signals into the learned embeddings.
    """
    emb_user = create_embeddings(num_users, K)
    emb_item = create_embeddings(num_drinks, K)
    Y        = df2matrix(df_enc, num_users, num_drinks)
    v_u      = np.zeros_like(emb_user)
    v_i      = np.zeros_like(emb_item)

    for _ in range(iterations):
        gu, gi   = gradient(df_enc, Y, emb_user, emb_item, conf_matrix)
        v_u      = 0.9 * v_u + 0.1 * gu
        v_i      = 0.9 * v_i + 0.1 * gi
        emb_user -= lr * v_u
        emb_item -= lr * v_i

    return emb_user, emb_item


def collaborative_scores(user_id, all_ratings_df, all_log_counts, drinks_df):
    """
    Runs Weighted Matrix Factorisation (WMF) combining explicit ratings and
    implicit log-frequency signals.

    Returns (scores_dict, emb_user, user_map) for reuse in contextual scoring.
    Returns ({}, None, None) when there are insufficient ratings.
    """
    user_count = (all_ratings_df["user_id"] == user_id).sum()
    if user_count < 5:
        p(f"  [CF] User has {user_count} ratings — minimum 5 required for collaborative filtering")
        return {}, None, None

    divider()
    p(f"  [WMF] Building combined matrix (explicit ratings + implicit log signals)...")

    # Build combined preference + confidence matrices
    pref_df, confidence_map = build_combined_matrix(all_ratings_df, all_log_counts)

    # Encode users and drinks
    user_map,  user_enc,  num_users  = proc_col(pref_df["user_id"])
    drink_map, drink_enc, num_drinks = proc_col(pref_df["drink_id"])
    pref_df = pref_df.copy()
    pref_df["user_enc"]  = [user_map[u] for u in pref_df["user_id"]]
    pref_df["drink_enc"] = [drink_map[d] for d in pref_df["drink_id"]]
    pref_df["rating"]    = pref_df["rating"].astype(float)

    if user_id not in user_map:
        p(f"  [WMF] User {user_id} not in combined matrix — no collaborative score")
        return {}, None, None

    # Build confidence matrix for WMF
    conf_matrix = build_confidence_matrix(confidence_map, user_map, drink_map, num_users, num_drinks)

    p(f"  [WMF] Matrix dimensions: {num_users} users × {num_drinks} drinks")
    p(f"  [WMF] Confidence range: {conf_matrix.min():.1f} – {conf_matrix.max():.1f}")
    p(f"  [WMF] Training WMF embeddings (K=5, iterations=300)...")

    emb_user, emb_item = train_mf(
        pref_df, num_users, num_drinks, conf_matrix=conf_matrix
    )

    p(f"  [WMF] Training complete")

    user_idx   = user_map[user_id]
    user_vec   = emb_user[user_idx]
    raw_scores = np.dot(user_vec, emb_item.T)

    idx2drink    = {v: k for k, v in drink_map.items()}
    min_s, max_s = raw_scores.min(), raw_scores.max()
    rng          = max_s - min_s if max_s != min_s else 1.0

    scores = {}
    for idx, drink_id in idx2drink.items():
        scores[drink_id] = (raw_scores[idx] - min_s) / rng

    return scores, emb_user, user_map


# ─── 5. HYBRID MERGE ─────────────────────────────────────────────────────────

CONTENT_WEIGHT = 0.70
COLLAB_WEIGHT  = 0.30

def hybrid_scores(cb_scores, cf_scores, rated_drink_ids, drinks_df):
    """
    Merges content-based and collaborative scores.
    Note: the IMPLICIT_CAP additive boost has been removed — implicit signals
    are now baked into the WMF embeddings directly, so boosting here would
    double-count log frequency.
    """
    all_drink_ids = drinks_df["drink_id"].tolist()
    final = {}
    for drink_id in all_drink_ids:
        if drink_id in rated_drink_ids:
            continue
        cb = cb_scores.get(drink_id, 0.0)
        cf = cf_scores.get(drink_id, 0.0)
        if not cf_scores:
            final[drink_id] = cb
        else:
            final[drink_id] = CONTENT_WEIGHT * cb + COLLAB_WEIGHT * cf
    return final


# ─── 6. DIETARY FILTER ───────────────────────────────────────────────────────

NUT_DRINKS = {
    "almond milk latte", "almond milk americano", "almond milk cappuccino",
    "hazelnut latte",
}

def apply_dietary_filter(scores, drinks_df, dietary_restrictions):
    if not dietary_restrictions:
        return scores, []

    drink_info   = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
    restrictions = [r.lower().strip() for r in dietary_restrictions]
    filtered     = {}
    removed      = []

    for drink_id, score in scores.items():
        d = drink_info.get(int(drink_id))
        if d is None:
            filtered[drink_id] = score
            continue

        name_lower = str(d["name"]).lower()
        fail       = None

        if "dairy-free" in restrictions and not bool(d["dairy_free"]):
            fail = "not dairy-free"
        elif "vegan" in restrictions and not bool(d["vegan"]):
            fail = "not vegan"
        elif "gluten-free" in restrictions and not bool(d["gluten_free"]):
            fail = "not gluten-free"
        elif "nut allergy" in restrictions and name_lower in NUT_DRINKS:
            fail = "contains nuts"

        if fail:
            removed.append((str(d["name"]), fail))
        else:
            filtered[drink_id] = score

    return filtered, removed


# ─── 7. CONTEXTUAL SCORING ───────────────────────────────────────────────────

CONTEXTUAL_BOOST_CAP = 0.25
SIMILAR_USER_K       = 20

def contextual_scores(user_id, all_ratings_df, drinks_df, emb_user, user_map,
                      mood, time_of_day):
    if user_id not in user_map:
        return {}

    mood_lower = mood.lower().strip() if mood else ""
    time_lower = time_of_day.lower().strip() if time_of_day else ""

    user_idx   = user_map[user_id]
    user_vec   = emb_user[user_idx]
    all_vecs   = emb_user
    norms      = np.linalg.norm(all_vecs, axis=1, keepdims=True)
    norms      = np.where(norms == 0, 1e-9, norms)
    sim_matrix = (all_vecs @ user_vec) / (norms.squeeze() * (np.linalg.norm(user_vec) or 1e-9))
    sim_matrix[user_idx] = -1.0

    top_k_idxs       = np.argsort(sim_matrix)[::-1][:SIMILAR_USER_K]
    idx2user         = {v: k for k, v in user_map.items()}
    similar_user_ids = [idx2user[i] for i in top_k_idxs if i in idx2user]
    similar_sims     = {idx2user[i]: float(sim_matrix[i]) for i in top_k_idxs if i in idx2user}

    ctx_df = all_ratings_df[all_ratings_df["user_id"].isin(similar_user_ids)].copy()
    if ctx_df.empty:
        return {}

    mood_mask = pd.Series([True] * len(ctx_df), index=ctx_df.index)
    if mood_lower:
        mood_mask = ctx_df["mood"].str.lower().str.startswith(mood_lower[:20], na=False)

    time_mask = pd.Series([True] * len(ctx_df), index=ctx_df.index)
    if time_lower:
        time_mask = ctx_df["time_of_day"].str.lower().str.strip() == time_lower

    ctx_df = ctx_df[mood_mask & time_mask]
    if ctx_df.empty:
        ctx_df = all_ratings_df[all_ratings_df["user_id"].isin(similar_user_ids)].copy()
        if mood_lower:
            ctx_df = ctx_df[ctx_df["mood"].str.lower().str.startswith(mood_lower[:20], na=False)]

    if ctx_df.empty:
        return {}

    raw_scores = {}
    weight_sum = {}
    for _, row in ctx_df.iterrows():
        did    = int(row["drink_id"])
        rating = float(row["rating"])
        sim    = similar_sims.get(str(row["user_id"]), 0.5)
        sim    = max(sim, 0.0)
        raw_scores[did] = raw_scores.get(did, 0.0) + rating * sim
        weight_sum[did] = weight_sum.get(did, 0.0) + sim

    if not raw_scores:
        return {}

    avg_scores = {did: raw_scores[did] / max(weight_sum[did], 1e-9) for did in raw_scores}
    max_s = max(avg_scores.values())
    if max_s == 0:
        return {}
    return {did: v / max_s for did, v in avg_scores.items()}


def apply_contextual_boost(scores, ctx_scores):
    boosted = {}
    for drink_id, score in scores.items():
        ctx   = ctx_scores.get(int(drink_id), 0.0)
        boost = ctx * CONTEXTUAL_BOOST_CAP
        boosted[drink_id] = score * (1 + boost)
    return boosted


# ─── 8. WEATHER FILTER ───────────────────────────────────────────────────────

WEATHER_BOOST = 0.30

def apply_weather_filter(scores, drinks_df, weather):
    if not weather:
        return scores, []

    drink_info    = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
    weather_lower = weather.lower().strip()

    if weather_lower == "cold":
        boost_type = "hot"
    elif weather_lower in ("hot/warm", "hot", "warm"):
        boost_type = "iced"
    else:
        return scores, []

    boosted     = {}
    boosted_log = []
    for drink_id, score in scores.items():
        d = drink_info.get(int(drink_id))
        if d is None:
            boosted[drink_id] = score
            continue
        drink_type = str(d["type"]).lower()
        if drink_type == boost_type:
            new_score = score * (1 + WEATHER_BOOST)
            boosted[drink_id] = new_score
            boosted_log.append((str(d["name"]), drink_type, score, new_score))
        else:
            boosted[drink_id] = score
    return boosted, boosted_log


# ─── 9. WIND-DOWN BOOST ──────────────────────────────────────────────────────

WINDDOWN_BOOST              = 0.30
WINDDOWN_MOODS              = {"relaxed and winding down"}
WINDDOWN_TIMES              = {"evening", "night"}
WINDDOWN_CAFFEINE_THRESHOLD = 10

def apply_winddown_boost(scores, drinks_df, mood, time_of_day):
    mood_lower = (mood or "").lower().strip()
    time_lower = (time_of_day or "").lower().strip()
    mood_match = mood_lower in WINDDOWN_MOODS
    time_match = time_lower in WINDDOWN_TIMES

    if not mood_match and not time_match:
        return scores, []

    drink_info  = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
    boosted     = {}
    boosted_log = []

    for drink_id, score in scores.items():
        d = drink_info.get(int(drink_id))
        if d is None:
            boosted[drink_id] = score
            continue
        caffeine = int(d["caffeine_mg"])
        if caffeine <= WINDDOWN_CAFFEINE_THRESHOLD:
            new_score = score * (1 + WINDDOWN_BOOST)
            boosted[drink_id] = new_score
            boosted_log.append((str(d["name"]), caffeine, score, new_score))
        else:
            boosted[drink_id] = score

    return boosted, boosted_log


# ─── 10. TERMINAL OUTPUT ─────────────────────────────────────────────────────

def print_all_drinks_ranked(final_scores, drinks_df, cb_scores, cf_scores,
                             rated_ids, mode):
    lookup = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
    ranked = sorted(final_scores.items(), key=lambda x: x[1], reverse=True)

    p()
    p("  FULL RANKED LIST — all drinks scored by hybrid recommender")
    p(f"  Mode: {mode}  |  Rated/skipped by this user: {len(rated_ids)}")
    p()
    p(f"  {'Rank':<5} {'Score':>7}  {'CB':>6}  {'CF':>6}  {'Drink Name':<34} {'Type':<6} {'Caffeine':>8}")
    divider()

    for rank, (did, score) in enumerate(ranked, 1):
        d = lookup.get(did)
        if d is None:
            continue
        cb  = cb_scores.get(did, 0.0)
        cf  = cf_scores.get(did, 0.0)
        tag = "  <<< TOP 3" if rank <= 3 else ""
        p(
            f"  {rank:<5} {score:>7.4f}  {cb:>6.4f}  {cf:>6.4f}  "
            f"{str(d['name']):<34} {str(d['type']):<6} {int(d['caffeine_mg']):>6}mg{tag}"
        )

    if rated_ids:
        p()
        p(f"  Skipped (already rated by this user): {len(rated_ids)} drinks")


def print_top3(recs):
    p()
    p("  *** TOP 3 RECOMMENDATIONS ***")
    for i, r in enumerate(recs, 1):
        p()
        p(f"  #{i}  {r['name']}")
        p(f"      {r['category']}  |  {r['type']}  |  {r['caffeine_mg']}mg caffeine")
        p(f"      Match: {r['match_percent']}%   "
          f"(content={r['score_breakdown']['content']:.4f}  "
          f"collab={r['score_breakdown']['collaborative']:.4f})")
    p()


# ─── 11. RESPONSE BUILDER ────────────────────────────────────────────────────

def build_response(top3, drinks_df, cb_scores, cf_scores, mode=None,
                   num_user_ratings=0, demo_method=None):
    recs        = []
    drink_lookup = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
    scores_only  = [s for _, s in top3]
    max_s        = max(scores_only) if scores_only else 1.0

    for drink_id, score in top3:
        drink_id = int(drink_id)
        d = drink_lookup.get(drink_id)
        if d is None:
            continue
        recs.append({
            "drink_id":      drink_id,
            "name":          str(d["name"]),
            "category":      str(d["category"]),
            "type":          str(d["type"]),
            "caffeine_mg":   int(d["caffeine_mg"]),
            "dairy_free":    bool(d["dairy_free"]),
            "vegan":         bool(d["vegan"]),
            "gluten_free":   bool(d["gluten_free"]),
            "score":         round(float(score), 4),
            "match_percent": min(round((score / max_s) * 100), 100),
            "score_breakdown": {
                "content":       round(float(cb_scores.get(drink_id, 0)), 4),
                "collaborative": round(float(cf_scores.get(drink_id, 0)), 4),
            },
            # Frontend uses these to show the accuracy warning message
            "num_user_ratings": num_user_ratings,
            "recommendation_mode": mode or "unknown",
        })
    return recs


# ─── 12. RECOMMEND ENDPOINT ──────────────────────────────────────────────────

@app.route("/recommend", methods=["POST"])
def recommend():
    data    = request.get_json()
    user_id = data.get("user_id")

    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    try:
        section("AROMA RECOMMENDER — REQUEST RECEIVED")
        p(f"  user_id    : {user_id}")
        p(f"  explore_new: {data.get('explore_new')}")

        drinks_df       = load_drinks()
        all_ratings_df  = load_all_ratings()
        user_ratings_df = load_user_ratings(user_id)
        log_counts      = load_user_log_counts(user_id)
        all_log_counts  = load_all_user_log_counts()

        divider()
        p(f"  Drinks in catalogue : {len(drinks_df)}")
        p(f"  Total ratings in DB : {len(all_ratings_df)}")
        p(f"  This user's ratings : {len(user_ratings_df)}")
        p(f"  This user's logs    : {sum(log_counts.values()) if log_counts else 0}")

        num_ratings = len(user_ratings_df)
        MIN_RATINGS_FOR_HYBRID = 5

        # ─── COLD START (0 ratings) — demographic similarity ──────────────
        if user_ratings_df.empty:
            divider()
            p("  MODE: COLD START — 0 ratings")
            p("  Strategy: demographic similarity (age band + gender)")
            p("  This justifies collection of age/gender data per GDPR guidelines.")
            p()

            user_demographics  = load_user_demographics(user_id)
            all_demographics   = load_all_user_demographics()

            demo_scores, demo_method = demographic_cold_start(
                user_id, user_demographics, all_demographics,
                all_ratings_df, drinks_df
            )

            if not demo_scores:
                p("  Demographic cold start produced no scores — using community popular fallback")
                demo_scores = community_popular_fallback(all_ratings_df, drinks_df)
                demo_method = "community_popular"
            else:
                p(f"  Demographic cold start method: {demo_method}")

            # Apply dietary filter
            dietary_restrictions = data.get("dietary_restrictions", [])
            if dietary_restrictions:
                demo_scores, removed = apply_dietary_filter(demo_scores, drinks_df, dietary_restrictions)
                p(f"  Dietary filter removed {len(removed)} drinks")

            top3 = sorted(demo_scores.items(), key=lambda x: x[1], reverse=True)[:3]
            recs = build_response(top3, drinks_df, {}, {}, mode="cold_start",
                                  num_user_ratings=0, demo_method=demo_method)
            print_top3(recs)
            return jsonify({
                "recommendations": recs,
                "mode": "cold_start",
                "demo_method": demo_method,
                "num_user_ratings": 0,
            })

        # ─── Determine explore mode ────────────────────────────────────────
        explore_new   = bool(data.get("explore_new", False))
        all_tried_ids = set(int(x) for x in user_ratings_df["drink_id"].tolist())
        rated_ids     = all_tried_ids if explore_new else set()

        divider()
        p(f"  explore_new  = {explore_new}")
        p(f"  Already rated by this user: {len(all_tried_ids)} drinks")
        if explore_new:
            p(f"  EXPLORE NEW: {len(all_tried_ids)} already-rated drinks excluded from results")
        else:
            p(f"  INCLUDE TRIED: full catalogue will be scored")

        name_lookup = {row["drink_id"]: row["name"] for _, row in drinks_df.iterrows()}

        if num_ratings < MIN_RATINGS_FOR_HYBRID:
            p(f"  *** MODE: WARM START ({num_ratings} rating(s)) ***")
            p(f"  Using: content-based + demographic boost | need {MIN_RATINGS_FOR_HYBRID} for WMF hybrid")
        else:
            p(f"  *** MODE: FULL HYBRID ({num_ratings} ratings) ***")
            p(f"  Using: content-based (70%) + WMF collaborative (30%) with implicit signals")

        divider()
        p(f"  This user's rated drinks ({num_ratings}):")
        for _, r in user_ratings_df.iterrows():
            stars = "*" * int(r["rating"])
            p(f"    [{stars:<5}] {name_lookup.get(r['drink_id'], r['drink_id'])}")

        # ─── Step 1: Content-based (always runs for warm + full hybrid) ───
        feature_matrix, _ = build_feature_matrix(drinks_df)
        cb = content_based_scores(user_ratings_df, drinks_df, feature_matrix)

        divider()
        p(f"  [STEP 1] CONTENT-BASED SCORES")
        p(f"  {'Drink Name':<34} {'CB Score':>10}")
        p(f"  {'-'*34} {'-'*10}")
        for did, score in sorted(cb.items(), key=lambda x: x[1], reverse=True):
            p(f"  {str(name_lookup.get(did, str(did))):<34} {score:>10.4f}")

        # ─── Step 2: WMF Collaborative (5+ ratings only) ──────────────────
        divider()
        if num_ratings >= MIN_RATINGS_FOR_HYBRID:
            cf, emb_user, cf_user_map = collaborative_scores(
                user_id, all_ratings_df, all_log_counts, drinks_df
            )
            if cf:
                p(f"  [STEP 2] WMF COLLABORATIVE SCORES")
                p(f"  (trained on {len(all_ratings_df)} explicit ratings + implicit log signals)")
                p()
                p(f"  {'Drink Name':<34} {'CF Score':>10}")
                p(f"  {'-'*34} {'-'*10}")
                for did, score in sorted(cf.items(), key=lambda x: x[1], reverse=True)[:15]:
                    p(f"  {str(name_lookup.get(did, str(did))):<34} {score:>10.4f}")
            else:
                p(f"  [STEP 2] WMF COLLABORATIVE — returned empty, falling back to CB only")
        else:
            cf, emb_user, cf_user_map = {}, None, None
            p(f"  [STEP 2] WMF COLLABORATIVE SKIPPED — warm start ({num_ratings} < {MIN_RATINGS_FOR_HYBRID} ratings)")

            # Warm start: add demographic boost to CB scores
            p(f"  [STEP 2b] DEMOGRAPHIC BOOST for warm start user")
            user_demographics = load_user_demographics(user_id)
            all_demographics  = load_all_user_demographics()
            p(f"  [DEMO] Warm start demographics: age_range={user_demographics.get('age_range')}, gender={user_demographics.get('gender')}")
            demo_scores, demo_method = demographic_cold_start(
                user_id, user_demographics, all_demographics,
                all_ratings_df, drinks_df
            )
            if demo_scores:
                p(f"  Blending CB (80%) + demographic signals (20%) for warm start")
                blended = {}
                all_ids = set(cb.keys()) | set(demo_scores.keys())
                for did in all_ids:
                    if did in rated_ids:
                        continue
                    blended[did] = 0.80 * cb.get(did, 0.0) + 0.20 * demo_scores.get(did, 0.0)
                cb = blended
                p(f"  Blended scores computed for {len(cb)} drinks")
            else:
                p(f"  No demographic data available for warm start boost")

        # ─── Step 3: Merge scores ─────────────────────────────────────────
        divider()
        if cf:
            mode   = "hybrid_wmf"
            scores = hybrid_scores(cb, cf, rated_ids, drinks_df)
            p(f"  [STEP 3] HYBRID MERGE  (CB {int(CONTENT_WEIGHT*100)}% + WMF-CF {int(COLLAB_WEIGHT*100)}%)")
            p(f"  Note: implicit boost cap removed — implicit signals baked into WMF embeddings")
        else:
            mode   = "content_only"
            scores = {did: score for did, score in cb.items() if did not in rated_ids}
            p(f"  [STEP 3] CONTENT-ONLY MERGE")

        p(f"  Final scored candidates: {len(scores)}")
        print_all_drinks_ranked(scores, drinks_df, cb, cf, rated_ids, mode)

        # ─── Step 4: Contextual boost ─────────────────────────────────────
        mood              = data.get("mood", "")
        time_of_day       = data.get("time_of_day", "")
        weather           = data.get("weather", "")
        dietary_restrictions = data.get("dietary_restrictions", [])

        divider()
        if mood or time_of_day:
            p(f"  [STEP 4] CONTEXTUAL BOOST  mood='{mood}'  time='{time_of_day}'")
            if emb_user is not None:
                p(f"  Method: similar-user signals (WMF embeddings available)")
                ctx = contextual_scores(
                    user_id, all_ratings_df, drinks_df,
                    emb_user, cf_user_map, mood, time_of_day
                )
            else:
                p(f"  Method: community-wide signals (warm start — no WMF embeddings)")
                ctx_df = all_ratings_df.copy()
                mood_lower = (mood or "").lower().strip()
                time_lower = (time_of_day or "").lower().strip()
                if mood_lower:
                    ctx_df = ctx_df[ctx_df["mood"].str.lower().str.startswith(mood_lower[:20], na=False)]
                if time_lower:
                    ctx_df = ctx_df[ctx_df["time_of_day"].str.lower().str.strip() == time_lower]
                if ctx_df.empty and mood_lower:
                    ctx_df = all_ratings_df[all_ratings_df["mood"].str.lower().str.startswith(mood_lower[:20], na=False)]
                if not ctx_df.empty:
                    raw    = ctx_df.groupby("drink_id")["rating"].mean().to_dict()
                    max_r  = max(raw.values()) if raw else 1.0
                    ctx    = {int(k): v / max_r for k, v in raw.items()}
                else:
                    ctx = {}

            if ctx:
                p(f"  Context signal found for {len(ctx)} drinks")
                scores = apply_contextual_boost(scores, ctx)
                p(f"  Contextual boost applied")
            else:
                p(f"  No context signal found — skipping")
        else:
            p(f"  [STEP 4] CONTEXTUAL BOOST skipped — no mood/time provided")

        # ─── Step 5: Weather filter ───────────────────────────────────────
        divider()
        if weather:
            p(f"  [STEP 5] WEATHER BOOST  weather='{weather}'")
            scores, w_boosted = apply_weather_filter(scores, drinks_df, weather)
            if w_boosted:
                p(f"  Boosted {len(w_boosted)} drink(s) by +{int(WEATHER_BOOST*100)}%")
            else:
                p(f"  No matching drinks found for weather type")
        else:
            p(f"  [STEP 5] WEATHER BOOST skipped")

        # ─── Step 5b: Wind-down boost ─────────────────────────────────────
        divider()
        mood_lower_check = (mood or "").lower().strip()
        time_lower_check = (time_of_day or "").lower().strip()
        if mood_lower_check in WINDDOWN_MOODS or time_lower_check in WINDDOWN_TIMES:
            p(f"  [STEP 5b] WIND-DOWN BOOST  mood='{mood}'  time='{time_of_day}'")
            scores, wd_boosted = apply_winddown_boost(scores, drinks_df, mood, time_of_day)
            if wd_boosted:
                p(f"  Boosted {len(wd_boosted)} low-caffeine drinks by +{int(WINDDOWN_BOOST*100)}%")
        else:
            p(f"  [STEP 5b] WIND-DOWN BOOST skipped")

        # ─── Step 6: Dietary filter ───────────────────────────────────────
        divider()
        if dietary_restrictions:
            p(f"  [STEP 6] DIETARY FILTER  restrictions={dietary_restrictions}")
            scores, d_removed = apply_dietary_filter(scores, drinks_df, dietary_restrictions)
            p(f"  Removed {len(d_removed)} drink(s) — {len(scores)} remaining")
        else:
            p(f"  [STEP 6] DIETARY FILTER skipped")

        top3 = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:3]
        recs = build_response(top3, drinks_df, cb, cf, mode=mode,
                              num_user_ratings=num_ratings)
        print_top3(recs)

        return jsonify({
            "recommendations": recs,
            "mode": mode,
            "num_user_ratings": num_ratings,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ─── TRACK CLICK ─────────────────────────────────────────────────────────────

@app.route("/track_click", methods=["POST"])
def track_click():
    data     = request.get_json()
    user_id  = data.get("user_id")
    drink_id = data.get("drink_id")
    if not user_id or not drink_id:
        return jsonify({"error": "user_id and drink_id required"}), 400
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO logs (user_id, drink_id, caffeine_amount, timestamp)
                    VALUES (%s, %s, 0, NOW())
                """, (user_id, drink_id))
            conn.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    p("[health] ping")
    return jsonify({"status": "ok", "service": "Aroma Recommender"})


# ─── STARTUP ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    section("Aroma Recommendation Engine - Starting")
    p("  Listening on http://localhost:5001")
    p("  Features active:")
    p("    - Demographic cold start (age band + gender similarity)")
    p("    - Weighted Matrix Factorisation with implicit log signals")
    p("    - Content-based + collaborative hybrid (70/30)")
    p("    - Contextual boost (mood + time of day)")
    p("    - Weather and wind-down boosts")
    p("    - Dietary hard filter")
    p()
    p("  Waiting for requests...")
    app.run(host="0.0.0.0", port=5001, debug=False)