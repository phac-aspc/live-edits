
export enum UserRole {
  VIEWER = 'VIEWER',
  EDITOR = 'EDITOR',
  ADMIN = 'ADMIN'
}

export interface User {
  username: string;
  role: UserRole;
  color?: string; // For cursor/avatar identification
}

export interface ContentBlock {
  id: string;
  type: 'h1' | 'h2' | 'p' | 'ul' | 'warning';
  content: string;
  originalIndex: number; // To map back to DOM nodes during export
}

export interface Project {
  id: string;
  folderName: string;
  title: string;
  importedAt: number;
}

export interface PageData {
  id: string;
  projectId: string;
  fileName: string;
  slug: string;
  title: string;
  blocks: ContentBlock[];
  lastUpdated: number;
  originalHtml: string; // Stored to allow reconstructing the full file later
}

export interface PageVersion {
  id: string;
  pageId: string;
  timestamp: number;
  editor: string;
  blocks: ContentBlock[];
}

export interface EditLog {
  id: string;
  pageId: string;
  blockId: string;
  username: string;
  timestamp: number;
  oldContent: string;
  newContent: string;
}

export interface Comment {
  id: string;
  pageId: string;
  blockId: string | null; // null means page-level comment
  username: string;
  text: string;
  timestamp: number;
  resolved: boolean;
}

export interface Presence {
  username: string;
  role: UserRole;
  pageSlug: string;
  lastSeen: number;
  color: string;
}

export interface AppStatus {
  status: 'RUNNING' | 'MAINTENANCE' | 'ERROR';
  version: string;
  uptime: number;
  activeUsers: number;
}

export type ViewMode = 'BROWSE' | 'EDIT' | 'COMMENT';
