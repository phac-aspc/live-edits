import React, { useEffect, useState, useRef } from 'react';
import { EditLog, AppStatus, Comment, PageVersion, PageData, Project } from '../types';
import { StorageService } from '../services/storageService';
import { GeminiService } from '../services/geminiService';
import { HtmlService } from '../services/htmlService';
import { MOCK_STATUS } from '../constants';
import { Modal } from '../components/Modal';
import { Activity, Server, Users, Clock, FileText, AlertCircle, Search, History as HistoryIcon, RotateCcw, ArrowLeft, HeartPulse, CheckCircle, XCircle, Wifi, Database, Cpu, Loader2, Eye, ArrowRight, BookOpen, Shield, MousePointer2, MessageSquare, FolderInput, Download, FolderOpen, FileCode } from 'lucide-react';

// Reusing chart components...
const SimpleActivityChart = ({ data }: { data: {name: string, edits: number, comments: number}[] }) => {
  const values = data.map(d => d.edits + d.comments);
  const rawMax = values.length > 0 ? Math.max(...values) : 0;
  const maxVal = rawMax > 0 ? rawMax : 1;
  
  return (
    <div className="w-full h-64 flex items-end justify-between gap-2 px-2 pt-8 pb-2">
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center gap-2 w-full h-full justify-end group">
          <div className="relative w-full max-w-[40px] flex flex-col justify-end gap-0.5 h-full transition-all duration-500">
             <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
               {d.edits} edits, {d.comments} comments
             </div>
             <div 
               style={{height: `${(d.comments / maxVal) * 70}%`}} 
               className="w-full bg-amber-400 rounded-t-sm opacity-90 group-hover:opacity-100 transition-all"
             ></div>
             <div 
               style={{height: `${(d.edits / maxVal) * 70}%`}} 
               className="w-full bg-blue-500 rounded-b-sm opacity-90 group-hover:opacity-100 transition-all"
             ></div>
          </div>
          <span className="text-xs text-slate-400 font-medium">{d.name}</span>
        </div>
      ))}
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, color }: any) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-start justify-between">
    <div>
      <p className="text-slate-500 text-sm font-medium mb-1">{label}</p>
      <h4 className="text-2xl font-bold text-slate-800">{value}</h4>
    </div>
    <div className={`p-3 rounded-lg ${color}`}>
      {Icon && <Icon size={20} className="text-white" />}
    </div>
  </div>
);

