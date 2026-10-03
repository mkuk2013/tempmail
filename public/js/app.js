'use strict';

/* TempMail frontend — talks to the Worker's /api/* endpoints. */

const LS = {
  addresses: 'tempmail_addresses',
  current: 'tempmail_current',
  password: 'tempmail_pw',
};

const state = {
  domain: '',
  current: '',
  addresses: [],
  messages: [],
  openMessageId: null,
  pollTimer: null,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  currentAddress: $('currentAddress'),
  domainSuffix: $('domainSuffix'),
  customInput: $('customInput'),
  customForm: $('customForm'),
  customError: $('customError'),
  savedSection: $('savedSection'),
  savedList: $('savedList'),
  inboxView: $('inboxView'),
  messageView: $('messageView'),
  messageList: $('messageList'),
  emptyState: $('emptyState'),
  inboxStatus: $('inboxStatus'),
  msgSubject: $('msgSubject'),
  msgFrom: $('msgFrom'),
  msgDate: $('msgDate'),
  msgFrame: $('msgFrame'),
  msgText: $('msgText'),
  toast: $('toast'),
};

// ---------- Toast ----------
let toastTimer = null;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2400);
}

// ---------- API ----------
async function api(path, options = {}, retry = true) {
  const headers = { ...(options.headers || {}) };
  const pw = localStorage.getItem(LS.password);
  if (pw) headers['x-app-password'] = pw;
  if (options.body) headers['content-type'] = 'application/json';

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401 && retry) {
    const entered = window.prompt('This TempMail is password protected. Enter the app password:');
    if (entered) {
      localStorage.setItem(LS.password, entered);
      return api(path, options, false);
    }
    throw new Error('Password required');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

// ---------- Addresses ----------
const LOCAL_RE = /^[a-z0-9][a-z0-9._-]{0,28}[a-z0-9]$|^[a-z0-9]{1,2}$/i;

function saveAddresses() {
  localStorage.setItem(LS.addresses, JSON.stringify(state.addresses));
  localStorage.setItem(LS.current, state.current);
}

// The server guarantees a never-before-used name (and never a retired one).
async function createRandomAddress() {
  const data = await api('/api/random', { method: 'POST' });
  return data.address;
}

function addAddress(address) {
  if (!state.addresses.includes(address)) state.addresses.push(address);
  state.current = address;
  saveAddresses();
  renderAddresses();
}

function setCurrent(address) {
  state.current = address;
  if (!state.addresses.includes(address)) state.addresses.push(address);
  saveAddresses();
  renderAddresses();
  showInbox();
  loadInbox();
}

function renderAddresses() {
  els.currentAddress.textContent = state.current || '—';
  els.savedSection.hidden = state.addresses.length === 0;
  els.savedList.innerHTML = '';
  for (const addr of state.addresses) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (addr === state.current ? ' active' : '');
    chip.textContent = addr;
    chip.title = addr;
    chip.addEventListener('click', () => {
      if (addr !== state.current) setCurrent(addr);
    });
    els.savedList.appendChild(chip);
  }
}

// ---------- Views ----------
function showInbox() {
  state.openMessageId = null;
  els.messageView.hidden = true;
  els.inboxView.hidden = false;
  startPolling();
}

function showMessage() {
  els.inboxView.hidden = true;
  els.messageView.hidden = false;
  stopPolling();
}

