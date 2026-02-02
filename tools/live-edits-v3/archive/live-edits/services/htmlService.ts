import { ContentBlock } from '../types';

export const HtmlService = {
  /**
   * Parses a raw HTML string into an array of editable ContentBlocks.
   * It also extracts the document title based on the first H1.
   */
  parseHtml: (html: string): { title: string; blocks: ContentBlock[] } => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blocks: ContentBlock[] = [];
    
    // Attempt to find a title from H1, fall back to title tag
    let title = doc.querySelector('title')?.innerText || 'Untitled Page';
    const h1 = doc.querySelector('h1');
    if (h1) {
      title = h1.innerText;
    }

    // Helper to generate ID
    const genId = (prefix: string, index: number) => `${prefix}-${index}-${Date.now().toString(36).slice(-4)}`;

    // Walk specific query selectors that we want to be editable
    const editableElements = doc.querySelectorAll('h1, h2, p, li, .warning, .alert');
    
    let indexCounter = 0;
    editableElements.forEach((el) => {
      // Only add if it has meaningful content
      if (!el.textContent?.trim()) return;

      const tagName = el.tagName.toLowerCase();
      let type: ContentBlock['type'] = 'p';
      
      if (tagName === 'h1') type = 'h1';
      else if (tagName === 'h2') type = 'h2';
      else if (tagName === 'li') type = 'ul'; 
      else if (el.classList.contains('warning') || el.classList.contains('alert')) type = 'warning';

      blocks.push({
        id: genId(type, indexCounter),
        type,
        content: el.textContent.trim(),
        originalIndex: indexCounter
      });
      indexCounter++;
    });

    return { title, blocks };
  },

  /**
   * Reconstructs an HTML string by injecting the updated block content 
   * back into the original HTML structure.
   */
  reconstructHtml: (originalHtml: string, blocks: ContentBlock[]): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(originalHtml, 'text/html');
    
    // Re-select the same elements in the same order
    const editableElements = doc.querySelectorAll('h1, h2, p, li, .warning, .alert');
    
    let blockIndex = 0;
    editableElements.forEach((el) => {
      // Match the skipping logic from parseHtml
      if (!el.textContent?.trim()) return;

      // If we have processed all blocks, stop
      if (blockIndex >= blocks.length) return;

      const currentBlock = blocks[blockIndex];
      
      // Update content
      el.textContent = currentBlock.content;
      blockIndex++;
    });

    return doc.documentElement.outerHTML;
  }
};