/**
 * AI assistance through Puter's AI service. Requests run against the
 * signed-in user's own Puter account.
 */
export function createAi() {
  return {
    available() {
      return typeof puter !== 'undefined' && Boolean(puter.ai?.chat);
    },
    async ask(prompt) {
      const res = await puter.ai.chat(prompt);
      if (typeof res === 'string') return res;
      const content = res?.message?.content;
      if (Array.isArray(content)) return content.map((c) => c.text || '').join('');
      return String(content ?? res?.text ?? res ?? '');
    },
  };
}

export const ASSIST_ACTIONS = [
  { id: 'summarize', label: 'Summarize this page', prompt: (text) => `Summarize these notes in a few short bullet points. Reply in plain text, one bullet per line starting with "- ".\n\n${text}` },
  { id: 'actions', label: 'Find action items', prompt: (text) => `List the action items and to-dos found in these notes. Reply in plain text, one per line starting with "- ". If there are none, reply "No action items found."\n\n${text}` },
  { id: 'questions', label: 'Suggest follow-up questions', prompt: (text) => `Suggest up to five follow-up questions about these notes. Reply in plain text, one per line starting with "- ".\n\n${text}` },
  { id: 'rewrite', label: 'Rewrite selection more clearly', needsSelection: true, prompt: (text) => `Rewrite this text so it is clearer and more concise. Keep the meaning. Reply with the rewritten text only.\n\n${text}` },
  { id: 'proofread', label: 'Fix spelling and grammar in selection', needsSelection: true, prompt: (text) => `Correct the spelling and grammar of this text. Reply with the corrected text only.\n\n${text}` },
];
