import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ConversationSession, ConversationMessage } from '../types/conversation';
import axios from 'axios';

export class ConversationManager {
  private sessionsPath: string;
  private sessions: Map<string, ConversationSession>;

  constructor(baseDir: string) {
    this.sessionsPath = path.join(baseDir, '.superdebugger', 'sessions');
    this.sessions = new Map();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionsPath, { recursive: true });
  }

  async createSession(): Promise<ConversationSession> {
    const session: ConversationSession = {
      id: uuidv4(),
      startTime: new Date().toISOString(),
      messages: [],
      resolvedErrors: []
    };
    await this.saveSession(session);
    this.sessions.set(session.id, session);
    return session;
  }

  async addMessage(sessionId: string, message: ConversationMessage): Promise<void> {
    const session = await this.loadSession(sessionId);
    session.messages.push(message);
    await this.saveSession(session);
  }

  async loadSession(sessionId: string): Promise<ConversationSession> {
    const filePath = path.join(this.sessionsPath, `${sessionId}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    const session = JSON.parse(data);
    this.sessions.set(sessionId, session);
    return session;
  }

  public async saveSession(session: ConversationSession): Promise<void> {
    const filePath = path.join(this.sessionsPath, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2));
  }

  async getAllSessions(): Promise<ConversationSession[]> {
    const files = await fs.readdir(this.sessionsPath);
    const sessions = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(f => this.loadSession(f.replace('.json', '')))
    );
    return sessions.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  async summarizeResolvedError(
    sessionId: string,
    errorLog: string,
    conversation: ConversationMessage[]
  ): Promise<string> {
    try {
      const response = await axios.post('http://localhost:3000/api/code/summarize', {
        errorLog,
        conversation
      });
      return response.data.summary;
    } catch (error) {
      console.error('Error generating summary:', error);
      return 'Error resolved (summary generation failed)';
    }
  }

  async markErrorAsResolved(
    sessionId: string,
    errorLog: string,
    relatedMessages: ConversationMessage[]
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const summary = await this.summarizeResolvedError(
      sessionId,
      errorLog,
      relatedMessages
    );

    // Add to resolved errors
    session.resolvedErrors = session.resolvedErrors || [];
    session.resolvedErrors.push({
      errorLog,
      summary,
      timestamp: new Date().toISOString()
    });

    // Mark related messages as resolved
    session.messages = session.messages.map(msg => {
      if (msg.errorLog === errorLog) {
        return { ...msg, isResolved: true };
      }
      return msg;
    });

    // Add summary as system message
    const systemMessage: ConversationMessage = {
      role: 'system',
      content: `Error resolved: ${summary}`,
      timestamp: new Date().toISOString(),
      isResolved: true,
      id: ''
    };

    session.messages.push(systemMessage);
    await this.saveSession(session);
  }

  getActiveConversation(sessionId: string): ConversationMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    // Filter out resolved error conversations
    return session.messages.filter(msg => !msg.isResolved);
  }
}
