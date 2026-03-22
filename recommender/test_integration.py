"""
Aroma — Integration Tests
===========================
Tests the full request-response cycle across the Node.js API and Python
recommender engine. Both servers must be running before executing these tests.

Requirements:
    pip install requests --break-system-packages

Run with:
    # Terminal 1
    cd backend && node server.js

    # Terminal 2
    cd backend && python recommender.py

    # Terminal 3
    python test_integration.py
    python test_integration.py -v    # verbose

What is tested:
    - Full HTTP round-trips from API → Python engine → response
    - Correct data flow between Node.js and Python
    - Database reads returning real data
    - All pipeline modes: cold start, warm start, full hybrid
    - All dietary filters end-to-end
    - Contextual, weather, and wind-down boosts end-to-end
    - Error handling across the full stack
"""

import sys
import json
import time
import requests
import unittest

# ─── CONFIG ───────────────────────────────────────────────────────────────────
# The script tries localhost first, then your network IP as a fallback.
# If your Node server is bound to a specific IP rather than 0.0.0.0,
# update NODE_BASE manually to match (e.g. "http://10.187.224.94:3000").

NODE_BASE   = "http://localhost:3000"
PYTHON_BASE = "http://localhost:5001"

# Real user IDs from the database
USER_WITH_RATINGS  = "eFijJwNdAae9koCODYmRih4Ij0H2"   # 26 ratings
USER_NO_RATINGS    = "integration_cold_start_test_000"   # fake — always triggers cold start
USER_FAKE          = "integration_test_fake_user_99999"  # never in DB

TIMEOUT = 120   # seconds — WMF training can take a moment


# ─── COLOUR OUTPUT ────────────────────────────────────────────────────────────

RESET = "\033[0m"; GREEN = "\033[92m"; RED = "\033[91m"; BOLD = "\033[1m"; DIM = "\033[2m"


# ─── SERVER PROBE ─────────────────────────────────────────────────────────────

def probe_node(base: str) -> bool:
    """
    Node.js server has no /health route — probe /api/drinks instead
    which is a lightweight GET that always returns quickly.
    """
    try:
        r = requests.get(f"{base}/api/drinks", timeout=5)
        return r.status_code in (200, 304)
    except Exception:
        return False

def probe_python(base: str) -> bool:
    try:
        r = requests.get(f"{base}/health", timeout=5)
        return r.status_code == 200
    except Exception:
        return False

def resolve_node_base() -> str:
    """
    Try localhost first (works when running on the same machine).
    Fall back to the network IP detected from the recommender startup log.
    """
    if probe_node("http://localhost:3000"):
        return "http://localhost:3000"
    # Common fallback — matches the IP shown in your server startup output
    fallback = "http://10.187.224.94:3000"
    if probe_node(fallback):
        print(f"{DIM}  [Config] localhost:3000 not reachable, using {fallback}{RESET}")
        return fallback
    return "http://localhost:3000"  # return default so error message is clear


# ─── BASE TEST CASE ───────────────────────────────────────────────────────────

class AromaIntegrationTest(unittest.TestCase):
    """Base class — checks both servers are reachable before each test."""

    @classmethod
    def setUpClass(cls):
        cls._check_servers()

    @classmethod
    def _check_servers(cls):
        global NODE_BASE
        NODE_BASE = resolve_node_base()

        errors = []

        if not probe_python(PYTHON_BASE):
            errors.append(
                f"  Python recommender not reachable at {PYTHON_BASE}\n"
                f"  Make sure you ran: python recommender.py"
            )

        if not probe_node(NODE_BASE):
            errors.append(
                f"  Node.js API not reachable at {NODE_BASE}\n"
                f"  Make sure you ran: node server.js"
            )

        if errors:
            print(f"\n{RED}Cannot run integration tests — servers not running:{RESET}")
            for e in errors:
                print(f"{RED}{e}{RESET}")
            print(
                f"\nOpen two separate terminals in your backend folder and run:\n"
                f"  Terminal 1:  node server.js\n"
                f"  Terminal 2:  python recommender.py\n"
                f"Then run this script in a third terminal.\n"
            )
            sys.exit(1)

        print(f"{GREEN}  Both servers reachable — running tests against:{RESET}")
        print(f"  Node.js  : {NODE_BASE}")
        print(f"  Python   : {PYTHON_BASE}\n")

    def recommend(self, payload, via_node=True):
        """Helper — send a recommendation request via Node or directly to Python."""
        url = f"{NODE_BASE}/api/recommendations" if via_node else f"{PYTHON_BASE}/recommend"
        r   = requests.post(url, json=payload, timeout=TIMEOUT)
        return r

    def assertRecommendations(self, recs, count=3):
        self.assertEqual(len(recs), count,
            f"Expected {count} recommendations, got {len(recs)}")
        for rec in recs:
            required = ["drink_id","name","category","type","caffeine_mg",
                        "dairy_free","vegan","gluten_free","score","match_percent"]
            for field in required:
                self.assertIn(field, rec, f"Field '{field}' missing from recommendation")
            self.assertGreaterEqual(rec["match_percent"], 0)
            self.assertLessEqual(rec["match_percent"], 100)


