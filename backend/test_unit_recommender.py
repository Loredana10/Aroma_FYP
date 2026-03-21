"""
Aroma Recommender — Python Unit Tests
=======================================
Tests individual functions in recommender.py in isolation.
No database connection or running server required.

Run with:
    python test_unit_recommender.py
    python test_unit_recommender.py -v    # verbose
"""

import sys
import os
import importlib.util
import unittest
import pandas as pd
import numpy as np
from unittest.mock import patch, MagicMock

# ─── LOAD RECOMMENDER WITHOUT DB ──────────────────────────────────────────────

def load_recommender():
    candidates = [
        os.path.join(os.path.dirname(__file__), "recommender.py"),
        os.path.join(os.path.dirname(__file__), "..", "backend", "recommender.py"),
    ]
    path = next((c for c in candidates if os.path.exists(c)), None)
    if not path:
        raise FileNotFoundError("recommender.py not found")

    spec   = importlib.util.spec_from_file_location("recommender", path)
    module = importlib.util.module_from_spec(spec)

    devnull    = open(os.devnull, 'w')
    old_stdout = sys.stdout
    sys.stdout = devnull
    try:
        with patch.dict("sys.modules", {
            "psycopg2": MagicMock(),
            "psycopg2.extras": MagicMock(),
        }):
            spec.loader.exec_module(module)
    finally:
        sys.stdout = old_stdout
        devnull.close()
    return module

R = load_recommender()

# ─── SHARED FIXTURES ──────────────────────────────────────────────────────────

def make_drinks():
    rows = [
        (1,  "Latte",              "Espresso-Based",  "Hot",  "Coffee", 200, 2, False, False, True,  True),
        (2,  "Cappuccino",         "Espresso-Based",  "Hot",  "Coffee", 200, 2, False, False, True,  True),
        (3,  "Flat White",         "Espresso-Based",  "Hot",  "Coffee", 241, 2, False, False, True,  True),
        (4,  "Americano",          "Espresso-Based",  "Hot",  "Coffee", 200, 2, True,  True,  True,  False),
        (5,  "Espresso",           "Espresso-Based",  "Hot",  "Coffee", 100, 1, True,  True,  True,  False),
        (6,  "Oat Milk Latte",     "Milk Alternative","Hot",  "Coffee", 200, 2, True,  True,  True,  True),
        (7,  "Soy Milk Latte",     "Milk Alternative","Hot",  "Coffee", 200, 2, True,  True,  True,  True),
        (8,  "Iced Latte",         "Iced Coffee",     "Iced", "Coffee", 200, 2, False, False, True,  True),
        (9,  "Cold Brew",          "Iced Coffee",     "Iced", "Coffee", 200, 0, True,  True,  True,  False),
        (10, "Iced Americano",     "Iced Coffee",     "Iced", "Coffee", 200, 2, True,  True,  True,  False),
        (11, "Chamomile Tea",      "Herbal Tea",      "Hot",  "Tea",    0,   0, True,  True,  True,  False),
        (12, "Peppermint Tea",     "Herbal Tea",      "Hot",  "Tea",    0,   0, True,  True,  True,  False),
        (13, "Decaf Latte",        "Decaf",           "Hot",  "Coffee", 2,   2, False, False, True,  True),
        (14, "Decaf Espresso",     "Decaf",           "Hot",  "Coffee", 2,   1, True,  True,  True,  False),
        (15, "Hazelnut Latte",     "Specialty Latte", "Hot",  "Coffee", 200, 2, False, False, True,  True),
        (16, "Almond Milk Latte",  "Milk Alternative","Hot",  "Coffee", 200, 2, True,  False, True,  True),
        (17, "Vanilla Latte",      "Specialty Latte", "Hot",  "Coffee", 200, 2, False, False, True,  True),
    ]
    cols = ["drink_id","name","category","type","base","caffeine_mg","shots",
            "dairy_free","vegan","gluten_free","milk_alternative_available"]
    return pd.DataFrame(rows, columns=cols)

def make_ratings(user_ids, drink_ids, rating=4.0):
    rows = []
    for uid in user_ids:
        for did in drink_ids:
            rows.append({"user_id": uid, "drink_id": did, "rating": rating,
                         "mood": "Fairly okay, just want a drink",
                         "time_of_day": "Morning", "weather": "Cold"})
    return pd.DataFrame(rows)

