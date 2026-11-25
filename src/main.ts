import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import en from './locales/en.json';
import ja from './locales/ja.json';

const languages = ['en', 'ja'] as const;
type Language = typeof languages[number];
const resources: Record<Language, typeof en> = { en, ja };
type EditorOption = keyof typeof en.editorOptions;
type EditorSettings = Record<EditorOption, boolean> & { language: Language };

const editorOptionKeys = Object.keys(en.editorOptions) as EditorOption[];
const editorSettingsKey = 'deqafed.editorSettings';
const editorSettings = loadEditorSettings();
let language = editorSettings.language ?? 'en';
let messages = resources[language];

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
  untitledNumber: number;
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
    if (saved?.language === 'en' || saved?.language === 'ja') settings.language = saved.language;
    for (const key of editorOptionKeys) {
      const value = saved?.[key];
      if (typeof value === 'boolean') settings[key] = value;
    }
  } catch {
    // Use the defaults if the saved settings cannot be read.
  }
  return settings;
}

function toggleEditorOption(option: EditorOption): void {
  applyEditorSettings({ [option]: !active.editor.getSettings()[option] });
}

function applyEditorSettings(patch: Partial<EditorSettings>): void {
  for (const tab of documents) {
    tab.editor.setSettings(patch);
  }
  Object.assign(editorSettings, patch);
  active?.editor.focus();
  localStorage.setItem(editorSettingsKey, JSON.stringify(editorSettings));
}

function setLanguage(next: Language): void {
  if (language === next) {
    active?.editor.focus();
    return;
  }
  language = next;
  messages = resources[language];
  renderMenu();
  render();
  applyEditorSettings({ language });
}

function formatMessage(template: string, key: string, value: string): string {
  return template.replace(`{${key}}`, () => value);
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'key' in error
      && typeof error.key === 'string' && Object.hasOwn(messages.errors, error.key)) {
    const template = messages.errors[error.key as keyof typeof messages.errors];
    const detail = 'detail' in error ? String(error.detail) : '';
    return formatMessage(template, 'detail', detail);
  }
  return error instanceof Error ? error.message : String(error);
}

function loadEditorModule(): Promise<EditorModule> {
  if (!editorModule) {
    const moduleUrl = new URL('/opticm/opticm.min.js', window.location.href).href;
    editorModule = (import(/* @vite-ignore */ moduleUrl) as Promise<EditorModule>).catch(error => {
      editorModule = undefined;
      throw new Error(formatMessage(messages.errors.loadEditor, 'detail', String(error)));
    });
  }
  return editorModule;
}

function dirty(tab: DocumentTab): boolean {
  return tab.editor.getValue() !== tab.savedText;
}

function tabName(tab: DocumentTab): string {
  return tab.path === null
    ? formatMessage(messages.tabs.untitled, 'number', String(tab.untitledNumber))
    : fileName(tab.path);
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
    const name = tabName(tab);
    label.textContent = `${dirty(tab) ? '● ' : ''}${name}`;
    label.title = tab.path ?? name;
    label.addEventListener('click', () => activate(tab));
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.setAttribute('aria-label', formatMessage(messages.tabs.close, 'name', name));
    close.addEventListener('click', () => run(() => closeTab(tab)));
    item.append(label, close);
    tabs.append(item);
    tab.element.classList.toggle('active', tab === active);
  }
  status.textContent = active ? (active.path ?? messages.status.unsaved) : '';
  document.title = active ? `${dirty(active) ? '● ' : ''}${tabName(active)} - Deqafed` : 'Deqafed';
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
      ...editorSettings, value: text, language, codeLanguage: 'java',
    });
    const tab: DocumentTab = {
      path, untitledNumber: path === null ? ++untitledCount : 0,
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
  const { javaFiles, allFiles } = messages.dialogs;
  const file = await invoke<OpenedFile | null>('open_file', { javaFiles, allFiles });
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
      errors.push(`${path}\n${errorMessage(error)}`);
    }
  }
  if (errors.length) window.alert(errors.join('\n\n'));
}

async function save(tab: DocumentTab, saveAs = false): Promise<boolean> {
  const text = tab.editor.getValue();
  const otherPaths = documents.filter(other => other !== tab && other.path).map(other => other.path);
  const output = tab.lineEnding === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
  const path = await invoke<string | null>('save_file', {
    path: saveAs ? null : tab.path, name: tabName(tab), text: output, otherPaths,
    javaFiles: messages.dialogs.javaFiles,
  });
  if (!path) return false;
  tab.path = path;
  tab.savedText = text;
  render();
  return true;
}

async function mayClose(tab: DocumentTab): Promise<boolean> {
  if (!dirty(tab)) return true;
  activate(tab);
  const labels = messages.dialogs;
  const answer = await invoke<string>('confirm_save', {
    title: labels.saveChanges,
    description: formatMessage(labels.confirmSave, 'name', tabName(tab)),
    save: labels.save,
    discard: labels.discard,
    cancel: labels.cancel,
  });
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
  catch (error) { window.alert(errorMessage(error)); }
  finally { busy = false; }
}

