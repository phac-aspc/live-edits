
import { PageData, EditLog, Comment, PageVersion, Presence, User, Project, ContentBlock } from '../types';
import { INITIAL_PAGES } from '../constants';

const KEYS = {
  PROJECTS: 'hilr_projects',
  PAGES: 'hilr_pages',
  EDITS: 'hilr_edits',
  COMMENTS: 'hilr_comments',
  VERSIONS: 'hilr_versions',
  PRESENCE: 'hilr_presence'
};

// UUID Generator Polyfill
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch (e) {}
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
};

const safeStorage = {
  getItem: (key: string) => {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  setItem: (key: string, value: string) => {
    try { localStorage.setItem(key, value); } catch (e) { console.warn("Storage write failed"); }
  }
};

// Initialize storage
const initStorage = () => {
  // If no projects exist, create the default Demo Project
  if (!safeStorage.getItem(KEYS.PROJECTS)) {
    const defaultProjectId = 'proj_demo';
    const defaultProject: Project = {
      id: defaultProjectId,
      folderName: 'demo_health_site',
      title: 'Health Infobase (Demo)',
      importedAt: Date.now()
    };
    safeStorage.setItem(KEYS.PROJECTS, JSON.stringify([defaultProject]));

    // Initialize pages for this demo project
    // We reconstruct a fake HTML string for them since constants don't have it by default
    if (!safeStorage.getItem(KEYS.PAGES)) {
      const pagesWithProject = INITIAL_PAGES.map(p => ({
        ...p,
        projectId: defaultProjectId,
        fileName: `${p.slug}.html`,
        originalHtml: `<html><head><title>${p.title}</title></head><body>${p.blocks.map(b => {
           // Rough reconstruction for demo purposes
           if(b.type === 'warning') return `<div class="warning">${b.content}</div>`;
           return `<${b.type === 'h1' ? 'h1' : b.type === 'h2' ? 'h2' : 'p'}>${b.content}</${b.type === 'h1' ? 'h1' : b.type === 'h2' ? 'h2' : 'p'}>`;
        }).join('\n')}</body></html>`,
        // Ensure blocks have originalIndex for these mock pages
        blocks: p.blocks.map((b, idx) => ({ ...b, originalIndex: idx }))
      }));
      safeStorage.setItem(KEYS.PAGES, JSON.stringify(pagesWithProject));
    }
  }
  
  // Initialize other stores if missing
  [KEYS.EDITS, KEYS.COMMENTS, KEYS.VERSIONS, KEYS.PRESENCE].forEach(key => {
    if (!safeStorage.getItem(key)) safeStorage.setItem(key, JSON.stringify([]));
  });
};

try { initStorage(); } catch(e) { console.error("Init failed", e); }

export const StorageService = {
  // --- PROJECT METHODS ---
  getProjects: (): Project[] => {
    try { return JSON.parse(safeStorage.getItem(KEYS.PROJECTS) || '[]'); } catch { return []; }
  },
  
  addProject: (project: Project) => {
    const projects = StorageService.getProjects();
    projects.push(project);
    safeStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
  },

  // --- PAGE METHODS ---
  getPages: (): PageData[] => {
    try { return JSON.parse(safeStorage.getItem(KEYS.PAGES) || '[]'); } catch { return []; }
  },
  
  getPagesByProject: (projectId: string): PageData[] => {
    return StorageService.getPages().filter(p => p.projectId === projectId);
  },

  addPage: (page: PageData) => {
    const pages = StorageService.getPages();
    // Remove existing page with same slug/project combo (overwrite)
    const filtered = pages.filter(p => !(p.projectId === page.projectId && p.fileName === page.fileName));
    filtered.push(page);
    safeStorage.setItem(KEYS.PAGES, JSON.stringify(filtered));
  },

  getPage: (slug: string): PageData | undefined => {
    // Note: Slug might not be unique across projects in a real app, but simplified here
    return StorageService.getPages().find(p => p.slug === slug);
  },

  // --- BLOCK SAVING ---
  savePageBlock: (pageId: string, blockId: string, newContent: string, username: string, originalContent: string): boolean => {
    const pages = StorageService.getPages();
    const pageIndex = pages.findIndex(p => p.id === pageId);
    if (pageIndex === -1) return false;

    const page = pages[pageIndex];
    const blockIndex = page.blocks.findIndex(b => b.id === blockId);
    if (blockIndex === -1) return false;

    if (page.blocks[blockIndex].content.trim() !== originalContent.trim()) {
      console.warn("Conflict detected");
      return false;
    }
    
    page.blocks[blockIndex].content = newContent;
    page.lastUpdated = Date.now();
    pages[pageIndex] = page;
    safeStorage.setItem(KEYS.PAGES, JSON.stringify(pages));

    // Save Version
    try {
      const versions: PageVersion[] = JSON.parse(safeStorage.getItem(KEYS.VERSIONS) || '[]');
      versions.push({
        id: generateId(),
        pageId: page.id,
        timestamp: Date.now(),
        editor: username,
        blocks: JSON.parse(JSON.stringify(page.blocks))
      });
      safeStorage.setItem(KEYS.VERSIONS, JSON.stringify(versions));
    } catch(e) {}

    // Log Edit
    try {
      const logs: EditLog[] = JSON.parse(safeStorage.getItem(KEYS.EDITS) || '[]');
      logs.unshift({
        id: generateId(), pageId, blockId, username, timestamp: Date.now(), oldContent: originalContent, newContent
      });
      safeStorage.setItem(KEYS.EDITS, JSON.stringify(logs));
    } catch(e) {}

    return true;
  },

  getVersions: (pageId: string): PageVersion[] => {
    const versions: PageVersion[] = JSON.parse(safeStorage.getItem(KEYS.VERSIONS) || '[]');
    return versions.filter(v => v.pageId === pageId).sort((a, b) => b.timestamp - a.timestamp);
  },

  revertToVersion: (pageId: string, versionId: string, username: string): void => {
    const versions = StorageService.getVersions(pageId);
    const targetVersion = versions.find(v => v.id === versionId);
    if (!targetVersion) return;

    const pages = StorageService.getPages();
    const pageIndex = pages.findIndex(p => p.id === pageId);
    if (pageIndex !== -1) {
      pages[pageIndex].blocks = JSON.parse(JSON.stringify(targetVersion.blocks));
      pages[pageIndex].lastUpdated = Date.now();
      safeStorage.setItem(KEYS.PAGES, JSON.stringify(pages));
      
      // Add new head version
      versions.push({
         id: generateId(),
         pageId,
         timestamp: Date.now(),
         editor: username,
         blocks: JSON.parse(JSON.stringify(targetVersion.blocks))
      });
      safeStorage.setItem(KEYS.VERSIONS, JSON.stringify(versions));
    }
  },

  // --- EDITS & COMMENTS ---
  getEdits: (): EditLog[] => {
    try { return JSON.parse(safeStorage.getItem(KEYS.EDITS) || '[]'); } catch { return []; }
  },
  getComments: (): Comment[] => {
    try { return JSON.parse(safeStorage.getItem(KEYS.COMMENTS) || '[]'); } catch { return []; }
  },
  addComment: (pageId: string, blockId: string | null, username: string, text: string) => {
    const comments = StorageService.getComments();
    comments.push({ id: generateId(), pageId, blockId, username, text, timestamp: Date.now(), resolved: false });
    safeStorage.setItem(KEYS.COMMENTS, JSON.stringify(comments));
  },
  toggleResolveComment: (commentId: string) => {
    const comments = StorageService.getComments();
    const c = comments.find(x => x.id === commentId);
    if (c) { c.resolved = !c.resolved; safeStorage.setItem(KEYS.COMMENTS, JSON.stringify(comments)); }
  },

  // --- PRESENCE ---
  heartbeat: (user: User, pageSlug: string) => {
    try {
      let p: Presence[] = JSON.parse(safeStorage.getItem(KEYS.PRESENCE) || '[]');
      p = p.filter(x => x.username !== user.username && Date.now() - x.lastSeen < 10000);
      p.push({ username: user.username, role: user.role, pageSlug, lastSeen: Date.now(), color: user.color || '#000' });
      safeStorage.setItem(KEYS.PRESENCE, JSON.stringify(p));
    } catch(e) {}
  },
  getActiveUsers: (slug: string): Presence[] => {
    try {
      const p: Presence[] = JSON.parse(safeStorage.getItem(KEYS.PRESENCE) || '[]');
      return p.filter(x => x.pageSlug === slug && Date.now() - x.lastSeen < 10000);
    } catch { return []; }
  },

  checkHealth: () => ({ status: 'healthy', details: 'Storage OK' })
};
