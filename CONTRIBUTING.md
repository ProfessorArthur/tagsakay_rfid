# Contributing

Thanks for your interest in improving TagSakay.

## Workflow

1. Fork the repository.
2. Create a feature branch from main.
3. Keep changes focused and scoped.
4. Run relevant tests/build checks before opening a pull request.
5. Open a pull request with a clear summary and validation notes.

## Development Setup

1. Backend
- cd backend-workers
- npm install
- configure local secrets in .dev.vars from .env.example
- npm run dev

2. Frontend
- cd frontend
- npm install
- configure .env with VITE_API_URL
- npm run dev

## Rules

- Do not commit secrets (.env, .dev.vars, API keys, credentials).
- Keep documentation aligned with behavior changes.
- Prefer small, reviewable pull requests.
