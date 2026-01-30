
import React, { useState, useEffect } from 'react';
import { ContentBlock, ViewMode, UserRole, User } from '../types';
import { Edit2, Check, X, MessageSquare, Wand2, Loader2, AlertTriangle } from 'lucide-react';
import { GeminiService } from '../services/geminiService';

interface EditableBlockProps {
  block: ContentBlock;
  mode: ViewMode;
  user: User | null;
  onSave: (id: string, newContent: string, originalContent: string) => boolean;
  onCommentClick: (blockId: string) => void;
  commentCount: number;
}

export const EditableBlock: React.FC<EditableBlockProps> = ({ 
  block, 
  mode, 
  user,
  onSave, 
  onCommentClick,
  commentCount
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempContent, setTempContent] = useState(block.content);
  const [originalContent, setOriginalContent] = useState(block.content);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Check permissions
  const canEdit = user && (user.role === UserRole.ADMIN || user.role === UserRole.EDITOR);
  const canComment = user && (user.role !== UserRole.VIEWER);

  useEffect(() => {
    // If block updates from external source while not editing, update temp
    if (!isEditing) {
      setTempContent(block.content);
      setOriginalContent(block.content);
    }
  }, [block.content, isEditing]);

  const handleStartEdit = () => {
    setOriginalContent(block.content);
    setTempContent(block.content);
    setIsEditing(true);
  };

  const handleSave = () => {
    setSaveError(null);
    // Pass the content we *thought* we were editing to check for conflicts
    const success = onSave(block.id, tempContent, originalContent);
    if (success) {
      setIsEditing(false);
    } else {
      setSaveError("Conflict: Content changed by another user. Copy your changes and refresh.");
    }
  };

  const handleCancel = () => {
    setTempContent(block.content);
    setIsEditing(false);
    setSaveError(null);
  };

  const handleAiPolish = async () => {
    setIsAiLoading(true);
    const improved = await GeminiService.improveText(tempContent);
    setTempContent(improved);
    setIsAiLoading(false);
  };

  const renderContent = () => {
    switch (block.type) {
      case 'h1': return <h1 className="text-3xl font-bold text-slate-900 mb-4">{block.content}</h1>;
      case 'h2': return <h2 className="text-2xl font-semibold text-slate-800 mt-6 mb-3">{block.content}</h2>;
      case 'warning': 
        return (
          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 my-4 rounded-r">
            <p className="text-amber-800 font-medium">{block.content}</p>
          </div>
        );
      default: return <p className="text-slate-600 leading-relaxed mb-4">{block.content}</p>;
    }
  };

  if (mode === 'EDIT' && isEditing) {
    return (
      <div className="relative group mb-6 animate-fade-in">
        <div className="absolute -left-3 top-0 h-full w-1 bg-blue-500 rounded-full"></div>
        <div className={`p-4 bg-white border-2 rounded-lg shadow-sm ${saveError ? 'border-red-300' : 'border-blue-200'}`}>
           <label className="block text-xs font-semibold text-blue-500 uppercase mb-1 flex justify-between">
             <span>Editing: {block.type}</span>
             {saveError && <span className="text-red-500 flex items-center gap-1 font-bold"><AlertTriangle size={12}/> {saveError}</span>}
           </label>
           <textarea
             className={`w-full p-2 text-slate-700 border rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[100px] ${saveError ? 'border-red-300 bg-red-50' : 'border-slate-300'}`}
             value={tempContent}
             onChange={(e) => setTempContent(e.target.value)}
           />
           <div className="flex items-center justify-between mt-3">
             <button
               onClick={handleAiPolish}
               disabled={isAiLoading}
               className="flex items-center gap-2 text-xs font-medium text-purple-600 bg-purple-50 px-3 py-1.5 rounded-full hover:bg-purple-100 transition-colors"
             >
               {isAiLoading ? <Loader2 className="animate-spin" size={14} /> : <Wand2 size={14} />}
               AI Polish
             </button>

             <div className="flex gap-2">
               <button onClick={handleCancel} className="p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors" title="Cancel">
                 <X size={18} />
               </button>
               <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 shadow-md transition-all">
                 <Check size={16} /> Save
               </button>
             </div>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative group transition-all duration-200 ${mode !== 'BROWSE' ? 'hover:bg-slate-50 -mx-4 px-4 py-1 rounded-lg cursor-pointer border border-transparent hover:border-slate-200' : ''}`}>
      
      {/* Action Buttons Overlay */}
      {mode !== 'BROWSE' && (
        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/90 backdrop-blur shadow-sm rounded-full p-1 z-10">
          {mode === 'EDIT' && canEdit && (
            <button onClick={handleStartEdit} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full" title="Edit Block">
              <Edit2 size={16} />
            </button>
          )}
          {mode === 'COMMENT' && canComment && (
            <button onClick={() => onCommentClick(block.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-full" title="Add Comment">
              <MessageSquare size={16} />
            </button>
          )}
        </div>
      )}

      {/* Comment Indicator */}
      {commentCount > 0 && (
        <div className="absolute -right-8 top-2 cursor-pointer" onClick={() => onCommentClick(block.id)}>
          <div className="bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-0.5 rounded-full border border-yellow-200 shadow-sm flex items-center gap-1">
             <MessageSquare size={10} /> {commentCount}
          </div>
        </div>
      )}

      {renderContent()}
    </div>
  );
};
