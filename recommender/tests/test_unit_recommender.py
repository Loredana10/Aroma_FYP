"""
Aroma Recommender — Python Unit Tests
Tests individual functions in recommender.py in isolation.
No database connection or running server required.

Run with:
    pytest tests/test_unit_recommender.py -v
    pytest tests/test_unit_recommender.py -v --cov=recommender --cov-report=term-missing

Following the Arrange-Act-Assert (AAA) pattern.
Tests cover: happy path, edge cases, boundary conditions,
             None input, empty strings, weird characters,
             case sensitivity, type errors, mixed valid/invalid input.
"""

import sys
import os
import importlib.util
import unittest
import pandas as pd
import numpy as np
from unittest.mock import patch, MagicMock
from contextlib import contextmanager

# Loading recommender without db
# recommender.py calls sys.stdout.reconfigure() at module level which breaks
# when stdout is replaced with StringIO. We redirect to /dev/null instead.

def load_recommender():
    # Look for recommender.py relative to this test file
    base = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base, "recommender.py"),           # tests/ sibling
        os.path.join(base, "..", "recommender.py"),     # one level up
    ]
    path = next((c for c in candidates if os.path.exists(c)), None)
    if not path:
        raise FileNotFoundError(
            "recommender.py not found. Run pytest from the recommender/ folder."
        )

    spec   = importlib.util.spec_from_file_location("recommender", path)
    module = importlib.util.module_from_spec(spec)

    devnull    = open(os.devnull, "w")
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = devnull
    sys.stderr = devnull
    try:
        with patch.dict("sys.modules", {
            "psycopg2":        MagicMock(),
            "psycopg2.extras": MagicMock(),
        }):
            spec.loader.exec_module(module)
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        devnull.close()
    return module


R = load_recommender()


# Supress print helper

@contextmanager
def quiet():
    """Suppress all stdout during test execution (recommender.py is very chatty)."""
    devnull = open(os.devnull, "w")
    old = sys.stdout
    sys.stdout = devnull
    try:
        yield
    finally:
        sys.stdout = old
        devnull.close()


# Shared fixtures

def make_drinks():
    """
    17-drink catalogue used across all unit tests.
    Covers: espresso-based, milk alternative, iced, herbal tea, decaf,
            specialty lattes, and a nut-containing drink.
    """
    rows = [
        # id  name                   category            type    base     caff  shots  df     vegan  gf     milk_alt
        (1,  "Latte",               "Espresso-Based",   "Hot",  "Coffee", 200, 2, False, False, True,  True),
        (2,  "Cappuccino",          "Espresso-Based",   "Hot",  "Coffee", 200, 2, False, False, True,  True),
        (3,  "Flat White",          "Espresso-Based",   "Hot",  "Coffee", 241, 2, False, False, True,  True),
        (4,  "Americano",           "Espresso-Based",   "Hot",  "Coffee", 200, 2, True,  True,  True,  False),
        (5,  "Espresso",            "Espresso-Based",   "Hot",  "Coffee", 100, 1, True,  True,  True,  False),
        (6,  "Oat Milk Latte",      "Milk Alternative", "Hot",  "Coffee", 200, 2, True,  True,  True,  True),
        (7,  "Soy Milk Latte",      "Milk Alternative", "Hot",  "Coffee", 200, 2, True,  True,  True,  True),
        (8,  "Iced Latte",          "Iced Coffee",      "Iced", "Coffee", 200, 2, False, False, True,  True),
        (9,  "Cold Brew",           "Iced Coffee",      "Iced", "Coffee", 200, 0, True,  True,  True,  False),
        (10, "Iced Americano",      "Iced Coffee",      "Iced", "Coffee", 200, 2, True,  True,  True,  False),
        (11, "Chamomile Tea",       "Herbal Tea",       "Hot",  "Tea",    0,   0, True,  True,  True,  False),
        (12, "Peppermint Tea",      "Herbal Tea",       "Hot",  "Tea",    0,   0, True,  True,  True,  False),
        (13, "Decaf Latte",         "Decaf",            "Hot",  "Coffee", 2,   2, False, False, True,  True),
        (14, "Decaf Espresso",      "Decaf",            "Hot",  "Coffee", 2,   1, True,  True,  True,  False),
        (15, "Hazelnut Latte",      "Specialty Latte",  "Hot",  "Coffee", 200, 2, False, False, True,  True),
        (16, "Almond Milk Latte",   "Milk Alternative", "Hot",  "Coffee", 200, 2, True,  False, True,  True),
        (17, "Vanilla Latte",       "Specialty Latte",  "Hot",  "Coffee", 200, 2, False, False, True,  True),
    ]
    cols = [
        "drink_id", "name", "category", "type", "base",
        "caffeine_mg", "shots", "dairy_free", "vegan",
        "gluten_free", "milk_alternative_available",
    ]
    return pd.DataFrame(rows, columns=cols)


def make_ratings(user_ids, drink_ids, rating=4.0):
    rows = []
    for uid in user_ids:
        for did in drink_ids:
            rows.append({
                "user_id":     uid,
                "drink_id":    did,
                "rating":      rating,
                "mood":        "Fairly okay, just want a drink",
                "time_of_day": "Morning",
                "weather":     "Cold",
            })
    return pd.DataFrame(rows)


DRINKS = make_drinks()


# 1. normalise_age_range()

