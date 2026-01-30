import React, { useState, useEffect } from 'react';
import { PageData, ViewMode, User, UserRole, Presence, Project } from '../types';
import { StorageService } from '../services/storageService';
import { EditableBlock } from '../components/EditableBlock';
import { Menu, Shield, X, Users, MessageSquareText, ChevronRight, ChevronDown, Folder } from 'lucide-react';

interface SiteViewerProps {
  user: User | null;
  viewMode: ViewMode;
  onNavigate: (path: string) => void;
  onTriggerLogin: () => void;
}

export const SiteViewer: React.FC<SiteViewerProps> = ({ user, onNavigate, viewMode, onTriggerLogin }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentSlug, setCurrentSlug] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [activeCommentsBlock, setActiveCommentsBlock] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<Presence[]>([]);

  const loadData = () => {
    const allProjects = StorageService.getProjects();
    const allPages = StorageService.getPages();
    setProjects(allProjects);
    setPages(allPages);

    // Init default view if nothing selected
    if (!currentSlug && allPages.length > 0) {
      setCurrentSlug(allPages[0].slug);
      // Expand the first project by default
      if (allProjects.length > 0) {
        setExpandedProjects({ [allProjects[0].id]: true });
      }
    }
  };

  useEffect(() => {
    loadData();
    const intervalId = setInterval(() => {
      loadData();
      if (user) StorageService.heartbeat(user, currentSlug);
      setActiveUsers(StorageService.getActiveUsers(currentSlug));
    }, 2000);
    return () => clearInterval(intervalId);
  }, [user, currentSlug]);

  const currentPage = pages.find(p => p.slug === currentSlug);
  const currentProject = projects.find(p => p.id === currentPage?.projectId);

  const toggleProject = (pid: string) => {
    setExpandedProjects(prev => ({ ...prev, [pid]: !prev[pid] }));
  };

  const handleBlockSave = (blockId: string, content: string, originalContent: string) => {
    if (!user || !currentPage) {
      onTriggerLogin();
      return false;
    }
    const success = StorageService.savePageBlock(currentPage.id, blockId, content, user.username, originalContent);
    if (success) loadData();
    return success;
  };

  const handleCommentAdd = (text: string) => {
    if (!user || !currentPage) {
      onTriggerLogin();
      return;
    }
    StorageService.addComment(currentPage.id, activeCommentsBlock, user.username, text);
    loadData(); 
  };
  
  const comments = StorageService.getComments();

  // ... Comment Drawer Logic (reused from previous iteration, simplified here) ...
  const CommentDrawer = () => {
    if (!activeCommentsBlock) return null;
    const blockComments = comments.filter(c => c.blockId === activeCommentsBlock && c.pageId === currentPage?.id);
    return (
      <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-slide-in-right">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><MessageSquareText size={16} /> Comments</h3>
          <button onClick={() => setActiveCommentsBlock(null)} className="p-1 hover:bg-slate-200 rounded-full"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {blockComments.map(c => (
            <div key={c.id} className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
               <div className="flex justify-between text-xs mb-1 text-slate-500">
                 <span className="font-bold text-slate-700">{c.username}</span>
                 <span>{new Date(c.timestamp).toLocaleDateString()}</span>
               </div>
               <p className="text-sm text-slate-700">{c.text}</p>
            </div>
          ))}
        </div>
        {user && user.role !== UserRole.VIEWER && (
          <div className="p-4 border-t border-slate-100 bg-white">
            <textarea className="w-full p-3 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Add note..." onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommentAdd(e.currentTarget.value); e.currentTarget.value = ''; } }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden relative">
      {/* Sidebar */}
      <div className="w-72 bg-slate-50 border-r border-slate-200 flex flex-col h-full hidden md:flex">
        <div className="p-6 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-blue-600 font-bold text-lg">
            <Shield className="fill-current" />
            Health Infobase
          </div>
          <p className="text-xs text-slate-400 mt-1">Live Review Environment</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar">
          {projects.map(project => {
            const projectPages = pages.filter(p => p.projectId === project.id);
            const isExpanded = expandedProjects[project.id];

            return (
              <div key={project.id} className="space-y-1">
                <button 
                  onClick={() => toggleProject(project.id)}
                  className="flex items-center gap-2 w-full text-left text-slate-700 font-bold text-sm hover:text-blue-600 transition-colors"
                >
                   {isExpanded ? <ChevronDown size={14} className="text-slate-400"/> : <ChevronRight size={14} className="text-slate-400"/>}
                   <Folder size={14} className="text-blue-400" />
                   {project.title}
                </button>
                
                {isExpanded && (
                  <div className="ml-2 pl-2 border-l border-slate-200 space-y-1 mt-1">
                    {projectPages.map(page => (
                      <button
                        key={page.id}
                        onClick={() => setCurrentSlug(page.slug)}
                        className={`w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition-all truncate ${currentSlug === page.slug ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
                      >
                        {page.title || page.fileName}
                      </button>
                    ))}
                    {projectPages.length === 0 && <p className="text-[10px] text-slate-400 italic pl-3">No pages found</p>}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        
        <div className="p-4 bg-white border-t border-slate-200">
           {activeUsers.length > 0 && (
             <div className="flex items-center gap-2">
               <span className="relative flex h-2 w-2">
                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
               </span>
               <span className="text-xs text-slate-600 font-medium">{activeUsers.length} active user{activeUsers.length !== 1 ? 's' : ''}</span>
             </div>
           )}
        </div>
      </div>
      
      <main className="flex-1 h-full overflow-y-auto bg-white custom-scrollbar relative">
        {/* Mobile Header */}
        <div className="md:hidden p-4 border-b flex justify-between items-center sticky top-0 bg-white z-20 shadow-sm">
          <span className="font-bold text-blue-600 flex items-center gap-1"><Shield size={16}/> Live Review</span>
          <Menu size={24} className="text-slate-500" />
        </div>

        {currentPage ? (
          <div className="max-w-4xl mx-auto px-8 py-12 pb-32 animate-fade-in">
             <div className="mb-8 border-b border-slate-100 pb-6">
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-2 uppercase tracking-wider">
                  <span>{currentProject?.title}</span>
                  <ChevronRight size={10} />
                  <span>{currentPage.fileName}</span>
                </div>
                <h1 className="text-4xl font-bold text-slate-900 tracking-tight mb-2">{currentPage.title}</h1>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                   <span className="bg-slate-100 px-2 py-0.5 rounded">Last updated: {new Date(currentPage.lastUpdated).toLocaleString()}</span>
                   <span className="font-mono">{currentPage.blocks.length} editable blocks</span>
                </div>
             </div>
             
             <div className="space-y-4">
               {currentPage.blocks.map(block => (
                 <EditableBlock 
                   key={block.id} 
                   block={block} 
                   mode={viewMode} 
                   user={user} 
                   onSave={handleBlockSave}
                   onCommentClick={(id) => setActiveCommentsBlock(id)}
                   commentCount={comments.filter(c => c.blockId === block.id && c.pageId === currentPage.id).length}
                 />
               ))}
             </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <p>Select a page from the sidebar to begin review.</p>
          </div>
        )}
      </main>
      <CommentDrawer />
    </div>
  );
};