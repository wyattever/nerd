# N.E.R.D. Cloud Smoke Tests

These tests are self-contained verification probes designed to run against 
the deployed Cloud Run services. They are **not** unit tests or integration 
tests for logic; they are connectivity and configuration health checks.

## Prerequisites

1. **NERD_API_URL**: The base URL of the deployed `nerd-api` service.
2. **SMOKE_ID_TOKEN**: A valid Firebase ID token.

### How to obtain an ID token
You can use the Firebase Auth REST API:
```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<YOUR_FIREBASE_WEB_API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"email":"your-auth-user@example.com", "password":"your-password", "returnSecureToken":true}'
```
Copy the `idToken` value from the response.

## Usage

Run all smoke tests:
```bash
export NERD_API_URL=https://nerd-api-meomhj23xq-uc.a.run.app
export SMOKE_ID_TOKEN=your_token_here
pytest tests/smoke/ -v
```

### Quota Management
The `test_research_initial` test triggers a real research job, which:
- Invokes Vertex AI (Gemini)
- Creates a Cloud Task
- Costs quota/money

To run smoke tests **without** triggering research:
```bash
pytest tests/smoke/ -v -k "not research_initial"
```

## Probes
1. `test_healthz`: Unauthenticated connectivity check.
2. `test_cors_preflight`: Validates CORS headers match the frontend origin.
3. `test_list_candidates`: Authenticated read from Firestore `nerd_candidates`.
4. `test_list_products`: Authenticated read from Firestore `nerd_products`.
5. `test_research_initial`: End-to-end enqueue check (costs quota).
