import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const editorOptions = {
  structureHighlight: 'Structure highlighting',
  declarationHighlight: 'Declaration highlighting',
  referenceHighlight: 'Reference highlighting',
  syntaxHighlight: 'Syntax highlighting',
  semanticHighlight: 'Semantic highlighting',
  functionScrollMarkers: 'Function scroll markers',
  bracketMatching: 'Bracket matching',
  closeBrackets: 'Automatically close brackets and quotes',
  closeBraces: 'Include curly braces',
  easyLineSelection: 'Easy line selection',
  rulers: 'Indentation guides',
} as const;
type EditorOption = keyof typeof editorOptions;
type EditorSettings = Record<EditorOption, boolean>;

const editorOptionKeys = Object.keys(editorOptions) as EditorOption[];
const editorSettingsKey = 'deqafed.editorSettings';
const editorSettings = loadEditorSettings();

interface Editor {
  getValue(): string;
  getSettings(): EditorSettings;
  setSettings(patch: Partial<EditorSettings>): void;
  on(type: string, listener: () => void): () => void;
  execute(command: string): void;
  focus(): void;
  refresh(): void;
  destroy(): void;
}

interface OpenedFile {
  path: string;
  text: string;
}

interface DocumentTab {
  path: string | null;
  name: string;
  savedText: string;
  lineEnding: '\n' | '\r\n';
  element: HTMLDivElement;
  editor: Editor;
}

const menu = document.querySelector<HTMLElement>('#menu')!;
const tabs = document.querySelector<HTMLElement>('#tabs')!;
const editors = document.querySelector<HTMLElement>('#editors')!;
const status = document.querySelector<HTMLElement>('#status')!;
const documents: DocumentTab[] = [];
let active: DocumentTab;
let untitledCount = 0;
let busy = false;
let closingWindow = false;
type EditorModule = {
  createEditor(element: HTMLElement, options: object): Promise<Editor>;
};
let editorModule: Promise<EditorModule> | undefined;

function loadEditorSettings(): Partial<EditorSettings> {
  const settings: Partial<EditorSettings> = {};
  try {
    const saved = JSON.parse(localStorage.getItem(editorSettingsKey) ?? 'null');
    for (const key of editorOptionKeys) {
      const value = saved?.[key];
      if (typeof value === 'boolean') settings[key] = value;
    }
  } catch {
    // Use Opticm's defaults if the saved settings cannot be read.
  }
  return settings;
}

function toggleEditorOption(option: EditorOption): void {
  const value = !active.editor.getSettings()[option];
  for (const tab of documents) {
    tab.editor.setSettings({ [option]: value });
  }
  editorSettings[option] = value;
  active.editor.focus();
  localStorage.setItem(editorSettingsKey, JSON.stringify(editorSettings));
}

function loadEditorModule(): Promise<EditorModule> {
  if (!editorModule) {
    const moduleUrl = new URL('/opticm/opticm.min.js', window.location.href).href;
    editorModule = (import(/* @vite-ignore */ moduleUrl) as Promise<EditorModule>).catch(error => {
      editorModule = undefined;
      throw new Error(`Failed to load the editor: ${String(error)}`);
    });
  }
  return editorModule;
}

function dirty(tab: DocumentTab): boolean {
  return tab.editor.getValue() !== tab.savedText;
}

function render(): void {
  tabs.replaceChildren();
  for (const tab of documents) {
    const item = document.createElement('div');
    item.className = `tab${tab === active ? ' active' : ''}`;
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(tab === active));
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = `${dirty(tab) ? '● ' : ''}${tab.name}`;
    label.title = tab.path ?? tab.name;
    label.addEventListener('click', () => activate(tab));
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.addEventListener('click', () => run(() => closeTab(tab)));
    item.append(label, close);
    tabs.append(item);
    tab.element.classList.toggle('active', tab === active);
  }
  status.textContent = active ? (active.path ?? 'Save the file to choose a location') : '';
  document.title = active ? `${dirty(active) ? '● ' : ''}${active.name} - Deqafed` : 'Deqafed';
}

function activate(tab: DocumentTab): void {
  active = tab;
  render();
  tab.editor.refresh();
  tab.editor.focus();
}

