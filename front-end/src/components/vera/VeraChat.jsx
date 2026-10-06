// VERA — Virtual Environmental Response Assistant (floating chatbot).
//
// Ported from the EMB ESWMP portal's VeraChat (same layout, styling and
// behaviour: launcher, contextual nudges, thinking states, cancel/retry,
// encrypted session history) and adapted to WQMS:
//   • answers come from /api/vera/chat, whose figures are computed from the
//     stored monitoring data;
//   • data changes arrive as proposals rendered as confirmation cards, applied
//     only via /api/vera/actions/confirm, after which every view re-syncs.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  SendOutlined, CloseOutlined, MinusOutlined, DeleteOutlined,
  MessageOutlined, WarningOutlined, ReloadOutlined, QuestionCircleOutlined,
  CheckOutlined, EditOutlined,
} from '@ant-design/icons';
import { animate, utils } from 'animejs';
import api from '../../api/axios';
import encryptedStorage from '../../utils/encryptedStorage';
import { useAuth } from '../../context/authStore';
import { logActivity } from '../../utils/appLog';
import { revalidateYear } from '../../utils/wqmSheets';
import VeraFlameIcon from './VeraFlameIcon';
import VeraMessage from './VeraMessage';
import './VeraChat.css';

const STORAGE_KEY = 'vera_chat_history';
const MAX_STORED = 30;
const MAX_INPUT = 1000;
const HISTORY_TURNS = 8;
const NUDGE_TTL_MS = 11000;

const reducedMotion = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false);

// Contextual feature nudges keyed by the current view. Guidance only.
const CONTEXT_NUDGES = {
  dashboard: 'Want a quick read of this year? Ask me which waterbodies have the most guideline failures.',
  'visualization:forecast': 'I can forecast any parameter at any station — just name the waterbody, station and parameter.',
  'visualization:heatmap': 'I can rank stations by any parameter, or list the readings behind a hot spot.',
  waterbody: 'Ask me about this waterbody — latest readings, exceedances, or a multi-year comparison.',
  'tabular-2026': 'Need to fix a value? Tell me the station, parameter, month and new value and I\'ll prepare it for you to confirm.',
};

const ABOUT_TEXT = 'I\'m VERA, the Virtual Environmental Response Assistant for the EMB Region III Water Quality Monitoring System.\n\n- I look up readings, guideline exceedances and multi-year trends from the stored monitoring data.\n- I forecast parameters with the same engine and horizon as the dashboards.\n- For administrators, I prepare data changes (readings, sampling dates, stations) — nothing is saved until you click **Confirm**.\n\nEvery figure I give comes from the database, not from memory.';

const newId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const readStored = () => {
  try {
    const parsed = encryptedStorage.session.getItem(STORAGE_KEY);
    return Array.isArray(parsed) ? parsed.slice(-MAX_STORED) : [];
  } catch {
    return [];
  }
};

