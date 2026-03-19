"""
Aroma Hybrid Recommendation Engine
====================================
Pipeline:
  1. Content-Based Score  (70%) - cosine similarity on drink features
  2. Collaborative Score  (30%) - matrix factorisation
  3. Implicit Boost       - log frequency nudge
  NO contextual filtering - scores go straight to top-3

Prints full terminal log + all 50 drinks ranked on every request.
"""

import os
import sys

# Force stdout/stderr to flush immediately — must be before any prints
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

def get_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)


#TERMINAL HELPERS

def p(msg=""):
    print(msg, flush=True)

def section(title):
    p(); p("=" * 60); p("  " + title); p("=" * 60)

def divider():
    p("-" * 60)


#1. DATA LOADERS

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
            # Try star_rating first (app column name), fall back to rating
            try:
                cur.execute("""
                    SELECT user_id, drink_id, star_rating AS rating,
                           mood, time_of_day, weather
                    FROM ratings
                    WHERE star_rating IS NOT NULL
                """)
            except Exception:
                cur.execute("""
                    SELECT user_id, drink_id, rating,
                           mood, time_of_day, weather
                    FROM ratings
                    WHERE rating IS NOT NULL
                """)
            rows = cur.fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    p(f"  [DB] load_all_ratings → {len(df)} rows")
    return df


def load_user_ratings(user_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("""
                    SELECT drink_id, star_rating AS rating
                    FROM ratings
                    WHERE user_id = %s AND star_rating IS NOT NULL
                """, (user_id,))
            except Exception:
                cur.execute("""
                    SELECT drink_id, rating
                    FROM ratings
                    WHERE user_id = %s AND rating IS NOT NULL
                """, (user_id,))
            rows = cur.fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    p(f"  [DB] load_user_ratings({user_id}) → {len(df)} rows")
    return df


def load_user_log_counts(user_id):
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


# 2. CONTENT-BASED

def build_feature_matrix(drinks_df):
    df = drinks_df.copy()
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
    feature_matrix = pd.concat(
        [category_dummies, type_dummies, base_dummies, binary, numerical_scaled],
        axis=1
    )
    return feature_matrix.values, scaler


def content_based_scores(user_ratings_df, drinks_df, feature_matrix):
    liked = user_ratings_df[user_ratings_df["rating"] >= 4]["drink_id"].tolist()
    if not liked:
        liked = user_ratings_df["drink_id"].tolist()
    if not liked:
        return {}

    # Reset index so positional row numbers match numpy array indices
    drinks_reset = drinks_df.reset_index(drop=True)

    # Build a map: drink_id -> positional index in feature_matrix
    id_to_pos = {int(row["drink_id"]): pos for pos, row in drinks_reset.iterrows()}

    scores = {}
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



#3. COLLABORATIVE FILTERING

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


def gradient(df, Y, emb_user, emb_item):
    Y_dense = np.array(Y.todense())
    mask    = (Y_dense != 0).astype(float)
    N       = mask.sum()
    if N == 0:
        return np.zeros_like(emb_user), np.zeros_like(emb_item)
    pred_u  = (emb_user @ emb_item.T) * mask
    pred_i  = (emb_item @ emb_user.T).T * mask
    grad_u  = -2 / N * ((Y_dense - pred_u) @ emb_item)
    grad_i  = -2 / N * ((Y_dense - pred_i).T @ emb_user)
    return grad_u, grad_i


def train_mf(df_enc, num_users, num_drinks, K=5, iterations=300, lr=0.05):
    emb_user = create_embeddings(num_users, K)
    emb_item = create_embeddings(num_drinks, K)
    Y        = df2matrix(df_enc, num_users, num_drinks)
    v_u      = np.zeros_like(emb_user)
    v_i      = np.zeros_like(emb_item)
    for _ in range(iterations):
        gu, gi   = gradient(df_enc, Y, emb_user, emb_item)
        v_u      = 0.9 * v_u + 0.1 * gu
        v_i      = 0.9 * v_i + 0.1 * gi
        emb_user -= lr * v_u
        emb_item -= lr * v_i
    return emb_user, emb_item


def collaborative_scores(user_id, all_ratings_df, drinks_df):
    """
    Returns (scores_dict, emb_user, user_map) so the caller can reuse the
    trained embeddings for contextual scoring without training MF twice.
    Returns ({}, None, None) when there are insufficient ratings.
    """
    user_count = (all_ratings_df["user_id"] == user_id).sum()
    if user_count < 5:
        return {}, None, None

    df = all_ratings_df.copy()
    user_map,  user_enc,  num_users  = proc_col(df["user_id"])
    drink_map, drink_enc, num_drinks = proc_col(df["drink_id"])
    df["user_enc"]  = user_enc
    df["drink_enc"] = drink_enc
    df["rating"]    = df["rating"].astype(float)

    if user_id not in user_map:
        return {}, None, None

    emb_user, emb_item = train_mf(df, num_users, num_drinks)
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


#4. HYBRID MERGE + IMPLICIT BOOST

CONTENT_WEIGHT = 0.70
COLLAB_WEIGHT  = 0.30
IMPLICIT_CAP   = 0.15


def hybrid_scores(cb_scores, cf_scores, log_counts, rated_drink_ids, drinks_df):
    all_drink_ids = drinks_df["drink_id"].tolist()
    final = {}
    for drink_id in all_drink_ids:
        if drink_id in rated_drink_ids:
            continue
        cb = cb_scores.get(drink_id, 0.0)
        cf = cf_scores.get(drink_id, 0.0)
        if not cf_scores:
            h = cb
        else:
            h = CONTENT_WEIGHT * cb + COLLAB_WEIGHT * cf
        count          = log_counts.get(drink_id, 0)
        boost          = min(0.05 * count, IMPLICIT_CAP)
        final[drink_id] = h * (1 + boost)
    return final



# 5. DIETARY FILTER
# Applied AFTER hybrid scoring — removes incompatible drinks from the ranked list
# so the top 3 returned are always safe for the user's dietary needs.
#
# NUT_DRINKS: drinks containing almond or hazelnut
NUT_DRINKS = {
    "almond milk latte", "almond milk americano", "almond milk cappuccino",
    "hazelnut latte",
}

def apply_dietary_filter(scores, drinks_df, dietary_restrictions):
    if not dietary_restrictions:
        return scores, []

    drink_info = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}

    restrictions = [r.lower().strip() for r in dietary_restrictions]
    filtered  = {}
    removed   = []

    for drink_id, score in scores.items():
        d    = drink_info.get(int(drink_id))
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