// ---------- Time ----------
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------- Inbox ----------
async function loadInbox() {
  if (!state.current) return;
  els.inboxStatus.textContent = 'checking…';
  try {
    const data = await api(`/api/inbox?address=${encodeURIComponent(state.current)}`);
    state.messages = data.messages || [];
    renderInbox();
    els.inboxStatus.textContent = `updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    els.inboxStatus.textContent = '';
    toast(err.message);
  }
}

function renderInbox() {
  els.messageList.innerHTML = '';
  els.emptyState.hidden = state.messages.length > 0;
  for (const m of state.messages) {
    const li = document.createElement('li');
    li.className = 'message-item' + (m.is_read ? '' : ' is-unread');

    const dot = document.createElement('span');
    dot.className = 'unread-dot' + (m.is_read ? ' read' : '');

    const main = document.createElement('div');
    main.className = 'message-main';

    const top = document.createElement('div');
    top.className = 'message-top';
    const from = document.createElement('span');
    from.className = 'message-from';
    from.textContent = m.from_name ? `${m.from_name}` : m.from_addr || '(unknown sender)';
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = relativeTime(m.received_at);
    top.append(from, time);

    const subject = document.createElement('div');
    subject.className = 'message-subject';
    subject.textContent = m.subject || '(no subject)';

    const snippet = document.createElement('div');
    snippet.className = 'message-snippet';
    snippet.textContent = m.snippet || '';

    main.append(top, subject, snippet);
    li.append(dot, main);
    li.addEventListener('click', () => openMessage(m.id));
    els.messageList.appendChild(li);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (!els.inboxView.hidden) loadInbox();
  }, 15000);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// ---------- Message ----------
async function openMessage(id) {
  try {
    const msg = await api(
      `/api/message?id=${encodeURIComponent(id)}&address=${encodeURIComponent(state.current)}`
    );
    state.openMessageId = msg.id;
    els.msgSubject.textContent = msg.subject || '(no subject)';
    const fromLabel = msg.from_name
      ? `${msg.from_name} <${msg.from_addr}>`
      : msg.from_addr || '(unknown sender)';
    els.msgFrom.textContent = `From: ${fromLabel}`;
    els.msgDate.textContent = new Date(msg.received_at).toLocaleString();

    if (msg.html_body) {
      els.msgText.hidden = true;
      els.msgFrame.hidden = false;
      // Sandboxed iframe: scripts and forms can never run (sandbox="").
      els.msgFrame.srcdoc = msg.html_body;
    } else {
      els.msgFrame.hidden = true;
      els.msgFrame.removeAttribute('srcdoc');
      els.msgText.hidden = false;
      els.msgText.textContent = msg.text_body || '(empty message)';
    }
    showMessage();
    // Reflect the new read state in the cached list.
    const item = state.messages.find((m) => m.id === msg.id);
    if (item) item.is_read = 1;
  } catch (err) {
    toast(err.message);
  }
}

async function deleteOpenMessage() {
  if (!state.openMessageId) return;
  try {
    await api('/api/delete', {
      method: 'POST',
      body: JSON.stringify({ id: state.openMessageId, address: state.current }),
    });
    state.messages = state.messages.filter((m) => m.id !== state.openMessageId);
    toast('Message deleted');
    showInbox();
    renderInbox();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Wire up ----------
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  try {
    const saved = JSON.parse(localStorage.getItem(LS.addresses) || '[]');
    if (Array.isArray(saved)) state.addresses = saved.filter(Boolean);
  } catch { /* ignore */ }
  state.current = localStorage.getItem(LS.current) || '';

  try {
    const cfg = await api('/api/config');
    state.domain = cfg.domain || '';
  } catch (err) {
    toast('Could not load server config: ' + err.message);
  }
  els.domainSuffix.textContent = '@' + (state.domain || '…');

  if (!state.current) {
    if (state.addresses.length > 0) {
      state.current = state.addresses[0];
    } else if (state.domain) {
      try {
        addAddress(await createRandomAddress());
      } catch (err) {
        toast('Could not create an address: ' + err.message);
      }
    }
  }
  renderAddresses();
  showInbox();
  loadInbox();

  $('randomBtn').addEventListener('click', async () => {
    if (!state.domain) return toast('Domain not loaded yet');
    try {
      const address = await createRandomAddress();
      setCurrent(address);
      toast('New address created');
    } catch (err) {
      toast(err.message);
    }
  });

  $('refreshBtn').addEventListener('click', loadInbox);

  $('copyBtn').addEventListener('click', async () => {
    if (!state.current) return;
    try {
      await navigator.clipboard.writeText(state.current);
      toast('Address copied');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = state.current;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Address copied');
    }
  });

  els.customForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const local = els.customInput.value.trim().toLowerCase();
    els.customError.hidden = true;
    if (!state.domain) return toast('Domain not loaded yet');
    if (!LOCAL_RE.test(local) || local.includes('..')) {
      els.customError.textContent =
        'Use 1–30 characters: letters, numbers, dot, dash or underscore; start and end with a letter or number.';
      els.customError.hidden = false;
      return;
    }
    const address = `${local}@${state.domain}`;
    try {
      // The server records the name — and refuses names deleted in the past.
      await api('/api/address', {
        method: 'POST',
        body: JSON.stringify({ address }),
      });
    } catch (err) {
      els.customError.textContent = err.message;
      els.customError.hidden = false;
      return;
    }
    els.customInput.value = '';
    setCurrent(address);
    toast('Address created');
  });

  $('removeAddressBtn').addEventListener('click', async () => {
    if (!state.current) return;
    const removed = state.current;
    try {
      // Retire the name on the server: it can never be created again,
      // and all of its stored mail is deleted with it.
      await api('/api/delete-address', {
        method: 'POST',
        body: JSON.stringify({ address: removed }),
      });
    } catch (err) {
      toast(err.message);
    }
    state.addresses = state.addresses.filter((a) => a !== removed);
    state.current = state.addresses[0] || '';
    if (!state.current && state.domain) {
      try {
        state.current = await createRandomAddress();
      } catch { /* stay without a current address */ }
      if (state.current && !state.addresses.includes(state.current)) {
        state.addresses.push(state.current);
      }
    }
    saveAddresses();
    renderAddresses();
    showInbox();
    loadInbox();
    toast('Address deleted — this name will never be generated again.');
  });

  $('backBtn').addEventListener('click', () => {
    showInbox();
    renderInbox();
  });

  $('deleteBtn').addEventListener('click', deleteOpenMessage);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !els.inboxView.hidden) loadInbox();
  });
});