DRINKS = make_drinks()

# ─── SUPPRESS PRINT HELPER ────────────────────────────────────────────────────

from contextlib import contextmanager

@contextmanager
def quiet():
    devnull = open(os.devnull, 'w')
    old = sys.stdout
    sys.stdout = devnull
    try:
        yield
    finally:
        sys.stdout = old
        devnull.close()


# ═══════════════════════════════════════════════════════════════════════════════
# TEST CASES
# ═══════════════════════════════════════════════════════════════════════════════

class TestNormaliseAgeRange(unittest.TestCase):
    """normalise_age_range() — string normalisation for demographic matching."""

    def test_basic_range(self):
        self.assertEqual(R.normalise_age_range("18-24"), "18-24")

    def test_strips_whitespace(self):
        self.assertEqual(R.normalise_age_range("  18-24 "), "18-24")

    def test_removes_internal_spaces(self):
        self.assertEqual(R.normalise_age_range("18 - 24"), "18-24")

    def test_lowercase(self):
        self.assertEqual(R.normalise_age_range("<18"), "<18")

    def test_none_returns_none(self):
        self.assertIsNone(R.normalise_age_range(None))

    def test_empty_string_returns_none(self):
        self.assertIsNone(R.normalise_age_range(""))


class TestBuildFeatureMatrix(unittest.TestCase):
    """build_feature_matrix() — produces a valid numerical matrix."""

    def setUp(self):
        with quiet():
            self.matrix, self.scaler = R.build_feature_matrix(DRINKS)

    def test_matrix_has_correct_row_count(self):
        self.assertEqual(self.matrix.shape[0], len(DRINKS))

    def test_matrix_has_no_nan(self):
        # Cast to float64 first — get_dummies produces bool columns which
        # np.isnan does not support directly
        self.assertFalse(np.isnan(self.matrix.astype(np.float64)).any())

    def test_scaled_features_between_0_and_1(self):
        # Numerical columns (last 2) should be [0, 1] after MinMaxScaler
        self.assertTrue((self.matrix[:, -2:] >= 0).all())
        self.assertTrue((self.matrix[:, -2:] <= 1).all())

    def test_binary_features_are_0_or_1(self):
        # One-hot columns should only contain 0 or 1
        one_hot_cols = self.matrix[:, :-2]
        unique_vals = np.unique(one_hot_cols)
        for v in unique_vals:
            self.assertIn(v, [0.0, 1.0])


class TestContentBasedScores(unittest.TestCase):
    """content_based_scores() — scores reflect user preferences."""

    def setUp(self):
        with quiet():
            self.fm, _ = R.build_feature_matrix(DRINKS)

    def test_returns_score_for_every_drink(self):
        user_ratings = pd.DataFrame([{"drink_id": 1, "rating": 5.0}])
        with quiet():
            scores = R.content_based_scores(user_ratings, DRINKS, self.fm)
        self.assertEqual(len(scores), len(DRINKS))

    def test_scores_are_between_0_and_1(self):
        user_ratings = pd.DataFrame([{"drink_id": 1, "rating": 5.0},
                                      {"drink_id": 2, "rating": 4.0}])
        with quiet():
            scores = R.content_based_scores(user_ratings, DRINKS, self.fm)
        for score in scores.values():
            self.assertGreaterEqual(score, 0.0)
            self.assertLessEqual(score, 1.0)

    def test_liked_espresso_based_drink_scores_similar_drinks_higher(self):
        # User likes Latte (id=1, espresso-based) → Cappuccino (id=2) should score higher than Chamomile Tea (id=11)
        user_ratings = pd.DataFrame([{"drink_id": 1, "rating": 5.0}])
        with quiet():
            scores = R.content_based_scores(user_ratings, DRINKS, self.fm)
        self.assertGreater(scores[2], scores[11],
            "Cappuccino should score higher than Chamomile Tea for a Latte lover")

    def test_empty_ratings_returns_empty(self):
        user_ratings = pd.DataFrame(columns=["drink_id","rating"])
        with quiet():
            scores = R.content_based_scores(user_ratings, DRINKS, self.fm)
        self.assertEqual(scores, {})

    def test_only_drinks_rated_4_or_5_used_as_reference(self):
        # 3-star rating should not be used as liked reference
        user_ratings = pd.DataFrame([
            {"drink_id": 1, "rating": 3.0},  # not liked
            {"drink_id": 2, "rating": 5.0},  # liked
        ])
        with quiet():
            scores_with_liked = R.content_based_scores(user_ratings, DRINKS, self.fm)
        user_ratings_no_liked = pd.DataFrame([{"drink_id": 1, "rating": 3.0}])
        with quiet():
            scores_no_liked = R.content_based_scores(user_ratings_no_liked, DRINKS, self.fm)
        # With a liked drink (5 stars) vs only 3-star, scores should differ
        self.assertNotEqual(list(scores_with_liked.values()), list(scores_no_liked.values()))


