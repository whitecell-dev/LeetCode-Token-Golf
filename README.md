# ⛳ LeetCode Token Golf

**Track how many tokens your AI solutions cost.**

Your API key never leaves your browser. No backend. No logging. No trust issues.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Click [this link](https://raw.githubusercontent.com/whitecell-dev/Leetcode-Token-Golf/main/leetcode-token-golf.user.js)
3. Tampermonkey will prompt you to install
4. Visit any LeetCode problem page

## How It Works

1. Write a prompt in the LeetCode editor
2. Click **🚀 Run with AI**
3. The script calls OpenAI/Anthropic directly from your browser
4. Response auto-fills the editor
5. Submit normally through LeetCode
6. The script tracks pass/fail and token usage

## Why This Exists

We taught engineers to optimize for time and space. Now we train them to optimize for **tokens**.

## Privacy

- API keys stored in your browser (Tampermonkey's isolated storage)
- No prompts or responses are ever sent to any server
- Direct browser → API calls (no proxy)
- Open source. Audit it yourself.

## Supported Providers

- OpenAI (GPT-4o-mini, GPT-4o, etc.)
- Anthropic (Claude 3.5 Haiku, Sonnet, etc.)

## Building

This is a single `.user.js` file. No build step. No dependencies.

## License

MIT
