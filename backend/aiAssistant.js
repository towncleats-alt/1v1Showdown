const LIVE_PATTERNS = /(score|current score|who is playing|who won|next match|upcoming|live match|timer|current time|what is the score|when is the final|what time is the final|the final)/i;
const RULE_PATTERNS = /(rules|how does|how it works|format|eligibility|register|registration|arrival|what is the tournament|what happens if|match rules|venue)/i;

export function classifyQuestionType(question = '') {
  const text = String(question ?? '').trim();
  if (!text) return 'general';
  if (LIVE_PATTERNS.test(text)) return 'live';
  if (RULE_PATTERNS.test(text)) return 'rules';
  return 'general';
}

export function buildKnowledgeAnswer(question, documents = []) {
  const normalized = String(question ?? '').trim();
  const matches = documents.filter((doc) => {
    const haystack = `${doc.title ?? ''} ${doc.content ?? ''}`.toLowerCase();
    return haystack.includes(normalized.toLowerCase()) || haystack.includes('tournament') || haystack.includes('match');
  });

  if (!matches.length) {
    return {
      text: 'I could not find that information in the approved tournament knowledge base right now.',
      sources: [],
    };
  }

  const text = matches
    .map((doc) => `${doc.title ?? 'Tournament Knowledge'}: ${doc.content ?? ''}`)
    .join('\n\n');

  return {
    text: text.slice(0, 1000),
    sources: matches.map((doc) => ({ title: doc.title ?? 'Tournament Knowledge' })),
  };
}
