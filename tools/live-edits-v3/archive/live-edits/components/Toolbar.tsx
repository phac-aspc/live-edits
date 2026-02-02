import React from 'react';
import { User, UserRole, ViewMode } from '../types';
import { MousePointer2, Edit3, MessageSquareText, LayoutDashboard, LogOut, Globe } from 'lucide-react';

interface ToolbarProps {
  user: User | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  currentRoute: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  onOpenLogin: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  user,
  viewMode,
  setViewMode,
  currentRoute,
  onNavigate,
  onLogout,
  onOpenLogin
}) => {
  const isAdminRoute = currentRoute.includes('admin');
  const canEdit = user && (user.role === UserRole.ADMIN || user.role === UserRole.EDITOR);
  const canComment = user && user.role !== UserRole.VIEWER;
  const isSiteAdmin = user && user.role === UserRole.ADMIN;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white p-1.5 rounded-full shadow-2xl z-[100] flex gap-2 items-center border border-white/10 transition-all">
      <div className="px-3 border-r border-slate-700 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isAdminRoute ? 'bg-amber-500' : 'bg-green-500 animate-pulse'}`}></div>
        <span className="text-xs font-bold tracking-wider uppercase text-slate-300 hidden sm:block">
          {isAdminRoute ? 'Admin Mode' : 'Live Review'}
        </span>
      </div>
      
      {/* View Modes - Disabled in Admin */}
      <div className={`flex gap-1 ${isAdminRoute ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
        <button
          onClick={() => setViewMode('BROWSE')}
          className={`p-2 rounded-full transition-all ${viewMode === 'BROWSE' ? 'bg-white text-slate-900' : 'hover:bg-slate-800 text-slate-400'}`}
          title="Browse Mode"
        >
          <MousePointer2 size={18} />
        </button>
        
        {canEdit && (
          <button
            onClick={() => setViewMode('EDIT')}
            className={`p-2 rounded-full transition-all ${viewMode === 'EDIT' ? 'bg-blue-500 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
            title="Edit Mode"
          >
            <Edit3 size={18} />
          </button>
        )}

        {canComment && (
          <button
            onClick={() => setViewMode('COMMENT')}
            className={`p-2 rounded-full transition-all ${viewMode === 'COMMENT' ? 'bg-yellow-500 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
            title="Comment Mode"
          >
            <MessageSquareText size={18} />
          </button>
        )}
      </div>

      <div className="w-px h-4 bg-slate-700 mx-1"></div>

      {user ? (
        <div className="flex items-center gap-2 px-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold text-white" style={{backgroundColor: user.color}}>
              {user.username[0].toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-slate-200 font-medium leading-none">{user.username}</span>
              <span className="text-[9px] text-slate-400 leading-none uppercase">{user.role}</span>
            </div>
          </div>
          
          {/* Dynamic Navigation Button */}
          {isSiteAdmin && (
            <>
              {isAdminRoute ? (
                 <button 
                   onClick={() => onNavigate('#/')}
                   className="ml-2 flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-full border border-transparent text-[10px] text-white transition-colors font-bold shadow-lg shadow-blue-900/50"
                   title="Return to Site"
                 >
                   <Globe size={10} /> Site
                 </button>
              ) : (
                 <button 
                   onClick={() => onNavigate('#/admin')}
                   className="ml-2 flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-[10px] text-slate-300 transition-colors"
                   title="Go to Admin Portal"
                 >
                   <LayoutDashboard size={10} /> Portal
                 </button>
              )}
            </>
          )}

          <button onClick={onLogout} className="ml-1 p-1.5 hover:bg-red-500/20 text-red-400 rounded-full" title="Log Out">
            <LogOut size={14} />
          </button>
        </div>
      ) : (
        <button 
          onClick={onOpenLogin}
          className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded-full transition-colors font-medium"
        >
          Sign In
        </button>
      )}
    </div>
  );
};