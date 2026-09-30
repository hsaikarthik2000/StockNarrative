export type ConversationStyle = 'formal' | 'concise' | 'conversational';

export type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
};

export type ConversationRequest = {
  conversationId: string;
  message: string;
  symbol?: string;
  style?: ConversationStyle;
  toolContext?: string;
};

export type ConversationStream = {
  stream: ReadableStream;
  completion: Promise<string>;
  followUps: Promise<string[]>;
};