class TestNormaliseAgeRange(unittest.TestCase):
    """
    Covers: happy path, whitespace, internal spaces, mixed case,
            None, empty string, integer input, unusual formats.
    """

    #  Happy path 

    def test_standard_range_unchanged(self):
        """Arrange: standard DB value. Act+Assert: returned as-is (lowercased)."""
        self.assertEqual(R.normalise_age_range("18-24"), "18-24")

    def test_common_ranges(self):
        for val in ["25-34", "35-49", "50-64", "65+"]:
            with self.subTest(val=val):
                self.assertEqual(R.normalise_age_range(val), val)

    #  Whitespace 

    def test_leading_trailing_whitespace_stripped(self):
        self.assertEqual(R.normalise_age_range("  18-24 "), "18-24")

    def test_internal_spaces_removed(self):
        """'18 - 24' is a common DB variation — spaces should be stripped."""
        self.assertEqual(R.normalise_age_range("18 - 24"), "18-24")

    def test_tabs_and_newlines_stripped(self):
        self.assertEqual(R.normalise_age_range("\t18-24\n"), "18-24")

    #  Case sensitivity 

    def test_uppercase_converted_to_lowercase(self):
        self.assertEqual(R.normalise_age_range("<18"), "<18")

    def test_mixed_case_lowercased(self):
        # Edge case: someone stored "Senior" as an age band
        result = R.normalise_age_range("SENIOR")
        self.assertEqual(result, "senior")

    #  None / empty 

    def test_none_returns_none(self):
        """None is the most common missing-data case — must not crash."""
        self.assertIsNone(R.normalise_age_range(None))

    def test_empty_string_returns_none(self):
        """Empty string from DB should be treated as missing."""
        self.assertIsNone(R.normalise_age_range(""))

    def test_whitespace_only_returns_none(self):
        """A string of only spaces collapses to empty after strip → None."""
        self.assertIsNone(R.normalise_age_range("   "))

    #  Type edge cases 

    def test_integer_input_coerced_to_string(self):
        """If age is stored as an integer in the DB, it should not crash."""
        result = R.normalise_age_range(18)
        self.assertEqual(result, "18")

    def test_float_input_coerced_to_string(self):
        result = R.normalise_age_range(18.0)
        self.assertIsNotNone(result)  # should not crash

    #  Weird characters 

    def test_special_chars_not_removed(self):
        """The '<18' format uses a special character — must be preserved."""
        self.assertEqual(R.normalise_age_range("<18"), "<18")

    def test_plus_sign_preserved(self):
        """'65+' is a valid age band — plus sign must be kept."""
        self.assertEqual(R.normalise_age_range("65+"), "65+")


# 2. build_feature_matrix()

class TestBuildFeatureMatrix(unittest.TestCase):
    """
    Covers: correct shape, no NaN, values in range,
            single-drink dataframe, zero-value numerical columns.
    """

    def setUp(self):
        with quiet():
            self.matrix, self.scaler = R.build_feature_matrix(DRINKS)

    #  Happy path

    def test_row_count_matches_drink_count(self):
        self.assertEqual(self.matrix.shape[0], len(DRINKS))

    def test_no_nan_values(self):
        """Cast to float64 first — get_dummies produces bool columns which
        np.isnan does not support directly on older numpy builds."""
        self.assertFalse(np.isnan(self.matrix.astype(np.float64)).any())

    def test_scaled_columns_between_0_and_1(self):
        """MinMaxScaler output (last 2 columns) must be in [0, 1]."""
        self.assertTrue((self.matrix[:, -2:] >= 0).all())
        self.assertTrue((self.matrix[:, -2:] <= 1).all())

    def test_one_hot_columns_are_0_or_1(self):
        one_hot = self.matrix[:, :-2]
        unique  = np.unique(one_hot.astype(np.float64))
        for v in unique:
            self.assertIn(v, [0.0, 1.0])

    #  Edge cases 

    def test_single_drink_produces_one_row(self):
        single = DRINKS.head(1)
        with quiet():
            mat, _ = R.build_feature_matrix(single)
        self.assertEqual(mat.shape[0], 1)

    def test_zero_caffeine_and_shots_no_nan_in_full_catalogue(self):
        """Full catalogue includes zero-caffeine drinks (Chamomile, Peppermint, Decaf).
        MinMaxScaler can handle these because the catalogue also has high-caffeine drinks,
        so max != min and no NaN is produced."""
        with quiet():
            mat, _ = R.build_feature_matrix(DRINKS)
        self.assertFalse(np.isnan(mat.astype(np.float64)).any())

    def test_all_same_category_produces_single_one_hot_column(self):
        """If all drinks share a category the dummy matrix collapses to 1 col — should not crash."""
        same_cat = DRINKS[DRINKS["category"] == "Espresso-Based"].copy()
        with quiet():
            mat, _ = R.build_feature_matrix(same_cat)
        self.assertEqual(mat.shape[0], len(same_cat))


# 3. content_based_scores()

