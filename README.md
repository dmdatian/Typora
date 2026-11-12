# Typora — Typing Speed Challenge

Typora is a responsive typing game made with HTML, CSS, and vanilla JavaScript. Play solo, race a bot, or challenge one other person in a live room. The static frontend is deployed on Vercel; its Express and Socket.IO API runs on Render; Firebase Firestore stores leaderboard scores. Personal bests stay in the current browser.

## What you need

- A GitHub account and this project pushed to a Git repository.
- A Firebase project with Cloud Firestore enabled.
- Vercel and Render accounts.
- Node.js 22 or newer if you want to run the API locally.

## 1. Connect Firebase

1. Open the [Firebase Console](https://console.firebase.google.com/) and create a project (or select an existing one).
2. In **Build → Firestore Database**, choose **Create database** and select a location. Test mode is not needed: the app connects from its backend using the Firebase Admin SDK.
3. Open **Project settings → Service accounts** and choose **Generate new private key**. Download the JSON file and keep it private. Do not put this key in `config.js`, the frontend, GitHub, or Firestore rules.
4. Later, copy the complete JSON file contents into Render as the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable. The API creates a `scores` collection on the first saved score, so you do not need to create that collection manually.

Firestore security rules do not need public write access. Only the Render backend should have the service account key.

## 2. Deploy the API and multiplayer server to Render

1. Push the project to GitHub. In Render, choose **New → Web Service**, connect that repository, and configure:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
2. Add these environment variables in the Render service's **Environment** settings:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete service-account JSON from step 1. Paste it as one JSON value; do not add extra surrounding quotes.
   - `FRONTEND_ORIGIN` — the exact public Vercel website origin, for example `https://typora-example.vercel.app` (no path or trailing slash). Multiple origins can be comma-separated.
   - Render sets `PORT` automatically; you do not need to add it.
3. Create and deploy the service. Render will give it a URL like `https://typora-api.onrender.com`.
4. Check `https://YOUR-RENDER-URL/health` in a browser. It should return `{"status":"ok"}`.

The same Render service handles leaderboard requests and live multiplayer rooms. Rooms are temporary and stored in server memory; deploying/restarting the service ends any active races. Keep this as a single Render instance. On Render's free plan, the service may sleep when idle, so the first connection can take a little while to wake it.

## 3. Deploy the website to Vercel

1. In Vercel, choose **Add New → Project**, import the same GitHub repository, and set the project root to the repository root (not `backend`).
2. Vercel detects the static site. No build command or frontend dependencies are required.
3. Deploy once to get your Vercel URL, for example `https://typora-example.vercel.app`.
4. Update `FRONTEND_ORIGIN` in Render to that exact Vercel origin and redeploy/restart the Render service if needed.
5. Edit `config.js` in the project and replace the empty API URL with your Render URL:

   ```js
   window.TYPORA_CONFIG = {
     apiUrl: "https://typora-api.onrender.com"
   };
   ```

6. Commit and push that change. Vercel will redeploy; the leaderboard and multiplayer modes will then connect to Render.

If you use a custom Vercel domain, add its exact origin to `FRONTEND_ORIGIN` too (comma-separated), then restart Render. Vercel preview URLs change; add the specific preview origin if you need to test multiplayer from a preview deployment.

## How to play

- **Solo practice:** type the passage and try to beat the personal best saved in your browser.
- **Race a bot:** choose a duration, then type; the bot races at a randomly selected speed.
- **Multiplayer:** choose a duration, enter a name, and create a room. Share the six-character room code with one friend. They choose Multiplayer, enter their name and the code, then either player can start the race by typing.
- Use the restart button to start a new passage or rematch. Multiplayer requires the Render API URL to be set in `config.js`.

## Local API development

From `backend`, copy `.env.example` to `.env`, fill in your Firebase service-account JSON and frontend origin, then run:

```sh
npm install
npm start
```

Do not commit `.env`. For local browser testing, set `FRONTEND_ORIGIN` to the local website's exact origin.

## API routes

- `GET /health` — service health check.
- `GET /api/leaderboard` — top 10 scores by WPM.
- `POST /api/scores` — validates and saves a score to Firestore.
- Socket.IO events — creates/joins two-player rooms and exchanges race progress/results.

Scores are not tied to authenticated accounts or verified typing sessions, so a determined user can submit a fake leaderboard score. The bot is a local opponent, and multiplayer room state is temporary. Do not use this leaderboard for prizes or other high-stakes competitions without adding authentication and server-verified test sessions.