#6. CONTEXTUAL SCORING (mood + time of day)

CONTEXTUAL_BOOST_CAP  = 0.25
SIMILAR_USER_K        = 20

def contextual_scores(user_id, all_ratings_df, drinks_df, emb_user, user_map,
                       mood, time_of_day):
    if user_id not in user_map:
        return {}

    mood_lower = mood.lower().strip() if mood else ""
    time_lower = time_of_day.lower().strip() if time_of_day else ""

    user_idx  = user_map[user_id]
    user_vec  = emb_user[user_idx]
    all_vecs  = emb_user

    norms     = np.linalg.norm(all_vecs, axis=1, keepdims=True)
    norms     = np.where(norms == 0, 1e-9, norms)
    sim_matrix = (all_vecs @ user_vec) / (norms.squeeze() * (np.linalg.norm(user_vec) or 1e-9))

    sim_matrix[user_idx] = -1.0
    top_k_idxs = np.argsort(sim_matrix)[::-1][:SIMILAR_USER_K]

    idx2user = {v: k for k, v in user_map.items()}
    similar_user_ids = [idx2user[i] for i in top_k_idxs if i in idx2user]
    similar_sims     = {idx2user[i]: float(sim_matrix[i])
                        for i in top_k_idxs if i in idx2user}

    ctx_df = all_ratings_df[all_ratings_df["user_id"].isin(similar_user_ids)].copy()

    if ctx_df.empty:
        return {}

    mood_mask = pd.Series([True] * len(ctx_df), index=ctx_df.index)
    if mood_lower:
        mood_prefix = mood_lower[:20]
        mood_mask = ctx_df["mood"].str.lower().str.startswith(mood_prefix, na=False)

    time_mask = pd.Series([True] * len(ctx_df), index=ctx_df.index)
    if time_lower:
        time_mask = ctx_df["time_of_day"].str.lower().str.strip() == time_lower

    ctx_df = ctx_df[mood_mask & time_mask]

    if ctx_df.empty:
        ctx_df = all_ratings_df[all_ratings_df["user_id"].isin(similar_user_ids)].copy()
        if mood_lower:
            mood_prefix = mood_lower[:20]
            ctx_df = ctx_df[ctx_df["mood"].str.lower().str.startswith(mood_prefix, na=False)]

    if ctx_df.empty:
        return {}

    raw_scores = {}
    weight_sum = {}

    for _, row in ctx_df.iterrows():
        did    = int(row["drink_id"])
        rating = float(row["rating"])
        sim    = similar_sims.get(str(row["user_id"]), 0.5)
        sim    = max(sim, 0.0)

        raw_scores[did]  = raw_scores.get(did, 0.0)  + rating * sim
        weight_sum[did]  = weight_sum.get(did, 0.0)  + sim

    if not raw_scores:
        return {}

    avg_scores = {did: raw_scores[did] / max(weight_sum[did], 1e-9)
                  for did in raw_scores}
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


