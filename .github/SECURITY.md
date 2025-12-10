# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use GitHub's private vulnerability reporting feature
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Security Measures

This project implements the following security measures:

- **OAuth 2.0**: Uses Google's OAuth 2.0 for authentication with Gmail API
- **Token Storage**: Tokens are stored locally in the user's home directory with restricted permissions
- **No Data Transmission**: Email data is processed locally and not transmitted to third parties (except to configured AI providers for classification)
- **Dependency Scanning**: Automated security scanning via CodeQL and Dependabot
- **Minimal Permissions**: Only requests necessary Gmail API scopes

## Best Practices for Users

- Keep your dependencies up to date
- Never share your OAuth credentials or tokens
- Review the AI provider's privacy policy before use
- Use environment variables for sensitive configuration
