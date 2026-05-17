# LEETCODE TOKEN GOLF

A profiler for LLM applications.
Not a solver. Not a platform. Just a small, honest tool that tells you one thing:

> "How many tokens did that cost?"

---

## The Philosophy

LeetCode trains you to add complexity:

*   Handle every edge case
*   Optimize for worst-case time
*   Build abstractions for hypothetical requirements

Token Golf is the opposite:

*   Do one thing: measure token cost
*   Do it simply: ~150 lines of code
*   Fail clearly: if it breaks, you'll know exactly where

This isn't a platform. It's a tool. And it embodies the only engineering principle that scales:

> "The cheapest solution that works is the only one that scales."

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Click [this link](https://raw.githubusercontent.com/whitecell-dev/Leetcode-Token-Golf/main/leetcode-token-golf.user.js)
3.  Visit any LeetCode problem page
4.  Click the Settings icon to add your API key (Gemini is free)
5.  Start coding

---

## How It Works

1.  Write a prompt in the LeetCode editor
2.  Click [Run with AI]
3.  The script calls the LLM directly from your browser
4.  Response auto-fills the editor
5.  Submit normally through LeetCode
6.  The script shows you exactly how many tokens you spent

That's it.

No history. No leaderboards. No cascade fallbacks. No IR compilation.
Just a measurement tool.

---

## Why This Exists

LeetCode taught you to optimize for time and space.
The real world optimizes for cost.

Token cost. API latency. Model selection. Prompt efficiency.
Token Golf is a profiler for the new reality.

Not a solver. Not a tutor. Just a simple tool that answers one question:

> "Was that efficient?"

---

## Privacy

*   API keys stored only in your browser (Tampermonkey's isolated storage)
*   No prompts or responses ever leave your machine
*   Direct browser to API calls (no proxy, no middleman)
*   Open source. Audit it yourself.

---

## Supported Providers

| Provider | Cost         | Setup                                           |
|----------|--------------|-------------------------------------------------|
| Gemini   | Free         | Get key from aistudio.google.com                |
| OpenAI   | Pay-as-you-go| Standard API key                                |

Start with Gemini. It's free. Learn the patterns. Then optimize for cost.

---

## The Unix Philosophy

This script does one thing: measure token cost.
It does it well: ~150 lines, no dependencies, clear failure modes.
It composes: use it with any LLM, any problem, any workflow.

That's the opposite of LeetCode. LeetCode teaches you to build cathedrals. Token Golf teaches you to build stone axes.

---

## License

MIT. Do whatever you want. Just make it smaller.

---

## Summary

"LeetCode taught you to optimize for time and space. Token Golf teaches you to optimize for cost. The cheapest solution that works is the only one that scales."