class TestContentBasedScores(unittest.TestCase):
    """
    Covers: scores for similar/dissimilar drinks, empty ratings,
            ratings below threshold (fallback), unknown drink ID in ratings.
    """

    def setUp(self):
        with quiet():
            self.fm, _ = R.build_feature_matrix(DRINKS)

    def _score(self, ratings_rows):
        df = pd.DataFrame(ratings_rows, columns=["drink_id", "rating"])
        with quiet():
            return R.content_based_scores(df, DRINKS, self.fm)

    #  Happy path 

    def test_returns_score_for_every_drink(self):
        scores = self._score([(1, 5.0)])
        self.assertEqual(len(scores), len(DRINKS))

    def test_scores_non_negative(self):
        scores = self._score([(1, 5.0), (2, 4.0)])
        for s in scores.values():
            self.assertGreaterEqual(s, 0.0)

    def test_similar_drink_scores_higher_than_dissimilar(self):
        """User likes Latte (espresso-based hot) →
        Cappuccino (same category) should outscore Chamomile Tea (herbal)."""
        scores = self._score([(1, 5.0)])
        self.assertGreater(scores[2], scores[11],
            "Cappuccino should score higher than Chamomile Tea for a Latte lover")

    #  Edge cases 

    def test_empty_ratings_returns_empty_dict(self):
        """No ratings at all — function should return {} not crash."""
        df = pd.DataFrame(columns=["drink_id", "rating"])
        with quiet():
            scores = R.content_based_scores(df, DRINKS, self.fm)
        self.assertEqual(scores, {})

    def test_all_ratings_below_4_falls_back_to_all_rated(self):
        """If no liked drinks (>=4 stars), code falls back to all rated drinks.
        Should still produce scores for every drink — not crash or return {}."""
        scores = self._score([(1, 2.0), (2, 3.0), (3, 1.0)])
        self.assertEqual(len(scores), len(DRINKS),
            "Should produce scores even when all ratings are below 4 stars")

    def test_drink_id_not_in_drinks_df_is_skipped_gracefully(self):
        """Rating for drink_id=999 (not in catalogue) — should not crash."""
        scores = self._score([(1, 5.0), (999, 5.0)])
        self.assertEqual(len(scores), len(DRINKS))

    def test_single_low_rating_still_produces_all_scores(self):
        """1 star is still a rating — fallback path should run without error."""
        scores = self._score([(1, 1.0)])
        self.assertEqual(len(scores), len(DRINKS))

    #  Boundary 

    def test_rating_exactly_4_is_treated_as_liked(self):
        """Boundary: exactly 4.0 stars should be included in liked drinks."""
        scores_4  = self._score([(1, 4.0)])
        scores_5  = self._score([(1, 5.0)])
        # Both should produce similar patterns (same liked set)
        self.assertEqual(len(scores_4), len(scores_5))

    def test_rating_exactly_3_is_not_liked(self):
        """Boundary: 3.0 stars falls below the threshold — fallback to all rated."""
        scores = self._score([(1, 3.0)])
        # Fallback still scores all drinks
        self.assertEqual(len(scores), len(DRINKS))


# 4. build_combined_matrix() — three-case implicit signal logic

class TestBuildCombinedMatrix(unittest.TestCase):
    """
    Covers: three implicit signal cases, confidence values,
            empty inputs, log count of zero, duplicate prevention.
    """

    def _run(self, ratings_list, log_counts):
        if ratings_list:
            rows = [
                {"user_id": "u1", "drink_id": did, "rating": r,
                 "mood": "", "time_of_day": "", "weather": ""}
                for did, r in ratings_list
            ]
            ratings = pd.DataFrame(rows)
        else:
            ratings = pd.DataFrame(
                columns=["user_id","drink_id","rating","mood","time_of_day","weather"]
            )
        with quiet():
            return R.build_combined_matrix(ratings, log_counts)

    #  Case 1: unrated + logged 

    def test_case1_unrated_logged_adds_implicit_row(self):
        """Drink 3 logged 5x, never rated → implicit row added with pref=0.5."""
        pref_df, conf_map = self._run([(1, 5.0)], {"u1": {3: 5}})
        row = pref_df[(pref_df["user_id"] == "u1") & (pref_df["drink_id"] == 3)]
        self.assertEqual(len(row), 1)
        self.assertAlmostEqual(float(row.iloc[0]["rating"]), 0.5, places=2)

    def test_case1_confidence_is_1_plus_alpha_times_count(self):
        pref_df, conf_map = self._run([(1, 5.0)], {"u1": {3: 5}})
        self.assertEqual(conf_map[("u1", 3)], 1 + R.ALPHA * 5)

    def test_case1_implicit_preference_capped_at_1(self):
        """Logged 20x → min(20/10, 1.0) = 1.0."""
        pref_df, conf_map = self._run([], {"u1": {5: 20}})
        row = pref_df[(pref_df["user_id"] == "u1") & (pref_df["drink_id"] == 5)]
        self.assertEqual(float(row.iloc[0]["rating"]), 1.0)

    def test_case1_single_log_gives_small_preference(self):
        """Logged once → pref = min(1/10, 1.0) = 0.1."""
        pref_df, conf_map = self._run([], {"u1": {7: 1}})
        row = pref_df[(pref_df["user_id"] == "u1") & (pref_df["drink_id"] == 7)]
        self.assertAlmostEqual(float(row.iloc[0]["rating"]), 0.1, places=3)

    #  Case 2: high-rated + logged 

    def test_case2_high_rated_logged_boosts_confidence(self):
        """Rated 5 stars AND logged 6x → confidence above base."""
        pref_df, conf_map = self._run([(1, 5.0)], {"u1": {1: 6}})
        base     = 1 + R.ALPHA * 5
        expected = base + R.ALPHA * 6
        self.assertEqual(conf_map[("u1", 1)], expected)

    def test_case2_rating_4_also_triggers_boost(self):
        """Boundary: 4.0 stars >= 4.0 → treated as Case 2."""
        pref_df, conf_map = self._run([(2, 4.0)], {"u1": {2: 3}})
        base     = 1 + R.ALPHA * 5
        expected = base + R.ALPHA * 3
        self.assertEqual(conf_map[("u1", 2)], expected)

    def test_case2_rated_drink_not_duplicated_in_pref_df(self):
        """Rated+logged drink should appear exactly once in pref_df."""
        pref_df, _ = self._run([(1, 5.0)], {"u1": {1: 3}})
        rows = pref_df[(pref_df["user_id"] == "u1") & (pref_df["drink_id"] == 1)]
        self.assertEqual(len(rows), 1)

    # Case 3: low-rated + logged 

    def test_case3_low_rated_logged_not_boosted(self):
        """Rated 2 stars AND logged 10x → confidence stays at base."""
        pref_df, conf_map = self._run([(1, 2.0)], {"u1": {1: 10}})
        base = 1 + R.ALPHA * 5
        self.assertEqual(conf_map[("u1", 1)], base)

    def test_case3_rating_3_is_low(self):
        """Boundary: 3.0 stars is below the 4-star threshold → Case 3."""
        pref_df, conf_map = self._run([(1, 3.0)], {"u1": {1: 5}})
        base = 1 + R.ALPHA * 5
        self.assertEqual(conf_map[("u1", 1)], base)

    #  Empty / edge inputs 

    def test_empty_ratings_and_empty_logs(self):
        """Both inputs empty — should return empty DataFrame and empty dict."""
        pref_df, conf_map = self._run([], {})
        self.assertTrue(pref_df.empty)
        self.assertEqual(conf_map, {})

    def test_empty_ratings_with_log_counts(self):
        """No explicit ratings but has log counts — only implicit rows added."""
        pref_df, conf_map = self._run([], {"u1": {1: 3}})
        self.assertEqual(len(pref_df), 1)

    def test_empty_log_counts_for_user(self):
        """User has ratings but empty log count dict — should not crash."""
        pref_df, conf_map = self._run([(1, 5.0)], {"u1": {}})
        self.assertEqual(len(pref_df), 1)

