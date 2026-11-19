import { useEffect, useId, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, type ChatMessage } from '../../../shared/types';
import { call } from '../net';
import { Icon } from '../ui';

/**
 * Chat de la sala. Los mensajes enviados con una ronda en marcha solo los ves tú hasta la
 * revelación: así nadie puede chivar la respuesta.
 *  - `Chat`: panel fijo (sala de espera y resultados).
 *  - `ChatPopup` + `useChatUnread`: ventana emergente de la partida, que se abre con un botón.
 */
function ChatBody({ messages, you, autoFocus = false }: { messages: ChatMessage[]; you: string; autoFocus?: boolean }) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // La lista baja sola al último mensaje.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
          autoFocus={autoFocus}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!text.trim() || sending}>Enviar</button>
      </form>
      {error && <p className="chat__error" role="alert">{error}</p>}
    </>
  );
}

/** Panel de chat fijo en la página (sala de espera y resultados). */
export function Chat({ messages, you }: { messages: ChatMessage[]; you: string }) {
  return (
    <section className="chat panel" aria-label="Chat de la sala">
      <h2 className="h3">Chat</h2>
      <ChatBody messages={messages} you={you} />
    </section>
  );
}

/** Mensajes de otros jugadores que llegaron con el chat cerrado. */
export function useChatUnread(messages: ChatMessage[], you: string, open: boolean) {
  const [seen, setSeen] = useState<Set<string>>(() => new Set(messages.map((m) => m.id)));
  useEffect(() => {
    if (open) setSeen(new Set(messages.map((m) => m.id)));
  }, [open, messages]);
  return open ? 0 : messages.filter((m) => m.playerId !== you && !seen.has(m.id)).length;
}

/** Ventana emergente de chat durante la partida: flota sobre el juego y no lo desplaza. Esc la cierra. */
export function ChatPopup({ id, messages, you, open, onClose }: { id: string; messages: ChatMessage[]; you: string; open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <section id={id} className="chat chat-pop" role="dialog" aria-modal="false" aria-label="Chat de la sala">
      <header className="chat-pop__head">
        <h2 className="h3"><span aria-hidden="true">{Icon.chat}</span> Chat</h2>
        <button type="button" className="chat-pop__close" onClick={onClose} aria-label="Cerrar chat">{Icon.cross}</button>
      </header>
      <ChatBody messages={messages} you={you} autoFocus />
    </section>
  );
}
