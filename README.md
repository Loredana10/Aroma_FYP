# Aroma — Coffee Recommender & Tracker App

Aroma is a cross-platform mobile lifestyle application for coffee lovers. It provides personalised coffee drink recommendations based on user preferences, mood, time of day, weather, and dietary restrictions. The app also lets users log their daily coffee intake, track caffeine consumption against a personal limit, and discover nearby cafés on an interactive map.

The recommendation engine uses a hybrid filtering approach, combining content-based filtering (drink attributes) and collaborative filtering (Weighted Matrix Factorisation with implicit signals) across a three-service microservices architecture deployed on Railway.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile App | React Native, Expo, TypeScript |
| Backend API | Node.js, Express.js |
| Recommendation Engine | Python, Flask, scikit-learn |
| Database | PostgreSQL (hosted on Railway) |
| Authentication | Firebase Auth (email/password + Google) |
| Maps | Google Maps API |
| Deployment | Railway (backend + recommender + database) |

---

## Project Structure

```
AROMA_FYP/
├── app/                        # React Native screens (Expo Router)
│   ├── (auth)/                 # Sign in, sign up, complete profile
│   └── (tabs)/                 # Home, log, explore, profile
├── backend/                    # Node.js Express API
│   ├── routes/                 # API route handlers
│   ├── __mocks__/              # Jest mock for database
│   └── test_unit_api.js        # Node.js unit tests
├── recommender/                # Python Flask recommendation engine
│   ├── recommender.py          # Full hybrid pipeline
│   ├── tests/                  # pytest unit + integration + scenario tests
│   ├── requirements.txt
│   └── runtime.txt
├── constants/                  # Shared theme, API URL, mascots
├── contexts/                   # Firebase auth context
├── services/                   # Push notifications
└── .github/workflows/          # GitHub Actions CI (runs tests on push)
```

---

## Prerequisites

Before running the project, make sure you have the following installed:

- [Node.js](https://nodejs.org/) v18 or higher
- [Python](https://www.python.org/) 3.11
- [Expo CLI](https://docs.expo.dev/): `npm install -g expo-cli`
- [Expo Go](https://expo.dev/client) app on your phone (for running on a physical device)

---

## Setup & Running Locally

### 1. Clone the repository

```bash
git clone <repo-url>
cd AROMA_FYP
```

### 2. Install React Native dependencies

```bash
npm install
```

### 3. Install backend dependencies

```bash
cd backend
npm install
cd ..
```

### 4. Install Python recommendation engine dependencies

```bash
cd recommender
pip install -r requirements.txt
cd ..
```

### 5. Environment variables

The `.env` file in `/backend` and `api.env` at the root are already configured to point to the live Railway PostgreSQL database and deployed services. No additional database setup is required.

---

## Running the Services

You will need **three terminal windows** running simultaneously.

### Terminal 1 — React Native app

```bash
npx expo start
```

Scan the QR code with Expo Go on your phone, or press `a` for Android emulator / `i` for iOS simulator.

### Terminal 2 — Node.js backend API

```bash
cd backend
node server.js
```

The API runs on `http://localhost:3000`.

### Terminal 3 — Python recommendation engine

```bash
cd recommender
python recommender.py
```

The recommendation engine runs on `http://localhost:5001`.

> **Note:** The mobile app's `constants/api.ts` file points to the deployed Railway backend by default. To run fully locally, update `API_BASE_URL` in that file to `http://localhost:3000`.

---

## Running the Tests

### Python unit tests

```bash
cd recommender
pytest tests/test_unit_recommender.py -v
```

### Node.js unit tests

```bash
cd backend
npm test
```

### Integration & scenario tests (requires live Railway deployment)

```bash
cd recommender
python tests/test_integration.py
python tests/test_scenarios.py
```

---

## Deployed Services

The backend is live on Railway. All three services (Node.js API, Python engine, PostgreSQL) are deployed and running continuously. The mobile app connects to these by default when built from this repository.