type MenuItem = {
  label: string;
  shortcut?: string;
  option?: EditorOption;
  action: () => void | Promise<unknown>;
} | null;

function closeMenus(): void {
  menu.querySelectorAll('.open').forEach(item => item.classList.remove('open'));
}

function editorOptionItem(option: EditorOption): MenuItem {
  return {
    label: messages.editorOptions[option], option, action: () => toggleEditorOption(option),
  };
}

function renderMenu(): void {
  const labels = messages.menu;
  document.documentElement.lang = language;
  menu.setAttribute('aria-label', labels.label);
  tabs.setAttribute('aria-label', messages.tabs.label);
  menu.replaceChildren();
  renderMenuGroup(labels.file, [
    { label: labels.new, shortcut: 'Ctrl+N', action: () => addTab() },
    { label: labels.open, shortcut: 'Ctrl+O', action: openFile },
    { label: labels.save, shortcut: 'Ctrl+S', action: () => save(active) },
    { label: labels.saveAs, shortcut: 'Ctrl+Shift+S', action: () => save(active, true) },
    null,
    { label: labels.closeTab, shortcut: 'Ctrl+W', action: () => closeTab(active) },
    { label: labels.exit, action: closeWindow },
  ]);
  renderMenuGroup(labels.edit, [
    { label: labels.undo, shortcut: 'Ctrl+Z', action: () => active.editor.execute('undo') },
    { label: labels.redo, shortcut: 'Ctrl+Y', action: () => active.editor.execute('redo') },
    null,
    { label: labels.cut, shortcut: 'Ctrl+X', action: () => active.editor.execute('cut') },
    { label: labels.copy, shortcut: 'Ctrl+C', action: () => active.editor.execute('copy') },
    { label: labels.paste, shortcut: 'Ctrl+V', action: () => active.editor.execute('paste') },
    { label: labels.selectAll, shortcut: 'Ctrl+A', action: () => active.editor.execute('selectAll') },
    null,
    { label: labels.find, shortcut: 'Ctrl+F', action: () => active.editor.execute('find') },
    { label: labels.replace, shortcut: 'Ctrl+H', action: () => active.editor.execute('replace') },
    null,
    editorOptionItem('closeBrackets'),
    editorOptionItem('closeBraces'),
    editorOptionItem('easyLineSelection'),
  ]);
  const views = renderMenuGroup(labels.views, [
    editorOptionItem('structureHighlight'),
    editorOptionItem('declarationHighlight'),
    editorOptionItem('referenceHighlight'),
    editorOptionItem('syntaxHighlight'),
    editorOptionItem('semanticHighlight'),
    null,
    editorOptionItem('functionScrollMarkers'),
    editorOptionItem('bracketMatching'),
    editorOptionItem('rulers'),
    null,
  ]);
  const languageGroup = document.createElement('div');
  languageGroup.setAttribute('role', 'group');
  languageGroup.setAttribute('aria-label', labels.language);
  const heading = document.createElement('div');
  heading.className = 'menu-heading';
  heading.setAttribute('aria-hidden', 'true');
  heading.textContent = labels.language;
  languageGroup.append(heading);
  for (const choice of languages) {
    const entry = document.createElement('button');
    entry.className = 'menu-item';
    entry.setAttribute('role', 'menuitemradio');
    entry.setAttribute('aria-checked', String(choice === language));
    entry.textContent = messages.languages[choice];
    entry.addEventListener('click', () => {
      closeMenus();
      void run(() => setLanguage(choice));
    });
    languageGroup.append(entry);
  }
  views.append(languageGroup);
  renderMenuGroup(labels.tools, [
    { label: labels.openTerminal, action: async () => {
      if (!active.path) {
        window.alert(messages.status.saveFirst);
        return;
      }
      await invoke('open_terminal', { path: active.path });
    } },
  ]);
}

function renderMenuGroup(name: string, items: MenuItem[]): HTMLDivElement {
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
  const hasOptions = items.some(item => item?.option);
  if (hasOptions) popup.setAttribute('role', 'menu');
  for (const item of items) {
    if (!item) {
      const separator = document.createElement('div');
      separator.className = 'separator';
      if (hasOptions) separator.setAttribute('role', 'separator');
      popup.append(separator);
      continue;
    }
    const entry = document.createElement('button');
    entry.className = 'menu-item';
    if (item.option) {
      entry.setAttribute('role', 'menuitemcheckbox');
      if (item.option === 'closeBraces') entry.classList.add('menu-item-indented');
      optionEntries.set(item.option, entry);
    } else if (hasOptions) {
      entry.setAttribute('role', 'menuitem');
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
  return popup;
}

renderMenu();
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
