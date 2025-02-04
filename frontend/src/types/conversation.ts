export interface ConversationMessage {
  id: string;           // Add unique ID for each message
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  files?: string[];
  errorLog?: string;
  isResolved?: boolean;
  summary?: string;
  replyTo?: string;    // ID of the message this is replying to
  contextUpdate?: {     // Track context changes
    addedFiles?: string[];
    removedFiles?: string[];
    errorLogChanged?: boolean;
  };
}

export interface ConversationSession {
  id: string;
  startTime: string;
  endTime?: string;
  messages: ConversationMessage[];
  resolvedErrors: {
    errorLog: string;
    summary: string;
    timestamp: string;
  }[];
}
