import React, { useState } from 'react';
import { Lock, User as UserIcon, Shield, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

interface AdminLoginProps {
  onLogin: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simulate network delay for realism
    setTimeout(() => {
      // Mock Credential Check
      if (username.toLowerCase() === 'admin' && password === 'admin123') {
        onLogin();
      } else {
        setError('Invalid credentials. Please check your username and password.');
        setIsLoading(false);
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md z-10 animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-800 rounded-2xl mb-4 shadow-xl border border-slate-700">
            <Shield size={32} className="text-blue-500" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Admin Portal</h1>
          <p className="text-slate-400 mt-2">Secure access for Health Infobase administrators</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-8">
             <form onSubmit={handleSubmit} className="space-y-5">
               {error && (
                 <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg flex items-start gap-2 animate-fade-in">
                   <AlertCircle size={16} className="mt-0.5 shrink-0" />
                   <span>{error}</span>
                 </div>
               )}

               <div>
                 <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Username</label>
                 <div className="relative group">
                   <UserIcon size={18} className="absolute left-3 top-3 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                   <input 
                     type="text" 
                     className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                     placeholder="Enter username"
                     value={username}
                     onChange={(e) => setUsername(e.target.value)}
                     disabled={isLoading}
                   />
                 </div>
               </div>

               <div>
                 <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
                 <div className="relative group">
                   <Lock size={18} className="absolute left-3 top-3 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                   <input 
                     type="password" 
                     className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                     placeholder="Enter password"
                     value={password}
                     onChange={(e) => setPassword(e.target.value)}
                     disabled={isLoading}
                   />
                 </div>
               </div>

               <button 
                 type="submit" 
                 disabled={isLoading}
                 className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-lg shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed mt-2"
               >
                 {isLoading ? (
                   <>
                     <Loader2 size={18} className="animate-spin" /> Authenticating...
                   </>
                 ) : (
                   <>
                     Sign In <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                   </>
                 )}
               </button>
             </form>
          </div>
          <div className="bg-slate-900/50 p-4 border-t border-slate-700/50 text-center">
            <p className="text-xs text-slate-500">
              Demo Credentials: <span className="font-mono text-slate-400">admin</span> / <span className="font-mono text-slate-400">admin123</span>
            </p>
          </div>
        </div>
        
        <p className="text-center text-xs text-slate-600 mt-8">
          &copy; {new Date().getFullYear()} Health Infobase Live. Restricted Access.
        </p>
      </div>
    </div>
  );
};