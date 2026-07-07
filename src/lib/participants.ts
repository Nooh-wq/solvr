/** Distinct display names of everyone who's actually spoken in a thread — the one list both the @mention autocomplete (MessageComposer) and the rendered @mention highlighting (ConversationThread's renderInline) key off of. Called from server-component pages, so this can't live in conversation-thread.tsx (a "use client" module). */
export function participantNames(
  clientName: string,
  messages: { sender: { name: string | null } | null }[]
): string[] {
  const names = new Set<string>([clientName]);
  for (const m of messages) if (m.sender?.name) names.add(m.sender.name);
  return Array.from(names);
}