class TestBuildCombinedMatrix(unittest.TestCase):
    """build_combined_matrix() — three-case implicit signal logic."""

    def _run(self, all_ratings, all_log_counts):
        with quiet():
            return R.build_combined_matrix(all_ratings, all_log_counts)

    def _make_ratings(self, entries):
        rows = [{"user_id": "u1", "drink_id": did, "rating": r,
                 "mood":"","time_of_day":"","weather":""} for did, r in entries]
        return pd.DataFrame(rows)

    def test_case1_unrated_logged_adds_implicit_row(self):
        """Unrated drink logged 5 times → added as implicit positive preference."""
        ratings     = self._make_ratings([(1, 5.0), (2, 4.0)])
        log_counts  = {"u1": {3: 5}}   # drink 3 logged 5x, never rated
        pref_df, conf_map = self._run(ratings, log_counts)

        impl_row = pref_df[(pref_df["user_id"] == "u1") & (pref_df["drink_id"] == 3)]
        self.assertEqual(len(impl_row), 1, "Implicit row should be added for unrated+logged drink")
        self.assertAlmostEqual(float(impl_row.iloc[0]["rating"]), 0.5, places=2)
        expected_conf = 1 + R.ALPHA * 5
        self.assertEqual(conf_map[("u1", 3)], expected_conf)

    def test_case2_high_rated_logged_boosts_confidence(self):
        """Rated 5 stars AND logged 6 times → confidence reinforced above base."""
        ratings     = self._make_ratings([(1, 5.0)])
        log_counts  = {"u1": {1: 6}}
        pref_df, conf_map = self._run(ratings, log_counts)

        base_conf     = 1 + R.ALPHA * 5
        expected_conf = base_conf + R.ALPHA * 6
        self.assertEqual(conf_map[("u1", 1)], expected_conf,
            "High-rated + frequently-logged drink should get boosted confidence")

    def test_case3_low_rated_logged_not_boosted(self):
        """Rated 2 stars AND logged 10 times → confidence NOT boosted."""
        ratings     = self._make_ratings([(1, 2.0)])
        log_counts  = {"u1": {1: 10}}
        pref_df, conf_map = self._run(ratings, log_counts)

        base_conf = 1 + R.ALPHA * 5
        self.assertEqual(conf_map[("u1", 1)], base_conf,
            "Low-rated drink should not get implicit confidence boost")

    def test_implicit_preference_capped_at_1(self):
        """Logged 20 times → preference = min(20/10, 1.0) = 1.0."""
        ratings     = self._make_ratings([])
        log_counts  = {"u1": {5: 20}}
        pref_df, conf_map = self._run(ratings, log_counts)

        impl_row = pref_df[(pref_df["user_id"] == "u1") & (pref_df["drink_id"] == 5)]
        self.assertEqual(float(impl_row.iloc[0]["rating"]), 1.0)

    def test_no_duplicate_rows_for_rated_and_logged(self):
        """A rated drink that is also logged should only appear once (the explicit rating)."""
        ratings     = self._make_ratings([(1, 5.0)])
        log_counts  = {"u1": {1: 3}}
        pref_df, _ = self._run(ratings, log_counts)

        u1_drink1 = pref_df[(pref_df["user_id"] == "u1") & (pref_df["drink_id"] == 1)]
        self.assertEqual(len(u1_drink1), 1, "Rated+logged drink should appear exactly once in preference matrix")