export default function VeraChat({ activeMenu = '', isMobile = false }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(readStored);
  const [typing, setTyping] = useState(false);
  const [thinkStage, setThinkStage] = useState(0);
  const [status, setStatus] = useState({ enabled: true, mode: 'fallback', starterQuestions: [], greeting: '' });
  const [nudge, setNudge] = useState(null);

  const nudgeRef = useRef(null);
  const launcherRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const abortReasonRef = useRef(null);
  const lastUserTextRef = useRef('');
  const pendingAskRef = useRef('');

  const thinkingMessages = useMemo(() => [
    'VERA is thinking…',
    'VERA is checking the monitoring data…',
    'VERA is preparing the answer…',
  ], []);

  useEffect(() => {
    if (!typing) return undefined;
    const id = setInterval(() => setThinkStage((s) => (s + 1) % thinkingMessages.length), 2200);
    return () => { clearInterval(id); setThinkStage(0); };
  }, [typing, thinkingMessages.length]);

  // Status decides whether VERA is shown at all (a developer can turn it off),
  // so it loads on mount rather than on first open.
  useEffect(() => {
    let cancelled = false;
    api.get('/vera/status')
      .then(({ data }) => { if (!cancelled) setStatus((s) => ({ ...s, ...(data || {}) })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { encryptedStorage.session.setItem(STORAGE_KEY, messages.slice(-MAX_STORED)); } catch { /* ignore */ }
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing, open, minimized]);

  // Open from anywhere: window.dispatchEvent(new CustomEvent('vera:open', { detail: { ask } }))
  useEffect(() => {
    const onOpen = (event) => {
      setOpen(true);
      setMinimized(false);
      const ask = String(event?.detail?.ask || '').trim();
      if (ask) pendingAskRef.current = ask;
    };
    window.addEventListener('vera:open', onOpen);
    return () => window.removeEventListener('vera:open', onOpen);
  }, []);

  const showNudge = useCallback((id, text, cta) => {
    if (!id || !text) return;
    const key = `vera_nudge_${id}`;
    try { if (encryptedStorage.session.getItem(key)) return; } catch { /* ignore */ }
    try { encryptedStorage.session.setItem(key, '1'); } catch { /* ignore */ }
    setNudge({ id, text, cta });
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => setNudge(null), NUDGE_TTL_MS);
  }, []);

  const dismissNudge = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    setNudge(null);
  }, []);

  useEffect(() => {
    const onNudge = (e) => { const d = e?.detail || {}; showNudge(d.id, d.text, d.cta); };
    window.addEventListener('vera:nudge', onNudge);
    return () => window.removeEventListener('vera:nudge', onNudge);
  }, [showNudge]);

  useEffect(() => {
    if (open || !activeMenu || !status.enabled) return undefined;
    const text = CONTEXT_NUDGES[activeMenu];
    if (!text) return undefined;
    const t = setTimeout(() => showNudge(`ctx_${activeMenu}`, text, true), 1400);
    return () => clearTimeout(t);
  }, [activeMenu, open, status.enabled, showNudge]);

  useEffect(() => { if (open) dismissNudge(); }, [open, dismissNudge]);
  useEffect(() => () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); }, []);

  useEffect(() => {
    if (!nudge || reducedMotion()) return undefined;
    const created = [];
    if (nudgeRef.current) {
      created.push(animate(nudgeRef.current, {
        opacity: [0, 1], translateY: [10, 0], scale: [0.94, 1], duration: 360, ease: 'outBack',
        onComplete: (self) => { try { utils.cleanInlineStyles(self); } catch { /* ignore */ } },
      }));
    }
    if (launcherRef.current) {
      created.push(animate(launcherRef.current, {
        translateY: [0, -5], duration: 900, ease: 'inOutSine', loop: 4, alternate: true,
        onComplete: (self) => { try { utils.cleanInlineStyles(self); } catch { /* ignore */ } },
      }));
    }
    return () => created.forEach((a) => { try { a.pause?.(); a.revert?.(); } catch { /* ignore */ } });
  }, [nudge]);

  useEffect(() => {
    if (open && !minimized) {
      const t = setTimeout(() => inputRef.current?.focus?.(), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, minimized]);

  const runRequest = useCallback(async (text, priorMessages) => {
    setTyping(true);
    abortReasonRef.current = null;
    const history = priorMessages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.source !== 'error')
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => { abortReasonRef.current = 'timeout'; controller.abort(); }, 45000);

    try {
      const { data = {} } = await api.post('/vera/chat', { message: text, history, page: activeMenu }, { signal: controller.signal, timeout: 50000 });
      if (data.ok && data.answer) {
        setMessages((prev) => [...prev, {
          id: newId(),
          role: 'assistant',
          content: data.answer,
          source: data.source,
          actions: (data.actions || []).map((action) => ({ ...action, state: 'pending' })),
        }]);
      } else {
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', content: data.message || 'Sorry, I couldn\'t answer that right now.', source: 'error', retry: true }]);
      }
    } catch (err) {
      const canceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      const byUser = abortReasonRef.current === 'user';
      const serverMessage = err?.response?.data?.message;
      setMessages((prev) => [...prev, {
        id: newId(),
        role: 'assistant',
        content: byUser
          ? 'Request cancelled. Ask me anything whenever you\'re ready.'
          : serverMessage || (canceled ? 'That request took too long and was stopped. You can retry.' : 'I\'m having trouble reaching the assistant service. You can retry.'),
        source: 'error',
        retry: !byUser && err?.response?.status !== 429,
      }]);
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      abortReasonRef.current = null;
      setTyping(false);
    }
  }, [activeMenu]);

  const send = useCallback((raw) => {
    const text = String(raw ?? '').trim().slice(0, MAX_INPUT);
    if (!text || typing) return;
    lastUserTextRef.current = text;
    const prior = messages;
    setMessages((prev) => [...prev, { id: newId(), role: 'user', content: text }]);
    setInput('');
    runRequest(text, prior);
  }, [typing, messages, runRequest]);

  useEffect(() => {
    if (!open || minimized || typing) return;
    const ask = pendingAskRef.current;
    if (!ask) return;
    pendingAskRef.current = '';
    send(ask);
  }, [open, minimized, typing, send]);

  const retryLast = useCallback(() => {
    if (typing) return;
    const text = lastUserTextRef.current;
    if (!text) return;
    const trimmed = messages.length && messages[messages.length - 1].source === 'error' ? messages.slice(0, -1) : messages;
    setMessages(trimmed);
    runRequest(text, trimmed.slice(0, -1));
  }, [typing, messages, runRequest]);

  const cancelRequest = useCallback(() => {
    if (abortRef.current) { abortReasonRef.current = 'user'; abortRef.current.abort(); }
  }, []);

  const setActionState = useCallback((messageId, token, patch) => {
    setMessages((prev) => prev.map((m) => (m.id !== messageId ? m : {
      ...m,
      actions: (m.actions || []).map((a) => (a.token === token ? { ...a, ...patch } : a)),
    })));
  }, []);

  // Apply a proposal, then pull the new version of that year into every view.
  const confirmAction = useCallback(async (messageId, action) => {
    setActionState(messageId, action.token, { state: 'applying', error: '' });
    try {
      const { data } = await api.post('/vera/actions/confirm', { token: action.token });
      await revalidateYear(data.year, { force: true });
      setActionState(messageId, action.token, { state: 'applied' });
      logActivity('VERA applied change', { year: data.year, change: action.summary }, user);
    } catch (err) {
      setActionState(messageId, action.token, { state: 'failed', error: err?.response?.data?.message || 'The change could not be applied.' });
    }
  }, [setActionState, user]);

  const clearChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    try { encryptedStorage.session.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const closeWindow = useCallback(() => {
    setOpen(false);
    setMinimized(false);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const onKeyDownShell = useCallback((e) => { if (e.key === 'Escape') closeWindow(); }, [closeWindow]);

  const starters = Array.isArray(status.starterQuestions) ? status.starterQuestions : [];
  const showGreeting = messages.length === 0;

  if (!status.enabled) return null;

  return (
    <div className="vera-root">
      {!open && (
        <>
          {nudge && (
            <div className="vera-nudge" ref={nudgeRef} role="status">
              <button type="button" className="vera-nudge-close" aria-label="Dismiss" onClick={dismissNudge}>×</button>
              <span className="vera-nudge-icon"><VeraFlameIcon size={18} anime /></span>
              <div className="vera-nudge-body">
                <p className="vera-nudge-text">{nudge.text}</p>
                {nudge.cta && (
                  <button type="button" className="vera-nudge-cta" onClick={() => { dismissNudge(); setOpen(true); setMinimized(false); }}>
                    Yes, guide me
                  </button>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            ref={launcherRef}
            className="vera-launcher"
            aria-label="Open VERA, the Virtual Environmental Response Assistant"
            onClick={() => { setOpen(true); setMinimized(false); }}
          >
            <span className="vera-launcher-icon"><VeraFlameIcon size={24} /></span>
            <span className="vera-launcher-label">Ask VERA</span>
          </button>
        </>
      )}

      {open && (
        <section
          className={`vera-window${minimized ? ' vera-window-min' : ''}${isMobile ? ' vera-window-mobile' : ''}`}
          role="dialog"
          aria-label="VERA assistant chat"
          onKeyDown={onKeyDownShell}
        >
          <header className="vera-header">
            <div className="vera-header-id">
              <span className="vera-header-icon"><VeraFlameIcon size={22} /></span>
              <div className="vera-header-text">
                <div className="vera-header-name">VERA</div>
                <div className="vera-header-sub">
                  <span className={`vera-status-dot ${status.mode === 'model' ? 'online' : 'lite'}`} />
                  {status.mode === 'model' ? 'Online' : 'Online · Data assistant'}
                </div>
              </div>
            </div>
            <div className="vera-header-actions">
              <button
                type="button"
                className="vera-icon-btn"
                aria-label="About VERA"
                title="About VERA"
                onClick={() => setMessages((prev) => [...prev, { id: newId(), role: 'assistant', content: ABOUT_TEXT, source: 'about' }])}
              >
                <QuestionCircleOutlined />
              </button>
              <button type="button" className="vera-icon-btn" aria-label={minimized ? 'Expand chat' : 'Minimize chat'} onClick={() => setMinimized((m) => !m)}>
                <MinusOutlined />
              </button>
              <button type="button" className="vera-icon-btn" aria-label="Close chat" onClick={closeWindow}>
                <CloseOutlined />
              </button>
            </div>
          </header>

          {!minimized && (
            <>
              <div className="vera-full-name">Virtual Environmental Response Assistant</div>

              <div className="vera-messages" ref={scrollRef} aria-live="polite">
                {showGreeting && (
                  <div className="vera-msg vera-msg-assistant">
                    <div className="vera-bubble">
                      {status.greeting || 'Hi! I\'m VERA. Ask me about readings, exceedances, trends and forecasts for any monitored waterbody.'}
                    </div>
                  </div>
                )}

                {messages.map((m) => (
                  <div key={m.id} className={`vera-msg ${m.role === 'user' ? 'vera-msg-user' : 'vera-msg-assistant'}`}>
                    <div className={`vera-bubble${m.source === 'error' ? ' vera-bubble-error' : ''}${m.role === 'assistant' && m.source !== 'error' ? ' vera-bubble-rich' : ''}`}>
                      {m.source === 'error' && <WarningOutlined className="vera-bubble-warn" />}
                      {m.role === 'assistant' && m.source !== 'error' ? <VeraMessage content={m.content} /> : m.content}
                      {(m.actions || []).map((action) => (
                        <div key={action.token} className={`vera-action vera-action-${action.state}`}>
                          <div className="vera-action-title"><EditOutlined /> Proposed change</div>
                          <div className="vera-action-summary">{action.summary}</div>
                          {action.state === 'pending' && (
                            <div className="vera-action-btns">
                              <button type="button" className="vera-action-confirm" onClick={() => confirmAction(m.id, action)}>
                                <CheckOutlined /> Confirm
                              </button>
                              <button type="button" className="vera-action-discard" onClick={() => setActionState(m.id, action.token, { state: 'discarded' })}>
                                Discard
                              </button>
                            </div>
                          )}
                          {action.state === 'applying' && <div className="vera-action-note">Applying…</div>}
                          {action.state === 'applied' && <div className="vera-action-note ok"><CheckOutlined /> Saved to MongoDB — every dashboard now shows it.</div>}
                          {action.state === 'discarded' && <div className="vera-action-note">Discarded — nothing was changed.</div>}
                          {action.state === 'failed' && <div className="vera-action-note err">{action.error}</div>}
                        </div>
                      ))}
                      {m.retry && !typing && (
                        <button type="button" className="vera-retry-btn" onClick={retryLast}>
                          <ReloadOutlined /> Retry
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {typing && (
                  <div className="vera-msg vera-msg-assistant">
                    <div className="vera-bubble vera-thinking" aria-live="assertive">
                      <span className="vera-thinking-flame"><VeraFlameIcon size={16} /></span>
                      <span className="vera-thinking-text">{thinkingMessages[thinkStage]}</span>
                      <span className="vera-typing" aria-hidden><span /><span /><span /></span>
                      <button type="button" className="vera-cancel-btn" onClick={cancelRequest} aria-label="Cancel request">Cancel</button>
                    </div>
                  </div>
                )}

                {showGreeting && starters.length > 0 && (
                  <div className="vera-starters">
                    <div className="vera-starters-label">Try asking:</div>
                    {starters.map((q) => (
                      <button key={q} type="button" className="vera-starter-chip" onClick={() => send(q)}>{q}</button>
                    ))}
                  </div>
                )}
              </div>

              <div className="vera-quick-actions">
                {messages.length > 0 && (
                  <button type="button" className="vera-quick-btn vera-quick-clear" onClick={clearChat}>
                    <DeleteOutlined /> Clear
                  </button>
                )}
              </div>

              <form className="vera-input-row" onSubmit={(e) => { e.preventDefault(); send(input); }}>
                <textarea
                  ref={inputRef}
                  className="vera-input"
                  value={input}
                  maxLength={MAX_INPUT}
                  rows={1}
                  placeholder="Ask VERA about water quality…"
                  aria-label="Message to VERA"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                />
                <button type="submit" className="vera-send-btn" aria-label="Send message" disabled={!input.trim() || typing}>
                  <SendOutlined />
                </button>
              </form>

              <div className="vera-disclaimer">
                <MessageOutlined /> Figures come from the stored monitoring data. Changes apply only after you confirm.
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