export const AdminDashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [edits, setEdits] = useState<EditLog[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'sources' | 'edits' | 'history' | 'health' | 'settings' | 'docs'>('overview');
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = () => {
    setProjects(StorageService.getProjects());
    setEdits(StorageService.getEdits());
    setComments(StorageService.getComments());
  };

  // --- IMPORT LOGIC ---
  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsImporting(true);
    setImportStatus('Scanning directory...');
    
    const files = Array.from(e.target.files);
    // Infer project name from root folder
    const rootFolder = files[0].webkitRelativePath.split('/')[0] || 'imported_project';
    
    setImportStatus(`Analyzing folder "${rootFolder}"...`);
    const projectTitle = await GeminiService.generateProjectTitle(rootFolder);
    
    const projectId = `proj_${Date.now()}`;
    const newProject: Project = {
      id: projectId,
      folderName: rootFolder,
      title: projectTitle,
      importedAt: Date.now()
    };
    
    StorageService.addProject(newProject);
    setImportStatus(`Parsing HTML files...`);
    
    let count = 0;
    for (const file of files) {
      if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
        try {
          const text = await file.text();
          const { title, blocks } = HtmlService.parseHtml(text);
          
          const page: PageData = {
            id: `page_${Date.now()}_${count}`,
            projectId,
            fileName: file.name,
            slug: file.name.replace('.html', '').replace(/[^a-z0-9]/gi, '-').toLowerCase(),
            title,
            blocks,
            lastUpdated: Date.now(),
            originalHtml: text
          };
          StorageService.addPage(page);
          count++;
        } catch (err) {
          console.error("Failed to parse file", file.name, err);
        }
      }
    }
    
    setImportStatus(`Done! Imported ${count} pages.`);
    setTimeout(() => {
      setIsImporting(false);
      setImportStatus('');
      loadData();
    }, 1500);
  };

  // --- EXPORT LOGIC ---
  const handleExportProject = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    const pages = StorageService.getPagesByProject(projectId);
    
    if (!project || pages.length === 0) return;
    
    // Trigger downloads
    pages.forEach(page => {
      const updatedHtml = HtmlService.reconstructHtml(page.originalHtml, page.blocks);
      const blob = new Blob([updatedHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `[UPDATED] ${page.fileName}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    
    alert(`Downloading ${pages.length} updated files for "${project.title}"`);
  };

  // ... (reusing chart data)
  const chartData = [
    { name: 'Mon', edits: 4, comments: 2 },
    { name: 'Tue', edits: 3, comments: 5 },
    { name: 'Wed', edits: 7, comments: 3 },
    { name: 'Thu', edits: 2, comments: 1 },
    { name: 'Fri', edits: 12, comments: 8 },
    { name: 'Sat', edits: 5, comments: 4 },
    { name: 'Sun', edits: 8, comments: 6 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-slate-900 text-white px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 p-1.5 rounded-md">
            <Activity size={20} className="text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Live Review <span className="text-slate-400 font-normal">| Admin Portal</span></h1>
        </div>
        <div className="flex items-center gap-6 text-sm">
           <span className="flex items-center gap-2 text-slate-300"><div className="w-2 h-2 bg-green-500 rounded-full"></div> System Online</span>
           <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center font-bold text-xs">AD</div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 bg-white border-r border-slate-200 hidden lg:block flex-shrink-0">
          <nav className="p-4 space-y-1">
            <button onClick={() => setActiveTab('overview')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'overview' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Activity size={18} /> Overview
            </button>
            <button onClick={() => setActiveTab('sources')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'sources' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>
              <FolderInput size={18} /> Content Sources
            </button>
            <button onClick={() => setActiveTab('edits')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'edits' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>
              <FileText size={18} /> Change Log
            </button>
            <button onClick={() => setActiveTab('health')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'health' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>
              <HeartPulse size={18} /> System Health
            </button>
            <div className="pt-4 mt-4 border-t border-slate-100">
              <button onClick={() => setActiveTab('docs')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'docs' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>
                <BookOpen size={18} /> Documentation
              </button>
            </div>
          </nav>
        </aside>

        <main className="flex-1 p-8 overflow-y-auto">
          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-8 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard icon={FolderOpen} label="Active Projects" value={projects.length} color="bg-indigo-500" />
                <StatCard icon={Clock} label="System Uptime" value="95h" color="bg-emerald-500" />
                <StatCard icon={FileText} label="Total Edits" value={edits.length} color="bg-purple-500" />
                <StatCard icon={AlertCircle} label="Pending Comments" value={comments.filter(c => !c.resolved).length} color="bg-amber-500" />
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 mb-6">Activity Trends</h3>
                <SimpleActivityChart data={chartData} />
              </div>
            </div>
          )}

          {/* CONTENT SOURCES (New) */}
          {activeTab === 'sources' && (
            <div className="max-w-5xl animate-fade-in">
              <div className="mb-8 flex justify-between items-end">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">Content Sources</h2>
                  <p className="text-slate-600 mt-1">Import website folders for live review and export updated HTML.</p>
                </div>
                <div className="flex gap-3">
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    // @ts-ignore
                    webkitdirectory=""
                    directory="" 
                    multiple
                    className="hidden"
                    onChange={handleFolderSelect}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 shadow-sm shadow-blue-200"
                  >
                    {isImporting ? <Loader2 className="animate-spin" size={18}/> : <FolderInput size={18} />}
                    Import Project Folder
                  </button>
                </div>
              </div>

              {isImporting && (
                <div className="bg-blue-50 border border-blue-100 text-blue-700 p-4 rounded-xl mb-6 flex items-center gap-3 animate-fade-in">
                  <Loader2 className="animate-spin" />
                  <span className="font-medium">{importStatus}</span>
                </div>
              )}

              <div className="grid gap-4">
                {projects.map(project => (
                  <div key={project.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between group hover:border-blue-300 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center">
                        <FolderOpen size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-lg">{project.title}</h3>
                        <p className="text-xs text-slate-500 flex items-center gap-2">
                          <span className="font-mono bg-slate-100 px-1.5 rounded border border-slate-200">/{project.folderName}</span>
                          <span>• Imported {new Date(project.importedAt).toLocaleDateString()}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                         <div className="text-2xl font-bold text-slate-800">{StorageService.getPagesByProject(project.id).length}</div>
                         <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pages</div>
                      </div>
                      <button 
                        onClick={() => handleExportProject(project.id)}
                        className="flex flex-col items-center justify-center w-20 h-16 border border-slate-200 rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all"
                      >
                        <Download size={20} className="mb-1"/>
                        <span className="text-[10px] font-bold">Export</span>
                      </button>
                    </div>
                  </div>
                ))}

                {projects.length === 0 && !isImporting && (
                  <div className="text-center py-16 bg-white border-2 border-dashed border-slate-200 rounded-xl">
                    <FileCode size={48} className="mx-auto text-slate-300 mb-4" />
                    <h3 className="text-lg font-bold text-slate-600">No Projects Found</h3>
                    <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
                      Import a folder containing HTML files. The system will automatically create a project and parse content for live editing.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* ... (Keeping other tabs like edits, health, etc. mostly static or just placeholders as defined previously) */}
          {activeTab === 'edits' && (
             <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-500">
               <FileText size={48} className="mx-auto mb-4 text-slate-300"/>
               <p>Global edit log view.</p>
             </div>
          )}
          
          {activeTab === 'docs' && (
             <div className="prose max-w-3xl">
               <h1>System Documentation</h1>
               <p>Use the Content Sources tab to import new projects.</p>
             </div>
          )}

        </main>
      </div>
    </div>
  );
};