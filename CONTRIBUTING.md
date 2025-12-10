# Contributing to Gmail Agent

Thanks for your interest in contributing! This document outlines how to contribute to the project.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (latest version)
- Node.js >= 18
- AWS account with Bedrock access (for testing classification)
- Google Cloud project with Gmail API enabled

### Setup

```bash
git clone https://github.com/anthropics/gmail-agent.git
cd gmail-agent
bun install
```

### Development

```bash
# Run with hot reload
bun run dev

# Run tests
bun run test:all

# Lint and format
bun run lint

# Type check
bun run tsc
```

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-search` - New features
- `fix/oauth-refresh` - Bug fixes
- `docs/update-readme` - Documentation
- `refactor/classifier-logic` - Code refactoring

### Code Style

This project uses [Biome](https://biomejs.dev) for linting and formatting:

- Tabs for indentation
- Double quotes for strings
- No trailing commas
- Sorted imports and object keys

Run `bun run lint` before committing to auto-fix issues.

### Testing

All changes should include tests where applicable:

```bash
# Run all tests
bun run test:all

# Run specific test file
bun test src/utils/retry.test.ts

# Run with coverage
bun run test:coverage
```

Tests that use `mock.module()` should be placed in `tests-isolated/` to avoid mock pollution.

### Commit Messages

Write clear, concise commit messages:

```
Add email search functionality

- Implement full-text search across subject, from, and body
- Add search input to email list screen
- Include tests for search queries
```

## Pull Request Process

1. **Fork** the repository
2. **Create a branch** from `main`
3. **Make your changes** with tests
4. **Run checks locally**:
   ```bash
   bun run lint
   bun run test:all
   bun run build
   ```
5. **Bump the version** in `package.json` (patch for fixes, minor for features)
6. **Open a pull request** with a clear description

### PR Requirements

- All CI checks must pass (lint, test, build)
- Version must be bumped
- Description should explain what and why

### Review Process

- PRs are reviewed by maintainers
- Feedback may be provided for changes
- Once approved, a maintainer will merge

## Project Structure

```
src/
├── ai/           # AI classification (parallel-classifier.ts, provider.ts)
├── cli/          # CLI command handlers
├── database/     # PGlite schema and queries
├── gmail/        # Gmail API client and OAuth
├── ui/           # Terminal UI (React Ink)
│   ├── components/
│   └── screens/
└── utils/        # Shared utilities (retry, env)

tests-isolated/   # Tests requiring mock isolation
scripts/          # Build and utility scripts
```

## Reporting Issues

When reporting bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node/Bun version)
- Error messages or logs

## Questions?

Open a [GitHub Discussion](https://github.com/anthropics/gmail-agent/discussions) for questions or ideas.
