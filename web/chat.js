const byId = id => document.getElementById(id);
const sidebar = byId('sidebar');
const toggle = byId('toggle-sidebar');
const backdrop = byId('backdrop');
const historyList = byId('history');
const welcome = byId('welcome');
const suggestions = byId('suggestions');
const messages = byId('messages');
const scrollArea = byId('scroll-area');
const composer = byId('composer');
const input = byId('message');
const send = byId('send');
const stop = byId('stop');
const error = byId('error');
const status = byId('status');

const mobile = matchMedia('(max-width: 680px)');
const storageKey = 'ana-chats-v1';
const maxChats = 30;
const maxSavedMessages = 100;
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const apiOrigin = document.querySelector('meta[name="ana-api-origin"]').content || (local ? location.origin : '');
const endpoint = apiOrigin ? new URL('/chat', apiOrigin) : null;
let chats = loadChats();
let active = null;
let request = null;

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!Array.isArray(saved)) return [];
    return saved.filter(chat => chat && typeof chat.id === 'string'
      && Array.isArray(chat.messages) && chat.messages.length > 0
      && chat.messages.every((message, index) => message
        && message.role === (index % 2 === 0 ? 'user' : 'assistant')
        && typeof message.content === 'string')
      && chat.messages.length % 2 === 0).slice(0, maxChats);
  } catch {
    return [];
  }
}

function saveChats() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(chats));
  } catch {
    // Chat remains usable when browser storage is blocked or full.
  }
}

function setSidebar(open) {
  sidebar.hidden = !open;
  backdrop.hidden = !open || !mobile.matches;
  toggle.setAttribute('aria-expanded', String(open));
}

function closeMobileSidebar() {
  if (mobile.matches) setSidebar(false);
}

