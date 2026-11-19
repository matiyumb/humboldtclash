import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_HISTORY, type CatalogSummary, type ChatMessage, type GameSettings, type RoomState } from '../../shared/types';
import type { Catalogs } from './screens/CatalogPicker';
import { call, identity, noteServerTime, socket, store } from './net';
import { forgetClip, unlockAudio } from './audio';
import { Home } from './screens/Home';
import { Setup } from './screens/Setup';
import { Lobby } from './screens/Lobby';
import { Game } from './screens/Game';
import { Results } from './screens/Results';
import { Intro } from './screens/Intro';
import { Mixes } from './screens/Mixes';
import type { HomeTab } from './screens/Home';
import { Banner, CornerControls, Logo } from './ui';

type View = { name: 'home' } | { name: 'setup'; initial: CatalogSummary | null } | { name: 'room' } | { name: 'mixes' };

const codeFromPath = () => {
  const m = location.pathname.match(/^\/sala\/([A-Za-z0-9]{6})\/?$/);
  return m ? m[1].toUpperCase() : null;
};

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [nickname, setNicknameState] = useState(store.nickname());
  const [connected, setConnected] = useState(socket.connected);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefillCode] = useState(codeFromPath());
  const [homeTab, setHomeTabState] = useState<HomeTab>(() => { try { return localStorage.getItem('hc.tab') === 'ranked' ? 'ranked' : 'casual'; } catch { return 'casual'; } });
  const [autoSearch, setAutoSearch] = useState(false);
  /** Cambia al pulsar el logo en el inicio: vuelve a montar la pantalla (como recargarla). */
  const [homeKey, setHomeKey] = useState(0);
  const setHomeTab = (t: HomeTab) => { setHomeTabState(t); setAutoSearch(false); try { localStorage.setItem('hc.tab', t); } catch { /* sin almacenamiento */ } };
  const roomCode = useRef<string | null>(null);

  const setNickname = (n: string) => { setNicknameState(n); store.setNickname(n); };

  const loadCatalogs = useCallback(async () => {
    try {
      const r = await fetch('/api/catalogs', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      setCatalogs(await r.json());
      setCatalogError(null);
    } catch {
      setCatalogError('No se pudo cargar el catálogo. Revisa tu conexión.');
    }
  }, []);

  const enterRoom = useCallback((code: string, mode: 'solo' | 'multi' | 'ranked') => {
    roomCode.current = code;
    store.setRoom(code);
    const path = mode === 'multi' ? `/sala/${code}` : '/';
    if (location.pathname !== path) history.replaceState(null, '', path);
    setView({ name: 'room' });
  }, []);

  const exitRoom = useCallback((message?: string) => {
    roomCode.current = null;
    store.setRoom(null);
    forgetClip();
    setRoom(null);
    setChat([]);
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    setView({ name: 'home' });
    if (message) setNotice({ kind: 'error', text: message });
  }, []);

  // Chat de la sala y expulsión por el anfitrión.
  useEffect(() => {
    const onMessage = (m: ChatMessage) => setChat((list) => {
      // Un mensaje retenido durante la ronda vuelve al revelar: se sustituye, no se duplica.
      const i = list.findIndex((x) => x.id === m.id);
      const next = i >= 0 ? list.map((x, j) => (j === i ? m : x)) : [...list, m];
      return next.slice(-CHAT_HISTORY);
    });
    const onHistory = (h: ChatMessage[]) => setChat(Array.isArray(h) ? h.slice(-CHAT_HISTORY) : []);
    const onKicked = ({ message }: { message?: string }) => exitRoom(message ?? 'El anfitrión te ha expulsado de la sala.');
    socket.on('chat:message', onMessage);
    socket.on('chat:history', onHistory);
    socket.on('room:kicked', onKicked);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:history', onHistory);
      socket.off('room:kicked', onKicked);
    };
  }, [exitRoom]);

  // Recuperar el puesto tras recargar o perder la conexión.
  const rejoin = useCallback(async () => {
    const code = roomCode.current ?? store.room();
    if (!code) return;
    const r = await call<{ code: string }>('room:join', { code, identity: identity(), nickname: store.nickname() });
    if (r.ok) {
      roomCode.current = code;
      setView({ name: 'room' });
    } else if (!r.error.startsWith('Sin conexión')) {
      exitRoom(roomCode.current ? r.error : undefined);
    }
  }, [exitRoom]);

  useEffect(() => {
    void loadCatalogs();
    const onConnect = () => { setConnected(true); void rejoin(); };
    const onDisconnect = () => setConnected(false);
    const onState = (s: RoomState) => {
      if (roomCode.current && s.code !== roomCode.current) return;
      if (s.round) noteServerTime(s.round.serverNow);
      else if (s.intro) noteServerTime(s.intro.serverNow);
      setRoom(s);
    };
    const onReplaced = () => { setReplaced(true); forgetClip(); };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('session:replaced', onReplaced);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('session:replaced', onReplaced);
    };
  }, [loadCatalogs, rejoin]);

  const requireNick = () => {
    if (nickname.trim()) return true;
    setNotice({ kind: 'error', text: 'Escribe un apodo para jugar como invitado.' });
    document.getElementById('nickname')?.focus();
    return false;
  };

  const startSolo = async (catalogId: string, settings: GameSettings) => {
    if (!requireNick()) return;
    unlockAudio();
    setBusy(true);
    const r = await call<{ code: string }>('solo:start', { identity: identity(), nickname, catalogId, settings }, 15000);
    setBusy(false);
    if (r.ok) { setNotice(null); enterRoom(r.code, 'solo'); } else setNotice({ kind: 'error', text: r.error });
  };

  const createRoom = async (catalogId?: string | null, isPublic = false, settings?: GameSettings) => {
    if (!requireNick()) return;
    unlockAudio();
    setBusy(true);
    const r = await call<{ code: string }>('room:create', { identity: identity(), nickname, catalogId: catalogId ?? null, isPublic, settings }, 15000);
    setBusy(false);
    if (r.ok) { setNotice(null); enterRoom(r.code, 'multi'); } else setNotice({ kind: 'error', text: r.error });
  };

  const joinRoom = async (code: string) => {
    if (!requireNick()) return;
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(clean)) { setNotice({ kind: 'error', text: 'El código de sala tiene 6 caracteres.' }); return; }
    unlockAudio();
    setBusy(true);
    const r = await call<{ code: string }>('room:join', { code: clean, identity: identity(), nickname });
    setBusy(false);
    if (r.ok) { setNotice(null); enterRoom(r.code, 'multi'); } else setNotice({ kind: 'error', text: r.error });
  };

  /**
   * El logo lleva al inicio (si estás en una sala, sales de ella; en partida, pregunta antes).
   * Si ya estás en el inicio, lo vuelve a cargar: arriba del todo, sin avisos y con el catálogo al día.
   */
  const goHome = async () => {
    if (view.name === 'room') {
      if (room?.phase === 'playing' && !confirm('¿Abandonar la partida?')) return;
      await leave();
      return;
    }
    setNotice(null);
    if (view.name === 'home') {
      setHomeKey((k) => k + 1);
      void loadCatalogs();
    }
    setView({ name: 'home' });
    window.scrollTo({ top: 0 });
  };

  const leave = async () => {
    await call('room:leave');
    exitRoom();
  };

  const reclaim = async () => {
    unlockAudio();
    setReplaced(false);
    await rejoin();
  };

  let body: React.ReactNode;
  if (replaced) {
    body = (
      <section className="panel center stack">
        <h1 className="h2">Sala abierta en otra ventana</h1>
        <p className="muted">Solo una pestaña por navegador puede jugar en la sala.</p>
        <div className="row center">
          <button className="btn btn--primary" onClick={reclaim}>Jugar desde aquí</button>
          <button className="btn btn--ghost" onClick={() => { setReplaced(false); roomCode.current = null; setRoom(null); history.replaceState(null, '', '/'); setView({ name: 'home' }); }}>Ir al inicio</button>
        </div>
      </section>
    );
  } else if (view.name === 'room') {
    if (!room) body = <section className="panel center"><p className="muted">Conectando con la sala…</p></section>;
    else if (room.phase === 'lobby') body = <Lobby room={room} catalogs={catalogs} chat={chat} onLeave={leave} />;
    else if (room.phase === 'playing') body = room.round ? <Game room={room} chat={chat} onLeave={leave} /> : <Intro room={room} />;
    else body = <Results room={room} chat={chat} onHome={leave} onRanked={async () => { await leave(); setHomeTabState('ranked'); setAutoSearch(true); }} />;
  } else if (view.name === 'mixes') {
    body = <Mixes nickname={nickname} onBack={() => setView({ name: 'home' })} onPlay={(c) => setView({ name: 'setup', initial: c })} />;
  } else if (view.name === 'setup') {
    body = (
      <Setup
        catalogs={catalogs}
        initial={view.initial}
        nickname={nickname}
        setNickname={setNickname}
        busy={busy}
        onBack={() => setView({ name: 'home' })}
        onSolo={startSolo}
        onCreateRoom={(id, s) => createRoom(id, false, s)}
      />
    );
  } else {
    body = (
      <Home
        tab={homeTab}
        setTab={setHomeTab}
        autoSearch={autoSearch}
        onRankedFound={(code) => { setAutoSearch(false); enterRoom(code, 'ranked'); }}
        catalogs={catalogs}
        catalogError={catalogError}
        onRetryCatalogs={loadCatalogs}
        nickname={nickname}
        setNickname={setNickname}
        prefillCode={prefillCode}
        busy={busy}
        onPickCatalog={(c) => { setNotice(null); setView({ name: 'setup', initial: c }); }}
        onSolo={() => { setNotice(null); setView({ name: 'setup', initial: null }); }}
        onCreateRoom={(isPublic) => createRoom(null, isPublic)}
        onMixes={() => { setNotice(null); setView({ name: 'mixes' }); }}
        onJoin={joinRoom}
        onLogo={goHome}
      />
    );
  }

  const inGame = view.name === 'room' && room?.phase === 'playing';
  const screenKey = replaced ? 'replaced' : view.name === 'room' ? `room-${room?.phase ?? 'wait'}-${room?.round ? 'g' : 'i'}` : view.name === 'home' ? `home-${homeKey}` : view.name;
  return (
    <div className="app">
      <CornerControls />
      {!inGame && view.name !== 'home' && (
        <header className="topbar">
          <button className="logo-btn" onClick={goHome} aria-label="Ir al inicio"><Logo small /></button>
        </header>
      )}
      {!connected && <div className="offline" role="status">Sin conexión… reconectando</div>}
      <main className="main">
        {notice && (
          <div className="notice-wrap">
            <Banner kind={notice.kind}>
              <span>{notice.text}</span>
              <button className="banner__close" onClick={() => setNotice(null)} aria-label="Cerrar aviso">×</button>
            </Banner>
          </div>
        )}
        <div className="screen" key={screenKey}>{body}</div>
      </main>
    </div>
  );
}