async function addTab(path: string | null = null, text = '', emptyTab?: DocumentTab): Promise<void> {
  const element = document.createElement('div');
  element.className = 'editor active';
  if (active) active.element.classList.remove('active');
  editors.append(element);
  try {
    const { createEditor } = await loadEditorModule();
    const editor = await createEditor(element, {
      ...editorSettings, value: text, language: 'ja', codeLanguage: 'java',
    });
    const tab: DocumentTab = {
      path, name: path ? fileName(path) : `Untitled${++untitledCount}.java`,
      savedText: editor.getValue(), lineEnding: text.includes('\r\n') ? '\r\n' : '\n', element, editor,
    };
    editor.on('change', render);
    if (emptyTab && isEmptyTab(emptyTab)) {
      documents[documents.indexOf(emptyTab)] = tab;
      emptyTab.editor.destroy();
      emptyTab.element.remove();
    } else {
      documents.push(tab);
    }
    activate(tab);
  } catch (error) {
    element.remove();
    if (active) active.element.classList.add('active');
    throw error;
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function samePath(a: string | null, b: string): boolean {
  return a !== null && a.replaceAll('/', '\\').toLowerCase() === b.replaceAll('/', '\\').toLowerCase();
}

async function openFile(): Promise<void> {
  const file = await invoke<OpenedFile | null>('open_file');
  if (!file) return;
  const existing = documents.find(tab => samePath(tab.path, file.path));
  if (existing) activate(existing);
  else await addTab(file.path, file.text);
}

function isEmptyTab(tab: DocumentTab): boolean {
  return tab.path === null && tab.editor.getValue() === '' && !dirty(tab);
}

async function openDroppedFiles(paths: string[]): Promise<void> {
  const errors: string[] = [];
  for (const path of paths) {
    const existing = documents.find(tab => samePath(tab.path, path));
    if (existing) {
      activate(existing);
      continue;
    }
    try {
      const file = await invoke<OpenedFile>('read_dropped_file', { path });
      const emptyTab = isEmptyTab(active) ? active : documents.find(isEmptyTab);
      await addTab(file.path, file.text, emptyTab);
    } catch (error) {
      errors.push(`${path}\n${String(error)}`);
    }
  }
  if (errors.length) window.alert(errors.join('\n\n'));
}

async function save(tab: DocumentTab, saveAs = false): Promise<boolean> {
  const text = tab.editor.getValue();
  const otherPaths = documents.filter(other => other !== tab && other.path).map(other => other.path);
  const output = tab.lineEnding === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
  const path = await invoke<string | null>('save_file', { path: saveAs ? null : tab.path, name: tab.name, text: output, otherPaths });
  if (!path) return false;
  tab.path = path;
  tab.name = fileName(path);
  tab.savedText = text;
  render();
  return true;
}

async function mayClose(tab: DocumentTab): Promise<boolean> {
  if (!dirty(tab)) return true;
  activate(tab);
  const answer = await invoke<string>('confirm_save', { name: tab.name });
  if (answer === 'save') return save(tab);
  return answer === 'discard';
}

async function closeTab(tab: DocumentTab): Promise<void> {
  if (!await mayClose(tab)) return;
  const index = documents.indexOf(tab);
  documents.splice(index, 1);
  tab.editor.destroy();
  tab.element.remove();
  if (!documents.length) await addTab();
  else if (tab === active) activate(documents[Math.min(index, documents.length - 1)]);
  else render();
}

async function closeWindow(): Promise<void> {
  for (const tab of [...documents]) {
    if (!await mayClose(tab)) return;
  }
  closingWindow = true;
  await getCurrentWindow().destroy();
}

async function run(action: () => void | Promise<unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  try { await action(); }
  catch (error) { window.alert(String(error)); }
  finally { busy = false; }
}

type MenuItem = {
  label: string;
  shortcut?: string;
  option?: EditorOption;
  action: () => void | Promise<unknown>;
} | null;
const groups: [string, MenuItem[]][] = [
  ['File', [
    { label: 'New', shortcut: 'Ctrl+N', action: () => addTab() },
    { label: 'Open...', shortcut: 'Ctrl+O', action: openFile },
    { label: 'Save', shortcut: 'Ctrl+S', action: () => save(active) },
    { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: () => save(active, true) },
    null,
    { label: 'Close Tab', shortcut: 'Ctrl+W', action: () => closeTab(active) },
    { label: 'Exit', action: closeWindow },
  ]],
  ['Edit', [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: () => active.editor.execute('undo') },
    { label: 'Redo', shortcut: 'Ctrl+Y', action: () => active.editor.execute('redo') },
    null,
    { label: 'Cut', shortcut: 'Ctrl+X', action: () => active.editor.execute('cut') },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => active.editor.execute('copy') },
    { label: 'Paste', shortcut: 'Ctrl+V', action: () => active.editor.execute('paste') },
    { label: 'Select All', shortcut: 'Ctrl+A', action: () => active.editor.execute('selectAll') },
    null,
    { label: 'Find', shortcut: 'Ctrl+F', action: () => active.editor.execute('find') },
    { label: 'Replace', shortcut: 'Ctrl+H', action: () => active.editor.execute('replace') },
  ]],
  ['Options', editorOptionKeys.map(option => ({
    label: editorOptions[option], option, action: () => toggleEditorOption(option),
  }))],
  ['Tools', [
    { label: 'Open Terminal in File Location', action: async () => {
      if (!active.path) { window.alert('Save the file first.'); return; }
      await invoke('open_terminal', { path: active.path });
    } },
  ]],
];