# ═══════════════════════════════════════════════════════════════════════════════
# PYTHON ENGINE INTEGRATION TESTS (direct)
# ═══════════════════════════════════════════════════════════════════════════════

class TestPythonEngineHealth(AromaIntegrationTest):

    def test_health_endpoint_returns_ok(self):
        r = requests.get(f"{PYTHON_BASE}/health", timeout=5)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "ok")


class TestColdStartIntegration(AromaIntegrationTest):
    """User with 0 ratings — demographic cold start path."""

    BASE_PAYLOAD = {
        "user_id":              USER_NO_RATINGS,
        "mood":                 "Fairly okay, just want a drink",
        "time_of_day":          "Morning",
        "weather":              "Cold",
        "dietary_restrictions": [],
        "explore_new":          False,
    }

    def test_returns_3_recommendations(self):
        r = self.recommend(self.BASE_PAYLOAD, via_node=False)
        self.assertEqual(r.status_code, 200)
        recs = r.json().get("recommendations", [])
        self.assertRecommendations(recs)

    def test_mode_is_cold_start(self):
        r    = self.recommend(self.BASE_PAYLOAD, via_node=False)
        mode = r.json().get("mode")
        # cold_start = demographic data found; community_popular = no demo data
        # Both are valid cold-start paths for a user with 0 ratings
        self.assertIn(mode, ("cold_start", "community_popular"),
            f"User with 0 ratings should use a cold start path, got: {mode}")

    def test_num_user_ratings_is_zero(self):
        r = self.recommend(self.BASE_PAYLOAD, via_node=False)
        n = r.json().get("num_user_ratings", -1)
        self.assertEqual(n, 0,
            f"Fake user should have 0 ratings, got {n}. "
            f"If this fails the fake user ID may have acquired ratings — change USER_NO_RATINGS.")

    def test_cold_start_with_dairy_free_returns_valid_drinks(self):
        payload = {**self.BASE_PAYLOAD, "dietary_restrictions": ["Dairy-free"]}
        r    = self.recommend(payload, via_node=False)
        recs = r.json().get("recommendations", [])
        self.assertRecommendations(recs)
        for rec in recs:
            self.assertTrue(rec["dairy_free"],
                f"Cold start returned non-dairy-free drink: {rec['name']}")

    def test_fake_user_falls_back_gracefully(self):
        payload = {**self.BASE_PAYLOAD, "user_id": USER_FAKE}
        r = self.recommend(payload, via_node=False)
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("error", r.json())
        recs = r.json().get("recommendations", [])
        self.assertGreaterEqual(len(recs), 1)


class TestFullHybridIntegration(AromaIntegrationTest):
    """User with 26 ratings — full hybrid WMF path."""

    BASE_PAYLOAD = {
        "user_id":              USER_WITH_RATINGS,
        "mood":                 "Fairly okay, just want a drink",
        "time_of_day":          "Afternoon",
        "weather":              "Cold",
        "dietary_restrictions": [],
        "explore_new":          False,
    }

    def test_mode_is_hybrid_wmf(self):
        r    = self.recommend(self.BASE_PAYLOAD, via_node=False)
        mode = r.json().get("mode")
        self.assertEqual(mode, "hybrid_wmf")

    def test_returns_3_recommendations(self):
        r    = self.recommend(self.BASE_PAYLOAD, via_node=False)
        recs = r.json().get("recommendations", [])
        self.assertRecommendations(recs)

    def test_score_breakdown_present(self):
        r    = self.recommend(self.BASE_PAYLOAD, via_node=False)
        recs = r.json().get("recommendations", [])
        for rec in recs:
            self.assertIn("score_breakdown", rec)
            self.assertIn("content",       rec["score_breakdown"])
            self.assertIn("collaborative", rec["score_breakdown"])

    def test_collaborative_score_non_zero_for_full_hybrid(self):
        """WMF is active — at least some recs should have a CF component."""
        r    = self.recommend(self.BASE_PAYLOAD, via_node=False)
        recs = r.json().get("recommendations", [])
        cf_scores = [rec["score_breakdown"]["collaborative"] for rec in recs]
        self.assertTrue(any(s > 0 for s in cf_scores),
            "At least one rec should have a non-zero collaborative score in full hybrid mode")

    def test_num_user_ratings_at_least_5(self):
        r = self.recommend(self.BASE_PAYLOAD, via_node=False)
        self.assertGreaterEqual(r.json().get("num_user_ratings", 0), 5)


