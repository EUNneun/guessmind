# Firebase backend staging

Project: `guessmind-ed9a4`. This folder is prepared but not deployed. The live GitHub Pages `docs/` directory remains a browser-only test until Functions and rules are deployed and the `firebase/web/` assets replace it.

## Console setup

1. Authentication: enable Anonymous.
2. Firestore: create Standard default database in production mode (`asia-northeast3` recommended).
3. Upgrade to Blaze before deploying Functions; set a billing budget alert.
4. Create an OpenAI API key and set a Firebase Functions secret named `OPENAI_API_KEY` through `firebase functions:secrets:set OPENAI_API_KEY`. Never put it in GitHub or client code.
5. Deploy `firestore.rules` and `guessmindApi` function through the Firebase CLI from this directory. Use `firebase deploy --only firestore:rules,functions` after installing dependencies in `functions/`.
6. Copy `web/*` into `docs/`, removing `demo-api.js`, then GitHub Pages publishes the real client. This step is intentionally deferred until the function deploy works.

Firestore client access is denied by default. All quiz reads/writes and scoring go through the authenticated callable function. It hides correct ratings and reviews from quiz responses, limits AI decoy generation to 10 calls per user per UTC day, and rejects repeat participation from the same anonymous UID. Anonymous identity persists in a browser but is not a permanent account across devices. Quiz links work across devices after deployment.