function closeMenus(): void {
  menu.querySelectorAll('.open').forEach(item => item.classList.remove('open'));
}

for (const [name, items] of groups) {
  const group = document.createElement('div');
  group.className = 'menu-group';
  const button = document.createElement('button');
  button.className = 'menu-button';
  button.textContent = name;
  const optionEntries = new Map<EditorOption, HTMLButtonElement>();
  button.addEventListener('click', event => {
    event.stopPropagation();
    const wasOpen = group.classList.contains('open');
    closeMenus();
    if (!wasOpen && optionEntries.size) {
      const settings = active?.editor.getSettings();
      for (const [option, entry] of optionEntries) {
        entry.setAttribute('aria-checked', String(settings?.[option] ?? false));
        entry.disabled = !settings || (option === 'closeBraces' && !settings.closeBrackets);
      }
    }
    group.classList.toggle('open', !wasOpen);
  });
  const popup = document.createElement('div');
  popup.className = 'menu-popup';
  if (items.some(item => item?.option)) popup.setAttribute('role', 'menu');
  for (const item of items) {
    if (!item) {
      const separator = document.createElement('div');
      separator.className = 'separator';
      popup.append(separator);
      continue;
    }
    const entry = document.createElement('button');
    entry.className = 'menu-item';
    if (item.option) {
      entry.setAttribute('role', 'menuitemcheckbox');
      optionEntries.set(item.option, entry);
    }
    const label = document.createElement('span');
    label.textContent = item.label;
    const shortcut = document.createElement('span');
    shortcut.className = 'shortcut';
    shortcut.textContent = item.shortcut ?? '';
    entry.append(label);
    if (!item.option) entry.append(shortcut);
    entry.addEventListener('click', () => { closeMenus(); void run(item.action); });
    popup.append(entry);
  }
  group.append(button, popup);
  menu.append(group);
}

document.addEventListener('click', event => { if (!menu.contains(event.target as Node)) closeMenus(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenus();
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  const action = key === 'n' && !event.shiftKey ? () => addTab()
    : key === 'o' && !event.shiftKey ? openFile
      : key === 's' ? () => save(active, event.shiftKey)
        : key === 'w' && !event.shiftKey ? () => closeTab(active) : null;
  if (action) { event.preventDefault(); void run(action); }
});

await getCurrentWindow().onCloseRequested(event => {
  if (closingWindow) return;
  event.preventDefault();
  void run(closeWindow);
});
await run(() => addTab());
await getCurrentWindow().onDragDropEvent(({ payload }) => {
  if (payload.type === 'drop') void run(() => openDroppedFiles(payload.paths));
});
