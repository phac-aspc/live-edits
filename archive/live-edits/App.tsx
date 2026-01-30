import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { SiteViewer } from './pages/SiteViewer';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminLogin } from './pages/AdminLogin';
import { User, ViewMode, UserRole } from './types';
import { AlertTriangle, User as UserIcon, Shield, Edit3, Eye } from 'lucide-react';
import { Toolbar } from './components/Toolbar';
import { Modal } from './components/Modal';

// Error Boundary to catch crashes
class SafeErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white p-8 rounded-xl shadow-xl max-w-md w-full border border-red-100">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle size={24} />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Something went wrong</h2>
            <p className="text-slate-600 text-sm mb-4">The application encountered an unexpected error.</p>
            <div className="bg-slate-100 p-3 rounded text-xs font-mono text-slate-700 mb-6 overflow-auto max-h-32">
              {this.state.error?.message || "Unknown error"}
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const App: React.FC = () => {
  // Initialize route from window, fallback to root
  const [route, setRoute] = useState(window.location.hash || '#/');
  const [user, setUser] = useState<User | null>(null);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  
  // Global State lifted from SiteViewer
  const [viewMode, setViewMode] = useState<ViewMode>('BROWSE');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginRole, setLoginRole] = useState<UserRole>(UserRole.EDITOR);

  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Robust navigation function
  const navigate = (path: string) => {
    setRoute(path);
    window.location.hash = path;
    // Reset view mode to browse when navigating to admin, restore otherwise
    if (path.includes('admin')) {
      setViewMode('BROWSE');
    }
  };

  // Login Logic
  const getRandomColor = () => {
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const handleLogin = () => {
    if (loginUsername.trim()) {
      setUser({ 
        username: loginUsername, 
        role: loginRole,
        color: getRandomColor()
      });
      setIsLoginModalOpen(false);
    }
  };

  // Routing Logic
  const renderRoute = () => {
    // Check if route contains admin (handles queries/trailing slashes)
    if (route.includes('admin')) {
      if (isAdminAuthenticated) {
        return <AdminDashboard />;
      }
      return <AdminLogin onLogin={() => setIsAdminAuthenticated(true)} />;
    }
    // Default to site viewer
    return (
      <SiteViewer 
        user={user} 
        onNavigate={navigate} 
        viewMode={viewMode} 
        onTriggerLogin={() => setIsLoginModalOpen(true)} 
      />
    );
  };

  return (
    <SafeErrorBoundary>
      <div className="relative min-h-screen bg-white">
        {renderRoute()}

        {/* Persistent Toolbar */}
        <Toolbar 
          user={user}
          viewMode={viewMode}
          setViewMode={setViewMode}
          currentRoute={route}
          onNavigate={navigate}
          onLogout={() => setUser(null)}
          onOpenLogin={() => setIsLoginModalOpen(true)}
        />

        {/* Global Login Modal */}
        <Modal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} title="Join Review Session">
          <div className="space-y-4">
            <p className="text-slate-600 text-sm">Enter your details to start contributing. Role selection is simulated for this demo.</p>
            
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Username</label>
              <div className="relative">
                 <UserIcon size={18} className="absolute left-3 top-3 text-slate-400"/>
                 <input 
                   type="text" 
                   placeholder="e.g. DrSmith"
                   className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                   value={loginUsername}
                   onChange={(e) => setLoginUsername(e.target.value)}
                   autoFocus
                 />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Role</label>
              <div className="grid grid-cols-3 gap-2">
                {[UserRole.VIEWER, UserRole.EDITOR, UserRole.ADMIN].map((role) => (
                  <button
                    key={role}
                    onClick={() => setLoginRole(role)}
                    className={`py-2 rounded-lg border text-sm font-medium transition-all ${loginRole === role ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                  >
                    <div className="flex flex-col items-center gap-1">
                      {role === 'ADMIN' && <Shield size={16} />}
                      {role === 'EDITOR' && <Edit3 size={16} />}
                      {role === 'VIEWER' && <Eye size={16} />}
                      <span className="capitalize text-xs">{role.toLowerCase()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            
            <button 
              onClick={handleLogin}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors mt-2"
            >
              Enter Session
            </button>
          </div>
        </Modal>
      </div>
    </SafeErrorBoundary>
  );
};

export default App;