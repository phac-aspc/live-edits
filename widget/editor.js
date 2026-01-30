/**
 * Live Edits v3 - Embeddable WYSIWYG Editor
 * 
 * Usage: Add these scripts to your HTML page (before closing </body>):
 * <script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
 * <script src="/path/to/editor.js"></script>
 * 
 * Make elements editable by adding class="editable"
 * 
 * Dynamic Content Detection:
 * To mark content as dynamically generated (so users know edits will revert), add:
 * - data-dynamic="true" attribute, OR
 * - class="dynamic-content", OR
 * - class containing "dynamic", "generated", or "js-" prefix
 * 
 * Dynamic content will be visually highlighted with a dotted underline and warning icon.
 * Users will be warned before editing dynamic content.
 * 
 * Note: Socket.IO client is required for real-time features.
 * If Socket.IO is not available, the editor will work but without real-time collaboration.
 */

(function() {
  'use strict';
  
  // Prevent re-initialization if already initialized
  if (window.liveEditsInitialized) {
    return;
  }
  window.liveEditsInitialized = true;

  // ============================================================================
  // CONFIGURATION - API base URL (same origin as page by default to avoid 404/CORS)
  // ============================================================================
  const scriptEl = document.currentScript || document.querySelector('script[src*="editor.js"]');
  const apiFromScript = scriptEl && scriptEl.getAttribute('data-live-edits-api');
  
  // Determine SERVER_URL
  let SERVER_URL;
  if (apiFromScript) {
    SERVER_URL = apiFromScript.replace(/\/$/, '');
  } else {
    // Default: use same origin, but handle infobase-dev.com -> en.infobase-dev.com
    const origin = window.location.origin;
    if (origin.includes('infobase-dev.com') && !origin.includes('en.infobase-dev.com')) {
      // Redirect to en.infobase-dev.com for API
      SERVER_URL = origin.replace('infobase-dev.com', 'en.infobase-dev.com') + '/live-edits';
    } else {
      SERVER_URL = origin + '/live-edits';
    }
  }
  
  const WS_URL = SERVER_URL;

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  // Normalize page path (remove trailing slash for consistency)
  const normalizePagePath = (path) => {
    return path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  };

  let state = {
    isEditMode: false,
    isCommentMode: false,
    currentEditableElement: null,
    currentPagePath: normalizePagePath(window.location.pathname),
    projectId: null,
    userId: localStorage.getItem('liveEdits_userId') || generateUserId(),
    userName: localStorage.getItem('liveEdits_userName') || '',
    socket: null,
    comments: [],
    presence: [],
    editLoaded: false, // Flag to prevent loading edit multiple times
    connectionErrorShown: false, // Flag to prevent showing connection error repeatedly
    lastError: null // Track last error message to avoid duplicate logs
  };
  
  console.log('Initialized with page path:', state.currentPagePath);

  // Generate or retrieve user ID
  function generateUserId() {
    let userId = localStorage.getItem('liveEdits_userId');
    if (!userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('liveEdits_userId', userId);
    }
    return userId;
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  async function init() {
    // Detect project from URL or meta tag (must complete before Save works)
    await detectProject();

    createToolbar();
    
    // Mark dynamic content before disabling editable elements
    markDynamicContent();
    
    // Ensure all editable elements are disabled on page load
    disableEditableElements();
    
    loadLatestEdit();
    loadComments();
    connectWebSocket();
    setupEventListeners();
  }

  // Detect project ID from folder path (URL, meta tag, or script data attribute)
  async function detectProject() {
    let folderPath = null;
    let projectName = null;
    const pathname = window.location.pathname;

    // 1) From URL: /_live-edits/products/project-name/...
    let pathMatch = pathname.match(/_live-edits\/(products\/[^/]+)/);
    if (pathMatch) {
      folderPath = `/_live-edits/${pathMatch[1]}`;
      projectName = pathMatch[1].split('/').pop();
    }

    // 2) From URL: /_live-edits/project-name/... (single segment -> map to products/project-name)
    if (!folderPath) {
      pathMatch = pathname.match(/_live-edits\/([^/]+)/);
      if (pathMatch && pathMatch[1] !== 'widget') {
        folderPath = `/_live-edits/products/${pathMatch[1]}`;
        projectName = pathMatch[1];
      }
    }

    // 3) Meta tag (injected by setup)
    if (!folderPath) {
      const meta = document.querySelector('meta[name="live-edits-folder-path"]');
      if (meta && meta.getAttribute('content')) {
        folderPath = meta.getAttribute('content').trim();
        if (folderPath) projectName = folderPath.split('/').filter(Boolean).pop();
      }
    }

    // 4) Script tag that loaded this widget (injected by setup)
    if (!folderPath) {
      const script = document.querySelector('script[src*="editor.js"]');
      if (script && script.getAttribute('data-live-edits-folder-path')) {
        folderPath = script.getAttribute('data-live-edits-folder-path').trim();
        if (folderPath) projectName = folderPath.split('/').filter(Boolean).pop();
      }
    }

    if (folderPath) {
      try {
        const url = `${SERVER_URL}/projects/${encodeURIComponent(folderPath)}`;
        const response = await fetch(url);
        if (response.ok) {
          const project = await response.json();
          state.projectId = project.id;
        } else if (response.status === 404) {
          // Project doesn't exist, try to register it
          const registerResponse = await fetch(`${SERVER_URL}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folder_path: folderPath,
              name: projectName || folderPath
            })
          });
          if (registerResponse.ok) {
            const project = await registerResponse.json();
            state.projectId = project.id;
          } else {
            const errorData = await registerResponse.json().catch(() => ({}));
            console.error('Failed to register project:', registerResponse.status, errorData);
          }
        } else {
          // Other error (400, 500, etc.)
          const errorData = await response.json().catch(() => ({}));
          console.error('Error getting project:', response.status, errorData);
        }
      } catch (error) {
        console.error('Error detecting project:', error);
      }
    }
  }

  // ============================================================================
  // TOOLBAR CREATION
  // ============================================================================
  function createToolbar() {
    // Remove existing toolbar and containers if they exist (cleanup duplicates)
    const existingToolbar = document.getElementById('live-edits-toolbar');
    if (existingToolbar) {
      existingToolbar.remove();
    }
    
    // Remove all existing wysiwyg containers (cleanup duplicates)
    document.querySelectorAll('#live-edits-wysiwyg-container').forEach(container => {
      container.remove();
    });
    
    const toolbar = document.createElement('div');
    toolbar.id = 'live-edits-toolbar';
    toolbar.innerHTML = `
      <style>
        #live-edits-toolbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: #26374A;
          color: white;
          padding: 12px 20px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.15);
          z-index: 10000;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #live-edits-toolbar .container {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        #live-edits-toolbar button {
          background: rgba(255,255,255,0.15);
          border: 1px solid rgba(255,255,255,0.25);
          color: white;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: all 0.2s ease;
          height: auto;
          line-height: 1.5;
          box-sizing: border-box;
        }
        #live-edits-toolbar button:hover {
          background: rgba(255,255,255,0.25);
          border-color: rgba(255,255,255,0.4);
        }
        #live-edits-toolbar button.active {
          background: #4A90E2;
          border-color: #5BA3F5;
        }
        #live-edits-toolbar button.active:hover {
          background: #5BA3F5;
        }
        #live-edits-toolbar #save-btn {
          background: #4A90E2;
          border-color: #5BA3F5;
        }
        #live-edits-toolbar #save-btn:hover {
          background: #5BA3F5;
        }
        #live-edits-toolbar #revert-btn {
          background: #DC3545;
          border-color: #C82333;
          color: white;
        }
        #live-edits-toolbar #revert-btn:hover {
          background: #C82333;
          border-color: #BD2130;
        }
        #live-edits-toolbar #edit-toggle-btn,
        #live-edits-toolbar #comment-toggle-btn {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.2);
        }
        #live-edits-toolbar #edit-toggle-btn:hover,
        #live-edits-toolbar #comment-toggle-btn:hover {
          background: rgba(255,255,255,0.2);
          border-color: rgba(255,255,255,0.3);
        }
        /* Revert dropdown styles */
        #revert-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          margin-top: 8px;
          background: white;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          min-width: 300px;
          max-width: 400px;
          max-height: 400px;
          overflow-y: auto;
          z-index: 10001;
          display: none;
        }
        #revert-dropdown.show {
          display: block;
        }
        #revert-dropdown .dropdown-header {
          padding: 12px 16px;
          background: #f3f4f6;
          border-bottom: 1px solid #e5e7eb;
          font-weight: 600;
          font-size: 14px;
          color: #374151;
        }
        #revert-dropdown .dropdown-item {
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          cursor: pointer;
          transition: background 0.2s ease;
        }
        #revert-dropdown .dropdown-item:last-child {
          border-bottom: none;
        }
        #revert-dropdown .dropdown-item:hover {
          background: #f9fafb;
        }
        #revert-dropdown .dropdown-item.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        #revert-dropdown .dropdown-item.disabled:hover {
          background: transparent;
        }
        #revert-dropdown .dropdown-item .item-time {
          font-size: 13px;
          color: #6b7280;
          margin-bottom: 4px;
        }
        #revert-dropdown .dropdown-item .item-editor {
          font-size: 14px;
          color: #374151;
          font-weight: 500;
        }
        #revert-dropdown .dropdown-item .item-label {
          font-size: 12px;
          color: #9ca3af;
          margin-top: 2px;
        }
        #revert-btn-wrapper {
          position: relative;
        }
        #live-edits-toolbar label {
          font-size: 16px;
          font-weight: 400;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          color: rgba(255,255,255,0.95);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        #live-edits-toolbar input {
          padding: 8px 12px;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 6px;
          background: rgba(255,255,255,0.95);
          font-size: 16px;
          width: 180px;
          height: auto;
          line-height: 1.5;
          box-sizing: border-box;
          margin-top: 4px;
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
        /* Dynamic content indicators */
        .editable[data-dynamic],
        .editable.dynamic-content {
          position: relative;
          background: linear-gradient(to bottom, transparent 0%, transparent 90%, rgba(239, 68, 68, 0.15) 90%, rgba(239, 68, 68, 0.15) 100%);
          border-bottom: 2px dotted rgba(239, 68, 68, 0.6);
          cursor: not-allowed;
        }
        .editable[data-dynamic]:hover,
        .editable.dynamic-content:hover {
          background: linear-gradient(to bottom, transparent 0%, transparent 90%, rgba(239, 68, 68, 0.25) 90%, rgba(239, 68, 68, 0.25) 100%);
          border-bottom-color: rgba(239, 68, 68, 0.8);
        }
        .editable[data-dynamic]::after,
        .editable.dynamic-content::after {
          content: '⚠';
          position: absolute;
          top: -2px;
          right: -18px;
          font-size: 12px;
          color: #ef4444;
          background: white;
          border-radius: 50%;
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          pointer-events: none;
        }
        .editable[data-dynamic]:hover::before,
        .editable.dynamic-content:hover::before {
          content: 'This content is generated dynamically and will revert on page reload';
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: #1f2937;
          color: white;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          white-space: nowrap;
          z-index: 10001;
          margin-bottom: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          pointer-events: none;
        }
        .editable[data-dynamic]:hover::before,
        .editable.dynamic-content:hover::before {
          white-space: normal;
          max-width: 250px;
          text-align: center;
        }
        /* Prevent editing SVG elements */
        svg .editable,
        .editable svg,
        svg.editable {
          cursor: not-allowed !important;
          pointer-events: none !important;
        }
        svg .editable:hover,
        .editable svg:hover,
        svg.editable:hover {
          outline: none !important;
        }
        .wysiwyg-controls {
          position: fixed;
          top: 60px;
          left: 0;
          right: 0;
          padding: 10px 20px;
          z-index: 9999;
        }
        .wysiwyg-controls .container {
          display: flex;
          gap: 4px;
          width: 100%;
        }
        .wysiwyg-controls button {
          background: white;
          border: 1px solid #d1d5db;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          color: #374151;
        }
        .wysiwyg-controls button:hover {
          background: #f3f4f6;
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
        }
        .presence-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          opacity: 0.9;
        }
        .presence-dot {
          width: 8px;
          height: 8px;
          background: #10b981;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
      <div class="container">
        <button id="edit-toggle-btn">Enable editing</button>
        <button id="comment-toggle-btn">Add comment</button>
        <div style="width: 1px; height: 24px; background: rgba(255,255,255,0.3);"></div>
        <label>
          Name:
          <input type="text" id="user-name-input" placeholder="Your name" value="${state.userName}" maxlength="20">
        </label>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div id="revert-btn-wrapper" style="position: relative;">
            <button id="revert-btn">Revert to...</button>
            <div id="revert-dropdown"></div>
          </div>
          <button id="save-btn">Save Changes</button>
          <div id="status-indicator" style="font-size: 12px; opacity: 0.8;"></div>
        </div>
        <div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
          <div class="presence-indicator" id="presence-indicator"></div>
        </div>
      </div>
    `;

    // Place toolbar at top of body, after Google Analytics script if present
    const body = document.body;
    let insertBeforeNode = body.firstChild;
    for (let i = 0; i < body.children.length; i++) {
      const el = body.children[i];
      if (el.tagName !== 'SCRIPT') continue;
      const src = (el.getAttribute('src') || '').toLowerCase();
      const content = (el.textContent || '').slice(0, 200);
      const isGA = src.includes('googletagmanager') || src.includes('google-analytics') || src.includes('gtag') || src.includes('analytics.js') || src.includes('ga.js') || content.includes("ga('create'") || content.includes('gtag(');
      if (isGA) {
        insertBeforeNode = el.nextSibling;
        break;
      }
    }
    body.insertBefore(toolbar, insertBeforeNode);
    
    // Create a container for WYSIWYG controls that will appear below toolbar
    // Check if it already exists (shouldn't after cleanup above, but double-check)
    let wysiwygContainer = document.getElementById('live-edits-wysiwyg-container');
    if (!wysiwygContainer) {
      wysiwygContainer = document.createElement('div');
      wysiwygContainer.id = 'live-edits-wysiwyg-container';
      wysiwygContainer.style.cssText = 'position: fixed; top: 60px; left: 0; right: 0; z-index: 9999; display: none;box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);border-bottom: 1px solid #e5e7eb;background:white;height:50px;';
      body.insertBefore(wysiwygContainer, toolbar.nextSibling);
    }
    
    // Set padding to account for toolbar (60px) + potential wysiwyg controls (48px)
    body.style.paddingTop = '108px';

    // Attach event listeners
    document.getElementById('edit-toggle-btn').addEventListener('click', toggleEditMode);
    document.getElementById('comment-toggle-btn').addEventListener('click', toggleCommentMode);
    document.getElementById('save-btn').addEventListener('click', saveChanges);
    
    // Revert button and dropdown
    const revertBtn = document.getElementById('revert-btn');
    const revertDropdown = document.getElementById('revert-dropdown');
    revertBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (revertDropdown.classList.contains('show')) {
        revertDropdown.classList.remove('show');
      } else {
        loadEditHistory();
      }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
      if (!revertBtn.contains(e.target) && !revertDropdown.contains(e.target)) {
        revertDropdown.classList.remove('show');
      }
    });
    
    document.getElementById('user-name-input').addEventListener('input', (e) => {
      state.userName = e.target.value;
      localStorage.setItem('liveEdits_userName', state.userName);
      if (state.socket) {
        state.socket.emit('join', {
          projectId: state.projectId,
          pagePath: state.currentPagePath,
          userId: state.userId,
          userName: state.userName
        });
      }
    });
  }

  // ============================================================================
  // EDIT MODE
  // ============================================================================
  function toggleEditMode() {
    state.isEditMode = !state.isEditMode;
    const btn = document.getElementById('edit-toggle-btn');

    if (state.isEditMode) {
      btn.textContent = 'Disable editing';
      btn.classList.add('active');
      enableEditableElements();
    } else {
      btn.textContent = 'Enable editing';
      btn.classList.remove('active');
      disableEditableElements();
    }
  }

  /**
   * Check if an element is inside an SVG element (including being an SVG element itself)
   */
  function isInsideSVG(element) {
    if (!element) return false;
    // Check if element itself is SVG or an SVG namespace element
    if (element.tagName === 'svg' || element.namespaceURI === 'http://www.w3.org/2000/svg') {
      return true;
    }
    // Check if any parent is SVG
    let parent = element.parentElement;
    while (parent) {
      if (parent.tagName === 'svg' || parent.namespaceURI === 'http://www.w3.org/2000/svg') {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function enableEditableElements() {
    // Re-mark dynamic content in case DOM changed
    markDynamicContent();
    
    const editables = document.querySelectorAll('.editable');
    editables.forEach(el => {
      // Skip SVG elements and their children - they should not be editable
      if (isInsideSVG(el)) {
        // Remove editable class from SVG elements to prevent editing
        el.classList.remove('editable');
        el.contentEditable = 'false';
        return;
      }
      
      // Ensure contentEditable is false initially
      el.contentEditable = 'false';
      // Remove any existing listener to avoid duplicates
      el.removeEventListener('click', handleEditableClick);
      // Add click listener
      el.addEventListener('click', handleEditableClick);
    });
  }

  /**
   * Mark dynamically generated content for visual indication
   * Looks for elements with data-dynamic attribute or common dynamic content patterns
   */
  function markDynamicContent() {
    // Method 1: Check for explicit data-dynamic attribute
    const explicitDynamic = document.querySelectorAll('.editable[data-dynamic="true"], .editable[data-dynamic]');
    explicitDynamic.forEach(el => {
      el.setAttribute('data-dynamic', 'true');
      el.classList.add('dynamic-content');
    });

    // Method 2: Check for common dynamic content class patterns
    // You can customize these selectors based on your site's patterns
    const dynamicPatterns = [
      '.editable[class*="dynamic"]',
      '.editable[class*="generated"]',
      '.editable[class*="js-"]',
      '.editable[data-js]',
      '.editable[data-generated]'
    ];
    
    dynamicPatterns.forEach(pattern => {
      try {
        const matches = document.querySelectorAll(pattern);
        matches.forEach(el => {
          if (!el.hasAttribute('data-dynamic')) {
            el.setAttribute('data-dynamic', 'true');
            el.classList.add('dynamic-content');
          }
        });
      } catch (e) {
        // Invalid selector, skip
      }
    });

    // Method 3: Check for elements that might be regenerated by common JS patterns
    // Look for elements with specific data attributes that indicate dynamic content
    const dataDynamicSelectors = document.querySelectorAll('.editable[data-dynamic-content], .editable[data-auto-generated]');
    dataDynamicSelectors.forEach(el => {
      el.setAttribute('data-dynamic', 'true');
      el.classList.add('dynamic-content');
    });
  }

  function disableEditableElements() {
    // Disable all elements with .editable class
    const editables = document.querySelectorAll('.editable');
    editables.forEach(el => {
      // Skip SVG elements
      if (isInsideSVG(el)) {
        return;
      }
      el.contentEditable = 'false';
      el.classList.remove('editing');
      // Remove click listener
      el.removeEventListener('click', handleEditableClick);
    });
    
    // Also disable any elements that might have contentEditable set directly
    const allElements = document.querySelectorAll('[contenteditable="true"]');
    allElements.forEach(el => {
      // Skip SVG elements
      if (isInsideSVG(el)) {
        el.contentEditable = 'false';
        return;
      }
      // Only disable if it's not the current editable element (or if edit mode is off)
      if (!state.isEditMode || el !== state.currentEditableElement) {
        el.contentEditable = 'false';
      }
    });
    
    // Hide WYSIWYG controls container
    const wysiwygContainer = document.getElementById('live-edits-wysiwyg-container');
    if (wysiwygContainer) {
      wysiwygContainer.style.display = 'none';
      wysiwygContainer.innerHTML = '';
    }
    state.currentEditableElement = null;
  }

  function handleEditableClick(e) {
    // Double-check edit mode is active
    if (!state.isEditMode) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    e.stopPropagation();
    const element = e.currentTarget;

    // Prevent editing SVG elements and their children
    if (isInsideSVG(element)) {
      alert('⚠️ SVG elements cannot be edited. SVG content is generated programmatically and editing it manually could break the graphics.');
      e.preventDefault();
      return;
    }

    // Check if this is dynamic content
    if (element.hasAttribute('data-dynamic') || element.classList.contains('dynamic-content')) {
      const proceed = confirm(
        '⚠️ Warning: This content is generated dynamically.\n\n' +
        'Any edits you make will be lost when the page reloads because JavaScript regenerates this content.\n\n' +
        'Do you still want to edit it?'
      );
      if (!proceed) {
        e.preventDefault();
        return;
      }
    }

    // Ensure element is not already editable (safety check)
    if (element.contentEditable === 'true' && !state.isEditMode) {
      element.contentEditable = 'false';
      return;
    }

    // Remove controls from previous element
    if (state.currentEditableElement && state.currentEditableElement !== element) {
      state.currentEditableElement.contentEditable = 'false';
      state.currentEditableElement.classList.remove('editing');
      // Controls are now in fixed container, so just remove editing class
    }

    element.contentEditable = 'true';
    element.classList.add('editing');
    element.focus();
    state.currentEditableElement = element;

    // Add WYSIWYG controls in fixed container below toolbar
    addWysiwygControls(element);
  }

  function addWysiwygControls(element) {
    // Get or create the fixed container below toolbar
    let container = document.getElementById('live-edits-wysiwyg-container');
    
    // If container doesn't exist, create it (should have been created in createToolbar, but handle edge case)
    if (!container) {
      container = document.createElement('div');
      container.id = 'live-edits-wysiwyg-container';
      container.style.cssText = 'position: fixed; top: 60px; left: 0; right: 0; z-index: 9999; display: none;box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);border-bottom: 1px solid #e5e7eb;background:white;height:50px;';
      const toolbar = document.getElementById('live-edits-toolbar');
      if (toolbar && toolbar.nextSibling) {
        toolbar.parentNode.insertBefore(container, toolbar.nextSibling);
      } else {
        document.body.appendChild(container);
      }
    }
    
    // Clear any existing controls
    container.innerHTML = '';
    container.style.display = 'block';
    
    // Create controls
    const controls = document.createElement('div');
    controls.className = 'wysiwyg-controls container';
    controls.innerHTML = `
        <button data-command="bold" title="Bold"><b>B</b></button>
        <button data-command="italic" title="Italic"><i>I</i></button>
        <button data-command="underline" title="Underline"><u>U</u></button>
        <button data-command="insertUnorderedList" title="Bullet List">• List</button>
        <button data-command="insertOrderedList" title="Numbered List">1. List</button>
        <button data-command="formatBlock:h2" title="Heading 2">H2</button>
        <button data-command="formatBlock:h3" title="Heading 3">H3</button>
        <button data-command="formatBlock:p" title="Paragraph">P</button>
    `;

    // Add controls to the fixed container
    container.appendChild(controls);

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

  // ============================================================================
  // COMMENT MODE
  // ============================================================================
  function toggleCommentMode() {
    state.isCommentMode = !state.isCommentMode;
    const btn = document.getElementById('comment-toggle-btn');

    if (state.isCommentMode) {
      btn.textContent = 'Cancel comment';
      btn.classList.add('active');
      document.body.style.cursor = 'crosshair';
    } else {
      btn.textContent = 'Add comment';
      btn.classList.remove('active');
      document.body.style.cursor = 'default';
    }
  }

  function setupEventListeners() {
    document.body.addEventListener('click', (e) => {
      if (state.isCommentMode) {
        e.preventDefault();
        e.stopPropagation();

        if (e.target.closest('#live-edits-toolbar')) {
          return;
        }

        showCommentInput(e.pageX, e.pageY);
        toggleCommentMode();
      }
    });
  }

  function showCommentInput(x, y) {
    const popup = document.createElement('div');
    popup.className = 'comment-input-popup';
    popup.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      z-index: 10001;
      transform: translate(-50%, -50%);
      left: ${x}px;
      top: ${y}px;
    `;
    popup.innerHTML = `
      <textarea placeholder="Enter your comment..." autofocus style="width: 300px; height: 100px; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-family: inherit; font-size: 14px; resize: vertical; margin-bottom: 8px;"></textarea>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="cancel-btn" style="padding: 8px 16px; border: 1px solid #d1d5db; border-radius: 4px; background: white; cursor: pointer; font-size: 16px;">Cancel</button>
        <button class="save-btn" style="padding: 8px 16px; border: none; border-radius: 4px; background: #3b82f6; color: white; cursor: pointer; font-size: 16px;">Save</button>
      </div>
    `;

    document.body.appendChild(popup);
    const textarea = popup.querySelector('textarea');
    textarea.focus();

    // Function to remove popup
    const removePopup = () => {
      popup.remove();
      // Remove click-outside listener
      document.removeEventListener('click', handleClickOutside);
    };

    // Handle click outside - cancel if empty
    const handleClickOutside = (e) => {
      // Don't close if clicking inside the popup
      if (popup.contains(e.target)) {
        return;
      }
      
      // Stop propagation to prevent triggering other click handlers
      e.stopPropagation();
      
      // If textarea is empty, cancel and remove
      if (!textarea.value.trim()) {
        removePopup();
      }
    };

    // Add click-outside listener after a short delay to avoid immediate trigger
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);

    popup.querySelector('.cancel-btn').addEventListener('click', () => {
      document.removeEventListener('click', handleClickOutside);
      popup.remove();
    });
    
    popup.querySelector('.save-btn').addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (text && state.userName) {
        document.removeEventListener('click', handleClickOutside);
        await saveComment(text, x, y);
        popup.remove();
      } else if (!state.userName) {
        alert('Please enter your name first');
      }
    });
  }

  async function saveComment(text, x, y) {
    if (!state.projectId) {
      alert('Project not detected. Please refresh the page.');
      return;
    }

    // Convert pixel positions to percentages based on viewport size
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const xPercent = (x / viewportWidth) * 100;
    const yPercent = (y / viewportHeight) * 100;

    try {
      const response = await fetch(`${SERVER_URL}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          page_path: state.currentPagePath,
          x_position: xPercent,
          y_position: yPercent,
          comment_text: text,
          author: state.userName
        })
      });

      if (response.ok) {
        await loadComments();
        if (state.socket && state.socket.connected) {
          state.socket.emit('comment', {
            projectId: state.projectId,
            pagePath: state.currentPagePath,
            comment: { text, x: xPercent, y: yPercent, author: state.userName }
          });
        }
      } else {
        alert('Failed to save comment');
      }
    } catch (error) {
      console.error('Error saving comment:', error);
      alert('Error saving comment');
    }
  }

  async function loadComments() {
    if (!state.projectId) return;

    try {
      const response = await fetch(`${SERVER_URL}/comments/${state.projectId}/${encodeURIComponent(state.currentPagePath)}`);
      if (response.ok) {
        state.comments = await response.json();
        renderCommentMarkers();
      }
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  }

  function renderCommentMarkers() {
    document.querySelectorAll('.comment-marker').forEach(m => m.remove());

    // Get current viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    state.comments.forEach((comment, index) => {
      const marker = document.createElement('div');
      marker.className = 'comment-marker';
      marker.textContent = index + 1;
      
      // Convert percentage positions back to pixels based on current viewport size
      // Handle both old pixel-based values (if > 100, assume pixels) and new percentage values
      let xPos, yPos;
      if (comment.x_position > 100 || comment.y_position > 100) {
        // Legacy pixel-based position - assume it was saved on a 1920x1080 viewport (common default)
        // Convert to percentage, then to current viewport
        const assumedViewportWidth = 1920;
        const assumedViewportHeight = 1080;
        const xPercent = (comment.x_position / assumedViewportWidth) * 100;
        const yPercent = (comment.y_position / assumedViewportHeight) * 100;
        xPos = (xPercent / 100) * viewportWidth;
        yPos = (yPercent / 100) * viewportHeight;
      } else {
        // Percentage-based position (0-100) - new system
        xPos = (comment.x_position / 100) * viewportWidth;
        yPos = (comment.y_position / 100) * viewportHeight;
      }
      
      marker.style.left = `${xPos}px`;
      marker.style.top = `${yPos}px`;

      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        showCommentPopup(comment, marker);
      });

      document.body.appendChild(marker);
    });
  }
  
  // Re-render markers on window resize to maintain correct positions
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (state.comments && state.comments.length > 0) {
        renderCommentMarkers();
      }
    }, 250);
  });

  function showCommentPopup(comment, marker) {
    document.querySelectorAll('.comment-popup').forEach(p => p.remove());

    const popup = document.createElement('div');
    popup.className = 'comment-popup';
    popup.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 9999;
      min-width: 250px;
      max-width: 400px;
      left: ${marker.offsetLeft + 30}px;
      top: ${marker.offsetTop}px;
    `;

    const date = new Date(comment.created_at).toLocaleString();
    popup.innerHTML = `
      <div style="font-weight: 600; color: #1f2937; margin-bottom: 8px; display: flex; justify-content: space-between;">
        <span>${comment.author}</span>
        <button class="delete-btn" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 16px;">Delete</button>
      </div>
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">${date}</div>
      <div style="color: #374151; line-height: 1.5;">${comment.comment_text}</div>
    `;

    popup.querySelector('.delete-btn').addEventListener('click', async () => {
      await deleteComment(comment.id);
      popup.remove();
    });

    document.body.appendChild(popup);

    setTimeout(() => {
      document.addEventListener('click', function closePopup(e) {
        if (!popup.contains(e.target) && e.target !== marker) {
          popup.remove();
          document.removeEventListener('click', closePopup);
        }
      });
    }, 0);
  }

  async function deleteComment(commentId) {
    try {
      const response = await fetch(`${SERVER_URL}/comments/${commentId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadComments();
      }
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  }

  // ============================================================================
  // SAVE FUNCTIONALITY
  // ============================================================================
  async function saveChanges() {
    if (!state.userName) {
      alert('Please enter your name before saving');
      return;
    }

    if (!state.projectId) {
      alert('Project not detected. Please refresh the page.');
      return;
    }

    try {
      // Clone the body to avoid modifying the original
      const bodyClone = document.body.cloneNode(true);
      
      // Remove widget UI elements before saving
      const toolbar = bodyClone.querySelector('#live-edits-toolbar');
      if (toolbar) toolbar.remove();
      
      // Remove all comment markers
      bodyClone.querySelectorAll('.comment-marker').forEach(m => m.remove());
      
      // Remove all WYSIWYG controls
      bodyClone.querySelectorAll('.wysiwyg-controls').forEach(c => c.remove());
      
      // Remove comment popups
      bodyClone.querySelectorAll('.comment-popup').forEach(p => p.remove());
      
      // Remove padding-top that was added for toolbar
      if (bodyClone.style) {
        bodyClone.style.paddingTop = '';
      }
      
      // Get the cleaned HTML content
      const htmlContent = bodyClone.innerHTML;
      
      console.log('Saving edit:', {
        projectId: state.projectId,
        pagePath: state.currentPagePath,
        contentLength: htmlContent.length,
        url: `${SERVER_URL}/edits`
      });

      const response = await fetch(`${SERVER_URL}/edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          page_path: state.currentPagePath,
          html_content: htmlContent,
          edited_by: state.userName
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Edit saved successfully:', result);
        updateStatus('Changes saved!', 'success');
        
        // Broadcast edit via WebSocket
        if (state.socket && state.socket.connected) {
          state.socket.emit('edit', {
            projectId: state.projectId,
            pagePath: state.currentPagePath,
            htmlContent,
            editedBy: state.userName
          });
        }

        // Disable edit mode after saving
        if (state.isEditMode) {
          toggleEditMode();
        }
      } else {
        updateStatus('Failed to save changes', 'error');
      }
    } catch (error) {
      console.error('Error saving changes:', error);
      updateStatus('Error saving changes', 'error');
    }
  }

  /**
   * Load edit history and show dropdown
   */
  async function loadEditHistory() {
    if (!state.projectId || !state.currentPagePath) {
      updateStatus('Cannot load history: Project not detected', 'error');
      return;
    }

    const revertDropdown = document.getElementById('revert-dropdown');
    revertDropdown.innerHTML = '<div class="dropdown-header">Loading history...</div>';

    try {
      const url = `${SERVER_URL}/edits/history/${state.projectId}${state.currentPagePath}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          revertDropdown.innerHTML = '<div class="dropdown-header">No saved versions found</div>';
          revertDropdown.classList.add('show');
          return;
        }
        throw new Error('Failed to load history');
      }

      const edits = await response.json();
      
      if (!edits || edits.length === 0) {
        revertDropdown.innerHTML = '<div class="dropdown-header">No saved versions found</div>';
        revertDropdown.classList.add('show');
        return;
      }

      // Limit to last 5 edits
      const recentEdits = edits.slice(0, 5);
      
      // Format dropdown content
      let dropdownHTML = '<div class="dropdown-header">Revert to previous save</div>';
      
      recentEdits.forEach((edit, index) => {
        const date = new Date(edit.created_at);
        const timeStr = date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        
        const editorName = edit.edited_by || 'Unknown';
        const isCurrent = index === 0; // Most recent is current
        
        dropdownHTML += `
          <div class="dropdown-item ${isCurrent ? 'disabled' : ''}" data-edit-id="${edit.id}" ${isCurrent ? 'data-current="true"' : ''}>
            <div class="item-time">${timeStr}</div>
            <div class="item-editor">${editorName}</div>
            ${isCurrent ? '<div class="item-label">(Current version)</div>' : ''}
          </div>
        `;
      });

      revertDropdown.innerHTML = dropdownHTML;
      revertDropdown.classList.add('show');

      // Add click handlers to dropdown items (skip the current version)
      revertDropdown.querySelectorAll('.dropdown-item').forEach(item => {
        const editId = item.getAttribute('data-edit-id');
        const isCurrent = item.getAttribute('data-current') === 'true';
        
        if (!editId || isCurrent) {
          return; // Skip current version or items without ID
        }

        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          await revertToEdit(editId);
          revertDropdown.classList.remove('show');
        });
      });

    } catch (error) {
      console.error('Error loading edit history:', error);
      revertDropdown.innerHTML = '<div class="dropdown-header">Error loading history</div>';
      revertDropdown.classList.add('show');
    }
  }

  /**
   * Revert to a specific edit version
   */
  async function revertToEdit(editId) {
    if (!state.projectId || !state.currentPagePath) {
      updateStatus('Cannot revert: Project not detected', 'error');
      return;
    }

    // Check if user is currently editing
    if (state.isEditMode && state.currentEditableElement) {
      const hasUnsavedChanges = confirm(
        '⚠️ Warning: You are currently editing content.\n\n' +
        'Reverting will discard your current edits.\n\n' +
        'Do you want to continue?'
      );
      if (!hasUnsavedChanges) {
        return;
      }
    }

    const confirmRevert = confirm(
      '⚠️ Warning: This will replace the current content with a previous version.\n\n' +
      'Any unsaved changes will be lost.\n\n' +
      'Do you want to continue?'
    );

    if (!confirmRevert) {
      return;
    }

    try {
      updateStatus('Reverting...', 'info');
      
      const url = `${SERVER_URL}/edits/by-id/${editId}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to load edit version');
      }

      const edit = await response.json();
      
      if (!edit || !edit.html_content) {
        throw new Error('Edit version has no content');
      }

      // Store current body content as backup
      const originalBodyHTML = document.body.innerHTML;
      
      // Store GTM dataLayer if it exists
      const gtmDataLayer = window.dataLayer ? Array.from(window.dataLayer) : null;
      
      // Suppress GTM errors during DOM replacement
      const originalErrorHandler = window.onerror;
      window.onerror = function(msg, url, line, col, error) {
        if (msg && (msg.indexOf('parentNode') !== -1 || msg.indexOf('GTM') !== -1 || msg.indexOf('gtm') !== -1)) {
          console.debug('Suppressed GTM error during revert:', msg);
          return true;
        }
        if (originalErrorHandler) {
          return originalErrorHandler.apply(this, arguments);
        }
        return false;
      };

      try {
        // Replace body content with reverted version
        const trimmedContent = edit.html_content.trim();
        document.body.innerHTML = trimmedContent;
        
        // Restore GTM dataLayer
        if (gtmDataLayer) {
          if (!window.dataLayer) {
            window.dataLayer = [];
          }
          gtmDataLayer.forEach(item => {
            var exists = window.dataLayer.some(existing => 
              JSON.stringify(existing) === JSON.stringify(item)
            );
            if (!exists) {
              window.dataLayer.push(item);
            }
          });
        }

        // Verify replacement was successful
        if (document.body.innerHTML.trim().length === 0) {
          console.error('Body content was cleared after revert, restoring original');
          document.body.innerHTML = originalBodyHTML;
          updateStatus('Revert failed: Content was empty', 'error');
          return;
        }
      } catch (error) {
        console.error('Error replacing body content during revert:', error);
        try {
          document.body.innerHTML = originalBodyHTML;
        } catch (e) {
          console.error('Failed to restore original body content:', e);
        }
        updateStatus('Revert failed', 'error');
        return;
      } finally {
        window.onerror = originalErrorHandler;
      }

      // Re-add scripts that were removed
      const bodyScripts = Array.from(document.body.querySelectorAll('script[src]')).filter(s => 
        !s.src.includes('editor.js')
      );
      const scriptData = bodyScripts.map(s => ({ src: s.src, async: s.async, defer: s.defer }));
      
      setTimeout(() => {
        scriptData.forEach(scriptInfo => {
          if (!document.querySelector(`script[src="${scriptInfo.src}"]`)) {
            const newScript = document.createElement('script');
            newScript.src = scriptInfo.src;
            if (scriptInfo.async) newScript.async = true;
            if (scriptInfo.defer) newScript.defer = true;
            newScript.onerror = function() {
              console.warn('Failed to reload script:', scriptInfo.src);
            };
            document.body.appendChild(newScript);
          }
        });
      }, 100);

      // Re-run initialization
      setTimeout(() => {
        createToolbar();
        markDynamicContent();
        disableEditableElements();
        loadComments();
        connectWebSocket();
        setupEventListeners();
      }, 50);

      updateStatus('Reverted successfully', 'success');
      console.log('Reverted to edit:', editId);

    } catch (error) {
      console.error('Error reverting to edit:', error);
      updateStatus('Error reverting: ' + error.message, 'error');
    }
  }

  async function loadLatestEdit() {
    // Prevent loading multiple times
    if (state.editLoaded) {
      console.log('Edit already loaded, skipping');
      return;
    }
    
    // Ensure body has content before attempting to load/edit
    if (!document.body || document.body.innerHTML.trim().length === 0) {
      console.log('Body content not ready yet, waiting...');
      setTimeout(() => {
        if (!state.editLoaded && document.body && document.body.innerHTML.trim().length > 0) {
          loadLatestEdit();
        } else if (!state.editLoaded) {
          // If still no content after waiting, mark as loaded to prevent infinite retry
          console.warn('Body content never loaded, marking edit as loaded');
          state.editLoaded = true;
        }
      }, 500);
      return;
    }
    
    if (!state.projectId) {
      // If project not detected yet, wait a bit and try again
      setTimeout(() => {
        if (state.projectId && !state.editLoaded) {
          loadLatestEdit();
        }
      }, 500);
      return;
    }

    try {
      const url = `${SERVER_URL}/edits/${state.projectId}/${encodeURIComponent(state.currentPagePath)}`;
      console.log('Loading latest edit:', {
        url: url,
        projectId: state.projectId,
        pagePath: state.currentPagePath,
        encodedPath: encodeURIComponent(state.currentPagePath)
      });
      const response = await fetch(url);
      
      if (response.ok) {
        const edit = await response.json();
        console.log('Loaded edit response:', {
          id: edit.id,
          page_path: edit.page_path,
          contentLength: edit.html_content ? edit.html_content.length : 0,
          created_at: edit.created_at
        });
        // Only replace content if we have valid, non-empty HTML content
        if (edit && edit.html_content && edit.html_content.trim().length > 0) {
          // Validate that we have actual HTML content (not just whitespace or empty tags)
          const trimmedContent = edit.html_content.trim();
          
          // Store current body content as backup
          const originalBodyHTML = document.body.innerHTML;
          const originalBodyLength = originalBodyHTML.trim().length;
          
          // Check if content has meaningful HTML (not just empty tags or whitespace)
          const hasContent = trimmedContent.length > 100 && // At least 100 chars
                            (trimmedContent.indexOf('<') !== -1) && // Has HTML tags
                            trimmedContent.replace(/<[^>]*>/g, '').trim().length > 0; // Has text content
          
          // Also check if saved content is suspiciously short compared to original
          // (might indicate a save error or incomplete content)
          const contentRatio = trimmedContent.length / Math.max(originalBodyLength, 1);
          const isSuspiciouslyShort = originalBodyLength > 1000 && contentRatio < 0.1; // Less than 10% of original
          
          if (!hasContent || isSuspiciouslyShort) {
            console.warn('Edit content appears to be empty, invalid, or suspiciously short, skipping replacement', {
              hasContent: hasContent,
              isSuspiciouslyShort: isSuspiciouslyShort,
              originalLength: originalBodyLength,
              savedLength: trimmedContent.length,
              ratio: contentRatio
            });
            state.editLoaded = true;
            return;
          }
          
          // Store references to scripts before replacing content
          const bodyScripts = Array.from(document.body.querySelectorAll('script[src]')).filter(s => 
            !s.src.includes('editor.js')
          );
          const scriptData = bodyScripts.map(s => ({ src: s.src, async: s.async, defer: s.defer }));
          
          // Store GTM dataLayer if it exists (Google Tag Manager)
          // GTM scripts maintain references to DOM nodes, so we need to preserve the dataLayer
          const gtmDataLayer = window.dataLayer ? Array.from(window.dataLayer) : null;
          
          // Suppress GTM errors during DOM replacement (they're expected when nodes are removed)
          const originalErrorHandler = window.onerror;
          window.onerror = function(msg, url, line, col, error) {
            // Suppress GTM errors related to parentNode during DOM replacement
            if (msg && (msg.indexOf('parentNode') !== -1 || msg.indexOf('GTM') !== -1 || msg.indexOf('gtm') !== -1)) {
              console.debug('Suppressed GTM error during DOM replacement:', msg);
              return true; // Suppress the error
            }
            // Let other errors through
            if (originalErrorHandler) {
              return originalErrorHandler.apply(this, arguments);
            }
            return false;
          };
          
          // Replace body content with saved content
          // The saved content is already cleaned (no widget UI elements)
          try {
            document.body.innerHTML = trimmedContent;
            
            // Verify the replacement was successful (body should have content)
            if (document.body.innerHTML.trim().length === 0) {
              console.error('Body content was cleared after replacement, restoring original');
              document.body.innerHTML = originalBodyHTML;
              state.editLoaded = true;
              return;
            }
            
            // Restore GTM dataLayer immediately after replacement
            if (gtmDataLayer) {
              if (!window.dataLayer) {
                window.dataLayer = [];
              }
              // Merge existing dataLayer with preserved one (avoid duplicates)
              gtmDataLayer.forEach(item => {
                // Simple check to avoid duplicates
                var exists = window.dataLayer.some(existing => 
                  JSON.stringify(existing) === JSON.stringify(item)
                );
                if (!exists) {
                  window.dataLayer.push(item);
                }
              });
            }
          } catch (error) {
            console.error('Error replacing body content:', error);
            // Restore original content on error
            try {
              document.body.innerHTML = originalBodyHTML;
            } catch (restoreError) {
              console.error('Failed to restore original body content:', restoreError);
            }
            state.editLoaded = true;
            return;
          } finally {
            // Restore original error handler
            window.onerror = originalErrorHandler;
          }
          
          // Re-add scripts that were removed, but wait a bit to let DOM settle
          setTimeout(() => {
            scriptData.forEach(scriptInfo => {
              if (!document.querySelector(`script[src="${scriptInfo.src}"]`)) {
                const newScript = document.createElement('script');
                newScript.src = scriptInfo.src;
                if (scriptInfo.async) newScript.async = true;
                if (scriptInfo.defer) newScript.defer = true;
                // Add error handling for script loading
                newScript.onerror = function() {
                  console.warn('Failed to reload script:', scriptInfo.src);
                };
                document.body.appendChild(newScript);
              }
            });
          }, 100);
          
          // Mark as loaded to prevent infinite loop
          state.editLoaded = true;
          
          // Re-run initialization to recreate toolbar and setup (but init() won't run again due to guard)
          // Use setTimeout to ensure DOM is ready
          setTimeout(() => {
            createToolbar();
            // Re-mark dynamic content after DOM changes
            markDynamicContent();
            // Ensure all editable elements are disabled after loading content
            disableEditableElements();
            loadComments();
            connectWebSocket();
            setupEventListeners();
          }, 50);
          
          console.log('Latest edit loaded successfully');
        } else {
          console.log('No edit content found');
          state.editLoaded = true; // Mark as loaded even if no content
        }
      } else if (response.status === 404) {
        console.log('No saved edits found for this page');
        state.editLoaded = true; // Mark as loaded even if no edits found
      } else {
        console.error('Failed to load edit:', response.status, response.statusText);
        state.editLoaded = true; // Mark as loaded to prevent retry loop
      }
    } catch (error) {
      console.error('Error loading latest edit:', error);
      state.editLoaded = true; // Mark as loaded to prevent retry loop
    }
  }

  // ============================================================================
  // WEBSOCKET / REAL-TIME
  // ============================================================================
  function connectWebSocket() {
    if (!state.projectId) return;

    // Check if Socket.IO is available
    if (typeof io === 'undefined') {
      console.warn('Socket.IO not loaded. Real-time features disabled.');
      updateStatus('Real-time disabled (Socket.IO not found)', 'error');
      return;
    }

    try {
      // Extract base URL and Socket.IO path from SERVER_URL
      // SERVER_URL might be like "https://en.infobase-dev.com/live-edits"
      // When behind a reverse proxy, Socket.IO needs the base origin and the full path
      let socketUrl = SERVER_URL;
      let socketPath = '/socket.io';
      
      // If SERVER_URL includes a path (like /live-edits), extract base URL and set path
      try {
        const url = new URL(SERVER_URL);
        if (url.pathname && url.pathname !== '/') {
          // Extract base origin (protocol + host)
          socketUrl = `${url.protocol}//${url.host}`;
          // Socket.IO path should be the API path + /socket.io
          // This ensures the reverse proxy routes correctly
          socketPath = url.pathname.replace(/\/$/, '') + '/socket.io';
        }
      } catch (e) {
        // If URL parsing fails, use SERVER_URL as-is
        console.warn('Failed to parse SERVER_URL for Socket.IO:', e);
      }
      
      // Use polling only since WebSocket upgrade fails through reverse proxy
      // Polling works fine for real-time features and is more reliable
      const socket = io(socketUrl, {
        path: socketPath,
        transports: ['polling'], // Use polling only - WebSocket upgrade fails through reverse proxy
        upgrade: false, // Disable WebSocket upgrade attempt
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity, // Keep trying to reconnect
        timeout: 20000,
        forceNew: false, // Reuse existing connection if available
        // Add extra headers if needed for reverse proxy
        extraHeaders: {}
      });
      
      // Log connection details for debugging
      console.log('Socket.IO connecting to:', socketUrl, 'with path:', socketPath);

      socket.on('connect', () => {
        state.connectionErrorShown = false; // Reset error flag on successful connection
        updateStatus('Connected', 'success');
        
        // Join room
        socket.emit('join', {
          projectId: state.projectId,
          pagePath: state.currentPagePath,
          userId: state.userId,
          userName: state.userName
        });
      });

      socket.on('joined', (data) => {
        if (data.presence) {
          state.presence = data.presence || [];
          updatePresenceIndicator();
        }
      });

      socket.on('presence-update', (presence) => {
        state.presence = presence || [];
        updatePresenceIndicator();
      });

      socket.on('edit-received', (data) => {
        // Show notification that someone else edited
        updateStatus(`${data.editedBy} made changes`, 'info');
      });

      socket.on('comment-received', (data) => {
        loadComments();
      });

      socket.on('cursor-update', (data) => {
        // Handle cursor updates (can be implemented later)
        // console.log('Cursor update:', data);
      });

      socket.on('disconnect', () => {
        updateStatus('Disconnected', 'error');
      });

      socket.on('connect_error', (error) => {
        // Only log detailed error on first attempt or if it's a different error type
        if (!state.connectionErrorShown || error.message !== state.lastError) {
          console.error('Socket.IO connection error:', error.message || error);
          state.lastError = error.message;
        }
        // Only show error status on first connection attempt, not on every retry
        if (!state.connectionErrorShown) {
          state.connectionErrorShown = true;
          updateStatus('Connecting...', 'info'); // Show "Connecting" instead of "error" since it will retry
        }
      });

      state.socket = socket;

      // Send heartbeat every 10 seconds
      const heartbeatInterval = setInterval(() => {
        if (socket.connected && state.projectId) {
          socket.emit('heartbeat', {
            projectId: state.projectId,
            pagePath: state.currentPagePath,
            userId: state.userId
          });
        }
      }, 10000);

      // Clean up interval on disconnect
      socket.on('disconnect', () => {
        clearInterval(heartbeatInterval);
      });

    } catch (error) {
      console.error('Error connecting WebSocket:', error);
      updateStatus('Connection error', 'error');
    }
  }

  function updatePresenceIndicator() {
    const indicator = document.getElementById('presence-indicator');
    if (indicator) {
      const activeUsers = state.presence.filter(p => p.user_id !== state.userId);
      if (activeUsers.length > 0) {
        indicator.innerHTML = `
          <div class="presence-dot"></div>
          <span>${activeUsers.length} active</span>
        `;
      } else {
        indicator.innerHTML = '';
      }
    }
  }

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  function updateStatus(message, type = 'info') {
    const indicator = document.getElementById('status-indicator');
    if (indicator) {
      indicator.textContent = message;
      indicator.style.color = 'white'; // All status messages in white
      setTimeout(() => {
        indicator.textContent = '';
      }, 3000);
    }
  }

  // ============================================================================
  // INITIALIZE ON DOM READY
  // ============================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
