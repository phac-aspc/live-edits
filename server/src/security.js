/**
 * Security utility module for input validation and sanitization
 */

// Input length limits
export const LIMITS = {
  html_content: 10 * 1024 * 1024,  // 10MB
  comment_text: 10000,               // 10KB
  folder_path: 500,                  // 500 chars
  page_path: 500,                    // 500 chars
  name: 200,                         // 200 chars
  author: 100,                       // 100 chars
  user_name: 100,                    // 100 chars
  user_id: 100,                      // 100 chars
  project_id: 50,                    // UUIDs are 36 chars, but allow some buffer
  edit_id: 50,                       // UUIDs are 36 chars
  comment_id: 50                     // UUIDs are 36 chars
};

// UUID v4 regex pattern
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate UUID v4 format
 */
export function validateUUID(id, fieldName = 'id') {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  if (!UUID_V4_REGEX.test(id)) {
    return { valid: false, error: `${fieldName} must be a valid UUID v4` };
  }
  
  return { valid: true };
}

/**
 * Sanitize file path to prevent path traversal attacks
 * Removes: .., <, >, :, ", |, ?, *, and control characters
 */
export function sanitizePath(path) {
  if (!path || typeof path !== 'string') {
    return null;
  }
  
  // Remove path traversal attempts
  let sanitized = path.replace(/\.\./g, '');
  
  // Remove dangerous characters: < > : " | ? * and control chars (0x00-0x1f)
  sanitized = sanitized.replace(/[<>:"|?*\x00-\x1f]/g, '');
  
  // Normalize slashes (convert backslashes to forward slashes)
  sanitized = sanitized.replace(/\\/g, '/');
  
  // Remove multiple consecutive slashes
  sanitized = sanitized.replace(/\/+/g, '/');
  
  // Remove leading/trailing slashes for normalization (we'll add leading slash back if needed)
  sanitized = sanitized.replace(/^\/+|\/+$/g, '');
  
  return sanitized;
}

/**
 * Validate and sanitize a path
 */
export function validatePath(path, fieldName = 'path', maxLength = LIMITS.page_path) {
  if (!path || typeof path !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  if (path.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }
  
  const sanitized = sanitizePath(path);
  if (!sanitized) {
    return { valid: false, error: `${fieldName} is invalid` };
  }
  
  // Ensure path starts with / (for consistency with database storage)
  const normalized = sanitized.startsWith('/') ? sanitized : '/' + sanitized;
  
  // CRITICAL: Reject dangerous absolute system paths
  const dangerousPaths = [
    '/etc/', '/windows/', '/sys/', '/proc/', '/dev/',
    '/usr/', '/var/', '/boot/', '/root/', '/home/',
    '/bin/', '/sbin/', '/lib/', '/lib64/', '/opt/',
    '/tmp/', '/temp/', '/system32/', '/program files/',
    '/program files (x86)/', '/users/', '/documents and settings/'
  ];
  
  const lowerPath = normalized.toLowerCase();
  for (const dangerous of dangerousPaths) {
    if (lowerPath.startsWith(dangerous)) {
      return { 
        valid: false, 
        error: `${fieldName} contains a dangerous system path` 
      };
    }
  }
  
  // Reject paths that are just root or single-level (too generic/dangerous)
  // Allow paths like /_live-edits/products/amrnet but reject /etc or /windows
  if (normalized === '/' || normalized.match(/^\/[^\/]+$/)) {
    // Exception: Allow /_live-edits as it's our expected root
    if (!normalized.startsWith('/_live-edits')) {
      return { 
        valid: false, 
        error: `${fieldName} must be a valid project path` 
      };
    }
  }
  
  // Reject paths that don't start with /_live-edits (our expected prefix)
  // This ensures only valid project paths are accepted
  if (!normalized.startsWith('/_live-edits')) {
    return {
      valid: false,
      error: `${fieldName} must start with /_live-edits`
    };
  }
  
  return { valid: true, sanitized: normalized };
}

/**
 * Validate string length
 */
export function validateLength(str, maxLength, fieldName = 'field', minLength = 0) {
  if (str === undefined || str === null) {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (typeof str !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  if (str.length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` };
  }
  
  if (str.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }
  
  return { valid: true };
}

/**
 * Validate string is not empty
 */
export function validateRequired(str, fieldName = 'field') {
  if (str === undefined || str === null || str === '') {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (typeof str !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  return { valid: true };
}

/**
 * Validate number is within range
 */
export function validateNumber(value, fieldName = 'number', min = -Infinity, max = Infinity) {
  if (value === undefined || value === null) {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (typeof value !== 'number' || isNaN(value)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  
  if (value < min || value > max) {
    return { valid: false, error: `${fieldName} must be between ${min} and ${max}` };
  }
  
  return { valid: true };
}

/**
 * Validate timestamp (must be a positive integer)
 */
export function validateTimestamp(timestamp, fieldName = 'timestamp') {
  if (timestamp === undefined || timestamp === null) {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (typeof timestamp !== 'number' || !Number.isInteger(timestamp)) {
    return { valid: false, error: `${fieldName} must be an integer` };
  }
  
  if (timestamp < 0) {
    return { valid: false, error: `${fieldName} must be a positive number` };
  }
  
  // Reasonable timestamp range (year 2000 to year 2100)
  const minTimestamp = 946684800000; // Jan 1, 2000
  const maxTimestamp = 4102444800000; // Jan 1, 2100
  
  if (timestamp < minTimestamp || timestamp > maxTimestamp) {
    return { valid: false, error: `${fieldName} is out of valid range` };
  }
  
  return { valid: true };
}

/**
 * Sanitize error message to prevent information disclosure
 */
export function sanitizeError(error, defaultMessage = 'An error occurred') {
  // Log the full error internally
  console.error('Error details:', error);
  
  // Return generic message to client
  if (error && typeof error === 'object') {
    // Check for known safe error codes that we can expose
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return 'A record with this information already exists';
    }
    if (error.code === 'SQLITE_CONSTRAINT') {
      return 'Database constraint violation';
    }
  }
  
  return defaultMessage;
}

/**
 * Validate project creation input
 */
export function validateProjectInput(body) {
  const errors = [];
  
  // Validate folder_path
  const folderPathResult = validatePath(body.folder_path, 'folder_path', LIMITS.folder_path);
  if (!folderPathResult.valid) {
    errors.push(folderPathResult.error);
  }
  
  // Validate name
  const nameResult = validateLength(body.name, LIMITS.name, 'name', 1);
  if (!nameResult.valid) {
    errors.push(nameResult.error);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      folder_path: folderPathResult.sanitized,
      name: body.name?.trim()
    }
  };
}

/**
 * Validate edit input
 */
export function validateEditInput(body) {
  const errors = [];
  
  // Validate project_id (UUID)
  const projectIdResult = validateUUID(body.project_id, 'project_id');
  if (!projectIdResult.valid) {
    errors.push(projectIdResult.error);
  }
  
  // Validate page_path
  const pagePathResult = validatePath(body.page_path, 'page_path', LIMITS.page_path);
  if (!pagePathResult.valid) {
    errors.push(pagePathResult.error);
  }
  
  // Validate html_content
  const htmlContentResult = validateLength(body.html_content, LIMITS.html_content, 'html_content', 0);
  if (!htmlContentResult.valid) {
    errors.push(htmlContentResult.error);
  }
  
  // Validate edited_by
  const editedByResult = validateLength(body.edited_by, LIMITS.user_name, 'edited_by', 1);
  if (!editedByResult.valid) {
    errors.push(editedByResult.error);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      project_id: body.project_id,
      page_path: pagePathResult.sanitized,
      html_content: body.html_content,
      edited_by: body.edited_by?.trim()
    }
  };
}

/**
 * Validate comment input
 */
export function validateCommentInput(body) {
  const errors = [];
  
  // Validate project_id (UUID)
  const projectIdResult = validateUUID(body.project_id, 'project_id');
  if (!projectIdResult.valid) {
    errors.push(projectIdResult.error);
  }
  
  // Validate page_path
  const pagePathResult = validatePath(body.page_path, 'page_path', LIMITS.page_path);
  if (!pagePathResult.valid) {
    errors.push(pagePathResult.error);
  }
  
  // Validate comment_text
  const commentTextResult = validateLength(body.comment_text, LIMITS.comment_text, 'comment_text', 1);
  if (!commentTextResult.valid) {
    errors.push(commentTextResult.error);
  }
  
  // Validate author
  const authorResult = validateLength(body.author, LIMITS.author, 'author', 1);
  if (!authorResult.valid) {
    errors.push(authorResult.error);
  }
  
  // Validate positions (optional, but if provided must be valid numbers)
  if (body.x_position !== undefined && body.x_position !== null) {
    const xResult = validateNumber(body.x_position, 'x_position', 0, 100);
    if (!xResult.valid) {
      errors.push(xResult.error);
    }
  }
  
  if (body.y_position !== undefined && body.y_position !== null) {
    const yResult = validateNumber(body.y_position, 'y_position', 0, 100);
    if (!yResult.valid) {
      errors.push(yResult.error);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      project_id: body.project_id,
      page_path: pagePathResult.sanitized,
      comment_text: body.comment_text?.trim(),
      author: body.author?.trim(),
      x_position: body.x_position ?? 0,
      y_position: body.y_position ?? 0
    }
  };
}

/**
 * Validate WebSocket join input
 */
export function validateWebSocketJoin(data) {
  const errors = [];
  
  // Validate projectId (UUID)
  const projectIdResult = validateUUID(data.projectId, 'projectId');
  if (!projectIdResult.valid) {
    errors.push(projectIdResult.error);
  }
  
  // Validate pagePath
  const pagePathResult = validatePath(data.pagePath, 'pagePath', LIMITS.page_path);
  if (!pagePathResult.valid) {
    errors.push(pagePathResult.error);
  }
  
  // Validate userId
  const userIdResult = validateLength(data.userId, LIMITS.user_id, 'userId', 1);
  if (!userIdResult.valid) {
    errors.push(userIdResult.error);
  }
  
  // Validate userName
  const userNameResult = validateLength(data.userName, LIMITS.user_name, 'userName', 1);
  if (!userNameResult.valid) {
    errors.push(userNameResult.error);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      projectId: data.projectId,
      pagePath: pagePathResult.sanitized,
      userId: data.userId?.trim(),
      userName: data.userName?.trim()
    }
  };
}

/**
 * Validate WebSocket heartbeat input
 */
export function validateWebSocketHeartbeat(data) {
  const errors = [];
  
  // Validate projectId (UUID)
  const projectIdResult = validateUUID(data.projectId, 'projectId');
  if (!projectIdResult.valid) {
    errors.push(projectIdResult.error);
  }
  
  // Validate pagePath
  const pagePathResult = validatePath(data.pagePath, 'pagePath', LIMITS.page_path);
  if (!pagePathResult.valid) {
    errors.push(pagePathResult.error);
  }
  
  // Validate userId
  const userIdResult = validateLength(data.userId, LIMITS.user_id, 'userId', 1);
  if (!userIdResult.valid) {
    errors.push(userIdResult.error);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      projectId: data.projectId,
      pagePath: pagePathResult.sanitized,
      userId: data.userId?.trim()
    }
  };
}