class TestDietaryIntegration(AromaIntegrationTest):
    """Dietary filters applied end-to-end on real data."""

    def recommend_with_diet(self, restrictions):
        r = self.recommend({
            "user_id":              USER_WITH_RATINGS,
            "mood":                 "Fairly okay, just want a drink",
            "time_of_day":          "Afternoon",
            "weather":              "Cold",
            "dietary_restrictions": restrictions,
            "explore_new":          False,
        }, via_node=False)
        return r.json().get("recommendations", [])

    def test_dairy_free_filter(self):
        for rec in self.recommend_with_diet(["Dairy-free"]):
            self.assertTrue(rec["dairy_free"], f"{rec['name']} is not dairy-free")

    def test_vegan_filter(self):
        for rec in self.recommend_with_diet(["Vegan"]):
            self.assertTrue(rec["vegan"], f"{rec['name']} is not vegan")

    def test_gluten_free_filter(self):
        for rec in self.recommend_with_diet(["Gluten-free"]):
            self.assertTrue(rec["gluten_free"], f"{rec['name']} is not gluten-free")

    def test_combined_dairy_free_and_vegan(self):
        for rec in self.recommend_with_diet(["Dairy-free", "Vegan"]):
            self.assertTrue(rec["dairy_free"] and rec["vegan"],
                f"{rec['name']} failed combined dairy-free + vegan filter")

    def test_nut_allergy_no_hazelnut(self):
        for rec in self.recommend_with_diet(["Nut allergy"]):
            self.assertNotIn("hazelnut", rec["name"].lower())
            self.assertNotIn("almond",   rec["name"].lower())

    def test_all_restrictions_combined_returns_results(self):
        recs = self.recommend_with_diet(["Dairy-free","Vegan","Gluten-free","Nut allergy"])
        self.assertGreaterEqual(len(recs), 1,
            "Should find at least 1 drink satisfying all restrictions")
        for rec in recs:
            self.assertTrue(rec["dairy_free"])
            self.assertTrue(rec["vegan"])
            self.assertTrue(rec["gluten_free"])


class TestContextualBoostIntegration(AromaIntegrationTest):
    """Weather and wind-down boosts applied end-to-end."""

    def test_hot_weather_includes_iced_drink(self):
        r = self.recommend({
            "user_id":              USER_WITH_RATINGS,
            "mood":                 "Fairly okay, just want a drink",
            "time_of_day":          "Afternoon",
            "weather":              "Hot/Warm",
            "dietary_restrictions": [],
            "explore_new":          False,
        }, via_node=False)
        recs  = r.json().get("recommendations", [])
        types = [rec["type"] for rec in recs]
        self.assertIn("Iced", types,
            "Hot/Warm weather should boost at least one iced drink into top 3")

    def test_wind_down_includes_low_caffeine(self):
        r = self.recommend({
            "user_id":              USER_WITH_RATINGS,
            "mood":                 "Relaxed and winding down",
            "time_of_day":          "Evening",
            "weather":              "Cold",
            "dietary_restrictions": [],
            "explore_new":          False,
        }, via_node=False)
        recs      = r.json().get("recommendations", [])
        caffeine  = [rec["caffeine_mg"] for rec in recs]
        self.assertTrue(any(c <= 70 for c in caffeine),
            "Evening wind-down should surface at least 1 low-caffeine drink")

    def test_explore_new_mode(self):
        r = self.recommend({
            "user_id":              USER_WITH_RATINGS,
            "mood":                 "Fairly okay, just want a drink",
            "time_of_day":          "Morning",
            "weather":              "Cold",
            "dietary_restrictions": [],
            "explore_new":          True,
        }, via_node=False)
        self.assertEqual(r.status_code, 200)
        recs = r.json().get("recommendations", [])
        self.assertRecommendations(recs)


