// Z1.4b: message-sender resolution now flows through the view-model
// pipeline. `resolveMessageSender` in `@/lib/z1-view-models` handles the
// full author state space (EndUser | TeamMember | Guest | SYSTEM/BOT).
//
// This file remains as a thin re-export so existing imports keep
// working. Callers should migrate imports directly to
// `@/lib/z1-view-models` at their next touch.

export { resolveMessageSender, type MessageSender } from "@/lib/z1-view-models";