# 7. WEATHER FILTER

WEATHER_BOOST = 0.30

def apply_weather_filter(scores, drinks_df, weather):
    if not weather:
        return scores, []

    drink_info = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
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


# 8. WIND-DOWN BOOST

WINDDOWN_BOOST = 0.30
WINDDOWN_MOODS = {"relaxed and winding down"}
WINDDOWN_TIMES = {"evening", "night"}
WINDDOWN_CAFFEINE_THRESHOLD = 10

def apply_winddown_boost(scores, drinks_df, mood, time_of_day):
    mood_lower = (mood or "").lower().strip()
    time_lower = (time_of_day or "").lower().strip()

    mood_match = mood_lower in WINDDOWN_MOODS
    time_match = time_lower in WINDDOWN_TIMES

    if not mood_match and not time_match:
        return scores, []

    drink_info = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
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

# 9. TERMINAL OUTPUT

def print_all_drinks_ranked(final_scores, drinks_df, cb_scores, cf_scores,
                             rated_ids, mode):
    lookup = {int(row["drink_id"]): dict(row) for _, row in drinks_df.iterrows()}
    ranked = sorted(final_scores.items(), key=lambda x: x[1], reverse=True)

    p()
    p("  FULL RANKED LIST — all 50 drinks scored by hybrid recommender")
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
        for did in rated_ids:
            d = lookup.get(int(did))
            if d is not None:
                p(f"    - {str(d['name'])}")


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


# 10. RESPONSE BUILDER

def build_response(top3, drinks_df, cb_scores, cf_scores):
    recs = []
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
            }
        })
    return recs


# 11. RECOMMEND ENDPOINT

