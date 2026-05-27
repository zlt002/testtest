// entrypoints/userscript-editor/main.js
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';

let editorView = null;
let hasUnsavedChanges = false;

// Get the userscript ID from URL parameters
const params = new URLSearchParams(window.location.search);
const scriptId = params.get('id');

// Update UI with script ID
const scriptIdElement = document.getElementById('script-id');
const saveBtn = document.getElementById('save-btn');
const reloadBtn = document.getElementById('reload-btn');
const loadingOverlay = document.getElementById('loading');
const editorElement = document.getElementById('editor');

if (!scriptId) {
  // Show error if no ID provided
  loadingOverlay.innerHTML = `
    <div class="error-message">
      <h2>No Script ID Provided</h2>
      <p>Please provide a script ID in the URL parameters (e.g., ?id=my-script)</p>
    </div>
  `;
} else {
  scriptIdElement.textContent = `#${scriptId}`;

  // Initialize the workspace
  initializeEditor();
}

async function initializeEditor() {
  try {
    const scriptContent = await loadUserscript(scriptId);

    editorView = new EditorView({
      parent: editorElement,
      state: EditorState.create({
        doc: scriptContent,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(false),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          javascript({ jsx: true }),
          oneDark,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              hasUnsavedChanges = true;
              saveBtn.textContent = 'Save*';
            }
          }),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
          ]),
        ],
      }),
    });

    loadingOverlay.style.display = 'none';
    saveBtn.disabled = false;

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const content = editorView?.state.doc.toString();
        if (content) {
          await saveUserscript(scriptId, content);
          hasUnsavedChanges = false;
          saveBtn.textContent = 'Saved!';
          setTimeout(() => {
            saveBtn.textContent = 'Save';
          }, 2000);
        } else {
          saveBtn.textContent = 'No Content';
          setTimeout(() => {
            saveBtn.textContent = 'Save';
          }, 2000);
        }
      } catch (error) {
        console.error('Failed to save:', error);
        saveBtn.textContent = 'Save Failed';
        setTimeout(() => {
          saveBtn.textContent = hasUnsavedChanges ? 'Save*' : 'Save';
        }, 2000);
      } finally {
        saveBtn.disabled = false;
      }
    });

    reloadBtn.addEventListener('click', async () => {
      if (hasUnsavedChanges) {
        const confirmed = confirm('You have unsaved changes. Are you sure you want to reload?');
        if (!confirmed) return;
      }

      reloadBtn.disabled = true;
      reloadBtn.textContent = 'Reloading...';

      try {
        const content = await loadUserscript(scriptId);
        if (editorView) {
          editorView.dispatch({
            changes: {
              from: 0,
              to: editorView.state.doc.length,
              insert: content,
            },
          });
        }
        hasUnsavedChanges = false;
        saveBtn.textContent = 'Save';
      } catch (error) {
        console.error('Failed to reload:', error);
        alert('Failed to reload the userscript');
      } finally {
        reloadBtn.disabled = false;
        reloadBtn.textContent = 'Reload';
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      }
    });
  } catch (error) {
    console.error('Failed to initialize editor:', error);
    loadingOverlay.innerHTML = `
      <div class="error-message">
        <h2>Failed to Load Editor</h2>
        <p>${error.message || 'An unexpected error occurred'}</p>
      </div>
    `;
  }
}

// Load userscript content from chrome.storage.local if present, else template
async function loadUserscript(id) {
  const storageKey = `webmcp:userscripts:${id}`;
  try {
    const stored = await chrome.storage.local.get(storageKey);
    const payload = stored?.[storageKey];
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload.content === 'string') return payload.content;
  } catch (_e) {
    // ignore
  }
  return `// ==UserScript==
// @name         ${id}
// @description  Userscript for ${id}
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';
  console.log('Userscript loaded: ${id}');
})();`;
}

// Save userscript content into chrome.storage.local
async function saveUserscript(id, content) {
  const storageKey = `webmcp:userscripts:${id}`;
  try {
    await chrome.storage.local.set({ [storageKey]: content });
    // Also persist a pointer to the last saved script for convenience
    await chrome.storage.local.set({
      'webmcp:userscripts:last': { id, content, savedAt: Date.now() },
    });
  } catch (e) {
    console.error('Failed to persist userscript', e);
    throw e;
  }
}
