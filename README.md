# Gmail Agent

AI-powered email classification system for Gmail using AWS Bedrock.

## Features

- Secure Gmail OAuth authentication
- Email syncing to local PGlite database
- AI-powered email classification using AWS Bedrock
- Custom classifier management
- Grid view with live classification progress
- Parallel processing for fast classification
- Beautiful terminal UI with Ink

## Installation

```bash
# npm
npm install -g gmail-agent

# yarn
yarn global add gmail-agent

# pnpm
pnpm add -g gmail-agent

# bun
bun add -g gmail-agent
```

**Requirements:** Node.js >= 18 (or Bun)

## Setup

### 1. AWS Bedrock

You need an AWS account with access to Claude models in Bedrock.

1. Go to [AWS Bedrock console](https://console.aws.amazon.com/bedrock)
2. Navigate to "Model access" and request access to Claude models
3. Create an IAM user with the following policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
    }
  ]
}
```

4. Generate access keys for the IAM user

### 2. Google Cloud

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the Gmail API
3. Create OAuth 2.0 credentials
4. Add `http://localhost:3000/callback` to authorized redirect URIs

### 3. Environment Variables

Export the following or create `~/.gmail-agent/.env`:

```bash
export AMAZON_BEDROCK_REGION=us-east-1
export AMAZON_BEDROCK_ACCESS_KEY_ID=your_access_key
export AMAZON_BEDROCK_SECRET_ACCESS_KEY=your_secret_key
export GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=your_client_secret
```

## Usage

### Interactive Mode (Recommended)

Launch the terminal UI for a guided experience:

```bash
gmail-agent
```

Navigate with arrow keys, Enter to select, Esc to go back.

The TUI will guide you through connecting your Gmail account, creating classifiers, syncing emails, and classifying them.

### CLI Commands

For scripting or quick actions:

```bash
gmail-agent --help
gmail-agent --version

# Authentication
gmail-agent auth login
gmail-agent auth logout
gmail-agent auth status

# Classifiers
gmail-agent classifier add
gmail-agent classifier list
gmail-agent classifier remove

# Sync and classify
gmail-agent sync [--max-emails 500]
gmail-agent classify [--max-emails 100]
```

### Classifiers

Classifiers define how emails are categorized:

- **Name**: Identifier for the classifier
- **Description**: What this classifier detects
- **Label**: Label applied to matching emails
- **Priority**: Higher priority classifiers run first

Examples: "Urgent", "Newsletter", "Receipt", "Job Application"

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Access Denied (AWS) | Check IAM permissions for Bedrock |
| Model Not Found | Verify Claude model access in your region |
| OAuth Error | Ensure redirect URI matches exactly |
| Token Expired | Run `gmail-agent auth logout` then `login` |
| Reset Database | Delete `~/.gmail-agent/data` |

---

## Development

### Setup

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/anthropics/gmail-agent.git
cd gmail-agent
bun install
bun run dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Development with hot reload |
| `bun run start` | Run directly |
| `bun run build` | Build for distribution |
| `bun run build:npm` | Build + package for npm |
| `bun run lint` | Lint with Biome |
| `bun run tsc` | Type check |
| `bun run db:generate` | Generate migrations |

### Project Structure

```
src/
├── ai/           # Classification logic (parallel-classifier.ts, provider.ts)
├── cli/          # CLI command handlers
├── database/     # Schema and operations
├── gmail/        # Gmail API integration
└── ui/           # Terminal UI (React Ink)
    ├── components/
    └── screens/
```

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
