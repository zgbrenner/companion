// Keep provider-specific privileged routers isolated. background.js is the
// shipped Claude adapter; openai-background.js adds ChatGPT without changing
// Claude's validation or storage behavior. badge-state.js and badge-router.js
// provide one serialized toolbar badge owner across both providers.
import "./badge-state.js";
import "./background.js";
import "./openai-background.js";
import "./badge-router.js";
