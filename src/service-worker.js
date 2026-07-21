// Keep provider-specific privileged routers isolated. background.js is the
// shipped Claude adapter; openai-background.js adds ChatGPT without changing
// Claude's validation or storage behavior.
import "./background.js";
import "./openai-background.js";
