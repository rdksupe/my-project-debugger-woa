import fs from 'fs/promises';
import path from 'path';
import { ConversationSession, ConversationMessage, ResolvedError } from '../types/conversation';

export class ConversationManager {
  private sessionsPath: string;
  private sessions: Map<string, ConversationSession>;
  private timezone: string;

  constructor(baseDir: string) {
    this.sessionsPath = path.join(baseDir, '.superdebugger', 'sessions');
    this.sessions = new Map();
    this.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionsPath, { recursive: true });
  }

  private getFormattedTimestamp(): string {
    const date = new Date();
    const formatted = date.toLocaleString('en-US', {
      timeZone: this.timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${formatted}-${ms}`.replace(/[/,:\s]/g, '-');
  }

  async createSession(): Promise<ConversationSession> {
    const timestamp = this.getFormattedTimestamp();
    const session: ConversationSession = {
      id: timestamp,
      startTime: timestamp,
      messages: [],
      resolvedErrors: []
    };
    
    await this.saveSession(session);
    this.sessions.set(session.id, session);
    return session;
  }

  async addMessage(sessionId: string, message: ConversationMessage): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    session.messages.push(message);
    this.sessions.set(sessionId, session);
  }

  async loadSession(sessionId: string): Promise<ConversationSession> {
    const filePath = path.join(this.sessionsPath, `${sessionId}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    const session = JSON.parse(data);
    this.sessions.set(sessionId, session);
    return this.sessions.get(sessionId)!;
  }

  async saveSession(session: ConversationSession): Promise<void> {
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

  async getRecentSessions(limit: number = 10): Promise<ConversationSession[]> {
    const files = await fs.readdir(this.sessionsPath);
    const sessions = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          const session = await this.loadSession(f.replace('.json', ''));
          return {
            ...session,
            lastMessageTime: session.messages.length > 0 
              ? session.messages[session.messages.length - 1].timestamp 
              : session.startTime
          };
        })
    );

    return sessions
      .sort((a, b) => b.lastMessageTime.localeCompare(a.lastMessageTime))
      .slice(0, limit);
  }

  async markErrorAsResolved(
    sessionId: string,
    errorLog: string,
    relatedMessages: ConversationMessage[]
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const resolvedError: ResolvedError = {
      errorLog,
      timestamp: new Date().toISOString()
    };

    session.resolvedErrors = session.resolvedErrors || [];
    session.resolvedErrors.push(resolvedError);

    session.messages = session.messages.map(msg => {
      if (msg.errorLog === errorLog) {
        return { ...msg, isResolved: true };
      }
      return msg;
    });

    this.sessions.set(sessionId, session);
  }
}
