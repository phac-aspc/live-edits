/**
 * Page Editor Library
 * Allows WYSIWYG editing and commenting on any HTML page
 */

(function() {
  'use strict';

  const API_BASE_URL = window.SUPABASE_URL ?
    `${window.SUPABASE_URL}/functions/v1/page-editor-api` :
    '/api/page-editor-api';

  const API_KEY = window.SUPABASE_ANON_KEY || '';

  class PageEditor {
    constructor() {
      this.currentPageUrl = window.location.pathname;
      this.isEditMode = false;
      this.isCommentMode = false;
      this.currentEditableElement = null;
      this.comments = [];
      this.userInitials = localStorage.getItem('pageEditorInitials') || '';

      this.init();
    }

    async init() {
      await this.loadLatestEdit();
      await this.loadComments();
      this.createToolbar();
      this.attachCommentClickHandlers();
      this.updateMetadataDisplay();
    }

    async loadLatestEdit() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/edits?pageUrl=${encodeURIComponent(this.currentPageUrl)}`,
          {
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data && data.html_content) {
            // Load the saved HTML content
            document.body.innerHTML = data.html_content;

            // Re-initialize after loading
            await this.loadComments();
            this.createToolbar();
            this.attachCommentClickHandlers();
            this.updateMetadataDisplay();
          }
        }
      } catch (error) {
        console.error('Error loading latest edit:', error);
      }
    }

    async loadComments() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/comments?pageUrl=${encodeURIComponent(this.currentPageUrl)}`,
          {
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          this.comments = await response.json();
          this.renderCommentMarkers();
        }
      } catch (error) {
        console.error('Error loading comments:', error);
      }
    }

    createToolbar() {
      // Remove existing toolbar if any
      const existingToolbar = document.getElementById('page-editor-toolbar');
      if (existingToolbar) {
        existingToolbar.remove();
      }

      const toolbar = document.createElement('div');
      toolbar.id = 'page-editor-toolbar';
      toolbar.innerHTML = `
        <style>
          #page-editor-toolbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
            color: white;
            padding: 12px 20px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }

          #page-editor-toolbar button {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
          }

          #page-editor-toolbar button:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-1px);
          }

          #page-editor-toolbar button.active {
            background: #10b981;
            border-color: #059669;
          }

          #page-editor-toolbar input {
            padding: 8px 12px;
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 6px;
            background: rgba(255,255,255,0.95);
            font-size: 14px;
            width: 80px;
          }

          #page-editor-toolbar .divider {
            width: 1px;
            height: 24px;
            background: rgba(255,255,255,0.3);
          }

          #page-editor-toolbar .info {
            margin-left: auto;
            font-size: 13px;
            opacity: 0.9;
          }

          .editable {
            outline: 2px dashed transparent;
            transition: outline 0.2s ease;
            cursor: pointer;
            position: relative;
          }

          .editable:hover {
            outline-color: rgba(59, 130, 246, 0.5);
          }

          .editable.editing {
            outline-color: #3b82f6;
            background: rgba(59, 130, 246, 0.05);
          }

          .wysiwyg-controls {
            position: sticky;
            top: 60px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 8px;
            margin-bottom: 8px;
            display: flex;
            gap: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            z-index: 9999;
          }

          .wysiwyg-controls button {
            background: white;
            border: 1px solid #d1d5db;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.15s ease;
            color: #374151;
          }

          .wysiwyg-controls button:hover {
            background: #f3f4f6;
            border-color: #9ca3af;
          }

          .wysiwyg-controls button:active {
            background: #e5e7eb;
          }

          .comment-marker {
            position: absolute;
            width: 24px;
            height: 24px;
            background: #f59e0b;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            z-index: 9998;
            transition: transform 0.2s ease;
          }

          .comment-marker:hover {
            transform: scale(1.1);
          }

          .comment-popup {
            position: absolute;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            min-width: 250px;
            max-width: 400px;
          }

          .comment-popup .comment-header {
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .comment-popup .comment-meta {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 8px;
          }

          .comment-popup .comment-text {
            color: #374151;
            line-height: 1.5;
            margin-bottom: 8px;
          }

          .comment-popup button {
            font-size: 12px;
            padding: 4px 8px;
          }

          .comment-input-popup {
            position: fixed;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.2);
            z-index: 10001;
          }

          .comment-input-popup textarea {
            width: 300px;
            height: 100px;
            padding: 8px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            font-family: inherit;
            font-size: 14px;
            resize: vertical;
            margin-bottom: 8px;
          }

          .comment-input-popup .buttons {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
          }

          body.comment-mode {
            cursor: crosshair !important;
          }

          body.comment-mode * {
            cursor: crosshair !important;
          }
        </style>

        <button id="edit-toggle-btn">Enable Editing</button>
        <button id="comment-toggle-btn">Add Comment</button>
        <div class="divider"></div>
        <label style="font-size: 13px;">
          Initials:
          <input type="text" id="initials-input" maxlength="4" placeholder="JD" value="${this.userInitials}">
        </label>
        <button id="save-btn" style="background: #10b981; border-color: #059669;">Save Changes</button>
        <button id="dashboard-btn">Dashboard</button>
        <div class="info" id="metadata-display"></div>
      `;

      document.body.insertBefore(toolbar, document.body.firstChild);
      document.body.style.paddingTop = '60px';

      // Attach event listeners
      document.getElementById('edit-toggle-btn').addEventListener('click', () => this.toggleEditMode());
      document.getElementById('comment-toggle-btn').addEventListener('click', () => this.toggleCommentMode());
      document.getElementById('save-btn').addEventListener('click', () => this.saveChanges());
      document.getElementById('dashboard-btn').addEventListener('click', () => this.openDashboard());
      document.getElementById('initials-input').addEventListener('input', (e) => {
        this.userInitials = e.target.value.toUpperCase();
        localStorage.setItem('pageEditorInitials', this.userInitials);
      });
    }

    toggleEditMode() {
      this.isEditMode = !this.isEditMode;
      const btn = document.getElementById('edit-toggle-btn');

      if (this.isEditMode) {
        btn.textContent = 'Disable Editing';
        btn.classList.add('active');
        this.enableEditableElements();
      } else {
        btn.textContent = 'Enable Editing';
        btn.classList.remove('active');
        this.disableEditableElements();
      }
    }

    toggleCommentMode() {
      this.isCommentMode = !this.isCommentMode;
      const btn = document.getElementById('comment-toggle-btn');

      if (this.isCommentMode) {
        btn.textContent = 'Cancel Comment';
        btn.classList.add('active');
        document.body.classList.add('comment-mode');
      } else {
        btn.textContent = 'Add Comment';
        btn.classList.remove('active');
        document.body.classList.remove('comment-mode');
      }
    }

    enableEditableElements() {
      const editables = document.querySelectorAll('.editable');
      editables.forEach(el => {
        el.addEventListener('click', (e) => this.handleEditableClick(e));
      });
    }

    disableEditableElements() {
      const editables = document.querySelectorAll('.editable');
      editables.forEach(el => {
        el.contentEditable = 'false';
        el.classList.remove('editing');
        const controls = el.previousElementSibling;
        if (controls && controls.classList.contains('wysiwyg-controls')) {
          controls.remove();
        }
      });
      this.currentEditableElement = null;
    }

    handleEditableClick(e) {
      if (!this.isEditMode) return;

      e.stopPropagation();
      const element = e.currentTarget;

      // Remove controls from previous element
      if (this.currentEditableElement && this.currentEditableElement !== element) {
        this.currentEditableElement.contentEditable = 'false';
        this.currentEditableElement.classList.remove('editing');
        const oldControls = this.currentEditableElement.previousElementSibling;
        if (oldControls && oldControls.classList.contains('wysiwyg-controls')) {
          oldControls.remove();
        }
      }

      element.contentEditable = 'true';
      element.classList.add('editing');
      element.focus();
      this.currentEditableElement = element;

      // Add WYSIWYG controls
      if (!element.previousElementSibling || !element.previousElementSibling.classList.contains('wysiwyg-controls')) {
        this.addWysiwygControls(element);
      }
    }

    addWysiwygControls(element) {
      const controls = document.createElement('div');
      controls.className = 'wysiwyg-controls';
      controls.innerHTML = `
        <button data-command="bold" title="Bold"><b>B</b></button>
        <button data-command="italic" title="Italic"><i>I</i></button>
        <button data-command="underline" title="Underline"><u>U</u></button>
        <button data-command="strikeThrough" title="Strikethrough"><s>S</s></button>
        <button data-command="insertUnorderedList" title="Bullet List">• List</button>
        <button data-command="insertOrderedList" title="Numbered List">1. List</button>
        <button data-command="formatBlock:h2" title="Heading 2">H2</button>
        <button data-command="formatBlock:h3" title="Heading 3">H3</button>
        <button data-command="formatBlock:p" title="Paragraph">P</button>
      `;

      element.parentNode.insertBefore(controls, element);

      controls.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const command = btn.dataset.command;
          if (command.includes(':')) {
            const [cmd, value] = command.split(':');
            document.execCommand(cmd, false, value);
          } else {
            document.execCommand(command, false, null);
          }
          element.focus();
        });
      });
    }

    attachCommentClickHandlers() {
      document.body.addEventListener('click', (e) => {
        if (this.isCommentMode) {
          e.preventDefault();
          e.stopPropagation();

          // Don't add comment on toolbar clicks
          if (e.target.closest('#page-editor-toolbar')) {
            return;
          }

          this.showCommentInput(e.pageX, e.pageY);
          this.toggleCommentMode();
        }
      });
    }

    showCommentInput(x, y) {
      const popup = document.createElement('div');
      popup.className = 'comment-input-popup';
      popup.style.left = `${x}px`;
      popup.style.top = `${y}px`;
      popup.innerHTML = `
        <textarea placeholder="Enter your comment..." autofocus></textarea>
        <div class="buttons">
          <button class="cancel-btn">Cancel</button>
          <button class="save-btn" style="background: #3b82f6; color: white; border: none;">Save</button>
        </div>
      `;

      document.body.appendChild(popup);
      const textarea = popup.querySelector('textarea');
      textarea.focus();

      popup.querySelector('.cancel-btn').addEventListener('click', () => popup.remove());
      popup.querySelector('.save-btn').addEventListener('click', async () => {
        const text = textarea.value.trim();
        if (text && this.userInitials) {
          await this.saveComment(text, x, y);
          popup.remove();
        } else if (!this.userInitials) {
          alert('Please enter your initials first');
        }
      });
    }

    async saveComment(text, x, y) {
      try {
        const response = await fetch(`${API_BASE_URL}/comments`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pageUrl: this.currentPageUrl,
            commentText: text,
            xPosition: x,
            yPosition: y,
            initials: this.userInitials,
          }),
        });

        if (response.ok) {
          await this.loadComments();
          this.updateMetadataDisplay();
        } else {
          alert('Failed to save comment');
        }
      } catch (error) {
        console.error('Error saving comment:', error);
        alert('Error saving comment');
      }
    }

    renderCommentMarkers() {
      // Remove existing markers
      document.querySelectorAll('.comment-marker').forEach(m => m.remove());

      this.comments.forEach((comment, index) => {
        const marker = document.createElement('div');
        marker.className = 'comment-marker';
        marker.textContent = index + 1;
        marker.style.left = `${comment.x_position}px`;
        marker.style.top = `${comment.y_position}px`;
        marker.dataset.commentId = comment.id;

        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showCommentPopup(comment, marker);
        });

        document.body.appendChild(marker);
      });
    }

    showCommentPopup(comment, marker) {
      // Remove existing popups
      document.querySelectorAll('.comment-popup').forEach(p => p.remove());

      const popup = document.createElement('div');
      popup.className = 'comment-popup';
      const rect = marker.getBoundingClientRect();
      popup.style.left = `${rect.right + 10}px`;
      popup.style.top = `${rect.top}px`;

      const date = new Date(comment.created_at).toLocaleString();
      popup.innerHTML = `
        <div class="comment-header">
          <span>${comment.initials}</span>
          <button class="delete-btn" style="background: #ef4444; color: white; border: none;">Delete</button>
        </div>
        <div class="comment-meta">${date}</div>
        <div class="comment-text">${comment.comment_text}</div>
      `;

      popup.querySelector('.delete-btn').addEventListener('click', async () => {
        await this.deleteComment(comment.id);
        popup.remove();
      });

      document.body.appendChild(popup);

      // Close popup when clicking outside
      setTimeout(() => {
        document.addEventListener('click', function closePopup(e) {
          if (!popup.contains(e.target) && e.target !== marker) {
            popup.remove();
            document.removeEventListener('click', closePopup);
          }
        });
      }, 0);
    }

    async deleteComment(commentId) {
      try {
        const response = await fetch(`${API_BASE_URL}/comments/${commentId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          await this.loadComments();
          this.updateMetadataDisplay();
        }
      } catch (error) {
        console.error('Error deleting comment:', error);
      }
    }

    async saveChanges() {
      if (!this.userInitials) {
        alert('Please enter your initials before saving');
        return;
      }

      try {
        // Get the current HTML of the body
        const htmlContent = document.body.innerHTML;

        const response = await fetch(`${API_BASE_URL}/edits`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pageUrl: this.currentPageUrl,
            htmlContent: htmlContent,
            editedBy: this.userInitials,
          }),
        });

        if (response.ok) {
          alert('Changes saved successfully!');
          this.updateMetadataDisplay();

          // Disable edit mode after saving
          if (this.isEditMode) {
            this.toggleEditMode();
          }
        } else {
          alert('Failed to save changes');
        }
      } catch (error) {
        console.error('Error saving changes:', error);
        alert('Error saving changes');
      }
    }

    async updateMetadataDisplay() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/stats?pageUrl=${encodeURIComponent(this.currentPageUrl)}`,
          {
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const stats = await response.json();
          const display = document.getElementById('metadata-display');

          if (stats.latestEdit) {
            const date = new Date(stats.latestEdit.created_at).toLocaleString();
            display.textContent = `Last edited by ${stats.latestEdit.edited_by} on ${date} | ${stats.commentCount} comments`;
          } else {
            display.textContent = `No edits yet | ${stats.commentCount} comments`;
          }
        }
      } catch (error) {
        console.error('Error loading metadata:', error);
      }
    }

    openDashboard() {
      window.open('dashboard.html', '_blank');
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.pageEditor = new PageEditor();
    });
  } else {
    window.pageEditor = new PageEditor();
  }
})();