class TestDietaryFilter(unittest.TestCase):
    """apply_dietary_filter() — hard removes non-compliant drinks."""

    def _filter(self, restrictions, scores=None):
        if scores is None:
            scores = {int(row["drink_id"]): 0.8 for _, row in DRINKS.iterrows()}
        with quiet():
            filtered, removed = R.apply_dietary_filter(scores, DRINKS, restrictions)
        return filtered, removed

    def test_dairy_free_removes_non_dairy_free(self):
        filtered, removed = self._filter(["Dairy-free"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["dairy_free"], f"{row['name']} is not dairy-free but passed filter")

    def test_vegan_removes_non_vegan(self):
        filtered, removed = self._filter(["Vegan"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["vegan"], f"{row['name']} is not vegan but passed filter")

    def test_nut_allergy_removes_hazelnut(self):
        filtered, _ = self._filter(["Nut allergy"])
        names_in_result = [DRINKS[DRINKS["drink_id"] == d].iloc[0]["name"].lower() for d in filtered]
        self.assertNotIn("hazelnut latte", names_in_result)

    def test_nut_allergy_removes_almond(self):
        filtered, _ = self._filter(["Nut allergy"])
        names_in_result = [DRINKS[DRINKS["drink_id"] == d].iloc[0]["name"].lower() for d in filtered]
        self.assertNotIn("almond milk latte", names_in_result)

    def test_no_restrictions_returns_all_drinks(self):
        filtered, removed = self._filter([])
        self.assertEqual(len(filtered), len(DRINKS))
        self.assertEqual(len(removed), 0)

    def test_combined_dairy_free_and_vegan(self):
        filtered, _ = self._filter(["Dairy-free", "Vegan"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["dairy_free"] and row["vegan"],
                f"{row['name']} failed combined dairy-free + vegan filter")

    def test_removed_list_contains_correct_drinks(self):
        _, removed = self._filter(["Dairy-free"])
        non_dairy_free_names = DRINKS[~DRINKS["dairy_free"]]["name"].tolist()
        removed_names = [name for name, _ in removed]
        for name in non_dairy_free_names:
            self.assertIn(name, removed_names)


class TestWeatherFilter(unittest.TestCase):
    """apply_weather_filter() — soft boosts correct drink type."""

    def _base_scores(self):
        return {int(row["drink_id"]): 0.5 for _, row in DRINKS.iterrows()}

    def test_hot_weather_boosts_iced_drinks(self):
        scores = self._base_scores()
        with quiet():
            boosted, log = R.apply_weather_filter(scores, DRINKS, "Hot/Warm")
        for name, dtype, before, after in log:
            self.assertEqual(dtype, "iced", f"{name} is not iced but was boosted")
            self.assertAlmostEqual(after, before * (1 + R.WEATHER_BOOST), places=4)

    def test_cold_weather_boosts_hot_drinks(self):
        scores = self._base_scores()
        with quiet():
            boosted, log = R.apply_weather_filter(scores, DRINKS, "Cold")
        for name, dtype, before, after in log:
            self.assertEqual(dtype, "hot")

    def test_hot_weather_does_not_boost_hot_drinks(self):
        scores = self._base_scores()
        with quiet():
            boosted, _ = R.apply_weather_filter(scores, DRINKS, "Hot/Warm")
        hot_drinks = DRINKS[DRINKS["type"] == "Hot"]["drink_id"].tolist()
        for did in hot_drinks:
            self.assertAlmostEqual(boosted[did], 0.5, places=4,
                msg=f"Hot drink id={did} should NOT be boosted in hot weather")

    def test_no_weather_returns_unchanged(self):
        scores = self._base_scores()
        with quiet():
            result, log = R.apply_weather_filter(scores, DRINKS, "")
        self.assertEqual(result, scores)
        self.assertEqual(log, [])

    def test_boost_amount_is_correct(self):
        scores = {8: 0.6}   # Iced Latte
        with quiet():
            boosted, _ = R.apply_weather_filter(scores, DRINKS, "Hot/Warm")
        expected = 0.6 * (1 + R.WEATHER_BOOST)
        self.assertAlmostEqual(boosted[8], expected, places=4)


class TestWindDownBoost(unittest.TestCase):
    """apply_winddown_boost() — boosts low-caffeine drinks at correct times."""

    def _base_scores(self):
        return {int(row["drink_id"]): 0.5 for _, row in DRINKS.iterrows()}

    def test_evening_mood_boosts_low_caffeine(self):
        scores = self._base_scores()
        with quiet():
            boosted, log = R.apply_winddown_boost(scores, DRINKS,
                                                   mood="Relaxed and winding down",
                                                   time_of_day="Evening")
        for name, caffeine, before, after in log:
            self.assertLessEqual(caffeine, R.WINDDOWN_CAFFEINE_THRESHOLD)
            self.assertAlmostEqual(after, before * (1 + R.WINDDOWN_BOOST), places=4)

    def test_no_high_caffeine_drinks_boosted(self):
        scores = self._base_scores()
        with quiet():
            boosted, _ = R.apply_winddown_boost(scores, DRINKS,
                                                  mood="Relaxed and winding down",
                                                  time_of_day="Evening")
        high_caff = DRINKS[DRINKS["caffeine_mg"] > R.WINDDOWN_CAFFEINE_THRESHOLD]["drink_id"].tolist()
        for did in high_caff:
            self.assertAlmostEqual(boosted[did], 0.5, places=4,
                msg=f"Drink id={did} has high caffeine and should not be boosted")

    def test_neutral_mood_and_time_skips_boost(self):
        scores = self._base_scores()
        with quiet():
            boosted, log = R.apply_winddown_boost(scores, DRINKS,
                                                   mood="Tired and need a boost",
                                                   time_of_day="Morning")
        self.assertEqual(log, [], "No boost should apply for morning/boost mood")
        self.assertEqual(boosted, scores)

    def test_time_alone_triggers_boost(self):
        scores = self._base_scores()
        with quiet():
            _, log = R.apply_winddown_boost(scores, DRINKS,
                                             mood="Fairly okay, just want a drink",
                                             time_of_day="Evening")
        self.assertGreater(len(log), 0, "Evening time alone should trigger wind-down boost")


class TestDemographicColdStart(unittest.TestCase):
    """demographic_cold_start() — similarity scoring and fallback logic."""

    def _run(self, user_demo, all_demo_df, all_ratings_df):
        with quiet():
            return R.demographic_cold_start(
                "test_user", user_demo, all_demo_df, all_ratings_df, DRINKS
            )

    def _sim_ratings(self, user_ids, drink_id, rating=5.0):
        rows = [{"user_id": uid, "drink_id": drink_id, "rating": rating,
                 "mood":"","time_of_day":"","weather":""} for uid in user_ids]
        return pd.DataFrame(rows)

    def test_perfect_match_returns_demographic_similarity(self):
        user_demo = {"age_range": "18-24", "gender": "female"}
        all_demo  = pd.DataFrame([
            {"user_id": "sim1", "age_range": "18-24", "gender": "Female"},
            {"user_id": "sim2", "age_range": "18-24", "gender": "Female"},
        ])
        ratings = self._sim_ratings(["sim1","sim2"], 1)
        scores, method = self._run(user_demo, all_demo, ratings)
        self.assertEqual(method, "demographic_similarity")
        self.assertGreater(len(scores), 0)

    def test_empty_demographics_returns_no_data_fallback(self):
        user_demo = {"age_range": None, "gender": None}
        all_demo  = pd.DataFrame(columns=["user_id","age_range","gender"])
        ratings   = pd.DataFrame(columns=["user_id","drink_id","rating","mood","time_of_day","weather"])
        scores, method = self._run(user_demo, all_demo, ratings)
        self.assertEqual(method, "no_demographic_data")
        self.assertEqual(scores, {})

    def test_no_matching_users_returns_no_similar_users(self):
        user_demo = {"age_range": "18-24", "gender": "female"}
        all_demo  = pd.DataFrame([
            {"user_id": "other", "age_range": "50-64", "gender": "Male"},
        ])
        ratings = self._sim_ratings(["other"], 1)
        scores, method = self._run(user_demo, all_demo, ratings)
        self.assertEqual(method, "no_similar_users")

    def test_unrepresented_gender_falls_back_to_age_band(self):
        """Non-binary user: gender not in DB → still matches on age band."""
        user_demo = {"age_range": "18-24", "gender": "non-binary"}
        all_demo  = pd.DataFrame([
            {"user_id": "f1", "age_range": "18-24", "gender": "Female"},
            {"user_id": "m1", "age_range": "18-24", "gender": "Male"},
        ])
        ratings = self._sim_ratings(["f1","m1"], 1)
        scores, method = self._run(user_demo, all_demo, ratings)
        self.assertEqual(method, "demographic_similarity",
            "Non-binary user should still match on age band even if gender unrepresented")
        self.assertGreater(len(scores), 0)

    def test_top_drink_reflects_similar_user_preferences(self):
        user_demo = {"age_range": "18-24", "gender": "female"}
        all_demo  = pd.DataFrame([
            {"user_id": f"u{i}", "age_range": "18-24", "gender": "Female"}
            for i in range(5)
        ])
        # All similar users love Chamomile Tea (id=11)
        rows = []
        for i in range(5):
            rows.append({"user_id": f"u{i}", "drink_id": 11, "rating": 5.0,
                         "mood":"","time_of_day":"","weather":""})
            rows.append({"user_id": f"u{i}", "drink_id": 1,  "rating": 1.0,
                         "mood":"","time_of_day":"","weather":""})
        ratings = pd.DataFrame(rows)
        scores, _ = self._run(user_demo, all_demo, ratings)
        top_drink = max(scores, key=scores.get)
        self.assertEqual(top_drink, 11, "Top drink should match what similar users rated highest")


class TestHybridScores(unittest.TestCase):
    """hybrid_scores() — correct weighted merge, correct exclusion logic."""

    def test_hybrid_formula_correct(self):
        cb = {1: 0.8, 2: 0.6}
        cf = {1: 0.4, 2: 0.9}
        with quiet():
            result = R.hybrid_scores(cb, cf, set(), DRINKS)
        expected_1 = 0.8 * R.CONTENT_WEIGHT + 0.4 * R.COLLAB_WEIGHT
        self.assertAlmostEqual(result[1], expected_1, places=4)

    def test_explore_new_excludes_rated_drinks(self):
        cb = {1: 0.9, 2: 0.7, 3: 0.5}
        cf = {1: 0.9, 2: 0.7, 3: 0.5}
        rated = {1, 2}
        with quiet():
            result = R.hybrid_scores(cb, cf, rated, DRINKS)
        self.assertNotIn(1, result)
        self.assertNotIn(2, result)
        self.assertIn(3, result)

    def test_no_cf_scores_uses_cb_only(self):
        cb = {1: 0.7, 2: 0.5}
        with quiet():
            result = R.hybrid_scores(cb, {}, set(), DRINKS)
        self.assertAlmostEqual(result[1], 0.7, places=4)
        self.assertAlmostEqual(result[2], 0.5, places=4)


class TestContextualBoost(unittest.TestCase):
    """apply_contextual_boost() — multiplier capped at CONTEXTUAL_BOOST_CAP."""

    def test_boost_applied_correctly(self):
        scores     = {1: 0.8, 2: 0.5}
        ctx_scores = {1: 1.0, 2: 0.0}
        with quiet():
            result = R.apply_contextual_boost(scores, ctx_scores)
        expected_1 = 0.8 * (1 + 1.0 * R.CONTEXTUAL_BOOST_CAP)
        self.assertAlmostEqual(result[1], expected_1, places=4)
        self.assertAlmostEqual(result[2], 0.5, places=4)

    def test_zero_ctx_score_leaves_unchanged(self):
        scores     = {5: 0.6}
        ctx_scores = {5: 0.0}
        with quiet():
            result = R.apply_contextual_boost(scores, ctx_scores)
        self.assertAlmostEqual(result[5], 0.6, places=4)


# ─── RUN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    verbosity = 2 if "-v" in sys.argv else 1
    loader  = unittest.TestLoader()
    suite   = unittest.TestSuite()
    for cls in [
        TestNormaliseAgeRange,
        TestBuildFeatureMatrix,
        TestContentBasedScores,
        TestBuildCombinedMatrix,
        TestDietaryFilter,
        TestWeatherFilter,
        TestWindDownBoost,
        TestDemographicColdStart,
        TestHybridScores,
        TestContextualBoost,
    ]:
        suite.addTests(loader.loadTestsFromTestCase(cls))

    runner = unittest.TextTestRunner(verbosity=verbosity)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)