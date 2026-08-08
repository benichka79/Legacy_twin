// Guided interview prompts, first cut of the plan's "100–200 prompts across
// life domains" (MVP features, §3). Ordered gently: easy warm memories first,
// harder and more reflective questions later.

export interface InterviewPrompt {
  domain: string;
  question: string;
}

export const INTERVIEW_PROMPTS: InterviewPrompt[] = [
  { domain: "Childhood", question: "What is your earliest memory?" },
  { domain: "Childhood", question: "Describe the home you grew up in — the rooms, the sounds, the smells." },
  { domain: "Childhood", question: "What did you love doing as a child that nobody had to ask you twice to do?" },
  { domain: "Family origins", question: "Tell me about your parents — what were they like when you were small?" },
  { domain: "Family origins", question: "What do you know about how your parents or grandparents came to live where they did?" },
  { domain: "Family origins", question: "Which relative do people say you take after, and why?" },
  { domain: "Places", question: "Describe a street, town, or landscape that still feels like yours." },
  { domain: "Places", question: "Tell me about a journey or move that changed the direction of your life." },
  { domain: "Love", question: "How did you meet your partner, and what did you first notice about them?" },
  { domain: "Love", question: "What made you decide this was the person? Tell it as it happened." },
  { domain: "Work", question: "What work did you do, and how did you come to it?" },
  { domain: "Work", question: "Tell me about something you made or did at work that you're still proud of." },
  { domain: "Work", question: "Who taught you your craft, and what was the most important lesson?" },
  { domain: "Traditions", question: "Walk me through a holiday or family meal exactly as your family did it." },
  { domain: "Traditions", question: "Is there a recipe, song, or ritual you hope never gets lost? Tell its story." },
  { domain: "Friendship", question: "Tell me about a friend who mattered — how you met, and what you went through together." },
  { domain: "Hard times", question: "Tell me about a time that truly tested you. What carried you through?" },
  { domain: "Hard times", question: "What loss shaped you the most, and what would you want us to know about that person or time?" },
  { domain: "Joys", question: "Describe a perfectly ordinary day from a happy period of your life." },
  { domain: "Joys", question: "What always makes you laugh, even now?" },
  { domain: "Values", question: "What advice do you find yourself repeating to the people you love?" },
  { domain: "Values", question: "What do you believe that you didn't believe at twenty?" },
  { domain: "Legacy", question: "What do you hope people will say about you when you're not in the room?" },
  { domain: "Legacy", question: "If a great-grandchild you never meet listens to this one day — what do you want to tell them?" },
];
