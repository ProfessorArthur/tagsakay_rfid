# Contributing

Thanks for your interest in contributing to TagSakay RFID.

## Getting Started

1. Fork the repository.
2. Create a branch from main.
3. Make your change with clear commit messages.
4. Test locally before opening a pull request.
5. Open a pull request with context, screenshots, and test notes when applicable.

## Development Setup

1. Backend
- cd backend-workers
- npm install
- configure .dev.vars from .env.example
- npm run dev

2. Frontend
- cd frontend
- npm install
- configure .env with VITE_API_URL
- npm run dev

## Contribution Guidelines

- Keep changes focused and minimal.
- Avoid mixing refactors with feature work in one pull request.
- Do not commit secrets, credentials, or local environment files.
- Update docs when behavior or setup changes.

## Reporting Issues

Please include:
- What happened
- What you expected
- Steps to reproduce
- Logs or screenshots if relevant