function renderHistory() {
  historyList.replaceChildren();
  for (const chat of chats) {
    const row = document.createElement('div');
    row.className = 'chat-row';
    const title = chat.messages[0].content.trim().replace(/\s+/g, ' ').slice(0, 80);
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'chat-link';
    link.textContent = title;
    if (chat === active) link.setAttribute('aria-current', 'true');
    link.addEventListener('click', () => openChat(chat));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-chat';
    remove.setAttribute('aria-label', `Delete chat: ${title}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    remove.addEventListener('click', () => {
      chats = chats.filter(item => item !== chat);
      saveChats();
      if (active === chat) openChat(null);
      else {
        renderHistory();
        byId('new-chat').focus();
      }
    });
    row.append(link, remove);
    historyList.append(row);
  }
}

function appendMessage(role, content) {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  article.setAttribute('aria-label', role === 'assistant' ? 'Ana' : 'You');
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.src = './ana.png';
    avatar.className = 'avatar';
    avatar.width = avatar.height = 28;
    avatar.alt = '';
    article.append(avatar);
  }
  const text = document.createElement('p');
  text.textContent = content;
  article.append(text);
  messages.append(article);
  return { article, text };
}

function showConversation(show) {
  welcome.hidden = suggestions.hidden = show;
  messages.hidden = !show;
}

function showError(message = '') {
  error.textContent = message;
  error.hidden = !message;
}

function refreshComposer() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 148)}px`;
  input.readOnly = Boolean(request);
  send.hidden = Boolean(request);
  stop.hidden = !request;
  send.disabled = !endpoint || !input.value.trim();
}

function openChat(chat) {
  request?.abort();
  request = null;
  active = chat;
  messages.replaceChildren();
  for (const message of active?.messages ?? []) appendMessage(message.role, message.content);
  showConversation(Boolean(active));
  showError(endpoint ? '' : 'Ana’s chat service has not been configured.');
  status.textContent = '';
  input.value = '';
  refreshComposer();
  renderHistory();
  closeMobileSidebar();
  scrollArea.scrollTop = scrollArea.scrollHeight;
  input.focus();
}

function requestBody(message) {
  const history = [];
  const encoder = new TextEncoder();
  let chars = 0;
  for (let index = (active?.messages.length ?? 0) - 2; index >= 0 && history.length < 40; index -= 2) {
    const pair = active.messages.slice(index, index + 2);
    chars += pair[0].content.length + pair[1].content.length;
    if (chars > 12000 || pair[1].content.length > 6000) break;
    if (encoder.encode(JSON.stringify({ message, history: [...pair, ...history] })).length > 16384) break;
    history.unshift(...pair);
  }
  return JSON.stringify({ message, history });
}

async function readReply(response, onDelta) {
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    const data = await response.json().catch(() => null);
    if (response.ok && typeof data?.reply === 'string' && data.reply.trim()) return data.reply;
    throw new Error(data?.error?.message || 'Ana couldn’t answer. Please try again.');
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('The reply was interrupted. Please try again.');
      buffer += value;
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === 'delta') onDelta(event.text);
        if (event.type === 'done' && typeof event.reply === 'string' && event.reply.trim()) return event.reply;
        if (event.error) throw new Error(event.error.message);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function submitMessage() {
  const message = input.value.trim();
  if (!endpoint || !message || request) return;

  const controller = new AbortController();
  request = controller;
  const body = requestBody(message);
  input.value = '';
  refreshComposer();
  showError();
  status.textContent = 'Ana is responding.';
  showConversation(true);
  const user = appendMessage('user', message);
  const assistant = appendMessage('assistant', 'Thinking…');
  assistant.article.classList.add('pending');
  scrollArea.scrollTop = scrollArea.scrollHeight;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body,
      signal: controller.signal,
    });
    const reply = await readReply(response, delta => {
      const pinned = scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight < 60;
      if (assistant.article.classList.contains('pending')) assistant.text.textContent = '';
      assistant.article.classList.remove('pending');
      assistant.text.textContent += delta;
      if (pinned) scrollArea.scrollTop = scrollArea.scrollHeight;
    });
    if (request !== controller) return;
    controller.signal.throwIfAborted();
    assistant.article.classList.remove('pending');
    assistant.text.textContent = reply;
    active ??= { id: crypto.randomUUID(), messages: [] };
    active.messages.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
    if (active.messages.length > maxSavedMessages) active.messages.splice(2, 2);
    chats = [active, ...chats.filter(chat => chat !== active)].slice(0, maxChats);
    saveChats();
    renderHistory();
    status.textContent = 'Ana replied.';
  } catch (failure) {
    if (request !== controller) return;
    user.article.remove();
    assistant.article.remove();
    input.value = message;
    showConversation(Boolean(active));
    if (!controller.signal.aborted) {
      showError(failure instanceof TypeError ? 'Couldn’t reach Ana. Please try again.' : failure.message);
    }
    status.textContent = controller.signal.aborted ? 'Response stopped.' : '';
  } finally {
    if (request === controller) {
      request = null;
      const restoreFocus = document.activeElement === stop || document.activeElement === document.body;
      refreshComposer();
      if (restoreFocus) input.focus();
    }
  }
}

composer.addEventListener('submit', event => {
  event.preventDefault();
  void submitMessage();
});
input.addEventListener('input', refreshComposer);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submitMessage();
  }
});
stop.addEventListener('click', () => request?.abort());
suggestions.addEventListener('click', event => {
  const prompt = event.target.closest('[data-prompt]')?.dataset.prompt;
  if (!prompt) return;
  input.value = prompt;
  refreshComposer();
  input.focus();
});
byId('new-chat').addEventListener('click', () => openChat(null));
toggle.addEventListener('click', () => {
  const opening = sidebar.hidden;
  setSidebar(opening);
  if (opening && mobile.matches) byId('new-chat').focus();
});
backdrop.addEventListener('click', () => {
  setSidebar(false);
  toggle.focus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobile.matches && !sidebar.hidden) backdrop.click();
});
mobile.addEventListener('change', () => setSidebar(!mobile.matches));
setSidebar(!mobile.matches);
renderHistory();
if (!endpoint) showError('Ana’s chat service has not been configured.');
refreshComposer();