# ═══════════════════════════════════════════════════════════════════════════════
# NODE.JS API INTEGRATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestNodeLogsAPI(AromaIntegrationTest):
    """Node.js /api/logs routes — read from real DB."""

    def test_get_logs_for_real_user_returns_array(self):
        r = requests.get(f"{NODE_BASE}/api/logs/{USER_WITH_RATINGS}", timeout=10)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_get_logs_for_new_user_returns_empty_array(self):
        r = requests.get(f"{NODE_BASE}/api/logs/{USER_FAKE}", timeout=10)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), [])

    def test_log_entry_has_required_fields(self):
        r    = requests.get(f"{NODE_BASE}/api/logs/{USER_WITH_RATINGS}", timeout=10)
        logs = r.json()
        if logs:
            for field in ["log_id","drink_name","caffeine_amount","timestamp"]:
                self.assertIn(field, logs[0], f"Log entry missing field: {field}")


class TestNodeRatingsAPI(AromaIntegrationTest):
    """Node.js /api/ratings routes — read from real DB."""

    def test_get_user_ratings_returns_array(self):
        r = requests.get(f"{NODE_BASE}/api/ratings/user/{USER_WITH_RATINGS}", timeout=10)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_get_ratings_for_unknown_user_returns_empty(self):
        r = requests.get(f"{NODE_BASE}/api/ratings/user/{USER_FAKE}", timeout=10)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), [])

    def test_community_averages_endpoint_returns_data(self):
        r = requests.get(f"{NODE_BASE}/api/ratings/averages", timeout=10)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)
        self.assertGreater(len(r.json()), 0)


class TestNodeStatisticsAPI(AromaIntegrationTest):
    """Node.js /api/statistics routes."""

    def test_user_stats_returns_required_fields(self):
        r = requests.get(f"{NODE_BASE}/api/statistics/user/{USER_WITH_RATINGS}", timeout=10)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        for field in ["caffeine_by_day","total_drinks_this_week","most_logged_drink"]:
            self.assertIn(field, body, f"Stats response missing field: {field}")

    def test_community_stats_returns_required_fields(self):
        r = requests.get(f"{NODE_BASE}/api/statistics/community", timeout=10)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        for field in ["total_community_logs","most_popular_drink","top_rated_drinks"]:
            self.assertIn(field, body, f"Community stats missing field: {field}")


class TestNodeRecommendationsProxy(AromaIntegrationTest):
    """Node.js /api/recommendations — full proxy chain Node → Python → DB → response."""

    def test_full_chain_returns_recommendations(self):
        r = requests.post(f"{NODE_BASE}/api/recommendations", json={
            "user_id":              USER_WITH_RATINGS,
            "mood":                 "Fairly okay, just want a drink",
            "time_of_day":          "Morning",
            "weather":              "Cold",
            "dietary_restrictions": [],
            "explore_new":          False,
        }, timeout=TIMEOUT)
        self.assertEqual(r.status_code, 200)
        recs = r.json().get("recommendations", [])
        self.assertRecommendations(recs)

    def test_missing_user_id_returns_400(self):
        r = requests.post(f"{NODE_BASE}/api/recommendations", json={
            "mood": "Morning",
        }, timeout=10)
        self.assertEqual(r.status_code, 400)

    def test_response_time_under_threshold(self):
        """Recommendation pipeline should complete within 90 seconds."""
        start = time.time()
        requests.post(f"{NODE_BASE}/api/recommendations", json={
            "user_id":              USER_WITH_RATINGS,
            "mood":                 "Fairly okay, just want a drink",
            "time_of_day":          "Morning",
            "weather":              "Cold",
            "dietary_restrictions": [],
            "explore_new":          False,
        }, timeout=TIMEOUT)
        elapsed = time.time() - start
        self.assertLess(elapsed, 90,
            f"Recommendation took {elapsed:.1f}s — should be under 90s")


# ─── RUN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    verbosity = 2 if "-v" in sys.argv else 1
    loader    = unittest.TestLoader()
    suite     = unittest.TestSuite()

    for cls in [
        TestPythonEngineHealth,
        TestColdStartIntegration,
        TestFullHybridIntegration,
        TestDietaryIntegration,
        TestContextualBoostIntegration,
        TestNodeLogsAPI,
        TestNodeRatingsAPI,
        TestNodeStatisticsAPI,
        TestNodeRecommendationsProxy,
    ]:
        suite.addTests(loader.loadTestsFromTestCase(cls))

    print(f"\n{BOLD}Aroma — Integration Test Suite{RESET}")
    print(f"{DIM}Requires both servers running: node server.js + python recommender.py{RESET}\n")

    result = unittest.TextTestRunner(verbosity=verbosity).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)