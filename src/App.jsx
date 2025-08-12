// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

// === Pixel Clock（3x5 像素时钟）====
const FONT = {
  "0": ["111","101","101","101","111"],
  "1": ["010","110","010","010","111"],
  "2": ["111","001","111","100","111"],
  "3": ["111","001","111","001","111"],
  "4": ["101","101","111","001","001"],
  "5": ["111","100","111","001","111"],
  "6": ["111","100","111","101","111"],
  "7": ["111","001","010","010","010"],
  "8": ["111","101","111","101","111"],
  "9": ["111","101","111","001","111"],
  ":": ["000","010","000","010","000"],
};
function PixelChar({ ch, scale = 4 }) {
  const pattern = FONT[ch] || ["000","000","000","000","000"];
  const cell = Math.max(2, scale);
  const gap = Math.max(1, Math.floor(scale / 3));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${pattern[0].length}, ${cell}px)`,
        gridAutoRows: `${cell}px`,
        gap,
      }}
    >
      {pattern.flatMap((row, r) =>
        row.split("").map((bit, c) => (
          <div
            key={`${r}-${c}`}
            style={{
              background: bit === "1" ? "#00ff66" : "transparent",
              boxShadow: bit === "1" ? "0 0 4px #00ff66, 0 0 8px #00ff66" : "none",
              borderRadius: 1,
            }}
          />
        ))
      )}
    </div>
  );
}
function PixelClock({ scale = 4 }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString("zh-CN", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: scale * 1.2 }} title={time}>
      {time.split("").map((ch, i) => <PixelChar key={i} ch={ch} scale={scale} />)}
    </div>
  );
}
// === /Pixel Clock ====


// --- 颜色：固定 + 稳定“伪随机” ---
const FIXED = {
  1: "#fecaca", // 红-浅
  2: "#bbf7d0", // 绿-浅
  3: "#ddd6fe", // 紫-浅
};
const PALETTE = [
  "#fee2e2", "#dcfce7", "#ede9fe", "#e0f2fe",
  "#fff7ed", "#fef9c3", "#fce7f3", "#d1fae5",
];
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function colorFor(key) {
  const asNum = Number(key);
  if (!Number.isNaN(asNum) && FIXED[asNum]) return FIXED[asNum];
  const idx = hashString(String(key)) % PALETTE.length;
  return PALETTE[idx];
}

// --- 小工具 ---
function initials(name) {
  return (name || "游客").slice(0, 2);
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// --- 只保留最近 N 小时 ---
const WINDOW_HOURS = 3;
function windowStartISO() {
  return new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}
function trimToWindow(list) {
  const since = new Date(windowStartISO()).getTime();
  return list.filter(m => new Date(m.created_at).getTime() >= since);
}
function mergeById(prev, incoming) {
  const map = new Map();
  const put = (m) => {
    const key = m.id ?? `${m.created_at}-${m.user_name}-${m.text}`;
    const old = map.get(key);
    map.set(key, { ...(old || {}), ...m });
  };
  prev.forEach(put);
  incoming.forEach(put);
  const out = Array.from(map.values())
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return trimToWindow(out);
}

export default function App() {
  const ROOM = "lobby";
  const [me] = useState("游客" + Math.floor(Math.random() * 1000));
  const [input, setInput] = useState("");
  const [items, setItems] = useState([]);

  const listRef = useRef(null);
  const endRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);

  const didInitialScroll = useRef(false);
  const lastTsRef = useRef(null);
  const pollTimerRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const stopPolling = () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    const startPolling = (fn) => {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(fn, 2000);
      }
    };
    const fetchLatest = async () => {
      const base = supabase.from("messages")
        .select("*").eq("room", ROOM)
        .order("created_at", { ascending: true }).limit(200);
      const cursor = lastTsRef.current || windowStartISO();
      const q = cursor ? base.gte("created_at", cursor) : base;
      const { data, error } = await q;
      if (!isMounted) return;
      if (error) return;
      if (data && data.length) {
        setItems(v => mergeById(v, data));
        lastTsRef.current = data[data.length - 1].created_at;
      }
    };
    (async () => {
      const { data, error } = await supabase.from("messages")
        .select("*").eq("room", ROOM)
        .gte("created_at", windowStartISO())
        .order("created_at", { ascending: true }).limit(200);
      if (!isMounted) return;
      if (!error && data) {
        setItems(trimToWindow(data));
        if (data.length) lastTsRef.current = data[data.length - 1].created_at;
        setTimeout(() => {
          endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
          didInitialScroll.current = true;
        }, 0);
      }
    })();
    const channel = supabase.channel(`room:${ROOM}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          if (!isMounted) return;
          const m = payload?.new;
          if (m?.room === ROOM) {
            setItems(v => mergeById(v, [m]));
            lastTsRef.current = m.created_at;
            stopPolling();
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") stopPolling();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          startPolling(fetchLatest);
        }
      });
    const fallback = setTimeout(() => {
      if (!pollTimerRef.current) startPolling(fetchLatest);
    }, 5000);
    const janitor = setInterval(() => {
      setItems(v => trimToWindow(v));
      if (items.length === 0) lastTsRef.current = windowStartISO();
    }, 60 * 1000);
    return () => {
      isMounted = false;
      clearTimeout(fallback);
      clearInterval(janitor);
      stopPolling();
      supabase.removeChannel(channel);
    };
  }, []);

  const timeline = useMemo(() => {
    const out = [];
    let prev = null;
    items.forEach((m) => {
      if (!prev || !isSameDay(prev.created_at, m.created_at)) {
        out.push({ type: "sep", id: "sep-" + (m.id || m.created_at),
          label: new Date(m.created_at).toLocaleDateString("zh-CN") });
      }
      out.push({ type: "msg", ...m });
      prev = m;
    });
    return out;
  }, [items]);

  useEffect(() => {
    const el = listRef.current;
    function onScroll() {
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setAtBottom(nearBottom);
    }
    el?.addEventListener("scroll", onScroll);
    return () => el?.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (didInitialScroll.current && atBottom) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [timeline, atBottom]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const optimistic = {
      id: `tmp-${Date.now()}`, user_name: me, text, room: ROOM,
      created_at: new Date().toISOString(),
    };
    setItems(v => mergeById(v, [optimistic]));
    const { data, error } = await supabase.from("messages")
      .insert([{ room: ROOM, user_name: me, text }]).select();
    if (error) {
      setItems(v => v.filter(x => x.id !== optimistic.id));
      alert("发送失败：" + error.message);
    } else if (data && data[0]) {
      setItems(v => mergeById([], v.map(x => x.id === optimistic.id ? data[0] : x)));
      lastTsRef.current = data[0].created_at;
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }
  function onKey(e) {
    const onlyEnter = e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey;
    const cmdEnter = e.key === "Enter" && (e.metaKey || e.ctrlKey);
    if (onlyEnter || cmdEnter) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="app">
      <header className="header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="logo" />
        <div>
          <h1>聊天 H5</h1>
          <div className="sub">Supabase 实时 · 稳定着色 · 最近{WINDOW_HOURS}小时窗口</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <PixelClock scale={4} />
        </div>
      </header>

      <section className="panel">
        <div className="list" ref={listRef}>
          {timeline.map((node) => {
            if (node.type === "sep") {
              return <div key={node.id} className="day-sep">— {node.label} —</div>;
            }
            const colorKey = node.user_id ?? node.user_name ?? "unknown";
            const bg = colorFor(colorKey);
            const mine = node.user_name === me;
            return (
              <div key={node.id} className={`row ${mine ? "me" : ""}`}>
                <div className="avatar" title={node.user_name}
                  style={{ background: bg, color: "#111" }}>
                  {initials(node.user_name)}
                </div>
                <div>
                  <div className="bubble"
                    style={{ background: bg, borderColor: "transparent", color: "#111" }}>
                    {node.text}
                  </div>
                  <div className="meta">
                    {node.user_name} · {fmtTime(node.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} className="sticky-bottom" />
        </div>

        <div className="composer">
          <textarea className="input" rows={1} value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
            placeholder="输入消息，Enter 发送 / Shift+Enter 换行" />
          <button className="btn" onClick={send} disabled={!input.trim()}>发送</button>
        </div>
      </section>

      {!atBottom && (
        <button className="scroll-btn"
          onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}>
          回到底部
        </button>
      )}
    </div>
  );
}