@app.route("/recommend", methods=["POST"])
def recommend():
    data    = request.get_json()
    user_id = data.get("user_id")

    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    try:
        section("AROMA RECOMMENDER — REQUEST RECEIVED")
        p(f"  user_id    : {user_id}")
        p(f"  explore_new: {data.get('explore_new')}  (raw value received from Node proxy)")

        drinks_df       = load_drinks()
        all_ratings_df  = load_all_ratings()
        user_ratings_df = load_user_ratings(user_id)
        log_counts      = load_user_log_counts(user_id)

        divider()
        p(f"  Drinks in catalogue : {len(drinks_df)}")
        p(f"  Total ratings in DB : {len(all_ratings_df)}")
        p(f"  This user's ratings : {len(user_ratings_df)}")
        p(f"  This user's logs    : {sum(log_counts.values()) if log_counts else 0}")

        # Cold-start
        if user_ratings_df.empty:
            divider()
            p("  MODE: COLD START — no ratings yet, returning community top-rated drinks")
            popular = (
                all_ratings_df.groupby("drink_id")["rating"]
                .mean().reset_index()
                .rename(columns={"rating": "avg_rating"})
            )
            pop_scores = {
                int(r["drink_id"]): float(r["avg_rating"]) / 5.0
                for _, r in popular.iterrows()
            }
            lookup = {row["drink_id"]: row for _, row in drinks_df.iterrows()}
            ranked = sorted(pop_scores.items(), key=lambda x: x[1], reverse=True)
            p()
            p(f"  {'Rank':<5} {'Avg/5':>6}  {'Drink Name':<34} {'Type':<6} {'Caffeine':>8}")
            divider()
            for rank, (did, score) in enumerate(ranked, 1):
                d = lookup.get(did)
                if d is None: continue
                tag = "  <<< TOP 3" if rank <= 3 else ""
                p(f"  {rank:<5} {score:>6.4f}  {str(d['name']):<34} {str(d['type']):<6} {int(d['caffeine_mg']):>6}mg{tag}")

            top3 = ranked[:3]
            recs = build_response(top3, drinks_df, {}, {})
            print_top3(recs)
            return jsonify({"recommendations": recs, "mode": "popular"})

        # ── Determine explore mode ───────────────────────────────────────
        # explore_new = True  → user chose "Something new"
        #                        → exclude drinks they have already rated
        # explore_new = False → user chose "Include drinks I've tried"
        #                        → score the full catalogue, nothing excluded
        explore_new   = bool(data.get("explore_new", False))
        all_tried_ids = set(int(x) for x in user_ratings_df["drink_id"].tolist())

        if explore_new:
            rated_ids = all_tried_ids   # these will be skipped in scoring
        else:
            rated_ids = set()           # nothing excluded

        divider()
        p(f"  explore_new  = {explore_new}")
        p(f"  Already rated by this user: {len(all_tried_ids)} drinks")
        if explore_new:
            p(f"  → EXPLORE NEW: {len(all_tried_ids)} already-rated drinks will be excluded from results")
        else:
            p(f"  → INCLUDE TRIED: full catalogue will be scored, no drinks excluded")

        name_lookup = {row["drink_id"]: row["name"] for _, row in drinks_df.iterrows()}
        num_ratings = len(user_ratings_df)
        MIN_RATINGS_FOR_HYBRID = 5

        divider()
        p(f"  This user's rated drinks ({num_ratings}):")
        for _, r in user_ratings_df.iterrows():
            stars = "*" * int(r["rating"])
            p(f"    [{stars:<5}] {name_lookup.get(r['drink_id'], r['drink_id'])}")

        divider()
        if num_ratings < MIN_RATINGS_FOR_HYBRID:
            p(f"  *** MODE: WARM START ***")
            p(f"  User has {num_ratings} rating(s) — need {MIN_RATINGS_FOR_HYBRID} for hybrid model")
            p(f"  Using: Content-Based scoring + Contextual boosts only")
        else:
            p(f"  *** MODE: FULL HYBRID ***")
            p(f"  User has {num_ratings} ratings — all pipeline steps active")

        # Step 1: Content-based (always runs)
        feature_matrix, _ = build_feature_matrix(drinks_df)
        cb = content_based_scores(user_ratings_df, drinks_df, feature_matrix)

        divider()
        p(f"  [STEP 1] CONTENT-BASED SCORES  (cosine similarity, weighted by star rating)")
        p(f"  Computed for {len(cb)} candidate drinks")
        p()
        p(f"  {'Drink Name':<34} {'CB Score':>10}")
        p(f"  {'-'*34} {'-'*10}")
        cb_sorted = sorted(cb.items(), key=lambda x: x[1], reverse=True)
        for did, score in cb_sorted:
            d = name_lookup.get(did, str(did))
            p(f"  {str(d):<34} {score:>10.4f}")

        # Step 2: Collaborative (5+ ratings only)
        divider()
        if num_ratings >= MIN_RATINGS_FOR_HYBRID:
            cf, emb_user, cf_user_map = collaborative_scores(user_id, all_ratings_df, drinks_df)
            if cf:
                p(f"  [STEP 2] COLLABORATIVE SCORES  (matrix factorisation, trained on {len(all_ratings_df)} ratings)")
                p()
                p(f"  {'Drink Name':<34} {'CF Score':>10}")
                p(f"  {'-'*34} {'-'*10}")
                cf_sorted = sorted(cf.items(), key=lambda x: x[1], reverse=True)
                for did, score in cf_sorted:
                    d = name_lookup.get(did, str(did))
                    p(f"  {str(d):<34} {score:>10.4f}")
            else:
                p(f"  [STEP 2] COLLABORATIVE  — returned empty (unexpected), falling back to CB only")
        else:
            cf, emb_user, cf_user_map = {}, None, None
            p(f"  [STEP 2] COLLABORATIVE SKIPPED — warm start mode ({num_ratings} < {MIN_RATINGS_FOR_HYBRID} ratings)")

        #  Step 3: Merge scores
        # rated_ids is passed here so that already-rated drinks are excluded
        # when explore_new=True.  When explore_new=False, rated_ids is empty
        # so the full catalogue is scored.
        divider()
        if cf:
            mode = "hybrid"
            scores = hybrid_scores(cb, cf, log_counts, rated_ids, drinks_df)
            p(f"  [STEP 3] HYBRID MERGE  (CB {int(CONTENT_WEIGHT*100)}% + CF {int(COLLAB_WEIGHT*100)}%)")
        else:
            mode = "content-only"
            scores = {}
            for drink_id, cb_score in cb.items():
                if drink_id in rated_ids:   # ← skip already-rated when explore_new=True
                    continue
                count = log_counts.get(drink_id, 0)
                boost = min(0.05 * count, IMPLICIT_CAP)
                scores[drink_id] = cb_score * (1 + boost)
            p(f"  [STEP 3] CONTENT-ONLY MERGE  (CB 100%  |  mode: {mode})")

        if log_counts:
            p(f"  Implicit boost applied for {len(log_counts)} previously-logged drinks (cap {IMPLICIT_CAP})")
        p(f"  Final scored candidates: {len(scores)}")

        if explore_new:
            p(f"  [EXPLORE MODE] 'Something new' — excluded {len(rated_ids)} already-rated drinks")
        else:
            p(f"  [EXPLORE MODE] 'Include tried drinks' — full catalogue scored ({len(scores)} drinks)")

        print_all_drinks_ranked(scores, drinks_df, cb, cf, rated_ids, mode)

        #Step 4: Contextual boost (mood + time of day)
        mood         = data.get("mood", "")
        time_of_day  = data.get("time_of_day", "")
        weather      = data.get("weather", "")
        dietary_restrictions = data.get("dietary_restrictions", [])

        divider()
        if mood or time_of_day:
            p(f"  [STEP 4] CONTEXTUAL BOOST  mood='{mood}'  time='{time_of_day}'")
            if emb_user is not None:
                p(f"  Method: similar-user signals (CF embeddings available)")
                ctx = contextual_scores(
                    user_id, all_ratings_df, drinks_df,
                    emb_user, cf_user_map, mood, time_of_day
                )
            else:
                p(f"  Method: community-wide signals (warm start — no CF embeddings)")
                ctx_df = all_ratings_df.copy()
                mood_lower  = (mood or "").lower().strip()
                time_lower  = (time_of_day or "").lower().strip()
                if mood_lower:
                    ctx_df = ctx_df[ctx_df["mood"].str.lower().str.startswith(mood_lower[:20], na=False)]
                if time_lower:
                    ctx_df = ctx_df[ctx_df["time_of_day"].str.lower().str.strip() == time_lower]
                if ctx_df.empty and mood_lower:
                    ctx_df = all_ratings_df[all_ratings_df["mood"].str.lower().str.startswith(mood_lower[:20], na=False)]
                if not ctx_df.empty:
                    raw = ctx_df.groupby("drink_id")["rating"].mean().to_dict()
                    max_r = max(raw.values()) if raw else 1.0
                    ctx = {int(k): v / max_r for k, v in raw.items()}
                else:
                    ctx = {}

            if ctx:
                p(f"  Context signal found for {len(ctx)} drinks")
                p()
                p(f"  {'Drink Name':<34} {'Ctx Score':>10}  {'Boost':>8}")
                p(f"  {'-'*34} {'-'*10}  {'-'*8}")
                ctx_sorted = sorted(ctx.items(), key=lambda x: x[1], reverse=True)
                for did, cscore in ctx_sorted[:15]:
                    boost = cscore * CONTEXTUAL_BOOST_CAP
                    dname = name_lookup.get(did, str(did))
                    p(f"  {str(dname):<34} {cscore:>10.4f}  {boost:>+8.4f}")
                scores = apply_contextual_boost(scores, ctx)
                p(f"  Contextual boost applied — scores updated")
            else:
                p(f"  No context signal found for mood/time combination — skipping boost")
        else:
            p(f"  [STEP 4] CONTEXTUAL BOOST  skipped — no mood/time provided")

        # Step 5: Weather filter
        divider()
        if weather:
            p(f"  [STEP 5] WEATHER BOOST  weather='{weather}'  (soft preference, no drinks removed)")
            scores, w_boosted = apply_weather_filter(scores, drinks_df, weather)
            if w_boosted:
                boost_type = w_boosted[0][1]
                p(f"  Boosted {len(w_boosted)} {boost_type} drink(s) by +{int(WEATHER_BOOST*100)}%:")
                p(f"  {'Drink Name':<34} {'Before':>8}  {'After':>8}")
                p(f"  {'-'*34} {'-'*8}  {'-'*8}")
                for name, dtype, before, after in w_boosted:
                    p(f"  {name:<34} {before:>8.4f}  {after:>8.4f}")
            else:
                p(f"  No matching drinks found for weather type")
        else:
            p(f"  [STEP 5] WEATHER BOOST  skipped — no weather provided")

        # Step 5b: Wind-down boost
        divider()
        mood_lower_check = (mood or "").lower().strip()
        time_lower_check = (time_of_day or "").lower().strip()
        if mood_lower_check in WINDDOWN_MOODS or time_lower_check in WINDDOWN_TIMES:
            p(f"  [STEP 5b] WIND-DOWN BOOST  mood='{mood}'  time='{time_of_day}'")
            scores, wd_boosted = apply_winddown_boost(scores, drinks_df, mood, time_of_day)
            if wd_boosted:
                p(f"  Boosted {len(wd_boosted)} low-caffeine drink(s) by +{int(WINDDOWN_BOOST*100)}%:")
                p(f"  {'Drink Name':<34} {'Caffeine':>9}  {'Before':>8}  {'After':>8}")
                p(f"  {'-'*34} {'-'*9}  {'-'*8}  {'-'*8}")
                for name, caf, before, after in wd_boosted:
                    p(f"  {name:<34} {caf:>7}mg  {before:>8.4f}  {after:>8.4f}")
            else:
                p(f"  No low-caffeine drinks found to boost")
        else:
            p(f"  [STEP 5b] WIND-DOWN BOOST  skipped — mood/time not wind-down")

        # Step 6: Dietary filter
        divider()
        if dietary_restrictions:
            p(f"  [STEP 6] DIETARY FILTER  restrictions={dietary_restrictions}")
            scores, d_removed = apply_dietary_filter(scores, drinks_df, dietary_restrictions)
            if d_removed:
                p(f"  Removed {len(d_removed)} drink(s):")
                for name, reason in d_removed:
                    p(f"    ✗  {name:<34}  ({reason})")
            else:
                p(f"  No drinks removed — all candidates meet dietary requirements")
            p(f"  Remaining after dietary filter: {len(scores)}")
        else:
            p(f"  [STEP 6] DIETARY FILTER  skipped — no restrictions")

        top3 = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:3]
        recs = build_response(top3, drinks_df, cb, cf)
        print_top3(recs)

        return jsonify({"recommendations": recs, "mode": mode})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


#8. TRACK CLICK

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


# 9. HEALTH CHECK

@app.route("/health", methods=["GET"])
def health():
    p("[health] ping")
    return jsonify({"status": "ok", "service": "Aroma Recommender"})


# ─── STARTUP ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    section("Aroma Recommendation Engine - Starting")
    p("  Listening on http://localhost:5001")
    p("  debug=False (terminal output will show correctly)")
    p("  Waiting for requests...\n")
    app.run(host="0.0.0.0", port=5001, debug=False)