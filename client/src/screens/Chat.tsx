import { useEffect, useId, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, type ChatMessage } from '../../../shared/types';
import { call } from '../net';

/**
 * Chat de la sala (sala de espera, partida y resultados). Los mensajes enviados con una ronda en
 * marcha solo los ves tú hasta la revelación: así nadie puede chivar la respuesta.
 * `collapsible`: plegado por defecto (en partida), con contador de mensajes nuevos.
 */
export function Chat({ messages, you, collapsible = false }: { messages: ChatMessage[]; you: string; collapsible?: boolean }) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(!collapsible);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(messages.map((m) => m.id)));
  const listRef = useRef<HTMLOListElement>(null);

  // Abierto: todo lo que llega queda leído y la lista baja al último mensaje.
  useEffect(() => {
    if (!open) return;
    setSeen(new Set(messages.map((m) => m.id)));
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  const unread = open ? 0 : messages.filter((m) => m.playerId !== you && !seen.has(m.id)).length;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const r = await call<{ held: boolean }>('chat:send', { text: t });
    setSending(false);
    if (r.ok) { setText(''); setError(null); } else setError(r.error);
  };

  return (
    <section className={`chat panel ${collapsible ? 'chat--fold' : ''}`} aria-label="Chat de la sala">
      {collapsible ? (
        <button type="button" className="chat__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span aria-hidden="true">💬</span> Chat
          {unread > 0 && <span className="chat__badge">{unread}<span className="sr-only"> mensajes nuevos</span></span>}
          <span className="chat__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <h2 className="h3">Chat</h2>
      )}
      {open && (
        <>
          <ol className="chat__list" ref={listRef} aria-live="polite" aria-relevant="additions">
            {messages.length === 0 && <li className="chat__empty">Aún no hay mensajes. ¡Saluda!</li>}
            {messages.map((m) => (
              <li key={m.id} className={`chat__msg ${m.playerId === you ? 'is-me' : ''} ${m.held ? 'is-held' : ''}`}>
                <b className="chat__nick">{m.playerId === you ? 'Tú' : m.nickname}</b>
                <span className="chat__text">{m.text}</span>
                {m.held && <small className="chat__held">Los demás lo verán al revelar la canción</small>}
              </li>
            ))}
          </ol>
          <form className="chat__form" onSubmit={send}>
            <label className="sr-only" htmlFor={inputId}>Mensaje para la sala</label>
            <input
              id={inputId}
              className="input chat__input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Escribe un mensaje…"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" className="btn btn--primary btn--sm" disabled={!text.trim() || sending}>Enviar</button>
          </form>
          {error && <p className="chat__error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