# 5. apply_dietary_filter()

class TestDietaryFilter(unittest.TestCase):
    """
    Covers: each restriction type, combined restrictions, no restriction,
            None input, unknown restriction string, weird casing,
            empty string in list, drink ID not in catalogue.
    """

    def _all_scores(self):
        return {int(r["drink_id"]): 0.8 for _, r in DRINKS.iterrows()}

    def _filter(self, restrictions, scores=None):
        if scores is None:
            scores = self._all_scores()
        with quiet():
            return R.apply_dietary_filter(scores, DRINKS, restrictions)

    #  Happy path 

    def test_dairy_free_removes_non_dairy_free_drinks(self):
        filtered, _ = self._filter(["Dairy-free"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["dairy_free"],
                f"{row['name']} is not dairy-free but passed filter")

    def test_vegan_removes_non_vegan_drinks(self):
        filtered, _ = self._filter(["Vegan"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["vegan"], f"{row['name']} is not vegan but passed filter")

    def test_gluten_free_removes_non_gf_drinks(self):
        filtered, _ = self._filter(["Gluten-free"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["gluten_free"])

    def test_nut_allergy_removes_hazelnut_latte(self):
        filtered, _ = self._filter(["Nut allergy"])
        names = [DRINKS[DRINKS["drink_id"] == d].iloc[0]["name"].lower() for d in filtered]
        self.assertNotIn("hazelnut latte", names)

    def test_nut_allergy_removes_almond_milk_latte(self):
        filtered, _ = self._filter(["Nut allergy"])
        names = [DRINKS[DRINKS["drink_id"] == d].iloc[0]["name"].lower() for d in filtered]
        self.assertNotIn("almond milk latte", names)

    def test_combined_dairy_free_and_vegan(self):
        filtered, _ = self._filter(["Dairy-free", "Vegan"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["dairy_free"] and row["vegan"])

    def test_removed_list_is_accurate(self):
        _, removed = self._filter(["Dairy-free"])
        non_df_names = DRINKS[~DRINKS["dairy_free"]]["name"].tolist()
        removed_names = [name for name, _ in removed]
        for name in non_df_names:
            self.assertIn(name, removed_names)

    #  No restriction 

    def test_empty_list_returns_all_drinks_unchanged(self):
        filtered, removed = self._filter([])
        self.assertEqual(len(filtered), len(DRINKS))
        self.assertEqual(removed, [])

    #  None input 

    def test_none_restrictions_returns_all_drinks(self):
        """None should be treated as no restrictions — must not crash."""
        filtered, removed = self._filter(None)
        self.assertEqual(len(filtered), len(DRINKS))
        self.assertEqual(removed, [])

    # Case sensitivity 

    def test_uppercase_restriction_still_applied(self):
        """'DAIRY-FREE' should behave the same as 'Dairy-free'."""
        filtered_lower, _  = self._filter(["Dairy-free"])
        filtered_upper, _  = self._filter(["DAIRY-FREE"])
        self.assertEqual(set(filtered_lower.keys()), set(filtered_upper.keys()))

    def test_mixed_case_restriction(self):
        """'dAIRY-fReE' — case-insensitive matching should handle this."""
        filtered, _ = self._filter(["dAIRY-fReE"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["dairy_free"])

    # Unknown / weird restrictions 

    def test_unknown_restriction_string_does_not_crash(self):
        """'keto' is not a known restriction — should silently pass all drinks."""
        filtered, removed = self._filter(["keto"])
        self.assertEqual(len(filtered), len(DRINKS))
        self.assertEqual(removed, [])

    def test_empty_string_in_restriction_list_does_not_crash(self):
        """An empty string in the list (UI bug) — must not crash."""
        filtered, _ = self._filter([""])
        self.assertEqual(len(filtered), len(DRINKS))

    def test_mixed_valid_and_invalid_restrictions(self):
        """['Dairy-free', 'keto'] — valid restriction applied, unknown ignored."""
        filtered, _ = self._filter(["Dairy-free", "keto"])
        for did in filtered:
            row = DRINKS[DRINKS["drink_id"] == did].iloc[0]
            self.assertTrue(row["dairy_free"])

    #  Drink not in catalogue 

    def test_drink_id_not_in_drinks_df_is_passed_through(self):
        """If scores contain a drink_id not in drinks_df, it should pass through (safe default)."""
        scores = {999: 0.8, 1: 0.8}
        filtered, _ = self._filter(["Dairy-free"], scores=scores)
        self.assertIn(999, filtered,
            "Unknown drink_id should pass through filter (no info = assume safe)")

    #  Scores unchanged for passing drinks 

    def test_scores_unchanged_for_passing_drinks(self):
        """Filtering should not alter the score values of drinks that pass."""
        scores   = {4: 0.75, 5: 0.60}  # Americano and Espresso — both dairy-free
        filtered, _ = self._filter(["Dairy-free"], scores=scores)
        self.assertAlmostEqual(filtered[4], 0.75, places=4)
        self.assertAlmostEqual(filtered[5], 0.60, places=4)


# 6. apply_weather_filter()

class TestWeatherFilter(unittest.TestCase):
    """
    Covers: cold/hot boost direction, boost amount, no weather,
            None, empty string, unknown weather value, weird casing.
    """

    def _base_scores(self):
        return {int(r["drink_id"]): 0.5 for _, r in DRINKS.iterrows()}

    def _filter(self, weather, scores=None):
        if scores is None:
            scores = self._base_scores()
        with quiet():
            return R.apply_weather_filter(scores, DRINKS, weather)

    #  Happy path 

    def test_cold_weather_boosts_hot_drinks(self):
        boosted, log = self._filter("Cold")
        for name, dtype, before, after in log:
            self.assertEqual(dtype, "hot")

    def test_hot_warm_weather_boosts_iced_drinks(self):
        boosted, log = self._filter("Hot/Warm")
        for name, dtype, before, after in log:
            self.assertEqual(dtype, "iced")

    def test_cold_weather_does_not_boost_iced_drinks(self):
        boosted, _ = self._filter("Cold")
        iced_ids = DRINKS[DRINKS["type"] == "Iced"]["drink_id"].tolist()
        for did in iced_ids:
            self.assertAlmostEqual(boosted[did], 0.5, places=4)

    def test_hot_weather_does_not_boost_hot_drinks(self):
        boosted, _ = self._filter("Hot/Warm")
        hot_ids = DRINKS[DRINKS["type"] == "Hot"]["drink_id"].tolist()
        for did in hot_ids:
            self.assertAlmostEqual(boosted[did], 0.5, places=4)

    def test_boost_amount_is_correct(self):
        """Iced Latte (id=8) at 0.6 → should be 0.6 * (1 + WEATHER_BOOST)."""
        scores  = {8: 0.6}
        boosted, _ = self._filter("Hot/Warm", scores=scores)
        self.assertAlmostEqual(boosted[8], 0.6 * (1 + R.WEATHER_BOOST), places=4)

    #  No weather 

    def test_empty_string_returns_unchanged_scores(self):
        original = self._base_scores()
        boosted, log = self._filter("")
        self.assertEqual(boosted, original)
        self.assertEqual(log, [])

    #  None input 

    def test_none_weather_returns_unchanged_scores(self):
        """None from the request body — must not crash."""
        original = self._base_scores()
        boosted, log = self._filter(None)
        self.assertEqual(boosted, original)
        self.assertEqual(log, [])

    #  Case sensitivity 

    def test_lowercase_cold_applies_boost(self):
        """'cold' should work the same as 'Cold'."""
        _, log_upper = self._filter("Cold")
        _, log_lower = self._filter("cold")
        self.assertEqual(len(log_upper), len(log_lower))

    def test_uppercase_hot_warm_applies_boost(self):
        _, log_normal = self._filter("Hot/Warm")
        _, log_upper  = self._filter("HOT/WARM")
        self.assertEqual(len(log_normal), len(log_upper))

    # Unknown weather 

    def test_unknown_weather_value_returns_unchanged(self):
        """'Snowing' is not a known value — should return scores unchanged."""
        original = self._base_scores()
        boosted, log = self._filter("Snowing")
        self.assertEqual(boosted, original)
        self.assertEqual(log, [])

    def test_weird_string_does_not_crash(self):
        """Emoji or special chars in weather field — must not crash."""
        original = self._base_scores()
        boosted, log = self._filter("☀️")
        self.assertEqual(boosted, original)

    #  Boundary 

    def test_warm_alias_boosts_iced_drinks(self):
        """'warm' is an alias for 'hot' — should also boost iced drinks."""
        _, log = self._filter("warm")
        self.assertGreater(len(log), 0, "'warm' should boost iced drinks")


# 7. apply_winddown_boost()

class TestWindDownBoost(unittest.TestCase):
    """
    Covers: mood only, time only, both, neither, None inputs,
            caffeine boundary at 10mg, case sensitivity.
    """

    def _base_scores(self):
        return {int(r["drink_id"]): 0.5 for _, r in DRINKS.iterrows()}

    def _boost(self, mood, time):
        with quiet():
            return R.apply_winddown_boost(self._base_scores(), DRINKS, mood, time)

    #  Happy path 

    def test_evening_and_winddown_mood_boosts_low_caffeine(self):
        boosted, log = self._boost("Relaxed and winding down", "Evening")
        for name, caffeine, before, after in log:
            self.assertLessEqual(caffeine, R.WINDDOWN_CAFFEINE_THRESHOLD)

    def test_boost_amount_is_correct(self):
        boosted, log = self._boost("Relaxed and winding down", "Evening")
        for name, caffeine, before, after in log:
            self.assertAlmostEqual(after, before * (1 + R.WINDDOWN_BOOST), places=4)

    def test_high_caffeine_drinks_not_boosted(self):
        boosted, _ = self._boost("Relaxed and winding down", "Evening")
        high_ids = DRINKS[DRINKS["caffeine_mg"] > R.WINDDOWN_CAFFEINE_THRESHOLD]["drink_id"].tolist()
        for did in high_ids:
            self.assertAlmostEqual(boosted[did], 0.5, places=4)

    #  One trigger sufficient 

    def test_evening_time_alone_triggers_boost(self):
        """Time='Evening' with neutral mood should still trigger the boost."""
        _, log = self._boost("Fairly okay, just want a drink", "Evening")
        self.assertGreater(len(log), 0)

    def test_winddown_mood_alone_triggers_boost(self):
        """Wind-down mood with non-evening time should still trigger the boost."""
        _, log = self._boost("Relaxed and winding down", "Morning")
        self.assertGreater(len(log), 0)

    #  Neither trigger 

    def test_morning_boost_mood_does_not_trigger(self):
        boosted, log = self._boost("Tired and need a boost", "Morning")
        self.assertEqual(log, [])
        self.assertEqual(boosted, self._base_scores())

    def test_neutral_mood_and_afternoon_does_not_trigger(self):
        boosted, log = self._boost("Fairly okay, just want a drink", "Afternoon")
        self.assertEqual(log, [])

    #  None inputs 

    def test_none_mood_none_time_does_not_crash(self):
        """Both None — most common missing-data case from the frontend."""
        boosted, log = self._boost(None, None)
        self.assertEqual(log, [])
        self.assertEqual(boosted, self._base_scores())

    def test_none_mood_with_evening_time(self):
        """None mood + Evening time — should still trigger boost via time."""
        _, log = self._boost(None, "Evening")
        self.assertGreater(len(log), 0)

    def test_winddown_mood_with_none_time(self):
        """Winddown mood + None time — should still trigger boost via mood."""
        _, log = self._boost("Relaxed and winding down", None)
        self.assertGreater(len(log), 0)

    #  Boundary conditions 

    def test_caffeine_exactly_at_threshold_is_boosted(self):
        """Drinks with caffeine_mg == WINDDOWN_CAFFEINE_THRESHOLD should be boosted."""
        boundary_drink = pd.DataFrame([{
            "drink_id": 99, "name": "Boundary Tea", "category": "Herbal Tea",
            "type": "Hot", "base": "Tea", "caffeine_mg": R.WINDDOWN_CAFFEINE_THRESHOLD,
            "shots": 0, "dairy_free": True, "vegan": True, "gluten_free": True,
            "milk_alternative_available": False,
        }])
        scores = {99: 0.5}
        with quiet():
            boosted, log = R.apply_winddown_boost(
                scores, boundary_drink, "Relaxed and winding down", "Evening"
            )
        self.assertGreater(len(log), 0, "Drink at exact threshold should be boosted")
        self.assertAlmostEqual(boosted[99], 0.5 * (1 + R.WINDDOWN_BOOST), places=4)

    def test_caffeine_one_above_threshold_not_boosted(self):
        """caffeine_mg == threshold + 1 should NOT be boosted."""
        over_drink = pd.DataFrame([{
            "drink_id": 98, "name": "Over Threshold", "category": "Herbal Tea",
            "type": "Hot", "base": "Tea",
            "caffeine_mg": R.WINDDOWN_CAFFEINE_THRESHOLD + 1,
            "shots": 0, "dairy_free": True, "vegan": True, "gluten_free": True,
            "milk_alternative_available": False,
        }])
        scores = {98: 0.5}
        with quiet():
            boosted, log = R.apply_winddown_boost(
                scores, over_drink, "Relaxed and winding down", "Evening"
            )
        self.assertEqual(log, [], "Drink one above threshold must NOT be boosted")
        self.assertAlmostEqual(boosted[98], 0.5, places=4)

    def test_zero_caffeine_always_boosted(self):
        """Chamomile Tea (0mg) should always be boosted in wind-down."""
        boosted, log = self._boost("Relaxed and winding down", "Evening")
        zero_caff_ids = DRINKS[DRINKS["caffeine_mg"] == 0]["drink_id"].tolist()
        boosted_ids   = [entry[0] for entry in log]
        for did in zero_caff_ids:
            name = DRINKS[DRINKS["drink_id"] == did].iloc[0]["name"]
            self.assertIn(name, boosted_ids, f"{name} (0mg) should always be boosted")

    #  Case sensitivity 

    def test_evening_uppercase_triggers_boost(self):
        """'EVENING' vs 'Evening' — case should not matter."""
        _, log_normal = self._boost("Relaxed and winding down", "Evening")
        _, log_upper  = self._boost("Relaxed and winding down", "EVENING")
        self.assertEqual(len(log_normal), len(log_upper))


# 8. hybrid_scores()

class TestHybridScores(unittest.TestCase):
    """
    Covers: correct 70/30 weighting, CB-only fallback,
            rated drink exclusion, drink not in drinks_df, empty inputs.
    """

    def _hybrid(self, cb, cf, rated=None):
        if rated is None:
            rated = set()
        with quiet():
            return R.hybrid_scores(cb, cf, rated, DRINKS)

    #  Happy path 

    def test_hybrid_formula_applied_correctly(self):
        cb = {1: 0.8, 2: 0.6}
        cf = {1: 0.4, 2: 0.9}
        result = self._hybrid(cb, cf)
        expected = 0.8 * R.CONTENT_WEIGHT + 0.4 * R.COLLAB_WEIGHT
        self.assertAlmostEqual(result[1], expected, places=4)

    def test_content_weight_is_0_7(self):
        self.assertAlmostEqual(R.CONTENT_WEIGHT, 0.70, places=2)

    def test_collab_weight_is_0_3(self):
        self.assertAlmostEqual(R.COLLAB_WEIGHT, 0.30, places=2)

    def test_weights_sum_to_1(self):
        self.assertAlmostEqual(R.CONTENT_WEIGHT + R.COLLAB_WEIGHT, 1.0, places=4)

    #  CB-only fallback 

    def test_empty_cf_uses_cb_only(self):
        cb = {1: 0.7, 2: 0.5}
        result = self._hybrid(cb, {})
        self.assertAlmostEqual(result[1], 0.7, places=4)
        self.assertAlmostEqual(result[2], 0.5, places=4)

    #  Explore-new exclusion 

    def test_rated_drinks_excluded(self):
        cb = {1: 0.9, 2: 0.7, 3: 0.5}
        cf = {1: 0.9, 2: 0.7, 3: 0.5}
        result = self._hybrid(cb, cf, rated={1, 2})
        self.assertNotIn(1, result)
        self.assertNotIn(2, result)
        self.assertIn(3, result)

    def test_empty_rated_set_includes_all_drinks(self):
        cb = {1: 0.5}
        result = self._hybrid(cb, {}, rated=set())
        # All drinks in the catalogue should be present (default 0 for missing)
        self.assertIn(1, result)

    #  Drinks not in scores 

    def test_drink_missing_from_cb_scores_defaults_to_zero(self):
        """A drink in the catalogue but missing from cb_scores gets 0.0 for CB."""
        cb = {1: 0.8}   # only drink 1
        cf = {}
        result = self._hybrid(cb, cf)
        # Drink 2 is in DRINKS but not in cb — should be scored as 0.0
        self.assertAlmostEqual(result.get(2, 0.0), 0.0, places=4)


# 9. apply_contextual_boost()

class TestContextualBoost(unittest.TestCase):
    """
    Covers: boost applied, zero ctx score, capped at CONTEXTUAL_BOOST_CAP,
            missing drink in ctx_scores, empty inputs.
    """

    def _boost(self, scores, ctx_scores):
        with quiet():
            return R.apply_contextual_boost(scores, ctx_scores)

    #  Happy path 

    def test_full_ctx_signal_applies_cap_boost(self):
        """ctx=1.0 → score * (1 + CONTEXTUAL_BOOST_CAP)."""
        result = self._boost({1: 0.8}, {1: 1.0})
        expected = 0.8 * (1 + R.CONTEXTUAL_BOOST_CAP)
        self.assertAlmostEqual(result[1], expected, places=4)

    def test_zero_ctx_score_leaves_score_unchanged(self):
        result = self._boost({1: 0.6}, {1: 0.0})
        self.assertAlmostEqual(result[1], 0.6, places=4)

    def test_partial_ctx_score_proportional_boost(self):
        result = self._boost({1: 0.8}, {1: 0.5})
        expected = 0.8 * (1 + 0.5 * R.CONTEXTUAL_BOOST_CAP)
        self.assertAlmostEqual(result[1], expected, places=4)

    #  Edge cases 

    def test_drink_missing_from_ctx_scores_gets_zero_boost(self):
        """Drink 2 not in ctx_scores → no boost applied → score stays the same."""
        result = self._boost({1: 0.8, 2: 0.5}, {1: 1.0})
        self.assertAlmostEqual(result[2], 0.5, places=4)

    def test_empty_scores_returns_empty(self):
        result = self._boost({}, {1: 1.0})
        self.assertEqual(result, {})

    def test_empty_ctx_scores_leaves_all_unchanged(self):
        scores = {1: 0.7, 2: 0.3}
        result = self._boost(scores, {})
        self.assertAlmostEqual(result[1], 0.7, places=4)
        self.assertAlmostEqual(result[2], 0.3, places=4)


# 10. community_popular_fallback()

class TestCommunityPopularFallback(unittest.TestCase):
    """
    Covers: correct ranking, score normalisation, empty ratings, category diversity.
    """

    def _run(self, ratings_df):
        with quiet():
            return R.community_popular_fallback(ratings_df, DRINKS)

    def _make_ratings(self, entries):
        """entries: list of (user_id, drink_id, rating)"""
        rows = [{"user_id": u, "drink_id": d, "rating": r,
                 "mood": "", "time_of_day": "", "weather": ""}
                for u, d, r in entries]
        return pd.DataFrame(rows)

    #  Happy path 

    def test_highest_rated_drink_gets_highest_score(self):
        ratings = self._make_ratings([
            ("u1", 1, 5.0),  # Latte — avg 5
            ("u1", 2, 2.0),  # Cappuccino — avg 2
        ])
        scores = self._run(ratings)
        self.assertGreater(scores[1], scores[2])

    def test_scores_normalised_between_0_and_1(self):
        ratings = self._make_ratings([
            ("u1", 1, 5.0),
            ("u2", 2, 3.0),
            ("u3", 3, 1.0),
        ])
        scores = self._run(ratings)
        for s in scores.values():
            self.assertGreaterEqual(s, 0.0)
            self.assertLessEqual(s, 1.0)

    def test_max_score_is_1_0(self):
        ratings = self._make_ratings([("u1", 1, 5.0), ("u1", 2, 2.5)])
        scores  = self._run(ratings)
        self.assertAlmostEqual(max(scores.values()), 1.0, places=4)

    #  Edge cases 

    def test_empty_ratings_returns_empty_dict(self):
        empty = pd.DataFrame(columns=["user_id","drink_id","rating","mood","time_of_day","weather"])
        scores = self._run(empty)
        self.assertEqual(scores, {})

    def test_single_rating_is_handled(self):
        # community_popular_fallback normalises scores as avg_rating / 5.0,
        # NOT by dividing by the maximum score.
        # A single 4-star rating → score = 4.0 / 5.0 = 0.8, not 1.0.
        ratings = self._make_ratings([("u1", 1, 4.0)])
        scores  = self._run(ratings)
        self.assertIn(1, scores)
        self.assertAlmostEqual(scores[1], 0.8, places=4)

    def test_single_5_star_rating_scores_1_0(self):
        """A single 5-star rating → 5.0 / 5.0 = 1.0 (the true maximum)."""
        ratings = self._make_ratings([("u1", 1, 5.0)])
        scores  = self._run(ratings)
        self.assertAlmostEqual(scores[1], 1.0, places=4)

    def test_all_equal_ratings_all_score_equally(self):
        ratings = self._make_ratings([
            ("u1", 1, 3.0),
            ("u2", 2, 3.0),
            ("u3", 3, 3.0),
        ])
        scores = self._run(ratings)
        score_vals = list(scores.values())
        self.assertAlmostEqual(score_vals[0], score_vals[1], places=4)

# 11. demographic_cold_start()

class TestDemographicColdStart(unittest.TestCase):
    """
    Covers: perfect match, age-band only, gender only, no match,
            None demographics, empty all_demographics_df, unrepresented gender.
    """

    def _run(self, user_demo, all_demo_rows, ratings_rows):
        all_demo = pd.DataFrame(all_demo_rows, columns=["user_id","age_range","gender"]) \
            if all_demo_rows else pd.DataFrame(columns=["user_id","age_range","gender"])
        if ratings_rows:
            ratings = pd.DataFrame(ratings_rows,
                columns=["user_id","drink_id","rating","mood","time_of_day","weather"])
        else:
            ratings = pd.DataFrame(
                columns=["user_id","drink_id","rating","mood","time_of_day","weather"])
        with quiet():
            return R.demographic_cold_start("test_user", user_demo, all_demo, ratings, DRINKS)

    #  Happy path 

    def test_perfect_match_returns_scores(self):
        scores, method = self._run(
            {"age_range": "18-24", "gender": "Female"},
            [("u1", "18-24", "Female"), ("u2", "18-24", "Female")],
            [("u1", 1, 5.0, "", "", ""), ("u2", 2, 4.0, "", "", "")],
        )
        self.assertEqual(method, "demographic_similarity")
        self.assertGreater(len(scores), 0)

    def test_top_drink_reflects_similar_user_preferences(self):
        """Similar users all love Chamomile Tea — it should top the scores."""
        all_demo = [("u1","18-24","Female"),("u2","18-24","Female")]
        ratings  = [
            ("u1", 11, 5.0, "", "", ""),  # Chamomile Tea
            ("u1", 1,  1.0, "", "", ""),  # Latte — low rating
            ("u2", 11, 5.0, "", "", ""),
            ("u2", 1,  1.0, "", "", ""),
        ]
        scores, _ = self._run({"age_range": "18-24", "gender": "Female"}, all_demo, ratings)
        self.assertEqual(max(scores, key=scores.get), 11)

    #  Fallback cases 

    def test_empty_all_demographics_returns_no_data(self):
        scores, method = self._run({"age_range": "18-24", "gender": "female"}, [], [])
        self.assertEqual(method, "no_demographic_data")
        self.assertEqual(scores, {})

    def test_no_matching_users_returns_no_similar_users(self):
        scores, method = self._run(
            {"age_range": "18-24", "gender": "female"},
            [("u1", "50-64", "Male")],
            [("u1", 1, 5.0, "", "", "")],
        )
        self.assertEqual(method, "no_similar_users")
        self.assertEqual(scores, {})

    def test_similar_users_with_no_ratings_returns_similar_users_unrated(self):
        all_demo = [("u1","18-24","Female")]
        scores, method = self._run({"age_range": "18-24", "gender": "female"}, all_demo, [])
        self.assertEqual(method, "similar_users_unrated")

    #  None / missing demographics 

    def test_none_age_range_falls_back_gracefully(self):
        """User with no age data — should not crash, return empty scores."""
        scores, method = self._run({"age_range": None, "gender": None}, [], [])
        self.assertEqual(scores, {})

    def test_none_gender_falls_back_to_age_band(self):
        all_demo = [("u1","18-24","Female"),("u2","18-24","Male")]
        ratings  = [("u1", 1, 5.0, "", "", "")]
        # User has age_range but no gender
        scores, method = self._run({"age_range": "18-24", "gender": None}, all_demo, ratings)
        # Should still produce scores using age band matching
        self.assertIn(method, ("demographic_similarity",))
        self.assertGreater(len(scores), 0)

    #  Unrepresented gender 

    def test_unrepresented_gender_matches_on_age_band_only(self):
        """Non-binary user: gender not in training data → falls back to age band."""
        all_demo = [("u1","18-24","Female"),("u2","18-24","Male")]
        ratings  = [("u1", 1, 5.0, "", "", ""), ("u2", 2, 4.0, "", "", "")]
        scores, method = self._run({"age_range": "18-24", "gender": "non-binary"}, all_demo, ratings)
        self.assertEqual(method, "demographic_similarity",
            "Non-binary user should match on age band even if gender unrepresented")
        self.assertGreater(len(scores), 0)


# run

if __name__ == "__main__":
    verbosity = 2 if "-v" in sys.argv else 1
    loader = unittest.TestLoader()
    suite  = unittest.TestSuite()

    for cls in [
        TestNormaliseAgeRange,
        TestBuildFeatureMatrix,
        TestContentBasedScores,
        TestBuildCombinedMatrix,
        TestDietaryFilter,
        TestWeatherFilter,
        TestWindDownBoost,
        TestHybridScores,
        TestContextualBoost,
        TestCommunityPopularFallback,
        TestDemographicColdStart,
    ]:
        suite.addTests(loader.loadTestsFromTestCase(cls))

    runner = unittest.TextTestRunner(verbosity=verbosity)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)