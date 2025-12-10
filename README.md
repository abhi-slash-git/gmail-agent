# Gmail Agent

AI-powered email classification system for Gmail using Amazon Bedrock and Claude models.

## Features

- 🔐 Secure Gmail OAuth authentication
- 📧 Email syncing to local PGlite database
- 🤖 AI-powered email classification using Claude via AWS Bedrock
- 🎯 Custom classifier management
- 📊 Grid view with live classification progress
- ⚡ Parallel processing for fast classification
- 🖥️ Beautiful terminal UI with Ink

## Installation

### npm (Recommended)

```bash
npm install -g gmail-agent
```

Or with other package managers:

```bash
# yarn
yarn global add gmail-agent

# pnpm
pnpm add -g gmail-agent

# bun
bun add -g gmail-agent
```

### Pre-built Binaries

Download the latest release for your platform:

| Platform | Architecture | Download |
|----------|--------------|----------|
| Linux | x64 | `gmail-agent-linux-x64` |
| Linux | ARM64 | `gmail-agent-linux-arm64` |
| macOS | Intel | `gmail-agent-darwin-x64` |
| macOS | Apple Silicon | `gmail-agent-darwin-arm64` |
| Windows | x64 | `gmail-agent-windows-x64.exe` |

#### Linux / macOS

```bash
# Download (replace with your platform)
curl -L -o gmail-agent https://github.com/YOUR_REPO/releases/latest/download/gmail-agent-darwin-arm64

# Make executable
chmod +x gmail-agent

# Move to PATH
sudo mv gmail-agent /usr/local/bin/

# Verify installation
gmail-agent --version
```

#### Windows

1. Download `gmail-agent-windows-x64.exe`
2. Rename to `gmail-agent.exe`
3. Move to a directory in your PATH (e.g., `C:\Users\<user>\bin`)
4. Or run directly: `.\gmail-agent.exe`

### Build from Source

Requires [Bun](https://bun.sh) runtime.

```bash
# Clone the repository
git clone https://github.com/YOUR_REPO/gmail-agent.git
cd gmail-agent

# Install dependencies
bun install

# Build for current platform
bun run build

# Build for all platforms
bun run build:all

# Build for specific platforms
bun run build:linux    # Linux x64 and ARM64
bun run build:macos    # macOS Intel and Apple Silicon
bun run build:windows  # Windows x64

# Install locally (macOS/Linux)
bun run install:local
```

The built executables will be in the `dist/` directory.

### Development Setup

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Or link for development
bun run link
gmail-agent
```

## Prerequisites

1. **AWS Account with Bedrock Access**
   - Enable Amazon Bedrock in your AWS account
   - Request access to Anthropic Claude models in Bedrock
   - Create IAM credentials with Bedrock permissions

2. **Google Cloud Project**
   - Enable Gmail API
   - Create OAuth 2.0 credentials
   - Add `http://localhost:3000/callback` to authorized redirect URIs

## Configuration

### Environment Variables

Create a `.env` file in your home directory (`~/.gmail-agent/.env`) or in the current working directory:

```env
# AWS Bedrock Configuration
AMAZON_BEDROCK_REGION=us-east-1
AMAZON_BEDROCK_ACCESS_KEY_ID=your_aws_access_key
AMAZON_BEDROCK_SECRET_ACCESS_KEY=your_aws_secret_key

# Google OAuth Credentials
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
```

### AWS Bedrock Setup

1. **Enable Bedrock Models**:
   - Go to AWS Bedrock console
   - Navigate to "Model access"
   - Request access to:
     - Claude 3.5 Haiku
     - Claude 3.5 Sonnet (optional)
     - Claude 3 Opus (optional)

2. **Create IAM User**:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel",
           "bedrock:InvokeModelWithResponseStream"
         ],
         "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
       }
     ]
   }
   ```

3. **Generate Access Keys**:
   - Create access key for the IAM user
   - Add to your `.env` file

## Usage

### Interactive Mode (TUI)

```bash
gmail-agent
```

### CLI Commands

```bash
# Show help
gmail-agent --help

# Show version
gmail-agent --version

# Authentication
gmail-agent auth login      # Connect Gmail account
gmail-agent auth logout     # Disconnect Gmail account
gmail-agent auth status     # Show authentication status

# Classifiers
gmail-agent classifier add     # Add a new classifier
gmail-agent classifier list    # List all classifiers
gmail-agent classifier remove  # Remove a classifier

# Sync emails
gmail-agent sync --max-emails 500

# Classify emails
gmail-agent classify --max-emails 100
```

### Main Features

1. **Connect Gmail**: Authenticate with your Google account
2. **Manage Classifiers**: Create custom email classification rules
3. **Sync Emails**: Download emails from Gmail to local database
4. **Classify Emails**: AI-powered classification with live progress
5. **View Emails**: Browse and search your synced emails

## Build Options

```bash
# Build for current platform
bun run build

# Build for all platforms
bun run build --all

# Build for specific target
bun run build -t linux-x64
bun run build -t darwin-arm64
bun run build -t windows-x64

# Multiple targets
bun run build -t linux-x64 -t linux-arm64

# Verbose output
bun run build --all -v
```

### Available Targets

| Target | Description |
|--------|-------------|
| `linux-x64` | Linux x86_64 |
| `linux-arm64` | Linux ARM64 (Raspberry Pi, etc.) |
| `darwin-x64` | macOS Intel |
| `darwin-arm64` | macOS Apple Silicon (M1/M2/M3) |
| `windows-x64` | Windows x86_64 |

## Troubleshooting

### AWS Bedrock Issues

- **Access Denied**: Ensure your IAM user has the correct Bedrock permissions
- **Model Not Found**: Verify you have access to Claude models in your region
- **Region Issues**: Some regions may not have all Claude models available

### Rate Limits

- The parallel classifier processes 5 emails concurrently by default
- Adjust `MAX_CONCURRENT` in `src/ai/parallel-classifier.ts` if needed

### Database Issues

- Database is stored in `~/.gmail-agent/data` by default
- Delete this directory to reset the database

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start with hot reload |
| `bun run start` | Start production mode |
| `bun run build` | Build for current platform |
| `bun run build:all` | Build for all platforms |
| `bun run lint` | Run linter |
| `bun run tsc` | Type check |
| `bun run db:generate` | Generate database migrations |
| `bun run db:check` | Check migration status |

### Project Structure

```
gmail-agent/
├── src/
│   ├── ai/              # AI classification logic
│   │   ├── parallel-classifier.ts
│   │   └── provider.ts  # Bedrock configuration
│   ├── database/        # Database schema and operations
│   ├── gmail/           # Gmail API integration
│   ├── ui/              # Terminal UI components
│   │   ├── screens/     # Application screens
│   │   └── components/  # Reusable UI components
│   └── cli/             # CLI commands
├── build.ts             # Cross-platform build script
└── index.tsx            # Entry point
```

## License

MIT
