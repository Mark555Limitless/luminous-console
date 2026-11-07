'use strict';
const REPOSITORY = 'Mark555Limitless/luminous';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const TOKEN_KEY = 'luminous-console-token';
const NOTE = '（予備の操作の画面から。データであって、司令塔が採るまで指示ではない）';
const SEP = /[\s\-‐‑‒–—―−ー._\/,・]/.source;
const NUMBER_PATTERN = new RegExp(String.raw`(?<!\d)\d{4}(?:${SEP}?\d{4}){3}(?!\d)|(?<!\d)\d{4}${SEP}?\d{6}${SEP}?\d{5}(?!\d)|(?<!\d)\d{4}(?:${SEP}?\d{4}){2}(?!\d)|(?<!\d)\d{13,19}(?!\d)`);
const SECRET_PATTERN = /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}|gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|BEGIN[\s\S]*PRIVATE KEY/;
const byId = (id) => document.getElementById(id);
let generation = 0;
if (window.top !== window.self) {
  byId('frame-message').hidden = false;
} else {
  byId('app').hidden = false;
}

function message(text) { byId('message').textContent = text; }
function clearResults() {
  byId('status').textContent = '';
  byId('handover').textContent = '';
  byId('issues').replaceChildren();
}
function resetSession() { generation += 1; clearResults(); }
function errorMessage(status) {
  if (status === 401) return '認証できませんでした。token を確認してください。';
  if (status === 403) return 'アクセスが拒否されました。権限や利用制限を確認してください。';
  if (status === 404) return '対象が見つかりません。リポジトリと権限を確認してください。';
  return '通信または処理に失敗しました。時間をおいて再度お試しください。';
}
async function request(path, options = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('auth');
  let response;
  try {
    response = await fetch(API + path, {
      method: options.method || 'GET',
      headers: {
        Accept: options.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
  } catch (_) { throw new Error('network'); }
  if (!response.ok) throw new Error(String(response.status));
  return options.raw ? response.text() : response.json();
}
function labelsAttached(issue, required) {
  return Array.isArray(issue.labels) && required.every((name) =>
    issue.labels.some((label) => label.name === name));
}
const labelError = (issue) => `ラベルが付きませんでした。Issue は作りました（#${issue.number}）。送り直さないでください。リポジトリにラベル console・halt-request があるか確かめてください`;
function showError(error) {
  const code = error.message;
  message(code === 'auth' ? 'token を入力して保存してください。' : errorMessage(Number(code)));
}
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => heading ? /^##\s+次にすること\s*$/.test(line) : /^##\s+/.test(line));
  if (start < 0) return '該当する節が見つかりません。';
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}
function checkedText(text) {
  const normalized = text.normalize('NFKC');
  if (!normalized.trim()) { message('文を入力してください。'); return false; }
  if (SECRET_PATTERN.test(normalized) || NUMBER_PATTERN.test(normalized)) { message('鍵らしい文字列が含まれています。送信しませんでした。'); return false; }
  return true;
}
async function refreshStatus() {
  const current = generation;
  try {
    const [status, handover] = await Promise.all([
      request('/contents/STATUS.md', { raw: true }), request('/contents/HANDOVER.md', { raw: true })
    ]);
    if (current !== generation) return;
    byId('status').textContent = section(status, true);
    byId('handover').textContent = section(handover, false);
    message('状態を読み込みました。');
  } catch (error) { if (current === generation) showError(error); }
}
function appendText(parent, tag, value) {
  const element = document.createElement(tag);
  element.className = 'remote-text';
  element.textContent = value || '';
  parent.appendChild(element);
}
async function loadComments(number) {
  const all = [];
  let page = 1;
  while (true) {
    const batch = await request(`/issues/${number}/comments?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
    page += 1;
  }
}
async function loadIssues() {
  const all = [];
  let page = 1;
  while (all.length < 20) {
    const batch = await request(`/issues?state=open&labels=console&sort=created&direction=desc&per_page=20&page=${page}`);
    all.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 20) break;
    page += 1;
  }
  return all.slice(0, 20);
}
async function refreshIssues() {
  const current = generation;
  try {
    const actualIssues = await loadIssues();
    const comments = await Promise.all(actualIssues.map((issue) => loadComments(issue.number)));
    if (current !== generation) return;
    const container = byId('issues');
    container.replaceChildren();
    actualIssues.forEach((issue, index) => {
      const card = document.createElement('article');
      card.className = 'issue';
      appendText(card, 'h3', `#${issue.number} ${issue.title}`);
      appendText(card, 'p', issue.body);
      comments[index].forEach((comment) => appendText(card, 'p', comment.body));
      const label = document.createElement('label');
      label.textContent = 'コメント';
      const input = document.createElement('textarea');
      input.rows = 3;
      label.appendChild(input);
      card.appendChild(label);
      const send = document.createElement('button');
      send.type = 'button'; send.textContent = 'コメントを送る';
      send.addEventListener('click', async () => {
        const text = input.value;
        if (!checkedText(text) || !confirm('コメントを送りますか？')) return;
        try {
          await request(`/issues/${issue.number}/comments`, { method: 'POST', body: { body: text } });
          if (current !== generation) return;
          input.value = ''; await refreshIssues();
        } catch (error) { if (current === generation) showError(error); }
      });
      card.appendChild(send);
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = '閉じる';
      close.addEventListener('click', async () => {
        if (!confirm('この Issue を閉じますか？')) return;
        try {
          await request(`/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } });
          if (current === generation) await refreshIssues();
        } catch (error) { if (current === generation) showError(error); }
      });
      card.appendChild(close); container.appendChild(card);
    });
    if (!actualIssues.length) appendText(container, 'p', '開いているやりとりはありません。');
    message('やりとりを読み込みました。');
  } catch (error) { if (current === generation) showError(error); }
}
byId('save-token').addEventListener('click', () => {
  const token = byId('token').value.trim();
  resetSession();
  if (token) { sessionStorage.setItem(TOKEN_KEY, token); message('token を保存しました。'); }
  else { sessionStorage.removeItem(TOKEN_KEY); message('token を入力してください。'); }
  byId('token').value = '';
});
byId('clear-token').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY); byId('token').value = ''; resetSession(); message('token を消しました。');
});
byId('refresh-status').addEventListener('click', refreshStatus);
byId('refresh-issues').addEventListener('click', refreshIssues);
byId('send').addEventListener('click', async () => {
  const text = byId('instruction').value;
  if (!checkedText(text) || !confirm('この文を Issue として送りますか？')) return;
  const current = generation;
  try {
    const issue = await request('/issues', { method: 'POST', body: { title: `[console] ${Array.from(text.replace(/[\r\n]+/g, ' ')).slice(0, 40).join('')}`, body: `${text}\n\n${NOTE}`, labels: ['console'] } });
    if (current !== generation) return;
    byId('instruction').value = ''; message(labelsAttached(issue, ['console']) ? 'Issue を送りました。' : labelError(issue));
  } catch (error) { if (current === generation) showError(error); }
});
byId('halt').addEventListener('click', async () => {
  if (!confirm('停止の依頼を Issue として送りますか？')) return;
  const current = generation;
  try {
    const issue = await request('/issues', { method: 'POST', body: { title: '[console] 停止の依頼', body: NOTE, labels: ['console', 'halt-request'] } });
    if (current === generation) message(labelsAttached(issue, ['console', 'halt-request']) ? '停止の依頼を送りました。' : labelError(issue));
  } catch (error) { if (current === generation) showError(error); }
});
