import cfg from './firebase-config.js';

const $ = id => document.getElementById(id);
const V = '10.14.1';
const SAVE_DELAY = 500;

if (cfg && cfg.apiKey && cfg.projectId) start().catch(e => console.error('sync init failed', e));

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  const box = $('syncBox'), status = $('syncStatus'), btn = $('syncBtn');
  box.style.display = '';

  let unsub = null, timer = null, ref = null, ready = false;

  const snapshotOf = s => JSON.stringify({ habits: s.habits, selected: s.selected });
  const setStatus = t => { status.textContent = t; };

  function merge(remote, local) {
    const byId = new Map();
    for (const h of (remote.habits || [])) byId.set(h.id, { ...h, marks: { ...h.marks } });
    for (const h of local.habits) {
      const r = byId.get(h.id);
      if (r) r.marks = { ...h.marks, ...r.marks };
      else byId.set(h.id, { ...h, marks: { ...h.marks } });
    }
    return { habits: [...byId.values()], selected: remote.selected || local.selected };
  }

  async function push() {
    if (!ref) return;
    const s = window.__habit.get();
    try {
      await F.setDoc(ref, { habits: s.habits, selected: s.selected || null, updatedAt: Date.now() });
      setStatus('동기화됨 · ' + new Date().toLocaleTimeString('ko-KR'));
    } catch (e) {
      console.error(e);
      setStatus('동기화 실패: 인터넷 연결을 확인하세요');
    }
  }

  window.addEventListener('habit-save', () => {
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(push, SAVE_DELAY);
  });

  async function onLogin(user) {
    ref = F.doc(db, 'users', user.uid);
    setStatus('동기화 중…');
    const snap = await F.getDoc(ref);
    const local = window.__habit.get();
    const merged = snap.exists() ? merge(snap.data(), local) : local;
    window.__habit.set(merged);
    await F.setDoc(ref, { habits: merged.habits, selected: merged.selected || null, updatedAt: Date.now() });
    ready = true;
    setStatus(user.email + ' · 동기화됨');
    btn.textContent = '로그아웃';
    unsub = F.onSnapshot(ref, s => {
      if (!s.exists() || s.metadata.hasPendingWrites) return;
      const d = s.data();
      const remote = { habits: d.habits || [], selected: d.selected || null };
      if (snapshotOf(remote) === snapshotOf(window.__habit.get())) return;
      window.__habit.set(remote);
      setStatus(user.email + ' · 다른 기기 변경 반영됨');
    });
  }

  function onLogout() {
    ready = false; ref = null;
    if (unsub) { unsub(); unsub = null; }
    setStatus('로그인하면 폰·PC 기록이 자동으로 맞춰집니다');
    btn.textContent = 'Google로 로그인';
  }

  btn.onclick = async () => {
    if (auth.currentUser) {
      if (confirm('로그아웃할까요? 이 기기의 기록은 그대로 남습니다.')) await A.signOut(auth);
      return;
    }
    try {
      await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await A.signInWithRedirect(auth, new A.GoogleAuthProvider());
      } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        alert('로그인 실패: ' + (e.code || e.message));
      }
    }
  };

  onLogout();
  A.onAuthStateChanged(auth, u => { u ? onLogin(u).catch(e => { console.error(e); setStatus('동기화 실패'); }) : onLogout(); });
}
